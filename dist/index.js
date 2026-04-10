var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/node-streams.ts
var SimpleEventEmitter = class {
  _listeners = /* @__PURE__ */ new Map();
  _onceSet = /* @__PURE__ */ new WeakSet();
  on(event, fn) {
    let arr = this._listeners.get(event);
    if (!arr) {
      arr = [];
      this._listeners.set(event, arr);
    }
    arr.push(fn);
    return this;
  }
  addListener(event, fn) {
    return this.on(event, fn);
  }
  once(event, fn) {
    this._onceSet.add(fn);
    return this.on(event, fn);
  }
  off(event, fn) {
    const arr = this._listeners.get(event);
    if (arr) {
      const idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    }
    return this;
  }
  removeListener(event, fn) {
    return this.off(event, fn);
  }
  removeAllListeners(event) {
    if (event !== void 0) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
    return this;
  }
  emit(event, ...args) {
    const arr = this._listeners.get(event);
    if (!arr || arr.length === 0) return false;
    const copy = arr.slice();
    for (const fn of copy) {
      if (this._onceSet.has(fn)) {
        this._onceSet.delete(fn);
        this.off(event, fn);
      }
      fn(...args);
    }
    return true;
  }
  listenerCount(event) {
    return this._listeners.get(event)?.length ?? 0;
  }
};
var NodeReadable = class extends SimpleEventEmitter {
  constructor(_readFn, destroyFn) {
    super();
    this._readFn = _readFn;
    if (destroyFn) this._destroyFn = destroyFn;
  }
  _paused = true;
  _destroyed = false;
  _ended = false;
  _reading = false;
  _readBuffer = null;
  _encoding = null;
  /** Whether the stream is still readable (not ended or destroyed). */
  readable = true;
  /** The file path this stream reads from (set externally). */
  path = "";
  /** Total bytes read so far. */
  bytesRead = 0;
  /** Optional cleanup callback invoked on destroy (e.g. close file handle). */
  _destroyFn = null;
  // ---- Flow control (override on to auto-resume) ----
  on(event, fn) {
    super.on(event, fn);
    if (event === "data" && this._paused) {
      this.resume();
    }
    return this;
  }
  pause() {
    this._paused = true;
    return this;
  }
  resume() {
    if (this._destroyed || this._ended) return this;
    this._paused = false;
    this._drain();
    return this;
  }
  /**
   * Set the character encoding for data read from this stream.
   * When set, 'data' events emit strings instead of Uint8Array.
   */
  setEncoding(encoding) {
    this._encoding = encoding;
    return this;
  }
  /**
   * Non-flowing read — returns the last buffered chunk or null.
   * Node.js has a complex buffer system; we keep it simple here.
   */
  read(_size) {
    const buf = this._readBuffer;
    this._readBuffer = null;
    return buf;
  }
  /** Destroy the stream, optionally with an error. */
  destroy(err) {
    if (this._destroyed) return this;
    this._destroyed = true;
    this.readable = false;
    if (err) {
      this.emit("error", err);
    }
    if (this._destroyFn) {
      this._destroyFn().then(
        () => this.emit("close"),
        () => this.emit("close")
      );
    } else {
      this.emit("close");
    }
    return this;
  }
  // ---- pipe ----
  pipe(dest) {
    if (isNodeWritableInstance(dest)) {
      this.on("data", (chunk) => {
        dest.write(chunk);
      });
      this.on("end", () => {
        if (typeof dest.end === "function") {
          dest.end();
        }
      });
      this.on("error", (err) => {
        if (typeof dest.destroy === "function") {
          dest.destroy(err);
        }
      });
    } else {
      const writer = dest.getWriter();
      this.on("data", (chunk) => {
        writer.write(chunk);
      });
      this.on("end", () => {
        writer.close();
      });
      this.on("error", (err) => {
        writer.abort(err);
      });
    }
    if (this._paused) {
      this.resume();
    }
    return dest;
  }
  // ---- Internal ----
  async _drain() {
    if (this._reading || this._destroyed || this._ended) return;
    this._reading = true;
    try {
      while (!this._paused && !this._destroyed && !this._ended) {
        const result = await this._readFn();
        if (this._destroyed) break;
        if (result.done || !result.value || result.value.byteLength === 0) {
          this._ended = true;
          this.readable = false;
          this.emit("end");
          this.emit("close");
          break;
        }
        this.bytesRead += result.value.byteLength;
        this._readBuffer = result.value;
        if (this._encoding) {
          this.emit("data", new TextDecoder(this._encoding).decode(result.value));
        } else {
          this.emit("data", result.value);
        }
      }
    } catch (err) {
      if (!this._destroyed) {
        this.destroy(err);
      }
    } finally {
      this._reading = false;
    }
  }
};
var NodeWritable = class extends SimpleEventEmitter {
  constructor(path, _writeFn, _closeFn) {
    super();
    this._writeFn = _writeFn;
    this._closeFn = _closeFn;
    this.path = path;
  }
  /** Total bytes written so far. */
  bytesWritten = 0;
  /** The file path this stream was created for. */
  path;
  /** Whether this stream is still writable. */
  writable = true;
  _destroyed = false;
  _finished = false;
  _writing = false;
  _corked = false;
  // -- public API -----------------------------------------------------------
  /**
   * Buffer all writes until `uncork()` is called.
   * In this minimal implementation we only track the flag for compatibility.
   */
  cork() {
    this._corked = true;
  }
  /**
   * Flush buffered writes (clears the cork flag).
   * In this minimal implementation we only track the flag for compatibility.
   */
  uncork() {
    this._corked = false;
  }
  write(chunk, encodingOrCb, cb) {
    const callback = typeof encodingOrCb === "function" ? encodingOrCb : cb;
    if (this._destroyed || this._finished) {
      const err = new Error("write after end");
      if (callback) callback(err);
      return false;
    }
    const data = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    this._writing = true;
    this._writeFn(data).then(() => {
      this.bytesWritten += data.byteLength;
      this._writing = false;
      if (callback) callback();
      this.emit("drain");
    }).catch((err) => {
      this._writing = false;
      if (callback) callback(err);
      this.emit("error", err);
    });
    return true;
  }
  end(chunk, encodingOrCb, cb) {
    let callback;
    let finalChunk;
    if (typeof chunk === "function") {
      callback = chunk;
      finalChunk = void 0;
    } else {
      finalChunk = chunk;
      if (typeof encodingOrCb === "function") {
        callback = encodingOrCb;
      } else {
        callback = cb;
      }
    }
    if (this._finished) {
      if (callback) callback();
      return this;
    }
    this.writable = false;
    const finish = () => {
      this._closeFn().then(() => {
        this._finished = true;
        this.emit("finish");
        this.emit("close");
        if (callback) callback();
      }).catch((err) => {
        this.emit("error", err);
        if (callback) callback(err);
      });
    };
    if (finalChunk !== void 0 && finalChunk !== null) {
      this.write(finalChunk, void 0, () => finish());
    } else {
      finish();
    }
    return this;
  }
  destroy(err) {
    if (this._destroyed) return this;
    this._destroyed = true;
    this.writable = false;
    this._closeFn().catch(() => {
    }).finally(() => {
      if (err) this.emit("error", err);
      this.emit("close");
    });
    return this;
  }
};
function isNodeWritableInstance(obj) {
  return obj !== null && typeof obj === "object" && typeof obj.write === "function" && !("getWriter" in obj);
}

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
  const nlink = data.byteLength >= 53 ? view.getUint32(49, true) : 1;
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
    dev: 1,
    ino,
    mode,
    nlink,
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
    birthtime: new Date(ctimeMs),
    atimeNs: atimeMs * 1e6,
    mtimeNs: mtimeMs * 1e6,
    ctimeNs: ctimeMs * 1e6,
    birthtimeNs: ctimeMs * 1e6
  };
}
function decodeStatsBigInt(data) {
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
  const nlink = data.byteLength >= 53 ? view.getUint32(49, true) : 1;
  const isFile = type === INODE_TYPE.FILE;
  const isDirectory = type === INODE_TYPE.DIRECTORY;
  const isSymlink = type === INODE_TYPE.SYMLINK;
  const atimeMsBigInt = BigInt(Math.trunc(atimeMs));
  const mtimeMsBigInt = BigInt(Math.trunc(mtimeMs));
  const ctimeMsBigInt = BigInt(Math.trunc(ctimeMs));
  return {
    isFile: () => isFile,
    isDirectory: () => isDirectory,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => isSymlink,
    isFIFO: () => false,
    isSocket: () => false,
    dev: 1n,
    ino: BigInt(ino),
    mode: BigInt(mode),
    nlink: BigInt(nlink),
    uid: BigInt(uid),
    gid: BigInt(gid),
    rdev: 0n,
    size: BigInt(Math.trunc(size)),
    blksize: 4096n,
    blocks: BigInt(Math.ceil(size / 512)),
    atimeMs: atimeMsBigInt,
    mtimeMs: mtimeMsBigInt,
    ctimeMs: ctimeMsBigInt,
    birthtimeMs: ctimeMsBigInt,
    atime: new Date(atimeMs),
    mtime: new Date(mtimeMs),
    ctime: new Date(ctimeMs),
    birthtime: new Date(ctimeMs),
    atimeNs: atimeMsBigInt * 1000000n,
    mtimeNs: mtimeMsBigInt * 1000000n,
    ctimeNs: ctimeMsBigInt * 1000000n,
    birthtimeNs: ctimeMsBigInt * 1000000n
  };
}
function decodeDirents(data, parentPath = "") {
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
      parentPath,
      path: parentPath,
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
  O_NOCTTY: 256,
  O_NONBLOCK: 2048,
  O_SYNC: 4096,
  O_DSYNC: 4096,
  O_DIRECTORY: 65536,
  O_NOFOLLOW: 131072,
  O_NOATIME: 262144,
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

// src/methods/open.ts
var encoder2 = new TextEncoder();
var decoder2 = new TextDecoder();
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
function readSync(syncRequest, fd, bufferOrOptions, offsetOrOptions, length, position) {
  let buffer;
  let off, len, pos;
  if (bufferOrOptions instanceof Uint8Array) {
    buffer = bufferOrOptions;
    if (offsetOrOptions != null && typeof offsetOrOptions === "object") {
      off = offsetOrOptions.offset ?? 0;
      len = offsetOrOptions.length ?? buffer.byteLength;
      pos = offsetOrOptions.position ?? null;
    } else {
      off = offsetOrOptions ?? 0;
      len = length ?? buffer.byteLength;
      pos = position ?? null;
    }
  } else {
    buffer = bufferOrOptions.buffer;
    off = bufferOrOptions.offset ?? 0;
    len = bufferOrOptions.length ?? buffer.byteLength;
    pos = bufferOrOptions.position ?? null;
  }
  const fdBuf = new Uint8Array(16);
  const dv = new DataView(fdBuf.buffer);
  dv.setUint32(0, fd, true);
  dv.setUint32(4, len, true);
  dv.setFloat64(8, pos ?? -1, true);
  const buf = encodeRequest(OP.FREAD, "", 0, fdBuf);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "read", String(fd));
  if (data) {
    buffer.set(data.subarray(0, Math.min(data.byteLength, len)), off);
    return data.byteLength;
  }
  return 0;
}
function writeSyncFd(syncRequest, fd, bufferOrString, offsetOrPositionOrOptions, lengthOrEncoding, position) {
  let writeData;
  let pos;
  if (typeof bufferOrString === "string") {
    writeData = encoder2.encode(bufferOrString);
    pos = offsetOrPositionOrOptions != null && typeof offsetOrPositionOrOptions === "number" ? offsetOrPositionOrOptions : null;
  } else if (offsetOrPositionOrOptions != null && typeof offsetOrPositionOrOptions === "object") {
    const offset = offsetOrPositionOrOptions.offset ?? 0;
    const length = offsetOrPositionOrOptions.length ?? bufferOrString.byteLength;
    pos = offsetOrPositionOrOptions.position ?? null;
    writeData = bufferOrString.subarray(offset, offset + length);
  } else {
    const offset = offsetOrPositionOrOptions ?? 0;
    const length = lengthOrEncoding != null ? lengthOrEncoding : bufferOrString.byteLength;
    pos = position ?? null;
    writeData = bufferOrString.subarray(offset, offset + length);
  }
  const fdBuf = new Uint8Array(12 + writeData.byteLength);
  const dv = new DataView(fdBuf.buffer);
  dv.setUint32(0, fd, true);
  dv.setFloat64(4, pos ?? -1, true);
  fdBuf.set(writeData, 12);
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
  const fdBuf = new Uint8Array(12);
  const dv = new DataView(fdBuf.buffer);
  dv.setUint32(0, fd, true);
  dv.setFloat64(4, len, true);
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
    async read(bufferOrOptions, offsetOrOptions, length, position) {
      let buffer;
      let off, len, pos;
      if (bufferOrOptions instanceof Uint8Array) {
        buffer = bufferOrOptions;
        if (offsetOrOptions != null && typeof offsetOrOptions === "object") {
          off = offsetOrOptions.offset ?? 0;
          len = offsetOrOptions.length ?? buffer.byteLength;
          pos = offsetOrOptions.position ?? null;
        } else {
          off = offsetOrOptions ?? 0;
          len = length ?? buffer.byteLength;
          pos = position ?? null;
        }
      } else {
        buffer = bufferOrOptions.buffer;
        off = bufferOrOptions.offset ?? 0;
        len = bufferOrOptions.length ?? buffer.byteLength;
        pos = bufferOrOptions.position ?? null;
      }
      const { status, data } = await asyncRequest(OP.FREAD, "", 0, null, void 0, { fd, length: len, position: pos ?? -1 });
      if (status !== 0) throw statusToError(status, "read", String(fd));
      const bytesRead = data ? data.byteLength : 0;
      if (data) buffer.set(data.subarray(0, Math.min(bytesRead, len)), off);
      return { bytesRead, buffer };
    },
    async write(bufferOrString, offsetOrPositionOrOptions, lengthOrEncoding, position) {
      let writeData;
      let pos;
      let resultBuffer;
      if (typeof bufferOrString === "string") {
        resultBuffer = encoder2.encode(bufferOrString);
        writeData = resultBuffer;
        pos = offsetOrPositionOrOptions != null && typeof offsetOrPositionOrOptions === "number" ? offsetOrPositionOrOptions : -1;
      } else if (offsetOrPositionOrOptions != null && typeof offsetOrPositionOrOptions === "object") {
        resultBuffer = bufferOrString;
        const offset = offsetOrPositionOrOptions.offset ?? 0;
        const length = offsetOrPositionOrOptions.length ?? bufferOrString.byteLength;
        pos = offsetOrPositionOrOptions.position != null ? offsetOrPositionOrOptions.position : -1;
        writeData = bufferOrString.subarray(offset, offset + length);
      } else {
        resultBuffer = bufferOrString;
        const offset = offsetOrPositionOrOptions ?? 0;
        const length = lengthOrEncoding != null ? lengthOrEncoding : bufferOrString.byteLength;
        pos = position != null ? position : -1;
        writeData = bufferOrString.subarray(offset, offset + length);
      }
      const { status, data } = await asyncRequest(OP.FWRITE, "", 0, null, void 0, { fd, data: writeData, position: pos });
      if (status !== 0) throw statusToError(status, "write", String(fd));
      const bytesWritten = data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
      return { bytesWritten, buffer: resultBuffer };
    },
    async readv(buffers, position) {
      let totalRead = 0;
      let pos = position ?? null;
      for (const buf of buffers) {
        const { bytesRead } = await this.read(buf, 0, buf.byteLength, pos);
        totalRead += bytesRead;
        if (pos !== null) pos += bytesRead;
        if (bytesRead < buf.byteLength) break;
      }
      return { bytesRead: totalRead, buffers };
    },
    async writev(buffers, position) {
      let totalWritten = 0;
      let pos = position ?? null;
      for (const buf of buffers) {
        const { bytesWritten } = await this.write(buf, 0, buf.byteLength, pos);
        totalWritten += bytesWritten;
        if (pos !== null) pos += bytesWritten;
      }
      return { bytesWritten: totalWritten, buffers };
    },
    async readFile(options) {
      const encoding = typeof options === "string" ? options : options?.encoding;
      const { status, data } = await asyncRequest(OP.FREAD, "", 0, null, void 0, { fd, length: Number.MAX_SAFE_INTEGER, position: 0 });
      if (status !== 0) throw statusToError(status, "read", String(fd));
      const result = data ?? new Uint8Array(0);
      if (encoding) return decoder2.decode(result);
      return result;
    },
    async writeFile(data, _options) {
      const encoded = typeof data === "string" ? encoder2.encode(data) : data;
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
    async appendFile(data, _options) {
      const encoded = typeof data === "string" ? encoder2.encode(data) : data;
      const st = await this.stat();
      const { status } = await asyncRequest(OP.FWRITE, "", 0, null, void 0, { fd, data: encoded, position: st.size });
      if (status !== 0) throw statusToError(status, "write", String(fd));
    },
    async chmod(_mode) {
    },
    async chown(_uid, _gid) {
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
    },
    [Symbol.asyncDispose]() {
      return this.close();
    }
  };
}

