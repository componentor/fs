/**
 * File system constants matching Node.js fs.constants
 */
export interface FSConstants {
  F_OK: number
  R_OK: number
  W_OK: number
  X_OK: number
  COPYFILE_EXCL: number
  COPYFILE_FICLONE: number
  COPYFILE_FICLONE_FORCE: number
  O_RDONLY: number
  O_WRONLY: number
  O_RDWR: number
  O_CREAT: number
  O_EXCL: number
  O_TRUNC: number
  O_APPEND: number
  S_IFMT: number
  S_IFREG: number
  S_IFDIR: number
  S_IFLNK: number
}

/**
 * Configuration options for OPFS instance
 */
export interface OPFSOptions {
  /** Use synchronous access handles when available (default: true) */
  useSync?: boolean
  /** Enable verbose logging (default: false) */
  verbose?: boolean
  /** Enable compression for batch writes (default: false) */
  useCompression?: boolean
  /** Enable CRC32 checksum for batch writes (default: true) */
  useChecksum?: boolean
}

/**
 * Options for readFile operation
 */
export interface ReadFileOptions {
  /** Text encoding (e.g., 'utf-8'). If not provided, returns Uint8Array */
  encoding?: string
}

/**
 * Options for writeFile operation
 */
export interface WriteFileOptions {
  /** Text encoding for string data */
  encoding?: string
}

/**
 * Entry for batch file write operation
 */
export interface BatchWriteEntry {
  /** File path to write */
  path: string
  /** Data to write (string or binary) */
  data: string | Uint8Array
}

/**
 * Result entry for batch file read operation
 */
export interface BatchReadResult {
  /** File path */
  path: string
  /** File data (null if file doesn't exist or error occurred) */
  data: Uint8Array | null
  /** Error if read failed */
  error?: Error
}

/**
 * Options for readdir operation
 */
export interface ReaddirOptions {
  /** Return Dirent objects instead of strings */
  withFileTypes?: boolean
}

/**
 * Directory entry (Dirent-like object)
 */
export interface Dirent {
  name: string
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

/**
 * File statistics
 */
export interface Stats {
  type: 'file' | 'dir' | 'symlink'
  size: number
  mode: number
  ctime: Date
  ctimeMs: number
  mtime: Date
  mtimeMs: number
  target?: string
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

/**
 * Options for rm operation
 */
export interface RmOptions {
  /** Remove directories and their contents recursively */
  recursive?: boolean
  /** Ignore if path doesn't exist */
  force?: boolean
}

/**
 * Options for cp operation
 */
export interface CpOptions {
  /** Copy directories recursively */
  recursive?: boolean
  /** Overwrite existing files */
  force?: boolean
  /** Throw if destination exists */
  errorOnExist?: boolean
}

/**
 * Options for watch operation
 */
export interface WatchOptions {
  /** Keep the process running while watching (default: true) */
  persistent?: boolean
  /** Watch subdirectories recursively */
  recursive?: boolean
  /** Abort signal to stop watching */
  signal?: AbortSignal
  /** Encoding for filename (default: 'utf8') */
  encoding?: string
}

/**
 * Watch event
 */
export interface WatchEvent {
  eventType: 'rename' | 'change'
  filename: string
}

/**
 * File watcher
 */
export interface FSWatcher {
  close(): void
  ref(): FSWatcher
  unref(): FSWatcher
  [Symbol.asyncIterator](): AsyncIterator<WatchEvent>
}

/**
 * Read stream options
 */
export interface ReadStreamOptions {
  /** Start reading from this byte position */
  start?: number
  /** Stop reading at this byte position */
  end?: number
  /** Chunk size for reading (default: 64KB) */
  highWaterMark?: number
}

/**
 * Write stream options
 */
export interface WriteStreamOptions {
  /** File open flags (default: 'w') */
  flags?: string
  /** Start writing at this byte position */
  start?: number
}

/**
 * Symlink definition for batch operations
 */
export interface SymlinkDefinition {
  target: string
  path: string
}

/**
 * Result of read operation on FileHandle
 */
export interface ReadResult {
  bytesRead: number
  buffer: Uint8Array
}

/**
 * Result of write operation on FileHandle
 */
export interface WriteResult {
  bytesWritten: number
  buffer: Uint8Array
}

/**
 * FileHandle interface (returned by open())
 */
export interface FileHandle {
  fd: number
  read(buffer: Uint8Array, offset?: number, length?: number, position?: number | null): Promise<ReadResult>
  write(buffer: Uint8Array, offset?: number, length?: number, position?: number | null): Promise<WriteResult>
  close(): Promise<void>
  stat(): Promise<Stats>
  truncate(len?: number): Promise<void>
  sync(): Promise<void>
  datasync(): Promise<void>
  readFile(options?: ReadFileOptions): Promise<string | Uint8Array>
  writeFile(data: string | Uint8Array, options?: WriteFileOptions): Promise<void>
  appendFile(data: string | Uint8Array, options?: WriteFileOptions): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}

/**
 * Directory handle (returned by opendir())
 */
export interface Dir {
  path: string
  read(): Promise<Dirent | null>
  close(): Promise<void>
  [Symbol.asyncIterator](): AsyncIterableIterator<Dirent>
}

/**
 * Disk usage result
 */
export interface DiskUsage {
  path: string
  size: number
}

/**
 * Filesystem statistics (similar to Node.js fs.statfs)
 */
export interface StatFs {
  /** Filesystem type (always 0 for OPFS) */
  type: number
  /** Optimal transfer block size (simulated as 4096) */
  bsize: number
  /** Total blocks in filesystem */
  blocks: number
  /** Free blocks in filesystem */
  bfree: number
  /** Available blocks for unprivileged users */
  bavail: number
  /** Total file nodes (0 - not available in browser) */
  files: number
  /** Free file nodes (0 - not available in browser) */
  ffree: number
  /** Bytes used by origin (from Storage API) */
  usage: number
  /** Total bytes available to origin (from Storage API) */
  quota: number
}

/**
 * Internal symlink cache structure
 */
export type SymlinkCache = Record<string, string>

/**
 * Watch callback function
 */
export type WatchCallback = (eventType: string, filename: string) => void

/**
 * Internal watch registration
 */
export interface WatchRegistration {
  path: string
  callbacks: Set<WatchCallback>
  recursive: boolean
}
