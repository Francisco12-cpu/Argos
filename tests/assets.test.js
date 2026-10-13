import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AssetError, download, downloadAll, formatMegabytes } from '../src/vision/assets.js';

/** fetch falso que entrega `bytes` em pedaços de `chunk`. */
function fakeFetch(files, { chunk = 1000, contentLength } = {}) {
  return async (url) => {
    const size = files[url];
    if (size === undefined) return new Response('nada aqui', { status: 404 });
    let sent = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (sent >= size) {
          controller.close();
          return;
        }
        const n = Math.min(chunk, size - sent);
        controller.enqueue(new Uint8Array(n).fill(7));
        sent += n;
      },
    });
    const headers = contentLength === undefined ? {} : { 'content-length': String(contentLength) };
    return new Response(body, { status: 200, headers });
  };
}

describe('download', () => {
  it('relata o progresso e entrega todos os bytes', async () => {
    const reports = [];
    const buffer = await download('modelo.tflite', {
      expectedBytes: 5000,
      fetchImpl: fakeFetch({ 'modelo.tflite': 5000 }),
      onProgress: (received, total) => reports.push([received, total]),
    });
    assert.equal(buffer.byteLength, 5000);
    assert.deepEqual(reports.at(-1), [5000, 5000]);
    assert.ok(reports.length >= 5);
  });

  it('usa o tamanho esperado mesmo se o cabeçalho trouxer o tamanho comprimido', async () => {
    const reports = [];
    await download('motor.wasm', {
      expectedBytes: 8000,
      fetchImpl: fakeFetch({ 'motor.wasm': 8000 }, { contentLength: 2000 }),
      onProgress: (received, total) => reports.push(received / total),
    });
    assert.ok(reports.every((fraction) => fraction <= 1));
  });

  it('falha com AssetError quando o arquivo não existe', async () => {
    await assert.rejects(download('sumiu.bin', { fetchImpl: fakeFetch({}) }), AssetError);
  });
});

describe('downloadAll', () => {
  it('soma o progresso de vários arquivos de 0 a 1', async () => {
    const fractions = [];
    const [a, b] = await downloadAll(
      [
        { url: 'a', bytes: 3000 },
        { url: 'b', bytes: 1000 },
      ],
      (fraction) => fractions.push(fraction),
      fakeFetch({ a: 3000, b: 1000 }),
    );
    assert.equal(a.byteLength, 3000);
    assert.equal(b.byteLength, 1000);
    assert.equal(fractions.at(-1), 1);
    assert.ok(fractions.every((f, i) => i === 0 || f >= fractions[i - 1]), 'o progresso nunca volta');
  });
});

describe('formatMegabytes', () => {
  it('usa vírgula decimal', () => {
    assert.equal(formatMegabytes(12_997_272), '13,0 MB');
    assert.equal(formatMegabytes(4_544_599), '4,5 MB');
  });
});
