/**
 * Adaptador do MediaPipe Object Detector.
 *
 * Funciona tanto dentro do Web Worker (caminho normal) quanto na thread
 * principal (reserva para navegadores sem suporte). As caixas saem
 * normalizadas, em fração do quadro, para não depender da resolução.
 */
import { ObjectDetector } from '../../vendor/mediapipe/vision_bundle.mjs';

/**
 * @typedef {object} EngineOptions
 * @property {string} loaderUrl   URL absoluta de vision_wasm_module_internal.js
 * @property {string} wasmUrl     URL do .wasm (pode ser blob:)
 * @property {ArrayBuffer} modelBytes
 * @property {'CPU'|'GPU'} delegate
 * @property {number} scoreThreshold
 * @property {number} maxResults
 */

/** @param {EngineOptions} options */
export async function createEngine(options) {
  // O carregador "module" do MediaPipe é um módulo ES. Importá-lo aqui e
  // entregar a fábrica pronta funciona igual no worker e na thread
  // principal; com wasmLoaderPath vazio, o MediaPipe usa essa fábrica.
  const loader = await import(options.loaderUrl);
  globalThis.ModuleFactory = loader.default;

  const detector = await ObjectDetector.createFromOptions(
    { wasmLoaderPath: '', wasmBinaryPath: options.wasmUrl },
    {
      baseOptions: {
        modelAssetBuffer: new Uint8Array(options.modelBytes),
        delegate: options.delegate,
      },
      runningMode: 'VIDEO',
      scoreThreshold: options.scoreThreshold,
      maxResults: options.maxResults,
    },
  );

  let lastTimestamp = -1;

  return {
    /**
     * @param {ImageBitmap|HTMLVideoElement} image
     * @param {number} width  Largura real da imagem em pixels.
     * @param {number} height Altura real da imagem em pixels.
     * @param {number} timestampMs
     */
    detect(image, width, height, timestampMs) {
      // O modo VIDEO exige carimbos de tempo sempre crescentes.
      const timestamp = Math.max(Math.round(timestampMs), lastTimestamp + 1);
      lastTimestamp = timestamp;
      const started = performance.now();
      const result = detector.detectForVideo(image, timestamp);
      const inferMs = performance.now() - started;
      return { inferMs, detections: normalize(result.detections, width, height) };
    },
    close() {
      detector.close();
    },
  };
}

function normalize(detections, width, height) {
  const output = [];
  for (const detection of detections) {
    const category = detection.categories?.[0];
    const box = detection.boundingBox;
    if (!category || !box || !category.categoryName || category.categoryName === '???') continue;
    output.push({
      label: category.categoryName,
      score: category.score,
      box: {
        x: box.originX / width,
        y: box.originY / height,
        w: box.width / width,
        h: box.height / height,
      },
    });
  }
  return output;
}
