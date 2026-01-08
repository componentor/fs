// src/constants.ts
var constants = {
  // File access modes
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
  // Copy file flags
  COPYFILE_EXCL: 1,
  COPYFILE_FICLONE: 2,
  COPYFILE_FICLONE_FORCE: 4,
  // File open flags
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  O_CREAT: 64,
  O_EXCL: 128,
  O_TRUNC: 512,
  O_APPEND: 1024,
  // File type masks
  S_IFMT: 61440,
  S_IFREG: 32768,
  S_IFDIR: 16384,
  S_IFLNK: 40960
};
function flagsToString(flags) {
  if (typeof flags === "string") return flags;
  const map = {
    [constants.O_RDONLY]: "r",
    [constants.O_WRONLY]: "w",
    [constants.O_RDWR]: "r+",
    [constants.O_CREAT | constants.O_WRONLY]: "w",
    [constants.O_CREAT | constants.O_WRONLY | constants.O_TRUNC]: "w",
    [constants.O_CREAT | constants.O_RDWR]: "w+",
    [constants.O_APPEND | constants.O_WRONLY]: "a",
    [constants.O_APPEND | constants.O_RDWR]: "a+"
  };
  return map[flags] || "r";
}

// src/errors.ts
var FSError = class extends Error {
  code;
  syscall;
  path;
  original;
  constructor(message, code, options) {
    super(message);
    this.name = "FSError";
    this.code = code;
    this.syscall = options?.syscall;
    this.path = options?.path;
    this.original = options?.original;
  }
};
function createENOENT(path) {
  return new FSError(`ENOENT: No such file or directory, '${path}'`, "ENOENT", { path });
}
function createEEXIST(path, operation) {
  const message = `EEXIST: File exists, '${path}'`;
  return new FSError(message, "EEXIST", { path });
}
function createEACCES(path, syscall) {
  return new FSError(`EACCES: permission denied, access '${path}'`, "EACCES", { syscall, path });
}
function createEISDIR(path, operation = "operation") {
  return new FSError(`EISDIR: illegal operation on a directory, ${operation} '${path}'`, "EISDIR", { path });
}
function createELOOP(path) {
  return new FSError(`ELOOP: Too many symbolic links, '${path}'`, "ELOOP", { path });
}
function createEINVAL(path) {
  return new FSError(`EINVAL: Invalid argument, '${path}'`, "EINVAL", { path });
}
function createECORRUPTED(path) {
  return new FSError(`ECORRUPTED: Pack file integrity check failed, '${path}'`, "ECORRUPTED", { path });
}
function wrapError(err) {
  if (err instanceof FSError) return err;
  const error = err;
  if (typeof error.code === "string") {
    const fsErr = new FSError(error.message, error.code);
    fsErr.original = error;
    return fsErr;
  }
  const wrapped = new FSError(error.message || "Unknown error", "UNKNOWN");
  wrapped.original = error;
  return wrapped;
}

// src/path-utils.ts
var normalizeCache = /* @__PURE__ */ new Map();
var CACHE_MAX_SIZE = 1e3;
function normalize(path) {
  if (path === void 0 || path === null) {
    throw new TypeError("Path cannot be undefined or null");
  }
  if (typeof path !== "string") {
    throw new TypeError(`Expected string path, got ${typeof path}`);
  }
  if (path === "") {
    return "/";
  }
  const cached = normalizeCache.get(path);
  if (cached !== void 0) {
    return cached;
  }
  const parts = path.split("/");
  const stack = [];
  for (const part of parts) {
    if (part === "" || part === ".") {
      continue;
    } else if (part === "..") {
      if (stack.length > 0) stack.pop();
    } else {
      stack.push(part);
    }
  }
  const result = "/" + stack.join("/");
  if (normalizeCache.size >= CACHE_MAX_SIZE) {
    const deleteCount = CACHE_MAX_SIZE / 4;
    let count = 0;
    for (const key of normalizeCache.keys()) {
      if (count++ >= deleteCount) break;
      normalizeCache.delete(key);
    }
  }
  normalizeCache.set(path, result);
  return result;
}
function dirname(path) {
  const normalized = normalize(path);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length < 2) return "/";
  return "/" + parts.slice(0, -1).join("/");
}
function isRoot(path) {
  const normalized = normalize(path);
  return normalized === "/" || normalized === "";
}
function segments(path) {
  return normalize(path).split("/").filter(Boolean);
}

// src/handle-manager.ts
var FILE_HANDLE_POOL_SIZE = 50;
var DIR_CACHE_MAX_SIZE = 200;
var FileLock = class {
  active = /* @__PURE__ */ new Set();
  queues = /* @__PURE__ */ new Map();
  async acquire(path) {
    if (!this.active.has(path)) {
      this.active.add(path);
      return this.createRelease(path);
    }
    await new Promise((resolve) => {
      let queue = this.queues.get(path);
      if (!queue) {
        queue = [];
        this.queues.set(path, queue);
      }
      queue.push(resolve);
    });
    return this.createRelease(path);
  }
  createRelease(path) {
    return () => {
      const queue = this.queues.get(path);
      if (queue && queue.length > 0) {
        const next = queue.shift();
        if (queue.length === 0) {
          this.queues.delete(path);
        }
        next();
      } else {
        this.active.delete(path);
      }
    };
  }
};
var fileLock = new FileLock();
var HandleManager = class {
  rootPromise;
  dirCache = /* @__PURE__ */ new Map();
  fileHandlePool = /* @__PURE__ */ new Map();
  constructor() {
    this.rootPromise = navigator.storage.getDirectory();
  }
  /**
   * Get the root directory handle
   */
  async getRoot() {
    return this.rootPromise;
  }
  /**
   * Cache a directory handle with LRU eviction
   */
  cacheDirHandle(path, handle) {
    if (this.dirCache.size >= DIR_CACHE_MAX_SIZE) {
      const firstKey = this.dirCache.keys().next().value;
      if (firstKey) this.dirCache.delete(firstKey);
    }
    this.dirCache.set(path, handle);
  }
  /**
   * Clear directory cache for a path and its children
   */
  clearCache(path = "") {
    const normalizedPath = normalize(path);
    if (normalizedPath === "/" || normalizedPath === "") {
      this.dirCache.clear();
      this.fileHandlePool.clear();
      return;
    }
    if (this.dirCache.size > 0) {
      for (const key of this.dirCache.keys()) {
        if (key === normalizedPath || key.startsWith(normalizedPath + "/")) {
          this.dirCache.delete(key);
        }
      }
    }
    if (this.fileHandlePool.size > 0) {
      for (const key of this.fileHandlePool.keys()) {
        if (key === normalizedPath || key.startsWith(normalizedPath + "/")) {
          this.fileHandlePool.delete(key);
        }
      }
    }
  }
  /**
   * Get a file handle from the pool or create a new one
   */
  async getPooledFileHandle(path, create = false) {
    const normalizedPath = normalize(path);
    const pooled = this.fileHandlePool.get(normalizedPath);
    if (pooled) {
      return pooled;
    }
    const { fileHandle } = await this.getHandle(normalizedPath, { create });
    if (!fileHandle) return null;
    if (this.fileHandlePool.size >= FILE_HANDLE_POOL_SIZE) {
      const firstKey = this.fileHandlePool.keys().next().value;
      if (firstKey) this.fileHandlePool.delete(firstKey);
    }
    this.fileHandlePool.set(normalizedPath, fileHandle);
    return fileHandle;
  }
  /**
   * Invalidate a specific file handle from the pool
   */
  invalidateFileHandle(path) {
    const normalizedPath = normalize(path);
    this.fileHandlePool.delete(normalizedPath);
  }
  /**
   * Get file or directory handle for a path
   */
  async getHandle(path, opts = {}) {
    const parts = segments(path);
    if (parts.length === 0) {
      const root = await this.rootPromise;
      return { dir: root, name: "", fileHandle: null, dirHandle: root };
    }
    let dir = await this.rootPromise;
    let currentPath = "";
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath += "/" + parts[i];
      if (this.dirCache.has(currentPath)) {
        dir = this.dirCache.get(currentPath);
        continue;
      }
      try {
        dir = await dir.getDirectoryHandle(parts[i], { create: opts.create });
        this.cacheDirHandle(currentPath, dir);
      } catch {
        throw createENOENT(path);
      }
    }
    const name = parts[parts.length - 1];
    try {
      if (opts.kind === "directory") {
        const dirHandle = await dir.getDirectoryHandle(name, { create: opts.create });
        return { dir, name, fileHandle: null, dirHandle };
      } else {
        const fileHandle = await dir.getFileHandle(name, { create: opts.create });
        return { dir, name, fileHandle, dirHandle: null };
      }
    } catch {
      if (!opts.create) {
        return { dir, name, fileHandle: null, dirHandle: null };
      }
      throw createENOENT(path);
    }
  }
  /**
   * Get directory handle with caching
   */
  async getDirectoryHandle(path) {
    const normalizedPath = normalize(path);
    if (normalizedPath === "/" || normalizedPath === "") {
      return this.rootPromise;
    }
    if (this.dirCache.has(normalizedPath)) {
      return this.dirCache.get(normalizedPath);
    }
    const parts = segments(normalizedPath);
    let dir = await this.rootPromise;
    let currentPath = "";
    for (const part of parts) {
      currentPath += "/" + part;
      if (this.dirCache.has(currentPath)) {
        dir = this.dirCache.get(currentPath);
        continue;
      }
      dir = await dir.getDirectoryHandle(part);
      this.cacheDirHandle(currentPath, dir);
    }
    return dir;
  }
  /**
   * Ensure parent directory exists
   */
  async ensureParentDir(path) {
    const parentPath = dirname(path);
    if (parentPath === "/" || parentPath === "") return;
    const parts = segments(parentPath);
    let dir = await this.rootPromise;
    let currentPath = "";
    for (const part of parts) {
      currentPath += "/" + part;
      if (this.dirCache.has(currentPath)) {
        dir = this.dirCache.get(currentPath);
        continue;
      }
      dir = await dir.getDirectoryHandle(part, { create: true });
      this.cacheDirHandle(currentPath, dir);
    }
  }
  /**
   * Create directory (with automatic parent creation)
   */
  async mkdir(path) {
    const normalizedPath = normalize(path);
    this.clearCache(normalizedPath);
    const parts = segments(normalizedPath);
    let dir = await this.rootPromise;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const subPath = "/" + parts.slice(0, i + 1).join("/");
      if (this.dirCache.has(subPath)) {
        dir = this.dirCache.get(subPath);
      } else {
        dir = await dir.getDirectoryHandle(part, { create: true });
        this.cacheDirHandle(subPath, dir);
      }
    }
  }
};

