/**
 * Geometria pura (sem DOM), usada pelo rastreador e pelo HUD.
 * Caixas: { x, y, w, h }. Nas detecções, em fração do quadro (0 a 1).
 */

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Interseção sobre união: 0 = não se tocam, 1 = idênticas. */
export function iou(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  if (intersection <= 0) return 0;
  const union = a.w * a.h + b.w * b.h - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Transformação equivalente ao `object-fit: cover`: a imagem de origem
 * (srcW × srcH) preenche a área de destino e o excesso é cortado nas bordas.
 */
export function coverTransform(srcW, srcH, dstW, dstH) {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  return {
    scale,
    offsetX: (dstW - srcW * scale) / 2,
    offsetY: (dstH - srcH * scale) / 2,
  };
}

/**
 * Cria a função que leva caixas normalizadas do quadro da câmera
 * para pixels CSS da tela, já considerando o corte e o espelhamento.
 */
export function createScreenMapper(frame, view, mirrored = false) {
  const { scale, offsetX, offsetY } = coverTransform(frame.w, frame.h, view.w, view.h);
  const fw = frame.w * scale;
  const fh = frame.h * scale;
  return (box) => {
    const w = box.w * fw;
    const h = box.h * fh;
    let x = box.x * fw + offsetX;
    if (mirrored) x = view.w - x - w;
    return { x, y: box.y * fh + offsetY, w, h };
  };
}

/**
 * Quando o modelo vê o mesmo objeto como duas coisas (copo e tigela, por
 * exemplo), fica só a detecção mais confiante.
 * @param {(a: string, b: string) => boolean} [related] Quais rótulos podem ser o mesmo objeto.
 */
export function suppressCrossClass(detections, threshold, related = () => true) {
  const kept = [];
  const sorted = [...detections].sort((a, b) => b.score - a.score);
  for (const detection of sorted) {
    const overlapsStronger = kept.some(
      (other) =>
        other.label !== detection.label &&
        related(other.label, detection.label) &&
        iou(other.box, detection.box) >= threshold,
    );
    if (!overlapsStronger) kept.push(detection);
  }
  return kept;
}

/** Parte da caixa que cai dentro da área visível, ou null. */
export function intersect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  if (right <= x || bottom <= y) return null;
  return { x, y, w: right - x, h: bottom - y };
}
