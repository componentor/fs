/**
 * Sync Relay Worker — the VFS engine owner and primary request processor.
 *
 * Operates in one of two modes:
 *
 * LEADER MODE (primary tab):
 *   - Owns the VFS engine and OPFS sync access handle
 *   - Processes own tab's sync requests via syncSAB (fastest path, no hops)
 *   - Processes own tab's async requests via asyncSAB (no MessagePort hop)
 *   - Accepts MessagePort connections from secondary tabs
 *   - Yields periodically to process port messages when clients are connected
 *   - When no clients: pure blocking loop — zero overhead
 *
 * FOLLOWER MODE (secondary tabs):
 *   - Does NOT own VFS engine
 *   - Connects to leader's sync-relay via MessagePort (through service worker)
 *   - Relays own tab's sync + async SAB requests via MessagePort to leader
 *   - Same SAB protocol with own main thread, but forwards to leader for processing
 *
 * Priority order: syncSAB > asyncSAB > client port messages
 */

import { VFSEngine } from '../vfs/engine.js';
import { OPFSEngine } from '../opfs-engine.js';
import { SAB_OFFSETS, SIGNAL, OP, decodeRequest, decodeSecondPath, encodeResponse } from '../protocol/opcodes.js';

const engine = new VFSEngine();
let opfsEngine: OPFSEngine | null = null;
let opfsMode = false;

// Guards: prevent duplicate init and double-ready
let leaderInitialized = false;
let readySent = false;
let debug = false;
let leaderLoopRunning = false;

// OPFS Sync Worker (leader mode only — mirrors VFS to real OPFS files)
let opfsSyncPort: MessagePort | null = null;
let opfsSyncEnabled = false;
const suppressPaths = new Set<string>(); // break external→engine→notify loop

// Watch broadcast (leader mode only — fires on every VFS mutation)
let watchBc: BroadcastChannel | null = null;

// Own tab's sync SAB
let sab: SharedArrayBuffer;
let ctrl: Int32Array;
let readySab: SharedArrayBuffer;
let readySignal: Int32Array;

// Own tab's async SAB (shared with async-relay worker)
let asyncSab: SharedArrayBuffer | null = null;
let asyncCtrl: Int32Array | null = null;

// Tab identity
let tabId: string = '';

const HEADER_SIZE = SAB_OFFSETS.HEADER_SIZE;

// ========== Leader mode: client port management ==========

const clientPorts = new Map<string, MessagePort>();
const portQueue: Array<{ port: MessagePort; tabId: string; id: string; buffer: ArrayBuffer }> = [];

// Fast macrotask yield via MessageChannel self-post (~0.1ms)
const yieldChannel = new MessageChannel();
yieldChannel.port2.start();

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => {
    yieldChannel.port2.onmessage = () => resolve();
    yieldChannel.port1.postMessage(null);
  });
}

function registerClientPort(clientTabId: string, port: MessagePort): void {
  port.onmessage = async (e: MessageEvent) => {
    if (e.data.buffer instanceof ArrayBuffer) {
      if (leaderLoopRunning) {
        // Leader loop will drain the queue
        portQueue.push({
          port,
          tabId: clientTabId,
          id: e.data.id,
          buffer: e.data.buffer,
        });
      } else {
        // No leader loop (no-SAB mode): handle directly
        const result = opfsMode
          ? await handleRequestOPFS(clientTabId, e.data.buffer)
          : handleRequest(clientTabId, e.data.buffer);
        const response = encodeResponse(result.status, result.data);
        port.postMessage({ id: e.data.id, buffer: response }, [response]);
        if (!opfsMode && result._op !== undefined) notifyOPFSSync(result._op, result._path!, result._newPath);
      }
    }
  };
  port.start();
  clientPorts.set(clientTabId, port);
}

function removeClientPort(clientTabId: string): void {
  const port = clientPorts.get(clientTabId);
  if (port) {
    port.close();
    clientPorts.delete(clientTabId);
  }
  if (opfsMode) {
    opfsEngine?.cleanupTab(clientTabId);
  } else {
    engine.cleanupTab(clientTabId);
  }
}

function drainPortQueue(): void {
  while (portQueue.length > 0) {
    const msg = portQueue.shift()!;
    const result = handleRequest(msg.tabId, msg.buffer);
    const response = encodeResponse(result.status, result.data);
    msg.port.postMessage({ id: msg.id, buffer: response }, [response]);
    if (result._op !== undefined) notifyOPFSSync(result._op, result._path!, result._newPath);
  }
}

async function drainPortQueueAsync(): Promise<void> {
  while (portQueue.length > 0) {
    const msg = portQueue.shift()!;
    const result = await handleRequestOPFS(msg.tabId, msg.buffer);
    const response = encodeResponse(result.status, result.data);
    msg.port.postMessage({ id: msg.id, buffer: response }, [response]);
  }
}

// ========== Follower mode: leader port ==========

let leaderPort: MessagePort | null = null;
let pendingResolve: ((buf: ArrayBuffer) => void) | null = null;

// No-SAB mode: async-relay port (for forwarding in follower mode)
let asyncRelayPort: MessagePort | null = null;

function forwardToLeader(payload: Uint8Array): Promise<ArrayBuffer> {
  return new Promise(resolve => {
    pendingResolve = resolve;
    const buf = payload.buffer.byteLength === payload.byteLength
      ? payload.buffer
      : payload.slice().buffer;
    leaderPort!.postMessage(
      { id: tabId, tabId, buffer: buf },
      [buf]
    );
  });
}

