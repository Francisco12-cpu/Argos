import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatCode, isCovered, predictBox, Tracker, TrackStatus } from '../src/vision/tracker.js';

const STEP_MS = 100; // 10 análises por segundo

const det = (label, score, x, y, w = 0.2, h = 0.3) => ({ label, score, box: { x, y, w, h } });

/** Roda uma sequência de análises e devolve os eventos de cada uma. */
function run(tracker, frames, startMs = 0) {
  return frames.map((detections, index) => tracker.update(detections, startMs + index * STEP_MS));
}

const confirmed = (tracker) => tracker.tracks.filter((t) => t.status === TrackStatus.CONFIRMED);

describe('Tracker: ciclo de vida', () => {
  it('só mostra o objeto depois de 3 análises seguidas', () => {
    const tracker = new Tracker();
    const chair = det('chair', 0.8, 0.4, 0.4);
    const events = run(tracker, [[chair], [chair], [chair]]);

    assert.equal(events[0].confirmed.length, 0);
    assert.equal(events[1].confirmed.length, 0);
    assert.equal(events[2].confirmed.length, 1);
    assert.equal(confirmed(tracker)[0].code, 'OBJ-0001');
  });

  it('descarta um falso positivo que aparece uma vez só, sem gastar código', () => {
    const tracker = new Tracker();
    run(tracker, [[det('dog', 0.6, 0.1, 0.1)], []]);
    assert.equal(tracker.tracks.length, 0);

    const cup = det('cup', 0.9, 0.5, 0.5, 0.1, 0.1);
    run(tracker, [[cup], [cup], [cup]], 1000);
    assert.equal(confirmed(tracker)[0].code, 'OBJ-0001');
  });

  it('começa a sumir depois de 10 análises sem ver o objeto e é removido após o fade', () => {
    const tracker = new Tracker({ maxMisses: 10, fadeMs: 400 });
    const bottle = det('bottle', 0.85, 0.3, 0.3, 0.1, 0.25);
    run(tracker, [[bottle], [bottle], [bottle]]);

    const misses = run(tracker, Array.from({ length: 9 }, () => []), 300);
    assert.ok(misses.every((e) => e.lost.length === 0));
    assert.equal(tracker.tracks[0].status, TrackStatus.CONFIRMED);

    const tenth = tracker.update([], 1200);
    assert.equal(tenth.lost.length, 1);
    assert.equal(tracker.tracks[0].status, TrackStatus.LOST);

    tracker.update([], 1500);
    assert.equal(tracker.tracks.length, 1, 'ainda está no fade');
    const gone = tracker.update([], 1600);
    assert.equal(gone.removed.length, 1);
    assert.equal(tracker.tracks.length, 0);
  });

  it('se o objeto reaparece durante o fade, volta com o mesmo código', () => {
    const tracker = new Tracker({ maxMisses: 10, fadeMs: 400 });
    const laptop = det('laptop', 0.9, 0.2, 0.5, 0.3, 0.2);
    run(tracker, [[laptop], [laptop], [laptop]]);
    run(tracker, Array.from({ length: 10 }, () => []), 300);
    assert.equal(tracker.tracks[0].status, TrackStatus.LOST);

    const events = tracker.update([laptop], 1400);
    assert.equal(events.revived.length, 1);
    assert.equal(tracker.tracks.length, 1);
    assert.equal(tracker.tracks[0].status, TrackStatus.CONFIRMED);
    assert.equal(tracker.tracks[0].code, 'OBJ-0001');
  });

  it('numera os objetos na ordem em que aparecem, mesmo depois de reset()', () => {
    const tracker = new Tracker();
    const a = det('person', 0.9, 0.05, 0.1);
    const b = det('chair', 0.9, 0.6, 0.5);
    run(tracker, [[a, b], [a, b], [a, b]]);
    assert.deepEqual(confirmed(tracker).map((t) => t.code).sort(), ['OBJ-0001', 'OBJ-0002']);

    tracker.reset();
    run(tracker, [[a], [a], [a]], 1000);
    assert.equal(confirmed(tracker)[0].code, 'OBJ-0003');
  });
});

