/**
 * Mira central: um anel de 100 marcas (os cem olhos do Argos) girando
 * devagar, quatro arcos girando no sentido contrário e a cruz no centro.
 */
import { clamp01, easeOutCubic } from './easing.js';
import { rgba } from './themes.js';

const TICKS = 100;
const TAU = Math.PI * 2;

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} timeSeconds
 * @param {{palette: object, intro?: number, motion?: boolean}} options
 *   `intro` vai de 0 a 1 na calibração: a mira se desenha do centro para fora.
 */
export function drawReticle(ctx, cx, cy, radius, timeSeconds, { palette, intro = 1, motion = true }) {
  const grow = easeOutCubic(intro);
  const r = radius * (0.35 + 0.65 * grow);
  const spin = motion ? timeSeconds * 0.12 : 0;
  const counterSpin = motion ? -timeSeconds * 0.3 : 0;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineCap = 'butt';

  // Anel de marcas: aparece em varredura durante a calibração.
  const visible = Math.floor(TICKS * clamp01(intro * 1.35));
  const minor = new Path2D();
  const major = new Path2D();
  for (let i = 0; i < visible; i += 1) {
    const angle = spin + (i / TICKS) * TAU - Math.PI / 2;
    const isMajor = i % 25 === 0;
    const length = isMajor ? 9 : i % 5 === 0 ? 5 : 2.5;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const path = isMajor ? major : minor;
    path.moveTo(cos * r, sin * r);
    path.lineTo(cos * (r - length), sin * (r - length));
  }
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = 3;
  ctx.stroke(minor);
  ctx.stroke(major);
  ctx.strokeStyle = rgba(palette.primary, 0.5);
  ctx.lineWidth = 1;
  ctx.stroke(minor);
  ctx.strokeStyle = rgba(palette.primary, 0.95);
  ctx.lineWidth = 1.5;
  ctx.stroke(major);

  // Arcos internos, nas diagonais, para não cruzar com a mira.
  const inner = r * 0.56;
  const arc = (52 * Math.PI) / 180 * grow;
  if (arc > 0.01) {
    for (let k = 0; k < 4; k += 1) {
      const start = counterSpin + k * (Math.PI / 2) + Math.PI / 4 - arc / 2;
      ctx.beginPath();
      ctx.arc(0, 0, inner, start, start + arc);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.strokeStyle = rgba(palette.primary, 0.9);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // Cruz com vão no meio e ponto de destaque.
  const gap = 4;
  const arm = 7 * grow;
  if (arm > 0.5) {
    const cross = new Path2D();
    cross.moveTo(-gap - arm, 0);
    cross.lineTo(-gap, 0);
    cross.moveTo(gap, 0);
    cross.lineTo(gap + arm, 0);
    cross.moveTo(0, -gap - arm);
    cross.lineTo(0, -gap);
    cross.moveTo(0, gap);
    cross.lineTo(0, gap + arm);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 3;
    ctx.stroke(cross);
    ctx.strokeStyle = rgba(palette.text, 0.95);
    ctx.lineWidth = 1.25;
    ctx.stroke(cross);
  }
  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.arc(0, 0, 1.75, 0, TAU);
  ctx.fill();

  ctx.restore();
}
