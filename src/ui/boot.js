/**
 * Tela de abertura: o olho com cem pontos ao redor.
 * Cada ponto que acende é 1% do download real da IA.
 */

const DOTS = 100;
const RADIUS = 108;
const CENTER = 120;
const FIBERS = 60;
const MAX_LOG_LINES = 5;
const SVG_NS = 'http://www.w3.org/2000/svg';

export class BootScreen {
  #root;
  #ring;
  #dots = [];
  #lit = 0;
  #button;
  #label;
  #log;
  #inApp;
  #startedAt = performance.now();

  constructor(root) {
    this.#root = root;
    this.#ring = root.querySelector('[data-ring]');
    this.#button = root.querySelector('[data-activate]');
    this.#label = root.querySelector('[data-activate-label]');
    this.#log = root.querySelector('[data-log]');
    this.#inApp = root.querySelector('[data-inapp]');
    this.#buildRing();
  }

  #buildRing() {
    const group = this.#ring.querySelector('[data-dots]');
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < DOTS; i += 1) {
      const angle = (i / DOTS) * Math.PI * 2 - Math.PI / 2;
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', (CENTER + Math.cos(angle) * RADIUS).toFixed(2));
      dot.setAttribute('cy', (CENTER + Math.sin(angle) * RADIUS).toFixed(2));
      dot.setAttribute('r', i % 25 === 0 ? '2.6' : '1.6');
      dot.setAttribute('class', 'dot');
      fragment.append(dot);
      this.#dots.push(dot);
    }
    group.append(fragment);

    // Fibras da íris: linhas radiais de comprimentos variados, como numa íris de verdade.
    const fibers = this.#ring.querySelector('[data-fibers]');
    if (!fibers) return;
    const lines = document.createDocumentFragment();
    for (let i = 0; i < FIBERS; i += 1) {
      const angle = (i / FIBERS) * Math.PI * 2;
      const inner = 13 + ((i * 7) % 5);
      const outer = 30 + ((i * 11) % 8);
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', (CENTER + Math.cos(angle) * inner).toFixed(2));
      line.setAttribute('y1', (CENTER + Math.sin(angle) * inner).toFixed(2));
      line.setAttribute('x2', (CENTER + Math.cos(angle) * outer).toFixed(2));
      line.setAttribute('y2', (CENTER + Math.sin(angle) * outer).toFixed(2));
      line.setAttribute('class', i % 3 === 0 ? 'fiber fiber--bright' : 'fiber');
      lines.append(line);
    }
    fibers.append(lines);
  }

  reset() {
    this.#root.classList.remove('is-ready', 'is-busy');
    for (const dot of this.#dots) dot.classList.remove('on');
    this.#lit = 0;
    this.#log.replaceChildren();
    this.#startedAt = performance.now();
    this.setProgress(0);
  }

  /** @param {number} fraction 0 a 1 */
  setProgress(fraction) {
    const value = Math.min(1, Math.max(0, fraction));
    const lit = Math.round(value * DOTS);
    for (let i = this.#lit; i < lit; i += 1) this.#dots[i].classList.add('on');
    this.#lit = Math.max(this.#lit, lit);
    const percent = Math.round(value * 100);
    this.#root.style.setProperty('--progress', `${percent}%`);
    this.#ring.setAttribute('aria-valuenow', String(percent));
    if (!this.#root.classList.contains('is-ready')) {
      this.#label.textContent = `Carregando a IA ${percent}%`;
    }
  }

  log(text) {
    const line = document.createElement('li');
    const time = document.createElement('span');
    time.className = 'boot-log-time';
    time.textContent = ((performance.now() - this.#startedAt) / 1000).toFixed(2).padStart(5, '0');
    line.append(time, document.createTextNode(text));
    this.#log.append(line);
    while (this.#log.children.length > MAX_LOG_LINES) this.#log.firstElementChild.remove();
  }

  ready() {
    this.#root.classList.add('is-ready');
    this.#root.classList.remove('is-busy');
    this.#button.disabled = false;
    this.#label.textContent = 'Ativar visor';
  }

  busy(text) {
    this.#root.classList.add('is-busy');
    this.#button.disabled = true;
    this.#label.textContent = text;
  }

  idle() {
    this.#root.classList.remove('is-busy');
    if (this.#root.classList.contains('is-ready')) this.ready();
  }

  onActivate(handler) {
    this.#button.addEventListener('click', handler);
  }

  showInAppWarning(appName, onCopy) {
    this.#inApp.hidden = false;
    this.#inApp.querySelector('[data-inapp-name]').textContent = appName;
    const button = this.#inApp.querySelector('[data-inapp-copy]');
    button.onclick = async () => {
      const copied = await onCopy();
      button.textContent = copied ? 'Link copiado' : 'Copie o endereço da página';
    };
  }
}
