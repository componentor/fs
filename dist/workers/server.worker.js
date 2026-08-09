// src/vfs/layout.ts
var VFS_MAGIC = 1447449377;
var VFS_VERSION = 1;
var DEFAULT_BLOCK_SIZE = 4096;
var DEFAULT_INODE_COUNT = 1e5;
var INODE_SIZE = 64;
var SUPERBLOCK = {
  SIZE: 64,
  MAGIC: 0,
  // uint32 - 0x56465321
  VERSION: 4,
  // uint32
  INODE_COUNT: 8,
  // uint32 - total inodes allocated
  BLOCK_SIZE: 12,
  // uint32 - data block size (default 4096)
  TOTAL_BLOCKS: 16,
  // uint32 - total data blocks
  FREE_BLOCKS: 20,
  // uint32 - available data blocks
  INODE_OFFSET: 24,
  // float64 - byte offset to inode table
  PATH_OFFSET: 32,
  // float64 - byte offset to path table
  DATA_OFFSET: 40,
  // float64 - byte offset to data region
  BITMAP_OFFSET: 48,
  // float64 - byte offset to free block bitmap
  PATH_USED: 56,
  // uint32 - bytes used in path table
  CRC32: 60
  // uint32 - CRC-32 of superblock bytes 0..59.
  //   0 = legacy file written before checksumming existed
  //   (validation skipped; upgraded on next superblock write).
};
var INODE = {
  TYPE: 0,
  // uint8 - 0=free, 1=file, 2=directory, 3=symlink
  FLAGS: 1,
  // uint8[3] - reserved
  PATH_OFFSET: 4,
  // uint32 - byte offset into path table
  PATH_LENGTH: 8,
  // uint16 - length of path string
  NLINK: 10,
  // uint16 - hard link count
  MODE: 12,
  // uint32 - permissions (e.g. 0o100644)
  SIZE: 16,
  // float64 - file content size in bytes (using f64 for >4GB)
  FIRST_BLOCK: 24,
  // uint32 - index of first data block
  BLOCK_COUNT: 28,
  // uint32 - number of contiguous data blocks
  MTIME: 32,
  // float64 - last modification time (ms since epoch)
  CTIME: 40,
  // float64 - creation/change time (ms since epoch)
  ATIME: 48,
  // float64 - last access time (ms since epoch)
  UID: 56,
  // uint32 - owner
  GID: 60
  // uint32 - group
};
var INODE_TYPE = {
  FREE: 0,
  FILE: 1,
  DIRECTORY: 2,
  SYMLINK: 3
};
var DEFAULT_FILE_MODE = 33188;
var DEFAULT_DIR_MODE = 16877;
var DEFAULT_SYMLINK_MODE = 41471;
var DEFAULT_UMASK = 18;
var S_IFMT = 61440;
var S_IFREG = 32768;
var S_IFDIR = 16384;
var MAX_SYMLINK_DEPTH = 40;
var INITIAL_PATH_TABLE_SIZE = 256 * 1024;
var INITIAL_DATA_BLOCKS = 1024;
var MAX_DATA_BLOCKS = 4e6;
function calculateLayout(inodeCount = DEFAULT_INODE_COUNT, blockSize = DEFAULT_BLOCK_SIZE, totalBlocks = INITIAL_DATA_BLOCKS, maxBlocks = MAX_DATA_BLOCKS) {
  const inodeTableOffset = SUPERBLOCK.SIZE;
  const inodeTableSize = inodeCount * INODE_SIZE;
  const pathTableOffset = inodeTableOffset + inodeTableSize;
  const pathTableSize = INITIAL_PATH_TABLE_SIZE;
  const bitmapOffset = pathTableOffset + pathTableSize;
  const bitmapRegionSize = Math.ceil(maxBlocks / 8);
  const bitmapSize = Math.ceil(totalBlocks / 8);
  const dataOffset = Math.ceil((bitmapOffset + bitmapRegionSize) / blockSize) * blockSize;
  const totalSize = dataOffset + totalBlocks * blockSize;
  return {
    inodeTableOffset,
    inodeTableSize,
    pathTableOffset,
    pathTableSize,
    bitmapOffset,
    bitmapSize,
    bitmapRegionSize,
    dataOffset,
    totalSize,
    totalBlocks
  };
}

// src/vfs/crc32.ts
var TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();
function crc32(bytes, start = 0, end = bytes.byteLength) {
  let crc = 4294967295;
  for (let i = start; i < end; i++) {
    crc = TABLE[(crc ^ bytes[i]) & 255] ^ crc >>> 8;
  }
  return (crc ^ 4294967295) >>> 0;
}

// src/errors.ts
var CODE_TO_STATUS = {
  OK: 0,
  ENOENT: 1,
  EEXIST: 2,
  EISDIR: 3,
  ENOTDIR: 4,
  ENOTEMPTY: 5,
  EACCES: 6,
  EINVAL: 7,
  EBADF: 8,
  ELOOP: 9,
  ENOSPC: 10,
  EIO: 11,
  ENOTSUP: 12
};

