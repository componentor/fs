/**
 * OPFS FileSystem - Node.js fs-compatible API
 * Supports two performance tiers:
 * - Tier 1 (Sync): SharedArrayBuffer + Atomics - requires crossOriginIsolated (COOP/COEP headers)
 * - Tier 2 (Async): Promises API using Worker kernel - always available
 */

import * as path from './path.js';
import { constants } from './constants.js';
import {
  FSError,
  createENOENT,
  mapErrorCode,
} from './errors.js';
import type {
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
  KernelResponse,
  KernelResult,
  ReadStreamOptions,
  WriteStreamOptions,
  WatchOptions,
  WatchFileOptions,
  WatchEventType,
  FileHandle,
  Dir,
  FSWatcher,
  StatWatcher,
  WatchListener,
  WatchFileListener,
  FileSystemChangeRecord,
  FileSystemObserverCallback,
  FileSystemObserverInterface,
} from './types.js';

// Detect if we're running in a Worker context (where Atomics.wait and createSyncAccessHandle work)
const isWorkerContext = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;

// Worker kernel source - inlined for zero-config deployment
// Uses direct Worker postMessage for simple communication
// Includes sync handle caching for performance (same as sync kernel)
const KERNEL_SOURCE = `
const LOCK_NAME = 'opfs_fs_lock';
let messageQueue = [];
let isReady = false;
let cachedRoot = null;
const dirCache = new Map();

// Sync handle cache - MAJOR performance optimization
const syncHandleCache = new Map();
const MAX_HANDLES = 100;

async function getSyncHandle(filePath, create) {
  const cached = syncHandleCache.get(filePath);
  if (cached) return cached;

  // Evict oldest handles if cache is full
  if (syncHandleCache.size >= MAX_HANDLES) {
    const keys = Array.from(syncHandleCache.keys()).slice(0, 10);
    for (const key of keys) {
      const h = syncHandleCache.get(key);
      if (h) { try { h.close(); } catch {} syncHandleCache.delete(key); }
    }
  }

  const fh = await getFileHandle(filePath, create);
  const access = await fh.createSyncAccessHandle();
  syncHandleCache.set(filePath, access);
  return access;
}

function closeSyncHandle(filePath) {
  const h = syncHandleCache.get(filePath);
  if (h) { try { h.close(); } catch {} syncHandleCache.delete(filePath); }
}

function closeHandlesUnder(prefix) {
  for (const [p, h] of syncHandleCache) {
    if (p === prefix || p.startsWith(prefix + '/')) {
      try { h.close(); } catch {}
      syncHandleCache.delete(p);
    }
  }
}

// Clear directory cache entries for a path and all descendants
function clearDirCacheUnder(filePath) {
  // Convert to cache key format (no leading slash)
  const prefix = parsePath(filePath).join('/');
  if (!prefix) {
    // Root directory - clear everything
    dirCache.clear();
    return;
  }
  for (const key of dirCache.keys()) {
    if (key === prefix || key.startsWith(prefix + '/')) {
      dirCache.delete(key);
    }
  }
}

async function getRoot() {
  if (!cachedRoot) {
    cachedRoot = await navigator.storage.getDirectory();
  }
  return cachedRoot;
}

function parsePath(filePath) {
  return filePath.split('/').filter(Boolean);
}

async function getDirectoryHandle(parts, create = false) {
  if (parts.length === 0) return getRoot();

  const cacheKey = parts.join('/');
  if (dirCache.has(cacheKey)) {
    return dirCache.get(cacheKey);
  }

  let curr = await getRoot();
  let pathSoFar = '';

  for (const part of parts) {
    pathSoFar += (pathSoFar ? '/' : '') + part;

    if (dirCache.has(pathSoFar)) {
      curr = dirCache.get(pathSoFar);
    } else {
      curr = await curr.getDirectoryHandle(part, { create });
      dirCache.set(pathSoFar, curr);
    }
  }

  return curr;
}

async function getFileHandle(filePath, create = false) {
  const parts = parsePath(filePath);
  const fileName = parts.pop();
  if (!fileName) throw new Error('Invalid file path');
  const dir = parts.length > 0 ? await getDirectoryHandle(parts, create) : await getRoot();
  return await dir.getFileHandle(fileName, { create });
}

async function getParentAndName(filePath) {
  const parts = parsePath(filePath);
  const name = parts.pop();
  if (!name) throw new Error('Invalid path');
  const parent = parts.length > 0 ? await getDirectoryHandle(parts, false) : await getRoot();
  return { parent, name };
}

async function handleRead(filePath, payload) {
  const access = await getSyncHandle(filePath, false);
  const size = access.getSize();
  const offset = payload?.offset || 0;
  const len = payload?.len || (size - offset);
  const buf = new Uint8Array(len);
  const bytesRead = access.read(buf, { at: offset });
  return { data: buf.slice(0, bytesRead) };
}

async function handleWrite(filePath, payload) {
  const access = await getSyncHandle(filePath, true);
  if (payload?.data) {
    const offset = payload.offset ?? 0;
    if (offset === 0) access.truncate(0);
    access.write(payload.data, { at: offset });
    // Only flush if explicitly requested (default: true for safety)
    if (payload?.flush !== false) access.flush();
  }
  return { success: true };
}

async function handleAppend(filePath, payload) {
  const access = await getSyncHandle(filePath, true);
  if (payload?.data) {
    const size = access.getSize();
    access.write(payload.data, { at: size });
    if (payload?.flush !== false) access.flush();
  }
  return { success: true };
}

async function handleTruncate(filePath, payload) {
  const access = await getSyncHandle(filePath, false);
  access.truncate(payload?.len ?? 0);
  access.flush();
  return { success: true };
}

async function handleStat(filePath) {
  const parts = parsePath(filePath);
  // Node.js compatible stat shape: mode 33188 = file (0o100644), 16877 = dir (0o40755)
  if (parts.length === 0) {
    return { size: 0, mtimeMs: Date.now(), mode: 16877, type: 'directory' };
  }
  const name = parts.pop();
  const parent = parts.length > 0 ? await getDirectoryHandle(parts, false) : await getRoot();
  try {
    const fh = await parent.getFileHandle(name);
    // Use getFile() for metadata - faster than createSyncAccessHandle
    const file = await fh.getFile();
    return { size: file.size, mtimeMs: file.lastModified, mode: 33188, type: 'file' };
  } catch {
    try {
      await parent.getDirectoryHandle(name);
      return { size: 0, mtimeMs: Date.now(), mode: 16877, type: 'directory' };
    } catch {
      throw new Error('NotFoundError');
    }
  }
}

async function handleExists(filePath) {
  try {
    await handleStat(filePath);
    return { exists: true };
  } catch {
    return { exists: false };
  }
}

async function handleMkdir(filePath, payload) {
  const parts = parsePath(filePath);
  if (payload?.recursive) {
    let curr = await getRoot();
    for (const part of parts) {
      curr = await curr.getDirectoryHandle(part, { create: true });
    }
  } else {
    const name = parts.pop();
    if (!name) throw new Error('Invalid path');
    const parent = parts.length > 0 ? await getDirectoryHandle(parts, false) : await getRoot();
    await parent.getDirectoryHandle(name, { create: true });
  }
  return { success: true };
}

async function handleRmdir(filePath, payload) {
  closeHandlesUnder(filePath); // Close all cached file handles under this directory
  clearDirCacheUnder(filePath); // Clear stale directory cache entries
  const { parent, name } = await getParentAndName(filePath);
  if (payload?.recursive) {
    await parent.removeEntry(name, { recursive: true });
  } else {
    const dir = await parent.getDirectoryHandle(name);
    const entries = dir.entries();
    const first = await entries.next();
    if (!first.done) {
      const e = new Error('InvalidModificationError');
      e.name = 'InvalidModificationError';
      throw e;
    }
    await parent.removeEntry(name);
  }
  return { success: true };
}

async function handleUnlink(filePath) {
  closeSyncHandle(filePath); // Close cached handle before deleting
  const { parent, name } = await getParentAndName(filePath);
  await parent.removeEntry(name);
  return { success: true };
}

async function handleReaddir(filePath) {
  const parts = parsePath(filePath);
  const dir = parts.length > 0 ? await getDirectoryHandle(parts, false) : await getRoot();
  const entries = [];
  for await (const [name] of dir.entries()) {
    entries.push(name);
  }
  return { entries };
}

async function handleRename(oldPath, payload) {
  if (!payload?.newPath) throw new Error('newPath required');
  const newPath = payload.newPath;

  // Close cached handles for old path (file will be deleted)
  closeSyncHandle(oldPath);
  closeHandlesUnder(oldPath); // For directory renames
  clearDirCacheUnder(oldPath); // Clear stale directory cache entries

  const oldParts = parsePath(oldPath);
  const newParts = parsePath(newPath);
  const oldName = oldParts.pop();
  const newName = newParts.pop();
  const oldParent = oldParts.length > 0 ? await getDirectoryHandle(oldParts, false) : await getRoot();
  const newParent = newParts.length > 0 ? await getDirectoryHandle(newParts, true) : await getRoot();

  try {
    const fh = await oldParent.getFileHandle(oldName);
    const file = await fh.getFile();
    const data = new Uint8Array(await file.arrayBuffer());

    // Use cached handle for new file
    const access = await getSyncHandle(newPath, true);
    access.truncate(0);
    access.write(data, { at: 0 });
    access.flush();

    await oldParent.removeEntry(oldName);
    return { success: true };
  } catch {
    const oldDir = await oldParent.getDirectoryHandle(oldName);
    async function copyDir(src, dst, dstPath) {
      for await (const [name, handle] of src.entries()) {
        if (handle.kind === 'file') {
          const srcFile = await handle.getFile();
          const data = new Uint8Array(await srcFile.arrayBuffer());
          const filePath = dstPath + '/' + name;
          const access = await getSyncHandle(filePath, true);
          access.truncate(0);
          access.write(data, { at: 0 });
          access.flush();
        } else {
          const newSubDir = await dst.getDirectoryHandle(name, { create: true });
          await copyDir(handle, newSubDir, dstPath + '/' + name);
        }
      }
    }
    const newDir = await newParent.getDirectoryHandle(newName, { create: true });
    await copyDir(oldDir, newDir, newPath);
    await oldParent.removeEntry(oldName, { recursive: true });
    return { success: true };
  }
}

async function handleCopy(srcPath, payload) {
  if (!payload?.newPath) throw new Error('newPath required');
  const dstPath = payload.newPath;
  const srcParts = parsePath(srcPath);
  const srcName = srcParts.pop();
  const srcParent = srcParts.length > 0 ? await getDirectoryHandle(srcParts, false) : await getRoot();
  const srcFh = await srcParent.getFileHandle(srcName);
  const srcFile = await srcFh.getFile();
  const data = new Uint8Array(await srcFile.arrayBuffer());

  // Use cached handle for destination
  const access = await getSyncHandle(dstPath, true);
  access.truncate(0);
  access.write(data, { at: 0 });
  access.flush();
  return { success: true };
}

function handleFlush() {
  // Flush all cached sync handles
  for (const [, handle] of syncHandleCache) {
    try { handle.flush(); } catch {}
  }
  return { success: true };
}

function handlePurge() {
  // Flush and close all cached sync handles
  for (const [, handle] of syncHandleCache) {
    try { handle.flush(); handle.close(); } catch {}
  }
  syncHandleCache.clear();
  dirCache.clear();
  cachedRoot = null;
  return { success: true };
}

async function processMessage(msg) {
  const { type, path, payload } = msg;
  switch (type) {
    case 'read': return handleRead(path, payload);
    case 'write': return handleWrite(path, payload);
    case 'append': return handleAppend(path, payload);
    case 'truncate': return handleTruncate(path, payload);
    case 'stat': return handleStat(path);
    case 'exists': return handleExists(path);
    case 'mkdir': return handleMkdir(path, payload);
    case 'rmdir': return handleRmdir(path, payload);
    case 'unlink': return handleUnlink(path);
    case 'readdir': return handleReaddir(path);
    case 'rename': return handleRename(path, payload);
    case 'copy': return handleCopy(path, payload);
    case 'flush': return handleFlush();
    case 'purge': return handlePurge();
    default: throw new Error('Unknown operation: ' + type);
  }
}

function sendAtomicsResponse(result, payload) {
  const ctrl = payload.ctrl;
  if (result.data && payload.dataBuffer) {
    const view = new Uint8Array(payload.dataBuffer);
    view.set(result.data);
    Atomics.store(ctrl, 0, result.data.length);
  } else if (result.entries && payload.resultBuffer) {
    const json = JSON.stringify(result);
    const encoded = new TextEncoder().encode(json);
    const view = new Uint8Array(payload.resultBuffer);
    view.set(encoded);
    Atomics.store(ctrl, 0, encoded.length);
  } else if (result.success) {
    Atomics.store(ctrl, 0, 1);
  } else if (result.exists !== undefined) {
    Atomics.store(ctrl, 0, result.exists ? 1 : 0);
  } else if (result.isFile !== undefined) {
    if (payload.resultBuffer) {
      const json = JSON.stringify(result);
      const encoded = new TextEncoder().encode(json);
      const view = new Uint8Array(payload.resultBuffer);
      view.set(encoded);
      Atomics.store(ctrl, 0, encoded.length);
    } else {
      Atomics.store(ctrl, 0, result.size || 0);
    }
  }
  Atomics.notify(ctrl, 0);
}

// Handle incoming messages
async function handleMessage(msg) {
  const { id, payload } = msg;
  try {
    const result = await processMessage(msg);
    if (payload?.ctrl) {
      sendAtomicsResponse(result, payload);
    } else {
      // Use Transferable for data to avoid copying
      if (result.data) {
        const buffer = result.data.buffer;
        self.postMessage({ id, result }, [buffer]);
      } else {
        self.postMessage({ id, result });
      }
    }
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    // Use error name if it's a specific DOM exception, otherwise use message
    // (handleStat throws new Error('NotFoundError') where message contains the type)
    const errorName = error.name || 'Error';
    const errorCode = errorName !== 'Error' ? errorName : (error.message || 'Error');
    if (payload?.ctrl) {
      Atomics.store(payload.ctrl, 0, -1);
      Atomics.notify(payload.ctrl, 0);
    } else {
      self.postMessage({ id, error: errorCode, code: errorCode });
    }
  }
}

// Process queued messages after ready
function processQueue() {
  while (messageQueue.length > 0) {
    const msg = messageQueue.shift();
    handleMessage(msg);
  }
}

// Handle messages directly - no serialization needed because:
// - Tier 2: Client awaits response before sending next message
// - Each OPFSFileSystem instance has its own worker
self.onmessage = (event) => {
  if (isReady) {
    handleMessage(event.data);
  } else {
    messageQueue.push(event.data);
  }
};

// Signal ready after a timeout to ensure main thread handler is set
setTimeout(() => {
  isReady = true;
  processQueue();
  self.postMessage({ type: 'ready' });
}, 10);
`;

