import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { areConfusable, LABEL_GROUPS } from '../src/data/label-groups.js';

const modelLabels = readFileSync(new URL('../models/labelmap.txt', import.meta.url), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && line !== '???');

describe('areConfusable', () => {
  it('aceita o mesmo rótulo e pares que o modelo costuma trocar', () => {
    assert.ok(areConfusable('cup', 'cup'));
    assert.ok(areConfusable('cup', 'bowl'));
    assert.ok(areConfusable('truck', 'car'));
    assert.ok(areConfusable('couch', 'chair'));
  });

  it('recusa trocas sem sentido', () => {
    assert.equal(areConfusable('person', 'bicycle'), false);
    assert.equal(areConfusable('cat', 'bus'), false);
    assert.equal(areConfusable('person', 'chair'), false);
  });

  it('só usa rótulos que o modelo conhece', () => {
    const unknown = LABEL_GROUPS.flat().filter((label) => !modelLabels.includes(label));
    assert.deepEqual(unknown, []);
  });

  it('é simétrica para todos os rótulos do modelo', () => {
    for (const a of modelLabels) {
      for (const b of modelLabels) {
        assert.equal(areConfusable(a, b), areConfusable(b, a), `${a} × ${b}`);
      }
    }
  });
});
