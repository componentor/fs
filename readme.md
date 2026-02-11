# @componentor/fs

**High-performance OPFS-based Node.js `fs` polyfill for the browser**

A virtual filesystem powered by a custom binary format (VFS), SharedArrayBuffer + Atomics for true synchronous APIs, multi-tab coordination via Web Locks, and bidirectional OPFS mirroring.

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

- **True Sync API** — `readFileSync`, `writeFileSync`, etc. via SharedArrayBuffer + Atomics
- **Async API** — `promises.readFile`, `promises.writeFile` — works without COOP/COEP
- **VFS Binary Format** — All data in a single `.vfs.bin` file for maximum throughput
- **OPFS Sync** — Bidirectional mirror to real OPFS files (enabled by default)
- **Multi-tab Safe** — Leader/follower architecture with automatic failover via `navigator.locks`
- **FileSystemObserver** — External OPFS changes synced back to VFS automatically (Chrome 129+)
- **isomorphic-git Ready** — Full compatibility with git operations
- **Zero Config** — Workers inlined at build time, no external worker files needed
- **TypeScript First** — Complete type definitions included

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
  opfsSync: true,         // Mirror VFS to real OPFS files (default: true)
  opfsSyncRoot: undefined, // Custom OPFS root for mirroring (default: same as root)
  uid: 0,                 // User ID for file ownership (default: 0)
  gid: 0,                 // Group ID for file ownership (default: 0)
  umask: 0o022,           // File creation mask (default: 0o022)
  strictPermissions: false, // Enforce Unix permissions (default: false)
  sabSize: 4194304,       // SharedArrayBuffer size in bytes (default: 4MB)
  debug: false,           // Enable debug logging (default: false)
});
```

### OPFS Sync

When `opfsSync` is enabled (the default), VFS mutations are mirrored to real OPFS files in the background:

- **VFS → OPFS**: Every write, delete, mkdir, rename is replicated to real OPFS files after the sync operation completes (zero performance impact on the hot path)
- **OPFS → VFS**: A `FileSystemObserver` watches for external changes and syncs them back (Chrome 129+)

This allows external tools (browser DevTools, OPFS extensions) to see and modify files while VFS handles all the fast read/write operations internally.

```typescript
// OPFS sync enabled (default)
const fs = new VFSFileSystem({ opfsSync: true });
fs.writeFileSync('/file.txt', 'data');
// → /file.txt also appears in OPFS (visible in DevTools > Application > Storage)

// Disable for maximum performance (no OPFS mirroring)
const fastFs = new VFSFileSystem({ opfsSync: false });
```

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

Tested against LightningFS (IndexedDB-based) in Chrome with `crossOriginIsolated` enabled:

| Operation | LightningFS | VFS Sync | VFS Promises | Winner |
|-----------|------------|----------|-------------|--------|
| Write 100 x 1KB | 46ms | **12ms** | 23ms | **VFS 4x** |
| Write 100 x 4KB | 36ms | **13ms** | 22ms | **VFS 2.8x** |
| Read 100 x 1KB | 19ms | **2ms** | 14ms | **VFS 9x** |
| Read 100 x 4KB | 62ms | **2ms** | 13ms | **VFS 28x** |
| Large 10 x 1MB | 11ms | **10ms** | 17ms | **VFS 1.1x** |
| Batch Write 500 x 256B | 138ms | **50ms** | 75ms | **VFS 2.8x** |
| Batch Read 500 x 256B | 73ms | **7ms** | 91ms | **VFS 10x** |

**Key takeaways:**
- **Reads are 9-28x faster** — VFS binary format eliminates IndexedDB overhead
- **Writes are 2.8-4x faster** — Single binary file vs individual OPFS/IDB entries
- **Batch operations are 2.8-10x faster** — VFS excels at many small operations
- VFS Sync is the fastest path (SharedArrayBuffer + Atomics, zero async overhead)

Run benchmarks yourself:

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

### Watch API

```typescript
// Watch for changes
const watcher = fs.watch('/dir', { recursive: true }, (eventType, filename) => {
  console.log(eventType, filename); // 'change' 'file.txt'
});
watcher.close();

