/**
 * VFS-FS: High-performance OPFS-based Node.js fs polyfill
 *
 * Uses SharedArrayBuffer + Atomics for sync operations with a VFS binary format.
 *
 * @example
 * ```typescript
 * import fs from '@componentor/fs';
 *
 * // Sync API (blocks until ready)
 * fs.writeFileSync('/hello.txt', 'Hello World!');
 * const data = fs.readFileSync('/hello.txt', 'utf8');
 *
 * // Async API
 * await fs.promises.writeFile('/async.txt', 'Async data');
 * const content = await fs.promises.readFile('/async.txt', 'utf8');
 * ```
 */

export { VFSFileSystem } from './filesystem.js';
export { constants } from './constants.js';
export { FSError, createError, statusToError } from './errors.js';
export { unpackToOPFS, loadFromOPFS, repairVFS } from './helpers.js';
export type { UnpackResult, LoadResult, RepairResult } from './helpers.js';
export * as path from './path.js';
export type {
  Stats,
  Dirent,
  ReadOptions,
  WriteOptions,
  MkdirOptions,
  RmdirOptions,
  RmOptions,
  ReaddirOptions,
  Encoding,
  PathLike,
  FileHandle,
  Dir,
  VFSConfig,
  WatchOptions,
  WatchEventType,
  FSWatcher,
  WatchListener,
  WatchFileListener,
  ReadStreamOptions,
  WriteStreamOptions,
} from './types.js';

import { VFSFileSystem } from './filesystem.js';

/** Create a configured VFS instance */
export function createFS(config?: import('./types.js').VFSConfig): VFSFileSystem {
  return new VFSFileSystem(config);
}

// Lazy default singleton — only created on first access
let _defaultFS: VFSFileSystem | undefined;

/** Get (or create) the default VFS singleton */
export function getDefaultFS(): VFSFileSystem {
  if (!_defaultFS) _defaultFS = new VFSFileSystem();
  return _defaultFS;
}

/** Async init helper — avoids blocking main thread */
export function init(): Promise<void> {
  return getDefaultFS().init();
}
