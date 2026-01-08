/**
 * OPFS Worker Kernel
 * Runs in a dedicated Web Worker thread, handles all OPFS operations.
 * Uses SharedArrayBuffer + Atomics for zero-copy data transfer and synchronization.
 */

/// <reference lib="webworker" />

interface KernelMessage {
  type: string;
  path: string;
  ctrlBuffer: SharedArrayBuffer;  // SharedArrayBuffer for control signal
  metaBuffer: SharedArrayBuffer;
  dataBuffer: SharedArrayBuffer;
  dataLength?: number;
  payload?: {
    offset?: number;
    len?: number;
    newPath?: string;
    recursive?: boolean;
    truncate?: boolean;  // For write: false to keep existing data (stream mode)
  };
}

// Cache for performance
let cachedRoot: FileSystemDirectoryHandle | null = null;
const dirCache = new Map<string, FileSystemDirectoryHandle>();

// Sync access handle cache - MAJOR performance optimization (2-5x speedup)
// Handles are kept open and reused, only closed on file deletion/rename/shutdown
const syncHandleCache = new Map<string, FileSystemSyncAccessHandle>();
const MAX_SYNC_HANDLES = 100; // Limit cache size to prevent memory issues

async function getSyncAccessHandle(
  filePath: string,
  create: boolean
): Promise<FileSystemSyncAccessHandle> {
  const cached = syncHandleCache.get(filePath);
  if (cached) return cached;

  // Evict oldest handles if cache is full to prevent memory issues
  if (syncHandleCache.size >= MAX_SYNC_HANDLES) {
    const keysToDelete = Array.from(syncHandleCache.keys()).slice(0, 10);
    for (const key of keysToDelete) {
      const handle = syncHandleCache.get(key);
      if (handle) {
        try { handle.close(); } catch { /* ignore */ }
        syncHandleCache.delete(key);
      }
    }
  }

  const fh = await getFileHandle(filePath, create);
  const access = await fh.createSyncAccessHandle();
  syncHandleCache.set(filePath, access);
  return access;
}

function closeSyncHandle(filePath: string): void {
  const handle = syncHandleCache.get(filePath);
  if (handle) {
    try {
      handle.close();
    } catch {
      // Ignore close errors (handle may already be closed)
    }
    syncHandleCache.delete(filePath);
  }
}

function closeAllSyncHandlesUnder(pathPrefix: string): void {
  for (const [path, handle] of syncHandleCache) {
    if (path === pathPrefix || path.startsWith(pathPrefix + '/')) {
      try {
        handle.close();
      } catch {
        // Ignore close errors
      }
      syncHandleCache.delete(path);
    }
  }
}

// Flush all cached sync handles to ensure data is persisted
function flushAllSyncHandles(): void {
  for (const handle of syncHandleCache.values()) {
    try {
      handle.flush();
    } catch {
      // Ignore flush errors (handle may be invalid)
    }
  }
}

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  if (!cachedRoot) {
    cachedRoot = await navigator.storage.getDirectory();
  }
  return cachedRoot;
}

function parsePath(filePath: string): string[] {
  return filePath.split('/').filter(Boolean);
}

async function getDirectoryHandle(
  parts: string[],
  create = false
): Promise<FileSystemDirectoryHandle> {
  if (parts.length === 0) return getRoot();

  const cacheKey = parts.join('/');
  const cached = dirCache.get(cacheKey);
  if (cached) return cached;

  let curr = await getRoot();
  let pathSoFar = '';

  for (const part of parts) {
    pathSoFar += (pathSoFar ? '/' : '') + part;

    const cachedDir = dirCache.get(pathSoFar);
    if (cachedDir) {
      curr = cachedDir;
    } else {
      curr = await curr.getDirectoryHandle(part, { create });
      dirCache.set(pathSoFar, curr);
    }
  }

  return curr;
}

async function getFileHandle(
  filePath: string,
  create = false
): Promise<FileSystemFileHandle> {
  const parts = parsePath(filePath);
  const fileName = parts.pop();
  if (!fileName) throw new Error('Invalid file path');
  const dir = parts.length > 0 ? await getDirectoryHandle(parts, create) : await getRoot();
  return await dir.getFileHandle(fileName, { create });
}

async function getParentAndName(
  filePath: string
): Promise<{ parent: FileSystemDirectoryHandle; name: string }> {
  const parts = parsePath(filePath);
  const name = parts.pop();
  if (!name) throw new Error('Invalid path');
  const parent = parts.length > 0 ? await getDirectoryHandle(parts, false) : await getRoot();
  return { parent, name };
}

