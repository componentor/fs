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

export { OPFSFileSystem } from './filesystem.js';
export { constants } from './constants.js';
export { FSError, createENOENT, createEEXIST, createEISDIR, createENOTDIR, createENOTEMPTY, createEACCES, createEINVAL, mapErrorCode } from './errors.js';
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
  FileSystemPromises,
  PathLike,
} from './types.js';

import { OPFSFileSystem } from './filesystem.js';

// Default singleton instance
export const fs = new OPFSFileSystem();

// Default export for convenience
export default fs;
