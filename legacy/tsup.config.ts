import { defineConfig } from 'tsup'

export default defineConfig([
  // Main library
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'es2022',
    outDir: 'dist',
    splitting: false,
    treeshake: true
  },
  // Worker script (separate bundle)
  {
    entry: ['src/opfs-worker.ts'],
    format: ['esm'],
    dts: false,
    clean: false,
    sourcemap: true,
    target: 'es2022',
    outDir: 'dist',
    splitting: false,
    treeshake: true,
    // Bundle everything into the worker
    noExternal: [/.*/]
  },
  // Worker proxy (for main thread)
  {
    entry: ['src/opfs-worker-proxy.ts'],
    format: ['esm'],
    dts: true,
    clean: false,
    sourcemap: true,
    target: 'es2022',
    outDir: 'dist',
    splitting: false,
    treeshake: true
  },
  // Hybrid (routes read/write to different backends)
  {
    entry: ['src/opfs-hybrid.ts'],
    format: ['esm'],
    dts: true,
    clean: false,
    sourcemap: true,
    target: 'es2022',
    outDir: 'dist',
    splitting: false,
    treeshake: true
  }
])
