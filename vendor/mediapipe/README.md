# MediaPipe Tasks Vision 1.1.0

Cópia fixa do pacote [`@mediapipe/tasks-vision@1.1.0`](https://www.npmjs.com/package/@mediapipe/tasks-vision), servida pelo próprio site para o ARGOS não depender de CDN.

Licença: Apache License 2.0 (arquivo `LICENSE` nesta pasta).

| Arquivo | Origem no pacote | SHA-256 |
| --- | --- | --- |
| `vision_bundle.mjs` | `vision_bundle.mjs` | `9d5fc9ef74b22329cf9aa88dc543956d192b8c254210b187271614713eb5b10c` |
| `wasm/vision_wasm_module_internal.js` | `wasm/vision_wasm_module_internal.js` | `70eff3956521b7de058d7173a4935c95e4a223c26ea624b9f5a936d3a043dcb0` |
| `wasm/vision_wasm_module_internal.wasm` | `wasm/vision_wasm_module_internal.wasm` | `ee03b14a878e6c3c053a1bfa62e166dc45244be54dc0bbe61c578f710b771f6a` |

Só a variante "module" foi copiada: ela roda dentro de um Web Worker do tipo módulo e também na thread principal (o ARGOS importa o carregador antes de criar o detector). Ela exige WebAssembly SIMD, presente em todos os navegadores atuais.

## Como atualizar

```sh
npm pack @mediapipe/tasks-vision@<versão>
tar -xzf mediapipe-tasks-vision-<versão>.tgz
cp package/vision_bundle.mjs vendor/mediapipe/
cp package/wasm/vision_wasm_module_internal.* vendor/mediapipe/wasm/
```

Depois, atualize o tamanho do `.wasm` em `src/core/config.js` (`engine.wasm.bytes`), que alimenta a barra de progresso, e a tabela acima.
