# @componentor/fs

[![npm version](https://img.shields.io/npm/v/@componentor/fs.svg)](https://www.npmjs.com/package/@componentor/fs)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)
[![types: included](https://img.shields.io/badge/types-included-blue.svg)](#)

**A real, synchronous `fs` for the browser — backed by persistent storage, safe across tabs.**

`@componentor/fs` is a Node.js `fs` polyfill that gives you a *true* synchronous API
(`readFileSync`, `writeFileSync`, …) on top of real, persistent storage — not an in-memory
shim. It pairs a custom binary virtual filesystem (VFS) with SharedArrayBuffer + Atomics for
blocking sync calls, mirrors every change to real OPFS files so external tools can see them, and
coordinates multiple tabs with a leader/follower model and automatic failover.

If you've wanted `import fs from 'fs'` to *just work* in the browser — for isomorphic-git, a web
IDE, an in-browser bundler, or any Node-shaped tooling — that's the gap this fills. ~90 `fs`
methods are implemented across the sync, `promises`, callback, stream, and file-descriptor APIs.

```typescript
import { VFSFileSystem } from '@componentor/fs';

const fs = new VFSFileSystem();

// Sync API (requires crossOriginIsolated — blocks until ready on first call)
fs.writeFileSync('/hello.txt', 'Hello World!');
const data = fs.readFileSync('/hello.txt', 'utf8');

// Async API (always available)
await fs.promises.writeFile('/async.txt', 'Async data');
const content = await fs.promises.readFile('/async.txt', 'utf8');
```

## Features

- **True sync API** — blocking `readFileSync`/`writeFileSync`/… via SharedArrayBuffer + Atomics, not callbacks pretending to be sync.
- **Async API too** — `fs.promises.*` works everywhere, even without COOP/COEP headers.
- **Broad `fs` coverage** — ~90 methods: streams, file descriptors (`open`/`read`/`writev`), `watch`, `glob`, `cp`, `mkdtemp`, `realpath`, `statfs`, bigint stats, and more.
- **Real persistence** — a compact binary VFS (`.vfs.bin`) in OPFS, plus an optional bidirectional mirror to real OPFS files DevTools and other tools can see.
- **Multi-tab safe** — leader/follower architecture with automatic failover via `navigator.locks`; works on Safari (incl. worker-hosted followers).
- **External-change aware** — a `FileSystemObserver` syncs outside OPFS edits back into the VFS (Chrome 129+).
- **isomorphic-git ready** — battle-tested against real git operations.
- **Zero config** — workers are inlined at build time; no separate worker files to host.
- **TypeScript-first** — complete type definitions included.

## Installation

```bash
npm install @componentor/fs
```

## Quick Start

```typescript
import { VFSFileSystem } from '@componentor/fs';

const fs = new VFSFileSystem({ root: '/my-app' });

// Option 1: Sync API (blocks on first call until VFS is ready)
fs.mkdirSync('/my-app/src', { recursive: true });
fs.writeFileSync('/my-app/src/index.js', 'console.log("Hello!");');
const code = fs.readFileSync('/my-app/src/index.js', 'utf8');

// Option 2: Async init (non-blocking)
await fs.init(); // wait for VFS to be ready
const files = await fs.promises.readdir('/my-app/src');
const stats = await fs.promises.stat('/my-app/src/index.js');
```

### Convenience Helpers

```typescript
import { createFS, getDefaultFS, init } from '@componentor/fs';

// Create with config
const fs = createFS({ root: '/repo', debug: true });

// Lazy singleton (created on first access)
const defaultFs = getDefaultFS();

// Async init helper
await init(); // initializes the default singleton
```

## Configuration

```typescript
const fs = new VFSFileSystem({
  root: '/',              // OPFS root directory (default: '/')
  mode: 'hybrid',        // 'hybrid' | 'vfs' | 'opfs' (default: 'hybrid')
  opfsSyncRoot: undefined, // Custom OPFS root for mirroring (default: same as root)
  uid: 0,                 // User ID for file ownership (default: 0)
  gid: 0,                 // Group ID for file ownership (default: 0)
  umask: 0o022,           // File creation mask (default: 0o022)
  strictPermissions: false, // Enforce Unix permissions (default: false)
  sabSize: 4194304,       // SharedArrayBuffer size in bytes (default: 4MB)
  debug: false,           // Per-op timing logs (caller roundTrip + relay handleRequest) (default: false)
  forceSpin: undefined,   // Override the WebKit-only sync workarounds (spin/yield/slice + pre-grow).
                          // undefined = auto (on only for WebKit); true/false force on/off — an
                          // A/B escape hatch. You should not need this; see "Performance" below.
  swUrl: undefined,       // URL of the service worker script (default: auto-resolved)
  swScope: undefined,     // Custom service worker scope (default: auto-scoped per root)
  swBridge: undefined,    // MessagePort to a main-thread service-worker bridge, for
                          // running this instance inside a worker (enables follower
                          // sync on Safari). See "Multi-Tab Sync on Safari" below.
  limits: {               // Upper bounds for VFS validation (prevents corrupt data from causing OOM)
    maxInodes: 4_000_000,   // Max inode count (default: 4M)
    maxBlocks: 4_000_000,   // Max data blocks (default: 4M)
    maxPathTable: 256 * 1024 * 1024, // Max path table bytes (default: 256MB)
    maxVFSSize: 100 * 1024 * 1024 * 1024, // Max .vfs.bin size (default: 100GB)
    maxPayload: 2 * 1024 * 1024 * 1024,   // Max single SAB payload (default: 2GB)
  },
});
```

### Filesystem Modes

The `mode` option controls how the filesystem stores data:

| Mode | Storage | OPFS Sync | Speed | Resilience |
|------|---------|-----------|-------|------------|
| `hybrid` (default) | VFS binary + OPFS mirror | Bidirectional | Fast | High |
| `vfs` | VFS binary only | None | Fastest | Medium |
| `opfs` | Real OPFS files only | N/A | Slower | Highest |

```typescript
// Hybrid mode (default) — best of both worlds
const fs = new VFSFileSystem({ mode: 'hybrid' });
fs.writeFileSync('/file.txt', 'data');
// → stored in .vfs.bin AND mirrored to real OPFS files

// VFS-only mode — maximum performance, no OPFS mirroring
const fastFs = new VFSFileSystem({ mode: 'vfs' });

// OPFS-only mode — no VFS binary, operates directly on OPFS files
const safeFs = new VFSFileSystem({ mode: 'opfs' });
```

**Hybrid mode** mirrors all VFS mutations to real OPFS files in the background:

- **VFS → OPFS**: Every write, delete, mkdir, rename is replicated *after* the sync operation responds, so it never adds latency to an individual call. Bursts to the same path are coalesced.
- **OPFS → VFS**: A `FileSystemObserver` watches for external changes and syncs them back (Chrome 129+).

This lets external tools (browser DevTools, OPFS extensions) see and modify files while VFS handles all the fast read/write operations internally.

#### Choosing a mode (performance)

The mirror is the main performance knob. It persists every change a second time as a real OPFS file, and on Safari each of those writes opens a fresh sync-access handle, which is comparatively slow. Reads never touch the mirror, so they're fast in every mode.

- **`vfs`** (VFS binary only) — fastest writes; data is still fully persistent in `.vfs.bin`. Choose this when you don't need other tools to see individual files.
- **`hybrid`** (default) — adds the real-OPFS mirror so DevTools/extensions/other code can read your files. Expect writes to cost roughly ~2× `vfs` (more on Safari) in exchange; read speed is unaffected.
- **`opfs`** — no VFS binary; operates directly on OPFS files. Highest external compatibility, slowest.

A good rule of thumb: use `vfs` for pure app storage, `hybrid` when real OPFS visibility matters. You can switch at runtime with `setMode()`.

#### Sync-relay spinning (WebKit-gated)

The sync-relay leader loop carries three latency workarounds — a post-response busy-poll spin, a starvation-timer race in its event-loop yield, and a sliced response-consume wait — that exist **only** to defeat WebKit/Safari's lost cross-thread `Atomics.notify` and its main-thread-brokered `MessagePort` delivery (a sync caller busy-spinning the page's main thread starves both). On Chromium and Firefox those wakes are reliable, so the workarounds are pure overhead; on a core-constrained device (e.g. an Android phone — few cores, big.LITTLE, thermal/background-thread throttling) the relay worker's spinning can contend for a CPU with the spinning leader thread and slow every op.

Since **3.2.8** the spinning is gated to WebKit by user-agent detection, so Chromium/Firefox (desktop *and* mobile) take a quiet park-on-`Atomics.wait` path automatically — no configuration needed. A runtime escape hatch lets you override the detection for A/B testing, set **inside the sync-relay worker scope** before it begins dispatching:

```js
// In the sync-relay worker (e.g. injected at worker bootstrap):
self.__fs_force_spin = false; // force the quiet path (skip all spinning)
self.__fs_force_spin = true;  // force the WebKit spinning path everywhere
// unset (default) → auto-detect: spin only on WebKit
```

#### Corruption Fallback

In `hybrid` mode, if VFS corruption is detected during initialization, the filesystem automatically falls back to `opfs` mode. The `init()` call rejects with an error describing the corruption, but all filesystem operations continue working via OPFS:

```typescript
const fs = new VFSFileSystem(); // hybrid mode

try {
  await fs.init();
} catch (err) {
  // VFS was corrupt — system is now running in OPFS mode
  console.warn(err.message); // "Falling back to OPFS mode: <reason>"
  console.log(fs.mode);      // 'opfs'
}

// Filesystem still works — reads/writes go through OPFS
fs.writeFileSync('/file.txt', 'still works!');
```

#### Runtime Mode Switching

Use `setMode()` to switch modes at runtime. This is useful for IDE workflows where you want to recover from corruption:

```typescript
// Corruption detected, currently in OPFS fallback mode
console.log(fs.mode); // 'opfs'

// Repair the VFS binary
await repairVFS('/my-app');

// Switch back to hybrid mode
await fs.setMode('hybrid');
console.log(fs.mode); // 'hybrid'
```

`setMode()` terminates internal workers, allocates fresh shared memory, and reinitializes the filesystem in the requested mode.

### Service Worker Setup (Multi-Tab)

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
```

If you only use a single tab, the service worker is not needed — the tab always runs as the leader.

### Multi-Tab Sync on Safari (worker-hosted instances)

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

## COOP/COEP Headers

To enable the sync API, your page must be `crossOriginIsolated`. Add these headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without these headers, only the async (`promises`) API is available.

### Vite

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
```

### Express

```javascript
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});
```

### Vercel

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
      ]
    }
  ]
}
```

### Runtime Check

```typescript
if (crossOriginIsolated) {
  // Sync + async APIs available
  fs.writeFileSync('/fast.txt', 'blazing fast');
} else {
  // Async API only
  await fs.promises.writeFile('/fast.txt', 'still fast');
}
```

## Benchmarks

Versus LightningFS (IndexedDB-based), in Chrome with `crossOriginIsolated` enabled, hybrid mode:

| Operation | LightningFS | VFS Sync | VFS Promises |
|-----------|------------|----------|-------------|
| Write 100 × 1KB | 46ms | **12ms** | 23ms |
| Write 100 × 4KB | 36ms | **13ms** | 22ms |
| Read 100 × 1KB | 19ms | **2ms** | 14ms |
| Read 100 × 4KB | 62ms | **2ms** | 13ms |
| Large 10 × 1MB | 11ms | **10ms** | 17ms |
| Batch write 500 × 256B | 138ms | **50ms** | 75ms |
| Batch read 500 × 256B | 73ms | **7ms** | 91ms |

**Takeaways:**
- **Reads are 9–28× faster** — the binary VFS format avoids per-entry IndexedDB/OPFS overhead, and the sync path (SharedArrayBuffer + Atomics) has no async overhead.
- **Writes are ~3–4× faster** here, and faster still in `vfs` mode where the OPFS mirror is off.

**Reading these honestly:** numbers vary by browser and warm/cold state — measure your own workload. In-memory libraries like `memfs` will beat this on raw ops (no persistence to do), so the fair comparison is against other *persistent* browser filesystems. Writes are the work; reads are essentially free. On Safari, writes cost more because of slower OPFS sync-access handles (see [mode selection](#choosing-a-mode-performance)).

Run the suite yourself:

```bash
npm run benchmark:open
```

## API Reference

### Sync API (requires crossOriginIsolated)

```typescript
// Read/Write
fs.readFileSync(path, options?): Uint8Array | string
fs.writeFileSync(path, data, options?): void
fs.appendFileSync(path, data): void

