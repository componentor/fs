/**
 * OPFS Sync Worker — optional bidirectional mirror between VFS and real OPFS.
 *
 * Spawned by the server worker when opfsSync is enabled.
 * Receives mutation events from the server, writes them to real OPFS files.
 * Uses FileSystemObserver to detect external OPFS changes and syncs them back.
 */

interface SyncEvent {
  op: 'write' | 'delete' | 'mkdir' | 'rename';
  path: string;
  newPath?: string;
  data?: ArrayBuffer;
  ts: number;
}

let serverPort: MessagePort;
let mirrorRoot: FileSystemDirectoryHandle;

// Normalize path: ensure leading /, collapse //, strip trailing /
function normalizePath(p: string): string {
  if (p.charCodeAt(0) !== 47) p = '/' + p;
  if (p.length > 1 && p.charCodeAt(p.length - 1) === 47) p = p.slice(0, -1);
  if (p.indexOf('//') !== -1) p = p.replace(/\/\/+/g, '/');
  return p;
}

// Echo suppression — two structures:
//
// pendingPaths (Set): paths currently in the queue or being processed.
//   Added on enqueue, removed after OPFS operation completes.
//   No timeout — stays as long as the item is in the queue.
//   Prevents false externals when queue takes >1s (e.g., 500-file batches).
//
// completedPaths (Map<path, timestamp>): paths recently written by us.
//   Added when processing completes, removed ONLY by periodic cleanup.
//   Grace window catches delayed/batched observer events after processing.
//
// Parent path check (opt-in): if /dir was deleted by us, /dir/file disappearing
// is also our echo (recursive removeEntry fires per-child events).
// ONLY used for 'disappeared' events — NOT for 'appeared'/'modified', since
// creating /dir doesn't mean /dir/new-file appearing is our echo.

const pendingPaths = new Set<string>();
const completedPaths = new Map<string, number>();
const GRACE_MS = 3000;

function trackPending(path: string): void {
  pendingPaths.add(normalizePath(path));
}

function untrackPending(path: string): void {
  pendingPaths.delete(normalizePath(path));
}

function trackCompleted(path: string): void {
  completedPaths.set(normalizePath(path), Date.now());
}

function isOurEcho(path: string, checkParents = false): boolean {
  path = normalizePath(path);
  const now = Date.now();

  // Check exact path
  if (pendingPaths.has(path)) return true;
  const ts = completedPaths.get(path);
  if (ts && now - ts < GRACE_MS) return true;

  // Walk up parent paths — ONLY for 'disappeared' events.
  // Handles recursive delete cascading: removeEntry(dir, {recursive:true})
  // fires individual 'disappeared' for every child file.
  // NOT used for 'appeared'/'modified' — a parent being tracked doesn't mean
  // a new file appearing inside it is our echo (could be genuinely external).
  if (checkParents) {
    let parent = path;
    while (true) {
      const slash = parent.lastIndexOf('/');
      if (slash <= 0) break;
      parent = parent.substring(0, slash);
      if (pendingPaths.has(parent)) return true;
      const pts = completedPaths.get(parent);
      if (pts && now - pts < GRACE_MS) return true;
    }
  }

  return false;
}

// Periodic cleanup — the ONLY way completedPaths entries get removed
setInterval(() => {
  const cutoff = Date.now() - GRACE_MS;
  for (const [p, ts] of completedPaths) {
    if (ts < cutoff) completedPaths.delete(p);
  }
}, 5000);

// Event queue — process one at a time, in order
const queue: SyncEvent[] = [];
let processing = false;

function enqueue(event: SyncEvent): void {
  trackPending(event.path);
  if (event.op === 'rename' && event.newPath) {
    trackPending(event.newPath);
  }
  queue.push(event);
  if (!processing) processNext();
}

async function processNext(): Promise<void> {
  if (queue.length === 0) {
    processing = false;
    return;
  }
  processing = true;

  const event = queue.shift()!;

  try {
    switch (event.op) {
      case 'write':
        if (event.data) {
          await writeToOPFS(event.path, event.data);
        } else {
          // No data but file should still exist (empty file like .gitkeep)
          await writeToOPFS(event.path, new ArrayBuffer(0));
        }
        break;
      case 'delete':
        await deleteFromOPFS(event.path);
        break;
      case 'mkdir':
        await mkdirInOPFS(event.path);
        break;
      case 'rename':
        await renameInOPFS(event.path, event.newPath!);
        break;
    }
  } catch (err) {
    console.warn('[opfs-sync] mirror failed:', event.op, event.path, err);
  }

  // Move from pending → completed (starts grace window for delayed observer events)
  untrackPending(event.path);
  trackCompleted(event.path);
  if (event.op === 'rename' && event.newPath) {
    untrackPending(event.newPath);
    trackCompleted(event.newPath);
  }

  processNext();
}

