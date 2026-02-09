import { defineConfig } from 'tsup';

const jsExtension = () => ({ js: '.js' });

const shared = {
  format: ['esm'] as const,
  outExtension: jsExtension,
  splitting: false,
  sourcemap: true,
  minify: false,
  // Pre-bundled Buffer polyfill (buffer npm package inlined, no bare specifiers)
  inject: ['./buffer-shim-bundled.js'],
  // Bundle Node.js polyfill packages (not left as bare specifiers)
  noExternal: ['buffer', 'base64-js', 'ieee754', 'events'],
  // Browser platform prevents auto-externalization of Node.js builtins
  platform: 'browser' as const,
  esbuildOptions(options: any) {
    // Mark node: protocol imports as external (they're type-only)
    options.external = ['node:fs', 'node:path', 'node:buffer', 'node:stream', 'node:events', 'node:util'];
  },
};

export default defineConfig([
  // Main entry point — bundles all non-worker code
  {
    ...shared,
    entry: ['src/fs.polyfill.ts'],
    outDir: '../dist/future',
  },
  // Workers — each bundled separately
  {
    ...shared,
    entry: [
      'src/fs.sync.worker.ts',
      'src/fs.async.worker.ts',
      'src/fs.relay.worker.ts',
      'src/fs.service.worker.ts',
    ],
    outDir: '../dist/future',
  },
  // VFS OPFS sync worker (in vfs/ subdir, but outputs to same dir as main)
  {
    ...shared,
    entry: ['src/vfs/opfs-sync.worker.ts'],
    outDir: '../dist/future',
  },
]);