function onLeaderMessage(e: MessageEvent): void {
  if (e.data.buffer instanceof ArrayBuffer) {
    if (pendingResolve) {
      // SAB follower: resolve sync relay promise
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve(e.data.buffer);
    } else if (asyncRelayPort) {
      // No-SAB follower: forward response back to async-relay
      asyncRelayPort.postMessage({ id: e.data.id, buffer: e.data.buffer }, [e.data.buffer]);
    }
  }
}

// ========== Request dispatch (leader mode) ==========

const OP_NAMES: Record<number, string> = {
  1: 'READ', 2: 'WRITE', 3: 'UNLINK', 4: 'STAT', 5: 'LSTAT', 6: 'MKDIR',
  7: 'RMDIR', 8: 'READDIR', 9: 'RENAME', 10: 'EXISTS', 11: 'TRUNCATE',
  12: 'APPEND', 13: 'COPY', 14: 'ACCESS', 15: 'REALPATH', 16: 'CHMOD',
  17: 'CHOWN', 18: 'UTIMES', 19: 'SYMLINK', 20: 'READLINK', 21: 'LINK',
  22: 'OPEN', 23: 'CLOSE', 24: 'FREAD', 25: 'FWRITE', 26: 'FSTAT',
  27: 'FTRUNCATE', 28: 'FSYNC', 29: 'OPENDIR', 30: 'MKDTEMP',
};

function handleRequest(reqTabId: string, buffer: ArrayBuffer): { status: number; data?: Uint8Array; _op?: number; _path?: string; _newPath?: string } {
  const t0 = debug ? performance.now() : 0;
  const { op, flags, path, data } = decodeRequest(buffer);
  const t1 = debug ? performance.now() : 0;

  let result: { status: number; data?: Uint8Array | null };
  let syncOp: number | undefined;
  let syncPath: string | undefined;
  let syncNewPath: string | undefined;

  switch (op) {
    case OP.READ:
      result = engine.read(path);
      break;

    case OP.WRITE:
      result = engine.write(path, data ?? new Uint8Array(0), flags);
      if (result.status === 0) { syncOp = op; syncPath = path; }
      break;

    case OP.APPEND:
      result = engine.append(path, data ?? new Uint8Array(0));
      if (result.status === 0) { syncOp = op; syncPath = path; }
      break;

    case OP.UNLINK:
      result = engine.unlink(path);
      if (result.status === 0) { syncOp = op; syncPath = path; }
      break;

    case OP.STAT:
      result = engine.stat(path);
      break;

    case OP.LSTAT:
      result = engine.lstat(path);
      break;

    case OP.MKDIR:
      result = engine.mkdir(path, flags);
      if (result.status === 0) { syncOp = op; syncPath = path; }
      break;

    case OP.RMDIR:
      result = engine.rmdir(path, flags);
      if (result.status === 0) { syncOp = op; syncPath = path; }
      break;

    case OP.READDIR:
      result = engine.readdir(path, flags);
      break;

    case OP.RENAME: {
      const newPath = data ? decodeSecondPath(data) : '';
      result = engine.rename(path, newPath);
      if (result.status === 0) { syncOp = op; syncPath = path; syncNewPath = newPath; }
      break;
    }

    case OP.EXISTS:
      result = engine.exists(path);
      break;

    case OP.TRUNCATE: {
      const len = data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
      result = engine.truncate(path, len);
      if (result.status === 0) { syncOp = op; syncPath = path; }
      break;
    }

    case OP.COPY: {
      const destPath = data ? decodeSecondPath(data) : '';
      result = engine.copy(path, destPath, flags);
      if (result.status === 0) { syncOp = op; syncPath = destPath; }
      break;
    }

    case OP.ACCESS:
      result = engine.access(path, flags);
      break;

    case OP.REALPATH:
      result = engine.realpath(path);
      break;

    case OP.CHMOD: {
      const chmodMode = data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
      result = engine.chmod(path, chmodMode);
      if (result.status === 0) { syncOp = op; syncPath = path; }
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
      if (result.status === 0) { syncOp = op; syncPath = path; }
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
      if (result.status === 0) { syncOp = op; syncPath = path; }
      break;
    }

    case OP.SYMLINK: {
      const target = data ? new TextDecoder().decode(data) : '';
      result = engine.symlink(target, path);
      if (result.status === 0) { syncOp = op; syncPath = path; }
      break;
    }

    case OP.READLINK:
      result = engine.readlink(path);
      break;

    case OP.LINK: {
      const newPath = data ? decodeSecondPath(data) : '';
      result = engine.link(path, newPath);
      if (result.status === 0) { syncOp = op; syncPath = newPath; }
      break;
    }

    case OP.OPEN:
      result = engine.open(path, flags, reqTabId);
      break;

    case OP.CLOSE: {
      const fd = data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
      result = engine.close(fd);
      break;
    }

    case OP.FREAD: {
      if (!data || data.byteLength < 12) {
        result = { status: 7 };
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
        result = { status: 7 };
        break;
      }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const fd = dv.getUint32(0, true);
      const pos = dv.getInt32(4, true);
      const writeData = data.subarray(8);
      result = engine.fwrite(fd, writeData, pos === -1 ? null : pos);
      if (result.status === 0) { syncOp = op; syncPath = engine.getPathForFd(fd) ?? undefined; }
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
      if (result.status === 0) { syncOp = op; syncPath = engine.getPathForFd(fd) ?? undefined; }
      break;
    }

    case OP.FSYNC:
      result = engine.fsync();
      break;

    case OP.OPENDIR:
      result = engine.opendir(path, reqTabId);
      break;

    case OP.MKDTEMP:
      result = engine.mkdtemp(path);
      if (result.status === 0 && result.data) {
        syncOp = op;
        syncPath = new TextDecoder().decode(result.data instanceof Uint8Array ? result.data : new Uint8Array(0));
      }
      break;

    default:
      result = { status: 7 }; // EINVAL — unknown op
  }

  if (debug) {
    const t2 = performance.now();
    console.log(`[sync-relay] op=${OP_NAMES[op] ?? op} path=${path} decode=${(t1-t0).toFixed(3)}ms engine=${(t2-t1).toFixed(3)}ms TOTAL=${(t2-t0).toFixed(3)}ms`);
  }

  const ret: { status: number; data?: Uint8Array; _op?: number; _path?: string; _newPath?: string } = {
    status: result.status,
    data: result.data instanceof Uint8Array ? result.data : undefined,
  };
  if (syncOp !== undefined && syncPath) {
    // OPFS sync metadata (only used when opfsSyncEnabled, but callers guard via notifyOPFSSync)
    ret._op = syncOp;
    ret._path = syncPath;
    ret._newPath = syncNewPath;
    // Watch broadcast (always, for all tabs)
    broadcastWatch(syncOp, syncPath, syncNewPath);
  }
  return ret;
}

