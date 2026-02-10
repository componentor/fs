/**
 * VFS Engine — operates on a FileSystemSyncAccessHandle
 *
 * Manages the binary VFS layout: superblock, inode table, path table,
 * free block bitmap, and data region. All operations are synchronous
 * and run inside the server worker.
 */

import {
  VFS_MAGIC, VFS_VERSION, SUPERBLOCK, INODE, INODE_SIZE, INODE_TYPE,
  DEFAULT_BLOCK_SIZE, DEFAULT_INODE_COUNT, DEFAULT_FILE_MODE, DEFAULT_DIR_MODE,
  DEFAULT_SYMLINK_MODE, DEFAULT_UMASK, S_IFMT, S_IFREG, S_IFDIR, S_IFLNK,
  MAX_SYMLINK_DEPTH, INITIAL_DATA_BLOCKS, INITIAL_PATH_TABLE_SIZE,
  calculateLayout,
} from './layout.js';
import { CODE_TO_STATUS } from '../errors.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface Inode {
  type: number;
  pathOffset: number;
  pathLength: number;
  mode: number;
  size: number;
  firstBlock: number;
  blockCount: number;
  mtime: number;
  ctime: number;
  atime: number;
  uid: number;
  gid: number;
}

interface FdEntry {
  tabId: string;
  inodeIdx: number;
  position: number;
  flags: number;
}

export class VFSEngine {
  private handle!: FileSystemSyncAccessHandle;
  private pathIndex = new Map<string, number>(); // path → inode index
  private inodeCount = 0;
  private blockSize = DEFAULT_BLOCK_SIZE;
  private totalBlocks = 0;
  private freeBlocks = 0;
  private inodeTableOffset = 0;
  private pathTableOffset = 0;
  private pathTableUsed = 0;
  private pathTableSize = 0;
  private bitmapOffset = 0;
  private dataOffset = 0;
  private umask = DEFAULT_UMASK;
  private processUid = 0;
  private processGid = 0;
  private strictPermissions = false;
  private debug = false;

  // File descriptor table
  private fdTable = new Map<number, FdEntry>();
  private nextFd = 3; // 0=stdin, 1=stdout, 2=stderr reserved

  // Reusable buffers to avoid allocations
  private inodeBuf = new Uint8Array(INODE_SIZE);
  private inodeView = new DataView(this.inodeBuf.buffer);

  // In-memory inode cache — eliminates disk reads for hot inodes
  private inodeCache = new Map<number, Inode>();
  private superblockBuf = new Uint8Array(SUPERBLOCK.SIZE);
  private superblockView = new DataView(this.superblockBuf.buffer);

  init(
    handle: FileSystemSyncAccessHandle,
    opts?: { uid?: number; gid?: number; umask?: number; strictPermissions?: boolean; debug?: boolean }
  ): void {
    this.handle = handle;
    this.processUid = opts?.uid ?? 0;
    this.processGid = opts?.gid ?? 0;
    this.umask = opts?.umask ?? DEFAULT_UMASK;
    this.strictPermissions = opts?.strictPermissions ?? false;
    this.debug = opts?.debug ?? false;

    const size = handle.getSize();

    if (size === 0) {
      this.format();
    } else {
      this.mount();
    }
  }

  /** Format a fresh VFS */
  private format(): void {
    const layout = calculateLayout(DEFAULT_INODE_COUNT, DEFAULT_BLOCK_SIZE, INITIAL_DATA_BLOCKS);

    this.inodeCount = DEFAULT_INODE_COUNT;
    this.blockSize = DEFAULT_BLOCK_SIZE;
    this.totalBlocks = layout.totalBlocks;
    this.freeBlocks = layout.totalBlocks;
    this.inodeTableOffset = layout.inodeTableOffset;
    this.pathTableOffset = layout.pathTableOffset;
    this.pathTableSize = layout.pathTableSize;
    this.pathTableUsed = 0;
    this.bitmapOffset = layout.bitmapOffset;
    this.dataOffset = layout.dataOffset;

    // Grow file to total size
    this.handle.truncate(layout.totalSize);

    // Write superblock
    this.writeSuperblock();

    // Zero out inode table (type=0 means free)
    const zeroBuf = new Uint8Array(layout.inodeTableSize);
    this.handle.write(zeroBuf, { at: this.inodeTableOffset });

    // Zero out bitmap
    const bitmapBuf = new Uint8Array(layout.bitmapSize);
    this.handle.write(bitmapBuf, { at: this.bitmapOffset });

    // Create root directory inode
    this.createInode('/', INODE_TYPE.DIRECTORY, DEFAULT_DIR_MODE, 0);

    this.handle.flush();
  }

  /** Mount an existing VFS from disk */
  private mount(): void {
    this.handle.read(this.superblockBuf, { at: 0 });
    const v = this.superblockView;

    const magic = v.getUint32(SUPERBLOCK.MAGIC, true);
    if (magic !== VFS_MAGIC) {
      throw new Error(`Invalid VFS: bad magic 0x${magic.toString(16)}`);
    }

    this.inodeCount = v.getUint32(SUPERBLOCK.INODE_COUNT, true);
    this.blockSize = v.getUint32(SUPERBLOCK.BLOCK_SIZE, true);
    this.totalBlocks = v.getUint32(SUPERBLOCK.TOTAL_BLOCKS, true);
    this.freeBlocks = v.getUint32(SUPERBLOCK.FREE_BLOCKS, true);
    this.inodeTableOffset = v.getFloat64(SUPERBLOCK.INODE_OFFSET, true);
    this.pathTableOffset = v.getFloat64(SUPERBLOCK.PATH_OFFSET, true);
    this.dataOffset = v.getFloat64(SUPERBLOCK.DATA_OFFSET, true);
    this.bitmapOffset = v.getFloat64(SUPERBLOCK.BITMAP_OFFSET, true);
    this.pathTableUsed = v.getUint32(SUPERBLOCK.PATH_USED, true);
    this.pathTableSize = this.bitmapOffset - this.pathTableOffset;

    this.rebuildIndex();
  }

