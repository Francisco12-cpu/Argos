/**
 * Adaptador do MediaPipe: detector de objetos + classificador de imagens.
 *
 * Funciona tanto dentro do Web Worker (caminho normal) quanto na thread
 * principal (reserva para navegadores sem suporte). As caixas saem
 * normalizadas, em fração da imagem analisada, para não depender da resolução.
 */
import { ImageClassifier, ObjectDetector } from '../../vendor/mediapipe/vision_bundle.mjs';
import { softmaxTop } from './softmax.js';

/**
 * @typedef {object} EngineOptions
 * @property {string} loaderUrl   URL absoluta de vision_wasm_module_internal.js
 * @property {string} wasmUrl     URL do .wasm (pode ser blob:)
 * @property {{modelBytes: ArrayBuffer, delegate: 'CPU'|'GPU', scoreThreshold: number, maxResults: number}} detector
 * @property {{modelBytes: ArrayBuffer} | null} [classifier]
 */

/** @param {EngineOptions} options */
export async function createEngine(options) {
  // O carregador "module" do MediaPipe é um módulo ES. Cada tarefa criada
  // consome a fábrica (o MediaPipe a apaga depois de usar), então ela é
  // entregue de novo antes de cada criação.
  const loader = await import(options.loaderUrl);
  const fileset = { wasmLoaderPath: '', wasmBinaryPath: options.wasmUrl };

  globalThis.ModuleFactory = loader.default;
  const detector = await ObjectDetector.createFromOptions(fileset, {
    baseOptions: {
      modelAssetBuffer: new Uint8Array(options.detector.modelBytes),
      delegate: options.detector.delegate,
    },
    runningMode: 'VIDEO',
    scoreThreshold: options.detector.scoreThreshold,
    maxResults: options.detector.maxResults,
  });

  let classifier = null;
  if (options.classifier) {
    globalThis.ModuleFactory = loader.default;
    classifier = await ImageClassifier.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: new Uint8Array(options.classifier.modelBytes), delegate: 'CPU' },
      runningMode: 'IMAGE',
      maxResults: -1,
    });
  }

  let lastTimestamp = -1;

  return {
    hasClassifier: classifier !== null,

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

    /**
     * Classifica a imagem inteira e devolve as 5 classes mais prováveis.
     * O modelo int8 devolve logits; aqui viram probabilidades (softmax).
     * @returns {{inferMs: number, top: Array<{index: number, score: number}>}}
     */
    classify(image) {
      if (!classifier) throw new Error('Classificador não carregado');
      const started = performance.now();
      const categories = classifier.classify(image).classifications[0]?.categories ?? [];
      const inferMs = performance.now() - started;
      return { inferMs, top: softmaxTop(categories, 5) };
    },

    close() {
      detector.close();
      classifier?.close();
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
