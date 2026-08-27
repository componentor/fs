# Multi-Drive API (experimental)

Mounting more than one backing store — the `Drive` interface, `DriveManager`, the bundled drive implementations and the sync engine.

← Back to the [readme](../readme.md).

---

> **Status: experimental.** Additive and self-contained — the single-OPFS
> `VFSFileSystem` API above is unchanged and untouched by this. The `Drive` surface
> is stable enough to build against but may still evolve. The in-RAM drives,
> `DriveManager.transfer`, and `SyncEngine` are unit-tested; the browser-API drives
> (`VfsDrive`, localStorage, IndexedDB, local-folder, cloud) compile and build but
> need a browser to exercise. Pin a version if you depend on it. See
> [`src/src/drives/DESIGN.md`](../src/src/drives/DESIGN.md) for the full design.

A **drive** is a uniform, async, path-relative file API for any disk a host's
"Finder" might show — OPFS, in-memory, localStorage, IndexedDB, Google Drive /
Dropbox / OneDrive, or a local/USB folder. Every drive implements the same
[`Drive`](../src/src/drives/types.ts) interface, so the UI, cross-drive copy/move,
and sync all work against one abstraction with no per-backend code.

> **Engine-free import.** The drive layer is also exported from
> `@componentor/fs/drives`, which omits `VfsDrive` (the only drive that wraps the
> VFS engine) so a host that brings its own OPFS layer can tree-shake the engine
> out of its bundle. Import `VfsDrive` from the root `@componentor/fs` when you do
> want to wrap the engine. Both entries are otherwise identical.

```typescript
import { DriveManager, MemoryDrive } from '@componentor/fs';
// …or, engine-free: import { DriveManager, MemoryDrive } from '@componentor/fs/drives';

const manager = new DriveManager();

// Mount drives (each needs a stable unique id).
const mem = manager.mount(new MemoryDrive('mem-1', 'Scratch'));
const out = manager.mount(new MemoryDrive('mem-2', 'Output'));

// React to the sidebar changing (mounted / unmounted / state-or-label changed).
const off = manager.on((e) => console.log(e.type, manager.list().length));

// Every drive speaks the same path-relative, async API. All paths are POSIX and
// absolute within the drive ("/" = root); they never include the drive id.
await mem.mkdir('/project/src', { recursive: true });
await mem.writeFile('/project/src/app.ts', new TextEncoder().encode('export {}'));
const entries = await mem.list('/project/src'); // [{ name: 'app.ts', type: 'file', size, mtimeMs, ... }]

// Copy or move a file/tree between ANY two drives, with progress for a UI bar.
// Same-drive transfers fast-path to native rename/copy.
await manager.transfer(mem, '/project', out, '/backup', {
  move: false,            // true = delete source after a fully successful copy
  overwrite: true,        // default true
  onProgress: (p) => {
    const pct = p.totalBytes ? Math.round((p.movedBytes / p.totalBytes) * 100) : 100;
    console.log(`${pct}%  ${p.movedFiles}/${p.totalFiles}  ${p.current}`);
  },
  // signal: abortController.signal, // optional AbortSignal
});

off();
await manager.dispose(); // unmount + dispose every drive
```

### `Drive` interface

Each drive advertises `kind`, an `icon` key, a `state`, and a `capabilities` set
the UI uses to enable/disable actions. Core operations:

| Op | Signature | Notes |
|----|-----------|-------|
| `stat` | `stat(path) → DriveStat` | `{ type, size, mtimeMs, ctimeMs?, readonly?, sync? }` |
| `exists` | `exists(path) → boolean` | |
| `list` | `list(path) → DriveEntry[]` | immediate children only |
| `readFile` / `writeFile` | `(path[, data]) → Uint8Array \| void` | |
| `createReadable` / `createWritable` | `(path) → stream handle` | optional; used for large-file streaming |
| `mkdir` | `mkdir(path, { recursive? })` | |
| `remove` | `remove(path, { recursive? })` | idempotent (`rm -f` semantics) |
| `rename` | `rename(from, to)` | atomic within a drive |
| `copy` | `copy(from, to)` | optional in-drive fast-path |
| `usage` | `usage() → { total, used } \| null` | optional; `total: 0` = unbounded |
| `batch` | `batch(fn)` | optional; coalesces a burst of writes into one commit (persist-per-op drives) |
| `dispose` | `dispose()` | optional cleanup on unmount |

Errors carry Node-style `code` fields (`ENOENT`, `ENOTDIR`, `EISDIR`,
`ENOTEMPTY`, `EINVAL`), so existing `fs`-error handling applies.

### `DriveManager`

| Method | Description |
|--------|-------------|
| `mount(drive)` | register a drive (throws on duplicate id) |
| `unmount(id)` | dispose + remove (no-op if absent) |
| `get(id)` / `has(id)` / `list()` | registry queries |
| `on(fn) → off` | subscribe to `mounted` / `unmounted` / `changed` events |
| `notifyChanged(id)` | drivers call this when a drive's state/label changes |
| `transfer(src, srcPath, dst, dstPath, opts)` | generic cross-drive copy/move with progress |
| `dispose()` | unmount everything and drop listeners |