// src/symlink-manager.ts
var SYMLINK_FILE = "/.opfs-symlinks.json";
var MAX_SYMLINK_DEPTH = 10;
var SymlinkManager = class {
  cache = null;
  cacheCount = 0;
  // Track count to avoid Object.keys() calls
  resolvedCache = /* @__PURE__ */ new Map();
  // Cache resolved paths
  dirty = false;
  handleManager;
  useSync;
  loadPromise = null;
  // Avoid multiple concurrent loads
  diskLoaded = false;
  // Track if we've loaded from disk
  constructor(handleManager, useSync) {
    this.handleManager = handleManager;
    this.useSync = useSync;
    this.cache = {};
    this.cacheCount = 0;
  }
  /**
   * Reset all symlink state (called when root directory is cleared)
   */
  reset() {
    this.cache = {};
    this.cacheCount = 0;
    this.resolvedCache.clear();
    this.dirty = false;
    this.loadPromise = null;
    this.diskLoaded = false;
  }
  /**
   * Load symlinks from metadata file
   * Uses loadPromise to avoid multiple concurrent disk reads
   */
  async load() {
    if (this.diskLoaded) return this.cache;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.loadFromDisk();
    const result = await this.loadPromise;
    this.loadPromise = null;
    return result;
  }
  /**
   * Actually read from disk
   */
  async loadFromDisk() {
    try {
      const { fileHandle } = await this.handleManager.getHandle(SYMLINK_FILE);
      if (!fileHandle) {
        this.diskLoaded = true;
        return this.cache;
      }
      const file = await fileHandle.getFile();
      const text = await file.text();
      this.cache = JSON.parse(text);
      this.cacheCount = Object.keys(this.cache).length;
      this.diskLoaded = true;
    } catch {
      if (!this.cache) {
        this.cache = {};
        this.cacheCount = 0;
      }
      this.diskLoaded = true;
    }
    return this.cache;
  }
  /**
   * Save symlinks to metadata file
   */
  async save() {
    if (!this.cache) return;
    const data = JSON.stringify(this.cache);
    const { fileHandle } = await this.handleManager.getHandle(SYMLINK_FILE, { create: true });
    if (!fileHandle) return;
    const buffer = new TextEncoder().encode(data);
    if (this.useSync) {
      const release = await fileLock.acquire(SYMLINK_FILE);
      try {
        const access = await fileHandle.createSyncAccessHandle();
        try {
          access.truncate(0);
          let written = 0;
          while (written < buffer.length) {
            written += access.write(buffer.subarray(written), { at: written });
          }
        } finally {
          access.close();
        }
      } finally {
        release();
      }
    } else {
      const writable = await fileHandle.createWritable();
      await writable.write(buffer);
      await writable.close();
    }
    this.dirty = false;
  }
  /**
   * Flush pending changes if dirty
   */
  async flush() {
    if (this.dirty) {
      await this.save();
    }
  }
  /**
   * Resolve a path through symlinks
   * Fast synchronous path when cache is already loaded
   * Uses resolved cache for O(1) repeated lookups
   *
   * OPTIMIZATION: If we haven't loaded from disk yet AND no symlinks have been
   * created in this session, we skip the disk check entirely. This makes pure
   * file operations (no symlinks) very fast.
   */
  async resolve(path, maxDepth = MAX_SYMLINK_DEPTH) {
    if (this.cacheCount === 0) {
      return path;
    }
    const cached = this.resolvedCache.get(path);
    if (cached !== void 0) {
      return cached;
    }
    return this.resolveSync(path, this.cache, maxDepth);
  }
  /**
   * Synchronous resolution helper - caches the result
   */
  resolveSync(path, symlinks, maxDepth) {
    let currentPath = path;
    let depth = 0;
    while (symlinks[currentPath] && depth < maxDepth) {
      currentPath = symlinks[currentPath];
      depth++;
    }
    if (depth >= maxDepth) {
      throw createELOOP(path);
    }
    if (currentPath !== path) {
      this.resolvedCache.set(path, currentPath);
    }
    return currentPath;
  }
  /**
   * Clear the resolved path cache (called when symlinks change)
   */
  clearResolvedCache() {
    this.resolvedCache.clear();
  }
  /**
   * Check if a path is a symlink
   */
  async isSymlink(path) {
    const symlinks = await this.load();
    return !!symlinks[path];
  }
  /**
   * Get symlink target
   */
  async readlink(path) {
    const normalizedPath = normalize(path);
    const symlinks = await this.load();
    if (!symlinks[normalizedPath]) {
      throw createEINVAL(path);
    }
    return symlinks[normalizedPath];
  }
  /**
   * Create a symlink
   */
  async symlink(target, path, checkExists) {
    const normalizedPath = normalize(path);
    const normalizedTarget = normalize(target);
    const symlinks = await this.load();
    if (symlinks[normalizedPath]) {
      throw createEEXIST(normalizedPath);
    }
    await checkExists();
    symlinks[normalizedPath] = normalizedTarget;
    this.cacheCount++;
    this.clearResolvedCache();
    this.dirty = true;
    await this.flush();
  }
  /**
   * Create multiple symlinks efficiently
   */
  async symlinkBatch(links, checkExists) {
    const symlinks = await this.load();
    const normalizedLinks = links.map(({ target, path }) => ({
      normalizedPath: normalize(path),
      normalizedTarget: normalize(target)
    }));
    for (const { normalizedPath } of normalizedLinks) {
      if (symlinks[normalizedPath]) {
        throw createEEXIST(normalizedPath);
      }
    }
    await Promise.all(normalizedLinks.map(({ normalizedPath }) => checkExists(normalizedPath)));
    for (const { normalizedPath, normalizedTarget } of normalizedLinks) {
      symlinks[normalizedPath] = normalizedTarget;
    }
    this.cacheCount += links.length;
    this.clearResolvedCache();
    this.dirty = true;
    await this.flush();
  }
  /**
   * Remove a symlink
   */
  async unlink(path) {
    const symlinks = await this.load();
    if (symlinks[path]) {
      delete symlinks[path];
      this.cacheCount--;
      this.clearResolvedCache();
      this.dirty = true;
      await this.flush();
      return true;
    }
    return false;
  }
  /**
   * Rename/move a symlink
   */
  async rename(oldPath, newPath) {
    const symlinks = await this.load();
    if (symlinks[oldPath]) {
      const target = symlinks[oldPath];
      delete symlinks[oldPath];
      symlinks[newPath] = target;
      this.clearResolvedCache();
      this.dirty = true;
      await this.flush();
      return true;
    }
    return false;
  }
  /**
   * Get all symlinks in a directory
   */
  async getSymlinksInDir(dirPath) {
    const symlinks = await this.load();
    const result = [];
    for (const symlinkPath of Object.keys(symlinks)) {
      const parts = symlinkPath.split("/").filter(Boolean);
      const parentPath = "/" + parts.slice(0, -1).join("/");
      if (parentPath === dirPath || dirPath === "/" && parts.length === 1) {
        result.push(parts[parts.length - 1]);
      }
    }
    return result;
  }
  /**
   * Check if path is the symlink metadata file
   */
  isMetadataFile(name) {
    return name === SYMLINK_FILE.replace(/^\/+/, "");
  }
};