// ========== OPFS mode: async request handler ==========

async function handleRequestOPFS(reqTabId: string, buffer: ArrayBuffer): Promise<{ status: number; data?: Uint8Array; _op?: number; _path?: string; _newPath?: string }> {
  const oe = opfsEngine!;
  const { op, flags, path, data } = decodeRequest(buffer);

  let result: { status: number; data?: Uint8Array | null };
  let syncPath: string | undefined;
  let syncNewPath: string | undefined;

  switch (op) {
    case OP.READ:
      result = await oe.read(path);
      break;
    case OP.WRITE:
      result = await oe.write(path, data ?? new Uint8Array(0), flags);
      syncPath = path;
      break;
    case OP.APPEND:
      result = await oe.append(path, data ?? new Uint8Array(0));
      syncPath = path;
      break;
    case OP.UNLINK:
      result = await oe.unlink(path);
      syncPath = path;
      break;
    case OP.STAT:
      result = await oe.stat(path);
      break;
    case OP.LSTAT:
      result = await oe.lstat(path);
      break;
    case OP.MKDIR:
      result = await oe.mkdir(path, flags);
      syncPath = path;
      break;
    case OP.RMDIR:
      result = await oe.rmdir(path, flags);
      syncPath = path;
      break;
    case OP.READDIR:
      result = await oe.readdir(path, flags);
      break;
    case OP.RENAME: {
      const newPath = data ? decodeSecondPath(data) : '';
      result = await oe.rename(path, newPath);
      syncPath = path; syncNewPath = newPath;
      break;
    }
    case OP.EXISTS:
      result = await oe.exists(path);
      break;
    case OP.TRUNCATE: {
      const len = data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
      result = await oe.truncate(path, len);
      syncPath = path;
      break;
    }
    case OP.COPY: {
      const destPath = data ? decodeSecondPath(data) : '';
      result = await oe.copy(path, destPath, flags);
      syncPath = destPath;
      break;
    }
    case OP.ACCESS:
      result = await oe.access(path, flags);
      break;
    case OP.REALPATH:
      result = await oe.realpath(path);
      break;
    case OP.CHMOD: {
      const chmodMode = data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
      result = await oe.chmod(path, chmodMode);
      break;
    }
    case OP.CHOWN: {
      if (!data || data.byteLength < 8) { result = { status: 7 }; break; }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      result = await oe.chown(path, dv.getUint32(0, true), dv.getUint32(4, true));
      break;
    }
    case OP.UTIMES: {
      if (!data || data.byteLength < 16) { result = { status: 7 }; break; }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      result = await oe.utimes(path, dv.getFloat64(0, true), dv.getFloat64(8, true));
      break;
    }
    case OP.SYMLINK: {
      const target = data ? new TextDecoder().decode(data) : '';
      result = await oe.symlink(target, path);
      break;
    }
    case OP.READLINK:
      result = await oe.readlink(path);
      break;
    case OP.LINK: {
      const newPath = data ? decodeSecondPath(data) : '';
      result = await oe.link(path, newPath);
      syncPath = newPath;
      break;
    }
    case OP.OPEN:
      result = await oe.open(path, flags, reqTabId);
      break;
    case OP.CLOSE: {
      const fd = data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
      result = await oe.close(fd);
      break;
    }
    case OP.FREAD: {
      if (!data || data.byteLength < 12) { result = { status: 7 }; break; }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      result = await oe.fread(dv.getUint32(0, true), dv.getUint32(4, true), dv.getInt32(8, true) === -1 ? null : dv.getInt32(8, true));
      break;
    }
    case OP.FWRITE: {
      if (!data || data.byteLength < 8) { result = { status: 7 }; break; }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const fd = dv.getUint32(0, true);
      const pos = dv.getInt32(4, true);
      result = await oe.fwrite(fd, data.subarray(8), pos === -1 ? null : pos);
      syncPath = oe.getPathForFd(fd) ?? undefined;
      break;
    }
    case OP.FSTAT: {
      const fd = data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
      result = await oe.fstat(fd);
      break;
    }
    case OP.FTRUNCATE: {
      if (!data || data.byteLength < 8) { result = { status: 7 }; break; }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      result = await oe.ftruncate(dv.getUint32(0, true), dv.getUint32(4, true));
      syncPath = oe.getPathForFd(dv.getUint32(0, true)) ?? undefined;
      break;
    }
    case OP.FSYNC:
      result = await oe.fsync();
      break;
    case OP.OPENDIR:
      result = await oe.opendir(path, reqTabId);
      break;
    case OP.MKDTEMP:
      result = await oe.mkdtemp(path);
      if (result.status === 0 && result.data) {
        syncPath = new TextDecoder().decode(result.data instanceof Uint8Array ? result.data : new Uint8Array(0));
      }
      break;
    default:
      result = { status: 7 };
  }

  const ret: { status: number; data?: Uint8Array; _op?: number; _path?: string; _newPath?: string } = {
    status: result.status,
    data: result.data instanceof Uint8Array ? result.data : undefined,
  };
  if (result.status === 0 && syncPath) {
    // Watch broadcast (OPFS mode doesn't need OPFS sync since it IS OPFS)
    broadcastWatch(op, syncPath, syncNewPath);
  }
  return ret;
}

