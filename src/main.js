/**
 * ARGOS: ponto de entrada.
 *
 * Liga os módulos e conduz a máquina de estados:
 *   BOOT (baixa e inicia a IA) → PERMISSION (botão "Ativar visor")
 *   → CALIBRATION (câmera liga, visor acende) → SCANNING (IA + HUD)
 *
 * Dois laços independentes:
 *   - IA: analisa a câmera de 10 a 15 vezes por segundo, no Web Worker;
 *   - desenho: 60 quadros por segundo, sempre lendo o último estado.
 */
import { CONFIG } from './core/config.js';
import { EventBus } from './core/events.js';
import { State, StateMachine } from './core/state.js';
import { labelPt } from './data/labels-pt.js';
import { download, downloadAll, formatMegabytes } from './vision/assets.js';
import { Camera, CameraError } from './vision/camera.js';
import { createDetector } from './vision/detector.js';
import { predictBox, Tracker, TrackStatus } from './vision/tracker.js';
import { centerCrop, ViewScheduler } from './vision/views.js';
import { bestGuess } from './data/imagenet-pt.js';
import { resetTextMetrics } from './hud/brackets.js';
import { glitch, installNoise, powerOn } from './hud/effects.js';
import { HudRenderer } from './hud/renderer.js';
import { applyTheme, nextThemeId, savedThemeId } from './hud/themes.js';
import { BootScreen } from './ui/boot.js';
import { copyPageLink, detectInAppBrowser } from './ui/environment.js';
import { ErrorScreen } from './ui/error-screen.js';
import { Telemetry } from './ui/telemetry.js';

const $ = (selector) => document.querySelector(selector);
const absolute = (path) => new URL(path, document.baseURI).href;
const seconds = (ms) => `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`;

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const inAppBrowser = detectInAppBrowser(navigator.userAgent);

const ui = {
  stage: $('#stage'),
  video: $('#camera'),
  canvas: $('#hud'),
  top: $('[data-hud-top]'),
  bottom: $('[data-hud-bottom]'),
  switchCamera: $('[data-action="switch-camera"]'),
  torch: $('[data-action="torch"]'),
  mode: $('[data-action="mode"]'),
  modeName: $('[data-mode-name]'),
  theme: $('[data-action="theme"]'),
  themeName: $('[data-theme-name]'),
};

const bus = new EventBus();
const machine = new StateMachine(bus);
const camera = new Camera(ui.video);
const tracker = new Tracker(CONFIG.tracker);
const boot = new BootScreen($('#boot'));
const errorScreen = new ErrorScreen($('#error'));
const stats = createStats();
const views = new ViewScheduler(CONFIG.views);
const MODE_KEY = 'argos.mode';

let theme = applyTheme(savedThemeId(CONFIG.ui.defaultTheme));
let detector = null;
let wasmUrl = null;
let modeKey = savedMode();
const modelBytes = new Map();
let classifierBytes = null;
/** Palpite do classificador para o que está na mira. */
let guess = null;
let lastObjectAt = performance.now();
let aiGeneration = 0;
let status = 'Calibrando';
let statusOverride = null;
let engine = { short: '--', title: '' };

const renderer = new HudRenderer(ui.canvas, {
  source: {
    frame: () => camera.frame,
    mirrored: () => camera.mirrored,
    tracks: () => tracker.tracks,
    weak: () => tracker.weak,
    guess: () => guess,
    hint: hintActive,
  },
  palette: theme,
  fadeMs: CONFIG.tracker.fadeMs,
  maxPredictMs: CONFIG.tracker.maxPredictMs,
  weakMs: CONFIG.tracker.weakMs,
  reducedMotion,
});

const telemetry = new Telemetry(document, () => ({
  fps: renderer.fps,
  inferMs: stats.inferMs,
  rate: stats.rate(performance.now()),
  engine: engine.short,
  engineTitle: engine.title,
  labels: tracker.tracks
    .filter((track) => track.status === TrackStatus.CONFIRMED)
    .map((track) => labelPt(track.label)),
  status: currentStatus(),
}));

/** Muito tempo sem objetos e sem palpite: a mira sugere aproximar. */
function hintActive() {
  return machine.is(State.SCANNING) && !guess && performance.now() - lastObjectAt > CONFIG.ui.hintAfterMs;
}

