/**
 * Barramento de eventos mínimo.
 * Mantém os módulos desacoplados: o HUD, a interface e (depois) som e voz
 * só escutam eventos, sem depender do código uns dos outros.
 */
export class EventBus {
  #handlers = new Map();

  /** Registra um ouvinte e devolve a função que o remove. */
  on(type, handler) {
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
    this.#handlers.get(type).add(handler);
    return () => this.off(type, handler);
  }

  off(type, handler) {
    this.#handlers.get(type)?.delete(handler);
  }

  emit(type, payload) {
    const handlers = this.#handlers.get(type);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[ARGOS] Erro num ouvinte de "${type}"`, error);
      }
    }
  }
}
