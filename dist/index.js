var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
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
  MKDTEMP: 30
};
var SAB_OFFSETS = {
  // Int32 - bytes in this chunk
  TOTAL_LEN: 16,
  // Int32 - reserved
  HEADER_SIZE: 32
  // Data payload starts here
};
var SIGNAL = {
  IDLE: 0,
  REQUEST: 1,
  RESPONSE: 2,
  CHUNK: 3,
  CHUNK_ACK: 4
};
var encoder = new TextEncoder();
new TextDecoder();
function encodeRequest(op, path, flags = 0, data) {
  const pathBytes = encoder.encode(path);
  const dataLen = data ? data.byteLength : 0;
  const totalLen = 16 + pathBytes.byteLength + dataLen;
  const buf = new ArrayBuffer(totalLen);
  const view = new DataView(buf);
  view.setUint32(0, op, true);
  view.setUint32(4, flags, true);
  view.setUint32(8, pathBytes.byteLength, true);
  view.setUint32(12, dataLen, true);
  const bytes = new Uint8Array(buf);
  bytes.set(pathBytes, 16);
  if (data) {
    bytes.set(data, 16 + pathBytes.byteLength);
  }
  return buf;
}
function decodeResponse(buf) {
  const view = new DataView(buf);
  const status = view.getUint32(0, true);
  const dataLen = view.getUint32(4, true);
  const data = dataLen > 0 ? new Uint8Array(buf, 8, dataLen) : null;
  return { status, data };
}
function encodeTwoPathRequest(op, path1, path2, flags = 0) {
  const path2Bytes = encoder.encode(path2);
  const payload = new Uint8Array(4 + path2Bytes.byteLength);
  const pv = new DataView(payload.buffer);
  pv.setUint32(0, path2Bytes.byteLength, true);
  payload.set(path2Bytes, 4);
  return encodeRequest(op, path1, flags, payload);
}

// src/errors.ts
var FSError = class extends Error {
  code;
  errno;
  syscall;
  path;
  constructor(code, errno, message, syscall, path) {
    super(message);
    this.name = "FSError";
    this.code = code;
    this.errno = errno;
    this.syscall = syscall;
    this.path = path;
  }
};
var ErrorCodes = {
  ENOENT: -2,
  EEXIST: -17,
  EISDIR: -21,
  ENOTDIR: -20,
  ENOTEMPTY: -39,
  EACCES: -13,
  EBADF: -9,
  EINVAL: -22,
  EMFILE: -24,
  ENOSPC: -28,
  EPERM: -1,
  ENOSYS: -38,
  ELOOP: -40
};
var STATUS_TO_CODE = {
  0: "OK",
  1: "ENOENT",
  2: "EEXIST",
  3: "EISDIR",
  4: "ENOTDIR",
  5: "ENOTEMPTY",
  6: "EACCES",
  7: "EINVAL",
  8: "EBADF",
  9: "ELOOP",
  10: "ENOSPC"
};
var CODE_TO_STATUS = {
  ENOENT: 1,
  EEXIST: 2,
  EISDIR: 3,
  ENOTDIR: 4,
  ENOTEMPTY: 5,
  EACCES: 6,
  EINVAL: 7,
  EBADF: 8};
function createError(code, syscall, path) {
  const errno = ErrorCodes[code] ?? -1;
  const messages = {
    ENOENT: "no such file or directory",
    EEXIST: "file already exists",
    EISDIR: "illegal operation on a directory",
    ENOTDIR: "not a directory",
    ENOTEMPTY: "directory not empty",
    EACCES: "permission denied",
    EINVAL: "invalid argument",
    EBADF: "bad file descriptor",
    ELOOP: "too many symbolic links encountered",
    ENOSPC: "no space left on device"
  };
  const msg = messages[code] ?? "unknown error";
  return new FSError(code, errno, `${code}: ${msg}, ${syscall} '${path}'`, syscall, path);
}
function statusToError(status, syscall, path) {
  const code = STATUS_TO_CODE[status] ?? "EINVAL";
  return createError(code, syscall, path);
}

// src/methods/readFile.ts
var decoder2 = new TextDecoder();
function readFileSync(syncRequest, filePath, options) {
  const encoding = typeof options === "string" ? options : options?.encoding;
  const buf = encodeRequest(OP.READ, filePath);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "read", filePath);
  const result = data ?? new Uint8Array(0);
  if (encoding) return decoder2.decode(result);
  return result;
}
async function readFile(asyncRequest, filePath, options) {
  const encoding = typeof options === "string" ? options : options?.encoding;
  const { status, data } = await asyncRequest(OP.READ, filePath);
  if (status !== 0) throw statusToError(status, "read", filePath);
  const result = data ?? new Uint8Array(0);
  if (encoding) return decoder2.decode(result);
  return result;
}

// src/methods/writeFile.ts
var encoder2 = new TextEncoder();
function writeFileSync(syncRequest, filePath, data, options) {
  const opts = typeof options === "string" ? { } : options;
  const encoded = typeof data === "string" ? encoder2.encode(data) : data;
  const flags = opts?.flush === true ? 1 : 0;
  const buf = encodeRequest(OP.WRITE, filePath, flags, encoded);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "write", filePath);
}
async function writeFile(asyncRequest, filePath, data, options) {
  const opts = typeof options === "string" ? { } : options;
  const flags = opts?.flush === true ? 1 : 0;
  const encoded = typeof data === "string" ? encoder2.encode(data) : data;
  const { status } = await asyncRequest(OP.WRITE, filePath, flags, encoded);
  if (status !== 0) throw statusToError(status, "write", filePath);
}

// src/methods/appendFile.ts
var encoder3 = new TextEncoder();
function appendFileSync(syncRequest, filePath, data, options) {
  const encoded = typeof data === "string" ? encoder3.encode(data) : data;
  const buf = encodeRequest(OP.APPEND, filePath, 0, encoded);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "appendFile", filePath);
}
async function appendFile(asyncRequest, filePath, data, options) {
  const encoded = typeof data === "string" ? encoder3.encode(data) : data;
  const { status } = await asyncRequest(OP.APPEND, filePath, 0, encoded);
  if (status !== 0) throw statusToError(status, "appendFile", filePath);
}

// src/methods/exists.ts
function existsSync(syncRequest, filePath) {
  const buf = encodeRequest(OP.EXISTS, filePath);
  const { data } = syncRequest(buf);
  return data ? data[0] === 1 : false;
}
async function exists(asyncRequest, filePath) {
  const { data } = await asyncRequest(OP.EXISTS, filePath);
  return data ? data[0] === 1 : false;
}

// src/methods/mkdir.ts
var decoder3 = new TextDecoder();
function mkdirSync(syncRequest, filePath, options) {
  const opts = typeof options === "number" ? { } : options;
  const flags = opts?.recursive ? 1 : 0;
  const buf = encodeRequest(OP.MKDIR, filePath, flags);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "mkdir", filePath);
  return data ? decoder3.decode(data) : void 0;
}
async function mkdir(asyncRequest, filePath, options) {
  const opts = typeof options === "number" ? { } : options;
  const flags = opts?.recursive ? 1 : 0;
  const { status, data } = await asyncRequest(OP.MKDIR, filePath, flags);
  if (status !== 0) throw statusToError(status, "mkdir", filePath);
  return data ? decoder3.decode(data) : void 0;
}

// src/methods/rmdir.ts
function rmdirSync(syncRequest, filePath, options) {
  const flags = options?.recursive ? 1 : 0;
  const buf = encodeRequest(OP.RMDIR, filePath, flags);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "rmdir", filePath);
}
async function rmdir(asyncRequest, filePath, options) {
  const flags = options?.recursive ? 1 : 0;
  const { status } = await asyncRequest(OP.RMDIR, filePath, flags);
  if (status !== 0) throw statusToError(status, "rmdir", filePath);
}

// src/methods/rm.ts
function rmSync(syncRequest, filePath, options) {
  const flags = (options?.recursive ? 1 : 0) | (options?.force ? 2 : 0);
  const buf = encodeRequest(OP.UNLINK, filePath, flags);
  const { status } = syncRequest(buf);
  if (status === 3) {
    const rmdirBuf = encodeRequest(OP.RMDIR, filePath, flags);
    const rmdirResult = syncRequest(rmdirBuf);
    if (rmdirResult.status !== 0) {
      if (options?.force && rmdirResult.status === 1) return;
      throw statusToError(rmdirResult.status, "rm", filePath);
    }
    return;
  }
  if (status !== 0) {
    if (options?.force && status === 1) return;
    throw statusToError(status, "rm", filePath);
  }
}
async function rm(asyncRequest, filePath, options) {
  const flags = (options?.recursive ? 1 : 0) | (options?.force ? 2 : 0);
  const { status } = await asyncRequest(OP.UNLINK, filePath, flags);
  if (status === 3) {
    const { status: s2 } = await asyncRequest(OP.RMDIR, filePath, flags);
    if (s2 !== 0) {
      if (options?.force && s2 === 1) return;
      throw statusToError(s2, "rm", filePath);
    }
    return;
  }
  if (status !== 0) {
    if (options?.force && status === 1) return;
    throw statusToError(status, "rm", filePath);
  }
}

// src/methods/unlink.ts
function unlinkSync(syncRequest, filePath) {
  const buf = encodeRequest(OP.UNLINK, filePath);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "unlink", filePath);
}
async function unlink(asyncRequest, filePath) {
  const { status } = await asyncRequest(OP.UNLINK, filePath);
  if (status !== 0) throw statusToError(status, "unlink", filePath);
}

// src/vfs/layout.ts
var VFS_MAGIC = 1447449377;
var VFS_VERSION = 1;
var DEFAULT_BLOCK_SIZE = 4096;
var DEFAULT_INODE_COUNT = 1e4;
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
  PATH_USED: 56};
var INODE = {
  TYPE: 0,
  // uint8 - 0=free, 1=file, 2=directory, 3=symlink
  FLAGS: 1,
  // uint8[3] - reserved
  PATH_OFFSET: 4,
  // uint32 - byte offset into path table
  PATH_LENGTH: 8,
  // uint16 - length of path string
  RESERVED_10: 10,
  // uint16
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
var MAX_SYMLINK_DEPTH = 40;
var INITIAL_PATH_TABLE_SIZE = 256 * 1024;
var INITIAL_DATA_BLOCKS = 1024;
function calculateLayout(inodeCount = DEFAULT_INODE_COUNT, blockSize = DEFAULT_BLOCK_SIZE, totalBlocks = INITIAL_DATA_BLOCKS) {
  const inodeTableOffset = SUPERBLOCK.SIZE;
  const inodeTableSize = inodeCount * INODE_SIZE;
  const pathTableOffset = inodeTableOffset + inodeTableSize;
  const pathTableSize = INITIAL_PATH_TABLE_SIZE;
  const bitmapOffset = pathTableOffset + pathTableSize;
  const bitmapSize = Math.ceil(totalBlocks / 8);
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
    totalBlocks
  };
}

