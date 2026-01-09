# @componentor/fs

**Battle-tested OPFS-based Node.js `fs` polyfill with sync and async APIs**

A high-performance browser filesystem with native OPFS backend and synchronous API support.

```typescript
import { fs } from '@componentor/fs';

// Sync API (requires crossOriginIsolated)
fs.writeFileSync('/hello.txt', 'Hello World!');
const data = fs.readFileSync('/hello.txt', 'utf8');

// Async API (always available)
await fs.promises.writeFile('/async.txt', 'Async data');
const content = await fs.promises.readFile('/async.txt', 'utf8');
```

## Features

- **Node.js Compatible** - Drop-in replacement for `fs` module
- **Sync API** - `readFileSync`, `writeFileSync`, etc. (requires COOP/COEP)
- **Async API** - `promises.readFile`, `promises.writeFile`, etc.
- **Cross-tab Safe** - Uses `navigator.locks` for multi-tab coordination
- **isomorphic-git Ready** - Full compatibility with git operations
- **Zero Config** - Works out of the box, no worker files needed
- **TypeScript First** - Complete type definitions included

## Installation

```bash
npm install @componentor/fs
```

## Quick Start

```typescript
import { fs, path } from '@componentor/fs';

// Create a directory
await fs.promises.mkdir('/projects/my-app', { recursive: true });

// Write a file
await fs.promises.writeFile('/projects/my-app/index.js', 'console.log("Hello!");');

// Read a file
const code = await fs.promises.readFile('/projects/my-app/index.js', 'utf8');
console.log(code); // 'console.log("Hello!");'

// List directory contents
const files = await fs.promises.readdir('/projects/my-app');
console.log(files); // ['index.js']

// Get file stats
const stats = await fs.promises.stat('/projects/my-app/index.js');
console.log(stats.size); // 23

// Use path utilities
console.log(path.join('/projects', 'my-app', 'src')); // '/projects/my-app/src'
console.log(path.dirname('/projects/my-app/index.js')); // '/projects/my-app'
console.log(path.basename('/projects/my-app/index.js')); // 'index.js'
```

## Performance Tiers

@componentor/fs operates in two performance tiers based on browser capabilities:

### Tier 1: Sync (Fastest)

**Requirements:** `crossOriginIsolated` context (COOP/COEP headers)

Uses `SharedArrayBuffer` + `Atomics` for zero-copy data transfer between main thread and worker. Enables **synchronous** filesystem operations.

```typescript
// Tier 1 unlocks sync APIs
fs.writeFileSync('/file.txt', 'data');
const data = fs.readFileSync('/file.txt', 'utf8');
fs.mkdirSync('/dir', { recursive: true });
fs.existsSync('/file.txt'); // true
```

### Tier 2: Async (Always Available)

Works in any browser context without special headers. Uses Web Worker with `postMessage` for async operations.

```typescript
// Tier 2 - promises API always works
await fs.promises.writeFile('/file.txt', 'data');
const data = await fs.promises.readFile('/file.txt', 'utf8');
await fs.promises.mkdir('/dir', { recursive: true });
await fs.promises.exists('/file.txt'); // true
```

## COOP/COEP Headers (Required for Tier 1)

To enable Tier 1 (sync) performance, your server must send these headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

### Vite Configuration

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

### Express/Node.js

```javascript
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});
```

### Vercel

