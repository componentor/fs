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
var pendingPaths = /* @__PURE__ */ new Set();
var completedPaths = /* @__PURE__ */ new Map();
var GRACE_MS = 3e3;
function trackPending(path) {
  pendingPaths.add(normalizePath(path));
}
function untrackPending(path) {
  pendingPaths.delete(normalizePath(path));
}
function trackCompleted(path) {
  completedPaths.set(normalizePath(path), Date.now());
}
function isOurEcho(path, checkParents = false) {
  path = normalizePath(path);
  const now = Date.now();
  if (pendingPaths.has(path)) return true;
  const ts = completedPaths.get(path);
  if (ts && now - ts < GRACE_MS) return true;
  if (checkParents) {
    let parent = path;
    while (true) {
      const slash = parent.lastIndexOf("/");
      if (slash <= 0) break;
      parent = parent.substring(0, slash);
      if (pendingPaths.has(parent)) return true;
      const pts = completedPaths.get(parent);
      if (pts && now - pts < GRACE_MS) return true;
    }
  }
  return false;
}
setInterval(() => {
  const cutoff = Date.now() - GRACE_MS;
  for (const [p, ts] of completedPaths) {
    if (ts < cutoff) completedPaths.delete(p);
  }
}, 5e3);
var queue = [];
var processing = false;
function enqueue(event) {
  trackPending(event.path);
  if (event.op === "rename" && event.newPath) {
    trackPending(event.newPath);
  }
  if (event.op === "write") {
    for (let i = queue.length - 1; i >= 0; i--) {
      const pending = queue[i];
      if (pending.op === "write" && normalizePath(pending.path) === normalizePath(event.path)) {
        pending.data = event.data;
        pending.ts = event.ts;
        return;
      }
    }
  }
  queue.push(event);
  if (!processing) processNext();
}
async function processNext() {
  if (queue.length === 0) {
    processing = false;
    return;
  }
  processing = true;
  const event = queue.shift();
  try {
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
  } catch (err) {
    console.warn("[opfs-sync] mirror failed:", event.op, event.path, err);
  }
  untrackPending(event.path);
  trackCompleted(event.path);
  if (event.op === "rename" && event.newPath) {
    untrackPending(event.newPath);
    trackCompleted(event.newPath);
  }
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
  const accessHandle = await fileHandle.createSyncAccessHandle();
  try {
    accessHandle.truncate(0);
    accessHandle.write(new Uint8Array(data), { at: 0 });
    accessHandle.flush();
  } finally {
    accessHandle.close();
  }
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
  try {
    const oldDir = await navigateToParent(oldPath);
    const oldHandle = await oldDir.getFileHandle(basename(oldPath));
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
    await oldDir.removeEntry(basename(oldPath));
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
async function navigateToParent(path) {
  const parts = pathSegments(path);
  parts.pop();
  let dir = mirrorRoot;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part);
  }
  return dir;
}
function setupObserver() {
  if (typeof FileSystemObserver === "undefined") {
    console.warn("[opfs-sync] FileSystemObserver not available \u2014 external changes will not be detected");
    return;
  }
  console.log("[opfs-sync] Setting up FileSystemObserver on mirrorRoot:", mirrorRoot.name || "(opfs-root)");
  const observer = new FileSystemObserver((records) => {
    for (const record of records) {
      const path = normalizePath("/" + record.relativePathComponents.join("/"));
      if (path === "/.vfs.bin" || path === "/.vfs" || path.startsWith("/.vfs")) continue;
      const isDelete = record.type === "disappeared";
      if (isOurEcho(path, isDelete)) {
        continue;
      }
      switch (record.type) {
        case "appeared":
        case "modified":
          syncExternalChange(path, record.changedHandle);
          break;
        case "disappeared":
          syncExternalDelete(path);
          break;
        case "moved": {
          const from = normalizePath("/" + record.relativePathMovedFrom.join("/"));
          syncExternalRename(from, path);
          break;
        }
      }
    }
  });
  observer.observe(mirrorRoot, { recursive: true });
}
async function syncExternalChange(path, handle) {
  try {
    if (!handle || handle.kind !== "file") return;
    const fileHandle = handle;
    const file = await fileHandle.getFile();
    const data = await file.arrayBuffer();
    serverPort.postMessage({
      op: "external-write",
      path,
      data,
      ts: Date.now()
    }, [data]);
  } catch (err) {
    console.warn("[opfs-sync] external change read failed:", path, err);
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
    serverPort = e.ports[0];
    mirrorRoot = await navigator.storage.getDirectory();
    if (msg.root && msg.root !== "/") {
      const segments = msg.root.split("/").filter(Boolean);
      for (const segment of segments) {
        mirrorRoot = await mirrorRoot.getDirectoryHandle(segment, { create: true });
      }
    }
    console.log("[opfs-sync] initialized with root:", msg.root || "/", "mirrorRoot.name:", mirrorRoot.name || "(opfs-root)");
    setupObserver();
    serverPort.onmessage = (ev) => {
      const event = ev.data;
      enqueue(event);
    };
    serverPort.start();
    self.postMessage({ type: "ready" });
    return;
  }
};
//# sourceMappingURL=opfs-sync.worker.js.map