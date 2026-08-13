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
  MAX_SYMLINK_DEPTH, INITIAL_DATA_BLOCKS, INITIAL_PATH_TABLE_SIZE, MAX_DATA_BLOCKS,
  calculateLayout,
} from './layout.js';
import { crc32 } from './crc32.js';
import { CODE_TO_STATUS } from '../errors.js';

const encoder = new TextEncoder();

// Free trailing-block headroom maintained by pre-growth (maybePreGrow) and
// preserved by trimTrailingBlocks. 16384 blocks = 64MB at the default 4KB
// block size.
//
// Why so large: on WebKit, ANY size-changing OPFS call (truncate or
// extending write — both verified empirically) blocks until the page's
// main thread returns to its event loop. A busy-spinning sync caller
// therefore DEADLOCKS file growth until the caller's stall guard gives up.
// Growth is consequently only performed at provably-safe moments (engine
// init, ≥25ms-quiet idle), and the headroom must be large enough that a
// burst of back-to-back sync writes never exhausts it mid-burst. Bursts
// writing more than this between quiet periods fall back to in-request
// growth, which on WebKit costs a stall-guard abort (EIO) for that one op.
const PREGROW_HEADROOM_BLOCKS = 16384;
const decoder = new TextDecoder();

/** Is `child` strictly below `parent` in the tree? Both must be normalized. */
function isUnder(child: string, parent: string): boolean {
  return parent === '/' ? child !== '/' : child.startsWith(parent + '/');
}

interface Inode {
  type: number;
  pathOffset: number;
  pathLength: number;
  mode: number;
  size: number;
  /** Index of the first data block — or, for an INODE_TYPE.HARDLINK entry, the index of the
   *  inode this name is a second name for (that entry owns no blocks). See INODE.LINK_TARGET. */
  firstBlock: number;
  blockCount: number;
  mtime: number;
  ctime: number;
  atime: number;
  uid: number;
  gid: number;
  nlink: number;
}

interface FdEntry {
  tabId: string;
  inodeIdx: number;
  position: number;
  flags: number;
  implicitPath?: string; // set when fd was opened via opendir on an implicit directory
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

  /**
   * Whether an fd's open flags permit reading / writing.
   *
   * The low two bits of the flags are the access mode (O_RDONLY=0, O_WRONLY=1, O_RDWR=2). These
   * were not enforced: reading from a descriptor opened `'w'` returned 0 bytes instead of EBADF,
   * and writing through one opened `'r'` succeeded. Both are errors in Node, and code that
   * relies on the error to detect a mis-opened file saw silence instead. Found by the fd fuzzer.
   */
  private static isReadable(flags: number): boolean {
    const mode = flags & 3;
    return mode === 0 /* O_RDONLY */ || mode === 2 /* O_RDWR */;
  }

  private static isWritable(flags: number): boolean {
    const mode = flags & 3;
    return mode === 1 /* O_WRONLY */ || mode === 2 /* O_RDWR */;
  }

  // Reusable buffers to avoid allocations
  private inodeBuf = new Uint8Array(INODE_SIZE);
  private inodeView = new DataView(this.inodeBuf.buffer);

  // In-memory inode cache — eliminates disk reads for hot inodes
  private inodeCache = new Map<number, Inode>();
  private superblockBuf = new Uint8Array(SUPERBLOCK.SIZE);
  private superblockView = new DataView(this.superblockBuf.buffer);

  // In-memory bitmap cache — eliminates bitmap reads from OPFS
  private bitmap: Uint8Array | null = null;
  private bitmapDirtyLo = Infinity;   // lowest dirty byte index
  private bitmapDirtyHi = -1;         // highest dirty byte index (inclusive)
  private superblockDirty = false;

  // Free inode hint — skip O(n) scan
  private freeInodeHint = 0;

  // Implicit directory support — tracks all directory prefixes implied by file paths.
  // Rebuilt lazily when pathIndex changes (tracked via generation counter).
  // Map value is the stable timestamp (ms since epoch) assigned when the implicit
  // dir was first discovered, so that stat() returns consistent mtime/ctime/atime
  // across repeated calls.
  private implicitDirs = new Map<string, number>();
  private implicitDirsGen = -1;  // generation when implicitDirs was last rebuilt
  private pathIndexGen = 0;      // bumped on every pathIndex mutation

  // Incrementally maintained "number of pathIndex entries that have this
  // path as a strict ancestor" map. Lets `isImplicitDirectory` answer in
  // O(1) — an implicit dir P is exactly !pathIndex.has(P) && descCount[P] > 0.
  // Without this, every `isImplicitDirectory` call triggered an O(N×depth)
  // rebuild of `implicitDirs`, and the 3.0.49 fix put one of those calls on
  // the hot path of every fresh write/symlink/link/copy — making batch
  // writes O(N²) on total path count.
  private descCount = new Map<string, number>();
  // descCount is in sync with pathIndex iff descCountGen >= pathIndexGen.
  // Helpers `setPathIndex`/`deletePathIndex` keep them in sync. Code that
  // mutates `pathIndex` directly (only test scaffolding does this in
  // practice — see the implicit-directory tests in vfs-engine.test.ts)
  // bumps `pathIndexGen` without going through the helpers, which leaves
  // descCount stale; `isImplicitDirectory` notices the mismatch and
  // recomputes descCount on demand.
  private descCountGen = 0;

  // Incrementally maintained directory-children index: parent dir path →
  // (child name → number of pathIndex entries whose path passes through
  // parent/name). Lets getDirectChildren / getDirectChildrenWithImplicit
  // answer in O(children) instead of scanning every path in the volume,
  // which made readdir and directory-stat O(total files) per call.
  // A child name with refcount > 0 but no pathIndex entry of its own is an
  // implicit directory. Same staleness contract as descCount: in sync iff
  // childIndexGen >= pathIndexGen, rebuilt from scratch on demand when test
  // scaffolding mutates pathIndex directly.
  private childIndex = new Map<string, Map<string, number>>();
  private childIndexGen = 0;

  // ---- Hard links ----
  //
  // A hard link is a second NAME for an existing inode, stored on disk as its own
  // INODE_TYPE.HARDLINK entry holding that name plus the target's inode index. The
  // path index maps the link's path straight to the TARGET inode, so read, write,
  // stat, truncate and every other path operation reach one shared inode with no
  // special-casing anywhere. These two maps hold the part the path index cannot
  // express — which names are links, and which inode owns which name:
  //
  //   linkInodes        link path → the HARDLINK inode that owns that directory entry
  //   linkPathsByTarget target idx → every link path pointing at it
  //
  // Both are rebuilt from the inode table in `rebuildIndex`, which is what makes the
  // second name survive a reload. An earlier attempt registered the extra name only
  // in `pathIndex`; since the index is rebuilt by scanning inodes, and an inode
  // stores exactly one path, that name silently disappeared on the next mount.
  private linkInodes = new Map<string, number>();
  private linkPathsByTarget = new Map<number, Set<string>>();

  /** Where the next block search resumes — see allocateBlocks. Reset on mount/format. */
  private allocCursor = 0;

  /**
   * Set when path resolution gave up because a symlink chain exceeded MAX_SYMLINK_DEPTH.
   *
   * The resolvers return `undefined` for both "not there" and "went in circles", which every
   * caller then reported as ENOENT — so a symlink pointing at itself looked like a missing file
   * instead of the ELOOP Node reports. Reset at the start of every top-level resolve and read
   * immediately after, via `resolveFailureStatus`.
   */
  private symlinkLoopDetected = false;

  /** ENOENT, or ELOOP when the last resolve gave up on a symlink cycle. */
  private resolveFailureStatus(): number {
    return this.symlinkLoopDetected ? CODE_TO_STATUS.ELOOP : CODE_TO_STATUS.ENOENT;
  }

  // Configurable upper bounds
  private maxInodes = 4_000_000;
  // Default ceiling on data blocks. The on-disk bitmap region is reserved for
  // this many blocks at format time (see calculateLayout), so the effective
  // limit and the reserved bitmap capacity stay in lock-step. Sourced from the
  // shared layout constant so both agree.
  private maxBlocks = MAX_DATA_BLOCKS;
  private maxPathTable = 256 * 1024 * 1024; // 256MB
  private maxVFSSize = 100 * 1024 * 1024 * 1024; // 100GB