// ========== SAB I/O helpers ==========

/**
 * Read the full request/response payload from a SAB. Handles multi-chunk assembly.
 * Returns an owned Uint8Array (not a view into the SAB).
 */
function readPayload(targetSab: SharedArrayBuffer, targetCtrl: Int32Array): Uint8Array {
  const totalLenView = new BigUint64Array(targetSab, SAB_OFFSETS.TOTAL_LEN, 1);
  const maxChunk = targetSab.byteLength - HEADER_SIZE;

  const chunkLen = Atomics.load(targetCtrl, 3);
  const totalLen = Number(Atomics.load(totalLenView, 0));

  if (totalLen <= maxChunk) {
    // Fast path: single chunk
    return new Uint8Array(targetSab, HEADER_SIZE, chunkLen).slice();
  }

  // Multi-chunk: assemble full buffer
  const fullBuffer = new Uint8Array(totalLen);
  let offset = 0;

  // Read first chunk (already in SAB)
  fullBuffer.set(new Uint8Array(targetSab, HEADER_SIZE, chunkLen), offset);
  offset += chunkLen;

  // Ack and wait for more chunks
  while (offset < totalLen) {
    Atomics.store(targetCtrl, 0, SIGNAL.CHUNK_ACK);
    Atomics.notify(targetCtrl, 0);
    Atomics.wait(targetCtrl, 0, SIGNAL.CHUNK_ACK); // Wait for next chunk
    const nextLen = Atomics.load(targetCtrl, 3);
    fullBuffer.set(new Uint8Array(targetSab, HEADER_SIZE, nextLen), offset);
    offset += nextLen;
  }

  return fullBuffer;
}

/**
 * Write status + data directly into a SAB (no intermediate encodeResponse buffer).
 * Saves one full copy of the data compared to encodeResponse + writeResponse.
 */
function writeDirectResponse(
  targetSab: SharedArrayBuffer,
  targetCtrl: Int32Array,
  status: number,
  data?: Uint8Array
): void {
  const dataLen = data ? data.byteLength : 0;
  const totalLen = 8 + dataLen;
  const maxChunk = targetSab.byteLength - HEADER_SIZE;

  if (totalLen <= maxChunk) {
    // Fast path: write 8-byte header + data directly into SAB
    const hdr = new DataView(targetSab, HEADER_SIZE, 8);
    hdr.setUint32(0, status, true);
    hdr.setUint32(4, dataLen, true);
    if (data && dataLen > 0) {
      new Uint8Array(targetSab, HEADER_SIZE + 8, dataLen).set(data);
    }
    Atomics.store(targetCtrl, 3, totalLen);
    const totalView = new BigUint64Array(targetSab, SAB_OFFSETS.TOTAL_LEN, 1);
    Atomics.store(totalView, 0, BigInt(totalLen));
    Atomics.store(targetCtrl, 0, SIGNAL.RESPONSE);
    Atomics.notify(targetCtrl, 0);
  } else {
    // Multi-chunk: fall back to encoded buffer + chunked write
    const response = encodeResponse(status, data);
    writeResponse(targetSab, targetCtrl, new Uint8Array(response));
  }
}

/**
 * Write a response payload to a SAB and signal RESPONSE. Handles multi-chunk.
 */
function writeResponse(targetSab: SharedArrayBuffer, targetCtrl: Int32Array, responseData: Uint8Array): void {
  const maxChunk = targetSab.byteLength - HEADER_SIZE;

  if (responseData.byteLength <= maxChunk) {
    // Fast path: single chunk
    new Uint8Array(targetSab, HEADER_SIZE, responseData.byteLength).set(responseData);
    Atomics.store(targetCtrl, 3, responseData.byteLength);
    const totalView = new BigUint64Array(targetSab, SAB_OFFSETS.TOTAL_LEN, 1);
    Atomics.store(totalView, 0, BigInt(responseData.byteLength));
    Atomics.store(targetCtrl, 0, SIGNAL.RESPONSE);
    Atomics.notify(targetCtrl, 0);
  } else {
    // Multi-chunk response
    let sent = 0;
    while (sent < responseData.byteLength) {
      const chunkSize = Math.min(maxChunk, responseData.byteLength - sent);
      new Uint8Array(targetSab, HEADER_SIZE, chunkSize).set(
        responseData.subarray(sent, sent + chunkSize)
      );
      Atomics.store(targetCtrl, 3, chunkSize);
      Atomics.store(targetCtrl, 6, Math.floor(sent / maxChunk));

      const isLast = sent + chunkSize >= responseData.byteLength;
      Atomics.store(targetCtrl, 0, isLast ? SIGNAL.RESPONSE : SIGNAL.CHUNK);
      Atomics.notify(targetCtrl, 0);

      if (!isLast) {
        Atomics.wait(targetCtrl, 0, SIGNAL.CHUNK); // Wait for reader ack
      }
      sent += chunkSize;
    }
  }
}

