/**
 * Filtro One Euro (Casiez, Roussel e Vogel, CHI 2012).
 *
 * Suaviza muito quando o valor está parado (tira o tremor) e quase nada
 * quando ele se move rápido (não atrasa o movimento).
 * https://gery.casiez.net/1euro/
 */

const smoothingFactor = (cutoffHz, dtSeconds) => {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSeconds);
};

export class OneEuroFilter {
  /**
   * @param {object} options
   * @param {number} [options.minCutoff=1] Corte mínimo em Hz: menor = mais suave parado.
   * @param {number} [options.beta=0]      Quanto a velocidade abre o corte: maior = menos atraso.
   * @param {number} [options.dCutoff=1]   Corte em Hz da estimativa de velocidade.
   */
  constructor({ minCutoff = 1, beta = 0, dCutoff = 1 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.value = null;
    this.lastRaw = null;
    this.derivative = 0;
    this.lastTime = null;
  }

  /** Velocidade suavizada, em unidades por segundo. */
  get velocity() {
    return this.derivative;
  }

  /**
   * @param {number} value
   * @param {number} timeSeconds Instante da amostra, em segundos.
   */
  filter(value, timeSeconds) {
    if (this.lastTime === null) {
      this.value = value;
      this.lastRaw = value;
      this.derivative = 0;
      this.lastTime = timeSeconds;
      return value;
    }

    const dt = Math.max(timeSeconds - this.lastTime, 1e-3);
    this.lastTime = timeSeconds;

    // Como na implementação de referência: a velocidade vem das amostras
    // cruas, senão o atraso do próprio filtro inflaria a estimativa.
    const rawDerivative = (value - this.lastRaw) / dt;
    this.lastRaw = value;
    const aD = smoothingFactor(this.dCutoff, dt);
    this.derivative = aD * rawDerivative + (1 - aD) * this.derivative;

    const cutoff = this.minCutoff + this.beta * Math.abs(this.derivative);
    const a = smoothingFactor(cutoff, dt);
    this.value = a * value + (1 - a) * this.value;
    return this.value;
  }
}
