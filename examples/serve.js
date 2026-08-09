/**
 * Static server for the examples, with the two headers this library needs.
 *
 * `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`
 * are what make `crossOriginIsolated` true, which is what makes `SharedArrayBuffer` available,
 * which is what makes the **synchronous** API possible. Serve the same files without them and
 * `fs.readFileSync` cannot work — the async API still will. This is a property of the page, not
 * of the library, so it is the one piece of setup no package can do for you.
 *
 *   node examples/serve.js 01-quickstart
 *   node examples/serve.js 03-worker-hosted 8080
 *
 * `/vendor/` is mapped to the repo's built `dist/`, so the examples run against your working
 * copy with no install step. In your own project you would `npm install @componentor/fs` and
 * delete the import map — see examples/README.md.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const example = process.argv[2] ?? '01-quickstart';
const port = Number(process.argv[3] ?? 5173);

const exampleDir = path.join(__dirname, example);
const distDir = path.join(__dirname, '..', 'dist');

if (!fs.existsSync(exampleDir)) {
  console.error(`No such example: ${example}`);
  console.error(`Available: ${fs.readdirSync(__dirname).filter((d) => /^\d/.test(d)).join(', ')}`);
  process.exit(1);
}
if (!fs.existsSync(path.join(distDir, 'index.js'))) {
  console.error('dist/ is not built yet — run `npm run build` in the repo root first.');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
};

http
  .createServer((req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

    const url = decodeURIComponent(req.url.split('?')[0]);
    const rel = url === '/' ? '/index.html' : url;

    // `/vendor/*` serves the built library; everything else comes from the example.
    const target = rel.startsWith('/vendor/')
      ? path.join(distDir, rel.slice('/vendor/'.length))
      : path.join(exampleDir, rel);

    // Refuse to serve outside the two roots we intend to expose.
    const allowed = [exampleDir, distDir].some((root) => target.startsWith(root + path.sep));
    if (!allowed || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found: ' + rel);
      return;
    }

    res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(target));
  })
  .listen(port, () => {
    console.log(`\n  ${example} → http://localhost:${port}`);
    console.log('  COOP/COEP enabled, so the sync API is available.\n');
  });