// ========== Leader mode: main loop ==========

async function leaderLoop(): Promise<void> {
  leaderLoopRunning = true;
  while (true) {
    // === Inner tight loop: process all pending work without yielding ===
    let processed = true;
    let tightOps = 0;
    while (processed) {
      processed = false;

      // Periodic yield: during sustained load the inner loop never exits,
      // starving MessagePort handlers (external OPFS changes, client ports).
      // Yield every 100 ops to let the event loop process pending messages.
      if (++tightOps >= 100) {
        tightOps = 0;
        await yieldToEventLoop();
      }

      // Priority 1: own tab's sync requests (fastest path)
      if (Atomics.load(ctrl, 0) === SIGNAL.REQUEST) {
        const lt0 = debug ? performance.now() : 0;
        const payload = readPayload(sab, ctrl);
        const lt1 = debug ? performance.now() : 0;
        const reqResult = handleRequest(tabId, payload.buffer as ArrayBuffer);
        const lt2 = debug ? performance.now() : 0;
        writeDirectResponse(sab, ctrl, reqResult.status, reqResult.data);
        if (reqResult._op !== undefined) notifyOPFSSync(reqResult._op, reqResult._path!, reqResult._newPath);
        const lt3 = debug ? performance.now() : 0;
        if (debug) {
          console.log(`[leaderLoop] readPayload=${(lt1-lt0).toFixed(3)}ms handleRequest=${(lt2-lt1).toFixed(3)}ms writeResponse=${(lt3-lt2).toFixed(3)}ms TOTAL=${(lt3-lt0).toFixed(3)}ms`);
        }
        // Wait for main thread to consume response (10ms safety timeout).
        // Main thread sets IDLE without notify — worker stays asleep until the
        // NEXT request's notify wakes it. This gives ONE wake per operation.
        const waitResult = Atomics.wait(ctrl, 0, SIGNAL.RESPONSE, 10);
        if (waitResult === 'timed-out') {
          Atomics.store(ctrl, 0, SIGNAL.IDLE);
        }
        processed = true;
        continue;
      }

      // Priority 2: own tab's async requests
      if (asyncCtrl && Atomics.load(asyncCtrl, 0) === SIGNAL.REQUEST) {
        const payload = readPayload(asyncSab!, asyncCtrl);
        const asyncResult = handleRequest(tabId, payload.buffer as ArrayBuffer);
        writeDirectResponse(asyncSab!, asyncCtrl, asyncResult.status, asyncResult.data);
        if (asyncResult._op !== undefined) notifyOPFSSync(asyncResult._op, asyncResult._path!, asyncResult._newPath);
        const waitResult = Atomics.wait(asyncCtrl, 0, SIGNAL.RESPONSE, 10);
        if (waitResult === 'timed-out') {
          Atomics.store(asyncCtrl, 0, SIGNAL.IDLE);
        }
        processed = true;
        continue;
      }

      // Priority 3: client requests already queued from previous yields
      if (portQueue.length > 0) {
        drainPortQueue();
        processed = true;
        continue;
      }
    }

    // === All queues empty — yield to process MessagePort events ===
    // Always yield: external OPFS changes arrive via opfsSyncPort.onmessage,
    // client registrations via self.onmessage — both need the event loop.
    await yieldToEventLoop();

    // If no clients and no new SAB work, block briefly for next request
    if (clientPorts.size === 0 && !opfsSyncEnabled) {
      const currentSignal = Atomics.load(ctrl, 0);
      if (currentSignal !== SIGNAL.REQUEST) {
        Atomics.wait(ctrl, 0, currentSignal, 50);
      }
    }
  }
}

// ========== OPFS mode: leader loop (async handleRequest) ==========

async function leaderLoopOPFS(): Promise<void> {
  leaderLoopRunning = true;
  while (true) {
    let processed = true;
    let tightOps = 0;
    while (processed) {
      processed = false;

      if (++tightOps >= 100) {
        tightOps = 0;
        await yieldToEventLoop();
      }

      // Priority 1: own tab's sync requests
      if (Atomics.load(ctrl, 0) === SIGNAL.REQUEST) {
        const payload = readPayload(sab, ctrl);
        const reqResult = await handleRequestOPFS(tabId, payload.buffer as ArrayBuffer);
        writeDirectResponse(sab, ctrl, reqResult.status, reqResult.data);
        const waitResult = Atomics.wait(ctrl, 0, SIGNAL.RESPONSE, 10);
        if (waitResult === 'timed-out') {
          Atomics.store(ctrl, 0, SIGNAL.IDLE);
        }
        processed = true;
        continue;
      }

      // Priority 2: own tab's async requests
      if (asyncCtrl && Atomics.load(asyncCtrl, 0) === SIGNAL.REQUEST) {
        const payload = readPayload(asyncSab!, asyncCtrl);
        const asyncResult = await handleRequestOPFS(tabId, payload.buffer as ArrayBuffer);
        writeDirectResponse(asyncSab!, asyncCtrl, asyncResult.status, asyncResult.data);
        const waitResult = Atomics.wait(asyncCtrl, 0, SIGNAL.RESPONSE, 10);
        if (waitResult === 'timed-out') {
          Atomics.store(asyncCtrl, 0, SIGNAL.IDLE);
        }
        processed = true;
        continue;
      }

      // Priority 3: client requests
      if (portQueue.length > 0) {
        await drainPortQueueAsync();
        processed = true;
        continue;
      }
    }

    await yieldToEventLoop();

    if (clientPorts.size === 0) {
      const currentSignal = Atomics.load(ctrl, 0);
      if (currentSignal !== SIGNAL.REQUEST) {
        Atomics.wait(ctrl, 0, currentSignal, 50);
      }
    }
  }
}

