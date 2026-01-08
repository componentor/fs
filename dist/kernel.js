// src/worker/kernel.ts
var cachedRoot = null;
var dirCache = /* @__PURE__ */ new Map();
var syncHandleCache = /* @__PURE__ */ new Map();
var MAX_SYNC_HANDLES = 100;
async function getSyncAccessHandle(filePath, create) {
  const cached = syncHandleCache.get(filePath);
  if (cached) return cached;
  if (syncHandleCache.size >= MAX_SYNC_HANDLES) {
    const keysToDelete = Array.from(syncHandleCache.keys()).slice(0, 10);
    for (const key of keysToDelete) {
      const handle = syncHandleCache.get(key);
      if (handle) {
        try {
          handle.close();
        } catch {
        }
        syncHandleCache.delete(key);
      }
    }
  }
  const fh = await getFileHandle(filePath, create);
  const access = await fh.createSyncAccessHandle();
  syncHandleCache.set(filePath, access);
  return access;
}
function closeSyncHandle(filePath) {
  const handle = syncHandleCache.get(filePath);
  if (handle) {
    try {
      handle.close();
    } catch {
    }
    syncHandleCache.delete(filePath);
  }
}
function closeAllSyncHandlesUnder(pathPrefix) {
  for (const [path, handle] of syncHandleCache) {
    if (path === pathPrefix || path.startsWith(pathPrefix + "/")) {
      try {
        handle.flush();
        handle.close();
      } catch {
      }
      syncHandleCache.delete(path);
    }
  }
}
function purgeAllCaches() {
  for (const handle of syncHandleCache.values()) {
    try {
      handle.flush();
      handle.close();
    } catch {
    }
  }
  syncHandleCache.clear();
  dirCache.clear();
  cachedRoot = null;
}
function flushAllSyncHandles() {
  for (const handle of syncHandleCache.values()) {
    try {
      handle.flush();
    } catch {
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
async function getParentAndName(filePath) {
  const parts = parsePath(filePath);
  const name = parts.pop();
  if (!name) throw new Error("Invalid path");
  const parent = parts.length > 0 ? await getDirectoryHandle(parts, false) : await getRoot();
  return { parent, name };
}
async function handleRead(filePath, dataBuffer, payload) {
  const access = await getSyncAccessHandle(filePath, false);
  const size = access.getSize();
  const offset = payload?.offset || 0;
  const len = payload?.len || size - offset;
  const view = new Uint8Array(dataBuffer, 0, Math.min(len, dataBuffer.byteLength));
  const bytesRead = access.read(view, { at: offset });
  return bytesRead;
}
async function handleWrite(filePath, dataBuffer, dataLength, payload) {
  const access = await getSyncAccessHandle(filePath, true);
  const offset = payload?.offset ?? 0;
  const shouldTruncate = payload?.truncate ?? offset === 0;
  if (shouldTruncate) {
    access.truncate(0);
  }
  const data = new Uint8Array(dataBuffer, 0, dataLength);
  access.write(data, { at: offset });
  if (payload?.flush !== false) {
    access.flush();
  }
  return 1;
}
async function handleAppend(filePath, dataBuffer, dataLength) {
  const access = await getSyncAccessHandle(filePath, true);
  const size = access.getSize();
  const data = new Uint8Array(dataBuffer, 0, dataLength);
  access.write(data, { at: size });
  access.flush();
  return 1;
}
async function handleTruncate(filePath, payload) {
  const access = await getSyncAccessHandle(filePath, false);
  access.truncate(payload?.len ?? 0);
  access.flush();
  return 1;
}
var STAT_SIZE = 24;
async function handleStat(filePath, metaBuffer) {
  const parts = parsePath(filePath);
  const view = new DataView(metaBuffer);
  if (parts.length === 0) {
    view.setUint8(0, 1);
    view.setUint32(4, 16877, true);
    view.setFloat64(8, 0, true);
    view.setFloat64(16, Date.now(), true);
    return STAT_SIZE;
  }
  const name = parts.pop();
  const parent = parts.length > 0 ? await getDirectoryHandle(parts, false) : await getRoot();
  try {
    const fh = await parent.getFileHandle(name);
    const file = await fh.getFile();
    view.setUint8(0, 0);
    view.setUint32(4, 33188, true);
    view.setFloat64(8, file.size, true);
    view.setFloat64(16, file.lastModified, true);
    return STAT_SIZE;
  } catch {
    try {
      await parent.getDirectoryHandle(name);
      view.setUint8(0, 1);
      view.setUint32(4, 16877, true);
      view.setFloat64(8, 0, true);
      view.setFloat64(16, Date.now(), true);
      return STAT_SIZE;
    } catch {
      return -2;
    }
  }
}
async function handleExists(filePath) {
  if (syncHandleCache.has(filePath)) return 1;
  try {
    const parts = parsePath(filePath);
    if (parts.length === 0) return 1;
    const name = parts.pop();
    const parent = parts.length > 0 ? await getDirectoryHandle(parts, false) : await getRoot();
    try {
      await parent.getFileHandle(name);
      return 1;
    } catch {
      try {
        await parent.getDirectoryHandle(name);
        return 1;
      } catch {
        return 0;
      }
    }
  } catch {
    return 0;
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
    if (!name) throw new Error("Invalid path");
    const parent = parts.length > 0 ? await getDirectoryHandle(parts, false) : await getRoot();
    await parent.getDirectoryHandle(name, { create: true });
  }
  return 1;
}
async function handleRmdir(filePath, payload) {
  const { parent, name } = await getParentAndName(filePath);
  const normalizedPath = "/" + parsePath(filePath).join("/");
  const pathPrefix = parsePath(filePath).join("/");
  if (payload?.recursive) {
    closeAllSyncHandlesUnder(normalizedPath);
    await parent.removeEntry(name, { recursive: true });
    for (const key of dirCache.keys()) {
      if (key === pathPrefix || key.startsWith(pathPrefix + "/")) {
        dirCache.delete(key);
      }
    }
  } else {
    const dir = await parent.getDirectoryHandle(name);
    const entries = dir.entries();
    const first = await entries.next();
    if (!first.done) {
      const e = new Error("InvalidModificationError");
      e.name = "InvalidModificationError";
      throw e;
    }
    await parent.removeEntry(name);
    dirCache.delete(pathPrefix);
  }
  return 1;
}
async function handleUnlink(filePath) {
  const { parent, name } = await getParentAndName(filePath);
  try {
    await parent.getFileHandle(name);
  } catch {
    try {
      await parent.getDirectoryHandle(name);
      throw new Error("EISDIR: illegal operation on a directory");
    } catch (e) {
      if (e.message?.includes("EISDIR")) throw e;
      throw new Error("NotFoundError");
    }
  }
  closeSyncHandle(filePath);
  await parent.removeEntry(name);
  return 1;
}
var textEncoder = new TextEncoder();
async function handleReaddir(filePath, metaBuffer) {
  const parts = parsePath(filePath);
  const dir = parts.length > 0 ? await getDirectoryHandle(parts, false) : await getRoot();
  const entries = [];
  for await (const [name] of dir.entries()) {
    entries.push(name);
  }
  const view = new DataView(metaBuffer);
  const bytes = new Uint8Array(metaBuffer);
  view.setUint32(0, entries.length, true);
  let offset = 4;
  for (const name of entries) {
    const encoded = textEncoder.encode(name);
    view.setUint16(offset, encoded.length, true);
    offset += 2;
    bytes.set(encoded, offset);
    offset += encoded.length;
  }
  return offset;
}
var MIN_CHUNK = 64 * 1024;
var MAX_CHUNK = 1024 * 1024;
var DEFAULT_CHUNK = 256 * 1024;
var LAST_RESORT_CHUNK = 8 * 1024;
var chunkSize = DEFAULT_CHUNK;
var failureCount = 0;
var yieldMicrotask = () => new Promise((resolve) => queueMicrotask(resolve));
function maybeIncreaseChunk() {
  if (failureCount === 0 && chunkSize < MAX_CHUNK) {
    chunkSize = Math.min(MAX_CHUNK, chunkSize + 64 * 1024);
  }
}
function reduceChunkOnFailure() {
  failureCount++;
  chunkSize = Math.max(MIN_CHUNK, Math.floor(chunkSize / 2));
  return chunkSize;
}
async function safeAllocateChunk(srcFile, offset, requestedSize) {
  const size = Math.min(requestedSize, chunkSize);
  try {
    const chunk = srcFile.slice(offset, offset + size);
    return new Uint8Array(await chunk.arrayBuffer());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("allocation") && !msg.includes("Array buffer") && !msg.includes("out of memory")) {
      throw e;
    }
    let retrySize = reduceChunkOnFailure();
    while (retrySize >= MIN_CHUNK) {
      await yieldMicrotask();
      try {
        const chunk = srcFile.slice(offset, offset + retrySize);
        return new Uint8Array(await chunk.arrayBuffer());
      } catch {
        retrySize = reduceChunkOnFailure();
      }
    }
    await yieldMicrotask();
    try {
      chunkSize = LAST_RESORT_CHUNK;
      const chunk = srcFile.slice(offset, offset + LAST_RESORT_CHUNK);
      return new Uint8Array(await chunk.arrayBuffer());
    } catch {
      throw new Error("ENOMEM: unable to allocate memory");
    }
  }
}
async function streamCopyFile(srcHandle, dstPath) {
  const srcFile = await srcHandle.getFile();
  const size = srcFile.size;
  await navigator.locks.request(`opfs:${dstPath}`, async () => {
    const access = await getSyncAccessHandle(dstPath, true);
    access.truncate(0);
    let offset = 0;
    while (offset < size) {
      const remaining = size - offset;
      const data = await safeAllocateChunk(srcFile, offset, remaining);
      access.write(data, { at: offset });
      offset += data.byteLength;
    }
    maybeIncreaseChunk();
    access.flush();
  });
}
async function handleRename(oldPath, payload) {
  if (!payload?.newPath) throw new Error("newPath required");
  const newPath = payload.newPath;
  const oldParts = parsePath(oldPath);
  const newParts = parsePath(newPath);
  const oldName = oldParts.pop();
  const newName = newParts.pop();
  const oldParent = oldParts.length > 0 ? await getDirectoryHandle(oldParts, false) : await getRoot();
  const newParent = newParts.length > 0 ? await getDirectoryHandle(newParts, true) : await getRoot();
  try {
    const fh = await oldParent.getFileHandle(oldName);
    closeSyncHandle(oldPath);
    if ("move" in fh && typeof fh.move === "function") {
      await fh.move(newParent, newName);
      return 1;
    }
    await streamCopyFile(fh, newPath);
    await oldParent.removeEntry(oldName);
    return 1;
  } catch {
    const oldDir = await oldParent.getDirectoryHandle(oldName);
    const pathPrefix = parsePath(oldPath).join("/");
    closeAllSyncHandlesUnder(pathPrefix);
    if ("move" in oldDir && typeof oldDir.move === "function") {
      await oldDir.move(newParent, newName);
      for (const key of dirCache.keys()) {
        if (key === pathPrefix || key.startsWith(pathPrefix + "/")) {
          dirCache.delete(key);
        }
      }
      return 1;
    }
    async function copyDir(src, dst, dstBasePath) {
      for await (const [name, handle] of src.entries()) {
        const dstFilePath = dstBasePath + "/" + name;
        if (handle.kind === "file") {
          const srcFile = handle;
          await streamCopyFile(srcFile, dstFilePath);
        } else {
          const newSubDir = await dst.getDirectoryHandle(name, { create: true });
          await copyDir(handle, newSubDir, dstFilePath);
        }
      }
    }
    const newDir = await newParent.getDirectoryHandle(newName, { create: true });
    await copyDir(oldDir, newDir, newPath);
    await oldParent.removeEntry(oldName, { recursive: true });
    for (const key of dirCache.keys()) {
      if (key === pathPrefix || key.startsWith(pathPrefix + "/")) {
        dirCache.delete(key);
      }
    }
    return 1;
  }
}
async function handleCopy(srcPath, payload) {
  if (!payload?.newPath) throw new Error("newPath required");
  const dstPath = payload.newPath;
  const srcParts = parsePath(srcPath);
  const srcName = srcParts.pop();
  const srcParent = srcParts.length > 0 ? await getDirectoryHandle(srcParts, false) : await getRoot();
  const srcFh = await srcParent.getFileHandle(srcName);
  await streamCopyFile(srcFh, dstPath);
  return 1;
}
var LOCKLESS_OPS = /* @__PURE__ */ new Set(["stat", "exists", "readdir", "mkdir", "flush", "purge"]);
async function processMessage(msg) {
  const { type, path: filePath, ctrlBuffer, metaBuffer, dataBuffer, dataLength, payload } = msg;
  const ctrl = new Int32Array(ctrlBuffer);
  const executeOperation = async () => {
    switch (type) {
      case "read":
      case "readChunk":
        return handleRead(filePath, dataBuffer, payload);
      case "write":
        return handleWrite(filePath, dataBuffer, dataLength || 0, payload);
      case "append":
        return handleAppend(filePath, dataBuffer, dataLength || 0);
      case "truncate":
        return handleTruncate(filePath, payload);
      case "stat":
        return handleStat(filePath, metaBuffer);
      case "exists":
        return handleExists(filePath);
      case "mkdir":
        return handleMkdir(filePath, payload);
      case "rmdir":
        return handleRmdir(filePath, payload);
      case "unlink":
        return handleUnlink(filePath);
      case "readdir":
        return handleReaddir(filePath, metaBuffer);
      case "rename":
        return handleRename(filePath, payload);
      case "copy":
        return handleCopy(filePath, payload);
      case "flush":
        flushAllSyncHandles();
        return 1;
      case "purge":
        purgeAllCaches();
        return 1;
      default:
        throw new Error(`Unknown operation: ${type}`);
    }
  };
  const runAndSignal = async () => {
    try {
      const result = await executeOperation();
      Atomics.store(ctrl, 0, result);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      const errorName = error.name || "";
      const errorMsg = error.message || "Unknown error";
      const isNotFound = errorName === "NotFoundError" || errorMsg.includes("NotFoundError") || errorMsg.includes("not found") || errorMsg.includes("could not be found");
      if (isNotFound) {
        Atomics.store(ctrl, 0, -2);
      } else {
        const errorInfo = errorName && errorName !== "Error" ? errorName : errorMsg;
        const encoded = new TextEncoder().encode(errorInfo);
        const view = new Uint8Array(metaBuffer);
        view.set(encoded);
        if (encoded.length < metaBuffer.byteLength) {
          view[encoded.length] = 0;
        }
        Atomics.store(ctrl, 0, -1);
      }
    }
    Atomics.notify(ctrl, 0);
  };
  if (LOCKLESS_OPS.has(type)) {
    await runAndSignal();
  } else {
    await navigator.locks.request(`opfs:${filePath}`, runAndSignal);
  }
}
self.onmessage = (event) => {
  processMessage(event.data);
};
self.postMessage({ type: "ready" });
//# sourceMappingURL=kernel.js.map