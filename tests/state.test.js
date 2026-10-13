import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EventBus } from '../src/core/events.js';
import { State, StateMachine } from '../src/core/state.js';

describe('StateMachine', () => {
  it('segue o caminho feliz e avisa cada mudança', () => {
    const bus = new EventBus();
    const seen = [];
    bus.on('state', ({ from, to }) => seen.push(`${from}→${to}`));
    const machine = new StateMachine(bus);

    machine.go(State.PERMISSION);
    machine.go(State.CALIBRATION);
    machine.go(State.SCANNING);

    assert.equal(machine.state, State.SCANNING);
    assert.deepEqual(seen, ['boot→permission', 'permission→calibration', 'calibration→scanning']);
  });

  it('recusa transições que pulam etapas', () => {
    const machine = new StateMachine(new EventBus());
    assert.equal(machine.can(State.SCANNING), false);
    assert.throws(() => machine.go(State.SCANNING), /Transição inválida/);
  });

  it('qualquer estado pode ir para erro, e do erro dá para tentar de novo', () => {
    const machine = new StateMachine(new EventBus(), State.SCANNING);
    machine.go(State.ERROR);
    assert.ok(machine.can(State.PERMISSION));
    assert.ok(machine.can(State.BOOT));
  });
});

describe('EventBus', () => {
  it('remove o ouvinte pela função devolvida em on()', () => {
    const bus = new EventBus();
    let calls = 0;
    const off = bus.on('ping', () => (calls += 1));
    bus.emit('ping');
    off();
    bus.emit('ping');
    assert.equal(calls, 1);
  });

  it('um ouvinte com erro não impede os outros', () => {
    const bus = new EventBus();
    let reached = false;
    const original = console.error;
    console.error = () => {};
    bus.on('ping', () => {
      throw new Error('falhou');
    });
    bus.on('ping', () => (reached = true));
    bus.emit('ping');
    console.error = original;
    assert.ok(reached);
  });
});