  private writeSuperblock(): void {
    const v = this.superblockView;
    v.setUint32(SUPERBLOCK.MAGIC, VFS_MAGIC, true);
    v.setUint32(SUPERBLOCK.VERSION, VFS_VERSION, true);
    v.setUint32(SUPERBLOCK.INODE_COUNT, this.inodeCount, true);
    v.setUint32(SUPERBLOCK.BLOCK_SIZE, this.blockSize, true);
    v.setUint32(SUPERBLOCK.TOTAL_BLOCKS, this.totalBlocks, true);
    v.setUint32(SUPERBLOCK.FREE_BLOCKS, this.freeBlocks, true);
    v.setFloat64(SUPERBLOCK.INODE_OFFSET, this.inodeTableOffset, true);
    v.setFloat64(SUPERBLOCK.PATH_OFFSET, this.pathTableOffset, true);
    v.setFloat64(SUPERBLOCK.DATA_OFFSET, this.dataOffset, true);
    v.setFloat64(SUPERBLOCK.BITMAP_OFFSET, this.bitmapOffset, true);
    v.setUint32(SUPERBLOCK.PATH_USED, this.pathTableUsed, true);
    this.handle.write(this.superblockBuf, { at: 0 });
  }

  /** Rebuild in-memory path→inode index from disk */
  private rebuildIndex(): void {
    this.pathIndex.clear();
    for (let i = 0; i < this.inodeCount; i++) {
      const inode = this.readInode(i);
      if (inode.type === INODE_TYPE.FREE) continue;
      const path = this.readPath(inode.pathOffset, inode.pathLength);
      this.pathIndex.set(path, i);
    }
  }

  // ========== Low-level inode I/O ==========

  private readInode(idx: number): Inode {
    const cached = this.inodeCache.get(idx);
    if (cached) return cached;

    const offset = this.inodeTableOffset + idx * INODE_SIZE;
    this.handle.read(this.inodeBuf, { at: offset });
    const v = this.inodeView;
    const inode: Inode = {
      type: v.getUint8(INODE.TYPE),
      pathOffset: v.getUint32(INODE.PATH_OFFSET, true),
      pathLength: v.getUint16(INODE.PATH_LENGTH, true),
      mode: v.getUint32(INODE.MODE, true),
      size: v.getFloat64(INODE.SIZE, true),
      firstBlock: v.getUint32(INODE.FIRST_BLOCK, true),
      blockCount: v.getUint32(INODE.BLOCK_COUNT, true),
      mtime: v.getFloat64(INODE.MTIME, true),
      ctime: v.getFloat64(INODE.CTIME, true),
      atime: v.getFloat64(INODE.ATIME, true),
      uid: v.getUint32(INODE.UID, true),
      gid: v.getUint32(INODE.GID, true),
    };
    this.inodeCache.set(idx, inode);
    return inode;
  }

  private writeInode(idx: number, inode: Inode): void {
    // Maintain inode cache
    if (inode.type === INODE_TYPE.FREE) {
      this.inodeCache.delete(idx);
    } else {
      this.inodeCache.set(idx, inode);
    }

    const v = this.inodeView;
    v.setUint8(INODE.TYPE, inode.type);
    v.setUint8(INODE.FLAGS, 0);
    v.setUint8(INODE.FLAGS + 1, 0);
    v.setUint8(INODE.FLAGS + 2, 0);
    v.setUint32(INODE.PATH_OFFSET, inode.pathOffset, true);
    v.setUint16(INODE.PATH_LENGTH, inode.pathLength, true);
    v.setUint16(INODE.RESERVED_10, 0, true);
    v.setUint32(INODE.MODE, inode.mode, true);
    v.setFloat64(INODE.SIZE, inode.size, true);
    v.setUint32(INODE.FIRST_BLOCK, inode.firstBlock, true);
    v.setUint32(INODE.BLOCK_COUNT, inode.blockCount, true);
    v.setFloat64(INODE.MTIME, inode.mtime, true);
    v.setFloat64(INODE.CTIME, inode.ctime, true);
    v.setFloat64(INODE.ATIME, inode.atime, true);
    v.setUint32(INODE.UID, inode.uid, true);
    v.setUint32(INODE.GID, inode.gid, true);

    const offset = this.inodeTableOffset + idx * INODE_SIZE;
    this.handle.write(this.inodeBuf, { at: offset });
  }

  // ========== Path table I/O ==========

  private readPath(offset: number, length: number): string {
    const buf = new Uint8Array(length);
    this.handle.read(buf, { at: this.pathTableOffset + offset });
    return decoder.decode(buf);
  }

  private appendPath(path: string): { offset: number; length: number } {
    const bytes = encoder.encode(path);
    const offset = this.pathTableUsed;

    // Check if path table needs to grow
    if (offset + bytes.byteLength > this.pathTableSize) {
      this.growPathTable(offset + bytes.byteLength);
    }

    this.handle.write(bytes, { at: this.pathTableOffset + offset });
    this.pathTableUsed += bytes.byteLength;

    // Update superblock with new path table usage
    this.superblockView.setUint32(SUPERBLOCK.PATH_USED, this.pathTableUsed, true);
    this.handle.write(this.superblockBuf.subarray(SUPERBLOCK.PATH_USED, SUPERBLOCK.PATH_USED + 4), { at: SUPERBLOCK.PATH_USED });

    return { offset, length: bytes.byteLength };
  }

  private growPathTable(needed: number): void {
    // Double the path table or grow to fit needed, whichever is larger
    const newSize = Math.max(this.pathTableSize * 2, needed + INITIAL_PATH_TABLE_SIZE);
    const growth = newSize - this.pathTableSize;

    // Need to shift bitmap and data region forward
    // Read existing bitmap
    const bitmapSize = Math.ceil(this.totalBlocks / 8);
    const bitmapBuf = new Uint8Array(bitmapSize);
    this.handle.read(bitmapBuf, { at: this.bitmapOffset });

    // Read existing data region
    const dataSize = this.totalBlocks * this.blockSize;
    const dataBuf = new Uint8Array(dataSize);
    this.handle.read(dataBuf, { at: this.dataOffset });

    // Grow file
    const newTotalSize = this.handle.getSize() + growth;
    this.handle.truncate(newTotalSize);

    // Write data back at new offset
    const newBitmapOffset = this.bitmapOffset + growth;
    const newDataOffset = this.dataOffset + growth;
    this.handle.write(dataBuf, { at: newDataOffset });
    this.handle.write(bitmapBuf, { at: newBitmapOffset });

    // Update offsets
    this.pathTableSize = newSize;
    this.bitmapOffset = newBitmapOffset;
    this.dataOffset = newDataOffset;

    // Update superblock
    this.writeSuperblock();
  }

  // ========== Bitmap I/O ==========

