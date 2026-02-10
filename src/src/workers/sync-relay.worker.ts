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
import { SAB_OFFSETS, SIGNAL, OP, decodeRequest, decodeSecondPath, encodeResponse } from '../protocol/opcodes.js';

const engine = new VFSEngine();

// Guards: prevent duplicate init and double-ready
let leaderInitialized = false;
let readySent = false;
let debug = false;

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
  port.onmessage = (e: MessageEvent) => {
    if (e.data.buffer instanceof ArrayBuffer) {
      portQueue.push({
        port,
        tabId: clientTabId,
        id: e.data.id,
        buffer: e.data.buffer,
      });
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
  engine.cleanupTab(clientTabId);
}

function drainPortQueue(): void {
  while (portQueue.length > 0) {
    const msg = portQueue.shift()!;
    const response = handleRequest(msg.tabId, msg.buffer);
    msg.port.postMessage({ id: msg.id, buffer: response }, [response]);
  }
}

// ========== Follower mode: leader port ==========

let leaderPort: MessagePort | null = null;
let pendingResolve: ((buf: ArrayBuffer) => void) | null = null;

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
  if (e.data.buffer instanceof ArrayBuffer && pendingResolve) {
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve(e.data.buffer);
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

function handleRequest(reqTabId: string, buffer: ArrayBuffer): ArrayBuffer {
  const t0 = debug ? performance.now() : 0;
  const { op, flags, path, data } = decodeRequest(buffer);
  const t1 = debug ? performance.now() : 0;

  let result: { status: number; data?: Uint8Array | null };

  switch (op) {
    case OP.READ:
      result = engine.read(path);
      break;

    case OP.WRITE:
      result = engine.write(path, data ?? new Uint8Array(0), flags);
      break;

    case OP.APPEND:
      result = engine.append(path, data ?? new Uint8Array(0));
      break;

    case OP.UNLINK:
      result = engine.unlink(path);
      break;

    case OP.STAT:
      result = engine.stat(path);
      break;

    case OP.LSTAT:
      result = engine.lstat(path);
      break;

    case OP.MKDIR:
      result = engine.mkdir(path, flags);
      break;

    case OP.RMDIR:
      result = engine.rmdir(path, flags);
      break;

    case OP.READDIR:
      result = engine.readdir(path, flags);
      break;

    case OP.RENAME: {
      const newPath = data ? decodeSecondPath(data) : '';
      result = engine.rename(path, newPath);
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
      const chmodMode = data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
      result = engine.chmod(path, chmodMode);
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
      result = engine.opendir(path, reqTabId);
      break;

    case OP.MKDTEMP:
      result = engine.mkdtemp(path);
      break;

    default:
      result = { status: 7 }; // EINVAL — unknown op
  }

  const t2 = debug ? performance.now() : 0;
  const responseData = result.data instanceof Uint8Array ? result.data : undefined;
  const response = encodeResponse(result.status, responseData);
  const t3 = debug ? performance.now() : 0;

  if (debug) {
    console.log(`[sync-relay] op=${OP_NAMES[op] ?? op} path=${path} decode=${(t1-t0).toFixed(3)}ms engine=${(t2-t1).toFixed(3)}ms encode=${(t3-t2).toFixed(3)}ms TOTAL=${(t3-t0).toFixed(3)}ms`);
  }

  return response;
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
  while (true) {
    // === Inner tight loop: process all pending work without yielding ===
    let processed = true;
    while (processed) {
      processed = false;

      // Priority 1: own tab's sync requests (fastest path)
      if (Atomics.load(ctrl, 0) === SIGNAL.REQUEST) {
        const lt0 = debug ? performance.now() : 0;
        const payload = readPayload(sab, ctrl);
        const lt1 = debug ? performance.now() : 0;
        const response = handleRequest(tabId, payload.buffer as ArrayBuffer);
        const lt2 = debug ? performance.now() : 0;
        writeResponse(sab, ctrl, new Uint8Array(response));
        const lt3 = debug ? performance.now() : 0;
        if (debug) {
          console.log(`[leaderLoop] readPayload=${(lt1-lt0).toFixed(3)}ms handleRequest=${(lt2-lt1).toFixed(3)}ms writeResponse=${(lt3-lt2).toFixed(3)}ms TOTAL=${(lt3-lt0).toFixed(3)}ms`);
        }
        // Wait for main thread to consume response (10ms safety timeout).
        // Main thread sets IDLE without notify — worker stays asleep until the
        // NEXT request's notify wakes it. This gives ONE wake per operation.
        const result = Atomics.wait(ctrl, 0, SIGNAL.RESPONSE, 10);
        if (result === 'timed-out') {
          Atomics.store(ctrl, 0, SIGNAL.IDLE);
        }
        processed = true;
        continue;
      }

      // Priority 2: own tab's async requests
      if (asyncCtrl && Atomics.load(asyncCtrl, 0) === SIGNAL.REQUEST) {
        const payload = readPayload(asyncSab!, asyncCtrl);
        const response = handleRequest(tabId, payload.buffer as ArrayBuffer);
        writeResponse(asyncSab!, asyncCtrl, new Uint8Array(response));
        const result = Atomics.wait(asyncCtrl, 0, SIGNAL.RESPONSE, 10);
        if (result === 'timed-out') {
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

    // === All queues empty — wait for new work ===
    if (clientPorts.size > 0) {
      // Clients connected: yield to receive port messages (~0.1ms)
      await yieldToEventLoop();
    } else {
      // No clients: block until SAB notification or timeout
      const currentSignal = Atomics.load(ctrl, 0);
      if (currentSignal !== SIGNAL.REQUEST) {
        const result = Atomics.wait(ctrl, 0, currentSignal, 50);
        if (result === 'timed-out') {
          // Idle — yield to process pending onmessage (e.g. client-port registration)
          await yieldToEventLoop();
        }
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
  opfsSync: boolean;
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

  // Initialize VFS engine
  engine.init(vfsHandle, {
    uid: config.uid,
    gid: config.gid,
    umask: config.umask,
    strictPermissions: config.strictPermissions,
    debug: config.debug,
  });
}

// ========== Message handling ==========

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  // --- Async port registration (no-SAB mode: async-relay connects via MessagePort) ---
  if (msg.type === 'async-port') {
    const port = msg.port ?? e.ports[0];
    if (port) {
      // Process async requests directly when received (no SAB polling)
      port.onmessage = (ev: MessageEvent) => {
        if (ev.data.buffer instanceof ArrayBuffer) {
          const response = handleRequest(tabId || 'nosab', ev.data.buffer);
          port.postMessage({ id: ev.data.id, buffer: response }, [response]);
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
      Atomics.store(readySignal, 0, 1);
      Atomics.notify(readySignal, 0);
      (self as unknown as Worker).postMessage({ type: 'ready' });
      followerLoop();
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
