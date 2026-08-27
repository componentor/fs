# API reference

Every method, across the sync, async, stream, `FileHandle`, watch, path and constants surfaces.

← Back to the [readme](../readme.md).

---

### Sync API (requires crossOriginIsolated)

```typescript
// Read/Write — `path` may also be a file descriptor (see below)
fs.readFileSync(path | fd, options?): Uint8Array | string
fs.writeFileSync(path | fd, data, options?): void
fs.appendFileSync(path | fd, data, options?): void   // { encoding?, mode?, flag?, flush? } | encoding

// Directories
fs.mkdirSync(path, options?): string | undefined   // options: { recursive?, mode? } | mode
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
// Read/Write — `path` may also be a FileHandle (not a raw descriptor; see below)
fs.promises.readFile(path | handle, options?): Promise<Uint8Array | string>
fs.promises.writeFile(path | handle, data, options?): Promise<void>
fs.promises.appendFile(path | handle, data, options?): Promise<void>

// Directories
fs.promises.mkdir(path, options?): Promise<string | undefined>  // { recursive?, mode? } | mode
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
fs.promises.opendir(path, options?): Promise<Dir>   // { recursive?, encoding?, bufferSize? }
fs.promises.mkdtemp(prefix): Promise<string>
fs.promises.statfs(path?): Promise<StatFs>
fs.promises.watch(path, options?): AsyncIterable<{ eventType, filename }>

// glob returns an ASYNC ITERATOR, as node's does — not a promise. Iterate it:
//   for await (const p of fs.promises.glob('/src/**/*.ts')) { … }
// The callback form gives you the whole array at once: fs.glob(pattern, (err, matches) => …)
fs.promises.glob(pattern, options?): AsyncIterator<string | Dirent>

// Flush
fs.promises.flush(): Promise<void>
```

> **Changed in 4.0:** `fs.promises.glob` used to return `Promise<string[]>`. It is an async
> iterator now, matching node — so `for await` works, and `await` no longer gives you an array.

#### `glob`'s `exclude` option

Both of node's forms work, and they do not share a contract:

```js
// Function — receives the entry's BASENAME (or a Dirent when withFileTypes is set)
fs.globSync('**/*', { exclude: (name) => name === 'node_modules' });

// Glob patterns — matched against the path RELATIVE TO cwd
fs.globSync('**/*', { exclude: ['**/*.test.ts', 'dist/**'] });
```

Excluding a **directory** prunes its whole subtree, so the first example drops `node_modules`
and everything under it. A trailing `**` needs at least one segment to match: `exclude: ['a/**']`
drops what is inside `a` but keeps `a` itself, while `exclude: ['a']` drops both — both verified
against `node:fs`.

### Streams API

`createReadStream` returns a Node-style readable — `.on('data')`, `.pipe()`, and `for await`,
which works because the stream implements `Symbol.asyncIterator` as node's does:

```typescript
const stream = fs.createReadStream('/large-file.bin', {
  start: 0,                 // byte offset to start
  end: 1024,                // byte offset to stop (inclusive, as in node)
  highWaterMark: 64 * 1024, // chunk size (default: 64KB)
});
for await (const chunk of stream) {
  console.log('Read chunk:', chunk.length, 'bytes');
}

// Writable — a node Writable, not a WHATWG WritableStream
const writable = fs.createWriteStream('/output.bin');
writable.write(new Uint8Array([1, 2, 3]));
writable.end();
await new Promise((resolve) => writable.on('finish', resolve));
```

Both accept an `fd` in the options, in which case the descriptor stays the caller's to close.

### FileHandle

`fs.promises.open()` returns a `FileHandle` with node's full API, including its stream methods:

```typescript
const handle = await fs.promises.open('/data.log', 'r');

for await (const line of handle.readLines()) { … }   // lines, CRLF-aware
handle.createReadStream(options?)                     // node Readable
handle.createWriteStream(options?)                    // node Writable
handle.readableWebStream()                            // WHATWG ReadableStream

handle.on('close', () => { … });                      // it is an EventEmitter
```

A stream created from a handle **owns** it: node closes the handle when the stream finishes, so
using it afterwards is `EBADF`. Pass `autoClose: false` to keep it open.

### Utf8Stream (buffered logging)

