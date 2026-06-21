// src/drives/manager.ts
var STREAM_THRESHOLD = 4 * 1024 * 1024;
function join(dir, name) {
  if (dir === "/" || dir === "") return "/" + name;
  return dir.replace(/\/$/, "") + "/" + name;
}
function normPath(p) {
  const parts = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return "/" + parts.join("/");
}
var DriveManager = class {
  drives = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  // ---- registry ----
  mount(drive) {
    if (this.drives.has(drive.id)) throw new Error(`drive already mounted: ${drive.id}`);
    this.drives.set(drive.id, drive);
    this.emit({ type: "mounted", drive });
    return drive;
  }
  async unmount(id) {
    const d = this.drives.get(id);
    if (!d) return;
    this.drives.delete(id);
    try {
      await d.dispose?.();
    } finally {
      this.emit({ type: "unmounted", id });
    }
  }
  get(id) {
    return this.drives.get(id);
  }
  list() {
    return [...this.drives.values()];
  }
  has(id) {
    return this.drives.has(id);
  }
  /** drivers call this when a drive's state/label changes (e.g. OAuth completes). */
  notifyChanged(id) {
    if (this.drives.has(id)) this.emit({ type: "changed", id });
  }
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(e) {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {
      }
    }
  }
  // ---- transfer ----
  /**
   * Copy (or move) a file or directory tree from one drive to another, emitting
   * progress. Pre-walks the source to compute totals so the Finder bar is exact,
   * then copies file-by-file. On `move`, sources are removed only after the whole
   * tree copies successfully (fast in-drive rename when src===dst).
   *
   * Semantics worth knowing:
   * - Directory copies **merge** into an existing destination (per-file overwrite
   *   governed by `opts.overwrite`); they do not replace it wholesale.
   * - A cross-drive `move` is copy-then-delete, so it is **not atomic** — an abort
   *   or error mid-transfer can leave a partial copy at the destination with the
   *   source still intact. Same-drive moves use the drive's atomic `rename`.
   * - `opts.signal` cancels between files and mid-file during streaming, rejecting
   *   with an `AbortError`.
   */
  async transfer(src, srcPath, dst, dstPath, opts = {}) {
    const { move = false, overwrite = true, onProgress, signal } = opts;
    srcPath = normPath(srcPath);
    dstPath = normPath(dstPath);
    if (src === dst) {
      const st = await src.stat(srcPath);
      const totalBytes2 = st.type === "dir" ? 0 : st.size;
      await dst.mkdir(parentOf(dstPath), { recursive: true });
      if (move) {
        await src.rename(srcPath, dstPath);
        onProgress?.({ totalBytes: totalBytes2, movedBytes: totalBytes2, totalFiles: 1, movedFiles: 1, current: dstPath });
        return;
      }
      if (src.copy) {
        await src.copy(srcPath, dstPath);
        onProgress?.({ totalBytes: totalBytes2, movedBytes: totalBytes2, totalFiles: 1, movedFiles: 1, current: dstPath });
        return;
      }
    }
    const files = await this.walk(src, srcPath);
    const totalBytes = files.reduce((n, f) => n + f.size, 0);
    const totalFiles = files.filter((f) => f.type === "file").length;
    const progress = { totalBytes, movedBytes: 0, totalFiles, movedFiles: 0, current: "" };
    onProgress?.({ ...progress });
    const writeAll = async () => {
      for (const f of files) {
        throwIfAborted(signal);
        const rel = f.path.slice(srcPath.length).replace(/^\//, "");
        const target = rel ? join(dstPath, rel) : dstPath;
        progress.current = f.path;
        if (f.type === "dir") {
          await dst.mkdir(target, { recursive: true });
          continue;
        }
        if (!overwrite && await dst.exists(target)) {
          progress.movedFiles++;
          progress.movedBytes += f.size;
          onProgress?.({ ...progress });
          continue;
        }
        await dst.mkdir(parentOf(target), { recursive: true });
        await this.copyFile(src, f.path, dst, target, f.size, (delta) => {
          progress.movedBytes += delta;
          onProgress?.({ ...progress });
        }, signal);
        progress.movedFiles++;
        onProgress?.({ ...progress });
      }
    };
    if (dst.batch) await dst.batch(writeAll);
    else await writeAll();
    if (move) {
      throwIfAborted(signal);
      await src.remove(srcPath, { recursive: true });
    }
  }
  /** Stream a single file when both ends support it and it's large; else buffer. */
  async copyFile(src, srcPath, dst, dstPath, size, onBytes, signal) {
    const canStream = size >= STREAM_THRESHOLD && src.capabilities.streaming && dst.capabilities.streaming && src.createReadable && dst.createWritable;
    if (canStream) {
      const r = await src.createReadable(srcPath);
      const w = await dst.createWritable(dstPath, size).catch(async (e) => {
        await r.close();
        throw e;
      });
      try {
        for (; ; ) {
          throwIfAborted(signal);
          const chunk = await r.read();
          if (!chunk) break;
          await w.write(chunk);
          onBytes(chunk.byteLength);
        }
        await w.close();
      } catch (e) {
        await w.abort?.(e);
        throw e;
      } finally {
        await r.close();
      }
      return;
    }
    const data = await src.readFile(srcPath);
    await dst.writeFile(dstPath, data);
    onBytes(data.byteLength);
  }
  /** Depth-first listing of a path: dirs (parents before children) then files. */
  async walk(drive, root) {
    const st = await drive.stat(root);
    if (st.type !== "dir") return [{ path: root, type: st.type, size: st.size }];
    const out = [{ path: root, type: "dir", size: 0 }];
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      for (const e of await drive.list(dir)) {
        const p = join(dir, e.name);
        if (e.type === "dir") {
          out.push({ path: p, type: "dir", size: 0 });
          stack.push(p);
        } else out.push({ path: p, type: e.type, size: e.size });
      }
    }
    return out;
  }
  async dispose() {
    for (const id of [...this.drives.keys()]) await this.unmount(id);
    this.listeners.clear();
  }
};
function parentOf(path) {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}
function throwIfAborted(signal) {
  if (signal?.aborted) {
    const e = new Error("transfer aborted");
    e.name = "AbortError";
    throw e;
  }
}

