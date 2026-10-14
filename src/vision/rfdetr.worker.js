/**
 * Worker do modo máximo: RF-DETR Nano (Roboflow, Apache 2.0) via
 * Transformers.js, rodando na GPU do aparelho (WebGPU).
 *
 * O Transformers.js (versão fixa) e o motor ONNX vêm do jsDelivr, e o
 * modelo (cerca de 54 MB, fp16) vem do Hugging Face no primeiro uso; o
 * navegador guarda tudo em cache.
 *
 * Protocolo:
 *   → { type: 'init', library, model, dtype }        ← { type: 'progress', loaded, total }
 *                                           ← { type: 'ready' } | { type: 'init-error', message }
 *   → { type: 'detect', id, bitmap, threshold }
 *                                           ← { type: 'result', id, detections, inferMs }
 *                                           ← { type: 'task-error', id, message }
 */
import { fromTransformers } from './rfdetr-format.js';

let detector = null;
let RawImage = null;
let canvas = null;
const files = new Map();

const describe = (error) => (error && (error.message || String(error))) || 'erro desconhecido';

function reportProgress(event) {
  if (event.status !== 'progress' || !event.file) return;
  files.set(event.file, { loaded: event.loaded ?? 0, total: event.total ?? 0 });
  let loaded = 0;
  let total = 0;
  for (const file of files.values()) {
    loaded += file.loaded;
    total += file.total;
  }
  self.postMessage({ type: 'progress', loaded, total });
}

function toRawImage(bitmap) {
  canvas ??= new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return new RawImage(data, bitmap.width, bitmap.height, 4);
}

self.addEventListener('message', async ({ data: message }) => {
  switch (message.type) {
    case 'init': {
      try {
        const transformers = await import(message.library);
        transformers.env.allowLocalModels = false;
        // Guarda os pesos no cache do navegador: o modo máximo funciona sem internet depois.
        transformers.env.useBrowserCache = true;
        RawImage = transformers.RawImage;
        detector = await transformers.pipeline('object-detection', message.model, {
          device: 'webgpu',
          dtype: message.dtype,
          progress_callback: reportProgress,
        });
        self.postMessage({ type: 'ready' });
      } catch (error) {
        self.postMessage({ type: 'init-error', message: describe(error) });
      }
      break;
    }
    case 'detect': {
      const { id, bitmap, threshold } = message;
      try {
        if (!detector) throw new Error('Modelo ainda não carregado');
        const image = toRawImage(bitmap);
        const started = performance.now();
        const output = await detector(image, { threshold, percentage: true });
        const inferMs = performance.now() - started;
        self.postMessage({ type: 'result', id, inferMs, detections: fromTransformers(output) });
      } catch (error) {
        self.postMessage({ type: 'task-error', id, message: describe(error) });
      } finally {
        bitmap.close();
      }
      break;
    }
    case 'dispose': {
      await detector?.dispose?.();
      detector = null;
      break;
    }
    default:
      break;
  }
});
