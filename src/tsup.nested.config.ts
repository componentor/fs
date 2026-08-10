import { defineConfig } from 'tsup';

/**
 * Stage 1: the nested worker only.
 *
 * `opfs-sync` is started by the sync relay rather than by the main thread, so its bundled text
 * has to exist before the relay is built. See scripts/build.mjs.
 */
export default defineConfig({
  entry: ['src/workers/opfs-sync.worker.ts'],
  outDir: '../dist/workers',
  format: ['esm'],
  outExtension: () => ({ js: '.js' }),
  splitting: false,
  sourcemap: true,
  minify: false,
});