// src/stats.ts
function decodeStats(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const type = view.getUint8(0);
  const mode = view.getUint32(1, true);
  const size = view.getFloat64(5, true);
  const mtimeMs = view.getFloat64(13, true);
  const ctimeMs = view.getFloat64(21, true);
  const atimeMs = view.getFloat64(29, true);
  const uid = view.getUint32(37, true);
  const gid = view.getUint32(41, true);
  const ino = view.getUint32(45, true);
  const isFile = type === INODE_TYPE.FILE;
  const isDirectory = type === INODE_TYPE.DIRECTORY;
  const isSymlink = type === INODE_TYPE.SYMLINK;
  return {
    isFile: () => isFile,
    isDirectory: () => isDirectory,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => isSymlink,
    isFIFO: () => false,
    isSocket: () => false,
    dev: 0,
    ino,
    mode,
    nlink: 1,
    uid,
    gid,
    rdev: 0,
    size,
    blksize: 4096,
    blocks: Math.ceil(size / 512),
    atimeMs,
    mtimeMs,
    ctimeMs,
    birthtimeMs: ctimeMs,
    atime: new Date(atimeMs),
    mtime: new Date(mtimeMs),
    ctime: new Date(ctimeMs),
    birthtime: new Date(ctimeMs)
  };
}
function decodeDirents(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(0, true);
  const decoder9 = new TextDecoder();
  const entries = [];
  let offset = 4;
  for (let i = 0; i < count; i++) {
    const nameLen = view.getUint16(offset, true);
    offset += 2;
    const name = decoder9.decode(data.subarray(offset, offset + nameLen));
    offset += nameLen;
    const type = data[offset++];
    const isFile = type === INODE_TYPE.FILE;
    const isDirectory = type === INODE_TYPE.DIRECTORY;
    const isSymlink = type === INODE_TYPE.SYMLINK;
    entries.push({
      name,
      isFile: () => isFile,
      isDirectory: () => isDirectory,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isSymbolicLink: () => isSymlink,
      isFIFO: () => false,
      isSocket: () => false
    });
  }
  return entries;
}
function decodeNames(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(0, true);
  const decoder9 = new TextDecoder();
  const names = [];
  let offset = 4;
  for (let i = 0; i < count; i++) {
    const nameLen = view.getUint16(offset, true);
    offset += 2;
    names.push(decoder9.decode(data.subarray(offset, offset + nameLen)));
    offset += nameLen;
  }
  return names;
}

// src/methods/readdir.ts
function readdirSync(syncRequest, filePath, options) {
  const opts = typeof options === "string" ? { } : options;
  const flags = opts?.withFileTypes ? 1 : 0;
  const buf = encodeRequest(OP.READDIR, filePath, flags);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "readdir", filePath);
  if (!data) return [];
  return opts?.withFileTypes ? decodeDirents(data) : decodeNames(data);
}
async function readdir(asyncRequest, filePath, options) {
  const opts = typeof options === "string" ? { } : options;
  const flags = opts?.withFileTypes ? 1 : 0;
  const { status, data } = await asyncRequest(OP.READDIR, filePath, flags);
  if (status !== 0) throw statusToError(status, "readdir", filePath);
  if (!data) return [];
  return opts?.withFileTypes ? decodeDirents(data) : decodeNames(data);
}

// src/methods/stat.ts
function statSync(syncRequest, filePath) {
  const buf = encodeRequest(OP.STAT, filePath);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "stat", filePath);
  return decodeStats(data);
}
function lstatSync(syncRequest, filePath) {
  const buf = encodeRequest(OP.LSTAT, filePath);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "lstat", filePath);
  return decodeStats(data);
}
async function stat(asyncRequest, filePath) {
  const { status, data } = await asyncRequest(OP.STAT, filePath);
  if (status !== 0) throw statusToError(status, "stat", filePath);
  return decodeStats(data);
}
async function lstat(asyncRequest, filePath) {
  const { status, data } = await asyncRequest(OP.LSTAT, filePath);
  if (status !== 0) throw statusToError(status, "lstat", filePath);
  return decodeStats(data);
}

// src/methods/rename.ts
var encoder4 = new TextEncoder();
function renameSync(syncRequest, oldPath, newPath) {
  const buf = encodeTwoPathRequest(OP.RENAME, oldPath, newPath);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "rename", oldPath);
}
async function rename(asyncRequest, oldPath, newPath) {
  const path2Bytes = encoder4.encode(newPath);
  const payload = new Uint8Array(4 + path2Bytes.byteLength);
  new DataView(payload.buffer).setUint32(0, path2Bytes.byteLength, true);
  payload.set(path2Bytes, 4);
  const { status } = await asyncRequest(OP.RENAME, oldPath, 0, payload);
  if (status !== 0) throw statusToError(status, "rename", oldPath);
}

// src/methods/copyFile.ts
var encoder5 = new TextEncoder();
function copyFileSync(syncRequest, src, dest, mode) {
  const buf = encodeTwoPathRequest(OP.COPY, src, dest, mode ?? 0);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "copyFile", src);
}
async function copyFile(asyncRequest, src, dest, mode) {
  const path2Bytes = encoder5.encode(dest);
  const payload = new Uint8Array(4 + path2Bytes.byteLength);
  new DataView(payload.buffer).setUint32(0, path2Bytes.byteLength, true);
  payload.set(path2Bytes, 4);
  const { status } = await asyncRequest(OP.COPY, src, mode ?? 0, payload);
  if (status !== 0) throw statusToError(status, "copyFile", src);
}

// src/methods/truncate.ts
function truncateSync(syncRequest, filePath, len = 0) {
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, len, true);
  const buf = encodeRequest(OP.TRUNCATE, filePath, 0, lenBuf);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "truncate", filePath);
}
async function truncate(asyncRequest, filePath, len) {
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, len ?? 0, true);
  const { status } = await asyncRequest(OP.TRUNCATE, filePath, 0, lenBuf);
  if (status !== 0) throw statusToError(status, "truncate", filePath);
}

// src/constants.ts
var constants = {
  // File access constants
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
  // File copy constants
  COPYFILE_EXCL: 1,
  COPYFILE_FICLONE: 2,
  COPYFILE_FICLONE_FORCE: 4,
  // File open constants
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  O_CREAT: 64,
  O_EXCL: 128,
  O_TRUNC: 512,
  O_APPEND: 1024,
  O_SYNC: 4096,
  // File type constants
  S_IFMT: 61440,
  S_IFREG: 32768,
  S_IFDIR: 16384,
  S_IFCHR: 8192,
  S_IFBLK: 24576,
  S_IFIFO: 4096,
  S_IFLNK: 40960,
  S_IFSOCK: 49152,
  // File mode constants
  S_IRWXU: 448,
  S_IRUSR: 256,
  S_IWUSR: 128,
  S_IXUSR: 64,
  S_IRWXG: 56,
  S_IRGRP: 32,
  S_IWGRP: 16,
  S_IXGRP: 8,
  S_IRWXO: 7,
  S_IROTH: 4,
  S_IWOTH: 2,
  S_IXOTH: 1
};

// src/methods/access.ts
function accessSync(syncRequest, filePath, mode = constants.F_OK) {
  const buf = encodeRequest(OP.ACCESS, filePath, mode);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "access", filePath);
}
async function access(asyncRequest, filePath, mode) {
  const { status } = await asyncRequest(OP.ACCESS, filePath, mode ?? 0);
  if (status !== 0) throw statusToError(status, "access", filePath);
}

// src/methods/realpath.ts
var decoder4 = new TextDecoder();
function realpathSync(syncRequest, filePath) {
  const buf = encodeRequest(OP.REALPATH, filePath);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "realpath", filePath);
  return decoder4.decode(data);
}
async function realpath(asyncRequest, filePath) {
  const { status, data } = await asyncRequest(OP.REALPATH, filePath);
  if (status !== 0) throw statusToError(status, "realpath", filePath);
  return decoder4.decode(data);
}

// src/methods/chmod.ts
function chmodSync(syncRequest, filePath, mode) {
  const modeBuf = new Uint8Array(4);
  new DataView(modeBuf.buffer).setUint32(0, mode, true);
  const buf = encodeRequest(OP.CHMOD, filePath, 0, modeBuf);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "chmod", filePath);
}
async function chmod(asyncRequest, filePath, mode) {
  const modeBuf = new Uint8Array(4);
  new DataView(modeBuf.buffer).setUint32(0, mode, true);
  const { status } = await asyncRequest(OP.CHMOD, filePath, 0, modeBuf);
  if (status !== 0) throw statusToError(status, "chmod", filePath);
}

// src/methods/chown.ts
function chownSync(syncRequest, filePath, uid, gid) {
  const ownerBuf = new Uint8Array(8);
  const dv = new DataView(ownerBuf.buffer);
  dv.setUint32(0, uid, true);
  dv.setUint32(4, gid, true);
  const buf = encodeRequest(OP.CHOWN, filePath, 0, ownerBuf);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "chown", filePath);
}
async function chown(asyncRequest, filePath, uid, gid) {
  const buf = new Uint8Array(8);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, uid, true);
  dv.setUint32(4, gid, true);
  const { status } = await asyncRequest(OP.CHOWN, filePath, 0, buf);
  if (status !== 0) throw statusToError(status, "chown", filePath);
}

// src/methods/utimes.ts
function utimesSync(syncRequest, filePath, atime, mtime) {
  const timesBuf = new Uint8Array(16);
  const dv = new DataView(timesBuf.buffer);
  dv.setFloat64(0, typeof atime === "number" ? atime : atime.getTime(), true);
  dv.setFloat64(8, typeof mtime === "number" ? mtime : mtime.getTime(), true);
  const buf = encodeRequest(OP.UTIMES, filePath, 0, timesBuf);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "utimes", filePath);
}
async function utimes(asyncRequest, filePath, atime, mtime) {
  const buf = new Uint8Array(16);
  const dv = new DataView(buf.buffer);
  dv.setFloat64(0, typeof atime === "number" ? atime : atime.getTime(), true);
  dv.setFloat64(8, typeof mtime === "number" ? mtime : mtime.getTime(), true);
  const { status } = await asyncRequest(OP.UTIMES, filePath, 0, buf);
  if (status !== 0) throw statusToError(status, "utimes", filePath);
}

// src/methods/symlink.ts
var encoder6 = new TextEncoder();
var decoder5 = new TextDecoder();
function symlinkSync(syncRequest, target, linkPath) {
  const targetBytes = encoder6.encode(target);
  const buf = encodeRequest(OP.SYMLINK, linkPath, 0, targetBytes);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "symlink", linkPath);
}
function readlinkSync(syncRequest, filePath) {
  const buf = encodeRequest(OP.READLINK, filePath);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "readlink", filePath);
  return decoder5.decode(data);
}
async function symlink(asyncRequest, target, linkPath) {
  const targetBytes = encoder6.encode(target);
  const { status } = await asyncRequest(OP.SYMLINK, linkPath, 0, targetBytes);
  if (status !== 0) throw statusToError(status, "symlink", linkPath);
}
async function readlink(asyncRequest, filePath) {
  const { status, data } = await asyncRequest(OP.READLINK, filePath);
  if (status !== 0) throw statusToError(status, "readlink", filePath);
  return decoder5.decode(data);
}

// src/methods/link.ts
var encoder7 = new TextEncoder();
function linkSync(syncRequest, existingPath, newPath) {
  const buf = encodeTwoPathRequest(OP.LINK, existingPath, newPath);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "link", existingPath);
}
async function link(asyncRequest, existingPath, newPath) {
  const path2Bytes = encoder7.encode(newPath);
  const payload = new Uint8Array(4 + path2Bytes.byteLength);
  new DataView(payload.buffer).setUint32(0, path2Bytes.byteLength, true);
  payload.set(path2Bytes, 4);
  const { status } = await asyncRequest(OP.LINK, existingPath, 0, payload);
  if (status !== 0) throw statusToError(status, "link", existingPath);
}

// src/methods/mkdtemp.ts
var decoder6 = new TextDecoder();
function mkdtempSync(syncRequest, prefix) {
  const buf = encodeRequest(OP.MKDTEMP, prefix);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "mkdtemp", prefix);
  return decoder6.decode(data);
}
async function mkdtemp(asyncRequest, prefix) {
  const { status, data } = await asyncRequest(OP.MKDTEMP, prefix);
  if (status !== 0) throw statusToError(status, "mkdtemp", prefix);
  return decoder6.decode(data);
}