function currentStatus() {
  if (statusOverride) return statusOverride;
  if (hintActive()) return 'Nada à vista: aproxime';
  return status;
}

bus.on('state', ({ to }) => {
  document.body.dataset.state = to;
});

// ── Boot ─────────────────────────────────────────────────────────────

async function bootSequence() {
  boot.reset();
  if (inAppBrowser) boot.showInAppWarning(inAppBrowser, () => copyPageLink());

  const { wasm } = CONFIG.engine;
  const fast = CONFIG.models.fast;
  const { classifier } = CONFIG;
  boot.log(`Baixando a IA: detector ${formatMegabytes(fast.bytes)}, classificador ${formatMegabytes(classifier.bytes)}, motor ${formatMegabytes(wasm.bytes)}`);

  const downloadStarted = performance.now();
  const [wasmBytes, fastBytes, classBytes] = await downloadAll(
    [
      { url: wasm.url, bytes: wasm.bytes },
      { url: fast.url, bytes: fast.bytes },
      { url: classifier.url, bytes: classifier.bytes },
    ],
    (fraction) => boot.setProgress(fraction * 0.9),
  );
  modelBytes.set('fast', fastBytes);
  classifierBytes = classBytes;
  boot.log(`Download concluído em ${seconds(performance.now() - downloadStarted)}`);

  if (wasmUrl) URL.revokeObjectURL(wasmUrl);
  wasmUrl = URL.createObjectURL(new Blob([wasmBytes], { type: 'application/wasm' }));

  if (modeKey === 'precise') {
    try {
      boot.log('Baixando o modelo preciso (EfficientDet-Lite2)');
      modelBytes.set('precise', await download(CONFIG.models.precise.url));
    } catch (error) {
      console.warn('[ARGOS] Modo preciso indisponível', error);
      boot.log('Modo preciso indisponível agora; usando o rápido');
      setMode('fast');
    }
  }

  const initStarted = performance.now();
  await buildDetector(modeKey);
  const where = detector.backend === 'worker' ? 'Web Worker' : 'thread principal';
  boot.log(`IA pronta em ${seconds(performance.now() - initStarted)} (${CONFIG.models[modeKey].label}, ${where})`);

  await fontsReady();
  boot.setProgress(1);
  machine.go(State.PERMISSION);
  boot.ready();
}

/** Cria (ou recria) o detector com o modelo do modo escolhido. */
async function buildDetector(key) {
  const model = CONFIG.models[key];
  const next = await createDetector({
    loaderUrl: absolute(CONFIG.engine.loader),
    wasmUrl,
    detector: {
      modelBytes: modelBytes.get(key),
      delegate: model.delegate,
      scoreThreshold: CONFIG.detector.scoreThreshold,
      maxResults: CONFIG.detector.maxResults,
    },
    classifier: classifierBytes ? { modelBytes: classifierBytes } : null,
    initTimeoutMs: CONFIG.detector.initTimeoutMs,
  });
  detector?.dispose();
  detector = next;
  const where = detector.backend === 'worker' ? 'Web Worker' : 'thread principal';
  engine = { short: model.label, title: `${model.label} em ${model.delegate}, ${where}` };
}

function savedMode() {
  try {
    return localStorage.getItem(MODE_KEY) === 'precise' ? 'precise' : 'fast';
  } catch {
    return 'fast';
  }
}

function setMode(key) {
  modeKey = key;
  try {
    localStorage.setItem(MODE_KEY, key);
  } catch {
    // Sem armazenamento, o modo só não fica salvo.
  }
  updateModeButton();
}

function fontsReady() {
  const fonts = ['700 12px Orbitron', '900 12px Orbitron', '11px "Share Tech Mono"'];
  const timeout = new Promise((resolve) => setTimeout(resolve, 1500));
  return Promise.race([Promise.all(fonts.map((font) => document.fonts.load(font))), timeout]).catch(() => {});
}

// ── Ativação e calibração ────────────────────────────────────────────

async function activate() {
  if (!machine.is(State.PERMISSION)) return;
  boot.busy('Abrindo a câmera');
  try {
    await camera.start();
  } catch (error) {
    boot.idle();
    failCamera(error);
    return;
  }
  enterCalibration();
}

