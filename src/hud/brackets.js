/**
 * Cantoneiras e etiquetas dos objetos, desenhadas no canvas.
 *
 *   ┌ OBJ-0007     ▮▮▮▮▯ 92% ╲
 *   │ CADEIRA                 │
 *   └─────────────────────────┘
 *   ┏━━                     ━━┓
 *   ┃         objeto          ┃
 *   ┗━━                     ━━┛
 */
import { clamp } from '../vision/geometry.js';
import { clamp01, easeOutCubic } from './easing.js';
import { rgba } from './themes.js';

const NAME_FONT = '700 12.5px Orbitron, "Share Tech Mono", sans-serif';
const DATA_FONT = '11px "Share Tech Mono", ui-monospace, monospace';
const NAME_SPACING = '0.8px';

const PAD_X = 9;
const LINE_1 = 11; // baseline da primeira linha, a partir do topo da placa
const LINE_2 = 29; // baseline da segunda linha
const PLATE_H = 37;
const CHAMFER = 8;
const MIN_PLATE_W = 96;
const SEGMENTS = 5;
const SEGMENT_W = 4;
const SEGMENT_GAP = 2;
const METER_W = SEGMENTS * SEGMENT_W + (SEGMENTS - 1) * SEGMENT_GAP;

const supportsLetterSpacing =
  typeof CanvasRenderingContext2D !== 'undefined' && 'letterSpacing' in CanvasRenderingContext2D.prototype;

const widths = new Map();

/** Esquece medidas de texto (chame quando as fontes terminarem de carregar). */
export function resetTextMetrics() {
  widths.clear();
}

function measure(ctx, font, text, spacing = '0px') {
  const key = `${font}|${spacing}|${text}`;
  let width = widths.get(key);
  if (width === undefined) {
    ctx.save();
    ctx.font = font;
    if (supportsLetterSpacing) ctx.letterSpacing = spacing;
    width = ctx.measureText(text).width;
    ctx.restore();
    if (widths.size > 400) widths.clear();
    widths.set(key, width);
  }
  return width;
}

function cornerPath(x, y, w, h, len) {
  const path = new Path2D();
  path.moveTo(x, y + len);
  path.lineTo(x, y);
  path.lineTo(x + len, y);
  path.moveTo(x + w - len, y);
  path.lineTo(x + w, y);
  path.lineTo(x + w, y + len);
  path.moveTo(x + w, y + h - len);
  path.lineTo(x + w, y + h);
  path.lineTo(x + w - len, y + h);
  path.moveTo(x + len, y + h);
  path.lineTo(x, y + h);
  path.lineTo(x, y + h - len);
  return path;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number,w:number,h:number}} box Caixa na tela, em pixels CSS.
 * @param {object} style
 * @param {object} style.palette
 * @param {number} style.alpha  Opacidade geral (fade de entrada e saída).
 * @param {number} [style.spread] Quanto as cantoneiras ainda estão abertas (px).
 * @param {number} [style.flash]  Brilho na cor de destaque ao travar no objeto (0 a 1).
 */
export function drawBrackets(ctx, box, { palette, alpha, spread = 0, flash = 0 }) {
  if (alpha <= 0.01) return;
  const x = box.x - spread;
  const y = box.y - spread;
  const w = box.w + spread * 2;
  const h = box.h + spread * 2;
  const len = clamp(Math.min(w, h) * 0.2, 9, 28);

  ctx.save();
  ctx.fillStyle = rgba(palette.primary, 0.045 * alpha);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = rgba(palette.primary, 0.13 * alpha);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, Math.max(w - 1, 0), Math.max(h - 1, 0));

  const corners = cornerPath(x, y, w, h, len);
  ctx.lineCap = 'square';
  ctx.strokeStyle = rgba(palette.primary, 0.22 * alpha);
  ctx.lineWidth = 5;
  ctx.stroke(corners);
  ctx.strokeStyle = rgba(palette.primary, alpha);
  ctx.lineWidth = 1.75;
  ctx.stroke(corners);
  if (flash > 0.01) {
    ctx.strokeStyle = rgba(palette.accent, flash * alpha);
    ctx.lineWidth = 2.5;
    ctx.stroke(corners);
  }
  ctx.restore();
}

/**
 * Calcula onde a etiqueta cabe: acima do objeto; se não houver espaço,
 * dentro dele; se ele for baixo demais, embaixo. Evita sobrepor etiquetas
 * já posicionadas neste quadro (`taken`).
 */
export function placeLabel(ctx, box, view, { code, name, score }, { safeTop, safeBottom, taken }) {
  const pct = `${Math.round(score * 100)}%`;
  const line1 = measure(ctx, DATA_FONT, code) + 14 + METER_W + 6 + measure(ctx, DATA_FONT, pct);
  const line2 = measure(ctx, NAME_FONT, name, NAME_SPACING);
  const w = Math.ceil(Math.max(line1, line2, MIN_PLATE_W - PAD_X * 2) + PAD_X * 2 + CHAMFER / 2);
  const h = PLATE_H;

  const x = clamp(box.x, 6, Math.max(6, view.w - w - 6));
  let y = box.y - h - 6;
  if (y < safeTop) y = box.h > h * 2.2 ? box.y + 6 : box.y + box.h + 6;
  y = clamp(y, safeTop, Math.max(safeTop, view.h - safeBottom - h));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const hit = taken.find((r) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y);
    if (!hit) break;
    y = hit.y + hit.h + 4;
  }

  const rect = { x, y, w, h, pct };
  taken.push(rect);
  return rect;
}