```json
// vercel.json
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

### Check if Tier 1 is Available

```typescript
if (crossOriginIsolated) {
  console.log('Tier 1 (sync) available!');
  fs.writeFileSync('/fast.txt', 'blazing fast');
} else {
  console.log('Tier 2 (async) only');
  await fs.promises.writeFile('/fast.txt', 'still fast');
}
```

## Benchmarks

Tested against LightningFS (IndexedDB-based filesystem) in Chrome with Tier 1 enabled:

| Operation | @componentor/fs | LightningFS | Winner |
|-----------|-----------------|-------------|--------|
| Write 100 x 1KB | 131ms (763 ops/s) | 317ms (316 ops/s) | **OPFS 2.4x** |
| Write 100 x 4KB | 145ms (690 ops/s) | 49ms (2061 ops/s) | LightningFS |
| Read 100 x 1KB | 11ms (9170 ops/s) | 17ms (5824 ops/s) | **OPFS 1.6x** |
| Read 100 x 4KB | 10ms (10493 ops/s) | 16ms (6431 ops/s) | **OPFS 1.6x** |
| Large 10 x 1MB | 19ms (538 ops/s) | 11ms (910 ops/s) | LightningFS |
| Batch Write 500 | 416ms (1202 ops/s) | 125ms (4014 ops/s) | LightningFS |
| Batch Read 500 | 311ms (1608 ops/s) | 74ms (6736 ops/s) | LightningFS |
| **Git Clone** | 427ms | 1325ms | **OPFS 3.1x** |
| Git Status 10x | 53ms | 39ms | LightningFS |

**Key takeaways:**
- **Git clone is 2-3x faster** - the most important real-world operation
- **Reads are 1.6x faster** - OPFS excels at read operations
- **Small writes (1KB) are 2.4x faster** - great for config files and metadata
- LightningFS wins on batch operations and larger sequential writes

*Results from Chrome 120+ with crossOriginIsolated enabled. Performance varies by browser and hardware.*

Run benchmarks yourself:

```bash
npm run benchmark:open
```

## API Reference

### Sync API (Tier 1 Only)

```typescript
// Read/Write
fs.readFileSync(path: string, options?: { encoding?: string }): Uint8Array | string
fs.writeFileSync(path: string, data: Uint8Array | string, options?: { flush?: boolean }): void
fs.appendFileSync(path: string, data: Uint8Array | string): void

// Directories
fs.mkdirSync(path: string, options?: { recursive?: boolean }): void
fs.rmdirSync(path: string, options?: { recursive?: boolean }): void
fs.readdirSync(path: string): string[]

// File Operations
fs.unlinkSync(path: string): void
fs.renameSync(oldPath: string, newPath: string): void
fs.copyFileSync(src: string, dest: string): void
fs.truncateSync(path: string, len?: number): void

// Info
fs.statSync(path: string): Stats
fs.existsSync(path: string): boolean
fs.accessSync(path: string, mode?: number): void
```

### Async API (Always Available)

```typescript
// Read/Write
fs.promises.readFile(path: string, options?: ReadOptions): Promise<Uint8Array | string>
fs.promises.writeFile(path: string, data: Uint8Array | string, options?: WriteOptions): Promise<void>
fs.promises.appendFile(path: string, data: Uint8Array | string): Promise<void>

// Directories
fs.promises.mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
fs.promises.rmdir(path: string, options?: { recursive?: boolean }): Promise<void>
fs.promises.readdir(path: string, options?: { withFileTypes?: boolean }): Promise<string[] | Dirent[]>

// File Operations
fs.promises.unlink(path: string): Promise<void>
fs.promises.rename(oldPath: string, newPath: string): Promise<void>
fs.promises.copyFile(src: string, dest: string): Promise<void>
fs.promises.truncate(path: string, len?: number): Promise<void>
fs.promises.rm(path: string, options?: { recursive?: boolean, force?: boolean }): Promise<void>

// Info
fs.promises.stat(path: string): Promise<Stats>
fs.promises.lstat(path: string): Promise<Stats>
fs.promises.exists(path: string): Promise<boolean>
fs.promises.access(path: string, mode?: number): Promise<void>
fs.promises.realpath(path: string): Promise<string>

// Advanced
fs.promises.open(path: string, flags?: string, mode?: number): Promise<FileHandle>
fs.promises.opendir(path: string): Promise<Dir>
fs.promises.mkdtemp(prefix: string): Promise<string>
fs.promises.symlink(target: string, path: string): Promise<void>
fs.promises.readlink(path: string): Promise<string>
fs.promises.link(existingPath: string, newPath: string): Promise<void>

// Cache Management
fs.promises.flush(): Promise<void>   // Flush pending writes
fs.promises.purge(): Promise<void>   // Clear all caches
```

### Path Utilities

```typescript
import { path } from '@componentor/fs';

