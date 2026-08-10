/**
 * Starting a worker from source held in the bundle, rather than from a URL beside it.
 *
 * Workers used to be located with `new URL('./workers/x.worker.js', import.meta.url)`. That reads
 * as the obvious thing to do, and it breaks in the two situations people actually hit first:
 *
 *   • **Loaded from a CDN.** `new Worker()` on a cross-origin URL is a `SecurityError`, full stop.
 *     So `import { VFSFileSystem } from 'https://esm.sh/@componentor/fs'` could never start —
 *     the one way to try a browser library without installing anything.
 *   • **Bundlers that pre-bundle dependencies.** Vite rewrites that `new URL(...)` during dep
 *     optimisation and the workers stop resolving, which is why the package needed an
 *     `optimizeDeps.exclude` entry to work at all.
 *
 * Each worker is bundled to a standalone script at build time and embedded here as a string
 * (see `scripts/build.mjs`), so a worker is a same-origin blob no matter where the library was
 * loaded from, and there is no URL for a bundler to rewrite.
 *
 * The cost is bundle size — the worker bundles are minified specifically to hold that down.
 * The service worker is deliberately *not* handled this way: service workers must be registered
 * from a real same-origin URL, because their scope is derived from the script's path.
 */

/** Object URLs held per worker so they can be released when the worker is terminated. */
const objectUrls = new WeakMap<Worker, string>();

/**
 * Build a module worker from bundled source.
 *
 * `type: 'module'` matches what these workers were always started as, so this changes where the
 * code comes from and nothing about how it runs.
 */
export function workerFromSource(source: string, name?: string): Worker {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    const worker = new Worker(url, { type: 'module', name });
    objectUrls.set(worker, url);
    return worker;
  } catch (err) {
    // Nothing will reference the URL if construction threw.
    URL.revokeObjectURL(url);
    throw err;
  }
}

/**
 * Terminate a worker and release its object URL.
 *
 * The URL is deliberately not revoked straight after `new Worker()`: the spec does not guarantee
 * the script has been fetched by then, and revoking early has historically raced in WebKit.
 * Holding it until terminate costs one string per live worker.
 */
export function terminateWorker(worker: Worker | null | undefined): void {
  if (!worker) return;
  try { worker.terminate(); } catch { /* already gone */ }
  const url = objectUrls.get(worker);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrls.delete(worker);
  }
}