// Directories
fs.mkdirSync(path, options?): void
fs.rmdirSync(path, options?): void
fs.rmSync(path, options?): void
fs.readdirSync(path, options?): string[] | Dirent[]

// File Operations
fs.unlinkSync(path): void
fs.renameSync(oldPath, newPath): void
fs.copyFileSync(src, dest, mode?): void
fs.truncateSync(path, len?): void
fs.symlinkSync(target, path): void
fs.readlinkSync(path): string
fs.linkSync(existingPath, newPath): void

// Info
fs.statSync(path): Stats
fs.lstatSync(path): Stats
fs.existsSync(path): boolean
fs.accessSync(path, mode?): void
fs.realpathSync(path): string

// Metadata
fs.chmodSync(path, mode): void
fs.chownSync(path, uid, gid): void
fs.utimesSync(path, atime, mtime): void

// File Descriptors
fs.openSync(path, flags?, mode?): number
fs.closeSync(fd): void
fs.readSync(fd, buffer, offset?, length?, position?): number
fs.writeSync(fd, buffer, offset?, length?, position?): number
fs.fstatSync(fd): Stats
fs.ftruncateSync(fd, len?): void
fs.fdatasyncSync(fd): void

// Temp / Flush
fs.mkdtempSync(prefix): string
fs.flushSync(): void
```

### Async API (always available)

```typescript
// Read/Write
fs.promises.readFile(path, options?): Promise<Uint8Array | string>
fs.promises.writeFile(path, data, options?): Promise<void>
fs.promises.appendFile(path, data): Promise<void>