// src/vfs/engine.ts
var encoder = new TextEncoder();
var PREGROW_HEADROOM_BLOCKS = 16384;
var decoder = new TextDecoder();
var VFSEngine = class _VFSEngine {
  handle;
  pathIndex = /* @__PURE__ */ new Map();
  // path → inode index
  inodeCount = 0;
  blockSize = DEFAULT_BLOCK_SIZE;
  totalBlocks = 0;
  freeBlocks = 0;
  inodeTableOffset = 0;
  pathTableOffset = 0;
  pathTableUsed = 0;
  pathTableSize = 0;
  bitmapOffset = 0;
  dataOffset = 0;
  umask = DEFAULT_UMASK;
  processUid = 0;
  processGid = 0;
  strictPermissions = false;
  debug = false;
  // File descriptor table
  fdTable = /* @__PURE__ */ new Map();
  nextFd = 3;
  // 0=stdin, 1=stdout, 2=stderr reserved
  /**
   * Whether an fd's open flags permit reading / writing.
   *
   * The low two bits of the flags are the access mode (O_RDONLY=0, O_WRONLY=1, O_RDWR=2). These
   * were not enforced: reading from a descriptor opened `'w'` returned 0 bytes instead of EBADF,
   * and writing through one opened `'r'` succeeded. Both are errors in Node, and code that
   * relies on the error to detect a mis-opened file saw silence instead. Found by the fd fuzzer.
   */
  static isReadable(flags) {
    const mode = flags & 3;
    return mode === 0 || mode === 2;
  }
  static isWritable(flags) {
    const mode = flags & 3;
    return mode === 1 || mode === 2;
  }
  // Reusable buffers to avoid allocations
  inodeBuf = new Uint8Array(INODE_SIZE);
  inodeView = new DataView(this.inodeBuf.buffer);
  // In-memory inode cache — eliminates disk reads for hot inodes
  inodeCache = /* @__PURE__ */ new Map();
  superblockBuf = new Uint8Array(SUPERBLOCK.SIZE);
  superblockView = new DataView(this.superblockBuf.buffer);
  // In-memory bitmap cache — eliminates bitmap reads from OPFS
  bitmap = null;
  bitmapDirtyLo = Infinity;
  // lowest dirty byte index
  bitmapDirtyHi = -1;
  // highest dirty byte index (inclusive)
  superblockDirty = false;
  // Free inode hint — skip O(n) scan
  freeInodeHint = 0;
  // Implicit directory support — tracks all directory prefixes implied by file paths.
  // Rebuilt lazily when pathIndex changes (tracked via generation counter).
  // Map value is the stable timestamp (ms since epoch) assigned when the implicit
  // dir was first discovered, so that stat() returns consistent mtime/ctime/atime
  // across repeated calls.
  implicitDirs = /* @__PURE__ */ new Map();
  implicitDirsGen = -1;
  // generation when implicitDirs was last rebuilt
  pathIndexGen = 0;
  // bumped on every pathIndex mutation
  // Incrementally maintained "number of pathIndex entries that have this
  // path as a strict ancestor" map. Lets `isImplicitDirectory` answer in
  // O(1) — an implicit dir P is exactly !pathIndex.has(P) && descCount[P] > 0.
  // Without this, every `isImplicitDirectory` call triggered an O(N×depth)
  // rebuild of `implicitDirs`, and the 3.0.49 fix put one of those calls on
  // the hot path of every fresh write/symlink/link/copy — making batch
  // writes O(N²) on total path count.
  descCount = /* @__PURE__ */ new Map();
  // descCount is in sync with pathIndex iff descCountGen >= pathIndexGen.
  // Helpers `setPathIndex`/`deletePathIndex` keep them in sync. Code that
  // mutates `pathIndex` directly (only test scaffolding does this in
  // practice — see the implicit-directory tests in vfs-engine.test.ts)
  // bumps `pathIndexGen` without going through the helpers, which leaves
  // descCount stale; `isImplicitDirectory` notices the mismatch and
  // recomputes descCount on demand.
  descCountGen = 0;
  // Incrementally maintained directory-children index: parent dir path →
  // (child name → number of pathIndex entries whose path passes through
  // parent/name). Lets getDirectChildren / getDirectChildrenWithImplicit
  // answer in O(children) instead of scanning every path in the volume,
  // which made readdir and directory-stat O(total files) per call.
  // A child name with refcount > 0 but no pathIndex entry of its own is an
  // implicit directory. Same staleness contract as descCount: in sync iff
  // childIndexGen >= pathIndexGen, rebuilt from scratch on demand when test
  // scaffolding mutates pathIndex directly.
  childIndex = /* @__PURE__ */ new Map();
  childIndexGen = 0;
  /** Where the next block search resumes — see allocateBlocks. Reset on mount/format. */
  allocCursor = 0;
  /**
   * Set when path resolution gave up because a symlink chain exceeded MAX_SYMLINK_DEPTH.
   *
   * The resolvers return `undefined` for both "not there" and "went in circles", which every
   * caller then reported as ENOENT — so a symlink pointing at itself looked like a missing file
   * instead of the ELOOP Node reports. Reset at the start of every top-level resolve and read
   * immediately after, via `resolveFailureStatus`.
   */
  symlinkLoopDetected = false;
  /** ENOENT, or ELOOP when the last resolve gave up on a symlink cycle. */
  resolveFailureStatus() {
    return this.symlinkLoopDetected ? CODE_TO_STATUS.ELOOP : CODE_TO_STATUS.ENOENT;
  }
  // Configurable upper bounds
  maxInodes = 4e6;
  // Default ceiling on data blocks. The on-disk bitmap region is reserved for
  // this many blocks at format time (see calculateLayout), so the effective
  // limit and the reserved bitmap capacity stay in lock-step. Sourced from the
  // shared layout constant so both agree.
  maxBlocks = MAX_DATA_BLOCKS;
  maxPathTable = 256 * 1024 * 1024;
  // 256MB
  maxVFSSize = 100 * 1024 * 1024 * 1024;
  // 100GB
  init(handle, opts) {
    this.handle = handle;
    this.processUid = opts?.uid ?? 0;
    this.processGid = opts?.gid ?? 0;
    this.umask = opts?.umask ?? DEFAULT_UMASK;
    this.strictPermissions = opts?.strictPermissions ?? false;
    this.debug = opts?.debug ?? false;
    if (opts?.limits) {
      if (opts.limits.maxInodes != null) this.maxInodes = opts.limits.maxInodes;
      if (opts.limits.maxBlocks != null) this.maxBlocks = opts.limits.maxBlocks;
      if (opts.limits.maxPathTable != null) this.maxPathTable = opts.limits.maxPathTable;
      if (opts.limits.maxVFSSize != null) this.maxVFSSize = opts.limits.maxVFSSize;
    }
    const size = handle.getSize();
    if (size === 0) {
      this.format();
    } else {
      try {
        this.mount();
      } catch (err) {
        const msg = err.message ?? String(err);
        if (msg.startsWith("Corrupt VFS:")) throw err;
        throw new Error(`Corrupt VFS: ${msg}`);
      }
    }
  }
  /** Release the sync access handle (call on fatal error or shutdown) */
  closeHandle() {
    try {
      this.handle?.close();
    } catch (_) {
    }
  }
  /** Format a fresh VFS */
  format() {
    const layout = calculateLayout(DEFAULT_INODE_COUNT, DEFAULT_BLOCK_SIZE, INITIAL_DATA_BLOCKS, this.maxBlocks);
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
    this.handle.truncate(layout.totalSize);
    this.writeSuperblock();
    const zeroBuf = new Uint8Array(layout.inodeTableSize);
    this.handle.write(zeroBuf, { at: this.inodeTableOffset });
    this.bitmap = new Uint8Array(layout.bitmapSize);
    this.handle.write(this.bitmap, { at: this.bitmapOffset });
    this.createInode("/", INODE_TYPE.DIRECTORY, DEFAULT_DIR_MODE, 0);
    this.writeSuperblock();
    this.handle.flush();
  }
  /** Mount an existing VFS from disk — validates superblock integrity */
  mount() {
    const fileSize = this.handle.getSize();
    if (fileSize < SUPERBLOCK.SIZE) {
      throw new Error(`Corrupt VFS: file too small (${fileSize} bytes, need at least ${SUPERBLOCK.SIZE})`);
    }
    this.handle.read(this.superblockBuf, { at: 0 });
    const v = this.superblockView;
    const magic = v.getUint32(SUPERBLOCK.MAGIC, true);
    if (magic !== VFS_MAGIC) {
      throw new Error(`Corrupt VFS: bad magic 0x${magic.toString(16)} (expected 0x${VFS_MAGIC.toString(16)})`);
    }
    const version = v.getUint32(SUPERBLOCK.VERSION, true);
    if (version !== VFS_VERSION) {
      throw new Error(`Corrupt VFS: unsupported version ${version} (expected ${VFS_VERSION})`);
    }
    const storedCrc = v.getUint32(SUPERBLOCK.CRC32, true);
    if (storedCrc !== 0) {
      const computedCrc = crc32(this.superblockBuf, 0, SUPERBLOCK.CRC32);
      if (computedCrc !== storedCrc) {
        throw new Error(
          `Corrupt VFS: superblock checksum mismatch (stored 0x${storedCrc.toString(16)}, computed 0x${computedCrc.toString(16)})`
        );
      }
    }
    const inodeCount = v.getUint32(SUPERBLOCK.INODE_COUNT, true);
    const blockSize = v.getUint32(SUPERBLOCK.BLOCK_SIZE, true);
    const totalBlocks = v.getUint32(SUPERBLOCK.TOTAL_BLOCKS, true);
    const freeBlocks = v.getUint32(SUPERBLOCK.FREE_BLOCKS, true);
    const inodeTableOffset = v.getFloat64(SUPERBLOCK.INODE_OFFSET, true);
    const pathTableOffset = v.getFloat64(SUPERBLOCK.PATH_OFFSET, true);
    const dataOffset = v.getFloat64(SUPERBLOCK.DATA_OFFSET, true);
    const bitmapOffset = v.getFloat64(SUPERBLOCK.BITMAP_OFFSET, true);
    const pathUsed = v.getUint32(SUPERBLOCK.PATH_USED, true);
    if (blockSize === 0 || (blockSize & blockSize - 1) !== 0) {
      throw new Error(`Corrupt VFS: invalid block size ${blockSize} (must be power of 2)`);
    }
    if (inodeCount === 0) {
      throw new Error("Corrupt VFS: inode count is 0");
    }
    if (freeBlocks > totalBlocks) {
      throw new Error(`Corrupt VFS: free blocks (${freeBlocks}) exceeds total blocks (${totalBlocks})`);
    }
    if (inodeCount > this.maxInodes) {
      throw new Error(`Corrupt VFS: inode count ${inodeCount} exceeds maximum ${this.maxInodes}`);
    }
    if (totalBlocks > this.maxBlocks) {
      throw new Error(`Corrupt VFS: total blocks ${totalBlocks} exceeds maximum ${this.maxBlocks}`);
    }
    if (fileSize > this.maxVFSSize) {
      throw new Error(`Corrupt VFS: file size ${fileSize} exceeds maximum ${this.maxVFSSize}`);
    }
    if (!Number.isFinite(inodeTableOffset) || inodeTableOffset < 0 || !Number.isFinite(pathTableOffset) || pathTableOffset < 0 || !Number.isFinite(bitmapOffset) || bitmapOffset < 0 || !Number.isFinite(dataOffset) || dataOffset < 0) {
      throw new Error(`Corrupt VFS: non-finite or negative section offset`);
    }
    if (inodeTableOffset !== SUPERBLOCK.SIZE) {
      throw new Error(`Corrupt VFS: inode table offset ${inodeTableOffset} (expected ${SUPERBLOCK.SIZE})`);
    }
    const expectedPathOffset = inodeTableOffset + inodeCount * INODE_SIZE;
    if (pathTableOffset !== expectedPathOffset) {
      throw new Error(`Corrupt VFS: path table offset ${pathTableOffset} (expected ${expectedPathOffset})`);
    }
    if (bitmapOffset <= pathTableOffset) {
      throw new Error(`Corrupt VFS: bitmap offset ${bitmapOffset} must be after path table ${pathTableOffset}`);
    }
    if (dataOffset <= bitmapOffset) {
      throw new Error(`Corrupt VFS: data offset ${dataOffset} must be after bitmap ${bitmapOffset}`);
    }
    if (totalBlocks > (dataOffset - bitmapOffset) * 8) {
      throw new Error(`Corrupt VFS: total blocks (${totalBlocks}) exceed bitmap region capacity (${(dataOffset - bitmapOffset) * 8})`);
    }
    const pathTableSize = bitmapOffset - pathTableOffset;
    if (pathUsed > pathTableSize) {
      throw new Error(`Corrupt VFS: path used (${pathUsed}) exceeds path table size (${pathTableSize})`);
    }
    if (pathTableSize > this.maxPathTable) {
      throw new Error(`Corrupt VFS: path table size ${pathTableSize} exceeds maximum ${this.maxPathTable}`);
    }
    const expectedMinSize = dataOffset + totalBlocks * blockSize;
    if (expectedMinSize > this.maxVFSSize) {
      throw new Error(`Corrupt VFS: computed layout size ${expectedMinSize} exceeds maximum ${this.maxVFSSize}`);
    }
    if (fileSize < expectedMinSize) {
      throw new Error(`Corrupt VFS: file size ${fileSize} too small for layout (need ${expectedMinSize})`);
    }
    this.inodeCount = inodeCount;
    this.blockSize = blockSize;
    this.totalBlocks = totalBlocks;
    this.freeBlocks = freeBlocks;
    this.inodeTableOffset = inodeTableOffset;
    this.pathTableOffset = pathTableOffset;
    this.dataOffset = dataOffset;
    this.bitmapOffset = bitmapOffset;
    this.pathTableUsed = pathUsed;
    this.pathTableSize = pathTableSize;
    const bitmapSize = Math.ceil(this.totalBlocks / 8);
    this.bitmap = new Uint8Array(bitmapSize);
    this.handle.read(this.bitmap, { at: this.bitmapOffset });
    this.rebuildIndex();
    if (!this.pathIndex.has("/")) {
      throw new Error('Corrupt VFS: root directory "/" not found in inode table');
    }
  }
  writeSuperblock() {
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
    v.setUint32(SUPERBLOCK.CRC32, crc32(this.superblockBuf, 0, SUPERBLOCK.CRC32), true);
    this.handle.write(this.superblockBuf, { at: 0 });
  }
  /** Flush pending bitmap and superblock writes to disk (one write each) */
  markBitmapDirty(lo, hi) {
    if (lo < this.bitmapDirtyLo) this.bitmapDirtyLo = lo;
    if (hi > this.bitmapDirtyHi) this.bitmapDirtyHi = hi;
  }
  commitPending() {
    if (this.blocksFreedsinceTrim) {
      this.trimTrailingBlocks();
      this.blocksFreedsinceTrim = false;
    }
    if (this.bitmapDirtyHi >= 0) {
      const lo = this.bitmapDirtyLo;
      const hi = this.bitmapDirtyHi;
      this.handle.write(this.bitmap.subarray(lo, hi + 1), { at: this.bitmapOffset + lo });
      this.bitmapDirtyLo = Infinity;
      this.bitmapDirtyHi = -1;
    }
    if (this.superblockDirty) {
      this.writeSuperblock();
      this.superblockDirty = false;
    }
  }
  /** Find the last used block index (-1 if the data region is empty). */
  findLastUsedBlock() {
    const bitmap = this.bitmap;
    for (let byteIdx = Math.ceil(this.totalBlocks / 8) - 1; byteIdx >= 0; byteIdx--) {
      if (bitmap[byteIdx] !== 0) {
        for (let bit = 7; bit >= 0; bit--) {
          const blockIdx = byteIdx * 8 + bit;
          if (blockIdx < this.totalBlocks && bitmap[byteIdx] & 1 << bit) {
            return blockIdx;
          }
        }
      }
    }
    return -1;
  }
  /** Shrink the OPFS file by removing trailing free blocks from the data region.
   *  Keeps PREGROW_HEADROOM_BLOCKS of free tail (see maybePreGrow) so trim and
   *  idle pre-growth don't oscillate — each truncate is a storage-IPC round
   *  trip that can stall badly on WebKit while a sync caller spins. */
  trimTrailingBlocks() {
    const lastUsed = this.findLastUsedBlock();
    const newTotal = Math.max(lastUsed + 1 + PREGROW_HEADROOM_BLOCKS, INITIAL_DATA_BLOCKS);
    if (newTotal >= this.totalBlocks) return;
    this.handle.truncate(this.dataOffset + newTotal * this.blockSize);
    const newBitmapSize = Math.ceil(newTotal / 8);
    this.bitmap = this.bitmap.slice(0, newBitmapSize);
    const trimmed = this.totalBlocks - newTotal;
    this.freeBlocks -= trimmed;
    this.totalBlocks = newTotal;
    this.superblockDirty = true;
    this.bitmapDirtyLo = 0;
    this.bitmapDirtyHi = newBitmapSize - 1;
  }
  // Throttle for maybePreGrow's tail scan (cheap, but no need to run it
  // thousands of times per second from the dispatch loop's idle phase).
  lastPreGrowCheck = 0;
  /**
   * Idle-time data-region pre-growth — call from the dispatch loop when no
   * request is pending.
   *
   * Growing the VFS file (`handle.truncate`) is the one engine operation
   * that can block on a storage-IPC round trip for ~20 seconds on WebKit
   * while a sync caller busy-spins the page's main thread (observed:
   * FWRITE engine time of exactly ~20s when allocation landed on a growth
   * boundary). Growing during idle — when nobody is spinning — takes
   * milliseconds. This keeps PREGROW_HEADROOM_BLOCKS of CONTIGUOUS trailing
   * free space (allocation is contiguous, so scattered free blocks don't
   * prevent an in-request growth), so request-path growth only happens for
   * single writes larger than the headroom.
   *
   * Returns true if the file was grown.
   */
  maybePreGrow(force = false) {
    if (!this.bitmap) return false;
    const now = Date.now();
    if (!force && now - this.lastPreGrowCheck < 250) return false;
    this.lastPreGrowCheck = now;
    const trailingFree = this.totalBlocks - (this.findLastUsedBlock() + 1);
    if (trailingFree >= PREGROW_HEADROOM_BLOCKS) return false;
    const hardCap = Math.min(this.maxBlocks, this.bitmapCapacityBlocks());
    const wanted = Math.ceil((PREGROW_HEADROOM_BLOCKS - trailingFree) / 8) * 8;
    const addedBlocks = Math.min(wanted, hardCap - this.totalBlocks);
    if (addedBlocks <= 0) return false;
    const newTotal = this.totalBlocks + addedBlocks;
    this.handle.truncate(this.dataOffset + newTotal * this.blockSize);
    const newBitmapSize = Math.ceil(newTotal / 8);
    if (newBitmapSize > this.bitmap.byteLength) {
      const newBitmap = new Uint8Array(newBitmapSize);
      newBitmap.set(this.bitmap);
      this.bitmap = newBitmap;
    }
    this.totalBlocks = newTotal;
    this.freeBlocks += addedBlocks;
    this.superblockDirty = true;
    this.commitPending();
    return true;
  }
  /** Rebuild in-memory path→inode index from disk.
   *  Bulk-reads the entire inode table + path table in 2 I/O calls,
   *  then parses in memory (avoids 10k+ individual reads). */
  rebuildIndex() {
    this.pathIndex.clear();
    this.inodeCache.clear();
    const inodeTableSize = this.inodeCount * INODE_SIZE;
    const inodeBuf = new Uint8Array(inodeTableSize);
    this.handle.read(inodeBuf, { at: this.inodeTableOffset });
    const inodeView = new DataView(inodeBuf.buffer);
    const pathBuf = this.pathTableUsed > 0 ? new Uint8Array(this.pathTableUsed) : null;
    if (pathBuf) {
      this.handle.read(pathBuf, { at: this.pathTableOffset });
    }
    for (let i = 0; i < this.inodeCount; i++) {
      const off = i * INODE_SIZE;
      const type = inodeView.getUint8(off + INODE.TYPE);
      if (type === INODE_TYPE.FREE) continue;
      if (type < INODE_TYPE.FILE || type > INODE_TYPE.SYMLINK) {
        throw new Error(`Corrupt VFS: inode ${i} has invalid type ${type}`);
      }
      const pathOffset = inodeView.getUint32(off + INODE.PATH_OFFSET, true);
      const pathLength = inodeView.getUint16(off + INODE.PATH_LENGTH, true);
      const size = inodeView.getFloat64(off + INODE.SIZE, true);
      const firstBlock = inodeView.getUint32(off + INODE.FIRST_BLOCK, true);
      const blockCount = inodeView.getUint32(off + INODE.BLOCK_COUNT, true);
      if (pathLength === 0 || pathOffset + pathLength > this.pathTableUsed) {
        throw new Error(`Corrupt VFS: inode ${i} path out of bounds (offset=${pathOffset}, len=${pathLength}, tableUsed=${this.pathTableUsed})`);
      }
      if (type !== INODE_TYPE.DIRECTORY) {
        if (size < 0 || !isFinite(size)) {
          throw new Error(`Corrupt VFS: inode ${i} has invalid size ${size}`);
        }
        if (blockCount > 0 && firstBlock + blockCount > this.totalBlocks) {
          throw new Error(`Corrupt VFS: inode ${i} data blocks out of range (first=${firstBlock}, count=${blockCount}, total=${this.totalBlocks})`);
        }
      }
      const inode = {
        type,
        pathOffset,
        pathLength,
        nlink: inodeView.getUint16(off + INODE.NLINK, true) || 1,
        mode: inodeView.getUint32(off + INODE.MODE, true),
        size,
        firstBlock,
        blockCount,
        mtime: inodeView.getFloat64(off + INODE.MTIME, true),
        ctime: inodeView.getFloat64(off + INODE.CTIME, true),
        atime: inodeView.getFloat64(off + INODE.ATIME, true),
        uid: inodeView.getUint32(off + INODE.UID, true),
        gid: inodeView.getUint32(off + INODE.GID, true)
      };
      this.inodeCache.set(i, inode);
      let path;
      if (pathBuf) {
        path = decoder.decode(pathBuf.subarray(inode.pathOffset, inode.pathOffset + inode.pathLength));
      } else {
        path = this.readPath(inode.pathOffset, inode.pathLength);
      }
      if (!path.startsWith("/") || path.includes("\0")) {
        throw new Error(`Corrupt VFS: inode ${i} has invalid path "${path.substring(0, 50)}"`);
      }
      this.setPathIndex(path, i);
    }
    this.pathIndexGen++;
  }
  // ========== Low-level inode I/O ==========
  readInode(idx) {
    const cached = this.inodeCache.get(idx);
    if (cached) return cached;
    const offset = this.inodeTableOffset + idx * INODE_SIZE;
    this.handle.read(this.inodeBuf, { at: offset });
    const v = this.inodeView;
    const inode = {
      type: v.getUint8(INODE.TYPE),
      pathOffset: v.getUint32(INODE.PATH_OFFSET, true),
      pathLength: v.getUint16(INODE.PATH_LENGTH, true),
      nlink: v.getUint16(INODE.NLINK, true) || 1,
      mode: v.getUint32(INODE.MODE, true),
      size: v.getFloat64(INODE.SIZE, true),
      firstBlock: v.getUint32(INODE.FIRST_BLOCK, true),
      blockCount: v.getUint32(INODE.BLOCK_COUNT, true),
      mtime: v.getFloat64(INODE.MTIME, true),
      ctime: v.getFloat64(INODE.CTIME, true),
      atime: v.getFloat64(INODE.ATIME, true),
      uid: v.getUint32(INODE.UID, true),
      gid: v.getUint32(INODE.GID, true)
    };
    this.inodeCache.set(idx, inode);
    return inode;
  }
  writeInode(idx, inode) {
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
    v.setUint16(INODE.NLINK, inode.nlink, true);
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
  readPath(offset, length) {
    const buf = new Uint8Array(length);
    this.handle.read(buf, { at: this.pathTableOffset + offset });
    return decoder.decode(buf);
  }
  appendPath(path) {
    const bytes = encoder.encode(path);
    const offset = this.pathTableUsed;
    if (offset + bytes.byteLength > this.pathTableSize) {
      this.growPathTable(offset + bytes.byteLength);
    }
    this.handle.write(bytes, { at: this.pathTableOffset + offset });
    this.pathTableUsed += bytes.byteLength;
    this.superblockDirty = true;
    return { offset, length: bytes.byteLength };
  }
  growPathTable(needed) {
    const newSize = Math.max(this.pathTableSize * 2, needed + INITIAL_PATH_TABLE_SIZE);
    const growth = newSize - this.pathTableSize;
    const newTotalSize = this.handle.getSize() + growth;
    this.handle.truncate(newTotalSize);
    const dataSize = this.totalBlocks * this.blockSize;
    const CHUNK = 4 * 1024 * 1024;
    const scratch = new Uint8Array(Math.min(CHUNK, Math.max(dataSize, 1)));
    let remaining = dataSize;
    while (remaining > 0) {
      const chunk = Math.min(remaining, CHUNK);
      const srcAt = this.dataOffset + (remaining - chunk);
      const dstAt = this.dataOffset + growth + (remaining - chunk);
      const slice = chunk < scratch.length ? scratch.subarray(0, chunk) : scratch;
      this.handle.read(slice, { at: srcAt });
      this.handle.write(slice, { at: dstAt });
      remaining -= chunk;
    }
    const newBitmapOffset = this.bitmapOffset + growth;
    const newDataOffset = this.dataOffset + growth;
    this.handle.write(this.bitmap, { at: newBitmapOffset });
    this.pathTableSize = newSize;
    this.bitmapOffset = newBitmapOffset;
    this.dataOffset = newDataOffset;
    this.superblockDirty = true;
  }
  // ========== Bitmap I/O ==========
  // Write `length` zero bytes at absolute file offset `at` via a small
  // reusable scratch buffer. Used to materialize POSIX "holes" when a
  // write starts past the current file size — those bytes must read as
  // zeros rather than whatever stale data happened to live in the
  // underlying storage blocks.
  zeroFileRange(at, length) {
    if (length <= 0) return;
    const CHUNK = 4 * 1024 * 1024;
    const zeros = new Uint8Array(Math.min(length, CHUNK));
    let written = 0;
    while (written < length) {
      const n = Math.min(CHUNK, length - written);
      const slice = n < zeros.length ? zeros.subarray(0, n) : zeros;
      this.handle.write(slice, { at: at + written });
      written += n;
    }
  }
  /**
   * Find and reserve `count` contiguous free blocks.
   *
   * Next-fit: the search resumes where the last allocation ended and wraps once, rather than
   * restarting at block 0 every time. Restarting meant each allocation first walked past every
   * block already in use, so creating files into a filling volume cost O(allocated) each and
   * O(n²) overall — measured at 8 µs per create on an empty volume rising to 16 µs by 16k files.
   * With a cursor, sequential allocation is O(count).
   *
   * Wrapping preserves the old guarantee that the volume only grows when no contiguous run
   * exists anywhere: the second pass covers everything below the cursor, extended by `count - 1`
   * so a run straddling the cursor is still found.
   */
  allocateBlocks(count) {
    if (count === 0) return 0;
    let start = this.scanForRun(this.allocCursor, this.totalBlocks, count);
    if (start < 0 && this.allocCursor > 0) {
      const wrapEnd = Math.min(this.allocCursor + count - 1, this.totalBlocks);
      start = this.scanForRun(0, wrapEnd, count);
    }
    if (start < 0) return this.growAndAllocate(count);
    const end = start + count - 1;
    const bitmap = this.bitmap;
    for (let j = start; j <= end; j++) bitmap[j >>> 3] |= 1 << (j & 7);
    this.markBitmapDirty(start >>> 3, end >>> 3);
    this.freeBlocks -= count;
    this.superblockDirty = true;
    this.allocCursor = end + 1 >= this.totalBlocks ? 0 : end + 1;
    return start;
  }
  /**
   * First index in [from, to) starting a run of `count` free blocks, or -1.
   *
   * Fully-allocated bytes are skipped eight blocks at a time. That matters on a filling volume,
   * where the overwhelming majority of the bitmap the scan crosses is solid 0xFF.
   */
  scanForRun(from, to, count) {
    const bitmap = this.bitmap;
    let run = 0;
    let start = from;
    for (let i = from; i < to; i++) {
      if (run === 0 && (i & 7) === 0 && bitmap[i >>> 3] === 255) {
        i += 7;
        start = i + 1;
        continue;
      }
      if (bitmap[i >>> 3] >>> (i & 7) & 1) {
        run = 0;
        start = i + 1;
      } else if (++run === count) {
        return start;
      }
    }
    return -1;
  }
  /** Highest block count the reserved on-disk bitmap region can represent.
   *  The bitmap lives in [bitmapOffset, dataOffset); each byte covers 8 blocks.
   *  Growing past this would write bitmap bytes into the data region (silent
   *  corruption) — the bug fixed by reserving the region for maxBlocks at
   *  format. This is the authoritative ceiling for any layout, new or legacy. */
  bitmapCapacityBlocks() {
    return (this.dataOffset - this.bitmapOffset) * 8;
  }
  growAndAllocate(count) {
    const oldTotal = this.totalBlocks;
    const hardCap = Math.min(this.maxBlocks, this.bitmapCapacityBlocks());
    let newTotal = Math.max(oldTotal * 2, oldTotal + count);
    if (newTotal > hardCap) newTotal = hardCap;
    if (newTotal < oldTotal + count) {
      throw new Error(`ENOSPC: cannot allocate ${count} blocks (total ${oldTotal}, ceiling ${hardCap})`);
    }
    const addedBlocks = newTotal - oldTotal;
    const newFileSize = this.dataOffset + newTotal * this.blockSize;
    this.handle.truncate(newFileSize);
    const newBitmapSize = Math.ceil(newTotal / 8);
    const newBitmap = new Uint8Array(newBitmapSize);
    newBitmap.set(this.bitmap);
    this.bitmap = newBitmap;
    this.totalBlocks = newTotal;
    this.freeBlocks += addedBlocks;
    const start = oldTotal;
    for (let j = start; j < start + count; j++) {
      const bj = j >>> 3;
      const bi = j & 7;
      this.bitmap[bj] |= 1 << bi;
    }
    this.markBitmapDirty(start >>> 3, start + count - 1 >>> 3);
    this.freeBlocks -= count;
    this.superblockDirty = true;
    return start;
  }
  blocksFreedsinceTrim = false;
  freeBlockRange(start, count) {
    if (count === 0) return;
    const bitmap = this.bitmap;
    for (let i = start; i < start + count; i++) {
      const byteIdx = i >>> 3;
      const bitIdx = i & 7;
      bitmap[byteIdx] &= ~(1 << bitIdx);
    }
    this.markBitmapDirty(start >>> 3, start + count - 1 >>> 3);
    this.freeBlocks += count;
    this.superblockDirty = true;
    this.blocksFreedsinceTrim = true;
  }
  // updateSuperblockFreeBlocks is no longer needed — superblock writes are coalesced via commitPending()
  // ========== Inode allocation ==========
  findFreeInode() {
    for (let i = this.freeInodeHint; i < this.inodeCount; i++) {
      if (this.inodeCache.has(i)) continue;
      const offset = this.inodeTableOffset + i * INODE_SIZE;
      const typeBuf = new Uint8Array(1);
      this.handle.read(typeBuf, { at: offset });
      if (typeBuf[0] === INODE_TYPE.FREE) {
        this.freeInodeHint = i + 1;
        return i;
      }
    }
    const idx = this.growInodeTable();
    this.freeInodeHint = idx + 1;
    return idx;
  }
  growInodeTable() {
    const oldCount = this.inodeCount;
    const newCount = oldCount * 2;
    const growth = (newCount - oldCount) * INODE_SIZE;
    const afterInodeOffset = this.inodeTableOffset + oldCount * INODE_SIZE;
    const totalSize = this.handle.getSize();
    const afterSize = totalSize - afterInodeOffset;
    this.handle.truncate(totalSize + growth);
    const SHIFT_CHUNK = 8 * 1024 * 1024;
    if (afterSize > 0) {
      const buf = new Uint8Array(Math.min(SHIFT_CHUNK, afterSize));
      let remaining = afterSize;
      while (remaining > 0) {
        const n = Math.min(SHIFT_CHUNK, remaining);
        const srcAt = afterInodeOffset + remaining - n;
        const view = n === buf.length ? buf : buf.subarray(0, n);
        this.handle.read(view, { at: srcAt });
        this.handle.write(view, { at: srcAt + growth });
        remaining -= n;
      }
    }
    const zChunk = new Uint8Array(Math.min(SHIFT_CHUNK, growth));
    let zRemaining = growth;
    let zOffset = afterInodeOffset;
    while (zRemaining > 0) {
      const n = Math.min(SHIFT_CHUNK, zRemaining);
      this.handle.write(n === zChunk.length ? zChunk : zChunk.subarray(0, n), { at: zOffset });
      zOffset += n;
      zRemaining -= n;
    }
    this.pathTableOffset += growth;
    this.bitmapOffset += growth;
    this.dataOffset += growth;
    this.inodeCount = newCount;
    this.superblockDirty = true;
    return oldCount;
  }
  // ========== Data I/O ==========
  readData(firstBlock, blockCount, size) {
    const buf = new Uint8Array(size);
    const offset = this.dataOffset + firstBlock * this.blockSize;
    this.handle.read(buf, { at: offset });
    return buf;
  }
  writeData(firstBlock, data) {
    const offset = this.dataOffset + firstBlock * this.blockSize;
    this.handle.write(data, { at: offset });
  }
  // ========== Path resolution ==========
  resolvePath(path, depth = 0) {
    if (depth === 0) this.symlinkLoopDetected = false;
    if (depth > MAX_SYMLINK_DEPTH) {
      this.symlinkLoopDetected = true;
      return void 0;
    }
    const idx = this.pathIndex.get(path);
    if (idx === void 0) {
      return this.resolvePathComponents(path, true, depth);
    }
    const inode = this.readInode(idx);
    if (inode.type === INODE_TYPE.SYMLINK) {
      const target = decoder.decode(this.readData(inode.firstBlock, inode.blockCount, inode.size));
      const resolved = target.startsWith("/") ? target : this.resolveRelative(path, target);
      return this.resolvePath(resolved, depth + 1);
    }
    return idx;
  }
  /** Resolve symlinks in intermediate path components */
  resolvePathComponents(path, followLast = true, depth = 0) {
    const result = this.resolvePathFull(path, followLast, depth);
    return result?.idx;
  }
  /**
   * Resolve a path following symlinks, returning both the inode index AND the
   * fully resolved path. This is needed by readdir: when listing a symlinked
   * directory, we must search for children under the resolved target path
   * (where files actually exist in pathIndex), not under the symlink path.
   */
  resolvePathFull(path, followLast = true, depth = 0) {
    if (depth === 0) this.symlinkLoopDetected = false;
    if (depth > MAX_SYMLINK_DEPTH) {
      this.symlinkLoopDetected = true;
      return void 0;
    }
    const parts = path.split("/").filter(Boolean);
    let current = "/";
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      current = current === "/" ? "/" + parts[i] : current + "/" + parts[i];
      const idx = this.pathIndex.get(current);
      if (idx === void 0) return void 0;
      const inode = this.readInode(idx);
      if (inode.type === INODE_TYPE.SYMLINK && (!isLast || followLast)) {
        const target = decoder.decode(this.readData(inode.firstBlock, inode.blockCount, inode.size));
        const resolved = target.startsWith("/") ? target : this.resolveRelative(current, target);
        if (isLast) {
          return this.resolvePathFull(resolved, true, depth + 1);
        }
        const remaining = parts.slice(i + 1).join("/");
        const newPath = resolved + (remaining ? "/" + remaining : "");
        return this.resolvePathFull(newPath, followLast, depth + 1);
      }
    }
    const finalIdx = this.pathIndex.get(current);
    if (finalIdx === void 0) return void 0;
    return { idx: finalIdx, resolvedPath: current };
  }
  /**
   * Follow a symlink chain to the path a *create* should land on.
   *
   * `resolvePathFull` gives up when the final target does not exist, which is exactly the
   * dangling-link case: `writeFileSync('/link', …)` where `/link` → `t3` and `t3` is absent.
   * Callers then created a file at `/link` itself, destroying the symlink — Node follows the
   * link and creates `/t3`, leaving the link intact.
   *
   * Returns `path` unchanged when it is not a symlink, so callers on the common path pay a
   * single Map lookup, and `null` when the chain exceeds MAX_SYMLINK_DEPTH — a cycle, which
   * callers must report as ELOOP rather than writing to wherever the walk happened to stop.
   */
  resolveDanglingLink(path, depth = 0) {
    if (depth > MAX_SYMLINK_DEPTH) return null;
    const idx = this.pathIndex.get(path);
    if (idx === void 0) return path;
    const inode = this.readInode(idx);
    if (inode.type !== INODE_TYPE.SYMLINK) return path;
    const target = decoder.decode(this.readData(inode.firstBlock, inode.blockCount, inode.size));
    const resolved = target.startsWith("/") ? target : this.resolveRelative(path, target);
    return this.resolveDanglingLink(resolved, depth + 1);
  }
  resolveRelative(from, target) {
    const dir = from.substring(0, from.lastIndexOf("/")) || "/";
    const parts = (dir + "/" + target).split("/").filter(Boolean);
    const resolved = [];
    for (const p of parts) {
      if (p === ".") continue;
      if (p === "..") {
        resolved.pop();
        continue;
      }
      resolved.push(p);
    }
    return "/" + resolved.join("/");
  }
  // ========== Core inode creation helper ==========
  createInode(path, type, mode, size, data) {
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
    const inode = {
      type,
      pathOffset: pathOff,
      pathLength: pathLen,
      nlink: type === INODE_TYPE.DIRECTORY ? 2 : 1,
      mode,
      size,
      firstBlock,
      blockCount,
      mtime: now,
      ctime: now,
      atime: now,
      uid: this.processUid,
      gid: this.processGid
    };
    this.writeInode(idx, inode);
    this.setPathIndex(path, idx);
    this.pathIndexGen++;
    return idx;
  }
  // ========== Public API — called by server worker dispatch ==========
  /** Normalize a path: ensure leading /, resolve . and .. */
  normalizePath(p) {
    if (p.charCodeAt(0) !== 47) p = "/" + p;
    if (p.length === 1) return p;
    if (p.indexOf("/.") === -1 && p.indexOf("//") === -1 && p.charCodeAt(p.length - 1) !== 47) {
      return p;
    }
    const parts = p.split("/").filter(Boolean);
    const resolved = [];
    for (const part of parts) {
      if (part === ".") continue;
      if (part === "..") {
        resolved.pop();
        continue;
      }
      resolved.push(part);
    }
    return "/" + resolved.join("/");
  }
  // ---- READ ----
  read(path) {
    const t0 = this.debug ? performance.now() : 0;
    path = this.normalizePath(path);
    let idx = this.pathIndex.get(path);
    if (idx !== void 0) {
      const inode2 = this.inodeCache.get(idx);
      if (inode2) {
        if (inode2.type === INODE_TYPE.SYMLINK) {
          idx = this.resolvePathComponents(path, true);
        } else if (inode2.type === INODE_TYPE.DIRECTORY) {
          return { status: CODE_TO_STATUS.EISDIR, data: null };
        } else {
          const data2 = inode2.size > 0 ? this.readData(inode2.firstBlock, inode2.blockCount, inode2.size) : new Uint8Array(0);
          if (this.debug) {
            const t1 = performance.now();
            console.log(`[VFS read] path=${path} size=${inode2.size} TOTAL=${(t1 - t0).toFixed(3)}ms (fast)`);
          }
          return { status: 0, data: data2 };
        }
      }
    }
    if (idx === void 0) idx = this.resolvePathComponents(path, true);
    if (idx === void 0) return { status: this.resolveFailureStatus(), data: null };
    const inode = this.readInode(idx);
    if (inode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EISDIR, data: null };
    const data = inode.size > 0 ? this.readData(inode.firstBlock, inode.blockCount, inode.size) : new Uint8Array(0);
    if (this.debug) {
      const t1 = performance.now();
      console.log(`[VFS read] path=${path} size=${inode.size} TOTAL=${(t1 - t0).toFixed(3)}ms (slow path)`);
    }
    return { status: 0, data };
  }
  // ---- WRITE ----
  write(path, data, flags = 0) {
    const t0 = this.debug ? performance.now() : 0;
    path = this.normalizePath(path);
    const t1 = this.debug ? performance.now() : 0;
    const parentStatus = this.ensureParent(path);
    if (parentStatus !== 0) return { status: parentStatus };
    const t2 = this.debug ? performance.now() : 0;
    let existingIdx = this.resolvePathComponents(path, true);
    if (existingIdx === void 0) {
      const linkTarget = this.resolveDanglingLink(path);
      if (linkTarget === null) return { status: CODE_TO_STATUS.ELOOP };
      if (linkTarget !== path) {
        path = linkTarget;
        const targetParentStatus = this.ensureParent(path);
        if (targetParentStatus !== 0) return { status: targetParentStatus };
        existingIdx = this.resolvePathComponents(path, true);
      }
    }
    const t3 = this.debug ? performance.now() : 0;
    let tAlloc = t3, tData = t3, tInode = t3;
    if (existingIdx !== void 0) {
      const inode = this.readInode(existingIdx);
      if (inode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EISDIR };
      const neededBlocks = Math.ceil(data.byteLength / this.blockSize);
      if (neededBlocks <= inode.blockCount) {
        tAlloc = this.debug ? performance.now() : 0;
        this.writeData(inode.firstBlock, data);
        tData = this.debug ? performance.now() : 0;
        if (neededBlocks < inode.blockCount) {
          this.freeBlockRange(inode.firstBlock + neededBlocks, inode.blockCount - neededBlocks);
        }
      } else {
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
      if (this.isImplicitDirectory(path)) return { status: CODE_TO_STATUS.EISDIR };
      const mode = DEFAULT_FILE_MODE & ~(this.umask & 511);
      this.createInode(path, INODE_TYPE.FILE, mode, data.byteLength, data);
      tAlloc = this.debug ? performance.now() : 0;
      tData = tAlloc;
      tInode = tAlloc;
    }
    this.commitPending();
    if (flags & 1) {
      this.handle.flush();
    }
    const tFlush = this.debug ? performance.now() : 0;
    if (this.debug) {
      const existing = existingIdx !== void 0;
      console.log(`[VFS write] path=${path} size=${data.byteLength} ${existing ? "UPDATE" : "CREATE"} normalize=${(t1 - t0).toFixed(3)}ms parent=${(t2 - t1).toFixed(3)}ms resolve=${(t3 - t2).toFixed(3)}ms alloc=${(tAlloc - t3).toFixed(3)}ms data=${(tData - tAlloc).toFixed(3)}ms inode=${(tInode - tData).toFixed(3)}ms flush=${(tFlush - tInode).toFixed(3)}ms TOTAL=${(tFlush - t0).toFixed(3)}ms`);
    }
    return { status: 0 };
  }
  // ---- APPEND ----
  append(path, data) {
    path = this.normalizePath(path);
    const existingIdx = this.resolvePathComponents(path, true);
    if (existingIdx === void 0) {
      return this.write(path, data);
    }
    const inode = this.readInode(existingIdx);
    if (inode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EISDIR };
    const combinedSize = inode.size + data.byteLength;
    const neededBlocks = Math.ceil(combinedSize / this.blockSize);
    if (neededBlocks <= inode.blockCount) {
      this.handle.write(data, { at: this.dataOffset + inode.firstBlock * this.blockSize + inode.size });
      inode.size = combinedSize;
      inode.mtime = Date.now();
      this.writeInode(existingIdx, inode);
      this.commitPending();
      return { status: 0 };
    }
    const newFirst = this.allocateBlocks(neededBlocks);
    const newBase = this.dataOffset + newFirst * this.blockSize;
    if (inode.size > 0) {
      const oldBase = this.dataOffset + inode.firstBlock * this.blockSize;
      const CHUNK = 4 * 1024 * 1024;
      const scratch = new Uint8Array(Math.min(CHUNK, inode.size));
      let copied = 0;
      while (copied < inode.size) {
        const n = Math.min(CHUNK, inode.size - copied);
        const slice = n < scratch.length ? scratch.subarray(0, n) : scratch;
        this.handle.read(slice, { at: oldBase + copied });
        this.handle.write(slice, { at: newBase + copied });
        copied += n;
      }
    }
    this.freeBlockRange(inode.firstBlock, inode.blockCount);
    this.handle.write(data, { at: newBase + inode.size });
    inode.firstBlock = newFirst;
    inode.blockCount = neededBlocks;
    inode.size = combinedSize;
    inode.mtime = Date.now();
    this.writeInode(existingIdx, inode);
    this.commitPending();
    return { status: 0 };
  }
  // ---- UNLINK ----
  unlink(path) {
    path = this.normalizePath(path);
    const idx = this.pathIndex.get(path);
    if (idx === void 0) return { status: CODE_TO_STATUS.ENOENT };
    const inode = this.readInode(idx);
    if (inode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EISDIR };
    inode.nlink = Math.max(0, inode.nlink - 1);
    this.freeBlockRange(inode.firstBlock, inode.blockCount);
    inode.type = INODE_TYPE.FREE;
    this.writeInode(idx, inode);
    this.deletePathIndex(path);
    this.pathIndexGen++;
    if (idx < this.freeInodeHint) this.freeInodeHint = idx;
    this.commitPending();
    return { status: 0 };
  }
  // ---- STAT ----
  stat(path) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === void 0) {
      const failure = this.resolveFailureStatus();
      if (this.isImplicitDirectory(path)) {
        return this.encodeImplicitDirStatResponse(path);
      }
      return { status: failure, data: null };
    }
    return this.encodeStatResponse(idx);
  }
  // ---- LSTAT (no symlink follow for the FINAL component) ----
  lstat(path) {
    path = this.normalizePath(path);
    let idx = this.resolvePathComponents(path, false);
    if (idx === void 0) {
      idx = this.resolvePathComponents(path, true);
      if (idx === void 0) {
        if (this.isImplicitDirectory(path)) {
          return this.encodeImplicitDirStatResponse(path);
        }
        return { status: CODE_TO_STATUS.ENOENT, data: null };
      }
    }
    return this.encodeStatResponse(idx);
  }
  encodeStatResponse(idx) {
    const inode = this.readInode(idx);
    let nlink = inode.nlink;
    if (inode.type === INODE_TYPE.DIRECTORY) {
      const path = this.readPath(inode.pathOffset, inode.pathLength);
      const children = this.getDirectChildrenWithImplicit(path);
      let subdirCount = 0;
      for (const child of children) {
        if (child.type === "implicit") {
          subdirCount++;
        } else {
          const childIdx = this.pathIndex.get(child.path);
          if (childIdx !== void 0) {
            const childInode = this.readInode(childIdx);
            if (childInode.type === INODE_TYPE.DIRECTORY) subdirCount++;
          }
        }
      }
      nlink = 2 + subdirCount;
    }
    const buf = new Uint8Array(53);
    const view = new DataView(buf.buffer);
    view.setUint8(0, inode.type);
    view.setUint32(1, inode.mode, true);
    view.setFloat64(5, inode.size, true);
    view.setFloat64(13, inode.mtime, true);
    view.setFloat64(21, inode.ctime, true);
    view.setFloat64(29, inode.atime, true);
    view.setUint32(37, inode.uid, true);
    view.setUint32(41, inode.gid, true);
    view.setUint32(45, idx, true);
    view.setUint32(49, nlink, true);
    return { status: 0, data: buf };
  }
  // ---- MKDIR ----
  /**
   * mkdir(2). `reqMode` is the caller's requested permission mode; the umask is subtracted from it
   * here exactly as the kernel does. It defaults to 0o777 so an omitted mode still lands on the
   * historical 0o755 under the default 0o022 umask.
   *
   * Honouring the mode is not cosmetic: software that creates a private directory and then stats it
   * back treats a widened mode as a security failure and aborts. Chrome's ProcessSingleton is the
   * canonical case — it mkdtemp()s its socket directory and CHECKs that the mode is exactly 0700,
   * killing the browser at startup when the filesystem silently returns 0755.
   */
  mkdir(path, flags = 0, reqMode = 511) {
    path = this.normalizePath(path);
    const recursive = (flags & 1) !== 0;
    if (recursive) {
      return this.mkdirRecursive(path, reqMode);
    }
    if (this.pathIndex.has(path) || this.isImplicitDirectory(path)) {
      return { status: CODE_TO_STATUS.EEXIST, data: null };
    }
    const parentStatus = this.ensureParent(path);
    if (parentStatus !== 0) return { status: parentStatus, data: null };
    this.createInode(path, INODE_TYPE.DIRECTORY, this.dirModeFor(reqMode), 0);
    this.commitPending();
    return { status: 0, data: null };
  }
  /** Permission bits a new directory gets: the request minus the umask, plus the S_IFDIR type. */
  dirModeFor(reqMode) {
    return S_IFDIR | reqMode & 4095 & ~(this.umask & 511);
  }
  /** Same, for a newly created regular file. Node's open defaults reqMode to 0o666 → 0o644. */
  fileModeFor(reqMode) {
    return S_IFREG | reqMode & 4095 & ~(this.umask & 511);
  }
  mkdirRecursive(path, reqMode = 511) {
    const parts = path.split("/").filter(Boolean);
    let current = "";
    let firstCreated = null;
    for (const part of parts) {
      current += "/" + part;
      if (this.pathIndex.has(current)) {
        const idx = this.pathIndex.get(current);
        const inode = this.readInode(idx);
        if (inode.type !== INODE_TYPE.DIRECTORY) {
          return { status: CODE_TO_STATUS.ENOTDIR, data: null };
        }
        continue;
      }
      this.createInode(current, INODE_TYPE.DIRECTORY, this.dirModeFor(reqMode), 0);
      if (!firstCreated) firstCreated = current;
    }
    this.commitPending();
    const result = firstCreated ? encoder.encode(firstCreated) : void 0;
    return { status: 0, data: result ?? null };
  }
  // ---- RMDIR ----
  rmdir(path, flags = 0) {
    path = this.normalizePath(path);
    const recursive = (flags & 1) !== 0;
    const idx = this.pathIndex.get(path);
    if (idx === void 0) {
      if (this.isImplicitDirectory(path)) {
        const children2 = this.getDirectChildrenWithImplicit(path);
        if (children2.length > 0) {
          if (!recursive) return { status: CODE_TO_STATUS.ENOTEMPTY };
          for (const desc of this.getAllDescendants(path)) {
            const descIdx = this.pathIndex.get(desc);
            const descInode = this.readInode(descIdx);
            this.freeBlockRange(descInode.firstBlock, descInode.blockCount);
            descInode.type = INODE_TYPE.FREE;
            this.writeInode(descIdx, descInode);
            this.deletePathIndex(desc);
          }
          this.pathIndexGen++;
          this.commitPending();
        }
        return { status: 0 };
      }
      return { status: CODE_TO_STATUS.ENOENT };
    }
    const inode = this.readInode(idx);
    if (inode.type !== INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.ENOTDIR };
    const children = this.getDirectChildren(path);
    if (children.length > 0) {
      if (!recursive) return { status: CODE_TO_STATUS.ENOTEMPTY };
      for (const child of this.getAllDescendants(path)) {
        const childIdx = this.pathIndex.get(child);
        const childInode = this.readInode(childIdx);
        this.freeBlockRange(childInode.firstBlock, childInode.blockCount);
        childInode.type = INODE_TYPE.FREE;
        this.writeInode(childIdx, childInode);
        this.deletePathIndex(child);
      }
    }
    if (path === "/") {
      this.pathIndexGen++;
      this.commitPending();
      return { status: 0 };
    }
    inode.type = INODE_TYPE.FREE;
    this.writeInode(idx, inode);
    this.deletePathIndex(path);
    this.pathIndexGen++;
    if (idx < this.freeInodeHint) this.freeInodeHint = idx;
    this.commitPending();
    return { status: 0 };
  }
  // ---- READDIR ----
  readdir(path, flags = 0) {
    path = this.normalizePath(path);
    const resolved = this.resolvePathFull(path, true);
    let effectiveDirPath;
    if (resolved) {
      const inode = this.readInode(resolved.idx);
      if (inode.type !== INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.ENOTDIR, data: null };
      effectiveDirPath = resolved.resolvedPath;
    } else if (this.isImplicitDirectory(path)) {
      effectiveDirPath = path;
    } else {
      return { status: CODE_TO_STATUS.ENOENT, data: null };
    }
    const withFileTypes = (flags & 1) !== 0;
    if (withFileTypes) {
      this.ensureChildIndex();
      const typedNames = this.childIndex.get(effectiveDirPath);
      if (!typedNames) return { status: 0, data: new Uint8Array([0, 0, 0, 0]) };
      const names2 = [...typedNames.keys()].sort();
      const prefix = effectiveDirPath === "/" ? "/" : effectiveDirPath + "/";
      let capacity2 = 4;
      for (const name of names2) capacity2 += 3 + name.length * 3;
      const buf2 = new Uint8Array(capacity2);
      const view2 = new DataView(buf2.buffer);
      view2.setUint32(0, names2.length, true);
      let offset2 = 4;
      for (const name of names2) {
        const { written } = encoder.encodeInto(name, buf2.subarray(offset2 + 2));
        view2.setUint16(offset2, written, true);
        offset2 += 2 + written;
        const childIdx = this.pathIndex.get(prefix + name);
        buf2[offset2++] = childIdx === void 0 ? INODE_TYPE.DIRECTORY : this.readInode(childIdx).type;
      }
      return { status: 0, data: buf2.subarray(0, offset2) };
    }
    this.ensureChildIndex();
    const childNames = this.childIndex.get(effectiveDirPath);
    if (!childNames) return { status: 0, data: new Uint8Array([0, 0, 0, 0]) };
    const names = [...childNames.keys()].sort();
    let capacity = 4;
    for (const name of names) capacity += 2 + name.length * 3;
    const buf = new Uint8Array(capacity);
    const view = new DataView(buf.buffer);
    view.setUint32(0, names.length, true);
    let offset = 4;
    for (const name of names) {
      const { written } = encoder.encodeInto(name, buf.subarray(offset + 2));
      view.setUint16(offset, written, true);
      offset += 2 + written;
    }
    return { status: 0, data: buf.subarray(0, offset) };
  }
  // ---- RENAME ----
  rename(oldPath, newPath) {
    oldPath = this.normalizePath(oldPath);
    newPath = this.normalizePath(newPath);
    const idx = this.pathIndex.get(oldPath);
    if (idx === void 0) return { status: CODE_TO_STATUS.ENOENT };
    if (oldPath === newPath) return { status: 0 };
    const parentStatus = this.ensureParent(newPath);
    if (parentStatus !== 0) return { status: parentStatus };
    const existingIdx = this.pathIndex.get(newPath);
    const targetIsImplicitDir = existingIdx === void 0 && this.isImplicitDirectory(newPath);
    if (existingIdx !== void 0 || targetIsImplicitDir) {
      const srcIsDir = this.readInode(idx).type === INODE_TYPE.DIRECTORY;
      const dstIsDir = targetIsImplicitDir || existingIdx !== void 0 && this.readInode(existingIdx).type === INODE_TYPE.DIRECTORY;
      if (srcIsDir && !dstIsDir) return { status: CODE_TO_STATUS.ENOTDIR };
      if (!srcIsDir && dstIsDir) return { status: CODE_TO_STATUS.EISDIR };
    }
    if (existingIdx !== void 0 || targetIsImplicitDir) {
      let cleanDescendants = targetIsImplicitDir;
      if (existingIdx !== void 0) {
        const existingInode = this.readInode(existingIdx);
        cleanDescendants = existingInode.type === INODE_TYPE.DIRECTORY;
        this.freeBlockRange(existingInode.firstBlock, existingInode.blockCount);
        existingInode.type = INODE_TYPE.FREE;
        this.writeInode(existingIdx, existingInode);
        this.deletePathIndex(newPath);
        if (existingIdx < this.freeInodeHint) this.freeInodeHint = existingIdx;
      }
      if (cleanDescendants) {
        for (const desc of this.getAllDescendants(newPath)) {
          const descIdx = this.pathIndex.get(desc);
          const descInode = this.readInode(descIdx);
          this.freeBlockRange(descInode.firstBlock, descInode.blockCount);
          descInode.type = INODE_TYPE.FREE;
          this.writeInode(descIdx, descInode);
          this.deletePathIndex(desc);
          if (descIdx < this.freeInodeHint) this.freeInodeHint = descIdx;
        }
      }
    }
    const inode = this.readInode(idx);
    const { offset: pathOff, length: pathLen } = this.appendPath(newPath);
    inode.pathOffset = pathOff;
    inode.pathLength = pathLen;
    inode.mtime = Date.now();
    this.writeInode(idx, inode);
    this.deletePathIndex(oldPath);
    this.setPathIndex(newPath, idx);
    this.pathIndexGen++;
    if (inode.type === INODE_TYPE.DIRECTORY) {
      const prefix = oldPath === "/" ? "/" : oldPath + "/";
      const toRename = [];
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
        this.deletePathIndex(p);
        this.setPathIndex(childNewPath, i);
      }
    }
    this.commitPending();
    return { status: 0 };
  }
  // ---- EXISTS ----
  exists(path) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    const buf = new Uint8Array(1);
    buf[0] = idx !== void 0 || this.isImplicitDirectory(path) ? 1 : 0;
    return { status: 0, data: buf };
  }
  // ---- TRUNCATE ----
  truncate(path, len = 0) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === void 0) return { status: this.resolveFailureStatus() };
    const inode = this.readInode(idx);
    if (inode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EISDIR };
    if (len === 0) {
      this.freeBlockRange(inode.firstBlock, inode.blockCount);
      inode.firstBlock = 0;
      inode.blockCount = 0;
      inode.size = 0;
    } else if (len < inode.size) {
      const neededBlocks = Math.ceil(len / this.blockSize);
      if (neededBlocks < inode.blockCount) {
        this.freeBlockRange(inode.firstBlock + neededBlocks, inode.blockCount - neededBlocks);
      }
      inode.blockCount = neededBlocks;
      inode.size = len;
    } else if (len > inode.size) {
      const neededBlocks = Math.ceil(len / this.blockSize);
      if (neededBlocks > inode.blockCount) {
        const newFirst = this.allocateBlocks(neededBlocks);
        const newBase = this.dataOffset + newFirst * this.blockSize;
        if (inode.size > 0) {
          const oldBase = this.dataOffset + inode.firstBlock * this.blockSize;
          const CHUNK = 4 * 1024 * 1024;
          const scratch = new Uint8Array(Math.min(CHUNK, inode.size));
          let copied = 0;
          while (copied < inode.size) {
            const n = Math.min(CHUNK, inode.size - copied);
            const slice = n < scratch.length ? scratch.subarray(0, n) : scratch;
            this.handle.read(slice, { at: oldBase + copied });
            this.handle.write(slice, { at: newBase + copied });
            copied += n;
          }
        }
        this.freeBlockRange(inode.firstBlock, inode.blockCount);
        this.zeroFileRange(newBase + inode.size, len - inode.size);
        inode.firstBlock = newFirst;
      } else {
        this.zeroFileRange(
          this.dataOffset + inode.firstBlock * this.blockSize + inode.size,
          len - inode.size
        );
      }
      inode.blockCount = neededBlocks;
      inode.size = len;
    }
    inode.mtime = Date.now();
    this.writeInode(idx, inode);
    this.commitPending();
    return { status: 0 };
  }
  // ---- COPY ----
  copy(srcPath, destPath, flags = 0) {
    srcPath = this.normalizePath(srcPath);
    destPath = this.normalizePath(destPath);
    const srcIdx = this.resolvePathComponents(srcPath, true);
    if (srcIdx === void 0) return { status: this.resolveFailureStatus() };
    const srcInode = this.readInode(srcIdx);
    if (srcInode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.ENOTSUP };
    if (flags & 1 && (this.pathIndex.has(destPath) || this.isImplicitDirectory(destPath))) {
      return { status: CODE_TO_STATUS.EEXIST };
    }
    if (srcPath === destPath) return { status: 0 };
    const srcSize = srcInode.size;
    const srcFirstBlock = srcInode.firstBlock;
    const srcMode = srcInode.mode;
    const emptyStatus = this.write(destPath, new Uint8Array(0));
    if (emptyStatus.status !== 0) return emptyStatus;
    if (srcSize === 0) {
      const emptyIdx = this.resolvePathComponents(destPath, true);
      if (emptyIdx !== void 0) {
        const emptyInode = this.readInode(emptyIdx);
        emptyInode.mode = emptyInode.mode & ~4095 | srcMode & 4095;
        this.writeInode(emptyIdx, emptyInode);
        this.commitPending();
      }
      return { status: 0 };
    }
    const destIdx = this.resolvePathComponents(destPath, true);
    if (destIdx === void 0) return { status: CODE_TO_STATUS.EIO };
    const destInode = this.readInode(destIdx);
    const neededBlocks = Math.ceil(srcSize / this.blockSize);
    const newFirst = this.allocateBlocks(neededBlocks);
    const newBase = this.dataOffset + newFirst * this.blockSize;
    const srcBase = this.dataOffset + srcFirstBlock * this.blockSize;
    const CHUNK = 4 * 1024 * 1024;
    const scratch = new Uint8Array(Math.min(CHUNK, srcSize));
    let copied = 0;
    while (copied < srcSize) {
      const n = Math.min(CHUNK, srcSize - copied);
      const slice = n < scratch.length ? scratch.subarray(0, n) : scratch;
      this.handle.read(slice, { at: srcBase + copied });
      this.handle.write(slice, { at: newBase + copied });
      copied += n;
    }
    destInode.firstBlock = newFirst;
    destInode.blockCount = neededBlocks;
    destInode.size = srcSize;
    destInode.mtime = Date.now();
    destInode.mode = destInode.mode & ~4095 | srcMode & 4095;
    this.writeInode(destIdx, destInode);
    this.commitPending();
    return { status: 0 };
  }
  // ---- ACCESS ----
  access(path, mode = 0) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === void 0) {
      const failure = this.resolveFailureStatus();
      if (this.isImplicitDirectory(path)) return { status: 0 };
      return { status: failure };
    }
    if (mode === 0) return { status: 0 };
    if (!this.strictPermissions) return { status: 0 };
    const inode = this.readInode(idx);
    const filePerm = this.getEffectivePermission(inode);
    if (mode & 4 && !(filePerm & 4)) return { status: CODE_TO_STATUS.EACCES };
    if (mode & 2 && !(filePerm & 2)) return { status: CODE_TO_STATUS.EACCES };
    if (mode & 1 && !(filePerm & 1)) return { status: CODE_TO_STATUS.EACCES };
    return { status: 0 };
  }
  getEffectivePermission(inode) {
    const modeBits = inode.mode & 511;
    if (this.processUid === inode.uid) return modeBits >>> 6 & 7;
    if (this.processGid === inode.gid) return modeBits >>> 3 & 7;
    return modeBits & 7;
  }
  // ---- REALPATH ----
  realpath(path) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === void 0) {
      const failure = this.resolveFailureStatus();
      if (this.isImplicitDirectory(path)) {
        return { status: 0, data: encoder.encode(path) };
      }
      return { status: failure, data: null };
    }
    const inode = this.readInode(idx);
    const resolvedPath = this.readPath(inode.pathOffset, inode.pathLength);
    return { status: 0, data: encoder.encode(resolvedPath) };
  }
  // ---- CHMOD ----
  chmod(path, mode) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === void 0) return { status: this.resolveFailureStatus() };
    const inode = this.readInode(idx);
    inode.mode = inode.mode & S_IFMT | mode & 4095;
    inode.ctime = Date.now();
    this.writeInode(idx, inode);
    return { status: 0 };
  }
  // ---- CHOWN ----
  chown(path, uid, gid) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === void 0) return { status: this.resolveFailureStatus() };
    const inode = this.readInode(idx);
    inode.uid = uid;
    inode.gid = gid;
    inode.ctime = Date.now();
    this.writeInode(idx, inode);
    return { status: 0 };
  }
  // ---- UTIMES ----
  utimes(path, atime, mtime) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === void 0) return { status: this.resolveFailureStatus() };
    const inode = this.readInode(idx);
    inode.atime = atime;
    inode.mtime = mtime;
    inode.ctime = Date.now();
    this.writeInode(idx, inode);
    return { status: 0 };
  }
  // ---- SYMLINK ----
  symlink(target, linkPath) {
    linkPath = this.normalizePath(linkPath);
    if (this.pathIndex.has(linkPath) || this.isImplicitDirectory(linkPath)) {
      return { status: CODE_TO_STATUS.EEXIST };
    }
    const parentStatus = this.ensureParent(linkPath);
    if (parentStatus !== 0) return { status: parentStatus };
    const targetBytes = encoder.encode(target);
    this.createInode(linkPath, INODE_TYPE.SYMLINK, DEFAULT_SYMLINK_MODE, targetBytes.byteLength, targetBytes);
    this.commitPending();
    return { status: 0 };
  }
  // ---- READLINK ----
  readlink(path) {
    path = this.normalizePath(path);
    const idx = this.pathIndex.get(path);
    if (idx === void 0) return { status: CODE_TO_STATUS.ENOENT, data: null };
    const inode = this.readInode(idx);
    if (inode.type !== INODE_TYPE.SYMLINK) return { status: CODE_TO_STATUS.EINVAL, data: null };
    const target = this.readData(inode.firstBlock, inode.blockCount, inode.size);
    return { status: 0, data: target };
  }
  // ---- LINK (hard link — copies the file data, tracks nlink) ----
  link(existingPath, newPath) {
    existingPath = this.normalizePath(existingPath);
    newPath = this.normalizePath(newPath);
    const srcIdx = this.resolvePathComponents(existingPath, true);
    if (srcIdx === void 0) return { status: this.resolveFailureStatus() };
    const srcInode = this.readInode(srcIdx);
    if (srcInode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EPERM };
    if (this.pathIndex.has(newPath) || this.isImplicitDirectory(newPath)) {
      return { status: CODE_TO_STATUS.EEXIST };
    }
    const result = this.copy(existingPath, newPath);
    if (result.status !== 0) return result;
    srcInode.nlink++;
    this.writeInode(srcIdx, srcInode);
    const destIdx = this.pathIndex.get(newPath);
    if (destIdx !== void 0) {
      const destInode = this.readInode(destIdx);
      destInode.nlink = srcInode.nlink;
      this.writeInode(destIdx, destInode);
    }
    return { status: 0 };
  }
  // ---- OPEN (file descriptor) ----
  /**
   * open(2). `reqMode` is the mode an O_CREAT open asks for; the umask is subtracted from it
   * here, as the kernel does. It defaults to 0o666 — Node's default for `open` — so an omitted
   * mode still lands on the historical 0o644 under the default 0o022 umask.
   *
   * The mode applies **only when the file is created**. Re-opening an existing file with a
   * different mode leaves its permissions alone, matching open(2) and Node.
   */
  open(path, flags, tabId, reqMode = 438) {
    path = this.normalizePath(path);
    const hasCreate = (flags & 64) !== 0;
    const hasTrunc = (flags & 512) !== 0;
    const hasExcl = (flags & 128) !== 0;
    let idx = this.resolvePathComponents(path, true);
    if (idx === void 0) {
      const linkTarget = this.resolveDanglingLink(path);
      if (linkTarget === null) return { status: CODE_TO_STATUS.ELOOP, data: null };
      if (linkTarget !== path) {
        path = linkTarget;
        idx = this.resolvePathComponents(path, true);
      }
    }
    if (idx === void 0) {
      if (!hasCreate) return { status: this.resolveFailureStatus(), data: null };
      const parentStatus = this.ensureParent(path);
      if (parentStatus !== 0) return { status: parentStatus, data: null };
      idx = this.createInode(path, INODE_TYPE.FILE, this.fileModeFor(reqMode), 0);
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
  close(fd) {
    if (!this.fdTable.has(fd)) return { status: CODE_TO_STATUS.EBADF };
    this.fdTable.delete(fd);
    return { status: 0 };
  }
  // ---- FREAD ----
  fread(fd, length, position) {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF, data: null };
    if (!_VFSEngine.isReadable(entry.flags)) return { status: CODE_TO_STATUS.EBADF, data: null };
    const inode = this.readInode(entry.inodeIdx);
    if (inode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EISDIR, data: null };
    const pos = position ?? entry.position;
    const readLen = Math.min(length, inode.size - pos);
    if (readLen <= 0) return { status: 0, data: new Uint8Array(0) };
    const dataOffset = this.dataOffset + inode.firstBlock * this.blockSize + pos;
    const buf = new Uint8Array(readLen);
    this.handle.read(buf, { at: dataOffset });
    if (position === null) {
      entry.position += readLen;
    }
    return { status: 0, data: buf };
  }
  // ---- FWRITE ----
  fwrite(fd, data, position) {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF, data: null };
    if (!_VFSEngine.isWritable(entry.flags)) return { status: CODE_TO_STATUS.EBADF, data: null };
    const inode = this.readInode(entry.inodeIdx);
    const isAppend = (entry.flags & 1024) !== 0;
    const pos = isAppend ? inode.size : position ?? entry.position;
    const endPos = pos + data.byteLength;
    if (endPos > inode.size) {
      const neededBlocks = Math.ceil(endPos / this.blockSize);
      if (neededBlocks > inode.blockCount) {
        const newFirst = this.allocateBlocks(neededBlocks);
        const newBase = this.dataOffset + newFirst * this.blockSize;
        const oldBase = this.dataOffset + inode.firstBlock * this.blockSize;
        if (inode.size > 0) {
          const CHUNK = 4 * 1024 * 1024;
          const scratch = new Uint8Array(Math.min(CHUNK, inode.size));
          let copied = 0;
          while (copied < inode.size) {
            const n = Math.min(CHUNK, inode.size - copied);
            const slice = n < scratch.length ? scratch.subarray(0, n) : scratch;
            this.handle.read(slice, { at: oldBase + copied });
            this.handle.write(slice, { at: newBase + copied });
            copied += n;
          }
        }
        this.freeBlockRange(inode.firstBlock, inode.blockCount);
        if (pos > inode.size) {
          this.zeroFileRange(newBase + inode.size, pos - inode.size);
        }
        this.handle.write(data, { at: newBase + pos });
        inode.firstBlock = newFirst;
        inode.blockCount = neededBlocks;
      } else {
        if (pos > inode.size) {
          this.zeroFileRange(
            this.dataOffset + inode.firstBlock * this.blockSize + inode.size,
            pos - inode.size
          );
        }
        const dataOffset = this.dataOffset + inode.firstBlock * this.blockSize + pos;
        this.handle.write(data, { at: dataOffset });
      }
      inode.size = endPos;
    } else {
      const dataOffset = this.dataOffset + inode.firstBlock * this.blockSize + pos;
      this.handle.write(data, { at: dataOffset });
    }
    inode.mtime = Date.now();
    this.writeInode(entry.inodeIdx, inode);
    if (position === null) {
      entry.position = endPos;
    }
    this.commitPending();
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, data.byteLength, true);
    return { status: 0, data: buf };
  }
  // ---- FSTAT ----
  fstat(fd) {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF, data: null };
    if (entry.implicitPath) return this.encodeImplicitDirStatResponse(entry.implicitPath);
    return this.encodeStatResponse(entry.inodeIdx);
  }
  // ---- FTRUNCATE ----
  ftruncate(fd, len = 0) {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF };
    if (!_VFSEngine.isWritable(entry.flags)) return { status: CODE_TO_STATUS.EINVAL };
    const inode = this.readInode(entry.inodeIdx);
    const path = this.readPath(inode.pathOffset, inode.pathLength);
    return this.truncate(path, len);
  }
  // ---- FSYNC ----
  /**
   * Real volume statistics.
   *
   * `statfs` used to be answered by the filesystem layer with fixed constants — always ~4 GB
   * capacity and ~2 GB free, whatever the volume actually held — so anything checking free space
   * before a large write got a number unrelated to reality. These come from the superblock the
   * allocator maintains.
   *
   * Payload: [type u32][bsize u32][blocks u32][bfree u32][files u32][ffree u32].
   */
  statfs(path = "/") {
    path = this.normalizePath(path);
    if (this.resolvePathComponents(path, true) === void 0 && !this.isImplicitDirectory(path)) {
      return { status: this.resolveFailureStatus(), data: null };
    }
    const usedInodes = new Set(this.pathIndex.values()).size;
    const buf = new Uint8Array(24);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, VFS_MAGIC, true);
    dv.setUint32(4, this.blockSize, true);
    dv.setUint32(8, this.totalBlocks, true);
    dv.setUint32(12, this.freeBlocks, true);
    dv.setUint32(16, this.inodeCount, true);
    dv.setUint32(20, Math.max(0, this.inodeCount - usedInodes), true);
    return { status: 0, data: buf };
  }
  fsync() {
    this.commitPending();
    this.handle.flush();
    return { status: 0 };
  }
  // ---- FCHMOD ----
  // fd-based chmod: look up the inode directly from the fd table and mutate
  // its mode bits. Native Node does the same thing at the libuv layer.
  fchmod(fd, mode) {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF };
    if (entry.implicitPath) return { status: 0 };
    const inode = this.readInode(entry.inodeIdx);
    inode.mode = inode.mode & S_IFMT | mode & 4095;
    inode.ctime = Date.now();
    this.writeInode(entry.inodeIdx, inode);
    return { status: 0 };
  }
  // ---- FCHOWN ----
  fchown(fd, uid, gid) {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF };
    if (entry.implicitPath) return { status: 0 };
    const inode = this.readInode(entry.inodeIdx);
    inode.uid = uid;
    inode.gid = gid;
    inode.ctime = Date.now();
    this.writeInode(entry.inodeIdx, inode);
    return { status: 0 };
  }
  // ---- FUTIMES ----
  futimes(fd, atime, mtime) {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF };
    if (entry.implicitPath) return { status: 0 };
    const inode = this.readInode(entry.inodeIdx);
    inode.atime = atime;
    inode.mtime = mtime;
    inode.ctime = Date.now();
    this.writeInode(entry.inodeIdx, inode);
    return { status: 0 };
  }
  // ---- OPENDIR ----
  opendir(path, tabId) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === void 0) {
      if (this.isImplicitDirectory(path)) {
        const fd2 = this.nextFd++;
        this.fdTable.set(fd2, { tabId, inodeIdx: -1, position: 0, flags: 0, implicitPath: path });
        const buf2 = new Uint8Array(4);
        new DataView(buf2.buffer).setUint32(0, fd2, true);
        return { status: 0, data: buf2 };
      }
      return { status: CODE_TO_STATUS.ENOENT, data: null };
    }
    const inode = this.readInode(idx);
    if (inode.type !== INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.ENOTDIR, data: null };
    const fd = this.nextFd++;
    this.fdTable.set(fd, { tabId, inodeIdx: idx, position: 0, flags: 0 });
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, fd, true);
    return { status: 0, data: buf };
  }
  // ---- MKDTEMP ----
  mkdtemp(prefix) {
    const suffix = Math.random().toString(36).substring(2, 8);
    const path = this.normalizePath(prefix + suffix);
    const parentStatus = this.ensureParent(path);
    if (parentStatus !== 0) {
      const parentPath = path.substring(0, path.lastIndexOf("/"));
      if (parentPath) {
        this.mkdirRecursive(parentPath);
      }
    }
    this.createInode(path, INODE_TYPE.DIRECTORY, this.dirModeFor(448), 0);
    this.commitPending();
    return { status: 0, data: encoder.encode(path) };
  }
  // ========== Helpers ==========
  getDirectChildren(dirPath) {
    this.ensureChildIndex();
    const names = this.childIndex.get(dirPath);
    if (!names) return [];
    const prefix = dirPath === "/" ? "/" : dirPath + "/";
    const children = [];
    for (const name of names.keys()) {
      const full = prefix + name;
      if (this.pathIndex.has(full)) children.push(full);
    }
    return children.sort();
  }
  /**
   * Rebuild the set of all implicit directory paths.
   * An implicit directory is any ancestor path of a file/symlink in pathIndex
   * that doesn't itself have an explicit inode entry.
   * Only rebuilt when pathIndex has changed (tracked via generation counter).
   */
  rebuildImplicitDirs() {
    if (this.implicitDirsGen === this.pathIndexGen) return;
    const now = Date.now();
    const prev = this.implicitDirs;
    this.implicitDirs = /* @__PURE__ */ new Map();
    for (const filePath of this.pathIndex.keys()) {
      let pos = filePath.length;
      while (true) {
        pos = filePath.lastIndexOf("/", pos - 1);
        if (pos <= 0) break;
        const ancestor = filePath.substring(0, pos);
        if (this.implicitDirs.has(ancestor)) break;
        if (!this.pathIndex.has(ancestor)) {
          this.implicitDirs.set(ancestor, prev.get(ancestor) ?? now);
        }
      }
    }
    this.implicitDirsGen = this.pathIndexGen;
  }
  /**
   * Check if a path is an implicit directory (exists because files exist under it,
   * but no explicit directory inode was created for it).
   *
   * O(1) via the incrementally maintained `descCount` map (an implicit dir
   * is exactly !pathIndex.has(P) && descCount[P] > 0). If `pathIndex` was
   * mutated directly without going through the helpers (test scaffolding),
   * descCount is stale and we rebuild it from scratch — once — to resync.
   */
  isImplicitDirectory(path) {
    if (path === "/") return false;
    if (this.pathIndex.has(path)) return false;
    if (this.descCountGen < this.pathIndexGen) this.rebuildDescCount();
    return (this.descCount.get(path) ?? 0) > 0;
  }
  /**
   * Recompute `descCount` from scratch by walking every pathIndex entry's
   * ancestor chain. O(N×depth). Only triggered when something bypassed the
   * setPathIndex/deletePathIndex helpers — in production code that's
   * never; the tests exercise this path.
   */
  rebuildDescCount() {
    this.descCount.clear();
    for (const path of this.pathIndex.keys()) {
      this.bumpDescCount(path);
    }
    this.descCountGen = this.pathIndexGen;
  }
  // ---- pathIndex helpers — keep `descCount` in sync ----
  // Every pathIndex.set/delete in the engine MUST go through these so the
  // `descCount` map (used by `isImplicitDirectory`) stays correct. We
  // anticipate the caller's `pathIndexGen++` by setting `descCountGen` to
  // `pathIndexGen + 1`; idempotent across multiple helper calls within a
  // single logical op (e.g. rmdir doing N deletes then one bump). Test
  // code that mutates `pathIndex` directly leaves descCountGen behind,
  // which is what triggers the rebuild path in `isImplicitDirectory`.
  setPathIndex(path, idx) {
    const had = this.pathIndex.has(path);
    this.pathIndex.set(path, idx);
    if (!had) {
      this.bumpDescCount(path);
      this.bumpChildIndex(path);
    }
    this.descCountGen = this.pathIndexGen + 1;
    this.childIndexGen = this.pathIndexGen + 1;
  }
  deletePathIndex(path) {
    const had = this.pathIndex.delete(path);
    if (had) {
      this.decDescCount(path);
      this.decChildIndex(path);
    }
    this.descCountGen = this.pathIndexGen + 1;
    this.childIndexGen = this.pathIndexGen + 1;
    return had;
  }
  bumpDescCount(path) {
    let pos = path.length;
    while (true) {
      pos = path.lastIndexOf("/", pos - 1);
      if (pos <= 0) break;
      const ancestor = path.substring(0, pos);
      this.descCount.set(ancestor, (this.descCount.get(ancestor) ?? 0) + 1);
    }
  }
  decDescCount(path) {
    let pos = path.length;
    while (true) {
      pos = path.lastIndexOf("/", pos - 1);
      if (pos <= 0) break;
      const ancestor = path.substring(0, pos);
      const cur = this.descCount.get(ancestor);
      if (cur === void 0) break;
      if (cur <= 1) this.descCount.delete(ancestor);
      else this.descCount.set(ancestor, cur - 1);
    }
  }
  // ---- children index maintenance ----
  // For path /a/b/c.txt, registers: '/'→'a', '/a'→'b', '/a/b'→'c.txt',
  // each with a refcount of how many pathIndex entries pass through that edge.
  bumpChildIndex(path) {
    if (path === "/" || path.length === 0) return;
    let parent = "/";
    let start = 1;
    while (start <= path.length) {
      let end = path.indexOf("/", start);
      if (end === -1) end = path.length;
      const name = path.substring(start, end);
      if (name.length > 0) {
        let children = this.childIndex.get(parent);
        if (!children) {
          children = /* @__PURE__ */ new Map();
          this.childIndex.set(parent, children);
        }
        children.set(name, (children.get(name) ?? 0) + 1);
        parent = parent === "/" ? "/" + name : parent + "/" + name;
      }
      start = end + 1;
    }
  }
  decChildIndex(path) {
    if (path === "/" || path.length === 0) return;
    let parent = "/";
    let start = 1;
    while (start <= path.length) {
      let end = path.indexOf("/", start);
      if (end === -1) end = path.length;
      const name = path.substring(start, end);
      if (name.length > 0) {
        const children = this.childIndex.get(parent);
        if (!children) break;
        const cur = children.get(name);
        if (cur === void 0) break;
        if (cur <= 1) {
          children.delete(name);
          if (children.size === 0) this.childIndex.delete(parent);
        } else {
          children.set(name, cur - 1);
        }
        parent = parent === "/" ? "/" + name : parent + "/" + name;
      }
      start = end + 1;
    }
  }
  /**
   * Resync childIndex with pathIndex if test scaffolding (or repair paths)
   * mutated pathIndex directly. Mirrors the descCount staleness contract.
   */
  ensureChildIndex() {
    if (this.childIndexGen >= this.pathIndexGen) return;
    this.childIndex.clear();
    for (const path of this.pathIndex.keys()) {
      this.bumpChildIndex(path);
    }
    this.childIndexGen = this.pathIndexGen;
  }
  /**
   * Get direct children of a directory path, including implicit subdirectories.
   * Returns unique child full paths. Each entry is tagged with whether it's a
   * real inode or an implicit directory.
   */
  getDirectChildrenWithImplicit(dirPath) {
    this.ensureChildIndex();
    const names = this.childIndex.get(dirPath);
    if (!names) return [];
    const prefix = dirPath === "/" ? "/" : dirPath + "/";
    const result = [];
    for (const name of names.keys()) {
      const full = prefix + name;
      result.push({ path: full, type: this.pathIndex.has(full) ? "real" : "implicit" });
    }
    result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return result;
  }
  /**
   * Encode a synthetic stat response for an implicit directory.
   * Returns directory stats with default mode, zero size, current timestamps.
   */
  encodeImplicitDirStatResponse(path) {
    this.rebuildImplicitDirs();
    const ts = this.implicitDirs.get(path) ?? Date.now();
    const mode = DEFAULT_DIR_MODE & ~(this.umask & 511);
    const children = this.getDirectChildrenWithImplicit(path);
    let subdirCount = 0;
    for (const child of children) {
      if (child.type === "implicit") {
        subdirCount++;
      } else {
        const childIdx = this.pathIndex.get(child.path);
        if (childIdx !== void 0) {
          const childInode = this.readInode(childIdx);
          if (childInode.type === INODE_TYPE.DIRECTORY) subdirCount++;
        }
      }
    }
    const nlink = 2 + subdirCount;
    const buf = new Uint8Array(53);
    const view = new DataView(buf.buffer);
    view.setUint8(0, INODE_TYPE.DIRECTORY);
    view.setUint32(1, mode, true);
    view.setFloat64(5, 0, true);
    view.setFloat64(13, ts, true);
    view.setFloat64(21, ts, true);
    view.setFloat64(29, ts, true);
    view.setUint32(37, this.processUid, true);
    view.setUint32(41, this.processGid, true);
    view.setUint32(45, 0, true);
    view.setUint32(49, nlink, true);
    return { status: 0, data: buf };
  }
  getAllDescendants(dirPath) {
    const prefix = dirPath === "/" ? "/" : dirPath + "/";
    const descendants = [];
    for (const path of this.pathIndex.keys()) {
      if (path !== dirPath && path.startsWith(prefix)) descendants.push(path);
    }
    return descendants.sort((a, b) => {
      const da = a.split("/").length;
      const db = b.split("/").length;
      return db - da;
    });
  }
  ensureParent(path) {
    const lastSlash = path.lastIndexOf("/");
    if (lastSlash <= 0) return 0;
    const parentPath = path.substring(0, lastSlash);
    const parentIdx = this.pathIndex.get(parentPath);
    if (parentIdx === void 0) {
      if (this.isImplicitDirectory(parentPath)) return 0;
      return CODE_TO_STATUS.ENOENT;
    }
    const parentInode = this.readInode(parentIdx);
    if (parentInode.type !== INODE_TYPE.DIRECTORY) return CODE_TO_STATUS.ENOTDIR;
    return 0;
  }
  /** Clean up all fds owned by a tab */
  cleanupTab(tabId) {
    for (const [fd, entry] of this.fdTable) {
      if (entry.tabId === tabId) {
        this.fdTable.delete(fd);
      }
    }
  }
  /** Get all file paths and their data for OPFS sync */
  getAllFiles() {
    const files = [];
    for (const [path, idx] of this.pathIndex) {
      files.push({ path, idx });
    }
    return files;
  }
  /** Get file path for a file descriptor (used by OPFS sync for FD-based ops) */
  getPathForFd(fd) {
    const entry = this.fdTable.get(fd);
    if (!entry) return null;
    const inode = this.readInode(entry.inodeIdx);
    return this.readPath(inode.pathOffset, inode.pathLength);
  }
  /** Get file data by inode index */
  getInodeData(idx) {
    const inode = this.readInode(idx);
    const data = inode.size > 0 ? this.readData(inode.firstBlock, inode.blockCount, inode.size) : new Uint8Array(0);
    return { type: inode.type, data, mtime: inode.mtime };
  }
  /** Export all files/dirs/symlinks from the VFS */
  exportAll() {
    const result = [];
    for (const [path, idx] of this.pathIndex) {
      const inode = this.readInode(idx);
      let data = null;
      if (inode.type === INODE_TYPE.FILE || inode.type === INODE_TYPE.SYMLINK) {
        data = inode.size > 0 ? this.readData(inode.firstBlock, inode.blockCount, inode.size) : new Uint8Array(0);
      }
      result.push({ path, type: inode.type, data, mode: inode.mode, mtime: inode.mtime });
    }
    result.sort((a, b) => {
      if (a.type === INODE_TYPE.DIRECTORY && b.type !== INODE_TYPE.DIRECTORY) return -1;
      if (a.type !== INODE_TYPE.DIRECTORY && b.type === INODE_TYPE.DIRECTORY) return 1;
      return a.path.localeCompare(b.path);
    });
    return result;
  }
  flush() {
    this.handle.flush();
  }
};

