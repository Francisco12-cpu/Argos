import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fromTransformers, supportsMaxMode } from '../src/vision/rfdetr-format.js';

describe('modo máximo (RF-DETR)', () => {
  it('converte a saída do Transformers.js para caixas x, y, w, h', () => {
    const out = fromTransformers([
      { label: 'cup', score: 0.9, box: { xmin: 0.1, ymin: 0.2, xmax: 0.4, ymax: 0.6 } },
      { label: 'person', score: 0.5, box: { xmin: -0.1, ymin: 0.5, xmax: 1.2, ymax: 1.1 } },
      { label: 'tv', score: 0.4, box: { xmin: 0.5, ymin: 0.5, xmax: 0.5, ymax: 0.7 } },
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0].label, 'cup');
    assert.ok(Math.abs(out[0].box.w - 0.3) < 1e-9 && Math.abs(out[0].box.h - 0.4) < 1e-9);
    assert.deepEqual(out[1].box, { x: 0, y: 0.5, w: 1, h: 0.5 });
  });

  it('só libera o modo com WebGPU e shader-f16', async () => {
    const gpu = (features) => ({ requestAdapter: async () => ({ features: new Set(features) }) });
    assert.equal(await supportsMaxMode(undefined), false);
    assert.equal(await supportsMaxMode(gpu([])), false);
    assert.equal(await supportsMaxMode(gpu(['shader-f16'])), true);
    assert.equal(await supportsMaxMode({ requestAdapter: async () => null }), false);
  });
});