  private allocateBlocks(count: number): number {
    if (count === 0) return 0;

    // Find contiguous free blocks
    const bitmapSize = Math.ceil(this.totalBlocks / 8);
    const bitmap = new Uint8Array(bitmapSize);
    this.handle.read(bitmap, { at: this.bitmapOffset });

    let run = 0;
    let start = 0;

    for (let i = 0; i < this.totalBlocks; i++) {
      const byteIdx = i >>> 3;
      const bitIdx = i & 7;
      const used = (bitmap[byteIdx] >>> bitIdx) & 1;

      if (used) {
        run = 0;
        start = i + 1;
      } else {
        run++;
        if (run === count) {
          // Mark blocks as used
          for (let j = start; j <= i; j++) {
            const bj = j >>> 3;
            const bi = j & 7;
            bitmap[bj] |= (1 << bi);
          }
          this.handle.write(bitmap, { at: this.bitmapOffset });
          this.freeBlocks -= count;
          this.updateSuperblockFreeBlocks();
          return start;
        }
      }
    }

    // No contiguous space — grow data region
    return this.growAndAllocate(count);
  }

  private growAndAllocate(count: number): number {
    const oldTotal = this.totalBlocks;
    // Grow by at least doubling or enough for the request
    const newTotal = Math.max(oldTotal * 2, oldTotal + count);
    const addedBlocks = newTotal - oldTotal;

    // Grow the file
    const newFileSize = this.dataOffset + newTotal * this.blockSize;
    this.handle.truncate(newFileSize);

    // Grow bitmap
    const oldBitmapSize = Math.ceil(oldTotal / 8);
    const newBitmapSize = Math.ceil(newTotal / 8);
    if (newBitmapSize > oldBitmapSize) {
      const zeroes = new Uint8Array(newBitmapSize - oldBitmapSize);
      this.handle.write(zeroes, { at: this.bitmapOffset + oldBitmapSize });
    }

    this.totalBlocks = newTotal;
    this.freeBlocks += addedBlocks;

    // Now allocate from the newly freed area
    const start = oldTotal;
    const bitmap = new Uint8Array(newBitmapSize);
    this.handle.read(bitmap, { at: this.bitmapOffset });

    for (let j = start; j < start + count; j++) {
      const bj = j >>> 3;
      const bi = j & 7;
      bitmap[bj] |= (1 << bi);
    }

    this.handle.write(bitmap, { at: this.bitmapOffset });
    this.freeBlocks -= count;

    // Update superblock
    this.superblockView.setUint32(SUPERBLOCK.TOTAL_BLOCKS, this.totalBlocks, true);
    this.superblockView.setUint32(SUPERBLOCK.FREE_BLOCKS, this.freeBlocks, true);
    this.handle.write(this.superblockBuf, { at: 0 });

    return start;
  }

  private freeBlockRange(start: number, count: number): void {
    if (count === 0) return;
    const bitmapSize = Math.ceil(this.totalBlocks / 8);
    const bitmap = new Uint8Array(bitmapSize);
    this.handle.read(bitmap, { at: this.bitmapOffset });

    for (let i = start; i < start + count; i++) {
      const byteIdx = i >>> 3;
      const bitIdx = i & 7;
      bitmap[byteIdx] &= ~(1 << bitIdx);
    }

    this.handle.write(bitmap, { at: this.bitmapOffset });
    this.freeBlocks += count;
    this.updateSuperblockFreeBlocks();
  }

  private updateSuperblockFreeBlocks(): void {
    this.superblockView.setUint32(SUPERBLOCK.FREE_BLOCKS, this.freeBlocks, true);
    this.handle.write(
      this.superblockBuf.subarray(SUPERBLOCK.FREE_BLOCKS, SUPERBLOCK.FREE_BLOCKS + 4),
      { at: SUPERBLOCK.FREE_BLOCKS }
    );
  }

  // ========== Inode allocation ==========

  private findFreeInode(): number {
    for (let i = 0; i < this.inodeCount; i++) {
      // Check cache first — cached entries are never FREE
      if (this.inodeCache.has(i)) continue;

      const offset = this.inodeTableOffset + i * INODE_SIZE;
      const typeBuf = new Uint8Array(1);
      this.handle.read(typeBuf, { at: offset });
      if (typeBuf[0] === INODE_TYPE.FREE) return i;
    }
    // All inodes used — grow inode table
    return this.growInodeTable();
  }

  private growInodeTable(): number {
    const oldCount = this.inodeCount;
    const newCount = oldCount * 2;
    const growth = (newCount - oldCount) * INODE_SIZE;

    // Read everything after inode table
    const afterInodeOffset = this.inodeTableOffset + oldCount * INODE_SIZE;
    const afterSize = this.handle.getSize() - afterInodeOffset;
    const afterBuf = new Uint8Array(afterSize);
    this.handle.read(afterBuf, { at: afterInodeOffset });

    // Grow file
    this.handle.truncate(this.handle.getSize() + growth);

    // Write back shifted content
    this.handle.write(afterBuf, { at: afterInodeOffset + growth });

    // Zero out new inode entries
    const zeroes = new Uint8Array(growth);
    this.handle.write(zeroes, { at: afterInodeOffset });

    // Update offsets
    this.pathTableOffset += growth;
    this.bitmapOffset += growth;
    this.dataOffset += growth;
    this.inodeCount = newCount;

    this.writeSuperblock();

    return oldCount; // First new free inode
  }

  // ========== Data I/O ==========

  private readData(firstBlock: number, blockCount: number, size: number): Uint8Array {
    const buf = new Uint8Array(size);
    const offset = this.dataOffset + firstBlock * this.blockSize;
    this.handle.read(buf, { at: offset });
    return buf;
  }

  private writeData(firstBlock: number, data: Uint8Array): void {
    const offset = this.dataOffset + firstBlock * this.blockSize;
    this.handle.write(data, { at: offset });
  }

  // ========== Path resolution ==========

  private resolvePath(path: string, depth: number = 0): number | undefined {
    if (depth > MAX_SYMLINK_DEPTH) return undefined; // ELOOP

    const idx = this.pathIndex.get(path);
    if (idx === undefined) return undefined;

    const inode = this.readInode(idx);
    if (inode.type === INODE_TYPE.SYMLINK) {
      // Follow symlink
      const target = decoder.decode(this.readData(inode.firstBlock, inode.blockCount, inode.size));
      const resolved = target.startsWith('/') ? target : this.resolveRelative(path, target);
      return this.resolvePath(resolved, depth + 1);
    }

    return idx;
  }