// src/drives/tree-drive.ts
function norm(p) {
  const parts = [];
  for (const seg of (p || "/").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return "/" + parts.join("/");
}
var dirname = (p) => {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
};
var basename = (p) => p.slice(p.lastIndexOf("/") + 1);
var childPath = (dir, name) => dir === "/" ? "/" + name : dir + "/" + name;
function fsError(code, msg) {
  const e = new Error(`${code}: ${msg}`);
  e.code = code;
  return e;
}
var TreeDrive = class {
  constructor(id, label) {
    this.id = id;
    this.label = label;
    this.nodes.set("/", { type: "dir", mtimeMs: this.now(), ctimeMs: this.now(), children: /* @__PURE__ */ new Set() });
  }
  capabilities = { writable: true, streaming: true, nativeSync: false, watch: false, syncBadges: false };
  state = "ready";
  nodes = /* @__PURE__ */ new Map();
  now = () => Date.now();
  /**
   * Load the whole node set from the backing store into `this.nodes` (records
   * only — the base rebuilds dir `children` sets centrally in `ready()`). Default:
   * no-op (a pure RAM disk).
   */
  async hydrate() {
  }
  /**
   * Commit just what changed since the last flush: write/replace every node at a
   * path in `puts`, delete every path in `dels`. Default: no-op. This is the seam
   * that makes a single small write touch a single record, not the whole tree.
   */
  async commit(_puts, _dels) {
  }
  // Paths changed/removed since the last flush (mutually exclusive per path).
  dirtyPuts = /* @__PURE__ */ new Set();
  dirtyDels = /* @__PURE__ */ new Set();
  markPut(p) {
    this.dirtyDels.delete(p);
    this.dirtyPuts.add(p);
  }
  markDel(p) {
    this.dirtyPuts.delete(p);
    this.dirtyDels.add(p);
  }
  /** >0 while a multi-step op (copy / batch) is in flight — coalesces its writes
   *  into a single commit instead of one store round-trip per file. */
  suspend = 0;
  async save() {
    if (this.suspend !== 0) return;
    if (this.dirtyPuts.size === 0 && this.dirtyDels.size === 0) return;
    const puts = this.dirtyPuts, dels = this.dirtyDels;
    this.dirtyPuts = /* @__PURE__ */ new Set();
    this.dirtyDels = /* @__PURE__ */ new Set();
    await this.commit(puts, dels);
  }
  /**
   * Run `fn` with persistence suspended, then commit once. Lets a caller (e.g.
   * `DriveManager.transfer`) collapse a whole burst of writes into a single
   * commit. Nests safely; commits on the outermost exit even if `fn` throws.
   */
  async batch(fn) {
    this.suspend++;
    try {
      return await fn();
    } finally {
      this.suspend--;
      await this.save();
    }
  }
  // Memoised so concurrent ops await the SAME hydration — otherwise a second call
  // arriving mid-`hydrate()` (async IndexedDB) would see a half-built tree.
  readyOnce = null;
  ready() {
    if (!this.readyOnce) {
      this.readyOnce = (async () => {
        try {
          await this.hydrate();
        } catch {
        }
        if (!this.nodes.has("/")) this.nodes.set("/", { type: "dir", mtimeMs: this.now(), ctimeMs: this.now(), children: /* @__PURE__ */ new Set() });
        this.rebuildChildren();
      })();
    }
    return this.readyOnce;
  }
  /** Reconstruct every dir's `children` set from the flat path set (the store
   *  persists records, not edges) — so subclasses' `hydrate` only loads nodes. */
  rebuildChildren() {
    for (const n of this.nodes.values()) if (n.type === "dir") n.children.clear();
    for (const p of this.nodes.keys()) {
      if (p === "/") continue;
      const parent = this.nodes.get(dirname(p));
      if (parent?.type === "dir") parent.children.add(basename(p));
    }
  }
  link(p, node) {
    this.nodes.set(p, node);
    this.markPut(p);
    if (p === "/") return;
    const parent = this.nodes.get(dirname(p));
    if (parent?.type === "dir") parent.children.add(basename(p));
  }
  unlink(p) {
    this.nodes.delete(p);
    this.markDel(p);
    if (p === "/") return;
    const parent = this.nodes.get(dirname(p));
    if (parent?.type === "dir") parent.children.delete(basename(p));
  }
  descendants(dir) {
    const out = [];
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop();
      const node = this.nodes.get(d);
      if (node?.type !== "dir") continue;
      for (const name of node.children) {
        const c = childPath(d, name);
        out.push(c);
        stack.push(c);
      }
    }
    return out;
  }
  requireDirOf(p) {
    const d = this.nodes.get(dirname(p));
    if (!d) throw fsError("ENOENT", `no such file or directory, '${dirname(p)}'`);
    if (d.type !== "dir") throw fsError("ENOTDIR", `not a directory, '${dirname(p)}'`);
  }
  async stat(path) {
    await this.ready();
    const n = this.nodes.get(norm(path));
    if (!n) throw fsError("ENOENT", `no such file or directory, '${path}'`);
    return { type: n.type, size: n.type === "file" ? n.data.byteLength : 0, mtimeMs: n.mtimeMs, ctimeMs: n.ctimeMs, sync: "local" };
  }
  async exists(path) {
    await this.ready();
    return this.nodes.has(norm(path));
  }
  async list(path) {
    await this.ready();
    const dir = norm(path);
    const n = this.nodes.get(dir);
    if (!n) throw fsError("ENOENT", `no such file or directory, '${path}'`);
    if (n.type !== "dir") throw fsError("ENOTDIR", `not a directory, '${path}'`);
    const out = [];
    for (const name of n.children) {
      const node = this.nodes.get(childPath(dir, name));
      out.push({ name, type: node.type, size: node.type === "file" ? node.data.byteLength : 0, mtimeMs: node.mtimeMs, ctimeMs: node.ctimeMs, sync: "local" });
    }
    return out;
  }
  async readFile(path) {
    await this.ready();
    const n = this.nodes.get(norm(path));
    if (!n) throw fsError("ENOENT", `no such file or directory, '${path}'`);
    if (n.type !== "file") throw fsError("EISDIR", `illegal operation on a directory, '${path}'`);
    return n.data.slice();
  }
  async writeFile(path, data) {
    await this.ready();
    const target = norm(path);
    this.requireDirOf(target);
    const existing = this.nodes.get(target);
    if (existing?.type === "dir") throw fsError("EISDIR", `illegal operation on a directory, '${path}'`);
    this.link(target, { type: "file", data: data.slice(), mtimeMs: this.now(), ctimeMs: existing?.ctimeMs ?? this.now() });
    await this.save();
  }
  async mkdir(path, opts) {
    await this.ready();
    const segs2 = norm(path).split("/").filter(Boolean);
    let cur = "";
    for (let i = 0; i < segs2.length; i++) {
      cur += "/" + segs2[i];
      const ex = this.nodes.get(cur);
      if (ex) {
        if (ex.type !== "dir") throw fsError("ENOTDIR", `not a directory, '${cur}'`);
        continue;
      }
      if (!opts?.recursive && i < segs2.length - 1) throw fsError("ENOENT", `no such file or directory, '${cur}'`);
      this.link(cur, { type: "dir", mtimeMs: this.now(), ctimeMs: this.now(), children: /* @__PURE__ */ new Set() });
    }
    await this.save();
  }
  async remove(path, opts) {
    await this.ready();
    const target = norm(path);
    const n = this.nodes.get(target);
    if (!n) return;
    if (n.type === "dir") {
      const desc = this.descendants(target);
      if (desc.length && !opts?.recursive) throw fsError("ENOTEMPTY", `directory not empty, '${path}'`);
      for (const c of desc) {
        this.nodes.delete(c);
        this.markDel(c);
      }
    }
    this.unlink(target);
    await this.save();
  }
  async rename(from, to) {
    await this.ready();
    const a = norm(from), b = norm(to);
    const n = this.nodes.get(a);
    if (!n) throw fsError("ENOENT", `no such file or directory, '${from}'`);
    if (a === b) return;
    this.requireDirOf(b);
    if (n.type === "dir" && b.startsWith(a + "/")) throw fsError("EINVAL", `invalid argument, rename '${from}' -> '${to}'`);
    this.suspend++;
    try {
      if (this.nodes.has(b)) await this.remove(b, { recursive: true });
      const desc = n.type === "dir" ? this.descendants(a) : [];
      const grafts = desc.map((p) => [b + p.slice(a.length), this.nodes.get(p)]);
      this.unlink(a);
      for (const p of desc) {
        this.nodes.delete(p);
        this.markDel(p);
      }
      this.link(b, n);
      for (const [p, node] of grafts) {
        this.nodes.set(p, node);
        this.markPut(p);
      }
      n.mtimeMs = this.now();
    } finally {
      this.suspend--;
      await this.save();
    }
  }
  async copy(from, to) {
    await this.ready();
    const a = norm(from), b = norm(to);
    if (!this.nodes.has(a)) throw fsError("ENOENT", `no such file or directory, '${from}'`);
    if (this.nodes.get(a).type === "dir" && (b === a || b.startsWith(a + "/"))) {
      throw fsError("EINVAL", `cannot copy a directory into itself, '${from}' -> '${to}'`);
    }
    this.suspend++;
    try {
      await this.copyInto(a, b);
    } finally {
      this.suspend--;
    }
    await this.save();
  }
  async copyInto(a, b) {
    const n = this.nodes.get(a);
    if (n.type === "file") {
      await this.writeFile(b, n.data);
      return;
    }
    await this.mkdir(b, { recursive: true });
    for (const e of await this.list(a)) await this.copyInto(childPath(a, e.name), childPath(b, e.name));
  }
  async createReadable(path) {
    const data = await this.readFile(path);
    let done = false;
    return { async read() {
      if (done) return null;
      done = true;
      return data;
    }, async close() {
    } };
  }
  async createWritable(path) {
    const chunks = [];
    const self = this;
    return {
      async write(c) {
        chunks.push(c.slice());
      },
      async close() {
        let n = 0;
        for (const c of chunks) n += c.byteLength;
        const b = new Uint8Array(n);
        let o = 0;
        for (const c of chunks) {
          b.set(c, o);
          o += c.byteLength;
        }
        await self.writeFile(path, b);
      },
      async abort() {
        chunks.length = 0;
      }
    };
  }
  async usage() {
    await this.ready();
    let used = 0;
    for (const n of this.nodes.values()) if (n.type === "file") used += n.data.byteLength;
    return { total: this.quotaBytes(), used };
  }
  quotaBytes() {
    return 0;
  }
  dispose() {
    this.nodes.clear();
  }
};