// src/encoding.ts
function decodeBuffer(data, encoding) {
  switch (encoding) {
    case "utf8":
    case "utf-8":
      return new TextDecoder("utf-8").decode(data);
    case "latin1":
    case "binary": {
      let result = "";
      for (let i = 0; i < data.length; i++) {
        result += String.fromCharCode(data[i]);
      }
      return result;
    }
    case "ascii": {
      let result = "";
      for (let i = 0; i < data.length; i++) {
        result += String.fromCharCode(data[i] & 127);
      }
      return result;
    }
    case "base64": {
      let binary = "";
      for (let i = 0; i < data.length; i++) {
        binary += String.fromCharCode(data[i]);
      }
      return btoa(binary);
    }
    case "hex": {
      let hex = "";
      for (let i = 0; i < data.length; i++) {
        hex += data[i].toString(16).padStart(2, "0");
      }
      return hex;
    }
    case "ucs2":
    case "ucs-2":
    case "utf16le":
    case "utf-16le":
      return new TextDecoder("utf-16le").decode(data);
    default:
      return new TextDecoder("utf-8").decode(data);
  }
}
function encodeString(str, encoding) {
  switch (encoding) {
    case "utf8":
    case "utf-8":
      return new TextEncoder().encode(str);
    case "latin1":
    case "binary": {
      const buf = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) {
        buf[i] = str.charCodeAt(i) & 255;
      }
      return buf;
    }
    case "ascii": {
      const buf = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) {
        buf[i] = str.charCodeAt(i) & 127;
      }
      return buf;
    }
    case "base64": {
      const binary = atob(str);
      const buf = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        buf[i] = binary.charCodeAt(i);
      }
      return buf;
    }
    case "hex": {
      const len = str.length >>> 1;
      const buf = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        buf[i] = parseInt(str.slice(i * 2, i * 2 + 2), 16);
      }
      return buf;
    }
    case "ucs2":
    case "ucs-2":
    case "utf16le":
    case "utf-16le": {
      const buf = new Uint8Array(str.length * 2);
      for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        buf[i * 2] = code & 255;
        buf[i * 2 + 1] = code >>> 8 & 255;
      }
      return buf;
    }
    default:
      return new TextEncoder().encode(str);
  }
}

