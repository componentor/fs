import { defineConfig } from 'tsup';

/**
 * Stage 3: the public entries, with the worker bundles embedded as text.
 *
 * Run `npm run build` (scripts/build.mjs) rather than `tsup` directly — the `.workertext` files
 * this imports are produced by the earlier stages.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/drives-entry.ts'],
  outDir: '../dist',
  format: ['esm'],
  outExtension: () => ({ js: '.js' }),
  dts: true,
  splitting: false,
  sourcemap: true,
  treeshake: true,
  minify: false,
  esbuildOptions(options) {
    options.loader = { ...options.loader, '.workertext': 'text' };
  },
});