function enterCalibration() {
  machine.go(State.CALIBRATION);
  tracker.reset();
  renderer.clear();
  renderer.resize();
  updateInsets();
  renderer.start();
  renderer.playIntro(CONFIG.ui.calibrationMs);
  if (!reducedMotion) powerOn(ui.stage, 700);
  status = 'Calibrando';
  telemetry.start(CONFIG.ui.telemetryHz);
  refreshSwitchButton();

  setTimeout(() => {
    if (!machine.is(State.CALIBRATION)) return;
    machine.go(State.SCANNING);
    status = 'Varredura ativa';
    startAi();
  }, CONFIG.ui.calibrationMs);
}

// ── Laço da IA ───────────────────────────────────────────────────────

function startAi() {
  stats.reset();
  guess = null;
  lastObjectAt = performance.now();
  runAi(++aiGeneration);
}

function stopAi() {
  aiGeneration += 1;
}

async function runAi(generation) {
  // Sem worker, cada análise trava a página enquanto roda: menos análises
  // por segundo e sempre um quadro de desenho entre uma e outra.
  const onMainThread = detector.backend === 'main';
  const minInterval = 1000 / (onMainThread ? CONFIG.loop.mainThreadAiHz : CONFIG.loop.maxAiHz);
  let lastSent = -Infinity;
  let lastGuessAt = -Infinity;
  let centerFreeSince = performance.now();
  let failures = 0;
  views.reset();

  while (generation === aiGeneration) {
    // Só espera um quadro novo se a última análise foi há pouco tempo;
    // depois de uma análise demorada, a câmera já tem imagem nova.
    const idle = document.hidden || !camera.active || ui.video.readyState < 2;
    if (idle || performance.now() - lastSent < minInterval) {
      await nextVideoFrame(ui.video);
      continue;
    }
    if (generation !== aiGeneration) break;

    const capturedAt = performance.now();
    lastSent = capturedAt;
    const frame = camera.frame;

    // A mira está sobre algum objeto conhecido?
    const centerTaken = tracker.tracks.some(
      (track) => track.status === TrackStatus.CONFIRMED && containsCenter(predictBox(track, capturedAt)),
    );
    if (centerTaken) {
      centerFreeSince = capturedAt;
      guess = null;
    }
    if (tracker.tracks.some((track) => track.status === TrackStatus.CONFIRMED)) lastObjectAt = capturedAt;
    if (guess && capturedAt - guess.at > CONFIG.classifier.showMs) guess = null;

    const wantsGuess =
      detector.hasClassifier &&
      !centerTaken &&
      capturedAt - centerFreeSince >= CONFIG.classifier.idleMs &&
      capturedAt - lastGuessAt >= CONFIG.classifier.intervalMs;

    try {
      if (wantsGuess) {
        // Palpite: o classificador de 1.000 categorias olha o centro da mira.
        lastGuessAt = capturedAt;
        const result = await detector.classify(ui.video, centerCrop(frame, CONFIG.classifier.cropFraction));
        if (generation !== aiGeneration) break;
        const best = bestGuess(result.top);
        if (best && best.score >= CONFIG.classifier.minScore) guess = { ...best, at: performance.now() };
      } else {
        // Alterna imagem inteira e zoom no centro (veja vision/views.js).
        const view = views.next(frame);
        const result = await detector.detect(ui.video, capturedAt, view.crop);
        if (generation !== aiGeneration) break;
        // O carimbo é o da captura: o HUD prevê a posição até "agora" e
        // assim compensa o tempo que a IA levou para responder.
        const events = tracker.update(result.detections, capturedAt, view.region);
        stats.record(result.inferMs, performance.now());
        for (const track of events.confirmed) bus.emit('object:found', track);
        for (const track of events.lost) bus.emit('object:lost', track);
      }
      failures = 0;
      if (onMainThread) await nextVideoFrame(ui.video);
    } catch (error) {
      failures += 1;
      console.error('[ARGOS] Falha numa análise', error);
      if (failures >= CONFIG.detector.maxConsecutiveFailures) {
        fail(
          {
            code: 'ERR_IA',
            title: 'A IA parou de responder',
            message: 'O modelo travou durante a análise. Recarregue a página para reiniciar o visor.',
          },
          { label: 'Recarregar', onClick: () => location.reload() },
        );
        return;
      }
    }
  }
}