// Operation handlers - use SharedArrayBuffer for data transfer

async function handleRead(
  filePath: string,
  dataBuffer: SharedArrayBuffer,
  payload?: { offset?: number; len?: number }
): Promise<number> {
  const access = await getSyncAccessHandle(filePath, false);
  const size = access.getSize();
  const offset = payload?.offset || 0;
  const len = payload?.len || (size - offset);

  // Read directly into SharedArrayBuffer
  const view = new Uint8Array(dataBuffer, 0, Math.min(len, dataBuffer.byteLength));
  const bytesRead = access.read(view, { at: offset });
  return bytesRead;
}

async function handleWrite(
  filePath: string,
  dataBuffer: SharedArrayBuffer,
  dataLength: number,
  payload?: { offset?: number; truncate?: boolean; flush?: boolean }
): Promise<number> {
  const access = await getSyncAccessHandle(filePath, true);
  const offset = payload?.offset ?? 0;
  // Truncate by default when offset is 0 (writeFileSync behavior),
  // but allow callers to opt out for stream writes
  const shouldTruncate = payload?.truncate ?? (offset === 0);
  if (shouldTruncate) {
    access.truncate(0);
  }
  // Read from SharedArrayBuffer
  const data = new Uint8Array(dataBuffer, 0, dataLength);
  access.write(data, { at: offset });
  // Flush by default for durability, but allow skipping for performance
  // Data is still written and readable, just not guaranteed to survive crashes
  if (payload?.flush !== false) {
    access.flush();
  }
  return 1; // Success
}

async function handleAppend(
  filePath: string,
  dataBuffer: SharedArrayBuffer,
  dataLength: number
): Promise<number> {
  const access = await getSyncAccessHandle(filePath, true);
  const size = access.getSize();
  const data = new Uint8Array(dataBuffer, 0, dataLength);
  access.write(data, { at: size });
  access.flush();
  return 1;
}

async function handleTruncate(
  filePath: string,
  payload?: { len?: number }
): Promise<number> {
  const access = await getSyncAccessHandle(filePath, false);
  access.truncate(payload?.len ?? 0);
  access.flush();
  return 1;
}

// Binary stat layout (24 bytes) - faster than JSON for hot path:
// Offset 0: type (Uint8) - 0=file, 1=directory
// Offset 4: mode (Uint32)
// Offset 8: size (Float64)
// Offset 16: mtimeMs (Float64)
const STAT_SIZE = 24;

async function handleStat(
  filePath: string,
  metaBuffer: SharedArrayBuffer
): Promise<number> {
  const parts = parsePath(filePath);
  const view = new DataView(metaBuffer);

  // mode: 33188 = 0o100644 (regular file), 16877 = 0o40755 (directory)
  if (parts.length === 0) {
    view.setUint8(0, 1); // directory
    view.setUint32(4, 16877, true);
    view.setFloat64(8, 0, true); // size
    view.setFloat64(16, Date.now(), true); // mtimeMs
    return STAT_SIZE;
  }

  // Fast path: if sync handle is cached, we know it's a file
  const cachedHandle = syncHandleCache.get(filePath);
  if (cachedHandle) {
    const size = cachedHandle.getSize();
    view.setUint8(0, 0); // file
    view.setUint32(4, 33188, true);
    view.setFloat64(8, size, true);
    // Note: can't get mtime from sync handle, use current time as approximation
    view.setFloat64(16, Date.now(), true);
    return STAT_SIZE;
  }

  const name = parts.pop()!;
  const parent = parts.length > 0 ? await getDirectoryHandle(parts, false) : await getRoot();

  try {
    const fh = await parent.getFileHandle(name);
    const file = await fh.getFile();
    view.setUint8(0, 0); // file
    view.setUint32(4, 33188, true);
    view.setFloat64(8, file.size, true);
    view.setFloat64(16, file.lastModified, true);
    return STAT_SIZE;
  } catch {
    try {
      await parent.getDirectoryHandle(name);
      view.setUint8(0, 1); // directory
      view.setUint32(4, 16877, true);
      view.setFloat64(8, 0, true);
      view.setFloat64(16, Date.now(), true);
      return STAT_SIZE;
    } catch {
      return -2; // Not found
    }
  }
}