// ========== Follower mode: relay loop ==========

async function followerLoop(): Promise<void> {
  while (true) {
    // Check own sync SAB
    if (Atomics.load(ctrl, 0) === SIGNAL.REQUEST) {
      const payload = readPayload(sab, ctrl);
      const response = await forwardToLeader(payload);
      writeResponse(sab, ctrl, new Uint8Array(response));
      // Wait for main thread to consume response (safety timeout to prevent deadlock —
      // main thread stores IDLE without notify)
      const result = Atomics.wait(ctrl, 0, SIGNAL.RESPONSE, 10);
      if (result === 'timed-out') {
        Atomics.store(ctrl, 0, SIGNAL.IDLE);
      }
      continue;
    }

    // Check own async SAB
    if (asyncCtrl && Atomics.load(asyncCtrl, 0) === SIGNAL.REQUEST) {
      const payload = readPayload(asyncSab!, asyncCtrl);
      const response = await forwardToLeader(payload);
      writeResponse(asyncSab!, asyncCtrl, new Uint8Array(response));
      const result = Atomics.wait(asyncCtrl, 0, SIGNAL.RESPONSE, 10);
      if (result === 'timed-out') {
        Atomics.store(asyncCtrl, 0, SIGNAL.IDLE);
      }
      continue;
    }

    // Wait for SAB notification or timeout; yield on idle to process onmessage
    // (e.g. leader-port reconnection). Requests wake via Atomics.notify on ctrl.
    const waitResult = Atomics.wait(ctrl, 0, SIGNAL.IDLE, 50);
    if (waitResult === 'timed-out') {
      await yieldToEventLoop();
    }
  }
}

// ========== OPFS + VFS engine initialization (leader only) ==========

async function initEngine(config: {
  root: string;
  ns: string;
  opfsSync: boolean;
  opfsSyncRoot?: string;
  uid: number;
  gid: number;
  umask: number;
  strictPermissions: boolean;
  debug?: boolean;
}): Promise<void> {
  debug = config.debug ?? false;

  // Navigate to configured OPFS root
  let rootDir = await navigator.storage.getDirectory();

  if (config.root && config.root !== '/') {
    const segments = config.root.split('/').filter(Boolean);
    for (const segment of segments) {
      rootDir = await rootDir.getDirectoryHandle(segment, { create: true });
    }
  }

  // Open VFS binary file with exclusive sync access
  const vfsFileHandle = await rootDir.getFileHandle('.vfs.bin', { create: true });
  const vfsHandle = await vfsFileHandle.createSyncAccessHandle();

  // Initialize VFS engine — release handle on corruption/failure
  try {
    engine.init(vfsHandle, {
      uid: config.uid,
      gid: config.gid,
      umask: config.umask,
      strictPermissions: config.strictPermissions,
      debug: config.debug,
    });
  } catch (err) {
    // Release the exclusive sync handle so it can be re-acquired
    try { vfsHandle.close(); } catch (_) {}
    throw err;
  }

  // Spawn OPFS sync worker (mirrors VFS mutations to real OPFS files)
  if (config.opfsSync) {
    opfsSyncEnabled = true;
    const mc = new MessageChannel();
    opfsSyncPort = mc.port1;
    opfsSyncPort.onmessage = (e) => handleExternalChange(e.data);
    opfsSyncPort.start();

    const workerUrl = new URL('./opfs-sync.worker.js', import.meta.url);
    const syncWorker = new Worker(workerUrl, { type: 'module' });
    syncWorker.postMessage(
      { type: 'init', root: config.opfsSyncRoot ?? config.root },
      [mc.port2],
    );
  }

  // Watch broadcast channel — fires on every VFS mutation for fs.watch() support
  watchBc = new BroadcastChannel(`${config.ns}-watch`);
}

/** Initialize OPFS-direct mode engine (no VFS binary) */
async function initOPFSEngine(config: {
  root: string;
  ns: string;
  uid: number;
  gid: number;
  debug?: boolean;
}): Promise<void> {
  debug = config.debug ?? false;
  opfsMode = true;

  // Navigate to configured OPFS root
  let rootDir = await navigator.storage.getDirectory();
  if (config.root && config.root !== '/') {
    const segments = config.root.split('/').filter(Boolean);
    for (const segment of segments) {
      rootDir = await rootDir.getDirectoryHandle(segment, { create: true });
    }
  }

  opfsEngine = new OPFSEngine();
  await opfsEngine.init(rootDir, {
    uid: config.uid,
    gid: config.gid,
  });

  // Watch broadcast channel for fs.watch() support
  watchBc = new BroadcastChannel(`${config.ns}-watch`);
}