// src/packed-storage.ts
async function compress(data) {
  if (data.length < 100) return data;
  try {
    const stream = new CompressionStream("gzip");
    const writer = stream.writable.getWriter();
    writer.write(data);
    writer.close();
    const chunks = [];
    const reader = stream.readable.getReader();
    let totalSize = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalSize += value.length;
    }
    if (totalSize >= data.length) return data;
    const result = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  } catch {
    return data;
  }
}
async function decompress(data) {
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(data);
  writer.close();
  const chunks = [];
  const reader = stream.readable.getReader();
  let totalSize = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalSize += value.length;
  }
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
var CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
  }
  CRC32_TABLE[i] = c;
}
function crc32(data) {
  let crc = 4294967295;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 255] ^ crc >>> 8;
  }
  return (crc ^ 4294967295) >>> 0;
}
var PACK_FILE = "/.opfs-pack";
var PackedStorage = class {
  handleManager;
  useSync;
  useCompression;
  useChecksum;
  index = null;
  indexLoaded = false;
  constructor(handleManager, useSync, useCompression = false, useChecksum = true) {
    this.handleManager = handleManager;
    this.useSync = useSync;
    this.useCompression = useCompression && typeof CompressionStream !== "undefined";
    this.useChecksum = useChecksum;
  }
  /**
   * Reset pack storage state (memory only)
   */
  reset() {
    this.index = null;
    this.indexLoaded = false;
  }
  /**
   * Clear pack storage completely (deletes pack file from disk)
   */
  async clear() {
    this.index = null;
    this.indexLoaded = false;
    try {
      const root = await this.handleManager.getRoot();
      await root.removeEntry(PACK_FILE.replace(/^\//, ""));
    } catch {
    }
  }
  /**
   * Load pack index from disk (always reloads to support hybrid mode)
   * Verifies CRC32 checksum for integrity
   * Note: Caller must hold the lock
   */
  async loadIndex() {
    try {
      const { fileHandle } = await this.handleManager.getHandle(PACK_FILE);
      if (!fileHandle) {
        return {};
      }
      if (this.useSync) {
        const release = await fileLock.acquire(PACK_FILE);
        try {
          const access = await fileHandle.createSyncAccessHandle();
          try {
            const size = access.getSize();
            if (size < 8) {
              return {};
            }
            const header = new Uint8Array(8);
            access.read(header, { at: 0 });
            const view = new DataView(header.buffer);
            const indexLen = view.getUint32(0, true);
            const storedCrc = view.getUint32(4, true);
            const contentSize = size - 8;
            const content = new Uint8Array(contentSize);
            access.read(content, { at: 8 });
            if (this.useChecksum && storedCrc !== 0) {
              const calculatedCrc = crc32(content);
              if (calculatedCrc !== storedCrc) {
                throw createECORRUPTED(PACK_FILE);
              }
            }
            const indexJson = new TextDecoder().decode(content.subarray(0, indexLen));
            return JSON.parse(indexJson);
          } finally {
            access.close();
          }
        } finally {
          release();
        }
      } else {
        const file = await fileHandle.getFile();
        const data = new Uint8Array(await file.arrayBuffer());
        if (data.length < 8) {
          return {};
        }
        const view = new DataView(data.buffer);
        const indexLen = view.getUint32(0, true);
        const storedCrc = view.getUint32(4, true);
        const content = data.subarray(8);
        if (this.useChecksum && storedCrc !== 0) {
          const calculatedCrc = crc32(content);
          if (calculatedCrc !== storedCrc) {
            throw createECORRUPTED(PACK_FILE);
          }
        }
        const indexJson = new TextDecoder().decode(content.subarray(0, indexLen));
        return JSON.parse(indexJson);
      }
    } catch {
      return {};
    }
  }
  /**
   * Check if a path exists in the pack
   */
  async has(path) {
    const index = await this.loadIndex();
    return path in index;
  }
  /**
   * Get file size from pack (for stat)
   * Returns originalSize if compressed, otherwise size
   */
  async getSize(path) {
    const index = await this.loadIndex();
    const entry = index[path];
    if (!entry) return null;
    return entry.originalSize ?? entry.size;
  }
  /**
   * Read a file from the pack
   * Handles decompression if file was stored compressed
   */
  async read(path) {
    const index = await this.loadIndex();
    const entry = index[path];
    if (!entry) return null;
    const { fileHandle } = await this.handleManager.getHandle(PACK_FILE);
    if (!fileHandle) return null;
    let buffer;
    if (this.useSync) {
      const release = await fileLock.acquire(PACK_FILE);
      try {
        const access = await fileHandle.createSyncAccessHandle();
        try {
          buffer = new Uint8Array(entry.size);
          access.read(buffer, { at: entry.offset });
        } finally {
          access.close();
        }
      } finally {
        release();
      }
    } else {
      const file = await fileHandle.getFile();
      const data = new Uint8Array(await file.arrayBuffer());
      buffer = data.slice(entry.offset, entry.offset + entry.size);
    }
    if (entry.originalSize !== void 0) {
      return decompress(buffer);
    }
    return buffer;
  }
  /**
   * Read multiple files from the pack in a single operation
   * Loads index once, reads all data in parallel
   * Handles decompression if files were stored compressed
   */
  async readBatch(paths) {
    const results = /* @__PURE__ */ new Map();
    if (paths.length === 0) return results;
    const index = await this.loadIndex();
    const toRead = [];
    for (const path of paths) {
      const entry = index[path];
      if (entry) {
        toRead.push({ path, offset: entry.offset, size: entry.size, originalSize: entry.originalSize });
      } else {
        results.set(path, null);
      }
    }
    if (toRead.length === 0) return results;
    const { fileHandle } = await this.handleManager.getHandle(PACK_FILE);
    if (!fileHandle) {
      for (const { path } of toRead) {
        results.set(path, null);
      }
      return results;
    }
    const decompressPromises = [];
    if (this.useSync) {
      const release = await fileLock.acquire(PACK_FILE);
      try {
        const access = await fileHandle.createSyncAccessHandle();
        try {
          for (const { path, offset, size, originalSize } of toRead) {
            const buffer = new Uint8Array(size);
            access.read(buffer, { at: offset });
            if (originalSize !== void 0) {
              decompressPromises.push({ path, promise: decompress(buffer) });
            } else {
              results.set(path, buffer);
            }
          }
        } finally {
          access.close();
        }
      } finally {
        release();
      }
    } else {
      const file = await fileHandle.getFile();
      const data = new Uint8Array(await file.arrayBuffer());
      for (const { path, offset, size, originalSize } of toRead) {
        const buffer = data.slice(offset, offset + size);
        if (originalSize !== void 0) {
          decompressPromises.push({ path, promise: decompress(buffer) });
        } else {
          results.set(path, buffer);
        }
      }
    }
    for (const { path, promise } of decompressPromises) {
      results.set(path, await promise);
    }
    return results;
  }
  /**
   * Write multiple files to the pack in a single operation
   * This is the key optimization - 100 files become 1 write!
   * Includes CRC32 checksum for integrity verification.
   * Optionally compresses data for smaller storage.
   * Note: This replaces the entire pack with the new entries
   */
  async writeBatch(entries) {
    if (entries.length === 0) return;
    const encoder = new TextEncoder();
    let processedEntries;
    if (this.useCompression) {
      processedEntries = await Promise.all(
        entries.map(async ({ path, data }) => {
          const compressed = await compress(data);
          if (compressed.length < data.length) {
            return { path, data: compressed, originalSize: data.length };
          }
          return { path, data };
        })
      );
    } else {
      processedEntries = entries;
    }
    let totalDataSize = 0;
    for (const { data } of processedEntries) {
      totalDataSize += data.length;
    }
    const newIndex = {};
    let headerSize = 8;
    let prevHeaderSize = 0;
    while (headerSize !== prevHeaderSize) {
      prevHeaderSize = headerSize;
      let currentOffset = headerSize;
      for (const { path, data, originalSize } of processedEntries) {
        const entry = { offset: currentOffset, size: data.length };
        if (originalSize !== void 0) {
          entry.originalSize = originalSize;
        }
        newIndex[path] = entry;
        currentOffset += data.length;
      }
      const indexBuf = encoder.encode(JSON.stringify(newIndex));
      headerSize = 8 + indexBuf.length;
    }
    const finalIndexBuf = encoder.encode(JSON.stringify(newIndex));
    const totalSize = headerSize + totalDataSize;
    const packBuffer = new Uint8Array(totalSize);
    const view = new DataView(packBuffer.buffer);
    packBuffer.set(finalIndexBuf, 8);
    for (const { path, data } of processedEntries) {
      const entry = newIndex[path];
      packBuffer.set(data, entry.offset);
    }
    const content = packBuffer.subarray(8);
    const checksum = this.useChecksum ? crc32(content) : 0;
    view.setUint32(0, finalIndexBuf.length, true);
    view.setUint32(4, checksum, true);
    await this.writePackFile(packBuffer);
    this.index = newIndex;
  }
  /**
   * Write the pack file to OPFS
   * Note: Caller must hold the lock
   */
  async writePackFile(data) {
    const { fileHandle } = await this.handleManager.getHandle(PACK_FILE, { create: true });
    if (!fileHandle) return;
    if (this.useSync) {
      const release = await fileLock.acquire(PACK_FILE);
      try {
        const access = await fileHandle.createSyncAccessHandle();
        try {
          access.truncate(data.length);
          access.write(data, { at: 0 });
        } finally {
          access.close();
        }
      } finally {
        release();
      }
    } else {
      const writable = await fileHandle.createWritable();
      await writable.write(data);
      await writable.close();
    }
  }
  /**
   * Remove a path from the pack index
   * Note: Doesn't reclaim space, just removes from index and recalculates CRC32
   */
  async remove(path) {
    const index = await this.loadIndex();
    if (!(path in index)) return false;
    delete index[path];
    const { fileHandle } = await this.handleManager.getHandle(PACK_FILE);
    if (!fileHandle) return true;
    const encoder = new TextEncoder();
    const newIndexBuf = encoder.encode(JSON.stringify(index));
    if (this.useSync) {
      const release = await fileLock.acquire(PACK_FILE);
      try {
        const access = await fileHandle.createSyncAccessHandle();
        try {
          const size = access.getSize();
          const oldHeader = new Uint8Array(8);
          access.read(oldHeader, { at: 0 });
          const oldIndexLen = new DataView(oldHeader.buffer).getUint32(0, true);
          const dataStart = 8 + oldIndexLen;
          const dataSize = size - dataStart;
          const dataPortion = new Uint8Array(dataSize);
          if (dataSize > 0) {
            access.read(dataPortion, { at: dataStart });
          }
          const newContent = new Uint8Array(newIndexBuf.length + dataSize);
          newContent.set(newIndexBuf, 0);
          if (dataSize > 0) {
            newContent.set(dataPortion, newIndexBuf.length);
          }
          const checksum = this.useChecksum ? crc32(newContent) : 0;
          const newHeader = new Uint8Array(8);
          const view = new DataView(newHeader.buffer);
          view.setUint32(0, newIndexBuf.length, true);
          view.setUint32(4, checksum, true);
          const newFile = new Uint8Array(8 + newContent.length);
          newFile.set(newHeader, 0);
          newFile.set(newContent, 8);
          access.truncate(newFile.length);
          access.write(newFile, { at: 0 });
        } finally {
          access.close();
        }
      } finally {
        release();
      }
    } else {
      const file = await fileHandle.getFile();
      const oldData = new Uint8Array(await file.arrayBuffer());
      if (oldData.length < 8) return true;
      const oldIndexLen = new DataView(oldData.buffer).getUint32(0, true);
      const dataStart = 8 + oldIndexLen;
      const dataPortion = oldData.subarray(dataStart);
      const newContent = new Uint8Array(newIndexBuf.length + dataPortion.length);
      newContent.set(newIndexBuf, 0);
      newContent.set(dataPortion, newIndexBuf.length);
      const checksum = this.useChecksum ? crc32(newContent) : 0;
      const newFile = new Uint8Array(8 + newContent.length);
      const view = new DataView(newFile.buffer);
      view.setUint32(0, newIndexBuf.length, true);
      view.setUint32(4, checksum, true);
      newFile.set(newContent, 8);
      const writable = await fileHandle.createWritable();
      await writable.write(newFile);
      await writable.close();
    }
    return true;
  }
  /**
   * Check if pack file is being used (has entries)
   */
  async isEmpty() {
    const index = await this.loadIndex();
    return Object.keys(index).length === 0;
  }
};

// src/file-handle.ts
function createFileHandle(resolvedPath, initialPosition, context) {
  let position = initialPosition;
  return {
    fd: Math.floor(Math.random() * 1e6),
    async read(buffer, offset = 0, length = buffer.length, pos = null) {
      const readPos = pos !== null ? pos : position;
      const data = await context.readFile(resolvedPath);
      const bytesToRead = Math.min(length, data.length - readPos);
      buffer.set(data.subarray(readPos, readPos + bytesToRead), offset);
      if (pos === null) position += bytesToRead;
      return { bytesRead: bytesToRead, buffer };
    },
    async write(buffer, offset = 0, length = buffer.length, pos = null) {
      const writePos = pos !== null ? pos : position;
      let existingData = new Uint8Array(0);
      try {
        existingData = await context.readFile(resolvedPath);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      const dataToWrite = buffer.subarray(offset, offset + length);
      const newSize = Math.max(existingData.length, writePos + length);
      const newData = new Uint8Array(newSize);
      newData.set(existingData, 0);
      newData.set(dataToWrite, writePos);
      await context.writeFile(resolvedPath, newData);
      if (pos === null) position += length;
      return { bytesWritten: length, buffer };
    },
    async close() {
    },
    async stat() {
      return context.stat(resolvedPath);
    },
    async truncate(len = 0) {
      return context.truncate(resolvedPath, len);
    },
    async sync() {
    },
    async datasync() {
    },
    async readFile(options) {
      return context.readFile(resolvedPath, options);
    },
    async writeFile(data, options) {
      return context.writeFile(resolvedPath, data, options);
    },
    async appendFile(data, options) {
      return context.appendFile(resolvedPath, data, options);
    },
    [Symbol.asyncDispose]: async function() {
    }
  };
}

// src/streams.ts
function createReadStream(path, options, context) {
  const { start = 0, end = Infinity, highWaterMark = 64 * 1024 } = options;
  let position = start;
  let closed = false;
  let cachedData = null;
  return new ReadableStream({
    async pull(controller) {
      if (closed) {
        controller.close();
        return;
      }
      try {
        if (cachedData === null) {
          cachedData = await context.readFile(path);
        }
        const endPos = Math.min(end, cachedData.length);
        const chunk = cachedData.subarray(position, Math.min(position + highWaterMark, endPos));
        if (chunk.length === 0 || position >= endPos) {
          controller.close();
          closed = true;
          cachedData = null;
          return;
        }
        position += chunk.length;
        controller.enqueue(chunk);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      closed = true;
      cachedData = null;
    }
  });
}
function createWriteStream(path, options, context) {
  const { flags = "w", start = 0 } = options;
  const chunks = [];
  let position = start;
  return new WritableStream({
    async write(chunk) {
      chunks.push({ data: chunk, position });
      position += chunk.length;
    },
    async close() {
      let existingData = new Uint8Array(0);
      if (!flags.includes("w")) {
        try {
          existingData = await context.readFile(path);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
      }
      let maxSize = existingData.length;
      for (const { data, position: position2 } of chunks) {
        maxSize = Math.max(maxSize, position2 + data.length);
      }
      const finalData = new Uint8Array(maxSize);
      if (!flags.includes("w")) {
        finalData.set(existingData, 0);
      }
      for (const { data, position: position2 } of chunks) {
        finalData.set(data, position2);
      }
      await context.writeFile(path, finalData);
    }
  });
}

// src/opfs-worker-proxy.ts
var OPFSWorker = class {
  worker = null;
  pendingRequests = /* @__PURE__ */ new Map();
  nextId = 1;
  readyPromise;
  readyResolve;
  /** File system constants */
  constants = constants;
  constructor(options = {}) {
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
    this.initWorker(options);
  }
  initWorker(options) {
    const { workerUrl, workerOptions = { type: "module" } } = options;
    if (workerUrl) {
      this.worker = new Worker(workerUrl, workerOptions);
    } else {
      throw new Error(
        'OPFSWorker requires a workerUrl option pointing to the worker script. Example: new OPFSWorker({ workerUrl: new URL("./opfs-worker.js", import.meta.url) })'
      );
    }
    this.worker.onmessage = (event) => {
      const { id, type, result, error } = event.data;
      if (type === "ready") {
        this.readyResolve();
        return;
      }
      if (id !== void 0) {
        const pending = this.pendingRequests.get(id);
        if (pending) {
          this.pendingRequests.delete(id);
          if (error) {
            const fsError = new FSError(error.message, error.code || "UNKNOWN");
            pending.reject(fsError);
          } else {
            pending.resolve(result);
          }
        }
      }
    };
    this.worker.onerror = (event) => {
      console.error("[OPFSWorker] Worker error:", event);
    };
  }
  /**
   * Wait for the worker to be ready
   */
  async ready() {
    return this.readyPromise;
  }
  /**
   * Terminate the worker
   */
  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error("Worker terminated"));
      }
      this.pendingRequests.clear();
    }
  }
  call(method, args, transfer) {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Worker not initialized or terminated"));
        return;
      }
      const id = this.nextId++;
      this.pendingRequests.set(id, {
        resolve,
        reject
      });
      const message = { id, method, args };
      if (transfer && transfer.length > 0) {
        this.worker.postMessage(message, transfer);
      } else {
        this.worker.postMessage(message);
      }
    });
  }
  // File operations
  async readFile(path, options) {
    const result = await this.call("readFile", [path, options]);
    return result;
  }
  async writeFile(path, data, options) {
    await this.call("writeFile", [path, data, options]);
  }
  async readFileBatch(paths) {
    return this.call("readFileBatch", [paths]);
  }
  async writeFileBatch(entries) {
    await this.call("writeFileBatch", [entries]);
  }
  async appendFile(path, data, options) {
    await this.call("appendFile", [path, data, options]);
  }
  async copyFile(src, dest, mode) {
    await this.call("copyFile", [src, dest, mode]);
  }
  async unlink(path) {
    await this.call("unlink", [path]);
  }
  async truncate(path, len) {
    await this.call("truncate", [path, len]);
  }
  // Directory operations
  async mkdir(path) {
    await this.call("mkdir", [path]);
  }
  async rmdir(path) {
    await this.call("rmdir", [path]);
  }
  async readdir(path, options) {
    const result = await this.call("readdir", [path, options]);
    if (options?.withFileTypes && Array.isArray(result)) {
      return result.map((item) => {
        if (typeof item === "object" && "name" in item) {
          const entry = item;
          return {
            name: entry.name,
            isFile: () => entry._isFile ?? false,
            isDirectory: () => entry._isDir ?? false,
            isSymbolicLink: () => entry._isSymlink ?? false
          };
        }
        return item;
      });
    }
    return result;
  }
  async cp(src, dest, options) {
    await this.call("cp", [src, dest, options]);
  }
  async rm(path, options) {
    await this.call("rm", [path, options]);
  }
  // Stat operations
  async stat(path) {
    const result = await this.call("stat", [path]);
    return this.deserializeStats(result);
  }
  async lstat(path) {
    const result = await this.call("lstat", [path]);
    return this.deserializeStats(result);
  }
  deserializeStats(data) {
    const ctime = new Date(data.ctime);
    const mtime = new Date(data.mtime);
    return {
      type: data.type,
      size: data.size,
      mode: data.mode,
      ctime,
      ctimeMs: data.ctimeMs,
      mtime,
      mtimeMs: data.mtimeMs,
      target: data.target,
      isFile: () => data.type === "file",
      isDirectory: () => data.type === "dir",
      isSymbolicLink: () => data.type === "symlink"
    };
  }
  async exists(path) {
    return this.call("exists", [path]);
  }
  async access(path, mode) {
    await this.call("access", [path, mode]);
  }
  async statfs(path) {
    return this.call("statfs", [path]);
  }
  async du(path) {
    return this.call("du", [path]);
  }
  // Symlink operations
  async symlink(target, path) {
    await this.call("symlink", [target, path]);
  }
  async readlink(path) {
    return this.call("readlink", [path]);
  }
  async symlinkBatch(links) {
    await this.call("symlinkBatch", [links]);
  }
  async realpath(path) {
    return this.call("realpath", [path]);
  }
  // Other operations
  async rename(oldPath, newPath) {
    await this.call("rename", [oldPath, newPath]);
  }
  async mkdtemp(prefix) {
    return this.call("mkdtemp", [prefix]);
  }
  async chmod(path, mode) {
    await this.call("chmod", [path, mode]);
  }
  async chown(path, uid, gid) {
    await this.call("chown", [path, uid, gid]);
  }
  async utimes(path, atime, mtime) {
    await this.call("utimes", [path, atime, mtime]);
  }
  async lutimes(path, atime, mtime) {
    await this.call("lutimes", [path, atime, mtime]);
  }
  /**
   * Reset internal caches to free memory
   * Useful for long-running benchmarks or after bulk operations
   */
  async resetCache() {
    await this.call("resetCache", []);
  }
  /**
   * Force full garbage collection by reinitializing the OPFS instance in the worker
   * This completely releases all handles and caches, preventing memory leaks in long-running operations
   * More aggressive than resetCache() - use when resetCache() isn't sufficient
   */
  async gc() {
    await this.call("gc", []);
  }
};

