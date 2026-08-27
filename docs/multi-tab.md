# Multiple tabs, and Safari

Sharing one filesystem across tabs: the service-worker broker that makes it work, and what Safari needs.

← Back to the [readme](../readme.md).

---

## Service Worker Setup (Multi-Tab)

Multi-tab coordination requires a service worker that acts as a MessagePort broker between tabs. The built service worker is shipped at `dist/workers/service.worker.js`. Unlike regular workers (which are resolved by the bundler), **service workers must be served as a real file at a public URL**.

Most bundlers (Vite, webpack) handle `new URL('./workers/service.worker.js', import.meta.url)` automatically, but if the default resolution doesn't work in your setup, use the `swUrl` option:

```typescript
const fs = new VFSFileSystem({
  swUrl: '/vfs-service-worker.js', // your public URL
});
```

**Vite example** — copy the file to `public/`:

```bash
cp node_modules/@componentor/fs/dist/workers/service.worker.js public/vfs-service-worker.js
```

```typescript
const fs = new VFSFileSystem({ swUrl: '/vfs-service-worker.js' });

// Relative paths resolve against the page, so an app served from a subpath works too:
//   https://example.github.io/my-app/  →  .../my-app/vfs-service-worker.js
const fs = new VFSFileSystem({ swUrl: './vfs-service-worker.js' });
```

If you only use a single tab, the service worker is not needed — the tab always runs as the leader.

## Synchronous calls on Safari need a worker

`Atomics.wait` is illegal on a page's main thread, so a sync call busy-spins instead. On Chromium
and Firefox the relay worker progresses regardless and calls finish in milliseconds. **On WebKit
the spinning page starves the worker's continuations**, the reply never arrives, and the call sits
until the 30-second stall guard fires — measured on this project's own demo, where roughly half of
all Safari loads took 30.2s to boot until the instance was moved into a worker.

This is not limited to `opfs` mode or to follower tabs: it hits a leader in the default `hybrid`
mode too. Run the instance inside a worker on Safari — `Atomics.wait` is legal there and the
page's main thread stays free. [examples/03-worker-hosted](../examples/03-worker-hosted/) is that
arrangement, and so is the [live demo](https://componentor.github.io/fs/).

## Multi-Tab Sync on Safari (worker-hosted instances)

In secondary ("follower") tabs, a synchronous FS call relays to the leader tab.
On **Chrome, Edge and Firefox** this works from the main thread. On **Safari it
does not** — and cannot, by the platform's design: a follower's sync call must
busy-wait the calling thread, and WebKit gates a worker's message delivery on
the parent page's main thread, so while the main thread spins the leader's reply
can never arrive. (A follower's main-thread sync op therefore fails fast with
`EIO` on Safari; the **async** API — `fs.promises.*` — works cross-tab on Safari
without any of this.)

The fix is to run the VFS instance **inside a worker**, where the wait becomes a
real `Atomics.wait` and the main thread stays free. Because `navigator.serviceWorker`
is not exposed in worker scopes on Safari/Firefox, the multi-tab broker is
delegated to the main thread with `createServiceWorkerBridge`:

```typescript
// ---- main thread (per tab) ----
import { createServiceWorkerBridge } from '@componentor/fs';

const worker = new Worker('/my-fs-worker.js', { type: 'module' });
const channel = new MessageChannel();
// ns is `vfs-${root}` with every non-alphanumeric char replaced by `_`
createServiceWorkerBridge(channel.port1, { ns: 'vfs-_my_app' });
worker.postMessage({ swBridge: channel.port2 }, [channel.port2]);

// ---- inside /my-fs-worker.js ----
import { VFSFileSystem } from '@componentor/fs';

let fs;
self.onmessage = async (e) => {
  if (e.data.swBridge) {
    fs = new VFSFileSystem({ root: '/my-app', swBridge: e.data.swBridge });
    await fs.init();
    // fs.readFileSync(...) / fs.writeFileSync(...) now work in EVERY tab,
    // Safari included — leader or follower.
  }
};
```

`swBridge` is fully optional and backward compatible: when omitted, the
initialization path is unchanged and the instance uses `navigator.serviceWorker`
directly (correct on the main thread and in Chrome workers).

**Why a worker (and what's actually limited).** The fast part of the sync path —
a relay worker writing the result into a `SharedArrayBuffer` that the caller
reads synchronously — works on Safari and is unchanged; it's how single-tab /
leader `readFileSync` returns synchronously. What Safari can't do is deliver the
*leader's cross-tab reply* to a follower's relay worker while that tab's **main
thread** busy-spins. Running the caller in a worker uses `Atomics.wait` instead
of a spin, so the main thread stays free to pump that delivery — same fast SAB
transfer, just worker→worker. The only thing impossible on Safari is calling a
**follower's** `readFileSync` from the **main thread**; an instance in a worker
has no such limit, and the leader tab is unaffected either way.

**Try it.** `tests/benchmark/multitab-demo.html` is a runnable two-tab demo
(open it in multiple Safari tabs). The benchmark page (`npm run benchmark:open`)
has a **"Run in worker"** checkbox that runs the whole suite through this path,
which is what makes it produce results in secondary Safari tabs.