  init(
    handle: FileSystemSyncAccessHandle,
    opts?: {
      uid?: number; gid?: number; umask?: number; strictPermissions?: boolean; debug?: boolean;
      limits?: { maxInodes?: number; maxBlocks?: number; maxPathTable?: number; maxVFSSize?: number };
    }
  ): void {
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
        // Ensure all mount errors are prefixed with "Corrupt VFS:" so the
        // sync-relay handler recognizes them as corruption (not OPFS contention)
        // and triggers fallback instead of infinite retry.
        const msg = (err as Error).message ?? String(err);
        if (msg.startsWith('Corrupt VFS:')) throw err;
        throw new Error(`Corrupt VFS: ${msg}`);
      }
    }
  }

  /** Release the sync access handle (call on fatal error or shutdown) */
  closeHandle(): void {
    try {
      this.handle?.close();
    } catch (_) {
      // Ignore — handle may already be closed
    }
  }

  /** Format a fresh VFS */
  private format(): void {
    // Reserve the bitmap region for `this.maxBlocks` (honors opts.limits.maxBlocks)
    // so the bitmap never overflows into the data region as the FS grows.
    const layout = calculateLayout(DEFAULT_INODE_COUNT, DEFAULT_BLOCK_SIZE, INITIAL_DATA_BLOCKS, this.maxBlocks);

    // A fresh volume has no names at all. `mount` clears these via rebuildIndex;
    // `format` has no rebuild, so it clears them here — an engine object can be
    // re-init'd onto a different handle.
    this.linkInodes.clear();
    this.linkPathsByTarget.clear();

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

    // Zero out bitmap and cache in memory
    this.bitmap = new Uint8Array(layout.bitmapSize);
    this.handle.write(this.bitmap, { at: this.bitmapOffset });

    // Create root directory inode
    this.createInode('/', INODE_TYPE.DIRECTORY, DEFAULT_DIR_MODE, 0);

    // Re-write superblock with updated pathTableUsed (createInode appended "/" to path table)
    this.writeSuperblock();
    this.handle.flush();
  }

  /** Mount an existing VFS from disk — validates superblock integrity */
  private mount(): void {
    const fileSize = this.handle.getSize();
    if (fileSize < SUPERBLOCK.SIZE) {
      throw new Error(`Corrupt VFS: file too small (${fileSize} bytes, need at least ${SUPERBLOCK.SIZE})`);
    }

    this.handle.read(this.superblockBuf, { at: 0 });
    const v = this.superblockView;

    // Validate magic
    const magic = v.getUint32(SUPERBLOCK.MAGIC, true);
    if (magic !== VFS_MAGIC) {
      throw new Error(`Corrupt VFS: bad magic 0x${magic.toString(16)} (expected 0x${VFS_MAGIC.toString(16)})`);
    }

    // Validate version
    const version = v.getUint32(SUPERBLOCK.VERSION, true);
    if (version !== VFS_VERSION) {
      throw new Error(`Corrupt VFS: unsupported version ${version} (expected ${VFS_VERSION})`);
    }

    // Validate checksum (0 = legacy pre-CRC file: skip, upgraded on next
    // superblock write). A mismatch means the superblock was torn or
    // corrupted — fail mount so the repair path takes over rather than
    // trusting bogus layout fields.
    const storedCrc = v.getUint32(SUPERBLOCK.CRC32, true);
    if (storedCrc !== 0) {
      const computedCrc = crc32(this.superblockBuf, 0, SUPERBLOCK.CRC32);
      if (computedCrc !== storedCrc) {
        throw new Error(
          `Corrupt VFS: superblock checksum mismatch (stored 0x${storedCrc.toString(16)}, computed 0x${computedCrc.toString(16)})`
        );
      }
    }

    // Read superblock fields
    const inodeCount = v.getUint32(SUPERBLOCK.INODE_COUNT, true);
    const blockSize = v.getUint32(SUPERBLOCK.BLOCK_SIZE, true);
    const totalBlocks = v.getUint32(SUPERBLOCK.TOTAL_BLOCKS, true);
    const freeBlocks = v.getUint32(SUPERBLOCK.FREE_BLOCKS, true);
    const inodeTableOffset = v.getFloat64(SUPERBLOCK.INODE_OFFSET, true);
    const pathTableOffset = v.getFloat64(SUPERBLOCK.PATH_OFFSET, true);
    const dataOffset = v.getFloat64(SUPERBLOCK.DATA_OFFSET, true);
    const bitmapOffset = v.getFloat64(SUPERBLOCK.BITMAP_OFFSET, true);
    const pathUsed = v.getUint32(SUPERBLOCK.PATH_USED, true);

    // Validate field sanity
    if (blockSize === 0 || (blockSize & (blockSize - 1)) !== 0) {
      throw new Error(`Corrupt VFS: invalid block size ${blockSize} (must be power of 2)`);
    }
    if (inodeCount === 0) {
      throw new Error('Corrupt VFS: inode count is 0');
    }
    if (freeBlocks > totalBlocks) {
      throw new Error(`Corrupt VFS: free blocks (${freeBlocks}) exceeds total blocks (${totalBlocks})`);
    }

    // Sane upper bounds — prevent huge allocations from corrupt values.
    // Configurable via opts.limits in init().
    if (inodeCount > this.maxInodes) {
      throw new Error(`Corrupt VFS: inode count ${inodeCount} exceeds maximum ${this.maxInodes}`);
    }
    if (totalBlocks > this.maxBlocks) {
      throw new Error(`Corrupt VFS: total blocks ${totalBlocks} exceeds maximum ${this.maxBlocks}`);
    }
    if (fileSize > this.maxVFSSize) {
      throw new Error(`Corrupt VFS: file size ${fileSize} exceeds maximum ${this.maxVFSSize}`);
    }

    // Validate all offsets are finite positive integers
    if (!Number.isFinite(inodeTableOffset) || inodeTableOffset < 0 ||
        !Number.isFinite(pathTableOffset) || pathTableOffset < 0 ||
        !Number.isFinite(bitmapOffset) || bitmapOffset < 0 ||
        !Number.isFinite(dataOffset) || dataOffset < 0) {
      throw new Error(`Corrupt VFS: non-finite or negative section offset`);
    }

    // Validate section ordering: superblock < inodes < paths < bitmap < data
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
    // The bitmap [bitmapOffset, dataOffset) must be able to represent every
    // block. If totalBlocks exceeds the region's capacity the on-disk bitmap
    // overlaps file data (the pre-fix overflow bug) — the bitmap we're about to
    // read is partly garbage, so fail the mount rather than trust it.
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

    // Validate file is large enough for the declared layout
    const expectedMinSize = dataOffset + totalBlocks * blockSize;
    if (expectedMinSize > this.maxVFSSize) {
      throw new Error(`Corrupt VFS: computed layout size ${expectedMinSize} exceeds maximum ${this.maxVFSSize}`);
    }
    if (fileSize < expectedMinSize) {
      throw new Error(`Corrupt VFS: file size ${fileSize} too small for layout (need ${expectedMinSize})`);
    }

    // All checks passed — commit to engine state
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

    // Load bitmap into memory
    const bitmapSize = Math.ceil(this.totalBlocks / 8);
    this.bitmap = new Uint8Array(bitmapSize);
    this.handle.read(this.bitmap, { at: this.bitmapOffset });

    this.rebuildIndex();

    // Verify root directory exists
    if (!this.pathIndex.has('/')) {
      throw new Error('Corrupt VFS: root directory "/" not found in inode table');
    }
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
    // Checksum everything before the CRC field; written in the same 64-byte
    // write so a torn superblock write is detectable at mount.
    v.setUint32(SUPERBLOCK.CRC32, crc32(this.superblockBuf, 0, SUPERBLOCK.CRC32), true);
    this.handle.write(this.superblockBuf, { at: 0 });
  }

  /** Flush pending bitmap and superblock writes to disk (one write each) */
  private markBitmapDirty(lo: number, hi: number): void {
    if (lo < this.bitmapDirtyLo) this.bitmapDirtyLo = lo;
    if (hi > this.bitmapDirtyHi) this.bitmapDirtyHi = hi;
  }

  private commitPending(): void {
    // Trim trailing free blocks before flushing bitmap/superblock
    if (this.blocksFreedsinceTrim) {
      this.trimTrailingBlocks();
      this.blocksFreedsinceTrim = false;
    }

    if (this.bitmapDirtyHi >= 0) {
      const lo = this.bitmapDirtyLo;
      const hi = this.bitmapDirtyHi;
      this.handle.write(this.bitmap!.subarray(lo, hi + 1), { at: this.bitmapOffset + lo });
      this.bitmapDirtyLo = Infinity;
      this.bitmapDirtyHi = -1;
    }
    if (this.superblockDirty) {
      this.writeSuperblock();
      this.superblockDirty = false;
    }
  }

  /** Find the last used block index (-1 if the data region is empty). */
  private findLastUsedBlock(): number {
    const bitmap = this.bitmap!;
    for (let byteIdx = Math.ceil(this.totalBlocks / 8) - 1; byteIdx >= 0; byteIdx--) {
      if (bitmap[byteIdx] !== 0) {
        for (let bit = 7; bit >= 0; bit--) {
          const blockIdx = byteIdx * 8 + bit;
          if (blockIdx < this.totalBlocks && (bitmap[byteIdx] & (1 << bit))) {
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
  private trimTrailingBlocks(): void {
    const lastUsed = this.findLastUsedBlock();

    const newTotal = Math.max(lastUsed + 1 + PREGROW_HEADROOM_BLOCKS, INITIAL_DATA_BLOCKS);
    if (newTotal >= this.totalBlocks) return; // nothing to trim

    // Truncate the OPFS file
    this.handle.truncate(this.dataOffset + newTotal * this.blockSize);

    // Shrink in-memory bitmap
    const newBitmapSize = Math.ceil(newTotal / 8);
    this.bitmap = this.bitmap!.slice(0, newBitmapSize);

    // Update counters
    const trimmed = this.totalBlocks - newTotal;
    this.freeBlocks -= trimmed; // these free blocks no longer exist
    this.totalBlocks = newTotal;
    this.superblockDirty = true;

    // Re-mark entire bitmap dirty so the smaller bitmap is flushed
    this.bitmapDirtyLo = 0;
    this.bitmapDirtyHi = newBitmapSize - 1;
  }

  // Throttle for maybePreGrow's tail scan (cheap, but no need to run it
  // thousands of times per second from the dispatch loop's idle phase).
  private lastPreGrowCheck = 0;

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
  maybePreGrow(force = false): boolean {
    if (!this.bitmap) return false;
    const now = Date.now();
    if (!force && now - this.lastPreGrowCheck < 250) return false;
    this.lastPreGrowCheck = now;

    const trailingFree = this.totalBlocks - (this.findLastUsedBlock() + 1);
    if (trailingFree >= PREGROW_HEADROOM_BLOCKS) return false;

    // Round to whole bitmap bytes; respect both the configured block ceiling
    // and the reserved bitmap-region capacity (never grow the bitmap into data).
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
    this.commitPending(); // flush now, while idle
    return true;
  }

  /** Rebuild in-memory path→inode index from disk.
   *  Bulk-reads the entire inode table + path table in 2 I/O calls,
   *  then parses in memory (avoids 10k+ individual reads). */
  private rebuildIndex(): void {
    this.pathIndex.clear();
    this.inodeCache.clear();
    this.linkInodes.clear();
    this.linkPathsByTarget.clear();

    // Hard-link entries are registered in a second pass: an entry can appear in the
    // table before the inode it names, so its target is only guaranteed to be loaded
    // once the whole table has been read.
    const pendingLinks: { idx: number; path: string; targetIdx: number }[] = [];

    // Bulk read entire inode table (e.g. 640KB for 10k inodes)
    const inodeTableSize = this.inodeCount * INODE_SIZE;
    const inodeBuf = new Uint8Array(inodeTableSize);
    this.handle.read(inodeBuf, { at: this.inodeTableOffset });
    const inodeView = new DataView(inodeBuf.buffer);

    // Bulk read used portion of path table
    const pathBuf = this.pathTableUsed > 0 ? new Uint8Array(this.pathTableUsed) : null;
    if (pathBuf) {
      this.handle.read(pathBuf, { at: this.pathTableOffset });
    }

    for (let i = 0; i < this.inodeCount; i++) {
      const off = i * INODE_SIZE;
      const type = inodeView.getUint8(off + INODE.TYPE);
      if (type === INODE_TYPE.FREE) continue;

      // Validate inode type
      if (type < INODE_TYPE.FILE || type > INODE_TYPE.HARDLINK) {
        throw new Error(`Corrupt VFS: inode ${i} has invalid type ${type}`);
      }

      const pathOffset = inodeView.getUint32(off + INODE.PATH_OFFSET, true);
      const pathLength = inodeView.getUint16(off + INODE.PATH_LENGTH, true);
      const size = inodeView.getFloat64(off + INODE.SIZE, true);
      const firstBlock = inodeView.getUint32(off + INODE.FIRST_BLOCK, true);
      const blockCount = inodeView.getUint32(off + INODE.BLOCK_COUNT, true);

      // Validate path bounds
      if (pathLength === 0 || pathOffset + pathLength > this.pathTableUsed) {
        throw new Error(`Corrupt VFS: inode ${i} path out of bounds (offset=${pathOffset}, len=${pathLength}, tableUsed=${this.pathTableUsed})`);
      }

      // Validate data bounds for files/symlinks. A hard-link entry owns no data —
      // its FIRST_BLOCK field is a target inode index, checked in the second pass —
      // and a directory owns none either.
      if (type === INODE_TYPE.FILE || type === INODE_TYPE.SYMLINK) {
        if (size < 0 || !isFinite(size)) {
          throw new Error(`Corrupt VFS: inode ${i} has invalid size ${size}`);
        }
        if (blockCount > 0 && firstBlock + blockCount > this.totalBlocks) {
          throw new Error(`Corrupt VFS: inode ${i} data blocks out of range (first=${firstBlock}, count=${blockCount}, total=${this.totalBlocks})`);
        }
      }

      const inode: Inode = {
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
        gid: inodeView.getUint32(off + INODE.GID, true),
      };
      this.inodeCache.set(i, inode);

      // Decode path from in-memory path table buffer (no disk read)
      let path: string;
      if (pathBuf) {
        path = decoder.decode(pathBuf.subarray(inode.pathOffset, inode.pathOffset + inode.pathLength));
      } else {
        path = this.readPath(inode.pathOffset, inode.pathLength);
      }

      // Validate path format
      if (!path.startsWith('/') || path.includes('\0')) {
        throw new Error(`Corrupt VFS: inode ${i} has invalid path "${path.substring(0, 50)}"`);
      }

      if (type === INODE_TYPE.HARDLINK) {
        // The name resolves to the TARGET, not to this entry — deferred so the
        // target is known to be loaded. `firstBlock` is INODE.LINK_TARGET here.
        pendingLinks.push({ idx: i, path, targetIdx: firstBlock });
        continue;
      }

      this.setPathIndex(path, i);
    }

    // Second pass: point every hard-link name at the inode it names. This is what
    // restores the shared inode across a remount.
    for (const link of pendingLinks) {
      const target = this.inodeCache.get(link.targetIdx);
      if (!target) {
        throw new Error(`Corrupt VFS: hard link inode ${link.idx} ("${link.path.substring(0, 50)}") targets inode ${link.targetIdx}, which is not in use`);
      }
      if (target.type !== INODE_TYPE.FILE && target.type !== INODE_TYPE.SYMLINK) {
        throw new Error(`Corrupt VFS: hard link inode ${link.idx} targets inode ${link.targetIdx} of type ${target.type}, which cannot be hard-linked`);
      }
      if (this.pathIndex.has(link.path)) {
        throw new Error(`Corrupt VFS: hard link inode ${link.idx} duplicates the path "${link.path.substring(0, 50)}"`);
      }
      this.setPathIndex(link.path, link.targetIdx);
      this.linkInodes.set(link.path, link.idx);
      this.trackLinkPath(link.targetIdx, link.path);
    }

    this.pathIndexGen++;
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
      nlink: v.getUint16(INODE.NLINK, true) || 1,
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

    // Defer superblock write — committed in commitPending()
    this.superblockDirty = true;

    return { offset, length: bytes.byteLength };
  }

  private growPathTable(needed: number): void {
    // Double the path table or grow to fit needed, whichever is larger
    const newSize = Math.max(this.pathTableSize * 2, needed + INITIAL_PATH_TABLE_SIZE);
    const growth = newSize - this.pathTableSize;

    // Grow file first so the shifted data has somewhere to land.
    const newTotalSize = this.handle.getSize() + growth;
    this.handle.truncate(newTotalSize);

    // Shift the data region forward by `growth` bytes. We must NOT allocate
    // a single buffer the size of the whole data section — when the VFS
    // holds a large install (pnpm linking ~1300 Directus packages puts the
    // data section in the hundreds of MB) the one-shot
    //   new Uint8Array(dataSize)
    // failed with "Array buffer allocation failed" because Chrome refuses
    // allocations near the 2 GB cap even with OS memory to spare.
    //
    // Copy back-to-front through a small scratch buffer so we never
    // overwrite bytes we haven't relocated yet, and the peak allocation
    // stays bounded at CHUNK regardless of how big the VFS has grown.
    const dataSize = this.totalBlocks * this.blockSize;
    const CHUNK = 4 * 1024 * 1024; // 4 MB
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

    // Write the (in-memory) bitmap to its new offset.
    const newBitmapOffset = this.bitmapOffset + growth;
    const newDataOffset = this.dataOffset + growth;
    this.handle.write(this.bitmap!, { at: newBitmapOffset });

    // Update offsets
    this.pathTableSize = newSize;
    this.bitmapOffset = newBitmapOffset;
    this.dataOffset = newDataOffset;

    // Mark superblock dirty (will be written in commitPending)
    this.superblockDirty = true;
  }

  // ========== Bitmap I/O ==========

  // Write `length` zero bytes at absolute file offset `at` via a small
  // reusable scratch buffer. Used to materialize POSIX "holes" when a
  // write starts past the current file size — those bytes must read as
  // zeros rather than whatever stale data happened to live in the
  // underlying storage blocks.
  private zeroFileRange(at: number, length: number, knownZeroFrom = Infinity): void {
    if (length <= 0) return;

    // Anything at or beyond `knownZeroFrom` is already zero, so writing zeros over it is pure
    // cost — and on a large grow it is the whole cost. Callers pass the volume's size as it was
    // *before* the allocation that prompted this call: every byte past that point was added by
    // `handle.truncate`, which pads with null bytes, so it reads as zeros without being touched.
    // Below it the bytes may belong to a block some other file used and freed, and those must not
    // become visible as this file's zero-filled extension — that part is written for real.
    //
    // The saving is the difference between a hole and a copy: growing a file to 4GB on a fresh
    // volume wrote 4GB of zeros in 4MB chunks (about a second, and every byte of it resident);
    // now it writes none.
    const end = Math.min(at + length, knownZeroFrom);
    if (end <= at) return;

    const CHUNK = 4 * 1024 * 1024;
    const total = end - at;
    const zeros = new Uint8Array(Math.min(total, CHUNK));
    let written = 0;
    while (written < total) {
      const n = Math.min(CHUNK, total - written);
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
  private allocateBlocks(count: number): number {
    if (count === 0) return 0;

    let start = this.scanForRun(this.allocCursor, this.totalBlocks, count);
    if (start < 0 && this.allocCursor > 0) {
      const wrapEnd = Math.min(this.allocCursor + count - 1, this.totalBlocks);
      start = this.scanForRun(0, wrapEnd, count);
    }

    // No contiguous space anywhere — grow the data region.
    if (start < 0) return this.growAndAllocate(count);

    const end = start + count - 1;
    const bitmap = this.bitmap!;
    for (let j = start; j <= end; j++) bitmap[j >>> 3] |= (1 << (j & 7));
    this.markBitmapDirty(start >>> 3, end >>> 3);
    this.freeBlocks -= count;
    this.superblockDirty = true;
    // Resume here next time. Past the end is fine: the wrap pass covers the rest.
    this.allocCursor = end + 1 >= this.totalBlocks ? 0 : end + 1;
    return start;
  }

  /**
   * First index in [from, to) starting a run of `count` free blocks, or -1.
   *
   * Fully-allocated bytes are skipped eight blocks at a time. That matters on a filling volume,
   * where the overwhelming majority of the bitmap the scan crosses is solid 0xFF.
   */
  private scanForRun(from: number, to: number, count: number): number {
    const bitmap = this.bitmap!;
    let run = 0;
    let start = from;

    for (let i = from; i < to; i++) {
      // Only safe to skip a whole byte when aligned and not partway through a run.
      if (run === 0 && (i & 7) === 0 && bitmap[i >>> 3] === 0xff) {
        i += 7;              // the loop's i++ steps past the last bit of the byte
        start = i + 1;
        continue;
      }
      if ((bitmap[i >>> 3] >>> (i & 7)) & 1) {
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
  private bitmapCapacityBlocks(): number {
    return (this.dataOffset - this.bitmapOffset) * 8;
  }

  private growAndAllocate(count: number): number {
    const oldTotal = this.totalBlocks;
    // Never grow past the reserved bitmap region or the configured ceiling —
    // either would push the bitmap into file data. If even the clamped total
    // can't fit the request, the volume is genuinely full.
    const hardCap = Math.min(this.maxBlocks, this.bitmapCapacityBlocks());
    let newTotal = Math.max(oldTotal * 2, oldTotal + count);
    if (newTotal > hardCap) newTotal = hardCap;
    if (newTotal < oldTotal + count) {
      throw new Error(`ENOSPC: cannot allocate ${count} blocks (total ${oldTotal}, ceiling ${hardCap})`);
    }
    const addedBlocks = newTotal - oldTotal;

    // Grow the file
    const newFileSize = this.dataOffset + newTotal * this.blockSize;
    this.handle.truncate(newFileSize);

    // Grow in-memory bitmap
    const newBitmapSize = Math.ceil(newTotal / 8);
    const newBitmap = new Uint8Array(newBitmapSize);
    newBitmap.set(this.bitmap!);
    this.bitmap = newBitmap;

    this.totalBlocks = newTotal;
    this.freeBlocks += addedBlocks;

    // Allocate from the newly freed area
    const start = oldTotal;
    for (let j = start; j < start + count; j++) {
      const bj = j >>> 3;
      const bi = j & 7;
      this.bitmap[bj] |= (1 << bi);
    }

    this.markBitmapDirty(start >>> 3, (start + count - 1) >>> 3);
    this.freeBlocks -= count;
    this.superblockDirty = true;

    return start;
  }

  private blocksFreedsinceTrim = false;

  private freeBlockRange(start: number, count: number): void {
    if (count === 0) return;
    const bitmap = this.bitmap!;

    for (let i = start; i < start + count; i++) {
      const byteIdx = i >>> 3;
      const bitIdx = i & 7;
      bitmap[byteIdx] &= ~(1 << bitIdx);
    }

    this.markBitmapDirty(start >>> 3, (start + count - 1) >>> 3);
    this.freeBlocks += count;
    this.superblockDirty = true;
    this.blocksFreedsinceTrim = true;
  }

  // updateSuperblockFreeBlocks is no longer needed — superblock writes are coalesced via commitPending()

  // ========== Inode allocation ==========

  private findFreeInode(): number {
    // Start from hint to skip already-used entries
    for (let i = this.freeInodeHint; i < this.inodeCount; i++) {
      // Check cache first — cached entries are never FREE
      if (this.inodeCache.has(i)) continue;

      const offset = this.inodeTableOffset + i * INODE_SIZE;
      const typeBuf = new Uint8Array(1);
      this.handle.read(typeBuf, { at: offset });
      if (typeBuf[0] === INODE_TYPE.FREE) {
        this.freeInodeHint = i + 1;
        return i;
      }
    }
    // All inodes used — grow inode table
    const idx = this.growInodeTable();
    this.freeInodeHint = idx + 1;
    return idx;
  }

  private growInodeTable(): number {
    const oldCount = this.inodeCount;
    const newCount = oldCount * 2;
    const growth = (newCount - oldCount) * INODE_SIZE;

    const afterInodeOffset = this.inodeTableOffset + oldCount * INODE_SIZE;
    const totalSize = this.handle.getSize();
    const afterSize = totalSize - afterInodeOffset;

    // Grow the file first.
    this.handle.truncate(totalSize + growth);

    // Shift the region after the inode table (path table + bitmap + ALL DATA)
    // RIGHT by `growth`, in CHUNKS scanned from the END backward. A single
    // `new Uint8Array(afterSize)` buffers the entire data region — hundreds of MB
    // for a large bundle (e.g. the Telegram AppDir) — and throws "Array buffer
    // allocation failed". Chunking caps the transient allocation; end→start order
    // guarantees a chunk's source bytes are never overwritten by an earlier
    // (lower-offset) chunk's destination, since every write lands `growth` bytes
    // HIGHER than its read and we always move the highest-offset chunk first.
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

    // Zero out the new inode entries (also chunked — `growth` doubles each grow
    // and can itself exceed a comfortable single allocation on a large table).
    const zChunk = new Uint8Array(Math.min(SHIFT_CHUNK, growth));
    let zRemaining = growth;
    let zOffset = afterInodeOffset;
    while (zRemaining > 0) {
      const n = Math.min(SHIFT_CHUNK, zRemaining);
      this.handle.write(n === zChunk.length ? zChunk : zChunk.subarray(0, n), { at: zOffset });
      zOffset += n;
      zRemaining -= n;
    }

    // Update offsets
    this.pathTableOffset += growth;
    this.bitmapOffset += growth;
    this.dataOffset += growth;
    this.inodeCount = newCount;

    this.superblockDirty = true;

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
    if (depth === 0) this.symlinkLoopDetected = false;
    if (depth > MAX_SYMLINK_DEPTH) {
      this.symlinkLoopDetected = true;
      return undefined;
    }

    const idx = this.pathIndex.get(path);
    if (idx === undefined) {
      // Path not found directly — try component resolution (handles intermediate symlinks)
      return this.resolvePathComponents(path, true, depth);
    }

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
  private resolvePathComponents(path: string, followLast: boolean = true, depth: number = 0): number | undefined {
    const result = this.resolvePathFull(path, followLast, depth);
    return result?.idx;
  }

  /**
   * Resolve a path following symlinks, returning both the inode index AND the
   * fully resolved path. This is needed by readdir: when listing a symlinked
   * directory, we must search for children under the resolved target path
   * (where files actually exist in pathIndex), not under the symlink path.
   */
  private resolvePathFull(path: string, followLast: boolean = true, depth: number = 0): { idx: number; resolvedPath: string } | undefined {
    if (depth === 0) this.symlinkLoopDetected = false;
    if (depth > MAX_SYMLINK_DEPTH) {
      this.symlinkLoopDetected = true;
      return undefined;
    }

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
          // Use resolvePathFull (not resolvePath) so intermediate symlinks
          // in the resolved target path are also followed
          return this.resolvePathFull(resolved, true, depth + 1);
        }

        // Reconstruct remaining path with resolved symlink
        const remaining = parts.slice(i + 1).join('/');
        const newPath = resolved + (remaining ? '/' + remaining : '');
        return this.resolvePathFull(newPath, followLast, depth + 1);
      }
    }

    const finalIdx = this.pathIndex.get(current);
    if (finalIdx === undefined) return undefined;
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
  private resolveDanglingLink(path: string, depth: number = 0): string | null {
    if (depth > MAX_SYMLINK_DEPTH) return null;
    const idx = this.pathIndex.get(path);
    if (idx === undefined) return path;
    const inode = this.readInode(idx);
    if (inode.type !== INODE_TYPE.SYMLINK) return path;

    const target = decoder.decode(this.readData(inode.firstBlock, inode.blockCount, inode.size));
    const resolved = target.startsWith('/') ? target : this.resolveRelative(path, target);
    return this.resolveDanglingLink(resolved, depth + 1);
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
      nlink: type === INODE_TYPE.DIRECTORY ? 2 : 1,
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
    this.setPathIndex(path, idx);
    this.pathIndexGen++;

    return idx;
  }

  // ========== Hard links ==========

  /**
   * Create the on-disk record for a second name.
   *
   * Unlike {@link createInode} this does NOT register the path against the entry it
   * writes: the name has to resolve to `targetIdx`, so the caller sets the path index.
   * The entry carries no metadata of its own — mode, size, ownership and timestamps all
   * belong to the target and are read through it — so only the path and the target
   * pointer are meaningful.
   */
  private createLinkInode(path: string, targetIdx: number): number {
    const idx = this.findFreeInode();
    const { offset: pathOff, length: pathLen } = this.appendPath(path);
    const now = Date.now();

    const inode: Inode = {
      type: INODE_TYPE.HARDLINK,
      pathOffset: pathOff,
      pathLength: pathLen,
      nlink: 1,
      mode: 0,
      size: 0,
      firstBlock: targetIdx, // INODE.LINK_TARGET
      blockCount: 0,
      mtime: now,
      ctime: now,
      atime: now,
      uid: this.processUid,
      gid: this.processGid,
    };

    this.writeInode(idx, inode);
    return idx;
  }

  private trackLinkPath(targetIdx: number, linkPath: string): void {
    let paths = this.linkPathsByTarget.get(targetIdx);
    if (!paths) {
      paths = new Set<string>();
      this.linkPathsByTarget.set(targetIdx, paths);
    }
    paths.add(linkPath);
  }

  private untrackLinkPath(targetIdx: number, linkPath: string): void {
    const paths = this.linkPathsByTarget.get(targetIdx);
    if (!paths) return;
    paths.delete(linkPath);
    if (paths.size === 0) this.linkPathsByTarget.delete(targetIdx);
  }

  /**
   * How many names reach this inode: the one it stores itself, plus every hard link.
   *
   * This is what `stat` reports as `nlink`, in preference to the stored NLINK field.
   * Deriving it means the count cannot drift from the names that actually exist, and it
   * corrects volumes written before links were real — where `link()` copied the file and
   * stamped `nlink: 2` on two inodes that were never related.
   */
  private nameCount(idx: number): number {
    return 1 + (this.linkPathsByTarget.get(idx)?.size ?? 0);
  }

  /** Mark an inode slot free and make it available to the next allocation. */
  private releaseInode(idx: number, inode: Inode): void {
    inode.type = INODE_TYPE.FREE;
    this.writeInode(idx, inode);
    if (idx < this.freeInodeHint) this.freeInodeHint = idx;
  }

  /**
   * Remove ONE name for `idx`, freeing exactly what that name owned.
   *
   * Every path that destroys a directory entry — `unlink`, the target-replacement and
   * descendant sweeps in `rename`, recursive `rmdir` — goes through here, because
   * "free the blocks and mark the inode free" is only correct for the *last* name. With
   * hard links there are three cases:
   *
   *  - the name is a hard link → free the link entry alone; the file is untouched;
   *  - the name is the one the inode stores, and links remain → promote a link to be
   *    the inode's own name (the inode adopts its path, that link entry is freed), so
   *    the data keeps a name that still resolves after a remount;
   *  - it was the last name → free the data blocks and the inode.
   *
   * The decision is made from the link registry rather than the stored `nlink`, so a
   * stale or bogus count on an old volume can neither leak blocks nor free live ones.
   *
   * The caller still owns `pathIndexGen++` and `commitPending()` — one bump and one
   * commit per logical operation, not per name.
   */
  private removeName(path: string, idx: number): void {
    const linkIdx = this.linkInodes.get(path);

    if (linkIdx !== undefined) {
      // A second name. Only its directory entry goes away.
      this.linkInodes.delete(path);
      this.untrackLinkPath(idx, path);
      this.releaseInode(linkIdx, this.readInode(linkIdx));

      const target = this.readInode(idx);
      target.nlink = this.nameCount(idx);
      target.ctime = Date.now();
      this.writeInode(idx, target);
      this.deletePathIndex(path);
      return;
    }

    const inode = this.readInode(idx);
    const links = this.linkPathsByTarget.get(idx);

    if (links && links.size > 0) {
      // The inode's own name is going, but other names still reach it. Adopt one of
      // them: the inode takes over that path and the link entry for it is freed, which
      // keeps the invariant that every live inode stores a path that resolves to it.
      const promoted = links.values().next().value as string;
      const promotedLinkIdx = this.linkInodes.get(promoted)!;
      this.linkInodes.delete(promoted);
      this.untrackLinkPath(idx, promoted);
      this.releaseInode(promotedLinkIdx, this.readInode(promotedLinkIdx));

      const { offset: pathOff, length: pathLen } = this.appendPath(promoted);
      inode.pathOffset = pathOff;
      inode.pathLength = pathLen;
      inode.nlink = this.nameCount(idx);
      inode.ctime = Date.now();
      this.writeInode(idx, inode);
      this.deletePathIndex(path);
      return;
    }

    // Last name — the data and the inode go with it.
    inode.nlink = 0;
    this.freeBlockRange(inode.firstBlock, inode.blockCount);
    this.releaseInode(idx, inode);
    this.deletePathIndex(path);
  }

  /**
   * Move the directory entry `oldPath` to `newPath`, rewriting whichever inode owns the
   * name — the hard-link entry if it is a second name, otherwise the inode itself.
   * Renaming a link must not touch the file it names, and renaming the file must not
   * disturb the links pointing at it.
   *
   * The path index is the caller's to update; this only fixes the on-disk record and the
   * link registry.
   */
  private repathName(oldPath: string, newPath: string, idx: number, touchMtime: boolean): void {
    const linkIdx = this.linkInodes.get(oldPath);
    const ownerIdx = linkIdx ?? idx;
    const owner = this.readInode(ownerIdx);

    const { offset: pathOff, length: pathLen } = this.appendPath(newPath);
    owner.pathOffset = pathOff;
    owner.pathLength = pathLen;
    if (touchMtime) owner.mtime = Date.now();
    this.writeInode(ownerIdx, owner);

    if (linkIdx !== undefined) {
      this.linkInodes.delete(oldPath);
      this.linkInodes.set(newPath, linkIdx);
      this.untrackLinkPath(idx, oldPath);
      this.trackLinkPath(idx, newPath);
    }
  }

  /**
   * Every OTHER name that reaches the same inode as `path`.
   *
   * Empty for the overwhelmingly common case of a file with one name, and answered
   * from a single map probe in that case. The OPFS mirror needs it: a write through
   * one name changes the bytes behind all of them, but OPFS has no hard links, so each
   * name is a separate file over there and has to be re-mirrored.
   */
  linkNamesFor(path: string): string[] {
    path = this.normalizePath(path);
    const idx = this.pathIndex.get(path);
    if (idx === undefined) return [];
    const links = this.linkPathsByTarget.get(idx);
    if (!links || links.size === 0) return [];

    const names: string[] = [];
    const inode = this.readInode(idx);
    const primary = this.readPath(inode.pathOffset, inode.pathLength);
    if (primary !== path) names.push(primary);
    for (const link of links) if (link !== path) names.push(link);
    return names;
  }

  // ========== Public API — called by server worker dispatch ==========

  /** Normalize a path: ensure leading /, resolve . and .. */
  normalizePath(p: string): string {
    if (p.charCodeAt(0) !== 47) p = '/' + p; // 47 = '/'
    // Fast path: already normalized (no '.', '..', '//', trailing '/')
    if (p.length === 1) return p; // "/"
    if (p.indexOf('/.') === -1 && p.indexOf('//') === -1 && p.charCodeAt(p.length - 1) !== 47) {
      return p;
    }
    // Slow path: full normalize
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

    // Fast path: direct index lookup (skips component-by-component walk)
    let idx = this.pathIndex.get(path);
    if (idx !== undefined) {
      const inode = this.inodeCache.get(idx);
      if (inode) {
        // Symlink? Fall through to full resolve
        if (inode.type === INODE_TYPE.SYMLINK) {
          idx = this.resolvePathComponents(path, true);
        } else if (inode.type === INODE_TYPE.DIRECTORY) {
          return { status: CODE_TO_STATUS.EISDIR, data: null };
        } else {
          // Hot path: cached inode, no symlinks
          const data = inode.size > 0
            ? this.readData(inode.firstBlock, inode.blockCount, inode.size)
            : new Uint8Array(0);
          if (this.debug) {
            const t1 = performance.now();
            console.log(`[VFS read] path=${path} size=${inode.size} TOTAL=${(t1-t0).toFixed(3)}ms (fast)`);
          }
          return { status: 0, data };
        }
      }
    }

    // Slow path: full component resolution (handles symlinks, uncached inodes)
    if (idx === undefined) idx = this.resolvePathComponents(path, true);
    if (idx === undefined) return { status: this.resolveFailureStatus(), data: null };

    const inode = this.readInode(idx);
    if (inode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EISDIR, data: null };

    const data = inode.size > 0
      ? this.readData(inode.firstBlock, inode.blockCount, inode.size)
      : new Uint8Array(0);

    if (this.debug) {
      const t1 = performance.now();
      console.log(`[VFS read] path=${path} size=${inode.size} TOTAL=${(t1-t0).toFixed(3)}ms (slow path)`);
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

    let existingIdx = this.resolvePathComponents(path, true);

    if (existingIdx === undefined) {
      // Nothing resolved — but the path itself may be a symlink whose target does not exist yet.
      // Node writes *through* the link and creates the target; creating at the literal path
      // would destroy the link. Costs one Map lookup, and only on the create path.
      const linkTarget = this.resolveDanglingLink(path);
      if (linkTarget === null) return { status: CODE_TO_STATUS.ELOOP };
      if (linkTarget !== path) {
        path = linkTarget;
        // The target can live in a different directory than the link.
        const targetParentStatus = this.ensureParent(path);
        if (targetParentStatus !== 0) return { status: targetParentStatus };
        existingIdx = this.resolvePathComponents(path, true);
      }
    }
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
      // Refuse to create a regular file at a path that is an implicit
      // directory (children exist beneath it but no inode for the path
      // itself). Without this guard we'd register a FILE inode at `path`
      // while its descendants stay in pathIndex — the resulting "file with
      // children" state breaks every subsequent read of `path` and its
      // subtree.
      if (this.isImplicitDirectory(path)) return { status: CODE_TO_STATUS.EISDIR };
      // Create new file
      const mode = DEFAULT_FILE_MODE & ~(this.umask & 0o777);
      this.createInode(path, INODE_TYPE.FILE, mode, data.byteLength, data);
      tAlloc = this.debug ? performance.now() : 0;
      tData = tAlloc;
      tInode = tAlloc;
    }

    // Always commit pending superblock/bitmap changes (matches unlink, mkdir, etc.)
    // Without this, PATH_USED won't be persisted for newly created files,
    // causing "path out of bounds" corruption on reload.
    this.commitPending();
    if (flags & 1) {
      this.handle.flush();
    }
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

    const combinedSize = inode.size + data.byteLength;
    const neededBlocks = Math.ceil(combinedSize / this.blockSize);

    // Fast path: the block run already reserved for this file has room for the new bytes, so
    // just write them at the end. Blocks are 4 KB, so most appends land here.
    //
    // Without this, every append relocated the WHOLE file — allocate a fresh run, copy every
    // existing byte, free the old run — making a repeatedly-appended log O(size) per call and
    // O(n²) overall: adding 64 bytes to a 10 MB log copied 10 MB. `fwrite` has always taken the
    // in-place path (it only relocates when neededBlocks exceeds blockCount), so the fd-based
    // append route was already fast; this brings the single-op APPEND route in line.
    if (neededBlocks <= inode.blockCount) {
      this.handle.write(data, { at: this.dataOffset + inode.firstBlock * this.blockSize + inode.size });
      inode.size = combinedSize;
      inode.mtime = Date.now();
      this.writeInode(existingIdx, inode);
      this.commitPending();
      return { status: 0 };
    }

    // Growth path. Avoid materializing the whole (existing + data) file in a single Uint8Array —
    // that blew up with "Array buffer allocation failed" on large appends (e.g. appending a few
    // MB to a multi-hundred-MB file).
    //
    // Strategy: allocate a new block run sized to the total, copy the existing contents over in
    // bounded chunks, then write the caller's `data` at the end. Peak allocation stays at 4 MB
    // regardless of file size.
    const newFirst = this.allocateBlocks(neededBlocks);
    const newBase = this.dataOffset + newFirst * this.blockSize;
    if (inode.size > 0) {
      const oldBase = this.dataOffset + inode.firstBlock * this.blockSize;
      const CHUNK = 4 * 1024 * 1024; // 4 MB
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
  unlink(path: string): { status: number } {
    path = this.normalizePath(path);
    const idx = this.pathIndex.get(path);
    if (idx === undefined) return { status: CODE_TO_STATUS.ENOENT };

    const inode = this.readInode(idx);
    if (inode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EISDIR };

    // Drop this one name. removeName frees the data blocks only when it was the last
    // name for the inode — unlinking one of two hard links leaves the file intact,
    // reachable through the other, exactly as unlink(2) does.
    this.removeName(path, idx);
    this.pathIndexGen++;

    this.commitPending();
    return { status: 0 };
  }

  // ---- STAT ----
  stat(path: string): { status: number; data: Uint8Array | null } {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === undefined) {
      // Capture WHY resolution failed before isImplicitDirectory runs — it resolves too, and
      // would reset the flag that distinguishes a symlink cycle (ELOOP) from a missing path.
      const failure = this.resolveFailureStatus();
      // Check for implicit directory (exists because files exist under it)
      if (this.isImplicitDirectory(path)) {
        return this.encodeImplicitDirStatResponse(path);
      }
      return { status: failure, data: null };
    }

    return this.encodeStatResponse(idx);
  }

  // ---- LSTAT (no symlink follow for the FINAL component) ----
  lstat(path: string): { status: number; data: Uint8Array | null } {
    path = this.normalizePath(path);
    // Use resolvePathComponents with followLast=false — follows intermediate
    // symlinks but returns the symlink inode itself for the last component.
    // Direct pathIndex.get(path) fails for paths through symlinked directories
    // because children are stored under the symlink target path in pathIndex.
    let idx = this.resolvePathComponents(path, false);
    if (idx === undefined) {
      // Fallback: followLast=false can fail for paths through symlink chains
      // when pathIndex stores files under their resolved (real) path.
      // Try with followLast=true — if it resolves, use the result regardless
      // of whether the final component is a symlink or not. lstat on an
      // existing symlink should return the symlink's own stats, not ENOENT.
      idx = this.resolvePathComponents(path, true);
      if (idx === undefined) {
        // Check for implicit directory
        if (this.isImplicitDirectory(path)) {
          return this.encodeImplicitDirStatResponse(path);
        }
        return { status: CODE_TO_STATUS.ENOENT, data: null };
      }
    }

    return this.encodeStatResponse(idx);
  }

  private encodeStatResponse(idx: number): { status: number; data: Uint8Array } {
    const inode = this.readInode(idx);

    // nlink is derived, never read back from the record, so it always equals the number
    // of names that actually reach this inode. For a directory that is 2 + its child
    // subdirectories (implicit ones included, so the count agrees with readdir); for
    // everything else it is its own name plus every hard link pointing at it.
    const nlink = inode.type === INODE_TYPE.DIRECTORY
      ? 2 + this.countSubdirectories(this.readPath(inode.pathOffset, inode.pathLength))
      : this.nameCount(idx);

    // Encode stat into binary: type(1) + mode(4) + size(8) + mtime(8) + ctime(8) + atime(8) + uid(4) + gid(4) + ino(4) + nlink(4) = 53 bytes
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
    view.setUint32(45, idx, true); // ino = inode index
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
  mkdir(path: string, flags: number = 0, reqMode: number = 0o777): { status: number; data: Uint8Array | null } {
    path = this.normalizePath(path);
    const recursive = (flags & 1) !== 0;

    if (recursive) {
      return this.mkdirRecursive(path, reqMode);
    }

    // Check if already exists (explicit or implicit)
    if (this.pathIndex.has(path) || this.isImplicitDirectory(path)) {
      return { status: CODE_TO_STATUS.EEXIST, data: null };
    }

    // Ensure parent exists
    const parentStatus = this.ensureParent(path);
    if (parentStatus !== 0) return { status: parentStatus, data: null };

    this.createInode(path, INODE_TYPE.DIRECTORY, this.dirModeFor(reqMode), 0);

    this.commitPending();
    // Non-recursive mkdir returns undefined (null data) per Node.js spec
    return { status: 0, data: null };
  }

  /** Permission bits a new directory gets: the request minus the umask, plus the S_IFDIR type. */
  private dirModeFor(reqMode: number): number {
    return S_IFDIR | ((reqMode & 0o7777) & ~(this.umask & 0o777));
  }

  /** Same, for a newly created regular file. Node's open defaults reqMode to 0o666 → 0o644. */
  private fileModeFor(reqMode: number): number {
    return S_IFREG | ((reqMode & 0o7777) & ~(this.umask & 0o777));
  }

  private mkdirRecursive(path: string, reqMode: number = 0o777): { status: number; data: Uint8Array | null } {
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

      this.createInode(current, INODE_TYPE.DIRECTORY, this.dirModeFor(reqMode), 0);
      if (!firstCreated) firstCreated = current;
    }

    this.commitPending();
    const result = firstCreated ? encoder.encode(firstCreated) : undefined;
    return { status: 0, data: result ?? null };
  }

  // ---- RMDIR ----
  rmdir(path: string, flags: number = 0): { status: number } {
    path = this.normalizePath(path);
    const recursive = (flags & 1) !== 0;
    const idx = this.pathIndex.get(path);
    if (idx === undefined) {
      // Check for implicit directory — a dir that exists because files
      // exist under it but no explicit inode was created.
      if (this.isImplicitDirectory(path)) {
        const children = this.getDirectChildrenWithImplicit(path);
        if (children.length > 0) {
          if (!recursive) return { status: CODE_TO_STATUS.ENOTEMPTY };
          // Recursive: delete all real descendants; the implicit dir
          // disappears automatically when its children are gone.
          for (const desc of this.getAllDescendants(path)) {
            this.removeName(desc, this.pathIndex.get(desc)!);
          }
          this.pathIndexGen++;
          this.commitPending();
        }
        // Empty implicit dir or just-emptied: no-op — it vanishes on its own.
        return { status: 0 };
      }
      return { status: CODE_TO_STATUS.ENOENT };
    }

    const inode = this.readInode(idx);
    if (inode.type !== INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.ENOTDIR };

    // Check for children
    const children = this.getDirectChildren(path);

    if (children.length > 0) {
      if (!recursive) return { status: CODE_TO_STATUS.ENOTEMPTY };

      // Recursive delete. removeName keeps a file alive when a hard link outside this
      // subtree still names it, and frees the link entry when the link is the one inside.
      for (const child of this.getAllDescendants(path)) {
        this.removeName(child, this.pathIndex.get(child)!);
      }
    }

    // Remove the directory itself — except the volume root, which has no parent to be removed
    // from. A real filesystem cannot unlink its own mount point either. Deleting it left the
    // volume with no root at all: `stat('/')` and `readdir('/')` both answered ENOENT
    // afterwards, and `rm('/', { recursive: true })` is the ordinary way to clear a volume, so
    // that state was easy to reach. The children are gone either way, which is what the caller
    // asked for.
    if (path === '/') {
      this.pathIndexGen++;
      this.commitPending();
      return { status: 0 };
    }

    this.removeName(path, idx);
    this.pathIndexGen++;

    this.commitPending();
    return { status: 0 };
  }

  // ---- READDIR ----
  readdir(path: string, flags: number = 0): { status: number; data: Uint8Array | null } {
    path = this.normalizePath(path);
    const resolved = this.resolvePathFull(path, true);

    // Determine the effective directory path for child lookup
    let effectiveDirPath: string;

    if (resolved) {
      const inode = this.readInode(resolved.idx);
      if (inode.type !== INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.ENOTDIR, data: null };
      // Use the resolved path for child lookup — when path is a symlink,
      // the actual children are stored under the target path in pathIndex.
      effectiveDirPath = resolved.resolvedPath;
    } else if (this.isImplicitDirectory(path)) {
      effectiveDirPath = path;
    } else {
      return { status: CODE_TO_STATUS.ENOENT, data: null };
    }

    const withFileTypes = (flags & 1) !== 0;

    if (withFileTypes) {
      // Encode as: count(u32) + entries[name_len(u16) + name(bytes) + type(u8)].
      //
      // Same shape as the names-only path below: work from the child index's names, sort those
      // (same order as sorting full paths, since every child shares one prefix), and write UTF-8
      // straight into an over-allocated buffer with encodeInto. Only the classification needs a
      // full path, and it is built once per child for the pathIndex probe instead of being
      // constructed, sorted, and then sliced back apart.
      this.ensureChildIndex();
      const typedNames = this.childIndex.get(effectiveDirPath);
      if (!typedNames) return { status: 0, data: new Uint8Array([0, 0, 0, 0]) };

      const names = [...typedNames.keys()].sort();
      const prefix = effectiveDirPath === '/' ? '/' : effectiveDirPath + '/';

      // 3 bytes per UTF-16 unit is an upper bound for UTF-8; +3 covers the length and type bytes.
      let capacity = 4;
      for (const name of names) capacity += 3 + name.length * 3;

      const buf = new Uint8Array(capacity);
      const view = new DataView(buf.buffer);
      view.setUint32(0, names.length, true);
      let offset = 4;

      for (const name of names) {
        const { written } = encoder.encodeInto(name, buf.subarray(offset + 2));
        view.setUint16(offset, written, true);
        offset += 2 + written;
        // A child with no pathIndex entry is implicit — it exists only because descendants pass
        // through it, so it is a directory.
        const childIdx = this.pathIndex.get(prefix + name);
        buf[offset++] = childIdx === undefined ? INODE_TYPE.DIRECTORY : this.readInode(childIdx).type;
      }

      return { status: 0, data: buf.subarray(0, offset) };
    }

    this.ensureChildIndex();
    const childNames = this.childIndex.get(effectiveDirPath);
    if (!childNames) return { status: 0, data: new Uint8Array([0, 0, 0, 0]) };

    // Simple name list: count(u32) + entries[name_len(u16) + name(bytes)].
    //
    // This is the hot readdir shape (everything except withFileTypes), so it works from the
    // child index's names directly rather than going through getDirectChildrenWithImplicit.
    // That path builds a full path per child by concatenation, looks each one up in pathIndex
    // to classify it real-or-implicit, sorts the long strings, and then slices the name back
    // out — three allocations and a Map probe per entry, all of it discarded here because a
    // name list does not care which children are implicit. Sorting the bare names gives the
    // same order as sorting the full paths, since every child shares one prefix.
    const names = [...childNames.keys()].sort();

    // Size the buffer without a measuring pass: UTF-8 needs at most 3 bytes per UTF-16 code
    // unit (a surrogate pair is 2 units → 4 bytes, still under 3×), so this is an upper bound.
    // encodeInto writes straight into it and the result is trimmed to what was actually used.
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
  rename(oldPath: string, newPath: string): { status: number } {
    oldPath = this.normalizePath(oldPath);
    newPath = this.normalizePath(newPath);

    const idx = this.pathIndex.get(oldPath);
    if (idx === undefined) return { status: CODE_TO_STATUS.ENOENT };

    // Same path → no-op (matches Node.js semantics)
    if (oldPath === newPath) return { status: 0 };

    // Two different names for the SAME inode — hard links to each other. rename(2) is
    // defined to succeed and do nothing here, and it has to: the replace-then-move path
    // below would free the inode as the target and then rename the entry that named it.
    if (this.pathIndex.get(newPath) === idx) return { status: 0 };

    // Ancestry guards. Both of these used to report success and then destroy the tree,
    // because the descendant sweep below and the move itself end up operating on each
    // other: renaming `/d/sub` onto `/d` freed `/d/sub` as a descendant of the target and
    // then moved the inode it had just freed (after a remount the whole tree was gone),
    // and renaming `/d` into `/d/sub` re-listed the moved directory as its own descendant
    // and renamed it again, to `/d/sub/sub`. Node reports ENOTEMPTY and EINVAL, and does
    // nothing. Only meaningful for a directory source: a file cannot have a path under it,
    // and file-onto-directory is already EISDIR below.
    if (this.readInode(idx).type === INODE_TYPE.DIRECTORY) {
      // A directory cannot become a subdirectory of itself.
      if (isUnder(newPath, oldPath)) return { status: CODE_TO_STATUS.EINVAL };
      // …and it cannot replace one of its own ancestors: that directory is not empty —
      // it contains the source.
      if (isUnder(oldPath, newPath)) return { status: CODE_TO_STATUS.ENOTEMPTY };
    }

    // Ensure parent of new path exists
    const parentStatus = this.ensureParent(newPath);
    if (parentStatus !== 0) return { status: parentStatus };

    // If target exists, remove it. For directory targets we MUST recursively
    // free every descendant inode and drop every descendant pathIndex entry —
    // otherwise the source's children get added on top, leaving a mix of
    // source children + leftover target children pointing at zombie inodes
    // (the target's old children still appear in pathIndex, while their
    // inodes are not freed so blocks are leaked too).
    //
    // Concrete consequence of the old behavior: Vite's deps optimization
    // commit (`.vite/deps_temp_<hash>` → `.vite/deps`) on the second run
    // returned success but produced a corrupt deps directory — subsequent
    // requests for `vue.js`, `@unhead/vue`, etc. resolved to stale chunks
    // from the previous round (or 404'd entirely).
    //
    // The target may also be an *implicit* directory (no inode of its own,
    // but children exist under it — the state produced by bulk OPFS import).
    // In that case there's no inode to free, but the descendants must still
    // be cleaned up for the same reason.
    const existingIdx = this.pathIndex.get(newPath);
    const targetIsImplicitDir =
      existingIdx === undefined && this.isImplicitDirectory(newPath);

    // POSIX type-conflict guards. Without these the replace logic below would
    // overwrite a directory with a file (or vice versa), diverging from Node —
    // and the OPFS mirror cannot represent a file-replaces-directory (a `write`
    // can't convert an OPFS directory into a file), so the mirror would silently
    // keep the stale directory tree. Reject the type-mismatch combinations the
    // way Node does. (Replacing a non-empty *directory* with another directory
    // is deliberately allowed — Vite's `.vite/deps_temp_<hash>` → `.vite/deps`
    // commit relies on it, and the mirror handles it via renameDirInOPFS.)
    if (existingIdx !== undefined || targetIsImplicitDir) {
      const srcIsDir = this.readInode(idx).type === INODE_TYPE.DIRECTORY;
      const dstIsDir = targetIsImplicitDir ||
        (existingIdx !== undefined && this.readInode(existingIdx).type === INODE_TYPE.DIRECTORY);
      if (srcIsDir && !dstIsDir) return { status: CODE_TO_STATUS.ENOTDIR };
      if (!srcIsDir && dstIsDir) return { status: CODE_TO_STATUS.EISDIR };
    }

    if (existingIdx !== undefined || targetIsImplicitDir) {
      let cleanDescendants = targetIsImplicitDir;

      if (existingIdx !== undefined) {
        cleanDescendants = this.readInode(existingIdx).type === INODE_TYPE.DIRECTORY;
        // Through removeName, so replacing a name that is a hard link — or a file that
        // still has links elsewhere — drops the name without destroying the data.
        this.removeName(newPath, existingIdx);
      }

      if (cleanDescendants) {
        // Free every descendant inode and remove its pathIndex entry.
        // Use getAllDescendants for the deepest-first ordering (matches
        // rmdir's recursive path) — though for a flat free pass order
        // doesn't affect correctness here.
        for (const desc of this.getAllDescendants(newPath)) {
          this.removeName(desc, this.pathIndex.get(desc)!);
        }
      }
    }

    // Move the directory entry to its new path. For a hard-link name this rewrites the
    // link record; for anything else, the inode's own stored path.
    const inode = this.readInode(idx);
    this.repathName(oldPath, newPath, idx, true);

    // Update index
    this.deletePathIndex(oldPath);
    this.setPathIndex(newPath, idx);
    this.pathIndexGen++;

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
        this.repathName(p, childNewPath, i, false);
        this.deletePathIndex(p);
        this.setPathIndex(childNewPath, i);
      }
    }

    this.commitPending();
    return { status: 0 };
  }

  // ---- EXISTS ----
  exists(path: string): { status: number; data: Uint8Array | null } {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    const buf = new Uint8Array(1);
    buf[0] = (idx !== undefined || this.isImplicitDirectory(path)) ? 1 : 0;
    return { status: 0, data: buf };
  }

  // ---- TRUNCATE ----
  truncate(path: string, len: number = 0): { status: number } {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === undefined) return { status: this.resolveFailureStatus() };

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
      // Grow with POSIX zero-fill semantics. Old code staged the entire
      // new file as a single `new Uint8Array(len)` — OOMs for large
      // truncates and allocates way more than necessary. Instead, copy
      // old contents in bounded chunks and zero-fill the extension
      // directly on disk.
      const neededBlocks = Math.ceil(len / this.blockSize);
      if (neededBlocks > inode.blockCount) {
        // Allocate-then-copy-then-free so the old range is guaranteed
        // not to overlap the new one. See `fwrite` for the same pattern.
        //
        // Read the volume's size before allocating: whatever the allocation adds past this point
        // comes back zero-filled from `handle.truncate` and does not need zeroing again. This is
        // what keeps a grow to a large length from costing its own size in writes.
        const knownZeroFrom = this.handle.getSize();
        const newFirst = this.allocateBlocks(neededBlocks);
        const newBase = this.dataOffset + newFirst * this.blockSize;
        if (inode.size > 0) {
          const oldBase = this.dataOffset + inode.firstBlock * this.blockSize;
          const CHUNK = 4 * 1024 * 1024; // 4 MB
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
        this.zeroFileRange(newBase + inode.size, len - inode.size, knownZeroFrom);
        inode.firstBlock = newFirst;
      } else {
        // Same block count, just growing `size`. The tail of the last
        // existing block still contains whatever stale data was there
        // before — zero it so the extended region reads as zeros.
        this.zeroFileRange(
          this.dataOffset + inode.firstBlock * this.blockSize + inode.size,
          len - inode.size,
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
  copy(srcPath: string, destPath: string, flags: number = 0): { status: number } {
    srcPath = this.normalizePath(srcPath);
    destPath = this.normalizePath(destPath);

    const srcIdx = this.resolvePathComponents(srcPath, true);
    if (srcIdx === undefined) return { status: this.resolveFailureStatus() };

    const srcInode = this.readInode(srcIdx);
    // Node reports ENOTSUP here, not EISDIR: copyFile is defined for files, so a directory
    // source is an unsupported operation rather than a misuse of a directory.
    if (srcInode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.ENOTSUP };

    // COPYFILE_EXCL check
    if ((flags & 1) && (this.pathIndex.has(destPath) || this.isImplicitDirectory(destPath))) {
      return { status: CODE_TO_STATUS.EEXIST };
    }

    // Self-copy — no-op.
    if (srcPath === destPath) return { status: 0 };

    const srcSize = srcInode.size;
    const srcFirstBlock = srcInode.firstBlock;
    const srcMode = srcInode.mode;

    // Stage 1: create the destination as an empty file. This goes through
    // the normal `write` path which handles parent-directory creation,
    // freeing any pre-existing blocks at `destPath`, and registering the
    // inode in `pathIndex`. Doing this first also means any side effects
    // (e.g. a `growPathTable` shift of the data region) happen BEFORE we
    // start allocating destination blocks, so the relative block indices
    // we capture below stay valid.
    const emptyStatus = this.write(destPath, new Uint8Array(0));
    if (emptyStatus.status !== 0) return emptyStatus;

    if (srcSize === 0) {
      // Empty source still has permissions to carry over.
      const emptyIdx = this.resolvePathComponents(destPath, true);
      if (emptyIdx !== undefined) {
        const emptyInode = this.readInode(emptyIdx);
        emptyInode.mode = (emptyInode.mode & ~0o7777) | (srcMode & 0o7777);
        this.writeInode(emptyIdx, emptyInode);
        this.commitPending();
      }
      return { status: 0 };
    }

    // Stage 2: allocate a destination block run sized to the source, then
    // copy the bytes directly between block ranges via the file handle in
    // bounded chunks. No full-file buffer is ever allocated — peak scratch
    // stays at 4 MB regardless of how big the source file is.
    const destIdx = this.resolvePathComponents(destPath, true);
    if (destIdx === undefined) return { status: CODE_TO_STATUS.EIO };
    const destInode = this.readInode(destIdx);

    const neededBlocks = Math.ceil(srcSize / this.blockSize);
    const newFirst = this.allocateBlocks(neededBlocks);
    const newBase = this.dataOffset + newFirst * this.blockSize;
    const srcBase = this.dataOffset + srcFirstBlock * this.blockSize;

    const CHUNK = 4 * 1024 * 1024; // 4 MB
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
    // Carry the source's permission bits over. The destination was created by write(), which
    // applies the default file mode, so a 0600 source produced a 0644 copy — copyFile(2) and
    // Node both give the copy the source's permissions. Found by the differential fuzzer.
    destInode.mode = (destInode.mode & ~0o7777) | (srcMode & 0o7777);
    this.writeInode(destIdx, destInode);
    this.commitPending();
    return { status: 0 };
  }

  // ---- ACCESS ----
  access(path: string, mode: number = 0): { status: number } {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === undefined) {
      // Capture WHY resolution failed first — isImplicitDirectory resolves too and would reset
      // the flag that separates a symlink cycle (ELOOP) from a missing path. Same as stat().
      const failure = this.resolveFailureStatus();
      // Check for implicit directory
      if (this.isImplicitDirectory(path)) return { status: 0 };
      return { status: failure };
    }

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
    if (idx === undefined) {
      // Capture the failure reason before isImplicitDirectory resolves — see access()/stat().
      const failure = this.resolveFailureStatus();
      // Check for implicit directory
      if (this.isImplicitDirectory(path)) {
        return { status: 0, data: encoder.encode(path) };
      }
      return { status: failure, data: null };
    }

    // Find the resolved path for this inode
    const inode = this.readInode(idx);
    const resolvedPath = this.readPath(inode.pathOffset, inode.pathLength);
    return { status: 0, data: encoder.encode(resolvedPath) };
  }

  // ---- CHMOD ----
  /**
   * `follow: false` is `lchmod` — act on the symlink itself rather than what it points at.
   *
   * This used to have no such parameter and `lchmod` simply called `chmod`, so it changed the
   * **target's** permissions: the one thing the `l` prefix exists to prevent. `resolvePathComponents`
   * already distinguishes the two, exactly as `stat` and `lstat` do.
   */
  chmod(path: string, mode: number, follow = true): { status: number } {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, follow);
    if (idx === undefined) return { status: this.resolveFailureStatus() };

    const inode = this.readInode(idx);
    // Preserve file type bits, update permission bits
    inode.mode = (inode.mode & S_IFMT) | (mode & 0o7777);
    inode.ctime = Date.now();
    this.writeInode(idx, inode);

    return { status: 0 };
  }

  // ---- CHOWN ----
  /** `follow: false` is `lchown` — the link's own ownership, not its target's. */
  chown(path: string, uid: number, gid: number, follow = true): { status: number } {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, follow);
    if (idx === undefined) return { status: this.resolveFailureStatus() };

    const inode = this.readInode(idx);
    inode.uid = uid;
    inode.gid = gid;
    inode.ctime = Date.now();
    this.writeInode(idx, inode);

    return { status: 0 };
  }

  // ---- UTIMES ----
  /** `follow: false` is `lutimes` — timestamps on the symlink itself, not on its target. */
  utimes(path: string, atime: number, mtime: number, follow = true): { status: number } {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, follow);
    if (idx === undefined) return { status: this.resolveFailureStatus() };

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
  readlink(path: string): { status: number; data: Uint8Array | null } {
    path = this.normalizePath(path);
    const idx = this.pathIndex.get(path);
    if (idx === undefined) return { status: CODE_TO_STATUS.ENOENT, data: null };

    const inode = this.readInode(idx);
    if (inode.type !== INODE_TYPE.SYMLINK) return { status: CODE_TO_STATUS.EINVAL, data: null };

    const target = this.readData(inode.firstBlock, inode.blockCount, inode.size);
    return { status: 0, data: target };
  }

  /**
   * link(2) — a real second name for one inode, not a copy.
   *
   * `newPath` becomes an INODE_TYPE.HARDLINK entry holding that name and the target's
   * inode index, and the path index maps it straight to the target. So the two names
   * share an inode number, a write through either is visible through the other, and
   * `nlink` counts the names that exist. The entry is in the inode table, so the mount
   * scan rebuilds the second name — the property the previous in-memory-only attempt
   * lacked, which made every link vanish on reload.
   *
   * Linking a directory is EPERM, as it is on Linux. The final component of
   * `existingPath` is resolved through symlinks (long-standing behaviour here), so a
   * link to a symlink names the file the symlink points at.
   */
  link(existingPath: string, newPath: string): { status: number } {
    existingPath = this.normalizePath(existingPath);
    newPath = this.normalizePath(newPath);

    const srcIdx = this.resolvePathComponents(existingPath, true);
    if (srcIdx === undefined) return { status: this.resolveFailureStatus() };

    const srcInode = this.readInode(srcIdx);
    if (srcInode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EPERM };

    if (this.pathIndex.has(newPath) || this.isImplicitDirectory(newPath)) {
      return { status: CODE_TO_STATUS.EEXIST };
    }

    const parentStatus = this.ensureParent(newPath);
    if (parentStatus !== 0) return { status: parentStatus };

    const linkIdx = this.createLinkInode(newPath, srcIdx);
    this.linkInodes.set(newPath, linkIdx);
    this.trackLinkPath(srcIdx, newPath);
    this.setPathIndex(newPath, srcIdx);
    this.pathIndexGen++;

    // link(2) changes the target's ctime — the inode gained a name — and nothing else
    // about it. The stored count is kept in step with the derived one so the record on
    // disk is meaningful to anything reading it directly (the repair worker, say).
    srcInode.nlink = this.nameCount(srcIdx);
    srcInode.ctime = Date.now();
    this.writeInode(srcIdx, srcInode);

    this.commitPending();
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
  open(path: string, flags: number, tabId: string, reqMode: number = 0o666): { status: number; data: Uint8Array | null } {
    path = this.normalizePath(path);

    const hasCreate = (flags & 64) !== 0;  // O_CREAT
    const hasTrunc = (flags & 512) !== 0;   // O_TRUNC
    const hasExcl = (flags & 128) !== 0;    // O_EXCL

    let idx = this.resolvePathComponents(path, true);

    if (idx === undefined) {
      // As in write(): the path may be a symlink whose target does not exist yet. O_CREAT must
      // create the *target*, leaving the link intact — creating at the literal path destroys it.
      const linkTarget = this.resolveDanglingLink(path);
      if (linkTarget === null) return { status: CODE_TO_STATUS.ELOOP, data: null };
      if (linkTarget !== path) {
        path = linkTarget;
        idx = this.resolvePathComponents(path, true);
      }
    }

    /**
     * A directory opens read-only — node allows it, and `fstat` through the descriptor is the
     * reason — but any write access is EISDIR.
     *
     * This is checked before the O_CREAT and O_TRUNC branches below, both of which get it wrong
     * on their own: `truncate` does return EISDIR here, but its status was discarded, so
     * `open(dir, 'w')` silently skipped the truncation and handed back a working descriptor; and
     * an *implicit* directory — one that exists only because it has children — has no inode of
     * its own, so O_CREAT created a file directly over it.
     */
    if (VFSEngine.isWritable(flags)) {
      const isDirectory = idx !== undefined
        ? this.readInode(idx).type === INODE_TYPE.DIRECTORY
        : this.isImplicitDirectory(path);
      if (isDirectory) return { status: CODE_TO_STATUS.EISDIR, data: null };
    }

    if (idx === undefined) {
      if (!hasCreate) return { status: this.resolveFailureStatus(), data: null };
      const parentStatus = this.ensureParent(path);
      if (parentStatus !== 0) return { status: parentStatus, data: null };
      // Create file
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
  close(fd: number): { status: number } {
    if (!this.fdTable.has(fd)) return { status: CODE_TO_STATUS.EBADF };
    this.fdTable.delete(fd);
    return { status: 0 };
  }

  // ---- FREAD ----
  fread(fd: number, length: number, position: number | null): { status: number; data: Uint8Array | null } {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF, data: null };
    if (!VFSEngine.isReadable(entry.flags)) return { status: CODE_TO_STATUS.EBADF, data: null };

    const inode = this.readInode(entry.inodeIdx);
    // A directory can be opened read-only — node allows it, and fstat on the descriptor works —
    // but reading through it is EISDIR. Without this the read fell through to the size
    // arithmetic below and returned an empty buffer, so `readFileSync(dirFd)` looked like an
    // empty file instead of an error.
    if (inode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EISDIR, data: null };

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
    if (!VFSEngine.isWritable(entry.flags)) return { status: CODE_TO_STATUS.EBADF, data: null };

    const inode = this.readInode(entry.inodeIdx);
    const isAppend = (entry.flags & 1024) !== 0; // O_APPEND
    const pos = isAppend ? inode.size : (position ?? entry.position);
    const endPos = pos + data.byteLength;

    // Check if we need to grow
    if (endPos > inode.size) {
      const neededBlocks = Math.ceil(endPos / this.blockSize);
      if (neededBlocks > inode.blockCount) {
        // Grow by relocating to a larger block run. We used to stage the
        // entire new file contents in a single `new Uint8Array(endPos)`
        // and then call `writeData` once — that blew up with
        // "Array buffer allocation failed" on multi-hundred-MB writes
        // because Chrome refuses contiguous allocations near ~2 GB even
        // with plenty of OS RAM. Instead, allocate new blocks, copy the
        // old contents forward in chunks via the underlying file handle
        // (which is O(N) bytes but with a bounded scratch buffer), then
        // free the old blocks and write just the caller's `data` at its
        // offset inside the new region.
        // Before allocating, so the hole below can skip the part of itself the allocation
        // zero-filled for free. See `zeroFileRange`.
        const knownZeroFrom = this.handle.getSize();
        const newFirst = this.allocateBlocks(neededBlocks);
        const newBase = this.dataOffset + newFirst * this.blockSize;
        const oldBase = this.dataOffset + inode.firstBlock * this.blockSize;
        // Copy oldData from old block run to new block run in chunks.
        if (inode.size > 0) {
          const CHUNK = 4 * 1024 * 1024; // 4 MB
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
        // POSIX "hole" — if the caller is writing past the current EOF
        // with a gap in between, those bytes must read back as zeros
        // rather than whatever stale data lives in the freshly allocated
        // blocks. `allocateBlocks` only flips bitmap bits, it never
        // zeroes the underlying storage.
        if (pos > inode.size) {
          this.zeroFileRange(newBase + inode.size, pos - inode.size, knownZeroFrom);
        }
        // Write the caller's new data at its offset inside the new region.
        this.handle.write(data, { at: newBase + pos });
        inode.firstBlock = newFirst;
        inode.blockCount = neededBlocks;
      } else {
        // Fits within existing blocks. Same hole semantics as above —
        // stale bytes in the tail of the last allocated block (past the
        // old file size) must be zeroed before the caller's write lands.
        if (pos > inode.size) {
          this.zeroFileRange(
            this.dataOffset + inode.firstBlock * this.blockSize + inode.size,
            pos - inode.size,
          );
        }
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

    this.commitPending();
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, data.byteLength, true);
    return { status: 0, data: buf };
  }

  // ---- FSTAT ----
  fstat(fd: number): { status: number; data: Uint8Array | null } {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF, data: null };
    if (entry.implicitPath) return this.encodeImplicitDirStatResponse(entry.implicitPath);
    return this.encodeStatResponse(entry.inodeIdx);
  }

  // ---- FTRUNCATE ----
  ftruncate(fd: number, len: number = 0): { status: number } {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF };
    // Node reports EINVAL here rather than the EBADF a read/write gets — truncating through a
    // read-only descriptor is a bad *argument*, not a bad descriptor. Verified against node:fs.
    if (!VFSEngine.isWritable(entry.flags)) return { status: CODE_TO_STATUS.EINVAL };

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
  statfs(path: string = '/'): { status: number; data: Uint8Array | null } {
    // Node resolves the path first: statfs on something that is not there is ENOENT, not a
    // report about the volume. We answered regardless of the path, which made a typo look like
    // a healthy filesystem.
    path = this.normalizePath(path);
    if (this.resolvePathComponents(path, true) === undefined && !this.isImplicitDirectory(path)) {
      return { status: this.resolveFailureStatus(), data: null };
    }

    // Distinct inode indices in the path index, not a pass over the inode table: the table lives
    // on disk, so scanning it would mean one read per slot (100k by default). Counting distinct
    // values is exact rather than approximate — the two names of a hard link resolve to one
    // index and must count once. The link's own directory entry occupies a table slot of its
    // own in this format, though, so `linkInodes` is added: `ffree` is capacity, and those
    // slots are genuinely spent.
    const usedInodes = new Set(this.pathIndex.values()).size + this.linkInodes.size;

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

  /**
   * fsync(2) / fdatasync(2).
   *
   * Everything here is committed to one backing handle, so there is nothing per-descriptor to
   * flush — but the descriptor still has to be *checked*. `fs.fsyncSync(fd)` on a closed or
   * never-opened fd answers EBADF in node, and reporting success instead turns a use-after-close
   * into silence at the one call whose entire job is to confirm the data is safe.
   *
   * `fd` is optional because the volume-wide flush behind `promises.flush()` has no descriptor
   * to name, and because a request encoded by an older worker carries no fd payload.
   */
  fsync(fd?: number): { status: number } {
    if (fd !== undefined && !this.fdTable.has(fd)) return { status: CODE_TO_STATUS.EBADF };
    this.commitPending();
    this.handle.flush();
    return { status: 0 };
  }

  // ---- FCHMOD ----
  // fd-based chmod: look up the inode directly from the fd table and mutate
  // its mode bits. Native Node does the same thing at the libuv layer.
  fchmod(fd: number, mode: number): { status: number } {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF };
    if (entry.implicitPath) return { status: 0 }; // no-op for implicit dirs
    const inode = this.readInode(entry.inodeIdx);
    inode.mode = (inode.mode & S_IFMT) | (mode & 0o7777);
    inode.ctime = Date.now();
    this.writeInode(entry.inodeIdx, inode);
    return { status: 0 };
  }

  // ---- FCHOWN ----
  fchown(fd: number, uid: number, gid: number): { status: number } {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF };
    if (entry.implicitPath) return { status: 0 }; // no-op for implicit dirs
    const inode = this.readInode(entry.inodeIdx);
    inode.uid = uid;
    inode.gid = gid;
    inode.ctime = Date.now();
    this.writeInode(entry.inodeIdx, inode);
    return { status: 0 };
  }

  // ---- FUTIMES ----
  futimes(fd: number, atime: number, mtime: number): { status: number } {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF };
    if (entry.implicitPath) return { status: 0 }; // no-op for implicit dirs
    const inode = this.readInode(entry.inodeIdx);
    inode.atime = atime;
    inode.mtime = mtime;
    inode.ctime = Date.now();
    this.writeInode(entry.inodeIdx, inode);
    return { status: 0 };
  }

  // ---- OPENDIR ----
  opendir(path: string, tabId: string): { status: number; data: Uint8Array | null } {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === undefined) {
      // Check for implicit directory
      if (this.isImplicitDirectory(path)) {
        // Create fd with synthetic inode index -1 and the path stored so
        // fd-based operations (fstat, fchmod, etc.) can handle it.
        const fd = this.nextFd++;
        this.fdTable.set(fd, { tabId, inodeIdx: -1, position: 0, flags: 0, implicitPath: path });
        const buf = new Uint8Array(4);
        new DataView(buf.buffer).setUint32(0, fd, true);
        return { status: 0, data: buf };
      }
      return { status: CODE_TO_STATUS.ENOENT, data: null };
    }

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

    // The parent must already exist. This used to create it — `mkdtemp('/no/where/t-')` happily
    // returned a path under a directory tree it had invented, where node reports ENOENT. A
    // temp-directory helper silently building the path it was handed is the sort of thing that
    // turns a typo'd prefix into a directory nobody looks in again.
    const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
    if (parentPath !== '/' && this.resolvePathComponents(parentPath, true) === undefined
        && !this.isImplicitDirectory(parentPath)) {
      return { status: CODE_TO_STATUS.ENOENT, data: null };
    }

    // mkdtemp(3) creates the directory with mkdir(path, S_IRWXU) — a PRIVATE 0700 directory, not
    // the 0755 an ordinary mkdir gets. Callers rely on that privacy: the directory is meant to hold
    // secrets (sockets, keys, scratch state) that no other user may reach, and several programs
    // stat it back and abort if it is group/world-readable.
    this.createInode(path, INODE_TYPE.DIRECTORY, this.dirModeFor(0o700), 0);

    this.commitPending();
    return { status: 0, data: encoder.encode(path) };
  }

  // ========== Helpers ==========

  private getDirectChildren(dirPath: string): string[] {
    this.ensureChildIndex();
    const names = this.childIndex.get(dirPath);
    if (!names) return [];

    const prefix = dirPath === '/' ? '/' : dirPath + '/';
    const children: string[] = [];
    for (const name of names.keys()) {
      const full = prefix + name;
      // Only children that exist as real pathIndex entries (matching the
      // previous full-scan semantics); names with only deeper descendants
      // are implicit dirs and excluded here.
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
  private rebuildImplicitDirs(): void {
    if (this.implicitDirsGen === this.pathIndexGen) return;

    const now = Date.now();
    const prev = this.implicitDirs;
    this.implicitDirs = new Map<string, number>();
    for (const filePath of this.pathIndex.keys()) {
      // Walk up from each path, adding all ancestor dirs that aren't explicit
      let pos = filePath.length;
      while (true) {
        pos = filePath.lastIndexOf('/', pos - 1);
        if (pos <= 0) break; // reached root
        const ancestor = filePath.substring(0, pos);
        if (this.implicitDirs.has(ancestor)) break; // already tracked all ancestors from here up
        if (!this.pathIndex.has(ancestor)) {
          // Preserve timestamp if this implicit dir was already known,
          // otherwise stamp it with "now" so stat() stays stable.
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
  private isImplicitDirectory(path: string): boolean {
    if (path === '/') return false; // root always has an explicit inode
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
  private rebuildDescCount(): void {
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

  private setPathIndex(path: string, idx: number): void {
    const had = this.pathIndex.has(path);
    this.pathIndex.set(path, idx);
    if (!had) {
      this.bumpDescCount(path);
      this.bumpChildIndex(path);
    }
    this.descCountGen = this.pathIndexGen + 1;
    this.childIndexGen = this.pathIndexGen + 1;
  }

  private deletePathIndex(path: string): boolean {
    const had = this.pathIndex.delete(path);
    if (had) {
      this.decDescCount(path);
      this.decChildIndex(path);
    }
    this.descCountGen = this.pathIndexGen + 1;
    this.childIndexGen = this.pathIndexGen + 1;
    return had;
  }

  private bumpDescCount(path: string): void {
    let pos = path.length;
    while (true) {
      pos = path.lastIndexOf('/', pos - 1);
      if (pos <= 0) break; // reached root, which has no descCount entry
      const ancestor = path.substring(0, pos);
      this.descCount.set(ancestor, (this.descCount.get(ancestor) ?? 0) + 1);
    }
  }

  private decDescCount(path: string): void {
    let pos = path.length;
    while (true) {
      pos = path.lastIndexOf('/', pos - 1);
      if (pos <= 0) break;
      const ancestor = path.substring(0, pos);
      const cur = this.descCount.get(ancestor);
      if (cur === undefined) break;
      if (cur <= 1) this.descCount.delete(ancestor);
      else this.descCount.set(ancestor, cur - 1);
    }
  }

  // ---- children index maintenance ----
  // For path /a/b/c.txt, registers: '/'→'a', '/a'→'b', '/a/b'→'c.txt',
  // each with a refcount of how many pathIndex entries pass through that edge.

  private bumpChildIndex(path: string): void {
    if (path === '/' || path.length === 0) return; // root is nobody's child
    let parent = '/';
    let start = 1;
    while (start <= path.length) {
      let end = path.indexOf('/', start);
      if (end === -1) end = path.length;
      const name = path.substring(start, end);
      if (name.length > 0) {
        let children = this.childIndex.get(parent);
        if (!children) {
          children = new Map<string, number>();
          this.childIndex.set(parent, children);
        }
        children.set(name, (children.get(name) ?? 0) + 1);
        parent = parent === '/' ? '/' + name : parent + '/' + name;
      }
      start = end + 1;
    }
  }

  private decChildIndex(path: string): void {
    if (path === '/' || path.length === 0) return;
    let parent = '/';
    let start = 1;
    while (start <= path.length) {
      let end = path.indexOf('/', start);
      if (end === -1) end = path.length;
      const name = path.substring(start, end);
      if (name.length > 0) {
        const children = this.childIndex.get(parent);
        if (!children) break; // index out of sync — staleness rebuild will fix
        const cur = children.get(name);
        if (cur === undefined) break;
        if (cur <= 1) {
          children.delete(name);
          if (children.size === 0) this.childIndex.delete(parent);
        } else {
          children.set(name, cur - 1);
        }
        parent = parent === '/' ? '/' + name : parent + '/' + name;
      }
      start = end + 1;
    }
  }

  /**
   * Resync childIndex with pathIndex if test scaffolding (or repair paths)
   * mutated pathIndex directly. Mirrors the descCount staleness contract.
   */
  private ensureChildIndex(): void {
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
  /**
   * How many direct children of `dirPath` are directories — the `nlink` a directory reports
   * (`2 + subdirectories`, as on a real filesystem).
   *
   * Counting through {@link getDirectChildrenWithImplicit} meant every `stat` on a directory
   * allocated one object and one string per child, built an array, and then **sorted** it, all to
   * arrive at a single integer. The sort in particular is entirely wasted: order cannot change a
   * count. This walks the child index directly and allocates nothing per child beyond the lookup
   * key, which is why `stat` on a directory was ~40× the cost of `stat` on a file.
   */
  private countSubdirectories(dirPath: string): number {
    this.ensureChildIndex();
    const names = this.childIndex.get(dirPath);
    if (!names) return 0;

    const prefix = dirPath === '/' ? '/' : dirPath + '/';
    let subdirs = 0;
    for (const name of names.keys()) {
      const childIdx = this.pathIndex.get(prefix + name);
      // No pathIndex entry means the child exists only because deeper descendants pass through
      // it — an implicit directory, which counts.
      if (childIdx === undefined) subdirs++;
      else if (this.readInode(childIdx).type === INODE_TYPE.DIRECTORY) subdirs++;
    }
    return subdirs;
  }

  private getDirectChildrenWithImplicit(dirPath: string): { path: string; type: 'real' | 'implicit' }[] {
    this.ensureChildIndex();
    const names = this.childIndex.get(dirPath);
    if (!names) return [];

    const prefix = dirPath === '/' ? '/' : dirPath + '/';
    const result: { path: string; type: 'real' | 'implicit' }[] = [];
    for (const name of names.keys()) {
      const full = prefix + name;
      // A child with its own pathIndex entry is a real inode; one that only
      // exists because deeper descendants pass through it is implicit.
      result.push({ path: full, type: this.pathIndex.has(full) ? 'real' : 'implicit' });
    }
    result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return result;
  }

  /**
   * Encode a synthetic stat response for an implicit directory.
   * Returns directory stats with default mode, zero size, current timestamps.
   */
  private encodeImplicitDirStatResponse(path: string): { status: number; data: Uint8Array } {
    // Use the stable timestamp assigned when this implicit dir was first
    // discovered, so repeated stat() calls return the same mtime/ctime/atime.
    this.rebuildImplicitDirs();
    const ts = this.implicitDirs.get(path) ?? Date.now();
    const mode = DEFAULT_DIR_MODE & ~(this.umask & 0o777);

    const nlink = 2 + this.countSubdirectories(path);

    // Encode stat: type(1) + mode(4) + size(8) + mtime(8) + ctime(8) + atime(8) + uid(4) + gid(4) + ino(4) + nlink(4) = 53 bytes
    const buf = new Uint8Array(53);
    const view = new DataView(buf.buffer);
    view.setUint8(0, INODE_TYPE.DIRECTORY);
    view.setUint32(1, mode, true);
    view.setFloat64(5, 0, true); // size = 0
    view.setFloat64(13, ts, true); // mtime
    view.setFloat64(21, ts, true); // ctime
    view.setFloat64(29, ts, true); // atime
    view.setUint32(37, this.processUid, true);
    view.setUint32(41, this.processGid, true);
    view.setUint32(45, 0, true); // ino = 0 (synthetic)
    view.setUint32(49, nlink, true);

    return { status: 0, data: buf };
  }

  private getAllDescendants(dirPath: string): string[] {
    const prefix = dirPath === '/' ? '/' : dirPath + '/';
    const descendants: string[] = [];

    for (const path of this.pathIndex.keys()) {
      // `path !== dirPath` matters only for the root: its prefix is '/', which every path starts
      // with — including '/' itself, so a recursive remove of the root deleted the root inode
      // along with its children and left the volume with no root at all. For any other directory
      // the trailing slash in `prefix` already excludes it.
      if (path !== dirPath && path.startsWith(prefix)) descendants.push(path);
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
    if (parentIdx === undefined) {
      // Check for implicit directory
      if (this.isImplicitDirectory(parentPath)) return 0;
      return CODE_TO_STATUS.ENOENT;
    }

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

  /** Get file path for a file descriptor (used by OPFS sync for FD-based ops) */
  getPathForFd(fd: number): string | null {
    const entry = this.fdTable.get(fd);
    if (!entry) return null;
    const inode = this.readInode(entry.inodeIdx);
    return this.readPath(inode.pathOffset, inode.pathLength);
  }

  /** Get file data by inode index */
  getInodeData(idx: number): { type: number; data: Uint8Array; mtime: number } {
    const inode = this.readInode(idx);
    const data = inode.size > 0
      ? this.readData(inode.firstBlock, inode.blockCount, inode.size)
      : new Uint8Array(0);
    return { type: inode.type, data, mtime: inode.mtime };
  }

  /** Export all files/dirs/symlinks from the VFS */
  exportAll(): Array<{ path: string; type: number; data: Uint8Array | null; mode: number; mtime: number }> {
    const result: Array<{ path: string; type: number; data: Uint8Array | null; mode: number; mtime: number }> = [];
    for (const [path, idx] of this.pathIndex) {
      const inode = this.readInode(idx);
      let data: Uint8Array | null = null;
      if (inode.type === INODE_TYPE.FILE || inode.type === INODE_TYPE.SYMLINK) {
        data = inode.size > 0
          ? this.readData(inode.firstBlock, inode.blockCount, inode.size)
          : new Uint8Array(0);
      }
      result.push({ path, type: inode.type, data, mode: inode.mode, mtime: inode.mtime });
    }
    // Sort directories first so parents are created before children
    result.sort((a, b) => {
      if (a.type === INODE_TYPE.DIRECTORY && b.type !== INODE_TYPE.DIRECTORY) return -1;
      if (a.type !== INODE_TYPE.DIRECTORY && b.type === INODE_TYPE.DIRECTORY) return 1;
      return a.path.localeCompare(b.path);
    });
    return result;
  }

  flush(): void {
    this.handle.flush();
  }
}
