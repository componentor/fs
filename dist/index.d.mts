import { Drive, DriveCapabilities, DriveStat, DriveEntry, DriveReadable, DriveWritable } from './drives-entry.mjs';
export { CloudDrive, CloudDriveOptions, CloudProvider, DirNode, DriveEvent, DriveKind, DriveManager, EntryType, FileNode, IndexedDbDrive, LocalFolderDrive, LocalStorageDrive, MemoryDrive, SyncDirection, SyncEngine, SyncOptions, SyncResult, SyncStatus, TokenProvider, TransferOptions, TransferProgress, TreeDrive, TreeNode, dropHandle, loadHandle, localFolderSupported, pickDirectory } from './drives-entry.mjs';

/**
 * Type definitions for the VFS-based filesystem.
 * Mirrors Node.js fs module interfaces.
 */
type Encoding = 'utf8' | 'utf-8' | 'ascii' | 'base64' | 'base64url' | 'hex' | 'binary' | 'latin1' | 'ucs2' | 'ucs-2' | 'utf16le' | 'utf-16le' | 'buffer';
interface ReadOptions {
    encoding?: Encoding | null;
    flag?: string;
    signal?: AbortSignal;
}
interface WriteOptions {
    encoding?: Encoding;
    /** Honoured on the default ('w') flag path, which chmods the file after writing it. */
    mode?: Mode;
    flag?: string;
    flush?: boolean;
    signal?: AbortSignal;
}
/**
 * A file mode, as Node accepts it: a uint32, or an octal *string* ('0700', '777').
 * Parsed by `parseFileMode` — see [mode.ts](./methods/mode.ts).
 */