// src/protocol/opcodes.ts
var OP = {
  READ: 1,
  WRITE: 2,
  UNLINK: 3,
  STAT: 4,
  LSTAT: 5,
  MKDIR: 6,
  RMDIR: 7,
  READDIR: 8,
  RENAME: 9,
  EXISTS: 10,
  TRUNCATE: 11,
  APPEND: 12,
  COPY: 13,
  ACCESS: 14,
  REALPATH: 15,
  CHMOD: 16,
  CHOWN: 17,
  UTIMES: 18,
  SYMLINK: 19,
  READLINK: 20,
  LINK: 21,
  OPEN: 22,
  CLOSE: 23,
  FREAD: 24,
  FWRITE: 25,
  FSTAT: 26,
  FTRUNCATE: 27,
  FSYNC: 28,
  OPENDIR: 29,
  MKDTEMP: 30,
  FCHMOD: 31,
  FCHOWN: 32,
  FUTIMES: 33,
  STATFS: 34
};
var encoder2 = new TextEncoder();
var decoder2 = new TextDecoder();
function decodeRequest(buf) {
  if (buf.byteLength < 16) {
    throw new Error(`Request buffer too small: ${buf.byteLength} < 16 bytes (possible SAB race)`);
  }
  const view = new DataView(buf);
  const op = view.getUint32(0, true);
  const flags = view.getUint32(4, true);
  const pathLen = view.getUint32(8, true);
  const dataLen = view.getUint32(12, true);
  const expectedMin = 16 + pathLen + dataLen;
  if (buf.byteLength < expectedMin) {
    throw new Error(`Request buffer truncated: ${buf.byteLength} < ${expectedMin} bytes (op=${op}, pathLen=${pathLen}, dataLen=${dataLen})`);
  }
  const bytes = new Uint8Array(buf);
  const path = decoder2.decode(bytes.subarray(16, 16 + pathLen));
  const data = dataLen > 0 ? bytes.subarray(16 + pathLen, 16 + pathLen + dataLen) : null;
  return { op, flags, path, data };
}
function encodeResponse(status, data) {
  const dataLen = data ? data.byteLength : 0;
  const buf = new ArrayBuffer(8 + dataLen);
  const view = new DataView(buf);
  view.setUint32(0, status, true);
  view.setUint32(4, dataLen, true);
  if (data) {
    new Uint8Array(buf).set(data, 8);
  }
  return buf;
}
function decodeSecondPath(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const pathLen = view.getUint32(0, true);
  return decoder2.decode(data.subarray(4, 4 + pathLen));
}

