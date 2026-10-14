/**
 * Página de teste de acertos.
 *
 * A pessoa escolhe fotos e escreve o que há em cada uma; o ARGOS analisa
 * cada foto de três jeitos (e do quarto, se o modo preciso for incluído):
 *   1. imagem inteira (como na v0.2);
 *   2. imagem inteira + zoom no centro (como no visor agora);
 *   3. palpite do classificador de 1.000 categorias, no centro;
 *   4. modo preciso (EfficientDet-Lite2) + zoom no centro.
 */
import { CONFIG } from '../core/config.js';
import { bestGuess } from '../data/imagenet-pt.js';
import { labelPt } from '../data/labels-pt.js';
import { download, downloadAll } from '../vision/assets.js';
import { iou } from '../vision/geometry.js';
import { createEngine } from '../vision/mediapipe-engine.js';
import { centerCrop, cropToFrame } from '../vision/views.js';
import { isMatch, normalizeName } from './matching.js';

const $ = (selector) => document.querySelector(selector);
const ui = {
  files: $('[data-files]'),
  precise: $('[data-precise]'),
  run: $('[data-run]'),
  status: $('[data-status]'),
  photos: $('[data-photos]'),
  summary: $('[data-summary]'),
  summaryBody: $('[data-summary-body]'),
};

const MIN_SCORE = CONFIG.tracker.minScoreNew;
const absolute = (path) => new URL(path, document.baseURI).href;

let wasmUrl = null;
let classifierBytes = null;
const detectorBytes = new Map();
const engines = new Map();
let photos = [];

async function boot() {
  const { wasm } = CONFIG.engine;
  const [wasmBytes, fastBytes, classBytes] = await downloadAll(
    [
      { url: wasm.url, bytes: wasm.bytes },
      { url: CONFIG.models.fast.url, bytes: CONFIG.models.fast.bytes },
      { url: CONFIG.classifier.url, bytes: CONFIG.classifier.bytes },
    ],
    (fraction) => (ui.status.textContent = `Carregando a IA ${Math.round(fraction * 100)}%`),
  );
  wasmUrl = URL.createObjectURL(new Blob([wasmBytes], { type: 'application/wasm' }));
  detectorBytes.set('fast', fastBytes);
  classifierBytes = classBytes;
  await engineFor('fast');
  ui.status.textContent = 'Pronto. Escolha as fotos.';
  updateRunButton();
}

async function engineFor(key) {
  if (engines.has(key)) return engines.get(key);
  if (!detectorBytes.has(key)) {
    ui.status.textContent = 'Baixando o modo preciso…';
    detectorBytes.set(key, await download(CONFIG.models[key].url));
  }
  const engine = await createEngine({
    loaderUrl: absolute(CONFIG.engine.loader),
    wasmUrl,
    detector: {
      modelBytes: detectorBytes.get(key),
      delegate: CONFIG.models[key].delegate,
      scoreThreshold: CONFIG.detector.scoreThreshold,
      maxResults: CONFIG.detector.maxResults,
    },
    classifier: key === 'fast' ? { modelBytes: classifierBytes } : null,
  });
  engines.set(key, engine);
  return engine;
}

// ── Fotos ───────────────────────────────────────────────────────────

ui.files.addEventListener('change', async () => {
  photos = [];
  ui.photos.replaceChildren();
  ui.summary.hidden = true;
  for (const file of ui.files.files) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const photo = { file, bitmap, expected: '', results: {} };
    photos.push(photo);
    ui.photos.append(photoRow(photo));
  }
  ui.status.textContent = `${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'}. Escreva o que tem em cada uma e toque em Analisar.`;
  updateRunButton();
});

function photoRow(photo) {
  const item = document.createElement('li');
  item.className = 'photo';
  const url = URL.createObjectURL(photo.file);
  item.innerHTML = `
    <img alt="" src="${url}">
    <label><span>O que tem na foto</span><input type="text" placeholder="ex.: caneca" autocomplete="off"></label>
    <dl class="results"></dl>`;
  item.querySelector('input').addEventListener('input', (event) => {
    photo.expected = event.target.value;
  });
  photo.element = item;
  return item;
}

function updateRunButton() {
  ui.run.disabled = !wasmUrl || photos.length === 0;
}

// ── Análise ─────────────────────────────────────────────────────────

