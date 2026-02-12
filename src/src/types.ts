/**
 * Type definitions for the VFS-based filesystem.
 * Mirrors Node.js fs module interfaces.
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

export type PathLike = string;

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

export interface Dir {
  path: string;
  read(): Promise<Dirent | null>;
  close(): Promise<void>;
  [Symbol.asyncIterator](): AsyncIterableIterator<Dirent>;
}

export interface FSWatcher {
  close(): void;
  ref(): this;
  unref(): this;
}

export type WatchListener = (eventType: 'rename' | 'change', filename: string | null) => void;
export type WatchFileListener = (curr: Stats, prev: Stats) => void;

/** VFS configuration options */
export interface VFSConfig {
  root?: string;
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
