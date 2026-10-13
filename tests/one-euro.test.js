import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OneEuroFilter } from '../src/vision/one-euro.js';

describe('OneEuroFilter', () => {
  it('devolve a primeira amostra sem alterar', () => {
    const filter = new OneEuroFilter({ minCutoff: 1, beta: 0 });
    assert.equal(filter.filter(0.42, 0), 0.42);
  });

  it('converge para um valor parado', () => {
    const filter = new OneEuroFilter({ minCutoff: 1.2, beta: 8 });
    filter.filter(0, 0);
    let value = 0;
    for (let i = 1; i <= 60; i += 1) value = filter.filter(1, i * 0.1);
    assert.ok(Math.abs(value - 1) < 1e-3, `esperava ~1, veio ${value}`);
  });

  it('reduz o tremor de um objeto parado', () => {
    const filter = new OneEuroFilter({ minCutoff: 1.2, beta: 8 });
    const noise = [0.01, -0.012, 0.009, -0.008, 0.011, -0.01, 0.012, -0.009, 0.01, -0.011];
    const outputs = noise.map((n, i) => filter.filter(0.5 + n, i * 0.1));
    const spread = (values) => Math.max(...values) - Math.min(...values);
    assert.ok(spread(outputs.slice(2)) < spread(noise.slice(2)) * 0.6);
  });

  it('acompanha movimento rápido com pouco atraso e mede a velocidade', () => {
    const filter = new OneEuroFilter({ minCutoff: 1.2, beta: 8 });
    let value = 0;
    for (let i = 0; i <= 20; i += 1) value = filter.filter(i * 0.03, i * 0.1); // 0,3 por segundo
    const target = 20 * 0.03;
    assert.ok(target - value < 0.05, `atraso grande demais: ${target - value}`);
    assert.ok(Math.abs(filter.velocity - 0.3) < 0.05, `velocidade ${filter.velocity}`);
  });
});