// src/opfs-hybrid.ts
var OPFSHybrid = class {
  mainFs;
  workerFs = null;
  readBackend;
  writeBackend;
  workerUrl;
  workerReady = null;
  verbose;
  constructor(options = {}) {
    this.readBackend = options.read ?? "main";
    this.writeBackend = options.write ?? "worker";
    this.workerUrl = options.workerUrl;
    this.verbose = options.verbose ?? false;
    this.mainFs = new OPFS({ useSync: false, verbose: this.verbose });
    if (this.readBackend === "worker" || this.writeBackend === "worker") {
      if (!this.workerUrl) {
        throw new Error("workerUrl is required when using worker backend");
      }
      this.workerFs = new OPFSWorker({ workerUrl: this.workerUrl });
      this.workerReady = this.workerFs.ready();
    }
  }
  /**
   * Wait for all backends to be ready
   */
  async ready() {
    if (this.workerReady) {
      await this.workerReady;
    }
  }
  /**
   * Terminate worker if active
   */
  terminate() {
    if (this.workerFs) {
      this.workerFs.terminate();
      this.workerFs = null;
    }
  }
  getReadFs() {
    if (this.readBackend === "worker" && this.workerFs) {
      return this.workerFs;
    }
    return this.mainFs;
  }
  getWriteFs() {
    if (this.writeBackend === "worker" && this.workerFs) {
      return this.workerFs;
    }
    return this.mainFs;
  }
  // ============ Read Operations ============
  async readFile(path, options) {
    return this.getReadFs().readFile(path, options);
  }
  async readFileBatch(paths) {
    return this.getReadFs().readFileBatch(paths);
  }
  async readdir(path, options) {
    return this.getReadFs().readdir(path, options);
  }
  async stat(path) {
    return this.getReadFs().stat(path);
  }
  async lstat(path) {
    return this.getReadFs().lstat(path);
  }
  async exists(path) {
    return this.getReadFs().exists(path);
  }
  async access(path, mode) {
    return this.getReadFs().access(path, mode);
  }
  async readlink(path) {
    return this.getReadFs().readlink(path);
  }
  async realpath(path) {
    return this.getReadFs().realpath(path);
  }
  async statfs(path) {
    return this.getReadFs().statfs(path);
  }
  async du(path) {
    return this.getReadFs().du(path);
  }
  // ============ Write Operations ============
  async writeFile(path, data, options) {
    return this.getWriteFs().writeFile(path, data, options);
  }
  async writeFileBatch(entries) {
    return this.getWriteFs().writeFileBatch(entries);
  }
  async appendFile(path, data, options) {
    return this.getWriteFs().appendFile(path, data, options);
  }
  async mkdir(path) {
    return this.getWriteFs().mkdir(path);
  }
  async rmdir(path) {
    if (this.readBackend !== this.writeBackend && this.workerFs) {
      await this.workerFs.rmdir(path);
      this.mainFs.resetCache();
    } else {
      return this.getWriteFs().rmdir(path);
    }
  }
  async unlink(path) {
    return this.getWriteFs().unlink(path);
  }
  async truncate(path, len) {
    return this.getWriteFs().truncate(path, len);
  }
  async symlink(target, path) {
    if (this.readBackend !== this.writeBackend && this.workerFs) {
      await this.workerFs.symlink(target, path);
      this.mainFs.resetCache();
    } else {
      return this.getWriteFs().symlink(target, path);
    }
  }
  async symlinkBatch(symlinks) {
    if (this.readBackend !== this.writeBackend && this.workerFs) {
      await this.workerFs.symlinkBatch(symlinks);
      this.mainFs.resetCache();
    } else {
      return this.getWriteFs().symlinkBatch(symlinks);
    }
  }
  async rename(oldPath, newPath) {
    return this.getWriteFs().rename(oldPath, newPath);
  }
  async copyFile(src, dest, mode) {
    return this.getWriteFs().copyFile(src, dest, mode);
  }
  async cp(src, dest, options) {
    return this.getWriteFs().cp(src, dest, options);
  }
  async rm(path, options) {
    return this.getWriteFs().rm(path, options);
  }
  async chmod(path, mode) {
    return this.getWriteFs().chmod(path, mode);
  }
  async chown(path, uid, gid) {
    return this.getWriteFs().chown(path, uid, gid);
  }
  async utimes(path, atime, mtime) {
    return this.getWriteFs().utimes(path, atime, mtime);
  }
  async lutimes(path, atime, mtime) {
    return this.getWriteFs().lutimes(path, atime, mtime);
  }
  async mkdtemp(prefix) {
    return this.getWriteFs().mkdtemp(prefix);
  }
  /**
   * Reset internal caches on both backends
   */
  async resetCache() {
    this.mainFs.resetCache();
    if (this.workerFs) {
      await this.workerFs.resetCache();
    }
  }
  /**
   * Force full garbage collection on both backends
   * More aggressive than resetCache() - reinitializes the worker's OPFS instance
   */
  async gc() {
    this.mainFs.resetCache();
    if (this.workerFs) {
      await this.workerFs.gc();
    }
  }
};