path.join('/foo', 'bar', 'baz')     // '/foo/bar/baz'
path.resolve('foo', 'bar')          // '/foo/bar'
path.dirname('/foo/bar/baz.txt')    // '/foo/bar'
path.basename('/foo/bar/baz.txt')   // 'baz.txt'
path.extname('/foo/bar/baz.txt')    // '.txt'
path.normalize('/foo//bar/../baz')  // '/foo/baz'
path.isAbsolute('/foo')             // true
path.relative('/foo/bar', '/foo/baz') // '../baz'
path.parse('/foo/bar/baz.txt')      // { root, dir, base, ext, name }
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

@componentor/fs works seamlessly with isomorphic-git:

```typescript
import { fs } from '@componentor/fs';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';

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
┌─────────────────────────────────────────────────────────────┐
│                      Main Thread                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Sync API  │  │  Async API  │  │    Path Utilities   │ │
│  │ readFileSync│  │  promises.  │  │ join, dirname, etc. │ │
│  │writeFileSync│  │  readFile   │  └─────────────────────┘ │
│  └──────┬──────┘  └──────┬──────┘                          │
│         │                │                                   │
│         │ Atomics.wait   │ postMessage                      │
│         │ (Tier 1)       │ (Tier 2)                         │
└─────────┼────────────────┼──────────────────────────────────┘
          │                │
          ▼                ▼
┌─────────────────────────────────────────────────────────────┐
│                      Web Worker                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                   OPFS Kernel                          │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │ │
│  │  │ Sync Handle  │  │  Directory   │  │  navigator  │  │ │
│  │  │    Cache     │  │    Cache     │  │    .locks   │  │ │
│  │  │  (100 max)   │  │              │  │ (cross-tab) │  │ │
│  │  └──────────────┘  └──────────────┘  └─────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                            │                                 │
└────────────────────────────┼─────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                         OPFS                                 │
│            Origin Private File System                        │
│              (Browser Storage API)                           │
└─────────────────────────────────────────────────────────────┘
```

## Feature Comparison

### API Compatibility

| Feature | Node.js fs | @componentor/fs v2 | @componentor/fs v1 | LightningFS |
|---------|------------|--------------------|--------------------|-------------|
| `readFile` | ✅ | ✅ | ✅ | ✅ |
| `writeFile` | ✅ | ✅ | ✅ | ✅ |
| `readFileSync` | ✅ | ✅ Tier 1 | ❌ | ❌ |
| `writeFileSync` | ✅ | ✅ Tier 1 | ❌ | ❌ |
| `mkdir` / `mkdirSync` | ✅ | ✅ | ✅ | ✅ |
| `readdir` / `readdirSync` | ✅ | ✅ | ✅ | ✅ |
| `stat` / `statSync` | ✅ | ✅ | ✅ | ✅ |
| `unlink` / `unlinkSync` | ✅ | ✅ | ✅ | ✅ |
| `rename` / `renameSync` | ✅ | ✅ | ✅ | ✅ |
| `rm` (recursive) | ✅ | ✅ | ✅ | ❌ |
| `copyFile` | ✅ | ✅ | ✅ | ❌ |
| `symlink` / `readlink` | ✅ | ✅ | ✅ | ✅ |
| `watch` / `watchFile` | ✅ | ✅ | ❌ | ❌ |
| `open` / `FileHandle` | ✅ | ✅ | ❌ | ❌ |
| `opendir` / `Dir` | ✅ | ✅ | ❌ | ❌ |
| `mkdtemp` | ✅ | ✅ | ❌ | ❌ |
| Streams | ✅ | ❌ | ❌ | ❌ |

### Performance Tiers

| Capability | Tier 1 Sync | Tier 1 Promises | Tier 2 | Legacy v1 | LightningFS |
|------------|-------------|-----------------|--------|-----------|-------------|
| **Sync API** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Async API** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Requires COOP/COEP** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **SharedArrayBuffer** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Handle Caching** | ✅ | ✅ | ❌ | ❌ | N/A |
| **Zero-copy Transfer** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Cross-tab Safety** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Storage Backend** | OPFS | OPFS | OPFS | OPFS | IndexedDB |

### Architecture Comparison

