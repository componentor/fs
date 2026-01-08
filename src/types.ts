/**
 * File system types matching Node.js fs module interfaces
 */

export type Encoding = 'utf8' | 'utf-8' | 'ascii' | 'base64' | 'hex' | 'binary';

export interface ReadOptions {
  encoding?: Encoding | null;
  flag?: string;
}

export interface WriteOptions {
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

export interface MkdirOptions {
  recursive?: boolean;
  mode?: number;
}

export interface RmdirOptions {
  recursive?: boolean;
}

export interface RmOptions {
  recursive?: boolean;
  force?: boolean;
}

export interface ReaddirOptions {
  encoding?: Encoding | null;
  withFileTypes?: boolean;
}

export interface StatOptions {
  bigint?: boolean;
}

export interface Stats {
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

export interface Dirent {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isBlockDevice(): boolean;
  isCharacterDevice(): boolean;
  isSymbolicLink(): boolean;
  isFIFO(): boolean;
  isSocket(): boolean;
}

export interface FileSystemPromises {
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

export type KernelOperation =
  | 'read'
  | 'write'
  | 'stat'
  | 'mkdir'
  | 'rmdir'
  | 'unlink'
  | 'readdir'
  | 'rename'
  | 'exists'
  | 'truncate'
  | 'append'
  | 'copy';

export interface KernelMessage {
  id: string;
  type: KernelOperation | string;
  path: string;
  payload?: KernelPayload;
}

export interface KernelPayload {
  data?: Uint8Array;
  offset?: number;
  len?: number;
  newPath?: string;
  recursive?: boolean;
  ctrl?: Int32Array;
  dataBuffer?: SharedArrayBuffer;
  resultBuffer?: SharedArrayBuffer;
}

export interface KernelResponse {
  id: string;
  type?: string; // For signals like 'ready'
  result?: KernelResult;
  error?: string;
  code?: string;
}

export interface KernelResult {
  success?: boolean;
  data?: Uint8Array;
  exists?: boolean;
  size?: number;
  // Stat fields - Node.js compatible shape
  type?: 'file' | 'directory';
  mtimeMs?: number;
  mode?: number;
  // Legacy stat fields (for backwards compatibility)
  isFile?: boolean;
  isDirectory?: boolean;
  mtime?: number;
  entries?: string[];
}

export type PathLike = string;

// Stream options
export interface ReadStreamOptions {
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

export interface WriteStreamOptions {
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

// Watch options
export interface WatchOptions {
  persistent?: boolean;
  recursive?: boolean;
  encoding?: Encoding;
  signal?: AbortSignal;
}

export interface WatchFileOptions {
  persistent?: boolean;
  interval?: number;
}

export interface WatchEventType {
  eventType: 'rename' | 'change';
  filename: string | null;
}

// FileHandle for promises.open()
export interface FileHandle {
  fd: number;
  read(buffer: Uint8Array, offset?: number, length?: number, position?: number | null): Promise<{ bytesRead: number; buffer: Uint8Array }>;
  write(buffer: Uint8Array, offset?: number, length?: number, position?: number | null): Promise<{ bytesWritten: number; buffer: Uint8Array }>;
  readFile(options?: ReadOptions | Encoding | null): Promise<Uint8Array | string>;
  writeFile(data: Uint8Array | string, options?: WriteOptions | Encoding): Promise<void>;
  truncate(len?: number): Promise<void>;
  stat(): Promise<Stats>;
  sync(): Promise<void>;
  datasync(): Promise<void>;
  close(): Promise<void>;
}

// Dir for opendir()
export interface Dir {
  path: string;
  read(): Promise<Dirent | null>;
  close(): Promise<void>;
  [Symbol.asyncIterator](): AsyncIterableIterator<Dirent>;
}

// FSWatcher for watch()
export interface FSWatcher {
  close(): void;
  ref(): this;
  unref(): this;
}

// StatWatcher for watchFile()
export interface StatWatcher {
  ref(): this;
  unref(): this;
}

// Callback types for watch
export type WatchListener = (eventType: 'rename' | 'change', filename: string | null) => void;
export type WatchFileListener = (curr: Stats, prev: Stats) => void;

// FileSystemObserver types (experimental API)
export interface FileSystemChangeRecord {
  changedHandle: FileSystemHandle | null;
  relativePathComponents: string[];
  relativePathMovedFrom: string[] | null;
  root: FileSystemHandle;
  type: 'appeared' | 'disappeared' | 'modified' | 'moved' | 'errored' | 'unknown';
}

export type FileSystemObserverCallback = (
  records: FileSystemChangeRecord[],
  observer: FileSystemObserverInterface
) => void;

export interface FileSystemObserverInterface {
  observe(handle: FileSystemHandle, options?: { recursive?: boolean }): Promise<void>;
  disconnect(): void;
}

// Augment global for FileSystemObserver
declare global {
  interface Window {
    FileSystemObserver?: new (callback: FileSystemObserverCallback) => FileSystemObserverInterface;
  }
  // eslint-disable-next-line no-var
  var FileSystemObserver: (new (callback: FileSystemObserverCallback) => FileSystemObserverInterface) | undefined;
}
