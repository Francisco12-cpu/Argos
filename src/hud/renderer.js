/**
 * Laço de desenho do HUD (60 quadros por segundo).
 *
 * Não espera a IA: lê o último estado do rastreador a cada quadro e prevê
 * onde cada objeto está agora pela velocidade medida. Uma suavização extra
 * na tela evita saltos quando chega uma análise nova.
 */
import { labelPt } from '../data/labels-pt.js';
import { clamp, createScreenMapper, intersect, iou } from '../vision/geometry.js';
import { predictBox, TrackStatus } from '../vision/tracker.js';
import { drawBrackets, drawCandidate, drawCaption, drawLabel, placeLabel } from './brackets.js';
import { easeOutCubic, progress } from './easing.js';
import { drawReticle } from './reticle.js';

const DISPLAY_SMOOTHING_MS = 70;
const APPEAR_MS = 260;
const FLASH_MS = 450;
const LABEL_DELAY_MS = 120;
const LABEL_MS = 340;
const MAX_DPR = 2;
/** Objetos com menos que isso visível na tela não ganham etiqueta. */
const MIN_VISIBLE_PX = 28;

/**
 * @typedef {object} HudSource
 * @property {() => {w: number, h: number}} frame   Dimensões da imagem da câmera.
 * @property {() => boolean} mirrored
 * @property {() => object[]} tracks                Objetos do rastreador.
 */

