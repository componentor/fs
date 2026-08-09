/**
 * Server Worker — the VFS file handle owner.
 *
 * This worker is the ONLY entity that opens sync file handles.
 * It receives binary requests from client workers via MessageChannel
 * ports and dispatches to the VFS engine.
 *
 * Critical performance rules:
 * 1. Only receives and sends ArrayBuffers — no JSON, no strings
 * 2. Only does sync file operations
 * 3. Minimal work — decode header, execute op, encode response
 * 4. Zero-copy transfers on all MessageChannel communication
 * 5. No encoding/decoding — that is the client's responsibility
 * 6. Handles stay open — never close/reopen during normal operation
 */

import { VFSEngine } from '../vfs/engine.js';
import { decodeRequest, decodeSecondPath, encodeResponse, OP } from '../protocol/opcodes.js';
import { dispatchOp } from '../protocol/dispatch.js';

const engine = new VFSEngine();

// Map of tabId → received port (from client workers via Service Worker)
const ports = new Map<string, MessagePort>();

// OPFS Sync Worker port (optional)
let opfsSyncPort: MessagePort | null = null;

// Config received from spawning tab
let config: {
  root: string;
  opfsSync: boolean;
  uid: number;
  gid: number;
  umask: number;
  strictPermissions: boolean;
} = {
  root: '/',
  opfsSync: true,
  uid: 0,
  gid: 0,
  umask: 0o022,
  strictPermissions: false,
};

/**
 * Handle a binary request from a client worker.
 */
function handleRequest(tabId: string, buffer: ArrayBuffer): ArrayBuffer {
  const { op, flags, path, data } = decodeRequest(buffer);

  // One shared decoder for every payload layout — see dispatch.ts. This used to be a private
  // copy of that switch, and the copies drifted: TRUNCATE/FTRUNCATE lengths were read as uint32
  // where the client writes float64, so every non-zero truncate emptied the file.
  const result = dispatchOp(engine, tabId, op, flags, path, data);

  if (result.status === 0) notifyMirror(op, path, data);

  const responseData = result.data instanceof Uint8Array ? result.data : undefined;
  return encodeResponse(result.status, responseData);
}

/**
 * Forward a successful mutation to the OPFS mirror.
 *
 * Only ops that change the tree or a file's bytes are forwarded; reads and metadata queries are
 * skipped. Previously these calls were interleaved with the dispatch switch and fired even when
 * the op had failed — a rejected mkdir still told the mirror to create the directory.
 */
function notifyMirror(op: number, path: string, data: Uint8Array | null): void {
  if (!opfsSyncPort) return;

  switch (op) {
    case OP.WRITE:
    case OP.APPEND:
      notifyOPFSSync('write', path, data);
      break;
    case OP.UNLINK:
    case OP.RMDIR:
      notifyOPFSSync('delete', path);
      break;
    case OP.MKDIR:
      notifyOPFSSync('mkdir', path);
      break;
    case OP.RENAME:
      notifyOPFSSync('rename', path, undefined, data ? decodeSecondPath(data) : '');
      break;
  }
}

/** Notify OPFS sync worker of a VFS mutation */
function notifyOPFSSync(
  op: 'write' | 'delete' | 'mkdir' | 'rename',
  path: string,
  data?: Uint8Array | null,
  newPath?: string
): void {
  if (!opfsSyncPort) return;

  const msg: Record<string, unknown> = { op, path, ts: Date.now() };
  const transfers: ArrayBuffer[] = [];

  if (op === 'write' && data) {
    // Copy data for transfer (original may be reused)
    const copy = data.slice().buffer;
    msg.data = copy;
    transfers.push(copy);
  }

  if (op === 'rename' && newPath) {
    msg.newPath = newPath;
  }

  opfsSyncPort.postMessage(msg, transfers);
}

/** Set up a client port for a specific tab */
function setupClientPort(tabId: string, port: MessagePort): void {
  ports.set(tabId, port);

  port.onmessage = (e: MessageEvent) => {
    const { buffer, id } = e.data;

    if (buffer instanceof ArrayBuffer) {
      let response: ArrayBuffer;
      try {
        response = handleRequest(tabId, buffer);
      } catch (err) {
        // An engine op threw (e.g. ENOSPC when the volume is full). Degrade to
        // an EIO response rather than rejecting and hanging the awaiting client.
        console.error('[server.worker] handleRequest threw:', (err as Error)?.message);
        response = encodeResponse(11, undefined); // EIO
      }
      port.postMessage({ id, buffer: response }, [response]);
    }
  };

  port.start();
}

/** Handle tab death — clean up resources */
function onTabLost(tabId: string): void {
  engine.cleanupTab(tabId);
  const port = ports.get(tabId);
  if (port) {
    port.close();
    ports.delete(tabId);
  }
}

// ========== Initialization ==========

async function init(initData: {
  root: string;
  opfsSync: boolean;
  uid: number;
  gid: number;
  umask: number;
  strictPermissions: boolean;
}): Promise<void> {
  config = initData;

  // Get OPFS root
  let rootDir = await navigator.storage.getDirectory();

  // Navigate to configured root
  if (config.root && config.root !== '/') {
    const segments = config.root.split('/').filter(Boolean);
    for (const segment of segments) {
      rootDir = await rootDir.getDirectoryHandle(segment, { create: true });
    }
  }

  // Open VFS binary file
  const vfsFileHandle = await rootDir.getFileHandle('.vfs.bin', { create: true });
  const vfsHandle = await vfsFileHandle.createSyncAccessHandle();

  // Initialize VFS engine
  engine.init(vfsHandle, {
    uid: config.uid,
    gid: config.gid,
    umask: config.umask,
    strictPermissions: config.strictPermissions,
  });
}

// ========== Message handling (from sync relay worker in same tab) ==========

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === 'init') {
    await init(msg.config);
    (self as unknown as Worker).postMessage({ type: 'ready' });
    return;
  }

  if (msg.type === 'port') {
    // Receive a client port (transferred from service worker or direct)
    setupClientPort(msg.tabId, msg.port);
    return;
  }

  if (msg.type === 'tab-lost') {
    onTabLost(msg.tabId);
    return;
  }

  if (msg.type === 'opfs-sync-port') {
    opfsSyncPort = msg.port;
    opfsSyncPort!.start();
    return;
  }

  // Direct request (from same-tab sync worker, uses buffer + id)
  if (msg.buffer instanceof ArrayBuffer) {
    const tabId = msg.tabId || 'local';
    const response = handleRequest(tabId, msg.buffer);
    (self as unknown as Worker).postMessage(
      { id: msg.id, buffer: response },
      [response]
    );
  }
};
