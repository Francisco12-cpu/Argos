/**
 * Painel de ajustes que sobe da parte de baixo da tela (feito para o polegar).
 *
 * Só cuida da interface: abrir, fechar, foco e desenhar o estado.
 * O que cada botão faz fica em main.js, pelas funções passadas no construtor.
 */

const FOCUSABLE = 'button:not([disabled]):not([hidden]), a[href]';

export class SettingsSheet {
  #root;
  #panel;
  #opener = null;
  #handlers;

  /**
   * @param {HTMLElement} root
   * @param {{
   *   onMode: (key: string) => void,
   *   onTheme: (id: string) => void,
   *   onTorch: () => void,
   *   onSwitchCamera: () => void,
   *   onDownloadAll: () => void,
   * }} handlers
   */
  constructor(root, handlers) {
    this.#root = root;
    this.#panel = root.querySelector('.sheet-panel');
    this.#handlers = handlers;

    for (const close of root.querySelectorAll('[data-sheet-close]')) {
      close.addEventListener('click', () => this.close());
    }
    for (const option of root.querySelectorAll('[data-mode-option]')) {
      option.addEventListener('click', () => handlers.onMode(option.dataset.modeOption));
    }
    for (const option of root.querySelectorAll('[data-theme-option]')) {
      option.addEventListener('click', () => handlers.onTheme(option.dataset.themeOption));
    }
    root.querySelector('[data-sheet-torch]')?.addEventListener('click', () => handlers.onTorch());
    root.querySelector('[data-action="switch-camera"]')?.addEventListener('click', () => handlers.onSwitchCamera());
    root.querySelector('[data-download-all]')?.addEventListener('click', () => handlers.onDownloadAll());

    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      } else if (event.key === 'Tab') {
        this.#trapFocus(event);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        this.#moveInRadioGroup(event);
      }
    });
  }

  get isOpen() {
    return !this.#root.hidden;
  }

  open(opener = document.activeElement) {
    if (this.isOpen) return;
    this.#opener = opener;
    this.#root.hidden = false;
    document.body.classList.add('sheet-open');
    const checked = this.#root.querySelector('[data-mode-option][aria-checked="true"]');
    (checked ?? this.#panel.querySelector(FOCUSABLE))?.focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen) return;
    this.#root.hidden = true;
    document.body.classList.remove('sheet-open');
    this.#opener?.focus?.({ preventScroll: true });
    this.#opener = null;
  }

  /**
   * @param {{
   *   mode: string,
   *   busy: boolean,
   *   modes: Record<string, {available: boolean, state: string, ready: boolean}>,
   * }} info
   */
  renderModes({ mode, busy, modes }) {
    for (const option of this.#root.querySelectorAll('[data-mode-option]')) {
      const key = option.dataset.modeOption;
      const info = modes[key];
      const checked = key === mode;
      option.setAttribute('aria-checked', String(checked));
      option.tabIndex = checked ? 0 : -1;
      option.disabled = busy || !info?.available;
      const state = this.#root.querySelector(`[data-mode-state="${key}"]`);
      if (state && info) {
        state.textContent = info.state;
        state.classList.toggle('is-ready', info.ready);
      }
    }
  }

  renderDownload({ busy, label, status }) {
    const button = this.#root.querySelector('[data-download-all]');
    button.disabled = busy;
    button.textContent = label;
    this.#root.querySelector('[data-download-status]').textContent = status ?? '';
  }

  renderTheme(id) {
    for (const option of this.#root.querySelectorAll('[data-theme-option]')) {
      option.setAttribute('aria-pressed', String(option.dataset.themeOption === id));
    }
  }

  renderCamera({ canSwitch, torch, torchOn }) {
    const switchButton = this.#root.querySelector('[data-action="switch-camera"]');
    const torchButton = this.#root.querySelector('[data-sheet-torch]');
    switchButton.hidden = !canSwitch;
    torchButton.hidden = !torch;
    torchButton.setAttribute('aria-pressed', String(Boolean(torchOn)));
    torchButton.textContent = torchOn ? 'Desligar lanterna' : 'Ligar lanterna';
    this.#root.querySelector('[data-camera-note]').hidden = canSwitch || torch;
  }

  setVersion(text) {
    const el = this.#root.querySelector('[data-version]');
    if (el) el.textContent = text;
  }

  #focusables() {
    return [...this.#panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
  }

  #trapFocus(event) {
    const items = this.#focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  #moveInRadioGroup(event) {
    const current = event.target.closest?.('[data-mode-option]');
    if (!current) return;
    const options = [...this.#root.querySelectorAll('[data-mode-option]:not([disabled])')];
    const index = options.indexOf(current);
    if (index < 0) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    options[(index + step + options.length) % options.length].focus();
  }
}
