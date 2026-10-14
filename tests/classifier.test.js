import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { bestGuess, imagenetPt } from '../src/data/imagenet-pt.js';
import { softmaxTop } from '../src/vision/softmax.js';

const labels = readFileSync(new URL('../models/imagenet-labels.txt', import.meta.url), 'utf8').split('\n');

describe('softmaxTop', () => {
  it('transforma logits em probabilidades que somam 1', () => {
    const logits = [{ index: 1, score: 2 }, { index: 2, score: 1 }, { index: 3, score: 0 }];
    const all = softmaxTop(logits, 3);
    assert.deepEqual(all.map((c) => c.index), [1, 2, 3]);
    assert.ok(Math.abs(all.reduce((s, c) => s + c.score, 0) - 1) < 1e-9);
  });
});

describe('palpites em português', () => {
  it('usa os índices certos do modelo', () => {
    const expect = { 419: 'ballpoint', 488: 'cellular telephone', 838: 'sunglasses', 894: 'wallet', 1000: 'toilet tissue', 152: 'Chihuahua', 286: 'Egyptian cat' };
    for (const [index, label] of Object.entries(expect)) assert.equal(labels[index], label);
    assert.equal(imagenetPt(419), 'caneta');
    assert.equal(imagenetPt(200), 'cachorro');
    assert.equal(imagenetPt(283), 'gato');
  });

  it('ignora categorias que não são do dia a dia', () => {
    assert.equal(imagenetPt(992), null); // um tipo de fungo
  });

  it('soma as categorias que viram o mesmo nome', () => {
    const guess = bestGuess([
      { index: 282, score: 0.3 },
      { index: 283, score: 0.25 },
      { index: 505, score: 0.4 },
    ]);
    assert.equal(guess.name, 'gato');
    assert.ok(Math.abs(guess.score - 0.55) < 1e-9);
  });
});
