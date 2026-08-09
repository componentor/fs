# Examples

Four starting points, smallest first. Each one runs as-is against your working copy — no
install, no bundler — except the Vite example, which is deliberately a real project.

```bash
npm run build                       # from the repo root, once
node examples/serve.js 01-quickstart
```

Then open <http://localhost:5173>. Pass a different directory name to run a different example,
and a second argument to change the port:

```bash
node examples/serve.js 02-files-and-streams
node examples/serve.js 03-worker-hosted 8080
```

| Example | What it shows |
|---|---|
| [01-quickstart](01-quickstart/) | Mounting a volume; the sync API and the promises API side by side |
| [02-files-and-streams](02-files-and-streams/) | Descriptors, `FileHandle`, read/write streams, `readLines`, `cp -r`, `glob` |
| [03-worker-hosted](03-worker-hosted/) | Running the instance in a worker so the **sync API works in every tab**, Safari included |
| [04-vite](04-vite/) | The same thing as a real project: `npm install`, bare imports, bundler config |

## The one piece of setup you cannot skip

The synchronous API is built on `SharedArrayBuffer`, and browsers only expose that to pages that
are **cross-origin isolated**. That takes two response headers on the page and everything it
loads:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`examples/serve.js` sets them, and [04-vite/vite.config.js](04-vite/vite.config.js) shows the
equivalent for a dev server. Your production host needs them too.

Without them nothing crashes — `crossOriginIsolated` is simply `false`, and the **async** API
(`fs.promises.*`) keeps working normally. Only `fs.readFileSync` and friends are unavailable.
Every example checks the flag and says so rather than failing obscurely.

## Reading the example source

The static examples resolve the library through an import map:

```html
<script type="importmap">
  { "imports": { "@componentor/fs": "/vendor/index.js" } }
</script>
```

That exists only so the examples can run against this repo's `dist/` with no install step. In
your own project, `npm install @componentor/fs` and delete the import map — the
`import { VFSFileSystem } from '@componentor/fs'` lines are already correct.

Import maps are not inherited by module workers, so [03-worker-hosted](03-worker-hosted/) uses a
plain URL on both sides instead. With a bundler that distinction disappears.

## Where to go next

- Storage modes (`hybrid` / `vfs` / `opfs`), and what each costs — [readme](../readme.md#filesystem-modes)
- Multi-tab and the service worker — [readme](../readme.md#service-worker-setup-multi-tab)
- Known divergences from Node — [readme](../readme.md#known-divergences-from-node)

## Keeping them working

The examples are covered by [examples.spec.ts](../tests/benchmark/examples.spec.ts), which loads
each one in a real browser and fails if it errors or does not reach its final line:

```bash
npx playwright test examples --project=chromium
```