// Directories
fs.promises.mkdir(path, options?): Promise<void>
fs.promises.rmdir(path, options?): Promise<void>
fs.promises.rm(path, options?): Promise<void>
fs.promises.readdir(path, options?): Promise<string[] | Dirent[]>

// File Operations
fs.promises.unlink(path): Promise<void>
fs.promises.rename(oldPath, newPath): Promise<void>
fs.promises.copyFile(src, dest, mode?): Promise<void>
fs.promises.truncate(path, len?): Promise<void>
fs.promises.symlink(target, path): Promise<void>
fs.promises.readlink(path): Promise<string>
fs.promises.link(existingPath, newPath): Promise<void>

// Info
fs.promises.stat(path): Promise<Stats>
fs.promises.lstat(path): Promise<Stats>
fs.promises.exists(path): Promise<boolean>
fs.promises.access(path, mode?): Promise<void>
fs.promises.realpath(path): Promise<string>

// Metadata
fs.promises.chmod(path, mode): Promise<void>
fs.promises.chown(path, uid, gid): Promise<void>
fs.promises.utimes(path, atime, mtime): Promise<void>

// Advanced
fs.promises.open(path, flags?, mode?): Promise<FileHandle>
fs.promises.opendir(path): Promise<Dir>
fs.promises.mkdtemp(prefix): Promise<string>