describe('Tracker: estabilidade', () => {
  it('mantém o mesmo código para um objeto em movimento', () => {
    const tracker = new Tracker();
    const frames = Array.from({ length: 25 }, (_, i) => [det('car', 0.8, 0.1 + i * 0.02, 0.4)]);
    run(tracker, frames);

    assert.equal(tracker.tracks.length, 1);
    const [car] = tracker.tracks;
    assert.equal(car.code, 'OBJ-0001');
    const lastX = 0.1 + 24 * 0.02;
    assert.ok(Math.abs(car.box.x - lastX) < 0.03, `ficou para trás: ${car.box.x} vs ${lastX}`);
    assert.ok(car.velocity.cx > 0.15 && car.velocity.cx < 0.25, `velocidade ${car.velocity.cx}`);
  });

  it('dois objetos que se cruzam devagar não trocam de código', () => {
    const tracker = new Tracker();
    const frames = Array.from({ length: 40 }, (_, i) => [
      det('person', 0.85, 0.15 + i * 0.012, 0.3, 0.15, 0.4),
      det('person', 0.85, 0.7 - i * 0.012, 0.33, 0.15, 0.4),
    ]);
    run(tracker, frames.slice(0, 3));
    const first = confirmed(tracker);
    const goingRight = first.find((t) => t.cx < 0.5).code;
    const goingLeft = first.find((t) => t.cx > 0.5).code;

    run(tracker, frames.slice(3), 300);
    const final = confirmed(tracker);
    assert.equal(final.length, 2);
    assert.equal(final.find((t) => t.velocity.cx > 0).code, goingRight);
    assert.equal(final.find((t) => t.velocity.cx < 0).code, goingLeft);
  });

  it('se o modelo alterna "copo" e "tigela", continua um objeto só, com o nome mais votado', () => {
    const tracker = new Tracker();
    const frames = Array.from({ length: 12 }, (_, i) =>
      i % 2 === 0 ? [det('cup', 0.62, 0.4, 0.4, 0.12, 0.15)] : [det('bowl', 0.5, 0.405, 0.4, 0.12, 0.15)],
    );
    run(tracker, frames);
    assert.equal(tracker.tracks.length, 1);
    assert.equal(tracker.tracks[0].label, 'cup');
  });

  it('um objeto de outro tipo no mesmo lugar ganha código novo', () => {
    const tracker = new Tracker();
    const person = det('person', 0.8, 0.3, 0.2, 0.3, 0.6);
    run(tracker, [[person], [person], [person]]);

    const bike = det('bicycle', 0.8, 0.31, 0.21, 0.3, 0.6);
    run(tracker, [[bike], [bike], [bike]], 300);

    const shown = confirmed(tracker);
    assert.deepEqual(
      shown.map((t) => `${t.code}:${t.label}`).sort(),
      ['OBJ-0001:person', 'OBJ-0002:bicycle'],
    );
    assert.equal(shown.find((t) => t.label === 'person').misses, 3, 'a pessoa só está sem ser vista');
  });

  it('confiança baixa mantém um objeto existente, mas não cria um novo', () => {
    const tracker = new Tracker({ minScoreNew: 0.45, minScoreKeep: 0.3 });
    const book = det('book', 0.8, 0.2, 0.2, 0.1, 0.12);
    run(tracker, [[book], [book], [book]]);

    const weak = det('book', 0.35, 0.2, 0.2, 0.1, 0.12);
    const stranger = det('clock', 0.35, 0.7, 0.1, 0.08, 0.08);
    tracker.update([weak, stranger], 300);

    assert.equal(tracker.tracks.length, 1);
    assert.equal(tracker.tracks[0].misses, 0);
  });

  it('suaviza a confiança exibida', () => {
    const tracker = new Tracker({ scoreSmoothing: 0.35 });
    run(tracker, [[det('tv', 0.9, 0.3, 0.3)], [det('tv', 0.5, 0.3, 0.3)]]);
    const { score } = tracker.tracks[0];
    assert.ok(score < 0.9 && score > 0.7, `confiança ${score}`);
  });
});

describe('predictBox', () => {
  const track = {
    cx: 0.5,
    cy: 0.5,
    w: 0.2,
    h: 0.2,
    updatedAt: 1000,
    velocity: { cx: 0.4, cy: 0, w: 0, h: 0 },
  };

  it('avança a caixa pela velocidade', () => {
    const box = predictBox(track, 1100, 250);
    assert.ok(Math.abs(box.x + box.w / 2 - 0.54) < 1e-9);
  });

  it('não prevê além do limite', () => {
    const box = predictBox(track, 5000, 250);
    assert.ok(Math.abs(box.x + box.w / 2 - 0.6) < 1e-9);
  });
});

describe('formatCode', () => {
  it('usa quatro dígitos', () => {
    assert.equal(formatCode(7), 'OBJ-0007');
    assert.equal(formatCode(1234), 'OBJ-1234');
  });
});

describe('Tracker: análises parciais (zoom no centro)', () => {
  const center = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };

  it('objeto fora do recorte não conta como "não visto"', () => {
    const tracker = new Tracker();
    const chair = det('chair', 0.8, 0.02, 0.02, 0.15, 0.2);
    run(tracker, [[chair], [chair], [chair]]);
    for (let i = 0; i < 12; i += 1) tracker.update([], 300 + i * 100, center);
    assert.equal(tracker.tracks[0].status, TrackStatus.CONFIRMED);
    assert.equal(tracker.tracks[0].misses, 0);
  });

  it('objeto dentro do recorte e ausente conta como "não visto"', () => {
    const tracker = new Tracker();
    const cup = det('cup', 0.8, 0.45, 0.45, 0.08, 0.08);
    run(tracker, [[cup], [cup], [cup]]);
    tracker.update([], 300, center);
    assert.equal(tracker.tracks[0].misses, 1);
  });

  it('alternando imagem inteira e centro, objetos fora do centro ainda são confirmados', () => {
    const tracker = new Tracker();
    const bike = det('bicycle', 0.8, 0.02, 0.6, 0.2, 0.3);
    for (let i = 0; i < 6; i += 1) {
      const region = i % 2 ? center : undefined;
      tracker.update(i % 2 ? [] : [bike], i * 100, region);
    }
    assert.equal(tracker.tracks[0].status, TrackStatus.CONFIRMED);
  });

  it('isCovered recusa objetos maiores que o recorte', () => {
    assert.equal(isCovered({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, center), false);
    assert.equal(isCovered({ x: 0.4, y: 0.4, w: 0.1, h: 0.1 }, center), true);
  });
});

describe('Tracker: dúvidas', () => {
  it('guarda detecções fracas por um instante, sem criar objetos', () => {
    const tracker = new Tracker({ minScoreNew: 0.45, minScoreKeep: 0.3, weakMs: 700 });
    tracker.update([det('book', 0.38, 0.6, 0.6, 0.1, 0.1)], 0);
    assert.equal(tracker.tracks.length, 0);
    assert.equal(tracker.weak.length, 1);
    tracker.update([], 800);
    assert.equal(tracker.weak.length, 0);
  });
});