Node 24's `fs.Utf8Stream` — a buffered, append-only text stream. It batches writes instead of
issuing one write per line, which is what makes it usable as a logger.

```typescript
const log = new fs.Utf8Stream({ dest: '/app.log', minLength: 4096 });

log.write('started\n');          // buffered until 4 KB is pending
log.flushSync();                  // or force it out now
log.reopen('/app.1.log');         // log rotation: close, reopen elsewhere
log.end();                        // flush, close, then 'finish' and 'close'

log.on('drop', (chunk) => { … }); // fired when maxLength is exceeded
```

| Option | Default | |
|---|---|---|
| `dest` / `fd` | — | one is required; a supplied `fd` stays yours to close |
| `minLength` | `0` | buffer until this many bytes are pending |
| `maxLength` | `0` | drop writes past this, with a `drop` event; `0` is no limit |
| `append` | `true` | `false` truncates the file instead |
| `mkdir` | `false` | create the parent directory |
| `contentMode` | `'utf8'` | `'buffer'` accepts `Uint8Array` instead of strings |
| `fsync` | `false` | fsync after each flush |
| `periodicFlush` | `0` | flush every N ms |
| `mode` | — | mode for a file it creates |

Unlike node's, this one is a property of the instance (`fs.Utf8Stream`) rather than a free class,
because it writes through *this* filesystem.

### Instance Methods

```typescript
// Get the current filesystem mode
fs.mode: 'hybrid' | 'vfs' | 'opfs'

// Switch mode at runtime (terminates workers, reinitializes)
await fs.setMode('hybrid' | 'vfs' | 'opfs'): Promise<void>

// Non-blocking async init (waits for VFS to be ready)
await fs.init(): Promise<void>

// Release the instance: relay workers, the OPFS mirror worker, and the
// FileSystemObserver it registers on the origin's storage. The observer is the
// one resource that does NOT die with a page navigation on its own, so call
// this in anything that creates instances repeatedly (a test suite, an app that
// switches volumes). Instances also tear down on `pagehide` automatically.
// Named `dispose` because `close(fd)` is node's descriptor API.
await fs.dispose(): Promise<void>

// Which tab owns the volume. One holds the lock and does the work; the rest relay to it, so a
// follower's sync calls cost a round trip — worth knowing before comparing benchmarks, and
// before relying on main-thread sync calls in a follower on Safari.
fs.isLeader: boolean
fs.onLeaderChange(listener): () => void   // leadership moves when the leader closes

// Or scope it to a block — `Symbol.asyncDispose` is implemented:
await using fs = new VFSFileSystem({ root: '/scratch' });

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
promoted, there's a window where the new sync-relay worker isn't looping yet. If
your app also does its own leader election, await `fs.whenReady()` *after*
acquiring your own lock to be sure the FS has finished any promotion first:

```typescript
navigator.locks.request('my-app-leader', async () => {
  await fs.whenReady();      // FS promotion (if any) has completed
  fs.writeFileSync('/state.json', data); // safe — the volume is mounted here
  await new Promise(() => {}); // hold the lock
});
```

**A sync call made before the volume is mounted throws, rather than waiting for a mount it is
preventing.** Mounting runs on an event loop — the retry is a `setTimeout`, and the first attempt
starts from a `navigator.locks` callback — and a synchronous call blocks that event loop. On a
page's main thread it must busy-loop, because `Atomics.wait` is illegal there; in a worker
`Atomics.wait` blocks the agent just as completely. So a sync call that waits for its own mount is
not early, it is deadlocked, and the error says so and names `fs.promises.*`.

This is why `await fs.init()` matters. Anything that gets you past one turn of the event loop is
enough — `await fs.init()`, `await fs.whenReady()`, or simply any `await` between constructing the
filesystem and the first `*Sync` call. Once mounted, sync calls behave exactly as advertised and
this never comes up again; it is a startup-ordering rule, not a running cost.

It applies to a handover too, for the same reason: while the volume is moving between tabs, the new
leader's mount needs its own event loop.

Note what this rule is *not*. It is a check on the filesystem's state, not a limit on how long a
call may take — nothing here caps an operation, and a multi-gigabyte read or write on a mounted
volume runs to completion however long that is.

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
