/**
 * Câmera: abre, troca entre frontal e traseira e traduz os erros do
 * navegador em mensagens que a pessoa consegue resolver.
 */

const MESSAGES = Object.freeze({
  insecure: 'A câmera só funciona em páginas seguras (https). Abra o ARGOS pelo link publicado.',
  unsupported: 'Este navegador não dá acesso à câmera. Abra o ARGOS no Chrome ou no Safari atualizados.',
  denied: 'O acesso à câmera foi bloqueado. Toque no cadeado ao lado do endereço, permita a câmera e tente de novo.',
  'not-found': 'Nenhuma câmera foi encontrada neste aparelho.',
  'in-use': 'Outro app está usando a câmera. Feche-o e tente de novo.',
  'no-frames': 'A câmera abriu, mas não enviou imagem. Tente de novo.',
  ended: 'A câmera foi desligada pelo sistema ou por outro app. Tente de novo.',
  unknown: 'Não foi possível abrir a câmera. Tente de novo.',
});

export class CameraError extends Error {
  constructor(code, cause) {
    super(MESSAGES[code] ?? MESSAGES.unknown);
    this.name = 'CameraError';
    this.code = code;
    this.cause = cause;
  }
}

/** Traduz erros do getUserMedia para os códigos do ARGOS. */
export function toCameraError(error) {
  if (error instanceof CameraError) return error;
  switch (error?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return new CameraError('denied', error);
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return new CameraError('not-found', error);
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new CameraError('in-use', error);
    case 'NotSupportedError':
      return new CameraError('unsupported', error);
    default:
      return new CameraError('unknown', error);
  }
}

const FRAME_TIMEOUT_MS = 8_000;

export class Camera {
  #video;
  #stream = null;
  #facing = 'environment';
  #mirrored = false;

  /** Chamado quando a câmera é desligada por fora (outro app, cabo solto). */
  onEnded = null;

  constructor(video) {
    this.#video = video;
  }

  get active() {
    return this.#stream !== null;
  }

  get facing() {
    return this.#facing;
  }

  /** Dimensões reais da imagem da câmera, em pixels. */
  get frame() {
    return { w: this.#video.videoWidth, h: this.#video.videoHeight };
  }

  /**
   * Imagem espelhada? Sim na câmera frontal; nas webcams de computador,
   * que não informam o lado, também (é o que as pessoas esperam).
   */
  get mirrored() {
    return this.#mirrored;
  }

  #detectMirrored(track) {
    const facingMode = track?.getSettings?.().facingMode;
    if (facingMode) return facingMode === 'user';
    return !matchMedia('(pointer: coarse)').matches;
  }

  async start(facing = this.#facing) {
    if (!window.isSecureContext) throw new CameraError('insecure');
    if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unsupported');

    this.stop();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
    } catch (error) {
      if (error?.name !== 'OverconstrainedError') throw toCameraError(error);
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      } catch (retryError) {
        throw toCameraError(retryError);
      }
    }

    this.#stream = stream;
    this.#facing = facing;
    const [track] = stream.getVideoTracks();
    track?.addEventListener('ended', () => {
      if (this.#stream === stream) this.onEnded?.();
    });

    this.#mirrored = this.#detectMirrored(track);

    const video = this.#video;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.srcObject = stream;
    video.classList.toggle('mirrored', this.#mirrored);
    try {
      await video.play();
    } catch {
      // Alguns navegadores recusam play() fora do toque; o autoplay mudo resolve.
    }
    await waitForFrames(video);
  }

  /** Alterna frontal ↔ traseira. Se não der, volta para a câmera anterior. */
  async switchFacing() {
    const previous = this.#facing;
    const next = previous === 'environment' ? 'user' : 'environment';
    try {
      await this.start(next);
    } catch (error) {
      await this.start(previous);
      throw error;
    }
  }

  async hasMultipleCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((device) => device.kind === 'videoinput').length > 1;
    } catch {
      return false;
    }
  }

  stop() {
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = null;
    this.#video.srcObject = null;
  }
}

function waitForFrames(video) {
  if (video.readyState >= 2 && video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      if (video.videoWidth === 0) return;
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new CameraError('no-frames'));
    }, FRAME_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', done);
      video.removeEventListener('resize', done);
    };
    video.addEventListener('loadeddata', done);
    video.addEventListener('resize', done);
  });
}
