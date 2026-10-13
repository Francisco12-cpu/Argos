import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeScene } from '../src/ui/telemetry.js';

describe('describeScene', () => {
  it('avisa quando não há nada', () => {
    assert.equal(describeScene([]), 'Nenhum objeto na tela.');
  });

  it('agrupa por tipo, do mais numeroso para o menos', () => {
    assert.equal(describeScene(['copo', 'pessoa', 'pessoa']), 'Na tela: pessoa (2), copo (1).');
  });

  it('desempata em ordem alfabética', () => {
    assert.equal(describeScene(['gato', 'cadeira']), 'Na tela: cadeira (1), gato (1).');
  });
});
