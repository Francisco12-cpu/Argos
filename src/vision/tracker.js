/**
 * Rastreador de objetos.
 *
 * Recebe as detecções cruas de cada análise da IA e devolve objetos
 * estáveis: cada um com código fixo (OBJ-0001), caixa sem tremor,
 * velocidade para prever a posição entre análises e um ciclo de vida:
 *
 *   tentative ──3 análises seguidas──▶ confirmed ──10 sem ver──▶ lost ──fade──▶ (removido)
 *       │                                  ▲                      │
 *       └──falhou uma vez──▶ (removido)    └──────reapareceu──────┘
 *
 * Tudo aqui é JavaScript puro, sem DOM: roda e é testado no Node.
 */
import { areConfusable } from '../data/label-groups.js';
import { clamp, iou, suppressCrossClass } from './geometry.js';
import { OneEuroFilter } from './one-euro.js';

export const TrackStatus = Object.freeze({
  TENTATIVE: 'tentative',
  CONFIRMED: 'confirmed',
  LOST: 'lost',
});

const DEFAULTS = Object.freeze({
  minScoreNew: 0.45,
  minScoreKeep: 0.3,
  confirmHits: 3,
  maxMisses: 10,
  fadeMs: 400,
  iouSame: 0.3,
  iouCross: 0.55,
  crossClassIou: 0.7,
  voteDecay: 0.85,
  scoreSmoothing: 0.35,
  maxPredictMs: 250,
  filter: {
    position: { minCutoff: 1.2, beta: 8, dCutoff: 1 },
    size: { minCutoff: 0.8, beta: 4, dCutoff: 1 },
  },
  /** Rótulos diferentes que ainda podem ser o mesmo objeto. */
  related: areConfusable,
});

/** Bônus de prioridade no casamento detecção ↔ objeto. */
const SAME_LABEL_BONUS = 0.15;
const CONFIRMED_BONUS = 0.05;

export const formatCode = (n) => `OBJ-${String(n).padStart(4, '0')}`;

/**
 * Posição prevista de um objeto no instante `timeMs`, pela velocidade
 * medida. A previsão vai no máximo `maxPredictMs` além da última medição.
 */
