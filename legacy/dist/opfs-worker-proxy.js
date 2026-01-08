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

export { OPFSWorker };
//# sourceMappingURL=opfs-worker-proxy.js.map
//# sourceMappingURL=opfs-worker-proxy.js.map