// src/protocol/payloads.ts
var viewOf = (d) => new DataView(d.buffer, d.byteOffset, d.byteLength);
var tooShort = (d, n) => !d || d.byteLength < n;
function decodeModeArg(data) {
  return tooShort(data, 4) ? null : viewOf(data).getUint32(0, true);
}
function decodeTruncateArgs(data) {
  return tooShort(data, 8) ? null : viewOf(data).getFloat64(0, true);
}
function decodeChownArgs(data) {
  if (tooShort(data, 8)) return null;
  const dv = viewOf(data);
  return { uid: dv.getUint32(0, true), gid: dv.getUint32(4, true) };
}
function decodeTimesArgs(data) {
  if (tooShort(data, 16)) return null;
  const dv = viewOf(data);
  return { atime: dv.getFloat64(0, true), mtime: dv.getFloat64(8, true) };
}
function decodeFdArg(data) {
  return tooShort(data, 4) ? null : viewOf(data).getUint32(0, true);
}
function decodeFreadArgs(data) {
  if (tooShort(data, 16)) return null;
  const dv = viewOf(data);
  const pos = dv.getFloat64(8, true);
  return { fd: dv.getUint32(0, true), length: dv.getUint32(4, true), position: pos === -1 ? null : pos };
}
function decodeFwriteArgs(data) {
  if (tooShort(data, 12)) return null;
  const dv = viewOf(data);
  const pos = dv.getFloat64(4, true);
  return { fd: dv.getUint32(0, true), position: pos === -1 ? null : pos, bytes: data.subarray(12) };
}
function decodeFtruncateArgs(data) {
  if (tooShort(data, 12)) return null;
  const dv = viewOf(data);
  return { fd: dv.getUint32(0, true), len: dv.getFloat64(4, true) };
}
function decodeFchmodArgs(data) {
  if (tooShort(data, 8)) return null;
  const dv = viewOf(data);
  return { fd: dv.getUint32(0, true), mode: dv.getUint32(4, true) };
}
function decodeFchownArgs(data) {
  if (tooShort(data, 12)) return null;
  const dv = viewOf(data);
  return { fd: dv.getUint32(0, true), uid: dv.getUint32(4, true), gid: dv.getUint32(8, true) };
}
function decodeFutimesArgs(data) {
  if (tooShort(data, 24)) return null;
  const dv = viewOf(data);
  return { fd: dv.getUint32(0, true), atime: dv.getFloat64(8, true), mtime: dv.getFloat64(16, true) };
}

