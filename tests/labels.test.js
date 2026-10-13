import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { LABELS_PT, labelPt } from '../src/data/labels-pt.js';

const modelLabels = readFileSync(new URL('../models/labelmap.txt', import.meta.url), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && line !== '???');

describe('rótulos em português', () => {
  it('o modelo reconhece 80 tipos de objeto', () => {
    assert.equal(modelLabels.length, 80);
  });

  it('todo rótulo do modelo tem tradução', () => {
    const missing = modelLabels.filter((label) => !(label in LABELS_PT));
    assert.deepEqual(missing, []);
  });

  it('não há traduções sobrando', () => {
    const extra = Object.keys(LABELS_PT).filter((label) => !modelLabels.includes(label));
    assert.deepEqual(extra, []);
  });

  it('devolve o original quando não conhece o rótulo', () => {
    assert.equal(labelPt('cell phone'), 'celular');
    assert.equal(labelPt('flux capacitor'), 'flux capacitor');
  });
});