async function handleExists(filePath: string): Promise<number> {
  // Fast path: if sync handle is cached, file definitely exists
  if (syncHandleCache.has(filePath)) return 1;

  try {
    const parts = parsePath(filePath);
    if (parts.length === 0) return 1;

    const name = parts.pop()!;
    const parent = parts.length > 0 ? await getDirectoryHandle(parts, false) : await getRoot();

    try {
      await parent.getFileHandle(name);
      return 1;
    } catch {
      try {
        await parent.getDirectoryHandle(name);
        return 1;
      } catch {
        return 0;
      }
    }
  } catch {
    return 0;
  }
}

async function handleMkdir(
  filePath: string,
  payload?: { recursive?: boolean }
): Promise<number> {
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

  return 1;
}

async function handleRmdir(
  filePath: string,
  payload?: { recursive?: boolean }
): Promise<number> {
  const { parent, name } = await getParentAndName(filePath);
  // Normalize path - ensure leading slash for consistent cache lookups
  const normalizedPath = '/' + parsePath(filePath).join('/');
  const pathPrefix = parsePath(filePath).join('/');

  if (payload?.recursive) {
    // Close ALL cached sync handles for files under this directory
    // Use normalized path with leading slash to match cached handle keys
    closeAllSyncHandlesUnder(normalizedPath);
    await parent.removeEntry(name, { recursive: true });
    // Clear ALL cached dir handles that start with this path prefix
    for (const key of dirCache.keys()) {
      if (key === pathPrefix || key.startsWith(pathPrefix + '/')) {
        dirCache.delete(key);
      }
    }
  } else {
    const dir = await parent.getDirectoryHandle(name);
    const entries = dir.entries();
    const first = await entries.next();
    if (!first.done) {
      throw new Error('Directory not empty');
    }
    await parent.removeEntry(name);
    // Only invalidate the specific directory
    dirCache.delete(pathPrefix);
  }

  return 1;
}

async function handleUnlink(filePath: string): Promise<number> {
  const { parent, name } = await getParentAndName(filePath);

  // Verify it's a file, not a directory (Node.js unlink semantics)
  try {
    await parent.getFileHandle(name);
  } catch {
    // Check if it's a directory
    try {
      await parent.getDirectoryHandle(name);
      throw new Error('EISDIR: illegal operation on a directory');
    } catch (e) {
      // Re-throw EISDIR, otherwise it's not found
      if ((e as Error).message?.includes('EISDIR')) throw e;
      throw new Error('NotFoundError');
    }
  }

  // Close cached sync handle before removing file
  closeSyncHandle(filePath);
  await parent.removeEntry(name);
  return 1;
}

// Binary readdir layout - faster than JSON for hot path:
// Offset 0: entry count (Uint32)
// For each entry: 2 bytes length (Uint16) + UTF-8 name bytes
const textEncoder = new TextEncoder();

async function handleReaddir(
  filePath: string,
  metaBuffer: SharedArrayBuffer
): Promise<number> {
  const parts = parsePath(filePath);
  const dir = parts.length > 0 ? await getDirectoryHandle(parts, false) : await getRoot();

  // Collect entries
  const entries: string[] = [];
  for await (const [name] of dir.entries()) {
    entries.push(name);
  }

  // Binary encode: [count:u32] [len:u16 + utf8]...
  const view = new DataView(metaBuffer);
  const bytes = new Uint8Array(metaBuffer);
  view.setUint32(0, entries.length, true);

  let offset = 4;
  for (const name of entries) {
    const encoded = textEncoder.encode(name);
    view.setUint16(offset, encoded.length, true);
    offset += 2;
    bytes.set(encoded, offset);
    offset += encoded.length;
  }

  return offset;
}

// === MEMORY-SAFE CHUNK ALLOCATION (Zero overhead in normal operation) ===

const MIN_CHUNK = 64 * 1024;          // 64KB floor
const MAX_CHUNK = 1024 * 1024;        // 1MB ceiling
const DEFAULT_CHUNK = 256 * 1024;     // 256KB default
const LAST_RESORT_CHUNK = 8 * 1024;   // 8KB emergency

// State
let chunkSize = DEFAULT_CHUNK;
let failureCount = 0;

// Only yield on actual failure (use microtask, not setTimeout)
const yieldMicrotask = (): Promise<void> => new Promise(resolve => queueMicrotask(resolve));

// Get current chunk size (fast path - just return cached value)
function getChunkSize(): number {
  return chunkSize;
}

