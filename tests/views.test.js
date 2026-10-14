import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { centerCrop, cropRegion, cropToFrame, ViewScheduler } from '../src/vision/views.js';

const frame = { w: 1080, h: 1920 };

describe('centerCrop', () => {
  it('faz um quadrado no centro, com lado em fração do menor lado', () => {
    assert.deepEqual(centerCrop(frame, 0.5), { x: 270, y: 690, w: 540, h: 540 });
  });
});

describe('cropToFrame', () => {
  const crop = centerCrop(frame, 0.5);

  it('leva a caixa do recorte para o quadro inteiro', () => {
    const [d] = cropToFrame([{ label: 'cup', score: 0.8, box: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }], crop, frame);
    assert.ok(Math.abs(d.box.x - (270 + 135) / 1080) < 1e-9);
    assert.ok(Math.abs(d.box.y - (690 + 135) / 1920) < 1e-9);
    assert.ok(Math.abs(d.box.w - 270 / 1080) < 1e-9);
    assert.ok(Math.abs(d.box.h - 270 / 1920) < 1e-9);
  });

  it('descarta objetos cortados pela borda do recorte', () => {
    const out = cropToFrame([{ label: 'person', score: 0.9, box: { x: 0, y: 0.2, w: 0.4, h: 0.5 } }], crop, frame);
    assert.equal(out.length, 0);
  });

  it('na imagem inteira, mantém objetos na borda', () => {
    const full = { x: 0, y: 0, w: frame.w, h: frame.h };
    const out = cropToFrame([{ label: 'person', score: 0.9, box: { x: 0, y: 0.2, w: 0.4, h: 0.5 } }], full, frame);
    assert.equal(out.length, 1);
  });
});

describe('ViewScheduler', () => {
  it('alterna imagem inteira e centro', () => {
    const views = new ViewScheduler({ enabled: true, cropFraction: 0.5, minFrameSide: 480 });
    const kinds = [1, 2, 3, 4].map(() => views.next(frame).kind);
    assert.deepEqual(kinds, ['full', 'center', 'full', 'center']);
  });

  it('não usa o recorte em câmeras de baixa resolução', () => {
    const views = new ViewScheduler({ enabled: true, cropFraction: 0.5, minFrameSide: 480 });
    const kinds = [1, 2].map(() => views.next({ w: 640, h: 360 }).kind);
    assert.deepEqual(kinds, ['full', 'full']);
  });

  it('informa a região olhada em fração do quadro', () => {
    const views = new ViewScheduler({ enabled: true, cropFraction: 0.5, minFrameSide: 480 });
    views.next(frame);
    const { region } = views.next(frame);
    assert.deepEqual(region, cropRegion(centerCrop(frame, 0.5), frame));
  });
});
