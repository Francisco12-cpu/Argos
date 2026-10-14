/**
 * "Zoom de análise": em vez de sempre reduzir a imagem inteira da câmera
 * para os 320 × 320 pixels que o modelo enxerga, o ARGOS alterna entre a
 * imagem inteira e um recorte quadrado do centro, onde fica a mira.
 * No recorte, os objetos chegam à IA de 2 a 3 vezes maiores.
 *
 * Funções puras: rodam e são testadas no Node.
 */

/** Margem (em fração do recorte) para considerar que a caixa encosta na borda. */
const EDGE_MARGIN = 0.015;

/**
 * Recorte quadrado no centro do quadro, em pixels inteiros.
 * @param {{w: number, h: number}} frame
 * @param {number} fraction Lado do recorte em fração do menor lado do quadro.
 */
export function centerCrop(frame, fraction) {
  const side = Math.max(1, Math.round(Math.min(frame.w, frame.h) * fraction));
  return {
    x: Math.round((frame.w - side) / 2),
    y: Math.round((frame.h - side) / 2),
    w: side,
    h: side,
  };
}

/** O recorte em fração do quadro (o formato que o rastreador usa). */
export function cropRegion(crop, frame) {
  return { x: crop.x / frame.w, y: crop.y / frame.h, w: crop.w / frame.w, h: crop.h / frame.h };
}

/**
 * Converte caixas normalizadas no recorte para caixas normalizadas no quadro.
 * Num recorte menor que o quadro, caixas que encostam na borda são objetos
 * cortados ao meio: ficam de fora, e a passada pela imagem inteira cuida deles.
 */
export function cropToFrame(detections, crop, frame) {
  const isFull = crop.x === 0 && crop.y === 0 && crop.w === frame.w && crop.h === frame.h;
  const output = [];
  for (const detection of detections) {
    const { x, y, w, h } = detection.box;
    if (!isFull) {
      const touches =
        x <= EDGE_MARGIN || y <= EDGE_MARGIN || x + w >= 1 - EDGE_MARGIN || y + h >= 1 - EDGE_MARGIN;
      if (touches) continue;
    }
    output.push({
      ...detection,
      box: {
        x: (crop.x + x * crop.w) / frame.w,
        y: (crop.y + y * crop.h) / frame.h,
        w: (w * crop.w) / frame.w,
        h: (h * crop.h) / frame.h,
      },
    });
  }
  return output;
}

/**
 * Decide o que a próxima análise olha: imagem inteira ou centro.
 * Em câmeras de baixa resolução o recorte não acrescenta detalhe e fica desligado.
 */
export class ViewScheduler {
  #count = 0;

  /**
   * @param {{enabled: boolean, cropFraction: number, minFrameSide: number}} options
   */
  constructor({ enabled = true, cropFraction = 0.55, minFrameSide = 480 } = {}) {
    this.enabled = enabled;
    this.cropFraction = cropFraction;
    this.minFrameSide = minFrameSide;
  }

  reset() {
    this.#count = 0;
  }

  /**
   * @param {{w: number, h: number}} frame
   * @returns {{kind: 'full'|'center', crop: {x:number,y:number,w:number,h:number}, region: {x:number,y:number,w:number,h:number}}}
   */
  next(frame) {
    const useCenter = this.enabled && Math.min(frame.w, frame.h) >= this.minFrameSide && this.#count % 2 === 1;
    this.#count += 1;
    if (!useCenter) {
      return { kind: 'full', crop: { x: 0, y: 0, w: frame.w, h: frame.h }, region: { x: 0, y: 0, w: 1, h: 1 } };
    }
    const crop = centerCrop(frame, this.cropFraction);
    return { kind: 'center', crop, region: cropRegion(crop, frame) };
  }
}
