/**
 * Probabilidades das `count` classes mais prováveis, a partir dos logits
 * (o classificador int8 devolve notas cruas, não probabilidades).
 * @param {Array<{index: number, score: number}>} categories
 */
export function softmaxTop(categories, count) {
  if (categories.length === 0) return [];
  let max = -Infinity;
  for (const c of categories) if (c.score > max) max = c.score;
  let sum = 0;
  const exps = categories.map((c) => {
    const e = Math.exp(c.score - max);
    sum += e;
    return { index: c.index, e };
  });
  return exps
    .sort((a, b) => b.e - a.e)
    .slice(0, count)
    .map(({ index, e }) => ({ index, score: e / sum }));
}