// ========== Watch broadcast (fire-and-forget, after SAB response) ==========

function broadcastWatch(op: number, path: string, newPath?: string): void {
  if (!watchBc) return;

  let eventType: 'change' | 'rename';
  switch (op) {
    case OP.WRITE:
    case OP.APPEND:
    case OP.TRUNCATE:
    case OP.FWRITE:
    case OP.FTRUNCATE:
    case OP.CHMOD:
    case OP.CHOWN:
    case OP.UTIMES:
      eventType = 'change';
      break;
    case OP.UNLINK:
    case OP.RMDIR:
    case OP.RENAME:
    case OP.MKDIR:
    case OP.MKDTEMP:
    case OP.SYMLINK:
    case OP.LINK:
    case OP.COPY:
      eventType = 'rename';
      break;
    default:
      return;
  }

  watchBc.postMessage({ eventType, path });
  if (op === OP.RENAME && newPath) {
    watchBc.postMessage({ eventType: 'rename', path: newPath });
  }
}

// ========== OPFS sync notification (fire-and-forget, after SAB response) ==========

function notifyOPFSSync(op: number, path: string, newPath?: string): void {
  if (!opfsSyncPort) return;
  if (suppressPaths.has(path)) {
    suppressPaths.delete(path);
    return;
  }

  const ts = Date.now();

  switch (op) {
    case OP.WRITE:
    case OP.APPEND:
    case OP.TRUNCATE:
    case OP.FWRITE:
    case OP.FTRUNCATE:
    case OP.COPY:
    case OP.LINK: {
      const result = engine.read(path);
      if (result.status === 0) {
        if (result.data && result.data.byteLength > 0) {
          const buf = result.data.buffer.byteLength === result.data.byteLength
            ? result.data.buffer
            : result.data.slice().buffer;
          opfsSyncPort.postMessage({ op: 'write', path, data: buf, ts } as const, [buf as ArrayBuffer]);
        } else {
          // Empty file (e.g. .gitkeep) — send with empty ArrayBuffer
          opfsSyncPort.postMessage({ op: 'write', path, data: new ArrayBuffer(0), ts });
        }
      }
      break;
    }
    case OP.SYMLINK: {
      // OPFS has no symlinks — mirror as regular file with target's content
      const result = engine.read(path); // follows symlink to target
      if (result.status === 0) {
        if (result.data && result.data.byteLength > 0) {
          const buf = result.data.buffer.byteLength === result.data.byteLength
            ? result.data.buffer
            : result.data.slice().buffer;
          opfsSyncPort.postMessage({ op: 'write', path, data: buf, ts } as const, [buf as ArrayBuffer]);
        } else {
          opfsSyncPort.postMessage({ op: 'write', path, data: new ArrayBuffer(0), ts });
        }
      }
      // If target doesn't exist yet (dangling symlink), skip — will be synced
      // when the target is written and read through the symlink succeeds
      break;
    }
    case OP.UNLINK:
    case OP.RMDIR:
      opfsSyncPort.postMessage({ op: 'delete', path, ts });
      break;
    case OP.MKDIR:
    case OP.MKDTEMP:
      opfsSyncPort.postMessage({ op: 'mkdir', path, ts });
      break;
    case OP.RENAME:
      if (newPath) {
        opfsSyncPort.postMessage({ op: 'rename', path, newPath, ts });
      }
      break;
  }
}

function handleExternalChange(msg: { op: string; path: string; newPath?: string; data?: ArrayBuffer }): void {
  switch (msg.op) {
    case 'external-write': {
      suppressPaths.add(msg.path);
      const result = engine.write(msg.path, new Uint8Array(msg.data!), 0);
      if (result.status === 0) broadcastWatch(OP.WRITE, msg.path);
      console.log('[sync-relay] external-write:', msg.path, `${msg.data?.byteLength ?? 0}B`, `status=${result.status}`);
      break;
    }
    case 'external-delete': {
      suppressPaths.add(msg.path);
      const result = engine.unlink(msg.path);
      if (result.status !== 0) {
        const rmdirResult = engine.rmdir(msg.path, 1);
        if (rmdirResult.status === 0) broadcastWatch(OP.RMDIR, msg.path);
        console.log('[sync-relay] external-delete (rmdir):', msg.path, `status=${rmdirResult.status}`);
      } else {
        broadcastWatch(OP.UNLINK, msg.path);
        console.log('[sync-relay] external-delete:', msg.path, `status=${result.status}`);
      }
      break;
    }
    case 'external-rename':
      suppressPaths.add(msg.path);
      if (msg.newPath) {
        suppressPaths.add(msg.newPath);
        const result = engine.rename(msg.path, msg.newPath);
        if (result.status === 0) broadcastWatch(OP.RENAME, msg.path, msg.newPath);
        console.log('[sync-relay] external-rename:', msg.path, '→', msg.newPath, `status=${result.status}`);
      }
      break;
  }
}