// src/drives/memory-drive.ts
var enc = new TextEncoder();
var MemoryDrive = class extends TreeDrive {
  kind = "memory";
  icon = "memory";
  constructor(id, label = "Memory") {
    super(id, label);
  }
  /** convenience for seeding/tests */
  writeText(path, text) {
    return this.writeFile(path, enc.encode(text));
  }
};

// src/drives/localstorage-drive.ts
function toB64(u) {
  let s = "";
  const CH = 32768;
  for (let i = 0; i < u.length; i += CH) s += String.fromCharCode(...u.subarray(i, i + CH));
  return btoa(s);
}
function fromB64(b) {
  const s = atob(b);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
var LocalStorageDrive = class extends TreeDrive {
  kind = "localstorage";
  icon = "database";
  prefix;
  constructor(id, label = "localStorage") {
    super(id, label);
    this.prefix = `td.drive.ls.${id}:`;
  }
  quotaBytes() {
    return 5 * 1024 * 1024;
  }
  keys() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(this.prefix)) out.push(k);
    }
    return out;
  }
  async hydrate() {
    const keys = this.keys();
    if (!keys.length) return;
    this.nodes.clear();
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const n = JSON.parse(raw);
      const path = k.slice(this.prefix.length);
      this.nodes.set(path, n.t === "file" ? { type: "file", data: n.d ? fromB64(n.d) : new Uint8Array(0), mtimeMs: n.m, ctimeMs: n.c } : { type: "dir", mtimeMs: n.m, ctimeMs: n.c, children: /* @__PURE__ */ new Set() });
    }
  }
  /** Incremental: write only changed keys, remove only deleted ones. */
  async commit(puts, dels) {
    try {
      for (const p of dels) localStorage.removeItem(this.prefix + p);
      for (const p of puts) {
        const n = this.nodes.get(p);
        if (!n) continue;
        const ser = n.type === "file" ? { t: "file", m: n.mtimeMs, c: n.ctimeMs, d: toB64(n.data) } : { t: "dir", m: n.mtimeMs, c: n.ctimeMs };
        localStorage.setItem(this.prefix + p, JSON.stringify(ser));
      }
    } catch (e) {
      throw Object.assign(new Error("ENOSPC: localStorage quota exceeded"), { code: "ENOSPC", cause: e });
    }
  }
  dispose() {
    this.nodes.clear();
  }
  /** Wipe persisted contents (when the user removes the disk). */
  async destroy() {
    try {
      for (const k of this.keys()) localStorage.removeItem(k);
    } catch {
    }
    this.nodes.clear();
  }
};

