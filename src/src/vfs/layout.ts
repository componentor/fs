/**
 * VFS Binary Layout Constants
 *
 * Defines the on-disk structure of the virtual filesystem binary file.
 * All reads/writes go through a FileSystemSyncAccessHandle.
 */

// Magic number: "VFS!" in ASCII
export const VFS_MAGIC = 0x56465321;
export const VFS_VERSION = 1;

// Default sizes
export const DEFAULT_BLOCK_SIZE = 4096;
export const DEFAULT_INODE_COUNT = 10000;
export const INODE_SIZE = 64; // bytes per inode entry

// Superblock layout (64 bytes)
export const SUPERBLOCK = {
  SIZE: 64,
  MAGIC: 0,           // uint32 - 0x56465321
  VERSION: 4,         // uint32
  INODE_COUNT: 8,     // uint32 - total inodes allocated
  BLOCK_SIZE: 12,     // uint32 - data block size (default 4096)
  TOTAL_BLOCKS: 16,   // uint32 - total data blocks
  FREE_BLOCKS: 20,    // uint32 - available data blocks
  INODE_OFFSET: 24,   // float64 - byte offset to inode table
  PATH_OFFSET: 32,    // float64 - byte offset to path table
  DATA_OFFSET: 40,    // float64 - byte offset to data region
  BITMAP_OFFSET: 48,  // float64 - byte offset to free block bitmap
  PATH_USED: 56,      // uint32 - bytes used in path table
  RESERVED: 60,       // uint32
} as const;

// Inode entry layout (64 bytes each)
export const INODE = {
  TYPE: 0,            // uint8 - 0=free, 1=file, 2=directory, 3=symlink
  FLAGS: 1,           // uint8[3] - reserved
  PATH_OFFSET: 4,     // uint32 - byte offset into path table
  PATH_LENGTH: 8,     // uint16 - length of path string
  RESERVED_10: 10,    // uint16
  MODE: 12,           // uint32 - permissions (e.g. 0o100644)
  SIZE: 16,           // float64 - file content size in bytes (using f64 for >4GB)
  FIRST_BLOCK: 24,    // uint32 - index of first data block
  BLOCK_COUNT: 28,    // uint32 - number of contiguous data blocks
  MTIME: 32,          // float64 - last modification time (ms since epoch)
  CTIME: 40,          // float64 - creation/change time (ms since epoch)
  ATIME: 48,          // float64 - last access time (ms since epoch)
  UID: 56,            // uint32 - owner
  GID: 60,            // uint32 - group
} as const;

// Inode type constants
export const INODE_TYPE = {
  FREE: 0,
  FILE: 1,
  DIRECTORY: 2,
  SYMLINK: 3,
} as const;

// Default file modes
export const DEFAULT_FILE_MODE = 0o100644;
export const DEFAULT_DIR_MODE = 0o040755;
export const DEFAULT_SYMLINK_MODE = 0o120777;
export const DEFAULT_UMASK = 0o022;

// POSIX file type bits
export const S_IFMT = 0o170000;
export const S_IFREG = 0o100000;
export const S_IFDIR = 0o040000;
export const S_IFLNK = 0o120000;

// Max symlink depth for cycle detection
export const MAX_SYMLINK_DEPTH = 40;

// Path table compaction threshold (25% dead space)
export const PATH_COMPACTION_THRESHOLD = 0.25;

// Initial path table size (256KB)
export const INITIAL_PATH_TABLE_SIZE = 256 * 1024;

// Initial data blocks (1024 blocks = 4MB with 4KB blocks)
export const INITIAL_DATA_BLOCKS = 1024;

/**
 * Calculate section offsets for a fresh VFS.
 */
export function calculateLayout(inodeCount: number = DEFAULT_INODE_COUNT, blockSize: number = DEFAULT_BLOCK_SIZE, totalBlocks: number = INITIAL_DATA_BLOCKS) {
  const inodeTableOffset = SUPERBLOCK.SIZE;
  const inodeTableSize = inodeCount * INODE_SIZE;
  const pathTableOffset = inodeTableOffset + inodeTableSize;
  const pathTableSize = INITIAL_PATH_TABLE_SIZE;
  const bitmapOffset = pathTableOffset + pathTableSize;
  const bitmapSize = Math.ceil(totalBlocks / 8);
  // Align data region to block boundary
  const dataOffset = Math.ceil((bitmapOffset + bitmapSize) / blockSize) * blockSize;
  const totalSize = dataOffset + totalBlocks * blockSize;

  return {
    inodeTableOffset,
    inodeTableSize,
    pathTableOffset,
    pathTableSize,
    bitmapOffset,
    bitmapSize,
    dataOffset,
    totalSize,
    totalBlocks,
  };
}