/**
 * @param {number} reveal 0 a 1: a placa abre da esquerda e o nome é "digitado".
 */
export function drawLabel(ctx, rect, { code, name, score, palette, alpha, reveal }) {
  if (alpha <= 0.01 || reveal <= 0) return;
  const { x, y, w, h, pct } = rect;
  const open = easeOutCubic(reveal);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 1, y - 1, w * open + 2, h + 2);
  ctx.clip();

  const plate = new Path2D();
  plate.moveTo(x, y);
  plate.lineTo(x + w - CHAMFER, y);
  plate.lineTo(x + w, y + CHAMFER);
  plate.lineTo(x + w, y + h);
  plate.lineTo(x, y + h);
  plate.closePath();
  ctx.fillStyle = rgba(palette.ink, 0.74 * alpha);
  ctx.fill(plate);
  ctx.strokeStyle = rgba(palette.primary, 0.38 * alpha);
  ctx.lineWidth = 1;
  ctx.stroke(plate);
  ctx.fillStyle = rgba(palette.primary, alpha);
  ctx.fillRect(x, y, 2, h);

  // Linha 1: código à esquerda; medidor de confiança e porcentagem à direita.
  ctx.font = DATA_FONT;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = rgba(palette.primary, 0.92 * alpha);
  ctx.fillText(code, x + PAD_X, y + LINE_1);

  const right = x + w - PAD_X - CHAMFER / 2;
  const pctWidth = measure(ctx, DATA_FONT, pct);
  ctx.fillStyle = rgba(palette.text, alpha);
  ctx.fillText(pct, right - pctWidth, y + LINE_1);

  const meterX = right - pctWidth - 6 - METER_W;
  const filled = Math.round(clamp01(score) * SEGMENTS);
  for (let i = 0; i < SEGMENTS; i += 1) {
    ctx.fillStyle = rgba(palette.primary, (i < filled ? 0.95 : 0.22) * alpha);
    ctx.fillRect(meterX + i * (SEGMENT_W + SEGMENT_GAP), y + LINE_1 - 7, SEGMENT_W, 7);
  }

  // Linha 2: nome do objeto, que aparece letra por letra.
  const typed = Math.ceil(name.length * clamp01((reveal - 0.25) / 0.75));
  if (typed > 0) {
    ctx.font = NAME_FONT;
    if (supportsLetterSpacing) ctx.letterSpacing = NAME_SPACING;
    ctx.fillStyle = rgba(palette.text, alpha);
    ctx.fillText(name.slice(0, typed), x + PAD_X, y + LINE_2);
  }
  ctx.restore();
}

/**
 * Dúvida: algo que a IA talvez tenha visto, com pouca confiança.
 * Retângulo tracejado e um rótulo curto com "?".
 */
export function drawCandidate(ctx, box, { palette, alpha, text }) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = rgba(palette.text, 0.55 * alpha);
  ctx.strokeRect(box.x + 0.5, box.y + 0.5, Math.max(box.w - 1, 0), Math.max(box.h - 1, 0));
  ctx.setLineDash([]);
  if (text) {
    ctx.font = DATA_FONT;
    const label = `? ${text}`;
    const width = measure(ctx, DATA_FONT, label) + 10;
    const y = Math.max(0, box.y - 18);
    ctx.fillStyle = rgba(palette.ink, 0.62 * alpha);
    ctx.fillRect(box.x, y, width, 16);
    ctx.fillStyle = rgba(palette.text, 0.85 * alpha);
    ctx.textBaseline = 'middle';
    ctx.fillText(label, box.x + 5, y + 8.5);
  }
  ctx.restore();
}

/**
 * Legenda centralizada sob a mira: palpite do classificador ou dica.
 * @param {{kicker: string, text: string, palette: object, alpha: number, accent?: boolean}} options
 */
export function drawCaption(ctx, cx, top, { kicker, text, palette, alpha, accent = false }) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  const kickerWidth = measure(ctx, DATA_FONT, kicker);
  const textWidth = measure(ctx, NAME_FONT, text, NAME_SPACING);
  const width = Math.ceil(Math.max(kickerWidth, textWidth) + PAD_X * 2 + 4);
  const x = cx - width / 2;
  ctx.fillStyle = rgba(palette.ink, 0.72 * alpha);
  ctx.fillRect(x, top, width, PLATE_H);
  ctx.fillStyle = rgba(accent ? palette.accent : palette.primary, alpha);
  ctx.fillRect(x, top, width, 2);
  ctx.font = DATA_FONT;
  ctx.fillStyle = rgba(accent ? palette.accent : palette.primary, 0.95 * alpha);
  ctx.fillText(kicker, cx - kickerWidth / 2, top + LINE_1 + 2);
  ctx.font = NAME_FONT;
  if (supportsLetterSpacing) ctx.letterSpacing = NAME_SPACING;
  ctx.fillStyle = rgba(palette.text, alpha);
  ctx.fillText(text, cx - textWidth / 2, top + LINE_2 + 2);
  ctx.restore();
}