export class HudRenderer {
  #canvas;
  #ctx;
  #source;
  #palette;
  #fadeMs;
  #maxPredictMs;
  #weakMs;
  #reducedMotion;
  #view = { w: 0, h: 0 };
  #insets = { top: 0, bottom: 0 };
  #dpr = 1;
  #running = false;
  #raf = 0;
  #last = 0;
  #frameTimes = [];
  #display = new Map();
  #introStart = null;
  #introMs = 0;

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{source: HudSource, palette: object, fadeMs: number, maxPredictMs: number, reducedMotion: boolean}} options
   */
  constructor(canvas, { source, palette, fadeMs, maxPredictMs, weakMs = 700, reducedMotion }) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext('2d');
    this.#source = source;
    this.#palette = palette;
    this.#fadeMs = fadeMs;
    this.#maxPredictMs = maxPredictMs;
    this.#weakMs = weakMs;
    this.#reducedMotion = reducedMotion;
    this.resize();
  }

  /** Quadros por segundo do desenho, medidos no último segundo. */
  get fps() {
    const times = this.#frameTimes;
    if (times.length < 2) return 0;
    const span = times[times.length - 1] - times[0];
    return span > 0 ? ((times.length - 1) * 1000) / span : 0;
  }

  get view() {
    return this.#view;
  }

  setPalette(palette) {
    this.#palette = palette;
  }

  /** Áreas ocupadas pelas barras de cima e de baixo, onde etiquetas não entram. */
  setInsets(insets) {
    this.#insets = insets;
  }

  playIntro(durationMs) {
    this.#introStart = performance.now();
    this.#introMs = durationMs;
  }

  resize() {
    const rect = this.#canvas.getBoundingClientRect();
    this.#dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.#view = { w: rect.width, h: rect.height };
    this.#canvas.width = Math.max(1, Math.round(rect.width * this.#dpr));
    this.#canvas.height = Math.max(1, Math.round(rect.height * this.#dpr));
  }

  /** Esquece as posições suavizadas (ao trocar de câmera, por exemplo). */
  clear() {
    this.#display.clear();
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#last = performance.now();
    this.#frameTimes = [];
    this.#raf = requestAnimationFrame(this.#frame);
  }

  stop() {
    this.#running = false;
    cancelAnimationFrame(this.#raf);
    this.#ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.#ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
  }

  #frame = (now) => {
    if (!this.#running) return;
    const dt = clamp(now - this.#last, 0, 100);
    this.#last = now;
    const times = this.#frameTimes;
    times.push(now);
    while (now - times[0] > 1000) times.shift();
    this.#draw(now, dt);
    this.#raf = requestAnimationFrame(this.#frame);
  };

  #draw(now, dt) {
    const ctx = this.#ctx;
    const { w, h } = this.#view;
    ctx.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const frame = this.#source.frame();
    if (frame.w > 0 && frame.h > 0) this.#drawTracks(ctx, now, dt, frame);

    const intro = this.#introStart === null ? 1 : progress(now, this.#introStart, this.#introMs);
    const radius = clamp(Math.min(w, h) * 0.12, 40, 84);
    drawReticle(ctx, w / 2, h / 2, radius, now / 1000, {
      palette: this.#palette,
      intro,
      motion: !this.#reducedMotion,
    });
    this.#drawCaption(ctx, now, w / 2, h / 2 + radius + 14);
  }

  /** Sob a mira: o palpite do classificador ou a dica de aproximar. */
  #drawCaption(ctx, now, cx, top) {
    const guess = this.#source.guess?.();
    if (guess) {
      const alpha = easeOutCubic(progress(now, guess.at, 250));
      drawCaption(ctx, cx, top, {
        kicker: `PALPITE · ${Math.round(guess.score * 100)}%`,
        text: guess.name.toLocaleUpperCase('pt-BR'),
        palette: this.#palette,
        alpha,
        accent: true,
      });
      return;
    }
    if (this.#source.hint?.()) {
      const pulse = this.#reducedMotion ? 1 : 0.7 + 0.3 * Math.sin(now / 320);
      drawCaption(ctx, cx, top, {
        kicker: 'NADA À VISTA',
        text: 'APROXIME O OBJETO',
        palette: this.#palette,
        alpha: pulse,
      });
    }
  }

  /**
   * Dúvidas: objetos ainda não confirmados e detecções fracas aparecem
   * tracejados, em vez de simplesmente não existirem.
   */
  #drawDoubts(ctx, now, toScreen) {
    const tracks = this.#source.tracks();
    const solid = tracks.filter((track) => track.status !== TrackStatus.TENTATIVE);
    const palette = this.#palette;
    for (const track of tracks) {
      if (track.status !== TrackStatus.TENTATIVE) continue;
      drawCandidate(ctx, toScreen(track.box), { palette, alpha: 0.7 });
    }
    for (const weak of this.#source.weak?.() ?? []) {
      if (solid.some((track) => iou(track.box, weak.box) > 0.3)) continue;
      const alpha = 1 - clamp((now - weak.at) / this.#weakMs, 0, 1);
      const text = `${labelPt(weak.label).toLocaleUpperCase('pt-BR')} ${Math.round(weak.score * 100)}%`;
      drawCandidate(ctx, toScreen(weak.box), { palette, alpha, text });
    }
  }

  #drawTracks(ctx, now, dt, frame) {
    const toScreen = createScreenMapper(frame, this.#view, this.#source.mirrored());
    const follow = 1 - Math.exp(-dt / DISPLAY_SMOOTHING_MS);
    const palette = this.#palette;
    const items = [];
    const seen = new Set();

    for (const track of this.#source.tracks()) {
      if (track.status === TrackStatus.TENTATIVE) continue;
      const target = toScreen(predictBox(track, now, this.#maxPredictMs));
      let shown = this.#display.get(track.id);
      if (!shown) {
        // As animações de entrada contam a partir de quando o objeto aparece
        // na tela, não de quando a câmera capturou o quadro.
        shown = { box: { ...target }, since: now };
        this.#display.set(track.id, shown);
      } else {
        const { box } = shown;
        box.x += (target.x - box.x) * follow;
        box.y += (target.y - box.y) * follow;
        box.w += (target.w - box.w) * follow;
        box.h += (target.h - box.h) * follow;
      }
      seen.add(track.id);

      const appear = easeOutCubic(progress(now, shown.since, APPEAR_MS));
      // O HUD mostra a dúvida: confiança baixa ou objeto sumido há algumas
      // análises deixam as marcas mais apagadas.
      const certainty = 0.6 + 0.4 * clamp((track.score - 0.3) / 0.4, 0, 1);
      let alpha = appear * certainty * Math.max(0.35, 1 - track.misses * 0.08);
      if (track.status === TrackStatus.LOST) alpha *= 1 - progress(now, track.lostAt, this.#fadeMs);
      items.push({ track, box: shown.box, since: shown.since, alpha, appear });
    }
    for (const id of this.#display.keys()) {
      if (!seen.has(id)) this.#display.delete(id);
    }

    items.sort((a, b) => a.box.y - b.box.y);
    this.#drawDoubts(ctx, now, toScreen);

    for (const { box, since, alpha, appear } of items) {
      drawBrackets(ctx, box, {
        palette,
        alpha,
        spread: (1 - appear) * 14,
        flash: this.#reducedMotion ? 0 : 1 - progress(now, since, FLASH_MS),
      });
    }

    // A etiqueta se prende à parte do objeto que aparece na tela; quem está
    // quase todo fora (o vídeo é cortado para preencher a tela) fica sem.
    const screen = { x: 0, y: 0, w: this.#view.w, h: this.#view.h };
    const taken = [];
    const placement = { safeTop: this.#insets.top, safeBottom: this.#insets.bottom, taken };
    for (const { track, box, since, alpha } of items) {
      const visible = intersect(box, screen);
      if (!visible || visible.w < MIN_VISIBLE_PX || visible.h < MIN_VISIBLE_PX) continue;
      const info = {
        code: track.code,
        name: labelPt(track.label).toLocaleUpperCase('pt-BR'),
        score: track.score,
      };
      const rect = placeLabel(ctx, visible, this.#view, info, placement);
      const reveal = this.#reducedMotion ? 1 : progress(now, since + LABEL_DELAY_MS, LABEL_MS);
      drawLabel(ctx, rect, { ...info, palette, alpha, reveal });
    }
  }
}