// src/methods/open.ts
var encoder8 = new TextEncoder();
var decoder7 = new TextDecoder();
function parseFlags(flags) {
  switch (flags) {
    case "r":
      return constants.O_RDONLY;
    case "r+":
      return constants.O_RDWR;
    case "w":
      return constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC;
    case "w+":
      return constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC;
    case "a":
      return constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND;
    case "a+":
      return constants.O_RDWR | constants.O_CREAT | constants.O_APPEND;
    case "wx":
      return constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_EXCL;
    case "wx+":
      return constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC | constants.O_EXCL;
    case "ax":
      return constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_EXCL;
    case "ax+":
      return constants.O_RDWR | constants.O_CREAT | constants.O_APPEND | constants.O_EXCL;
    default:
      return constants.O_RDONLY;
  }
}
function openSync(syncRequest, filePath, flags = "r", _mode) {
  const numFlags = typeof flags === "string" ? parseFlags(flags) : flags;
  const buf = encodeRequest(OP.OPEN, filePath, numFlags);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "open", filePath);
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true);
}
function closeSync(syncRequest, fd) {
  const fdBuf = new Uint8Array(4);
  new DataView(fdBuf.buffer).setUint32(0, fd, true);
  const buf = encodeRequest(OP.CLOSE, "", 0, fdBuf);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "close", String(fd));
}
function readSync(syncRequest, fd, buffer, offset = 0, length = buffer.byteLength, position = null) {
  const fdBuf = new Uint8Array(12);
  const dv = new DataView(fdBuf.buffer);
  dv.setUint32(0, fd, true);
  dv.setUint32(4, length, true);
  dv.setInt32(8, position ?? -1, true);
  const buf = encodeRequest(OP.FREAD, "", 0, fdBuf);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "read", String(fd));
  if (data) {
    buffer.set(data.subarray(0, Math.min(data.byteLength, length)), offset);
    return data.byteLength;
  }
  return 0;
}
function writeSyncFd(syncRequest, fd, buffer, offset = 0, length = buffer.byteLength, position = null) {
  const writeData = buffer.subarray(offset, offset + length);
  const fdBuf = new Uint8Array(8 + writeData.byteLength);
  const dv = new DataView(fdBuf.buffer);
  dv.setUint32(0, fd, true);
  dv.setInt32(4, position ?? -1, true);
  fdBuf.set(writeData, 8);
  const buf = encodeRequest(OP.FWRITE, "", 0, fdBuf);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "write", String(fd));
  return data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
}
function fstatSync(syncRequest, fd) {
  const fdBuf = new Uint8Array(4);
  new DataView(fdBuf.buffer).setUint32(0, fd, true);
  const buf = encodeRequest(OP.FSTAT, "", 0, fdBuf);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "fstat", String(fd));
  return decodeStats(data);
}
function ftruncateSync(syncRequest, fd, len = 0) {
  const fdBuf = new Uint8Array(8);
  const dv = new DataView(fdBuf.buffer);
  dv.setUint32(0, fd, true);
  dv.setUint32(4, len, true);
  const buf = encodeRequest(OP.FTRUNCATE, "", 0, fdBuf);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "ftruncate", String(fd));
}
function fdatasyncSync(syncRequest, fd) {
  const buf = encodeRequest(OP.FSYNC, "");
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "fdatasync", String(fd));
}
async function open(asyncRequest, filePath, flags, _mode) {
  const numFlags = typeof flags === "string" ? parseFlags(flags ?? "r") : flags ?? 0;
  const { status, data } = await asyncRequest(OP.OPEN, filePath, numFlags);
  if (status !== 0) throw statusToError(status, "open", filePath);
  const fd = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true);
  return createFileHandle(fd, asyncRequest);
}
function createFileHandle(fd, asyncRequest) {
  return {
    fd,
    async read(buffer, offset = 0, length = buffer.byteLength, position = null) {
      const { status, data } = await asyncRequest(OP.FREAD, "", 0, null, void 0, { fd, length, position: position ?? -1 });
      if (status !== 0) throw statusToError(status, "read", String(fd));
      const bytesRead = data ? data.byteLength : 0;
      if (data) buffer.set(data.subarray(0, Math.min(bytesRead, length)), offset);
      return { bytesRead, buffer };
    },
    async write(buffer, offset = 0, length = buffer.byteLength, position = null) {
      const writeData = buffer.subarray(offset, offset + length);
      const { status, data } = await asyncRequest(OP.FWRITE, "", 0, null, void 0, { fd, data: writeData, position: position ?? -1 });
      if (status !== 0) throw statusToError(status, "write", String(fd));
      const bytesWritten = data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
      return { bytesWritten, buffer };
    },
    async readFile(options) {
      const encoding = typeof options === "string" ? options : options?.encoding;
      const { status, data } = await asyncRequest(OP.FREAD, "", 0, null, void 0, { fd, length: Number.MAX_SAFE_INTEGER, position: 0 });
      if (status !== 0) throw statusToError(status, "read", String(fd));
      const result = data ?? new Uint8Array(0);
      if (encoding) return decoder7.decode(result);
      return result;
    },
    async writeFile(data, _options) {
      const encoded = typeof data === "string" ? encoder8.encode(data) : data;
      const { status } = await asyncRequest(OP.FWRITE, "", 0, null, void 0, { fd, data: encoded, position: 0 });
      if (status !== 0) throw statusToError(status, "write", String(fd));
    },
    async truncate(len = 0) {
      const { status } = await asyncRequest(OP.FTRUNCATE, "", 0, null, void 0, { fd, length: len });
      if (status !== 0) throw statusToError(status, "ftruncate", String(fd));
    },
    async stat() {
      const { status, data } = await asyncRequest(OP.FSTAT, "", 0, null, void 0, { fd });
      if (status !== 0) throw statusToError(status, "fstat", String(fd));
      return decodeStats(data);
    },
    async sync() {
      await asyncRequest(OP.FSYNC, "");
    },
    async datasync() {
      await asyncRequest(OP.FSYNC, "");
    },
    async close() {
      const { status } = await asyncRequest(OP.CLOSE, "", 0, null, void 0, { fd });
      if (status !== 0) throw statusToError(status, "close", String(fd));
    }
  };
}

// src/methods/opendir.ts
async function opendir(asyncRequest, filePath) {
  const { status, data } = await asyncRequest(OP.OPENDIR, filePath);
  if (status !== 0) throw statusToError(status, "opendir", filePath);
  const fd = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true);
  let entries = null;
  let index = 0;
  const loadEntries = async () => {
    if (entries === null) {
      entries = await readdir(asyncRequest, filePath, { withFileTypes: true });
    }
  };
  return {
    path: filePath,
    async read() {
      await loadEntries();
      if (index >= entries.length) return null;
      return entries[index++];
    },
    async close() {
      const { status: status2 } = await asyncRequest(OP.CLOSE, "", 0, null, void 0, { fd });
      if (status2 !== 0) throw statusToError(status2, "close", String(fd));
    },
    async *[Symbol.asyncIterator]() {
      await loadEntries();
      for (const entry of entries) {
        yield entry;
      }
    }
  };
}

// src/path.ts
var path_exports = {};
__export(path_exports, {
  basename: () => basename,
  delimiter: () => delimiter,
  dirname: () => dirname,
  extname: () => extname,
  format: () => format,
  isAbsolute: () => isAbsolute,
  join: () => join,
  normalize: () => normalize,
  parse: () => parse,
  relative: () => relative,
  resolve: () => resolve,
  sep: () => sep
});
var sep = "/";
var delimiter = ":";
function normalize(p) {
  if (p.length === 0) return ".";
  const isAbsolute2 = p.charCodeAt(0) === 47;
  const segments = p.split("/");
  const result = [];
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (result.length > 0 && result[result.length - 1] !== "..") {
        result.pop();
      } else if (!isAbsolute2) {
        result.push("..");
      }
    } else {
      result.push(seg);
    }
  }
  let out = result.join("/");
  if (isAbsolute2) out = "/" + out;
  return out || (isAbsolute2 ? "/" : ".");
}
function join(...paths) {
  return normalize(paths.filter(Boolean).join("/"));
}
function resolve(...paths) {
  let resolved = "";
  for (let i = paths.length - 1; i >= 0; i--) {
    const p = paths[i];
    if (!p) continue;
    resolved = p + (resolved ? "/" + resolved : "");
    if (p.charCodeAt(0) === 47) break;
  }
  return normalize(resolved || "/");
}
function dirname(p) {
  if (p.length === 0) return ".";
  const i = p.lastIndexOf("/");
  if (i < 0) return ".";
  if (i === 0) return "/";
  return p.substring(0, i);
}
function basename(p, ext) {
  let base = p;
  const i = p.lastIndexOf("/");
  if (i >= 0) base = p.substring(i + 1);
  if (ext && base.endsWith(ext)) {
    base = base.substring(0, base.length - ext.length);
  }
  return base;
}
function extname(p) {
  const base = basename(p);
  const i = base.lastIndexOf(".");
  if (i <= 0) return "";
  return base.substring(i);
}
function isAbsolute(p) {
  return p.length > 0 && p.charCodeAt(0) === 47;
}
function relative(from, to) {
  const fromParts = resolve(from).split("/").filter(Boolean);
  const toParts = resolve(to).split("/").filter(Boolean);
  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common++;
  }
  const ups = fromParts.length - common;
  const result = [...Array(ups).fill(".."), ...toParts.slice(common)];
  return result.join("/") || ".";
}
function parse(p) {
  const dir = dirname(p);
  const base = basename(p);
  const ext = extname(p);
  const name = ext ? base.substring(0, base.length - ext.length) : base;
  const root = isAbsolute(p) ? "/" : "";
  return { root, dir, base, ext, name };
}
function format(obj) {
  const dir = obj.dir || obj.root || "";
  const base = obj.base || (obj.name || "") + (obj.ext || "");
  return dir ? dir === "/" ? "/" + base : dir + "/" + base : base;
}

