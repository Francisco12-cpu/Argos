/**
 * Interface Detector e sua fábrica.
 *
 * O resto do app só conhece esta interface, então o motor de IA pode ser
 * trocado (outro modelo, outro framework) sem mexer no HUD ou no rastreador.
 *
 * @typedef {{label: string, score: number, box: {x: number, y: number, w: number, h: number}}} Detection
 *   Caixa em fração do quadro inteiro (0 a 1).
 *
 * @typedef {{x: number, y: number, w: number, h: number}} Crop
 *   Recorte do quadro, em pixels da câmera.
 *
 * @typedef {object} Detector
 * @property {'worker'|'main'} backend Onde a IA está rodando.
 * @property {boolean} hasClassifier   Se o classificador de 1.000 categorias carregou.
 * @property {(video: HTMLVideoElement, timestampMs: number, crop?: Crop) => Promise<{detections: Detection[], inferMs: number}>} detect
 * @property {(video: HTMLVideoElement, crop: Crop) => Promise<{top: Array<{index: number, score: number}>, inferMs: number}>} classify
 * @property {() => void} dispose
 */
import { cropToFrame } from './views.js';

/**
 * Cria o detector no Web Worker; se o navegador não permitir, usa a
 * thread principal (funciona, mas o HUD pode engasgar durante a análise).
 * @param {import('./mediapipe-engine.js').EngineOptions & {initTimeoutMs: number}} options
 * @returns {Promise<Detector>}
 */
export async function createDetector(options) {
  try {
    return await WorkerDetector.create(options);
  } catch (error) {
    console.warn('[ARGOS] Web Worker indisponível; a IA vai rodar na thread principal.', error);
    return MainThreadDetector.create(options);
  }
}

class WorkerDetector {
  backend = 'worker';
  hasClassifier = false;
  #worker;
  #pending = new Map();
  #sequence = 0;
  #failure = null;
  #onInit = null;

  static async create({ initTimeoutMs, ...engineOptions }) {
    const worker = new Worker(new URL('./detector.worker.js', import.meta.url), {
      type: 'module',
      name: 'argos-ia',
    });
    const detector = new WorkerDetector(worker);
    try {
      await detector.#init(engineOptions, initTimeoutMs);
    } catch (error) {
      worker.terminate();
      throw error;
    }
    return detector;
  }

  constructor(worker) {
    this.#worker = worker;
    worker.addEventListener('message', (event) => this.#handle(event.data));
    worker.addEventListener('error', (event) => {
      event.preventDefault?.();
      this.#fail(new Error(event.message || 'O worker da IA parou.'));
    });
    worker.addEventListener('messageerror', () => this.#fail(new Error('Mensagem inválida do worker da IA.')));
  }

  #init(engineOptions, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('A IA demorou demais para iniciar.')), timeoutMs);
      this.#onInit = (error, hasClassifier) => {
        clearTimeout(timer);
        this.#onInit = null;
        this.hasClassifier = Boolean(hasClassifier);
        if (error) reject(error);
        else resolve();
      };
      // A cópia dos modelos é proposital: se o worker falhar, a thread
      // principal ainda tem os bytes para tentar de novo.
      this.#worker.postMessage({ type: 'init', options: engineOptions });
    });
  }

  async detect(video, timestampMs, crop) {
    const frame = sourceSize(video);
    const area = crop ?? { x: 0, y: 0, ...frame };
    const result = await this.#run('detect', video, area, { timestamp: timestampMs });
    return { inferMs: result.inferMs, detections: cropToFrame(result.detections, area, frame) };
  }

  async classify(video, crop) {
    const result = await this.#run('classify', video, crop);
    return { inferMs: result.inferMs, top: result.top };
  }

  async #run(type, video, area, extra = {}) {
    if (this.#failure) throw this.#failure;
    const bitmap = await grabFrame(video, area);
    const id = ++this.#sequence;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({ type, id, bitmap, ...extra }, [bitmap]);
    });
  }

  dispose() {
    this.#worker.postMessage({ type: 'dispose' });
    this.#worker.terminate();
    this.#fail(new Error('Detector encerrado.'));
  }

  #handle(message) {
    switch (message.type) {
      case 'ready':
        this.#onInit?.(null, message.hasClassifier);
        break;
      case 'init-error':
        this.#onInit?.(new Error(message.message));
        break;
      case 'result':
      case 'task-error': {
        const pending = this.#pending.get(message.id);
        if (!pending) return;
        this.#pending.delete(message.id);
        if (message.type === 'result') pending.resolve(message);
        else pending.reject(new Error(message.message));
        break;
      }
      default:
        break;
    }
  }

  #fail(error) {
    this.#failure ??= error;
    this.#onInit?.(error);
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}

