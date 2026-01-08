/**
 * File system constants matching Node.js fs.constants
 */
interface FSConstants {
    F_OK: number;
    R_OK: number;
    W_OK: number;
    X_OK: number;
    COPYFILE_EXCL: number;
    COPYFILE_FICLONE: number;
    COPYFILE_FICLONE_FORCE: number;
    O_RDONLY: number;
    O_WRONLY: number;
    O_RDWR: number;
    O_CREAT: number;
    O_EXCL: number;
    O_TRUNC: number;
    O_APPEND: number;
    S_IFMT: number;
    S_IFREG: number;
    S_IFDIR: number;
    S_IFLNK: number;
}
/**
 * Options for readFile operation
 */
interface ReadFileOptions {
    /** Text encoding (e.g., 'utf-8'). If not provided, returns Uint8Array */
    encoding?: string;
}
/**
 * Options for writeFile operation
 */
interface WriteFileOptions {
    /** Text encoding for string data */
    encoding?: string;
}
/**
 * Entry for batch file write operation
 */
interface BatchWriteEntry {
    /** File path to write */
    path: string;
    /** Data to write (string or binary) */
    data: string | Uint8Array;
}
/**
 * Result entry for batch file read operation
 */
interface BatchReadResult {
    /** File path */
    path: string;
    /** File data (null if file doesn't exist or error occurred) */
    data: Uint8Array | null;
    /** Error if read failed */
    error?: Error;
}
/**
 * Options for readdir operation
 */
interface ReaddirOptions {
    /** Return Dirent objects instead of strings */
    withFileTypes?: boolean;
}
/**
 * Directory entry (Dirent-like object)
 */
interface Dirent {
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
}
/**
 * File statistics
 */
interface Stats {
    type: 'file' | 'dir' | 'symlink';
    size: number;
    mode: number;
    ctime: Date;
    ctimeMs: number;
    mtime: Date;
    mtimeMs: number;
    target?: string;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
}
/**
 * Options for rm operation
 */
interface RmOptions {
    /** Remove directories and their contents recursively */
    recursive?: boolean;
    /** Ignore if path doesn't exist */
    force?: boolean;
}
/**
 * Options for cp operation
 */
interface CpOptions {
    /** Copy directories recursively */
    recursive?: boolean;
    /** Overwrite existing files */
    force?: boolean;
    /** Throw if destination exists */
    errorOnExist?: boolean;
}
/**
 * Symlink definition for batch operations
 */
interface SymlinkDefinition {
    target: string;
    path: string;
}
/**
 * Disk usage result
 */
interface DiskUsage {
    path: string;
    size: number;
}
/**
 * Filesystem statistics (similar to Node.js fs.statfs)
 */
interface StatFs {
    /** Filesystem type (always 0 for OPFS) */
    type: number;
    /** Optimal transfer block size (simulated as 4096) */
    bsize: number;
    /** Total blocks in filesystem */
    blocks: number;
    /** Free blocks in filesystem */
    bfree: number;
    /** Available blocks for unprivileged users */
    bavail: number;
    /** Total file nodes (0 - not available in browser) */
    files: number;
    /** Free file nodes (0 - not available in browser) */
    ffree: number;
    /** Bytes used by origin (from Storage API) */
    usage: number;
    /** Total bytes available to origin (from Storage API) */
    quota: number;
}

interface OPFSWorkerOptions {
    /** URL to the worker script (default: auto-detect) */
    workerUrl?: string | URL;
    /** Worker initialization options */
    workerOptions?: WorkerOptions;
}
/**
 * OPFS Worker Proxy - runs OPFS operations in a Web Worker
 *
 * Benefits:
 * - Non-blocking main thread
 * - Uses sync access handles (faster) in the worker
 * - Compatible with libraries that reuse buffers (e.g., isomorphic-git)
 */
declare class OPFSWorker {
    private worker;
    private pendingRequests;
    private nextId;
    private readyPromise;
    private readyResolve;
    /** File system constants */
    readonly constants: FSConstants;
    constructor(options?: OPFSWorkerOptions);
    private initWorker;
    /**
     * Wait for the worker to be ready
     */
    ready(): Promise<void>;
    /**
     * Terminate the worker
     */
    terminate(): void;
    private call;
    readFile(path: string, options?: ReadFileOptions): Promise<string | Uint8Array>;
    writeFile(path: string, data: string | Uint8Array, options?: WriteFileOptions): Promise<void>;
    readFileBatch(paths: string[]): Promise<BatchReadResult[]>;
    writeFileBatch(entries: BatchWriteEntry[]): Promise<void>;
    appendFile(path: string, data: string | Uint8Array, options?: WriteFileOptions): Promise<void>;
    copyFile(src: string, dest: string, mode?: number): Promise<void>;
    unlink(path: string): Promise<void>;
    truncate(path: string, len?: number): Promise<void>;
    mkdir(path: string): Promise<void>;
    rmdir(path: string): Promise<void>;
    readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[]>;
    cp(src: string, dest: string, options?: CpOptions): Promise<void>;
    rm(path: string, options?: RmOptions): Promise<void>;
    stat(path: string): Promise<Stats>;
    lstat(path: string): Promise<Stats>;
    private deserializeStats;
    exists(path: string): Promise<boolean>;
    access(path: string, mode?: number): Promise<void>;
    statfs(path?: string): Promise<StatFs>;
    du(path: string): Promise<DiskUsage>;
    symlink(target: string, path: string): Promise<void>;
    readlink(path: string): Promise<string>;
    symlinkBatch(links: SymlinkDefinition[]): Promise<void>;
    realpath(path: string): Promise<string>;
    rename(oldPath: string, newPath: string): Promise<void>;
    mkdtemp(prefix: string): Promise<string>;
    chmod(path: string, mode: number): Promise<void>;
    chown(path: string, uid: number, gid: number): Promise<void>;
    utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void>;
    lutimes(path: string, atime: Date | number, mtime: Date | number): Promise<void>;
    /**
     * Reset internal caches to free memory
     * Useful for long-running benchmarks or after bulk operations
     */
    resetCache(): Promise<void>;
    /**
     * Force full garbage collection by reinitializing the OPFS instance in the worker
     * This completely releases all handles and caches, preventing memory leaks in long-running operations
     * More aggressive than resetCache() - use when resetCache() isn't sufficient
     */
    gc(): Promise<void>;
}

export { OPFSWorker, type OPFSWorkerOptions };