// src/methods/watch.ts
var watchers = /* @__PURE__ */ new Set();
var fileWatchers = /* @__PURE__ */ new Map();
var bcMap = /* @__PURE__ */ new Map();
function ensureBc(ns) {
  const entry = bcMap.get(ns);
  if (entry) {
    entry.refCount++;
    return;
  }
  const bc = new BroadcastChannel(`${ns}-watch`);
  bcMap.set(ns, { bc, refCount: 1 });
  bc.onmessage = onBroadcast;
}
function releaseBc(ns) {
  const entry = bcMap.get(ns);
  if (!entry) return;
  if (--entry.refCount <= 0) {
    entry.bc.close();
    bcMap.delete(ns);
  }
}
function onBroadcast(event) {
  const { eventType, path: mutatedPath } = event.data;
  for (const entry of watchers) {
    const filename = matchWatcher(entry, mutatedPath);
    if (filename !== null) {
      try {
        entry.listener(eventType, filename);
      } catch {
      }
    }
  }
  const fileSet = fileWatchers.get(mutatedPath);
  if (fileSet) {
    for (const entry of fileSet) {
      triggerWatchFile(entry);
    }
  }
}
function matchWatcher(entry, mutatedPath) {
  const { absPath, recursive } = entry;
  if (mutatedPath === absPath) {
    return basename(mutatedPath);
  }
  const prefix = absPath.endsWith("/") ? absPath : absPath + "/";
  if (!mutatedPath.startsWith(prefix)) {
    return null;
  }
  const relativePath = mutatedPath.substring(prefix.length);
  if (recursive) return relativePath;
  return relativePath.indexOf("/") === -1 ? relativePath : null;
}
function watch(ns, filePath, options, listener) {
  const opts = typeof options === "string" ? { } : options ?? {};
  const cb = listener ?? (() => {
  });
  const absPath = resolve(filePath);
  const signal = opts.signal;
  const entry = {
    ns,
    absPath,
    recursive: opts.recursive ?? false,
    listener: cb,
    signal
  };
  ensureBc(ns);
  watchers.add(entry);
  if (signal) {
    const onAbort = () => {
      watchers.delete(entry);
      releaseBc(ns);
      signal.removeEventListener("abort", onAbort);
    };
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort);
    }
  }
  const watcher = {
    close() {
      watchers.delete(entry);
      releaseBc(ns);
    },
    ref() {
      return watcher;
    },
    unref() {
      return watcher;
    }
  };
  return watcher;
}
function watchFile(ns, syncRequest, filePath, optionsOrListener, listener) {
  let opts;
  let cb;
  if (typeof optionsOrListener === "function") {
    cb = optionsOrListener;
    opts = {};
  } else {
    opts = optionsOrListener ?? {};
    cb = listener;
  }
  if (!cb) return;
  const absPath = resolve(filePath);
  const interval = opts.interval ?? 5007;
  let prevStats = null;
  try {
    prevStats = statSync(syncRequest, absPath);
  } catch {
  }
  const entry = {
    ns,
    absPath,
    listener: cb,
    interval,
    prevStats,
    syncRequest,
    timerId: null
  };
  ensureBc(ns);
  let set = fileWatchers.get(absPath);
  if (!set) {
    set = /* @__PURE__ */ new Set();
    fileWatchers.set(absPath, set);
  }
  set.add(entry);
  entry.timerId = setInterval(() => triggerWatchFile(entry), interval);
}
function unwatchFile(ns, filePath, listener) {
  const absPath = resolve(filePath);
  const set = fileWatchers.get(absPath);
  if (!set) return;
  if (listener) {
    for (const entry of set) {
      if (entry.listener === listener) {
        if (entry.timerId !== null) clearInterval(entry.timerId);
        set.delete(entry);
        releaseBc(ns);
        break;
      }
    }
    if (set.size === 0) fileWatchers.delete(absPath);
  } else {
    for (const entry of set) {
      if (entry.timerId !== null) clearInterval(entry.timerId);
      releaseBc(ns);
    }
    fileWatchers.delete(absPath);
  }
}
function triggerWatchFile(entry) {
  let currStats = null;
  try {
    currStats = statSync(entry.syncRequest, entry.absPath);
  } catch {
  }
  const prev = entry.prevStats ?? emptyStats();
  const curr = currStats ?? emptyStats();
  if (prev.mtimeMs !== curr.mtimeMs || prev.size !== curr.size || prev.ino !== curr.ino) {
    entry.prevStats = currStats;
    try {
      entry.listener(curr, prev);
    } catch {
    }
  }
}
function emptyStats() {
  const zero = /* @__PURE__ */ new Date(0);
  return {
    isFile: () => false,
    isDirectory: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    dev: 0,
    ino: 0,
    mode: 0,
    nlink: 0,
    uid: 0,
    gid: 0,
    rdev: 0,
    size: 0,
    blksize: 4096,
    blocks: 0,
    atimeMs: 0,
    mtimeMs: 0,
    ctimeMs: 0,
    birthtimeMs: 0,
    atime: zero,
    mtime: zero,
    ctime: zero,
    birthtime: zero
  };
}
async function* watchAsync(ns, _asyncRequest, filePath, options) {
  const absPath = resolve(filePath);
  const recursive = options?.recursive ?? false;
  const signal = options?.signal;
  const queue = [];
  let resolve2 = null;
  const entry = {
    ns,
    absPath,
    recursive,
    listener: (eventType, filename) => {
      queue.push({ eventType, filename });
      if (resolve2) {
        resolve2();
        resolve2 = null;
      }
    },
    signal
  };
  ensureBc(ns);
  watchers.add(entry);
  try {
    while (!signal?.aborted) {
      if (queue.length === 0) {
        await new Promise((r) => {
          resolve2 = r;
        });
      }
      while (queue.length > 0) {
        yield queue.shift();
      }
    }
  } finally {
    watchers.delete(entry);
    releaseBc(ns);
  }
}