// Called after successful operations - gradually recover chunk size
function maybeIncreaseChunk(): void {
  if (failureCount === 0 && chunkSize < MAX_CHUNK) {
    chunkSize = Math.min(MAX_CHUNK, chunkSize + 64 * 1024);
  }
}

// Called on allocation failure - reduce and remember
function reduceChunkOnFailure(): number {
  failureCount++;
  chunkSize = Math.max(MIN_CHUNK, Math.floor(chunkSize / 2));
  return chunkSize;
}

// Safe allocation - only adds overhead on actual failure
async function safeAllocateChunk(
  srcFile: File,
  offset: number,
  requestedSize: number
): Promise<Uint8Array> {
  const size = Math.min(requestedSize, chunkSize);

  try {
    // Fast path - no overhead
    const chunk = srcFile.slice(offset, offset + size);
    return new Uint8Array(await chunk.arrayBuffer());
  } catch (e) {
    // Slow path - only on failure
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes('allocation') && !msg.includes('Array buffer') && !msg.includes('out of memory')) {
      throw e; // Not a memory error
    }

    // Retry with smaller chunks
    let retrySize = reduceChunkOnFailure();
    while (retrySize >= MIN_CHUNK) {
      await yieldMicrotask(); // Microtask yield (fast, not setTimeout)
      try {
        const chunk = srcFile.slice(offset, offset + retrySize);
        return new Uint8Array(await chunk.arrayBuffer());
      } catch {
        retrySize = reduceChunkOnFailure();
      }
    }

    // Last resort
    await yieldMicrotask();
    try {
      chunkSize = LAST_RESORT_CHUNK;
      const chunk = srcFile.slice(offset, offset + LAST_RESORT_CHUNK);
      return new Uint8Array(await chunk.arrayBuffer());
    } catch {
      throw new Error('ENOMEM: unable to allocate memory');
    }
  }
}

// Lock-protected streaming copy using cached sync handles
async function streamCopyFile(
  srcHandle: FileSystemFileHandle,
  dstPath: string
): Promise<void> {
  const srcFile = await srcHandle.getFile();
  const size = srcFile.size;

  // Lock destination path for multi-tab safety
  await navigator.locks.request(`opfs:${dstPath}`, async () => {
    const access = await getSyncAccessHandle(dstPath, true);
    access.truncate(0);

    // Chunked streaming for memory safety
    let offset = 0;
    while (offset < size) {
      const remaining = size - offset;

      // Safe allocation (only adds overhead on failure)
      const data = await safeAllocateChunk(srcFile, offset, remaining);

      access.write(data, { at: offset });
      offset += data.byteLength;
    }

    // Gradually recover chunk size after successful operation
    maybeIncreaseChunk();
    access.flush();
  });
}

async function handleRename(
  oldPath: string,
  payload?: { newPath?: string }
): Promise<number> {
  if (!payload?.newPath) throw new Error('newPath required');

  const newPath = payload.newPath;
  const oldParts = parsePath(oldPath);
  const newParts = parsePath(newPath);

  const oldName = oldParts.pop()!;
  const newName = newParts.pop()!;

  const oldParent = oldParts.length > 0 ? await getDirectoryHandle(oldParts, false) : await getRoot();
  const newParent = newParts.length > 0 ? await getDirectoryHandle(newParts, true) : await getRoot();

  // Try file first
  try {
    const fh = await oldParent.getFileHandle(oldName);

    // Close cached sync handle before rename
    closeSyncHandle(oldPath);

    // TIER 1: Use native move() if available (fastest, zero-copy, memory safe)
    if ('move' in fh && typeof (fh as any).move === 'function') {
      await (fh as any).move(newParent, newName);
      return 1;
    }

    // TIER 2: Fallback to stream copy (memory safe for large files)
    await streamCopyFile(fh, newPath);
    await oldParent.removeEntry(oldName);
    return 1;
  } catch {
    // Directory rename
    const oldDir = await oldParent.getDirectoryHandle(oldName);
    const pathPrefix = parsePath(oldPath).join('/');

    // Close all cached sync handles for files in this directory
    closeAllSyncHandlesUnder(pathPrefix);

    // Try native move for directories too
    if ('move' in oldDir && typeof (oldDir as any).move === 'function') {
      await (oldDir as any).move(newParent, newName);
      // Invalidate dir cache for moved directory
      for (const key of dirCache.keys()) {
        if (key === pathPrefix || key.startsWith(pathPrefix + '/')) {
          dirCache.delete(key);
        }
      }
      return 1;
    }

    // Fallback: recursive copy with streaming (track paths for lock discipline)
    async function copyDir(src: FileSystemDirectoryHandle, dst: FileSystemDirectoryHandle, dstBasePath: string) {
      for await (const [name, handle] of src.entries()) {
        const dstFilePath = dstBasePath + '/' + name;
        if (handle.kind === 'file') {
          const srcFile = handle as FileSystemFileHandle;
          await streamCopyFile(srcFile, dstFilePath);
        } else {
          const newSubDir = await dst.getDirectoryHandle(name, { create: true });
          await copyDir(handle as FileSystemDirectoryHandle, newSubDir, dstFilePath);
        }
      }
    }

    const newDir = await newParent.getDirectoryHandle(newName, { create: true });
    await copyDir(oldDir, newDir, newPath);
    await oldParent.removeEntry(oldName, { recursive: true });

    // Invalidate dir cache (pathPrefix already defined above)
    for (const key of dirCache.keys()) {
      if (key === pathPrefix || key.startsWith(pathPrefix + '/')) {
        dirCache.delete(key);
      }
    }

    return 1;
  }
}