// Flush
fs.promises.flush(): Promise<void>
```

### Streams API

```typescript
// Readable stream (Web Streams API)
const stream = fs.createReadStream('/large-file.bin', {
  start: 0,           // byte offset to start
  end: 1024,          // byte offset to stop
  highWaterMark: 64 * 1024, // chunk size (default: 64KB)
});
for await (const chunk of stream) {
  console.log('Read chunk:', chunk.length, 'bytes');
}

// Writable stream
const writable = fs.createWriteStream('/output.bin');
const writer = writable.getWriter();
await writer.write(new Uint8Array([1, 2, 3]));
await writer.close();
```

### Instance Methods

```typescript
// Get the current filesystem mode
fs.mode: 'hybrid' | 'vfs' | 'opfs'

// Switch mode at runtime (terminates workers, reinitializes)
await fs.setMode('hybrid' | 'vfs' | 'opfs'): Promise<void>

// Non-blocking async init (waits for VFS to be ready)
await fs.init(): Promise<void>

// Moment-in-time readiness: true only when ready AND no leader transition is
// in flight (equivalent to isReady && !transitioning)
fs.ready: boolean

// Await readiness reliably, INCLUDING through an in-flight leader promotion.
// Resolves immediately if already ready; otherwise resolves on the next time
// the sync-relay signals 'ready'. Use this to coordinate with another
// navigator.locks-based leader election running independently of the FS:
await fs.whenReady(): Promise<void>
```

The `fs.ready` / `fs.whenReady()` pair exists because the FS elects its own
multi-tab leader via `navigator.locks`. When the leader tab dies and this tab is
promoted, there's a window where the new sync-relay worker isn't looping yet —
issuing a sync op then stalls until the worker's heartbeat watchdog fires. If
your app also does its own leader election, await `fs.whenReady()` *after*
acquiring your own lock to be sure the FS has finished any promotion first:

```typescript
navigator.locks.request('my-app-leader', async () => {
  await fs.whenReady();      // FS promotion (if any) has completed
  fs.writeFileSync('/state.json', data); // safe — won't stall the relay worker
  await new Promise(() => {}); // hold the lock
});
```

### Watch API

```typescript
// Watch for changes (supports recursive + AbortSignal)
const ac = new AbortController();
const watcher = fs.watch('/dir', { recursive: true, signal: ac.signal }, (eventType, filename) => {
  console.log(eventType, filename); // 'rename' 'newfile.txt' or 'change' 'file.txt'
});
watcher.close(); // or ac.abort()

