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

  let result: { status: number; data?: Uint8Array | null };

  switch (op) {
    case OP.READ:
      result = engine.read(path);
      break;

    case OP.WRITE:
      result = engine.write(path, data ?? new Uint8Array(0), flags);
      notifyOPFSSync('write', path, data);
      break;

    case OP.APPEND:
      result = engine.append(path, data ?? new Uint8Array(0));
      notifyOPFSSync('write', path, data);
      break;

    case OP.UNLINK:
      result = engine.unlink(path);
      notifyOPFSSync('delete', path);
      break;

    case OP.STAT:
      result = engine.stat(path);
      break;

    case OP.LSTAT:
      result = engine.lstat(path);
      break;

    case OP.MKDIR:
      result = engine.mkdir(path, flags);
      notifyOPFSSync('mkdir', path);
      break;

    case OP.RMDIR:
      result = engine.rmdir(path, flags);
      notifyOPFSSync('delete', path);
      break;

    case OP.READDIR:
      result = engine.readdir(path, flags);
      break;

    case OP.RENAME: {
      const newPath = data ? decodeSecondPath(data) : '';
      result = engine.rename(path, newPath);
      notifyOPFSSync('rename', path, undefined, newPath);
      break;
    }

    case OP.EXISTS:
      result = engine.exists(path);
      break;

    case OP.TRUNCATE: {
      const len = data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
      result = engine.truncate(path, len);
      break;
    }

    case OP.COPY: {
      const destPath = data ? decodeSecondPath(data) : '';
      result = engine.copy(path, destPath, flags);
      break;
    }

    case OP.ACCESS:
      result = engine.access(path, flags);
      break;

    case OP.REALPATH:
      result = engine.realpath(path);
      break;

    case OP.CHMOD: {
      const mode = data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
      result = engine.chmod(path, mode);
      break;
    }

    case OP.CHOWN: {
      if (!data || data.byteLength < 8) {
        result = { status: 7 }; // EINVAL
        break;
      }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const uid = dv.getUint32(0, true);
      const gid = dv.getUint32(4, true);
      result = engine.chown(path, uid, gid);
      break;
    }

    case OP.UTIMES: {
      if (!data || data.byteLength < 16) {
        result = { status: 7 }; // EINVAL
        break;
      }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const atime = dv.getFloat64(0, true);
      const mtime = dv.getFloat64(8, true);
      result = engine.utimes(path, atime, mtime);
      break;
    }

    case OP.SYMLINK: {
      const target = data ? new TextDecoder().decode(data) : '';
      result = engine.symlink(target, path);
      break;
    }

    case OP.READLINK:
      result = engine.readlink(path);
      break;

    case OP.LINK: {
      const newPath = data ? decodeSecondPath(data) : '';
      result = engine.link(path, newPath);
      break;
    }

    case OP.OPEN: {
      result = engine.open(path, flags, tabId);
      break;
    }

    case OP.CLOSE: {
      const fd = data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
      result = engine.close(fd);
      break;
    }

    case OP.FREAD: {
      if (!data || data.byteLength < 12) {
        result = { status: 7 }; // EINVAL
        break;
      }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const fd = dv.getUint32(0, true);
      const length = dv.getUint32(4, true);
      const pos = dv.getInt32(8, true);
      result = engine.fread(fd, length, pos === -1 ? null : pos);
      break;
    }

    case OP.FWRITE: {
      if (!data || data.byteLength < 8) {
        result = { status: 7 }; // EINVAL
        break;
      }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const fd = dv.getUint32(0, true);
      const pos = dv.getInt32(4, true);
      const writeData = data.subarray(8);
      result = engine.fwrite(fd, writeData, pos === -1 ? null : pos);
      break;
    }

    case OP.FSTAT: {
      const fd = data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
      result = engine.fstat(fd);
      break;
    }

    case OP.FTRUNCATE: {
      if (!data || data.byteLength < 8) {
        result = { status: 7 };
        break;
      }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const fd = dv.getUint32(0, true);
      const len = dv.getUint32(4, true);
      result = engine.ftruncate(fd, len);
      break;
    }

    case OP.FSYNC:
      result = engine.fsync();
      break;

    case OP.OPENDIR:
      result = engine.opendir(path, tabId);
      break;

    case OP.MKDTEMP:
      result = engine.mkdtemp(path);
      break;

    default:
      result = { status: 7 }; // EINVAL — unknown op
  }

  const responseData = result.data instanceof Uint8Array ? result.data : undefined;
  return encodeResponse(result.status, responseData);
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
      const response = handleRequest(tabId, buffer);
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