async function handleCopy(
  srcPath: string,
  payload?: { newPath?: string }
): Promise<number> {
  if (!payload?.newPath) throw new Error('newPath required');

  const dstPath = payload.newPath;
  const srcParts = parsePath(srcPath);
  const srcName = srcParts.pop()!;
  const srcParent = srcParts.length > 0 ? await getDirectoryHandle(srcParts, false) : await getRoot();
  const srcFh = await srcParent.getFileHandle(srcName);

  // Use streaming copy with lock-protected destination (memory safe for large files)
  await streamCopyFile(srcFh, dstPath);

  return 1;
}

// Operations that don't need locking (don't use createSyncAccessHandle)
const LOCKLESS_OPS = new Set(['stat', 'exists', 'readdir', 'mkdir', 'flush']);

// Process incoming messages with SharedArrayBuffer-based communication
async function processMessage(msg: KernelMessage): Promise<void> {
  const { type, path: filePath, ctrlBuffer, metaBuffer, dataBuffer, dataLength, payload } = msg;

  // Create Int32Array view from the SharedArrayBuffer
  const ctrl = new Int32Array(ctrlBuffer);

  // Core operation logic
  const executeOperation = async (): Promise<number> => {
    switch (type) {
      case 'read':
        return handleRead(filePath, dataBuffer, payload);
      case 'write':
        return handleWrite(filePath, dataBuffer, dataLength || 0, payload);
      case 'append':
        return handleAppend(filePath, dataBuffer, dataLength || 0);
      case 'truncate':
        return handleTruncate(filePath, payload);
      case 'stat':
        return handleStat(filePath, metaBuffer);
      case 'exists':
        return handleExists(filePath);
      case 'mkdir':
        return handleMkdir(filePath, payload);
      case 'rmdir':
        return handleRmdir(filePath, payload);
      case 'unlink':
        return handleUnlink(filePath);
      case 'readdir':
        return handleReaddir(filePath, metaBuffer);
      case 'rename':
        return handleRename(filePath, payload);
      case 'copy':
        return handleCopy(filePath, payload);
      case 'flush':
        flushAllSyncHandles();
        return 1;
      default:
        throw new Error(`Unknown operation: ${type}`);
    }
  };

  // Wrapper that handles result signaling
  const runAndSignal = async () => {
    try {
      const result = await executeOperation();
      Atomics.store(ctrl, 0, result);
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      const errorMsg = error.message || 'Unknown error';

      if (errorMsg.includes('NotFoundError') || errorMsg.includes('not found')) {
        Atomics.store(ctrl, 0, -2);
      } else {
        // Write error message to metaBuffer
        const encoded = new TextEncoder().encode(errorMsg);
        const view = new Uint8Array(metaBuffer);
        view.set(encoded);
        Atomics.store(ctrl, 0, -1);
      }
    }
    Atomics.notify(ctrl, 0);
  };

  // Use Web Locks API to prevent NoModificationAllowedError across tabs
  // Skip locking for read-only operations that don't use createSyncAccessHandle
  if (LOCKLESS_OPS.has(type)) {
    await runAndSignal();
  } else {
    await navigator.locks.request(`opfs:${filePath}`, runAndSignal);
  }
}

// Main message handler
self.onmessage = (event: MessageEvent<KernelMessage>) => {
  processMessage(event.data);
};

// Signal ready
self.postMessage({ type: 'ready' });
