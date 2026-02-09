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

// Echo suppression: tracks our own writes to ignore observer callbacks
const pendingOps = new Map<string, number>();
const ECHO_WINDOW_MS = 500;

// Event queue — process one at a time, in order
const queue: SyncEvent[] = [];
let processing = false;

function enqueue(event: SyncEvent): void {
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
  pendingOps.set(event.path, event.ts);

  try {
    switch (event.op) {
      case 'write':
        await writeToOPFS(event.path, event.data!);
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
  } catch {
    // Log but don't block queue — OPFS mirror is best-effort
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
  const fileHandle = await dir.getFileHandle(basename(path), { create: true });
  const syncHandle = await fileHandle.createSyncAccessHandle();

  syncHandle.truncate(0);
  syncHandle.write(new Uint8Array(data), { at: 0 });
  syncHandle.flush();
  syncHandle.close();
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
    const syncHandle = await newHandle.createSyncAccessHandle();
    syncHandle.truncate(0);
    syncHandle.write(new Uint8Array(data), { at: 0 });
    syncHandle.flush();
    syncHandle.close();

    await oldDir.removeEntry(basename(oldPath));
  } catch {
    // Best-effort
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
  if (typeof FileSystemObserver === 'undefined') return;

  const observer = new FileSystemObserver((records) => {
    for (const record of records) {
      const path = '/' + record.relativePathComponents.join('/');

      // Skip VFS binary file
      if (path === '/.vfs.bin' || path === '/.vfs') continue;

      // Echo suppression
      const pendingTs = pendingOps.get(path);
      if (pendingTs && Date.now() - pendingTs < ECHO_WINDOW_MS) {
        pendingOps.delete(path);
        continue;
      }

      switch (record.type) {
        case 'appeared':
        case 'modified':
          syncExternalChange(path, record.changedHandle);
          break;
        case 'disappeared':
          syncExternalDelete(path);
          break;
        case 'moved':
          syncExternalRename(
            '/' + record.relativePathMovedFrom!.join('/'),
            path
          );
          break;
      }
    }
  });

  observer.observe(mirrorRoot, { recursive: true });
}

async function syncExternalChange(path: string, handle: FileSystemHandle | null): Promise<void> {
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
