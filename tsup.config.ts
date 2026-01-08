import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    treeshake: true,
    minify: false,
  },
  {
    entry: ['src/worker/kernel.ts'],
    format: ['esm'],
    outDir: 'dist',
    splitting: false,
    sourcemap: true,
    minify: false,
  },
]);