// --- Helper functions ---

function createStats(result: KernelResult): Stats {
  // Support both new format (type, mtimeMs) and legacy format (isFile, isDirectory, mtime)
  const isFile = result.type ? result.type === 'file' : (result.isFile ?? false);
  const isDir = result.type ? result.type === 'directory' : (result.isDirectory ?? false);
  const mtimeMs = result.mtimeMs ?? result.mtime ?? Date.now();
  const size = result.size ?? 0;
  const mode = result.mode ?? (isDir ? 16877 : 33188);

  return {
    isFile: () => isFile,
    isDirectory: () => isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    dev: 0,
    ino: 0,
    mode,
    nlink: 1,
    uid: 0,
    gid: 0,
    rdev: 0,
    size,
    blksize: 4096,
    blocks: Math.ceil(size / 512),
    atimeMs: mtimeMs,
    mtimeMs,
    ctimeMs: mtimeMs,
    birthtimeMs: mtimeMs,
    atime: new Date(mtimeMs),
    mtime: new Date(mtimeMs),
    ctime: new Date(mtimeMs),
    birthtime: new Date(mtimeMs),
  };
}

function createDirent(name: string, isDir: boolean): Dirent {
  return {
    name,
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  };
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function encodeData(data: Uint8Array | string | ArrayBufferView | ArrayBuffer, _encoding?: Encoding): Uint8Array {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data);
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  // Fallback for unknown types - convert to string
  return new TextEncoder().encode(String(data ?? ''));
}

function decodeData(data: Uint8Array, encoding?: Encoding | null): Uint8Array | string {
  if (encoding === 'utf8' || encoding === 'utf-8') {
    return new TextDecoder().decode(data);
  }
  return data;
}

// File descriptor entry for low-level read/write operations
interface FileDescriptor {
  path: string;
  flags: number;
  position: number;
}

export class OPFSFileSystem {
  private worker: Worker | null = null;
  private pending = new Map<string, { resolve: (v: KernelResult) => void; reject: (e: Error) => void; path: string; type: string }>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  // File descriptor table for openSync/readSync/writeSync/closeSync
  private fdTable = new Map<number, FileDescriptor>();
  private nextFd = 3; // Start at 3 (0=stdin, 1=stdout, 2=stderr)

  // Stat cache - reduces FS traffic by 30-50% for git operations
  private statCache = new Map<string, Stats>();

  constructor() {
    // Auto-initialize worker for fast async operations
    this.initWorker();
  }

  // Invalidate stat cache for a path (and parent for directory operations)
  private invalidateStat(filePath: string): void {
    const absPath = path.normalize(path.resolve(filePath));
    this.statCache.delete(absPath);
    // Also invalidate parent directory (for readdir caching if added later)
    const parent = path.dirname(absPath);
    if (parent !== absPath) {
      this.statCache.delete(parent);
    }
  }

  // Invalidate all stats under a directory (for recursive operations)
  private invalidateStatsUnder(dirPath: string): void {
    const prefix = path.normalize(path.resolve(dirPath));
    for (const key of this.statCache.keys()) {
      if (key === prefix || key.startsWith(prefix + '/')) {
        this.statCache.delete(key);
      }
    }
  }

