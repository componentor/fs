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
type DriveKind = 'opfs' | 'memory' | 'localstorage' | 'indexeddb' | 'gdrive' | 'dropbox' | 'onedrive' | 'localfolder';
type EntryType = 'file' | 'dir' | 'symlink';
/** Per-entry sync state for cloud/synced drives (badged in the Finder). */
type SyncStatus = 'local' | 'synced' | 'pending' | 'uploading' | 'downloading' | 'conflict' | 'error';
interface DriveStat {
    type: EntryType;
    size: number;
    mtimeMs: number;
    ctimeMs?: number;
    readonly?: boolean;
    sync?: SyncStatus;
}
interface DriveEntry extends DriveStat {
    name: string;
}
/** What a drive can do — the UI hides/disables actions accordingly. */
interface DriveCapabilities {
    writable: boolean;
    streaming: boolean;
    /** the drive is also reachable through the sync Node-fs API (block-backed) */
    nativeSync: boolean;
    watch: boolean;
    /** files carry meaningful SyncStatus (cloud/synced drives) */
    syncBadges: boolean;
}
/** Streaming handles — generic so any backend (or the host) can adapt them. */
interface DriveReadable {
    read(): Promise<Uint8Array | null>;
    close(): Promise<void>;
}
interface DriveWritable {
    write(chunk: Uint8Array): Promise<void>;
    close(): Promise<void>;
    abort?(reason?: unknown): Promise<void>;
}
/**
 * A mounted disk. All paths are POSIX, absolute within the drive ("/" = root),
 * never include the drive id. Implementations must be safe to call concurrently.
 */
interface Drive {
    /** stable unique id (e.g. "opfs", "mem-1", "gdrive:me@x"). */
    readonly id: string;
    /** human label shown in the sidebar. */
    label: string;
    readonly kind: DriveKind;
    /** lucide-ish icon key the host maps to an SVG. */
    readonly icon: string;
    readonly capabilities: DriveCapabilities;
    /** present once connected; cloud drives may be `disconnected` until OAuth. */
    state: 'ready' | 'connecting' | 'disconnected' | 'error';
    stat(path: string): Promise<DriveStat>;
    exists(path: string): Promise<boolean>;
    list(path: string): Promise<DriveEntry[]>;
    readFile(path: string): Promise<Uint8Array>;
    writeFile(path: string, data: Uint8Array): Promise<void>;
    createReadable?(path: string): Promise<DriveReadable>;
    createWritable?(path: string, size?: number): Promise<DriveWritable>;
    mkdir(path: string, opts?: {
        recursive?: boolean;
    }): Promise<void>;
    remove(path: string, opts?: {
        recursive?: boolean;
    }): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    /** in-drive copy fast-path; manager falls back to read+write if absent. */
    copy?(from: string, to: string): Promise<void>;
    /** total/used bytes if known (drives quota / VFS statfs). */
    usage?(): Promise<{
        total: number;
        used: number;
    } | null>;
    dispose?(): Promise<void> | void;
    /**
     * Optional: run a burst of writes with persistence/flush coalesced into one
     * commit at the end. Drives that persist per-op (localStorage / IndexedDB)
     * implement this so a bulk `transfer` rewrites the store once, not once per
     * file. Drives without a persistence step (or that already commit per-op) omit
     * it and the manager just runs the work directly.
     */
    batch?<T>(fn: () => Promise<T>): Promise<T>;
}
/** Progress emitted during a cross-drive transfer (drives the Finder bar). */
interface TransferProgress {
    totalBytes: number;
    movedBytes: number;
    totalFiles: number;
    movedFiles: number;
    /** the file currently being moved (drive-relative path). */
    current: string;
}
interface TransferOptions {
    move?: boolean;
    overwrite?: boolean;
    onProgress?: (p: TransferProgress) => void;
    signal?: AbortSignal;
}
/** Token seam for cloud drives — the HOST owns OAuth; the lib never sees secrets. */
interface TokenProvider {
    getAccessToken(): Promise<string>;
    /** called by a driver when the token is rejected so the host can re-auth. */
    onInvalid?(): void;
}

/**
 * DriveManager — the registry the Finder talks to, plus the one generic
 * cross-drive copy/move engine. It only ever uses the `Drive` interface, so any
 * pair of drives (OPFS↔cloud, memory↔USB, …) interoperates with no per-pair code.
 *
 * Self-contained (depends only on ./types). No engine/SAB coupling.
 */

