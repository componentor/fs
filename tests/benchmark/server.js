/**
 * Simple HTTP server with COOP/COEP headers for crossOriginIsolated testing
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '../../dist');
const benchDir = __dirname;
const noCoep = process.argv.includes('--no-coep');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  // Enable COOP/COEP for crossOriginIsolated (unless --no-coep)
  if (!noCoep) {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  let filePath;
  const url = req.url.split('?')[0];

  if (url === '/' || url === '/index.html') {
    filePath = path.join(benchDir, 'index.html');
  } else if (url.startsWith('/dist/') || url === '/index.js' || url === '/kernel.js') {
    // Map shorthand URLs to dist files
    const fileName = url === '/index.js' ? 'index.js'
      : url === '/kernel.js' ? 'kernel.js'
      : url.replace('/dist/', '');
    filePath = path.join(distDir, fileName);
  } else {
    // Try benchmark directory first, then dist
    const benchPath = path.join(benchDir, url);
    const distPath = path.join(distDir, url);

    if (fs.existsSync(benchPath)) {
      filePath = benchPath;
    } else if (fs.existsSync(distPath)) {
      filePath = distPath;
    } else {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (err) {
    res.writeHead(404);
    res.end(`File not found: ${filePath}`);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Benchmark server running at http://localhost:${PORT}`);
  console.log(noCoep
    ? `COOP/COEP headers DISABLED — sync API will not work, promises-only mode`
    : `COOP/COEP headers enabled for crossOriginIsolated`);
});
