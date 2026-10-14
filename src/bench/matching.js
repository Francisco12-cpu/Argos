/**
 * Comparação tolerante entre o que a pessoa escreveu e os nomes que o
 * ARGOS encontrou: ignora maiúsculas, acentos, artigos e plural simples.
 */

const STOP_WORDS = new Set(['um', 'uma', 'o', 'a', 'os', 'as', 'de', 'do', 'da']);

export function normalizeName(text) {
  return String(text ?? '')
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 -]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !STOP_WORDS.has(word))
    .map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word))
    .join(' ');
}

/** O nome esperado aparece (inteiro) em algum dos nomes encontrados, ou o contrário? */
export function isMatch(expected, names) {
  const want = normalizeName(expected);
  if (!want) return false;
  return names.some((name) => {
    const got = normalizeName(name);
    if (!got) return false;
    const pad = (text) => ` ${text} `;
    return got === want || pad(got).includes(pad(want)) || pad(want).includes(pad(got));
  });
}