// src/filesystem.ts
var encoder9 = new TextEncoder();
var DEFAULT_SAB_SIZE = 2 * 1024 * 1024;
var instanceRegistry = /* @__PURE__ */ new Map();
var HEADER_SIZE = SAB_OFFSETS.HEADER_SIZE;
var _canAtomicsWait = typeof globalThis.WorkerGlobalScope !== "undefined";
function spinWait(arr, index, value) {
  if (_canAtomicsWait) {
    Atomics.wait(arr, index, value);
  } else {
    while (Atomics.load(arr, index) === value) {
    }
  }
}
var VFSFileSystem = class {
  // SAB for sync communication with sync relay worker (null when SAB unavailable)
  sab;
  ctrl;
  readySab;
  readySignal;
  // SAB for async-relay ↔ sync-relay communication
  asyncSab;
  // Whether SharedArrayBuffer is available (crossOriginIsolated)
  hasSAB = typeof SharedArrayBuffer !== "undefined";
  // Workers
  syncWorker;
  asyncWorker;
  // Async request tracking
  asyncCallId = 0;
  asyncPending = /* @__PURE__ */ new Map();
  // Ready promise for async callers
  readyPromise;
  resolveReady;
  isReady = false;
  // Config (definite assignment — always set when constructor doesn't return singleton)
  config;
  tabId;
  /** Namespace string derived from root — used for lock names, BroadcastChannel, and SW scope
   *  so multiple VFS instances with different roots don't collide. */
  ns;
  // Service worker registration for multi-tab port transfer
  swReg = null;
  isFollower = false;
  holdingLeaderLock = false;
  brokerInitialized = false;
  leaderChangeBc = null;
  // Bound request functions for method delegation
  _sync = (buf) => this.syncRequest(buf);
  _async = (op, p, flags, data, path2, fdArgs) => this.asyncRequest(op, p, flags, data, path2, fdArgs);
  // Promises API namespace
  promises;
  constructor(config = {}) {
    const root = config.root ?? "/";
    const ns = `vfs-${root.replace(/[^a-zA-Z0-9]/g, "_")}`;
    const existing = instanceRegistry.get(ns);
    if (existing) return existing;
    this.config = {
      root,
      opfsSync: config.opfsSync ?? true,
      opfsSyncRoot: config.opfsSyncRoot,
      uid: config.uid ?? 0,
      gid: config.gid ?? 0,
      umask: config.umask ?? 18,
      strictPermissions: config.strictPermissions ?? false,
      sabSize: config.sabSize ?? DEFAULT_SAB_SIZE,
      debug: config.debug ?? false,
      swScope: config.swScope
    };
    this.tabId = crypto.randomUUID();
    this.ns = ns;
    this.readyPromise = new Promise((resolve2) => {
      this.resolveReady = resolve2;
    });
    this.promises = new VFSPromises(this._async, ns);
    instanceRegistry.set(ns, this);
    this.bootstrap();
  }
  /** Spawn workers and establish communication */
  bootstrap() {
    const sabSize = this.config.sabSize;
    if (this.hasSAB) {
      this.sab = new SharedArrayBuffer(sabSize);
      this.readySab = new SharedArrayBuffer(4);
      this.asyncSab = new SharedArrayBuffer(sabSize);
      this.ctrl = new Int32Array(this.sab, 0, 8);
      this.readySignal = new Int32Array(this.readySab, 0, 1);
    }
    this.syncWorker = this.spawnWorker("sync-relay");
    this.asyncWorker = this.spawnWorker("async-relay");
    this.syncWorker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "ready") {
        this.isReady = true;
        this.resolveReady();
        if (!this.isFollower) {
          this.initLeaderBroker();
        }
      } else if (msg.type === "init-failed") {
        if (this.holdingLeaderLock) {
          setTimeout(() => this.sendLeaderInit(), 500);
        } else if (!("locks" in navigator)) {
          this.startAsFollower();
        }
      }
    };
    this.asyncWorker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "response") {
        const pending = this.asyncPending.get(msg.callId);
        if (pending) {
          this.asyncPending.delete(msg.callId);
          pending.resolve({ status: msg.status, data: msg.data });
        }
      }
    };
    if (this.hasSAB) {
      this.asyncWorker.postMessage({
        type: "init-leader",
        asyncSab: this.asyncSab,
        wakeSab: this.sab
      });
    } else {
      const mc = new MessageChannel();
      this.asyncWorker.postMessage(
        { type: "init-port", port: mc.port1 },
        [mc.port1]
      );
      this.syncWorker.postMessage(
        { type: "async-port", port: mc.port2 },
        [mc.port2]
      );
    }
    this.acquireLeaderLock();
  }
  /** Use Web Locks API for leader election. The tab that acquires the lock is
   *  the leader; all others become followers. When the leader dies, the browser
   *  releases the lock and the next waiting tab is promoted. */
  acquireLeaderLock() {
    if (!("locks" in navigator)) {
      this.startAsLeader();
      return;
    }
    let decided = false;
    navigator.locks.request(`${this.ns}-leader`, { ifAvailable: true }, async (lock) => {
      if (decided) return;
      decided = true;
      if (lock) {
        this.holdingLeaderLock = true;
        this.startAsLeader();
        await new Promise(() => {
        });
      } else {
        this.startAsFollower();
        this.waitForLeaderLock();
      }
    });
  }
  /** Queue for leader takeover when the current leader's lock is released */
  waitForLeaderLock() {
    if (!("locks" in navigator)) return;
    navigator.locks.request(`${this.ns}-leader`, async () => {
      console.log("[VFS] Leader lock acquired \u2014 promoting to leader");
      this.holdingLeaderLock = true;
      this.promoteToLeader();
      await new Promise(() => {
      });
    });
  }
  /** Send init-leader message to sync-relay worker */
  sendLeaderInit() {
    this.syncWorker.postMessage({
      type: "init-leader",
      sab: this.hasSAB ? this.sab : null,
      readySab: this.hasSAB ? this.readySab : null,
      asyncSab: this.hasSAB ? this.asyncSab : null,
      tabId: this.tabId,
      config: {
        root: this.config.root,
        ns: this.ns,
        opfsSync: this.config.opfsSync,
        opfsSyncRoot: this.config.opfsSyncRoot,
        uid: this.config.uid,
        gid: this.config.gid,
        umask: this.config.umask,
        strictPermissions: this.config.strictPermissions,
        debug: this.config.debug
      }
    });
  }
  /** Start as leader — tell sync-relay to init VFS engine + OPFS handle */
  startAsLeader() {
    this.isFollower = false;
    this.sendLeaderInit();
  }
  /** Start as follower — connect to leader via service worker port brokering */
  startAsFollower() {
    this.isFollower = true;
    this.syncWorker.postMessage({
      type: "init-follower",
      sab: this.hasSAB ? this.sab : null,
      readySab: this.hasSAB ? this.readySab : null,
      asyncSab: this.hasSAB ? this.asyncSab : null,
      tabId: this.tabId
    });
    this.connectToLeader();
    this.leaderChangeBc = new BroadcastChannel(`${this.ns}-leader-change`);
    this.leaderChangeBc.onmessage = () => {
      if (this.isFollower) {
        console.log("[VFS] Leader changed \u2014 reconnecting");
        this.connectToLeader();
      }
    };
  }
  /** Send a new port to sync-relay for connecting to the current leader */
  connectToLeader() {
    const mc = new MessageChannel();
    this.syncWorker.postMessage(
      { type: "leader-port", port: mc.port1 },
      [mc.port1]
    );
    this.getServiceWorker().then((sw) => {
      sw.postMessage({ type: "transfer-port", tabId: this.tabId }, [mc.port2]);
    }).catch((err) => {
      console.error("[VFS] Failed to connect to leader:", err.message);
      mc.port2.close();
    });
  }
  /** Register the VFS service worker and return the active SW */
  async getServiceWorker() {
    if (!this.swReg) {
      const swUrl = new URL("./workers/service.worker.js", import.meta.url);
      const scope = this.config.swScope ?? new URL(`./${this.ns}/`, swUrl).href;
      this.swReg = await navigator.serviceWorker.register(swUrl.href, { type: "module", scope });
    }
    const reg = this.swReg;
    if (reg.active) return reg.active;
    const sw = reg.installing || reg.waiting;
    if (!sw) throw new Error("No service worker found");
    return new Promise((resolve2, reject) => {
      const timer = setTimeout(() => {
        sw.removeEventListener("statechange", onState);
        reject(new Error("Service worker activation timeout"));
      }, 5e3);
      const onState = () => {
        if (sw.state === "activated") {
          clearTimeout(timer);
          sw.removeEventListener("statechange", onState);
          resolve2(sw);
        } else if (sw.state === "redundant") {
          clearTimeout(timer);
          sw.removeEventListener("statechange", onState);
          reject(new Error("SW redundant"));
        }
      };
      sw.addEventListener("statechange", onState);
      onState();
    });
  }
  /** Register as leader with SW broker (receives follower ports via control channel) */
  initLeaderBroker() {
    if (this.brokerInitialized) return;
    this.brokerInitialized = true;
    this.getServiceWorker().then((sw) => {
      const mc = new MessageChannel();
      sw.postMessage({ type: "register-server" }, [mc.port2]);
      mc.port1.onmessage = (event) => {
        if (event.data.type === "client-port") {
          const clientPort = event.ports[0];
          if (clientPort) {
            this.syncWorker.postMessage(
              { type: "client-port", tabId: event.data.tabId, port: clientPort },
              [clientPort]
            );
          }
        }
      };
      mc.port1.start();
      const bc = new BroadcastChannel(`${this.ns}-leader-change`);
      bc.postMessage({ type: "leader-changed" });
      bc.close();
    }).catch((err) => {
      console.warn("[VFS] SW broker unavailable, single-tab only:", err.message);
    });
  }
  /** Promote from follower to leader (after leader tab dies and lock is acquired) */
  promoteToLeader() {
    this.isFollower = false;
    this.isReady = false;
    this.brokerInitialized = false;
    if (this.leaderChangeBc) {
      this.leaderChangeBc.close();
      this.leaderChangeBc = null;
    }
    this.readyPromise = new Promise((resolve2) => {
      this.resolveReady = resolve2;
    });
    this.syncWorker.terminate();
    this.asyncWorker.terminate();
    const sabSize = this.config.sabSize;
    if (this.hasSAB) {
      this.sab = new SharedArrayBuffer(sabSize);
      this.readySab = new SharedArrayBuffer(4);
      this.asyncSab = new SharedArrayBuffer(sabSize);
      this.ctrl = new Int32Array(this.sab, 0, 8);
      this.readySignal = new Int32Array(this.readySab, 0, 1);
    }
    this.syncWorker = this.spawnWorker("sync-relay");
    this.asyncWorker = this.spawnWorker("async-relay");
    this.syncWorker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "ready") {
        this.isReady = true;
        this.resolveReady();
        this.initLeaderBroker();
      } else if (msg.type === "init-failed") {
        console.warn("[VFS] Promotion: OPFS handle still busy, retrying...");
        setTimeout(() => this.sendLeaderInit(), 500);
      }
    };
    this.asyncWorker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "response") {
        const pending = this.asyncPending.get(msg.callId);
        if (pending) {
          this.asyncPending.delete(msg.callId);
          pending.resolve({ status: msg.status, data: msg.data });
        }
      }
    };
    if (this.hasSAB) {
      this.asyncWorker.postMessage({
        type: "init-leader",
        asyncSab: this.asyncSab,
        wakeSab: this.sab
      });
    } else {
      const mc = new MessageChannel();
      this.asyncWorker.postMessage(
        { type: "init-port", port: mc.port1 },
        [mc.port1]
      );
      this.syncWorker.postMessage(
        { type: "async-port", port: mc.port2 },
        [mc.port2]
      );
    }
    this.sendLeaderInit();
  }
  /** Spawn an inline worker from bundled code */
  spawnWorker(name) {
    const workerUrl = new URL(`./workers/${name}.worker.js`, import.meta.url);
    return new Worker(workerUrl, { type: "module" });
  }
  // ========== Sync operation primitives ==========
  /** Block until workers are ready */
  ensureReady() {
    if (this.isReady) return;
    if (!this.hasSAB) {
      throw new Error("Sync API requires crossOriginIsolated (COOP/COEP headers). Use the promises API instead.");
    }
    if (Atomics.load(this.readySignal, 0) === 1) {
      this.isReady = true;
      return;
    }
    spinWait(this.readySignal, 0, 0);
    this.isReady = true;
  }
  /** Send a sync request via SAB and wait for response */
  syncRequest(requestBuf) {
    this.ensureReady();
    const t0 = this.config.debug ? performance.now() : 0;
    const maxChunk = this.sab.byteLength - HEADER_SIZE;
    const requestBytes = new Uint8Array(requestBuf);
    const totalLenView = new BigUint64Array(this.sab, SAB_OFFSETS.TOTAL_LEN, 1);
    if (requestBytes.byteLength <= maxChunk) {
      new Uint8Array(this.sab, HEADER_SIZE, requestBytes.byteLength).set(requestBytes);
      Atomics.store(this.ctrl, 3, requestBytes.byteLength);
      Atomics.store(totalLenView, 0, BigInt(requestBytes.byteLength));
      Atomics.store(this.ctrl, 0, SIGNAL.REQUEST);
      Atomics.notify(this.ctrl, 0);
    } else {
      let sent = 0;
      while (sent < requestBytes.byteLength) {
        const chunkSize = Math.min(maxChunk, requestBytes.byteLength - sent);
        new Uint8Array(this.sab, HEADER_SIZE, chunkSize).set(
          requestBytes.subarray(sent, sent + chunkSize)
        );
        Atomics.store(this.ctrl, 3, chunkSize);
        Atomics.store(totalLenView, 0, BigInt(requestBytes.byteLength));
        Atomics.store(this.ctrl, 6, Math.floor(sent / maxChunk));
        if (sent === 0) {
          Atomics.store(this.ctrl, 0, SIGNAL.REQUEST);
        } else {
          Atomics.store(this.ctrl, 0, SIGNAL.CHUNK);
        }
        Atomics.notify(this.ctrl, 0);
        sent += chunkSize;
        if (sent < requestBytes.byteLength) {
          spinWait(this.ctrl, 0, sent === chunkSize ? SIGNAL.REQUEST : SIGNAL.CHUNK);
        }
      }
    }
    spinWait(this.ctrl, 0, SIGNAL.REQUEST);
    const signal = Atomics.load(this.ctrl, 0);
    const respChunkLen = Atomics.load(this.ctrl, 3);
    const respTotalLen = Number(Atomics.load(totalLenView, 0));
    let responseBytes;
    if (signal === SIGNAL.RESPONSE && respTotalLen <= maxChunk) {
      responseBytes = new Uint8Array(this.sab, HEADER_SIZE, respChunkLen).slice();
    } else {
      responseBytes = new Uint8Array(respTotalLen);
      let received = 0;
      const firstLen = respChunkLen;
      responseBytes.set(new Uint8Array(this.sab, HEADER_SIZE, firstLen), 0);
      received += firstLen;
      while (received < respTotalLen) {
        Atomics.store(this.ctrl, 0, SIGNAL.CHUNK_ACK);
        Atomics.notify(this.ctrl, 0);
        spinWait(this.ctrl, 0, SIGNAL.CHUNK_ACK);
        const nextLen = Atomics.load(this.ctrl, 3);
        responseBytes.set(new Uint8Array(this.sab, HEADER_SIZE, nextLen), received);
        received += nextLen;
      }
    }
    Atomics.store(this.ctrl, 0, SIGNAL.IDLE);
    const result = decodeResponse(responseBytes.buffer);
    if (this.config.debug) {
      const t1 = performance.now();
      console.log(`[syncRequest] size=${requestBuf.byteLength} roundTrip=${(t1 - t0).toFixed(3)}ms`);
    }
    return result;
  }
  // ========== Async operation primitive ==========
  asyncRequest(op, filePath, flags, data, path2, fdArgs) {
    return this.readyPromise.then(() => {
      return new Promise((resolve2, reject) => {
        const callId = this.asyncCallId++;
        this.asyncPending.set(callId, { resolve: resolve2, reject });
        this.asyncWorker.postMessage({
          type: "request",
          callId,
          op,
          path: filePath,
          flags: flags ?? 0,
          data: data instanceof Uint8Array ? data : typeof data === "string" ? data : null,
          path2,
          fdArgs
        });
      });
    });
  }
  // ========== Sync API ==========
  readFileSync(filePath, options) {
    return readFileSync(this._sync, filePath, options);
  }
  writeFileSync(filePath, data, options) {
    writeFileSync(this._sync, filePath, data, options);
  }
  appendFileSync(filePath, data, options) {
    appendFileSync(this._sync, filePath, data);
  }
  existsSync(filePath) {
    return existsSync(this._sync, filePath);
  }
  mkdirSync(filePath, options) {
    return mkdirSync(this._sync, filePath, options);
  }
  rmdirSync(filePath, options) {
    rmdirSync(this._sync, filePath, options);
  }
  rmSync(filePath, options) {
    rmSync(this._sync, filePath, options);
  }
  unlinkSync(filePath) {
    unlinkSync(this._sync, filePath);
  }
  readdirSync(filePath, options) {
    return readdirSync(this._sync, filePath, options);
  }
  statSync(filePath) {
    return statSync(this._sync, filePath);
  }
  lstatSync(filePath) {
    return lstatSync(this._sync, filePath);
  }
  renameSync(oldPath, newPath) {
    renameSync(this._sync, oldPath, newPath);
  }
  copyFileSync(src, dest, mode) {
    copyFileSync(this._sync, src, dest, mode);
  }
  truncateSync(filePath, len) {
    truncateSync(this._sync, filePath, len);
  }
  accessSync(filePath, mode) {
    accessSync(this._sync, filePath, mode);
  }
  realpathSync(filePath) {
    return realpathSync(this._sync, filePath);
  }
  chmodSync(filePath, mode) {
    chmodSync(this._sync, filePath, mode);
  }
  chownSync(filePath, uid, gid) {
    chownSync(this._sync, filePath, uid, gid);
  }
  utimesSync(filePath, atime, mtime) {
    utimesSync(this._sync, filePath, atime, mtime);
  }
  symlinkSync(target, linkPath) {
    symlinkSync(this._sync, target, linkPath);
  }
  readlinkSync(filePath) {
    return readlinkSync(this._sync, filePath);
  }
  linkSync(existingPath, newPath) {
    linkSync(this._sync, existingPath, newPath);
  }
  mkdtempSync(prefix) {
    return mkdtempSync(this._sync, prefix);
  }
  // ---- File descriptor sync methods ----
  openSync(filePath, flags = "r", mode) {
    return openSync(this._sync, filePath, flags);
  }
  closeSync(fd) {
    closeSync(this._sync, fd);
  }
  readSync(fd, buffer, offset = 0, length = buffer.byteLength, position = null) {
    return readSync(this._sync, fd, buffer, offset, length, position);
  }
  writeSync(fd, buffer, offset = 0, length = buffer.byteLength, position = null) {
    return writeSyncFd(this._sync, fd, buffer, offset, length, position);
  }
  fstatSync(fd) {
    return fstatSync(this._sync, fd);
  }
  ftruncateSync(fd, len) {
    ftruncateSync(this._sync, fd, len);
  }
  fdatasyncSync(fd) {
    fdatasyncSync(this._sync, fd);
  }
  // ---- Watch methods ----
  watch(filePath, options, listener) {
    return watch(this.ns, filePath, options, listener);
  }
  watchFile(filePath, optionsOrListener, listener) {
    watchFile(this.ns, this._sync, filePath, optionsOrListener, listener);
  }
  unwatchFile(filePath, listener) {
    unwatchFile(this.ns, filePath, listener);
  }
  // ---- Stream methods ----
  createReadStream(filePath, options) {
    const opts = typeof options === "string" ? { } : options;
    const start = opts?.start ?? 0;
    const end = opts?.end;
    const highWaterMark = opts?.highWaterMark ?? 64 * 1024;
    let position = start;
    return new ReadableStream({
      pull: async (controller) => {
        try {
          const readLen = end !== void 0 ? Math.min(highWaterMark, end - position + 1) : highWaterMark;
          if (readLen <= 0) {
            controller.close();
            return;
          }
          const result = await this.promises.readFile(filePath);
          const data = result instanceof Uint8Array ? result : encoder9.encode(result);
          const chunk = data.subarray(position, position + readLen);
          if (chunk.byteLength === 0) {
            controller.close();
            return;
          }
          controller.enqueue(chunk);
          position += chunk.byteLength;
          if (end !== void 0 && position > end) {
            controller.close();
          }
        } catch (err) {
          controller.error(err);
        }
      }
    });
  }
  createWriteStream(filePath, options) {
    const opts = typeof options === "string" ? { } : options;
    let position = opts?.start ?? 0;
    let initialized = false;
    return new WritableStream({
      write: async (chunk) => {
        if (!initialized) {
          if (opts?.flags !== "a" && opts?.flags !== "a+") {
            await this.promises.writeFile(filePath, new Uint8Array(0));
          }
          initialized = true;
        }
        await this.promises.appendFile(filePath, chunk);
        position += chunk.byteLength;
      },
      close: async () => {
        if (opts?.flush) {
          await this.promises.flush();
        }
      }
    });
  }
  // ---- Utility methods ----
  flushSync() {
    const buf = encodeRequest(OP.FSYNC, "");
    this.syncRequest(buf);
  }
  purgeSync() {
  }
  /** Async init helper — avoid blocking main thread */
  init() {
    return this.readyPromise;
  }
};
var VFSPromises = class {
  _async;
  _ns;
  constructor(asyncRequest, ns) {
    this._async = asyncRequest;
    this._ns = ns;
  }
  readFile(filePath, options) {
    return readFile(this._async, filePath, options);
  }
  writeFile(filePath, data, options) {
    return writeFile(this._async, filePath, data, options);
  }
  appendFile(filePath, data, options) {
    return appendFile(this._async, filePath, data);
  }
  mkdir(filePath, options) {
    return mkdir(this._async, filePath, options);
  }
  rmdir(filePath, options) {
    return rmdir(this._async, filePath, options);
  }
  rm(filePath, options) {
    return rm(this._async, filePath, options);
  }
  unlink(filePath) {
    return unlink(this._async, filePath);
  }
  readdir(filePath, options) {
    return readdir(this._async, filePath, options);
  }
  stat(filePath) {
    return stat(this._async, filePath);
  }
  lstat(filePath) {
    return lstat(this._async, filePath);
  }
  access(filePath, mode) {
    return access(this._async, filePath, mode);
  }
  rename(oldPath, newPath) {
    return rename(this._async, oldPath, newPath);
  }
  copyFile(src, dest, mode) {
    return copyFile(this._async, src, dest, mode);
  }
  truncate(filePath, len) {
    return truncate(this._async, filePath, len);
  }
  realpath(filePath) {
    return realpath(this._async, filePath);
  }
  exists(filePath) {
    return exists(this._async, filePath);
  }
  chmod(filePath, mode) {
    return chmod(this._async, filePath, mode);
  }
  chown(filePath, uid, gid) {
    return chown(this._async, filePath, uid, gid);
  }
  utimes(filePath, atime, mtime) {
    return utimes(this._async, filePath, atime, mtime);
  }
  symlink(target, linkPath) {
    return symlink(this._async, target, linkPath);
  }
  readlink(filePath) {
    return readlink(this._async, filePath);
  }
  link(existingPath, newPath) {
    return link(this._async, existingPath, newPath);
  }
  open(filePath, flags, mode) {
    return open(this._async, filePath, flags);
  }
  opendir(filePath) {
    return opendir(this._async, filePath);
  }
  mkdtemp(prefix) {
    return mkdtemp(this._async, prefix);
  }
  async *watch(filePath, options) {
    yield* watchAsync(this._ns, this._async, filePath, options);
  }
  async flush() {
    await this._async(OP.FSYNC, "");
  }
  async purge() {
  }
};