// Watch specific file with polling
fs.watchFile('/file.txt', { interval: 1000 }, (curr, prev) => {
  console.log('File changed:', curr.mtimeMs !== prev.mtimeMs);
});
fs.unwatchFile('/file.txt');
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
│  │  ┌──────────────────┐  ┌─────────────┐  ┌──────────────┐  │  │
│  │  │  VFS Binary File  │  │  Inode/Path │  │  Block Data  │  │  │
│  │  │  (.vfs.bin OPFS)  │  │    Table    │  │   Region     │  │  │
│  │  └──────────────────┘  └─────────────┘  └──────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                            │                                     │
│                    notifyOPFSSync()                               │
│                     (fire & forget)                               │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    opfs-sync Worker                               │
│  ┌────────────────────┐  ┌────────────────────────────────────┐  │
│  │  VFS → OPFS Mirror │  │  FileSystemObserver (OPFS → VFS)  │  │
│  │  (queue + echo     │  │  External changes detected and    │  │
│  │   suppression)     │  │  synced back to VFS engine        │  │
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
| Chrome 102+ | Yes | Yes |
| Edge 102+ | Yes | Yes |
| Firefox 111+ | Yes* | Yes |
| Safari 15.2+ | No** | Yes |
| Opera 88+ | Yes | Yes |

\* Firefox requires `dom.workers.modules.enabled` flag
\** Safari doesn't support `SharedArrayBuffer` in the required context

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

### v3.0.2 (2026)

**Bug Fixes:**
- Fix symlink resolution when resolved target path contains intermediate symlinks — `resolvePath` now falls back to component-by-component resolution instead of failing on direct lookup
- Add ELOOP depth tracking to `resolvePathComponents` to prevent infinite recursion on circular symlinks
- Mirror symlinks to OPFS as regular files (OPFS has no symlink concept) — reads through the symlink and writes the target's content

### v3.0.1 (2026)

**Bug Fixes:**
- Fix empty files (e.g. `.gitkeep`) not being mirrored to OPFS — both the sync-relay (skipped sending empty data) and opfs-sync worker (skipped writing 0-byte files) now handle empty files correctly

**Benchmark:**
- Add memfs (in-memory) to the benchmark suite for comparison

### v3.0.0 (2026)

**Complete architecture rewrite — VFS binary format with SharedArrayBuffer.**

**New Architecture:**
- VFS binary format — all data stored in a single `.vfs.bin` file (Superblock → Inode Table → Path Table → Bitmap → Data Region)
- SharedArrayBuffer + Atomics for true zero-overhead synchronous operations
- Multi-tab leader/follower architecture with automatic failover via `navigator.locks` + Service Worker
- Bidirectional OPFS sync — VFS mutations mirrored to real OPFS files, external changes synced back via `FileSystemObserver`
- Workers inlined as blob URLs at build time (zero config, no external worker files)
- Echo suppression for OPFS sync (prevents infinite sync loops)

**Performance:**
- 9-28x faster reads vs LightningFS
- 2.8-4x faster writes vs LightningFS
- 2.8-10x faster batch operations vs LightningFS
- Fire-and-forget OPFS sync — zero impact on hot path

**Breaking Changes:**
- New API: `new VFSFileSystem(config)` instead of default `fs` singleton
- `createFS(config)` and `getDefaultFS()` helpers available
- Requires `crossOriginIsolated` for sync API (async API works everywhere)
- Complete internal rewrite — not backwards compatible with v2 internals

### v2.0.0 (2025)

Major rewrite with sync API support via OPFS sync access handles and performance tiers.

### v1.0.0 (2024)

Initial release — async-only OPFS filesystem with `fs.promises` API.

## Contributing

```bash
git clone https://github.com/componentor/fs
cd fs
npm install
npm run build       # Build the library
npm test            # Run unit tests (77 tests)
npm run benchmark:open  # Run benchmarks in browser
```

## License

MIT
