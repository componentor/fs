/**
 * The package must work when it is loaded from a different origin — i.e. from a CDN.
 *
 * It could not, for the whole of its life before 4.0. Workers were located with
 * `new URL('./workers/…', import.meta.url)`, and `new Worker()` on a cross-origin URL is a
 * `SecurityError` with no workaround available to the caller. So the single lowest-friction way
 * to try a browser library —
 *
 *     import { VFSFileSystem } from 'https://esm.sh/@componentor/fs'
 *
 * — failed at construction, and the failure looked like the library was broken rather than like a
 * packaging problem. The worker bundles are embedded as text now and started as same-origin
 * blobs, which is what this spec pins.
 *
 * The setup is the real thing, not a simulation: a second HTTP server on a different port (a
 * different origin by definition) serves `dist/`, while the page itself comes from the benchmark
 * server. `Cross-Origin-Resource-Policy: cross-origin` is set on the library server because the
 * page is COEP `require-corp` — that is what a CDN has to send too, and esm.sh does.
 *
 * Run: npx playwright test cross-origin-load --project=chromium
 */
import { test, expect } from './fixtures';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
const PORT = 3457;

const MIME: Record<string, string> = {
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.map': 'application/json',
};

let server: http.Server;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    const file = path.join(distDir, url);
    // Exactly the headers a CDN serving to a cross-origin-isolated page must send.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (!file.startsWith(distDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('the library loaded from another origin starts its workers and works', async ({ page }) => {
  test.setTimeout(120_000);

  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/correctness.html');

  const result = await page.evaluate(async (port) => {
    const origin = `http://localhost:${port}`;
    const mod: any = await import(/* @vite-ignore */ `${origin}/index.js`);

    // Prove the module really did come from the other origin, so a same-origin fallback
    // could not make this pass by accident.
    const sameOrigin = origin === location.origin;

    const fsInstance = new mod.VFSFileSystem({ root: '/cross-origin-test' });
    await fsInstance.init();
    try { await fsInstance.promises.rm('/', { recursive: true, force: true }); } catch { /* fresh */ }

    // The async path (async-relay worker).
    await fsInstance.promises.mkdir('/d', { recursive: true });
    await fsInstance.promises.writeFile('/d/async.txt', 'from the async relay');
    const asyncRead = await fsInstance.promises.readFile('/d/async.txt', 'utf8');

    // The sync path (sync-relay worker + SharedArrayBuffer). This is the one that proves the
    // blob worker really is running, since a sync call is answered by the relay.
    let syncRead: string | null = null;
    if ((globalThis as any).crossOriginIsolated) {
      fsInstance.writeFileSync('/d/sync.txt', 'from the sync relay');
      syncRead = fsInstance.readFileSync('/d/sync.txt', 'utf8') as string;
    }

    const listing = (await fsInstance.promises.readdir('/d')).sort();
    await fsInstance.dispose();

    return { sameOrigin, isolated: (globalThis as any).crossOriginIsolated, asyncRead, syncRead, listing };
  }, PORT);

  expect(result.sameOrigin, 'the test must actually be cross-origin').toBe(false);
  expect(result.asyncRead).toBe('from the async relay');
  expect(result.listing).toEqual(['async.txt', 'sync.txt']);

  // The page is served cross-origin isolated, so the sync API must have run too.
  expect(result.isolated).toBe(true);
  expect(result.syncRead).toBe('from the sync relay');

  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

test('the URL-based approach this replaced still fails, so the test above is not vacuous', async ({ page }) => {
  await page.goto('/correctness.html');

  const outcome = await page.evaluate(async (port) => {
    // Precisely what `spawnWorker` used to do once `import.meta.url` pointed at another origin.
    try {
      new Worker(`http://localhost:${port}/workers/sync-relay.worker.js`, { type: 'module' });
      return 'constructed';
    } catch (e) {
      return (e as Error).name;
    }
  }, PORT);

  // If this ever starts returning 'constructed', the browser rule changed and the embedding is
  // no longer load-bearing — worth knowing before someone removes it.
  expect(outcome).toBe('SecurityError');
});
