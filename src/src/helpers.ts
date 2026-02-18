/**
 * VFS Helper Functions
 *
 * Standalone utilities for VFS maintenance:
 * - unpackToOPFS: Export VFS contents to real OPFS files
 * - loadFromOPFS: Rebuild VFS from real OPFS files
 * - repairVFS: Attempt to recover files from a corrupt VFS binary
 *
 * Each function accepts an optional `fs` parameter (a running VFSFileSystem
 * instance). When provided, operations go through the VFS worker which holds
 * the exclusive sync handle on .vfs.bin. This allows these functions to work
 * from the main thread while the VFS is running.
 *
 * When `fs` is NOT provided, spawns a repair worker that uses
 * createSyncAccessHandle for direct disk I/O (no RAM bloat).
 */

import { VFSEngine } from './vfs/engine.js';
import { INODE_TYPE } from './vfs/layout.js';

/**
 * Minimal FS interface accepted by the helper functions.
 * Compatible with VFSFileSystem — avoids circular import.
 */
interface FsLike {
  readFileSync(path: string, options?: any): any;
  writeFileSync(path: string, data: any, options?: any): void;
  mkdirSync(path: string, options?: any): any;
  readdirSync(path: string, options?: any): any;
  rmSync(path: string, options?: any): void;
  statSync(path: string): any;
  symlinkSync?(target: string, path: string): void;
}

// ========== In-Memory Handle (main thread fallback) ==========

/**
 * In-memory implementation of FileSystemSyncAccessHandle.
 * Used on the main thread where createSyncAccessHandle is unavailable.
 * After operations complete, call saveToOPFS() to persist.
 */
class MemoryHandle {
  private buf: Uint8Array;
  private len: number;

  constructor(initialData?: ArrayBuffer) {
    if (initialData && initialData.byteLength > 0) {
      this.buf = new Uint8Array(initialData);
      this.len = initialData.byteLength;
    } else {
      this.buf = new Uint8Array(1024 * 1024); // 1MB initial
      this.len = 0;
    }
  }

  getSize(): number {
    return this.len;
  }

  read(target: ArrayBufferView, opts?: { at?: number }): number {
    const offset = opts?.at ?? 0;
    const dst = new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
    const bytesToRead = Math.min(dst.length, this.len - offset);
    if (bytesToRead <= 0) return 0;
    dst.set(this.buf.subarray(offset, offset + bytesToRead));
    return bytesToRead;
  }

  write(data: ArrayBufferView, opts?: { at?: number }): number {
    const offset = opts?.at ?? 0;
    const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const needed = offset + src.length;
    if (needed > this.buf.length) {
      this.grow(needed);
    }
    this.buf.set(src, offset);
    if (needed > this.len) this.len = needed;
    return src.length;
  }

  truncate(size: number): void {
    if (size > this.buf.length) {
      this.grow(size);
    }
    if (size > this.len) {
      this.buf.fill(0, this.len, size);
    }
    this.len = size;
  }

  flush(): void {}
  close(): void {}

  getBuffer(): ArrayBuffer {
    return this.buf.buffer.slice(0, this.len) as ArrayBuffer;
  }

  private grow(minSize: number): void {
    const newSize = Math.max(minSize, this.buf.length * 2);
    const newBuf = new Uint8Array(newSize);
    newBuf.set(this.buf.subarray(0, this.len));
    this.buf = newBuf;
  }
}

async function openVFSHandle(
  fileHandle: FileSystemFileHandle
): Promise<{ handle: any; isMemory: boolean }> {
  try {
    const handle = await (fileHandle as any).createSyncAccessHandle();
    return { handle, isMemory: false };
  } catch {
    const file = await fileHandle.getFile();
    const data = await file.arrayBuffer();
    return { handle: new MemoryHandle(data), isMemory: true };
  }
}

// ========== OPFS Navigation Helpers ==========

async function navigateToRoot(root: string): Promise<FileSystemDirectoryHandle> {
  let dir = await navigator.storage.getDirectory();
  if (root && root !== '/') {
    for (const seg of root.split('/').filter(Boolean)) {
      dir = await dir.getDirectoryHandle(seg, { create: true });
    }
  }
  return dir;
}

