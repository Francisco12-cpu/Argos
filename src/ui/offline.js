/**
 * Uso sem internet: registra o service worker e guarda os modelos opcionais.
 *
 * Tudo aqui é "melhor esforço": sem Cache API (navegação privada, http), o
 * app continua funcionando, só baixa de novo na próxima visita.
 */
import { download } from '../vision/assets.js';

export const MODELS_CACHE = 'argos-models';
/** Cache que o Transformers.js usa para os arquivos do Hugging Face. */
export const TRANSFORMERS_CACHE = 'transformers-cache';

const hasCaches = () => typeof caches !== 'undefined';

export function registerServiceWorker(url = 'sw.js') {
  if (!('serviceWorker' in navigator) || !isSecureContext) return Promise.resolve(null);
  return navigator.serviceWorker.register(url).catch((error) => {
    console.warn('[ARGOS] Sem uso offline', error);
    return null;
  });
}

/** Pede ao navegador para não apagar os modelos quando faltar espaço. */
export async function requestPersistence() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** Baixa um arquivo e guarda no cache; na próxima vez, lê de lá. */
export async function downloadCached(url, options = {}) {
  if (hasCaches()) {
    try {
      const cache = await caches.open(MODELS_CACHE);
      const hit = await cache.match(url);
      if (hit) {
        const buffer = await hit.arrayBuffer();
        options.onProgress?.(buffer.byteLength, buffer.byteLength);
        return buffer;
      }
      const buffer = await download(url, options);
      await cache.put(url, new Response(buffer.slice(0), { headers: { 'content-type': 'application/octet-stream' } })).catch(() => {});
      return buffer;
    } catch (error) {
      if (error?.name === 'AssetError') throw error;
    }
  }
  return download(url, options);
}

export async function isCached(url) {
  if (!hasCaches()) return false;
  try {
    return Boolean(await caches.match(url));
  } catch {
    return false;
  }
}

/**
 * O modo máximo está inteiro no aparelho? Precisa da biblioteca e do
 * arquivo de pesos do modelo no cache.
 */
export async function isMaxModeCached({ library, hub, dtype }) {
  if (!hasCaches()) return false;
  try {
    if (!(await caches.match(library))) return false;
    const cache = await caches.open(TRANSFORMERS_CACHE);
    const keys = await cache.keys();
    const weights = `model_${dtype}.onnx`;
    return keys.some(({ url }) => url.includes(hub) && url.includes(weights));
  } catch {
    return false;
  }
}

/** Quanto espaço o site ocupa no aparelho, para mostrar ao usuário. */
export async function storageUsage() {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return estimate?.usage ?? 0;
  } catch {
    return 0;
  }
}
