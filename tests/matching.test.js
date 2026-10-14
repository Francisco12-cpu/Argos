import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isMatch, normalizeName } from '../src/bench/matching.js';

describe('página de teste: comparação de nomes', () => {
  it('ignora acentos, maiúsculas, artigos e plural', () => {
    assert.equal(normalizeName('Uma Xícaras'), 'xicara');
  });

  it('aceita nome parcial, por palavra inteira', () => {
    assert.ok(isMatch('copo de vidro', ['copo']));
    assert.ok(isMatch('gato', ['gato']));
    assert.ok(isMatch('óculos', ['óculos de sol']));
  });

  it('não confunde pedaços de palavra', () => {
    assert.equal(isMatch('papel', ['pá']), false);
    assert.equal(isMatch('', ['copo']), false);
  });
});
