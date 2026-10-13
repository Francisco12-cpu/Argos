/**
 * Interface Detector e sua fábrica.
 *
 * O resto do app só conhece esta interface, então o motor de IA pode ser
 * trocado (outro modelo, outro framework) sem mexer no HUD ou no rastreador.
 *
 * @typedef {{label: string, score: number, box: {x: number, y: number, w: number, h: number}}} Detection
 *   Caixa em fração do quadro (0 a 1).
 *
 * @typedef {object} Detector
 * @property {'worker'|'main'} backend Onde a IA está rodando.
 * @property {(video: HTMLVideoElement, timestampMs: number) => Promise<{detections: Detection[], inferMs: number}>} detect
 * @property {() => void} dispose
 */

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
      this.#onInit = (error) => {
        clearTimeout(timer);
        this.#onInit = null;
        if (error) reject(error);
        else resolve();
      };
      // A cópia do modelo é proposital: se o worker falhar, a thread
      // principal ainda tem os bytes para tentar de novo.
      this.#worker.postMessage({ type: 'init', options: engineOptions });
    });
  }

  async detect(video, timestampMs) {
    if (this.#failure) throw this.#failure;
    const bitmap = await grabFrame(video);
    const id = ++this.#sequence;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({ type: 'detect', id, bitmap, timestamp: timestampMs }, [bitmap]);
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
        this.#onInit?.();
        break;
      case 'init-error':
        this.#onInit?.(new Error(message.message));
        break;
      case 'result':
      case 'detect-error': {
        const pending = this.#pending.get(message.id);
        if (!pending) return;
        this.#pending.delete(message.id);
        if (message.type === 'result') {
          pending.resolve({ detections: message.detections, inferMs: message.inferMs });
        } else {
          pending.reject(new Error(message.message));
        }
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

  async detect(video, timestampMs) {
    return this.#engine.detect(video, video.videoWidth, video.videoHeight, timestampMs);
  }

  dispose() {
    this.#engine.close();
  }
}

let fallbackCanvas = null;

/** Captura o quadro atual do vídeo como ImageBitmap (transferível ao worker). */
async function grabFrame(video) {
  try {
    return await createImageBitmap(video);
  } catch {
    // Alguns navegadores não criam bitmap direto do <video>: passa por um canvas.
    fallbackCanvas ??= document.createElement('canvas');
    fallbackCanvas.width = video.videoWidth;
    fallbackCanvas.height = video.videoHeight;
    fallbackCanvas.getContext('2d').drawImage(video, 0, 0);
    return createImageBitmap(fallbackCanvas);
  }
}