// src/drives/indexeddb-drive.ts
function openDb(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("nodes", { keyPath: "path" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
var IndexedDbDrive = class extends TreeDrive {
  kind = "indexeddb";
  icon = "database";
  dbName;
  db = null;
  constructor(id, label = "IndexedDB") {
    super(id, label);
    this.dbName = `td-drive-idb-${id}`;
  }
  async getDb() {
    if (!this.db) this.db = await openDb(this.dbName);
    return this.db;
  }
  async hydrate() {
    const db = await this.getDb();
    const recs = await new Promise((resolve, reject) => {
      const req = db.transaction("nodes", "readonly").objectStore("nodes").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!recs.length) return;
    this.nodes.clear();
    for (const r of recs) {
      this.nodes.set(r.path, r.t === "file" ? { type: "file", data: r.d ?? new Uint8Array(0), mtimeMs: r.m, ctimeMs: r.c } : { type: "dir", mtimeMs: r.m, ctimeMs: r.c, children: /* @__PURE__ */ new Set() });
    }
  }
  /** Incremental: write only changed records, delete only removed ones — one tx. */
  async commit(puts, dels) {
    const db = await this.getDb();
    const tx = db.transaction("nodes", "readwrite");
    const store = tx.objectStore("nodes");
    for (const p of dels) store.delete(p);
    for (const p of puts) {
      const n = this.nodes.get(p);
      if (!n) continue;
      store.put(n.type === "file" ? { path: p, t: "file", m: n.mtimeMs, c: n.ctimeMs, d: n.data } : { path: p, t: "dir", m: n.mtimeMs, c: n.ctimeMs });
    }
    await txDone(tx);
  }
  dispose() {
    this.db?.close();
    this.db = null;
    this.nodes.clear();
  }
  async destroy() {
    this.dispose();
    await new Promise((resolve) => {
      const r = indexedDB.deleteDatabase(this.dbName);
      r.onsuccess = r.onerror = () => resolve();
    });
  }
};

// src/drives/localfolder-drive.ts
var HANDLE_DB = "td-drive-handles";
function norm2(p) {
  const parts = [];
  for (const seg of (p || "/").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return "/" + parts.join("/");
}
var segs = (p) => norm2(p).split("/").filter(Boolean);
var baseName = (p) => segs(p).slice(-1)[0] || "";
var dirName = (p) => "/" + segs(p).slice(0, -1).join("/");
function fsError2(code, msg) {
  const e = new Error(`${code}: ${msg}`);
  e.code = code;
  return e;
}
function openHandleDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("handles");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function saveHandle(id, handle) {
  const db = await openHandleDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put(handle, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
async function loadHandle(id) {
  const db = await openHandleDb();
  const h = await new Promise((resolve, reject) => {
    const r = db.transaction("handles", "readonly").objectStore("handles").get(id);
    r.onsuccess = () => resolve(r.result ?? null);
    r.onerror = () => reject(r.error);
  });
  db.close();
  return h;
}
async function dropHandle(id) {
  const db = await openHandleDb();
  await new Promise((resolve) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").delete(id);
    tx.oncomplete = tx.onerror = () => resolve();
  });
  db.close();
}
function localFolderSupported() {
  return typeof globalThis.showDirectoryPicker === "function";
}
async function pickDirectory() {
  const picker = globalThis.showDirectoryPicker;
  if (!picker) throw fsError2("ENOTSUP", "directory picker not supported");
  return picker({ mode: "readwrite" });
}
var LocalFolderDrive = class {
  constructor(id, label, root) {
    this.id = id;
    this.label = label;
    this.root = root;
    if (root) this.state = "ready";
  }
  kind = "localfolder";
  icon = "usb";
  capabilities = { writable: true, streaming: true, nativeSync: false, watch: false, syncBadges: false };
  state = "disconnected";
  async connect() {
    if (!this.root) this.root = await loadHandle(this.id);
    if (!this.root) {
      this.state = "disconnected";
      throw fsError2("ENOENT", "no folder handle; pick a folder");
    }
    const perm = await this.ensurePermission(true);
    this.state = perm === "granted" ? "ready" : "disconnected";
    if (perm === "granted") await saveHandle(this.id, this.root);
  }
  async ensurePermission(request) {
    const h = this.root;
    const opt = { mode: "readwrite" };
    let p = await h.queryPermission?.(opt) ?? "granted";
    if (p !== "granted" && request) p = await h.requestPermission?.(opt) ?? p;
    return p;
  }
  async dirHandle(path, create = false) {
    if (!this.root) throw fsError2("ENOENT", "folder not attached");
    let cur = this.root;
    for (const seg of segs(path)) cur = await cur.getDirectoryHandle(seg, { create });
    return cur;
  }
  async fileHandle(path, create = false) {
    return (await this.dirHandle(dirName(path), create)).getFileHandle(baseName(path), { create });
  }
  async stat(path) {
    if (!segs(path).length) return { type: "dir", size: 0, mtimeMs: 0, sync: "local" };
    try {
      const f = await (await this.fileHandle(path)).getFile();
      return { type: "file", size: f.size, mtimeMs: f.lastModified, sync: "local" };
    } catch {
      await this.dirHandle(path);
      return { type: "dir", size: 0, mtimeMs: 0, sync: "local" };
    }
  }
  async exists(path) {
    try {
      await this.stat(path);
      return true;
    } catch {
      return false;
    }
  }
  async list(path) {
    const dir = await this.dirHandle(path);
    const out = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "directory") out.push({ name, type: "dir", size: 0, mtimeMs: 0, sync: "local" });
      else {
        const f = await handle.getFile();
        out.push({ name, type: "file", size: f.size, mtimeMs: f.lastModified, sync: "local" });
      }
    }
    return out;
  }
  async readFile(path) {
    return new Uint8Array(await (await (await this.fileHandle(path)).getFile()).arrayBuffer());
  }
  async writeFile(path, data) {
    const w = await (await this.fileHandle(path, true)).createWritable();
    await w.write(data);
    await w.close();
  }
  async createReadable(path) {
    const reader = (await (await this.fileHandle(path)).getFile()).stream().getReader();
    return { async read() {
      const { value, done } = await reader.read();
      return done ? null : value;
    }, async close() {
      try {
        await reader.cancel();
      } catch {
      }
    } };
  }
  async createWritable(path) {
    const w = await (await this.fileHandle(path, true)).createWritable();
    return { async write(c) {
      await w.write(c);
    }, async close() {
      await w.close();
    }, async abort(r) {
      try {
        await w.abort?.(r);
      } catch {
      }
    } };
  }
  async mkdir(path, opts) {
    if (opts?.recursive) {
      await this.dirHandle(path, true);
      return;
    }
    await (await this.dirHandle(dirName(path))).getDirectoryHandle(baseName(path), { create: true });
  }
  async remove(path, opts) {
    try {
      await (await this.dirHandle(dirName(path))).removeEntry(baseName(path), { recursive: opts?.recursive ?? false });
    } catch (e) {
      if (e.name !== "NotFoundError") throw e;
    }
  }
  async rename(from, to) {
    await this.copy(from, to);
    await this.remove(from, { recursive: true });
  }
  async copy(from, to) {
    const s = await this.stat(from);
    if (s.type === "file") {
      await this.writeFile(to, await this.readFile(from));
      return;
    }
    const a = norm2(from), b = norm2(to);
    if (b === a || b.startsWith(a + "/")) throw fsError2("EINVAL", `cannot copy a directory into itself, '${from}' -> '${to}'`);
    await this.mkdir(to, { recursive: true });
    for (const e of await this.list(from)) await this.copy(`${from}/${e.name}`, `${to}/${e.name}`);
  }
  async usage() {
    return null;
  }
  dispose() {
  }
  async destroy() {
    await dropHandle(this.id);
  }
};

// src/drives/cloud-drive.ts
function norm3(p) {
  const parts = [];
  for (const seg of (p || "/").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return "/" + parts.join("/");
}
function fsError3(code, msg) {
  const e = new Error(`${code}: ${msg}`);
  e.code = code;
  return e;
}
var DEFAULT_ICON = { gdrive: "gdrive", dropbox: "dropbox", onedrive: "onedrive" };
var CloudDrive = class {
  id;
  label;
  kind;
  icon;
  capabilities = { writable: true, streaming: false, nativeSync: false, watch: false, syncBadges: true };
  state = "disconnected";
  base;
  connId;
  provider;
  _fetch;
  constructor(opts) {
    this.id = opts.id;
    this.label = opts.label;
    this.provider = opts.provider;
    this.kind = opts.provider;
    this.icon = opts.icon || DEFAULT_ICON[opts.provider];
    this.base = opts.baseUrl.replace(/\/$/, "");
    this.connId = opts.connectionId;
    const f = opts.fetch || globalThis.fetch.bind(globalThis);
    this._fetch = ((input, init) => f(input, { credentials: "include", ...init }));
  }
  async connect() {
    try {
      await this.list("/");
      this.state = "ready";
    } catch (e) {
      this.state = e.code === "EAUTH" ? "disconnected" : "error";
      throw e;
    }
  }
  url(op, q) {
    const u = new URL(`${this.base}/drives/${this.connId}/${op}`);
    if (q) for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
    return u.toString();
  }
  async api(op, init, q) {
    const res = await this._fetch(this.url(op, q), init);
    if (res.status === 401) {
      this.state = "disconnected";
      throw fsError3("EAUTH", "cloud session expired; reconnect");
    }
    if (res.status === 404) throw fsError3("ENOENT", "not found");
    if (!res.ok) throw fsError3("EIO", `cloud ${op} failed (${res.status})`);
    return res.json();
  }
  async stat(path) {
    const r = await this.api("stat", void 0, { path: norm3(path) });
    return { type: r.type, size: r.size, mtimeMs: r.mtimeMs, sync: "synced" };
  }
  async exists(path) {
    try {
      await this.stat(path);
      return true;
    } catch {
      return false;
    }
  }
  async list(path) {
    const r = await this.api("list", void 0, { path: norm3(path) });
    return r.entries.map((x) => ({ name: x.name, type: x.type, size: x.size, mtimeMs: x.mtimeMs, sync: "synced" }));
  }
  async readFile(path) {
    const res = await this._fetch(this.url("read", { path: norm3(path) }));
    if (res.status === 401) {
      this.state = "disconnected";
      throw fsError3("EAUTH", "cloud session expired; reconnect");
    }
    if (!res.ok) throw fsError3("EIO", `cloud read failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }
  async writeFile(path, data) {
    const res = await this._fetch(this.url("write", { path: norm3(path) }), { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: new Blob([data]) });
    if (res.status === 401) {
      this.state = "disconnected";
      throw fsError3("EAUTH", "cloud session expired; reconnect");
    }
    if (!res.ok) throw fsError3("EIO", `cloud write failed (${res.status})`);
  }
  async mkdir(path) {
    await this.api("mkdir", { method: "POST" }, { path: norm3(path) });
  }
  async remove(path) {
    await this.api("remove", { method: "POST" }, { path: norm3(path) });
  }
  async rename(from, to) {
    await this.api("rename", { method: "POST" }, { from: norm3(from), to: norm3(to) });
  }
  async copy(from, to) {
    await this.api("copy", { method: "POST" }, { from: norm3(from), to: norm3(to) });
  }
  async usage() {
    try {
      return await this.api("usage");
    } catch {
      return null;
    }
  }
};

// src/drives/sync-engine.ts
var MANIFEST = ".tdsync.json";
function join2(dir, rel) {
  if (!rel) return dir;
  return dir === "/" ? "/" + rel : dir.replace(/\/$/, "") + "/" + rel;
}
var SyncEngine = class {
  constructor(remote, remotePath, local, localPath) {
    this.remote = remote;
    this.remotePath = remotePath;
    this.local = local;
    this.localPath = localPath;
  }
  /** live per-path status (rel → status), readable by the UI between syncs. */
  statuses = /* @__PURE__ */ new Map();
  running = false;
  status(rel) {
    return this.statuses.get(rel) || "local";
  }
  async sync(opts = {}) {
    if (this.running) throw new Error("sync already running");
    this.running = true;
    const direction = opts.direction || "two-way";
    const set = (rel, s) => {
      this.statuses.set(rel, s);
      opts.onStatus?.(rel, s);
    };
    const result = { downloaded: 0, uploaded: 0, deleted: 0, conflicts: [], errors: [] };
    try {
      await this.local.mkdir(this.localPath, { recursive: true });
      const manifest = await this.readManifest();
      const [remoteList, localList] = await Promise.all([
        this.walk(this.remote, this.remotePath),
        this.walk(this.local, this.localPath)
      ]);
      const rMap = new Map(remoteList.map((e) => [e.rel, e]));
      const lMap = new Map(localList.map((e) => [e.rel, e]));
      const rels = [.../* @__PURE__ */ new Set([...rMap.keys(), ...lMap.keys()])].filter((r) => r !== MANIFEST).sort();
      let done = 0;
      for (const rel of rels) {
        if (opts.signal?.aborted) throw Object.assign(new Error("sync aborted"), { name: "AbortError" });
        const r = rMap.get(rel), l = lMap.get(rel), m = manifest[rel];
        try {
          if (r?.type === "dir" || l?.type === "dir") {
            if (!l && r && direction !== "push") await this.local.mkdir(join2(this.localPath, rel), { recursive: true });
            if (!r && l && direction !== "pull") await this.remote.mkdir(join2(this.remotePath, rel), { recursive: true });
            done++;
            opts.onProgress?.(done, rels.length);
            continue;
          }
          const rChanged = !!r && (!m || r.mtime !== m.rMtime || r.size !== m.size);
          const lChanged = !!l && (!m || l.mtime !== m.lMtime || l.size !== m.size);
          if (r && l) {
            if (rChanged && lChanged) {
              if (direction === "two-way") {
                set(rel, "conflict");
                result.conflicts.push(rel);
              } else if (direction === "pull") {
                await this.download(rel, manifest, set);
                result.downloaded++;
              } else {
                await this.upload(rel, manifest, set);
                result.uploaded++;
              }
            } else if (rChanged && direction !== "push") {
              await this.download(rel, manifest, set);
              result.downloaded++;
            } else if (lChanged && direction !== "pull") {
              await this.upload(rel, manifest, set);
              result.uploaded++;
            } else set(rel, "synced");
          } else if (r && !l) {
            if (m && direction !== "pull") {
              await this.remote.remove(join2(this.remotePath, rel), { recursive: true });
              delete manifest[rel];
              result.deleted++;
              this.statuses.delete(rel);
            } else if (direction !== "push") {
              await this.download(rel, manifest, set);
              result.downloaded++;
            }
          } else if (l && !r) {
            if (m && direction !== "push") {
              await this.local.remove(join2(this.localPath, rel), { recursive: true });
              delete manifest[rel];
              result.deleted++;
              this.statuses.delete(rel);
            } else if (direction !== "pull") {
              await this.upload(rel, manifest, set);
              result.uploaded++;
            }
          }
        } catch (e) {
          set(rel, "error");
          result.errors.push({ path: rel, error: e.message });
        }
        done++;
        opts.onProgress?.(done, rels.length);
      }
      await this.writeManifest(manifest);
      return result;
    } finally {
      this.running = false;
    }
  }
  async download(rel, manifest, set) {
    set(rel, "downloading");
    const rp = join2(this.remotePath, rel), lp = join2(this.localPath, rel);
    await this.local.mkdir(parentRel(lp), { recursive: true });
    await this.local.writeFile(lp, await this.remote.readFile(rp));
    await this.record(rel, manifest);
    set(rel, "synced");
  }
  async upload(rel, manifest, set) {
    set(rel, "uploading");
    const rp = join2(this.remotePath, rel), lp = join2(this.localPath, rel);
    await this.remote.mkdir(parentRel(rp), { recursive: true });
    await this.remote.writeFile(rp, await this.local.readFile(lp));
    await this.record(rel, manifest);
    set(rel, "synced");
  }
  /** Re-stat both sides after an op and store their current mtimes/size. */
  async record(rel, manifest) {
    const [r, l] = await Promise.all([
      this.remote.stat(join2(this.remotePath, rel)).catch(() => null),
      this.local.stat(join2(this.localPath, rel)).catch(() => null)
    ]);
    manifest[rel] = { rMtime: r?.mtimeMs || 0, lMtime: l?.mtimeMs || 0, size: l?.size ?? r?.size ?? 0 };
  }
  async readManifest() {
    try {
      return JSON.parse(new TextDecoder().decode(await this.local.readFile(join2(this.localPath, MANIFEST))));
    } catch {
      return {};
    }
  }
  async writeManifest(m) {
    await this.local.writeFile(join2(this.localPath, MANIFEST), new TextEncoder().encode(JSON.stringify(m)));
  }
  /** Depth-first relative listing of a tree (paths relative to `root`). */
  async walk(drive, root) {
    const out = [];
    const stack = [""];
    while (stack.length) {
      const rel = stack.pop();
      let entries;
      try {
        entries = await drive.list(rel ? join2(root, rel) : root);
      } catch {
        continue;
      }
      for (const e of entries) {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.type === "dir") {
          out.push({ rel: childRel, type: "dir", size: 0, mtime: e.mtimeMs });
          stack.push(childRel);
        } else out.push({ rel: childRel, type: e.type, size: e.size, mtime: e.mtimeMs });
      }
    }
    return out;
  }
};
function parentRel(p) {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

export { CloudDrive, DriveManager, IndexedDbDrive, LocalFolderDrive, LocalStorageDrive, MemoryDrive, SyncEngine, TreeDrive, dropHandle, loadHandle, localFolderSupported, pickDirectory };
//# sourceMappingURL=drives-entry.js.map
//# sourceMappingURL=drives-entry.js.map