// ========== Message handling ==========

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  // --- Async port registration (no-SAB mode: async-relay connects via MessagePort) ---
  if (msg.type === 'async-port') {
    const port = msg.port ?? e.ports[0];
    if (port) {
      asyncRelayPort = port;
      port.onmessage = async (ev: MessageEvent) => {
        if (ev.data.buffer instanceof ArrayBuffer) {
          if (leaderInitialized) {
            // Leader mode: handle locally (engine available)
            const result = opfsMode
              ? await handleRequestOPFS(tabId || 'nosab', ev.data.buffer)
              : handleRequest(tabId || 'nosab', ev.data.buffer);
            const response = encodeResponse(result.status, result.data);
            port.postMessage({ id: ev.data.id, buffer: response }, [response]);
            if (!opfsMode && result._op !== undefined) notifyOPFSSync(result._op, result._path!, result._newPath);
          } else if (leaderPort) {
            // Follower mode: forward to leader via leader port
            const buf = ev.data.buffer;
            leaderPort.postMessage({ id: ev.data.id, tabId, buffer: buf }, [buf]);
          }
        }
      };
      port.start();
    }
    return;
  }

  // --- Leader mode init ---
  if (msg.type === 'init-leader') {
    if (leaderInitialized) return; // Prevent duplicate init during async gap
    leaderInitialized = true;

    tabId = msg.tabId;
    const hasSAB = msg.sab != null;

    if (hasSAB) {
      sab = msg.sab;
      readySab = msg.readySab;
      ctrl = new Int32Array(sab, 0, 8);
      readySignal = new Int32Array(readySab, 0, 1);
    }

    if (msg.asyncSab) {
      asyncSab = msg.asyncSab;
      asyncCtrl = new Int32Array(msg.asyncSab, 0, 8);
    }

    try {
      await initEngine(msg.config);
    } catch (err) {
      // OPFS handle unavailable — tell main thread to fall back
      leaderInitialized = false; // Allow retry
      (self as unknown as Worker).postMessage({
        type: 'init-failed',
        error: (err as Error).message,
      });
      return;
    }

    // Signal ready to main thread
    if (!readySent) {
      readySent = true;
      if (hasSAB) {
        Atomics.store(readySignal, 0, 1);
        Atomics.notify(readySignal, 0);
      }
      (self as unknown as Worker).postMessage({ type: 'ready' });
    }

    // Start leader loop only when SABs are available (it uses Atomics.wait)
    if (hasSAB) {
      leaderLoop();
    }
    // When no SAB, requests arrive only via MessagePorts (async-port handler above)
    return;
  }

  // --- OPFS-direct mode init ---
  if (msg.type === 'init-opfs') {
    // Reset guards for re-init (corruption fallback or mode=opfs)
    leaderInitialized = true;
    readySent = false;

    tabId = msg.tabId;
    const hasSAB = msg.sab != null;

    if (hasSAB) {
      sab = msg.sab;
      readySab = msg.readySab;
      ctrl = new Int32Array(sab, 0, 8);
      readySignal = new Int32Array(readySab, 0, 1);
    }

    if (msg.asyncSab) {
      asyncSab = msg.asyncSab;
      asyncCtrl = new Int32Array(msg.asyncSab, 0, 8);
    }

    try {
      await initOPFSEngine(msg.config);
    } catch (err) {
      leaderInitialized = false;
      (self as unknown as Worker).postMessage({
        type: 'init-failed',
        error: (err as Error).message,
      });
      return;
    }

    // Signal ready
    if (!readySent) {
      readySent = true;
      if (hasSAB) {
        Atomics.store(readySignal, 0, 1);
        Atomics.notify(readySignal, 0);
      }
      (self as unknown as Worker).postMessage({ type: 'ready', mode: 'opfs' });
    }

    if (hasSAB) {
      leaderLoopOPFS();
    }
    return;
  }

  // --- Follower mode init ---
  if (msg.type === 'init-follower') {
    tabId = msg.tabId;
    const hasSAB = msg.sab != null;

    if (hasSAB) {
      sab = msg.sab;
      readySab = msg.readySab;
      ctrl = new Int32Array(sab, 0, 8);
      readySignal = new Int32Array(readySab, 0, 1);
    }

    if (msg.asyncSab) {
      asyncSab = msg.asyncSab;
      asyncCtrl = new Int32Array(msg.asyncSab, 0, 8);
    }

    // Leader port will be sent separately
    return;
  }

  // --- Leader port (follower mode / reconnection) ---
  if (msg.type === 'leader-port') {
    // If already running as leader, ignore stale follower port
    if (leaderInitialized) return;

    const newPort = msg.port ?? e.ports[0];
    if (!newPort) return;

    // Reconnection: close old port and unblock any pending forwardToLeader()
    if (leaderPort) {
      leaderPort.close();
      if (pendingResolve) {
        // Resolve with EIO error response to unblock followerLoop
        const errorBuf = encodeResponse(5); // EIO
        pendingResolve(errorBuf);
        pendingResolve = null;
      }
    }

    leaderPort = newPort;
    newPort.onmessage = onLeaderMessage;
    newPort.start();

    if (!readySent) {
      // First time: signal ready and start follower loop
      readySent = true;
      if (readySignal) {
        Atomics.store(readySignal, 0, 1);
        Atomics.notify(readySignal, 0);
      }
      (self as unknown as Worker).postMessage({ type: 'ready' });
      if (ctrl) {
        followerLoop();
      }
      // When no SAB (no crossOriginIsolated), follower can't relay sync requests.
      // Only promises work — async-relay uses MessagePort to leader's sync-relay.
    }
    // If followerLoop is already running, it will pick up the new port on next iteration
    return;
  }

  // --- Client port registration (leader mode, during yields) ---
  if (msg.type === 'client-port') {
    registerClientPort(msg.tabId, msg.port ?? e.ports[0]);
    return;
  }

  // --- Client disconnection (leader mode) ---
  if (msg.type === 'client-lost') {
    removeClientPort(msg.tabId);
    return;
  }
};
