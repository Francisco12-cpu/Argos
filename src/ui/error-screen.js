/**
 * Tela de erro: diz o que aconteceu e oferece a ação que resolve.
 */

export class ErrorScreen {
  #root;
  #code;
  #title;
  #text;
  #primary;
  #secondary;

  constructor(root) {
    this.#root = root;
    this.#code = root.querySelector('[data-error-code]');
    this.#title = root.querySelector('[data-error-title]');
    this.#text = root.querySelector('[data-error-text]');
    this.#primary = root.querySelector('[data-error-primary]');
    this.#secondary = root.querySelector('[data-error-secondary]');
  }

  /**
   * @param {{code: string, title: string, message: string,
   *          primary: {label: string, onClick: () => void},
   *          secondary?: {label: string, onClick: () => void}}} error
   */
  show({ code, title, message, primary, secondary }) {
    this.#code.textContent = code;
    this.#title.textContent = title;
    this.#text.textContent = message;
    this.#primary.textContent = primary.label;
    this.#primary.onclick = primary.onClick;
    this.#secondary.hidden = !secondary;
    if (secondary) {
      this.#secondary.textContent = secondary.label;
      this.#secondary.onclick = secondary.onClick;
    }
    requestAnimationFrame(() => this.#primary.focus({ preventScroll: true }));
  }
}
