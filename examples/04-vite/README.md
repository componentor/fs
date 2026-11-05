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

**No bundler configuration.** The worker bundles are embedded in the package, so there is
nothing for Vite to resolve or rewrite — this used to need an `optimizeDeps.exclude` entry, and
no longer does. Verified against both `vite dev` and `vite build`.

**The service worker, if you need multiple tabs.** Service workers must be served as a real file
at a URL whose scope covers your app, which a bundled chunk is not. The simplest way is to import
the shipped file as an asset URL (`&no-inline`, because a 1 KB file would otherwise be inlined as a
`data:` URL, which cannot be registered):

```js
import swUrl from '@componentor/fs/sw?url&no-inline';
const fs = new VFSFileSystem({ swUrl });
```

Or copy it into `public/` and point the instance at it (re-copy after upgrading):

```bash
cp node_modules/@componentor/fs/dist/workers/service.worker.js public/vfs-service-worker.js
```

```js
const fs = new VFSFileSystem({ swUrl: '/vfs-service-worker.js' });
```

A single-tab app does not need this — that tab is always the leader.