// src/protocol/dispatch.ts
var DEFAULT_MKDIR_MODE = 511;
var DEFAULT_OPEN_MODE = 438;
var EINVAL = CODE_TO_STATUS.EINVAL;
function decodeMode(data, fallback) {
  return decodeModeArg(data ?? null) ?? fallback;
}
function dispatchOp(engine2, tabId, op, flags, path, data) {
  switch (op) {
    case OP.READ:
      return engine2.read(path);
    case OP.WRITE:
      return engine2.write(path, data ?? new Uint8Array(0), flags);
    case OP.APPEND:
      return engine2.append(path, data ?? new Uint8Array(0));
    case OP.UNLINK:
      return engine2.unlink(path);
    case OP.STAT:
      return engine2.stat(path);
    case OP.LSTAT:
      return engine2.lstat(path);
    case OP.MKDIR:
      return engine2.mkdir(path, flags, decodeMode(data, DEFAULT_MKDIR_MODE));
    case OP.RMDIR:
      return engine2.rmdir(path, flags);
    case OP.READDIR:
      return engine2.readdir(path, flags);
    case OP.RENAME:
      return engine2.rename(path, data ? decodeSecondPath(data) : "");
    case OP.EXISTS:
      return engine2.exists(path);
    case OP.COPY:
      return engine2.copy(path, data ? decodeSecondPath(data) : "", flags);
    case OP.ACCESS:
      return engine2.access(path, flags);
    case OP.REALPATH:
      return engine2.realpath(path);
    case OP.READLINK:
      return engine2.readlink(path);
    case OP.LINK:
      return engine2.link(path, data ? decodeSecondPath(data) : "");
    case OP.OPENDIR:
      return engine2.opendir(path, tabId);
    case OP.MKDTEMP:
      return engine2.mkdtemp(path);
    case OP.FSYNC:
      return engine2.fsync();
    case OP.STATFS:
      return engine2.statfs(path);
    case OP.TRUNCATE: {
      const len = decodeTruncateArgs(data);
      return len === null ? { status: EINVAL } : engine2.truncate(path, len);
    }
    case OP.CHMOD: {
      const mode = decodeModeArg(data);
      return mode === null ? { status: EINVAL } : engine2.chmod(path, mode);
    }
    case OP.CHOWN: {
      const a = decodeChownArgs(data);
      return a === null ? { status: EINVAL } : engine2.chown(path, a.uid, a.gid);
    }
    case OP.UTIMES: {
      const a = decodeTimesArgs(data);
      return a === null ? { status: EINVAL } : engine2.utimes(path, a.atime, a.mtime);
    }
    case OP.SYMLINK:
      return engine2.symlink(data ? new TextDecoder().decode(data) : "", path);
    case OP.OPEN:
      return engine2.open(path, flags, tabId, decodeMode(data, DEFAULT_OPEN_MODE));
    case OP.CLOSE: {
      const fd = decodeFdArg(data);
      return fd === null ? { status: EINVAL } : engine2.close(fd);
    }
    case OP.FREAD: {
      const a = decodeFreadArgs(data);
      return a === null ? { status: EINVAL } : engine2.fread(a.fd, a.length, a.position);
    }
    case OP.FWRITE: {
      const a = decodeFwriteArgs(data);
      return a === null ? { status: EINVAL } : engine2.fwrite(a.fd, a.bytes, a.position);
    }
    case OP.FSTAT: {
      const fd = decodeFdArg(data);
      return fd === null ? { status: EINVAL } : engine2.fstat(fd);
    }
    case OP.FTRUNCATE: {
      const a = decodeFtruncateArgs(data);
      return a === null ? { status: EINVAL } : engine2.ftruncate(a.fd, a.len);
    }
    case OP.FCHMOD: {
      const a = decodeFchmodArgs(data);
      return a === null ? { status: EINVAL } : engine2.fchmod(a.fd, a.mode);
    }
    case OP.FCHOWN: {
      const a = decodeFchownArgs(data);
      return a === null ? { status: EINVAL } : engine2.fchown(a.fd, a.uid, a.gid);
    }
    case OP.FUTIMES: {
      const a = decodeFutimesArgs(data);
      return a === null ? { status: EINVAL } : engine2.futimes(a.fd, a.atime, a.mtime);
    }
    default:
      return { status: EINVAL };
  }
}
var DISPATCHED_OPS = /* @__PURE__ */ new Set([
  OP.READ,
  OP.WRITE,
  OP.APPEND,
  OP.UNLINK,
  OP.STAT,
  OP.LSTAT,
  OP.MKDIR,
  OP.RMDIR,
  OP.READDIR,
  OP.RENAME,
  OP.EXISTS,
  OP.TRUNCATE,
  OP.COPY,
  OP.ACCESS,
  OP.REALPATH,
  OP.CHMOD,
  OP.CHOWN,
  OP.UTIMES,
  OP.SYMLINK,
  OP.READLINK,
  OP.LINK,
  OP.OPEN,
  OP.CLOSE,
  OP.FREAD,
  OP.FWRITE,
  OP.FSTAT,
  OP.FTRUNCATE,
  OP.FSYNC,
  OP.OPENDIR,
  OP.MKDTEMP,
  OP.FCHMOD,
  OP.FCHOWN,
  OP.FUTIMES,
  OP.STATFS
]);

