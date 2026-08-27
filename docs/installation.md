# Installation

Every way to install and load the library — npm with any bundler, and from a CDN with no build step at all.

← Back to the [readme](../readme.md).

---

## Installation

Two ways in. Both give you the identical library — the difference is only whether you have a
build step.

### With npm

For any bundler or framework — Vite, webpack, Next.js, Rollup, esbuild:

```bash
npm install @componentor/fs
```

```typescript
import { VFSFileSystem } from '@componentor/fs';
```

**No bundler configuration is needed.** The worker bundles are embedded in the package, so there
is nothing to resolve, copy or host — verified against `vite dev` and `vite build` with a config
containing nothing but the isolation headers. TypeScript types are included.

The same package is also published as [`sync-opfs`](https://www.npmjs.com/package/sync-opfs) if
you prefer that name: `npm install sync-opfs`.

### From a CDN, with no build step

Nothing to install. Works in a plain `.html` file:

```html
<script type="module">
  import { VFSFileSystem } from 'https://esm.sh/@componentor/fs';

  const fs = new VFSFileSystem({ root: '/my-app' });
  await fs.init();

  await fs.promises.writeFile('/hello.txt', 'Hello from a CDN');
  console.log(await fs.promises.readFile('/hello.txt', 'utf8'));
</script>
```

This works because the workers are embedded and started as same-origin blobs. Loading a browser
filesystem from a CDN used to be impossible — a cross-origin `new Worker()` is a `SecurityError`
— which is why versions before 4.0 could not be tried this way. Any CDN that serves ESM with CORS
works; [esm.sh](https://esm.sh), [jsDelivr](https://www.jsdelivr.com) and
[unpkg](https://unpkg.com) all do.

If you would rather write bare specifiers without a bundler, use an import map:

```html
<script type="importmap">
  { "imports": { "@componentor/fs": "https://esm.sh/@componentor/fs" } }
</script>
<script type="module">
  import { VFSFileSystem } from '@componentor/fs';
</script>
```

> **Remember the two headers.** From a CDN you are usually on a static host, which means no
> `crossOriginIsolated` and therefore **no sync API** — the async API above works regardless. See
> [COOP/COEP Headers](./coop-coep.md#coopcoep-headers), including a service-worker workaround that gets the sync
> API working on GitHub Pages.