// Watch specific file with stat polling
fs.watchFile('/file.txt', { interval: 1000 }, (curr, prev) => {
  console.log('File changed:', curr.mtimeMs !== prev.mtimeMs);
});
fs.unwatchFile('/file.txt');

// Async iterable (promises API)
for await (const event of fs.promises.watch('/dir', { recursive: true })) {
  console.log(event.eventType, event.filename);
}
```

### Path Utilities

```typescript
import { path } from '@componentor/fs';

path.join('/foo', 'bar', 'baz')       // '/foo/bar/baz'
path.resolve('foo', 'bar')            // '/foo/bar'
path.dirname('/foo/bar/baz.txt')      // '/foo/bar'
path.basename('/foo/bar/baz.txt')     // 'baz.txt'
path.extname('/foo/bar/baz.txt')      // '.txt'
path.normalize('/foo//bar/../baz')    // '/foo/baz'
path.isAbsolute('/foo')               // true
path.relative('/foo/bar', '/foo/baz') // '../baz'
path.parse('/foo/bar/baz.txt')        // { root, dir, base, ext, name }
path.format({ dir: '/foo', name: 'bar', ext: '.txt' }) // '/foo/bar.txt'
```

### Constants

```typescript
import { constants } from '@componentor/fs';

constants.F_OK  // 0 - File exists
constants.R_OK  // 4 - File is readable
constants.W_OK  // 2 - File is writable
constants.X_OK  // 1 - File is executable

constants.COPYFILE_EXCL  // 1 - Fail if dest exists

constants.O_RDONLY   // 0
constants.O_WRONLY   // 1
constants.O_RDWR     // 2
constants.O_CREAT    // 64
constants.O_EXCL     // 128
constants.O_TRUNC    // 512
constants.O_APPEND   // 1024
```

## Maintenance Helpers

Standalone utilities for VFS maintenance, recovery, and migration. Must be called from a Worker context (sync access handle requirement). Close any running `VFSFileSystem` instance first.

```typescript
import { unpackToOPFS, loadFromOPFS, repairVFS } from '@componentor/fs';