type DriveEvent = {
    type: 'mounted';
    drive: Drive;
} | {
    type: 'unmounted';
    id: string;
} | {
    type: 'changed';
    id: string;
};
declare class DriveManager {
    private drives;
    private listeners;
    mount(drive: Drive): Drive;
    unmount(id: string): Promise<void>;
    get(id: string): Drive | undefined;
    list(): Drive[];
    has(id: string): boolean;
    /** drivers call this when a drive's state/label changes (e.g. OAuth completes). */
    notifyChanged(id: string): void;
    on(fn: (e: DriveEvent) => void): () => void;
    private emit;
    /**
     * Copy (or move) a file or directory tree from one drive to another, emitting
     * progress. Pre-walks the source to compute totals so the Finder bar is exact,
     * then copies file-by-file. On `move`, sources are removed only after the whole
     * tree copies successfully (fast in-drive rename when src===dst).
     *
     * Semantics worth knowing:
     * - Directory copies **merge** into an existing destination (per-file overwrite
     *   governed by `opts.overwrite`); they do not replace it wholesale.
     * - A cross-drive `move` is copy-then-delete, so it is **not atomic** — an abort
     *   or error mid-transfer can leave a partial copy at the destination with the
     *   source still intact. Same-drive moves use the drive's atomic `rename`.
     * - `opts.signal` cancels between files and mid-file during streaming, rejecting
     *   with an `AbortError`.
     */
    transfer(src: Drive, srcPath: string, dst: Drive, dstPath: string, opts?: TransferOptions): Promise<void>;
    /** Stream a single file when both ends support it and it's large; else buffer. */
    private copyFile;
    /** Depth-first listing of a path: dirs (parents before children) then files. */
    private walk;
    dispose(): Promise<void>;
}

/**
 * TreeDrive — a complete in-RAM POSIX tree (Map<path, node>, each dir carrying a
 * `children` set so list/remove/rename touch only a subtree) implementing the
 * full `Drive` surface. Subclasses (localStorage, IndexedDB) override
 * `hydrate()` + `commit(puts, dels)` to mirror the tree into a durable store
 * incrementally (only changed/removed records per flush); the path/tree logic
 * lives here once. `MemoryDrive` is just this base with the no-op default store.
 */

interface FileNode {
    type: 'file';
    data: Uint8Array;
    mtimeMs: number;
    ctimeMs: number;
}
interface DirNode {
    type: 'dir';
    mtimeMs: number;
    ctimeMs: number;
    children: Set<string>;
}
type TreeNode = FileNode | DirNode;
declare abstract class TreeDrive implements Drive {
    readonly id: string;
    label: string;
    abstract readonly kind: Drive['kind'];
    abstract readonly icon: string;
    readonly capabilities: DriveCapabilities;
    state: Drive['state'];
    protected nodes: Map<string, TreeNode>;
    protected now: () => number;
    constructor(id: string, label: string);
    /**
     * Load the whole node set from the backing store into `this.nodes` (records
     * only — the base rebuilds dir `children` sets centrally in `ready()`). Default:
     * no-op (a pure RAM disk).
     */
    protected hydrate(): Promise<void>;
    /**
     * Commit just what changed since the last flush: write/replace every node at a
     * path in `puts`, delete every path in `dels`. Default: no-op. This is the seam
     * that makes a single small write touch a single record, not the whole tree.
     */
    protected commit(_puts: Set<string>, _dels: Set<string>): Promise<void>;
    private dirtyPuts;
    private dirtyDels;
    private markPut;
    private markDel;
    /** >0 while a multi-step op (copy / batch) is in flight — coalesces its writes
     *  into a single commit instead of one store round-trip per file. */
    private suspend;
    private save;
    /**
     * Run `fn` with persistence suspended, then commit once. Lets a caller (e.g.
     * `DriveManager.transfer`) collapse a whole burst of writes into a single
     * commit. Nests safely; commits on the outermost exit even if `fn` throws.
     */
    batch<T>(fn: () => Promise<T>): Promise<T>;
    private readyOnce;
    protected ready(): Promise<void>;
    /** Reconstruct every dir's `children` set from the flat path set (the store
     *  persists records, not edges) — so subclasses' `hydrate` only loads nodes. */
    private rebuildChildren;
    private link;
    private unlink;
    private descendants;
    private requireDirOf;
    stat(path: string): Promise<DriveStat>;
    exists(path: string): Promise<boolean>;
    list(path: string): Promise<DriveEntry[]>;
    readFile(path: string): Promise<Uint8Array>;
    writeFile(path: string, data: Uint8Array): Promise<void>;
    mkdir(path: string, opts?: {
        recursive?: boolean;
    }): Promise<void>;
    remove(path: string, opts?: {
        recursive?: boolean;
    }): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    copy(from: string, to: string): Promise<void>;
    private copyInto;
    createReadable(path: string): Promise<DriveReadable>;
    createWritable(path: string): Promise<DriveWritable>;
    usage(): Promise<{
        total: number;
        used: number;
    } | null>;
    protected quotaBytes(): number;
    dispose(): void;
}

