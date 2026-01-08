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
    if (path.length === 0) continue;
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
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, _FSError);
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
const syncHandleCache = new Map();
const MAX_HANDLES = 100;

async function getSyncHandle(filePath, create) {
  const cached = syncHandleCache.get(filePath);
  if (cached) return cached;

  // Evict oldest handles if cache is full
  if (syncHandleCache.size >= MAX_HANDLES) {
    const keys = Array.from(syncHandleCache.keys()).slice(0, 10);
    for (const key of keys) {
      const h = syncHandleCache.get(key);
      if (h) { try { h.close(); } catch {} syncHandleCache.delete(key); }
    }
  }

  const fh = await getFileHandle(filePath, create);
  const access = await fh.createSyncAccessHandle();
  syncHandleCache.set(filePath, access);
  return access;
}

function closeSyncHandle(filePath) {
  const h = syncHandleCache.get(filePath);
  if (h) { try { h.close(); } catch {} syncHandleCache.delete(filePath); }
}

function closeHandlesUnder(prefix) {
  for (const [p, h] of syncHandleCache) {
    if (p === prefix || p.startsWith(prefix + '/')) {
      try { h.close(); } catch {}
      syncHandleCache.delete(p);
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
    access.flush();
  }
  return { success: true };
}

async function handleAppend(filePath, payload) {
  const access = await getSyncHandle(filePath, true);
  if (payload?.data) {
    const size = access.getSize();
    access.write(payload.data, { at: size });
    access.flush();
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
  closeHandlesUnder(filePath); // Close all cached handles under this directory
  const { parent, name } = await getParentAndName(filePath);
  if (payload?.recursive) {
    await parent.removeEntry(name, { recursive: true });
  } else {
    const dir = await parent.getDirectoryHandle(name);
    const entries = dir.entries();
    const first = await entries.next();
    if (!first.done) throw new Error('InvalidModificationError');
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
    const errorName = error.name || 'Error';
    if (payload?.ctrl) {
      Atomics.store(payload.ctrl, 0, -1);
      Atomics.notify(payload.ctrl, 0);
    } else {
      self.postMessage({ id, error: errorName, code: errorName });
    }
  }
}

// Process queued messages after lock is acquired
function processQueue() {
  while (messageQueue.length > 0) {
    const msg = messageQueue.shift();
    handleMessage(msg);
  }
}

// Queue messages until ready
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
  self.postMessage({ type: 'ready' });
}, 10);
`;
var cachedRoot = null;
var dirCache = /* @__PURE__ */ new Map();
async function getRoot() {
  if (!cachedRoot) {
    cachedRoot = await navigator.storage.getDirectory();
  }
  return cachedRoot;
}
function parsePath(filePath) {
  return filePath.split("/").filter(Boolean);
}
async function getDirectoryHandle(parts, create = false) {
  if (parts.length === 0) return getRoot();
  const cacheKey = parts.join("/");
  const cached = dirCache.get(cacheKey);
  if (cached) return cached;
  let curr = await getRoot();
  let pathSoFar = "";
  for (const part of parts) {
    pathSoFar += (pathSoFar ? "/" : "") + part;
    const cachedDir = dirCache.get(pathSoFar);
    if (cachedDir) {
      curr = cachedDir;
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
  if (!fileName) throw new Error("Invalid file path");
  const dir = parts.length > 0 ? await getDirectoryHandle(parts, create) : await getRoot();
  return await dir.getFileHandle(fileName, { create });
}
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
  return data;
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
              pending.reject(new FSError(code || "Error", -1, error));
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
      this.pending.set(id, { resolve: resolve2, reject });
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
        const name = new TextDecoder().decode(bytes.subarray(offset, offset + len));
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
          return createDirent(name, stat.isDirectory ?? false);
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
    return this.statSync(filePath);
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
  // Reads use direct OPFS for minimal overhead
  // Writes use Worker with createSyncAccessHandle for speed
  promises = {
    readFile: async (filePath, options) => {
      const encoding = typeof options === "string" ? options : options?.encoding;
      const absPath = resolve(filePath);
      try {
        const fh = await getFileHandle(absPath);
        const file = await fh.getFile();
        const data = new Uint8Array(await file.arrayBuffer());
        return decodeData(data, encoding);
      } catch (e) {
        throw mapErrorCode(e.name, "read", absPath);
      }
    },
    writeFile: async (filePath, data, options) => {
      typeof options === "string" ? options : options?.encoding;
      const encoded = encodeData(data);
      await this.asyncCall("write", filePath, { data: encoded });
    },
    appendFile: async (filePath, data, options) => {
      typeof options === "string" ? options : options?.encoding;
      const encoded = encodeData(data);
      await this.asyncCall("append", filePath, { data: encoded });
    },
    mkdir: async (filePath, options) => {
      const recursive = typeof options === "object" ? options?.recursive : false;
      await this.asyncCall("mkdir", filePath, { recursive });
      return recursive ? filePath : void 0;
    },
    rmdir: async (filePath, options) => {
      await this.asyncCall("rmdir", filePath, { recursive: options?.recursive });
    },
    rm: async (filePath, options) => {
      try {
        const result = await this.asyncCall("stat", filePath);
        if (result.isDirectory) {
          await this.asyncCall("rmdir", filePath, { recursive: options?.recursive });
        } else {
          await this.asyncCall("unlink", filePath);
        }
      } catch (e) {
        if (!options?.force) throw e;
      }
    },
    unlink: async (filePath) => {
      await this.asyncCall("unlink", filePath);
    },
    readdir: async (filePath, options) => {
      const result = await this.asyncCall("readdir", filePath);
      const entries = result.entries || [];
      const opts = typeof options === "object" ? options : { };
      if (opts?.withFileTypes) {
        const dirents = [];
        for (const name of entries) {
          try {
            const stat = await this.asyncCall("stat", join(filePath, name));
            dirents.push(createDirent(name, stat.isDirectory ?? false));
          } catch {
            dirents.push(createDirent(name, false));
          }
        }
        return dirents;
      }
      return entries;
    },
    stat: async (filePath) => {
      const result = await this.asyncCall("stat", filePath);
      return createStats(result);
    },
    access: async (filePath, _mode) => {
      const result = await this.asyncCall("exists", filePath);
      if (!result.exists) {
        throw createENOENT("access", filePath);
      }
    },
    rename: async (oldFilePath, newFilePath) => {
      await this.asyncCall("rename", oldFilePath, { newPath: resolve(newFilePath) });
    },
    copyFile: async (srcPath, destPath) => {
      await this.asyncCall("copy", srcPath, { newPath: resolve(destPath) });
    }
  };
  // Constants
  constants = constants;
};

// src/index.ts
var fs = new OPFSFileSystem();
var index_default = fs;

export { FSError, OPFSFileSystem, constants, createEACCES, createEEXIST, createEINVAL, createEISDIR, createENOENT, createENOTDIR, createENOTEMPTY, index_default as default, fs, mapErrorCode, path_exports as path };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map