// Export VFS contents to real OPFS files (clears existing OPFS files first)
const { files, directories } = await unpackToOPFS('/my-app');

// Rebuild VFS from real OPFS files (deletes .vfs.bin, creates fresh VFS)
const { files, directories } = await loadFromOPFS('/my-app');

// Attempt to recover files from a corrupt VFS binary
const { recovered, lost, entries } = await repairVFS('/my-app');
console.log(`Recovered ${recovered} entries, lost ${lost}`);
for (const entry of entries) {
  console.log(`  ${entry.type} ${entry.path} (${entry.size} bytes)`);
}
```

| Function | Description |
|----------|-------------|
| `unpackToOPFS(root?)` | Read all files from VFS, write to real OPFS paths |
| `loadFromOPFS(root?)` | Read all OPFS files, create fresh VFS with their contents |
| `repairVFS(root?)` | Scan corrupt `.vfs.bin` for recoverable inodes, rebuild fresh VFS |

## isomorphic-git Integration

```typescript
import { VFSFileSystem } from '@componentor/fs';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';

const fs = new VFSFileSystem({ root: '/repo' });

// Clone a repository
await git.clone({
  fs,
  http,
  dir: '/repo',
  url: 'https://github.com/user/repo',
  corsProxy: 'https://cors.isomorphic-git.org',
});

// Check status
const status = await git.statusMatrix({ fs, dir: '/repo' });

// Stage and commit
await git.add({ fs, dir: '/repo', filepath: '.' });
await git.commit({
  fs,
  dir: '/repo',
  message: 'Initial commit',
  author: { name: 'User', email: 'user@example.com' },
});
```

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Main Thread                              │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │   Sync API   │  │  Async API   │  │    Path / Constants    │  │
│  │ readFileSync │  │  promises.   │  │ join, dirname, etc.    │  │
│  │writeFileSync │  │  readFile    │  └────────────────────────┘  │
│  └──────┬───────┘  └──────┬───────┘                              │
│         │                 │                                      │
│   SAB + Atomics     postMessage                                  │
└─────────┼─────────────────┼──────────────────────────────────────┘
          │                 │
          ▼                 ▼
┌──────────────────────────────────────────────────────────────────┐
│               sync-relay Worker (Leader)                         │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                     VFS Engine                             │  │
│  │  ┌──────────────────┐  ┌─────────────┐  ┌──────────────┐   │  │
│  │  │  VFS Binary File │  │  Inode/Path │  │  Block Data  │   │  │
│  │  │  (.vfs.bin OPFS) │  │    Table    │  │   Region     │   │  │
│  │  └──────────────────┘  └─────────────┘  └──────────────┘   │  │
│  └────────────────────────────────────────────────────────────┘  │
│                            │                                     │
│                    notifyOPFSSync()                              │
│                     (fire & forget)                              │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    opfs-sync Worker                              │
│  ┌────────────────────┐  ┌────────────────────────────────────┐  │
│  │  VFS → OPFS Mirror │  │  FileSystemObserver (OPFS → VFS)   │  │
│  │  (queue + echo     │  │  External changes detected and     │  │
│  │   suppression)     │  │  synced back to VFS engine         │  │
│  └────────────────────┘  └────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘

Multi-tab (via Service Worker + navigator.locks):
  Tab 1 (Leader) ←→ Service Worker ←→ Tab 2 (Follower)
  Tab 1 holds VFS engine, Tab 2 forwards requests via MessagePort
  If Tab 1 dies, Tab 2 auto-promotes to leader
```

## Browser Support

| Browser | Sync API | Async API |
|---------|----------|-----------|
| Chrome / Edge 102+ | Yes | Yes |
| Firefox 114+ | Yes | Yes |
| Safari 16.4+ | Yes* | Yes |
| Opera 88+ | Yes | Yes |

The sync API needs `SharedArrayBuffer`, which requires a `crossOriginIsolated` page (COOP/COEP headers — see above). The async API (`fs.promises.*`) works everywhere without those headers. (Firefox needs 114+ for the module workers this library uses — enabled by default since then; older 111–113 required the `dom.workers.modules.enabled` flag.)

