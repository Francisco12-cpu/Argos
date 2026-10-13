/**
 * Download dos arquivos pesados (motor wasm e modelo) com progresso real.
 *
 * O total vem da configuração, não do cabeçalho Content-Length: quando o
 * servidor comprime a resposta, o cabeçalho traz o tamanho comprimido e o
 * progresso ficaria errado.
 */

export class AssetError extends Error {
  constructor(url, status, cause) {
    super(`Não foi possível baixar ${url}${status ? ` (HTTP ${status})` : ''}`);
    this.name = 'AssetError';
    this.url = url;
    this.status = status;
    this.cause = cause;
  }
}

/**
 * Baixa um arquivo e devolve um ArrayBuffer.
 * @param {string} url
 * @param {{expectedBytes?: number, onProgress?: (received: number, total: number) => void, fetchImpl?: typeof fetch}} [options]
 */
export async function download(url, { expectedBytes = 0, onProgress, fetchImpl = globalThis.fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new AssetError(url, 0, error);
  }
  if (!response.ok) throw new AssetError(url, response.status);

  const headerBytes = Number(response.headers.get('content-length')) || 0;
  const total = expectedBytes || headerBytes;

  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = await response.arrayBuffer();
    onProgress?.(buffer.byteLength, buffer.byteLength);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total) onProgress?.(Math.min(received, total), total);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress?.(received, received);
  return bytes.buffer;
}

/**
 * Baixa vários arquivos em paralelo, com um único progresso de 0 a 1.
 * @param {Array<{url: string, bytes: number}>} items
 * @param {(fraction: number) => void} [onProgress]
 * @returns {Promise<ArrayBuffer[]>}
 */
export function downloadAll(items, onProgress, fetchImpl) {
  const total = items.reduce((sum, item) => sum + (item.bytes || 0), 0) || 1;
  const received = items.map(() => 0);
  const report = () => {
    const sum = received.reduce((a, b) => a + b, 0);
    onProgress?.(Math.min(1, sum / total));
  };
  return Promise.all(
    items.map((item, index) =>
      download(item.url, {
        expectedBytes: item.bytes,
        fetchImpl,
        onProgress: (bytes) => {
          received[index] = Math.min(bytes, item.bytes || bytes);
          report();
        },
      }),
    ),
  );
}

/** Formata bytes em MB no padrão brasileiro: 12,4 MB. */
export function formatMegabytes(bytes) {
  return `${(bytes / 1_000_000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}
