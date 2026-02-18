/**
 * Type definitions for the VFS-based filesystem.
 * Mirrors Node.js fs module interfaces.
 */
type Encoding = 'utf8' | 'utf-8' | 'ascii' | 'base64' | 'hex' | 'binary';
interface ReadOptions {
    encoding?: Encoding | null;
    flag?: string;
}
interface WriteOptions {
    encoding?: Encoding;
    mode?: number;
    flag?: string;
    flush?: boolean;
}
interface MkdirOptions {
    recursive?: boolean;
    mode?: number;
}
interface RmdirOptions {
    recursive?: boolean;
}
interface RmOptions {
    recursive?: boolean;
    force?: boolean;
}
interface ReaddirOptions {
    encoding?: Encoding | null;
    withFileTypes?: boolean;
}
interface Stats {
    isFile(): boolean;
    isDirectory(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isSymbolicLink(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
    dev: number;
    ino: number;
    mode: number;
    nlink: number;
    uid: number;
    gid: number;
    rdev: number;
    size: number;
    blksize: number;
    blocks: number;
    atimeMs: number;
    mtimeMs: number;
    ctimeMs: number;
    birthtimeMs: number;
    atime: Date;
    mtime: Date;
    ctime: Date;
    birthtime: Date;
}
interface Dirent {
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isSymbolicLink(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
}
type PathLike = string;
interface ReadStreamOptions {
    flags?: string;
    encoding?: Encoding | null;
    fd?: number | null;
    mode?: number;
    autoClose?: boolean;
    emitClose?: boolean;
    start?: number;
    end?: number;
    highWaterMark?: number;
}
interface WriteStreamOptions {
    flags?: string;
    encoding?: Encoding;
    fd?: number | null;
    mode?: number;
    autoClose?: boolean;
    emitClose?: boolean;
    start?: number;
    highWaterMark?: number;
    flush?: boolean;
}
interface WatchOptions {
    persistent?: boolean;
    recursive?: boolean;
    encoding?: Encoding;
    signal?: AbortSignal;
}
interface WatchFileOptions {
    persistent?: boolean;
    interval?: number;
}
interface WatchEventType {
    eventType: 'rename' | 'change';
    filename: string | null;
}
interface FileHandle {
    fd: number;
    read(buffer: Uint8Array, offset?: number, length?: number, position?: number | null): Promise<{
        bytesRead: number;
        buffer: Uint8Array;
    }>;
    write(buffer: Uint8Array, offset?: number, length?: number, position?: number | null): Promise<{
        bytesWritten: number;
        buffer: Uint8Array;
    }>;
    readFile(options?: ReadOptions | Encoding | null): Promise<Uint8Array | string>;
    writeFile(data: Uint8Array | string, options?: WriteOptions | Encoding): Promise<void>;
    truncate(len?: number): Promise<void>;
    stat(): Promise<Stats>;
    sync(): Promise<void>;
    datasync(): Promise<void>;
    close(): Promise<void>;
}
interface Dir {
    path: string;
    read(): Promise<Dirent | null>;
    close(): Promise<void>;
    [Symbol.asyncIterator](): AsyncIterableIterator<Dirent>;
}
interface FSWatcher {
    close(): void;
    ref(): this;
    unref(): this;
}
type WatchListener = (eventType: 'rename' | 'change', filename: string | null) => void;
type WatchFileListener = (curr: Stats, prev: Stats) => void;
/** Filesystem operating mode:
 *  - 'hybrid' (default): VFS binary + bidirectional OPFS sync. Best of both worlds.
 *  - 'vfs': VFS binary only, no OPFS mirroring. Fastest, but data lives only in .vfs.bin.
 *  - 'opfs': Pure OPFS files, no VFS binary. Slowest but most resilient.
 *    Automatically selected as fallback when VFS corruption is detected in hybrid mode.
 */
type FSMode = 'hybrid' | 'vfs' | 'opfs';
/** VFS configuration options */
interface VFSConfig {
    root?: string;
    /** Filesystem mode. Defaults to 'hybrid'. */
    mode?: FSMode;
    /** @deprecated Use `mode` instead. When set, overrides mode's OPFS sync behavior. */
    opfsSync?: boolean;
    opfsSyncRoot?: string;
    uid?: number;
    gid?: number;
    umask?: number;
    strictPermissions?: boolean;
    sabSize?: number;
    debug?: boolean;
    /** Scope for the internal service worker registration. Defaults to
     *  `'./opfs-fs-sw/'` (relative to the SW script URL) so it won't collide
     *  with the host application's service worker. */
    swScope?: string;
}

type AsyncRequestFn = (op: number, path: string, flags?: number, data?: Uint8Array | string | null, path2?: string, fdArgs?: Record<string, unknown>) => Promise<{
    status: number;
    data: Uint8Array | null;
}>;

declare class VFSFileSystem {
    private sab;
    private ctrl;
    private readySab;
    private readySignal;
    private asyncSab;
    private hasSAB;
    private syncWorker;
    private asyncWorker;
    private asyncCallId;
    private asyncPending;
    private readyPromise;
    private resolveReady;
    private rejectReady;
    private initError;
    private isReady;
    private config;
    private tabId;
    private _mode;
    private corruptionError;
    /** Namespace string derived from root — used for lock names, BroadcastChannel, and SW scope
     *  so multiple VFS instances with different roots don't collide. */
    private ns;
    private swReg;
    private isFollower;
    private holdingLeaderLock;
    private brokerInitialized;
    private leaderChangeBc;
    private _sync;
    private _async;
    readonly promises: VFSPromises;
    constructor(config?: VFSConfig);
    /** Spawn workers and establish communication */
    private bootstrap;
    /** Use Web Locks API for leader election. The tab that acquires the lock is
     *  the leader; all others become followers. When the leader dies, the browser
     *  releases the lock and the next waiting tab is promoted. */
    private acquireLeaderLock;
    /** Queue for leader takeover when the current leader's lock is released */
    private waitForLeaderLock;
    /** Send init-leader message to sync-relay worker */
    private sendLeaderInit;
    /** Send init-opfs message to sync-relay for OPFS-direct mode */
    private sendOPFSInit;
    /** Handle VFS corruption: log error, fall back to OPFS-direct mode.
     *  The readyPromise will resolve once OPFS mode is ready, but init()
     *  will reject with the corruption error to inform the caller. */
    private handleCorruptVFS;
    /** Start as leader — tell sync-relay to init VFS engine + OPFS handle */
    private startAsLeader;
    /** Start as follower — connect to leader via service worker port brokering */
    private startAsFollower;
    /** Send a new port to sync-relay for connecting to the current leader */
    private connectToLeader;
    /** Register the VFS service worker and return the active SW */
    private getServiceWorker;
    /** Register as leader with SW broker (receives follower ports via control channel) */
    private initLeaderBroker;
    /** Promote from follower to leader (after leader tab dies and lock is acquired) */
    private promoteToLeader;
    /** Spawn an inline worker from bundled code */
    private spawnWorker;
    /** Block until workers are ready */
    private ensureReady;
    /** Send a sync request via SAB and wait for response */
    private syncRequest;
    private asyncRequest;
    readFileSync(filePath: string, options?: ReadOptions | Encoding | null): string | Uint8Array;
    writeFileSync(filePath: string, data: string | Uint8Array, options?: WriteOptions | Encoding): void;
    appendFileSync(filePath: string, data: string | Uint8Array, options?: WriteOptions | Encoding): void;
    existsSync(filePath: string): boolean;
    mkdirSync(filePath: string, options?: MkdirOptions | number): string | undefined;
    rmdirSync(filePath: string, options?: RmdirOptions): void;
    rmSync(filePath: string, options?: RmOptions): void;
    unlinkSync(filePath: string): void;
    readdirSync(filePath: string, options?: ReaddirOptions | Encoding | null): string[] | Dirent[];
    statSync(filePath: string): Stats;
    lstatSync(filePath: string): Stats;
    renameSync(oldPath: string, newPath: string): void;
    copyFileSync(src: string, dest: string, mode?: number): void;
    truncateSync(filePath: string, len?: number): void;
    accessSync(filePath: string, mode?: number): void;
    realpathSync(filePath: string): string;
    chmodSync(filePath: string, mode: number): void;
    chownSync(filePath: string, uid: number, gid: number): void;
    utimesSync(filePath: string, atime: Date | number, mtime: Date | number): void;
    symlinkSync(target: string, linkPath: string): void;
    readlinkSync(filePath: string): string;
    linkSync(existingPath: string, newPath: string): void;
    mkdtempSync(prefix: string): string;
    openSync(filePath: string, flags?: string | number, mode?: number): number;
    closeSync(fd: number): void;
    readSync(fd: number, buffer: Uint8Array, offset?: number, length?: number, position?: number | null): number;
    writeSync(fd: number, buffer: Uint8Array, offset?: number, length?: number, position?: number | null): number;
    fstatSync(fd: number): Stats;
    ftruncateSync(fd: number, len?: number): void;
    fdatasyncSync(fd: number): void;
    watch(filePath: string, options?: WatchOptions | Encoding, listener?: WatchListener): FSWatcher;
    watchFile(filePath: string, optionsOrListener?: WatchFileOptions | WatchFileListener, listener?: WatchFileListener): void;
    unwatchFile(filePath: string, listener?: WatchFileListener): void;
    createReadStream(filePath: string, options?: ReadStreamOptions | string): ReadableStream<Uint8Array>;
    createWriteStream(filePath: string, options?: WriteStreamOptions | string): WritableStream<Uint8Array>;
    flushSync(): void;
    purgeSync(): void;
    /** The current filesystem mode. Changes to 'opfs' on corruption fallback. */
    get mode(): FSMode;
    /** Async init helper — avoid blocking main thread.
     *  Rejects with corruption error if VFS was corrupt (but system falls back to OPFS mode).
     *  Callers can catch and continue — the fs API works in OPFS mode after rejection. */
    init(): Promise<void>;
    /** Switch the filesystem mode at runtime.
     *
     *  Typical flow for IDE corruption recovery:
     *  1. `await fs.init()` throws with corruption error (auto-falls back to opfs)
     *  2. IDE shows warning, user clicks "Repair" → call `repairVFS(root, fs)`
     *  3. After repair: `await fs.setMode('hybrid')` to resume normal VFS+OPFS mode
     *
     *  Returns a Promise that resolves when the new mode is ready. */
    setMode(newMode: FSMode): Promise<void>;
}
declare class VFSPromises {
    private _async;
    private _ns;
    constructor(asyncRequest: AsyncRequestFn, ns: string);
    readFile(filePath: string, options?: ReadOptions | Encoding | null): Promise<string | Uint8Array<ArrayBufferLike>>;
    writeFile(filePath: string, data: string | Uint8Array, options?: WriteOptions | Encoding): Promise<void>;
    appendFile(filePath: string, data: string | Uint8Array, options?: WriteOptions | Encoding): Promise<void>;
    mkdir(filePath: string, options?: MkdirOptions | number): Promise<string | undefined>;
    rmdir(filePath: string, options?: RmdirOptions): Promise<void>;
    rm(filePath: string, options?: RmOptions): Promise<void>;
    unlink(filePath: string): Promise<void>;
    readdir(filePath: string, options?: ReaddirOptions | Encoding | null): Promise<string[] | Dirent[]>;
    stat(filePath: string): Promise<Stats>;
    lstat(filePath: string): Promise<Stats>;
    access(filePath: string, mode?: number): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
    copyFile(src: string, dest: string, mode?: number): Promise<void>;
    truncate(filePath: string, len?: number): Promise<void>;
    realpath(filePath: string): Promise<string>;
    exists(filePath: string): Promise<boolean>;
    chmod(filePath: string, mode: number): Promise<void>;
    chown(filePath: string, uid: number, gid: number): Promise<void>;
    utimes(filePath: string, atime: Date | number, mtime: Date | number): Promise<void>;
    symlink(target: string, linkPath: string): Promise<void>;
    readlink(filePath: string): Promise<string>;
    link(existingPath: string, newPath: string): Promise<void>;
    open(filePath: string, flags?: string | number, mode?: number): Promise<FileHandle>;
    opendir(filePath: string): Promise<Dir>;
    mkdtemp(prefix: string): Promise<string>;
    watch(filePath: string, options?: WatchOptions): AsyncIterable<WatchEventType>;
    flush(): Promise<void>;
    purge(): Promise<void>;
}

/**
 * File system constants matching Node.js fs.constants
 */
declare const constants: {
    readonly F_OK: 0;
    readonly R_OK: 4;
    readonly W_OK: 2;
    readonly X_OK: 1;
    readonly COPYFILE_EXCL: 1;
    readonly COPYFILE_FICLONE: 2;
    readonly COPYFILE_FICLONE_FORCE: 4;
    readonly O_RDONLY: 0;
    readonly O_WRONLY: 1;
    readonly O_RDWR: 2;
    readonly O_CREAT: 64;
    readonly O_EXCL: 128;
    readonly O_TRUNC: 512;
    readonly O_APPEND: 1024;
    readonly O_SYNC: 4096;
    readonly S_IFMT: 61440;
    readonly S_IFREG: 32768;
    readonly S_IFDIR: 16384;
    readonly S_IFCHR: 8192;
    readonly S_IFBLK: 24576;
    readonly S_IFIFO: 4096;
    readonly S_IFLNK: 40960;
    readonly S_IFSOCK: 49152;
    readonly S_IRWXU: 448;
    readonly S_IRUSR: 256;
    readonly S_IWUSR: 128;
    readonly S_IXUSR: 64;
    readonly S_IRWXG: 56;
    readonly S_IRGRP: 32;
    readonly S_IWGRP: 16;
    readonly S_IXGRP: 8;
    readonly S_IRWXO: 7;
    readonly S_IROTH: 4;
    readonly S_IWOTH: 2;
    readonly S_IXOTH: 1;
};

/**
 * Node.js compatible filesystem error classes
 */
declare class FSError extends Error {
    code: string;
    errno: number;
    syscall?: string;
    path?: string;
    constructor(code: string, errno: number, message: string, syscall?: string, path?: string);
}
declare function createError(code: string, syscall: string, path: string): FSError;
declare function statusToError(status: number, syscall: string, path: string): FSError;

/**
 * VFS Helper Functions
 *
 * Standalone utilities for VFS maintenance:
 * - unpackToOPFS: Export VFS contents to real OPFS files
 * - loadFromOPFS: Rebuild VFS from real OPFS files
 * - repairVFS: Attempt to recover files from a corrupt VFS binary
 *
 * Each function accepts an optional `fs` parameter (a running VFSFileSystem
 * instance). When provided, operations go through the VFS worker which holds
 * the exclusive sync handle on .vfs.bin. This allows these functions to work
 * from the main thread while the VFS is running.
 *
 * When `fs` is NOT provided, spawns a repair worker that uses
 * createSyncAccessHandle for direct disk I/O (no RAM bloat).
 */
/**
 * Minimal FS interface accepted by the helper functions.
 * Compatible with VFSFileSystem — avoids circular import.
 */
interface FsLike {
    readFileSync(path: string, options?: any): any;
    writeFileSync(path: string, data: any, options?: any): void;
    mkdirSync(path: string, options?: any): any;
    readdirSync(path: string, options?: any): any;
    rmSync(path: string, options?: any): void;
    statSync(path: string): any;
    symlinkSync?(target: string, path: string): void;
}
interface UnpackResult {
    files: number;
    directories: number;
}
/**
 * Unpack VFS contents to real OPFS files.
 *
 * When `fs` is provided: reads VFS via the running instance (communicates
 * with VFS worker), writes to OPFS additively (no deletions).
 *
 * When `fs` is NOT provided: opens .vfs.bin directly via VFSEngine,
 * clears OPFS (except .vfs.bin), then writes all entries.
 * Requires VFS to be stopped or a Worker context.
 */
declare function unpackToOPFS(root?: string, fs?: FsLike): Promise<UnpackResult>;
interface LoadResult {
    files: number;
    directories: number;
}
/**
 * Load all real OPFS files into VFS.
 *
 * When `fs` is provided: reads OPFS files, clears VFS, writes to VFS via
 * the running instance. Never touches .vfs.bin directly.
 *
 * When `fs` is NOT provided: reads OPFS files, deletes .vfs.bin, creates
 * fresh VFS via VFSEngine. Requires VFS to be stopped or a Worker context.
 */
declare function loadFromOPFS(root?: string, fs?: FsLike): Promise<LoadResult>;
interface RepairResult {
    recovered: number;
    lost: number;
    entries: Array<{
        path: string;
        type: 'file' | 'directory' | 'symlink';
        size: number;
        /** true when the inode was found but data blocks were out of bounds (content lost) */
        contentLost?: boolean;
    }>;
}
/**
 * Attempt to repair a VFS.
 *
 * When `fs` is provided: rebuilds VFS from OPFS files (non-destructive read
 * of OPFS), then syncs repaired VFS back to OPFS (additive, no deletions).
 * This is the safe path — OPFS is the source of truth.
 *
 * When `fs` is NOT provided: scans raw .vfs.bin for recoverable inodes,
 * creates fresh VFS with recovered data. For corrupt VFS where init failed.
 */
declare function repairVFS(root?: string, fs?: FsLike): Promise<RepairResult>;

/**
 * POSIX path utilities (browser-compatible).
 * No Node.js dependencies.
 */
declare const sep = "/";
declare const delimiter = ":";
declare function normalize(p: string): string;
declare function join(...paths: string[]): string;
declare function resolve(...paths: string[]): string;
declare function dirname(p: string): string;
declare function basename(p: string, ext?: string): string;
declare function extname(p: string): string;
declare function isAbsolute(p: string): boolean;
declare function relative(from: string, to: string): string;
declare function parse(p: string): {
    root: string;
    dir: string;
    base: string;
    ext: string;
    name: string;
};
declare function format(obj: {
    root?: string;
    dir?: string;
    base?: string;
    ext?: string;
    name?: string;
}): string;

declare const path_basename: typeof basename;
declare const path_delimiter: typeof delimiter;
declare const path_dirname: typeof dirname;
declare const path_extname: typeof extname;
declare const path_format: typeof format;
declare const path_isAbsolute: typeof isAbsolute;
declare const path_join: typeof join;
declare const path_normalize: typeof normalize;
declare const path_parse: typeof parse;
declare const path_relative: typeof relative;
declare const path_resolve: typeof resolve;
declare const path_sep: typeof sep;
declare namespace path {
  export { path_basename as basename, path_delimiter as delimiter, path_dirname as dirname, path_extname as extname, path_format as format, path_isAbsolute as isAbsolute, path_join as join, path_normalize as normalize, path_parse as parse, path_relative as relative, path_resolve as resolve, path_sep as sep };
}

/** Create a configured VFS instance */
declare function createFS(config?: VFSConfig): VFSFileSystem;
/** Get (or create) the default VFS singleton */
declare function getDefaultFS(): VFSFileSystem;
/** Async init helper — avoids blocking main thread */
declare function init(): Promise<void>;

export { type Dir, type Dirent, type Encoding, FSError, type FSMode, type FSWatcher, type FileHandle, type LoadResult, type MkdirOptions, type PathLike, type ReadOptions, type ReadStreamOptions, type ReaddirOptions, type RepairResult, type RmOptions, type RmdirOptions, type Stats, type UnpackResult, type VFSConfig, VFSFileSystem, type WatchEventType, type WatchFileListener, type WatchListener, type WatchOptions, type WriteOptions, type WriteStreamOptions, constants, createError, createFS, getDefaultFS, init, loadFromOPFS, path, repairVFS, statusToError, unpackToOPFS };