  /** Resolve symlinks in intermediate path components */
  private resolvePathComponents(path: string, followLast: boolean = true): number | undefined {
    const parts = path.split('/').filter(Boolean);
    let current = '/';

    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      current = current === '/' ? '/' + parts[i] : current + '/' + parts[i];

      const idx = this.pathIndex.get(current);
      if (idx === undefined) return undefined;

      const inode = this.readInode(idx);
      if (inode.type === INODE_TYPE.SYMLINK && (!isLast || followLast)) {
        const target = decoder.decode(this.readData(inode.firstBlock, inode.blockCount, inode.size));
        const resolved = target.startsWith('/') ? target : this.resolveRelative(current, target);

        if (isLast) {
          return this.resolvePath(resolved);
        }

        // Reconstruct remaining path with resolved symlink
        const remaining = parts.slice(i + 1).join('/');
        const newPath = resolved + (remaining ? '/' + remaining : '');
        return this.resolvePathComponents(newPath, followLast);
      }
    }

    return this.pathIndex.get(current);
  }

  private resolveRelative(from: string, target: string): string {
    const dir = from.substring(0, from.lastIndexOf('/')) || '/';
    const parts = (dir + '/' + target).split('/').filter(Boolean);
    const resolved: string[] = [];
    for (const p of parts) {
      if (p === '.') continue;
      if (p === '..') { resolved.pop(); continue; }
      resolved.push(p);
    }
    return '/' + resolved.join('/');
  }

  // ========== Core inode creation helper ==========

  private createInode(path: string, type: number, mode: number, size: number, data?: Uint8Array): number {
    const idx = this.findFreeInode();
    const { offset: pathOff, length: pathLen } = this.appendPath(path);
    const now = Date.now();

    let firstBlock = 0;
    let blockCount = 0;

    if (data && data.byteLength > 0) {
      blockCount = Math.ceil(data.byteLength / this.blockSize);
      firstBlock = this.allocateBlocks(blockCount);
      this.writeData(firstBlock, data);
    }

    const inode: Inode = {
      type,
      pathOffset: pathOff,
      pathLength: pathLen,
      mode,
      size,
      firstBlock,
      blockCount,
      mtime: now,
      ctime: now,
      atime: now,
      uid: this.processUid,
      gid: this.processGid,
    };

    this.writeInode(idx, inode);
    this.pathIndex.set(path, idx);

    return idx;
  }

  // ========== Public API — called by server worker dispatch ==========

  /** Normalize a path: ensure leading /, resolve . and .. */
  normalizePath(p: string): string {
    if (!p.startsWith('/')) p = '/' + p;
    const parts = p.split('/').filter(Boolean);
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === '.') continue;
      if (part === '..') { resolved.pop(); continue; }
      resolved.push(part);
    }
    return '/' + resolved.join('/');
  }

  // ---- READ ----
  read(path: string): { status: number; data: Uint8Array | null } {
    const t0 = this.debug ? performance.now() : 0;
    path = this.normalizePath(path);
    const t1 = this.debug ? performance.now() : 0;
    const idx = this.resolvePathComponents(path, true);
    if (idx === undefined) return { status: CODE_TO_STATUS.ENOENT, data: null };

    const t2 = this.debug ? performance.now() : 0;
    const inode = this.readInode(idx);
    if (inode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EISDIR, data: null };

    const t3 = this.debug ? performance.now() : 0;
    const data = inode.size > 0
      ? this.readData(inode.firstBlock, inode.blockCount, inode.size)
      : new Uint8Array(0);
    const t4 = this.debug ? performance.now() : 0;

    if (this.debug) {
      console.log(`[VFS read] path=${path} size=${inode.size} normalize=${(t1-t0).toFixed(3)}ms resolve=${(t2-t1).toFixed(3)}ms inode=${(t3-t2).toFixed(3)}ms data=${(t4-t3).toFixed(3)}ms TOTAL=${(t4-t0).toFixed(3)}ms`);
    }

    return { status: 0, data };
  }

  // ---- WRITE ----
  write(path: string, data: Uint8Array, flags: number = 0): { status: number } {
    const t0 = this.debug ? performance.now() : 0;
    path = this.normalizePath(path);
    const t1 = this.debug ? performance.now() : 0;

    // Ensure parent directory exists
    const parentStatus = this.ensureParent(path);
    if (parentStatus !== 0) return { status: parentStatus };
    const t2 = this.debug ? performance.now() : 0;

    const existingIdx = this.resolvePathComponents(path, true);
    const t3 = this.debug ? performance.now() : 0;

    let tAlloc = t3, tData = t3, tInode = t3;

    if (existingIdx !== undefined) {
      // Update existing file
      const inode = this.readInode(existingIdx);
      if (inode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EISDIR };

      const neededBlocks = Math.ceil(data.byteLength / this.blockSize);

      if (neededBlocks <= inode.blockCount) {
        // Fits in current blocks
        tAlloc = this.debug ? performance.now() : 0;
        this.writeData(inode.firstBlock, data);
        tData = this.debug ? performance.now() : 0;
        if (neededBlocks < inode.blockCount) {
          this.freeBlockRange(inode.firstBlock + neededBlocks, inode.blockCount - neededBlocks);
        }
      } else {
        // Need more blocks — free old, allocate new
        this.freeBlockRange(inode.firstBlock, inode.blockCount);
        const newFirst = this.allocateBlocks(neededBlocks);
        tAlloc = this.debug ? performance.now() : 0;
        this.writeData(newFirst, data);
        tData = this.debug ? performance.now() : 0;
        inode.firstBlock = newFirst;
      }

      inode.size = data.byteLength;
      inode.blockCount = neededBlocks;
      inode.mtime = Date.now();
      this.writeInode(existingIdx, inode);
      tInode = this.debug ? performance.now() : 0;
    } else {
      // Create new file
      const mode = DEFAULT_FILE_MODE & ~(this.umask & 0o777);
      this.createInode(path, INODE_TYPE.FILE, mode, data.byteLength, data);
      tAlloc = this.debug ? performance.now() : 0;
      tData = tAlloc;
      tInode = tAlloc;
    }

    if (flags & 1) this.handle.flush();
    const tFlush = this.debug ? performance.now() : 0;

    if (this.debug) {
      const existing = existingIdx !== undefined;
      console.log(`[VFS write] path=${path} size=${data.byteLength} ${existing ? 'UPDATE' : 'CREATE'} normalize=${(t1-t0).toFixed(3)}ms parent=${(t2-t1).toFixed(3)}ms resolve=${(t3-t2).toFixed(3)}ms alloc=${(tAlloc-t3).toFixed(3)}ms data=${(tData-tAlloc).toFixed(3)}ms inode=${(tInode-tData).toFixed(3)}ms flush=${(tFlush-tInode).toFixed(3)}ms TOTAL=${(tFlush-t0).toFixed(3)}ms`);
    }

    return { status: 0 };
  }

  // ---- APPEND ----
  append(path: string, data: Uint8Array): { status: number } {
    path = this.normalizePath(path);
    const existingIdx = this.resolvePathComponents(path, true);

    if (existingIdx === undefined) {
      // Create new file with the data
      return this.write(path, data);
    }

    const inode = this.readInode(existingIdx);
    if (inode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EISDIR };

    // Read existing data
    const existing = inode.size > 0
      ? this.readData(inode.firstBlock, inode.blockCount, inode.size)
      : new Uint8Array(0);

    // Concat
    const combined = new Uint8Array(existing.byteLength + data.byteLength);
    combined.set(existing);
    combined.set(data, existing.byteLength);

    // Rewrite
    const neededBlocks = Math.ceil(combined.byteLength / this.blockSize);
    this.freeBlockRange(inode.firstBlock, inode.blockCount);
    const newFirst = this.allocateBlocks(neededBlocks);
    this.writeData(newFirst, combined);

    inode.firstBlock = newFirst;
    inode.blockCount = neededBlocks;
    inode.size = combined.byteLength;
    inode.mtime = Date.now();
    this.writeInode(existingIdx, inode);

    return { status: 0 };
  }

  // ---- UNLINK ----
  unlink(path: string): { status: number } {
    path = this.normalizePath(path);
    const idx = this.pathIndex.get(path);
    if (idx === undefined) return { status: CODE_TO_STATUS.ENOENT };

    const inode = this.readInode(idx);
    if (inode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EISDIR };

    // Free data blocks
    this.freeBlockRange(inode.firstBlock, inode.blockCount);

    // Mark inode as free
    inode.type = INODE_TYPE.FREE;
    this.writeInode(idx, inode);

    // Remove from index
    this.pathIndex.delete(path);

    return { status: 0 };
  }

  // ---- STAT ----
  stat(path: string): { status: number; data: Uint8Array | null } {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === undefined) return { status: CODE_TO_STATUS.ENOENT, data: null };

    return this.encodeStatResponse(idx);
  }

  // ---- LSTAT (no symlink follow) ----
  lstat(path: string): { status: number; data: Uint8Array | null } {
    path = this.normalizePath(path);
    const idx = this.pathIndex.get(path);
    if (idx === undefined) return { status: CODE_TO_STATUS.ENOENT, data: null };

    return this.encodeStatResponse(idx);
  }

  private encodeStatResponse(idx: number): { status: number; data: Uint8Array } {
    const inode = this.readInode(idx);
    // Encode stat into binary: type(1) + mode(4) + size(8) + mtime(8) + ctime(8) + atime(8) + uid(4) + gid(4) + ino(4) = 49 bytes
    const buf = new Uint8Array(49);
    const view = new DataView(buf.buffer);
    view.setUint8(0, inode.type);
    view.setUint32(1, inode.mode, true);
    view.setFloat64(5, inode.size, true);
    view.setFloat64(13, inode.mtime, true);
    view.setFloat64(21, inode.ctime, true);
    view.setFloat64(29, inode.atime, true);
    view.setUint32(37, inode.uid, true);
    view.setUint32(41, inode.gid, true);
    view.setUint32(45, idx, true); // ino = inode index

    return { status: 0, data: buf };
  }

  // ---- MKDIR ----
  mkdir(path: string, flags: number = 0): { status: number; data: Uint8Array | null } {
    path = this.normalizePath(path);
    const recursive = (flags & 1) !== 0;

    if (recursive) {
      return this.mkdirRecursive(path);
    }

    // Check if already exists
    if (this.pathIndex.has(path)) return { status: CODE_TO_STATUS.EEXIST, data: null };

    // Ensure parent exists
    const parentStatus = this.ensureParent(path);
    if (parentStatus !== 0) return { status: parentStatus, data: null };

    const mode = DEFAULT_DIR_MODE & ~(this.umask & 0o777);
    this.createInode(path, INODE_TYPE.DIRECTORY, mode, 0);

    // Return created path as data
    const pathBytes = encoder.encode(path);
    return { status: 0, data: pathBytes };
  }

  private mkdirRecursive(path: string): { status: number; data: Uint8Array | null } {
    const parts = path.split('/').filter(Boolean);
    let current = '';
    let firstCreated: string | null = null;

    for (const part of parts) {
      current += '/' + part;

      if (this.pathIndex.has(current)) {
        const idx = this.pathIndex.get(current)!;
        const inode = this.readInode(idx);
        if (inode.type !== INODE_TYPE.DIRECTORY) {
          return { status: CODE_TO_STATUS.ENOTDIR, data: null };
        }
        continue;
      }

      const mode = DEFAULT_DIR_MODE & ~(this.umask & 0o777);
      this.createInode(current, INODE_TYPE.DIRECTORY, mode, 0);
      if (!firstCreated) firstCreated = current;
    }

    const result = firstCreated ? encoder.encode(firstCreated) : undefined;
    return { status: 0, data: result ?? null };
  }

  // ---- RMDIR ----
  rmdir(path: string, flags: number = 0): { status: number } {
    path = this.normalizePath(path);
    const recursive = (flags & 1) !== 0;
    const idx = this.pathIndex.get(path);
    if (idx === undefined) return { status: CODE_TO_STATUS.ENOENT };

    const inode = this.readInode(idx);
    if (inode.type !== INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.ENOTDIR };

    // Check for children
    const children = this.getDirectChildren(path);

    if (children.length > 0) {
      if (!recursive) return { status: CODE_TO_STATUS.ENOTEMPTY };

      // Recursive delete
      for (const child of this.getAllDescendants(path)) {
        const childIdx = this.pathIndex.get(child)!;
        const childInode = this.readInode(childIdx);
        this.freeBlockRange(childInode.firstBlock, childInode.blockCount);
        childInode.type = INODE_TYPE.FREE;
        this.writeInode(childIdx, childInode);
        this.pathIndex.delete(child);
      }
    }

    // Remove the directory itself
    inode.type = INODE_TYPE.FREE;
    this.writeInode(idx, inode);
    this.pathIndex.delete(path);

    return { status: 0 };
  }

  // ---- READDIR ----
  readdir(path: string, flags: number = 0): { status: number; data: Uint8Array | null } {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === undefined) return { status: CODE_TO_STATUS.ENOENT, data: null };

    const inode = this.readInode(idx);
    if (inode.type !== INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.ENOTDIR, data: null };

    const withFileTypes = (flags & 1) !== 0;
    const children = this.getDirectChildren(path);

    if (withFileTypes) {
      // Encode as: count(u32) + entries[name_len(u16) + name(bytes) + type(u8)]
      let totalSize = 4;
      const entries: { name: Uint8Array; type: number }[] = [];

      for (const childPath of children) {
        const name = childPath.substring(childPath.lastIndexOf('/') + 1);
        const nameBytes = encoder.encode(name);
        const childIdx = this.pathIndex.get(childPath)!;
        const childInode = this.readInode(childIdx);
        entries.push({ name: nameBytes, type: childInode.type });
        totalSize += 2 + nameBytes.byteLength + 1; // nameLen + name + type
      }

      const buf = new Uint8Array(totalSize);
      const view = new DataView(buf.buffer);
      view.setUint32(0, entries.length, true);
      let offset = 4;

      for (const entry of entries) {
        view.setUint16(offset, entry.name.byteLength, true);
        offset += 2;
        buf.set(entry.name, offset);
        offset += entry.name.byteLength;
        buf[offset++] = entry.type;
      }

      return { status: 0, data: buf };
    }

    // Simple name list: count(u32) + entries[name_len(u16) + name(bytes)]
    let totalSize = 4;
    const nameEntries: Uint8Array[] = [];

    for (const childPath of children) {
      const name = childPath.substring(childPath.lastIndexOf('/') + 1);
      const nameBytes = encoder.encode(name);
      nameEntries.push(nameBytes);
      totalSize += 2 + nameBytes.byteLength;
    }

    const buf = new Uint8Array(totalSize);
    const view = new DataView(buf.buffer);
    view.setUint32(0, nameEntries.length, true);
    let offset = 4;

    for (const nameBytes of nameEntries) {
      view.setUint16(offset, nameBytes.byteLength, true);
      offset += 2;
      buf.set(nameBytes, offset);
      offset += nameBytes.byteLength;
    }

    return { status: 0, data: buf };
  }

  // ---- RENAME ----
  rename(oldPath: string, newPath: string): { status: number } {
    oldPath = this.normalizePath(oldPath);
    newPath = this.normalizePath(newPath);

    const idx = this.pathIndex.get(oldPath);
    if (idx === undefined) return { status: CODE_TO_STATUS.ENOENT };

    // Ensure parent of new path exists
    const parentStatus = this.ensureParent(newPath);
    if (parentStatus !== 0) return { status: parentStatus };

    // If target exists, remove it
    const existingIdx = this.pathIndex.get(newPath);
    if (existingIdx !== undefined) {
      const existingInode = this.readInode(existingIdx);
      this.freeBlockRange(existingInode.firstBlock, existingInode.blockCount);
      existingInode.type = INODE_TYPE.FREE;
      this.writeInode(existingIdx, existingInode);
      this.pathIndex.delete(newPath);
    }

    // Update inode with new path
    const inode = this.readInode(idx);
    const { offset: pathOff, length: pathLen } = this.appendPath(newPath);
    inode.pathOffset = pathOff;
    inode.pathLength = pathLen;
    inode.mtime = Date.now();
    this.writeInode(idx, inode);

    // Update index
    this.pathIndex.delete(oldPath);
    this.pathIndex.set(newPath, idx);

    // If it's a directory, rename all descendants
    if (inode.type === INODE_TYPE.DIRECTORY) {
      const prefix = oldPath === '/' ? '/' : oldPath + '/';
      const toRename: [string, number][] = [];

      for (const [p, i] of this.pathIndex) {
        if (p.startsWith(prefix)) {
          toRename.push([p, i]);
        }
      }

      for (const [p, i] of toRename) {
        const suffix = p.substring(oldPath.length);
        const childNewPath = newPath + suffix;
        const childInode = this.readInode(i);
        const { offset: cpo, length: cpl } = this.appendPath(childNewPath);
        childInode.pathOffset = cpo;
        childInode.pathLength = cpl;
        this.writeInode(i, childInode);
        this.pathIndex.delete(p);
        this.pathIndex.set(childNewPath, i);
      }
    }

    return { status: 0 };
  }

  // ---- EXISTS ----
  exists(path: string): { status: number; data: Uint8Array | null } {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    const buf = new Uint8Array(1);
    buf[0] = idx !== undefined ? 1 : 0;
    return { status: 0, data: buf };
  }

  // ---- TRUNCATE ----
  truncate(path: string, len: number = 0): { status: number } {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === undefined) return { status: CODE_TO_STATUS.ENOENT };

    const inode = this.readInode(idx);
    if (inode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EISDIR };

    if (len === 0) {
      // Free all blocks
      this.freeBlockRange(inode.firstBlock, inode.blockCount);
      inode.firstBlock = 0;
      inode.blockCount = 0;
      inode.size = 0;
    } else if (len < inode.size) {
      // Shrink
      const neededBlocks = Math.ceil(len / this.blockSize);
      if (neededBlocks < inode.blockCount) {
        this.freeBlockRange(inode.firstBlock + neededBlocks, inode.blockCount - neededBlocks);
      }
      inode.blockCount = neededBlocks;
      inode.size = len;
    } else if (len > inode.size) {
      // Grow (zero-fill)
      const neededBlocks = Math.ceil(len / this.blockSize);
      if (neededBlocks > inode.blockCount) {
        // Need more blocks
        const oldData = this.readData(inode.firstBlock, inode.blockCount, inode.size);
        this.freeBlockRange(inode.firstBlock, inode.blockCount);
        const newFirst = this.allocateBlocks(neededBlocks);
        const newData = new Uint8Array(len);
        newData.set(oldData);
        // Rest is already zero-filled
        this.writeData(newFirst, newData);
        inode.firstBlock = newFirst;
      }
      inode.blockCount = neededBlocks;
      inode.size = len;
    }

    inode.mtime = Date.now();
    this.writeInode(idx, inode);

    return { status: 0 };
  }

  // ---- COPY ----
  copy(srcPath: string, destPath: string, flags: number = 0): { status: number } {
    srcPath = this.normalizePath(srcPath);
    destPath = this.normalizePath(destPath);

    const srcIdx = this.resolvePathComponents(srcPath, true);
    if (srcIdx === undefined) return { status: CODE_TO_STATUS.ENOENT };

    const srcInode = this.readInode(srcIdx);
    if (srcInode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EISDIR };

    // COPYFILE_EXCL check
    if ((flags & 1) && this.pathIndex.has(destPath)) {
      return { status: CODE_TO_STATUS.EEXIST };
    }

    // Read source data
    const data = srcInode.size > 0
      ? this.readData(srcInode.firstBlock, srcInode.blockCount, srcInode.size)
      : new Uint8Array(0);

    return this.write(destPath, data);
  }

  // ---- ACCESS ----
  access(path: string, mode: number = 0): { status: number } {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === undefined) return { status: CODE_TO_STATUS.ENOENT };

    if (mode === 0) return { status: 0 }; // F_OK — just check existence

    if (!this.strictPermissions) return { status: 0 }; // Relaxed mode

    const inode = this.readInode(idx);
    // Check permission bits against process identity
    const filePerm = this.getEffectivePermission(inode);

    if ((mode & 4) && !(filePerm & 4)) return { status: CODE_TO_STATUS.EACCES }; // R_OK
    if ((mode & 2) && !(filePerm & 2)) return { status: CODE_TO_STATUS.EACCES }; // W_OK
    if ((mode & 1) && !(filePerm & 1)) return { status: CODE_TO_STATUS.EACCES }; // X_OK

    return { status: 0 };
  }

  private getEffectivePermission(inode: Inode): number {
    const modeBits = inode.mode & 0o777;
    if (this.processUid === inode.uid) return (modeBits >>> 6) & 7;
    if (this.processGid === inode.gid) return (modeBits >>> 3) & 7;
    return modeBits & 7;
  }

  // ---- REALPATH ----
  realpath(path: string): { status: number; data: Uint8Array | null } {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === undefined) return { status: CODE_TO_STATUS.ENOENT, data: null };

    // Find the resolved path for this inode
    const inode = this.readInode(idx);
    const resolvedPath = this.readPath(inode.pathOffset, inode.pathLength);
    return { status: 0, data: encoder.encode(resolvedPath) };
  }

  // ---- CHMOD ----
  chmod(path: string, mode: number): { status: number } {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === undefined) return { status: CODE_TO_STATUS.ENOENT };

    const inode = this.readInode(idx);
    // Preserve file type bits, update permission bits
    inode.mode = (inode.mode & S_IFMT) | (mode & 0o7777);
    inode.ctime = Date.now();
    this.writeInode(idx, inode);

    return { status: 0 };
  }

  // ---- CHOWN ----
  chown(path: string, uid: number, gid: number): { status: number } {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === undefined) return { status: CODE_TO_STATUS.ENOENT };

    const inode = this.readInode(idx);
    inode.uid = uid;
    inode.gid = gid;
    inode.ctime = Date.now();
    this.writeInode(idx, inode);

    return { status: 0 };
  }

  // ---- UTIMES ----
  utimes(path: string, atime: number, mtime: number): { status: number } {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === undefined) return { status: CODE_TO_STATUS.ENOENT };

    const inode = this.readInode(idx);
    inode.atime = atime;
    inode.mtime = mtime;
    inode.ctime = Date.now();
    this.writeInode(idx, inode);

    return { status: 0 };
  }

  // ---- SYMLINK ----
  symlink(target: string, linkPath: string): { status: number } {
    linkPath = this.normalizePath(linkPath);
    if (this.pathIndex.has(linkPath)) return { status: CODE_TO_STATUS.EEXIST };

    const parentStatus = this.ensureParent(linkPath);
    if (parentStatus !== 0) return { status: parentStatus };

    const targetBytes = encoder.encode(target);
    this.createInode(linkPath, INODE_TYPE.SYMLINK, DEFAULT_SYMLINK_MODE, targetBytes.byteLength, targetBytes);

    return { status: 0 };
  }

  // ---- READLINK ----
  readlink(path: string): { status: number; data: Uint8Array | null } {
    path = this.normalizePath(path);
    const idx = this.pathIndex.get(path);
    if (idx === undefined) return { status: CODE_TO_STATUS.ENOENT, data: null };

    const inode = this.readInode(idx);
    if (inode.type !== INODE_TYPE.SYMLINK) return { status: CODE_TO_STATUS.EINVAL, data: null };

    const target = this.readData(inode.firstBlock, inode.blockCount, inode.size);
    return { status: 0, data: target };
  }

  // ---- LINK (hard link — copies the file) ----
  link(existingPath: string, newPath: string): { status: number } {
    return this.copy(existingPath, newPath);
  }

  // ---- OPEN (file descriptor) ----
  open(path: string, flags: number, tabId: string): { status: number; data: Uint8Array | null } {
    path = this.normalizePath(path);

    const hasCreate = (flags & 64) !== 0;  // O_CREAT
    const hasTrunc = (flags & 512) !== 0;   // O_TRUNC
    const hasExcl = (flags & 128) !== 0;    // O_EXCL

    let idx = this.resolvePathComponents(path, true);

    if (idx === undefined) {
      if (!hasCreate) return { status: CODE_TO_STATUS.ENOENT, data: null };
      // Create file
      const mode = DEFAULT_FILE_MODE & ~(this.umask & 0o777);
      idx = this.createInode(path, INODE_TYPE.FILE, mode, 0);
    } else if (hasExcl && hasCreate) {
      return { status: CODE_TO_STATUS.EEXIST, data: null };
    }

    if (hasTrunc) {
      this.truncate(path, 0);
    }

    const fd = this.nextFd++;
    this.fdTable.set(fd, { tabId, inodeIdx: idx, position: 0, flags });

    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, fd, true);
    return { status: 0, data: buf };
  }

  // ---- CLOSE ----
  close(fd: number): { status: number } {
    if (!this.fdTable.has(fd)) return { status: CODE_TO_STATUS.EBADF };
    this.fdTable.delete(fd);
    return { status: 0 };
  }

  // ---- FREAD ----
  fread(fd: number, length: number, position: number | null): { status: number; data: Uint8Array | null } {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF, data: null };

    const inode = this.readInode(entry.inodeIdx);
    const pos = position ?? entry.position;
    const readLen = Math.min(length, inode.size - pos);

    if (readLen <= 0) return { status: 0, data: new Uint8Array(0) };

    // Read from specific offset within the file's data blocks
    const dataOffset = this.dataOffset + inode.firstBlock * this.blockSize + pos;
    const buf = new Uint8Array(readLen);
    this.handle.read(buf, { at: dataOffset });

    // Update position
    if (position === null) {
      entry.position += readLen;
    }

    return { status: 0, data: buf };
  }

  // ---- FWRITE ----
  fwrite(fd: number, data: Uint8Array, position: number | null): { status: number; data: Uint8Array | null } {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF, data: null };

    const inode = this.readInode(entry.inodeIdx);
    const isAppend = (entry.flags & 1024) !== 0; // O_APPEND
    const pos = isAppend ? inode.size : (position ?? entry.position);
    const endPos = pos + data.byteLength;

    // Check if we need to grow
    if (endPos > inode.size) {
      const neededBlocks = Math.ceil(endPos / this.blockSize);
      if (neededBlocks > inode.blockCount) {
        // Grow — read old data, reallocate, write back
        const oldData = inode.size > 0
          ? this.readData(inode.firstBlock, inode.blockCount, inode.size)
          : new Uint8Array(0);
        this.freeBlockRange(inode.firstBlock, inode.blockCount);
        const newFirst = this.allocateBlocks(neededBlocks);
        const newBuf = new Uint8Array(endPos);
        newBuf.set(oldData);
        newBuf.set(data, pos);
        this.writeData(newFirst, newBuf);
        inode.firstBlock = newFirst;
        inode.blockCount = neededBlocks;
      } else {
        // Fits, write at position
        const dataOffset = this.dataOffset + inode.firstBlock * this.blockSize + pos;
        this.handle.write(data, { at: dataOffset });
      }
      inode.size = endPos;
    } else {
      // Write within existing bounds
      const dataOffset = this.dataOffset + inode.firstBlock * this.blockSize + pos;
      this.handle.write(data, { at: dataOffset });
    }

    inode.mtime = Date.now();
    this.writeInode(entry.inodeIdx, inode);

    // Update position
    if (position === null) {
      entry.position = endPos;
    }

    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, data.byteLength, true);
    return { status: 0, data: buf };
  }

  // ---- FSTAT ----
  fstat(fd: number): { status: number; data: Uint8Array | null } {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF, data: null };
    return this.encodeStatResponse(entry.inodeIdx);
  }

  // ---- FTRUNCATE ----
  ftruncate(fd: number, len: number = 0): { status: number } {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF };

    const inode = this.readInode(entry.inodeIdx);
    const path = this.readPath(inode.pathOffset, inode.pathLength);
    return this.truncate(path, len);
  }

  // ---- FSYNC ----
  fsync(): { status: number } {
    this.handle.flush();
    return { status: 0 };
  }

  // ---- OPENDIR ----
  opendir(path: string, tabId: string): { status: number; data: Uint8Array | null } {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === undefined) return { status: CODE_TO_STATUS.ENOENT, data: null };

    const inode = this.readInode(idx);
    if (inode.type !== INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.ENOTDIR, data: null };

    // Use fd table for dir handles too
    const fd = this.nextFd++;
    this.fdTable.set(fd, { tabId, inodeIdx: idx, position: 0, flags: 0 });

    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, fd, true);
    return { status: 0, data: buf };
  }

  // ---- MKDTEMP ----
  mkdtemp(prefix: string): { status: number; data: Uint8Array | null } {
    const suffix = Math.random().toString(36).substring(2, 8);
    const path = this.normalizePath(prefix + suffix);

    // Ensure parent directories exist
    const parentStatus = this.ensureParent(path);
    if (parentStatus !== 0) {
      // Auto-create parent directories for mkdtemp
      const parentPath = path.substring(0, path.lastIndexOf('/'));
      if (parentPath) {
        this.mkdirRecursive(parentPath);
      }
    }

    const mode = DEFAULT_DIR_MODE & ~(this.umask & 0o777);
    this.createInode(path, INODE_TYPE.DIRECTORY, mode, 0);

    return { status: 0, data: encoder.encode(path) };
  }

  // ========== Helpers ==========

  private getDirectChildren(dirPath: string): string[] {
    const prefix = dirPath === '/' ? '/' : dirPath + '/';
    const children: string[] = [];

    for (const path of this.pathIndex.keys()) {
      if (path === dirPath) continue;
      if (!path.startsWith(prefix)) continue;
      // Direct child: no more slashes after prefix
      const rest = path.substring(prefix.length);
      if (!rest.includes('/')) {
        children.push(path);
      }
    }

    return children.sort();
  }

  private getAllDescendants(dirPath: string): string[] {
    const prefix = dirPath === '/' ? '/' : dirPath + '/';
    const descendants: string[] = [];

    for (const path of this.pathIndex.keys()) {
      if (path.startsWith(prefix)) descendants.push(path);
    }

    // Sort by depth (deepest first) for safe deletion
    return descendants.sort((a, b) => {
      const da = a.split('/').length;
      const db = b.split('/').length;
      return db - da;
    });
  }

  private ensureParent(path: string): number {
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash <= 0) return 0; // Parent is root, always exists

    const parentPath = path.substring(0, lastSlash);
    const parentIdx = this.pathIndex.get(parentPath);
    if (parentIdx === undefined) return CODE_TO_STATUS.ENOENT;

    const parentInode = this.readInode(parentIdx);
    if (parentInode.type !== INODE_TYPE.DIRECTORY) return CODE_TO_STATUS.ENOTDIR;

    return 0;
  }

  /** Clean up all fds owned by a tab */
  cleanupTab(tabId: string): void {
    for (const [fd, entry] of this.fdTable) {
      if (entry.tabId === tabId) {
        this.fdTable.delete(fd);
      }
    }
  }

  /** Get all file paths and their data for OPFS sync */
  getAllFiles(): { path: string; idx: number }[] {
    const files: { path: string; idx: number }[] = [];
    for (const [path, idx] of this.pathIndex) {
      files.push({ path, idx });
    }
    return files;
  }

  /** Get file data by inode index */
  getInodeData(idx: number): { type: number; data: Uint8Array; mtime: number } {
    const inode = this.readInode(idx);
    const data = inode.size > 0
      ? this.readData(inode.firstBlock, inode.blockCount, inode.size)
      : new Uint8Array(0);
    return { type: inode.type, data, mtime: inode.mtime };
  }

  flush(): void {
    this.handle.flush();
  }
}
