/**
 * Type definitions for the VFS-based filesystem.
 * Mirrors Node.js fs module interfaces.
 */
type Encoding = 'utf8' | 'utf-8' | 'ascii' | 'base64' | 'hex' | 'binary' | 'latin1' | 'ucs2' | 'ucs-2' | 'utf16le' | 'utf-16le' | 'buffer';
interface ReadOptions {
    encoding?: Encoding | null;
    flag?: string;
    signal?: AbortSignal;
}
interface WriteOptions {
    encoding?: Encoding;
    mode?: number;
    flag?: string;
    flush?: boolean;
    signal?: AbortSignal;
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
    maxRetries?: number;
    retryDelay?: number;
}
interface CpOptions {
    /** Dereference symlinks (default: false) */
    dereference?: boolean;
    /** Throw if destination exists (default: false) */
    errorOnExist?: boolean;
    /** Overwrite existing files/directories (default: true) */
    force?: boolean;
    /** Preserve timestamps from source (default: false) */
    preserveTimestamps?: boolean;
    /** Copy directories recursively (required for directories) */
    recursive?: boolean;
}
interface ReaddirOptions {
    encoding?: Encoding | null;
    withFileTypes?: boolean;
    recursive?: boolean;
}
interface StatOptions {
    bigint?: boolean;
}
interface BigIntStats {
    isFile(): boolean;
    isDirectory(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isSymbolicLink(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
    dev: bigint;
    ino: bigint;
    mode: bigint;
    nlink: bigint;
    uid: bigint;
    gid: bigint;
    rdev: bigint;
    size: bigint;
    blksize: bigint;
    blocks: bigint;
    atimeMs: bigint;
    mtimeMs: bigint;
    ctimeMs: bigint;
    birthtimeMs: bigint;
    atime: Date;
    mtime: Date;
    ctime: Date;
    birthtime: Date;
    atimeNs: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
    birthtimeNs: bigint;
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
    atimeNs: number;
    mtimeNs: number;
    ctimeNs: number;
    birthtimeNs: number;
}
interface Dirent {
    name: string;
    /** The directory path that was read (Node 20+). */
    parentPath: string;
    /** @deprecated Alias for `parentPath`. */
    path: string;
    isFile(): boolean;
    isDirectory(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isSymbolicLink(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
}
interface StatFs {
    type: number;
    bsize: number;
    blocks: number;
    bfree: number;
    bavail: number;
    files: number;
    ffree: number;
}
interface GlobOptions {
    /** Base directory to resolve relative patterns against. Default: '/' */
    cwd?: string | URL;
    /**
     * Exclude callback. Called with every candidate path (for `withFileTypes`,
     * called with a Dirent). Returning truthy drops the entry. Matches Node's
     * `fs.glob` behavior.
     */
    exclude?: ((path: string) => boolean) | ((dirent: Dirent) => boolean);
    /** Return Dirent objects instead of path strings. Default: false */
    withFileTypes?: boolean;
}
type PathLike = string | Uint8Array | URL;
interface OpenAsBlobOptions {
    type?: string;
}
interface FSReadStream {
    /** The file path being read. */
    path: string;
    /** Total bytes read so far. */
    bytesRead: number;
    /** Whether the stream is still readable. */
    readable: boolean;
    on(event: string, fn: (...args: unknown[]) => void): this;
    addListener(event: string, fn: (...args: unknown[]) => void): this;
    once(event: string, fn: (...args: unknown[]) => void): this;
    off(event: string, fn: (...args: unknown[]) => void): this;
    removeListener(event: string, fn: (...args: unknown[]) => void): this;
    removeAllListeners(event?: string): this;
    emit(event: string, ...args: unknown[]): boolean;
    pipe<T>(dest: T): T;
    pause(): this;
    resume(): this;
    read(size?: number): Uint8Array | null;
    setEncoding(encoding: string): this;
    destroy(err?: Error): this;
}
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
interface FSWriteStream {
    writable: boolean;
    bytesWritten: number;
    path: string;
    cork(): void;
    uncork(): void;
    write(chunk: string | Uint8Array, encodingOrCb?: string | Function, cb?: Function): boolean;
    end(chunk?: string | Uint8Array | Function, encodingOrCb?: string | Function, cb?: Function): this;
    on(event: string, fn: Function): this;
    once(event: string, fn: Function): this;
    off(event: string, fn: Function): this;
    removeListener(event: string, fn: Function): this;
    destroy(err?: Error): this;
    emit(event: string, ...args: unknown[]): boolean;
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
    write(string: string, position?: number, encoding?: string): Promise<{
        bytesWritten: number;
        buffer: Uint8Array;
    }>;
    readv(buffers: Uint8Array[], position?: number | null): Promise<{
        bytesRead: number;
        buffers: Uint8Array[];
    }>;
    writev(buffers: Uint8Array[], position?: number | null): Promise<{
        bytesWritten: number;
        buffers: Uint8Array[];
    }>;
    readFile(options?: ReadOptions | Encoding | null): Promise<Uint8Array | string>;
    writeFile(data: Uint8Array | string, options?: WriteOptions | Encoding): Promise<void>;
    truncate(len?: number): Promise<void>;
    stat(): Promise<Stats>;
    appendFile(data: string | Uint8Array, options?: WriteOptions | Encoding): Promise<void>;
    chmod(mode: number): Promise<void>;
    chown(uid: number, gid: number): Promise<void>;
    utimes(atime: Date | number, mtime: Date | number): Promise<void>;
    sync(): Promise<void>;
    datasync(): Promise<void>;
    close(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
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
/** Upper bounds for VFS validation. Prevents corrupt data from causing OOM/hangs. */
interface VFSLimits {
    /** Maximum number of inodes (default: 4,000,000) */
    maxInodes?: number;
    /** Maximum number of data blocks (default: 4,000,000) */
    maxBlocks?: number;
    /** Maximum path table size in bytes (default: 256MB) */
    maxPathTable?: number;
    /** Maximum total VFS file size in bytes (default: 100GB) */
    maxVFSSize?: number;
    /** Maximum single SAB payload size in bytes (default: 2GB) */
    maxPayload?: number;
}
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
    /** URL of the service worker script. Defaults to `'./workers/service.worker.js'`
     *  relative to `import.meta.url`. Override when the library is bundled and the
     *  default relative URL no longer resolves to the correct location. */
    swUrl?: string;
    /** Scope for the internal service worker registration. Defaults to
     *  `'./${ns}/'` (relative to the SW script URL) so it won't collide
     *  with the host application's service worker. */
    swScope?: string;
    /** Upper bounds for VFS validation (prevents corrupt data from causing OOM/hangs). */
    limits?: VFSLimits;
}

type AsyncRequestFn = (op: number, path: string, flags?: number, data?: Uint8Array | string | null, path2?: string, fdArgs?: Record<string, unknown>) => Promise<{
    status: number;
    data: Uint8Array | null;
}>;

/**
 * VFSFileSystem — main thread API.
 *
 * Provides Node.js-compatible sync and async filesystem methods.
 * Sync methods use SAB + Atomics to block until the server responds.
 * Async methods use postMessage to the async relay worker.
 *
 * On import, workers are spawned immediately. Every method blocks
 * (or waits) until the worker is ready. This is by design — the library
 * primarily runs inside workers where blocking is fine.
 */

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
    /** Initialize the async-relay worker. Called after sync-relay signals ready. */
    private initAsyncRelay;
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
    readFileSync(filePath: PathLike, options?: ReadOptions | Encoding | null): string | Uint8Array;
    writeFileSync(filePath: PathLike, data: string | Uint8Array, options?: WriteOptions | Encoding): void;
    appendFileSync(filePath: PathLike, data: string | Uint8Array, options?: WriteOptions | Encoding): void;
    existsSync(filePath: PathLike): boolean;
    mkdirSync(filePath: PathLike, options?: MkdirOptions | number): string | undefined;
    rmdirSync(filePath: PathLike, options?: RmdirOptions): void;
    rmSync(filePath: PathLike, options?: RmOptions): void;
    unlinkSync(filePath: PathLike): void;
    readdirSync(filePath: PathLike, options?: ReaddirOptions | Encoding | null): string[] | Uint8Array[] | Dirent[];
    globSync(pattern: string | string[], options?: GlobOptions): string[] | Dirent[];
    opendirSync(filePath: PathLike): Dir;
    statSync(filePath: PathLike, options?: StatOptions): Stats | BigIntStats;
    lstatSync(filePath: PathLike, options?: StatOptions): Stats | BigIntStats;
    renameSync(oldPath: PathLike, newPath: PathLike): void;
    copyFileSync(src: PathLike, dest: PathLike, mode?: number): void;
    cpSync(src: PathLike, dest: PathLike, options?: CpOptions): void;
    private _cpAsync;
    truncateSync(filePath: PathLike, len?: number): void;
    accessSync(filePath: PathLike, mode?: number): void;
    realpathSync(filePath: PathLike): string;
    chmodSync(filePath: PathLike, mode: number): void;
    /** Like chmodSync but operates on the symlink itself. In this VFS, delegates to chmodSync. */
    lchmodSync(filePath: string, mode: number): void;
    /** chmod on an open file descriptor. Resolves the fd to its inode on the
     *  server side and mutates the inode's mode bits directly, matching what
     *  native Node's libuv does. */
    fchmodSync(fd: number, mode: number): void;
    chownSync(filePath: PathLike, uid: number, gid: number): void;
    /** Like chownSync but operates on the symlink itself. In this VFS, delegates to chownSync. */
    lchownSync(filePath: string, uid: number, gid: number): void;
    /** chown on an open file descriptor. Mutates the underlying inode's uid/gid. */
    fchownSync(fd: number, uid: number, gid: number): void;
    utimesSync(filePath: PathLike, atime: Date | number, mtime: Date | number): void;
    /** utimes on an open file descriptor. Mutates the underlying inode's atime/mtime. */
    futimesSync(fd: number, atime: Date | number, mtime: Date | number): void;
    /** Like utimesSync but operates on the symlink itself. In this VFS, delegates to utimesSync. */
    lutimesSync(filePath: string, atime: Date | number, mtime: Date | number): void;
    symlinkSync(target: PathLike, linkPath: PathLike, type?: string | null): void;
    readlinkSync(filePath: PathLike, options?: {
        encoding?: string | null;
    } | string | null): string | Uint8Array;
    linkSync(existingPath: PathLike, newPath: PathLike): void;
    mkdtempSync(prefix: string): string;
    openSync(filePath: PathLike, flags?: string | number, mode?: number): number;
    closeSync(fd: number): void;
    readSync(fd: number, bufferOrOptions: Uint8Array | {
        buffer: Uint8Array;
        offset?: number;
        length?: number;
        position?: number | null;
    }, offsetOrOptions?: number | {
        offset?: number;
        length?: number;
        position?: number | null;
    }, length?: number, position?: number | null): number;
    writeSync(fd: number, bufferOrString: Uint8Array | string, offsetOrPositionOrOptions?: number | {
        offset?: number;
        length?: number;
        position?: number | null;
    }, lengthOrEncoding?: number | string, position?: number | null): number;
    fstatSync(fd: number, options?: StatOptions): Stats | BigIntStats;
    ftruncateSync(fd: number, len?: number): void;
    fdatasyncSync(fd: number): void;
    fsyncSync(fd: number): void;
    readvSync(fd: number, buffers: Uint8Array[], position?: number | null): number;
    writevSync(fd: number, buffers: Uint8Array[], position?: number | null): number;
    readv(fd: number, buffers: Uint8Array[], position: number | null | undefined, callback: (err: Error | null, bytesRead?: number, buffers?: Uint8Array[]) => void): void;
    readv(fd: number, buffers: Uint8Array[], callback: (err: Error | null, bytesRead?: number, buffers?: Uint8Array[]) => void): void;
    writev(fd: number, buffers: Uint8Array[], position: number | null | undefined, callback: (err: Error | null, bytesWritten?: number, buffers?: Uint8Array[]) => void): void;
    writev(fd: number, buffers: Uint8Array[], callback: (err: Error | null, bytesWritten?: number, buffers?: Uint8Array[]) => void): void;
    statfsSync(_path?: string): StatFs;
    statfs(path: string, callback: (err: Error | null, stats?: StatFs) => void): void;
    statfs(path: string): Promise<StatFs>;
    watch(filePath: PathLike, options?: WatchOptions | Encoding, listener?: WatchListener): FSWatcher;
    watchFile(filePath: PathLike, optionsOrListener?: WatchFileOptions | WatchFileListener, listener?: WatchFileListener): void;
    unwatchFile(filePath: PathLike, listener?: WatchFileListener): void;
    openAsBlob(filePath: string, options?: OpenAsBlobOptions): Promise<Blob>;
    createReadStream(filePath: PathLike, options?: ReadStreamOptions | string): FSReadStream;
    createWriteStream(filePath: PathLike, options?: WriteStreamOptions | string): FSWriteStream;
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
    private _validateCb;
    /** Adapt a promise to optional Node.js callback style.
     *  If cb is a function: calls cb(err, result) via setTimeout. Returns void.
     *  If cb is missing: returns the promise (allows .then() or await). */
    private _cb;
    /** Like _cb but for void-returning promises (no result value). */
    private _cbVoid;
    readFile(filePath: string, callback: (err: Error | null, data?: Uint8Array | string) => void): void;
    readFile(filePath: string, options: ReadOptions | Encoding | null, callback: (err: Error | null, data?: Uint8Array | string) => void): void;
    writeFile(filePath: string, data: string | Uint8Array, callback: (err: Error | null) => void): void;
    writeFile(filePath: string, data: string | Uint8Array, options: WriteOptions | Encoding, callback: (err: Error | null) => void): void;
    appendFile(filePath: string, data: string | Uint8Array, callback: (err: Error | null) => void): void;
    appendFile(filePath: string, data: string | Uint8Array, options: WriteOptions | Encoding, callback: (err: Error | null) => void): void;
    mkdir(filePath: string, callback: (err: Error | null, path?: string) => void): void;
    mkdir(filePath: string, options: MkdirOptions | number, callback: (err: Error | null, path?: string) => void): void;
    rmdir(filePath: string, callback: (err: Error | null) => void): void;
    rmdir(filePath: string, options: RmdirOptions, callback: (err: Error | null) => void): void;
    rm(filePath: string, callback: (err: Error | null) => void): void;
    rm(filePath: string, options: RmOptions, callback: (err: Error | null) => void): void;
    unlink(filePath: string, callback?: (err: Error | null) => void): any;
    readdir(filePath: string, callback: (err: Error | null, files?: string[] | Dirent[]) => void): void;
    readdir(filePath: string, options: ReaddirOptions | Encoding | null, callback: (err: Error | null, files?: string[] | Dirent[]) => void): void;
    stat(filePath: string, callback: (err: Error | null, stats?: Stats | BigIntStats) => void): void;
    stat(filePath: string, options: StatOptions, callback: (err: Error | null, stats?: Stats | BigIntStats) => void): void;
    lstat(filePath: string, callback: (err: Error | null, stats?: Stats | BigIntStats) => void): void;
    lstat(filePath: string, options: StatOptions, callback: (err: Error | null, stats?: Stats | BigIntStats) => void): void;
    access(filePath: string, callback: (err: Error | null) => void): void;
    access(filePath: string, mode: number, callback: (err: Error | null) => void): void;
    rename(oldPath: string, newPath: string, callback?: (err: Error | null) => void): any;
    copyFile(src: string, dest: string, callback: (err: Error | null) => void): void;
    copyFile(src: string, dest: string, mode: number, callback: (err: Error | null) => void): void;
    truncate(filePath: string, callback: (err: Error | null) => void): void;
    truncate(filePath: string, len: number, callback: (err: Error | null) => void): void;
    realpath(filePath: string, callback?: (err: Error | null, resolvedPath?: string) => void): any;
    chmod(filePath: string, mode: number, callback?: (err: Error | null) => void): any;
    chown(filePath: string, uid: number, gid: number, callback?: (err: Error | null) => void): any;
    utimes(filePath: string, atime: Date | number, mtime: Date | number, callback?: (err: Error | null) => void): any;
    symlink(target: string, linkPath: string, callback: (err: Error | null) => void): void;
    symlink(target: string, linkPath: string, type: string | null, callback: (err: Error | null) => void): void;
    readlink(filePath: string, callback: (err: Error | null, linkString?: string | Uint8Array) => void): void;
    readlink(filePath: string, options: {
        encoding?: string | null;
    } | string | null, callback: (err: Error | null, linkString?: string | Uint8Array) => void): void;
    link(existingPath: string, newPath: string, callback?: (err: Error | null) => void): any;
    open(filePath: string, flags: string | number, callback: (err: Error | null, fd?: number) => void): void;
    open(filePath: string, flags: string | number, mode: number, callback: (err: Error | null, fd?: number) => void): void;
    mkdtemp(prefix: string, callback?: (err: Error | null, folder?: string) => void): any;
    cp(src: string, dest: string, callback: (err: Error | null) => void): void;
    cp(src: string, dest: string, options: CpOptions, callback: (err: Error | null) => void): void;
    fdatasync(fd: number, callback?: (err: Error | null) => void): void;
    fsync(fd: number, callback?: (err: Error | null) => void): void;
    fstat(fd: number, callback: (err: Error | null, stats?: Stats | BigIntStats) => void): void;
    fstat(fd: number, options: any, callback: (err: Error | null, stats?: Stats | BigIntStats) => void): void;
    ftruncate(fd: number, callback: (err: Error | null) => void): void;
    ftruncate(fd: number, len: number, callback: (err: Error | null) => void): void;
    read(fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null, callback: (err: Error | null, bytesRead?: number, buffer?: Uint8Array) => void): void;
    read(fd: number, options: {
        buffer: Uint8Array;
        offset?: number;
        length?: number;
        position?: number | null;
    }, callback: (err: Error | null, bytesRead?: number, buffer?: Uint8Array) => void): void;
    write(fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null, callback: (err: Error | null, bytesWritten?: number, buffer?: Uint8Array) => void): void;
    write(fd: number, data: string, position: number | null | undefined, encoding: string | undefined, callback: (err: Error | null, bytesWritten?: number, data?: string) => void): void;
    close(fd: number, callback?: (err: Error | null) => void): void;
    exists(filePath: string, callback?: (exists: boolean) => void): any;
    opendir(filePath: string, callback?: (err: Error | null, dir?: Dir) => void): any;
    glob(pattern: string, callback: (err: Error | null, matches?: string[]) => void): void;
    glob(pattern: string, options: GlobOptions, callback: (err: Error | null, matches?: string[]) => void): void;
    futimes(fd: number, atime: Date | number, mtime: Date | number, callback?: (err: Error | null) => void): void;
    fchmod(fd: number, mode: number, callback?: (err: Error | null) => void): void;
    fchown(fd: number, uid: number, gid: number, callback?: (err: Error | null) => void): void;
    lchmod(filePath: string, mode: number, callback?: (err: Error | null) => void): any;
    lchown(filePath: string, uid: number, gid: number, callback?: (err: Error | null) => void): any;
    lutimes(filePath: string, atime: Date | number, mtime: Date | number, callback?: (err: Error | null) => void): any;
}
declare class VFSPromises {
    private _async;
    private _ns;
    constructor(asyncRequest: AsyncRequestFn, ns: string);
    /** Node.js compat: fs.promises.constants (same as fs.constants) */
    get constants(): {
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
        readonly O_NOCTTY: 256;
        readonly O_NONBLOCK: 2048;
        readonly O_SYNC: 4096;
        readonly O_DSYNC: 4096;
        readonly O_DIRECTORY: 65536;
        readonly O_NOFOLLOW: 131072;
        readonly O_NOATIME: 262144;
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
    readFile(filePath: PathLike, options?: ReadOptions | Encoding | null): Promise<string | Uint8Array<ArrayBufferLike>>;
    writeFile(filePath: PathLike, data: string | Uint8Array, options?: WriteOptions | Encoding): Promise<void>;
    appendFile(filePath: PathLike, data: string | Uint8Array, options?: WriteOptions | Encoding): Promise<void>;
    mkdir(filePath: PathLike, options?: MkdirOptions | number): Promise<string | undefined>;
    rmdir(filePath: PathLike, options?: RmdirOptions): Promise<void>;
    rm(filePath: PathLike, options?: RmOptions): Promise<void>;
    unlink(filePath: PathLike): Promise<void>;
    readdir(filePath: PathLike, options?: ReaddirOptions | Encoding | null): Promise<Uint8Array<ArrayBufferLike>[] | string[] | Dirent[]>;
    glob(pattern: string | string[], options?: GlobOptions): Promise<string[] | Dirent[]>;
    stat(filePath: PathLike, options?: StatOptions): Promise<BigIntStats | Stats>;
    lstat(filePath: PathLike, options?: StatOptions): Promise<BigIntStats | Stats>;
    access(filePath: PathLike, mode?: number): Promise<void>;
    rename(oldPath: PathLike, newPath: PathLike): Promise<void>;
    copyFile(src: PathLike, dest: PathLike, mode?: number): Promise<void>;
    cp(src: PathLike, dest: PathLike, options?: CpOptions): Promise<void>;
    truncate(filePath: PathLike, len?: number): Promise<void>;
    realpath(filePath: PathLike): Promise<string>;
    exists(filePath: PathLike): Promise<boolean>;
    chmod(filePath: PathLike, mode: number): Promise<void>;
    /** Like chmod but operates on the symlink itself. In this VFS, delegates to chmod. */
    lchmod(filePath: string, mode: number): Promise<void>;
    /** chmod on an open file descriptor. Engine resolves fd → inode and
     *  mutates the mode bits directly. */
    fchmod(fd: number, mode: number): Promise<void>;
    chown(filePath: PathLike, uid: number, gid: number): Promise<void>;
    /** Like chown but operates on the symlink itself. In this VFS, delegates to chown. */
    lchown(filePath: string, uid: number, gid: number): Promise<void>;
    /** chown on an open file descriptor. Engine resolves fd → inode and
     *  mutates uid/gid directly. */
    fchown(fd: number, uid: number, gid: number): Promise<void>;
    utimes(filePath: PathLike, atime: Date | number, mtime: Date | number): Promise<void>;
    /** utimes on an open file descriptor. Engine resolves fd → inode and
     *  mutates atime/mtime directly. */
    futimes(fd: number, atime: Date | number, mtime: Date | number): Promise<void>;
    /** Like utimes but operates on the symlink itself. In this VFS, delegates to utimes. */
    lutimes(filePath: string, atime: Date | number, mtime: Date | number): Promise<void>;
    symlink(target: PathLike, linkPath: PathLike, type?: string | null): Promise<void>;
    readlink(filePath: PathLike, options?: {
        encoding?: string | null;
    } | string | null): Promise<string | Uint8Array<ArrayBufferLike>>;
    link(existingPath: PathLike, newPath: PathLike): Promise<void>;
    open(filePath: PathLike, flags?: string | number, mode?: number): Promise<FileHandle>;
    opendir(filePath: PathLike): Promise<Dir>;
    mkdtemp(prefix: string): Promise<string>;
    openAsBlob(filePath: string, options?: OpenAsBlobOptions): Promise<Blob>;
    statfs(path: string): Promise<StatFs>;
    watch(filePath: string, options?: WatchOptions): AsyncIterable<WatchEventType>;
    fstat(fd: number, options?: StatOptions): Promise<Stats | BigIntStats>;
    ftruncate(fd: number, len?: number): Promise<void>;
    fsync(_fd: number): Promise<void>;
    fdatasync(_fd: number): Promise<void>;
    flush(): Promise<void>;
    purge(): Promise<void>;
}

/**
 * Minimal Node.js-compatible stream classes for use in browser/OPFS environments.
 *
 * These do NOT depend on Node.js built-ins — they provide just enough API surface
 * for libraries that expect `.on('data')`, `.pipe()`, `.write()`, `.end()`, etc.
 */
type Listener = (...args: unknown[]) => void;
declare class SimpleEventEmitter {
    private _listeners;
    private _onceSet;
    on(event: string, fn: Listener): this;
    addListener(event: string, fn: Listener): this;
    once(event: string, fn: Listener): this;
    off(event: string, fn: Listener): this;
    removeListener(event: string, fn: Listener): this;
    removeAllListeners(event?: string): this;
    emit(event: string, ...args: unknown[]): boolean;
    listenerCount(event: string): number;
    rawListeners(event: string): Function[];
    prependListener(event: string, fn: Listener): this;
    prependOnceListener(event: string, fn: Listener): this;
    eventNames(): string[];
}
declare class NodeReadable extends SimpleEventEmitter {
    private _readFn;
    private _paused;
    private _destroyed;
    private _ended;
    private _reading;
    private _readBuffer;
    private _encoding;
    /** Whether the stream is still readable (not ended or destroyed). */
    readable: boolean;
    /** The file path this stream reads from (set externally). */
    path: string;
    /** Total bytes read so far. */
    bytesRead: number;
    /** Optional cleanup callback invoked on destroy (e.g. close file handle). */
    private _destroyFn;
    constructor(_readFn: () => Promise<{
        done: boolean;
        value?: Uint8Array;
    }>, destroyFn?: () => Promise<void>);
    on(event: string, fn: Listener): this;
    pause(): this;
    resume(): this;
    /**
     * Set the character encoding for data read from this stream.
     * When set, 'data' events emit strings instead of Uint8Array.
     */
    setEncoding(encoding: string): this;
    /**
     * Non-flowing read — returns the last buffered chunk or null.
     * Node.js has a complex buffer system; we keep it simple here.
     */
    read(_size?: number): Uint8Array | null;
    /** Destroy the stream, optionally with an error. */
    destroy(err?: Error): this;
    pipe<T extends NodeWritable | WritableStream<Uint8Array>>(dest: T): T;
    private _drain;
}
declare class NodeWritable extends SimpleEventEmitter {
    private _writeFn;
    private _closeFn;
    /** Total bytes written so far. */
    bytesWritten: number;
    /** The file path this stream was created for. */
    readonly path: string;
    /** Whether this stream is still writable. */
    writable: boolean;
    private _destroyed;
    private _finished;
    private _writing;
    private _corked;
    constructor(path: string, _writeFn: (chunk: Uint8Array) => Promise<void>, _closeFn: () => Promise<void>);
    /**
     * Buffer all writes until `uncork()` is called.
     * In this minimal implementation we only track the flag for compatibility.
     */
    cork(): void;
    /**
     * Flush buffered writes (clears the cork flag).
     * In this minimal implementation we only track the flag for compatibility.
     */
    uncork(): void;
    write(chunk: string | Uint8Array, encodingOrCb?: string | ((...args: unknown[]) => void), cb?: (...args: unknown[]) => void): boolean;
    end(chunk?: string | Uint8Array | ((...args: unknown[]) => void), encodingOrCb?: string | ((...args: unknown[]) => void), cb?: (...args: unknown[]) => void): this;
    destroy(err?: Error): this;
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
    readonly O_NOCTTY: 256;
    readonly O_NONBLOCK: 2048;
    readonly O_SYNC: 4096;
    readonly O_DSYNC: 4096;
    readonly O_DIRECTORY: 65536;
    readonly O_NOFOLLOW: 131072;
    readonly O_NOATIME: 262144;
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

/**
 * Normalize a PathLike value (string, Uint8Array, or URL) to a plain string.
 * Mirrors Node.js behaviour: Buffer/Uint8Array is decoded as UTF-8,
 * URL must use the file: protocol and the pathname is used.
 */
declare function toPathString(p: PathLike): string;
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
declare const path_toPathString: typeof toPathString;
declare namespace path {
  export { path_basename as basename, path_delimiter as delimiter, path_dirname as dirname, path_extname as extname, path_format as format, path_isAbsolute as isAbsolute, path_join as join, path_normalize as normalize, path_parse as parse, path_relative as relative, path_resolve as resolve, path_sep as sep, path_toPathString as toPathString };
}

/** Create a configured VFS instance */
declare function createFS(config?: VFSConfig): VFSFileSystem;
/** Get (or create) the default VFS singleton */
declare function getDefaultFS(): VFSFileSystem;
/** Async init helper — avoids blocking main thread */
declare function init(): Promise<void>;

export { type BigIntStats, type CpOptions, type Dir, type Dirent, type Encoding, FSError, type FSMode, type FSReadStream, type FSWatcher, type FSWriteStream, type FileHandle, type LoadResult, type MkdirOptions, NodeReadable, NodeWritable, type OpenAsBlobOptions, type PathLike, type ReadOptions, NodeReadable as ReadStream, type ReadStreamOptions, type ReaddirOptions, type RepairResult, type RmOptions, type RmdirOptions, SimpleEventEmitter, type StatFs, type StatOptions, type Stats, type UnpackResult, type VFSConfig, VFSFileSystem, type VFSLimits, type WatchEventType, type WatchFileListener, type WatchListener, type WatchOptions, type WriteOptions, NodeWritable as WriteStream, type WriteStreamOptions, constants, createError, createFS, getDefaultFS, init, loadFromOPFS, path, repairVFS, statusToError, unpackToOPFS };
