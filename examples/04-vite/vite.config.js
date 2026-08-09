import { defineConfig } from 'vite';

/**
 * The only Vite-specific thing this library needs: the two isolation headers.
 *
 * Without them `crossOriginIsolated` is false, `SharedArrayBuffer` is unavailable, and the
 * synchronous API cannot work (the async API still does). They have to be set on the dev server
 * *and* on whatever serves the production build — Vite's `preview` is covered here, but your
 * real host needs the same two headers configured.
 */
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  server: { headers: isolation },
  preview: { headers: isolation },

  // Vite pre-bundles dependencies for dev, which rewrites the `new URL('./workers/…', import.meta.url)`
  // the library uses to find its workers. Excluding it keeps those URLs intact.
  optimizeDeps: { exclude: ['@componentor/fs'] },
});
