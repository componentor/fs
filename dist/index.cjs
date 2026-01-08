'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/path.ts
var path_exports = {};
__export(path_exports, {
  basename: () => basename,
  default: () => path_default,
  delimiter: () => delimiter,
  dirname: () => dirname,
  extname: () => extname,
  format: () => format,
  isAbsolute: () => isAbsolute,
  join: () => join,
  normalize: () => normalize,
  parse: () => parse,
  posix: () => posix,
  relative: () => relative,
  resolve: () => resolve,
  sep: () => sep
});
var sep = "/";
var delimiter = ":";
function normalize(p) {
  if (p.length === 0) return ".";
  const isAbsolute2 = p.charCodeAt(0) === 47;
  const trailingSlash = p.charCodeAt(p.length - 1) === 47;
  const segments = p.split("/");
  const result = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (result.length > 0 && result[result.length - 1] !== "..") {
        result.pop();
      } else if (!isAbsolute2) {
        result.push("..");
      }
    } else {
      result.push(segment);
    }
  }
  let normalized = result.join("/");
  if (isAbsolute2) {
    normalized = "/" + normalized;
  }
  if (trailingSlash && normalized.length > 1) {
    normalized += "/";
  }
  return normalized || (isAbsolute2 ? "/" : ".");
}
function join(...paths) {
  if (paths.length === 0) return ".";
  let joined;
  for (const path of paths) {
    if (path.length > 0) {
      if (joined === void 0) {
        joined = path;
      } else {
        joined += "/" + path;
      }
    }
  }
  if (joined === void 0) return ".";
  return normalize(joined);
}
function resolve(...paths) {
  let resolvedPath = "";
  let resolvedAbsolute = false;
  for (let i = paths.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    const path = i >= 0 ? paths[i] : "/";
    if (path == null || path.length === 0) continue;
    resolvedPath = resolvedPath ? path + "/" + resolvedPath : path;
    resolvedAbsolute = path.charCodeAt(0) === 47;
  }
  resolvedPath = normalize(resolvedPath);
  if (resolvedPath.length > 1 && resolvedPath.endsWith("/")) {
    resolvedPath = resolvedPath.slice(0, -1);
  }
  if (resolvedAbsolute) {
    return resolvedPath.length > 0 ? resolvedPath : "/";
  }
  return resolvedPath.length > 0 ? resolvedPath : ".";
}
function isAbsolute(p) {
  return p.length > 0 && p.charCodeAt(0) === 47;
}
function dirname(p) {
  if (p.length === 0) return ".";
  const hasRoot = p.charCodeAt(0) === 47;
  let end = -1;
  let matchedSlash = true;
  for (let i = p.length - 1; i >= 1; --i) {
    if (p.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) return hasRoot ? "/" : ".";
  if (hasRoot && end === 1) return "//";
  return p.slice(0, end);
}
function basename(p, ext) {
  let start = 0;
  let end = -1;
  let matchedSlash = true;
  for (let i = p.length - 1; i >= 0; --i) {
    if (p.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        start = i + 1;
        break;
      }
    } else if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
  }
  if (end === -1) return "";
  const base = p.slice(start, end);
  if (ext && base.endsWith(ext)) {
    return base.slice(0, base.length - ext.length);
  }
  return base;
}
function extname(p) {
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let preDotState = 0;
  for (let i = p.length - 1; i >= 0; --i) {
    const code = p.charCodeAt(i);
    if (code === 47) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === 46) {
      if (startDot === -1) {
        startDot = i;
      } else if (preDotState !== 1) {
        preDotState = 1;
      }
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }
  if (startDot === -1 || end === -1 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
    return "";
  }
  return p.slice(startDot, end);
}
function relative(from, to) {
  if (from === to) return "";
  from = resolve(from);
  to = resolve(to);
  if (from === to) return "";
  const fromParts = from.split("/").filter(Boolean);
  const toParts = to.split("/").filter(Boolean);
  let commonLength = 0;
  const minLength = Math.min(fromParts.length, toParts.length);
  for (let i = 0; i < minLength; i++) {
    if (fromParts[i] === toParts[i]) {
      commonLength++;
    } else {
      break;
    }
  }
  const upCount = fromParts.length - commonLength;
  const relativeParts = [];
  for (let i = 0; i < upCount; i++) {
    relativeParts.push("..");
  }
  for (let i = commonLength; i < toParts.length; i++) {
    relativeParts.push(toParts[i]);
  }
  return relativeParts.join("/") || ".";
}
function parse(p) {
  const ret = { root: "", dir: "", base: "", ext: "", name: "" };
  if (p.length === 0) return ret;
  const isAbsolutePath = p.charCodeAt(0) === 47;
  if (isAbsolutePath) {
    ret.root = "/";
  }
  let start = 0;
  let end = -1;
  let startDot = -1;
  let matchedSlash = true;
  let preDotState = 0;
  for (let i = p.length - 1; i >= 0; --i) {
    const code = p.charCodeAt(i);
    if (code === 47) {
      if (!matchedSlash) {
        start = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === 46) {
      if (startDot === -1) {
        startDot = i;
      } else if (preDotState !== 1) {
        preDotState = 1;
      }
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }
  if (end !== -1) {
    if (startDot === -1 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === start + 1) {
      ret.base = p.slice(start, end);
      ret.name = ret.base;
    } else {
      ret.name = p.slice(start, startDot);
      ret.base = p.slice(start, end);
      ret.ext = p.slice(startDot, end);
    }
  }
  if (start > 0) {
    ret.dir = p.slice(0, start - 1);
  } else if (isAbsolutePath) {
    ret.dir = "/";
  }
  return ret;
}
function format(pathObject) {
  const dir = pathObject.dir || pathObject.root || "";
  const base = pathObject.base || (pathObject.name || "") + (pathObject.ext || "");
  if (!dir) return base;
  if (dir === pathObject.root) return dir + base;
  return dir + "/" + base;
}
var posix = {
  sep,
  delimiter,
  normalize,
  join,
  resolve,
  isAbsolute,
  dirname,
  basename,
  extname,
  relative,
  parse,
  format
};
var path_default = posix;

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

// src/errors.ts
var FSError = class _FSError extends Error {
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
    const ErrorWithCapture = Error;
    if (ErrorWithCapture.captureStackTrace) {
      ErrorWithCapture.captureStackTrace(this, _FSError);
    }
  }
};
var ErrorCodes = {
  ENOENT: -2,
  EEXIST: -17,
  EISDIR: -21,
  ENOTDIR: -20,
  ENOTEMPTY: -39,
  EACCES: -13,
  EINVAL: -22,
  ENOSPC: -28};
function createENOENT(syscall, path) {
  return new FSError(
    "ENOENT",
    ErrorCodes.ENOENT,
    `ENOENT: no such file or directory, ${syscall} '${path}'`,
    syscall,
    path
  );
}
function createEEXIST(syscall, path) {
  return new FSError(
    "EEXIST",
    ErrorCodes.EEXIST,
    `EEXIST: file already exists, ${syscall} '${path}'`,
    syscall,
    path
  );
}
function createEISDIR(syscall, path) {
  return new FSError(
    "EISDIR",
    ErrorCodes.EISDIR,
    `EISDIR: illegal operation on a directory, ${syscall} '${path}'`,
    syscall,
    path
  );
}
function createENOTDIR(syscall, path) {
  return new FSError(
    "ENOTDIR",
    ErrorCodes.ENOTDIR,
    `ENOTDIR: not a directory, ${syscall} '${path}'`,
    syscall,
    path
  );
}
function createENOTEMPTY(syscall, path) {
  return new FSError(
    "ENOTEMPTY",
    ErrorCodes.ENOTEMPTY,
    `ENOTEMPTY: directory not empty, ${syscall} '${path}'`,
    syscall,
    path
  );
}
function createEACCES(syscall, path) {
  return new FSError(
    "EACCES",
    ErrorCodes.EACCES,
    `EACCES: permission denied, ${syscall} '${path}'`,
    syscall,
    path
  );
}
function createEINVAL(syscall, path) {
  return new FSError(
    "EINVAL",
    ErrorCodes.EINVAL,
    `EINVAL: invalid argument, ${syscall} '${path}'`,
    syscall,
    path
  );
}
function mapErrorCode(errorName, syscall, path) {
  switch (errorName) {
    case "NotFoundError":
      return createENOENT(syscall, path);
    case "NotAllowedError":
      return createEACCES(syscall, path);
    case "TypeMismatchError":
      return createENOTDIR(syscall, path);
    case "InvalidModificationError":
      return createENOTEMPTY(syscall, path);
    case "QuotaExceededError":
      return new FSError("ENOSPC", ErrorCodes.ENOSPC, `ENOSPC: no space left on device, ${syscall} '${path}'`, syscall, path);
    default:
      return new FSError("EINVAL", ErrorCodes.EINVAL, `${errorName}: ${syscall} '${path}'`, syscall, path);
  }
}

// src/filesystem.ts
var isWorkerContext = typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope;
var KERNEL_SOURCE = `
const LOCK_NAME = 'opfs_fs_lock';
let messageQueue = [];
let isReady = false;
let cachedRoot = null;
const dirCache = new Map();

// Sync handle cache - MAJOR performance optimization
// Handles auto-release after idle timeout to allow external tools to access files
const syncHandleCache = new Map();
const syncHandleLastAccess = new Map();
const MAX_HANDLES = 100;
const HANDLE_IDLE_TIMEOUT = 2000;
let idleCleanupTimer = null;

function scheduleIdleCleanup() {
  if (idleCleanupTimer) return;
  idleCleanupTimer = setTimeout(() => {
    idleCleanupTimer = null;
    const now = Date.now();
    for (const [p, lastAccess] of syncHandleLastAccess) {
      if (now - lastAccess > HANDLE_IDLE_TIMEOUT) {
        const h = syncHandleCache.get(p);
        if (h) { try { h.flush(); h.close(); } catch {} syncHandleCache.delete(p); }
        syncHandleLastAccess.delete(p);
      }
    }
    if (syncHandleCache.size > 0) scheduleIdleCleanup();
  }, HANDLE_IDLE_TIMEOUT);
}

async function getSyncHandle(filePath, create) {
  const cached = syncHandleCache.get(filePath);
  if (cached) {
    syncHandleLastAccess.set(filePath, Date.now());
    return cached;
  }

  // Evict oldest handles if cache is full
  if (syncHandleCache.size >= MAX_HANDLES) {
    const keys = Array.from(syncHandleCache.keys()).slice(0, 10);
    for (const key of keys) {
      const h = syncHandleCache.get(key);
      if (h) { try { h.close(); } catch {} syncHandleCache.delete(key); syncHandleLastAccess.delete(key); }
    }
  }

  const fh = await getFileHandle(filePath, create);
  const access = await fh.createSyncAccessHandle();
  syncHandleCache.set(filePath, access);
  syncHandleLastAccess.set(filePath, Date.now());
  scheduleIdleCleanup();
  return access;
}

function closeSyncHandle(filePath) {
  const h = syncHandleCache.get(filePath);
  if (h) { try { h.close(); } catch {} syncHandleCache.delete(filePath); syncHandleLastAccess.delete(filePath); }
}

function closeHandlesUnder(prefix) {
  for (const [p, h] of syncHandleCache) {
    if (p === prefix || p.startsWith(prefix + '/')) {
      try { h.close(); } catch {}
      syncHandleCache.delete(p);
      syncHandleLastAccess.delete(p);
    }
  }
}

// Clear directory cache entries for a path and all descendants
function clearDirCacheUnder(filePath) {
  // Convert to cache key format (no leading slash)
  const prefix = parsePath(filePath).join('/');
  if (!prefix) {
    // Root directory - clear everything
    dirCache.clear();
    return;
  }
  for (const key of dirCache.keys()) {
    if (key === prefix || key.startsWith(prefix + '/')) {
      dirCache.delete(key);
    }
  }
}

async function getRoot() {
  if (!cachedRoot) {
    cachedRoot = await navigator.storage.getDirectory();
  }
  return cachedRoot;
}

function parsePath(filePath) {
  return filePath.split('/').filter(Boolean);
}

async function getDirectoryHandle(parts, create = false) {
  if (parts.length === 0) return getRoot();

  const cacheKey = parts.join('/');
  if (dirCache.has(cacheKey)) {
    return dirCache.get(cacheKey);
  }

  let curr = await getRoot();
  let pathSoFar = '';

  for (const part of parts) {
    pathSoFar += (pathSoFar ? '/' : '') + part;

    if (dirCache.has(pathSoFar)) {
      curr = dirCache.get(pathSoFar);
    } else {
      curr = await curr.getDirectoryHandle(part, { create });
      dirCache.set(pathSoFar, curr);
    }
  }

  return curr;
}

async function getFileHandle(filePath, create = false) {
  const parts = parsePath(filePath);
  const fileName = parts.pop();
  if (!fileName) throw new Error('Invalid file path');
  const dir = parts.length > 0 ? await getDirectoryHandle(parts, create) : await getRoot();
  return await dir.getFileHandle(fileName, { create });
}

async function getParentAndName(filePath) {
  const parts = parsePath(filePath);
  const name = parts.pop();
  if (!name) throw new Error('Invalid path');
  const parent = parts.length > 0 ? await getDirectoryHandle(parts, false) : await getRoot();
  return { parent, name };
}

async function handleRead(filePath, payload) {
  const access = await getSyncHandle(filePath, false);
  const size = access.getSize();
  const offset = payload?.offset || 0;
  const len = payload?.len || (size - offset);
  const buf = new Uint8Array(len);
  const bytesRead = access.read(buf, { at: offset });
  return { data: buf.slice(0, bytesRead) };
}

async function handleWrite(filePath, payload) {
  const access = await getSyncHandle(filePath, true);
  if (payload?.data) {
    const offset = payload.offset ?? 0;
    if (offset === 0) access.truncate(0);
    access.write(payload.data, { at: offset });
    // Only flush if explicitly requested (default: true for safety)
    if (payload?.flush !== false) access.flush();
  }
  return { success: true };
}

async function handleAppend(filePath, payload) {
  const access = await getSyncHandle(filePath, true);
  if (payload?.data) {
    const size = access.getSize();
    access.write(payload.data, { at: size });
    if (payload?.flush !== false) access.flush();
  }
  return { success: true };
}

async function handleTruncate(filePath, payload) {
  const access = await getSyncHandle(filePath, false);
  access.truncate(payload?.len ?? 0);
  access.flush();
  return { success: true };
}

async function handleStat(filePath) {
  const parts = parsePath(filePath);
  // Node.js compatible stat shape: mode 33188 = file (0o100644), 16877 = dir (0o40755)
  if (parts.length === 0) {
    return { size: 0, mtimeMs: Date.now(), mode: 16877, type: 'directory' };
  }
  const name = parts.pop();
  const parent = parts.length > 0 ? await getDirectoryHandle(parts, false) : await getRoot();
  try {
    const fh = await parent.getFileHandle(name);
    // Use getFile() for metadata - faster than createSyncAccessHandle
    const file = await fh.getFile();
    return { size: file.size, mtimeMs: file.lastModified, mode: 33188, type: 'file' };
  } catch {
    try {
      await parent.getDirectoryHandle(name);
      return { size: 0, mtimeMs: Date.now(), mode: 16877, type: 'directory' };
    } catch {
      throw new Error('NotFoundError');
    }
  }
}

async function handleExists(filePath) {
  try {
    await handleStat(filePath);
    return { exists: true };
  } catch {
    return { exists: false };
  }
}

async function handleMkdir(filePath, payload) {
  const parts = parsePath(filePath);
  if (payload?.recursive) {
    let curr = await getRoot();
    for (const part of parts) {
      curr = await curr.getDirectoryHandle(part, { create: true });
    }
  } else {
    const name = parts.pop();
    if (!name) throw new Error('Invalid path');
    const parent = parts.length > 0 ? await getDirectoryHandle(parts, false) : await getRoot();
    await parent.getDirectoryHandle(name, { create: true });
  }
  return { success: true };
}

async function handleRmdir(filePath, payload) {
  closeHandlesUnder(filePath); // Close all cached file handles under this directory
  clearDirCacheUnder(filePath); // Clear stale directory cache entries
  const { parent, name } = await getParentAndName(filePath);
  if (payload?.recursive) {
    await parent.removeEntry(name, { recursive: true });
  } else {
    const dir = await parent.getDirectoryHandle(name);
    const entries = dir.entries();
    const first = await entries.next();
    if (!first.done) {
      const e = new Error('InvalidModificationError');
      e.name = 'InvalidModificationError';
      throw e;
    }
    await parent.removeEntry(name);
  }
  return { success: true };
}

async function handleUnlink(filePath) {
  closeSyncHandle(filePath); // Close cached handle before deleting
  const { parent, name } = await getParentAndName(filePath);
  await parent.removeEntry(name);
  return { success: true };
}

async function handleReaddir(filePath) {
  const parts = parsePath(filePath);
  const dir = parts.length > 0 ? await getDirectoryHandle(parts, false) : await getRoot();
  const entries = [];
  for await (const [name] of dir.entries()) {
    entries.push(name);
  }
  return { entries };
}

async function handleRename(oldPath, payload) {
  if (!payload?.newPath) throw new Error('newPath required');
  const newPath = payload.newPath;

  // Close cached handles for old path (file will be deleted)
  closeSyncHandle(oldPath);
  closeHandlesUnder(oldPath); // For directory renames
  clearDirCacheUnder(oldPath); // Clear stale directory cache entries

  const oldParts = parsePath(oldPath);
  const newParts = parsePath(newPath);
  const oldName = oldParts.pop();
  const newName = newParts.pop();
  const oldParent = oldParts.length > 0 ? await getDirectoryHandle(oldParts, false) : await getRoot();
  const newParent = newParts.length > 0 ? await getDirectoryHandle(newParts, true) : await getRoot();

  try {
    const fh = await oldParent.getFileHandle(oldName);
    const file = await fh.getFile();
    const data = new Uint8Array(await file.arrayBuffer());

    // Use cached handle for new file
    const access = await getSyncHandle(newPath, true);
    access.truncate(0);
    access.write(data, { at: 0 });
    access.flush();

    await oldParent.removeEntry(oldName);
    return { success: true };
  } catch {
    const oldDir = await oldParent.getDirectoryHandle(oldName);
    async function copyDir(src, dst, dstPath) {
      for await (const [name, handle] of src.entries()) {
        if (handle.kind === 'file') {
          const srcFile = await handle.getFile();
          const data = new Uint8Array(await srcFile.arrayBuffer());
          const filePath = dstPath + '/' + name;
          const access = await getSyncHandle(filePath, true);
          access.truncate(0);
          access.write(data, { at: 0 });
          access.flush();
        } else {
          const newSubDir = await dst.getDirectoryHandle(name, { create: true });
          await copyDir(handle, newSubDir, dstPath + '/' + name);
        }
      }
    }
    const newDir = await newParent.getDirectoryHandle(newName, { create: true });
    await copyDir(oldDir, newDir, newPath);
    await oldParent.removeEntry(oldName, { recursive: true });
    return { success: true };
  }
}

async function handleCopy(srcPath, payload) {
  if (!payload?.newPath) throw new Error('newPath required');
  const dstPath = payload.newPath;
  const srcParts = parsePath(srcPath);
  const srcName = srcParts.pop();
  const srcParent = srcParts.length > 0 ? await getDirectoryHandle(srcParts, false) : await getRoot();
  const srcFh = await srcParent.getFileHandle(srcName);
  const srcFile = await srcFh.getFile();
  const data = new Uint8Array(await srcFile.arrayBuffer());

  // Use cached handle for destination
  const access = await getSyncHandle(dstPath, true);
  access.truncate(0);
  access.write(data, { at: 0 });
  access.flush();
  return { success: true };
}

function handleFlush() {
  // Flush all cached sync handles
  for (const [, handle] of syncHandleCache) {
    try { handle.flush(); } catch {}
  }
  return { success: true };
}

function handlePurge() {
  // Flush and close all cached sync handles
  for (const [, handle] of syncHandleCache) {
    try { handle.flush(); handle.close(); } catch {}
  }
  syncHandleCache.clear();
  dirCache.clear();
  cachedRoot = null;
  return { success: true };
}

async function processMessage(msg) {
  const { type, path, payload } = msg;
  switch (type) {
    case 'read': return handleRead(path, payload);
    case 'write': return handleWrite(path, payload);
    case 'append': return handleAppend(path, payload);
    case 'truncate': return handleTruncate(path, payload);
    case 'stat': return handleStat(path);
    case 'exists': return handleExists(path);
    case 'mkdir': return handleMkdir(path, payload);
    case 'rmdir': return handleRmdir(path, payload);
    case 'unlink': return handleUnlink(path);
    case 'readdir': return handleReaddir(path);
    case 'rename': return handleRename(path, payload);
    case 'copy': return handleCopy(path, payload);
    case 'flush': return handleFlush();
    case 'purge': return handlePurge();
    default: throw new Error('Unknown operation: ' + type);
  }
}

function sendAtomicsResponse(result, payload) {
  const ctrl = payload.ctrl;
  if (result.data && payload.dataBuffer) {
    const view = new Uint8Array(payload.dataBuffer);
    view.set(result.data);
    Atomics.store(ctrl, 0, result.data.length);
  } else if (result.entries && payload.resultBuffer) {
    const json = JSON.stringify(result);
    const encoded = new TextEncoder().encode(json);
    const view = new Uint8Array(payload.resultBuffer);
    view.set(encoded);
    Atomics.store(ctrl, 0, encoded.length);
  } else if (result.success) {
    Atomics.store(ctrl, 0, 1);
  } else if (result.exists !== undefined) {
    Atomics.store(ctrl, 0, result.exists ? 1 : 0);
  } else if (result.isFile !== undefined) {
    if (payload.resultBuffer) {
      const json = JSON.stringify(result);
      const encoded = new TextEncoder().encode(json);
      const view = new Uint8Array(payload.resultBuffer);
      view.set(encoded);
      Atomics.store(ctrl, 0, encoded.length);
    } else {
      Atomics.store(ctrl, 0, result.size || 0);
    }
  }
  Atomics.notify(ctrl, 0);
}

// Handle incoming messages
async function handleMessage(msg) {
  const { id, payload } = msg;
  try {
    const result = await processMessage(msg);
    if (payload?.ctrl) {
      sendAtomicsResponse(result, payload);
    } else {
      // Use Transferable for data to avoid copying
      if (result.data) {
        const buffer = result.data.buffer;
        self.postMessage({ id, result }, [buffer]);
      } else {
        self.postMessage({ id, result });
      }
    }
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    // Use error name if it's a specific DOM exception, otherwise use message
    // (handleStat throws new Error('NotFoundError') where message contains the type)
    const errorName = error.name || 'Error';
    const errorCode = errorName !== 'Error' ? errorName : (error.message || 'Error');
    if (payload?.ctrl) {
      Atomics.store(payload.ctrl, 0, -1);
      Atomics.notify(payload.ctrl, 0);
    } else {
      self.postMessage({ id, error: errorCode, code: errorCode });
    }
  }
}

// Process queued messages after ready
function processQueue() {
  while (messageQueue.length > 0) {
    const msg = messageQueue.shift();
    handleMessage(msg);
  }
}

// Handle messages directly - no serialization needed because:
// - Tier 2: Client awaits response before sending next message
// - Each OPFSFileSystem instance has its own worker
self.onmessage = (event) => {
  if (isReady) {
    handleMessage(event.data);
  } else {
    messageQueue.push(event.data);
  }
};

// Signal ready after a timeout to ensure main thread handler is set
setTimeout(() => {
  isReady = true;
  processQueue();
  self.postMessage({ type: 'ready' });
}, 10);
`;
function createStats(result) {
  const isFile = result.type ? result.type === "file" : result.isFile ?? false;
  const isDir = result.type ? result.type === "directory" : result.isDirectory ?? false;
  const mtimeMs = result.mtimeMs ?? result.mtime ?? Date.now();
  const size = result.size ?? 0;
  const mode = result.mode ?? (isDir ? 16877 : 33188);
  return {
    isFile: () => isFile,
    isDirectory: () => isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    dev: 0,
    ino: 0,
    mode,
    nlink: 1,
    uid: 0,
    gid: 0,
    rdev: 0,
    size,
    blksize: 4096,
    blocks: Math.ceil(size / 512),
    atimeMs: mtimeMs,
    mtimeMs,
    ctimeMs: mtimeMs,
    birthtimeMs: mtimeMs,
    atime: new Date(mtimeMs),
    mtime: new Date(mtimeMs),
    ctime: new Date(mtimeMs),
    birthtime: new Date(mtimeMs)
  };
}
function createDirent(name, isDir) {
  return {
    name,
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false
  };
}
function generateId() {
  return Math.random().toString(36).substring(2, 15);
}
function encodeData(data, _encoding) {
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new TextEncoder().encode(String(data ?? ""));
}
function decodeData(data, encoding) {
  if (encoding === "utf8" || encoding === "utf-8") {
    return new TextDecoder().decode(data);
  }
  return data;
}
var OPFSFileSystem = class _OPFSFileSystem {
  worker = null;
  pending = /* @__PURE__ */ new Map();
  initialized = false;
  initPromise = null;
  // File descriptor table for openSync/readSync/writeSync/closeSync
  fdTable = /* @__PURE__ */ new Map();
  nextFd = 3;
  // Start at 3 (0=stdin, 1=stdout, 2=stderr)
  // Stat cache - reduces FS traffic by 30-50% for git operations
  statCache = /* @__PURE__ */ new Map();
  constructor() {
    this.initWorker();
  }
  // Invalidate stat cache for a path (and parent for directory operations)
  invalidateStat(filePath) {
    const absPath = normalize(resolve(filePath));
    this.statCache.delete(absPath);
    const parent = dirname(absPath);
    if (parent !== absPath) {
      this.statCache.delete(parent);
    }
  }
  // Invalidate all stats under a directory (for recursive operations)
  invalidateStatsUnder(dirPath) {
    const prefix = normalize(resolve(dirPath));
    for (const key of this.statCache.keys()) {
      if (key === prefix || key.startsWith(prefix + "/")) {
        this.statCache.delete(key);
      }
    }
  }
  async initWorker() {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const blob = new Blob([KERNEL_SOURCE], { type: "application/javascript" });
      this.worker = new Worker(URL.createObjectURL(blob));
      const readyPromise = new Promise((resolve2) => {
        this.worker.onmessage = (event) => {
          const { id, result, error, code, type: msgType } = event.data;
          if (msgType === "ready") {
            resolve2();
            return;
          }
          const pending = this.pending.get(id);
          if (pending) {
            this.pending.delete(id);
            if (error) {
              const errCode = code || "Error";
              if (errCode === "NotFoundError" || errCode === "NotAllowedError" || errCode === "TypeMismatchError" || errCode === "InvalidModificationError" || errCode === "QuotaExceededError") {
                pending.reject(mapErrorCode(errCode, pending.type, pending.path));
              } else {
                pending.reject(new FSError(errCode, -1, `${error}: ${pending.type} '${pending.path}'`));
              }
            } else if (result) {
              pending.resolve(result);
            }
          }
        };
      });
      await readyPromise;
      this.initialized = true;
    })();
    return this.initPromise;
  }
  // Async call to worker - uses fast createSyncAccessHandle internally
  async asyncCall(type, filePath, payload) {
    await this.initWorker();
    if (!this.worker) {
      throw new Error("Worker not initialized");
    }
    const absPath = resolve(filePath);
    const id = generateId();
    return new Promise((resolve2, reject) => {
      this.pending.set(id, { resolve: resolve2, reject, path: absPath, type });
      const msg = {
        id,
        type,
        path: absPath,
        payload
      };
      if (payload?.data instanceof Uint8Array) {
        const clone = new Uint8Array(payload.data);
        const newPayload = { ...payload, data: clone };
        this.worker.postMessage({ ...msg, payload: newPayload }, [clone.buffer]);
      } else {
        this.worker.postMessage(msg);
      }
    });
  }
  // Kernel worker for Tier 1 sync operations (loaded from URL, not blob)
  syncKernel = null;
  syncKernelReady = false;
  /**
   * Initialize sync operations with a kernel worker loaded from URL.
   * Required for Tier 1 (SharedArrayBuffer + Atomics) to work in nested Workers.
   * @param kernelUrl URL to the kernel.js file (defaults to '/kernel.js')
   */
  async initSync(kernelUrl = "/kernel.js") {
    if (this.syncKernelReady) return;
    this.syncKernel = new Worker(kernelUrl, { type: "module" });
    await new Promise((resolve2, reject) => {
      const timeout = setTimeout(() => reject(new Error("Kernel init timeout")), 1e4);
      this.syncKernel.onmessage = (e) => {
        if (e.data?.type === "ready") {
          clearTimeout(timeout);
          this.syncKernelReady = true;
          resolve2();
        }
      };
      this.syncKernel.onerror = (e) => {
        clearTimeout(timeout);
        reject(new Error(`Kernel error: ${e.message}`));
      };
    });
  }
  // Tier 1: SharedArrayBuffer + Atomics via kernel worker
  // Data is transferred via SharedArrayBuffer (zero-copy)
  // Synchronization via Atomics.wait/notify
  // Buffer sizes for Tier 1 communication
  static META_SIZE = 1024 * 64;
  // 64KB for metadata/results
  static DEFAULT_DATA_SIZE = 1024 * 1024 * 10;
  // 10MB default buffer
  static MAX_CHUNK_SIZE = 1024 * 1024 * 10;
  // 10MB max per chunk
  // Reusable SharedArrayBuffer pool to prevent memory leaks
  // SharedArrayBuffers are expensive to allocate and don't get GC'd quickly
  syncBufferPool = null;
  getSyncBuffers(requiredDataSize) {
    if (this.syncBufferPool && this.syncBufferPool.dataSize >= requiredDataSize) {
      return {
        ctrlBuffer: this.syncBufferPool.ctrl,
        ctrl: new Int32Array(this.syncBufferPool.ctrl),
        metaBuffer: this.syncBufferPool.meta,
        dataBuffer: this.syncBufferPool.data
      };
    }
    const dataSize = Math.max(
      _OPFSFileSystem.DEFAULT_DATA_SIZE,
      Math.min(requiredDataSize + 1024, 1024 * 1024 * 64)
      // Up to 64MB
    );
    const ctrlBuffer = new SharedArrayBuffer(4);
    const metaBuffer = new SharedArrayBuffer(_OPFSFileSystem.META_SIZE);
    const dataBuffer = new SharedArrayBuffer(dataSize);
    this.syncBufferPool = {
      ctrl: ctrlBuffer,
      meta: metaBuffer,
      data: dataBuffer,
      dataSize
    };
    return {
      ctrlBuffer,
      ctrl: new Int32Array(ctrlBuffer),
      metaBuffer,
      dataBuffer
    };
  }
  syncCallTier1(type, filePath, payload) {
    if (!this.syncKernel || !this.syncKernelReady) {
      throw new Error("Sync kernel not initialized. Call initSync() first.");
    }
    const absPath = normalize(resolve(filePath));
    const data = payload?.data instanceof Uint8Array ? payload.data : null;
    const dataSize = data?.length ?? 0;
    if (type === "write" && data && dataSize > _OPFSFileSystem.MAX_CHUNK_SIZE) {
      return this.syncCallTier1Chunked(absPath, data);
    }
    const { ctrlBuffer, ctrl, metaBuffer, dataBuffer } = this.getSyncBuffers(dataSize);
    Atomics.store(ctrl, 0, 0);
    let dataLength = 0;
    if (data) {
      const view = new Uint8Array(dataBuffer);
      view.set(data);
      dataLength = data.length;
    }
    this.syncKernel.postMessage({
      type,
      path: absPath,
      ctrlBuffer,
      metaBuffer,
      dataBuffer,
      dataLength,
      payload: payload ? { ...payload, data: void 0 } : void 0
    });
    const waitResult = Atomics.wait(ctrl, 0, 0, 3e4);
    if (waitResult === "timed-out") {
      throw new Error("Operation timed out");
    }
    const status = Atomics.load(ctrl, 0);
    if (status === -1) {
      const metaView = new Uint8Array(metaBuffer);
      let end = metaView.indexOf(0);
      if (end === -1) end = _OPFSFileSystem.META_SIZE;
      const errorMsg = new TextDecoder().decode(metaView.slice(0, end));
      throw mapErrorCode(errorMsg || "Error", type, absPath);
    }
    if (status === -2) {
      throw createENOENT(type, absPath);
    }
    if (type === "read") {
      const bytesRead = status;
      const bufferSize = dataBuffer.byteLength;
      if (bytesRead === bufferSize) {
        const stat = this.syncStatTier1(absPath);
        if (stat && stat.size > bytesRead) {
          return this.syncCallTier1ChunkedRead(absPath, stat.size);
        }
      }
      const dataView = new Uint8Array(dataBuffer);
      return { data: dataView.slice(0, bytesRead) };
    }
    if (type === "stat") {
      const view = new DataView(metaBuffer);
      const typeVal = view.getUint8(0);
      return {
        type: typeVal === 0 ? "file" : "directory",
        mode: view.getUint32(4, true),
        size: view.getFloat64(8, true),
        mtimeMs: view.getFloat64(16, true)
      };
    }
    if (type === "readdir") {
      const view = new DataView(metaBuffer);
      const bytes = new Uint8Array(metaBuffer);
      const count = view.getUint32(0, true);
      const entries = [];
      let offset = 4;
      for (let i = 0; i < count; i++) {
        const len = view.getUint16(offset, true);
        offset += 2;
        const name = new TextDecoder().decode(bytes.slice(offset, offset + len));
        entries.push(name);
        offset += len;
      }
      return { entries };
    }
    if (type === "exists") {
      return { exists: status === 1 };
    }
    return { success: status === 1 };
  }
  // Mutex for async operations to prevent buffer reuse race conditions
  // Multiple concurrent Atomics.waitAsync calls would share the same buffer pool,
  // causing data corruption when operations complete out of order
  asyncOperationPromise = Promise.resolve();
  // Async version of syncCallTier1 using Atomics.waitAsync (works on main thread)
  // This allows the main thread to use the fast SharedArrayBuffer path without blocking
  // IMPORTANT: Operations are serialized to prevent buffer reuse race conditions
  async syncCallTier1Async(type, filePath, payload) {
    const previousOp = this.asyncOperationPromise;
    let resolveCurrentOp;
    this.asyncOperationPromise = new Promise((resolve2) => {
      resolveCurrentOp = resolve2;
    });
    try {
      await previousOp;
      return await this.syncCallTier1AsyncImpl(type, filePath, payload);
    } finally {
      resolveCurrentOp();
    }
  }
  // Implementation of async Tier 1 call (called after serialization)
  async syncCallTier1AsyncImpl(type, filePath, payload) {
    if (!this.syncKernel || !this.syncKernelReady) {
      throw new Error("Sync kernel not initialized. Call initSync() first.");
    }
    const absPath = normalize(resolve(filePath));
    const data = payload?.data instanceof Uint8Array ? payload.data : null;
    const dataSize = data?.length ?? 0;
    if (type === "write" && data && dataSize > _OPFSFileSystem.MAX_CHUNK_SIZE) {
      return this.syncCallTier1ChunkedAsync(absPath, data);
    }
    const { ctrlBuffer, ctrl, metaBuffer, dataBuffer } = this.getSyncBuffers(dataSize);
    Atomics.store(ctrl, 0, 0);
    let dataLength = 0;
    if (data) {
      const view = new Uint8Array(dataBuffer);
      view.set(data);
      dataLength = data.length;
    }
    this.syncKernel.postMessage({
      type,
      path: absPath,
      ctrlBuffer,
      metaBuffer,
      dataBuffer,
      dataLength,
      payload: payload ? { ...payload, data: void 0 } : void 0
    });
    const waitResult = await Atomics.waitAsync(ctrl, 0, 0, 3e4).value;
    if (waitResult === "timed-out") {
      throw new Error("Operation timed out");
    }
    const status = Atomics.load(ctrl, 0);
    if (status === -1) {
      const metaView = new Uint8Array(metaBuffer);
      let end = metaView.indexOf(0);
      if (end === -1) end = _OPFSFileSystem.META_SIZE;
      const errorMsg = new TextDecoder().decode(metaView.slice(0, end));
      throw mapErrorCode(errorMsg || "Error", type, absPath);
    }
    if (status === -2) {
      throw createENOENT(type, absPath);
    }
    if (type === "read") {
      const bytesRead = status;
      const bufferSize = dataBuffer.byteLength;
      if (bytesRead === bufferSize) {
        const stat = await this.syncStatTier1Async(absPath);
        if (stat && stat.size > bytesRead) {
          return this.syncCallTier1ChunkedReadAsync(absPath, stat.size);
        }
      }
      const dataView = new Uint8Array(dataBuffer);
      return { data: dataView.slice(0, bytesRead) };
    }
    if (type === "stat") {
      const view = new DataView(metaBuffer);
      const typeVal = view.getUint8(0);
      return {
        type: typeVal === 0 ? "file" : "directory",
        mode: view.getUint32(4, true),
        size: view.getFloat64(8, true),
        mtimeMs: view.getFloat64(16, true)
      };
    }
    if (type === "readdir") {
      const view = new DataView(metaBuffer);
      const bytes = new Uint8Array(metaBuffer);
      const count = view.getUint32(0, true);
      const entries = [];
      let offset = 4;
      for (let i = 0; i < count; i++) {
        const len = view.getUint16(offset, true);
        offset += 2;
        const name = new TextDecoder().decode(bytes.slice(offset, offset + len));
        entries.push(name);
        offset += len;
      }
      return { entries };
    }
    if (type === "exists") {
      return { exists: status === 1 };
    }
    return { success: status === 1 };
  }
  // Async stat helper for main thread
  // NOTE: Called from within syncCallTier1AsyncImpl, so uses impl directly to avoid deadlock
  async syncStatTier1Async(absPath) {
    try {
      const result = await this.syncCallTier1AsyncImpl("stat", absPath);
      return { size: result.size };
    } catch {
      return null;
    }
  }
  // Async chunked write for main thread
  async syncCallTier1ChunkedAsync(absPath, data) {
    const totalSize = data.length;
    let offset = 0;
    while (offset < totalSize) {
      const remaining = totalSize - offset;
      const currentChunkSize = Math.min(remaining, _OPFSFileSystem.MAX_CHUNK_SIZE);
      const chunk = data.subarray(offset, offset + currentChunkSize);
      const { ctrlBuffer, ctrl, metaBuffer, dataBuffer } = this.getSyncBuffers(currentChunkSize);
      Atomics.store(ctrl, 0, 0);
      const view = new Uint8Array(dataBuffer);
      view.set(chunk);
      const isFirstChunk = offset === 0;
      this.syncKernel.postMessage({
        type: isFirstChunk ? "write" : "append",
        path: absPath,
        ctrlBuffer,
        metaBuffer,
        dataBuffer,
        dataLength: currentChunkSize,
        payload: { flush: false }
      });
      const waitResult = await Atomics.waitAsync(ctrl, 0, 0, 3e4).value;
      if (waitResult === "timed-out") {
        throw new Error("Chunked write timed out");
      }
      const status = Atomics.load(ctrl, 0);
      if (status === -1 || status === -2) {
        throw createENOENT("write", absPath);
      }
      offset += currentChunkSize;
    }
    return { success: true };
  }
  // Async chunked read for main thread
  async syncCallTier1ChunkedReadAsync(absPath, totalSize) {
    const result = new Uint8Array(totalSize);
    let offset = 0;
    while (offset < totalSize) {
      const remaining = totalSize - offset;
      const currentChunkSize = Math.min(remaining, _OPFSFileSystem.MAX_CHUNK_SIZE);
      const { ctrlBuffer, ctrl, metaBuffer, dataBuffer } = this.getSyncBuffers(currentChunkSize);
      Atomics.store(ctrl, 0, 0);
      this.syncKernel.postMessage({
        type: "readChunk",
        path: absPath,
        ctrlBuffer,
        metaBuffer,
        dataBuffer,
        dataLength: 0,
        payload: { offset, length: currentChunkSize }
      });
      const waitResult = await Atomics.waitAsync(ctrl, 0, 0, 3e4).value;
      if (waitResult === "timed-out") {
        throw new Error("Chunked read timed out");
      }
      const status = Atomics.load(ctrl, 0);
      if (status === -1 || status === -2) {
        throw createENOENT("read", absPath);
      }
      const bytesRead = status;
      const dataView = new Uint8Array(dataBuffer);
      result.set(dataView.subarray(0, bytesRead), offset);
      offset += bytesRead;
    }
    return { data: result };
  }
  // Chunked write for files larger than MAX_CHUNK_SIZE
  syncCallTier1Chunked(absPath, data) {
    const totalSize = data.length;
    const chunkSize = _OPFSFileSystem.MAX_CHUNK_SIZE;
    const { ctrlBuffer, ctrl, metaBuffer, dataBuffer } = this.getSyncBuffers(chunkSize);
    const dataView = new Uint8Array(dataBuffer);
    let offset = 0;
    while (offset < totalSize) {
      const remaining = totalSize - offset;
      const currentChunkSize = Math.min(chunkSize, remaining);
      const chunk = data.subarray(offset, offset + currentChunkSize);
      Atomics.store(ctrl, 0, 0);
      dataView.set(chunk);
      this.syncKernel.postMessage({
        type: "write",
        path: absPath,
        ctrlBuffer,
        metaBuffer,
        dataBuffer,
        dataLength: currentChunkSize,
        payload: { offset }
        // Kernel writes at this offset
      });
      const waitResult = Atomics.wait(ctrl, 0, 0, 6e4);
      if (waitResult === "timed-out") {
        throw new Error(`Chunked write timed out at offset ${offset}`);
      }
      const status = Atomics.load(ctrl, 0);
      if (status === -1) {
        const metaView = new Uint8Array(metaBuffer);
        let end = metaView.indexOf(0);
        if (end === -1) end = _OPFSFileSystem.META_SIZE;
        const errorMsg = new TextDecoder().decode(metaView.slice(0, end));
        throw mapErrorCode(errorMsg || "Error", "write", absPath);
      }
      if (status === -2) {
        throw createENOENT("write", absPath);
      }
      offset += currentChunkSize;
    }
    return { success: true };
  }
  // Chunked read for files larger than buffer size
  syncCallTier1ChunkedRead(absPath, totalSize) {
    const chunkSize = _OPFSFileSystem.MAX_CHUNK_SIZE;
    const result = new Uint8Array(totalSize);
    const { ctrlBuffer, ctrl, metaBuffer, dataBuffer } = this.getSyncBuffers(chunkSize);
    let offset = 0;
    while (offset < totalSize) {
      const remaining = totalSize - offset;
      const currentChunkSize = Math.min(chunkSize, remaining);
      Atomics.store(ctrl, 0, 0);
      this.syncKernel.postMessage({
        type: "read",
        path: absPath,
        ctrlBuffer,
        metaBuffer,
        dataBuffer,
        dataLength: 0,
        payload: { offset, len: currentChunkSize }
      });
      const waitResult = Atomics.wait(ctrl, 0, 0, 6e4);
      if (waitResult === "timed-out") {
        throw new Error(`Chunked read timed out at offset ${offset}`);
      }
      const status = Atomics.load(ctrl, 0);
      if (status === -1) {
        const metaView = new Uint8Array(metaBuffer);
        let end = metaView.indexOf(0);
        if (end === -1) end = _OPFSFileSystem.META_SIZE;
        const errorMsg = new TextDecoder().decode(metaView.slice(0, end));
        throw mapErrorCode(errorMsg || "Error", "read", absPath);
      }
      if (status === -2) {
        throw createENOENT("read", absPath);
      }
      const bytesRead = status;
      const dataView = new Uint8Array(dataBuffer, 0, bytesRead);
      result.set(dataView, offset);
      offset += bytesRead;
      if (bytesRead < currentChunkSize) {
        break;
      }
    }
    return { data: result.subarray(0, offset) };
  }
  // Get file size via stat (used for chunked reads)
  syncStatTier1(absPath) {
    const { ctrlBuffer, ctrl, metaBuffer, dataBuffer } = this.getSyncBuffers(1024);
    Atomics.store(ctrl, 0, 0);
    this.syncKernel.postMessage({
      type: "stat",
      path: absPath,
      ctrlBuffer,
      metaBuffer,
      dataBuffer,
      dataLength: 0
    });
    const waitResult = Atomics.wait(ctrl, 0, 0, 1e4);
    if (waitResult === "timed-out") {
      return null;
    }
    const status = Atomics.load(ctrl, 0);
    if (status <= 0) {
      return null;
    }
    const view = new DataView(metaBuffer);
    return { size: view.getFloat64(8, true) };
  }
  syncCall(type, filePath, payload) {
    if (isWorkerContext && typeof SharedArrayBuffer !== "undefined" && this.syncKernelReady) {
      return this.syncCallTier1(type, filePath, payload);
    }
    throw new Error(
      `Sync operations require crossOriginIsolated environment (COOP/COEP headers) and initSync() to be called. Current state: crossOriginIsolated=${typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : "N/A"}, isWorkerContext=${isWorkerContext}, syncKernelReady=${this.syncKernelReady}. Use fs.promises.* for async operations that work everywhere.`
    );
  }
  // --- Synchronous API (Node.js fs compatible) ---
  readFileSync(filePath, options) {
    const encoding = typeof options === "string" ? options : options?.encoding;
    const result = this.syncCall("read", filePath);
    if (!result.data) throw createENOENT("read", filePath);
    return decodeData(result.data, encoding);
  }
  writeFileSync(filePath, data, options) {
    const opts = typeof options === "string" ? { encoding: options } : options;
    const encoded = encodeData(data, opts?.encoding);
    this.syncCall("write", filePath, { data: encoded, flush: opts?.flush });
    this.invalidateStat(filePath);
  }
  appendFileSync(filePath, data, options) {
    typeof options === "string" ? options : options?.encoding;
    const encoded = encodeData(data);
    this.syncCall("append", filePath, { data: encoded });
    this.invalidateStat(filePath);
  }
  existsSync(filePath) {
    try {
      const result = this.syncCall("exists", filePath);
      return result.exists ?? false;
    } catch {
      return false;
    }
  }
  mkdirSync(filePath, options) {
    const recursive = typeof options === "object" ? options?.recursive : false;
    this.syncCall("mkdir", filePath, { recursive });
    this.invalidateStat(filePath);
    return recursive ? filePath : void 0;
  }
  rmdirSync(filePath, options) {
    this.syncCall("rmdir", filePath, { recursive: options?.recursive });
    if (options?.recursive) {
      this.invalidateStatsUnder(filePath);
    } else {
      this.invalidateStat(filePath);
    }
  }
  rmSync(filePath, options) {
    try {
      const result = this.syncCall("stat", filePath);
      try {
        if (result.isDirectory || result.type === "directory") {
          this.syncCall("rmdir", filePath, { recursive: options?.recursive });
          if (options?.recursive) {
            this.invalidateStatsUnder(filePath);
          } else {
            this.invalidateStat(filePath);
          }
        } else {
          this.syncCall("unlink", filePath);
          this.invalidateStat(filePath);
        }
      } catch (e) {
        if (!options?.force) throw e;
      }
    } catch (e) {
      if (!options?.force) throw e;
    }
  }
  unlinkSync(filePath) {
    this.syncCall("unlink", filePath);
    this.invalidateStat(filePath);
  }
  readdirSync(filePath, options) {
    const result = this.syncCall("readdir", filePath);
    const entries = result.entries || [];
    const opts = typeof options === "object" ? options : { };
    if (opts?.withFileTypes) {
      return entries.map((name) => {
        try {
          const stat = this.syncCall("stat", join(filePath, name));
          const isDir = stat.type === "directory" || stat.isDirectory === true;
          return createDirent(name, isDir);
        } catch {
          return createDirent(name, false);
        }
      });
    }
    return entries;
  }
  statSync(filePath) {
    const absPath = normalize(resolve(filePath));
    const cached = this.statCache.get(absPath);
    if (cached) return cached;
    const result = this.syncCall("stat", filePath);
    if (result.type === void 0 && result.isFile === void 0 && result.isDirectory === void 0) {
      throw createENOENT("stat", filePath);
    }
    const stats = createStats(result);
    this.statCache.set(absPath, stats);
    return stats;
  }
  lstatSync(filePath) {
    const stats = this.statSync(filePath);
    if (stats.isFile() && this.isSymlinkSync(filePath)) {
      return this.createSymlinkStats(stats);
    }
    return stats;
  }
  /**
   * Create stats object for a symlink file.
   */
  createSymlinkStats(baseStats) {
    return {
      ...baseStats,
      isFile: () => false,
      isSymbolicLink: () => true,
      // Symlink mode: 0o120777 (41471 decimal)
      mode: 41471
    };
  }
  renameSync(oldPath, newPath) {
    this.syncCall("rename", oldPath, { newPath });
    this.invalidateStat(oldPath);
    this.invalidateStat(newPath);
  }
  copyFileSync(src, dest) {
    this.syncCall("copy", src, { newPath: dest });
    this.invalidateStat(dest);
  }
  truncateSync(filePath, len = 0) {
    this.syncCall("truncate", filePath, { len });
    this.invalidateStat(filePath);
  }
  /**
   * Flush all pending writes to storage.
   * Use this after writes with { flush: false } to ensure data is persisted.
   */
  flushSync() {
    this.syncCall("flush", "/");
  }
  /**
   * Alias for flushSync() - matches Node.js fdatasync behavior
   */
  fdatasyncSync() {
    this.flushSync();
  }
  /**
   * Purge all kernel caches (sync handles, directory handles).
   * Use between major operations to ensure clean state.
   */
  purgeSync() {
    this.syncCall("purge", "/");
    this.statCache.clear();
  }
  accessSync(filePath, _mode) {
    const exists = this.existsSync(filePath);
    if (!exists) {
      throw createENOENT("access", filePath);
    }
  }
  // --- Low-level File Descriptor API ---
  // For efficient packfile access (read specific offsets without loading entire file)
  openSync(filePath, flags = "r") {
    const flagNum = typeof flags === "string" ? this.parseFlags(flags) : flags;
    const isReadOnly = (flagNum & constants.O_WRONLY) === 0 && (flagNum & constants.O_RDWR) === 0;
    if (isReadOnly && !this.existsSync(filePath)) {
      throw createENOENT("open", filePath);
    }
    const fd = this.nextFd++;
    this.fdTable.set(fd, {
      path: normalize(resolve(filePath)),
      flags: flagNum,
      position: 0
    });
    return fd;
  }
  closeSync(fd) {
    if (!this.fdTable.has(fd)) {
      throw new FSError("EBADF", -9, `bad file descriptor: ${fd}`);
    }
    this.fdTable.delete(fd);
  }
  readSync(fd, buffer, offset, length, position) {
    const entry = this.fdTable.get(fd);
    if (!entry) {
      throw new FSError("EBADF", -9, `bad file descriptor: ${fd}`);
    }
    const readPos = position !== null ? position : entry.position;
    const result = this.syncCall("read", entry.path, { offset: readPos, len: length });
    if (!result.data) {
      return 0;
    }
    const bytesRead = Math.min(result.data.length, length);
    buffer.set(result.data.subarray(0, bytesRead), offset);
    if (position === null) {
      entry.position += bytesRead;
    }
    return bytesRead;
  }
  writeSync(fd, buffer, offset, length, position) {
    const entry = this.fdTable.get(fd);
    if (!entry) {
      throw new FSError("EBADF", -9, `bad file descriptor: ${fd}`);
    }
    const writePos = position !== null ? position : entry.position;
    const data = buffer.subarray(offset, offset + length);
    this.syncCall("write", entry.path, {
      data,
      offset: writePos,
      truncate: false
    });
    this.invalidateStat(entry.path);
    if (position === null) {
      entry.position += length;
    }
    return length;
  }
  fstatSync(fd) {
    const entry = this.fdTable.get(fd);
    if (!entry) {
      throw new FSError("EBADF", -9, `bad file descriptor: ${fd}`);
    }
    return this.statSync(entry.path);
  }
  ftruncateSync(fd, len = 0) {
    const entry = this.fdTable.get(fd);
    if (!entry) {
      throw new FSError("EBADF", -9, `bad file descriptor: ${fd}`);
    }
    this.truncateSync(entry.path, len);
  }
  /**
   * Resolve a path to an absolute path.
   * OPFS doesn't support symlinks, so this just normalizes the path.
   */
  realpathSync(filePath) {
    this.accessSync(filePath);
    return normalize(resolve(filePath));
  }
  /**
   * Change file mode (no-op in OPFS - permissions not supported).
   */
  chmodSync(_filePath, _mode) {
  }
  /**
   * Change file owner (no-op in OPFS - ownership not supported).
   */
  chownSync(_filePath, _uid, _gid) {
  }
  /**
   * Change file timestamps (no-op in OPFS - timestamps are read-only).
   */
  utimesSync(_filePath, _atime, _mtime) {
  }
  // Magic prefix for symlink files - must be unique enough to not appear in regular files
  static SYMLINK_MAGIC = "OPFS_SYMLINK_V1:";
  /**
   * Create a symbolic link.
   * Emulated by storing target path in a special file format.
   */
  symlinkSync(target, filePath, _type) {
    const content = _OPFSFileSystem.SYMLINK_MAGIC + target;
    this.writeFileSync(filePath, content);
  }
  /**
   * Read a symbolic link target.
   */
  readlinkSync(filePath) {
    const content = this.readFileSync(filePath, { encoding: "utf8" });
    if (!content.startsWith(_OPFSFileSystem.SYMLINK_MAGIC)) {
      throw new FSError("EINVAL", -22, `EINVAL: invalid argument, readlink '${filePath}'`, "readlink", filePath);
    }
    return content.slice(_OPFSFileSystem.SYMLINK_MAGIC.length);
  }
  /**
   * Check if a file is a symlink (sync).
   */
  isSymlinkSync(filePath) {
    try {
      const content = this.readFileSync(filePath, { encoding: "utf8" });
      return content.startsWith(_OPFSFileSystem.SYMLINK_MAGIC);
    } catch {
      return false;
    }
  }
  /**
   * Check if a file is a symlink (async).
   */
  async isSymlinkAsync(filePath) {
    try {
      const content = await this.promises.readFile(filePath, { encoding: "utf8" });
      return content.startsWith(_OPFSFileSystem.SYMLINK_MAGIC);
    } catch {
      return false;
    }
  }
  /**
   * Create a hard link.
   * Emulated by copying the file (true hard links not supported in OPFS).
   */
  linkSync(existingPath, newPath) {
    this.copyFileSync(existingPath, newPath);
  }
  parseFlags(flags) {
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
      default:
        return constants.O_RDONLY;
    }
  }
  // --- Async Promises API ---
  // When Tier 1 sync kernel is available, use it for better performance (wrapped in Promise)
  // Otherwise fall back to async worker
  // Helper: Use sync kernel if available (in worker context), otherwise async worker
  async fastCall(type, filePath, payload) {
    if (this.syncKernelReady) {
      if (isWorkerContext) {
        return Promise.resolve(this.syncCallTier1(type, filePath, payload));
      } else {
        return this.syncCallTier1Async(type, filePath, payload);
      }
    }
    return this.asyncCall(type, filePath, payload);
  }
  promises = {
    readFile: async (filePath, options) => {
      if (!filePath) {
        throw createENOENT("read", filePath || "");
      }
      const encoding = typeof options === "string" ? options : options?.encoding;
      if (this.syncKernelReady) {
        if (isWorkerContext) {
          const result2 = this.syncCallTier1("read", filePath);
          if (!result2.data) throw createENOENT("read", filePath);
          return decodeData(result2.data, encoding);
        } else {
          const result2 = await this.syncCallTier1Async("read", filePath);
          if (!result2.data) throw createENOENT("read", filePath);
          return decodeData(result2.data, encoding);
        }
      }
      const result = await this.asyncCall("read", filePath);
      if (!result.data) throw createENOENT("read", filePath);
      return decodeData(result.data, encoding);
    },
    writeFile: async (filePath, data, options) => {
      const opts = typeof options === "string" ? { encoding: options } : options;
      const encoded = encodeData(data, opts?.encoding);
      await this.fastCall("write", filePath, { data: encoded, flush: opts?.flush });
      this.invalidateStat(filePath);
    },
    appendFile: async (filePath, data, options) => {
      const opts = typeof options === "string" ? { encoding: options } : options;
      const encoded = encodeData(data, opts?.encoding);
      await this.fastCall("append", filePath, { data: encoded, flush: opts?.flush });
      this.invalidateStat(filePath);
    },
    mkdir: async (filePath, options) => {
      const recursive = typeof options === "object" ? options?.recursive : false;
      await this.fastCall("mkdir", filePath, { recursive });
      return recursive ? filePath : void 0;
    },
    rmdir: async (filePath, options) => {
      await this.fastCall("rmdir", filePath, { recursive: options?.recursive });
    },
    rm: async (filePath, options) => {
      try {
        const result = await this.fastCall("stat", filePath);
        try {
          if (result.isDirectory || result.type === "directory") {
            await this.fastCall("rmdir", filePath, { recursive: options?.recursive });
            if (options?.recursive) {
              this.invalidateStatsUnder(filePath);
            } else {
              this.invalidateStat(filePath);
            }
          } else {
            await this.fastCall("unlink", filePath);
            this.invalidateStat(filePath);
          }
        } catch (e) {
          if (!options?.force) throw e;
        }
      } catch (e) {
        if (!options?.force) throw e;
      }
    },
    unlink: async (filePath) => {
      await this.fastCall("unlink", filePath);
    },
    readdir: async (filePath, options) => {
      const result = await this.fastCall("readdir", filePath);
      const entries = result.entries || [];
      const opts = typeof options === "object" ? options : { };
      if (opts?.withFileTypes) {
        const dirents = [];
        for (const name of entries) {
          try {
            const stat = await this.fastCall("stat", join(filePath, name));
            const isDir = stat.type === "directory" || stat.isDirectory === true;
            dirents.push(createDirent(name, isDir));
          } catch {
            dirents.push(createDirent(name, false));
          }
        }
        return dirents;
      }
      return entries;
    },
    stat: async (filePath) => {
      const result = await this.fastCall("stat", filePath);
      return createStats(result);
    },
    access: async (filePath, _mode) => {
      const result = await this.fastCall("exists", filePath);
      if (!result.exists) {
        throw createENOENT("access", filePath);
      }
    },
    rename: async (oldFilePath, newFilePath) => {
      await this.fastCall("rename", oldFilePath, { newPath: resolve(newFilePath) });
    },
    copyFile: async (srcPath, destPath) => {
      await this.fastCall("copy", srcPath, { newPath: resolve(destPath) });
    },
    truncate: async (filePath, len = 0) => {
      await this.fastCall("truncate", filePath, { len });
      this.invalidateStat(filePath);
    },
    lstat: async (filePath) => {
      const result = await this.fastCall("stat", filePath);
      const stats = createStats(result);
      if (stats.isFile()) {
        const isSymlink = await this.isSymlinkAsync(filePath);
        if (isSymlink) {
          return this.createSymlinkStats(stats);
        }
      }
      return stats;
    },
    realpath: async (filePath) => {
      await this.promises.access(filePath);
      return normalize(resolve(filePath));
    },
    exists: async (filePath) => {
      try {
        const result = await this.fastCall("exists", filePath);
        return result.exists ?? false;
      } catch {
        return false;
      }
    },
    chmod: async (_filePath, _mode) => {
    },
    chown: async (_filePath, _uid, _gid) => {
    },
    utimes: async (_filePath, _atime, _mtime) => {
    },
    symlink: async (target, filePath, _type) => {
      const content = _OPFSFileSystem.SYMLINK_MAGIC + target;
      await this.promises.writeFile(filePath, content);
    },
    readlink: async (filePath) => {
      const content = await this.promises.readFile(filePath, { encoding: "utf8" });
      if (!content.startsWith(_OPFSFileSystem.SYMLINK_MAGIC)) {
        throw new FSError("EINVAL", -22, `EINVAL: invalid argument, readlink '${filePath}'`, "readlink", filePath);
      }
      return content.slice(_OPFSFileSystem.SYMLINK_MAGIC.length);
    },
    link: async (existingPath, newPath) => {
      await this.promises.copyFile(existingPath, newPath);
    },
    open: async (filePath, flags = "r", _mode) => {
      const flagNum = typeof flags === "string" ? this.parseFlags(flags) : flags;
      const isReadOnly = (flagNum & constants.O_WRONLY) === 0 && (flagNum & constants.O_RDWR) === 0;
      if (isReadOnly) {
        const exists = await this.promises.exists(filePath);
        if (!exists) {
          throw createENOENT("open", filePath);
        }
      }
      const fd = this.nextFd++;
      this.fdTable.set(fd, {
        path: normalize(resolve(filePath)),
        flags: flagNum,
        position: 0
      });
      return this.createFileHandle(fd, filePath);
    },
    opendir: async (dirPath) => {
      return this.createDir(dirPath);
    },
    mkdtemp: async (prefix) => {
      const suffix = Math.random().toString(36).substring(2, 8);
      const tmpDir = `${prefix}${suffix}`;
      await this.promises.mkdir(tmpDir, { recursive: true });
      return tmpDir;
    },
    watch: (filePath, options) => {
      return this.createAsyncWatcher(filePath, options);
    },
    /**
     * Flush all pending writes to storage.
     * Use after writes with { flush: false } to ensure data is persisted.
     */
    flush: async () => {
      await this.fastCall("flush", "/");
    },
    /**
     * Purge all kernel caches.
     * Use between major operations to ensure clean state.
     */
    purge: async () => {
      await this.fastCall("purge", "/");
      this.statCache.clear();
    }
  };
  /**
   * Async flush - use after promises.writeFile with { flush: false }
   */
  async flush() {
    await this.fastCall("flush", "/");
  }
  /**
   * Async purge - clears all kernel caches
   */
  async purge() {
    await this.fastCall("purge", "/");
    this.statCache.clear();
  }
  // Constants
  constants = constants;
  // --- FileHandle Implementation ---
  createFileHandle(fd, filePath) {
    const self2 = this;
    const absPath = normalize(resolve(filePath));
    return {
      fd,
      async read(buffer, offset = 0, length, position = null) {
        const len = length ?? buffer.length - offset;
        const entry = self2.fdTable.get(fd);
        if (!entry) throw new FSError("EBADF", -9, `bad file descriptor: ${fd}`);
        const readPos = position !== null ? position : entry.position;
        const result = await self2.fastCall("read", absPath, { offset: readPos, len });
        if (!result.data) {
          return { bytesRead: 0, buffer };
        }
        const bytesRead = Math.min(result.data.length, len);
        buffer.set(result.data.subarray(0, bytesRead), offset);
        if (position === null) {
          entry.position += bytesRead;
        }
        return { bytesRead, buffer };
      },
      async write(buffer, offset = 0, length, position = null) {
        const len = length ?? buffer.length - offset;
        const entry = self2.fdTable.get(fd);
        if (!entry) throw new FSError("EBADF", -9, `bad file descriptor: ${fd}`);
        const writePos = position !== null ? position : entry.position;
        const data = buffer.subarray(offset, offset + len);
        await self2.fastCall("write", absPath, { data, offset: writePos, truncate: false });
        self2.invalidateStat(absPath);
        if (position === null) {
          entry.position += len;
        }
        return { bytesWritten: len, buffer };
      },
      async readFile(options) {
        return self2.promises.readFile(absPath, options);
      },
      async writeFile(data, options) {
        return self2.promises.writeFile(absPath, data, options);
      },
      async truncate(len = 0) {
        await self2.fastCall("truncate", absPath, { len });
        self2.invalidateStat(absPath);
      },
      async stat() {
        return self2.promises.stat(absPath);
      },
      async sync() {
        await self2.fastCall("flush", "/");
      },
      async datasync() {
        await self2.fastCall("flush", "/");
      },
      async close() {
        self2.fdTable.delete(fd);
      }
    };
  }
  // --- Dir Implementation ---
  createDir(dirPath) {
    const self2 = this;
    const absPath = normalize(resolve(dirPath));
    let entries = null;
    let index = 0;
    let closed = false;
    const loadEntries = async () => {
      if (entries === null) {
        const result = await self2.fastCall("readdir", absPath);
        entries = result.entries || [];
      }
    };
    const dir = {
      path: absPath,
      async read() {
        if (closed) throw new FSError("EBADF", -9, "Directory handle was closed");
        await loadEntries();
        if (index >= entries.length) return null;
        const name = entries[index++];
        try {
          const stat = await self2.fastCall("stat", join(absPath, name));
          const isDir = stat.type === "directory" || stat.isDirectory === true;
          return createDirent(name, isDir);
        } catch {
          return createDirent(name, false);
        }
      },
      async close() {
        closed = true;
        entries = null;
      },
      [Symbol.asyncIterator]() {
        const iterator = {
          next: async () => {
            const dirent = await dir.read();
            if (dirent === null) {
              return { done: true, value: void 0 };
            }
            return { done: false, value: dirent };
          },
          [Symbol.asyncIterator]() {
            return this;
          }
        };
        return iterator;
      }
    };
    return dir;
  }
  // --- Watch Implementation (Native FileSystemObserver with polling fallback) ---
  watchedFiles = /* @__PURE__ */ new Map();
  // Check if native FileSystemObserver is available
  static hasNativeObserver = typeof globalThis.FileSystemObserver !== "undefined";
  // Get OPFS directory handle for a path
  async getDirectoryHandle(dirPath, create = false) {
    const parts = dirPath.split("/").filter(Boolean);
    let current = await navigator.storage.getDirectory();
    for (const part of parts) {
      current = await current.getDirectoryHandle(part, { create });
    }
    return current;
  }
  // Get OPFS file handle for a path
  async getFileHandle(filePath, create = false) {
    const parts = filePath.split("/").filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) throw new Error("Invalid file path");
    let current = await navigator.storage.getDirectory();
    for (const part of parts) {
      current = await current.getDirectoryHandle(part, { create });
    }
    return current.getFileHandle(fileName, { create });
  }
  // Convert FileSystemObserver change type to Node.js event type
  mapChangeType(type) {
    switch (type) {
      case "appeared":
      case "disappeared":
      case "moved":
        return "rename";
      case "modified":
        return "change";
      default:
        return "change";
    }
  }
  createAsyncWatcher(filePath, options) {
    const absPath = normalize(resolve(filePath));
    if (_OPFSFileSystem.hasNativeObserver) {
      return this.createNativeAsyncWatcher(absPath, options);
    }
    return this.createPollingAsyncWatcher(absPath, options);
  }
  createNativeAsyncWatcher(absPath, options) {
    const self2 = this;
    return {
      [Symbol.asyncIterator]() {
        const eventQueue = [];
        let resolveNext = null;
        let observer = null;
        let aborted = false;
        let initialized = false;
        if (options?.signal) {
          options.signal.addEventListener("abort", () => {
            aborted = true;
            observer?.disconnect();
            if (resolveNext) {
              resolveNext({ done: true, value: void 0 });
              resolveNext = null;
            }
          });
        }
        const callback = (records) => {
          for (const record of records) {
            if (record.type === "errored" || record.type === "unknown") continue;
            const filename = record.relativePathComponents.length > 0 ? record.relativePathComponents[record.relativePathComponents.length - 1] : basename(absPath);
            const event = {
              eventType: self2.mapChangeType(record.type),
              filename
            };
            if (resolveNext) {
              resolveNext({ done: false, value: event });
              resolveNext = null;
            } else {
              eventQueue.push(event);
            }
          }
        };
        const init = async () => {
          if (initialized) return;
          initialized = true;
          try {
            observer = new globalThis.FileSystemObserver(callback);
            const stat = await self2.promises.stat(absPath);
            const handle = stat.isDirectory() ? await self2.getDirectoryHandle(absPath) : await self2.getFileHandle(absPath);
            await observer.observe(handle, { recursive: options?.recursive });
          } catch (e) {
            aborted = true;
          }
        };
        const iterator = {
          async next() {
            if (aborted) {
              return { done: true, value: void 0 };
            }
            await init();
            if (aborted) {
              return { done: true, value: void 0 };
            }
            if (eventQueue.length > 0) {
              return { done: false, value: eventQueue.shift() };
            }
            return new Promise((resolve2) => {
              resolveNext = resolve2;
            });
          },
          [Symbol.asyncIterator]() {
            return this;
          }
        };
        return iterator;
      }
    };
  }
  createPollingAsyncWatcher(absPath, options) {
    const self2 = this;
    const interval = 1e3;
    return {
      [Symbol.asyncIterator]() {
        let lastMtimeMs = null;
        let lastEntries = null;
        let aborted = false;
        let pollTimeout = null;
        if (options?.signal) {
          options.signal.addEventListener("abort", () => {
            aborted = true;
            if (pollTimeout) clearTimeout(pollTimeout);
          });
        }
        const checkForChanges = async () => {
          if (aborted) return null;
          try {
            const stat = await self2.promises.stat(absPath);
            if (stat.isDirectory()) {
              const entries = await self2.promises.readdir(absPath);
              const currentEntries = new Set(entries);
              if (lastEntries === null) {
                lastEntries = currentEntries;
                return null;
              }
              for (const entry of currentEntries) {
                if (!lastEntries.has(entry)) {
                  lastEntries = currentEntries;
                  return { eventType: "rename", filename: entry };
                }
              }
              for (const entry of lastEntries) {
                if (!currentEntries.has(entry)) {
                  lastEntries = currentEntries;
                  return { eventType: "rename", filename: entry };
                }
              }
              lastEntries = currentEntries;
            } else {
              if (lastMtimeMs === null) {
                lastMtimeMs = stat.mtimeMs;
                return null;
              }
              if (stat.mtimeMs !== lastMtimeMs) {
                lastMtimeMs = stat.mtimeMs;
                return { eventType: "change", filename: basename(absPath) };
              }
            }
          } catch {
            if (lastMtimeMs !== null || lastEntries !== null) {
              lastMtimeMs = null;
              lastEntries = null;
              return { eventType: "rename", filename: basename(absPath) };
            }
          }
          return null;
        };
        const iterator = {
          async next() {
            if (aborted) {
              return { done: true, value: void 0 };
            }
            while (!aborted) {
              const event = await checkForChanges();
              if (event) {
                return { done: false, value: event };
              }
              await new Promise((resolve2) => {
                pollTimeout = setTimeout(resolve2, interval);
              });
            }
            return { done: true, value: void 0 };
          },
          [Symbol.asyncIterator]() {
            return this;
          }
        };
        return iterator;
      }
    };
  }
  /**
   * Watch a file or directory for changes.
   * Uses native FileSystemObserver when available, falls back to polling.
   */
  watch(filePath, options = {}, listener) {
    const absPath = normalize(resolve(filePath));
    const opts = typeof options === "function" ? {} : options;
    const cb = typeof options === "function" ? options : listener;
    if (_OPFSFileSystem.hasNativeObserver) {
      return this.createNativeWatcher(absPath, opts, cb);
    }
    return this.createPollingWatcher(absPath, cb);
  }
  createNativeWatcher(absPath, opts, cb) {
    const self2 = this;
    let observer = null;
    let closed = false;
    const callback = (records) => {
      if (closed) return;
      for (const record of records) {
        if (record.type === "errored" || record.type === "unknown") continue;
        const filename = record.relativePathComponents.length > 0 ? record.relativePathComponents[record.relativePathComponents.length - 1] : basename(absPath);
        cb?.(self2.mapChangeType(record.type), filename);
      }
    };
    (async () => {
      if (closed) return;
      try {
        observer = new globalThis.FileSystemObserver(callback);
        const stat = await self2.promises.stat(absPath);
        const handle = stat.isDirectory() ? await self2.getDirectoryHandle(absPath) : await self2.getFileHandle(absPath);
        await observer.observe(handle, { recursive: opts.recursive });
      } catch {
      }
    })();
    const watcher = {
      close: () => {
        closed = true;
        observer?.disconnect();
      },
      ref: () => watcher,
      unref: () => watcher
    };
    return watcher;
  }
  createPollingWatcher(absPath, cb) {
    const interval = 1e3;
    let lastMtimeMs = null;
    let lastEntries = null;
    let closed = false;
    const poll = async () => {
      if (closed) return;
      try {
        const stat = await this.promises.stat(absPath);
        if (stat.isDirectory()) {
          const entries = await this.promises.readdir(absPath);
          const currentEntries = new Set(entries);
          if (lastEntries !== null) {
            for (const entry of currentEntries) {
              if (!lastEntries.has(entry)) {
                cb?.("rename", entry);
              }
            }
            for (const entry of lastEntries) {
              if (!currentEntries.has(entry)) {
                cb?.("rename", entry);
              }
            }
          }
          lastEntries = currentEntries;
        } else {
          if (lastMtimeMs !== null && stat.mtimeMs !== lastMtimeMs) {
            cb?.("change", basename(absPath));
          }
          lastMtimeMs = stat.mtimeMs;
        }
      } catch {
        if (lastMtimeMs !== null || lastEntries !== null) {
          cb?.("rename", basename(absPath));
          lastMtimeMs = null;
          lastEntries = null;
        }
      }
    };
    const intervalId = setInterval(poll, interval);
    poll();
    const watcher = {
      close: () => {
        closed = true;
        clearInterval(intervalId);
      },
      ref: () => watcher,
      unref: () => watcher
    };
    return watcher;
  }
  /**
   * Watch a file for changes using native FileSystemObserver or stat polling.
   */
  watchFile(filePath, options = {}, listener) {
    const absPath = normalize(resolve(filePath));
    const opts = typeof options === "function" ? {} : options;
    const cb = typeof options === "function" ? options : listener;
    const interval = opts.interval ?? 5007;
    let lastStat = null;
    let observer;
    const poll = async () => {
      try {
        const stat = await this.promises.stat(absPath);
        if (lastStat !== null) {
          if (stat.mtimeMs !== lastStat.mtimeMs || stat.size !== lastStat.size) {
            cb?.(stat, lastStat);
          }
        }
        lastStat = stat;
      } catch {
        const emptyStat = createStats({ type: "file", size: 0, mtimeMs: 0, mode: 0 });
        if (lastStat !== null) {
          cb?.(emptyStat, lastStat);
        }
        lastStat = emptyStat;
      }
    };
    if (_OPFSFileSystem.hasNativeObserver && cb) {
      const self2 = this;
      const observerCallback = async () => {
        try {
          const stat = await self2.promises.stat(absPath);
          if (lastStat !== null && (stat.mtimeMs !== lastStat.mtimeMs || stat.size !== lastStat.size)) {
            cb(stat, lastStat);
          }
          lastStat = stat;
        } catch {
          const emptyStat = createStats({ type: "file", size: 0, mtimeMs: 0, mode: 0 });
          if (lastStat !== null) {
            cb(emptyStat, lastStat);
          }
          lastStat = emptyStat;
        }
      };
      (async () => {
        try {
          lastStat = await self2.promises.stat(absPath);
          observer = new globalThis.FileSystemObserver(observerCallback);
          const handle = await self2.getFileHandle(absPath);
          await observer.observe(handle);
        } catch {
          if (!this.watchedFiles.get(absPath)?.interval) {
            const entry = this.watchedFiles.get(absPath);
            if (entry) {
              entry.interval = setInterval(poll, interval);
            }
          }
        }
      })();
      if (!this.watchedFiles.has(absPath)) {
        this.watchedFiles.set(absPath, {
          observer,
          listeners: /* @__PURE__ */ new Set(),
          lastStat: null
        });
      }
      this.watchedFiles.get(absPath).listeners.add(cb);
    } else {
      if (!this.watchedFiles.has(absPath)) {
        this.watchedFiles.set(absPath, {
          interval: setInterval(poll, interval),
          listeners: /* @__PURE__ */ new Set(),
          lastStat: null
        });
      }
      if (cb) this.watchedFiles.get(absPath).listeners.add(cb);
      poll();
    }
    const watcher = {
      ref: () => watcher,
      unref: () => watcher
    };
    return watcher;
  }
  /**
   * Stop watching a file.
   */
  unwatchFile(filePath, listener) {
    const absPath = normalize(resolve(filePath));
    const entry = this.watchedFiles.get(absPath);
    if (entry) {
      if (listener) {
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0) {
          if (entry.interval) clearInterval(entry.interval);
          if (entry.observer) entry.observer.disconnect();
          this.watchedFiles.delete(absPath);
        }
      } else {
        if (entry.interval) clearInterval(entry.interval);
        if (entry.observer) entry.observer.disconnect();
        this.watchedFiles.delete(absPath);
      }
    }
  }
  // --- Stream Implementation ---
  /**
   * Create a readable stream for a file.
   */
  createReadStream(filePath, options) {
    const opts = typeof options === "string" ? { } : options ?? {};
    const absPath = normalize(resolve(filePath));
    const start = opts.start ?? 0;
    const end = opts.end;
    const highWaterMark = opts.highWaterMark ?? 64 * 1024;
    let position = start;
    let closed = false;
    const self2 = this;
    return new ReadableStream({
      async pull(controller) {
        if (closed) {
          controller.close();
          return;
        }
        try {
          const maxRead = end !== void 0 ? Math.min(highWaterMark, end - position + 1) : highWaterMark;
          if (maxRead <= 0) {
            controller.close();
            closed = true;
            return;
          }
          const result = await self2.fastCall("read", absPath, { offset: position, len: maxRead });
          if (!result.data || result.data.length === 0) {
            controller.close();
            closed = true;
            return;
          }
          controller.enqueue(result.data);
          position += result.data.length;
          if (end !== void 0 && position > end) {
            controller.close();
            closed = true;
          }
        } catch (e) {
          controller.error(e);
          closed = true;
        }
      },
      cancel() {
        closed = true;
      }
    });
  }
  /**
   * Create a writable stream for a file.
   */
  createWriteStream(filePath, options) {
    const opts = typeof options === "string" ? { } : options ?? {};
    const absPath = normalize(resolve(filePath));
    const start = opts.start ?? 0;
    const shouldFlush = opts.flush !== false;
    let position = start;
    let initialized = false;
    const self2 = this;
    return new WritableStream({
      async write(chunk) {
        if (!initialized && start === 0) {
          await self2.fastCall("write", absPath, { data: chunk, offset: 0, flush: false });
          position = chunk.length;
          initialized = true;
        } else {
          await self2.fastCall("write", absPath, { data: chunk, offset: position, truncate: false, flush: false });
          position += chunk.length;
          initialized = true;
        }
        self2.invalidateStat(absPath);
      },
      async close() {
        if (shouldFlush) {
          await self2.fastCall("flush", "/");
        }
      },
      async abort() {
      }
    });
  }
  // --- Sync methods for opendir and mkdtemp ---
  /**
   * Open a directory for iteration (sync).
   */
  opendirSync(dirPath) {
    return this.createDir(dirPath);
  }
  /**
   * Create a unique temporary directory (sync).
   */
  mkdtempSync(prefix) {
    const suffix = Math.random().toString(36).substring(2, 8);
    const tmpDir = `${prefix}${suffix}`;
    this.mkdirSync(tmpDir, { recursive: true });
    return tmpDir;
  }
};

// src/index.ts
var fs = new OPFSFileSystem();
var index_default = fs;

exports.FSError = FSError;
exports.OPFSFileSystem = OPFSFileSystem;
exports.constants = constants;
exports.createEACCES = createEACCES;
exports.createEEXIST = createEEXIST;
exports.createEINVAL = createEINVAL;
exports.createEISDIR = createEISDIR;
exports.createENOENT = createENOENT;
exports.createENOTDIR = createENOTDIR;
exports.createENOTEMPTY = createENOTEMPTY;
exports.default = index_default;
exports.fs = fs;
exports.mapErrorCode = mapErrorCode;
exports.path = path_exports;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map