/**
 * Textos das barras do HUD (hora, FPS, tempo da IA, contagem).
 * Atualiza poucas vezes por segundo: o DOM não precisa de 60 quadros.
 */

/** Intervalo mínimo entre avisos para leitores de tela. */
const SUMMARY_EVERY_MS = 3_000;

/**
 * Resumo da cena para leitores de tela.
 * ['pessoa', 'copo', 'pessoa'] → 'Na tela: pessoa (2), copo (1).'
 */
export function describeScene(labels) {
  if (labels.length === 0) return 'Nenhum objeto na tela.';
  const counts = new Map();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  const parts = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
    .map(([label, count]) => `${label} (${count})`);
  return `Na tela: ${parts.join(', ')}.`;
}

export class Telemetry {
  #fields;
  #provider;
  #timer = 0;
  #shown = new Map();
  #summaryAt = 0;

  /**
   * @param {ParentNode} root
   * @param {() => {fps: number, inferMs: number, rate: number, engine: string, engineTitle: string, labels: string[], status: string}} provider
   *   `labels`: nomes em português dos objetos confirmados.
   */
  constructor(root, provider) {
    this.#provider = provider;
    this.#fields = {
      clock: root.querySelector('[data-clock]'),
      fps: root.querySelector('[data-fps]'),
      infer: root.querySelector('[data-infer]'),
      rate: root.querySelector('[data-rate]'),
      engine: root.querySelector('[data-engine]'),
      count: root.querySelector('[data-count]'),
      countLabel: root.querySelector('[data-count-label]'),
      status: root.querySelector('[data-status]'),
      summary: root.querySelector('[data-summary]'),
    };
  }

  start(hz) {
    this.stop();
    this.#tick();
    this.#timer = setInterval(() => this.#tick(), 1000 / hz);
  }

  stop() {
    clearInterval(this.#timer);
  }

  #set(name, text) {
    if (this.#shown.get(name) === text) return;
    this.#shown.set(name, text);
    this.#fields[name].textContent = text;
  }

  #tick() {
    const data = this.#provider();
    const now = new Date();
    this.#set('clock', now.toLocaleTimeString('pt-BR', { hour12: false }));
    this.#fields.clock.dateTime = now.toISOString();
    this.#set('fps', data.fps ? String(Math.round(data.fps)) : '--');
    this.#set('infer', data.inferMs ? `${Math.round(data.inferMs)} ms` : '--');
    this.#set('rate', `${data.rate}/s`);
    this.#set('engine', data.engine);
    this.#fields.engine.title = data.engineTitle;
    const count = data.labels.length;
    this.#set('count', String(count).padStart(2, '0'));
    this.#set('countLabel', count === 1 ? 'objeto' : 'objetos');
    this.#set('status', data.status);

    const elapsed = performance.now() - this.#summaryAt;
    if (elapsed >= SUMMARY_EVERY_MS) {
      const summary = describeScene(data.labels);
      if (this.#shown.get('summary') !== summary) {
        this.#set('summary', summary);
        this.#summaryAt = performance.now();
      }
    }
  }
}
