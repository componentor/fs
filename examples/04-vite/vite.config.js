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

  // No `optimizeDeps.exclude` needed. Until 4.0 the library located its workers with
  // `new URL('./workers/…', import.meta.url)`, which Vite's dependency pre-bundling rewrote,
  // and the workers stopped resolving. The worker bundles are embedded in the package now, so
  // there is no URL left to rewrite — dev and build both work with no configuration at all.
});