class MainThreadDetector {
  backend = 'main';
  #engine;

  static async create({ initTimeoutMs: _ignored, ...engineOptions }) {
    const { createEngine } = await import('./mediapipe-engine.js');
    return new MainThreadDetector(await createEngine(engineOptions));
  }

  constructor(engine) {
    this.#engine = engine;
  }

  get hasClassifier() {
    return this.#engine.hasClassifier;
  }

  async detect(video, timestampMs, crop) {
    const frame = sourceSize(video);
    const area = crop ?? { x: 0, y: 0, ...frame };
    const bitmap = await grabFrame(video, area);
    try {
      const result = this.#engine.detect(bitmap, bitmap.width, bitmap.height, timestampMs);
      return { inferMs: result.inferMs, detections: cropToFrame(result.detections, area, frame) };
    } finally {
      bitmap.close();
    }
  }

  async classify(video, crop) {
    const bitmap = await grabFrame(video, crop);
    try {
      return this.#engine.classify(bitmap);
    } finally {
      bitmap.close();
    }
  }

  dispose() {
    this.#engine.close();
  }
}

let fallbackCanvas = null;

/** Captura um trecho do quadro atual como ImageBitmap (transferível ao worker). */
async function grabFrame(video, area) {
  const { x, y, w, h } = area;
  try {
    return await createImageBitmap(video, x, y, w, h);
  } catch {
    // Alguns navegadores não criam bitmap direto do <video>: passa por um canvas.
    fallbackCanvas ??= document.createElement('canvas');
    fallbackCanvas.width = w;
    fallbackCanvas.height = h;
    fallbackCanvas.getContext('2d').drawImage(video, x, y, w, h, 0, 0, w, h);
    return createImageBitmap(fallbackCanvas);
  }
}

/**
 * Modo máximo: o RF-DETR (na GPU, num worker próprio) faz a detecção, e o
 * detector do MediaPipe já carregado continua cuidando dos palpites.
 * @param {Detector} base Detector do MediaPipe (para classify).
 * @param {{library: string, model: string, dtype: string, threshold: number, initTimeoutMs: number,
 *          onProgress?: (loaded: number, total: number) => void}} options
 * @returns {Promise<Detector>}
 */
export async function createMaxDetector(base, { library, model, dtype, threshold, initTimeoutMs, onProgress }) {
  const worker = new Worker(new URL('./rfdetr.worker.js', import.meta.url), { type: 'module', name: 'argos-rfdetr' });
  const pending = new Map();
  let sequence = 0;
  let failure = null;

  const fail = (error) => {
    failure ??= error;
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('O modelo demorou demais para carregar.')), initTimeoutMs);
    worker.addEventListener('message', ({ data }) => {
      if (data.type === 'progress') onProgress?.(data.loaded, data.total);
      else if (data.type === 'ready') {
        clearTimeout(timer);
        resolve();
      } else if (data.type === 'init-error') {
        clearTimeout(timer);
        reject(new Error(data.message));
      } else if (data.type === 'result' || data.type === 'task-error') {
        const entry = pending.get(data.id);
        if (!entry) return;
        pending.delete(data.id);
        if (data.type === 'result') entry.resolve(data);
        else entry.reject(new Error(data.message));
      }
    });
    worker.addEventListener('error', (event) => {
      event.preventDefault?.();
      const error = new Error(event.message || 'O worker do modo máximo parou.');
      clearTimeout(timer);
      reject(error);
      fail(error);
    });
    worker.postMessage({ type: 'init', library, model, dtype });
  }).catch((error) => {
    worker.terminate();
    throw error;
  });

  return {
    backend: 'worker',
    get hasClassifier() {
      return base.hasClassifier;
    },
    async detect(video, timestampMs, crop) {
      if (failure) throw failure;
      const frame = sourceSize(video);
      const area = crop ?? { x: 0, y: 0, ...frame };
      const bitmap = await grabFrame(video, area);
      const id = ++sequence;
      const result = await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: 'detect', id, bitmap, threshold }, [bitmap]);
      });
      return { inferMs: result.inferMs, detections: cropToFrame(result.detections, area, frame) };
    },
    classify: (video, crop) => base.classify(video, crop),
    dispose() {
      worker.postMessage({ type: 'dispose' });
      setTimeout(() => worker.terminate(), 500);
      fail(new Error('Detector encerrado.'));
      base.dispose();
    },
  };
}

/** Tamanho em pixels de um <video> ou de uma imagem (ImageBitmap). */
function sourceSize(source) {
  return { w: source.videoWidth ?? source.width, h: source.videoHeight ?? source.height };
}
