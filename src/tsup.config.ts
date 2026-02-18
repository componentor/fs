import { defineConfig } from 'tsup';

const jsExtension = () => ({ js: '.js' });

export default defineConfig([
  {
    entry: ['src/index.ts'],
    outDir: '../dist',
    format: ['esm'],
    outExtension: jsExtension,
    dts: true,
    splitting: false,
    sourcemap: true,
    treeshake: true,
    minify: false,
  },
  {
    entry: [
      'src/workers/server.worker.ts',
      'src/workers/sync-relay.worker.ts',
      'src/workers/async-relay.worker.ts',
      'src/workers/service.worker.ts',
      'src/workers/opfs-sync.worker.ts',
      'src/workers/repair.worker.ts',
    ],
    outDir: '../dist/workers',
    format: ['esm'],
    outExtension: jsExtension,
    splitting: false,
    sourcemap: true,
    minify: false,
  },
]);