/** O centro da imagem (onde fica a mira) cai dentro da caixa? */
function containsCenter(box) {
  return box.x <= 0.5 && box.x + box.w >= 0.5 && box.y <= 0.5 && box.y + box.h >= 0.5;
}

/** Espera o próximo quadro da câmera (ou desiste em 250 ms, com a aba escondida). */
function nextVideoFrame(video) {
  return new Promise((resolve) => {
    const useVideoFrames = typeof video.requestVideoFrameCallback === 'function';
    let handle = 0;
    const timer = setTimeout(() => {
      if (useVideoFrames) video.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
      resolve();
    }, 250);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    handle = useVideoFrames ? video.requestVideoFrameCallback(done) : requestAnimationFrame(done);
  });
}

function createStats() {
  const analyses = [];
  const prune = (now) => {
    while (analyses.length && now - analyses[0] > 1000) analyses.shift();
  };
  return {
    inferMs: 0,
    record(inferMs, now) {
      this.inferMs = this.inferMs ? this.inferMs * 0.8 + inferMs * 0.2 : inferMs;
      analyses.push(now);
      prune(now);
    },
    rate(now) {
      prune(now);
      return analyses.length;
    },
    reset() {
      analyses.length = 0;
      this.inferMs = 0;
    },
  };
}

// ── Controles ────────────────────────────────────────────────────────

async function refreshSwitchButton() {
  ui.switchCamera.hidden = !(await camera.hasMultipleCameras());
  refreshTorchButton();
}

function refreshTorchButton() {
  ui.torch.hidden = !camera.supportsTorch;
  ui.torch.setAttribute('aria-pressed', String(camera.torchOn));
}

async function toggleTorch() {
  try {
    await camera.setTorch(!camera.torchOn);
  } catch (error) {
    console.warn('[ARGOS] Não foi possível ligar a lanterna', error);
  }
  refreshTorchButton();
}

/** Alterna entre o modo rápido (Lite0) e o preciso (Lite2). */
async function toggleMode() {
  if (!machine.is(State.SCANNING) || ui.mode.disabled) return;
  const target = modeKey === 'fast' ? 'precise' : 'fast';
  ui.mode.disabled = true;
  stopAi();
  try {
    if (!modelBytes.has(target)) {
      const model = CONFIG.models[target];
      statusOverride = 'Baixando modo preciso';
      modelBytes.set(
        target,
        await download(model.url, {
          expectedBytes: model.bytes,
          onProgress: (received, total) => {
            statusOverride = total
              ? `Baixando modo preciso ${Math.round((received / total) * 100)}%`
              : `Baixando modo preciso ${formatMegabytes(received)}`;
          },
        }),
      );
    }
    statusOverride = 'Trocando o modelo';
    await buildDetector(target);
    setMode(target);
    tracker.reset();
    renderer.clear();
    statusOverride = null;
  } catch (error) {
    console.warn('[ARGOS] Não foi possível trocar de modo', error);
    statusOverride = 'Modo preciso indisponível agora';
    setTimeout(() => (statusOverride = null), 3_000);
  } finally {
    ui.mode.disabled = false;
  }
  startAi();
}

function updateModeButton() {
  const model = CONFIG.models[modeKey];
  ui.modeName.textContent = model.name;
  ui.mode.setAttribute('aria-label', `Modo ${model.name}. Trocar modo de detecção`);
}

async function switchCamera() {
  if (!machine.is(State.SCANNING)) return;
  ui.switchCamera.disabled = true;
  stopAi();
  try {
    await camera.switchFacing();
  } catch (error) {
    console.warn('[ARGOS] Não foi possível trocar de câmera', error);
  } finally {
    ui.switchCamera.disabled = false;
  }
  if (!camera.active) {
    failCamera(new CameraError('unknown'));
    return;
  }
  tracker.reset();
  renderer.clear();
  refreshTorchButton();
  if (!reducedMotion) glitch(ui.stage);
  startAi();
}

function cycleTheme() {
  theme = applyTheme(nextThemeId(theme.id));
  renderer.setPalette(theme);
  updateThemeButton();
  if (!reducedMotion) glitch(ui.stage, 160);
}

function updateThemeButton() {
  ui.themeName.textContent = theme.name;
  ui.theme.setAttribute('aria-label', `Tema ${theme.name}. Trocar tema`);
}

