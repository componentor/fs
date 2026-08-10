import { defineConfig } from 'vitest/config';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Load `.workertext` files as strings rather than executing them.
 *
 * The worker bundles are embedded into the entries as source text (see `scripts/build.mjs`);
 * esbuild does that with its `text` loader during the real build, but Vite has no idea what the
 * extension means and will happily try to run the file as a module — which fails with
 * `self is not defined`, because it is worker code.
 *
 * A missing file is not an error here: the embedded copies are build artifacts, so a clean
 * checkout can run `npm test` without building first. The stub only throws if something actually
 * tries to start a worker from it, which these suites never do — they drive the engine in-process
 * through `tests/helpers/engine-transport.ts`.
 */
function workerText() {
  return {
    name: 'workertext',
    enforce: 'pre' as const,
    load(id: string) {
      if (!id.endsWith('.workertext')) return null;
      const path = id.split('?')[0];
      const source = existsSync(path)
        ? readFileSync(path, 'utf8')
        : 'throw new Error("worker source not embedded — run `npm run build` first");';
      return `export default ${JSON.stringify(source)};`;
    },
  };
}

export default defineConfig({
  plugins: [workerText()],
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
  },
});