`transfer` pre-walks the source to compute exact byte/file totals, streams files
larger than 4 MB when both ends support streaming (otherwise buffers), and — on
`move` — removes the source only after the whole tree copies successfully.
`opts.signal` cancels between files and mid-file during streaming (rejects with
`AbortError`). A few semantics to keep in mind:

- Directory copies **merge** into an existing destination (per-file overwrite via
  `opts.overwrite`, default `true`); they don't replace it wholesale.
- A **cross-drive `move` is copy-then-delete, so it is not atomic** — an abort or
  error mid-transfer can leave a partial copy with the source still intact.
  Same-drive moves use the drive's atomic `rename`.

### Drive implementations

All of these implement the same `Drive` interface and interoperate via
`DriveManager.transfer` and `SyncEngine`:

| Class | `kind` | Backing | Persistent | Notes |
|-------|--------|---------|------------|-------|
| `TreeDrive` | — | abstract base | — | in-RAM POSIX tree (child-indexed dirs, batch/copy guards, streaming); subclass and override `persist()`/`hydrate()` |
| `MemoryDrive` | `memory` | `Map` in one tab | no | a zero-persistence `TreeDrive`; fastest, single-tab; the reference disk |
| `LocalStorageDrive` | `localstorage` | one `localStorage` key (base64 JSON) | yes | small (~5 MB origin budget), synchronous, single-origin |
| `IndexedDbDrive` | `indexeddb` | IDB object store (one record/path) | yes | large; works **without** COOP/COEP or OPFS |
| `VfsDrive` | `opfs` | wraps a `VFSFileSystem` | yes | bridges the OPFS engine; honours real symlinks; pass a sub-`root` for scoped disks |
| `LocalFolderDrive` | `localfolder` | File System Access dir handle | yes | `pickDirectory()` / re-attach a saved handle; a mounted USB folder is just a picked dir |
| `CloudDrive` | `gdrive`/`dropbox`/`onedrive` | host proxy (`/drives/:connId/*`) | yes | the **lib never sees OAuth tokens** — the host service brokers them |

```typescript
import {
  IndexedDbDrive, VfsDrive, LocalFolderDrive, CloudDrive,
  pickDirectory, localFolderSupported,
} from '@componentor/fs';

// Persistent disk that needs no cross-origin isolation:
const idb = manager.mount(new IndexedDbDrive('idb-1', 'Projects'));

// Expose the existing OPFS engine as a drive (optionally scoped to a sub-tree):
const opfs = manager.mount(new VfsDrive('opfs', 'Disk', fs, '/Volumes/Disk', true));

// A real local/USB folder (Chromium; needs a user gesture):
if (localFolderSupported()) {
  const folder = new LocalFolderDrive('usb-1', 'USB', await pickDirectory());
  await folder.connect();
  manager.mount(folder);
}

// A cloud account, brokered by your host service (no tokens in the lib):
const gdrive = new CloudDrive({
  id: 'gdrive:me', label: 'Google Drive', provider: 'gdrive',
  baseUrl: 'https://app.example.com/api', connectionId: 'conn_123',
});
await gdrive.connect();
manager.mount(gdrive);
```

**Persistence (`LocalStorageDrive` / `IndexedDbDrive`):** both persist
**incrementally** — one record per path (IndexedDB) or one key per path
(localStorage) — so a single write commits only the record(s) that changed, not
the whole tree. Multi-file operations are coalesced into **one** commit: a
recursive `copy`, a `rename`, a `DriveManager.transfer`, and anything you wrap in
`drive.batch(fn)` flush once at the end rather than per file. The tree lives in
memory and is loaded once on first access (`hydrate`); localStorage still has the
~5 MB origin budget, so prefer `VfsDrive` (OPFS) or `IndexedDbDrive` for large
working sets.

```typescript
// Group your own writes into a single store commit:
await idb.batch(async () => {
  for (const [path, bytes] of files) await idb.writeFile(path, bytes);
});
```

To implement a custom persistent drive, subclass `TreeDrive` and override
`hydrate()` (load all node records into `this.nodes`; the base rebuilds directory
`children` sets) and `commit(puts, dels)` (write the changed paths, delete the
removed ones).

### Sync engine

`SyncEngine` mirrors a folder on one drive into a folder on another (e.g. a cloud
drive ↔ a local OPFS cache), one-way or two-way, emitting a per-path `SyncStatus`
the UI can badge. Change detection uses a manifest (`.tdsync.json`) stored in the
local folder.

```typescript
import { SyncEngine } from '@componentor/fs';

const sync = new SyncEngine(gdrive, '/Reports', opfs, '/cache/Reports');
const result = await sync.sync({
  direction: 'two-way', // 'pull' | 'push' | 'two-way' (default)
  onStatus: (path, status) => console.log(status, path), // synced | uploading | downloading | conflict | …
  onProgress: (done, total) => console.log(`${done}/${total}`),
});
console.log(result); // { downloaded, uploaded, deleted, conflicts, errors }
```

Two-way conflicts (both sides changed since the last sync) are reported in
`result.conflicts` and badged `conflict` rather than auto-resolved, so the host can
prompt the user. Empty-directory deletions are not propagated.