// src/workers/server.worker.ts
var engine = new VFSEngine();
var ports = /* @__PURE__ */ new Map();
var opfsSyncPort = null;
var config = {
  root: "/",
  opfsSync: true,
  uid: 0,
  gid: 0,
  umask: 18,
  strictPermissions: false
};
function handleRequest(tabId, buffer) {
  const { op, flags, path, data } = decodeRequest(buffer);
  const result = dispatchOp(engine, tabId, op, flags, path, data);
  if (result.status === 0) notifyMirror(op, path, data);
  const responseData = result.data instanceof Uint8Array ? result.data : void 0;
  return encodeResponse(result.status, responseData);
}
function notifyMirror(op, path, data) {
  if (!opfsSyncPort) return;
  switch (op) {
    case OP.WRITE:
    case OP.APPEND:
      notifyOPFSSync("write", path, data);
      break;
    case OP.UNLINK:
    case OP.RMDIR:
      notifyOPFSSync("delete", path);
      break;
    case OP.MKDIR:
      notifyOPFSSync("mkdir", path);
      break;
    case OP.RENAME:
      notifyOPFSSync("rename", path, void 0, data ? decodeSecondPath(data) : "");
      break;
  }
}
function notifyOPFSSync(op, path, data, newPath) {
  if (!opfsSyncPort) return;
  const msg = { op, path, ts: Date.now() };
  const transfers = [];
  if (op === "write" && data) {
    const copy = data.slice().buffer;
    msg.data = copy;
    transfers.push(copy);
  }
  if (op === "rename" && newPath) {
    msg.newPath = newPath;
  }
  opfsSyncPort.postMessage(msg, transfers);
}
function setupClientPort(tabId, port) {
  ports.set(tabId, port);
  port.onmessage = (e) => {
    const { buffer, id } = e.data;
    if (buffer instanceof ArrayBuffer) {
      let response;
      try {
        response = handleRequest(tabId, buffer);
      } catch (err) {
        console.error("[server.worker] handleRequest threw:", err?.message);
        response = encodeResponse(11, void 0);
      }
      port.postMessage({ id, buffer: response }, [response]);
    }
  };
  port.start();
}
function onTabLost(tabId) {
  engine.cleanupTab(tabId);
  const port = ports.get(tabId);
  if (port) {
    port.close();
    ports.delete(tabId);
  }
}
async function init(initData) {
  config = initData;
  let rootDir = await navigator.storage.getDirectory();
  if (config.root && config.root !== "/") {
    const segments = config.root.split("/").filter(Boolean);
    for (const segment of segments) {
      rootDir = await rootDir.getDirectoryHandle(segment, { create: true });
    }
  }
  const vfsFileHandle = await rootDir.getFileHandle(".vfs.bin", { create: true });
  const vfsHandle = await vfsFileHandle.createSyncAccessHandle();
  engine.init(vfsHandle, {
    uid: config.uid,
    gid: config.gid,
    umask: config.umask,
    strictPermissions: config.strictPermissions
  });
}
self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    await init(msg.config);
    self.postMessage({ type: "ready" });
    return;
  }
  if (msg.type === "port") {
    setupClientPort(msg.tabId, msg.port);
    return;
  }
  if (msg.type === "tab-lost") {
    onTabLost(msg.tabId);
    return;
  }
  if (msg.type === "opfs-sync-port") {
    opfsSyncPort = msg.port;
    opfsSyncPort.start();
    return;
  }
  if (msg.buffer instanceof ArrayBuffer) {
    const tabId = msg.tabId || "local";
    const response = handleRequest(tabId, msg.buffer);
    self.postMessage(
      { id: msg.id, buffer: response },
      [response]
    );
  }
};
//# sourceMappingURL=server.worker.js.map