// src/methods/readFile.ts
new TextDecoder();
function readFileSync(syncRequest, filePath, options) {
  const encoding = typeof options === "string" ? options : options?.encoding;
  const flag = typeof options === "string" ? void 0 : options?.flag;
  const signal = typeof options === "string" ? void 0 : options?.signal;
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
  if (!flag || flag === "r") {
    const buf = encodeRequest(OP.READ, filePath);
    const { status, data } = syncRequest(buf);
    if (status !== 0) throw statusToError(status, "read", filePath);
    const result = data ?? new Uint8Array(0);
    if (encoding) return decodeBuffer(result, encoding);
    return result;
  }
  const fd = openSync(syncRequest, filePath, flag);
  try {
    const chunks = [];
    let totalRead = 0;
    const chunkSize = 64 * 1024;
    while (true) {
      const chunk = new Uint8Array(chunkSize);
      const bytesRead = readSync(syncRequest, fd, chunk, 0, chunkSize, totalRead);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      totalRead += bytesRead;
      if (bytesRead < chunkSize) break;
    }
    let result;
    if (chunks.length === 0) {
      result = new Uint8Array(0);
    } else if (chunks.length === 1) {
      result = chunks[0];
    } else {
      result = new Uint8Array(totalRead);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
    }
    if (encoding) return decodeBuffer(result, encoding);
    return result;
  } finally {
    closeSync(syncRequest, fd);
  }
}
async function readFile(asyncRequest, filePath, options) {
  const encoding = typeof options === "string" ? options : options?.encoding;
  const flag = typeof options === "string" ? void 0 : options?.flag;
  const signal = typeof options === "string" ? void 0 : options?.signal;
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
  if (!flag || flag === "r") {
    const { status, data } = await asyncRequest(OP.READ, filePath);
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    if (status !== 0) throw statusToError(status, "read", filePath);
    const result = data ?? new Uint8Array(0);
    if (encoding) return decodeBuffer(result, encoding);
    return result;
  }
  const handle = await open(asyncRequest, filePath, flag);
  try {
    const result = await handle.readFile(encoding ? encoding : void 0);
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    return result;
  } finally {
    await handle.close();
  }
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

// src/methods/writeFile.ts
var encoder3 = new TextEncoder();
function writeFileSync(syncRequest, filePath, data, options) {
  const opts = typeof options === "string" ? { encoding: options } : options;
  const encoded = typeof data === "string" ? opts?.encoding ? encodeString(data, opts.encoding) : encoder3.encode(data) : data;
  const flag = opts?.flag;
  const signal = opts?.signal;
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
  if (!flag || flag === "w") {
    const flags = opts?.flush === true ? 1 : 0;
    const buf = encodeRequest(OP.WRITE, filePath, flags, encoded);
    const { status } = syncRequest(buf);
    if (status !== 0) throw statusToError(status, "write", filePath);
    if (opts?.mode !== void 0) {
      chmodSync(syncRequest, filePath, opts.mode);
    }
    return;
  }
  const fd = openSync(syncRequest, filePath, flag, opts?.mode);
  try {
    writeSyncFd(syncRequest, fd, encoded, 0, encoded.byteLength, 0);
  } finally {
    closeSync(syncRequest, fd);
  }
}
async function writeFile(asyncRequest, filePath, data, options) {
  const opts = typeof options === "string" ? { encoding: options } : options;
  const encoded = typeof data === "string" ? opts?.encoding ? encodeString(data, opts.encoding) : encoder3.encode(data) : data;
  const flag = opts?.flag;
  const signal = opts?.signal;
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
  if (!flag || flag === "w") {
    const flags = opts?.flush === true ? 1 : 0;
    const { status } = await asyncRequest(OP.WRITE, filePath, flags, encoded);
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    if (status !== 0) throw statusToError(status, "write", filePath);
    if (opts?.mode !== void 0) {
      await chmod(asyncRequest, filePath, opts.mode);
    }
    return;
  }
  const handle = await open(asyncRequest, filePath, flag, opts?.mode);
  try {
    await handle.writeFile(encoded);
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
  } finally {
    await handle.close();
  }
}

// src/methods/appendFile.ts
var encoder4 = new TextEncoder();
function appendFileSync(syncRequest, filePath, data, options) {
  const encoded = typeof data === "string" ? encoder4.encode(data) : data;
  const buf = encodeRequest(OP.APPEND, filePath, 0, encoded);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "appendFile", filePath);
}
async function appendFile(asyncRequest, filePath, data, options) {
  const encoded = typeof data === "string" ? encoder4.encode(data) : data;
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
var decoder4 = new TextDecoder();
function mkdirSync(syncRequest, filePath, options) {
  const opts = typeof options === "number" ? { } : options;
  const flags = opts?.recursive ? 1 : 0;
  const buf = encodeRequest(OP.MKDIR, filePath, flags);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "mkdir", filePath);
  return data ? decoder4.decode(data) : void 0;
}
async function mkdir(asyncRequest, filePath, options) {
  const opts = typeof options === "number" ? { } : options;
  const flags = opts?.recursive ? 1 : 0;
  const { status, data } = await asyncRequest(OP.MKDIR, filePath, flags);
  if (status !== 0) throw statusToError(status, "mkdir", filePath);
  return data ? decoder4.decode(data) : void 0;
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
var RETRYABLE_CODES = /* @__PURE__ */ new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);
function isRetryable(e) {
  return e instanceof FSError && RETRYABLE_CODES.has(e.code);
}
function rmSyncCore(syncRequest, filePath, options) {
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
function rmSync(syncRequest, filePath, options) {
  const maxRetries = options?.maxRetries ?? 0;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      rmSyncCore(syncRequest, filePath, options);
      return;
    } catch (e) {
      lastError = e;
      if (attempt < maxRetries && isRetryable(e)) {
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}
async function rmAsyncCore(asyncRequest, filePath, options) {
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
function delay(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
async function rm(asyncRequest, filePath, options) {
  const maxRetries = options?.maxRetries ?? 0;
  const retryDelay = options?.retryDelay ?? 100;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await rmAsyncCore(asyncRequest, filePath, options);
      return;
    } catch (e) {
      lastError = e;
      if (attempt < maxRetries && isRetryable(e)) {
        await delay(retryDelay);
        continue;
      }
      throw e;
    }
  }
  throw lastError;
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

// src/methods/readdir.ts
var textEncoder = new TextEncoder();
function namesToBuffers(names) {
  return names.map((n) => textEncoder.encode(n));
}
function readdirBaseSync(syncRequest, filePath, withFileTypes) {
  const flags = withFileTypes ? 1 : 0;
  const buf = encodeRequest(OP.READDIR, filePath, flags);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "readdir", filePath);
  if (!data) return [];
  return withFileTypes ? decodeDirents(data, filePath) : decodeNames(data);
}
async function readdirBaseAsync(asyncRequest, filePath, withFileTypes) {
  const flags = withFileTypes ? 1 : 0;
  const { status, data } = await asyncRequest(OP.READDIR, filePath, flags);
  if (status !== 0) throw statusToError(status, "readdir", filePath);
  if (!data) return [];
  return withFileTypes ? decodeDirents(data, filePath) : decodeNames(data);
}
function readdirRecursiveSync(syncRequest, basePath, prefix, withFileTypes, rootPath) {
  const entries = readdirBaseSync(syncRequest, basePath, true);
  const results = [];
  const effectiveRoot = rootPath ?? basePath;
  for (const entry of entries) {
    const relativePath = prefix ? prefix + "/" + entry.name : entry.name;
    if (withFileTypes) {
      const parentPath = prefix || effectiveRoot;
      results.push({
        name: relativePath,
        parentPath,
        path: parentPath,
        isFile: entry.isFile,
        isDirectory: entry.isDirectory,
        isBlockDevice: entry.isBlockDevice,
        isCharacterDevice: entry.isCharacterDevice,
        isSymbolicLink: entry.isSymbolicLink,
        isFIFO: entry.isFIFO,
        isSocket: entry.isSocket
      });
    } else {
      results.push(relativePath);
    }
    if (entry.isDirectory()) {
      const childPath = basePath + "/" + entry.name;
      results.push(
        ...readdirRecursiveSync(syncRequest, childPath, relativePath, withFileTypes, effectiveRoot)
      );
    }
  }
  return results;
}
async function readdirRecursiveAsync(asyncRequest, basePath, prefix, withFileTypes, rootPath) {
  const entries = await readdirBaseAsync(asyncRequest, basePath, true);
  const results = [];
  const effectiveRoot = rootPath ?? basePath;
  for (const entry of entries) {
    const relativePath = prefix ? prefix + "/" + entry.name : entry.name;
    if (withFileTypes) {
      const parentPath = prefix || effectiveRoot;
      results.push({
        name: relativePath,
        parentPath,
        path: parentPath,
        isFile: entry.isFile,
        isDirectory: entry.isDirectory,
        isBlockDevice: entry.isBlockDevice,
        isCharacterDevice: entry.isCharacterDevice,
        isSymbolicLink: entry.isSymbolicLink,
        isFIFO: entry.isFIFO,
        isSocket: entry.isSocket
      });
    } else {
      results.push(relativePath);
    }
    if (entry.isDirectory()) {
      const childPath = basePath + "/" + entry.name;
      const children = await readdirRecursiveAsync(
        asyncRequest,
        childPath,
        relativePath,
        withFileTypes,
        effectiveRoot
      );
      results.push(...children);
    }
  }
  return results;
}
function readdirSync(syncRequest, filePath, options) {
  const opts = typeof options === "string" ? { encoding: options } : options;
  const asBuffer = opts?.encoding === "buffer";
  if (opts?.recursive) {
    const result2 = readdirRecursiveSync(
      syncRequest,
      filePath,
      "",
      !!opts?.withFileTypes
    );
    if (asBuffer && !opts?.withFileTypes) {
      return namesToBuffers(result2);
    }
    return result2;
  }
  const result = readdirBaseSync(syncRequest, filePath, !!opts?.withFileTypes);
  if (asBuffer && !opts?.withFileTypes) {
    return namesToBuffers(result);
  }
  return result;
}
async function readdir(asyncRequest, filePath, options) {
  const opts = typeof options === "string" ? { encoding: options } : options;
  const asBuffer = opts?.encoding === "buffer";
  if (opts?.recursive) {
    const result2 = await readdirRecursiveAsync(
      asyncRequest,
      filePath,
      "",
      !!opts?.withFileTypes
    );
    if (asBuffer && !opts?.withFileTypes) {
      return namesToBuffers(result2);
    }
    return result2;
  }
  const result = await readdirBaseAsync(asyncRequest, filePath, !!opts?.withFileTypes);
  if (asBuffer && !opts?.withFileTypes) {
    return namesToBuffers(result);
  }
  return result;
}

// src/methods/stat.ts
function statSync(syncRequest, filePath, options) {
  const buf = encodeRequest(OP.STAT, filePath);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "stat", filePath);
  return options?.bigint ? decodeStatsBigInt(data) : decodeStats(data);
}
function lstatSync(syncRequest, filePath, options) {
  const buf = encodeRequest(OP.LSTAT, filePath);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "lstat", filePath);
  return options?.bigint ? decodeStatsBigInt(data) : decodeStats(data);
}
async function stat(asyncRequest, filePath, options) {
  const { status, data } = await asyncRequest(OP.STAT, filePath);
  if (status !== 0) throw statusToError(status, "stat", filePath);
  return options?.bigint ? decodeStatsBigInt(data) : decodeStats(data);
}
async function lstat(asyncRequest, filePath, options) {
  const { status, data } = await asyncRequest(OP.LSTAT, filePath);
  if (status !== 0) throw statusToError(status, "lstat", filePath);
  return options?.bigint ? decodeStatsBigInt(data) : decodeStats(data);
}

// src/methods/rename.ts
var encoder5 = new TextEncoder();
function renameSync(syncRequest, oldPath, newPath) {
  const buf = encodeTwoPathRequest(OP.RENAME, oldPath, newPath);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "rename", oldPath);
}
async function rename(asyncRequest, oldPath, newPath) {
  const path2Bytes = encoder5.encode(newPath);
  const payload = new Uint8Array(4 + path2Bytes.byteLength);
  new DataView(payload.buffer).setUint32(0, path2Bytes.byteLength, true);
  payload.set(path2Bytes, 4);
  const { status } = await asyncRequest(OP.RENAME, oldPath, 0, payload);
  if (status !== 0) throw statusToError(status, "rename", oldPath);
}

// src/methods/copyFile.ts
var encoder6 = new TextEncoder();
function copyFileSync(syncRequest, src, dest, mode) {
  const buf = encodeTwoPathRequest(OP.COPY, src, dest, mode ?? 0);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "copyFile", src);
}
async function copyFile(asyncRequest, src, dest, mode) {
  const path2Bytes = encoder6.encode(dest);
  const payload = new Uint8Array(4 + path2Bytes.byteLength);
  new DataView(payload.buffer).setUint32(0, path2Bytes.byteLength, true);
  payload.set(path2Bytes, 4);
  const { status } = await asyncRequest(OP.COPY, src, mode ?? 0, payload);
  if (status !== 0) throw statusToError(status, "copyFile", src);
}

