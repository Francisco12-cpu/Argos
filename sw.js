/**
 * Service worker do ARGOS: deixa o visor funcionar sem internet.
 *
 * - O próprio site (código, motor, modelos, fontes) fica num cache por versão.
 *   O código usa "stale-while-revalidate": abre na hora com o que está
 *   guardado e atualiza em segundo plano.
 * - Os arquivos pesados de fora (modelo preciso, Transformers.js e o motor
 *   ONNX do modo máximo) ficam num cache que sobrevive às versões, com
 *   "cache-first": baixou uma vez, nunca mais.
 * - O modelo do modo máximo (Hugging Face) é guardado pelo próprio
 *   Transformers.js, no cache "transformers-cache".
 */

const VERSION = '0.5.0';
const SHELL_CACHE = `argos-shell-${VERSION}`;
const MODELS_CACHE = 'argos-models';

/** Tudo que o visor precisa para abrir sem internet. */
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'src/main.js',
  'src/core/config.js',
  'src/core/events.js',
  'src/core/state.js',
  'src/data/imagenet-pt.js',
  'src/data/label-groups.js',
  'src/data/labels-pt.js',
  'src/hud/brackets.js',
  'src/hud/easing.js',
  'src/hud/effects.js',
  'src/hud/renderer.js',
  'src/hud/reticle.js',
  'src/hud/themes.js',
  'src/styles/main.css',
  'src/ui/boot.js',
  'src/ui/environment.js',
  'src/ui/error-screen.js',
  'src/ui/offline.js',
  'src/ui/settings.js',
  'src/ui/telemetry.js',
  'src/vision/assets.js',
  'src/vision/camera.js',
  'src/vision/detector.js',
  'src/vision/detector.worker.js',
  'src/vision/geometry.js',
  'src/vision/mediapipe-engine.js',
  'src/vision/one-euro.js',
  'src/vision/rfdetr-format.js',
  'src/vision/rfdetr.worker.js',
  'src/vision/softmax.js',
  'src/vision/tracker.js',
  'src/vision/views.js',
  'vendor/mediapipe/vision_bundle.mjs',
  'vendor/mediapipe/wasm/vision_wasm_module_internal.js',
  'vendor/mediapipe/wasm/vision_wasm_module_internal.wasm',
  'models/efficientdet_lite0_int8.tflite',
  'models/mobilenet_v2_int8.tflite',
  'assets/fonts/orbitron-latin-500-normal.woff2',
  'assets/fonts/orbitron-latin-700-normal.woff2',
  'assets/fonts/orbitron-latin-900-normal.woff2',
  'assets/fonts/share-tech-mono-latin-400-normal.woff2',
  'assets/icons/icon.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-512.png',
  'assets/icons/apple-touch-icon.png',
];

/** Servidores de onde vêm os arquivos pesados dos modos preciso e máximo. */
const LONG_LIVED_HOSTS = ['storage.googleapis.com', 'cdn.jsdelivr.net'];

const isServiceWorker = typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope;

if (isServiceWorker) {
  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches
        .open(SHELL_CACHE)
        .then((cache) => cache.addAll(PRECACHE))
        .then(() => self.skipWaiting()),
    );
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.filter((key) => key.startsWith('argos-shell-') && key !== SHELL_CACHE).map((key) => caches.delete(key))))
        .then(() => self.clients.claim()),
    );
  });

  self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);

    if (url.origin === self.location.origin) {
      if (url.search.includes('nosw')) return;
      // Binários grandes mudam só com a versão: não vale baixar de novo a cada visita.
      const heavy = /\/(vendor|models|assets)\//.test(url.pathname);
      event.respondWith(heavy ? cacheFirst(request, SHELL_CACHE) : staleWhileRevalidate(event, request));
    } else if (LONG_LIVED_HOSTS.includes(url.hostname)) {
      event.respondWith(cacheFirst(request));
    }
  });
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(SHELL_CACHE);
  // Navegação (?debug, ?alguma-coisa) cai sempre na mesma página.
  const key = request.mode === 'navigate' ? new URL('./', self.location).href : request;
  const cached = await cache.match(key, { ignoreSearch: request.mode === 'navigate' });
  const network = fetch(request)
    .then((response) => {
      if (response.ok && response.type === 'basic') cache.put(key, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  return (await network) ?? Response.error();
}

async function cacheFirst(request, cacheName = MODELS_CACHE) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request.url);
  if (cached) return cached;
  const response = await fetch(request);
  // Só guarda respostas completas e legíveis; nada de respostas opacas.
  if (response.ok && (response.type === 'cors' || response.type === 'basic')) cache.put(request.url, response.clone());
  return response;
}
