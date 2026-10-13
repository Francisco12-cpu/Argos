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
import { downloadAll, formatMegabytes } from './vision/assets.js';
import { Camera, CameraError } from './vision/camera.js';
import { createDetector } from './vision/detector.js';
import { Tracker, TrackStatus } from './vision/tracker.js';
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

let theme = applyTheme(savedThemeId(CONFIG.ui.defaultTheme));
let detector = null;
let wasmUrl = null;
let aiGeneration = 0;
let status = 'Calibrando';
let engine = { short: '--', title: '' };

const renderer = new HudRenderer(ui.canvas, {
  source: {
    frame: () => camera.frame,
    mirrored: () => camera.mirrored,
    tracks: () => tracker.tracks,
  },
  palette: theme,
  fadeMs: CONFIG.tracker.fadeMs,
  maxPredictMs: CONFIG.tracker.maxPredictMs,
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
  status,
}));

bus.on('state', ({ to }) => {
  document.body.dataset.state = to;
});

// ── Boot ─────────────────────────────────────────────────────────────

async function bootSequence() {
  boot.reset();
  if (inAppBrowser) boot.showInAppWarning(inAppBrowser, () => copyPageLink());

  const model = CONFIG.models[0];
  const { wasm } = CONFIG.engine;
  boot.log(`Baixando a IA: modelo ${formatMegabytes(model.bytes)}, motor ${formatMegabytes(wasm.bytes)}`);

  const downloadStarted = performance.now();
  const [wasmBytes, modelBytes] = await downloadAll(
    [
      { url: wasm.url, bytes: wasm.bytes },
      { url: model.url, bytes: model.bytes },
    ],
    (fraction) => boot.setProgress(fraction * 0.9),
  );
  boot.log(`Download concluído em ${seconds(performance.now() - downloadStarted)}`);

  if (wasmUrl) URL.revokeObjectURL(wasmUrl);
  wasmUrl = URL.createObjectURL(new Blob([wasmBytes], { type: 'application/wasm' }));

  const initStarted = performance.now();
  detector?.dispose();
  detector = await createDetector({
    loaderUrl: absolute(CONFIG.engine.loader),
    wasmUrl,
    modelBytes,
    delegate: model.delegate,
    scoreThreshold: CONFIG.detector.scoreThreshold,
    maxResults: CONFIG.detector.maxResults,
    initTimeoutMs: CONFIG.detector.initTimeoutMs,
  });
  const where = detector.backend === 'worker' ? 'Web Worker' : 'thread principal';
  engine = { short: model.delegate, title: `${model.label} em ${model.delegate}, ${where}` };
  boot.log(`IA pronta em ${seconds(performance.now() - initStarted)} (${model.delegate}, ${where})`);

  await fontsReady();
  boot.setProgress(1);
  machine.go(State.PERMISSION);
  boot.ready();
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
  let failures = 0;

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

    try {
      const result = await detector.detect(ui.video, capturedAt);
      if (generation !== aiGeneration) break;
      failures = 0;
      // O carimbo é o da captura: o HUD prevê a posição até "agora" e
      // assim compensa o tempo que a IA levou para responder.
      const events = tracker.update(result.detections, capturedAt);
      stats.record(result.inferMs, performance.now());
      for (const track of events.confirmed) bus.emit('object:found', track);
      for (const track of events.lost) bus.emit('object:lost', track);
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
updateThemeButton();

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
  window.ARGOS = { machine, tracker, camera, stats, renderer, bus, get detector() { return detector; } };
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
