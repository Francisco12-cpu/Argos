# Modelo de detecção

`efficientdet_lite0_int8.tflite`: EfficientDet-Lite0 treinado no dataset COCO (80 tipos de objeto), quantizado em int8, com os rótulos embutidos nos metadados.

- Entrada: imagem 320 × 320; o MediaPipe redimensiona sozinho.
- Tamanho: 4.544.599 bytes.
- SHA-256: `dee1b4af055a644804d5594442300ecc9e4f7080c25b7c044c98f527eeabb6cf`
- Origem: [tensorflow/tflite-support](https://github.com/tensorflow/tflite-support/blob/master/tensorflow_lite_support/cc/test/testdata/task/vision/coco_efficientdet_lite0_v1_1.0_quant_2021_09_06.tflite), arquivo `coco_efficientdet_lite0_v1_1.0_quant_2021_09_06.tflite`.
- Licença: Apache License 2.0 (arquivo `LICENSE` nesta pasta).

`labelmap.txt` é a lista de rótulos extraída do próprio modelo (as linhas `???` são classes vagas do COCO, ignoradas pelo app). Os testes usam esse arquivo para garantir que todo rótulo tem tradução em `src/data/labels-pt.js`.

## Por que CPU

O delegate de GPU do MediaPipe não aceita modelos quantizados em int8 (no teste, a análise falha). Por isso o ARGOS roda este modelo na CPU, dentro de um Web Worker. Um modelo float16 para GPU entra como opção futura, na lista `models` de `src/core/config.js`.

# Classificador (palpites)

`mobilenet_v2_int8.tflite`: MobileNetV2 1.0 (entrada 224 × 224) treinado no ImageNet, quantizado em int8. Devolve notas cruas (logits) para 1.001 classes; o app converte em probabilidades.

- Tamanho: 3.577.760 bytes.
- SHA-256: `f08d447cde49b4e0446428aa921aff0a14ea589fa9c5817b31f83128e9a43c1d`
- Origem: [tensorflow/tflite-support](https://github.com/tensorflow/tflite-support/blob/master/tensorflow_lite_support/metadata/python/tests/testdata/image_classifier/mobilenet_v2_1.0_224_quant.tflite), arquivo `mobilenet_v2_1.0_224_quant.tflite`.
- Licença: Apache License 2.0.

O modelo não traz os rótulos embutidos. `imagenet-labels.txt` é a lista de rótulos (a linha 0 é "background"), tirada do `mobilenet_v2_1.0_224.tflite` do mesmo repositório. Só as categorias do dia a dia viram palpite, com nomes em português em `src/data/imagenet-pt.js`.

# Modo preciso

O EfficientDet-Lite2 int8 (entrada 448 × 448, cerca de 7 MB) não fica no repositório: o app o baixa do servidor oficial do MediaPipe quando a pessoa liga o modo preciso, e o navegador guarda em cache.