// src/methods/truncate.ts
function truncateSync(syncRequest, filePath, len = 0) {
  const lenBuf = new Uint8Array(8);
  new DataView(lenBuf.buffer).setFloat64(0, len, true);
  const buf = encodeRequest(OP.TRUNCATE, filePath, 0, lenBuf);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "truncate", filePath);
}
async function truncate(asyncRequest, filePath, len) {
  const lenBuf = new Uint8Array(8);
  new DataView(lenBuf.buffer).setFloat64(0, len ?? 0, true);
  const { status } = await asyncRequest(OP.TRUNCATE, filePath, 0, lenBuf);
  if (status !== 0) throw statusToError(status, "truncate", filePath);
}

// src/methods/access.ts
function accessSync(syncRequest, filePath, mode = constants.F_OK) {
  const buf = encodeRequest(OP.ACCESS, filePath, mode);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "access", filePath);
}
async function access(asyncRequest, filePath, mode = constants.F_OK) {
  const { status } = await asyncRequest(OP.ACCESS, filePath, mode);
  if (status !== 0) throw statusToError(status, "access", filePath);
}

// src/methods/realpath.ts
var decoder5 = new TextDecoder();
function realpathSync(syncRequest, filePath) {
  const buf = encodeRequest(OP.REALPATH, filePath);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "realpath", filePath);
  return decoder5.decode(data);
}
async function realpath(asyncRequest, filePath) {
  const { status, data } = await asyncRequest(OP.REALPATH, filePath);
  if (status !== 0) throw statusToError(status, "realpath", filePath);
  return decoder5.decode(data);
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
var encoder7 = new TextEncoder();
var decoder6 = new TextDecoder();
function symlinkSync(syncRequest, target, linkPath, type) {
  const targetBytes = encoder7.encode(target);
  const buf = encodeRequest(OP.SYMLINK, linkPath, 0, targetBytes);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "symlink", linkPath);
}
function readlinkSync(syncRequest, filePath, options) {
  const buf = encodeRequest(OP.READLINK, filePath);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "readlink", filePath);
  const encoding = typeof options === "string" ? options : options?.encoding;
  if (encoding === "buffer") return new Uint8Array(data);
  return decoder6.decode(data);
}
async function symlink(asyncRequest, target, linkPath, type) {
  const targetBytes = encoder7.encode(target);
  const { status } = await asyncRequest(OP.SYMLINK, linkPath, 0, targetBytes);
  if (status !== 0) throw statusToError(status, "symlink", linkPath);
}
async function readlink(asyncRequest, filePath, options) {
  const { status, data } = await asyncRequest(OP.READLINK, filePath);
  if (status !== 0) throw statusToError(status, "readlink", filePath);
  const encoding = typeof options === "string" ? options : options?.encoding;
  if (encoding === "buffer") return new Uint8Array(data);
  return decoder6.decode(data);
}

// src/methods/link.ts
var encoder8 = new TextEncoder();
function linkSync(syncRequest, existingPath, newPath) {
  const buf = encodeTwoPathRequest(OP.LINK, existingPath, newPath);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "link", existingPath);
}
async function link(asyncRequest, existingPath, newPath) {
  const path2Bytes = encoder8.encode(newPath);
  const payload = new Uint8Array(4 + path2Bytes.byteLength);
  new DataView(payload.buffer).setUint32(0, path2Bytes.byteLength, true);
  payload.set(path2Bytes, 4);
  const { status } = await asyncRequest(OP.LINK, existingPath, 0, payload);
  if (status !== 0) throw statusToError(status, "link", existingPath);
}

// src/methods/mkdtemp.ts
var decoder7 = new TextDecoder();
function mkdtempSync(syncRequest, prefix) {
  const buf = encodeRequest(OP.MKDTEMP, prefix);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "mkdtemp", prefix);
  return decoder7.decode(data);
}
async function mkdtemp(asyncRequest, prefix) {
  const { status, data } = await asyncRequest(OP.MKDTEMP, prefix);
  if (status !== 0) throw statusToError(status, "mkdtemp", prefix);
  return decoder7.decode(data);
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
  sep: () => sep,
  toPathString: () => toPathString
});
function toPathString(p) {
  if (typeof p === "string") return p;
  if (p instanceof Uint8Array) return new TextDecoder().decode(p);
  if (typeof URL !== "undefined" && p instanceof URL) {
    if (p.protocol !== "file:") {
      throw new TypeError("The URL must use the file: protocol");
    }
    return decodeURIComponent(p.pathname);
  }
  throw new TypeError('The "path" argument must be of type string, Uint8Array, or URL. Received ' + typeof p);
}
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
    birthtime: zero,
    atimeNs: 0,
    mtimeNs: 0,
    ctimeNs: 0,
    birthtimeNs: 0
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

// src/methods/glob.ts
function segmentToRegex(pattern) {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      re += "[^/]*";
    } else if (ch === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(ch)) {
      re += "\\" + ch;
    } else {
      re += ch;
    }
  }
  re += "$";
  return new RegExp(re);
}
function matchSegment(name, pattern) {
  return segmentToRegex(pattern).test(name);
}
function joinPath(base, name) {
  if (base === "/") return "/" + name;
  return base + "/" + name;
}
function globSync(syncRequest, pattern, options) {
  const cwd = options?.cwd ?? "/";
  const exclude = options?.exclude;
  const segments = pattern.split("/").filter((s) => s !== "");
  const results = [];
  function walk(dir, segIdx) {
    if (segIdx >= segments.length) return;
    const seg = segments[segIdx];
    const isLast = segIdx === segments.length - 1;
    if (seg === "**") {
      if (segIdx + 1 < segments.length) {
        walk(dir, segIdx + 1);
      }
      let entries2;
      try {
        entries2 = readdirSync(syncRequest, dir);
      } catch {
        return;
      }
      for (const entry of entries2) {
        const full = joinPath(dir, entry);
        if (exclude && exclude(full)) continue;
        let isDir;
        try {
          const s = statSync(syncRequest, full);
          isDir = s.isDirectory();
        } catch {
          continue;
        }
        if (isDir) {
          walk(full, segIdx);
        }
        if (isLast) {
          results.push(full);
        }
      }
      return;
    }
    let entries;
    try {
      entries = readdirSync(syncRequest, dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!matchSegment(entry, seg)) continue;
      const full = joinPath(dir, entry);
      if (exclude && exclude(full)) continue;
      if (isLast) {
        results.push(full);
      } else {
        let isDir;
        try {
          const s = statSync(syncRequest, full);
          isDir = s.isDirectory();
        } catch {
          continue;
        }
        if (isDir) {
          walk(full, segIdx + 1);
        }
      }
    }
  }
  walk(cwd, 0);
  return results;
}
async function glob(asyncRequest, pattern, options) {
  const cwd = options?.cwd ?? "/";
  const exclude = options?.exclude;
  const segments = pattern.split("/").filter((s) => s !== "");
  const results = [];
  async function walk(dir, segIdx) {
    if (segIdx >= segments.length) return;
    const seg = segments[segIdx];
    const isLast = segIdx === segments.length - 1;
    if (seg === "**") {
      if (segIdx + 1 < segments.length) {
        await walk(dir, segIdx + 1);
      }
      let entries2;
      try {
        entries2 = await readdir(asyncRequest, dir);
      } catch {
        return;
      }
      for (const entry of entries2) {
        const full = joinPath(dir, entry);
        if (exclude && exclude(full)) continue;
        let isDir;
        try {
          const s = await stat(asyncRequest, full);
          isDir = s.isDirectory();
        } catch {
          continue;
        }
        if (isDir) {
          await walk(full, segIdx);
        }
        if (isLast) {
          results.push(full);
        }
      }
      return;
    }
    let entries;
    try {
      entries = await readdir(asyncRequest, dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!matchSegment(entry, seg)) continue;
      const full = joinPath(dir, entry);
      if (exclude && exclude(full)) continue;
      if (isLast) {
        results.push(full);
      } else {
        let isDir;
        try {
          const s = await stat(asyncRequest, full);
          isDir = s.isDirectory();
        } catch {
          continue;
        }
        if (isDir) {
          await walk(full, segIdx + 1);
        }
      }
    }
  }
  await walk(cwd, 0);
  return results;
}

