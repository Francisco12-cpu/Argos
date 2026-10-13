/**
 * Temas: a estrutura do HUD não muda, só as cores.
 * As mesmas cores alimentam o CSS (variáveis) e o canvas.
 */

export const THEMES = Object.freeze({
  cyberpunk: Object.freeze({
    id: 'cyberpunk',
    name: 'Cyberpunk',
    primary: '#05D9E8',
    accent: '#FF2A6D',
    warn: '#F9F002',
    ink: '#04050E',
    text: '#D8FBFF',
  }),
  tactical: Object.freeze({
    id: 'tactical',
    name: 'Tático',
    primary: '#39FF14',
    accent: '#FFB000',
    warn: '#FF3B30',
    ink: '#020A04',
    text: '#E2FFD9',
  }),
  armor: Object.freeze({
    id: 'armor',
    name: 'Armadura',
    primary: '#FFB800',
    accent: '#E63946',
    warn: '#FFFFFF',
    ink: '#0B0604',
    text: '#FFF3D6',
  }),
});

const ORDER = ['cyberpunk', 'tactical', 'armor'];
const STORAGE_KEY = 'argos.theme';
const COLOR_KEYS = ['primary', 'accent', 'warn', 'ink', 'text'];

export function savedThemeId(fallback) {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    return id && THEMES[id] ? id : fallback;
  } catch {
    return fallback;
  }
}

export function nextThemeId(id) {
  return ORDER[(ORDER.indexOf(id) + 1) % ORDER.length];
}

/** Aplica o tema na página e devolve a paleta para o canvas. */
export function applyTheme(id) {
  const theme = THEMES[id] ?? THEMES.cyberpunk;
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  for (const key of COLOR_KEYS) root.style.setProperty(`--${key}`, theme[key]);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.ink);
  try {
    localStorage.setItem(STORAGE_KEY, theme.id);
  } catch {
    // Navegação privada pode bloquear o armazenamento; o tema só não fica salvo.
  }
  return theme;
}

/** '#05D9E8' + 0.5 → 'rgba(5, 217, 232, 0.5)' */
export function rgba(hex, alpha) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}
