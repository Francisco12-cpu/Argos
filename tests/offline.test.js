import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function precacheList() {
  const source = await readFile(join(ROOT, 'sw.js'), 'utf8');
  const block = source.match(/const PRECACHE = \[([\s\S]*?)\];/);
  assert.ok(block, 'sw.js precisa da lista PRECACHE');
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

async function filesUnder(dir) {
  const entries = await readdir(join(ROOT, dir), { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(ROOT, join(entry.parentPath ?? entry.path, entry.name)).split('\\').join('/'));
}

test('o service worker guarda todo arquivo que existe', async () => {
  for (const path of await precacheList()) {
    if (path === './') continue;
    const info = await stat(join(ROOT, path)).catch(() => null);
    assert.ok(info?.isFile(), `${path} está na lista mas não existe`);
  }
});

test('todo código do visor está na lista do service worker', async () => {
  const listed = new Set(await precacheList());
  const code = (await filesUnder('src')).filter((path) => !path.startsWith('src/bench/') && !path.endsWith('bench.css'));
  for (const path of code) assert.ok(listed.has(path), `${path} falta no PRECACHE de sw.js`);
});

test('os modelos e o motor embutidos ficam guardados', async () => {
  const listed = new Set(await precacheList());
  const binaries = [...(await filesUnder('models')), ...(await filesUnder('vendor'))].filter((path) => /\.(tflite|wasm|mjs|js)$/.test(path));
  for (const path of binaries) assert.ok(listed.has(path), `${path} falta no PRECACHE de sw.js`);
});

test('a versão do service worker acompanha a do app', async () => {
  const sw = await readFile(join(ROOT, 'sw.js'), 'utf8');
  const { CONFIG } = await import('../src/core/config.js');
  assert.match(sw, new RegExp(`const VERSION = '${CONFIG.app.version.replaceAll('.', '\\.')}'`));
});

test('o modo máximo só conta como baixado com biblioteca e pesos no cache', async () => {
  const { isMaxModeCached } = await import('../src/ui/offline.js');
  const model = { library: 'https://cdn.example/transformers.js', hub: 'org/rfdetr', dtype: 'fp16' };
  const stores = new Map();
  globalThis.caches = {
    match: async (url) => [...stores.values()].some((store) => store.has(url)) || undefined,
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Set());
      const store = stores.get(name);
      return { keys: async () => [...store].map((url) => ({ url })) };
    },
  };
  try {
    assert.equal(await isMaxModeCached(model), false);
    stores.set('argos-models', new Set([model.library]));
    assert.equal(await isMaxModeCached(model), false);
    stores.set('transformers-cache', new Set(['https://huggingface.co/org/rfdetr/resolve/main/onnx/model_fp16.onnx']));
    assert.equal(await isMaxModeCached(model), true);
    assert.equal(await isMaxModeCached({ ...model, dtype: 'q8' }), false);
  } finally {
    delete globalThis.caches;
  }
});
