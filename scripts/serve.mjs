#!/usr/bin/env node
/**
 * Servidor local sem dependências, para desenvolver o ARGOS.
 *
 *   npm start            → http://127.0.0.1:8080
 *   PORT=3000 npm start  → outra porta
 *
 * A câmera exige "contexto seguro": funciona em localhost, mas não em
 * http://192.168.x.x. Para testar no celular, publique no GitHub Pages.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.tflite': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    let path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (path !== ROOT && !path.startsWith(ROOT + sep)) {
      response.writeHead(403).end('Acesso negado');
      return;
    }
    let info = await stat(path).catch(() => null);
    if (info?.isDirectory()) {
      path = join(path, 'index.html');
      info = await stat(path).catch(() => null);
    }
    if (!info?.isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
      return;
    }
    response.writeHead(200, {
      'Content-Type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(path).pipe(response);
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  console.log(`ARGOS rodando em http://${shown}:${PORT}`);
});
