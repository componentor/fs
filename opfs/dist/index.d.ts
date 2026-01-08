/**
 * File system types matching Node.js fs module interfaces
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
    /**
     * Whether to flush data to storage after writing.
     * - true (default): Data is immediately persisted - safe but slower
     * - false: Data is written but not flushed - faster but may be lost on crash
     */
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
interface StatOptions {
    bigint?: boolean;
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
interface FileSystemPromises {
    readFile(path: string, options?: ReadOptions | Encoding | null): Promise<Uint8Array | string>;
    writeFile(path: string, data: Uint8Array | string, options?: WriteOptions | Encoding): Promise<void>;
    appendFile(path: string, data: Uint8Array | string, options?: WriteOptions | Encoding): Promise<void>;
    mkdir(path: string, options?: MkdirOptions | number): Promise<string | undefined>;
    rmdir(path: string, options?: RmdirOptions): Promise<void>;
    rm(path: string, options?: RmOptions): Promise<void>;
    unlink(path: string): Promise<void>;
    readdir(path: string, options?: ReaddirOptions | Encoding | null): Promise<string[] | Dirent[]>;
    stat(path: string, options?: StatOptions): Promise<Stats>;
    lstat(path: string, options?: StatOptions): Promise<Stats>;
    access(path: string, mode?: number): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
    copyFile(src: string, dest: string, mode?: number): Promise<void>;
    truncate(path: string, len?: number): Promise<void>;
    realpath(path: string): Promise<string>;
    /**
     * Check if a path exists.
     * Note: This is not in Node.js fs.promises but is commonly needed.
     */
    exists(path: string): Promise<boolean>;
    /**
     * Change file mode (no-op in OPFS - permissions not supported).
     */
    chmod(path: string, mode: number): Promise<void>;
    /**
     * Change file owner (no-op in OPFS - ownership not supported).
     */
    chown(path: string, uid: number, gid: number): Promise<void>;
    /**
     * Change file timestamps (no-op in OPFS - timestamps are read-only).
     */
    utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void>;
    /**
     * Create a symbolic link.
     * Emulated by storing target path in a special file format.
     */
    symlink(target: string, path: string, type?: string): Promise<void>;
    /**
     * Read a symbolic link target.
     */
    readlink(path: string): Promise<string>;
    /**
     * Create a hard link.
     * Emulated by copying the file (true hard links not supported in OPFS).
     */
    link(existingPath: string, newPath: string): Promise<void>;
    /**
     * Open a file and return a FileHandle.
     */
    open(path: string, flags?: string | number, mode?: number): Promise<FileHandle>;
    /**
     * Open a directory for iteration.
     */
    opendir(path: string): Promise<Dir>;
    /**
     * Create a unique temporary directory.
     */
    mkdtemp(prefix: string): Promise<string>;
    /**
     * Watch a file or directory for changes.
     */
    watch(path: string, options?: WatchOptions): AsyncIterable<WatchEventType>;
    /**
     * Flush all pending writes to storage.
     * Use after writes with { flush: false } to ensure data is persisted.
     */
    flush(): Promise<void>;
    /**
     * Purge all kernel caches.
     * Use between major operations to ensure clean state.
     */
    purge(): Promise<void>;
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
interface StatWatcher {
    ref(): this;
    unref(): this;
}
type WatchListener = (eventType: 'rename' | 'change', filename: string | null) => void;
type WatchFileListener = (curr: Stats, prev: Stats) => void;
interface FileSystemChangeRecord {
    changedHandle: FileSystemHandle | null;
    relativePathComponents: string[];
    relativePathMovedFrom: string[] | null;
    root: FileSystemHandle;
    type: 'appeared' | 'disappeared' | 'modified' | 'moved' | 'errored' | 'unknown';
}
type FileSystemObserverCallback = (records: FileSystemChangeRecord[], observer: FileSystemObserverInterface) => void;
interface FileSystemObserverInterface {
    observe(handle: FileSystemHandle, options?: {
        recursive?: boolean;
    }): Promise<void>;
    disconnect(): void;
}
declare global {
    interface Window {
        FileSystemObserver?: new (callback: FileSystemObserverCallback) => FileSystemObserverInterface;
    }
    var FileSystemObserver: (new (callback: FileSystemObserverCallback) => FileSystemObserverInterface) | undefined;
}

/**
 * OPFS FileSystem - Node.js fs-compatible API
 * Supports two performance tiers:
 * - Tier 1 (Sync): SharedArrayBuffer + Atomics - requires crossOriginIsolated (COOP/COEP headers)
 * - Tier 2 (Async): Promises API using Worker kernel - always available
 */

declare class OPFSFileSystem {
    private worker;
    private pending;
    private initialized;
    private initPromise;
    private fdTable;
    private nextFd;
    private statCache;
    constructor();
    private invalidateStat;
    private invalidateStatsUnder;
    private initWorker;
    private asyncCall;
    private syncKernel;
    private syncKernelReady;
    /**
     * Initialize sync operations with a kernel worker loaded from URL.
     * Required for Tier 1 (SharedArrayBuffer + Atomics) to work in nested Workers.
     * @param kernelUrl URL to the kernel.js file (defaults to '/kernel.js')
     */
    initSync(kernelUrl?: string): Promise<void>;
    private static readonly META_SIZE;
    private static readonly DEFAULT_DATA_SIZE;
    private static readonly MAX_CHUNK_SIZE;
    private syncBufferPool;
    private getSyncBuffers;
    private syncCallTier1;
    private asyncOperationPromise;
    private syncCallTier1Async;
    private syncCallTier1AsyncImpl;
    private syncStatTier1Async;
    private syncCallTier1ChunkedAsync;
    private syncCallTier1ChunkedReadAsync;
    private syncCallTier1Chunked;
    private syncCallTier1ChunkedRead;
    private syncStatTier1;
    private syncCall;
    readFileSync(filePath: string, options?: ReadOptions | Encoding | null): Uint8Array | string;
    writeFileSync(filePath: string, data: Uint8Array | string, options?: WriteOptions | Encoding): void;
    appendFileSync(filePath: string, data: Uint8Array | string, options?: WriteOptions | Encoding): void;
    existsSync(filePath: string): boolean;
    mkdirSync(filePath: string, options?: MkdirOptions | number): string | undefined;
    rmdirSync(filePath: string, options?: RmdirOptions): void;
    rmSync(filePath: string, options?: RmOptions): void;
    unlinkSync(filePath: string): void;
    readdirSync(filePath: string, options?: ReaddirOptions | Encoding | null): string[] | Dirent[];
    statSync(filePath: string): Stats;
    lstatSync(filePath: string): Stats;
    /**
     * Create stats object for a symlink file.
     */
    private createSymlinkStats;
    renameSync(oldPath: string, newPath: string): void;
    copyFileSync(src: string, dest: string): void;
    truncateSync(filePath: string, len?: number): void;
    /**
     * Flush all pending writes to storage.
     * Use this after writes with { flush: false } to ensure data is persisted.
     */
    flushSync(): void;
    /**
     * Alias for flushSync() - matches Node.js fdatasync behavior
     */
    fdatasyncSync(): void;
    /**
     * Purge all kernel caches (sync handles, directory handles).
     * Use between major operations to ensure clean state.
     */
    purgeSync(): void;
    accessSync(filePath: string, _mode?: number): void;
    openSync(filePath: string, flags?: string | number): number;
    closeSync(fd: number): void;
    readSync(fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null): number;
    writeSync(fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null): number;
    fstatSync(fd: number): Stats;
    ftruncateSync(fd: number, len?: number): void;
    /**
     * Resolve a path to an absolute path.
     * OPFS doesn't support symlinks, so this just normalizes the path.
     */
    realpathSync(filePath: string): string;
    /**
     * Change file mode (no-op in OPFS - permissions not supported).
     */
    chmodSync(_filePath: string, _mode: number): void;
    /**
     * Change file owner (no-op in OPFS - ownership not supported).
     */
    chownSync(_filePath: string, _uid: number, _gid: number): void;
    /**
     * Change file timestamps (no-op in OPFS - timestamps are read-only).
     */
    utimesSync(_filePath: string, _atime: Date | number, _mtime: Date | number): void;
    private static readonly SYMLINK_MAGIC;
    /**
     * Create a symbolic link.
     * Emulated by storing target path in a special file format.
     */
    symlinkSync(target: string, filePath: string, _type?: string): void;
    /**
     * Read a symbolic link target.
     */
    readlinkSync(filePath: string): string;
    /**
     * Check if a file is a symlink (sync).
     */
    private isSymlinkSync;
    /**
     * Check if a file is a symlink (async).
     */
    private isSymlinkAsync;
    /**
     * Create a hard link.
     * Emulated by copying the file (true hard links not supported in OPFS).
     */
    linkSync(existingPath: string, newPath: string): void;
    private parseFlags;
    private fastCall;
    promises: FileSystemPromises;
    /**
     * Async flush - use after promises.writeFile with { flush: false }
     */
    flush(): Promise<void>;
    /**
     * Async purge - clears all kernel caches
     */
    purge(): Promise<void>;
    constants: {
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
    private createFileHandle;
    private createDir;
    private watchedFiles;
    private static readonly hasNativeObserver;
    private getDirectoryHandle;
    private getFileHandle;
    private mapChangeType;
    private createAsyncWatcher;
    private createNativeAsyncWatcher;
    private createPollingAsyncWatcher;
    /**
     * Watch a file or directory for changes.
     * Uses native FileSystemObserver when available, falls back to polling.
     */
    watch(filePath: string, options?: WatchOptions | WatchListener, listener?: WatchListener): FSWatcher;
    private createNativeWatcher;
    private createPollingWatcher;
    /**
     * Watch a file for changes using native FileSystemObserver or stat polling.
     */
    watchFile(filePath: string, options?: WatchFileOptions | WatchFileListener, listener?: WatchFileListener): StatWatcher;
    /**
     * Stop watching a file.
     */
    unwatchFile(filePath: string, listener?: WatchFileListener): void;
    /**
     * Create a readable stream for a file.
     */
    createReadStream(filePath: string, options?: ReadStreamOptions | string): ReadableStream<Uint8Array>;
    /**
     * Create a writable stream for a file.
     */
    createWriteStream(filePath: string, options?: WriteStreamOptions | string): WritableStream<Uint8Array>;
    /**
     * Open a directory for iteration (sync).
     */
    opendirSync(dirPath: string): Dir;
    /**
     * Create a unique temporary directory (sync).
     */
    mkdtempSync(prefix: string): string;
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
declare function createENOENT(syscall: string, path: string): FSError;
declare function createEEXIST(syscall: string, path: string): FSError;
declare function createEISDIR(syscall: string, path: string): FSError;
declare function createENOTDIR(syscall: string, path: string): FSError;
declare function createENOTEMPTY(syscall: string, path: string): FSError;
declare function createEACCES(syscall: string, path: string): FSError;
declare function createEINVAL(syscall: string, path: string): FSError;
declare function mapErrorCode(errorName: string, syscall: string, path: string): FSError;

/**
 * POSIX-style path utilities for OPFS
 * Mirrors Node.js path module behavior
 */
declare const sep = "/";
declare const delimiter = ":";
declare function normalize(p: string): string;
declare function join(...paths: string[]): string;
declare function resolve(...paths: string[]): string;
declare function isAbsolute(p: string): boolean;
declare function dirname(p: string): string;
declare function basename(p: string, ext?: string): string;
declare function extname(p: string): string;
declare function relative(from: string, to: string): string;
declare function parse(p: string): {
    root: string;
    dir: string;
    base: string;
    ext: string;
    name: string;
};
declare function format(pathObject: {
    root?: string;
    dir?: string;
    base?: string;
    ext?: string;
    name?: string;
}): string;
declare const posix: {
    sep: string;
    delimiter: string;
    normalize: typeof normalize;
    join: typeof join;
    resolve: typeof resolve;
    isAbsolute: typeof isAbsolute;
    dirname: typeof dirname;
    basename: typeof basename;
    extname: typeof extname;
    relative: typeof relative;
    parse: typeof parse;
    format: typeof format;
};

declare const path_basename: typeof basename;
declare const path_delimiter: typeof delimiter;
declare const path_dirname: typeof dirname;
declare const path_extname: typeof extname;
declare const path_format: typeof format;
declare const path_isAbsolute: typeof isAbsolute;
declare const path_join: typeof join;
declare const path_normalize: typeof normalize;
declare const path_parse: typeof parse;
declare const path_posix: typeof posix;
declare const path_relative: typeof relative;
declare const path_resolve: typeof resolve;
declare const path_sep: typeof sep;
declare namespace path {
  export { path_basename as basename, posix as default, path_delimiter as delimiter, path_dirname as dirname, path_extname as extname, path_format as format, path_isAbsolute as isAbsolute, path_join as join, path_normalize as normalize, path_parse as parse, path_posix as posix, path_relative as relative, path_resolve as resolve, path_sep as sep };
}

/**
 * OPFS-FS: Battle-tested OPFS-based Node.js fs polyfill
 *
 * Provides a Node.js-compatible filesystem API that works in browsers using OPFS.
 *
 * Features:
 * - Synchronous API: fs.readFileSync, fs.writeFileSync, etc. (requires crossOriginIsolated)
 * - Async Promises API: fs.promises.readFile, fs.promises.writeFile, etc.
 * - Cross-tab safety via navigator.locks
 *
 * Performance Tiers:
 * - Tier 1 (Sync): SharedArrayBuffer + Atomics - requires crossOriginIsolated (COOP/COEP headers)
 * - Tier 2 (Async): Promises API - always available
 *
 * @example
 * ```typescript
 * import { fs } from 'opfs-fs';
 *
 * // Sync API (requires crossOriginIsolated)
 * fs.writeFileSync('/hello.txt', 'Hello World!');
 * const data = fs.readFileSync('/hello.txt', 'utf8');
 *
 * // Async API (always available)
 * await fs.promises.writeFile('/async.txt', 'Async data');
 * const content = await fs.promises.readFile('/async.txt', 'utf8');
 * ```
 */

declare const fs: OPFSFileSystem;

export { type Dirent, type Encoding, FSError, type FileSystemPromises, type MkdirOptions, OPFSFileSystem, type PathLike, type ReadOptions, type ReaddirOptions, type RmOptions, type RmdirOptions, type Stats, type WriteOptions, constants, createEACCES, createEEXIST, createEINVAL, createEISDIR, createENOENT, createENOTDIR, createENOTEMPTY, fs as default, fs, mapErrorCode, path };
