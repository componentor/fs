// src/workers/opfs-sync-plan.ts
function normalizeAbs(p) {
  if (!p.startsWith("/")) p = "/" + p;
  if (p.length === 1) return p;
  const out = [];
  for (const part of p.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return "/" + out.join("/");
}
function coalesceWriteIndex(queue2, path) {
  const np = normalizeAbs(path);
  for (let i = queue2.length - 1; i >= 0; i--) {
    const p = queue2[i];
    if (normalizeAbs(p.path) !== np) {
      if (p.op === "rename" && p.newPath && normalizeAbs(p.newPath) === np) return -1;
      continue;
    }
    if (p.op === "write") return i;
    return -1;
  }
  return -1;
}

// src/workers/opfs-sync-echo.ts
var ECHO_GRACE_MS = 3e3;
function hashBytes(b) {
  let h = 2166136261;
  for (let i = 0; i < b.length; i++) {
    h ^= b[i];
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 ^ b.length;
}
function removedBy(event) {
  if (event.op === "delete") return [event.path];
  if (event.op === "rename") return event.newPath ? [event.path, event.newPath] : [event.path];
  return [];
}
var MirrorEchoTracker = class {
  constructor(now = Date.now) {
    this.now = now;
  }
  pending = /* @__PURE__ */ new Set();
  pendingRemovals = /* @__PURE__ */ new Set();
  completed = /* @__PURE__ */ new Map();
  removed = /* @__PURE__ */ new Map();
  written = /* @__PURE__ */ new Map();
  /** A mirror op was queued. */
  enqueued(event) {
    this.pending.add(event.path);
    if (event.op === "rename" && event.newPath) this.pending.add(event.newPath);
    for (const p of removedBy(event)) this.pendingRemovals.add(p);
  }
  /** A mirror op finished (or gave up): its grace window starts now. */
  finished(event) {
    const t = this.now();
    this.pending.delete(event.path);
    this.completed.set(event.path, t);
    if (event.op === "rename" && event.newPath) {
      this.pending.delete(event.newPath);
      this.completed.set(event.newPath, t);
    }
    for (const p of removedBy(event)) {
      this.pendingRemovals.delete(p);
      this.removed.set(p, t);
    }
  }
  /** We wrote these bytes to `path`. */
  wrote(path, bytes) {
    this.written.set(path, hashBytes(bytes));
  }
  /** Did a mirror op on `path` finish within the grace window? */
  recentlyCompleted(path) {
    const ts = this.completed.get(path);
    return ts !== void 0 && this.now() - ts < ECHO_GRACE_MS;
  }
  /** Has a mirror op on `path` finished and not been swept yet (the window plus up to one sweep)? */
  wasCompleted(path) {
    return this.completed.has(path);
  }
  /** Is an observed write to `path` carrying `bytes` our own echo? */
  isWriteEcho(path, bytes) {
    if (this.pending.has(path)) return true;
    if (!this.recentlyCompleted(path)) return false;
    return this.written.get(path) === hashBytes(bytes);
  }
  /** Is an observed 'disappeared' of `path` our own echo? */
  isDeleteEcho(path) {
    if (this.pending.has(path)) return true;
    const now = this.now();
    let p = path;
    while (true) {
      if (this.pendingRemovals.has(p)) return true;
      const ts = this.removed.get(p);
      if (ts !== void 0 && now - ts < ECHO_GRACE_MS) return true;
      const slash = p.lastIndexOf("/");
      if (slash <= 0) return false;
      p = p.substring(0, slash);
    }
  }
  /**
   * Is an observed 'moved' (from → to) our own echo? We never move natively — a mirror rename is
   * copy + delete — so only an op in flight on either end, or one that removed the source,
   * explains it.
   */
  isMoveEcho(from, to) {
    if (this.pending.has(to)) return true;
    return this.isDeleteEcho(from);
  }
  /** Drop entries past the grace window. */
  sweep() {
    const cutoff = this.now() - ECHO_GRACE_MS;
    for (const [p, ts] of this.completed) {
      if (ts < cutoff) {
        this.completed.delete(p);
        this.written.delete(p);
      }
    }
    for (const [p, ts] of this.removed) if (ts < cutoff) this.removed.delete(p);
  }
};

// src/workers/opfs-sync.worker.ts
var serverPort;
var mirrorRoot;
function normalizePath(p) {
  if (p.charCodeAt(0) !== 47) p = "/" + p;
  if (p.indexOf("//") !== -1) p = p.replace(/\/\/+/g, "/");
  if (p.indexOf("/.") !== -1) {
    const parts = p.split("/");
    const resolved = [];
    for (const part of parts) {
      if (part === "." || part === "") continue;
      if (part === "..") {
        resolved.pop();
        continue;
      }
      resolved.push(part);
    }
    p = "/" + resolved.join("/");
  }
  if (p.length > 1 && p.charCodeAt(p.length - 1) === 47) p = p.slice(0, -1);
  return p || "/";
}
function pathSegments(p) {
  return normalizePath(p).split("/").filter(Boolean);
}
var echo = new MirrorEchoTracker();
setInterval(() => echo.sweep(), 5e3);
var debug = false;
var queue = [];
var processing = false;
function echoOp(event) {
  return { op: event.op, path: normalizePath(event.path), newPath: event.newPath && normalizePath(event.newPath) };
}
function enqueue(event) {
  echo.enqueued(echoOp(event));
  if (event.op === "write") {
    const idx = coalesceWriteIndex(queue, event.path);
    if (idx !== -1) {
      queue[idx].data = event.data;
      queue[idx].ts = event.ts;
      return;
    }
  }
  queue.push(event);
  if (!processing) processNext();
}
async function applyEvent(event) {
  switch (event.op) {
    case "write":
      if (event.data) {
        await writeToOPFS(event.path, event.data);
      } else {
        await writeToOPFS(event.path, new ArrayBuffer(0));
      }
      break;
    case "delete":
      await deleteFromOPFS(event.path);
      break;
    case "mkdir":
      await mkdirInOPFS(event.path);
      break;
    case "rename":
      await renameInOPFS(event.path, event.newPath);
      break;
  }
}
var MIRROR_MAX_ATTEMPTS = 4;
async function processNext() {
  if (queue.length === 0) {
    processing = false;
    return;
  }
  processing = true;
  const event = queue.shift();
  for (let attempt = 1; attempt <= MIRROR_MAX_ATTEMPTS; attempt++) {
    try {
      await applyEvent(event);
      break;
    } catch (err) {
      if (attempt === MIRROR_MAX_ATTEMPTS) {
        console.warn("[opfs-sync] mirror failed after retries:", event.op, event.path, err);
        break;
      }
      await new Promise((r) => setTimeout(r, 10 * attempt));
    }
  }
  echo.finished(echoOp(event));
  processNext();
}
async function ensureParentDirs(path) {
  const parts = pathSegments(path);
  parts.pop();
  let dir = mirrorRoot;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}
function basename(path) {
  const parts = pathSegments(path);
  return parts[parts.length - 1] || "";
}
async function writeToOPFS(path, data) {
  const dir = await ensureParentDirs(path);
  const name = basename(path);
  const fileHandle = await dir.getFileHandle(name, { create: true });
  const bytes = new Uint8Array(data);
  const accessHandle = await fileHandle.createSyncAccessHandle();
  try {
    accessHandle.truncate(0);
    accessHandle.write(bytes, { at: 0 });
    accessHandle.flush();
  } finally {
    accessHandle.close();
  }
  echo.wrote(normalizePath(path), bytes);
}
async function deleteFromOPFS(path) {
  try {
    const dir = await navigateToParent(path);
    await dir.removeEntry(basename(path), { recursive: true });
  } catch {
  }
}
async function mkdirInOPFS(path) {
  let dir = mirrorRoot;
  for (const part of pathSegments(path)) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
}
var RENAME_CHUNK = 2 * 1024 * 1024;
async function renameInOPFS(oldPath, newPath) {
  let srcAccess = null;
  let dstAccess = null;
  let oldDir;
  let oldHandle;
  let resolvedFile = false;
  let lastErr = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      oldDir = await navigateToParent(oldPath);
      oldHandle = await oldDir.getFileHandle(basename(oldPath));
      resolvedFile = true;
      break;
    } catch (err) {
      lastErr = err;
      const msg = err?.message || "";
      const isDir = err?.name === "TypeMismatchError" || msg.includes("TypeMismatch") || msg.includes("not a file") || msg.includes("not an entry of requested type");
      if (isDir) {
        try {
          await renameDirInOPFS(oldPath, newPath);
        } catch (dirErr) {
          console.warn("[opfs-sync] rename (dir) failed:", oldPath, "\u2192", newPath, dirErr);
        }
        return;
      }
      if (attempt < 5) {
        await new Promise((r) => setTimeout(r, 8 * (attempt + 1)));
        continue;
      }
    }
  }
  if (!resolvedFile) {
    try {
      await renameDirInOPFS(oldPath, newPath);
      return;
    } catch {
    }
    console.warn("[opfs-sync] rename failed (source not found after retries):", oldPath, "\u2192", newPath, lastErr);
    return;
  }
  try {
    srcAccess = await oldHandle.createSyncAccessHandle();
    const size = srcAccess.getSize();
    const newDir = await ensureParentDirs(newPath);
    const newHandle = await newDir.getFileHandle(basename(newPath), { create: true });
    dstAccess = await newHandle.createSyncAccessHandle();
    dstAccess.truncate(0);
    if (size > 0) {
      const chunk = new Uint8Array(Math.min(size, RENAME_CHUNK));
      let offset = 0;
      while (offset < size) {
        const len = Math.min(chunk.length, size - offset);
        const view = len === chunk.length ? chunk : chunk.subarray(0, len);
        srcAccess.read(view, { at: offset });
        dstAccess.write(view, { at: offset });
        offset += len;
      }
    }
    dstAccess.flush();
    try {
      dstAccess.close();
    } catch {
    }
    dstAccess = null;
    try {
      srcAccess.close();
    } catch {
    }
    srcAccess = null;
    await removeEntryWithRetry(oldDir, basename(oldPath));
  } catch (err) {
    console.warn("[opfs-sync] rename failed:", oldPath, "\u2192", newPath, err);
  } finally {
    if (dstAccess) {
      try {
        dstAccess.close();
      } catch {
      }
    }
    if (srcAccess) {
      try {
        srcAccess.close();
      } catch {
      }
    }
  }
}
async function renameDirInOPFS(oldPath, newPath) {
  const oldParent = await navigateToParent(oldPath);
  const srcDir = await oldParent.getDirectoryHandle(basename(oldPath));
  const newParent = await ensureParentDirs(newPath);
  try {
    await newParent.removeEntry(basename(newPath), { recursive: true });
  } catch (e) {
    if (e?.name !== "NotFoundError") throw e;
  }
  const dstDir = await newParent.getDirectoryHandle(basename(newPath), { create: true });
  await copyDirContents(srcDir, dstDir);
  await removeEntryWithRetry(oldParent, basename(oldPath), { recursive: true });
}
async function removeEntryWithRetry(dir, name, options) {
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await dir.removeEntry(name, options);
      return;
    } catch (err) {
      if (err?.name === "NotFoundError") return;
      lastErr = err;
      await new Promise((r) => setTimeout(r, 10 * (attempt + 1)));
    }
  }
  throw lastErr;
}
async function copyDirContents(src, dst) {
  for await (const [name, handle] of src.entries()) {
    if (handle.kind === "directory") {
      const childDst = await dst.getDirectoryHandle(name, { create: true });
      await copyDirContents(handle, childDst);
    } else {
      const fileHandle = handle;
      const dstFile = await dst.getFileHandle(name, { create: true });
      let srcAccess = null;
      let dstAccess = null;
      try {
        srcAccess = await fileHandle.createSyncAccessHandle();
        dstAccess = await dstFile.createSyncAccessHandle();
        const size = srcAccess.getSize();
        dstAccess.truncate(0);
        if (size > 0) {
          const chunk = new Uint8Array(Math.min(size, RENAME_CHUNK));
          let offset = 0;
          while (offset < size) {
            const len = Math.min(chunk.length, size - offset);
            const view = len === chunk.length ? chunk : chunk.subarray(0, len);
            srcAccess.read(view, { at: offset });
            dstAccess.write(view, { at: offset });
            offset += len;
          }
        }
        dstAccess.flush();
      } finally {
        if (dstAccess) {
          try {
            dstAccess.close();
          } catch {
          }
        }
        if (srcAccess) {
          try {
            srcAccess.close();
          } catch {
          }
        }
      }
    }
  }
}
async function navigateToParent(path) {
  const parts = pathSegments(path);
  parts.pop();
  let dir = mirrorRoot;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part);
  }
  return dir;
}
function applyExternalRecords(records) {
  for (const record of records) {
    const path = normalizePath(record.path);
    if (path === "/.vfs.bin" || path === "/.vfs" || path.startsWith("/.vfs")) continue;
    switch (record.kind) {
      case "appeared":
      case "modified":
        syncExternalChange(path, record.handle ?? null);
        break;
      case "disappeared":
        if (echo.isDeleteEcho(path)) continue;
        syncExternalDelete(path);
        break;
      case "moved": {
        const from = normalizePath(record.from);
        if (echo.isMoveEcho(from, path)) continue;
        syncExternalRename(from, path);
        break;
      }
    }
  }
}
async function syncExternalChange(path, handle) {
  try {
    if (!handle || handle.kind !== "file") return;
    const fileHandle = handle;
    let data = await fileHandle.getFile().then((f) => f.arrayBuffer());
    if (echo.isWriteEcho(path, new Uint8Array(data))) return;
    if (echo.wasCompleted(path)) {
      data = await fileHandle.getFile().then((f) => f.arrayBuffer());
      if (echo.isWriteEcho(path, new Uint8Array(data))) return;
    }
    serverPort.postMessage({
      op: "external-write",
      path,
      data,
      ts: Date.now()
    }, [data]);
  } catch (err) {
    if (debug) console.warn("[opfs-sync] external change read failed:", path, err);
  }
}
function syncExternalDelete(path) {
  serverPort.postMessage({
    op: "external-delete",
    path,
    ts: Date.now()
  });
}
function syncExternalRename(oldPath, newPath) {
  serverPort.postMessage({
    op: "external-rename",
    path: oldPath,
    newPath,
    ts: Date.now()
  });
}
self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    debug = msg.debug === true;
    serverPort = e.ports[0];
    mirrorRoot = await navigator.storage.getDirectory();
    if (msg.root && msg.root !== "/") {
      const segments = msg.root.split("/").filter(Boolean);
      for (const segment of segments) {
        mirrorRoot = await mirrorRoot.getDirectoryHandle(segment, { create: true });
      }
    }
    if (debug) console.log("[opfs-sync] initialized with root:", msg.root || "/", "mirrorRoot.name:", mirrorRoot.name || "(opfs-root)");
    serverPort.onmessage = (ev) => {
      if (ev.data?.type === "external-records") {
        applyExternalRecords(ev.data.records);
        return;
      }
      enqueue(ev.data);
    };
    serverPort.start();
    self.postMessage({ type: "ready" });
    return;
  }
  if (msg.type === "shutdown") {
    try {
      serverPort?.close();
    } catch {
    }
    self.postMessage({ type: "shutdown-done" });
    self.close();
    return;
  }
};
//# sourceMappingURL=opfs-sync.worker.js.map