/**
 * Worker da IA. Roda o MediaPipe fora da thread principal para que o HUD
 * continue a 60 quadros por segundo enquanto o modelo analisa a câmera.
 *
 * Protocolo:
 *   → { type: 'init', options }            ← { type: 'ready' } | { type: 'init-error', message }
 *   → { type: 'detect', id, bitmap, timestamp }
 *                                           ← { type: 'result', id, detections, inferMs }
 *                                           ← { type: 'detect-error', id, message }
 *   → { type: 'dispose' }
 */
import { createEngine } from './mediapipe-engine.js';

let engine = null;

const describe = (error) => (error && (error.message || String(error))) || 'erro desconhecido';

self.addEventListener('message', async ({ data: message }) => {
  switch (message.type) {
    case 'init': {
      try {
        engine = await createEngine(message.options);
        self.postMessage({ type: 'ready' });
      } catch (error) {
        self.postMessage({ type: 'init-error', message: describe(error) });
      }
      break;
    }
    case 'detect': {
      const { id, bitmap, timestamp } = message;
      try {
        if (!engine) throw new Error('IA ainda não iniciada');
        const output = engine.detect(bitmap, bitmap.width, bitmap.height, timestamp);
        self.postMessage({ type: 'result', id, ...output });
      } catch (error) {
        self.postMessage({ type: 'detect-error', id, message: describe(error) });
      } finally {
        bitmap.close();
      }
      break;
    }
    case 'dispose': {
      engine?.close();
      engine = null;
      break;
    }
    default:
      break;
  }
});
