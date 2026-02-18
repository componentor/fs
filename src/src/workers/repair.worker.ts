/**
 * Repair Worker — handles VFS repair and load operations.
 *
 * Spawned by helpers.ts when the caller doesn't have sync handle access
 * (e.g. main thread). All VFS writes go through createSyncAccessHandle
 * for direct disk I/O — no MemoryHandle, no RAM bloat.
 *
 * Operations:
 * - 'repair': Scan corrupt .vfs.bin, rebuild valid entries into fresh VFS
 * - 'load':   Read OPFS files, create fresh VFS from them
 *
 * Safety guarantees:
 * - Original .vfs.bin is never deleted until the replacement is verified
 * - Temp file (.vfs.bin.tmp) is verified via re-mount before swap
 * - Orphaned .vfs.bin.tmp is cleaned up on entry
 * - Repair fails fast if critical operations exceed error threshold
 */

import { VFSEngine } from '../vfs/engine.js';
import {
  VFS_MAGIC, VFS_VERSION, SUPERBLOCK, INODE, INODE_SIZE, INODE_TYPE,
  DEFAULT_INODE_COUNT, DEFAULT_BLOCK_SIZE, INITIAL_DATA_BLOCKS,
  INITIAL_PATH_TABLE_SIZE, calculateLayout,
} from '../vfs/layout.js';

self.onmessage = async (event: MessageEvent) => {
  try {
    const msg = event.data;
    if (msg.type === 'repair') {
      (self as any).postMessage(await handleRepair(msg.root));
    } else if (msg.type === 'load') {
      (self as any).postMessage(await handleLoad(msg.root));
    } else {
      throw new Error(`Unknown message type: ${msg.type}`);
    }
  } catch (err: any) {
    (self as any).postMessage({ error: err.message || String(err) });
  }
};

// ========== OPFS navigation (duplicated for bundle isolation) ==========

async function navigateToRoot(root: string): Promise<FileSystemDirectoryHandle> {
  let dir = await navigator.storage.getDirectory();
  if (root && root !== '/') {
    for (const seg of root.split('/').filter(Boolean)) {
      dir = await dir.getDirectoryHandle(seg, { create: true });
    }
  }
  return dir;
}

interface OPFSEntry {
  path: string;
  type: 'file' | 'directory';
  data?: ArrayBuffer;
}

