# Multi-drive filesystem — design

> Status: **Phases 1–4 implemented** (additive; the existing `VFSFileSystem`
> SAB/OPFS fast path is untouched). Typechecks clean; pure-logic parts
> (TreeDrive, MemoryDrive, DriveManager.transfer, SyncEngine) runtime-verified;
> browser-API drives (VfsDrive/localStorage/IndexedDB/LocalFolder/Cloud) compile +
> build but need a browser to exercise. Shipped experimental in 3.3.0.
>
> Modules: `types.ts` · `manager.ts` · `memory-drive.ts` · `tree-drive.ts`
> (base) → `localstorage-drive.ts` / `indexeddb-drive.ts` · `vfs-drive.ts`
> (wraps the engine; honours symlinks) · `localfolder-drive.ts` (FS Access/USB) ·
> `cloud-drive.ts` (host-proxy `/drives/:connId/*`, lib never sees tokens) ·
> `sync-engine.ts` (one/two-way mirror + per-path SyncStatus + manifest).
> Phase 2's "block-backend seam inside VFSEngine" was intentionally NOT done —
> wrapping the engine via `VfsDrive` achieves the same disks with zero risk to the
> SAB fast path. Phase 5 (Finder UI) lives in the host app (webcontainer/desktop).

## Goal

Turn `@componentor/fs` from a single OPFS disk into a **multi-drive** filesystem,
surfaced in the host app's Finder as a sidebar of disks you can browse, drag/drop
between (with progress), and sync. Disk types:

| Drive | Backing | Sync API? | Notes |
|-------|---------|-----------|-------|
| **OPFS** (default) | OPFS `.vfs.bin` | ✅ (SAB) | the current disk; unchanged |
| **OPFS (scoped)** | OPFS `.vfs.bin` at another root | ✅ | multiple independent OPFS disks (already supported via `root`) |
| **Memory** | `Uint8Array` in one tab | ✅* | NOT multi-tab; fastest — apps run hot from here |
| **localStorage** | chunked into `localStorage` | ✅* | small, persistent, single-origin |
| **IndexedDB** | blocks in IDB | ⚠️ async | works without OPFS/COI |
| **Google Drive / Dropbox / OneDrive** | provider REST API | ❌ async | OAuth; native file tree; optional OPFS-synced cache |
| **Local folder / USB** | File System Access dir handle | ⚠️ async | `showDirectoryPicker()`; a mounted USB folder is just a picked dir (no web API mounts a USB *filesystem* directly; WebUSB is raw device access only) |

\* sync only when cross-origin-isolated (same gate as today).

## Two layers (this is the key decision)

The disk types split into two families, so there are **two** extension points:

### A. Block backend (`VFSBackend`) — reuse the VFS engine
Memory / localStorage / IndexedDB / extra-OPFS disks store the **same binary VFS
format** (`.vfs.bin`: superblock + inodes + bitmap + data blocks) in a different
medium. So they reuse the entire `VFSEngine` (full Node-fs semantics, even sync)
by swapping only **where the bytes live**:

```ts
interface VFSBackend {        // src/src/vfs/backend.ts (Phase 2)
  read(offset: number, length: number): Uint8Array
  write(offset: number, data: Uint8Array): void
  truncate(size: number): void
  size(): number
  flush(): void
  close(): void
}
```
`VFSEngine.init()` currently hard-wires the OPFS `FileSystemSyncAccessHandle`.
Phase 2 extracts that into `OpfsBackend` and injects a `VFSBackend`, then adds
`MemoryBackend` / `IndexedDbBackend` / `LocalStorageBackend`. **No change to the
inode/path/bitmap logic or the SAB protocol** — the fast path is preserved.

### B. Native drive (`Drive`) — path-mounts with their own model
Cloud (GDrive/Dropbox/OneDrive) and File-System-Access folders have their **own**
file tree and are **inherently async** — they don't fit the binary VFS format.
They implement a high-level async `Drive` interface (this file's `types.ts`) and
are mounted by path. The Finder talks to **every** disk through this same `Drive`
interface, so block-backed disks are *also* exposed as a `Drive` (a thin
`VfsDrive` wrapper over a `VFSFileSystem`). That uniformity is what makes
cross-drive copy + the sidebar generic.

```
Finder ─┬─ DriveManager.list() → Drive[]
        ├─ Drive (VfsDrive)        → VFSFileSystem (OpfsBackend | MemoryBackend | …)
        ├─ Drive (CloudDrive)      → provider REST (OAuth)
        └─ Drive (LocalFolderDrive)→ FileSystemDirectoryHandle (USB / local)
```

## The `Drive` interface (Phase 1, this module)

Uniform, **async**, the lowest common denominator across all backends (sync
variants stay available on `VfsDrive` for the block-backed disks via the existing
`VFSFileSystem`). See `types.ts`. Every entry op is path-relative to the drive
root. Drives advertise `capabilities` (writable, streaming, native-sync, watch)
and `kind` so the UI adapts.

## Cross-drive copy / move (Phase 1, `manager.ts`)

`DriveManager.transfer(src, srcPath, dst, dstPath, { move, onProgress })` walks
the source tree and streams each file into the destination, emitting byte/per-file
progress (drives the Finder progress bar). Works for ANY pair of drives because
it only uses the `Drive` interface. Same-drive copy can fast-path to the drive's
native copy when both endpoints are the same drive.

## Sync engine (Phase 4)

A `SyncJob(remoteDrive, remotePath, { scope: 'all' | folder })` mirrors a cloud/
memory folder into an OPFS-backed cache and reconciles changes both ways,
exposing per-entry `SyncStatus` (`synced | pending | uploading | downloading |
conflict | error`) that the Finder badges onto files. Built on `Drive` + a small
manifest (path → {localMtime, remoteMtime, etag}) persisted in OPFS.

## OAuth (Phase 3)

Provider connect happens in the **host app** (it owns redirect URIs / client IDs
/ the popup), which hands the `fs` lib only a token provider:
`{ getAccessToken(): Promise<string>, onInvalid(): void }`. The lib's
`CloudDrive` stays host-agnostic (no secrets in the lib). Google Drive (Drive v3),
Dropbox (v2), OneDrive (Graph) each get a thin `Driver` mapping `Drive` ops →
their REST calls + a token refresh hook. PKCE in the browser; tokens in the host.

## Phases

1. **Foundation (this commit):** `Drive` interface + `MemoryDrive` (reference) +
   `DriveManager` (register/list + cross-drive `transfer` with progress). Pure,
   self-contained, unit-tested in isolation (`src/tests/drives.test.ts`). No
   engine/SAB changes.
2. **Block backends:** extract `VFSBackend` from `engine.ts`; `OpfsBackend`,
   `MemoryBackend`, `IndexedDbBackend`, `LocalStorageBackend`; `VfsDrive` wrapper
   so each is a `Drive`. Multiple scoped OPFS disks.
3. **Cloud drivers + OAuth:** host token-provider seam; `CloudDrive` +
   GDrive/Dropbox/OneDrive `Driver`s; `LocalFolderDrive` (FS Access / USB).
4. **Sync engine + status badges.**
5. **Finder UI (host repo):** disk sidebar, add-disk flow, OAuth connect,
   drag/drop across drives with the existing progress bar, sync badges.