async function ensureParentDirs(rootDir: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle> {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  let dir = rootDir;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

async function writeOPFSFile(rootDir: FileSystemDirectoryHandle, path: string, data: Uint8Array): Promise<void> {
  const parentDir = await ensureParentDirs(rootDir, path);
  const name = basename(path);
  const fileHandle = await parentDir.getFileHandle(name, { create: true });
  try {
    const syncHandle = await (fileHandle as any).createSyncAccessHandle();
    try {
      syncHandle.truncate(0);
      if (data.byteLength > 0) {
        syncHandle.write(data, { at: 0 });
      }
      syncHandle.flush();
    } finally {
      syncHandle.close();
    }
  } catch {
    const writable = await (fileHandle as any).createWritable();
    await writable.write(data);
    await writable.close();
  }
}

async function clearDirectory(dir: FileSystemDirectoryHandle, skip: Set<string>): Promise<void> {
  const entries: string[] = [];
  for await (const name of (dir as any).keys()) {
    if (!skip.has(name)) entries.push(name);
  }
  for (const name of entries) {
    await dir.removeEntry(name, { recursive: true });
  }
}

interface RecursiveEntry {
  path: string;
  type: 'file' | 'directory';
  data?: ArrayBuffer;
}

async function readOPFSRecursive(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  skip: Set<string>,
): Promise<RecursiveEntry[]> {
  const result: RecursiveEntry[] = [];
  for await (const [name, handle] of (dir as any).entries()) {
    if (prefix === '' && skip.has(name)) continue;
    const fullPath = prefix ? `${prefix}/${name}` : `/${name}`;
    if (handle.kind === 'directory') {
      result.push({ path: fullPath, type: 'directory' });
      const children = await readOPFSRecursive(handle as FileSystemDirectoryHandle, fullPath, skip);
      result.push(...children);
    } else {
      const file = await (handle as FileSystemFileHandle).getFile();
      const data = await file.arrayBuffer();
      result.push({ path: fullPath, type: 'file', data });
    }
  }
  return result;
}

/**
 * Recursively read all VFS entries via the fs API.
 */
function readVFSRecursive(fs: FsLike, vfsPath: string): Array<{ path: string; type: 'file' | 'directory'; data?: Uint8Array }> {
  const result: Array<{ path: string; type: 'file' | 'directory'; data?: Uint8Array }> = [];
  let entries: any[];
  try {
    entries = fs.readdirSync(vfsPath, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    const fullPath = vfsPath === '/' ? `/${entry.name}` : `${vfsPath}/${entry.name}`;
    if (entry.isDirectory()) {
      result.push({ path: fullPath, type: 'directory' });
      result.push(...readVFSRecursive(fs, fullPath));
    } else {
      try {
        const data = fs.readFileSync(fullPath) as Uint8Array;
        result.push({ path: fullPath, type: 'file', data });
      } catch {
        // Skip unreadable files
      }
    }
  }
  return result;
}

// ========== Public Helper Functions ==========

export interface UnpackResult {
  files: number;
  directories: number;
}

/**
 * Unpack VFS contents to real OPFS files.
 *
 * When `fs` is provided: reads VFS via the running instance (communicates
 * with VFS worker), writes to OPFS additively (no deletions).
 *
 * When `fs` is NOT provided: opens .vfs.bin directly via VFSEngine,
 * clears OPFS (except .vfs.bin), then writes all entries.
 * Requires VFS to be stopped or a Worker context.
 */
export async function unpackToOPFS(root: string = '/', fs?: FsLike): Promise<UnpackResult> {
  const rootDir = await navigateToRoot(root);

  if (fs) {
    // Read all entries from VFS via the running instance
    const vfsEntries = readVFSRecursive(fs, '/');

    let files = 0;
    let directories = 0;

    for (const entry of vfsEntries) {
      if (entry.type === 'directory') {
        const name = basename(entry.path);
        const parent = await ensureParentDirs(rootDir, entry.path);
        await parent.getDirectoryHandle(name, { create: true });
        directories++;
      } else {
        try {
          await writeOPFSFile(rootDir, entry.path, entry.data ?? new Uint8Array(0));
          files++;
        } catch (err: any) {
          console.warn(`[VFS] Failed to write OPFS file ${entry.path}: ${err.message}`);
        }
      }
    }

    return { files, directories };
  }

  // Direct VFSEngine path (VFS not running)
  const vfsFileHandle = await rootDir.getFileHandle('.vfs.bin');
  const { handle } = await openVFSHandle(vfsFileHandle);

  let entries: Array<{ path: string; type: number; data: Uint8Array | null; mode: number; mtime: number }>;
  try {
    const engine = new VFSEngine();
    engine.init(handle);
    entries = engine.exportAll();
  } finally {
    handle.close();
  }

  await clearDirectory(rootDir, new Set(['.vfs.bin']));

  let files = 0;
  let directories = 0;
  for (const entry of entries) {
    if (entry.path === '/') continue;
    if (entry.type === INODE_TYPE.DIRECTORY) {
      const name = basename(entry.path);
      const parent = await ensureParentDirs(rootDir, entry.path);
      await parent.getDirectoryHandle(name, { create: true });
      directories++;
    } else if (entry.type === INODE_TYPE.FILE || entry.type === INODE_TYPE.SYMLINK) {
      await writeOPFSFile(rootDir, entry.path, entry.data ?? new Uint8Array(0));
      files++;
    }
  }

  return { files, directories };
}

export interface LoadResult {
  files: number;
  directories: number;
}

/**
 * Load all real OPFS files into VFS.
 *
 * When `fs` is provided: reads OPFS files, clears VFS, writes to VFS via
 * the running instance. Never touches .vfs.bin directly.
 *
 * When `fs` is NOT provided: reads OPFS files, deletes .vfs.bin, creates
 * fresh VFS via VFSEngine. Requires VFS to be stopped or a Worker context.
 */
export async function loadFromOPFS(root: string = '/', fs?: FsLike): Promise<LoadResult> {
  const rootDir = await navigateToRoot(root);
  const opfsEntries = await readOPFSRecursive(rootDir, '', new Set(['.vfs.bin']));

  if (fs) {
    // Clear VFS root entries
    try {
      const rootEntries = fs.readdirSync('/') as string[];
      for (const entry of rootEntries) {
        try {
          fs.rmSync(`/${entry}`, { recursive: true, force: true });
        } catch { /* skip entries that can't be removed */ }
      }
    } catch { /* root might be empty */ }

    // Write directories first (sorted by depth)
    const dirs = opfsEntries
      .filter(e => e.type === 'directory')
      .sort((a, b) => a.path.localeCompare(b.path));

    let files = 0;
    let directories = 0;

    for (const dir of dirs) {
      try {
        fs.mkdirSync(dir.path, { recursive: true, mode: 0o755 });
        directories++;
      } catch { /* may already exist */ }
    }

    // Write files
    const fileEntries = opfsEntries.filter(e => e.type === 'file');
    for (const file of fileEntries) {
      try {
        const parentPath = file.path.substring(0, file.path.lastIndexOf('/')) || '/';
        if (parentPath !== '/') {
          try { fs.mkdirSync(parentPath, { recursive: true, mode: 0o755 }); } catch {}
        }
        fs.writeFileSync(file.path, new Uint8Array(file.data!));
        files++;
      } catch (err: any) {
        console.warn(`[VFS] Failed to write ${file.path}: ${err.message}`);
      }
    }

    return { files, directories };
  }

  // Delegate to repair worker (uses createSyncAccessHandle for disk I/O)
  return spawnRepairWorker<LoadResult>({ type: 'load', root });
}

export interface RepairResult {
  recovered: number;
  lost: number;
  entries: Array<{
    path: string;
    type: 'file' | 'directory' | 'symlink';
    size: number;
    /** true when the inode was found but data blocks were out of bounds (content lost) */
    contentLost?: boolean;
  }>;
}

/**
 * Attempt to repair a VFS.
 *
 * When `fs` is provided: rebuilds VFS from OPFS files (non-destructive read
 * of OPFS), then syncs repaired VFS back to OPFS (additive, no deletions).
 * This is the safe path — OPFS is the source of truth.
 *
 * When `fs` is NOT provided: scans raw .vfs.bin for recoverable inodes,
 * creates fresh VFS with recovered data. For corrupt VFS where init failed.
 */
export async function repairVFS(root: string = '/', fs?: FsLike): Promise<RepairResult> {
  if (fs) {
    // Step 1: Rebuild VFS from OPFS (reads OPFS, writes to VFS — OPFS untouched)
    const loadResult = await loadFromOPFS(root, fs);

    // Step 2: Only now that VFS is healthy, sync back to OPFS (additive)
    await unpackToOPFS(root, fs);

    const total = loadResult.files + loadResult.directories;
    return {
      recovered: total,
      lost: 0,
      entries: [], // Detailed entries not available in fs-based path
    };
  }

  // Raw .vfs.bin repair via worker (uses createSyncAccessHandle for disk I/O)
  return spawnRepairWorker<RepairResult>({ type: 'repair', root });
}

// ========== Repair Worker Delegation ==========

/**
 * Spawn the repair worker and await its result.
 * The worker uses createSyncAccessHandle for direct disk I/O —
 * no MemoryHandle, works from main thread, follower tabs, and workers.
 */
function spawnRepairWorker<T>(msg: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./workers/repair.worker.js', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (event: MessageEvent) => {
      worker.terminate();
      if (event.data.error) {
        reject(new Error(event.data.error));
      } else {
        resolve(event.data as T);
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'Repair worker failed'));
    };
    worker.postMessage(msg);
  });
}