const MODES = [
  { id: 'full', name: 'Imagem inteira (v0.2)', model: 'fast', zoom: false },
  { id: 'zoom', name: 'Com zoom no centro', model: 'fast', zoom: true },
  { id: 'guess', name: 'Palpite do classificador', model: 'fast', guess: true },
  { id: 'precise', name: 'Modo preciso + zoom', model: 'precise', zoom: true, optional: true },
];

ui.run.addEventListener('click', async () => {
  ui.run.disabled = true;
  const modes = MODES.filter((mode) => !mode.optional || ui.precise.checked);
  try {
    for (const mode of modes) await engineFor(mode.model);
  } catch (error) {
    console.warn(error);
    ui.status.textContent = 'O modo preciso não baixou. Seguindo sem ele.';
    modes.splice(modes.findIndex((m) => m.id === 'precise'), 1);
  }

  let timestamp = 0;
  for (const [index, photo] of photos.entries()) {
    ui.status.textContent = `Analisando a foto ${index + 1} de ${photos.length}…`;
    for (const mode of modes) {
      const engine = engines.get(mode.model);
      const started = performance.now();
      photo.results[mode.id] = mode.guess
        ? await guessPhoto(engine, photo.bitmap)
        : await detectPhoto(engine, photo.bitmap, mode.zoom, (timestamp += 1000));
      photo.results[mode.id].ms = performance.now() - started;
    }
    renderResults(photo, modes);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  renderSummary(modes);
  ui.status.textContent = 'Pronto.';
  ui.run.disabled = false;
});

async function detectPhoto(engine, bitmap, zoom, timestamp) {
  const frame = { w: bitmap.width, h: bitmap.height };
  const full = engine.detect(bitmap, frame.w, frame.h, timestamp).detections;
  let found = full.filter((d) => d.score >= MIN_SCORE);
  if (zoom) {
    const crop = centerCrop(frame, CONFIG.views.cropFraction);
    const piece = await createImageBitmap(bitmap, crop.x, crop.y, crop.w, crop.h);
    const zoomed = cropToFrame(engine.detect(piece, crop.w, crop.h, timestamp + 1).detections, crop, frame);
    piece.close();
    for (const d of zoomed) {
      if (d.score < MIN_SCORE) continue;
      const dup = found.find((f) => f.label === d.label && iou(f.box, d.box) > 0.3);
      if (!dup) found.push(d);
    }
  }
  return { names: found.map((d) => `${labelPt(d.label)} ${Math.round(d.score * 100)}%`), plain: found.map((d) => labelPt(d.label)) };
}

async function guessPhoto(engine, bitmap) {
  const crop = centerCrop({ w: bitmap.width, h: bitmap.height }, CONFIG.classifier.cropFraction);
  const piece = await createImageBitmap(bitmap, crop.x, crop.y, crop.w, crop.h);
  const best = bestGuess(engine.classify(piece).top);
  piece.close();
  if (!best || best.score < CONFIG.classifier.minScore) return { names: [], plain: [] };
  return { names: [`${best.name} ${Math.round(best.score * 100)}%`], plain: [best.name] };
}

function renderResults(photo, modes) {
  const list = photo.element.querySelector('.results');
  list.replaceChildren();
  for (const mode of modes) {
    const result = photo.results[mode.id];
    const hit = photo.expected && isMatch(photo.expected, result.plain);
    const dt = document.createElement('dt');
    dt.textContent = mode.name;
    const dd = document.createElement('dd');
    dd.className = photo.expected ? (hit ? 'hit' : 'miss') : '';
    dd.textContent = result.names.length ? result.names.join(', ') : 'nada';
    list.append(dt, dd);
  }
}

function renderSummary(modes) {
  const rated = photos.filter((photo) => normalizeName(photo.expected));
  ui.summaryBody.replaceChildren();
  for (const mode of modes) {
    const hits = rated.filter((photo) => isMatch(photo.expected, photo.results[mode.id].plain)).length;
    const avg = photos.reduce((sum, photo) => sum + photo.results[mode.id].ms, 0) / photos.length;
    const row = document.createElement('tr');
    row.innerHTML = `<td></td><td>${rated.length ? `${hits} de ${rated.length}` : '—'}</td><td>${Math.round(avg)} ms</td>`;
    row.firstElementChild.textContent = mode.name;
    ui.summaryBody.append(row);
  }
  ui.summary.hidden = false;
}

boot().catch((error) => {
  console.error(error);
  ui.status.textContent = 'A IA não carregou. Recarregue a página.';
});
