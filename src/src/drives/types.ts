/**
 * Multi-drive abstraction. Every disk the Finder shows — OPFS, memory,
 * localStorage, IndexedDB, Google Drive/Dropbox/OneDrive, a local/USB folder —
 * is a `Drive`: a uniform, async, path-relative file API plus metadata the UI
 * uses to render the sidebar and adapt behaviour. Block-backed disks (OPFS/mem/
 * idb/ls) are exposed through a thin `VfsDrive` over the existing VFS engine;
 * native-tree drives (cloud / FS-Access) implement this directly. See DESIGN.md.
 *
 * Self-contained on purpose (no engine imports) so the abstraction is testable in
 * isolation and the existing SAB/OPFS fast path is untouched.
 */

export type DriveKind =
  | 'opfs'
  | 'memory'
  | 'localstorage'
  | 'indexeddb'
  | 'gdrive'
  | 'dropbox'
  | 'onedrive'
  | 'localfolder' // File System Access dir handle (incl. a mounted USB folder)

// 'symlink' is a READ-ONLY result: backends that have real symlinks (VfsDrive /
// OPFS, via lstat) surface it; backends without them (memory, ls, idb, cloud,
// FS-Access) simply never produce it. The Drive interface has no symlink-creation
// op, so no backend is expected to "support" creating one — only to report it.
export type EntryType = 'file' | 'dir' | 'symlink'

/** Per-entry sync state for cloud/synced drives (badged in the Finder). */
export type SyncStatus =
  | 'local' // not a synced drive / sync not applicable
  | 'synced'
  | 'pending'
  | 'uploading'
  | 'downloading'
  | 'conflict'
  | 'error'

export interface DriveStat {
  type: EntryType
  size: number
  mtimeMs: number
  ctimeMs?: number
  readonly?: boolean
  sync?: SyncStatus
}

export interface DriveEntry extends DriveStat {
  name: string // basename, no slashes
}

/** What a drive can do — the UI hides/disables actions accordingly. */
export interface DriveCapabilities {
  writable: boolean
  streaming: boolean // supports createReadable/createWritable
  /** the drive is also reachable through the sync Node-fs API (block-backed) */
  nativeSync: boolean
  watch: boolean
  /** files carry meaningful SyncStatus (cloud/synced drives) */
  syncBadges: boolean
}

/** Streaming handles — generic so any backend (or the host) can adapt them. */
export interface DriveReadable {
  read(): Promise<Uint8Array | null> // null = EOF
  close(): Promise<void>
}
export interface DriveWritable {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<void>
  abort?(reason?: unknown): Promise<void>
}

/**
 * A mounted disk. All paths are POSIX, absolute within the drive ("/" = root),
 * never include the drive id. Implementations must be safe to call concurrently.
 */
export interface Drive {
  /** stable unique id (e.g. "opfs", "mem-1", "gdrive:me@x"). */
  readonly id: string
  /** human label shown in the sidebar. */
  label: string
  readonly kind: DriveKind
  /** lucide-ish icon key the host maps to an SVG. */
  readonly icon: string
  readonly capabilities: DriveCapabilities
  /** present once connected; cloud drives may be `disconnected` until OAuth. */
  state: 'ready' | 'connecting' | 'disconnected' | 'error'

  // ---- queries ----
  stat(path: string): Promise<DriveStat>
  exists(path: string): Promise<boolean>
  list(path: string): Promise<DriveEntry[]>

  // ---- files ----
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, data: Uint8Array): Promise<void>
  createReadable?(path: string): Promise<DriveReadable>
  createWritable?(path: string, size?: number): Promise<DriveWritable>

  // ---- tree ops ----
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>
  rename(from: string, to: string): Promise<void>
  /** in-drive copy fast-path; manager falls back to read+write if absent. */
  copy?(from: string, to: string): Promise<void>

  // ---- lifecycle ----
  /** total/used bytes if known (drives quota / VFS statfs). */
  usage?(): Promise<{ total: number; used: number } | null>
  dispose?(): Promise<void> | void
  /**
   * Optional: run a burst of writes with persistence/flush coalesced into one
   * commit at the end. Drives that persist per-op (localStorage / IndexedDB)
   * implement this so a bulk `transfer` rewrites the store once, not once per
   * file. Drives without a persistence step (or that already commit per-op) omit
   * it and the manager just runs the work directly.
   */
  batch?<T>(fn: () => Promise<T>): Promise<T>
}

/** Progress emitted during a cross-drive transfer (drives the Finder bar). */
export interface TransferProgress {
  totalBytes: number
  movedBytes: number
  totalFiles: number
  movedFiles: number
  /** the file currently being moved (drive-relative path). */
  current: string
}

export interface TransferOptions {
  move?: boolean // delete source after a successful copy
  overwrite?: boolean // default true
  onProgress?: (p: TransferProgress) => void
  signal?: AbortSignal
}

/** Token seam for cloud drives — the HOST owns OAuth; the lib never sees secrets. */
export interface TokenProvider {
  getAccessToken(): Promise<string>
  /** called by a driver when the token is rejected so the host can re-auth. */
  onInvalid?(): void
}