async function ensureParentDirs(path: string): Promise<FileSystemDirectoryHandle> {
  const parts = path.split('/').filter(Boolean);
  parts.pop(); // Remove filename

  let dir = mirrorRoot;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

async function writeToOPFS(path: string, data: ArrayBuffer): Promise<void> {
  const dir = await ensureParentDirs(path);
  const name = basename(path);
  const fileHandle = await dir.getFileHandle(name, { create: true });
  // Use createSyncAccessHandle for reliable writes in Worker context
  // (createWritable can silently fail in nested workers for OPFS files)
  const accessHandle = await fileHandle.createSyncAccessHandle();
  try {
    accessHandle.truncate(0);
    accessHandle.write(new Uint8Array(data), { at: 0 });
    accessHandle.flush();
  } finally {
    accessHandle.close();
  }
}

async function deleteFromOPFS(path: string): Promise<void> {
  try {
    const dir = await navigateToParent(path);
    await dir.removeEntry(basename(path), { recursive: true });
  } catch {
    // File may not exist in OPFS — that's fine
  }
}

async function mkdirInOPFS(path: string): Promise<void> {
  let dir = mirrorRoot;
  const parts = path.split('/').filter(Boolean);
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
}

async function renameInOPFS(oldPath: string, newPath: string): Promise<void> {
  // OPFS doesn't have a native rename — copy + delete
  try {
    const oldDir = await navigateToParent(oldPath);
    const oldHandle = await oldDir.getFileHandle(basename(oldPath));
    const file = await oldHandle.getFile();
    const data = await file.arrayBuffer();

    const newDir = await ensureParentDirs(newPath);
    const newHandle = await newDir.getFileHandle(basename(newPath), { create: true });
    const accessHandle = await newHandle.createSyncAccessHandle();
    try {
      accessHandle.truncate(0);
      accessHandle.write(new Uint8Array(data), { at: 0 });
      accessHandle.flush();
    } finally {
      accessHandle.close();
    }

    await oldDir.removeEntry(basename(oldPath));
  } catch (err) {
    console.warn('[opfs-sync] rename failed:', oldPath, '→', newPath, err);
  }
}

async function navigateToParent(path: string): Promise<FileSystemDirectoryHandle> {
  const parts = path.split('/').filter(Boolean);
  parts.pop();

  let dir = mirrorRoot;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part);
  }
  return dir;
}

// ========== FileSystemObserver for external changes ==========

function setupObserver(): void {
  if (typeof FileSystemObserver === 'undefined') {
    console.warn('[opfs-sync] FileSystemObserver not available — external changes will not be detected');
    return;
  }

  console.log('[opfs-sync] Setting up FileSystemObserver on mirrorRoot:', mirrorRoot.name || '(opfs-root)');

  const observer = new FileSystemObserver((records) => {
    //console.log(`[opfs-sync] observer fired: ${records.length} record(s), pending=${pendingPaths.size}, completed=${completedPaths.size}`);
    for (const record of records) {
      const path = normalizePath('/' + record.relativePathComponents.join('/'));

      // Skip VFS binary file and internal files
      if (path === '/.vfs.bin' || path === '/.vfs' || path.startsWith('/.vfs')) continue;

      // Echo suppression — check parents only for 'disappeared' (recursive delete cascading)
      const isDelete = record.type === 'disappeared';
      if (isOurEcho(path, isDelete)) {
        //console.log('[opfs-sync] suppressed (echo):', record.type, path);
        continue;
      }

      //console.log('[opfs-sync] external:', record.type, path);
      switch (record.type) {
        case 'appeared':
        case 'modified':
          syncExternalChange(path, record.changedHandle);
          break;
        case 'disappeared':
          syncExternalDelete(path);
          break;
        case 'moved': {
          const from = normalizePath('/' + record.relativePathMovedFrom!.join('/'));
          //console.log('[opfs-sync] external: moved from', from, '→', path);
          syncExternalRename(from, path);
          break;
        }
      }
    }
  });

  observer.observe(mirrorRoot, { recursive: true });
}

async function syncExternalChange(path: string, handle: FileSystemHandle | null): Promise<void> {
  try {
    if (!handle || handle.kind !== 'file') return;

    const fileHandle = handle as FileSystemFileHandle;
    const file = await fileHandle.getFile();
    const data = await file.arrayBuffer();

    serverPort.postMessage({
      op: 'external-write',
      path,
      data,
      ts: Date.now(),
    }, [data]);
  } catch (err) {
    // File may have been deleted between observer event and our read, or
    // a sync access handle may be holding the lock — either is fine to skip
    console.warn('[opfs-sync] external change read failed:', path, err);
  }
}

function syncExternalDelete(path: string): void {
  serverPort.postMessage({
    op: 'external-delete',
    path,
    ts: Date.now(),
  });
}

function syncExternalRename(oldPath: string, newPath: string): void {
  serverPort.postMessage({
    op: 'external-rename',
    path: oldPath,
    newPath,
    ts: Date.now(),
  });
}

// ========== Initialization ==========

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === 'init') {
    serverPort = e.ports[0];
    mirrorRoot = await navigator.storage.getDirectory();

    // Navigate to mirror root if specified
    if (msg.root && msg.root !== '/') {
      const segments = msg.root.split('/').filter(Boolean);
      for (const segment of segments) {
        mirrorRoot = await mirrorRoot.getDirectoryHandle(segment, { create: true });
      }
    }

    console.log('[opfs-sync] initialized with root:', msg.root || '/', 'mirrorRoot.name:', mirrorRoot.name || '(opfs-root)');

    // Set up FileSystemObserver
    setupObserver();

    // Listen for events from server
    serverPort.onmessage = (ev: MessageEvent) => {
      const event = ev.data as SyncEvent;
      enqueue(event);
    };
    serverPort.start();

    (self as unknown as Worker).postMessage({ type: 'ready' });
    return;
  }
};