| Aspect | @componentor/fs v2 | @componentor/fs v1 | LightningFS |
|--------|--------------------|--------------------|-------------|
| **Storage** | OPFS (native FS) | OPFS | IndexedDB |
| **Worker** | Dedicated kernel | Shared worker | None |
| **Sync Method** | Atomics.wait | N/A | N/A |
| **Handle Strategy** | Cached (100 max) | Per-operation | N/A |
| **Locking** | navigator.locks | navigator.locks | None |
| **Bundle Size** | ~16KB | ~12KB | ~25KB |
| **TypeScript** | Full | Full | Partial |

## Browser Support

| Browser | Tier 1 (Sync) | Tier 2 (Async) |
|---------|---------------|----------------|
| Chrome 102+ | Yes | Yes |
| Edge 102+ | Yes | Yes |
| Firefox 111+ | Yes* | Yes |
| Safari 15.2+ | No** | Yes |
| Opera 88+ | Yes | Yes |

\* Firefox requires `dom.workers.modules.enabled` flag
\** Safari doesn't support `createSyncAccessHandle` in workers

## Troubleshooting

### "SharedArrayBuffer is not defined"

Your page is not crossOriginIsolated. Add COOP/COEP headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

### "Atomics.wait cannot be called in this context"

`Atomics.wait` can only be called from a Worker. The library handles this automatically - use the async API on the main thread.

### "NotAllowedError: Access handle is already open"

Another tab or operation has the file open. The library uses `navigator.locks` to prevent this, but if you're using multiple filesystem instances, ensure they coordinate.

### Slow Performance

1. Check if Tier 1 is enabled: `console.log(crossOriginIsolated)`
2. Use batch operations when possible
3. Disable flush for bulk writes: `{ flush: false }`
4. Call `fs.promises.flush()` after bulk operations

## Changelog

### v2.0.7 (2025)

**High-Performance Handle Caching with `readwrite-unsafe`:**
- Uses `readwrite-unsafe` mode (Chrome 121+) - no exclusive locks
- Zero per-operation overhead: cache lookup is a single Map.get()
- Browser extensions can access files while handles are cached
- LRU eviction when cache exceeds 100 handles
- Falls back to 100ms debounced release on older browsers (handles block)

### v2.0.2 (2025)

**Improvements:**
- Sync access handles now auto-release after idle timeout
- Allows external tools (like OPFS Chrome extension) to access files when idle
- Maintains full performance during active operations

### v2.0.1 (2025)

**Bug Fixes:**
- Fixed mtime not updating correctly when files are modified
- `stat()` now always returns accurate `lastModified` from OPFS instead of approximation
- Ensures git status and other mtime-dependent operations work correctly

### v2.0.0 (2025)

**Major rewrite with sync API support and performance tiers.**

**New Features:**
- Synchronous API (`readFileSync`, `writeFileSync`, etc.) via Atomics
- Performance tiers (Tier 1 Sync, Tier 1 Promises, Tier 2)
- Dedicated worker kernel with handle caching (100 max)
- `watch()` and `watchFile()` for file change notifications
- `FileHandle` API (`fs.promises.open()`)
- `Dir` API (`fs.promises.opendir()`)
- `mkdtemp()` for temporary directories
- `flush()` and `purge()` for cache management
- Full `Dirent` support with `withFileTypes` option

**Performance:**
- 2-3x faster git clone vs LightningFS
- 1.6x faster reads
- Handle caching eliminates repeated open/close overhead
- Zero-copy data transfer with SharedArrayBuffer (Tier 1)

**Breaking Changes:**
- Requires `crossOriginIsolated` for Tier 1 (sync) features
- New architecture - not backwards compatible with v1 internals
- Minimum browser versions increased

### v1.2.8 (2024)

- Final release of v1 branch
- OPFS-based async filesystem
- Basic isomorphic-git compatibility
- Cross-tab locking with `navigator.locks`

### v1.0.0 (2024)

- Initial release
- Async-only OPFS filesystem
- Node.js `fs.promises` compatible API
- Basic directory and file operations

## Contributing

```bash
git clone https://github.com/componentor/fs
cd fs
npm install
npm run dev      # Watch mode
npm test         # Run tests
npm run benchmark:open  # Run benchmarks
```

## License

MIT