// src/vfs/engine.ts
var encoder10 = new TextEncoder();
var decoder8 = new TextDecoder();
var VFSEngine = class {
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
  init(handle, opts) {
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
  /** Release the sync access handle (call on fatal error or shutdown) */
  closeHandle() {
    try {
      this.handle?.close();
    } catch (_) {
    }
  }
  /** Format a fresh VFS */
  format() {
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
    this.handle.truncate(layout.totalSize);
    this.writeSuperblock();
    const zeroBuf = new Uint8Array(layout.inodeTableSize);
    this.handle.write(zeroBuf, { at: this.inodeTableOffset });
    this.bitmap = new Uint8Array(layout.bitmapSize);
    this.handle.write(this.bitmap, { at: this.bitmapOffset });
    this.createInode("/", INODE_TYPE.DIRECTORY, DEFAULT_DIR_MODE, 0);
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
    const pathTableSize = bitmapOffset - pathTableOffset;
    if (pathUsed > pathTableSize) {
      throw new Error(`Corrupt VFS: path used (${pathUsed}) exceeds path table size (${pathTableSize})`);
    }
    const expectedMinSize = dataOffset + totalBlocks * blockSize;
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
  /** Shrink the OPFS file by removing trailing free blocks from the data region.
   *  Scans bitmap from end to find the last used block, then truncates. */
  trimTrailingBlocks() {
    const bitmap = this.bitmap;
    let lastUsed = -1;
    for (let byteIdx = Math.ceil(this.totalBlocks / 8) - 1; byteIdx >= 0; byteIdx--) {
      if (bitmap[byteIdx] !== 0) {
        for (let bit = 7; bit >= 0; bit--) {
          const blockIdx = byteIdx * 8 + bit;
          if (blockIdx < this.totalBlocks && bitmap[byteIdx] & 1 << bit) {
            lastUsed = blockIdx;
            break;
          }
        }
        break;
      }
    }
    const newTotal = Math.max(lastUsed + 1, INITIAL_DATA_BLOCKS);
    if (newTotal >= this.totalBlocks) return;
    this.handle.truncate(this.dataOffset + newTotal * this.blockSize);
    const newBitmapSize = Math.ceil(newTotal / 8);
    this.bitmap = bitmap.slice(0, newBitmapSize);
    const trimmed = this.totalBlocks - newTotal;
    this.freeBlocks -= trimmed;
    this.totalBlocks = newTotal;
    this.superblockDirty = true;
    this.bitmapDirtyLo = 0;
    this.bitmapDirtyHi = newBitmapSize - 1;
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
      const inode = {
        type,
        pathOffset: inodeView.getUint32(off + INODE.PATH_OFFSET, true),
        pathLength: inodeView.getUint16(off + INODE.PATH_LENGTH, true),
        mode: inodeView.getUint32(off + INODE.MODE, true),
        size: inodeView.getFloat64(off + INODE.SIZE, true),
        firstBlock: inodeView.getUint32(off + INODE.FIRST_BLOCK, true),
        blockCount: inodeView.getUint32(off + INODE.BLOCK_COUNT, true),
        mtime: inodeView.getFloat64(off + INODE.MTIME, true),
        ctime: inodeView.getFloat64(off + INODE.CTIME, true),
        atime: inodeView.getFloat64(off + INODE.ATIME, true),
        uid: inodeView.getUint32(off + INODE.UID, true),
        gid: inodeView.getUint32(off + INODE.GID, true)
      };
      this.inodeCache.set(i, inode);
      const path = pathBuf ? decoder8.decode(pathBuf.subarray(inode.pathOffset, inode.pathOffset + inode.pathLength)) : this.readPath(inode.pathOffset, inode.pathLength);
      this.pathIndex.set(path, i);
    }
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
  readPath(offset, length) {
    const buf = new Uint8Array(length);
    this.handle.read(buf, { at: this.pathTableOffset + offset });
    return decoder8.decode(buf);
  }
  appendPath(path) {
    const bytes = encoder10.encode(path);
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
    const dataSize = this.totalBlocks * this.blockSize;
    const dataBuf = new Uint8Array(dataSize);
    this.handle.read(dataBuf, { at: this.dataOffset });
    const newTotalSize = this.handle.getSize() + growth;
    this.handle.truncate(newTotalSize);
    const newBitmapOffset = this.bitmapOffset + growth;
    const newDataOffset = this.dataOffset + growth;
    this.handle.write(dataBuf, { at: newDataOffset });
    this.handle.write(this.bitmap, { at: newBitmapOffset });
    this.pathTableSize = newSize;
    this.bitmapOffset = newBitmapOffset;
    this.dataOffset = newDataOffset;
    this.superblockDirty = true;
  }
  // ========== Bitmap I/O ==========
  allocateBlocks(count) {
    if (count === 0) return 0;
    const bitmap = this.bitmap;
    let run = 0;
    let start = 0;
    for (let i = 0; i < this.totalBlocks; i++) {
      const byteIdx = i >>> 3;
      const bitIdx = i & 7;
      const used = bitmap[byteIdx] >>> bitIdx & 1;
      if (used) {
        run = 0;
        start = i + 1;
      } else {
        run++;
        if (run === count) {
          for (let j = start; j <= i; j++) {
            const bj = j >>> 3;
            const bi = j & 7;
            bitmap[bj] |= 1 << bi;
          }
          this.markBitmapDirty(start >>> 3, i >>> 3);
          this.freeBlocks -= count;
          this.superblockDirty = true;
          return start;
        }
      }
    }
    return this.growAndAllocate(count);
  }
  growAndAllocate(count) {
    const oldTotal = this.totalBlocks;
    const newTotal = Math.max(oldTotal * 2, oldTotal + count);
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
    const afterSize = this.handle.getSize() - afterInodeOffset;
    const afterBuf = new Uint8Array(afterSize);
    this.handle.read(afterBuf, { at: afterInodeOffset });
    this.handle.truncate(this.handle.getSize() + growth);
    this.handle.write(afterBuf, { at: afterInodeOffset + growth });
    const zeroes = new Uint8Array(growth);
    this.handle.write(zeroes, { at: afterInodeOffset });
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
    if (depth > MAX_SYMLINK_DEPTH) return void 0;
    const idx = this.pathIndex.get(path);
    if (idx === void 0) {
      return this.resolvePathComponents(path, true, depth);
    }
    const inode = this.readInode(idx);
    if (inode.type === INODE_TYPE.SYMLINK) {
      const target = decoder8.decode(this.readData(inode.firstBlock, inode.blockCount, inode.size));
      const resolved = target.startsWith("/") ? target : this.resolveRelative(path, target);
      return this.resolvePath(resolved, depth + 1);
    }
    return idx;
  }
  /** Resolve symlinks in intermediate path components */
  resolvePathComponents(path, followLast = true, depth = 0) {
    if (depth > MAX_SYMLINK_DEPTH) return void 0;
    const parts = path.split("/").filter(Boolean);
    let current = "/";
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      current = current === "/" ? "/" + parts[i] : current + "/" + parts[i];
      const idx = this.pathIndex.get(current);
      if (idx === void 0) return void 0;
      const inode = this.readInode(idx);
      if (inode.type === INODE_TYPE.SYMLINK && (!isLast || followLast)) {
        const target = decoder8.decode(this.readData(inode.firstBlock, inode.blockCount, inode.size));
        const resolved = target.startsWith("/") ? target : this.resolveRelative(current, target);
        if (isLast) {
          return this.resolvePathComponents(resolved, true, depth + 1);
        }
        const remaining = parts.slice(i + 1).join("/");
        const newPath = resolved + (remaining ? "/" + remaining : "");
        return this.resolvePathComponents(newPath, followLast, depth + 1);
      }
    }
    return this.pathIndex.get(current);
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
    this.pathIndex.set(path, idx);
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
    if (idx === void 0) return { status: CODE_TO_STATUS.ENOENT, data: null };
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
    const existingIdx = this.resolvePathComponents(path, true);
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
      const mode = DEFAULT_FILE_MODE & ~(this.umask & 511);
      this.createInode(path, INODE_TYPE.FILE, mode, data.byteLength, data);
      tAlloc = this.debug ? performance.now() : 0;
      tData = tAlloc;
      tInode = tAlloc;
    }
    if (flags & 1) {
      this.commitPending();
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
    const existing = inode.size > 0 ? this.readData(inode.firstBlock, inode.blockCount, inode.size) : new Uint8Array(0);
    const combined = new Uint8Array(existing.byteLength + data.byteLength);
    combined.set(existing);
    combined.set(data, existing.byteLength);
    const neededBlocks = Math.ceil(combined.byteLength / this.blockSize);
    this.freeBlockRange(inode.firstBlock, inode.blockCount);
    const newFirst = this.allocateBlocks(neededBlocks);
    this.writeData(newFirst, combined);
    inode.firstBlock = newFirst;
    inode.blockCount = neededBlocks;
    inode.size = combined.byteLength;
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
    this.freeBlockRange(inode.firstBlock, inode.blockCount);
    inode.type = INODE_TYPE.FREE;
    this.writeInode(idx, inode);
    this.pathIndex.delete(path);
    if (idx < this.freeInodeHint) this.freeInodeHint = idx;
    this.commitPending();
    return { status: 0 };
  }
  // ---- STAT ----
  stat(path) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === void 0) return { status: CODE_TO_STATUS.ENOENT, data: null };
    return this.encodeStatResponse(idx);
  }
  // ---- LSTAT (no symlink follow) ----
  lstat(path) {
    path = this.normalizePath(path);
    const idx = this.pathIndex.get(path);
    if (idx === void 0) return { status: CODE_TO_STATUS.ENOENT, data: null };
    return this.encodeStatResponse(idx);
  }
  encodeStatResponse(idx) {
    const inode = this.readInode(idx);
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
    view.setUint32(45, idx, true);
    return { status: 0, data: buf };
  }
  // ---- MKDIR ----
  mkdir(path, flags = 0) {
    path = this.normalizePath(path);
    const recursive = (flags & 1) !== 0;
    if (recursive) {
      return this.mkdirRecursive(path);
    }
    if (this.pathIndex.has(path)) return { status: CODE_TO_STATUS.EEXIST, data: null };
    const parentStatus = this.ensureParent(path);
    if (parentStatus !== 0) return { status: parentStatus, data: null };
    const mode = DEFAULT_DIR_MODE & ~(this.umask & 511);
    this.createInode(path, INODE_TYPE.DIRECTORY, mode, 0);
    this.commitPending();
    const pathBytes = encoder10.encode(path);
    return { status: 0, data: pathBytes };
  }
  mkdirRecursive(path) {
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
      const mode = DEFAULT_DIR_MODE & ~(this.umask & 511);
      this.createInode(current, INODE_TYPE.DIRECTORY, mode, 0);
      if (!firstCreated) firstCreated = current;
    }
    this.commitPending();
    const result = firstCreated ? encoder10.encode(firstCreated) : void 0;
    return { status: 0, data: result ?? null };
  }
  // ---- RMDIR ----
  rmdir(path, flags = 0) {
    path = this.normalizePath(path);
    const recursive = (flags & 1) !== 0;
    const idx = this.pathIndex.get(path);
    if (idx === void 0) return { status: CODE_TO_STATUS.ENOENT };
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
        this.pathIndex.delete(child);
      }
    }
    inode.type = INODE_TYPE.FREE;
    this.writeInode(idx, inode);
    this.pathIndex.delete(path);
    if (idx < this.freeInodeHint) this.freeInodeHint = idx;
    this.commitPending();
    return { status: 0 };
  }
  // ---- READDIR ----
  readdir(path, flags = 0) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === void 0) return { status: CODE_TO_STATUS.ENOENT, data: null };
    const inode = this.readInode(idx);
    if (inode.type !== INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.ENOTDIR, data: null };
    const withFileTypes = (flags & 1) !== 0;
    const children = this.getDirectChildren(path);
    if (withFileTypes) {
      let totalSize2 = 4;
      const entries = [];
      for (const childPath of children) {
        const name = childPath.substring(childPath.lastIndexOf("/") + 1);
        const nameBytes = encoder10.encode(name);
        const childIdx = this.pathIndex.get(childPath);
        const childInode = this.readInode(childIdx);
        entries.push({ name: nameBytes, type: childInode.type });
        totalSize2 += 2 + nameBytes.byteLength + 1;
      }
      const buf2 = new Uint8Array(totalSize2);
      const view2 = new DataView(buf2.buffer);
      view2.setUint32(0, entries.length, true);
      let offset2 = 4;
      for (const entry of entries) {
        view2.setUint16(offset2, entry.name.byteLength, true);
        offset2 += 2;
        buf2.set(entry.name, offset2);
        offset2 += entry.name.byteLength;
        buf2[offset2++] = entry.type;
      }
      return { status: 0, data: buf2 };
    }
    let totalSize = 4;
    const nameEntries = [];
    for (const childPath of children) {
      const name = childPath.substring(childPath.lastIndexOf("/") + 1);
      const nameBytes = encoder10.encode(name);
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
  rename(oldPath, newPath) {
    oldPath = this.normalizePath(oldPath);
    newPath = this.normalizePath(newPath);
    const idx = this.pathIndex.get(oldPath);
    if (idx === void 0) return { status: CODE_TO_STATUS.ENOENT };
    const parentStatus = this.ensureParent(newPath);
    if (parentStatus !== 0) return { status: parentStatus };
    const existingIdx = this.pathIndex.get(newPath);
    if (existingIdx !== void 0) {
      const existingInode = this.readInode(existingIdx);
      this.freeBlockRange(existingInode.firstBlock, existingInode.blockCount);
      existingInode.type = INODE_TYPE.FREE;
      this.writeInode(existingIdx, existingInode);
      this.pathIndex.delete(newPath);
    }
    const inode = this.readInode(idx);
    const { offset: pathOff, length: pathLen } = this.appendPath(newPath);
    inode.pathOffset = pathOff;
    inode.pathLength = pathLen;
    inode.mtime = Date.now();
    this.writeInode(idx, inode);
    this.pathIndex.delete(oldPath);
    this.pathIndex.set(newPath, idx);
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
        this.pathIndex.delete(p);
        this.pathIndex.set(childNewPath, i);
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
    buf[0] = idx !== void 0 ? 1 : 0;
    return { status: 0, data: buf };
  }
  // ---- TRUNCATE ----
  truncate(path, len = 0) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === void 0) return { status: CODE_TO_STATUS.ENOENT };
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
        const oldData = this.readData(inode.firstBlock, inode.blockCount, inode.size);
        this.freeBlockRange(inode.firstBlock, inode.blockCount);
        const newFirst = this.allocateBlocks(neededBlocks);
        const newData = new Uint8Array(len);
        newData.set(oldData);
        this.writeData(newFirst, newData);
        inode.firstBlock = newFirst;
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
    if (srcIdx === void 0) return { status: CODE_TO_STATUS.ENOENT };
    const srcInode = this.readInode(srcIdx);
    if (srcInode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EISDIR };
    if (flags & 1 && this.pathIndex.has(destPath)) {
      return { status: CODE_TO_STATUS.EEXIST };
    }
    const data = srcInode.size > 0 ? this.readData(srcInode.firstBlock, srcInode.blockCount, srcInode.size) : new Uint8Array(0);
    return this.write(destPath, data);
  }
  // ---- ACCESS ----
  access(path, mode = 0) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === void 0) return { status: CODE_TO_STATUS.ENOENT };
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
    if (idx === void 0) return { status: CODE_TO_STATUS.ENOENT, data: null };
    const inode = this.readInode(idx);
    const resolvedPath = this.readPath(inode.pathOffset, inode.pathLength);
    return { status: 0, data: encoder10.encode(resolvedPath) };
  }
  // ---- CHMOD ----
  chmod(path, mode) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === void 0) return { status: CODE_TO_STATUS.ENOENT };
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
    if (idx === void 0) return { status: CODE_TO_STATUS.ENOENT };
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
    if (idx === void 0) return { status: CODE_TO_STATUS.ENOENT };
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
    if (this.pathIndex.has(linkPath)) return { status: CODE_TO_STATUS.EEXIST };
    const parentStatus = this.ensureParent(linkPath);
    if (parentStatus !== 0) return { status: parentStatus };
    const targetBytes = encoder10.encode(target);
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
  // ---- LINK (hard link — copies the file) ----
  link(existingPath, newPath) {
    return this.copy(existingPath, newPath);
  }
  // ---- OPEN (file descriptor) ----
  open(path, flags, tabId) {
    path = this.normalizePath(path);
    const hasCreate = (flags & 64) !== 0;
    const hasTrunc = (flags & 512) !== 0;
    const hasExcl = (flags & 128) !== 0;
    let idx = this.resolvePathComponents(path, true);
    if (idx === void 0) {
      if (!hasCreate) return { status: CODE_TO_STATUS.ENOENT, data: null };
      const mode = DEFAULT_FILE_MODE & ~(this.umask & 511);
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
  close(fd) {
    if (!this.fdTable.has(fd)) return { status: CODE_TO_STATUS.EBADF };
    this.fdTable.delete(fd);
    return { status: 0 };
  }
  // ---- FREAD ----
  fread(fd, length, position) {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF, data: null };
    const inode = this.readInode(entry.inodeIdx);
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
    const inode = this.readInode(entry.inodeIdx);
    const isAppend = (entry.flags & 1024) !== 0;
    const pos = isAppend ? inode.size : position ?? entry.position;
    const endPos = pos + data.byteLength;
    if (endPos > inode.size) {
      const neededBlocks = Math.ceil(endPos / this.blockSize);
      if (neededBlocks > inode.blockCount) {
        const oldData = inode.size > 0 ? this.readData(inode.firstBlock, inode.blockCount, inode.size) : new Uint8Array(0);
        this.freeBlockRange(inode.firstBlock, inode.blockCount);
        const newFirst = this.allocateBlocks(neededBlocks);
        const newBuf = new Uint8Array(endPos);
        newBuf.set(oldData);
        newBuf.set(data, pos);
        this.writeData(newFirst, newBuf);
        inode.firstBlock = newFirst;
        inode.blockCount = neededBlocks;
      } else {
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
    return this.encodeStatResponse(entry.inodeIdx);
  }
  // ---- FTRUNCATE ----
  ftruncate(fd, len = 0) {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF };
    const inode = this.readInode(entry.inodeIdx);
    const path = this.readPath(inode.pathOffset, inode.pathLength);
    return this.truncate(path, len);
  }
  // ---- FSYNC ----
  fsync() {
    this.commitPending();
    this.handle.flush();
    return { status: 0 };
  }
  // ---- OPENDIR ----
  opendir(path, tabId) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === void 0) return { status: CODE_TO_STATUS.ENOENT, data: null };
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
    const mode = DEFAULT_DIR_MODE & ~(this.umask & 511);
    this.createInode(path, INODE_TYPE.DIRECTORY, mode, 0);
    this.commitPending();
    return { status: 0, data: encoder10.encode(path) };
  }
  // ========== Helpers ==========
  getDirectChildren(dirPath) {
    const prefix = dirPath === "/" ? "/" : dirPath + "/";
    const children = [];
    for (const path of this.pathIndex.keys()) {
      if (path === dirPath) continue;
      if (!path.startsWith(prefix)) continue;
      const rest = path.substring(prefix.length);
      if (!rest.includes("/")) {
        children.push(path);
      }
    }
    return children.sort();
  }
  getAllDescendants(dirPath) {
    const prefix = dirPath === "/" ? "/" : dirPath + "/";
    const descendants = [];
    for (const path of this.pathIndex.keys()) {
      if (path.startsWith(prefix)) descendants.push(path);
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
    if (parentIdx === void 0) return CODE_TO_STATUS.ENOENT;
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

// src/helpers.ts
var MemoryHandle = class {
  buf;
  len;
  constructor(initialData) {
    if (initialData && initialData.byteLength > 0) {
      this.buf = new Uint8Array(initialData);
      this.len = initialData.byteLength;
    } else {
      this.buf = new Uint8Array(1024 * 1024);
      this.len = 0;
    }
  }
  getSize() {
    return this.len;
  }
  read(target, opts) {
    const offset = opts?.at ?? 0;
    const dst = new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
    const bytesToRead = Math.min(dst.length, this.len - offset);
    if (bytesToRead <= 0) return 0;
    dst.set(this.buf.subarray(offset, offset + bytesToRead));
    return bytesToRead;
  }
  write(data, opts) {
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
  truncate(size) {
    if (size > this.buf.length) {
      this.grow(size);
    }
    if (size > this.len) {
      this.buf.fill(0, this.len, size);
    }
    this.len = size;
  }
  flush() {
  }
  close() {
  }
  /** Get the current data as an ArrayBuffer (trimmed to actual size) */
  getBuffer() {
    return this.buf.buffer.slice(0, this.len);
  }
  grow(minSize) {
    const newSize = Math.max(minSize, this.buf.length * 2);
    const newBuf = new Uint8Array(newSize);
    newBuf.set(this.buf.subarray(0, this.len));
    this.buf = newBuf;
  }
};
async function openVFSHandle(fileHandle) {
  try {
    const handle = await fileHandle.createSyncAccessHandle();
    return { handle, isMemory: false };
  } catch {
    const file = await fileHandle.getFile();
    const data = await file.arrayBuffer();
    return { handle: new MemoryHandle(data), isMemory: true };
  }
}
async function openFreshVFSHandle(fileHandle) {
  try {
    const handle = await fileHandle.createSyncAccessHandle();
    return { handle, isMemory: false };
  } catch {
    return { handle: new MemoryHandle(), isMemory: true };
  }
}
async function saveMemoryHandle(fileHandle, memHandle) {
  const writable = await fileHandle.createWritable();
  await writable.write(memHandle.getBuffer());
  await writable.close();
}
async function navigateToRoot(root) {
  let dir = await navigator.storage.getDirectory();
  if (root && root !== "/") {
    for (const seg of root.split("/").filter(Boolean)) {
      dir = await dir.getDirectoryHandle(seg, { create: true });
    }
  }
  return dir;
}
async function ensureParentDirs(rootDir, path) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  let dir = rootDir;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}
function basename2(path) {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}
async function writeOPFSFile(rootDir, path, data) {
  const parentDir = await ensureParentDirs(rootDir, path);
  const name = basename2(path);
  const fileHandle = await parentDir.getFileHandle(name, { create: true });
  try {
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
  } catch {
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
  }
}
async function clearDirectory(dir, skip) {
  const entries = [];
  for await (const name of dir.keys()) {
    if (!skip.has(name)) entries.push(name);
  }
  for (const name of entries) {
    await dir.removeEntry(name, { recursive: true });
  }
}
async function readOPFSRecursive(dir, prefix, skip) {
  const result = [];
  for await (const [name, handle] of dir.entries()) {
    if (prefix === "" && skip.has(name)) continue;
    const fullPath = prefix ? `${prefix}/${name}` : `/${name}`;
    if (handle.kind === "directory") {
      result.push({ path: fullPath, type: "directory" });
      const children = await readOPFSRecursive(handle, fullPath, skip);
      result.push(...children);
    } else {
      const file = await handle.getFile();
      const data = await file.arrayBuffer();
      result.push({ path: fullPath, type: "file", data });
    }
  }
  return result;
}
async function unpackToOPFS(root = "/") {
  const rootDir = await navigateToRoot(root);
  const vfsFileHandle = await rootDir.getFileHandle(".vfs.bin");
  const { handle } = await openVFSHandle(vfsFileHandle);
  let entries;
  try {
    const engine = new VFSEngine();
    engine.init(handle);
    entries = engine.exportAll();
  } finally {
    handle.close();
  }
  await clearDirectory(rootDir, /* @__PURE__ */ new Set([".vfs.bin"]));
  let files = 0;
  let directories = 0;
  for (const entry of entries) {
    if (entry.path === "/") continue;
    if (entry.type === INODE_TYPE.DIRECTORY) {
      await ensureParentDirs(rootDir, entry.path + "/dummy");
      const name = basename2(entry.path);
      const parent = await ensureParentDirs(rootDir, entry.path);
      await parent.getDirectoryHandle(name, { create: true });
      directories++;
    } else if (entry.type === INODE_TYPE.FILE) {
      await writeOPFSFile(rootDir, entry.path, entry.data ?? new Uint8Array(0));
      files++;
    } else if (entry.type === INODE_TYPE.SYMLINK) {
      await writeOPFSFile(rootDir, entry.path, entry.data ?? new Uint8Array(0));
      files++;
    }
  }
  return { files, directories };
}
async function loadFromOPFS(root = "/") {
  const rootDir = await navigateToRoot(root);
  const opfsEntries = await readOPFSRecursive(rootDir, "", /* @__PURE__ */ new Set([".vfs.bin"]));
  try {
    await rootDir.removeEntry(".vfs.bin");
  } catch (_) {
  }
  const vfsFileHandle = await rootDir.getFileHandle(".vfs.bin", { create: true });
  const { handle, isMemory } = await openFreshVFSHandle(vfsFileHandle);
  try {
    const engine = new VFSEngine();
    engine.init(handle);
    const dirs = opfsEntries.filter((e) => e.type === "directory").sort((a, b) => a.path.localeCompare(b.path));
    let files = 0;
    let directories = 0;
    for (const dir of dirs) {
      engine.mkdir(dir.path, 16877);
      directories++;
    }
    const fileEntries = opfsEntries.filter((e) => e.type === "file");
    for (const file of fileEntries) {
      engine.write(file.path, new Uint8Array(file.data));
      files++;
    }
    engine.flush();
    if (isMemory) {
      await saveMemoryHandle(vfsFileHandle, handle);
    }
    return { files, directories };
  } finally {
    handle.close();
  }
}
async function repairVFS(root = "/") {
  const rootDir = await navigateToRoot(root);
  const vfsFileHandle = await rootDir.getFileHandle(".vfs.bin");
  const file = await vfsFileHandle.getFile();
  const raw = new Uint8Array(await file.arrayBuffer());
  const fileSize = raw.byteLength;
  if (fileSize < SUPERBLOCK.SIZE) {
    throw new Error(`VFS file too small to repair (${fileSize} bytes)`);
  }
  const view = new DataView(raw.buffer);
  let inodeCount;
  let blockSize;
  let totalBlocks;
  let inodeTableOffset;
  let pathTableOffset;
  let dataOffset;
  const magic = view.getUint32(SUPERBLOCK.MAGIC, true);
  const version = view.getUint32(SUPERBLOCK.VERSION, true);
  const superblockValid = magic === VFS_MAGIC && version === VFS_VERSION;
  if (superblockValid) {
    inodeCount = view.getUint32(SUPERBLOCK.INODE_COUNT, true);
    blockSize = view.getUint32(SUPERBLOCK.BLOCK_SIZE, true);
    totalBlocks = view.getUint32(SUPERBLOCK.TOTAL_BLOCKS, true);
    inodeTableOffset = view.getFloat64(SUPERBLOCK.INODE_OFFSET, true);
    pathTableOffset = view.getFloat64(SUPERBLOCK.PATH_OFFSET, true);
    view.getFloat64(SUPERBLOCK.BITMAP_OFFSET, true);
    dataOffset = view.getFloat64(SUPERBLOCK.DATA_OFFSET, true);
    view.getUint32(SUPERBLOCK.PATH_USED, true);
    if (blockSize === 0 || (blockSize & blockSize - 1) !== 0 || inodeCount === 0 || inodeTableOffset >= fileSize || pathTableOffset >= fileSize || dataOffset >= fileSize) {
      const layout = calculateLayout(DEFAULT_INODE_COUNT, DEFAULT_BLOCK_SIZE, INITIAL_DATA_BLOCKS);
      inodeCount = DEFAULT_INODE_COUNT;
      blockSize = DEFAULT_BLOCK_SIZE;
      totalBlocks = INITIAL_DATA_BLOCKS;
      inodeTableOffset = layout.inodeTableOffset;
      pathTableOffset = layout.pathTableOffset;
      dataOffset = layout.dataOffset;
    }
  } else {
    const layout = calculateLayout(DEFAULT_INODE_COUNT, DEFAULT_BLOCK_SIZE, INITIAL_DATA_BLOCKS);
    inodeCount = DEFAULT_INODE_COUNT;
    blockSize = DEFAULT_BLOCK_SIZE;
    totalBlocks = INITIAL_DATA_BLOCKS;
    inodeTableOffset = layout.inodeTableOffset;
    pathTableOffset = layout.pathTableOffset;
    dataOffset = layout.dataOffset;
  }
  const decoder9 = new TextDecoder();
  const recovered = [];
  let lost = 0;
  const maxInodes = Math.min(inodeCount, Math.floor((fileSize - inodeTableOffset) / INODE_SIZE));
  for (let i = 0; i < maxInodes; i++) {
    const off = inodeTableOffset + i * INODE_SIZE;
    if (off + INODE_SIZE > fileSize) break;
    const type = raw[off + INODE.TYPE];
    if (type < INODE_TYPE.FILE || type > INODE_TYPE.SYMLINK) continue;
    const inodeView = new DataView(raw.buffer, off, INODE_SIZE);
    const pathOffset = inodeView.getUint32(INODE.PATH_OFFSET, true);
    const pathLength = inodeView.getUint16(INODE.PATH_LENGTH, true);
    const size = inodeView.getFloat64(INODE.SIZE, true);
    const firstBlock = inodeView.getUint32(INODE.FIRST_BLOCK, true);
    inodeView.getUint32(INODE.BLOCK_COUNT, true);
    const absPathOffset = pathTableOffset + pathOffset;
    if (pathLength === 0 || pathLength > 4096 || absPathOffset + pathLength > fileSize) {
      lost++;
      continue;
    }
    let path;
    try {
      path = decoder9.decode(raw.subarray(absPathOffset, absPathOffset + pathLength));
    } catch {
      lost++;
      continue;
    }
    if (!path.startsWith("/") || path.includes("\0")) {
      lost++;
      continue;
    }
    if (type === INODE_TYPE.DIRECTORY) {
      recovered.push({ path, type, data: new Uint8Array(0) });
      continue;
    }
    if (size < 0 || size > fileSize || !isFinite(size)) {
      lost++;
      continue;
    }
    const dataStart = dataOffset + firstBlock * blockSize;
    if (dataStart + size > fileSize || firstBlock >= totalBlocks) {
      recovered.push({ path, type, data: new Uint8Array(0) });
      lost++;
      continue;
    }
    const data = raw.slice(dataStart, dataStart + size);
    recovered.push({ path, type, data });
  }
  await rootDir.removeEntry(".vfs.bin");
  const newFileHandle = await rootDir.getFileHandle(".vfs.bin", { create: true });
  const { handle, isMemory } = await openFreshVFSHandle(newFileHandle);
  try {
    const engine = new VFSEngine();
    engine.init(handle);
    const dirs = recovered.filter((e) => e.type === INODE_TYPE.DIRECTORY && e.path !== "/").sort((a, b) => a.path.localeCompare(b.path));
    const files = recovered.filter((e) => e.type === INODE_TYPE.FILE);
    const symlinks = recovered.filter((e) => e.type === INODE_TYPE.SYMLINK);
    for (const dir of dirs) {
      const result = engine.mkdir(dir.path, 16877);
      if (result.status !== 0) lost++;
    }
    for (const file2 of files) {
      const result = engine.write(file2.path, file2.data);
      if (result.status !== 0) lost++;
    }
    for (const sym of symlinks) {
      const target = decoder9.decode(sym.data);
      const result = engine.symlink(target, sym.path);
      if (result.status !== 0) lost++;
    }
    engine.flush();
    if (isMemory) {
      await saveMemoryHandle(newFileHandle, handle);
    }
  } finally {
    handle.close();
  }
  const entries = recovered.filter((e) => e.path !== "/").map((e) => ({
    path: e.path,
    type: e.type === INODE_TYPE.FILE ? "file" : e.type === INODE_TYPE.DIRECTORY ? "directory" : "symlink",
    size: e.data.byteLength
  }));
  return { recovered: entries.length, lost, entries };
}

// src/index.ts
function createFS(config) {
  return new VFSFileSystem(config);
}
var _defaultFS;
function getDefaultFS() {
  if (!_defaultFS) _defaultFS = new VFSFileSystem();
  return _defaultFS;
}
function init() {
  return getDefaultFS().init();
}

export { FSError, VFSFileSystem, constants, createError, createFS, getDefaultFS, init, loadFromOPFS, path_exports as path, repairVFS, statusToError, unpackToOPFS };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map