  private async initWorker(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const blob = new Blob([KERNEL_SOURCE], { type: 'application/javascript' });
      this.worker = new Worker(URL.createObjectURL(blob));

      // Set up message handler FIRST, before worker can send 'ready'
      const readyPromise = new Promise<void>((resolve) => {
        this.worker!.onmessage = (event: MessageEvent<KernelResponse>) => {
          const { id, result, error, code, type: msgType } = event.data;

          // Handle ready signal
          if (msgType === 'ready') {
            resolve();
            return;
          }

          const pending = this.pending.get(id);
          if (pending) {
            this.pending.delete(id);
            if (error) {
              // Map DOM exception names to Node.js-style error codes
              // Use stored path from pending request (more reliable than extracting from error)
              const errCode = code || 'Error';
              if (errCode === 'NotFoundError' || errCode === 'NotAllowedError' ||
                  errCode === 'TypeMismatchError' || errCode === 'InvalidModificationError' ||
                  errCode === 'QuotaExceededError') {
                pending.reject(mapErrorCode(errCode, pending.type, pending.path));
              } else {
                pending.reject(new FSError(errCode, -1, `${error}: ${pending.type} '${pending.path}'`));
              }
            } else if (result) {
              pending.resolve(result);
            }
          }
        };
      });

      await readyPromise;
      this.initialized = true;
    })();

    return this.initPromise;
  }

  // Async call to worker - uses fast createSyncAccessHandle internally
  private async asyncCall(
    type: string,
    filePath: string,
    payload?: Record<string, unknown>
  ): Promise<KernelResult> {
    await this.initWorker();

    if (!this.worker) {
      throw new Error('Worker not initialized');
    }

    const absPath = path.resolve(filePath);
    const id = generateId();

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, path: absPath, type });

      const msg = {
        id,
        type,
        path: absPath,
        payload,
      };

      // Transfer ArrayBuffer if payload contains data (for writes)
      if (payload?.data instanceof Uint8Array) {
        // Clone the data since we're transferring - caller might still need original
        const clone = new Uint8Array(payload.data);
        const newPayload = { ...payload, data: clone };
        this.worker!.postMessage({ ...msg, payload: newPayload }, [clone.buffer]);
      } else {
        this.worker!.postMessage(msg);
      }
    });
  }

  // Kernel worker for Tier 1 sync operations (loaded from URL, not blob)
  private syncKernel: Worker | null = null;
  private syncKernelReady = false;

  /**
   * Initialize sync operations with a kernel worker loaded from URL.
   * Required for Tier 1 (SharedArrayBuffer + Atomics) to work in nested Workers.
   * @param kernelUrl URL to the kernel.js file (defaults to '/kernel.js')
   */
  async initSync(kernelUrl = '/kernel.js'): Promise<void> {
    if (this.syncKernelReady) return;

    this.syncKernel = new Worker(kernelUrl, { type: 'module' });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Kernel init timeout')), 10000);
      this.syncKernel!.onmessage = (e) => {
        if (e.data?.type === 'ready') {
          clearTimeout(timeout);
          this.syncKernelReady = true;
          resolve();
        }
      };
      this.syncKernel!.onerror = (e) => {
        clearTimeout(timeout);
        reject(new Error(`Kernel error: ${e.message}`));
      };
    });
  }

  // Tier 1: SharedArrayBuffer + Atomics via kernel worker
  // Data is transferred via SharedArrayBuffer (zero-copy)
  // Synchronization via Atomics.wait/notify

  // Buffer sizes for Tier 1 communication
  private static readonly META_SIZE = 1024 * 64; // 64KB for metadata/results
  private static readonly DEFAULT_DATA_SIZE = 1024 * 1024 * 10; // 10MB default buffer
  private static readonly MAX_CHUNK_SIZE = 1024 * 1024 * 10; // 10MB max per chunk

  // Reusable SharedArrayBuffer pool to prevent memory leaks
  // SharedArrayBuffers are expensive to allocate and don't get GC'd quickly
  private syncBufferPool: {
    ctrl: SharedArrayBuffer;
    meta: SharedArrayBuffer;
    data: SharedArrayBuffer;
    dataSize: number;
  } | null = null;

  private getSyncBuffers(requiredDataSize: number): {
    ctrlBuffer: SharedArrayBuffer;
    ctrl: Int32Array;
    metaBuffer: SharedArrayBuffer;
    dataBuffer: SharedArrayBuffer;
  } {
    // Reuse existing buffers if they're large enough
    if (this.syncBufferPool && this.syncBufferPool.dataSize >= requiredDataSize) {
      return {
        ctrlBuffer: this.syncBufferPool.ctrl,
        ctrl: new Int32Array(this.syncBufferPool.ctrl),
        metaBuffer: this.syncBufferPool.meta,
        dataBuffer: this.syncBufferPool.data,
      };
    }

    // Allocate new buffers (or larger ones if needed)
    const dataSize = Math.max(
      OPFSFileSystem.DEFAULT_DATA_SIZE,
      Math.min(requiredDataSize + 1024, 1024 * 1024 * 64) // Up to 64MB
    );

    const ctrlBuffer = new SharedArrayBuffer(4);
    const metaBuffer = new SharedArrayBuffer(OPFSFileSystem.META_SIZE);
    const dataBuffer = new SharedArrayBuffer(dataSize);

    // Store in pool for reuse
    this.syncBufferPool = {
      ctrl: ctrlBuffer,
      meta: metaBuffer,
      data: dataBuffer,
      dataSize,
    };

    return {
      ctrlBuffer,
      ctrl: new Int32Array(ctrlBuffer),
      metaBuffer,
      dataBuffer,
    };
  }

  private syncCallTier1(
    type: string,
    filePath: string,
    payload?: Record<string, unknown>
  ): KernelResult {
    if (!this.syncKernel || !this.syncKernelReady) {
      throw new Error('Sync kernel not initialized. Call initSync() first.');
    }

    // Path normalization: resolve and normalize to ensure consistent paths
    // e.g., /foo/bar, foo/bar/, and /foo//bar all become /foo/bar
    const absPath = path.normalize(path.resolve(filePath));

    const data = payload?.data instanceof Uint8Array ? payload.data : null;
    const dataSize = data?.length ?? 0;

    // For large writes, use chunked approach
    if (type === 'write' && data && dataSize > OPFSFileSystem.MAX_CHUNK_SIZE) {
      return this.syncCallTier1Chunked(absPath, data);
    }

    // Get reusable SharedArrayBuffers from pool (prevents memory leaks)
    const { ctrlBuffer, ctrl, metaBuffer, dataBuffer } = this.getSyncBuffers(dataSize);

    // Initialize control signal to "waiting"
    Atomics.store(ctrl, 0, 0);

    // For write operations, copy data to SharedArrayBuffer
    let dataLength = 0;
    if (data) {
      const view = new Uint8Array(dataBuffer);
      view.set(data);
      dataLength = data.length;
    }

    // Send command to kernel with SharedArrayBuffers
    this.syncKernel.postMessage({
      type,
      path: absPath,
      ctrlBuffer,
      metaBuffer,
      dataBuffer,
      dataLength,
      payload: payload ? { ...payload, data: undefined } : undefined,
    });

    // Block until kernel signals completion
    const waitResult = Atomics.wait(ctrl, 0, 0, 30000);
    if (waitResult === 'timed-out') {
      throw new Error('Operation timed out');
    }

    const status = Atomics.load(ctrl, 0);

    // Status codes:
    // > 0: success, value indicates data length or result
    // -1: error (error message in metaBuffer)
    // -2: not found

    if (status === -1) {
      const metaView = new Uint8Array(metaBuffer);
      let end = metaView.indexOf(0);
      if (end === -1) end = OPFSFileSystem.META_SIZE;
      const errorMsg = new TextDecoder().decode(metaView.slice(0, end));
      throw mapErrorCode(errorMsg || 'Error', type, absPath);
    }

    if (status === -2) {
      throw createENOENT(type, absPath);
    }

    // Parse result based on operation type
    if (type === 'read') {
      const bytesRead = status;
      const bufferSize = dataBuffer.byteLength;

      // If we filled the buffer completely, there might be more data
      // Use stat to check total size and switch to chunked read if needed
      if (bytesRead === bufferSize) {
        const stat = this.syncStatTier1(absPath);
        if (stat && stat.size > bytesRead) {
          // File is larger than buffer, use chunked read from the beginning
          return this.syncCallTier1ChunkedRead(absPath, stat.size);
        }
      }

      const dataView = new Uint8Array(dataBuffer);
      return { data: dataView.slice(0, bytesRead) };
    }

    if (type === 'stat') {
      // Binary stat: [type:u8] [pad:3] [mode:u32] [size:f64] [mtimeMs:f64]
      const view = new DataView(metaBuffer);
      const typeVal = view.getUint8(0);
      return {
        type: typeVal === 0 ? 'file' : 'directory',
        mode: view.getUint32(4, true),
        size: view.getFloat64(8, true),
        mtimeMs: view.getFloat64(16, true),
      };
    }

    if (type === 'readdir') {
      // Binary readdir: [count:u32] [len:u16 + utf8]...
      const view = new DataView(metaBuffer);
      const bytes = new Uint8Array(metaBuffer);
      const count = view.getUint32(0, true);
      const entries: string[] = [];
      let offset = 4;
      for (let i = 0; i < count; i++) {
        const len = view.getUint16(offset, true);
        offset += 2;
        // Use slice() instead of subarray() to copy from SharedArrayBuffer (TextDecoder requires regular ArrayBuffer)
        const name = new TextDecoder().decode(bytes.slice(offset, offset + len));
        entries.push(name);
        offset += len;
      }
      return { entries };
    }

    if (type === 'exists') {
      return { exists: status === 1 };
    }

    return { success: status === 1 };
  }

  // Mutex for async operations to prevent buffer reuse race conditions
  // Multiple concurrent Atomics.waitAsync calls would share the same buffer pool,
  // causing data corruption when operations complete out of order
  private asyncOperationPromise: Promise<void> = Promise.resolve();

  // Async version of syncCallTier1 using Atomics.waitAsync (works on main thread)
  // This allows the main thread to use the fast SharedArrayBuffer path without blocking
  // IMPORTANT: Operations are serialized to prevent buffer reuse race conditions
  private async syncCallTier1Async(
    type: string,
    filePath: string,
    payload?: Record<string, unknown>
  ): Promise<KernelResult> {
    // Serialize async operations to prevent buffer reuse race conditions
    const previousOp = this.asyncOperationPromise;
    let resolveCurrentOp: () => void;
    this.asyncOperationPromise = new Promise(resolve => { resolveCurrentOp = resolve; });

    try {
      // Wait for previous operation to complete
      await previousOp;
      return await this.syncCallTier1AsyncImpl(type, filePath, payload);
    } finally {
      // Signal that this operation is complete
      resolveCurrentOp!();
    }
  }

  // Implementation of async Tier 1 call (called after serialization)
  private async syncCallTier1AsyncImpl(
    type: string,
    filePath: string,
    payload?: Record<string, unknown>
  ): Promise<KernelResult> {
    if (!this.syncKernel || !this.syncKernelReady) {
      throw new Error('Sync kernel not initialized. Call initSync() first.');
    }

    const absPath = path.normalize(path.resolve(filePath));
    const data = payload?.data instanceof Uint8Array ? payload.data : null;
    const dataSize = data?.length ?? 0;

    // For large writes, use chunked approach (async version)
    if (type === 'write' && data && dataSize > OPFSFileSystem.MAX_CHUNK_SIZE) {
      return this.syncCallTier1ChunkedAsync(absPath, data);
    }

    const { ctrlBuffer, ctrl, metaBuffer, dataBuffer } = this.getSyncBuffers(dataSize);

    Atomics.store(ctrl, 0, 0);

    let dataLength = 0;
    if (data) {
      const view = new Uint8Array(dataBuffer);
      view.set(data);
      dataLength = data.length;
    }

    this.syncKernel.postMessage({
      type,
      path: absPath,
      ctrlBuffer,
      metaBuffer,
      dataBuffer,
      dataLength,
      payload: payload ? { ...payload, data: undefined } : undefined,
    });

    // Use Atomics.waitAsync for non-blocking wait (works on main thread)
    const waitResult = await Atomics.waitAsync(ctrl, 0, 0, 30000).value;
    if (waitResult === 'timed-out') {
      throw new Error('Operation timed out');
    }

    const status = Atomics.load(ctrl, 0);

    if (status === -1) {
      const metaView = new Uint8Array(metaBuffer);
      let end = metaView.indexOf(0);
      if (end === -1) end = OPFSFileSystem.META_SIZE;
      const errorMsg = new TextDecoder().decode(metaView.slice(0, end));
      throw mapErrorCode(errorMsg || 'Error', type, absPath);
    }

    if (status === -2) {
      throw createENOENT(type, absPath);
    }

    // Parse result based on operation type
    if (type === 'read') {
      const bytesRead = status;
      const bufferSize = dataBuffer.byteLength;

      if (bytesRead === bufferSize) {
        const stat = await this.syncStatTier1Async(absPath);
        if (stat && stat.size > bytesRead) {
          return this.syncCallTier1ChunkedReadAsync(absPath, stat.size);
        }
      }

      const dataView = new Uint8Array(dataBuffer);
      return { data: dataView.slice(0, bytesRead) };
    }

    if (type === 'stat') {
      const view = new DataView(metaBuffer);
      const typeVal = view.getUint8(0);
      return {
        type: typeVal === 0 ? 'file' : 'directory',
        mode: view.getUint32(4, true),
        size: view.getFloat64(8, true),
        mtimeMs: view.getFloat64(16, true),
      };
    }

    if (type === 'readdir') {
      const view = new DataView(metaBuffer);
      const bytes = new Uint8Array(metaBuffer);
      const count = view.getUint32(0, true);
      const entries: string[] = [];
      let offset = 4;
      for (let i = 0; i < count; i++) {
        const len = view.getUint16(offset, true);
        offset += 2;
        // Use slice() instead of subarray() to copy from SharedArrayBuffer (TextDecoder requires regular ArrayBuffer)
        const name = new TextDecoder().decode(bytes.slice(offset, offset + len));
        entries.push(name);
        offset += len;
      }
      return { entries };
    }

    if (type === 'exists') {
      return { exists: status === 1 };
    }

    return { success: status === 1 };
  }

  // Async stat helper for main thread
  // NOTE: Called from within syncCallTier1AsyncImpl, so uses impl directly to avoid deadlock
  private async syncStatTier1Async(absPath: string): Promise<{ size: number } | null> {
    try {
      const result = await this.syncCallTier1AsyncImpl('stat', absPath);
      return { size: result.size as number };
    } catch {
      return null;
    }
  }

  // Async chunked write for main thread
  private async syncCallTier1ChunkedAsync(
    absPath: string,
    data: Uint8Array
  ): Promise<KernelResult> {
    const totalSize = data.length;
    let offset = 0;

    while (offset < totalSize) {
      const remaining = totalSize - offset;
      const currentChunkSize = Math.min(remaining, OPFSFileSystem.MAX_CHUNK_SIZE);
      const chunk = data.subarray(offset, offset + currentChunkSize);

      const { ctrlBuffer, ctrl, metaBuffer, dataBuffer } = this.getSyncBuffers(currentChunkSize);
      Atomics.store(ctrl, 0, 0);

      const view = new Uint8Array(dataBuffer);
      view.set(chunk);

      const isFirstChunk = offset === 0;
      this.syncKernel!.postMessage({
        type: isFirstChunk ? 'write' : 'append',
        path: absPath,
        ctrlBuffer,
        metaBuffer,
        dataBuffer,
        dataLength: currentChunkSize,
        payload: { flush: false },
      });

      const waitResult = await Atomics.waitAsync(ctrl, 0, 0, 30000).value;
      if (waitResult === 'timed-out') {
        throw new Error('Chunked write timed out');
      }

      const status = Atomics.load(ctrl, 0);
      if (status === -1 || status === -2) {
        throw createENOENT('write', absPath);
      }

      offset += currentChunkSize;
    }

    return { success: true };
  }

  // Async chunked read for main thread
  private async syncCallTier1ChunkedReadAsync(
    absPath: string,
    totalSize: number
  ): Promise<KernelResult> {
    const result = new Uint8Array(totalSize);
    let offset = 0;

    while (offset < totalSize) {
      const remaining = totalSize - offset;
      const currentChunkSize = Math.min(remaining, OPFSFileSystem.MAX_CHUNK_SIZE);

      const { ctrlBuffer, ctrl, metaBuffer, dataBuffer } = this.getSyncBuffers(currentChunkSize);
      Atomics.store(ctrl, 0, 0);

      this.syncKernel!.postMessage({
        type: 'readChunk',
        path: absPath,
        ctrlBuffer,
        metaBuffer,
        dataBuffer,
        dataLength: 0,
        payload: { offset, length: currentChunkSize },
      });

      const waitResult = await Atomics.waitAsync(ctrl, 0, 0, 30000).value;
      if (waitResult === 'timed-out') {
        throw new Error('Chunked read timed out');
      }

      const status = Atomics.load(ctrl, 0);
      if (status === -1 || status === -2) {
        throw createENOENT('read', absPath);
      }

      const bytesRead = status;
      const dataView = new Uint8Array(dataBuffer);
      result.set(dataView.subarray(0, bytesRead), offset);
      offset += bytesRead;
    }

    return { data: result };
  }

  // Chunked write for files larger than MAX_CHUNK_SIZE
  private syncCallTier1Chunked(
    absPath: string,
    data: Uint8Array
  ): KernelResult {
    const totalSize = data.length;
    const chunkSize = OPFSFileSystem.MAX_CHUNK_SIZE;

    // Reuse buffers from pool (prevents memory leaks)
    const { ctrlBuffer, ctrl, metaBuffer, dataBuffer } = this.getSyncBuffers(chunkSize);
    const dataView = new Uint8Array(dataBuffer);

    let offset = 0;
    while (offset < totalSize) {
      const remaining = totalSize - offset;
      const currentChunkSize = Math.min(chunkSize, remaining);
      const chunk = data.subarray(offset, offset + currentChunkSize);

      // Reset control signal
      Atomics.store(ctrl, 0, 0);

      // Copy chunk to SharedArrayBuffer
      dataView.set(chunk);

      // First chunk: truncate file (offset 0), subsequent chunks: append at offset
      this.syncKernel!.postMessage({
        type: 'write',
        path: absPath,
        ctrlBuffer,
        metaBuffer,
        dataBuffer,
        dataLength: currentChunkSize,
        payload: { offset }, // Kernel writes at this offset
      });

      // Wait for completion
      const waitResult = Atomics.wait(ctrl, 0, 0, 60000); // Longer timeout for large chunks
      if (waitResult === 'timed-out') {
        throw new Error(`Chunked write timed out at offset ${offset}`);
      }

      const status = Atomics.load(ctrl, 0);
      if (status === -1) {
        const metaView = new Uint8Array(metaBuffer);
        let end = metaView.indexOf(0);
        if (end === -1) end = OPFSFileSystem.META_SIZE;
        const errorMsg = new TextDecoder().decode(metaView.slice(0, end));
        throw mapErrorCode(errorMsg || 'Error', 'write', absPath);
      }
      if (status === -2) {
        throw createENOENT('write', absPath);
      }

      offset += currentChunkSize;
    }

    return { success: true };
  }

  // Chunked read for files larger than buffer size
  private syncCallTier1ChunkedRead(
    absPath: string,
    totalSize: number
  ): KernelResult {
    const chunkSize = OPFSFileSystem.MAX_CHUNK_SIZE;

    // Allocate result buffer on main thread
    const result = new Uint8Array(totalSize);

    // Reuse buffers from pool (prevents memory leaks)
    const { ctrlBuffer, ctrl, metaBuffer, dataBuffer } = this.getSyncBuffers(chunkSize);

    let offset = 0;
    while (offset < totalSize) {
      const remaining = totalSize - offset;
      const currentChunkSize = Math.min(chunkSize, remaining);

      // Reset control signal
      Atomics.store(ctrl, 0, 0);

      // Request chunk from kernel
      this.syncKernel!.postMessage({
        type: 'read',
        path: absPath,
        ctrlBuffer,
        metaBuffer,
        dataBuffer,
        dataLength: 0,
        payload: { offset, len: currentChunkSize },
      });

      // Wait for completion
      const waitResult = Atomics.wait(ctrl, 0, 0, 60000);
      if (waitResult === 'timed-out') {
        throw new Error(`Chunked read timed out at offset ${offset}`);
      }

      const status = Atomics.load(ctrl, 0);
      if (status === -1) {
        const metaView = new Uint8Array(metaBuffer);
        let end = metaView.indexOf(0);
        if (end === -1) end = OPFSFileSystem.META_SIZE;
        const errorMsg = new TextDecoder().decode(metaView.slice(0, end));
        throw mapErrorCode(errorMsg || 'Error', 'read', absPath);
      }
      if (status === -2) {
        throw createENOENT('read', absPath);
      }

      // Copy chunk from SharedArrayBuffer to result
      const bytesRead = status;
      const dataView = new Uint8Array(dataBuffer, 0, bytesRead);
      result.set(dataView, offset);

      offset += bytesRead;

      // If we read less than requested, we've reached EOF
      if (bytesRead < currentChunkSize) {
        break;
      }
    }

    return { data: result.subarray(0, offset) };
  }

  // Get file size via stat (used for chunked reads)
  private syncStatTier1(absPath: string): { size: number } | null {
    // Reuse buffers from pool (prevents memory leaks)
    const { ctrlBuffer, ctrl, metaBuffer, dataBuffer } = this.getSyncBuffers(1024);

    Atomics.store(ctrl, 0, 0);

    this.syncKernel!.postMessage({
      type: 'stat',
      path: absPath,
      ctrlBuffer,
      metaBuffer,
      dataBuffer,
      dataLength: 0,
    });

    const waitResult = Atomics.wait(ctrl, 0, 0, 10000);
    if (waitResult === 'timed-out') {
      return null;
    }

    const status = Atomics.load(ctrl, 0);
    if (status <= 0) {
      return null;
    }

    // Binary stat: [type:u8] [pad:3] [mode:u32] [size:f64] [mtimeMs:f64]
    const view = new DataView(metaBuffer);
    return { size: view.getFloat64(8, true) };
  }

  private syncCall(
    type: string,
    filePath: string,
    payload?: Record<string, unknown>
  ): KernelResult {
    // Sync operations require SharedArrayBuffer + Atomics
    // This requires crossOriginIsolated (COOP/COEP headers) and initSync() to be called
    if (
      isWorkerContext &&
      typeof SharedArrayBuffer !== 'undefined' &&
      this.syncKernelReady
    ) {
      return this.syncCallTier1(type, filePath, payload);
    }

    // No sync tier available - throw helpful error
    throw new Error(
      `Sync operations require crossOriginIsolated environment (COOP/COEP headers) and initSync() to be called. ` +
      `Current state: crossOriginIsolated=${typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : 'N/A'}, ` +
      `isWorkerContext=${isWorkerContext}, syncKernelReady=${this.syncKernelReady}. ` +
      `Use fs.promises.* for async operations that work everywhere.`
    );
  }

  // --- Synchronous API (Node.js fs compatible) ---

  readFileSync(filePath: string, options?: ReadOptions | Encoding | null): Uint8Array | string {
    const encoding = typeof options === 'string' ? options : options?.encoding;
    const result = this.syncCall('read', filePath);
    if (!result.data) throw createENOENT('read', filePath);
    return decodeData(result.data, encoding);
  }

  writeFileSync(filePath: string, data: Uint8Array | string, options?: WriteOptions | Encoding): void {
    const opts = typeof options === 'string' ? { encoding: options } : options;
    const encoded = encodeData(data, opts?.encoding);
    // Pass flush option (defaults to true in kernel for safety)
    this.syncCall('write', filePath, { data: encoded, flush: opts?.flush });
    this.invalidateStat(filePath);
  }

  appendFileSync(filePath: string, data: Uint8Array | string, options?: WriteOptions | Encoding): void {
    const encoding = typeof options === 'string' ? options : options?.encoding;
    const encoded = encodeData(data, encoding);
    this.syncCall('append', filePath, { data: encoded });
    this.invalidateStat(filePath);
  }

  existsSync(filePath: string): boolean {
    try {
      const result = this.syncCall('exists', filePath);
      return result.exists ?? false;
    } catch {
      return false;
    }
  }

  mkdirSync(filePath: string, options?: MkdirOptions | number): string | undefined {
    const recursive = typeof options === 'object' ? options?.recursive : false;
    this.syncCall('mkdir', filePath, { recursive });
    this.invalidateStat(filePath);
    return recursive ? filePath : undefined;
  }

  rmdirSync(filePath: string, options?: RmdirOptions): void {
    this.syncCall('rmdir', filePath, { recursive: options?.recursive });
    if (options?.recursive) {
      this.invalidateStatsUnder(filePath);
    } else {
      this.invalidateStat(filePath);
    }
  }

  rmSync(filePath: string, options?: RmOptions): void {
    try {
      const result = this.syncCall('stat', filePath);
      try {
        if (result.isDirectory || result.type === 'directory') {
          this.syncCall('rmdir', filePath, { recursive: options?.recursive });
          if (options?.recursive) {
            this.invalidateStatsUnder(filePath);
          } else {
            this.invalidateStat(filePath);
          }
        } else {
          this.syncCall('unlink', filePath);
          this.invalidateStat(filePath);
        }
      } catch (e) {
        // Handle errors from rmdir/unlink with force option
        if (!options?.force) throw e;
      }
    } catch (e) {
      // Handle errors from stat with force option
      if (!options?.force) throw e;
    }
  }

  unlinkSync(filePath: string): void {
    this.syncCall('unlink', filePath);
    this.invalidateStat(filePath);
  }

  readdirSync(filePath: string, options?: ReaddirOptions | Encoding | null): string[] | Dirent[] {
    const result = this.syncCall('readdir', filePath);
    const entries = result.entries || [];

    const opts = typeof options === 'object' ? options : { encoding: options };

    if (opts?.withFileTypes) {
      return entries.map((name) => {
        try {
          const stat = this.syncCall('stat', path.join(filePath, name));
          // Check type first (from kernel result), fall back to isDirectory boolean
          const isDir = stat.type === 'directory' || stat.isDirectory === true;
          return createDirent(name, isDir);
        } catch {
          return createDirent(name, false);
        }
      });
    }

    return entries;
  }

  statSync(filePath: string): Stats {
    const absPath = path.normalize(path.resolve(filePath));

    // Check cache first
    const cached = this.statCache.get(absPath);
    if (cached) return cached;

    const result = this.syncCall('stat', filePath);
    // Check for both new format (type) and legacy format (isFile/isDirectory)
    if (result.type === undefined && result.isFile === undefined && result.isDirectory === undefined) {
      throw createENOENT('stat', filePath);
    }
    const stats = createStats(result);

    // Cache the result
    this.statCache.set(absPath, stats);
    return stats;
  }

  lstatSync(filePath: string): Stats {
    const stats = this.statSync(filePath);
    // Check if it's a symlink and update the stats accordingly
    if (stats.isFile() && this.isSymlinkSync(filePath)) {
      return this.createSymlinkStats(stats);
    }
    return stats;
  }

  /**
   * Create stats object for a symlink file.
   */
  private createSymlinkStats(baseStats: Stats): Stats {
    return {
      ...baseStats,
      isFile: () => false,
      isSymbolicLink: () => true,
      // Symlink mode: 0o120777 (41471 decimal)
      mode: 41471,
    };
  }

  renameSync(oldPath: string, newPath: string): void {
    this.syncCall('rename', oldPath, { newPath });
    this.invalidateStat(oldPath);
    this.invalidateStat(newPath);
  }

  copyFileSync(src: string, dest: string): void {
    this.syncCall('copy', src, { newPath: dest });
    this.invalidateStat(dest);
  }

  truncateSync(filePath: string, len = 0): void {
    this.syncCall('truncate', filePath, { len });
    this.invalidateStat(filePath);
  }

  /**
   * Flush all pending writes to storage.
   * Use this after writes with { flush: false } to ensure data is persisted.
   */
  flushSync(): void {
    this.syncCall('flush', '/');
  }

  /**
   * Alias for flushSync() - matches Node.js fdatasync behavior
   */
  fdatasyncSync(): void {
    this.flushSync();
  }

  /**
   * Purge all kernel caches (sync handles, directory handles).
   * Use between major operations to ensure clean state.
   */
  purgeSync(): void {
    this.syncCall('purge', '/');
    this.statCache.clear();
  }

  accessSync(filePath: string, _mode?: number): void {
    const exists = this.existsSync(filePath);
    if (!exists) {
      throw createENOENT('access', filePath);
    }
  }

  // --- Low-level File Descriptor API ---
  // For efficient packfile access (read specific offsets without loading entire file)

  openSync(filePath: string, flags: string | number = 'r'): number {
    // Verify file exists for read modes
    const flagNum = typeof flags === 'string' ? this.parseFlags(flags) : flags;
    const isReadOnly = (flagNum & constants.O_WRONLY) === 0 && (flagNum & constants.O_RDWR) === 0;

    if (isReadOnly && !this.existsSync(filePath)) {
      throw createENOENT('open', filePath);
    }

    const fd = this.nextFd++;
    this.fdTable.set(fd, {
      path: path.normalize(path.resolve(filePath)),
      flags: flagNum,
      position: 0,
    });
    return fd;
  }

  closeSync(fd: number): void {
    if (!this.fdTable.has(fd)) {
      throw new FSError('EBADF', -9, `bad file descriptor: ${fd}`);
    }
    this.fdTable.delete(fd);
  }

  readSync(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null
  ): number {
    const entry = this.fdTable.get(fd);
    if (!entry) {
      throw new FSError('EBADF', -9, `bad file descriptor: ${fd}`);
    }

    const readPos = position !== null ? position : entry.position;
    const result = this.syncCall('read', entry.path, { offset: readPos, len: length });

    if (!result.data) {
      return 0; // EOF or error
    }

    // Copy data into the provided buffer at the specified offset
    const bytesRead = Math.min(result.data.length, length);
    buffer.set(result.data.subarray(0, bytesRead), offset);

    // Update position if not using explicit position
    if (position === null) {
      entry.position += bytesRead;
    }

    return bytesRead;
  }

  writeSync(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null
  ): number {
    const entry = this.fdTable.get(fd);
    if (!entry) {
      throw new FSError('EBADF', -9, `bad file descriptor: ${fd}`);
    }

    const writePos = position !== null ? position : entry.position;
    const data = buffer.subarray(offset, offset + length);

    // Use truncate: false to avoid truncating on positional writes
    this.syncCall('write', entry.path, {
      data,
      offset: writePos,
      truncate: false,
    });

    // Invalidate stat cache after write
    this.invalidateStat(entry.path);

    // Update position if not using explicit position
    if (position === null) {
      entry.position += length;
    }

    return length;
  }

  fstatSync(fd: number): Stats {
    const entry = this.fdTable.get(fd);
    if (!entry) {
      throw new FSError('EBADF', -9, `bad file descriptor: ${fd}`);
    }
    return this.statSync(entry.path);
  }

  ftruncateSync(fd: number, len = 0): void {
    const entry = this.fdTable.get(fd);
    if (!entry) {
      throw new FSError('EBADF', -9, `bad file descriptor: ${fd}`);
    }
    this.truncateSync(entry.path, len);
  }

  /**
   * Resolve a path to an absolute path.
   * OPFS doesn't support symlinks, so this just normalizes the path.
   */
  realpathSync(filePath: string): string {
    // Verify the path exists
    this.accessSync(filePath);
    return path.normalize(path.resolve(filePath));
  }

  /**
   * Change file mode (no-op in OPFS - permissions not supported).
   */
  chmodSync(_filePath: string, _mode: number): void {
    // No-op: OPFS doesn't support file permissions
  }

  /**
   * Change file owner (no-op in OPFS - ownership not supported).
   */
  chownSync(_filePath: string, _uid: number, _gid: number): void {
    // No-op: OPFS doesn't support file ownership
  }

  /**
   * Change file timestamps (no-op in OPFS - timestamps are read-only).
   */
  utimesSync(_filePath: string, _atime: Date | number, _mtime: Date | number): void {
    // No-op: OPFS doesn't support modifying timestamps
  }

  // Magic prefix for symlink files - must be unique enough to not appear in regular files
  private static readonly SYMLINK_MAGIC = 'OPFS_SYMLINK_V1:';

  /**
   * Create a symbolic link.
   * Emulated by storing target path in a special file format.
   */
  symlinkSync(target: string, filePath: string, _type?: string): void {
    const content = OPFSFileSystem.SYMLINK_MAGIC + target;
    this.writeFileSync(filePath, content);
  }

  /**
   * Read a symbolic link target.
   */
  readlinkSync(filePath: string): string {
    const content = this.readFileSync(filePath, { encoding: 'utf8' }) as string;
    if (!content.startsWith(OPFSFileSystem.SYMLINK_MAGIC)) {
      throw new FSError('EINVAL', -22, `EINVAL: invalid argument, readlink '${filePath}'`, 'readlink', filePath);
    }
    return content.slice(OPFSFileSystem.SYMLINK_MAGIC.length);
  }

  /**
   * Check if a file is a symlink (sync).
   */
  private isSymlinkSync(filePath: string): boolean {
    try {
      const content = this.readFileSync(filePath, { encoding: 'utf8' }) as string;
      return content.startsWith(OPFSFileSystem.SYMLINK_MAGIC);
    } catch {
      return false;
    }
  }

  /**
   * Check if a file is a symlink (async).
   */
  private async isSymlinkAsync(filePath: string): Promise<boolean> {
    try {
      const content = await this.promises.readFile(filePath, { encoding: 'utf8' }) as string;
      return content.startsWith(OPFSFileSystem.SYMLINK_MAGIC);
    } catch {
      return false;
    }
  }

  /**
   * Create a hard link.
   * Emulated by copying the file (true hard links not supported in OPFS).
   */
  linkSync(existingPath: string, newPath: string): void {
    // For symlinks, copy the symlink file itself (not the target)
    this.copyFileSync(existingPath, newPath);
  }

  private parseFlags(flags: string): number {
    switch (flags) {
      case 'r': return constants.O_RDONLY;
      case 'r+': return constants.O_RDWR;
      case 'w': return constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC;
      case 'w+': return constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC;
      case 'a': return constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND;
      case 'a+': return constants.O_RDWR | constants.O_CREAT | constants.O_APPEND;
      default: return constants.O_RDONLY;
    }
  }

  // --- Async Promises API ---
  // When Tier 1 sync kernel is available, use it for better performance (wrapped in Promise)
  // Otherwise fall back to async worker

  // Helper: Use sync kernel if available (in worker context), otherwise async worker
  private async fastCall(
    type: string,
    filePath: string,
    payload?: Record<string, unknown>
  ): Promise<KernelResult> {
    // Use sync kernel when available for best performance
    // Benefits of sync kernel:
    // 1. SharedArrayBuffer zero-copy data transfer
    // 2. Optimized sync handle caching
    // 3. No postMessage serialization overhead
    if (this.syncKernelReady) {
      if (isWorkerContext) {
        // In Worker: use blocking Atomics.wait (fastest)
        return Promise.resolve(this.syncCallTier1(type, filePath, payload));
      } else {
        // Main thread: use Atomics.waitAsync (non-blocking but still fast)
        return this.syncCallTier1Async(type, filePath, payload);
      }
    }
    // Fallback to async worker
    return this.asyncCall(type, filePath, payload);
  }

  promises: FileSystemPromises = {
    readFile: async (filePath: string, options?: ReadOptions | Encoding | null) => {
      // Validate path - isomorphic-git sometimes calls with no args
      if (!filePath) {
        throw createENOENT('read', filePath || '');
      }
      const encoding = typeof options === 'string' ? options : options?.encoding;

      // Use sync kernel if available (faster than async worker)
      if (this.syncKernelReady) {
        if (isWorkerContext) {
          // Worker: blocking wait (fastest)
          const result = this.syncCallTier1('read', filePath);
          if (!result.data) throw createENOENT('read', filePath);
          return decodeData(result.data, encoding);
        } else {
          // Main thread: use Atomics.waitAsync (non-blocking)
          const result = await this.syncCallTier1Async('read', filePath);
          if (!result.data) throw createENOENT('read', filePath);
          return decodeData(result.data, encoding);
        }
      }

      // Fallback to async worker (no sync kernel) - ensures consistent read/write path
      // Using asyncCall ensures reads go through same worker as writes,
      // which is important for file locking and cache consistency
      const result = await this.asyncCall('read', filePath);
      if (!result.data) throw createENOENT('read', filePath);
      return decodeData(result.data, encoding);
    },

    writeFile: async (filePath: string, data: Uint8Array | string, options?: WriteOptions | Encoding) => {
      const opts = typeof options === 'string' ? { encoding: options } : options;
      const encoded = encodeData(data, opts?.encoding);
      await this.fastCall('write', filePath, { data: encoded, flush: opts?.flush });
      this.invalidateStat(filePath);
    },

    appendFile: async (filePath: string, data: Uint8Array | string, options?: WriteOptions | Encoding) => {
      const opts = typeof options === 'string' ? { encoding: options } : options;
      const encoded = encodeData(data, opts?.encoding);
      await this.fastCall('append', filePath, { data: encoded, flush: opts?.flush });
      this.invalidateStat(filePath);
    },

    mkdir: async (filePath: string, options?: MkdirOptions | number) => {
      const recursive = typeof options === 'object' ? options?.recursive : false;
      await this.fastCall('mkdir', filePath, { recursive });
      return recursive ? filePath : undefined;
    },

    rmdir: async (filePath: string, options?: RmdirOptions) => {
      await this.fastCall('rmdir', filePath, { recursive: options?.recursive });
    },

    rm: async (filePath: string, options?: RmOptions) => {
      try {
        const result = await this.fastCall('stat', filePath);
        try {
          if (result.isDirectory || result.type === 'directory') {
            await this.fastCall('rmdir', filePath, { recursive: options?.recursive });
            if (options?.recursive) {
              this.invalidateStatsUnder(filePath);
            } else {
              this.invalidateStat(filePath);
            }
          } else {
            await this.fastCall('unlink', filePath);
            this.invalidateStat(filePath);
          }
        } catch (e) {
          // Handle errors from rmdir/unlink with force option
          if (!options?.force) throw e;
        }
      } catch (e) {
        // Handle errors from stat with force option
        if (!options?.force) throw e;
      }
    },

    unlink: async (filePath: string) => {
      await this.fastCall('unlink', filePath);
    },

    readdir: async (filePath: string, options?: ReaddirOptions | Encoding | null) => {
      const result = await this.fastCall('readdir', filePath);
      const entries = result.entries || [];
      const opts = typeof options === 'object' ? options : { encoding: options };

      if (opts?.withFileTypes) {
        const dirents: Dirent[] = [];
        for (const name of entries) {
          try {
            const stat = await this.fastCall('stat', path.join(filePath, name));
            // Check type first (from kernel result), fall back to isDirectory boolean
            const isDir = stat.type === 'directory' || stat.isDirectory === true;
            dirents.push(createDirent(name, isDir));
          } catch {
            dirents.push(createDirent(name, false));
          }
        }
        return dirents;
      }

      return entries;
    },

    stat: async (filePath: string) => {
      const result = await this.fastCall('stat', filePath);
      return createStats(result);
    },

    access: async (filePath: string, _mode?: number) => {
      const result = await this.fastCall('exists', filePath);
      if (!result.exists) {
        throw createENOENT('access', filePath);
      }
    },

    rename: async (oldFilePath: string, newFilePath: string) => {
      await this.fastCall('rename', oldFilePath, { newPath: path.resolve(newFilePath) });
    },

    copyFile: async (srcPath: string, destPath: string) => {
      await this.fastCall('copy', srcPath, { newPath: path.resolve(destPath) });
    },

    truncate: async (filePath: string, len = 0) => {
      await this.fastCall('truncate', filePath, { len });
      this.invalidateStat(filePath);
    },

    lstat: async (filePath: string) => {
      const result = await this.fastCall('stat', filePath);
      const stats = createStats(result);
      // Check if it's a symlink
      if (stats.isFile()) {
        const isSymlink = await this.isSymlinkAsync(filePath);
        if (isSymlink) {
          return this.createSymlinkStats(stats);
        }
      }
      return stats;
    },

    realpath: async (filePath: string) => {
      // Verify the path exists
      await this.promises.access(filePath);
      return path.normalize(path.resolve(filePath));
    },

    exists: async (filePath: string) => {
      try {
        const result = await this.fastCall('exists', filePath);
        return result.exists ?? false;
      } catch {
        return false;
      }
    },

    chmod: async (_filePath: string, _mode: number) => {
      // No-op: OPFS doesn't support file permissions
    },

    chown: async (_filePath: string, _uid: number, _gid: number) => {
      // No-op: OPFS doesn't support file ownership
    },

    utimes: async (_filePath: string, _atime: Date | number, _mtime: Date | number) => {
      // No-op: OPFS doesn't support modifying timestamps
    },

    symlink: async (target: string, filePath: string, _type?: string) => {
      const content = OPFSFileSystem.SYMLINK_MAGIC + target;
      await this.promises.writeFile(filePath, content);
    },

    readlink: async (filePath: string): Promise<string> => {
      const content = await this.promises.readFile(filePath, { encoding: 'utf8' }) as string;
      if (!content.startsWith(OPFSFileSystem.SYMLINK_MAGIC)) {
        throw new FSError('EINVAL', -22, `EINVAL: invalid argument, readlink '${filePath}'`, 'readlink', filePath);
      }
      return content.slice(OPFSFileSystem.SYMLINK_MAGIC.length);
    },

    link: async (existingPath: string, newPath: string) => {
      // Emulate hard link by copying the file
      await this.promises.copyFile(existingPath, newPath);
    },

    open: async (filePath: string, flags: string | number = 'r', _mode?: number): Promise<FileHandle> => {
      const fd = this.openSync(filePath, flags);
      return this.createFileHandle(fd, filePath);
    },

    opendir: async (dirPath: string): Promise<Dir> => {
      return this.createDir(dirPath);
    },

    mkdtemp: async (prefix: string): Promise<string> => {
      const suffix = Math.random().toString(36).substring(2, 8);
      const tmpDir = `${prefix}${suffix}`;
      await this.promises.mkdir(tmpDir, { recursive: true });
      return tmpDir;
    },

    watch: (filePath: string, options?: WatchOptions): AsyncIterable<WatchEventType> => {
      return this.createAsyncWatcher(filePath, options);
    },

    /**
     * Flush all pending writes to storage.
     * Use after writes with { flush: false } to ensure data is persisted.
     */
    flush: async () => {
      await this.fastCall('flush', '/');
    },

    /**
     * Purge all kernel caches.
     * Use between major operations to ensure clean state.
     */
    purge: async () => {
      await this.fastCall('purge', '/');
      this.statCache.clear();
    },
  };

  /**
   * Async flush - use after promises.writeFile with { flush: false }
   */
  async flush(): Promise<void> {
    await this.fastCall('flush', '/');
  }

  /**
   * Async purge - clears all kernel caches
   */
  async purge(): Promise<void> {
    await this.fastCall('purge', '/');
    this.statCache.clear();
  }

  // Constants
  constants = constants;

  // --- FileHandle Implementation ---

  private createFileHandle(fd: number, filePath: string): FileHandle {
    const self = this;
    const absPath = path.normalize(path.resolve(filePath));

    return {
      fd,

      async read(buffer: Uint8Array, offset = 0, length?: number, position: number | null = null): Promise<{ bytesRead: number; buffer: Uint8Array }> {
        const len = length ?? buffer.length - offset;
        const entry = self.fdTable.get(fd);
        if (!entry) throw new FSError('EBADF', -9, `bad file descriptor: ${fd}`);

        const readPos = position !== null ? position : entry.position;
        const result = await self.fastCall('read', absPath, { offset: readPos, len });

        if (!result.data) {
          return { bytesRead: 0, buffer };
        }

        const bytesRead = Math.min(result.data.length, len);
        buffer.set(result.data.subarray(0, bytesRead), offset);

        if (position === null) {
          entry.position += bytesRead;
        }

        return { bytesRead, buffer };
      },

      async write(buffer: Uint8Array, offset = 0, length?: number, position: number | null = null): Promise<{ bytesWritten: number; buffer: Uint8Array }> {
        const len = length ?? buffer.length - offset;
        const entry = self.fdTable.get(fd);
        if (!entry) throw new FSError('EBADF', -9, `bad file descriptor: ${fd}`);

        const writePos = position !== null ? position : entry.position;
        const data = buffer.subarray(offset, offset + len);

        await self.fastCall('write', absPath, { data, offset: writePos, truncate: false });
        self.invalidateStat(absPath);

        if (position === null) {
          entry.position += len;
        }

        return { bytesWritten: len, buffer };
      },

      async readFile(options?: ReadOptions | Encoding | null): Promise<Uint8Array | string> {
        return self.promises.readFile(absPath, options);
      },

      async writeFile(data: Uint8Array | string, options?: WriteOptions | Encoding): Promise<void> {
        return self.promises.writeFile(absPath, data, options);
      },

      async truncate(len = 0): Promise<void> {
        await self.fastCall('truncate', absPath, { len });
        self.invalidateStat(absPath);
      },

      async stat(): Promise<Stats> {
        return self.promises.stat(absPath);
      },

      async sync(): Promise<void> {
        await self.fastCall('flush', '/');
      },

      async datasync(): Promise<void> {
        await self.fastCall('flush', '/');
      },

      async close(): Promise<void> {
        self.fdTable.delete(fd);
      },
    };
  }

  // --- Dir Implementation ---

  private createDir(dirPath: string): Dir {
    const self = this;
    const absPath = path.normalize(path.resolve(dirPath));
    let entries: string[] | null = null;
    let index = 0;
    let closed = false;

    const loadEntries = async () => {
      if (entries === null) {
        const result = await self.fastCall('readdir', absPath);
        entries = result.entries || [];
      }
    };

    const dir: Dir = {
      path: absPath,

      async read(): Promise<Dirent | null> {
        if (closed) throw new FSError('EBADF', -9, 'Directory handle was closed');
        await loadEntries();
        if (index >= entries!.length) return null;

        const name = entries![index++];
        try {
          const stat = await self.fastCall('stat', path.join(absPath, name));
          const isDir = stat.type === 'directory' || stat.isDirectory === true;
          return createDirent(name, isDir);
        } catch {
          return createDirent(name, false);
        }
      },

      async close(): Promise<void> {
        closed = true;
        entries = null;
      },

      [Symbol.asyncIterator](): AsyncIterableIterator<Dirent> {
        const iterator: AsyncIterableIterator<Dirent> = {
          next: async (): Promise<IteratorResult<Dirent>> => {
            const dirent = await dir.read();
            if (dirent === null) {
              return { done: true, value: undefined };
            }
            return { done: false, value: dirent };
          },
          [Symbol.asyncIterator]() {
            return this;
          },
        };
        return iterator;
      },
    };

    return dir;
  }

  // --- Watch Implementation (Native FileSystemObserver with polling fallback) ---

  private watchedFiles = new Map<string, { interval?: ReturnType<typeof setInterval>; observer?: FileSystemObserverInterface; listeners: Set<WatchFileListener>; lastStat: Stats | null }>();

  // Check if native FileSystemObserver is available
  private static readonly hasNativeObserver = typeof globalThis.FileSystemObserver !== 'undefined';

  // Get OPFS directory handle for a path
  private async getDirectoryHandle(dirPath: string, create = false): Promise<FileSystemDirectoryHandle> {
    const parts = dirPath.split('/').filter(Boolean);
    let current = await navigator.storage.getDirectory();
    for (const part of parts) {
      current = await current.getDirectoryHandle(part, { create });
    }
    return current;
  }

  // Get OPFS file handle for a path
  private async getFileHandle(filePath: string, create = false): Promise<FileSystemFileHandle> {
    const parts = filePath.split('/').filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) throw new Error('Invalid file path');

    let current = await navigator.storage.getDirectory();
    for (const part of parts) {
      current = await current.getDirectoryHandle(part, { create });
    }
    return current.getFileHandle(fileName, { create });
  }

  // Convert FileSystemObserver change type to Node.js event type
  private mapChangeType(type: FileSystemChangeRecord['type']): 'rename' | 'change' {
    switch (type) {
      case 'appeared':
      case 'disappeared':
      case 'moved':
        return 'rename';
      case 'modified':
        return 'change';
      default:
        return 'change';
    }
  }

  private createAsyncWatcher(filePath: string, options?: WatchOptions): AsyncIterable<WatchEventType> {
    const absPath = path.normalize(path.resolve(filePath));

    // Use native FileSystemObserver if available
    if (OPFSFileSystem.hasNativeObserver) {
      return this.createNativeAsyncWatcher(absPath, options);
    }

    // Fallback to polling
    return this.createPollingAsyncWatcher(absPath, options);
  }

  private createNativeAsyncWatcher(absPath: string, options?: WatchOptions): AsyncIterable<WatchEventType> {
    const self = this;

    return {
      [Symbol.asyncIterator](): AsyncIterableIterator<WatchEventType> {
        const eventQueue: WatchEventType[] = [];
        let resolveNext: ((value: IteratorResult<WatchEventType>) => void) | null = null;
        let observer: FileSystemObserverInterface | null = null;
        let aborted = false;
        let initialized = false;

        // Handle abort signal
        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            aborted = true;
            observer?.disconnect();
            if (resolveNext) {
              resolveNext({ done: true, value: undefined });
              resolveNext = null;
            }
          });
        }

        const callback: FileSystemObserverCallback = (records) => {
          for (const record of records) {
            if (record.type === 'errored' || record.type === 'unknown') continue;

            const filename = record.relativePathComponents.length > 0
              ? record.relativePathComponents[record.relativePathComponents.length - 1]
              : path.basename(absPath);

            const event: WatchEventType = {
              eventType: self.mapChangeType(record.type),
              filename,
            };

            if (resolveNext) {
              resolveNext({ done: false, value: event });
              resolveNext = null;
            } else {
              eventQueue.push(event);
            }
          }
        };

        const init = async () => {
          if (initialized) return;
          initialized = true;

          try {
            observer = new globalThis.FileSystemObserver!(callback);
            const stat = await self.promises.stat(absPath);
            const handle = stat.isDirectory()
              ? await self.getDirectoryHandle(absPath)
              : await self.getFileHandle(absPath);
            await observer.observe(handle, { recursive: options?.recursive });
          } catch (e) {
            // If native observer fails, we should return done
            aborted = true;
          }
        };

        const iterator: AsyncIterableIterator<WatchEventType> = {
          async next(): Promise<IteratorResult<WatchEventType>> {
            if (aborted) {
              return { done: true, value: undefined };
            }

            await init();

            if (aborted) {
              return { done: true, value: undefined };
            }

            // Return queued event if available
            if (eventQueue.length > 0) {
              return { done: false, value: eventQueue.shift()! };
            }

            // Wait for next event
            return new Promise(resolve => {
              resolveNext = resolve;
            });
          },
          [Symbol.asyncIterator]() {
            return this;
          },
        };
        return iterator;
      },
    };
  }

  private createPollingAsyncWatcher(absPath: string, options?: WatchOptions): AsyncIterable<WatchEventType> {
    const self = this;
    const interval = 1000;

    return {
      [Symbol.asyncIterator](): AsyncIterableIterator<WatchEventType> {
        let lastMtimeMs: number | null = null;
        let lastEntries: Set<string> | null = null;
        let aborted = false;
        let pollTimeout: ReturnType<typeof setTimeout> | null = null;

        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            aborted = true;
            if (pollTimeout) clearTimeout(pollTimeout);
          });
        }

        const checkForChanges = async (): Promise<WatchEventType | null> => {
          if (aborted) return null;

          try {
            const stat = await self.promises.stat(absPath);

            if (stat.isDirectory()) {
              const entries = await self.promises.readdir(absPath) as string[];
              const currentEntries = new Set(entries);

              if (lastEntries === null) {
                lastEntries = currentEntries;
                return null;
              }

              for (const entry of currentEntries) {
                if (!lastEntries.has(entry)) {
                  lastEntries = currentEntries;
                  return { eventType: 'rename', filename: entry };
                }
              }

              for (const entry of lastEntries) {
                if (!currentEntries.has(entry)) {
                  lastEntries = currentEntries;
                  return { eventType: 'rename', filename: entry };
                }
              }

              lastEntries = currentEntries;
            } else {
              if (lastMtimeMs === null) {
                lastMtimeMs = stat.mtimeMs;
                return null;
              }

              if (stat.mtimeMs !== lastMtimeMs) {
                lastMtimeMs = stat.mtimeMs;
                return { eventType: 'change', filename: path.basename(absPath) };
              }
            }
          } catch {
            if (lastMtimeMs !== null || lastEntries !== null) {
              lastMtimeMs = null;
              lastEntries = null;
              return { eventType: 'rename', filename: path.basename(absPath) };
            }
          }

          return null;
        };

        const iterator: AsyncIterableIterator<WatchEventType> = {
          async next(): Promise<IteratorResult<WatchEventType>> {
            if (aborted) {
              return { done: true, value: undefined };
            }

            while (!aborted) {
              const event = await checkForChanges();
              if (event) {
                return { done: false, value: event };
              }

              await new Promise<void>(resolve => {
                pollTimeout = setTimeout(resolve, interval);
              });
            }

            return { done: true, value: undefined };
          },
          [Symbol.asyncIterator]() {
            return this;
          },
        };
        return iterator;
      },
    };
  }

  /**
   * Watch a file or directory for changes.
   * Uses native FileSystemObserver when available, falls back to polling.
   */
  watch(filePath: string, options: WatchOptions | WatchListener = {}, listener?: WatchListener): FSWatcher {
    const absPath = path.normalize(path.resolve(filePath));
    const opts = typeof options === 'function' ? {} : options;
    const cb = typeof options === 'function' ? options : listener;

    // Use native FileSystemObserver if available
    if (OPFSFileSystem.hasNativeObserver) {
      return this.createNativeWatcher(absPath, opts, cb);
    }

    // Fallback to polling
    return this.createPollingWatcher(absPath, cb);
  }

  private createNativeWatcher(absPath: string, opts: WatchOptions, cb?: WatchListener): FSWatcher {
    const self = this;
    let observer: FileSystemObserverInterface | null = null;
    let closed = false;

    const callback: FileSystemObserverCallback = (records) => {
      if (closed) return;

      for (const record of records) {
        if (record.type === 'errored' || record.type === 'unknown') continue;

        const filename = record.relativePathComponents.length > 0
          ? record.relativePathComponents[record.relativePathComponents.length - 1]
          : path.basename(absPath);

        cb?.(self.mapChangeType(record.type), filename);
      }
    };

    // Initialize observer asynchronously
    (async () => {
      if (closed) return;
      try {
        observer = new globalThis.FileSystemObserver!(callback);
        const stat = await self.promises.stat(absPath);
        const handle = stat.isDirectory()
          ? await self.getDirectoryHandle(absPath)
          : await self.getFileHandle(absPath);
        await observer.observe(handle, { recursive: opts.recursive });
      } catch {
        // Silently fail - watcher will just not work
      }
    })();

    const watcher: FSWatcher = {
      close: () => {
        closed = true;
        observer?.disconnect();
      },
      ref: () => watcher,
      unref: () => watcher,
    };

    return watcher;
  }

  private createPollingWatcher(absPath: string, cb?: WatchListener): FSWatcher {
    const interval = 1000;
    let lastMtimeMs: number | null = null;
    let lastEntries: Set<string> | null = null;
    let closed = false;

    const poll = async () => {
      if (closed) return;

      try {
        const stat = await this.promises.stat(absPath);

        if (stat.isDirectory()) {
          const entries = await this.promises.readdir(absPath) as string[];
          const currentEntries = new Set(entries);

          if (lastEntries !== null) {
            for (const entry of currentEntries) {
              if (!lastEntries.has(entry)) {
                cb?.('rename', entry);
              }
            }
            for (const entry of lastEntries) {
              if (!currentEntries.has(entry)) {
                cb?.('rename', entry);
              }
            }
          }
          lastEntries = currentEntries;
        } else {
          if (lastMtimeMs !== null && stat.mtimeMs !== lastMtimeMs) {
            cb?.('change', path.basename(absPath));
          }
          lastMtimeMs = stat.mtimeMs;
        }
      } catch {
        if (lastMtimeMs !== null || lastEntries !== null) {
          cb?.('rename', path.basename(absPath));
          lastMtimeMs = null;
          lastEntries = null;
        }
      }
    };

    const intervalId = setInterval(poll, interval);
    poll();

    const watcher: FSWatcher = {
      close: () => {
        closed = true;
        clearInterval(intervalId);
      },
      ref: () => watcher,
      unref: () => watcher,
    };

    return watcher;
  }

  /**
   * Watch a file for changes using native FileSystemObserver or stat polling.
   */
  watchFile(filePath: string, options: WatchFileOptions | WatchFileListener = {}, listener?: WatchFileListener): StatWatcher {
    const absPath = path.normalize(path.resolve(filePath));
    const opts = typeof options === 'function' ? {} : options;
    const cb = typeof options === 'function' ? options : listener;
    const interval = opts.interval ?? 5007;

    let lastStat: Stats | null = null;
    let closed = false;
    let observer: FileSystemObserverInterface | undefined;

    // Polling function used as fallback or primary
    const poll = async () => {
      if (closed) return;

      try {
        const stat = await this.promises.stat(absPath);
        if (lastStat !== null) {
          if (stat.mtimeMs !== lastStat.mtimeMs || stat.size !== lastStat.size) {
            cb?.(stat, lastStat);
          }
        }
        lastStat = stat;
      } catch {
        const emptyStat = createStats({ type: 'file', size: 0, mtimeMs: 0, mode: 0 });
        if (lastStat !== null) {
          cb?.(emptyStat, lastStat);
        }
        lastStat = emptyStat;
      }
    };

    // Try native observer first, fall back to polling
    if (OPFSFileSystem.hasNativeObserver && cb) {
      const self = this;

      const observerCallback: FileSystemObserverCallback = async () => {
        if (closed) return;
        try {
          const stat = await self.promises.stat(absPath);
          if (lastStat !== null && (stat.mtimeMs !== lastStat.mtimeMs || stat.size !== lastStat.size)) {
            cb(stat, lastStat);
          }
          lastStat = stat;
        } catch {
          const emptyStat = createStats({ type: 'file', size: 0, mtimeMs: 0, mode: 0 });
          if (lastStat !== null) {
            cb(emptyStat, lastStat);
          }
          lastStat = emptyStat;
        }
      };

      (async () => {
        if (closed) return;
        try {
          // Get initial stat
          lastStat = await self.promises.stat(absPath);

          observer = new globalThis.FileSystemObserver!(observerCallback);
          const handle = await self.getFileHandle(absPath);
          await observer.observe(handle);
        } catch {
          // Native observer failed, fall back to polling
          if (!closed && !this.watchedFiles.get(absPath)?.interval) {
            const entry = this.watchedFiles.get(absPath);
            if (entry) {
              entry.interval = setInterval(poll, interval);
            }
          }
        }
      })();

      if (!this.watchedFiles.has(absPath)) {
        this.watchedFiles.set(absPath, {
          observer,
          listeners: new Set(),
          lastStat: null,
        });
      }
      this.watchedFiles.get(absPath)!.listeners.add(cb);
    } else {
      // Polling fallback (no native observer available)
      if (!this.watchedFiles.has(absPath)) {
        this.watchedFiles.set(absPath, {
          interval: setInterval(poll, interval),
          listeners: new Set(),
          lastStat: null,
        });
      }
      if (cb) this.watchedFiles.get(absPath)!.listeners.add(cb);

      poll();
    }

    const watcher: StatWatcher = {
      ref: () => watcher,
      unref: () => watcher,
    };

    return watcher;
  }

  /**
   * Stop watching a file.
   */
  unwatchFile(filePath: string, listener?: WatchFileListener): void {
    const absPath = path.normalize(path.resolve(filePath));
    const entry = this.watchedFiles.get(absPath);

    if (entry) {
      if (listener) {
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0) {
          if (entry.interval) clearInterval(entry.interval);
          if (entry.observer) entry.observer.disconnect();
          this.watchedFiles.delete(absPath);
        }
      } else {
        if (entry.interval) clearInterval(entry.interval);
        if (entry.observer) entry.observer.disconnect();
        this.watchedFiles.delete(absPath);
      }
    }
  }

  // --- Stream Implementation ---

  /**
   * Create a readable stream for a file.
   */
  createReadStream(filePath: string, options?: ReadStreamOptions | string): ReadableStream<Uint8Array> {
    const opts = typeof options === 'string' ? { encoding: options as Encoding } : options ?? {};
    const absPath = path.normalize(path.resolve(filePath));
    const start = opts.start ?? 0;
    const end = opts.end;
    const highWaterMark = opts.highWaterMark ?? 64 * 1024;

    let position = start;
    let closed = false;
    const self = this;

    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (closed) {
          controller.close();
          return;
        }

        try {
          const maxRead = end !== undefined ? Math.min(highWaterMark, end - position + 1) : highWaterMark;
          if (maxRead <= 0) {
            controller.close();
            closed = true;
            return;
          }

          const result = await self.fastCall('read', absPath, { offset: position, len: maxRead });

          if (!result.data || result.data.length === 0) {
            controller.close();
            closed = true;
            return;
          }

          controller.enqueue(result.data);
          position += result.data.length;

          if (end !== undefined && position > end) {
            controller.close();
            closed = true;
          }
        } catch (e) {
          controller.error(e);
          closed = true;
        }
      },

      cancel() {
        closed = true;
      },
    });
  }

  /**
   * Create a writable stream for a file.
   */
  createWriteStream(filePath: string, options?: WriteStreamOptions | string): WritableStream<Uint8Array> {
    const opts = typeof options === 'string' ? { encoding: options as Encoding } : options ?? {};
    const absPath = path.normalize(path.resolve(filePath));
    const start = opts.start ?? 0;
    const shouldFlush = opts.flush !== false;

    let position = start;
    let initialized = false;
    const self = this;

    return new WritableStream<Uint8Array>({
      async write(chunk) {
        // Truncate on first write if starting from beginning
        if (!initialized && start === 0) {
          await self.fastCall('write', absPath, { data: chunk, offset: 0, flush: false });
          position = chunk.length;
          initialized = true;
        } else {
          await self.fastCall('write', absPath, { data: chunk, offset: position, truncate: false, flush: false });
          position += chunk.length;
          initialized = true;
        }
        self.invalidateStat(absPath);
      },

      async close() {
        if (shouldFlush) {
          await self.fastCall('flush', '/');
        }
      },

      async abort() {
        // Nothing to clean up
      },
    });
  }

  // --- Sync methods for opendir and mkdtemp ---

  /**
   * Open a directory for iteration (sync).
   */
  opendirSync(dirPath: string): Dir {
    return this.createDir(dirPath);
  }

  /**
   * Create a unique temporary directory (sync).
   */
  mkdtempSync(prefix: string): string {
    const suffix = Math.random().toString(36).substring(2, 8);
    const tmpDir = `${prefix}${suffix}`;
    this.mkdirSync(tmpDir, { recursive: true });
    return tmpDir;
  }
}
