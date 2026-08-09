# Vite example

A real project rather than a served file, so it shows the parts a bundler is responsible for.

```bash
npm install
npm run dev
```

Three things matter here, and they are the three that catch people out:

**The isolation headers.** [vite.config.js](vite.config.js) sets `Cross-Origin-Opener-Policy` and
`Cross-Origin-Embedder-Policy` on both `server` and `preview`. Without them `crossOriginIsolated`
is `false` and the synchronous API is unavailable — the promises API still works. Whatever hosts
your production build needs the same two headers; a static host that cannot set headers cannot
serve the sync API.

**`optimizeDeps.exclude`.** The library locates its workers with
`new URL('./workers/…​.worker.js', import.meta.url)`. Vite's dependency pre-bundling rewrites
those URLs and the workers stop resolving, so the package is excluded from it.

**The service worker, if you need multiple tabs.** Service workers must be served as a real file
at a URL whose scope covers your app, which a bundled chunk is not. Copy it into `public/` and
point the instance at it:

```bash
cp node_modules/@componentor/fs/dist/workers/service.worker.js public/vfs-service-worker.js
```

```js
const fs = new VFSFileSystem({ swUrl: '/vfs-service-worker.js' });
```

A single-tab app does not need this — that tab is always the leader.
