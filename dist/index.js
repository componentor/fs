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
  const flags = opts?.flush !== false ? 1 : 0;
  const buf = encodeRequest(OP.WRITE, filePath, flags, encoded);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "write", filePath);
}
async function writeFile(asyncRequest, filePath, data, options) {
  const opts = typeof options === "string" ? { } : options;
  const flags = opts?.flush !== false ? 1 : 0;
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
var INODE_TYPE = {
  FILE: 1,
  DIRECTORY: 2,
  SYMLINK: 3
};

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
  const decoder8 = new TextDecoder();
  const entries = [];
  let offset = 4;
  for (let i = 0; i < count; i++) {
    const nameLen = view.getUint16(offset, true);
    offset += 2;
    const name = decoder8.decode(data.subarray(offset, offset + nameLen));
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
  const decoder8 = new TextDecoder();
  const names = [];
  let offset = 4;
  for (let i = 0; i < count; i++) {
    const nameLen = view.getUint16(offset, true);
    offset += 2;
    names.push(decoder8.decode(data.subarray(offset, offset + nameLen)));
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
function watch(_filePath, _options, _listener) {
  const interval = setInterval(() => {
  }, 1e3);
  const watcher = {
    close: () => clearInterval(interval),
    ref: () => watcher,
    unref: () => watcher
  };
  return watcher;
}
async function* watchAsync(asyncRequest, filePath, options) {
  let lastMtime = 0;
  const signal = options?.signal;
  while (!signal?.aborted) {
    try {
      const s = await stat(asyncRequest, filePath);
      if (s.mtimeMs !== lastMtime) {
        if (lastMtime !== 0) {
          yield { eventType: "change", filename: basename(filePath) };
        }
        lastMtime = s.mtimeMs;
      }
    } catch {
      yield { eventType: "rename", filename: basename(filePath) };
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

// src/filesystem.ts
var encoder9 = new TextEncoder();
var DEFAULT_SAB_SIZE = 2 * 1024 * 1024;
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
  // Config
  config;
  tabId;
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
    this.config = {
      root: config.root ?? "/",
      opfsSync: config.opfsSync ?? true,
      opfsSyncRoot: config.opfsSyncRoot ?? "/",
      uid: config.uid ?? 0,
      gid: config.gid ?? 0,
      umask: config.umask ?? 18,
      strictPermissions: config.strictPermissions ?? false,
      sabSize: config.sabSize ?? DEFAULT_SAB_SIZE,
      debug: config.debug ?? false
    };
    this.tabId = crypto.randomUUID();
    this.readyPromise = new Promise((resolve2) => {
      this.resolveReady = resolve2;
    });
    this.promises = new VFSPromises(this._async);
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
    navigator.locks.request("vfs-leader", { ifAvailable: true }, async (lock) => {
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
    navigator.locks.request("vfs-leader", async () => {
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
        opfsSync: this.config.opfsSync,
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
    this.leaderChangeBc = new BroadcastChannel("vfs-leader-change");
    this.leaderChangeBc.onmessage = () => {
      if (this.isFollower) {
        console.log("[VFS] Leader changed \u2014 reconnecting");
        this.connectToLeader();
      }
    };
  }
  /** Send a new port to sync-relay for connecting to the current leader */
  connectToLeader() {
    this.getServiceWorker().then((sw) => {
      const mc = new MessageChannel();
      sw.postMessage({ type: "transfer-port", tabId: this.tabId }, [mc.port2]);
      this.syncWorker.postMessage(
        { type: "leader-port", port: mc.port1 },
        [mc.port1]
      );
    }).catch((err) => {
      console.error("[VFS] Failed to connect to leader:", err.message);
    });
  }
  /** Register the VFS service worker and return the active SW */
  async getServiceWorker() {
    if (!this.swReg) {
      const swUrl = new URL("./workers/service.worker.js", import.meta.url);
      this.swReg = await navigator.serviceWorker.register(swUrl.href, { type: "module" });
    }
    const reg = this.swReg;
    if (reg.active) return reg.active;
    const sw = reg.installing || reg.waiting;
    if (!sw) throw new Error("No service worker found");
    return new Promise((resolve2, reject) => {
      const onState = () => {
        if (sw.state === "activated") {
          sw.removeEventListener("statechange", onState);
          resolve2(sw);
        } else if (sw.state === "redundant") {
          sw.removeEventListener("statechange", onState);
          reject(new Error("SW redundant"));
        }
      };
      sw.addEventListener("statechange", onState);
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
      const bc = new BroadcastChannel("vfs-leader-change");
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
    return watch();
  }
  watchFile(filePath, optionsOrListener, listener) {
  }
  unwatchFile(filePath, listener) {
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
  constructor(asyncRequest) {
    this._async = asyncRequest;
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
    yield* watchAsync(this._async, filePath, options);
  }
  async flush() {
    await this._async(OP.FSYNC, "");
  }
  async purge() {
  }
};

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

export { FSError, VFSFileSystem, constants, createError, createFS, getDefaultFS, init, path_exports as path, statusToError };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map