function updateInsets() {
  const view = renderer.view;
  renderer.setInsets({
    top: ui.top.offsetTop + ui.top.offsetHeight + 4,
    bottom: Math.max(0, view.h - ui.bottom.offsetTop) + 4,
  });
}

// ── Erros ────────────────────────────────────────────────────────────

const CAMERA_TITLES = {
  insecure: 'Conexão não segura',
  unsupported: 'Navegador sem câmera',
  denied: 'Câmera bloqueada',
  'not-found': 'Nenhuma câmera',
  'in-use': 'Câmera ocupada',
  'no-frames': 'Câmera sem imagem',
  ended: 'A câmera desligou',
  unknown: 'Câmera indisponível',
};

function failCamera(error) {
  const code = error instanceof CameraError ? error.code : 'unknown';
  const copyLink = {
    label: 'Copiar link',
    onClick: async (event) => {
      event.currentTarget.textContent = (await copyPageLink()) ? 'Link copiado' : 'Copie o endereço da página';
    },
  };

  if (inAppBrowser && (code === 'denied' || code === 'unsupported' || code === 'unknown')) {
    fail(
      {
        code: 'ERR_NAVEGADOR_INTERNO',
        title: 'Abra no navegador',
        message: `O navegador interno do ${inAppBrowser} não libera a câmera. Copie o link e abra no Chrome ou no Safari.`,
      },
      copyLink,
    );
    return;
  }

  const retry = { label: 'Tentar de novo', onClick: retryCamera };
  const cannotRetry = code === 'insecure' || code === 'unsupported';
  fail(
    {
      code: `ERR_CAMERA_${code.toUpperCase().replace('-', '_')}`,
      title: CAMERA_TITLES[code] ?? CAMERA_TITLES.unknown,
      message: error.message,
    },
    cannotRetry ? copyLink : retry,
  );
}

function fail(info, primary, secondary) {
  stopAi();
  telemetry.stop();
  renderer.stop();
  camera.stop();
  if (machine.can(State.ERROR)) machine.go(State.ERROR);
  errorScreen.show({ ...info, primary, secondary });
}

async function retryCamera() {
  machine.go(State.PERMISSION);
  await activate();
}

// ── Eventos da página ────────────────────────────────────────────────

boot.onActivate(activate);
ui.switchCamera.addEventListener('click', switchCamera);
ui.theme.addEventListener('click', cycleTheme);
ui.mode.addEventListener('click', toggleMode);
ui.torch.addEventListener('click', toggleTorch);
updateThemeButton();
updateModeButton();

camera.onEnded = () => {
  if (machine.is(State.SCANNING) || machine.is(State.CALIBRATION)) {
    failCamera(new CameraError('ended'));
  }
};

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = performance.now();
    return;
  }
  if (performance.now() - hiddenAt > CONFIG.loop.resetAfterHiddenMs) {
    tracker.reset();
    renderer.clear();
  }
  if (camera.active && ui.video.paused) ui.video.play().catch(() => {});
});

const onResize = () => {
  renderer.resize();
  updateInsets();
};
window.addEventListener('resize', onResize);
// Ao girar o aparelho, a imagem da câmera muda de formato: recomeça o rastreamento.
const onOrientation = () => {
  tracker.reset();
  renderer.clear();
  onResize();
};
if (screen.orientation?.addEventListener) screen.orientation.addEventListener('change', onOrientation);
else window.addEventListener('orientationchange', onOrientation);

window.addEventListener('pagehide', () => {
  stopAi();
  camera.stop();
});

document.fonts?.addEventListener?.('loadingdone', resetTextMetrics);

if (new URLSearchParams(location.search).has('debug')) {
  window.ARGOS = { machine, tracker, camera, stats, renderer, bus, get detector() { return detector; }, get guess() { return guess; }, set guess(value) { guess = value; }, get mode() { return modeKey; } };
}

installNoise();
document.body.dataset.state = machine.state;
bootSequence().catch((error) => {
  console.error('[ARGOS] Falha ao iniciar', error);
  fail(
    {
      code: 'ERR_BOOT',
      title: 'A IA não carregou',
      message: 'Não foi possível baixar ou iniciar a rede neural. Confira a conexão e tente de novo.',
    },
    {
      label: 'Tentar de novo',
      onClick: () => {
        machine.go(State.BOOT);
        bootSequence().catch(() => location.reload());
      },
    },
  );
});
