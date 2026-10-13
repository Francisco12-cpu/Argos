/**
 * Máquina de estados do app.
 *
 *   BOOT → PERMISSION → CALIBRATION → SCANNING
 *     ↘        ↘             ↘           ↘
 *                     ERROR
 *
 * TRAVADO e ANÁLISE entram na Fase 3, junto com o travamento de alvo.
 */
export const State = Object.freeze({
  BOOT: 'boot',
  PERMISSION: 'permission',
  CALIBRATION: 'calibration',
  SCANNING: 'scanning',
  ERROR: 'error',
});

const TRANSITIONS = Object.freeze({
  [State.BOOT]: [State.PERMISSION, State.ERROR],
  [State.PERMISSION]: [State.CALIBRATION, State.ERROR],
  [State.CALIBRATION]: [State.SCANNING, State.ERROR],
  [State.SCANNING]: [State.CALIBRATION, State.ERROR],
  [State.ERROR]: [State.BOOT, State.PERMISSION],
});

export class StateMachine {
  #state;
  #bus;

  constructor(bus, initial = State.BOOT) {
    this.#bus = bus;
    this.#state = initial;
  }

  get state() {
    return this.#state;
  }

  is(state) {
    return this.#state === state;
  }

  can(next) {
    return TRANSITIONS[this.#state]?.includes(next) ?? false;
  }

  go(next, detail) {
    if (!this.can(next)) {
      throw new Error(`Transição inválida: ${this.#state} → ${next}`);
    }
    const from = this.#state;
    this.#state = next;
    this.#bus?.emit('state', { from, to: next, detail });
  }
}
