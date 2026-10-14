/**
 * Converte a saída do pipeline "object-detection" do Transformers.js
 * (com percentage: true) para o formato de detecção do ARGOS.
 *
 * Entrada:  [{ label, score, box: { xmin, ymin, xmax, ymax } }]  (0 a 1)
 * Saída:    [{ label, score, box: { x, y, w, h } }]               (0 a 1)
 */
export function fromTransformers(output) {
  const list = Array.isArray(output) ? output : [];
  const detections = [];
  for (const item of list) {
    const box = item?.box;
    if (!box || typeof item.label !== 'string') continue;
    const x = clamp01(box.xmin);
    const y = clamp01(box.ymin);
    const w = clamp01(box.xmax) - x;
    const h = clamp01(box.ymax) - y;
    if (!(w > 0 && h > 0)) continue;
    detections.push({ label: item.label, score: item.score, box: { x, y, w, h } });
  }
  return detections;
}

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));

/**
 * O aparelho consegue rodar o modo máximo? Precisa de WebGPU com suporte
 * a números de 16 bits (shader-f16), que o modelo fp16 usa.
 */
export async function supportsMaxMode(gpu = globalThis.navigator?.gpu) {
  if (!gpu?.requestAdapter) return false;
  try {
    const adapter = await gpu.requestAdapter();
    return Boolean(adapter?.features?.has?.('shader-f16'));
  } catch {
    return false;
  }
}