type Mode = number | string;
interface MkdirOptions {
    recursive?: boolean;
    mode?: Mode;
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
    /**
     * When `false`, a missing path yields `undefined` instead of throwing ENOENT (Node 14.17+).
     * Widely used to probe for a file without paying for an exception — TypeScript's own compiler
     * host relies on it. Only ENOENT is suppressed; other errors still throw.
     */
    throwIfNoEntry?: boolean;
}
interface BigIntStats$1 {
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
interface Stats$1 {
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
interface Dirent$1 {
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
/** Options for `opendir`/`opendirSync` (node 18.17+ for `recursive`). */
interface OpendirOptions {
    encoding?: string | null;
    /** Read-ahead hint in node; entries arrive in one response here, so it has no effect. */
    bufferSize?: number;
    /** Walk subdirectories too. Was accepted and ignored before. */
    recursive?: boolean;
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
    exclude?: ((path: string) => boolean) | ((dirent: Dirent$1) => boolean);
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
    filename: string | Uint8Array | null;
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
    stat(): Promise<Stats$1>;
    appendFile(data: string | Uint8Array, options?: WriteOptions | Encoding): Promise<void>;
    chmod(mode: number): Promise<void>;
    chown(uid: number, gid: number): Promise<void>;
    utimes(atime: Date | number, mtime: Date | number): Promise<void>;
    sync(): Promise<void>;
    datasync(): Promise<void>;
    close(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
    /** A read stream over this handle. Closes the handle when it ends unless `autoClose: false`. */
    createReadStream(options?: ReadStreamOptions | Encoding): FSReadStream;
    /** A write stream over this handle. Closes the handle on finish unless `autoClose: false`. */
    createWriteStream(options?: WriteStreamOptions | Encoding): FSWriteStream;
    /** The file's lines, as an async iterable. A trailing newline yields no final empty line. */
    readLines(options?: ReadStreamOptions | Encoding): AsyncIterableIterator<string>;
    /** A WHATWG `ReadableStream` of the file's bytes. */
    readableWebStream(options?: {
        type?: 'bytes';
    }): ReadableStream<Uint8Array>;
    on(event: string, listener: (...args: never[]) => void): FileHandle;
    once(event: string, listener: (...args: never[]) => void): FileHandle;
    off(event: string, listener: (...args: never[]) => void): FileHandle;
    removeListener(event: string, listener: (...args: never[]) => void): FileHandle;
    emit(event: string, ...args: never[]): boolean;
}
interface Dir$1 {
    path: string;
    read(): Promise<Dirent$1 | null>;
    close(): Promise<void>;
    [Symbol.asyncIterator](): AsyncIterableIterator<Dirent$1>;
}
interface FSWatcher {
    close(): void;
    ref(): this;
    unref(): this;
}
type WatchListener = (eventType: 'rename' | 'change', filename: string | Uint8Array | null) => void;
type WatchFileListener = (curr: Stats$1, prev: Stats$1) => void;
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
    /** Override the relay worker's `IS_WEBKIT` auto-detection for the three
     *  WebKit-only dispatch-loop workarounds (busy-poll spin, starvation-timer
     *  yield, 5ms-sliced response wait). `undefined` = auto (spin only on WebKit);
     *  `true`/`false` force them on/off — for A/B testing the sync hot path on a
     *  given device without a rebuild. Mirrors the `self.__fs_force_spin` runtime
     *  escape hatch, but settable from the embedding app's config. */
    forceSpin?: boolean;
    /** URL of the service worker script. Defaults to `'./workers/service.worker.js'`
     *  relative to `import.meta.url`. Override when the library is bundled and the
     *  default relative URL no longer resolves to the correct location. */
    swUrl?: string;
    /** Scope for the internal service worker registration. Defaults to
     *  `'./${ns}/'` (relative to the SW script URL) so it won't collide
     *  with the host application's service worker. */
    swScope?: string;
    /**
     * Service-worker broker bridge port, for running a VFS instance INSIDE a
     * worker (e.g. an OS/runtime worker that needs `readFileSync` to work in a
     * follower tab on Safari).
     *
     * `navigator.serviceWorker` is unavailable in worker scopes on Safari and
     * Firefox, so a worker-hosted instance cannot broker its own multi-tab
     * connection. Provide a `MessagePort` whose peer is driven on the main
     * thread by `createServiceWorkerBridge(peerPort, { swUrl, swScope })`; the
     * instance forwards its SW `postMessage`s (with transferred ports) through
     * this port. Return-path messages flow directly through the transferred
     * MessageChannel ports, so the bridge only forwards outbound.
     *
     * Why this matters: a follower's synchronous FS op busy-waits. On the main
     * thread that means a spin-loop, and WebKit gates a worker's MessagePort
     * delivery on the parent main thread's event loop — so the leader's reply
     * can never arrive and the op fails (EIO). In a worker the wait is a real
     * `Atomics.wait`, the main thread stays free to pump delivery, and follower
     * sync works on Safari too.
     */
    swBridge?: MessagePort;
    /** Upper bounds for VFS validation (prevents corrupt data from causing OOM/hangs). */
    limits?: VFSLimits;
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
    /**
     * Carries partial characters between chunks — see {@link createStringDecoder}.
     *
     * Decoding each chunk on its own turned every multi-byte character that straddled a 64 KB
     * chunk boundary into two U+FFFDs.
     */
    private _decoder;
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
    /**
     * `for await (const chunk of stream)`.
     *
     * Node's readables are async iterable, and this one was not — so the ordinary way to consume a
     * read stream threw "stream is not async iterable". Implemented over the event interface with
     * `pause()` between chunks so a slow consumer applies backpressure instead of buffering the
     * whole file.
     *
     * Leaving the loop early (`break`, `return`, or a throw in the body) destroys the stream, which
     * closes the underlying handle — node does the same, and here it matters more: in the browser
     * these are OPFS sync access handles holding an *exclusive* lock, so a leaked one blocks every
     * later open of that file for the lifetime of the page.
     */
    [Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array | string>;
    private _drain;
}
declare class NodeWritable extends SimpleEventEmitter {
    private _writeFn;
    private _closeFn;
    /** Encoding for string chunks written without one — the stream's `encoding` option. */
    private _defaultEncoding;
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
    /**
     * Set synchronously by `end()`, where `_finished` is only set once the queue has drained.
     *
     * Node rejects a write the moment `end()` has been called. Testing `_finished` instead let a
     * late write be accepted and queued, and whether it landed in the file, hit `EBADF`, or wrote
     * past a closed handle depended purely on whether close won the race.
     */
    private _ending;
    /**
     * Serialises queued writes.
     *
     * `_writeFn` reads the stream's current file offset when it runs and advances it by however
     * much it wrote. Firing writes concurrently therefore loses data: two synchronous `write()`
     * calls both started at the same offset, and the second overwrote the first — a plain
     * `ws.write('abc'); ws.write('def')` produced `'def'`. Chaining keeps each write starting
     * where the previous one finished, and lets `end()` wait for the queue to drain before
     * closing the handle, which was the same race one step later.
     */
    private _chain;
    constructor(path: string, _writeFn: (chunk: Uint8Array) => Promise<void>, _closeFn: () => Promise<void>, 
    /** Encoding for string chunks written without one — the stream's `encoding` option. */
    _defaultEncoding?: string);
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

type AsyncRequestFn = (op: number, path: string, flags?: number, data?: Uint8Array | string | null, path2?: string, fdArgs?: Record<string, unknown>) => Promise<{
    status: number;
    data: Uint8Array | null;
}>;

/**
 * `Dir` — the handle returned by `opendir`/`opendirSync`.
 *
 * Previously two separate object literals (one in `methods/opendir.ts`, one inline in
 * `opendirSync`) that between them were missing `readSync()` and `closeSync()`, half of node's
 * `Dir` API. A single class serves both, so the two forms cannot drift apart again.
 *
 * Entries are read eagerly at open. Node's `opendir` opens a real directory handle and streams
 * entries from it; here the entries come from one `readdir`, and reading them up front is what
 * makes the **synchronous** `readSync()` possible on a handle obtained asynchronously. The cost
 * is one extra round trip at open for a caller that opens a directory and never reads it, and
 * one fewer await for every caller that does.
 */

declare class Dir {
    readonly path: string;
    private _entries;
    private _index;
    private _closed;
    private _onClose;
    constructor(path: string, entries: Dirent$1[], onClose?: (() => Promise<void>) | null);
    private _assertOpen;
    /** The next entry, or `null` once the directory is exhausted. */
    read(): Promise<Dirent$1 | null>;
    /** The synchronous form. Was missing entirely. */
    readSync(): Dirent$1 | null;
    close(): Promise<void>;
    /** The synchronous form. Was missing entirely. */
    closeSync(): void;
    [Symbol.asyncIterator](): AsyncIterableIterator<Dirent$1>;
}

/**
 * Field order matters: it is the order `Object.keys` reports, and it matches node's.
 */
declare class Stats {
    #private;
    dev: number;
    mode: number;
    nlink: number;
    uid: number;
    gid: number;
    rdev: number;
    blksize: number;
    ino: number;
    size: number;
    blocks: number;
    atimeMs: number;
    mtimeMs: number;
    ctimeMs: number;
    birthtimeMs: number;
    constructor(dev: number, mode: number, nlink: number, uid: number, gid: number, rdev: number, blksize: number, ino: number, size: number, blocks: number, atimeMs: number, mtimeMs: number, ctimeMs: number, birthtimeMs: number);
    /** node's own helper name, kept so code that pokes at it behaves the same. */
    _checkModeProperty(type: number): boolean;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
    get atime(): Date;
    get mtime(): Date;
    get ctime(): Date;
    get birthtime(): Date;
    get atimeNs(): number;
    get mtimeNs(): number;
    get ctimeNs(): number;
    get birthtimeNs(): number;
}
/**
 * The `{ bigint: true }` form. Node keeps this a separate class, and unlike plain `Stats` it does
 * carry the nanosecond fields as own properties.
 */
declare class BigIntStats {
    #private;
    dev: bigint;
    mode: bigint;
    nlink: bigint;
    uid: bigint;
    gid: bigint;
    rdev: bigint;
    blksize: bigint;
    ino: bigint;
    size: bigint;
    blocks: bigint;
    atimeMs: bigint;
    mtimeMs: bigint;
    ctimeMs: bigint;
    birthtimeMs: bigint;
    atimeNs: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
    birthtimeNs: bigint;
    constructor(dev: bigint, mode: bigint, nlink: bigint, uid: bigint, gid: bigint, rdev: bigint, blksize: bigint, ino: bigint, size: bigint, blocks: bigint, atimeMs: bigint, mtimeMs: bigint, ctimeMs: bigint, birthtimeMs: bigint);
    _checkModeProperty(type: number): boolean;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
    get atime(): Date;
    get mtime(): Date;
    get ctime(): Date;
    get birthtime(): Date;
}
/**
 * A directory entry. Node's own properties are `name` and `parentPath` only. Ours carried `path`
 * as a third own property, so serialising an entry emitted a field node does not.
 *
 * `path` survives here as a prototype **getter** aliasing `parentPath`. Node deprecated it
 * (DEP0178) and removed it outright in v24, but dropping it would break callers that still read
 * it; as a getter it costs nothing per instance and stays out of `Object.keys`/`JSON.stringify`,
 * which is the part of the shape that has to match.
 *
 * Unlike `Stats`, this class is not a speed win: constructing one measures a few nanoseconds
 * *slower* than the object literal it replaced, because the private type slot costs more than
 * the seven closures saved. It is here for `instanceof fs.Dirent`, for node's exact own-property
 * shape, and so that `glob` and `readdir` cannot disagree about what a `Dirent` is — `glob` used
 * to omit `path` entirely.
 */
declare class Dirent {
    #private;
    name: string;
    parentPath: string;
    constructor(name: string, type: number, parentPath: string);
    /** @deprecated Alias of `parentPath`. Node removed this in v24; kept here for compatibility. */
    get path(): string;
    /**
     * The same entry reported under a different parent directory — what recursive `readdir` needs.
     *
     * Copying `isFile`/`isDirectory`/… off the source entry into a new object literal (which is
     * what the recursive walk used to do) only worked while those were per-instance closures. With
     * the predicates on the prototype they read the entry type through `this`, so a bare function
     * reference lands on an object that has no type and reports false for everything.
     */
    withParentPath(parentPath: string): Dirent;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
}

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
    /**
     * `fs.constants` — the flag/mode constants (`F_OK`, `O_CREAT`, `COPYFILE_EXCL`, …).
     *
     * This existed on `fs.promises.constants` but not on the instance, so the single most common
     * form — `fs.access(p, fs.constants.F_OK)` — read a property of `undefined`.
     */
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
    get Stats(): typeof Stats;
    get Dirent(): typeof Dirent;
    get Dir(): typeof Dir;
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
    /** Set by {@link dispose}; makes disposal idempotent. */
    private closed;
    /** The `pagehide` handler, kept so {@link dispose} can unregister it. */
    private onPageHide;
    /** True while a leader transition is in flight (promotion to leader, etc.).
     *  Cleared the moment the new sync-relay signals `ready`. Consumers can
     *  combine this with `isReady` to know when sync FS ops are safe again. */
    private transitioning;
    /** Listeners awaiting the next `ready` signal (used by `whenReady()`). */
    private readyListeners;
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
    private brokerHeartbeatTimer;
    private brokerControlPort;
    private leaderChangeBc;
    private _sync;
    /**
     * Spin cap for the current mode: bounded in `opfs` mode, unbounded otherwise.
     *
     * `undefined` keeps hybrid/vfs behaviour exactly as it was — those service sync requests
     * synchronously in the relay, so a long spin there means a genuinely slow op, not a stall.
     */
    private _opfsSpinCap;
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
    /** Register the VFS service worker and return something that can post
     *  messages to it. When running inside a worker (`swBridge` provided),
     *  returns a proxy that forwards postMessages — including transferred
     *  ports — to a main-thread bridge that owns the real `navigator.serviceWorker`. */
    private getServiceWorker;
    /** Register as leader with SW broker (receives follower ports via control channel).
     *
     *  Re-registers on a heartbeat so the broker survives SW idle-kill. Without this,
     *  a follower opening a tab after the SW has been killed (≥30s idle on Chrome)
     *  sees its `transfer-port` queued in the new SW's `pending` array forever:
     *  the prior leader's `port2` was held by the dead SW instance, the new SW
     *  starts with `serverPort=null`, and the leader has no way to know to
     *  re-register.
     *
     *  Re-posting `register-server` is idempotent in the SW handler — it replaces
     *  `serverPort` and flushes `pending` — so the heartbeat alone unsticks
     *  followers without needing to disturb anyone else. The follower's queued
     *  `mc.port2` rides through the pending-flush, and because it's a
     *  MessageChannel, any messages the follower's sync-relay had already posted
     *  on `port1` are buffered on `port2` until the leader's syncWorker starts
     *  the received port. Standard MessageChannel semantics — no follower-side
     *  notification required.
     *
     *  We deliberately do NOT broadcast `leader-changed` from the heartbeat:
     *  followers receiving it call `connectToLeader()`, which tears down the
     *  existing `leader-port` and resolves any in-flight sync FS request with
     *  EIO (sync-relay.worker.ts: `pendingResolve(EIO)`). Broadcasting on every
     *  tick would inject random EIOs into long-running ops on every connected
     *  follower. Broadcast only fires once, at initial registration, to wake any
     *  pre-existing followers (e.g. left over from a previous leader). */
    private initLeaderBroker;
    /** Promote from follower to leader (after leader tab dies and lock is acquired) */
    private promoteToLeader;
    /** Spawn an inline worker from bundled code */
    private spawnWorker;
    /** Block until workers are ready */
    private ensureReady;
    /** Send a sync request via SAB and wait for response */
    private syncRequest;
    private syncRequestLocked;
    private asyncRequest;
    readFileSync(filePath: PathLike | number, options?: ReadOptions | Encoding | null): string | Uint8Array;
    writeFileSync(filePath: PathLike | number, data: string | Uint8Array, options?: WriteOptions | Encoding): void;
    appendFileSync(filePath: PathLike | number, data: string | Uint8Array, options?: WriteOptions | Encoding): void;
    existsSync(filePath: PathLike): boolean;
    mkdirSync(filePath: PathLike, options?: MkdirOptions | Mode): string | undefined;
    rmdirSync(filePath: PathLike, options?: RmdirOptions): void;
    rmSync(filePath: PathLike, options?: RmOptions): void;
    unlinkSync(filePath: PathLike): void;
    readdirSync(filePath: PathLike, options?: ReaddirOptions | Encoding | null): string[] | Uint8Array[] | Dirent$1[];
    globSync(pattern: string | string[], options?: GlobOptions): string[] | Dirent$1[];
    opendirSync(filePath: PathLike, options?: OpendirOptions): Dir$1;
    statSync(filePath: PathLike, options?: StatOptions & {
        throwIfNoEntry?: true;
    }): Stats$1 | BigIntStats$1;
    statSync(filePath: PathLike, options: StatOptions & {
        throwIfNoEntry: false;
    }): Stats$1 | BigIntStats$1 | undefined;
    lstatSync(filePath: PathLike, options?: StatOptions & {
        throwIfNoEntry?: true;
    }): Stats$1 | BigIntStats$1;
    lstatSync(filePath: PathLike, options: StatOptions & {
        throwIfNoEntry: false;
    }): Stats$1 | BigIntStats$1 | undefined;
    renameSync(oldPath: PathLike, newPath: PathLike): void;
    copyFileSync(src: PathLike, dest: PathLike, mode?: number): void;
    /**
     * Reject a copy whose destination is the source, or lives inside it.
     *
     * The subtree case is the dangerous one: a recursive copy into its own subtree recreates the
     * destination inside itself on every pass and never terminates — an unbounded loop that hangs
     * the tab and fills storage. Node rejects both with ERR_FS_CP_EINVAL before copying anything.
     *
     * Called once per public `cp` entry point rather than inside the recursion, so the recursive
     * calls (whose dest is legitimately inside the destination tree) are unaffected.
     */
    private _assertCopyable;
    cpSync(src: PathLike, dest: PathLike, options?: CpOptions): void;
    /** The recursive worker. Its destinations are legitimately inside the destination tree. */
    private _cpSyncInner;
    private _cpAsync;
    truncateSync(filePath: PathLike, len?: number): void;
    accessSync(filePath: PathLike, mode?: number): void;
    realpathSync(filePath: PathLike, options?: {
        encoding?: string | null;
    } | string | null): string | Uint8Array;
    chmodSync(filePath: PathLike, mode: Mode): void;
    /** Like chmodSync but operates on the symlink itself. In this VFS, delegates to chmodSync. */
    lchmodSync(filePath: PathLike, mode: Mode): void;
    /** chmod on an open file descriptor. Resolves the fd to its inode on the
     *  server side and mutates the inode's mode bits directly, matching what
     *  native Node's libuv does. */
    fchmodSync(fd: number, mode: Mode): void;
    chownSync(filePath: PathLike, uid: number, gid: number): void;
    /** Like chownSync but operates on the symlink itself. In this VFS, delegates to chownSync. */
    lchownSync(filePath: PathLike, uid: number, gid: number): void;
    /** chown on an open file descriptor. Mutates the underlying inode's uid/gid. */
    fchownSync(fd: number, uid: number, gid: number): void;
    utimesSync(filePath: PathLike, atime: Date | number, mtime: Date | number): void;
    /** utimes on an open file descriptor. Mutates the underlying inode's atime/mtime. */
    futimesSync(fd: number, atime: Date | number, mtime: Date | number): void;
    /** Like utimesSync but operates on the symlink itself. In this VFS, delegates to utimesSync. */
    lutimesSync(filePath: PathLike, atime: Date | number, mtime: Date | number): void;
    symlinkSync(target: PathLike, linkPath: PathLike, type?: string | null): void;
    readlinkSync(filePath: PathLike, options?: {
        encoding?: string | null;
    } | string | null): string | Uint8Array;
    linkSync(existingPath: PathLike, newPath: PathLike): void;
    mkdtempSync(prefix: PathLike, options?: {
        encoding?: string | null;
    } | string | null): string | Uint8Array;
    /**
     * The stream constructors, exposed as properties the way `node:fs` exposes them, so
     * `x instanceof fs.ReadStream` and `fs.FileReadStream` resolve for code written against Node.
     * `Stats`, `Dirent` and `Dir` are deliberately absent: they are structural interfaces here,
     * not runtime classes, and a fake constructor would make `instanceof` lie.
     */
    get ReadStream(): typeof NodeReadable;
    get WriteStream(): typeof NodeWritable;
    /** Node's legacy aliases for the same two constructors. */
    get FileReadStream(): typeof NodeReadable;
    get FileWriteStream(): typeof NodeWritable;
    /**
     * `mkdtempSync` whose result cleans itself up — Node 24's explicit-resource-management form.
     *
     * ```js
     * using dir = fs.mkdtempDisposableSync('/tmp/build-');
     * // dir.path is removed when the block exits, however it exits
     * ```
     * `remove()` is idempotent so an explicit call followed by the implicit `Symbol.dispose`
     * does not throw ENOENT.
     */
    mkdtempDisposableSync(prefix: string): {
        path: string;
        remove(): void;
        [Symbol.dispose](): void;
    };
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
    fstatSync(fd: number, options?: StatOptions): Stats$1 | BigIntStats$1;
    ftruncateSync(fd: number, len?: number): void;
    fdatasyncSync(fd: number): void;
    fsyncSync(fd: number): void;
    readvSync(fd: number, buffers: Uint8Array[], position?: number | null): number;
    writevSync(fd: number, buffers: Uint8Array[], position?: number | null): number;
    readv(fd: number, buffers: Uint8Array[], position: number | null | undefined, callback: (err: Error | null, bytesRead?: number, buffers?: Uint8Array[]) => void): void;
    readv(fd: number, buffers: Uint8Array[], callback: (err: Error | null, bytesRead?: number, buffers?: Uint8Array[]) => void): void;
    writev(fd: number, buffers: Uint8Array[], position: number | null | undefined, callback: (err: Error | null, bytesWritten?: number, buffers?: Uint8Array[]) => void): void;
    writev(fd: number, buffers: Uint8Array[], callback: (err: Error | null, bytesWritten?: number, buffers?: Uint8Array[]) => void): void;
    /**
     * Real volume statistics, read from the VFS superblock.
     *
     * This used to return fixed constants — always ~4 GB capacity with ~2 GB free, whatever the
     * volume actually held — so code checking free space before a large write got an answer
     * unrelated to reality, and never saw a full disk coming.
     */
    statfsSync(path?: PathLike): StatFs;
    statfs(path: string, callback: (err: Error | null, stats?: StatFs) => void): void;
    statfs(path: string): Promise<StatFs>;
    watch(filePath: PathLike, options?: WatchOptions | Encoding | WatchListener, listener?: WatchListener): FSWatcher;
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
    /** True only while the filesystem is fully ready for synchronous operations
     *  AND no leader transition is in progress. Reflects the moment-in-time state;
     *  use `whenReady()` to await readiness reliably. */
    get ready(): boolean;
    /** Resolves once the filesystem is fully ready for synchronous operations,
     *  including any in-flight leader transition (promotion-to-leader, etc.).
     *  If already ready and no transition is pending, resolves immediately.
     *
     *  Use this when coordinating with other Web-Lock-based systems (e.g. a
     *  parent app that elects its own leader independently of the FS) — the
     *  timing of the two elections isn't synchronized, so the FS may still be
     *  reinitialising when the parent's lock fires. Calling `whenReady()`
     *  after your own leader-acquisition guarantees the FS is back in a state
     *  where sync ops won't stall the 20-second relay-worker heartbeat. */
    whenReady(): Promise<void>;
    /** Internal — called by lifecycle handlers when sync-relay says 'ready'. */
    private fireReadyListeners;
    /**
     * Tear the workers down when the page goes away, without needing the caller to remember.
     *
     * The OPFS mirror worker holds a recursive `FileSystemObserver`, and Chromium aborts the
     * **browser process** — `FATAL: Detected dangling raw_ptr in unretained` — when a page is
     * destroyed with one still attached. Callers cannot reasonably be relied on to call
     * {@link dispose} before every navigation, and `pagehide` is too late to round-trip a message
     * to the worker and back: nothing will run the event loop again.
     *
     * So this does the one thing that works synchronously — terminate the relay. The mirror worker
     * is a *nested* worker owned by the relay, so killing the parent destroys the child's context
     * and the observer with it, before teardown can trip over it.
     *
     * `event.persisted` means the page is going into the back/forward cache and may be restored,
     * so the filesystem is left alone in that case.
     */
    private installUnloadTeardown;
    /**
     * Ask the sync relay to release what it owns, and wait briefly for it to confirm.
     *
     * The thing that actually has to happen here is the OPFS mirror worker disconnecting its
     * recursive `FileSystemObserver`. Everything else the relay holds dies with the worker; an
     * attached observer does not, and Chromium aborts the browser process on a page teardown that
     * leaves one dangling. Bounded, because a close must not be able to hang.
     */
    private shutdownRelay;
    /**
     * Release every resource this instance owns: the relay workers, the OPFS mirror worker, and
     * the `FileSystemObserver` registered on the origin's storage.
     *
     * Worth calling explicitly in anything that creates instances repeatedly — a test suite, an
     * app that switches volumes — because the observer is the one thing that does not simply die
     * with the page. The instance is unusable afterwards; construct a new one to reopen the volume.
     *
     * Named `dispose` rather than `close` because `close(fd)` is already node's descriptor API and
     * means something entirely different. `await using fs = new VFSFileSystem()` works too.
     */
    dispose(): Promise<void>;
    /** `await using` support, so an instance can be scoped to a block. */
    [Symbol.asyncDispose](): Promise<void>;
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
    readFile(filePath: string | number, callback: (err: Error | null, data?: Uint8Array | string) => void): void;
    readFile(filePath: string | number, options: ReadOptions | Encoding | null, callback: (err: Error | null, data?: Uint8Array | string) => void): void;
    writeFile(filePath: string | number, data: string | Uint8Array, callback: (err: Error | null) => void): void;
    writeFile(filePath: string | number, data: string | Uint8Array, options: WriteOptions | Encoding, callback: (err: Error | null) => void): void;
    appendFile(filePath: string | number, data: string | Uint8Array, callback: (err: Error | null) => void): void;
    appendFile(filePath: string | number, data: string | Uint8Array, options: WriteOptions | Encoding, callback: (err: Error | null) => void): void;
    mkdir(filePath: string, callback: (err: Error | null, path?: string) => void): void;
    mkdir(filePath: string, options: MkdirOptions | Mode, callback: (err: Error | null, path?: string) => void): void;
    rmdir(filePath: string, callback: (err: Error | null) => void): void;
    rmdir(filePath: string, options: RmdirOptions, callback: (err: Error | null) => void): void;
    rm(filePath: string, callback: (err: Error | null) => void): void;
    rm(filePath: string, options: RmOptions, callback: (err: Error | null) => void): void;
    unlink(filePath: string, callback?: (err: Error | null) => void): any;
    readdir(filePath: string, callback: (err: Error | null, files?: string[] | Dirent$1[]) => void): void;
    readdir(filePath: string, options: ReaddirOptions | Encoding | null, callback: (err: Error | null, files?: string[] | Dirent$1[]) => void): void;
    stat(filePath: string, callback: (err: Error | null, stats?: Stats$1 | BigIntStats$1) => void): void;
    stat(filePath: string, options: StatOptions, callback: (err: Error | null, stats?: Stats$1 | BigIntStats$1) => void): void;
    lstat(filePath: string, callback: (err: Error | null, stats?: Stats$1 | BigIntStats$1) => void): void;
    lstat(filePath: string, options: StatOptions, callback: (err: Error | null, stats?: Stats$1 | BigIntStats$1) => void): void;
    access(filePath: string, callback: (err: Error | null) => void): void;
    access(filePath: string, mode: number, callback: (err: Error | null) => void): void;
    rename(oldPath: string, newPath: string, callback?: (err: Error | null) => void): any;
    copyFile(src: string, dest: string, callback: (err: Error | null) => void): void;
    copyFile(src: string, dest: string, mode: number, callback: (err: Error | null) => void): void;
    truncate(filePath: string, callback: (err: Error | null) => void): void;
    truncate(filePath: string, len: number, callback: (err: Error | null) => void): void;
    realpath(filePath: string, callback?: (err: Error | null, resolvedPath?: string | Uint8Array) => void): any;
    realpath(filePath: string, options: {
        encoding?: string | null;
    } | string | null, callback?: (err: Error | null, resolvedPath?: string | Uint8Array) => void): any;
    chmod(filePath: string, mode: Mode, callback?: (err: Error | null) => void): any;
    chown(filePath: string, uid: number, gid: number, callback?: (err: Error | null) => void): any;
    utimes(filePath: string, atime: Date | number, mtime: Date | number, callback?: (err: Error | null) => void): any;
    symlink(target: string, linkPath: string, callback: (err: Error | null) => void): void;
    symlink(target: string, linkPath: string, type: string | null, callback: (err: Error | null) => void): void;
    readlink(filePath: string, callback: (err: Error | null, linkString?: string | Uint8Array) => void): void;
    readlink(filePath: string, options: {
        encoding?: string | null;
    } | string | null, callback: (err: Error | null, linkString?: string | Uint8Array) => void): void;
    link(existingPath: string, newPath: string, callback?: (err: Error | null) => void): any;
    open(filePath: string, callback: (err: Error | null, fd?: number) => void): void;
    open(filePath: string, flags: string | number, callback: (err: Error | null, fd?: number) => void): void;
    open(filePath: string, flags: string | number, mode: Mode, callback: (err: Error | null, fd?: number) => void): void;
    mkdtemp(prefix: string, callback?: (err: Error | null, folder?: string | Uint8Array) => void): any;
    mkdtemp(prefix: string, options: {
        encoding?: string | null;
    } | string | null, callback?: (err: Error | null, folder?: string | Uint8Array) => void): any;
    cp(src: string, dest: string, callback: (err: Error | null) => void): void;
    cp(src: string, dest: string, options: CpOptions, callback: (err: Error | null) => void): void;
    fdatasync(fd: number, callback?: (err: Error | null) => void): void;
    fsync(fd: number, callback?: (err: Error | null) => void): void;
    fstat(fd: number, callback: (err: Error | null, stats?: Stats$1 | BigIntStats$1) => void): void;
    fstat(fd: number, options: any, callback: (err: Error | null, stats?: Stats$1 | BigIntStats$1) => void): void;
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
    opendir(filePath: string, callback?: (err: Error | null, dir?: Dir$1) => void): any;
    glob(pattern: string, callback: (err: Error | null, matches?: string[]) => void): void;
    glob(pattern: string, options: GlobOptions, callback: (err: Error | null, matches?: string[]) => void): void;
    futimes(fd: number, atime: Date | number, mtime: Date | number, callback?: (err: Error | null) => void): void;
    fchmod(fd: number, mode: Mode, callback?: (err: Error | null) => void): void;
    fchown(fd: number, uid: number, gid: number, callback?: (err: Error | null) => void): void;
    lchmod(filePath: PathLike, mode: Mode, callback?: (err: Error | null) => void): any;
    lchown(filePath: PathLike, uid: number, gid: number, callback?: (err: Error | null) => void): any;
    lutimes(filePath: PathLike, atime: Date | number, mtime: Date | number, callback?: (err: Error | null) => void): any;
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
    readFile(filePath: PathLike | FileHandle, options?: ReadOptions | Encoding | null): Promise<string | Uint8Array<ArrayBufferLike>>;
    writeFile(filePath: PathLike | FileHandle, data: string | Uint8Array, options?: WriteOptions | Encoding): Promise<void>;
    appendFile(filePath: PathLike | FileHandle, data: string | Uint8Array, options?: WriteOptions | Encoding): Promise<void>;
    mkdir(filePath: PathLike, options?: MkdirOptions | Mode): Promise<string | undefined>;
    rmdir(filePath: PathLike, options?: RmdirOptions): Promise<void>;
    rm(filePath: PathLike, options?: RmOptions): Promise<void>;
    unlink(filePath: PathLike): Promise<void>;
    readdir(filePath: PathLike, options?: ReaddirOptions | Encoding | null): Promise<Uint8Array<ArrayBufferLike>[] | string[] | Dirent$1[]>;
    glob(pattern: string | string[], options?: GlobOptions): Promise<string[] | Dirent$1[]>;
    stat(filePath: PathLike, options?: StatOptions & {
        throwIfNoEntry?: true;
    }): Promise<Stats$1 | BigIntStats$1>;
    stat(filePath: PathLike, options: StatOptions & {
        throwIfNoEntry: false;
    }): Promise<Stats$1 | BigIntStats$1 | undefined>;
    lstat(filePath: PathLike, options?: StatOptions & {
        throwIfNoEntry?: true;
    }): Promise<Stats$1 | BigIntStats$1>;
    lstat(filePath: PathLike, options: StatOptions & {
        throwIfNoEntry: false;
    }): Promise<Stats$1 | BigIntStats$1 | undefined>;
    access(filePath: PathLike, mode?: number): Promise<void>;
    rename(oldPath: PathLike, newPath: PathLike): Promise<void>;
    copyFile(src: PathLike, dest: PathLike, mode?: number): Promise<void>;
    cp(src: PathLike, dest: PathLike, options?: CpOptions): Promise<void>;
    /** The recursive worker; its destinations are legitimately inside the destination tree. */
    private _cpInner;
    truncate(filePath: PathLike, len?: number): Promise<void>;
    realpath(filePath: PathLike, options?: {
        encoding?: string | null;
    } | string | null): Promise<string | Uint8Array<ArrayBufferLike>>;
    exists(filePath: PathLike): Promise<boolean>;
    chmod(filePath: PathLike, mode: Mode): Promise<void>;
    /** Like chmod but operates on the symlink itself. In this VFS, delegates to chmod. */
    lchmod(filePath: PathLike, mode: Mode): Promise<void>;
    /** chmod on an open file descriptor. Engine resolves fd → inode and
     *  mutates the mode bits directly. */
    fchmod(fd: number, mode: Mode): Promise<void>;
    chown(filePath: PathLike, uid: number, gid: number): Promise<void>;
    /** Like chown but operates on the symlink itself. In this VFS, delegates to chown. */
    lchown(filePath: PathLike, uid: number, gid: number): Promise<void>;
    /** chown on an open file descriptor. Engine resolves fd → inode and
     *  mutates uid/gid directly. */
    fchown(fd: number, uid: number, gid: number): Promise<void>;
    utimes(filePath: PathLike, atime: Date | number, mtime: Date | number): Promise<void>;
    /** utimes on an open file descriptor. Engine resolves fd → inode and
     *  mutates atime/mtime directly. */
    futimes(fd: number, atime: Date | number, mtime: Date | number): Promise<void>;
    /** Like utimes but operates on the symlink itself. In this VFS, delegates to utimes. */
    lutimes(filePath: PathLike, atime: Date | number, mtime: Date | number): Promise<void>;
    symlink(target: PathLike, linkPath: PathLike, type?: string | null): Promise<void>;
    readlink(filePath: PathLike, options?: {
        encoding?: string | null;
    } | string | null): Promise<string | Uint8Array<ArrayBufferLike>>;
    link(existingPath: PathLike, newPath: PathLike): Promise<void>;
    open(filePath: PathLike, flags?: string | number, mode?: Mode): Promise<FileHandle>;
    opendir(filePath: PathLike, options?: OpendirOptions): Promise<Dir$1>;
    /**
     * `mkdtemp` whose result cleans itself up — see `mkdtempDisposableSync`. Disposal is async
     * here (`await using`), so the symbol is `Symbol.asyncDispose` and `remove()` returns a promise.
     */
    mkdtempDisposable(prefix: string): Promise<{
        path: string;
        remove(): Promise<void>;
        [Symbol.asyncDispose](): Promise<void>;
    }>;
    mkdtemp(prefix: PathLike, options?: {
        encoding?: string | null;
    } | string | null): Promise<string | Uint8Array<ArrayBufferLike>>;
    openAsBlob(filePath: string, options?: OpenAsBlobOptions): Promise<Blob>;
    /** Real volume statistics — see the note on `VFSFileSystem.statfsSync`. */
    statfs(path?: PathLike): Promise<StatFs>;
    watch(filePath: string, options?: WatchOptions): AsyncIterable<WatchEventType>;
    fstat(fd: number, options?: StatOptions): Promise<Stats$1 | BigIntStats$1>;
    ftruncate(fd: number, len?: number): Promise<void>;
    fsync(_fd: number): Promise<void>;
    fdatasync(_fd: number): Promise<void>;
    flush(): Promise<void>;
    purge(): Promise<void>;
}

/**
 * Fairness ticket lock for a shared control SAB.
 *
 * ## Why this exists
 *
 * The sync FS protocol uses ONE control SAB (one request/response slot) serviced
 * by ONE sync-relay worker against ONE OPFS sync access handle. When a single
 * client drives that SAB this is fine. But a host can deliberately share one SAB
 * across MANY sync clients — e.g. a browser dev container that runs several exec
 * Web Workers plus the main thread, all issuing sync FS ops to a single relay so
 * there is only ever one open OPFS handle. Those clients must take turns: if two
 * stage a request into the single slot at once, the relay reads a torn frame and
 * everyone downstream sees truncated/garbage data.
 *
 * A plain CAS spinlock (`compareExchange(lock, 0, 1)`) provides mutual exclusion
 * but is **unfair**: under contention one client can lose the race indefinitely
 * (starve). Hosts that "self-heal" a starved client by force-stealing the lock
 * after a timeout then create the exact double-holder corruption the lock was
 * meant to prevent — the timeout fires on a *live* holder simply because the
 * waiter was starved, not because anyone died.
 *
 * This is a **ticket (bakery) lock**: each client atomically draws a ticket and
 * is served in strict arrival order. No starvation, so the only reason a waiter
 * ever waits "too long" is a genuinely dead/wedged holder — which is recovered
 * conservatively (see below), not on mere contention.
 *
 * ## Protocol (two Int32 slots in the control header)
 *
 *   TICKET_NEXT     — next ticket to hand out; `Atomics.add(.,1)` draws one.
 *   TICKET_SERVING  — ticket currently permitted to touch the SAB.
 *
 * Both start at 0 (zeroed SAB). Acquire draws `t = fetch_add(NEXT)`, then waits
 * until `SERVING === t`. Release does `add(SERVING, 1)` + notify. Uncontended,
 * NEXT and SERVING march in lockstep and every acquire is satisfied immediately
 * — so the single-client case pays only a couple of atomics and never blocks
 * (in particular it never calls `Atomics.wait`, which is illegal on the browser
 * main thread).
 *
 * ## Liveness / recovery
 *
 * A holder runs exactly ONE sync op between acquire and release. A live holder
 * therefore always makes observable progress quickly: either SERVING advances
 * (it finished and released) or the protocol signal changes (it is mid multi-
 * chunk transfer, handing frames back and forth with the relay). The ONE state
 * that can legitimately sit frozen for a long stretch is a single slow op the
 * relay is servicing (e.g. a WebKit OPFS truncate that blocks the relay — and
 * thus its heartbeat — for up to ~20s). So: if neither SERVING nor the signal
 * changes for `HOLDER_STUCK_MS` (30s, matching the relay-heartbeat stall ceiling
 * the rest of the library already tolerates), the current holder — or the relay
 * itself — is wedged/dead. Exactly one waiter then advances SERVING past the
 * dead ticket via CAS so the queue drains. If it was the relay that died, the
 * recovered holder's own op surfaces that error through its normal spin-wait;
 * recovery here never throws and never leaks a ticket.
 *
 * 30s is far longer than any single live op, so a healthy holder is never
 * stolen from — the corruption mode of the old force-steal cannot occur.
 */
/**
 * Acquire the SAB. Returns the drawn ticket (pass it to nothing — release takes
 * no argument; the ticket is returned only for debugging/inspection). MUST be
 * paired with exactly one {@link releaseFsLock} in a `finally`.
 */
declare function acquireFsLock(ctrl: Int32Array): number;
/** Release the SAB, admitting the next ticket in line. */
declare function releaseFsLock(ctrl: Int32Array): void;

declare const SAB_OFFSETS: {
    readonly CONTROL: 0;
    readonly TICKET_NEXT: 4;
    readonly TICKET_SERVING: 8;
    readonly OPCODE: 4;
    readonly STATUS: 8;
    readonly CHUNK_LEN: 12;
    readonly TOTAL_LEN: 16;
    readonly CHUNK_IDX: 24;
    readonly HEARTBEAT: 28;
    readonly HEADER_SIZE: 32;
};
declare const SIGNAL: {
    readonly IDLE: 0;
    readonly REQUEST: 1;
    readonly RESPONSE: 2;
    readonly CHUNK: 3;
    readonly CHUNK_ACK: 4;
};

/**
 * Main-thread service-worker bridge for worker-hosted VFS instances.
 *
 * `navigator.serviceWorker` is not exposed in worker scopes on Safari and
 * Firefox, so a VFS instance running inside a worker cannot register or
 * message the multi-tab broker service worker itself. This helper runs on the
 * main thread, owns the real `navigator.serviceWorker`, and forwards the
 * worker instance's broker messages (including transferred MessagePorts) to it.
 *
 * Only OUTBOUND messages (worker → SW) need forwarding: the SW's replies to a
 * leader's control port, and a follower's leader-port traffic, all flow
 * directly through the MessageChannel ports that were transferred along with
 * those outbound messages — they never pass back through this bridge.
 *
 * Usage:
 *   // main thread
 *   const channel = new MessageChannel();
 *   createServiceWorkerBridge(channel.port1, { ns: 'app' });
 *   worker.postMessage({ swBridge: channel.port2 }, [channel.port2]);
 *
 *   // worker
 *   const fs = new VFSFileSystem({ root: '/app', swBridge: receivedPort });
 */
interface ServiceWorkerBridgeOptions {
    /** Namespace — must match the VFS instance's namespace (derived from root). */
    ns: string;
    /** Service worker script URL. Defaults to the bundled broker resolved
     *  relative to this module. Override when bundled elsewhere. */
    swUrl?: string;
    /** Registration scope. Defaults to `./${ns}/` relative to the SW URL. */
    swScope?: string;
}
/**
 * Begin bridging a worker-hosted VFS instance's service-worker broker
 * messages to the real service worker on this (main) thread.
 *
 * Returns a function that tears the bridge down.
 */
declare function createServiceWorkerBridge(bridgePort: MessagePort, opts: ServiceWorkerBridgeOptions): () => void;

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
/**
 * `realpath`'s path coercion, which is **not** the one every other method uses.
 *
 * Node validates the path argument everywhere except here: `fs.statSync({})` is an
 * `ERR_INVALID_ARG_TYPE`, but `fs.realpathSync({ toString: () => '/tmp' })` resolves, and
 * `fs.realpathSync(123)` is an `ENOENT` on the relative path `'123'`. Rejecting those would
 * make working node code fail against this library, so realpath keeps the loose form.
 */
declare function toRealpathString(p: PathLike): string;
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
declare const path_toRealpathString: typeof toRealpathString;
declare namespace path {
  export { path_basename as basename, path_delimiter as delimiter, path_dirname as dirname, path_extname as extname, path_format as format, path_isAbsolute as isAbsolute, path_join as join, path_normalize as normalize, path_parse as parse, path_relative as relative, path_resolve as resolve, path_sep as sep, path_toPathString as toPathString, path_toRealpathString as toRealpathString };
}

/**
 * VfsDrive — exposes a `VFSFileSystem` (the OPFS-backed VFS engine) as a `Drive`.
 * This is the Phase-2 bridge: instead of refactoring the SAB/OPFS engine behind a
 * block-backend seam, we wrap its existing async API. One VfsDrive = one disk;
 * pass a sub-`root` to scope a disk to a sub-tree (multiple independent OPFS
 * disks), or a separately-configured `VFSFileSystem` for a different medium.
 *
 * Unlike the leaf drives, this one DOES import the engine (it's the bridge) and
 * it honours `EntryType: 'symlink'` — the VFS has real symlinks (lstat/readlink),
 * so they surface here rather than being flattened to files.
 */

declare class VfsDrive implements Drive {
    readonly id: string;
    label: string;
    private vfs;
    private root;
    readonly kind: Drive['kind'];
    readonly icon: string;
    readonly capabilities: DriveCapabilities;
    state: Drive['state'];
    /**
     * @param id     drive id
     * @param label  sidebar label
     * @param vfs    the VFS engine instance
     * @param root   kernel root for this disk ("/" = whole VFS; "/Volumes/x" scoped)
     * @param scoped marks a scoped sub-tree disk (icon/kind differ)
     */
    constructor(id: string, label: string, vfs: VFSFileSystem, root?: string, scoped?: boolean);
    private get p();
    private abs;
    private entryType;
    /** Ensure the scoped root exists (no-op for the whole-VFS disk). */
    ensureRoot(): Promise<void>;
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
    usage(): Promise<{
        total: number;
        used: number;
    } | null>;
    createReadable(path: string): Promise<DriveReadable>;
    createWritable(path: string): Promise<DriveWritable>;
}

/** Create a configured VFS instance */
declare function createFS(config?: VFSConfig): VFSFileSystem;
/** Get (or create) the default VFS singleton */
declare function getDefaultFS(): VFSFileSystem;
/** Async init helper — avoids blocking main thread */
declare function init(): Promise<void>;

export { BigIntStats, type CpOptions, Dir, Dirent, Drive, DriveCapabilities, DriveEntry, DriveReadable, DriveStat, DriveWritable, type Encoding, FSError, type FSMode, type FSReadStream, type FSWatcher, type FSWriteStream, type FileHandle, type LoadResult, type MkdirOptions, NodeReadable, NodeWritable, type OpenAsBlobOptions, type OpendirOptions, type PathLike, type ReadOptions, NodeReadable as ReadStream, type ReadStreamOptions, type ReaddirOptions, type RepairResult, type RmOptions, type RmdirOptions, SAB_OFFSETS, SIGNAL, type ServiceWorkerBridgeOptions, SimpleEventEmitter, type StatFs, type StatOptions, Stats, type UnpackResult, type VFSConfig, VFSFileSystem, type VFSLimits, VfsDrive, type WatchEventType, type WatchFileListener, type WatchListener, type WatchOptions, type WriteOptions, NodeWritable as WriteStream, type WriteStreamOptions, acquireFsLock, constants, createError, createFS, createServiceWorkerBridge, getDefaultFS, init, loadFromOPFS, path, releaseFsLock, repairVFS, statusToError, unpackToOPFS };