// src/filesystem.ts
new TextEncoder();
var DEFAULT_SAB_SIZE = 2 * 1024 * 1024;
var instanceRegistry = /* @__PURE__ */ new Map();
var HEADER_SIZE = SAB_OFFSETS.HEADER_SIZE;
var _canAtomicsWait = typeof globalThis.WorkerGlobalScope !== "undefined";
var SPIN_TIMEOUT_MS = 1e4;
function spinWait(arr, index, value) {
  if (_canAtomicsWait) {
    Atomics.wait(arr, index, value);
  } else {
    const start = performance.now();
    while (Atomics.load(arr, index) === value) {
      if (performance.now() - start > SPIN_TIMEOUT_MS) {
        throw new Error(
          `VFS sync operation timed out after ${SPIN_TIMEOUT_MS / 1e3}s \u2014 SharedWorker may be unresponsive`
        );
      }
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
  rejectReady;
  initError = null;
  isReady = false;
  // Config (definite assignment — always set when constructor doesn't return singleton)
  config;
  tabId;
  _mode;
  corruptionError = null;
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
    const mode = config.mode ?? "hybrid";
    this._mode = mode;
    const opfsSync = config.opfsSync ?? mode === "hybrid";
    this.config = {
      root,
      opfsSync,
      opfsSyncRoot: config.opfsSyncRoot,
      uid: config.uid ?? 0,
      gid: config.gid ?? 0,
      umask: config.umask ?? 18,
      strictPermissions: config.strictPermissions ?? false,
      sabSize: config.sabSize ?? DEFAULT_SAB_SIZE,
      debug: config.debug ?? false,
      swUrl: config.swUrl,
      swScope: config.swScope,
      limits: config.limits
    };
    this.tabId = crypto.randomUUID();
    this.ns = ns;
    this.readyPromise = new Promise((resolve2, reject) => {
      this.resolveReady = resolve2;
      this.rejectReady = reject;
    });
    this.promises = new VFSPromises(this._async, ns);
    const boundRealpath = this.realpath.bind(this);
    boundRealpath.native = boundRealpath;
    this.realpath = boundRealpath;
    const boundRealpathSync = this.realpathSync.bind(this);
    boundRealpathSync.native = boundRealpathSync;
    this.realpathSync = boundRealpathSync;
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
        this.initAsyncRelay();
        this.resolveReady();
        if (!this.isFollower) {
          this.initLeaderBroker();
        }
      } else if (msg.type === "init-failed") {
        if (msg.error?.startsWith("Corrupt VFS:")) {
          this.handleCorruptVFS(msg.error);
        } else if (this.holdingLeaderLock) {
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
        debug: this.config.debug,
        limits: this.config.limits
      }
    });
  }
  /** Send init-opfs message to sync-relay for OPFS-direct mode */
  sendOPFSInit() {
    this.syncWorker.postMessage({
      type: "init-opfs",
      sab: this.hasSAB ? this.sab : null,
      readySab: this.hasSAB ? this.readySab : null,
      asyncSab: this.hasSAB ? this.asyncSab : null,
      tabId: this.tabId,
      config: {
        root: this.config.root,
        ns: this.ns,
        uid: this.config.uid,
        gid: this.config.gid,
        debug: this.config.debug
      }
    });
  }
  /** Handle VFS corruption: log error, fall back to OPFS-direct mode.
   *  The readyPromise will resolve once OPFS mode is ready, but init()
   *  will reject with the corruption error to inform the caller. */
  handleCorruptVFS(errorMessage) {
    const err = new Error(`${errorMessage} \u2014 Falling back to OPFS mode`);
    this.corruptionError = err;
    console.error(`[VFS] ${err.message}`);
    if (this._mode === "vfs") {
      this.initError = err;
      this.rejectReady(err);
      if (this.hasSAB) {
        Atomics.store(this.readySignal, 0, -1);
        Atomics.notify(this.readySignal, 0);
      }
      return;
    }
    this._mode = "opfs";
    this.sendOPFSInit();
  }
  /** Initialize the async-relay worker. Called after sync-relay signals ready. */
  initAsyncRelay() {
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
  }
  /** Start as leader — tell sync-relay to init VFS engine + OPFS handle */
  startAsLeader() {
    this.isFollower = false;
    if (this._mode === "opfs") {
      this.sendOPFSInit();
    } else {
      this.sendLeaderInit();
    }
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
      const swUrl = this.config.swUrl ? new URL(this.config.swUrl, location.origin) : new URL("./workers/service.worker.js", import.meta.url);
      const scope = this.config.swScope ?? new URL(`./${this.ns}/`, swUrl).href;
      this.swReg = await navigator.serviceWorker.register(swUrl.href, { scope });
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
    this.readyPromise = new Promise((resolve2, reject) => {
      this.resolveReady = resolve2;
      this.rejectReady = reject;
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
        if (msg.error?.startsWith("Corrupt VFS:")) {
          this.handleCorruptVFS(msg.error);
        } else {
          console.warn("[VFS] Promotion: OPFS handle still busy, retrying...");
          setTimeout(() => this.sendLeaderInit(), 500);
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
    if (this._mode === "opfs") {
      this.sendOPFSInit();
    } else {
      this.sendLeaderInit();
    }
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
    if (this.initError) throw this.initError;
    if (!this.hasSAB) {
      throw new Error("Sync API requires crossOriginIsolated (COOP/COEP headers). Use the promises API instead.");
    }
    const signal = Atomics.load(this.readySignal, 0);
    if (signal === 1) {
      this.isReady = true;
      return;
    }
    if (signal === -1) {
      throw this.initError ?? new Error("VFS initialization failed");
    }
    spinWait(this.readySignal, 0, 0);
    const finalSignal = Atomics.load(this.readySignal, 0);
    if (finalSignal === -1) {
      throw this.initError ?? new Error("VFS initialization failed");
    }
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
    return readFileSync(this._sync, toPathString(filePath), options);
  }
  writeFileSync(filePath, data, options) {
    writeFileSync(this._sync, toPathString(filePath), data, options);
  }
  appendFileSync(filePath, data, options) {
    appendFileSync(this._sync, toPathString(filePath), data);
  }
  existsSync(filePath) {
    return existsSync(this._sync, toPathString(filePath));
  }
  mkdirSync(filePath, options) {
    return mkdirSync(this._sync, toPathString(filePath), options);
  }
  rmdirSync(filePath, options) {
    rmdirSync(this._sync, toPathString(filePath), options);
  }
  rmSync(filePath, options) {
    rmSync(this._sync, toPathString(filePath), options);
  }
  unlinkSync(filePath) {
    unlinkSync(this._sync, toPathString(filePath));
  }
  readdirSync(filePath, options) {
    return readdirSync(this._sync, toPathString(filePath), options);
  }
  globSync(pattern, options) {
    return globSync(this._sync, pattern, options);
  }
  opendirSync(filePath) {
    const dirPath = toPathString(filePath);
    const entries = this.readdirSync(dirPath, { withFileTypes: true });
    let index = 0;
    return {
      path: dirPath,
      async read() {
        if (index >= entries.length) return null;
        return entries[index++];
      },
      async close() {
      },
      async *[Symbol.asyncIterator]() {
        for (const entry of entries) {
          yield entry;
        }
      }
    };
  }
  statSync(filePath, options) {
    return statSync(this._sync, toPathString(filePath), options);
  }
  lstatSync(filePath, options) {
    return lstatSync(this._sync, toPathString(filePath), options);
  }
  renameSync(oldPath, newPath) {
    renameSync(this._sync, toPathString(oldPath), toPathString(newPath));
  }
  copyFileSync(src, dest, mode) {
    copyFileSync(this._sync, toPathString(src), toPathString(dest), mode);
  }
  cpSync(src, dest, options) {
    const srcPath = toPathString(src);
    const destPath = toPathString(dest);
    const force = options?.force !== false;
    const errorOnExist = options?.errorOnExist ?? false;
    const dereference = options?.dereference ?? false;
    const preserveTimestamps = options?.preserveTimestamps ?? false;
    const srcStat = dereference ? this.statSync(srcPath) : this.lstatSync(srcPath);
    if (srcStat.isDirectory()) {
      if (!options?.recursive) {
        throw createError("EISDIR", "cp", srcPath);
      }
      try {
        this.mkdirSync(destPath, { recursive: true });
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      }
      const entries = this.readdirSync(srcPath, { withFileTypes: true });
      for (const entry of entries) {
        const srcChild = join(srcPath, entry.name);
        const destChild = join(destPath, entry.name);
        this.cpSync(srcChild, destChild, options);
      }
    } else if (srcStat.isSymbolicLink() && !dereference) {
      const target = this.readlinkSync(srcPath);
      let destExists = false;
      try {
        this.lstatSync(destPath);
        destExists = true;
      } catch {
      }
      if (destExists) {
        if (errorOnExist) throw createError("EEXIST", "cp", destPath);
        if (!force) return;
        this.unlinkSync(destPath);
      }
      this.symlinkSync(target, destPath);
    } else {
      let destExists = false;
      try {
        this.lstatSync(destPath);
        destExists = true;
      } catch {
      }
      if (destExists) {
        if (errorOnExist) throw createError("EEXIST", "cp", destPath);
        if (!force) return;
      }
      this.copyFileSync(srcPath, destPath, errorOnExist ? constants.COPYFILE_EXCL : 0);
    }
    if (preserveTimestamps) {
      const st = this.statSync(srcPath);
      this.utimesSync(destPath, st.atime, st.mtime);
    }
  }
  async _cpAsync(src, dest, options) {
    const force = options?.force !== false;
    const errorOnExist = options?.errorOnExist ?? false;
    const dereference = options?.dereference ?? false;
    const preserveTimestamps = options?.preserveTimestamps ?? false;
    const srcStat = dereference ? await this.promises.stat(src) : await this.promises.lstat(src);
    if (srcStat.isDirectory()) {
      if (!options?.recursive) {
        throw createError("EISDIR", "cp", src);
      }
      try {
        await this.promises.mkdir(dest, { recursive: true });
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      }
      const entries = await this.promises.readdir(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcChild = join(src, entry.name);
        const destChild = join(dest, entry.name);
        await this._cpAsync(srcChild, destChild, options);
      }
    } else if (srcStat.isSymbolicLink() && !dereference) {
      const target = await this.promises.readlink(src);
      let destExists = false;
      try {
        await this.promises.lstat(dest);
        destExists = true;
      } catch {
      }
      if (destExists) {
        if (errorOnExist) throw createError("EEXIST", "cp", dest);
        if (!force) return;
        await this.promises.unlink(dest);
      }
      await this.promises.symlink(target, dest);
    } else {
      let destExists = false;
      try {
        await this.promises.lstat(dest);
        destExists = true;
      } catch {
      }
      if (destExists) {
        if (errorOnExist) throw createError("EEXIST", "cp", dest);
        if (!force) return;
      }
      await this.promises.copyFile(src, dest, errorOnExist ? constants.COPYFILE_EXCL : 0);
    }
    if (preserveTimestamps) {
      const st = await this.promises.stat(src);
      await this.promises.utimes(dest, st.atime, st.mtime);
    }
  }
  truncateSync(filePath, len) {
    truncateSync(this._sync, toPathString(filePath), len);
  }
  accessSync(filePath, mode) {
    accessSync(this._sync, toPathString(filePath), mode);
  }
  realpathSync(filePath) {
    return realpathSync(this._sync, toPathString(filePath));
  }
  chmodSync(filePath, mode) {
    chmodSync(this._sync, toPathString(filePath), mode);
  }
  /** Like chmodSync but operates on the symlink itself. In this VFS, delegates to chmodSync. */
  lchmodSync(filePath, mode) {
    chmodSync(this._sync, filePath, mode);
  }
  /** chmod on an open file descriptor. No-op in this VFS (permissions are cosmetic). */
  fchmodSync(_fd, _mode) {
  }
  chownSync(filePath, uid, gid) {
    chownSync(this._sync, toPathString(filePath), uid, gid);
  }
  /** Like chownSync but operates on the symlink itself. In this VFS, delegates to chownSync. */
  lchownSync(filePath, uid, gid) {
    chownSync(this._sync, filePath, uid, gid);
  }
  /** chown on an open file descriptor. No-op in this VFS (permissions are cosmetic). */
  fchownSync(_fd, _uid, _gid) {
  }
  utimesSync(filePath, atime, mtime) {
    utimesSync(this._sync, toPathString(filePath), atime, mtime);
  }
  /** utimes on an open file descriptor. No-op in this VFS (cannot resolve fd to path). */
  futimesSync(_fd, _atime, _mtime) {
  }
  /** Like utimesSync but operates on the symlink itself. In this VFS, delegates to utimesSync. */
  lutimesSync(filePath, atime, mtime) {
    utimesSync(this._sync, filePath, atime, mtime);
  }
  symlinkSync(target, linkPath, type) {
    symlinkSync(this._sync, toPathString(target), toPathString(linkPath));
  }
  readlinkSync(filePath, options) {
    return readlinkSync(this._sync, toPathString(filePath), options);
  }
  linkSync(existingPath, newPath) {
    linkSync(this._sync, toPathString(existingPath), toPathString(newPath));
  }
  mkdtempSync(prefix) {
    return mkdtempSync(this._sync, prefix);
  }
  // ---- File descriptor sync methods ----
  openSync(filePath, flags = "r", mode) {
    return openSync(this._sync, toPathString(filePath), flags);
  }
  closeSync(fd) {
    closeSync(this._sync, fd);
  }
  readSync(fd, bufferOrOptions, offsetOrOptions, length, position) {
    return readSync(this._sync, fd, bufferOrOptions, offsetOrOptions, length, position);
  }
  writeSync(fd, bufferOrString, offsetOrPositionOrOptions, lengthOrEncoding, position) {
    return writeSyncFd(this._sync, fd, bufferOrString, offsetOrPositionOrOptions, lengthOrEncoding, position);
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
  fsyncSync(fd) {
    fdatasyncSync(this._sync, fd);
  }
  // ---- Vector I/O methods ----
  readvSync(fd, buffers, position) {
    let totalRead = 0;
    let pos = position ?? null;
    for (const buf of buffers) {
      const bytesRead = this.readSync(fd, buf, 0, buf.byteLength, pos);
      totalRead += bytesRead;
      if (pos !== null) pos += bytesRead;
      if (bytesRead < buf.byteLength) break;
    }
    return totalRead;
  }
  writevSync(fd, buffers, position) {
    let totalWritten = 0;
    let pos = position ?? null;
    for (const buf of buffers) {
      const bytesWritten = this.writeSync(fd, buf, 0, buf.byteLength, pos);
      totalWritten += bytesWritten;
      if (pos !== null) pos += bytesWritten;
    }
    return totalWritten;
  }
  readv(fd, buffers, positionOrCallback, callback) {
    let pos;
    let cb;
    if (typeof positionOrCallback === "function") {
      pos = void 0;
      cb = positionOrCallback;
    } else {
      pos = positionOrCallback;
      cb = callback;
    }
    try {
      const bytesRead = this.readvSync(fd, buffers, pos);
      setTimeout(() => cb(null, bytesRead, buffers), 0);
    } catch (err) {
      setTimeout(() => cb(err), 0);
    }
  }
  writev(fd, buffers, positionOrCallback, callback) {
    let pos;
    let cb;
    if (typeof positionOrCallback === "function") {
      pos = void 0;
      cb = positionOrCallback;
    } else {
      pos = positionOrCallback;
      cb = callback;
    }
    try {
      const bytesWritten = this.writevSync(fd, buffers, pos);
      setTimeout(() => cb(null, bytesWritten, buffers), 0);
    } catch (err) {
      setTimeout(() => cb(err), 0);
    }
  }
  // ---- statfs methods ----
  statfsSync(_path) {
    return {
      type: 1447449377,
      // "VFS!"
      bsize: 4096,
      blocks: 1024 * 1024,
      // ~4GB virtual capacity
      bfree: 512 * 1024,
      // ~2GB free (estimate)
      bavail: 512 * 1024,
      files: 1e4,
      // default max inodes
      ffree: 5e3
      // estimate half free
    };
  }
  statfs(path, callback) {
    const result = this.statfsSync(path);
    if (callback) {
      setTimeout(() => callback(null, result), 0);
      return;
    }
    return Promise.resolve(result);
  }
  // ---- Watch methods ----
  watch(filePath, options, listener) {
    return watch(this.ns, toPathString(filePath), options, listener);
  }
  watchFile(filePath, optionsOrListener, listener) {
    watchFile(this.ns, this._sync, toPathString(filePath), optionsOrListener, listener);
  }
  unwatchFile(filePath, listener) {
    unwatchFile(this.ns, toPathString(filePath), listener);
  }
  // ---- openAsBlob (Node.js 19+) ----
  async openAsBlob(filePath, options) {
    const data = await this.promises.readFile(filePath);
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
    return new Blob([bytes], { type: options?.type ?? "" });
  }
  // ---- Stream methods ----
  createReadStream(filePath, options) {
    const opts = typeof options === "string" ? { } : options;
    const start = opts?.start ?? 0;
    const end = opts?.end;
    const highWaterMark = opts?.highWaterMark ?? 64 * 1024;
    let position = start;
    let handle = null;
    let finished = false;
    const cleanup = async () => {
      if (handle && ownsHandle) {
        try {
          await handle.close();
        } catch {
        }
      }
      handle = null;
    };
    const providedFd = opts?.fd;
    let ownsHandle = providedFd == null;
    const readFn = async () => {
      if (finished) return { done: true };
      if (!handle) {
        if (providedFd != null) {
          handle = createFileHandle(providedFd, this._async);
        } else {
          handle = await this.promises.open(toPathString(filePath), opts?.flags ?? "r");
        }
      }
      const readLen = end !== void 0 ? Math.min(highWaterMark, end - position + 1) : highWaterMark;
      if (readLen <= 0) {
        finished = true;
        await cleanup();
        return { done: true };
      }
      const buffer = new Uint8Array(readLen);
      const { bytesRead } = await handle.read(buffer, 0, readLen, position);
      if (bytesRead === 0) {
        finished = true;
        await cleanup();
        return { done: true };
      }
      position += bytesRead;
      if (end !== void 0 && position > end) {
        finished = true;
        await cleanup();
        return { done: false, value: buffer.subarray(0, bytesRead) };
      }
      return { done: false, value: buffer.subarray(0, bytesRead) };
    };
    const stream = new NodeReadable(readFn, cleanup);
    stream.path = toPathString(filePath);
    return stream;
  }
  createWriteStream(filePath, options) {
    const opts = typeof options === "string" ? { } : options;
    let position = opts?.start ?? 0;
    let handle = null;
    const providedWFd = opts?.fd;
    const ownsWHandle = providedWFd == null;
    const writeFn = async (chunk) => {
      if (!handle) {
        if (providedWFd != null) {
          handle = createFileHandle(providedWFd, this._async);
        } else {
          handle = await this.promises.open(toPathString(filePath), opts?.flags ?? "w");
        }
      }
      const { bytesWritten } = await handle.write(chunk, 0, chunk.byteLength, position);
      position += bytesWritten;
    };
    const closeFn = async () => {
      if (handle) {
        if (opts?.flush) {
          await handle.sync();
        }
        if (ownsWHandle) {
          await handle.close();
        }
        handle = null;
      }
    };
    return new NodeWritable(toPathString(filePath), writeFn, closeFn);
  }
  // ---- Utility methods ----
  flushSync() {
    const buf = encodeRequest(OP.FSYNC, "");
    this.syncRequest(buf);
  }
  purgeSync() {
  }
  /** The current filesystem mode. Changes to 'opfs' on corruption fallback. */
  get mode() {
    return this._mode;
  }
  /** Async init helper — avoid blocking main thread.
   *  Rejects with corruption error if VFS was corrupt (but system falls back to OPFS mode).
   *  Callers can catch and continue — the fs API works in OPFS mode after rejection. */
  init() {
    return this.readyPromise.then(() => {
      if (this.corruptionError) {
        throw this.corruptionError;
      }
    });
  }
  /** Switch the filesystem mode at runtime.
   *
   *  Typical flow for IDE corruption recovery:
   *  1. `await fs.init()` throws with corruption error (auto-falls back to opfs)
   *  2. IDE shows warning, user clicks "Repair" → call `repairVFS(root, fs)`
   *  3. After repair: `await fs.setMode('hybrid')` to resume normal VFS+OPFS mode
   *
   *  Returns a Promise that resolves when the new mode is ready. */
  async setMode(newMode) {
    if (newMode === this._mode && this.isReady && !this.corruptionError) {
      return;
    }
    this._mode = newMode;
    this.corruptionError = null;
    this.initError = null;
    this.isReady = false;
    this.config.opfsSync = newMode === "hybrid";
    this.readyPromise = new Promise((resolve2, reject) => {
      this.resolveReady = resolve2;
      this.rejectReady = reject;
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
        if (!this.isFollower) {
          this.initLeaderBroker();
        }
      } else if (msg.type === "init-failed") {
        if (msg.error?.startsWith("Corrupt VFS:")) {
          this.handleCorruptVFS(msg.error);
        } else if (this.holdingLeaderLock) {
          setTimeout(() => this.sendLeaderInit(), 500);
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
    if (newMode === "opfs") {
      this.sendOPFSInit();
    } else {
      this.sendLeaderInit();
    }
    return this.readyPromise;
  }
  // ========== Callback API ==========
  // Node.js-style callback overloads for all async operations.
  // These delegate to this.promises.* and adapt the result to (err, result) callbacks.
  _validateCb(cb) {
    if (typeof cb !== "function") {
      throw new TypeError('The "cb" argument must be of type function. Received ' + typeof cb);
    }
  }
  readFile(filePath, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    this.promises.readFile(filePath, opts).then(
      (result) => setTimeout(() => cb(null, result), 0),
      (err) => setTimeout(() => cb(err), 0)
    );
  }
  writeFile(filePath, data, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    this.promises.writeFile(filePath, data, opts).then(
      () => setTimeout(() => cb(null), 0),
      (err) => setTimeout(() => cb(err), 0)
    );
  }
  appendFile(filePath, data, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    this.promises.appendFile(filePath, data, opts).then(
      () => setTimeout(() => cb(null), 0),
      (err) => setTimeout(() => cb(err), 0)
    );
  }
  mkdir(filePath, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    this.promises.mkdir(filePath, opts).then(
      (result) => setTimeout(() => cb(null, result), 0),
      (err) => setTimeout(() => cb(err), 0)
    );
  }
  rmdir(filePath, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    this.promises.rmdir(filePath, opts).then(
      () => setTimeout(() => cb(null), 0),
      (err) => setTimeout(() => cb(err), 0)
    );
  }
  rm(filePath, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    this.promises.rm(filePath, opts).then(
      () => setTimeout(() => cb(null), 0),
      (err) => setTimeout(() => cb(err), 0)
    );
  }
  unlink(filePath, callback) {
    this._validateCb(callback);
    this.promises.unlink(filePath).then(
      () => setTimeout(() => callback(null), 0),
      (err) => setTimeout(() => callback(err), 0)
    );
  }
  readdir(filePath, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    this.promises.readdir(filePath, opts).then(
      (result) => setTimeout(() => cb(null, result), 0),
      (err) => setTimeout(() => cb(err), 0)
    );
  }
  stat(filePath, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    this.promises.stat(filePath, opts).then(
      (result) => setTimeout(() => cb(null, result), 0),
      (err) => setTimeout(() => cb(err), 0)
    );
  }
  lstat(filePath, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    this.promises.lstat(filePath, opts).then(
      (result) => setTimeout(() => cb(null, result), 0),
      (err) => setTimeout(() => cb(err), 0)
    );
  }
  access(filePath, modeOrCallback, callback) {
    const cb = typeof modeOrCallback === "function" ? modeOrCallback : callback;
    this._validateCb(cb);
    const mode = typeof modeOrCallback === "function" ? void 0 : modeOrCallback;
    this.promises.access(filePath, mode).then(
      () => setTimeout(() => cb(null), 0),
      (err) => setTimeout(() => cb(err), 0)
    );
  }
  rename(oldPath, newPath, callback) {
    this._validateCb(callback);
    this.promises.rename(oldPath, newPath).then(
      () => setTimeout(() => callback(null), 0),
      (err) => setTimeout(() => callback(err), 0)
    );
  }
  copyFile(src, dest, modeOrCallback, callback) {
    const cb = typeof modeOrCallback === "function" ? modeOrCallback : callback;
    this._validateCb(cb);
    const mode = typeof modeOrCallback === "function" ? void 0 : modeOrCallback;
    this.promises.copyFile(src, dest, mode).then(
      () => setTimeout(() => cb(null), 0),
      (err) => setTimeout(() => cb(err), 0)
    );
  }
  truncate(filePath, lenOrCallback, callback) {
    const cb = typeof lenOrCallback === "function" ? lenOrCallback : callback;
    this._validateCb(cb);
    const len = typeof lenOrCallback === "function" ? void 0 : lenOrCallback;
    this.promises.truncate(filePath, len).then(
      () => setTimeout(() => cb(null), 0),
      (err) => setTimeout(() => cb(err), 0)
    );
  }
  realpath(filePath, callback) {
    this._validateCb(callback);
    this.promises.realpath(filePath).then(
      (result) => setTimeout(() => callback(null, result), 0),
      (err) => setTimeout(() => callback(err), 0)
    );
  }
  chmod(filePath, mode, callback) {
    this._validateCb(callback);
    this.promises.chmod(filePath, mode).then(
      () => setTimeout(() => callback(null), 0),
      (err) => setTimeout(() => callback(err), 0)
    );
  }
  chown(filePath, uid, gid, callback) {
    this._validateCb(callback);
    this.promises.chown(filePath, uid, gid).then(
      () => setTimeout(() => callback(null), 0),
      (err) => setTimeout(() => callback(err), 0)
    );
  }
  utimes(filePath, atime, mtime, callback) {
    this._validateCb(callback);
    this.promises.utimes(filePath, atime, mtime).then(
      () => setTimeout(() => callback(null), 0),
      (err) => setTimeout(() => callback(err), 0)
    );
  }
  symlink(target, linkPath, typeOrCallback, callback) {
    const cb = typeof typeOrCallback === "function" ? typeOrCallback : callback;
    this._validateCb(cb);
    const type = typeof typeOrCallback === "function" ? void 0 : typeOrCallback;
    this.promises.symlink(target, linkPath, type).then(
      () => setTimeout(() => cb(null), 0),
      (err) => setTimeout(() => cb(err), 0)
    );
  }
  readlink(filePath, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    this.promises.readlink(filePath, opts).then(
      (result) => setTimeout(() => cb(null, result), 0),
      (err) => setTimeout(() => cb(err), 0)
    );
  }
  link(existingPath, newPath, callback) {
    this._validateCb(callback);
    this.promises.link(existingPath, newPath).then(
      () => setTimeout(() => callback(null), 0),
      (err) => setTimeout(() => callback(err), 0)
    );
  }
  open(filePath, flags, modeOrCallback, callback) {
    const cb = typeof modeOrCallback === "function" ? modeOrCallback : callback;
    this._validateCb(cb);
    const mode = typeof modeOrCallback === "function" ? void 0 : modeOrCallback;
    this.promises.open(filePath, flags, mode).then(
      (handle) => setTimeout(() => cb(null, handle.fd), 0),
      (err) => setTimeout(() => cb(err), 0)
    );
  }
  mkdtemp(prefix, callback) {
    this._validateCb(callback);
    this.promises.mkdtemp(prefix).then(
      (result) => setTimeout(() => callback(null, result), 0),
      (err) => setTimeout(() => callback(err), 0)
    );
  }
  cp(src, dest, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    if (cb) {
      this._cpAsync(src, dest, opts).then(
        () => setTimeout(() => cb(null), 0),
        (err) => setTimeout(() => cb(err), 0)
      );
      return;
    }
    return this._cpAsync(src, dest, opts);
  }
  fdatasync(fd, callback) {
    this._validateCb(callback);
    try {
      this.fdatasyncSync(fd);
      setTimeout(() => callback(null), 0);
    } catch (err) {
      setTimeout(() => callback(err), 0);
    }
  }
  fsync(fd, callback) {
    this._validateCb(callback);
    try {
      this.fsyncSync(fd);
      setTimeout(() => callback(null), 0);
    } catch (err) {
      setTimeout(() => callback(err), 0);
    }
  }
  fstat(fd, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    try {
      const result = this.fstatSync(fd);
      setTimeout(() => cb(null, result), 0);
    } catch (err) {
      setTimeout(() => cb(err), 0);
    }
  }
  ftruncate(fd, lenOrCallback, callback) {
    const cb = typeof lenOrCallback === "function" ? lenOrCallback : callback;
    this._validateCb(cb);
    const len = typeof lenOrCallback === "function" ? 0 : lenOrCallback;
    try {
      this.ftruncateSync(fd, len);
      setTimeout(() => cb(null), 0);
    } catch (err) {
      setTimeout(() => cb(err), 0);
    }
  }
  read(fd, buffer, offset, length, position, callback) {
    this._validateCb(callback);
    try {
      const bytesRead = this.readSync(fd, buffer, offset, length, position);
      setTimeout(() => callback(null, bytesRead, buffer), 0);
    } catch (err) {
      setTimeout(() => callback(err), 0);
    }
  }
  write(fd, bufferOrString, offsetOrPosition, lengthOrEncoding, position, callback) {
    const cb = [offsetOrPosition, lengthOrEncoding, position, callback].find((a) => typeof a === "function");
    this._validateCb(cb);
    try {
      let bytesWritten;
      if (typeof bufferOrString === "string") {
        const pos = typeof offsetOrPosition === "function" ? void 0 : offsetOrPosition;
        const enc = typeof lengthOrEncoding === "function" ? void 0 : lengthOrEncoding;
        bytesWritten = this.writeSync(fd, bufferOrString, pos, enc);
      } else {
        const off = typeof offsetOrPosition === "function" ? void 0 : offsetOrPosition;
        const len = typeof lengthOrEncoding === "function" ? void 0 : lengthOrEncoding;
        const pos = typeof position === "function" ? void 0 : position;
        bytesWritten = this.writeSync(fd, bufferOrString, off, len, pos);
      }
      setTimeout(() => cb(null, bytesWritten, bufferOrString), 0);
    } catch (err) {
      setTimeout(() => cb(err), 0);
    }
  }
  close(fd, callback) {
    try {
      this.closeSync(fd);
      if (callback) setTimeout(() => callback(null), 0);
    } catch (err) {
      if (callback) setTimeout(() => callback(err), 0);
      else throw err;
    }
  }
  exists(filePath, callback) {
    this.promises.exists(filePath).then(
      (result) => setTimeout(() => callback(result), 0),
      () => setTimeout(() => callback(false), 0)
    );
  }
  opendir(filePath, callback) {
    this._validateCb(callback);
    this.promises.opendir(filePath).then(
      (dir) => setTimeout(() => callback(null, dir), 0),
      (err) => setTimeout(() => callback(err), 0)
    );
  }
  glob(pattern, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    this.promises.glob(pattern, opts).then(
      (result) => setTimeout(() => cb(null, result), 0),
      (err) => setTimeout(() => cb(err), 0)
    );
  }
  futimes(fd, atime, mtime, callback) {
    this._validateCb(callback);
    setTimeout(() => callback(null), 0);
  }
  fchmod(fd, mode, callback) {
    this._validateCb(callback);
    setTimeout(() => callback(null), 0);
  }
  fchown(fd, uid, gid, callback) {
    this._validateCb(callback);
    setTimeout(() => callback(null), 0);
  }
  lchmod(filePath, mode, callback) {
    this._validateCb(callback);
    this.promises.lchmod(filePath, mode).then(
      () => setTimeout(() => callback(null), 0),
      (err) => setTimeout(() => callback(err), 0)
    );
  }
  lchown(filePath, uid, gid, callback) {
    this._validateCb(callback);
    this.promises.lchown(filePath, uid, gid).then(
      () => setTimeout(() => callback(null), 0),
      (err) => setTimeout(() => callback(err), 0)
    );
  }
  lutimes(filePath, atime, mtime, callback) {
    this._validateCb(callback);
    this.promises.lutimes(filePath, atime, mtime).then(
      () => setTimeout(() => callback(null), 0),
      (err) => setTimeout(() => callback(err), 0)
    );
  }
};
var VFSPromises = class {
  _async;
  _ns;
  constructor(asyncRequest, ns) {
    this._async = asyncRequest;
    this._ns = ns;
  }
  /** Node.js compat: fs.promises.constants (same as fs.constants) */
  get constants() {
    return constants;
  }
  readFile(filePath, options) {
    return readFile(this._async, toPathString(filePath), options);
  }
  writeFile(filePath, data, options) {
    return writeFile(this._async, toPathString(filePath), data, options);
  }
  appendFile(filePath, data, options) {
    return appendFile(this._async, toPathString(filePath), data);
  }
  mkdir(filePath, options) {
    return mkdir(this._async, toPathString(filePath), options);
  }
  rmdir(filePath, options) {
    return rmdir(this._async, toPathString(filePath), options);
  }
  rm(filePath, options) {
    return rm(this._async, toPathString(filePath), options);
  }
  unlink(filePath) {
    return unlink(this._async, toPathString(filePath));
  }
  readdir(filePath, options) {
    return readdir(this._async, toPathString(filePath), options);
  }
  glob(pattern, options) {
    return glob(this._async, pattern, options);
  }
  stat(filePath, options) {
    return stat(this._async, toPathString(filePath), options);
  }
  lstat(filePath, options) {
    return lstat(this._async, toPathString(filePath), options);
  }
  access(filePath, mode) {
    return access(this._async, toPathString(filePath), mode);
  }
  rename(oldPath, newPath) {
    return rename(this._async, toPathString(oldPath), toPathString(newPath));
  }
  copyFile(src, dest, mode) {
    return copyFile(this._async, toPathString(src), toPathString(dest), mode);
  }
  async cp(src, dest, options) {
    const srcPath = toPathString(src);
    const destPath = toPathString(dest);
    const force = options?.force !== false;
    const errorOnExist = options?.errorOnExist ?? false;
    const dereference = options?.dereference ?? false;
    const preserveTimestamps = options?.preserveTimestamps ?? false;
    const srcStat = dereference ? await this.stat(srcPath) : await this.lstat(srcPath);
    if (srcStat.isDirectory()) {
      if (!options?.recursive) {
        throw createError("EISDIR", "cp", srcPath);
      }
      try {
        await this.mkdir(destPath, { recursive: true });
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      }
      const entries = await this.readdir(srcPath, { withFileTypes: true });
      for (const entry of entries) {
        const srcChild = join(srcPath, entry.name);
        const destChild = join(destPath, entry.name);
        await this.cp(srcChild, destChild, options);
      }
    } else if (srcStat.isSymbolicLink() && !dereference) {
      const target = await this.readlink(srcPath);
      let destExists = false;
      try {
        await this.lstat(destPath);
        destExists = true;
      } catch {
      }
      if (destExists) {
        if (errorOnExist) throw createError("EEXIST", "cp", destPath);
        if (!force) return;
        await this.unlink(destPath);
      }
      await this.symlink(target, destPath);
    } else {
      let destExists = false;
      try {
        await this.lstat(destPath);
        destExists = true;
      } catch {
      }
      if (destExists) {
        if (errorOnExist) throw createError("EEXIST", "cp", destPath);
        if (!force) return;
      }
      await this.copyFile(srcPath, destPath, errorOnExist ? constants.COPYFILE_EXCL : 0);
    }
    if (preserveTimestamps) {
      const st = await this.stat(srcPath);
      await this.utimes(destPath, st.atime, st.mtime);
    }
  }
  truncate(filePath, len) {
    return truncate(this._async, toPathString(filePath), len);
  }
  realpath(filePath) {
    return realpath(this._async, toPathString(filePath));
  }
  exists(filePath) {
    return exists(this._async, toPathString(filePath));
  }
  chmod(filePath, mode) {
    return chmod(this._async, toPathString(filePath), mode);
  }
  /** Like chmod but operates on the symlink itself. In this VFS, delegates to chmod. */
  lchmod(filePath, mode) {
    return chmod(this._async, filePath, mode);
  }
  /** chmod on an open file descriptor. No-op in this VFS (permissions are cosmetic). */
  async fchmod(_fd, _mode) {
  }
  chown(filePath, uid, gid) {
    return chown(this._async, toPathString(filePath), uid, gid);
  }
  /** Like chown but operates on the symlink itself. In this VFS, delegates to chown. */
  lchown(filePath, uid, gid) {
    return chown(this._async, filePath, uid, gid);
  }
  /** chown on an open file descriptor. No-op in this VFS (permissions are cosmetic). */
  async fchown(_fd, _uid, _gid) {
  }
  utimes(filePath, atime, mtime) {
    return utimes(this._async, toPathString(filePath), atime, mtime);
  }
  /** utimes on an open file descriptor. No-op in this VFS (cannot resolve fd to path). */
  async futimes(_fd, _atime, _mtime) {
  }
  /** Like utimes but operates on the symlink itself. In this VFS, delegates to utimes. */
  lutimes(filePath, atime, mtime) {
    return utimes(this._async, filePath, atime, mtime);
  }
  symlink(target, linkPath, type) {
    return symlink(this._async, toPathString(target), toPathString(linkPath));
  }
  readlink(filePath, options) {
    return readlink(this._async, toPathString(filePath), options);
  }
  link(existingPath, newPath) {
    return link(this._async, toPathString(existingPath), toPathString(newPath));
  }
  open(filePath, flags, mode) {
    return open(this._async, toPathString(filePath), flags);
  }
  opendir(filePath) {
    return opendir(this._async, toPathString(filePath));
  }
  mkdtemp(prefix) {
    return mkdtemp(this._async, prefix);
  }
  async openAsBlob(filePath, options) {
    const data = await this.readFile(filePath);
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
    return new Blob([bytes], { type: options?.type ?? "" });
  }
  async statfs(path) {
    return {
      type: 1447449377,
      // "VFS!"
      bsize: 4096,
      blocks: 1024 * 1024,
      // ~4GB virtual capacity
      bfree: 512 * 1024,
      // ~2GB free (estimate)
      bavail: 512 * 1024,
      files: 1e4,
      // default max inodes
      ffree: 5e3
      // estimate half free
    };
  }
  async *watch(filePath, options) {
    yield* watchAsync(this._ns, this._async, filePath, options);
  }
  async fsync(_fd) {
    await this._async(OP.FSYNC, "");
  }
  async fdatasync(_fd) {
    await this._async(OP.FSYNC, "");
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
  // Configurable upper bounds
  maxInodes = 4e6;
  maxBlocks = 4e6;
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
        path = decoder8.decode(pathBuf.subarray(inode.pathOffset, inode.pathOffset + inode.pathLength));
      } else {
        path = this.readPath(inode.pathOffset, inode.pathLength);
      }
      if (!path.startsWith("/") || path.includes("\0")) {
        throw new Error(`Corrupt VFS: inode ${i} has invalid path "${path.substring(0, 50)}"`);
      }
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
    inode.nlink = Math.max(0, inode.nlink - 1);
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
  // ---- LSTAT (no symlink follow for the FINAL component) ----
  lstat(path) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, false);
    if (idx === void 0) return { status: CODE_TO_STATUS.ENOENT, data: null };
    return this.encodeStatResponse(idx);
  }
  encodeStatResponse(idx) {
    const inode = this.readInode(idx);
    let nlink = inode.nlink;
    if (inode.type === INODE_TYPE.DIRECTORY) {
      const path = this.readPath(inode.pathOffset, inode.pathLength);
      const children = this.getDirectChildren(path);
      let subdirCount = 0;
      for (const child of children) {
        const childIdx = this.pathIndex.get(child);
        if (childIdx !== void 0) {
          const childInode = this.readInode(childIdx);
          if (childInode.type === INODE_TYPE.DIRECTORY) subdirCount++;
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
    return { status: 0, data: null };
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
    const resolved = this.resolvePathFull(path, true);
    if (!resolved) return { status: CODE_TO_STATUS.ENOENT, data: null };
    const inode = this.readInode(resolved.idx);
    if (inode.type !== INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.ENOTDIR, data: null };
    const withFileTypes = (flags & 1) !== 0;
    const children = this.getDirectChildren(resolved.resolvedPath);
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
  // ---- LINK (hard link — copies the file data, tracks nlink) ----
  link(existingPath, newPath) {
    existingPath = this.normalizePath(existingPath);
    newPath = this.normalizePath(newPath);
    const srcIdx = this.resolvePathComponents(existingPath, true);
    if (srcIdx === void 0) return { status: CODE_TO_STATUS.ENOENT };
    const srcInode = this.readInode(srcIdx);
    if (srcInode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EPERM };
    if (this.pathIndex.has(newPath)) return { status: CODE_TO_STATUS.EEXIST };
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
  getBuffer() {
    return this.buf.buffer.slice(0, this.len);
  }
  grow(minSize) {
    const MAX_SIZE = 4 * 1024 * 1024 * 1024;
    if (minSize > MAX_SIZE) {
      throw new Error(`MemoryHandle: cannot grow to ${minSize} bytes (max ${MAX_SIZE})`);
    }
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
function readVFSRecursive(fs, vfsPath) {
  const result = [];
  let entries;
  try {
    entries = fs.readdirSync(vfsPath, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    const fullPath = vfsPath === "/" ? `/${entry.name}` : `${vfsPath}/${entry.name}`;
    if (entry.isDirectory()) {
      result.push({ path: fullPath, type: "directory" });
      result.push(...readVFSRecursive(fs, fullPath));
    } else {
      try {
        const data = fs.readFileSync(fullPath);
        result.push({ path: fullPath, type: "file", data });
      } catch {
      }
    }
  }
  return result;
}
async function unpackToOPFS(root = "/", fs) {
  const rootDir = await navigateToRoot(root);
  if (fs) {
    const vfsEntries = readVFSRecursive(fs, "/");
    let files2 = 0;
    let directories2 = 0;
    for (const entry of vfsEntries) {
      if (entry.type === "directory") {
        const name = basename2(entry.path);
        const parent = await ensureParentDirs(rootDir, entry.path);
        await parent.getDirectoryHandle(name, { create: true });
        directories2++;
      } else {
        try {
          await writeOPFSFile(rootDir, entry.path, entry.data ?? new Uint8Array(0));
          files2++;
        } catch (err) {
          console.warn(`[VFS] Failed to write OPFS file ${entry.path}: ${err.message}`);
        }
      }
    }
    return { files: files2, directories: directories2 };
  }
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
      const name = basename2(entry.path);
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
async function loadFromOPFS(root = "/", fs) {
  const rootDir = await navigateToRoot(root);
  const opfsEntries = await readOPFSRecursive(rootDir, "", /* @__PURE__ */ new Set([".vfs.bin"]));
  if (fs) {
    try {
      const rootEntries = fs.readdirSync("/");
      for (const entry of rootEntries) {
        try {
          fs.rmSync(`/${entry}`, { recursive: true, force: true });
        } catch {
        }
      }
    } catch {
    }
    const dirs = opfsEntries.filter((e) => e.type === "directory").sort((a, b) => a.path.localeCompare(b.path));
    let files = 0;
    let directories = 0;
    for (const dir of dirs) {
      try {
        fs.mkdirSync(dir.path, { recursive: true, mode: 493 });
        directories++;
      } catch {
      }
    }
    const fileEntries = opfsEntries.filter((e) => e.type === "file");
    for (const file of fileEntries) {
      try {
        const parentPath = file.path.substring(0, file.path.lastIndexOf("/")) || "/";
        if (parentPath !== "/") {
          try {
            fs.mkdirSync(parentPath, { recursive: true, mode: 493 });
          } catch {
          }
        }
        fs.writeFileSync(file.path, new Uint8Array(file.data));
        files++;
      } catch (err) {
        console.warn(`[VFS] Failed to write ${file.path}: ${err.message}`);
      }
    }
    return { files, directories };
  }
  return spawnRepairWorker({ type: "load", root });
}
async function repairVFS(root = "/", fs) {
  if (fs) {
    const loadResult = await loadFromOPFS(root, fs);
    await unpackToOPFS(root, fs);
    const total = loadResult.files + loadResult.directories;
    return {
      recovered: total,
      lost: 0,
      entries: []
      // Detailed entries not available in fs-based path
    };
  }
  return spawnRepairWorker({ type: "repair", root });
}
function spawnRepairWorker(msg) {
  return new Promise((resolve2, reject) => {
    const worker = new Worker(
      new URL("./workers/repair.worker.js", import.meta.url),
      { type: "module" }
    );
    worker.onmessage = (event) => {
      worker.terminate();
      if (event.data.error) {
        reject(new Error(event.data.error));
      } else {
        resolve2(event.data);
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Repair worker failed"));
    };
    worker.postMessage(msg);
  });
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

export { FSError, NodeReadable, NodeWritable, NodeReadable as ReadStream, SimpleEventEmitter, VFSFileSystem, NodeWritable as WriteStream, constants, createError, createFS, getDefaultFS, init, loadFromOPFS, path_exports as path, repairVFS, statusToError, unpackToOPFS };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map