/**
 * In-memory Drive — a real "Memory disk" and the reference `Drive`.
 *
 * It IS a `TreeDrive` with no persistence: the base already provides the complete
 * POSIX tree (Map<path, node> with per-dir child sets, batch/copy guards, streaming
 * handles), and `hydrate()`/`commit()` default to no-ops — exactly a RAM disk.
 * Lives in the one tab/worker that created it, so apps run from it at full speed
 * with zero OPFS/SAB round-trips.
 */

declare class MemoryDrive extends TreeDrive {
    readonly kind: "memory";
    readonly icon = "memory";
    constructor(id: string, label?: string);
    /** convenience for seeding/tests */
    writeText(path: string, text: string): Promise<void>;
}

/**
 * localStorage disk — a TreeDrive mirrored into localStorage, ONE key per path
 * (`td.drive.ls.<id>:<path>`) so a single write touches a single key instead of
 * re-serialising the whole tree. Small (~5 MB origin budget) but persistent and
 * synchronous; file bytes are base64'd in each entry.
 */

declare class LocalStorageDrive extends TreeDrive {
    readonly kind: "localstorage";
    readonly icon = "database";
    private prefix;
    constructor(id: string, label?: string);
    protected quotaBytes(): number;
    private keys;
    protected hydrate(): Promise<void>;
    /** Incremental: write only changed keys, remove only deleted ones. */
    protected commit(puts: Set<string>, dels: Set<string>): Promise<void>;
    dispose(): void;
    /** Wipe persisted contents (when the user removes the disk). */
    destroy(): Promise<void>;
}

/**
 * IndexedDB disk — a TreeDrive mirrored into an IDB object store (one record per
 * path). Persistent, large, works WITHOUT cross-origin isolation / OPFS. File
 * bytes are stored as native Uint8Array (no base64).
 */

declare class IndexedDbDrive extends TreeDrive {
    readonly kind: "indexeddb";
    readonly icon = "database";
    private dbName;
    private db;
    constructor(id: string, label?: string);
    private getDb;
    protected hydrate(): Promise<void>;
    /** Incremental: write only changed records, delete only removed ones — one tx. */
    protected commit(puts: Set<string>, dels: Set<string>): Promise<void>;
    dispose(): void;
    destroy(): Promise<void>;
}

/**
 * Local folder / USB disk — a real directory on the user's machine via the File
 * System Access API. A mounted USB stick is just a picked folder (no web API
 * mounts a USB filesystem directly). The picked handle is stashed in IndexedDB so
 * the disk can be re-attached across reloads (re-prompting for permission).
 */

declare function loadHandle(id: string): Promise<FileSystemDirectoryHandle | null>;
declare function dropHandle(id: string): Promise<void>;
declare function localFolderSupported(): boolean;
declare function pickDirectory(): Promise<FileSystemDirectoryHandle>;
declare class LocalFolderDrive implements Drive {
    readonly id: string;
    label: string;
    private root;
    readonly kind: "localfolder";
    readonly icon = "usb";
    readonly capabilities: DriveCapabilities;
    state: Drive['state'];
    constructor(id: string, label: string, root: FileSystemDirectoryHandle | null);
    connect(): Promise<void>;
    private ensurePermission;
    private dirHandle;
    private fileHandle;
    stat(path: string): Promise<DriveStat>;
    exists(path: string): Promise<boolean>;
    list(path: string): Promise<DriveEntry[]>;
    readFile(path: string): Promise<Uint8Array>;
    writeFile(path: string, data: Uint8Array): Promise<void>;
    createReadable(path: string): Promise<DriveReadable>;
    createWritable(path: string): Promise<DriveWritable>;
    mkdir(path: string, opts?: {
        recursive?: boolean;
    }): Promise<void>;
    remove(path: string, opts?: {
        recursive?: boolean;
    }): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    copy(from: string, to: string): Promise<void>;
    usage(): Promise<{
        total: number;
        used: number;
    } | null>;
    dispose(): void;
    destroy(): Promise<void>;
}

