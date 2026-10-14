/**
 * Configuração central do ARGOS.
 * Caminhos são relativos ao index.html; tempos em milissegundos.
 */

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const CONFIG = deepFreeze({
  app: {
    name: 'ARGOS',
    version: '0.4.0',
  },

  /** Motor de IA (MediaPipe Tasks Vision 1.1.0), servido pelo próprio site. */
  engine: {
    loader: 'vendor/mediapipe/wasm/vision_wasm_module_internal.js',
    wasm: {
      url: 'vendor/mediapipe/wasm/vision_wasm_module_internal.wasm',
      bytes: 12_997_272,
    },
  },

  /**
   * Detectores disponíveis. O padrão vem dentro do repositório; o "modo
   * preciso" baixa o EfficientDet-Lite2 do servidor oficial do MediaPipe.
   * Os dois são int8 e rodam na CPU (o delegate de GPU não aceita int8).
   */
  models: {
    fast: {
      id: 'efficientdet-lite0-int8',
      label: 'LITE0',
      name: 'Rápido',
      url: 'models/efficientdet_lite0_int8.tflite',
      bytes: 4_544_599,
      delegate: 'CPU',
    },
    precise: {
      id: 'efficientdet-lite2-int8',
      label: 'LITE2',
      name: 'Preciso',
      url: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/int8/latest/efficientdet_lite2.tflite',
      bytes: 0,
      delegate: 'CPU',
    },
    /**
     * Modo máximo: RF-DETR Nano (precisão quase o dobro do Lite0 no COCO),
     * via Transformers.js na GPU (WebGPU com shader-f16). O modelo fp16
     * (cerca de 54 MB) vem do Hugging Face no primeiro uso.
     */
    max: {
      id: 'rf-detr-nano-fp16',
      label: 'RF-DETR',
      name: 'Máximo',
      library: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js',
      hub: 'onnx-community/rfdetr_nano-ONNX',
      dtype: 'fp16',
      approxBytes: 54_400_000,
      initTimeoutMs: 180_000,
    },
  },

  /** Classificador de 1.000 categorias (ImageNet), para palpites na mira. */
  classifier: {
    url: 'models/mobilenet_v2_int8.tflite',
    bytes: 3_577_760,
    /** Lado do recorte analisado, em fração do menor lado do quadro. */
    cropFraction: 0.4,
    /** Tempo mínimo entre palpites. */
    intervalMs: 700,
    /** Mira sem objeto por esse tempo antes de pedir um palpite. */
    idleMs: 600,
    /** Confiança mínima para mostrar o palpite. */
    minScore: 0.3,
    /** Por quanto tempo um palpite continua na tela. */
    showMs: 2_000,
  },

  /** Zoom de análise: alterna imagem inteira e recorte do centro. */
  views: {
    enabled: true,
    cropFraction: 0.55,
    minFrameSide: 480,
  },

  detector: {
    /** Corte mínimo pedido ao modelo; o rastreador decide o resto. */
    scoreThreshold: 0.3,
    maxResults: 12,
    initTimeoutMs: 25_000,
    /** Falhas seguidas antes de mostrar erro. */
    maxConsecutiveFailures: 3,
  },

  tracker: {
    /** Confiança para criar um objeto novo. */
    minScoreNew: 0.45,
    /** Confiança para manter um objeto que já está na tela. */
    minScoreKeep: 0.3,
    /** Análises seguidas até o objeto aparecer. */
    confirmHits: 3,
    /** Análises sem ver o objeto até ele começar a sumir. */
    maxMisses: 10,
    /** Duração do fade de saída. */
    fadeMs: 400,
    /** Sobreposição mínima (IoU) para casar com o mesmo tipo de objeto. */
    iouSame: 0.3,
    /** Sobreposição mínima para casar quando o modelo trocou o nome do objeto. */
    iouCross: 0.55,
    /** Detecções de tipos diferentes no mesmo lugar: fica a mais confiante. */
    crossClassIou: 0.7,
    /** Peso que cada voto antigo de rótulo mantém a cada análise. */
    voteDecay: 0.85,
    /** Suavização da confiança exibida (0 = parada, 1 = sem suavizar). */
    scoreSmoothing: 0.35,
    /** Por quanto tempo uma detecção fraca aparece como dúvida. */
    weakMs: 700,
    /** Até quanto tempo à frente a posição é prevista pela velocidade. */
    maxPredictMs: 250,
    /** Filtro One Euro, em unidades normalizadas (fração do quadro). */
    filter: {
      position: { minCutoff: 1.2, beta: 8, dCutoff: 1 },
      size: { minCutoff: 0.8, beta: 4, dCutoff: 1 },
    },
  },

  loop: {
    /** Teto de análises por segundo, para não esquentar o aparelho. */
    maxAiHz: 15,
    /** Teto quando a IA roda na thread principal (navegadores sem worker). */
    mainThreadAiHz: 6,
    /** Aba escondida por mais que isso: objetos antigos são descartados. */
    resetAfterHiddenMs: 1_000,
  },

  ui: {
    defaultTheme: 'cyberpunk',
    /** Sem nenhum objeto por esse tempo, a mira sugere aproximar. */
    hintAfterMs: 4_000,
    calibrationMs: 1_100,
    telemetryHz: 4,
  },
});