export function predictBox(track, timeMs, maxPredictMs = DEFAULTS.maxPredictMs) {
  const dt = clamp(timeMs - track.updatedAt, 0, maxPredictMs) / 1000;
  const v = track.velocity;
  const w = Math.max(track.w + v.w * dt, 1e-4);
  const h = Math.max(track.h + v.h * dt, 1e-4);
  const cx = track.cx + v.cx * dt;
  const cy = track.cy + v.cy * dt;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export class Tracker {
  #options;
  #tracks = [];
  #nextId = 1;
  #nextCode = 1;

  constructor(options = {}) {
    this.#options = {
      ...DEFAULTS,
      ...options,
      filter: { ...DEFAULTS.filter, ...options.filter },
    };
  }

  get options() {
    return this.#options;
  }

  /** Todos os objetos, inclusive os ainda não confirmados. */
  get tracks() {
    return this.#tracks;
  }

  /** Objetos que o HUD deve mostrar (confirmados ou sumindo). */
  get visible() {
    return this.#tracks.filter((track) => track.status !== TrackStatus.TENTATIVE);
  }

  /** Esquece os objetos atuais. A numeração dos códigos continua. */
  reset() {
    this.#tracks = [];
  }

  /**
   * Processa uma análise.
   * @param {Array<{label: string, score: number, box: {x:number,y:number,w:number,h:number}}>} detections
   *   Caixas em fração do quadro.
   * @param {number} timeMs Instante em que o quadro foi capturado.
   * @returns {{confirmed: object[], revived: object[], lost: object[], removed: object[]}}
   */
  update(detections, timeMs) {
    const o = this.#options;
    const events = { confirmed: [], revived: [], lost: [], removed: [] };

    const candidates = suppressCrossClass(
      detections.filter((d) => d.score >= o.minScoreKeep && d.box.w > 0 && d.box.h > 0),
      o.crossClassIou,
      o.related,
    );

    // 1. Pares possíveis objeto ↔ detecção, do mais provável ao menos provável.
    const pairs = [];
    this.#tracks.forEach((track, trackIndex) => {
      const predicted = predictBox(track, timeMs, o.maxPredictMs);
      candidates.forEach((detection, detectionIndex) => {
        if (track.status === TrackStatus.TENTATIVE && detection.score < o.minScoreNew) return;
        const sameLabel = detection.label === track.label;
        if (!sameLabel && !o.related(track.label, detection.label)) return;
        const overlap = iou(predicted, detection.box);
        if (overlap < (sameLabel ? o.iouSame : o.iouCross)) return;
        const priority =
          overlap +
          (sameLabel ? SAME_LABEL_BONUS : 0) +
          (track.status === TrackStatus.CONFIRMED ? CONFIRMED_BONUS : 0);
        pairs.push({ trackIndex, detectionIndex, priority });
      });
    });
    pairs.sort((a, b) => b.priority - a.priority);

    // 2. Casamento guloso: cada objeto e cada detecção entram uma vez só.
    const matchedTracks = new Set();
    const matchedDetections = new Set();
    for (const { trackIndex, detectionIndex } of pairs) {
      if (matchedTracks.has(trackIndex) || matchedDetections.has(detectionIndex)) continue;
      matchedTracks.add(trackIndex);
      matchedDetections.add(detectionIndex);
      this.#observe(this.#tracks[trackIndex], candidates[detectionIndex], timeMs, events);
    }

    // 3. Objetos que não apareceram nesta análise.
    const survivors = [];
    this.#tracks.forEach((track, trackIndex) => {
      if (!matchedTracks.has(trackIndex)) {
        track.misses += 1;
        track.streak = 0;
        if (track.status === TrackStatus.TENTATIVE) {
          events.removed.push(track);
          return;
        }
        if (track.status === TrackStatus.CONFIRMED && track.misses >= o.maxMisses) {
          track.status = TrackStatus.LOST;
          track.lostAt = timeMs;
          events.lost.push(track);
        }
        if (track.status === TrackStatus.LOST && timeMs - track.lostAt >= o.fadeMs) {
          events.removed.push(track);
          return;
        }
      }
      survivors.push(track);
    });
    this.#tracks = survivors;

    // 4. Detecções novas e confiantes viram candidatos a objeto.
    candidates.forEach((detection, detectionIndex) => {
      if (matchedDetections.has(detectionIndex) || detection.score < o.minScoreNew) return;
      const track = this.#create(detection, timeMs);
      if (track.streak >= o.confirmHits) this.#confirm(track, timeMs, events);
      this.#tracks.push(track);
    });

    return events;
  }

  #create(detection, timeMs) {
    const { position, size } = this.#options.filter;
    const track = {
      id: this.#nextId++,
      code: null,
      label: detection.label,
      votes: new Map(),
      score: detection.score,
      status: TrackStatus.TENTATIVE,
      cx: 0,
      cy: 0,
      w: 0,
      h: 0,
      box: null,
      velocity: { cx: 0, cy: 0, w: 0, h: 0 },
      hits: 0,
      streak: 0,
      misses: 0,
      firstSeen: timeMs,
      lastSeen: timeMs,
      updatedAt: timeMs,
      confirmedAt: null,
      lostAt: null,
      filters: {
        cx: new OneEuroFilter(position),
        cy: new OneEuroFilter(position),
        w: new OneEuroFilter(size),
        h: new OneEuroFilter(size),
      },
    };
    this.#observe(track, detection, timeMs, null);
    return track;
  }

  #observe(track, detection, timeMs, events) {
    const o = this.#options;
    const t = timeMs / 1000;
    const { box } = detection;
    const { filters } = track;

    track.cx = filters.cx.filter(box.x + box.w / 2, t);
    track.cy = filters.cy.filter(box.y + box.h / 2, t);
    track.w = filters.w.filter(box.w, t);
    track.h = filters.h.filter(box.h, t);
    track.box = { x: track.cx - track.w / 2, y: track.cy - track.h / 2, w: track.w, h: track.h };
    track.velocity = {
      cx: filters.cx.velocity,
      cy: filters.cy.velocity,
      w: filters.w.velocity,
      h: filters.h.velocity,
    };

    // Votação de rótulo: o nome exibido é o mais votado recentemente,
    // então um "copo" não vira "tigela" por causa de uma análise só.
    for (const [label, weight] of track.votes) track.votes.set(label, weight * o.voteDecay);
    track.votes.set(detection.label, (track.votes.get(detection.label) ?? 0) + detection.score);
    track.label = mostVoted(track.votes);

    track.score = track.hits === 0 ? detection.score : track.score + o.scoreSmoothing * (detection.score - track.score);
    track.hits += 1;
    track.streak += 1;
    track.misses = 0;
    track.lastSeen = timeMs;
    track.updatedAt = timeMs;

    if (!events) return;
    if (track.status === TrackStatus.LOST) {
      track.status = TrackStatus.CONFIRMED;
      track.lostAt = null;
      events.revived.push(track);
    } else if (track.status === TrackStatus.TENTATIVE && track.streak >= o.confirmHits) {
      this.#confirm(track, timeMs, events);
    }
  }

  #confirm(track, timeMs, events) {
    track.status = TrackStatus.CONFIRMED;
    track.code = formatCode(this.#nextCode++);
    track.confirmedAt = timeMs;
    events.confirmed.push(track);
  }
}

function mostVoted(votes) {
  let best = null;
  let bestWeight = -Infinity;
  for (const [label, weight] of votes) {
    if (weight > bestWeight) {
      best = label;
      bestWeight = weight;
    }
  }
  return best;
}
