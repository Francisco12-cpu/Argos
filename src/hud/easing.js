/** Curvas de animação, todas de 0 a 1. */

export const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

export const easeOutCubic = (t) => 1 - (1 - clamp01(t)) ** 3;

export const easeInOutSine = (t) => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;

/** Progresso de 0 a 1 de uma animação que começou em `start` e dura `duration`. */
export const progress = (now, start, duration) => (start == null ? 1 : clamp01((now - start) / duration));
