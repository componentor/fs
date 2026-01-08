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
  access(path: string, mode?: number): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  copyFile(src: string, dest: string, mode?: number): Promise<void>;
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