async function readOPFSRecursive(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  skip: Set<string>,
): Promise<OPFSEntry[]> {
  const result: OPFSEntry[] = [];
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

// ========== Cleanup orphaned temp files ==========

async function cleanupTmpFile(rootDir: FileSystemDirectoryHandle): Promise<void> {
  try { await rootDir.removeEntry('.vfs.bin.tmp'); } catch {}
}

// ========== Verify VFS via re-mount ==========

/**
 * Open the file, mount it as a VFS, verify superblock + inode table,
 * then close. Throws if the VFS is corrupt.
 */
async function verifyVFS(fileHandle: FileSystemFileHandle): Promise<void> {
  const handle = await (fileHandle as any).createSyncAccessHandle();
  try {
    const engine = new VFSEngine();
    engine.init(handle); // calls mount() which validates superblock + rebuilds index
  } finally {
    handle.close();
  }
}

// ========== Safe file swap: copy-then-delete ==========

/**
 * Safely replace .vfs.bin with .vfs.bin.tmp:
 * 1. Verify the temp file is a valid VFS (re-mount test)
 * 2. Copy temp → .vfs.bin (overwrite via truncate + chunked write)
 * 3. Only then delete .vfs.bin.tmp
 *
 * If the copy is interrupted mid-write, the original .vfs.bin.tmp
 * still exists intact for retry.
 */
async function swapTmpToVFS(
  rootDir: FileSystemDirectoryHandle,
  tmpFileHandle: FileSystemFileHandle,
): Promise<void> {
  // Step 1: Verify temp file is valid before touching original
  await verifyVFS(tmpFileHandle);

  // Step 2: Copy tmp → .vfs.bin (overwrite)
  const vfsFileHandle = await rootDir.getFileHandle('.vfs.bin', { create: true });

  const srcHandle = await (tmpFileHandle as any).createSyncAccessHandle();
  const dstHandle = await (vfsFileHandle as any).createSyncAccessHandle();
  try {
    const size: number = srcHandle.getSize();
    dstHandle.truncate(size);
    const CHUNK = 1024 * 1024; // 1MB
    const buf = new Uint8Array(CHUNK);
    for (let off = 0; off < size; off += CHUNK) {
      const n: number = srcHandle.read(buf, { at: off });
      dstHandle.write(n < CHUNK ? buf.subarray(0, n) : buf, { at: off });
    }
    dstHandle.flush();
  } finally {
    dstHandle.close();
    srcHandle.close();
  }

  // Step 3: Only delete tmp after successful copy
  try { await rootDir.removeEntry('.vfs.bin.tmp'); } catch {}
}

// ========== Repair handler ==========

async function handleRepair(root: string) {
  const rootDir = await navigateToRoot(root);

  // Clean up any orphaned temp file from a previous failed repair
  await cleanupTmpFile(rootDir);

  // Read old .vfs.bin
  const vfsFileHandle = await rootDir.getFileHandle('.vfs.bin');
  const file = await vfsFileHandle.getFile();
  const raw = new Uint8Array(await file.arrayBuffer());
  const fileSize = raw.byteLength;

  if (fileSize < SUPERBLOCK.SIZE) {
    throw new Error(`VFS file too small to repair (${fileSize} bytes)`);
  }

  // Parse superblock
  const view = new DataView(raw.buffer);
  let inodeCount: number;
  let blockSize: number;
  let totalBlocks: number;
  let inodeTableOffset: number;
  let pathTableOffset: number;
  let dataOffset: number;
  let bitmapOffset: number;
  let pathTableSize: number;

  const magic = view.getUint32(SUPERBLOCK.MAGIC, true);
  const version = view.getUint32(SUPERBLOCK.VERSION, true);
  const superblockValid = magic === VFS_MAGIC && version === VFS_VERSION;

  if (superblockValid) {
    inodeCount = view.getUint32(SUPERBLOCK.INODE_COUNT, true);
    blockSize = view.getUint32(SUPERBLOCK.BLOCK_SIZE, true);
    totalBlocks = view.getUint32(SUPERBLOCK.TOTAL_BLOCKS, true);
    inodeTableOffset = view.getFloat64(SUPERBLOCK.INODE_OFFSET, true);
    pathTableOffset = view.getFloat64(SUPERBLOCK.PATH_OFFSET, true);
    dataOffset = view.getFloat64(SUPERBLOCK.DATA_OFFSET, true);
    bitmapOffset = view.getFloat64(SUPERBLOCK.BITMAP_OFFSET, true);
    // Use the full allocated path table size (not PATH_USED) for repair validation.
    // PATH_USED may be stale if the superblock wasn't flushed after a write —
    // paths were written to OPFS but the superblock counter wasn't updated.
    pathTableSize = bitmapOffset - pathTableOffset;

    if (blockSize === 0 || (blockSize & (blockSize - 1)) !== 0 || inodeCount === 0 ||
        inodeTableOffset >= fileSize || pathTableOffset >= fileSize || dataOffset >= fileSize ||
        pathTableSize <= 0) {
      const layout = calculateLayout(DEFAULT_INODE_COUNT, DEFAULT_BLOCK_SIZE, INITIAL_DATA_BLOCKS);
      inodeCount = DEFAULT_INODE_COUNT;
      blockSize = DEFAULT_BLOCK_SIZE;
      totalBlocks = INITIAL_DATA_BLOCKS;
      inodeTableOffset = layout.inodeTableOffset;
      pathTableOffset = layout.pathTableOffset;
      dataOffset = layout.dataOffset;
      bitmapOffset = layout.bitmapOffset;
      pathTableSize = bitmapOffset - pathTableOffset;
    }
  } else {
    const layout = calculateLayout(DEFAULT_INODE_COUNT, DEFAULT_BLOCK_SIZE, INITIAL_DATA_BLOCKS);
    inodeCount = DEFAULT_INODE_COUNT;
    blockSize = DEFAULT_BLOCK_SIZE;
    totalBlocks = INITIAL_DATA_BLOCKS;
    inodeTableOffset = layout.inodeTableOffset;
    pathTableOffset = layout.pathTableOffset;
    dataOffset = layout.dataOffset;
    bitmapOffset = layout.bitmapOffset;
    pathTableSize = bitmapOffset - pathTableOffset;
  }

  // Scan inodes for recoverable entries
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const recovered: Array<{
    path: string;
    type: number;
    dataOffset: number;
    dataSize: number;
    /** true when inode was found but data blocks were out of bounds */
    contentLost: boolean;
  }> = [];
  let lost = 0;

  const maxInodes = Math.min(inodeCount, Math.floor((fileSize - inodeTableOffset) / INODE_SIZE));

  for (let i = 0; i < maxInodes; i++) {
    const off = inodeTableOffset + i * INODE_SIZE;
    if (off + INODE_SIZE > fileSize) break;

    const type = raw[off + INODE.TYPE];
    if (type < INODE_TYPE.FILE || type > INODE_TYPE.SYMLINK) continue;

    const inodeView = new DataView(raw.buffer, off, INODE_SIZE);
    const pathOff = inodeView.getUint32(INODE.PATH_OFFSET, true);
    const pathLength = inodeView.getUint16(INODE.PATH_LENGTH, true);
    const size = inodeView.getFloat64(INODE.SIZE, true);
    const firstBlock = inodeView.getUint32(INODE.FIRST_BLOCK, true);

    // Validate path bounds against the allocated path table region and file size.
    // Use pathTableSize (not PATH_USED from superblock) because PATH_USED may be
    // stale if the superblock wasn't flushed — the path bytes are still on disk.
    const absPathOffset = pathTableOffset + pathOff;
    if (pathLength === 0 || pathLength > 4096 ||
        absPathOffset + pathLength > fileSize ||
        pathOff + pathLength > pathTableSize) {
      lost++;
      continue;
    }

    // Decode path with strict UTF-8 (fatal: true rejects invalid sequences)
    let entryPath: string;
    try {
      entryPath = decoder.decode(raw.subarray(absPathOffset, absPathOffset + pathLength));
    } catch {
      lost++;
      continue;
    }

    if (!entryPath.startsWith('/') || entryPath.includes('\0')) {
      lost++;
      continue;
    }

    if (type === INODE_TYPE.DIRECTORY) {
      recovered.push({ path: entryPath, type, dataOffset: 0, dataSize: 0, contentLost: false });
      continue;
    }

    if (size < 0 || size > fileSize || !isFinite(size)) {
      lost++;
      continue;
    }

    const blockCount = inodeView.getUint32(INODE.BLOCK_COUNT, true);
    const dataStart = dataOffset + firstBlock * blockSize;
    if (dataStart + size > fileSize || firstBlock >= totalBlocks ||
        (blockCount > 0 && firstBlock + blockCount > totalBlocks)) {
      // Inode metadata is valid but data blocks are out of bounds — content is lost
      recovered.push({ path: entryPath, type, dataOffset: 0, dataSize: 0, contentLost: true });
      lost++;
      continue;
    }

    recovered.push({ path: entryPath, type, dataOffset: dataStart, dataSize: size, contentLost: false });
  }

  // Build repaired VFS in temp file — original .vfs.bin untouched until verified
  const tmpFileHandle = await rootDir.getFileHandle('.vfs.bin.tmp', { create: true });
  const tmpHandle = await (tmpFileHandle as any).createSyncAccessHandle();

  let repairOk = false;
  let criticalErrors = 0;
  const MAX_CRITICAL_ERRORS = 5;

  try {
    const engine = new VFSEngine();
    engine.init(tmpHandle);

    const dirs = recovered
      .filter(e => e.type === INODE_TYPE.DIRECTORY && e.path !== '/')
      .sort((a, b) => a.path.localeCompare(b.path));
    const files = recovered.filter(e => e.type === INODE_TYPE.FILE);
    const symlinks = recovered.filter(e => e.type === INODE_TYPE.SYMLINK);

    // Create directories — failure here is critical (blocks child files)
    for (const dir of dirs) {
      if (engine.mkdir(dir.path, 0o040755).status !== 0) {
        criticalErrors++;
        lost++;
        if (criticalErrors >= MAX_CRITICAL_ERRORS) {
          throw new Error(`Repair aborted: too many critical errors (${criticalErrors} mkdir failures)`);
        }
      }
    }

    // Write files
    for (const f of files) {
      const data = f.dataSize > 0
        ? raw.subarray(f.dataOffset, f.dataOffset + f.dataSize)
        : new Uint8Array(0);
      if (engine.write(f.path, data).status !== 0) {
        lost++;
        // File write failures are less critical than mkdir — parent may be missing
      }
    }

    // Write symlinks — validate target before creating
    for (const sym of symlinks) {
      if (sym.dataSize === 0 && sym.contentLost) {
        // Symlink target was lost — skip, don't create a broken symlink
        lost++;
        continue;
      }
      const data = sym.dataSize > 0
        ? raw.subarray(sym.dataOffset, sym.dataOffset + sym.dataSize)
        : new Uint8Array(0);
      let target: string;
      try {
        target = decoder.decode(data);
      } catch {
        // Invalid UTF-8 in symlink target — skip
        lost++;
        continue;
      }
      if (target.length === 0 || target.includes('\0')) {
        lost++;
        continue;
      }
      if (engine.symlink(target, sym.path).status !== 0) lost++;
    }

    engine.flush();
    repairOk = true;
  } finally {
    tmpHandle.close();
    if (!repairOk) {
      await cleanupTmpFile(rootDir);
    }
  }

  // Verify repaired VFS via re-mount, then swap into place
  // swapTmpToVFS calls verifyVFS internally — if verification fails,
  // .vfs.bin.tmp still exists and .vfs.bin is untouched
  try {
    await swapTmpToVFS(rootDir, tmpFileHandle);
  } catch (err: any) {
    // Swap failed — clean up temp file, throw descriptive error
    await cleanupTmpFile(rootDir);
    throw new Error(`Repair built a VFS but verification failed: ${err.message}`);
  }

  const entries = recovered
    .filter(e => e.path !== '/')
    .map(e => ({
      path: e.path,
      type: (e.type === INODE_TYPE.FILE ? 'file' : e.type === INODE_TYPE.DIRECTORY ? 'directory' : 'symlink') as 'file' | 'directory' | 'symlink',
      size: e.dataSize,
      contentLost: e.contentLost,
    }));

  return { recovered: entries.length, lost, entries };
}

// ========== Load handler ==========

async function handleLoad(root: string) {
  const rootDir = await navigateToRoot(root);

  // Clean up any orphaned temp file
  await cleanupTmpFile(rootDir);

  // Read all OPFS files FIRST (before touching .vfs.bin)
  const opfsEntries = await readOPFSRecursive(rootDir, '', new Set(['.vfs.bin', '.vfs.bin.tmp']));

  // Build fresh VFS in temp file — original .vfs.bin untouched until verified
  const tmpFileHandle = await rootDir.getFileHandle('.vfs.bin.tmp', { create: true });
  const tmpHandle = await (tmpFileHandle as any).createSyncAccessHandle();

  let buildOk = false;
  let files = 0;
  let directories = 0;

  try {
    const engine = new VFSEngine();
    engine.init(tmpHandle);

    const dirs = opfsEntries
      .filter(e => e.type === 'directory')
      .sort((a, b) => a.path.localeCompare(b.path));

    for (const dir of dirs) {
      if (engine.mkdir(dir.path, 0o040755).status === 0) {
        directories++;
      }
    }

    const fileEntries = opfsEntries.filter(e => e.type === 'file');
    for (const file of fileEntries) {
      if (engine.write(file.path, new Uint8Array(file.data ?? new ArrayBuffer(0))).status === 0) {
        files++;
      }
    }

    engine.flush();
    buildOk = true;
  } finally {
    tmpHandle.close();
    if (!buildOk) {
      await cleanupTmpFile(rootDir);
    }
  }

  // Verify then swap (verifyVFS + copy-then-delete)
  try {
    await swapTmpToVFS(rootDir, tmpFileHandle);
  } catch (err: any) {
    await cleanupTmpFile(rootDir);
    throw new Error(`Load built a VFS but verification failed: ${err.message}`);
  }

  return { files, directories };
}
