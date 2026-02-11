/**
 * VFS Helper Functions
 *
 * Standalone utilities for VFS maintenance:
 * - unpackToOPFS: Export VFS contents to real OPFS files
 * - loadFromOPFS: Rebuild VFS from real OPFS files
 * - repairVFS: Attempt to recover files from a corrupt VFS binary
 *
 * These functions acquire an exclusive sync access handle on .vfs.bin,
 * so any running VFSFileSystem instance must be closed first.
 * Must be called from a Worker context (createSyncAccessHandle requirement).
 */

import { VFSEngine } from './vfs/engine.js';
import {
  VFS_MAGIC, VFS_VERSION, SUPERBLOCK, INODE, INODE_SIZE, INODE_TYPE,
  DEFAULT_INODE_COUNT, DEFAULT_BLOCK_SIZE, INITIAL_DATA_BLOCKS,
  INITIAL_PATH_TABLE_SIZE, calculateLayout,
} from './vfs/layout.js';

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
  parts.pop(); // Remove filename
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
  const syncHandle = await fileHandle.createSyncAccessHandle();
  try {
    syncHandle.truncate(0);
    if (data.byteLength > 0) {
      syncHandle.write(data, { at: 0 });
    }
    syncHandle.flush();
  } finally {
    syncHandle.close();
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

// ========== Public Helper Functions ==========

export interface UnpackResult {
  files: number;
  directories: number;
}

/**
 * Unpack VFS contents to real OPFS files.
 *
 * Reads all files/directories from the VFS binary and writes them as real
 * OPFS files. Clears existing OPFS files (except .vfs.bin) first.
 *
 * Must be called from a Worker. Close any running VFSFileSystem first.
 */
export async function unpackToOPFS(root: string = '/'): Promise<UnpackResult> {
  const rootDir = await navigateToRoot(root);

  // Open VFS binary
  const vfsFileHandle = await rootDir.getFileHandle('.vfs.bin');
  const handle = await vfsFileHandle.createSyncAccessHandle();

  let entries: Array<{ path: string; type: number; data: Uint8Array | null; mode: number; mtime: number }>;
  try {
    const engine = new VFSEngine();
    engine.init(handle);
    entries = engine.exportAll();
  } finally {
    handle.close();
  }

  // Clear OPFS (except .vfs.bin)
  await clearDirectory(rootDir, new Set(['.vfs.bin']));

  // Write all entries
  let files = 0;
  let directories = 0;
  for (const entry of entries) {
    if (entry.path === '/') continue; // Skip root
    if (entry.type === INODE_TYPE.DIRECTORY) {
      await ensureParentDirs(rootDir, entry.path + '/dummy');
      const name = basename(entry.path);
      const parent = await ensureParentDirs(rootDir, entry.path);
      await parent.getDirectoryHandle(name, { create: true });
      directories++;
    } else if (entry.type === INODE_TYPE.FILE) {
      await writeOPFSFile(rootDir, entry.path, entry.data ?? new Uint8Array(0));
      files++;
    } else if (entry.type === INODE_TYPE.SYMLINK) {
      // OPFS has no symlink concept — write target content as regular file
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
 * Load all real OPFS files into a fresh VFS.
 *
 * Reads all OPFS files/directories recursively, deletes the existing .vfs.bin,
 * creates a fresh VFS, and writes all OPFS content into it.
 *
 * Must be called from a Worker. Close any running VFSFileSystem first.
 */
export async function loadFromOPFS(root: string = '/'): Promise<LoadResult> {
  const rootDir = await navigateToRoot(root);

  // Read all OPFS entries (skip .vfs.bin)
  const opfsEntries = await readOPFSRecursive(rootDir, '', new Set(['.vfs.bin']));

  // Delete old VFS binary
  try {
    await rootDir.removeEntry('.vfs.bin');
  } catch (_) {
    // May not exist
  }

  // Create fresh VFS
  const vfsFileHandle = await rootDir.getFileHandle('.vfs.bin', { create: true });
  const handle = await vfsFileHandle.createSyncAccessHandle();

  try {
    const engine = new VFSEngine();
    engine.init(handle); // size=0 → formats fresh VFS

    // Write directories first (sorted by depth)
    const dirs = opfsEntries
      .filter(e => e.type === 'directory')
      .sort((a, b) => a.path.localeCompare(b.path));

    let files = 0;
    let directories = 0;

    for (const dir of dirs) {
      engine.mkdir(dir.path, 0o040755);
      directories++;
    }

    // Write files
    const fileEntries = opfsEntries.filter(e => e.type === 'file');
    for (const file of fileEntries) {
      engine.write(file.path, new Uint8Array(file.data!));
      files++;
    }

    engine.flush();
    return { files, directories };
  } finally {
    handle.close();
  }
}

export interface RepairResult {
  recovered: number;
  lost: number;
  entries: Array<{ path: string; type: 'file' | 'directory' | 'symlink'; size: number }>;
}

/**
 * Attempt to recover files from a corrupt VFS binary.
 *
 * Reads the raw .vfs.bin binary, scans the inode table for valid-looking
 * entries, extracts recoverable files, then creates a fresh VFS with the
 * recovered data.
 *
 * Must be called from a Worker. Close any running VFSFileSystem first.
 */
export async function repairVFS(root: string = '/'): Promise<RepairResult> {
  const rootDir = await navigateToRoot(root);

  // Read corrupt VFS into memory
  const vfsFileHandle = await rootDir.getFileHandle('.vfs.bin');
  const file = await vfsFileHandle.getFile();
  const raw = new Uint8Array(await file.arrayBuffer());
  const fileSize = raw.byteLength;

  if (fileSize < SUPERBLOCK.SIZE) {
    throw new Error(`VFS file too small to repair (${fileSize} bytes)`);
  }

  const view = new DataView(raw.buffer);

  // Try to determine layout from superblock, fall back to defaults
  let inodeCount: number;
  let blockSize: number;
  let totalBlocks: number;
  let inodeTableOffset: number;
  let pathTableOffset: number;
  let bitmapOffset: number;
  let dataOffset: number;
  let pathTableUsed: number;

  const magic = view.getUint32(SUPERBLOCK.MAGIC, true);
  const version = view.getUint32(SUPERBLOCK.VERSION, true);
  const superblockValid = magic === VFS_MAGIC && version === VFS_VERSION;

  if (superblockValid) {
    // Superblock looks valid — use its values with sanity checks
    inodeCount = view.getUint32(SUPERBLOCK.INODE_COUNT, true);
    blockSize = view.getUint32(SUPERBLOCK.BLOCK_SIZE, true);
    totalBlocks = view.getUint32(SUPERBLOCK.TOTAL_BLOCKS, true);
    inodeTableOffset = view.getFloat64(SUPERBLOCK.INODE_OFFSET, true);
    pathTableOffset = view.getFloat64(SUPERBLOCK.PATH_OFFSET, true);
    bitmapOffset = view.getFloat64(SUPERBLOCK.BITMAP_OFFSET, true);
    dataOffset = view.getFloat64(SUPERBLOCK.DATA_OFFSET, true);
    pathTableUsed = view.getUint32(SUPERBLOCK.PATH_USED, true);

    // Sanity check — if values are unreasonable, fall back to defaults
    if (blockSize === 0 || (blockSize & (blockSize - 1)) !== 0 || inodeCount === 0 ||
        inodeTableOffset >= fileSize || pathTableOffset >= fileSize || dataOffset >= fileSize) {
      const layout = calculateLayout(DEFAULT_INODE_COUNT, DEFAULT_BLOCK_SIZE, INITIAL_DATA_BLOCKS);
      inodeCount = DEFAULT_INODE_COUNT;
      blockSize = DEFAULT_BLOCK_SIZE;
      totalBlocks = INITIAL_DATA_BLOCKS;
      inodeTableOffset = layout.inodeTableOffset;
      pathTableOffset = layout.pathTableOffset;
      bitmapOffset = layout.bitmapOffset;
      dataOffset = layout.dataOffset;
      pathTableUsed = INITIAL_PATH_TABLE_SIZE;
    }
  } else {
    // Superblock corrupt — use default layout
    const layout = calculateLayout(DEFAULT_INODE_COUNT, DEFAULT_BLOCK_SIZE, INITIAL_DATA_BLOCKS);
    inodeCount = DEFAULT_INODE_COUNT;
    blockSize = DEFAULT_BLOCK_SIZE;
    totalBlocks = INITIAL_DATA_BLOCKS;
    inodeTableOffset = layout.inodeTableOffset;
    pathTableOffset = layout.pathTableOffset;
    bitmapOffset = layout.bitmapOffset;
    dataOffset = layout.dataOffset;
    pathTableUsed = INITIAL_PATH_TABLE_SIZE;
  }

  // Scan inode table for valid entries
  const decoder = new TextDecoder();
  const recovered: Array<{ path: string; type: number; data: Uint8Array }> = [];
  let lost = 0;

  const maxInodes = Math.min(inodeCount, Math.floor((fileSize - inodeTableOffset) / INODE_SIZE));

  for (let i = 0; i < maxInodes; i++) {
    const off = inodeTableOffset + i * INODE_SIZE;
    if (off + INODE_SIZE > fileSize) break;

    const type = raw[off + INODE.TYPE];
    if (type < INODE_TYPE.FILE || type > INODE_TYPE.SYMLINK) continue; // Skip free/invalid

    const inodeView = new DataView(raw.buffer, off, INODE_SIZE);
    const pathOffset = inodeView.getUint32(INODE.PATH_OFFSET, true);
    const pathLength = inodeView.getUint16(INODE.PATH_LENGTH, true);
    const size = inodeView.getFloat64(INODE.SIZE, true);
    const firstBlock = inodeView.getUint32(INODE.FIRST_BLOCK, true);
    const blockCount = inodeView.getUint32(INODE.BLOCK_COUNT, true);

    // Try to read path
    const absPathOffset = pathTableOffset + pathOffset;
    if (pathLength === 0 || pathLength > 4096 || absPathOffset + pathLength > fileSize) {
      lost++;
      continue;
    }

    let path: string;
    try {
      path = decoder.decode(raw.subarray(absPathOffset, absPathOffset + pathLength));
    } catch {
      lost++;
      continue;
    }

    // Validate path looks reasonable
    if (!path.startsWith('/') || path.includes('\0')) {
      lost++;
      continue;
    }

    // For directories, no data needed
    if (type === INODE_TYPE.DIRECTORY) {
      recovered.push({ path, type, data: new Uint8Array(0) });
      continue;
    }

    // Try to read file data
    if (size < 0 || size > fileSize || !isFinite(size)) {
      lost++;
      continue;
    }

    const dataStart = dataOffset + firstBlock * blockSize;
    if (dataStart + size > fileSize || firstBlock >= totalBlocks) {
      // Data blocks out of bounds — try to recover with empty data
      recovered.push({ path, type, data: new Uint8Array(0) });
      lost++;
      continue;
    }

    const data = raw.slice(dataStart, dataStart + size);
    recovered.push({ path, type, data });
  }

  // Delete corrupt VFS
  await rootDir.removeEntry('.vfs.bin');

  // Create fresh VFS with recovered data
  const newFileHandle = await rootDir.getFileHandle('.vfs.bin', { create: true });
  const handle = await newFileHandle.createSyncAccessHandle();

  try {
    const engine = new VFSEngine();
    engine.init(handle); // Fresh format

    // Sort: directories first (by depth), then files
    const dirs = recovered
      .filter(e => e.type === INODE_TYPE.DIRECTORY && e.path !== '/')
      .sort((a, b) => a.path.localeCompare(b.path));
    const files = recovered.filter(e => e.type === INODE_TYPE.FILE);
    const symlinks = recovered.filter(e => e.type === INODE_TYPE.SYMLINK);

    // Create directories
    for (const dir of dirs) {
      const result = engine.mkdir(dir.path, 0o040755);
      if (result.status !== 0) lost++;
    }

    // Write files
    for (const file of files) {
      const result = engine.write(file.path, file.data);
      if (result.status !== 0) lost++;
    }

    // Recreate symlinks
    for (const sym of symlinks) {
      const target = decoder.decode(sym.data);
      const result = engine.symlink(target, sym.path);
      if (result.status !== 0) lost++;
    }

    engine.flush();
  } finally {
    handle.close();
  }

  const entries = recovered
    .filter(e => e.path !== '/')
    .map(e => ({
      path: e.path,
      type: (e.type === INODE_TYPE.FILE ? 'file' : e.type === INODE_TYPE.DIRECTORY ? 'directory' : 'symlink') as 'file' | 'directory' | 'symlink',
      size: e.data.byteLength,
    }));

  return { recovered: entries.length, lost, entries };
}