\* Safari supports the sync API for single-tab and leader tabs. In multi-tab mode, a *follower* tab can only do sync I/O when its instance runs inside a worker — a main-thread follower on Safari is a fundamental WebKit limitation. See [Multi-Tab Sync on Safari](#multi-tab-sync-on-safari-worker-hosted-instances) and [SAFARI-SYNC-LIMITATIONS.md](./SAFARI-SYNC-LIMITATIONS.md).

**Works out of the box — no per-browser tuning.** The library auto-detects the engine and only enables WebKit-specific workarounds on WebKit; everywhere else it takes the fast path. You don't set any flags for this. See Performance below for what those workarounds are and the one override (`forceSpin`) if you ever need it.

## Performance

The sync hot path is a `SharedArrayBuffer` request/response to a relay worker that owns the OPFS handle. On **Chromium, Firefox and (importantly) mobile Chrome/Android** the library runs the lean path: a parked `Atomics.wait`, and **on-demand file growth**. On **WebKit/Safari** it additionally enables a set of workarounds for one underlying fact — *MessagePort delivery and size-changing OPFS calls (`truncate` / extending `write`) are brokered through the page's main thread, which a spinning sync caller blocks.* Those WebKit-only workarounds are:

- **Dispatch-loop tweaks** — a post-response busy-poll, a starvation-timer yield, and a 5 ms-sliced response wait (defeat WebKit's lost cross-thread `Atomics.notify`).
- **Idle/init pre-growth** — a 64 MB free-tail headroom grown at idle, so writes never have to grow *in-request* (which would deadlock against the spinning caller on WebKit).

All of these are **gated behind a UA check (`IS_WEBKIT`) and run only on WebKit.** On Chromium/Gecko they are pure overhead — and on core-constrained mobile (few cores, big.LITTLE, slow flash) the pre-growth `truncate` in particular noticeably stalled the dispatch loop, so leaving it on everywhere regressed Android sync throughput badly (≈10×). Gating it restores full speed on Android while keeping Safari correct.

**Override:** `forceSpin: true | false` (or the runtime global `self.__fs_force_spin` in the relay worker) forces all of the above on or off regardless of UA — purely for A/B testing on a specific device. Default (`undefined`) is auto, which is what you want.

**Mode and write cost:** the OPFS **mirror** (`mode: 'hybrid'`, the default) writes every change to real OPFS files for interop; it's the main *write*-cost knob (reads are unaffected). If nothing reads the real OPFS files directly, `mode: 'vfs'` skips the mirror for the fastest writes. See [Filesystem Modes](#filesystem-modes).

## Troubleshooting

### "SharedArrayBuffer is not defined"

Your page is not `crossOriginIsolated`. Add COOP/COEP headers (see above). The async API still works without them.

### "Sync API requires crossOriginIsolated"

Same issue — sync methods (`readFileSync`, etc.) need `SharedArrayBuffer`. Use `fs.promises.*` as a fallback.

### "Atomics.wait cannot be called in this context"

`Atomics.wait` only works in Workers. The library handles this internally — if you see this error, you're likely calling sync methods from the main thread without proper COOP/COEP headers.

### Files not visible in OPFS DevTools

Make sure `opfsSync` is enabled (it's `true` by default). Files are mirrored to OPFS in the background after each VFS operation. Check DevTools > Application > Storage > OPFS.

### External OPFS changes not detected

`FileSystemObserver` requires Chrome 129+. The VFS instance must be running (observer is set up during init). Changes to files outside the configured `root` directory won't be detected.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full version history.

## Contributing

```bash
git clone https://github.com/componentor/fs
cd fs
npm install
npm run build           # Build the library
npm test                # Run the unit suite (700+ tests)
npm run benchmark:open  # Run benchmarks in a real browser
```

Cross-browser correctness and OPFS-mirror end-to-end specs run under Playwright in `tests/benchmark/*.spec.ts` (Chromium, Firefox, WebKit).

## License

MIT