// src/index.ts
var OPFS = class {
  useSync;
  verbose;
  handleManager;
  symlinkManager;
  packedStorage;
  watchCallbacks = /* @__PURE__ */ new Map();
  tmpCounter = 0;
  /** Hybrid instance when workerUrl is provided */
  hybrid = null;
  /** File system constants */
  constants = constants;
  constructor(options = {}) {
    const { useSync = true, verbose = false, useCompression = false, useChecksum = true, workerUrl, read, write } = options;
    this.verbose = verbose;
    if (workerUrl) {
      this.hybrid = new OPFSHybrid({
        workerUrl,
        read: read ?? "main",
        write: write ?? "worker",
        verbose
      });
      this.useSync = false;
      this.handleManager = new HandleManager();
      this.symlinkManager = new SymlinkManager(this.handleManager, false);
      this.packedStorage = new PackedStorage(this.handleManager, false, useCompression, useChecksum);
    } else {
      this.useSync = useSync && typeof FileSystemFileHandle !== "undefined" && "createSyncAccessHandle" in FileSystemFileHandle.prototype;
      this.handleManager = new HandleManager();
      this.symlinkManager = new SymlinkManager(this.handleManager, this.useSync);
      this.packedStorage = new PackedStorage(this.handleManager, this.useSync, useCompression, useChecksum);
    }
  }
  /**
   * Wait for the filesystem to be ready (only needed for hybrid mode)
   */
  async ready() {
    if (this.hybrid) {
      await this.hybrid.ready();
    }
  }
  /**
   * Terminate any background workers (only needed for hybrid mode)
   */
  terminate() {
    if (this.hybrid) {
      this.hybrid.terminate();
    }
  }
  log(method, ...args) {
    if (this.verbose) {
      console.log(`[OPFS] ${method}:`, ...args);
    }
  }
  logError(method, err) {
    if (this.verbose) {
      console.error(`[OPFS] ${method} error:`, err);
    }
  }
  /**
   * Execute tasks with limited concurrency to avoid overwhelming the system
   * @param items - Array of items to process
   * @param maxConcurrent - Maximum number of concurrent operations (default: 10)
   * @param taskFn - Function to execute for each item
   */
  async limitConcurrency(items, maxConcurrent, taskFn) {
    if (items.length === 0) return;
    if (items.length <= 2) {
      for (const item of items) {
        await taskFn(item);
      }
      return;
    }
    if (items.length <= maxConcurrent) {
      await Promise.all(items.map(taskFn));
      return;
    }
    const queue = [...items];
    const workers = Array.from({ length: maxConcurrent }).map(async () => {
      while (queue.length) {
        const item = queue.shift();
        if (item !== void 0) await taskFn(item);
      }
    });
    await Promise.all(workers);
  }
  /**
   * Read file contents
   */
  async readFile(path, options = {}) {
    if (this.hybrid) {
      return this.hybrid.readFile(path, options);
    }
    this.log("readFile", path, options);
    try {
      const normalizedPath = normalize(path);
      const resolvedPath = await this.symlinkManager.resolve(normalizedPath);
      let fileHandle = null;
      try {
        fileHandle = await this.handleManager.getPooledFileHandle(resolvedPath);
      } catch {
      }
      if (fileHandle) {
        let buffer;
        if (this.useSync) {
          const access = await fileHandle.createSyncAccessHandle();
          try {
            const size = access.getSize();
            buffer = new Uint8Array(size);
            access.read(buffer);
          } finally {
            access.close();
          }
        } else {
          const file = await fileHandle.getFile();
          buffer = new Uint8Array(await file.arrayBuffer());
        }
        return options.encoding ? new TextDecoder(options.encoding).decode(buffer) : buffer;
      }
      const packedData = await this.packedStorage.read(resolvedPath);
      if (packedData) {
        return options.encoding ? new TextDecoder(options.encoding).decode(packedData) : packedData;
      }
      throw createENOENT(path);
    } catch (err) {
      this.logError("readFile", err);
      throw wrapError(err);
    }
  }
  /**
   * Read multiple files efficiently in a batch operation
   * Uses packed storage batch read (single index load), falls back to individual files
   * Returns results in the same order as input paths
   */
  async readFileBatch(paths) {
    if (this.hybrid) {
      return this.hybrid.readFileBatch(paths);
    }
    this.log("readFileBatch", `${paths.length} files`);
    if (paths.length === 0) return [];
    try {
      const resolvedPaths = await Promise.all(
        paths.map(async (path) => {
          const normalizedPath = normalize(path);
          return this.symlinkManager.resolve(normalizedPath);
        })
      );
      const packedResults = await this.packedStorage.readBatch(resolvedPaths);
      const results = new Array(paths.length);
      const needsIndividualRead = [];
      for (let i = 0; i < paths.length; i++) {
        const packedData = packedResults.get(resolvedPaths[i]);
        if (packedData) {
          results[i] = { path: paths[i], data: packedData };
        } else {
          needsIndividualRead.push({ index: i, resolvedPath: resolvedPaths[i] });
        }
      }
      if (needsIndividualRead.length > 0) {
        await Promise.all(
          needsIndividualRead.map(async ({ index, resolvedPath }) => {
            try {
              const fileHandle = await this.handleManager.getPooledFileHandle(resolvedPath);
              if (!fileHandle) {
                results[index] = { path: paths[index], data: null, error: createENOENT(paths[index]) };
                return;
              }
              let buffer;
              if (this.useSync) {
                const access = await fileHandle.createSyncAccessHandle();
                try {
                  const size = access.getSize();
                  buffer = new Uint8Array(size);
                  access.read(buffer);
                } finally {
                  access.close();
                }
              } else {
                const file = await fileHandle.getFile();
                buffer = new Uint8Array(await file.arrayBuffer());
              }
              results[index] = { path: paths[index], data: buffer };
            } catch (err) {
              results[index] = { path: paths[index], data: null, error: err };
            }
          })
        );
      }
      return results;
    } catch (err) {
      this.logError("readFileBatch", err);
      throw wrapError(err);
    }
  }
  /**
   * Write data to a file
   */
  async writeFile(path, data, options = {}) {
    if (this.hybrid) {
      return this.hybrid.writeFile(path, data, options);
    }
    this.log("writeFile", path);
    try {
      const normalizedPath = normalize(path);
      const resolvedPath = await this.symlinkManager.resolve(normalizedPath);
      const { fileHandle } = await this.handleManager.getHandle(resolvedPath, { create: true });
      const buffer = typeof data === "string" ? new TextEncoder().encode(data) : data;
      if (this.useSync) {
        const access = await fileHandle.createSyncAccessHandle();
        try {
          access.truncate(buffer.length);
          access.write(buffer, { at: 0 });
        } finally {
          access.close();
        }
      } else {
        const writable = await fileHandle.createWritable();
        await writable.write(buffer);
        await writable.close();
      }
    } catch (err) {
      this.logError("writeFile", err);
      throw wrapError(err);
    }
  }
  /**
   * Write multiple files efficiently in a batch operation
   * Uses packed storage (single file) for maximum performance
   */
  async writeFileBatch(entries) {
    if (this.hybrid) {
      return this.hybrid.writeFileBatch(entries);
    }
    this.log("writeFileBatch", `${entries.length} files`);
    if (entries.length === 0) return;
    try {
      const encoder = new TextEncoder();
      const packEntries = await Promise.all(
        entries.map(async ({ path, data }) => {
          const normalizedPath = normalize(path);
          const resolvedPath = await this.symlinkManager.resolve(normalizedPath);
          return {
            path: resolvedPath,
            data: typeof data === "string" ? encoder.encode(data) : data
          };
        })
      );
      await this.packedStorage.writeBatch(packEntries);
    } catch (err) {
      this.logError("writeFileBatch", err);
      throw wrapError(err);
    }
  }
  /**
   * Create a directory
   */
  async mkdir(path) {
    if (this.hybrid) {
      return this.hybrid.mkdir(path);
    }
    this.log("mkdir", path);
    try {
      await this.handleManager.mkdir(path);
    } catch (err) {
      this.logError("mkdir", err);
      throw wrapError(err);
    }
  }
  /**
   * Remove a directory
   */
  async rmdir(path) {
    if (this.hybrid) {
      return this.hybrid.rmdir(path);
    }
    this.log("rmdir", path);
    try {
      const normalizedPath = normalize(path);
      this.handleManager.clearCache(normalizedPath);
      if (isRoot(normalizedPath)) {
        const root = await this.handleManager.getRoot();
        const entries = [];
        for await (const [name2] of root.entries()) {
          entries.push(name2);
        }
        await this.limitConcurrency(
          entries,
          10,
          (name2) => root.removeEntry(name2, { recursive: true })
        );
        this.symlinkManager.reset();
        this.packedStorage.reset();
        return;
      }
      const pathSegments = segments(normalizedPath);
      const name = pathSegments.pop();
      let dir = await this.handleManager.getRoot();
      for (const part of pathSegments) {
        dir = await dir.getDirectoryHandle(part);
      }
      try {
        await dir.removeEntry(name, { recursive: true });
      } catch {
        throw createENOENT(path);
      }
    } catch (err) {
      this.logError("rmdir", err);
      throw wrapError(err);
    }
  }
  /**
   * Remove a file or symlink
   */
  async unlink(path) {
    if (this.hybrid) {
      return this.hybrid.unlink(path);
    }
    this.log("unlink", path);
    try {
      const normalizedPath = normalize(path);
      this.handleManager.clearCache(normalizedPath);
      const isSymlink = await this.symlinkManager.isSymlink(normalizedPath);
      if (isSymlink) {
        await this.symlinkManager.unlink(normalizedPath);
        return;
      }
      const inPack = await this.packedStorage.has(normalizedPath);
      if (inPack) {
        await this.packedStorage.remove(normalizedPath);
        return;
      }
      const { dir, name, fileHandle } = await this.handleManager.getHandle(normalizedPath);
      if (!fileHandle) throw createENOENT(path);
      try {
        await dir.removeEntry(name);
      } catch {
        throw createENOENT(path);
      }
    } catch (err) {
      this.logError("unlink", err);
      throw wrapError(err);
    }
  }
  /**
   * Read directory contents
   */
  async readdir(path, options) {
    if (this.hybrid) {
      return this.hybrid.readdir(path, options);
    }
    this.log("readdir", path, options);
    try {
      const normalizedPath = normalize(path);
      const resolvedPath = await this.symlinkManager.resolve(normalizedPath);
      const dir = await this.handleManager.getDirectoryHandle(resolvedPath);
      const withFileTypes = options?.withFileTypes === true;
      const symlinksInDir = await this.symlinkManager.getSymlinksInDir(resolvedPath);
      const hasSymlinks = symlinksInDir.length > 0;
      const symlinkSet = hasSymlinks ? new Set(symlinksInDir) : null;
      const entryNames = /* @__PURE__ */ new Set();
      const entries = [];
      for await (const [name, handle] of dir.entries()) {
        if (this.symlinkManager.isMetadataFile(name)) continue;
        entryNames.add(name);
        if (withFileTypes) {
          const isSymlink = hasSymlinks && symlinkSet.has(name);
          entries.push({
            name,
            isFile: () => !isSymlink && handle.kind === "file",
            isDirectory: () => !isSymlink && handle.kind === "directory",
            isSymbolicLink: () => isSymlink
          });
        } else {
          entries.push(name);
        }
      }
      if (hasSymlinks) {
        for (const name of symlinksInDir) {
          if (!entryNames.has(name)) {
            if (withFileTypes) {
              entries.push({
                name,
                isFile: () => false,
                isDirectory: () => false,
                isSymbolicLink: () => true
              });
            } else {
              entries.push(name);
            }
          }
        }
      }
      return entries;
    } catch (err) {
      this.logError("readdir", err);
      throw wrapError(err);
    }
  }
  /**
   * Get file/directory statistics (follows symlinks)
   */
  async stat(path) {
    if (this.hybrid) {
      return this.hybrid.stat(path);
    }
    this.log("stat", path);
    try {
      const normalizedPath = normalize(path);
      const resolvedPath = await this.symlinkManager.resolve(normalizedPath);
      const defaultDate = /* @__PURE__ */ new Date(0);
      if (isRoot(resolvedPath)) {
        return {
          type: "dir",
          size: 0,
          mode: 16877,
          ctime: defaultDate,
          ctimeMs: 0,
          mtime: defaultDate,
          mtimeMs: 0,
          isFile: () => false,
          isDirectory: () => true,
          isSymbolicLink: () => false
        };
      }
      const pathSegments = segments(resolvedPath);
      const name = pathSegments.pop();
      let dir = await this.handleManager.getRoot();
      for (const part of pathSegments) {
        try {
          dir = await dir.getDirectoryHandle(part);
        } catch {
          throw createENOENT(path);
        }
      }
      const [fileResult, dirResult] = await Promise.allSettled([
        dir.getFileHandle(name),
        dir.getDirectoryHandle(name)
      ]);
      if (fileResult.status === "fulfilled") {
        const fileHandle = fileResult.value;
        const file = await fileHandle.getFile();
        const mtime = file.lastModified ? new Date(file.lastModified) : defaultDate;
        return {
          type: "file",
          size: file.size,
          mode: 33188,
          ctime: mtime,
          ctimeMs: mtime.getTime(),
          mtime,
          mtimeMs: mtime.getTime(),
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false
        };
      }
      if (dirResult.status === "fulfilled") {
        return {
          type: "dir",
          size: 0,
          mode: 16877,
          ctime: defaultDate,
          ctimeMs: 0,
          mtime: defaultDate,
          mtimeMs: 0,
          isFile: () => false,
          isDirectory: () => true,
          isSymbolicLink: () => false
        };
      }
      const packedSize = await this.packedStorage.getSize(resolvedPath);
      if (packedSize !== null) {
        return {
          type: "file",
          size: packedSize,
          mode: 33188,
          ctime: defaultDate,
          ctimeMs: 0,
          mtime: defaultDate,
          mtimeMs: 0,
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false
        };
      }
      throw createENOENT(path);
    } catch (err) {
      this.logError("stat", err);
      throw wrapError(err);
    }
  }
  /**
   * Get file/directory statistics (does not follow symlinks)
   */
  async lstat(path) {
    if (this.hybrid) {
      return this.hybrid.lstat(path);
    }
    this.log("lstat", path);
    try {
      const normalizedPath = normalize(path);
      const isSymlink = await this.symlinkManager.isSymlink(normalizedPath);
      if (isSymlink) {
        const target = await this.symlinkManager.readlink(normalizedPath);
        return {
          type: "symlink",
          target,
          size: target.length,
          mode: 41471,
          ctime: /* @__PURE__ */ new Date(0),
          ctimeMs: 0,
          mtime: /* @__PURE__ */ new Date(0),
          mtimeMs: 0,
          isFile: () => false,
          isDirectory: () => false,
          isSymbolicLink: () => true
        };
      }
      return this.stat(path);
    } catch (err) {
      this.logError("lstat", err);
      throw wrapError(err);
    }
  }
  /**
   * Rename a file or directory
   */
  async rename(oldPath, newPath) {
    if (this.hybrid) {
      return this.hybrid.rename(oldPath, newPath);
    }
    this.log("rename", oldPath, newPath);
    try {
      const normalizedOld = normalize(oldPath);
      const normalizedNew = normalize(newPath);
      this.handleManager.clearCache(normalizedOld);
      this.handleManager.clearCache(normalizedNew);
      const renamed = await this.symlinkManager.rename(normalizedOld, normalizedNew);
      if (renamed) return;
      const stat = await this.stat(normalizedOld);
      if (stat.isFile()) {
        const [data] = await Promise.all([
          this.readFile(normalizedOld),
          this.handleManager.ensureParentDir(normalizedNew)
        ]);
        await this.writeFile(normalizedNew, data);
        await this.unlink(normalizedOld);
      } else if (stat.isDirectory()) {
        await this.mkdir(normalizedNew);
        const entries = await this.readdir(normalizedOld);
        await this.limitConcurrency(
          entries,
          10,
          (entry) => this.rename(`${normalizedOld}/${entry}`, `${normalizedNew}/${entry}`)
        );
        await this.rmdir(normalizedOld);
      }
    } catch (err) {
      this.logError("rename", err);
      throw wrapError(err);
    }
  }
  /**
   * Create a symbolic link
   */
  async symlink(target, path) {
    if (this.hybrid) {
      return this.hybrid.symlink(target, path);
    }
    this.log("symlink", target, path);
    try {
      const normalizedPath = normalize(path);
      this.handleManager.clearCache(normalizedPath);
      await this.symlinkManager.symlink(target, path, async () => {
        const { fileHandle, dirHandle } = await this.handleManager.getHandle(normalizedPath);
        if (fileHandle || dirHandle) {
          throw createEEXIST(path);
        }
      });
    } catch (err) {
      this.logError("symlink", err);
      throw wrapError(err);
    }
  }
  /**
   * Read symlink target
   */
  async readlink(path) {
    if (this.hybrid) {
      return this.hybrid.readlink(path);
    }
    this.log("readlink", path);
    try {
      return await this.symlinkManager.readlink(path);
    } catch (err) {
      this.logError("readlink", err);
      throw wrapError(err);
    }
  }
  /**
   * Create multiple symlinks efficiently
   */
  async symlinkBatch(links) {
    if (this.hybrid) {
      return this.hybrid.symlinkBatch(links);
    }
    this.log("symlinkBatch", links.length, "links");
    try {
      for (const { path } of links) {
        this.handleManager.clearCache(normalize(path));
      }
      await this.symlinkManager.symlinkBatch(links, async (normalizedPath) => {
        try {
          const { fileHandle, dirHandle } = await this.handleManager.getHandle(normalizedPath);
          if (fileHandle || dirHandle) {
            throw createEEXIST(normalizedPath);
          }
        } catch (err) {
          if (err.code === "ENOENT") return;
          throw err;
        }
      });
    } catch (err) {
      this.logError("symlinkBatch", err);
      throw wrapError(err);
    }
  }
  /**
   * Check file accessibility
   */
  async access(path, mode = constants.F_OK) {
    if (this.hybrid) {
      return this.hybrid.access(path, mode);
    }
    this.log("access", path, mode);
    try {
      const normalizedPath = normalize(path);
      await this.stat(normalizedPath);
    } catch (err) {
      this.logError("access", err);
      throw createEACCES(path);
    }
  }
  /**
   * Append data to a file
   */
  async appendFile(path, data, options = {}) {
    if (this.hybrid) {
      return this.hybrid.appendFile(path, data, options);
    }
    this.log("appendFile", path);
    try {
      const normalizedPath = normalize(path);
      const resolvedPath = await this.symlinkManager.resolve(normalizedPath);
      let existingData = new Uint8Array(0);
      try {
        const result = await this.readFile(resolvedPath);
        existingData = result instanceof Uint8Array ? result : new TextEncoder().encode(result);
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
      const newData = typeof data === "string" ? new TextEncoder().encode(data) : data;
      const combined = new Uint8Array(existingData.length + newData.length);
      combined.set(existingData, 0);
      combined.set(newData, existingData.length);
      await this.writeFile(resolvedPath, combined, options);
    } catch (err) {
      this.logError("appendFile", err);
      throw wrapError(err);
    }
  }
  /**
   * Copy a file
   */
  async copyFile(src, dest, mode = 0) {
    if (this.hybrid) {
      return this.hybrid.copyFile(src, dest, mode);
    }
    this.log("copyFile", src, dest, mode);
    try {
      const normalizedSrc = normalize(src);
      const normalizedDest = normalize(dest);
      const resolvedSrc = await this.symlinkManager.resolve(normalizedSrc);
      if (mode & constants.COPYFILE_EXCL) {
        try {
          await this.stat(normalizedDest);
          throw createEEXIST(dest);
        } catch (err) {
          if (err.code !== "ENOENT") throw err;
        }
      }
      const [data] = await Promise.all([
        this.readFile(resolvedSrc),
        this.handleManager.ensureParentDir(normalizedDest)
      ]);
      await this.writeFile(normalizedDest, data);
    } catch (err) {
      this.logError("copyFile", err);
      throw wrapError(err);
    }
  }
  /**
   * Copy files/directories recursively
   */
  async cp(src, dest, options = {}) {
    if (this.hybrid) {
      return this.hybrid.cp(src, dest, options);
    }
    this.log("cp", src, dest, options);
    try {
      const normalizedSrc = normalize(src);
      const normalizedDest = normalize(dest);
      const { recursive = false, force = false, errorOnExist = false } = options;
      const srcStat = await this.stat(normalizedSrc);
      if (srcStat.isDirectory()) {
        if (!recursive) {
          throw createEISDIR(src);
        }
        let destExists = false;
        try {
          await this.stat(normalizedDest);
          destExists = true;
          if (errorOnExist && !force) {
            throw createEEXIST(dest);
          }
        } catch (err) {
          if (err.code !== "ENOENT") throw err;
        }
        if (!destExists) {
          await this.mkdir(normalizedDest);
        }
        const entries = await this.readdir(normalizedSrc);
        await this.limitConcurrency(
          entries,
          10,
          (entry) => this.cp(`${normalizedSrc}/${entry}`, `${normalizedDest}/${entry}`, options)
        );
      } else {
        if (errorOnExist) {
          try {
            await this.stat(normalizedDest);
            throw createEEXIST(dest);
          } catch (err) {
            if (err.code !== "ENOENT") throw err;
          }
        }
        await this.copyFile(normalizedSrc, normalizedDest);
      }
    } catch (err) {
      this.logError("cp", err);
      throw wrapError(err);
    }
  }
  /**
   * Check if path exists
   */
  async exists(path) {
    if (this.hybrid) {
      return this.hybrid.exists(path);
    }
    this.log("exists", path);
    try {
      await this.stat(normalize(path));
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Resolve symlinks to get real path
   */
  async realpath(path) {
    if (this.hybrid) {
      return this.hybrid.realpath(path);
    }
    this.log("realpath", path);
    const normalizedPath = normalize(path);
    return this.symlinkManager.resolve(normalizedPath);
  }
  /**
   * Remove files and directories
   */
  async rm(path, options = {}) {
    if (this.hybrid) {
      return this.hybrid.rm(path, options);
    }
    this.log("rm", path, options);
    try {
      const normalizedPath = normalize(path);
      const { recursive = false, force = false } = options;
      try {
        const stat = await this.lstat(normalizedPath);
        if (stat.isSymbolicLink()) {
          await this.unlink(normalizedPath);
        } else if (stat.isDirectory()) {
          if (!recursive) {
            throw createEISDIR(path);
          }
          await this.rmdir(normalizedPath);
        } else {
          await this.unlink(normalizedPath);
        }
      } catch (err) {
        if (err.code === "ENOENT" && force) {
          return;
        }
        throw err;
      }
    } catch (err) {
      this.logError("rm", err);
      throw wrapError(err);
    }
  }
  /**
   * Truncate file to specified length
   */
  async truncate(path, len = 0) {
    if (this.hybrid) {
      return this.hybrid.truncate(path, len);
    }
    this.log("truncate", path, len);
    try {
      const normalizedPath = normalize(path);
      const resolvedPath = await this.symlinkManager.resolve(normalizedPath);
      this.handleManager.clearCache(resolvedPath);
      const { fileHandle } = await this.handleManager.getHandle(resolvedPath);
      if (!fileHandle) throw createENOENT(path);
      if (this.useSync) {
        const access = await fileHandle.createSyncAccessHandle();
        try {
          access.truncate(len);
        } finally {
          access.close();
        }
      } else {
        const file = await fileHandle.getFile();
        const data = new Uint8Array(await file.arrayBuffer());
        const finalData = new Uint8Array(len);
        const copyLen = Math.min(len, data.length);
        if (copyLen > 0) {
          finalData.set(data.subarray(0, copyLen), 0);
        }
        const writable = await fileHandle.createWritable();
        await writable.write(finalData);
        await writable.close();
      }
    } catch (err) {
      this.logError("truncate", err);
      throw wrapError(err);
    }
  }
  /**
   * Create a unique temporary directory
   */
  async mkdtemp(prefix) {
    if (this.hybrid) {
      return this.hybrid.mkdtemp(prefix);
    }
    this.log("mkdtemp", prefix);
    try {
      const normalizedPrefix = normalize(prefix);
      const suffix = `${Date.now()}-${++this.tmpCounter}-${Math.random().toString(36).slice(2, 8)}`;
      const path = `${normalizedPrefix}${suffix}`;
      await this.mkdir(path);
      return path;
    } catch (err) {
      this.logError("mkdtemp", err);
      throw wrapError(err);
    }
  }
  /**
   * Change file mode (no-op for OPFS compatibility)
   */
  async chmod(path, mode) {
    if (this.hybrid) {
      return this.hybrid.chmod(path, mode);
    }
    this.log("chmod", path, mode);
    await this.stat(normalize(path));
  }
  /**
   * Change file owner (no-op for OPFS compatibility)
   */
  async chown(path, uid, gid) {
    if (this.hybrid) {
      return this.hybrid.chown(path, uid, gid);
    }
    this.log("chown", path, uid, gid);
    await this.stat(normalize(path));
  }
  /**
   * Update file timestamps (no-op for OPFS compatibility)
   */
  async utimes(path, atime, mtime) {
    if (this.hybrid) {
      return this.hybrid.utimes(path, atime, mtime);
    }
    this.log("utimes", path, atime, mtime);
    await this.stat(normalize(path));
  }
  /**
   * Update symlink timestamps (no-op)
   */
  async lutimes(path, atime, mtime) {
    if (this.hybrid) {
      return this.hybrid.lutimes(path, atime, mtime);
    }
    this.log("lutimes", path, atime, mtime);
    await this.lstat(normalize(path));
  }
  /**
   * Open file and return FileHandle
   */
  async open(path, flags = "r", mode = 438) {
    this.log("open", path, flags, mode);
    try {
      const normalizedPath = normalize(path);
      const flagStr = flagsToString(flags);
      const shouldCreate = flagStr.includes("w") || flagStr.includes("a") || flagStr.includes("+");
      const shouldTruncate = flagStr.includes("w");
      const shouldAppend = flagStr.includes("a");
      if (shouldCreate) {
        await this.handleManager.ensureParentDir(normalizedPath);
      }
      const resolvedPath = await this.symlinkManager.resolve(normalizedPath);
      const { fileHandle } = await this.handleManager.getHandle(resolvedPath, { create: shouldCreate });
      if (!fileHandle && !shouldCreate) {
        throw createENOENT(path);
      }
      if (shouldTruncate && fileHandle) {
        await this.truncate(resolvedPath, 0);
      }
      const initialPosition = shouldAppend ? (await this.stat(resolvedPath)).size : 0;
      return createFileHandle(resolvedPath, initialPosition, {
        readFile: (p, o) => this.readFile(p, o),
        writeFile: (p, d) => this.writeFile(p, d),
        stat: (p) => this.stat(p),
        truncate: (p, l) => this.truncate(p, l),
        appendFile: (p, d, o) => this.appendFile(p, d, o)
      });
    } catch (err) {
      this.logError("open", err);
      throw wrapError(err);
    }
  }
  /**
   * Open directory for iteration
   */
  async opendir(path) {
    this.log("opendir", path);
    try {
      const normalizedPath = normalize(path);
      const entries = await this.readdir(normalizedPath, { withFileTypes: true });
      let index = 0;
      return {
        path: normalizedPath,
        async read() {
          if (index >= entries.length) return null;
          return entries[index++];
        },
        async close() {
          index = entries.length;
        },
        async *[Symbol.asyncIterator]() {
          for (const entry of entries) {
            yield entry;
          }
        }
      };
    } catch (err) {
      this.logError("opendir", err);
      throw wrapError(err);
    }
  }
  /**
   * Watch for file changes
   */
  watch(path, options = {}) {
    this.log("watch", path, options);
    const normalizedPath = normalize(path);
    const { recursive = false, signal } = options;
    const callbacks = /* @__PURE__ */ new Set();
    const id = /* @__PURE__ */ Symbol("watcher");
    this.watchCallbacks.set(id, { path: normalizedPath, callbacks, recursive });
    if (signal) {
      signal.addEventListener("abort", () => {
        this.watchCallbacks.delete(id);
      });
    }
    const self2 = this;
    return {
      close() {
        self2.watchCallbacks.delete(id);
      },
      ref() {
        return this;
      },
      unref() {
        return this;
      },
      [Symbol.asyncIterator]() {
        const queue = [];
        let resolver = null;
        callbacks.add((eventType, filename) => {
          const event = { eventType, filename };
          if (resolver) {
            resolver({ value: event, done: false });
            resolver = null;
          } else {
            queue.push(event);
          }
        });
        return {
          next() {
            if (queue.length > 0) {
              return Promise.resolve({ value: queue.shift(), done: false });
            }
            return new Promise((resolve) => {
              resolver = resolve;
            });
          },
          return() {
            return Promise.resolve({ done: true, value: void 0 });
          }
        };
      }
    };
  }
  /**
   * Create read stream
   */
  createReadStream(path, options = {}) {
    this.log("createReadStream", path, options);
    const normalizedPath = normalize(path);
    return createReadStream(normalizedPath, options, {
      readFile: (p) => this.readFile(p)
    });
  }
  /**
   * Create write stream
   */
  createWriteStream(path, options = {}) {
    this.log("createWriteStream", path, options);
    const normalizedPath = normalize(path);
    return createWriteStream(normalizedPath, options, {
      readFile: (p) => this.readFile(p),
      writeFile: (p, d) => this.writeFile(p, d)
    });
  }
  /**
   * Get file statistics (alias for stat)
   */
  async backFile(path) {
    this.log("backFile", path);
    try {
      return await this.stat(normalize(path));
    } catch (err) {
      if (err.code === "ENOENT") throw err;
      throw createENOENT(path);
    }
  }
  /**
   * Get disk usage for a path
   */
  async du(path) {
    if (this.hybrid) {
      return this.hybrid.du(path);
    }
    this.log("du", path);
    const normalizedPath = normalize(path);
    const stat = await this.stat(normalizedPath);
    return { path: normalizedPath, size: stat.size };
  }
  /**
   * Get filesystem statistics (similar to Node.js fs.statfs)
   * Uses the Storage API to get quota and usage information
   * Note: Values are estimates for the entire origin, not per-path
   */
  async statfs(path) {
    if (this.hybrid) {
      return this.hybrid.statfs(path);
    }
    this.log("statfs", path);
    try {
      if (path) {
        await this.stat(normalize(path));
      }
      if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
        throw new Error("Storage API not available");
      }
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage ?? 0;
      const quota = estimate.quota ?? 0;
      const bsize = 4096;
      return {
        type: 0,
        bsize,
        blocks: Math.floor(quota / bsize),
        bfree: Math.floor((quota - usage) / bsize),
        bavail: Math.floor((quota - usage) / bsize),
        files: 0,
        ffree: 0,
        usage,
        quota
      };
    } catch (err) {
      this.logError("statfs", err);
      throw wrapError(err);
    }
  }
  /**
   * Reset internal caches
   * Useful when external processes modify the filesystem
   */
  resetCache() {
    if (this.hybrid) {
      this.hybrid.resetCache();
      return;
    }
    this.symlinkManager.reset();
    this.packedStorage.reset();
    this.handleManager.clearCache();
  }
  /**
   * Force full garbage collection
   * Releases all handles and caches, reinitializes the worker in hybrid mode
   * Use this for long-running operations to prevent memory leaks
   */
  async gc() {
    if (this.hybrid) {
      await this.hybrid.gc();
      return;
    }
    this.symlinkManager.reset();
    await this.packedStorage.clear();
    this.handleManager.clearCache();
  }
};

// src/opfs-worker.ts
var fs = null;
function getFS() {
  if (!fs) {
    fs = new OPFS({ useSync: true, verbose: false });
  }
  return fs;
}
self.onmessage = async (event) => {
  const { id, method, args } = event.data;
  try {
    const opfs = getFS();
    let result;
    const transfer = [];
    switch (method) {
      // File operations
      case "readFile": {
        const data = await opfs.readFile(args[0], args[1]);
        if (data instanceof Uint8Array) {
          result = data;
          transfer.push(data.buffer);
        } else {
          result = data;
        }
        break;
      }
      case "writeFile":
        await opfs.writeFile(args[0], args[1], args[2]);
        result = void 0;
        break;
      case "readFileBatch": {
        const results = await opfs.readFileBatch(args[0]);
        for (const r of results) {
          if (r.data) {
            transfer.push(r.data.buffer);
          }
        }
        result = results;
        break;
      }
      case "writeFileBatch":
        await opfs.writeFileBatch(args[0]);
        result = void 0;
        break;
      case "appendFile":
        await opfs.appendFile(args[0], args[1], args[2]);
        result = void 0;
        break;
      case "copyFile":
        await opfs.copyFile(args[0], args[1], args[2]);
        result = void 0;
        break;
      case "unlink":
        await opfs.unlink(args[0]);
        result = void 0;
        break;
      case "truncate":
        await opfs.truncate(args[0], args[1]);
        result = void 0;
        break;
      // Directory operations
      case "mkdir":
        await opfs.mkdir(args[0]);
        result = void 0;
        break;
      case "rmdir":
        await opfs.rmdir(args[0]);
        result = void 0;
        break;
      case "readdir":
        result = await opfs.readdir(args[0], args[1]);
        break;
      case "cp":
        await opfs.cp(args[0], args[1], args[2]);
        result = void 0;
        break;
      case "rm":
        await opfs.rm(args[0], args[1]);
        result = void 0;
        break;
      // Stat operations
      case "stat":
        result = serializeStats(await opfs.stat(args[0]));
        break;
      case "lstat":
        result = serializeStats(await opfs.lstat(args[0]));
        break;
      case "exists":
        result = await opfs.exists(args[0]);
        break;
      case "access":
        await opfs.access(args[0], args[1]);
        result = void 0;
        break;
      case "statfs":
        result = await opfs.statfs(args[0]);
        break;
      case "du":
        result = await opfs.du(args[0]);
        break;
      // Symlink operations
      case "symlink":
        await opfs.symlink(args[0], args[1]);
        result = void 0;
        break;
      case "readlink":
        result = await opfs.readlink(args[0]);
        break;
      case "symlinkBatch":
        await opfs.symlinkBatch(args[0]);
        result = void 0;
        break;
      case "realpath":
        result = await opfs.realpath(args[0]);
        break;
      // Other operations
      case "rename":
        await opfs.rename(args[0], args[1]);
        result = void 0;
        break;
      case "mkdtemp":
        result = await opfs.mkdtemp(args[0]);
        break;
      case "chmod":
        await opfs.chmod(args[0], args[1]);
        result = void 0;
        break;
      case "chown":
        await opfs.chown(args[0], args[1], args[2]);
        result = void 0;
        break;
      case "utimes":
        await opfs.utimes(args[0], args[1], args[2]);
        result = void 0;
        break;
      case "lutimes":
        await opfs.lutimes(args[0], args[1], args[2]);
        result = void 0;
        break;
      case "resetCache":
        opfs.resetCache();
        result = void 0;
        break;
      case "gc":
        fs = null;
        fs = new OPFS({ useSync: true, verbose: false });
        result = void 0;
        break;
      default:
        throw new Error(`Unknown method: ${method}`);
    }
    const response = { id, result };
    if (transfer.length > 0) {
      self.postMessage(response, transfer);
    } else {
      self.postMessage(response);
    }
  } catch (err) {
    const error = err;
    const response = {
      id,
      error: {
        message: error.message,
        code: error.code
      }
    };
    self.postMessage(response);
  }
};
function serializeStats(stats) {
  return {
    type: stats.type,
    size: stats.size,
    mode: stats.mode,
    ctime: stats.ctime.toISOString(),
    ctimeMs: stats.ctimeMs,
    mtime: stats.mtime.toISOString(),
    mtimeMs: stats.mtimeMs,
    target: stats.target
  };
}
self.postMessage({ type: "ready" });
//# sourceMappingURL=opfs-worker.js.map
//# sourceMappingURL=opfs-worker.js.map