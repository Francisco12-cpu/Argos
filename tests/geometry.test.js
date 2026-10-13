import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coverTransform, createScreenMapper, iou, suppressCrossClass } from '../src/vision/geometry.js';

const box = (x, y, w, h) => ({ x, y, w, h });

describe('iou', () => {
  it('vale 1 para caixas idênticas', () => {
    assert.ok(Math.abs(iou(box(0.1, 0.1, 0.2, 0.2), box(0.1, 0.1, 0.2, 0.2)) - 1) < 1e-9);
  });

  it('vale 0 para caixas que não se tocam', () => {
    assert.equal(iou(box(0, 0, 0.1, 0.1), box(0.5, 0.5, 0.1, 0.1)), 0);
  });

  it('calcula a sobreposição parcial', () => {
    // Interseção 0,5 × 1 = 0,5; união 1 + 1 − 0,5 = 1,5.
    assert.ok(Math.abs(iou(box(0, 0, 1, 1), box(0.5, 0, 1, 1)) - 1 / 3) < 1e-9);
  });
});

describe('coverTransform', () => {
  it('preenche a tela de um celular em pé cortando as laterais do vídeo deitado', () => {
    const t = coverTransform(1280, 720, 390, 844);
    assert.ok(Math.abs(t.scale - 844 / 720) < 1e-9);
    assert.equal(t.offsetY, 0);
    assert.ok(t.offsetX < 0, 'as laterais ficam fora da tela');
    assert.ok(Math.abs(t.offsetX - (390 - 1280 * (844 / 720)) / 2) < 1e-9);
  });

  it('não corta nada quando as proporções são iguais', () => {
    assert.deepEqual(coverTransform(1280, 720, 640, 360), { scale: 0.5, offsetX: 0, offsetY: 0 });
  });
});

describe('createScreenMapper', () => {
  const frame = { w: 1280, h: 720 };
  const view = { w: 640, h: 360 };

  it('converte caixa normalizada para pixels da tela', () => {
    const map = createScreenMapper(frame, view, false);
    assert.deepEqual(map(box(0.25, 0.5, 0.5, 0.25)), { x: 160, y: 180, w: 320, h: 90 });
  });

  it('espelha horizontalmente na câmera frontal', () => {
    const map = createScreenMapper(frame, view, true);
    assert.deepEqual(map(box(0, 0, 0.25, 0.5)), { x: 480, y: 0, w: 160, h: 180 });
  });
});

describe('suppressCrossClass', () => {
  it('mantém só a detecção mais confiante quando dois tipos ocupam o mesmo lugar', () => {
    const result = suppressCrossClass(
      [
        { label: 'bowl', score: 0.5, box: box(0.1, 0.1, 0.3, 0.3) },
        { label: 'cup', score: 0.8, box: box(0.11, 0.1, 0.3, 0.3) },
      ],
      0.7,
    );
    assert.deepEqual(result.map((d) => d.label), ['cup']);
  });

  it('não mexe em objetos do mesmo tipo, nem em objetos separados', () => {
    const result = suppressCrossClass(
      [
        { label: 'person', score: 0.9, box: box(0.1, 0.1, 0.3, 0.6) },
        { label: 'person', score: 0.7, box: box(0.12, 0.1, 0.3, 0.6) },
        { label: 'chair', score: 0.6, box: box(0.6, 0.5, 0.2, 0.3) },
      ],
      0.7,
    );
    assert.equal(result.length, 3);
  });
});