/**
 * Cloud disk — ONE linked account on Google Drive / Dropbox / OneDrive, brokered
 * by the HOST service (which holds the OAuth tokens encrypted and exposes
 * `${baseUrl}/drives/:connId/*`). The lib never sees a provider token: it just
 * speaks the proxy protocol. Keyed by the backend CONNECTION id so a user can
 * link several accounts per provider. Files live in the provider, so every entry
 * is reported `synced` (badged by the host UI).
 *
 * The proxy contract (all relative to `${baseUrl}/drives/:connId`):
 *   GET  list?path=   → { entries:[{name,type,size,mtimeMs}] }
 *   GET  stat?path=   → { type,size,mtimeMs }
 *   GET  read?path=   → raw bytes
 *   PUT  write?path=  → (raw body)
 *   POST mkdir|remove?path= ; rename|copy?from=&to= ; GET usage
 */

type CloudProvider = 'gdrive' | 'dropbox' | 'onedrive';
interface CloudDriveOptions {
    id: string;
    label: string;
    provider: CloudProvider;
    /** host service base URL (no trailing slash). */
    baseUrl: string;
    /** backend connection id (the linked account). */
    connectionId: string;
    /** icon key for the UI (defaults per provider). */
    icon?: string;
    /** custom fetch (defaults to global fetch with credentials:'include'). */
    fetch?: typeof fetch;
}
declare class CloudDrive implements Drive {
    readonly id: string;
    label: string;
    readonly kind: Drive['kind'];
    readonly icon: string;
    readonly capabilities: DriveCapabilities;
    state: Drive['state'];
    private base;
    private connId;
    readonly provider: CloudProvider;
    private _fetch;
    constructor(opts: CloudDriveOptions);
    connect(): Promise<void>;
    private url;
    private api;
    stat(path: string): Promise<DriveStat>;
    exists(path: string): Promise<boolean>;
    list(path: string): Promise<DriveEntry[]>;
    readFile(path: string): Promise<Uint8Array>;
    writeFile(path: string, data: Uint8Array): Promise<void>;
    mkdir(path: string): Promise<void>;
    remove(path: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    copy(from: string, to: string): Promise<void>;
    usage(): Promise<{
        total: number;
        used: number;
    } | null>;
}

/**
 * SyncEngine — mirror a folder on one drive into a folder on another (typically a
 * cloud/remote drive ↔ a local OPFS-backed cache), one-way or two-way, emitting a
 * per-path `SyncStatus` the UI badges. Works on ANY pair of drives (uses only the
 * `Drive` interface).
 *
 * Change detection uses a manifest (rel → { rMtime, lMtime, size }) persisted in
 * the LOCAL drive at `<localPath>/.tdsync.json`. Because writing a file changes
 * the destination's mtime, we store BOTH sides' observed mtimes after each sync
 * and flag a side "changed" when its CURRENT mtime differs from the stored one —
 * so a copy doesn't look like an edit on the next pass.
 */

type SyncDirection = 'pull' | 'push' | 'two-way';
interface SyncOptions {
    direction?: SyncDirection;
    onStatus?: (relPath: string, status: SyncStatus) => void;
    onProgress?: (done: number, total: number) => void;
    signal?: AbortSignal;
}
interface SyncResult {
    downloaded: number;
    uploaded: number;
    deleted: number;
    conflicts: string[];
    errors: Array<{
        path: string;
        error: string;
    }>;
}
declare class SyncEngine {
    private remote;
    private remotePath;
    private local;
    private localPath;
    /** live per-path status (rel → status), readable by the UI between syncs. */
    readonly statuses: Map<string, SyncStatus>;
    private running;
    constructor(remote: Drive, remotePath: string, local: Drive, localPath: string);
    status(rel: string): SyncStatus;
    sync(opts?: SyncOptions): Promise<SyncResult>;
    private download;
    private upload;
    /** Re-stat both sides after an op and store their current mtimes/size. */
    private record;
    private readManifest;
    private writeManifest;
    /** Depth-first relative listing of a tree (paths relative to `root`). */
    private walk;
}

export { CloudDrive, type CloudDriveOptions, type CloudProvider, type DirNode, type Drive, type DriveCapabilities, type DriveEntry, type DriveEvent, type DriveKind, DriveManager, type DriveReadable, type DriveStat, type DriveWritable, type EntryType, type FileNode, IndexedDbDrive, LocalFolderDrive, LocalStorageDrive, MemoryDrive, type SyncDirection, SyncEngine, type SyncOptions, type SyncResult, type SyncStatus, type TokenProvider, type TransferOptions, type TransferProgress, TreeDrive, type TreeNode, dropHandle, loadHandle, localFolderSupported, pickDirectory };
