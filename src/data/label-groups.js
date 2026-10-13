/**
 * Tipos de objeto que o modelo costuma confundir entre si.
 *
 * Se uma análise diz "copo" e a seguinte diz "tigela" no mesmo lugar, é o
 * mesmo objeto. Já "pessoa" virar "bicicleta" no mesmo lugar significa que
 * outra coisa entrou em cena, então o rastreador cria um objeto novo.
 */
export const LABEL_GROUPS = [
  ['car', 'truck', 'bus', 'train'],
  ['bicycle', 'motorcycle'],
  ['airplane', 'bird', 'kite'],
  ['boat', 'surfboard'],
  ['cup', 'wine glass', 'bowl', 'vase', 'bottle'],
  ['chair', 'couch', 'bench', 'bed'],
  ['dining table', 'bed', 'bench'],
  ['tv', 'laptop'],
  ['laptop', 'keyboard'],
  ['cell phone', 'remote', 'mouse'],
  ['cat', 'dog', 'teddy bear', 'bear', 'sheep'],
  ['horse', 'cow', 'sheep', 'zebra'],
  ['backpack', 'handbag', 'suitcase'],
  ['apple', 'orange'],
  ['donut', 'cake'],
  ['sandwich', 'hot dog', 'pizza'],
  ['sports ball', 'frisbee', 'orange', 'apple'],
  ['skis', 'snowboard', 'skateboard', 'surfboard'],
  ['oven', 'microwave', 'refrigerator', 'toaster'],
  ['knife', 'fork', 'spoon', 'scissors', 'toothbrush'],
  ['toilet', 'sink'],
  ['potted plant', 'vase', 'broccoli'],
];

const RELATED = new Map();
for (const group of LABEL_GROUPS) {
  for (const label of group) {
    if (!RELATED.has(label)) RELATED.set(label, new Set());
    for (const other of group) if (other !== label) RELATED.get(label).add(other);
  }
}

/** Mesmo rótulo, ou rótulos que o modelo costuma trocar entre si. */
export function areConfusable(a, b) {
  return a === b || (RELATED.get(a)?.has(b) ?? false);
}
