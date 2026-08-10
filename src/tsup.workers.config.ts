import { defineConfig } from 'tsup';

/**
 * Stage 2: the workers the main thread starts, plus the service worker.
 *
 * `sync-relay` imports `inlined/opfs-sync.workertext` (stage 1's output) as a string, so the
 * text loader has to be registered here too.
 */
export default defineConfig({
  entry: [
    'src/workers/sync-relay.worker.ts',
    'src/workers/async-relay.worker.ts',
    'src/workers/service.worker.ts',
    'src/workers/repair.worker.ts',
  ],
  outDir: '../dist/workers',
  format: ['esm'],
  outExtension: () => ({ js: '.js' }),
  splitting: false,
  sourcemap: true,
  minify: false,
  esbuildOptions(options) {
    options.loader = { ...options.loader, '.workertext': 'text' };
  },
});
