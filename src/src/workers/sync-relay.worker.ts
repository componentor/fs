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
import { SAB_OFFSETS, SIGNAL, OP, STATUS, decodeRequest, decodeSecondPath, encodeResponse } from '../protocol/opcodes.js';
import { FollowerForwarder } from '../protocol/follower-forward.js';
import { waitWhile, SAB_WAIT_DEADLINE_MS } from '../protocol/sab-wait.js';
import { planRenameMirror, planPendingReroutes, resolveLinkTarget, registerLink, deregisterLink, collectKeysUnder } from './opfs-sync-plan.js';

// A silent worker death is the worst failure mode this architecture has —
// the heartbeat keeps ticking while every request hangs. Surface everything.
self.addEventListener('error', (e) => {
  console.error('[sync-relay] uncaught error:', (e as ErrorEvent).message, (e as ErrorEvent).filename, (e as ErrorEvent).lineno);
});
self.addEventListener('unhandledrejection', (e) => {
  const reason = (e as PromiseRejectionEvent).reason;
  console.error('[sync-relay] unhandled rejection:', reason?.message ?? String(reason), reason?.stack ?? '');
});
import { VFS_MAGIC, VFS_VERSION, SUPERBLOCK, INODE_SIZE } from '../vfs/layout.js';

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
const HEARTBEAT_INDEX = SAB_OFFSETS.HEARTBEAT >> 2;
const HEARTBEAT_INTERVAL_MS = 1000;

// Liveness heartbeat: the main thread can't Atomics.wait(), so it spin-waits and
// needs a way to tell "this relay worker is slow" from "…is dead". This timer
// bumps a counter in the control SAB whenever our event loop is alive — crucially
// it still fires while we're parked on an `await` inside a long OPFS op (rename of
// a huge tree, etc.), so a genuinely-progressing op never trips the main thread's
// stall detector. It only goes quiet if the worker thread is wedged or gone.
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
function startHeartbeat(): void {
  if (heartbeatTimer !== null || !ctrl) return;
  heartbeatTimer = setInterval(() => {
    Atomics.add(ctrl, HEARTBEAT_INDEX, 1);
  }, HEARTBEAT_INTERVAL_MS);
}

// ========== Leader mode: client port management ==========

const clientPorts = new Map<string, MessagePort>();
const portQueue: Array<{ port: MessagePort; tabId: string; id: string; buffer: ArrayBuffer }> = [];

// Fast macrotask yield via MessageChannel self-post (~0.1ms), raced against
// a short timer as a starvation fallback.
//
// The fallback matters on WebKit: MessagePort delivery is brokered through
// the process main thread, so when a sync caller busy-spins the page's main
// thread waiting on the SAB, the self-ping never arrives and the dispatch
// loop would park here forever — deadlock: the main thread spins on a
// response the worker never produces, while the heartbeat timer keeps
// ticking so stall detection rightly stays quiet. Timers fire on the
// worker's own event loop regardless of main-thread state, so the race
// always settles. On Chromium/Firefox the ping wins (~0.1ms) and behavior
// is unchanged.
// EXPERIMENTAL (mobile-perf investigation, not committed). The busy-poll spin
// and the starvation-timer yield fallback below exist ONLY to defeat WebKit's
// lost cross-thread Atomics.notify + main-thread-brokered MessagePort delivery
// (a sync caller spinning the page main thread starves both). On Chromium and
// Gecko those wakes are reliable, so the spin is pure overhead — and on a
// core-constrained Android device it actively contends for a CPU with the
// spinning main thread and the exec worker, prolonging every op. Gate the
// WebKit-only spinning to WebKit. A runtime escape hatch
// (`self.__fs_force_spin`) lets the embedding app A/B test without a rebuild.
const _relayUa = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
const IS_WEBKIT = /AppleWebKit/.test(_relayUa) && !/Chrome|Chromium|Android|Edg|OPR/.test(_relayUa);
// Embedding-app override from the init config (`VFSConfig.forceSpin`). The
// runtime global `self.__fs_force_spin` takes precedence over both, so a value
// can still be flipped live in the console; then the config; then UA auto-detect.
let _forceSpinConfig: boolean | undefined = undefined;
function spinningNeeded(): boolean {
  const forced = (self as any).__fs_force_spin ?? _forceSpinConfig;
  return forced === undefined ? IS_WEBKIT : !!forced;
}

const yieldChannel = new MessageChannel();
yieldChannel.port2.start();

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = (): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve();
    };
    yieldChannel.port2.onmessage = done;
    yieldChannel.port1.postMessage(null);
    // EXPERIMENTAL (mobile-perf): the racing 1ms timer is the WebKit
    // starvation fallback — there the self-ping is brokered through the
    // spinning page main thread and may never arrive. On Chromium/Firefox
    // the ping is a reliable same-worker macrotask, so the timer is pure
    // churn (a setTimeout/clearTimeout per yield, thousands/sec during a
    // burst) that contends for the CPU on a core-constrained device. Gate
    // it to WebKit; elsewhere rely on the ping.
    if (spinningNeeded()) timer = setTimeout(done, 1);
  });
}

// Engine methods return { status } for expected filesystem errors, but an
// unexpected throw (e.g. WebKit's OPFS sync handles throwing transient
// errors Chromium never produces) must degrade to an EIO response for THAT
// request — never propagate out and kill the dispatch loop. A dead loop
// with a live heartbeat hangs every subsequent request with no diagnostic.
function safeHandleRequest(reqTabId: string, buffer: ArrayBuffer): ReturnType<typeof handleRequest> {
  try {
    return handleRequest(reqTabId, buffer);
  } catch (err) {
    console.error('[sync-relay] handleRequest threw:', (err as Error)?.message, (err as Error)?.stack);
    return { status: STATUS.EIO };
  }
}

async function safeHandleRequestOPFS(reqTabId: string, buffer: ArrayBuffer): ReturnType<typeof handleRequestOPFS> {
  try {
    return await handleRequestOPFS(reqTabId, buffer);
  } catch (err) {
    console.error('[sync-relay] handleRequestOPFS threw:', (err as Error)?.message, (err as Error)?.stack);
    return { status: STATUS.EIO };
  }
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
          ? await safeHandleRequestOPFS(clientTabId, e.data.buffer)
          : safeHandleRequest(clientTabId, e.data.buffer);
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
    const result = safeHandleRequest(msg.tabId, msg.buffer);
    const response = encodeResponse(result.status, result.data);
    msg.port.postMessage({ id: msg.id, buffer: response }, [response]);
    if (result._op !== undefined) notifyOPFSSync(result._op, result._path!, result._newPath);
  }
}

async function drainPortQueueAsync(): Promise<void> {
  while (portQueue.length > 0) {
    const msg = portQueue.shift()!;
    const result = await safeHandleRequestOPFS(msg.tabId, msg.buffer);
    const response = encodeResponse(result.status, result.data);
    msg.port.postMessage({ id: msg.id, buffer: response }, [response]);
  }
}

// ========== Follower mode: leader port ==========

// Follower→leader forwarding: sequence-id matching + per-request deadline.
// See FollowerForwarder for the reliability contract (no stale-response
// resolution, EIO instead of infinite hang on a lost response, no blind
// retry of possibly-applied mutations).
const forwarder = new FollowerForwarder(() => tabId);

// No-SAB mode: async-relay port (for forwarding in follower mode)
let asyncRelayPort: MessagePort | null = null;

function forwardToLeader(payload: Uint8Array): Promise<ArrayBuffer> {
  return forwarder.forward(payload);
}

function onLeaderMessage(e: MessageEvent): void {
  if (e.data.buffer instanceof ArrayBuffer) {
    // Sequence-matched sync response (or late echo of an abandoned one)?
    if (forwarder.handleResponse(e.data.id, e.data.buffer)) return;
    if (asyncRelayPort) {
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
  let op: number, flags: number, path: string, data: Uint8Array | null;
  try {
    ({ op, flags, path, data } = decodeRequest(buffer));
  } catch (err: any) {
    console.error(`[sync-relay] decodeRequest failed (bufLen=${buffer.byteLength}): ${err.message}`);
    return { status: -1 };
  }
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
      const len = data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getFloat64(0, true) : 0;
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

    case OP.OPEN: {
      // open() mutates the VFS in two cases that must be mirrored: O_TRUNC
      // empties an existing file, and O_CREAT of a missing path creates one
      // (e.g. `open(p,'w')`+close as a touch, or createWriteStream opened and
      // closed before any chunk). Neither emits a WRITE/TRUNCATE op, so without
      // this the OPFS mirror keeps stale bytes (O_TRUNC) or lacks the file
      // entirely (O_CREAT). A plain read-open, or O_CREAT of an already-present
      // file (no content change), must not re-mirror — the cheap exists()
      // pre-check (only for O_CREAT-without-O_TRUNC) avoids re-reading a large
      // append-mode file on every open.
      const willCreate = (flags & 64) !== 0;   // O_CREAT
      const willTrunc = (flags & 512) !== 0;    // O_TRUNC
      const existedBefore = willCreate && !willTrunc ? engine.exists(path).data?.[0] === 1 : false;
      result = engine.open(path, flags, reqTabId);
      if (result.status === 0 && (willTrunc || (willCreate && !existedBefore))) {
        syncOp = OP.WRITE;
        syncPath = path;
      }
      break;
    }

    case OP.CLOSE: {
      const fd = data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
      result = engine.close(fd);
      break;
    }

    case OP.FREAD: {
      if (!data || data.byteLength < 16) {
        result = { status: 7 };
        break;
      }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const fd = dv.getUint32(0, true);
      const length = dv.getUint32(4, true);
      const pos = dv.getFloat64(8, true);
      result = engine.fread(fd, length, pos === -1 ? null : pos);
      break;
    }

    case OP.FWRITE: {
      if (!data || data.byteLength < 12) {
        result = { status: 7 };
        break;
      }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const fd = dv.getUint32(0, true);
      const pos = dv.getFloat64(4, true);
      const writeData = data.subarray(12);
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
      if (!data || data.byteLength < 12) {
        result = { status: 7 };
        break;
      }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const fd = dv.getUint32(0, true);
      const len = dv.getFloat64(4, true);
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

    case OP.FCHMOD: {
      // Payload: [fd: u32][mode: u32]
      if (!data || data.byteLength < 8) { result = { status: 7 }; break; }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const fd = dv.getUint32(0, true);
      const mode = dv.getUint32(4, true);
      result = engine.fchmod(fd, mode);
      if (result.status === 0) {
        syncOp = OP.CHMOD;
        syncPath = engine.getPathForFd(fd) ?? undefined;
      }
      break;
    }

    case OP.FCHOWN: {
      // Payload: [fd: u32][uid: u32][gid: u32]
      if (!data || data.byteLength < 12) { result = { status: 7 }; break; }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const fd = dv.getUint32(0, true);
      const uid = dv.getUint32(4, true);
      const gid = dv.getUint32(8, true);
      result = engine.fchown(fd, uid, gid);
      if (result.status === 0) {
        syncOp = OP.CHOWN;
        syncPath = engine.getPathForFd(fd) ?? undefined;
      }
      break;
    }

    case OP.FUTIMES: {
      // Payload: [fd: u32][pad: u32][atime: f64][mtime: f64]
      if (!data || data.byteLength < 24) { result = { status: 7 }; break; }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const fd = dv.getUint32(0, true);
      const atime = dv.getFloat64(8, true);
      const mtime = dv.getFloat64(16, true);
      result = engine.futimes(fd, atime, mtime);
      if (result.status === 0) {
        syncOp = OP.UTIMES;
        syncPath = engine.getPathForFd(fd) ?? undefined;
      }
      break;
    }

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
  let op: number, flags: number, path: string, data: Uint8Array | null;
  try {
    ({ op, flags, path, data } = decodeRequest(buffer));
  } catch (err: any) {
    console.error(`[sync-relay] decodeRequest failed in OPFS handler (bufLen=${buffer.byteLength}): ${err.message}`);
    return { status: -1 };
  }

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
      const len = data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getFloat64(0, true) : 0;
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
      if (!data || data.byteLength < 16) { result = { status: 7 }; break; }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const pos = dv.getFloat64(8, true);
      result = await oe.fread(dv.getUint32(0, true), dv.getUint32(4, true), pos === -1 ? null : pos);
      break;
    }
    case OP.FWRITE: {
      if (!data || data.byteLength < 12) { result = { status: 7 }; break; }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const fd = dv.getUint32(0, true);
      const pos = dv.getFloat64(4, true);
      result = await oe.fwrite(fd, data.subarray(12), pos === -1 ? null : pos);
      syncPath = oe.getPathForFd(fd) ?? undefined;
      break;
    }
    case OP.FSTAT: {
      const fd = data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
      result = await oe.fstat(fd);
      break;
    }
    case OP.FTRUNCATE: {
      if (!data || data.byteLength < 12) { result = { status: 7 }; break; }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      result = await oe.ftruncate(dv.getUint32(0, true), dv.getFloat64(4, true));
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
    case OP.FCHMOD: {
      if (!data || data.byteLength < 8) { result = { status: 7 }; break; }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      result = await oe.fchmod(dv.getUint32(0, true), dv.getUint32(4, true));
      break;
    }
    case OP.FCHOWN: {
      if (!data || data.byteLength < 12) { result = { status: 7 }; break; }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      result = await oe.fchown(dv.getUint32(0, true), dv.getUint32(4, true), dv.getUint32(8, true));
      break;
    }
    case OP.FUTIMES: {
      if (!data || data.byteLength < 24) { result = { status: 7 }; break; }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      result = await oe.futimes(dv.getUint32(0, true), dv.getFloat64(8, true), dv.getFloat64(16, true));
      break;
    }
    default:
      result = { status: 7 };
  }

  // Fallback to VfsEngine for read-only operations that failed in OPFS.
  // OPFS doesn't support symlinks, so paths through pnpm symlinks resolve in
  // VfsEngine (which has the symlink→target mapping) but not in OPFSEngine.
  // This handles: readdir, stat, lstat, read, exists, access, realpath, readlink
  //
  // For most ops, OPFS returns ENOENT (status=1) when path not found.
  // But EXISTS is special: it returns OK (status=0) with data=[0] for non-existent paths.
  // So we also trigger fallback for EXISTS when the result indicates "not found".
  const ENOENT_STATUS = 1; // CODE_TO_STATUS.ENOENT
  const READ_OPS: number[] = [OP.READ, OP.STAT, OP.LSTAT, OP.READDIR, OP.EXISTS, OP.ACCESS, OP.REALPATH, OP.READLINK];
  const isExistsNotFound = op === OP.EXISTS && result.status === 0 && result.data instanceof Uint8Array && result.data[0] === 0;
  if ((result.status === ENOENT_STATUS || isExistsNotFound) && READ_OPS.includes(op)) {
    const vfsResult = (() => {
      switch (op) {
        case OP.READ: return engine.read(path);
        case OP.STAT: return engine.stat(path);
        case OP.LSTAT: return engine.lstat(path);
        case OP.READDIR: return engine.readdir(path, flags);
        case OP.EXISTS: return engine.exists(path);
        case OP.ACCESS: return engine.access(path, flags);
        case OP.REALPATH: return engine.realpath(path);
        case OP.READLINK: return engine.readlink(path);
        default: return null;
      }
    })();
    if (vfsResult && vfsResult.status !== ENOENT_STATUS) {
      result = vfsResult;
    }
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

  // Guard against zero/negative chunk lengths (SAB race or stale data)
  if (chunkLen <= 0 || chunkLen > maxChunk) {
    console.error(`[sync-relay] readPayload: invalid chunkLen=${chunkLen} (maxChunk=${maxChunk}, totalLen=${totalLen})`);
    return new Uint8Array(0);
  }

  if (totalLen <= maxChunk) {
    // Fast path: single chunk
    return new Uint8Array(targetSab, HEADER_SIZE, chunkLen).slice();
  }

  // Guard against corrupt TOTAL_LEN causing OOM
  if (totalLen > activeLimits.maxPayload || totalLen <= 0) {
    console.error(`[sync-relay] readPayload: totalLen=${totalLen} exceeds limit (${activeLimits.maxPayload}) or invalid`);
    return new Uint8Array(0);
  }

  // Multi-chunk: assemble full buffer
  const fullBuffer = new Uint8Array(totalLen);
  let offset = 0;

  // Read first chunk (already in SAB)
  fullBuffer.set(new Uint8Array(targetSab, HEADER_SIZE, chunkLen), offset);
  offset += chunkLen;

  // Ack and wait for more chunks. Bounded 50ms slices: an unbounded wait
  // here wedged the worker forever (frozen heartbeat → 20s stall abort on
  // the main thread) when a cross-thread notify was lost under a
  // busy-spinning main thread (observed on WebKit); slicing re-reads the
  // value so a lost wake costs at most 50ms instead of the whole request.
  const chunkDeadline = Date.now() + SAB_WAIT_DEADLINE_MS;
  while (offset < totalLen) {
    Atomics.store(targetCtrl, 0, SIGNAL.CHUNK_ACK);
    Atomics.notify(targetCtrl, 0);
    waitWhile(targetCtrl, SIGNAL.CHUNK_ACK, chunkDeadline, 'request chunk from caller', 50);
    const nextLen = Atomics.load(targetCtrl, 3);
    if (nextLen <= 0 || nextLen > maxChunk) {
      console.error(`[sync-relay] readPayload: invalid nextLen=${nextLen} at offset=${offset}`);
      return fullBuffer.slice(0, offset); // return what we have so far
    }
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
    const totalView = new BigUint64Array(targetSab, SAB_OFFSETS.TOTAL_LEN, 1);
    Atomics.store(totalView, 0, BigInt(responseData.byteLength));
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
        // Bounded slices for the same lost-wake reason as readPayload above.
        waitWhile(targetCtrl, SIGNAL.CHUNK, Date.now() + SAB_WAIT_DEADLINE_MS, 'response chunk ack from caller', 50);
      }
      sent += chunkSize;
    }
  }
}

// ========== Leader mode: main loop ==========

/**
 * Top up the VFS file's free-tail headroom (engine.maybePreGrow) — but only
 * after a genuine quiet period with no request pending on either SAB.
 *
 * On WebKit, ANY size-changing OPFS call blocks until the page's main
 * thread returns to its event loop, so growth started moments before a
 * sync caller posts-and-spins deadlocks until the caller's stall guard
 * aborts. A bare "no request pending right now" check loses that race
 * (verified: back-to-back sync writes post within the growth's own
 * duration). Requiring 25ms of quiet keeps growth to genuine gaps between
 * bursts; the large headroom (engine.PREGROW_HEADROOM_BLOCKS) ensures
 * bursts don't exhaust the tail before the next gap.
 */
const PREGROW_QUIET_MS = 25;
let lastRequestAt = 0;

function preGrowIfQuiet(): void {
  // Pre-growth exists ONLY to dodge WebKit's in-request growth deadlock: on
  // WebKit a size-changing OPFS call (truncate / extending write) blocks until
  // the page main thread returns to its event loop, which a spinning sync caller
  // prevents — so growth must be done proactively at idle. On Chromium/Gecko
  // there is NO such deadlock; in-request growth (allocateBlocks) is safe, so
  // this proactive 64MB OPFS truncate is pure overhead — and on a core-
  // constrained device (Android flash) it actively stalls the dispatch loop
  // between ops. Gate it to the WebKit case, exactly like the three dispatch-loop
  // workarounds (3.2.8). `forceSpin` / `self.__fs_force_spin` override.
  if (!spinningNeeded()) return;
  try {
    if (Date.now() - lastRequestAt < PREGROW_QUIET_MS) return;
    if (Atomics.load(ctrl, 0) === SIGNAL.REQUEST) return;
    if (asyncCtrl && Atomics.load(asyncCtrl, 0) === SIGNAL.REQUEST) return;
    engine.maybePreGrow(true);
  } catch (err) {
    console.error('[sync-relay] pre-grow failed:', (err as Error)?.message);
  }
}

/**
 * Lost-wake-proof wait for the counterpart to consume a response: sleep in
 * short slices and re-read the value, so a dropped cross-thread
 * Atomics.notify (observed on WebKit/Safari while the main thread spins)
 * costs one 5ms slice instead of the full budget — a plain
 * `Atomics.wait(ctrl, 0, RESPONSE, 100)` turned each lost wake into a
 * 100ms stall, which is exactly the erratic sync latency the maintainer
 * measured in Safari (e.g. 2.6ms/op average on a 500-op batch read).
 * Returns false if the response still wasn't consumed within budgetMs.
 */
function awaitResponseConsumed(targetCtrl: Int32Array, budgetMs: number): boolean {
  // EXPERIMENTAL (mobile-perf): the 5ms slicing is the WebKit lost-wake
  // workaround. On Chromium/Firefox cross-thread Atomics are reliable, so a
  // single bounded wait suffices — it returns the instant the consumer flips
  // the signal away from RESPONSE (or via the next request's notify), exactly
  // as pre-3.2.0 did. Slicing there just adds repeated re-reads/timer churn
  // that contend for the CPU on a core-constrained device. `true` = consumed.
  if (!spinningNeeded()) {
    Atomics.wait(targetCtrl, 0, SIGNAL.RESPONSE, budgetMs);
    return Atomics.load(targetCtrl, 0) !== SIGNAL.RESPONSE;
  }
  const deadline = Date.now() + budgetMs;
  while (Atomics.load(targetCtrl, 0) === SIGNAL.RESPONSE) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    Atomics.wait(targetCtrl, 0, SIGNAL.RESPONSE, Math.min(5, remaining));
  }
  return true;
}

// Run a dispatch loop with crash containment. The loops are infinite async
// functions invoked fire-and-forget; without this, one uncaught throw kills
// dispatch silently (heartbeat keeps ticking, every request hangs forever).
// On crash: log loudly, fail the in-flight request with EIO so the blocked
// caller unwinds, and restart. After repeated crashes, give up and tell the
// main thread so the failure is visible instead of a mystery hang.
let leaderLoopCrashes = 0;
const LEADER_LOOP_MAX_CRASHES = 5;

function startLeaderLoop(loop: () => Promise<void>, name: string): void {
  loop().catch((err: Error) => {
    leaderLoopRunning = false;
    console.error(`[sync-relay] ${name} crashed:`, err?.message, err?.stack);
    try {
      if (ctrl && Atomics.load(ctrl, 0) === SIGNAL.REQUEST) {
        writeDirectResponse(sab, ctrl, STATUS.EIO);
      }
      if (asyncCtrl && Atomics.load(asyncCtrl, 0) === SIGNAL.REQUEST) {
        writeDirectResponse(asyncSab!, asyncCtrl, STATUS.EIO);
      }
    } catch (_) {
      // Best effort — the SAB protocol may be mid-handshake.
    }
    if (++leaderLoopCrashes <= LEADER_LOOP_MAX_CRASHES) {
      startLeaderLoop(loop, name);
    } else {
      (self as unknown as Worker).postMessage({
        type: 'leader-loop-fatal',
        error: err?.message ?? String(err),
      });
    }
  });
}

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
        const reqResult = safeHandleRequest(tabId, payload.buffer as ArrayBuffer);
        const lt2 = debug ? performance.now() : 0;
        writeDirectResponse(sab, ctrl, reqResult.status, reqResult.data);
        if (reqResult._op !== undefined) notifyOPFSSync(reqResult._op, reqResult._path!, reqResult._newPath);
        const lt3 = debug ? performance.now() : 0;
        if (debug) {
          console.log(`[leaderLoop] readPayload=${(lt1-lt0).toFixed(3)}ms handleRequest=${(lt2-lt1).toFixed(3)}ms writeResponse=${(lt3-lt2).toFixed(3)}ms TOTAL=${(lt3-lt0).toFixed(3)}ms`);
        }
        // Wait (in lost-wake-proof slices) for main to consume the response.
        // Main sets IDLE without notify; the next request's notify normally
        // wakes us — but on WebKit that notify can be lost, so slices cap
        // the damage at 5ms instead of the full budget.
        if (!awaitResponseConsumed(ctrl, 100)) {
          Atomics.store(ctrl, 0, SIGNAL.IDLE);
        }
        lastRequestAt = Date.now();
        processed = true;
        continue;
      }

      // Priority 2: own tab's async requests
      if (asyncCtrl && Atomics.load(asyncCtrl, 0) === SIGNAL.REQUEST) {
        const payload = readPayload(asyncSab!, asyncCtrl);
        const asyncResult = safeHandleRequest(tabId, payload.buffer as ArrayBuffer);
        writeDirectResponse(asyncSab!, asyncCtrl, asyncResult.status, asyncResult.data);
        if (asyncResult._op !== undefined) notifyOPFSSync(asyncResult._op, asyncResult._path!, asyncResult._newPath);
        // Wait (in lost-wake-proof slices) for the async-relay to consume
        // the response. writeResponse handles the multi-chunk handshake
        // internally; when it returns the async-relay has all data but may
        // need one more tick to set IDLE.
        awaitResponseConsumed(asyncCtrl, 5000);
        lastRequestAt = Date.now();
        processed = true;
        continue;
      }

      // Priority 3: client requests already queued from previous yields
      if (portQueue.length > 0) {
        drainPortQueue();
        processed = true;
        continue;
      }

      // Nothing pending this instant — but in a stream of back-to-back ops
      // the NEXT request lands within ~100µs (the caller is just decoding
      // the previous response and encoding the next request). Busy-poll
      // briefly before falling out to the yield+park path: catching the
      // request here keeps the hot path free of yields, parks, and
      // cross-thread wakes entirely — which is what makes sync throughput
      // CONSISTENT on Safari, where the yield can cost a 1ms starved-timer
      // tick and a park's wake notify can be lost outright. When truly
      // idle this costs one 0.25ms spin before sleeping. Only worth doing
      // mid-stream — when the last request was served moments ago.
      if (spinningNeeded() && Date.now() - lastRequestAt < 20) {
        const spinStart = performance.now();
        while (performance.now() - spinStart < 0.25) {
          if (
            Atomics.load(ctrl, 0) === SIGNAL.REQUEST ||
            (asyncCtrl !== null && Atomics.load(asyncCtrl, 0) === SIGNAL.REQUEST)
          ) {
            processed = true;
            break;
          }
        }
      }
    }

    // === All queues empty — yield to process MessagePort events ===
    // Always yield: external OPFS changes arrive via opfsSyncPort.onmessage,
    // client registrations via self.onmessage — both need the event loop.
    await yieldToEventLoop();

    // Idle housekeeping: keep free-tail headroom in the VFS file so the
    // request path never needs handle.truncate growth (a storage-IPC call
    // that can stall ~20s on WebKit while a sync caller spins the main
    // thread). A failure here must never kill the loop.
    preGrowIfQuiet();

    // If no client tabs, park in a bounded Atomics.wait so the next
    // request's notify wakes us INSTANTLY instead of waiting out a yield.
    // This matters enormously on WebKit: while a sync caller busy-spins the
    // main thread, MessageChannel pings are starved and the yield above
    // resolves via its 1ms fallback timer — making every sync op pay a
    // timer tick (~2ms/op measured in Safari). An Atomics wake bypasses the
    // starved broker entirely. (Async requests wake us here too — the
    // async-relay notifies this ctrl as its wake hint after staging a
    // request on asyncCtrl.)
    //
    // MUST check BOTH SABs before blocking: an async request that landed
    // while we were yielding has already fired its wake hint — blocking
    // anyway stalls it for the full timeout (this exact miss cost the
    // promises path ~25× on a benchmark run).
    //
    // With opfsSync enabled, external-change messages arrive on a
    // MessagePort, so cap the block at 5ms to keep servicing the event
    // loop (those messages tolerate ms-scale delay; their echo-suppression
    // windows are measured in seconds). Without opfsSync, 50ms as before.
    // With client tabs connected, don't block at all (port latency rules).
    if (clientPorts.size === 0) {
      const currentSignal = Atomics.load(ctrl, 0);
      const asyncPending = asyncCtrl !== null && Atomics.load(asyncCtrl, 0) === SIGNAL.REQUEST;
      if (currentSignal !== SIGNAL.REQUEST && !asyncPending) {
        Atomics.wait(ctrl, 0, currentSignal, opfsSyncEnabled ? 5 : 50);
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
        const reqResult = await safeHandleRequestOPFS(tabId, payload.buffer as ArrayBuffer);
        writeDirectResponse(sab, ctrl, reqResult.status, reqResult.data);
        if (!awaitResponseConsumed(ctrl, 100)) {
          Atomics.store(ctrl, 0, SIGNAL.IDLE);
        }
        processed = true;
        continue;
      }

      // Priority 2: own tab's async requests
      if (asyncCtrl && Atomics.load(asyncCtrl, 0) === SIGNAL.REQUEST) {
        const payload = readPayload(asyncSab!, asyncCtrl);
        const asyncResult = await safeHandleRequestOPFS(tabId, payload.buffer as ArrayBuffer);
        writeDirectResponse(asyncSab!, asyncCtrl, asyncResult.status, asyncResult.data);
        if (!awaitResponseConsumed(asyncCtrl, 100)) {
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

    // Same both-SABs guard as leaderLoop: never block while an async
    // request is already staged on asyncCtrl (its wake hint has fired).
    if (clientPorts.size === 0) {
      const currentSignal = Atomics.load(ctrl, 0);
      const asyncPending = asyncCtrl !== null && Atomics.load(asyncCtrl, 0) === SIGNAL.REQUEST;
      if (currentSignal !== SIGNAL.REQUEST && !asyncPending) {
        Atomics.wait(ctrl, 0, currentSignal, 50);
      }
    }
  }
}

// ========== Follower mode: relay loop ==========

async function followerLoop(): Promise<void> {
  while (true) {
    // Check own sync SAB. failFastEligible: the caller is busy-spinning the
    // main thread, which on WebKit starves this tab's port brokering — once
    // a forward has timed out, further sync ops fail immediately with EIO
    // instead of freezing the tab for the full deadline each time (async
    // ops keep working and heal the suspicion on any delivery).
    if (Atomics.load(ctrl, 0) === SIGNAL.REQUEST) {
      const payload = readPayload(sab, ctrl);
      const response = await forwarder.forward(payload, true);
      writeResponse(sab, ctrl, new Uint8Array(response));
      // Wait for main thread to consume response (safety timeout to prevent deadlock —
      // main thread stores IDLE without notify)
      if (!awaitResponseConsumed(ctrl, 100)) {
        Atomics.store(ctrl, 0, SIGNAL.IDLE);
      }
      continue;
    }

    // Check own async SAB
    if (asyncCtrl && Atomics.load(asyncCtrl, 0) === SIGNAL.REQUEST) {
      const payload = readPayload(asyncSab!, asyncCtrl);
      const response = await forwardToLeader(payload);
      writeResponse(asyncSab!, asyncCtrl, new Uint8Array(response));
      if (!awaitResponseConsumed(asyncCtrl, 100)) {
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

// ========== OPFS directory scanning (for auto-populate on fresh VFS) ==========

const OPFS_SKIP = new Set(['.vfs.bin', '.vfs.bin.tmp']);

// Chunk size for streamed population of fresh VFS from existing OPFS.
// Caps peak memory during init at this size per file instead of
// materializing every OPFS file into the heap simultaneously.
const OPFS_POPULATE_CHUNK = 2 * 1024 * 1024;

// Populate a fresh VFS from an existing OPFS tree, streaming one file at
// a time through the engine. Directories are created before their files,
// files are written via truncate + chunked append so peak memory is
// bounded by OPFS_POPULATE_CHUNK rather than the sum of all file sizes.
async function populateVFSFromOPFS(
  dir: FileSystemDirectoryHandle,
  prefix: string,
): Promise<void> {
  const subdirs: Array<{ name: string; handle: FileSystemDirectoryHandle }> = [];
  const files: Array<{ name: string; handle: FileSystemFileHandle }> = [];
  for await (const [name, handle] of (dir as any).entries()) {
    if (prefix === '' && OPFS_SKIP.has(name)) continue;
    if (handle.kind === 'directory') {
      subdirs.push({ name, handle: handle as FileSystemDirectoryHandle });
    } else {
      files.push({ name, handle: handle as FileSystemFileHandle });
    }
  }

  // Create directories at this level first so file writes below (and
  // recursive calls) can rely on their parents existing.
  for (const { name } of subdirs) {
    const fullPath = prefix ? `${prefix}/${name}` : `/${name}`;
    engine.mkdir(fullPath, 0o040755);
  }

  // Stream each file through a single reusable chunk buffer.
  for (const { name, handle } of files) {
    const fullPath = prefix ? `${prefix}/${name}` : `/${name}`;
    let access: FileSystemSyncAccessHandle | null = null;
    try {
      access = await (handle as unknown as { createSyncAccessHandle: () => Promise<FileSystemSyncAccessHandle> }).createSyncAccessHandle();
      const size = access.getSize();
      // Create as empty, then append in chunks. engine.write(fullPath, empty)
      // establishes the inode; engine.append grows it without reallocation.
      engine.write(fullPath, new Uint8Array(0));
      if (size > 0) {
        const chunk = new Uint8Array(Math.min(size, OPFS_POPULATE_CHUNK));
        let offset = 0;
        while (offset < size) {
          const len = Math.min(chunk.length, size - offset);
          const view = len === chunk.length ? chunk : chunk.subarray(0, len);
          access.read(view, { at: offset });
          engine.append(fullPath, view);
          offset += len;
        }
      }
    } finally {
      if (access) { try { access.close(); } catch { /* ignore */ } }
    }
  }

  // Recurse into subdirectories.
  for (const { name, handle } of subdirs) {
    const fullPath = prefix ? `${prefix}/${name}` : `/${name}`;
    await populateVFSFromOPFS(handle, fullPath);
  }
}

/**
 * Quick superblock validation — reads only 64 bytes to detect corruption
 * BEFORE engine.init() runs. Prevents hangs from corrupt values causing
 * huge allocations or blocking Atomics loops.
 * Returns null if valid, or an error description string if corrupt.
 */
interface ResolvedLimits {
  maxInodes: number;
  maxBlocks: number;
  maxPathTable: number;
  maxVFSSize: number;
  maxPayload: number;
}

const DEFAULT_LIMITS: ResolvedLimits = {
  maxInodes: 4_000_000,
  maxBlocks: 4_000_000,
  maxPathTable: 256 * 1024 * 1024,
  maxVFSSize: 100 * 1024 * 1024 * 1024,
  maxPayload: 2 * 1024 * 1024 * 1024,
};

function resolveLimits(input?: Partial<ResolvedLimits>): ResolvedLimits {
  return { ...DEFAULT_LIMITS, ...input };
}

// Active limits for this worker instance
let activeLimits: ResolvedLimits = { ...DEFAULT_LIMITS };

function quickValidateVFS(handle: FileSystemSyncAccessHandle, fileSize: number, limits: ResolvedLimits): string | null {
  if (fileSize < SUPERBLOCK.SIZE) return `file too small (${fileSize} bytes)`;

  const buf = new Uint8Array(SUPERBLOCK.SIZE);
  handle.read(buf, { at: 0 });
  const v = new DataView(buf.buffer);

  const magic = v.getUint32(SUPERBLOCK.MAGIC, true);
  if (magic !== VFS_MAGIC) return `bad magic 0x${magic.toString(16)}`;
  const version = v.getUint32(SUPERBLOCK.VERSION, true);
  if (version !== VFS_VERSION) return `unsupported version ${version}`;

  const inodeCount = v.getUint32(SUPERBLOCK.INODE_COUNT, true);
  const blockSize = v.getUint32(SUPERBLOCK.BLOCK_SIZE, true);
  const totalBlocks = v.getUint32(SUPERBLOCK.TOTAL_BLOCKS, true);
  const freeBlocks = v.getUint32(SUPERBLOCK.FREE_BLOCKS, true);
  const inodeTableOffset = v.getFloat64(SUPERBLOCK.INODE_OFFSET, true);
  const pathTableOffset = v.getFloat64(SUPERBLOCK.PATH_OFFSET, true);
  const dataOffset = v.getFloat64(SUPERBLOCK.DATA_OFFSET, true);
  const bitmapOffset = v.getFloat64(SUPERBLOCK.BITMAP_OFFSET, true);
  const pathUsed = v.getUint32(SUPERBLOCK.PATH_USED, true);

  // Basic field sanity
  if (blockSize === 0 || (blockSize & (blockSize - 1)) !== 0) return `invalid block size ${blockSize}`;
  if (inodeCount === 0) return 'inode count is 0';
  if (inodeCount > limits.maxInodes) return `inode count ${inodeCount} exceeds maximum ${limits.maxInodes}`;
  if (totalBlocks > limits.maxBlocks) return `total blocks ${totalBlocks} exceeds maximum ${limits.maxBlocks}`;
  if (freeBlocks > totalBlocks) return `free blocks (${freeBlocks}) exceeds total (${totalBlocks})`;

  // Offsets must be finite positive numbers
  if (!Number.isFinite(inodeTableOffset) || inodeTableOffset < 0 ||
      !Number.isFinite(pathTableOffset) || pathTableOffset < 0 ||
      !Number.isFinite(bitmapOffset) || bitmapOffset < 0 ||
      !Number.isFinite(dataOffset) || dataOffset < 0) return 'non-finite or negative section offset';

  // Section ordering
  if (inodeTableOffset !== SUPERBLOCK.SIZE) return `inode table offset ${inodeTableOffset} (expected ${SUPERBLOCK.SIZE})`;
  const expectedPathOffset = inodeTableOffset + inodeCount * INODE_SIZE;
  if (pathTableOffset !== expectedPathOffset) return `path table offset ${pathTableOffset} (expected ${expectedPathOffset})`;
  if (bitmapOffset <= pathTableOffset) return 'bitmap offset must be after path table';
  if (dataOffset <= bitmapOffset) return 'data offset must be after bitmap';

  // Path table bounds
  const pathTableSize = bitmapOffset - pathTableOffset;
  if (pathUsed > pathTableSize) return `path used (${pathUsed}) exceeds path table size (${pathTableSize})`;
  if (pathTableSize > limits.maxPathTable) return `path table size ${pathTableSize} exceeds maximum ${limits.maxPathTable}`;

  // File size vs declared layout
  const expectedMinSize = dataOffset + totalBlocks * blockSize;
  if (expectedMinSize > limits.maxVFSSize) return `computed layout size ${expectedMinSize} exceeds maximum ${limits.maxVFSSize}`;
  if (fileSize < expectedMinSize) return `file size ${fileSize} too small for layout (need ${expectedMinSize})`;

  return null;
}

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
  forceSpin?: boolean;
  limits?: Partial<ResolvedLimits>;
}): Promise<void> {
  debug = config.debug ?? false;
  _forceSpinConfig = config.forceSpin;
  activeLimits = resolveLimits(config.limits);

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

  // Pre-validate vfs.bin BEFORE engine.init() to prevent hangs from corrupt data
  // causing huge allocations or blocking Atomics loops. Throws early so the caller
  // can offer repair instead of silently losing data.
  const vfsSize = vfsHandle.getSize();
  if (vfsSize > 0) {
    const validationError = quickValidateVFS(vfsHandle, vfsSize, activeLimits);
    if (validationError) {
      try { vfsHandle.close(); } catch (_) {}
      throw new Error(`Corrupt VFS: ${validationError}`);
    }
  }

  const wasFresh = vfsSize === 0;

  // Initialize VFS engine — release handle on corruption/failure
  try {
    engine.init(vfsHandle, {
      uid: config.uid,
      gid: config.gid,
      umask: config.umask,
      strictPermissions: config.strictPermissions,
      debug: config.debug,
      limits: activeLimits,
    });
  } catch (err) {
    // Release the exclusive sync handle so it can be re-acquired
    try { vfsHandle.close(); } catch (_) {}
    throw err;
  }

  // Auto-populate fresh VFS from existing OPFS files (streamed one file
  // at a time — see populateVFSFromOPFS for why).
  if (wasFresh) {
    await populateVFSFromOPFS(rootDir, '');
    engine.flush();
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

  // Pre-grow the free-tail headroom NOW, before 'ready' is posted: the main
  // thread is provably awaiting init (not spinning), so the size-changing
  // OPFS call is safe and fast. On WebKit, growth while a sync caller spins
  // deadlocks until the caller's stall guard aborts — see maybePreGrow.
  // WebKit-only: on Chromium/Gecko in-request growth is safe, so skip the
  // one-time 64MB OPFS truncate (slow on mobile flash) and grow on demand.
  if (spinningNeeded()) {
    try {
      engine.maybePreGrow(true);
    } catch (err) {
      console.error('[sync-relay] init pre-grow failed:', (err as Error)?.message);
    }
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

  // Mirror Node/libuv semantics:
  //   'change' — contents or metadata of an existing entry changed
  //   'rename' — an entry was created, removed, or moved in its parent
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
    case OP.COPY: // target file's contents were overwritten → 'change'
      eventType = 'change';
      break;
    case OP.UNLINK:
    case OP.RMDIR:
    case OP.RENAME:
    case OP.MKDIR:
    case OP.MKDTEMP:
    case OP.SYMLINK:
    case OP.LINK:
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
//
// Per-path debounce coalescer. Without this, every FWRITE/WRITE/FTRUNCATE
// triggers a full-file `engine.read(path)` here — which allocates a
// `new Uint8Array(inode.size)` on every call. For a file grown chunk-by-
// chunk (e.g. formidable writing a 100 MB upload via a 64 KB stream),
// that's ~1500 full-file reads totalling many GB of allocations, and the
// largest allocation (the final full file size) eventually fails with
// "Array buffer allocation failed" under memory pressure.
//
// Instead, coalesce bursts: any write-op schedules a sync 50 ms later,
// and subsequent write-ops to the same path reset the timer. At most
// ONE full-file read per burst, reading the file once at its final size.
const pendingPathSyncs = new Map<string, ReturnType<typeof setTimeout>>();
const SYNC_DEBOUNCE_MS = 50;

// Symlink → file aliasing. OPFS has no symlinks, so a symlink is mirrored as a
// regular file holding its TARGET's content (a snapshot via the following
// `engine.read`). That snapshot goes stale when the target is later rewritten,
// because a write notifies the *target's* path, not the link's. Track which
// link paths resolve to each target path so a target write also re-mirrors its
// links. `symlinkTargets` (target → links) drives re-sync; `linkToTarget` is the
// reverse map that lets a link be cleanly removed when it is unlinked, renamed,
// or recreated, so no stale entries accumulate. Mutate both only via
// registerLink/deregisterLink to keep them consistent.
const symlinkTargets = new Map<string, Set<string>>();
const linkToTarget = new Map<string, string>();

/** Register `linkPath` against its current target (reads the link from the engine). */
function registerSymlink(linkPath: string): void {
  const raw = engine.readlink(linkPath);
  if (raw.status !== 0 || !raw.data) return;
  const target = resolveLinkTarget(linkPath, new TextDecoder().decode(raw.data));
  registerLink(symlinkTargets, linkToTarget, linkPath, target);
}

function flushPathSync(path: string): void {
  pendingPathSyncs.delete(path);
  if (!opfsSyncPort) return;
  try {
    const result = engine.read(path);
    if (result.status !== 0) {
      // A dangling symlink (link exists, target missing) reads ENOENT here but
      // is NOT gone — `readlink` still returns its target. Mirror an empty
      // placeholder so the link's existence isn't silently dropped; once the
      // target appears, the alias re-sync fills in the real content. A truly
      // absent path (deleted file) has no readlink and is correctly skipped.
      if (engine.readlink(path).status === 0) {
        opfsSyncPort.postMessage({ op: 'write', path, data: new ArrayBuffer(0), ts: Date.now() });
      }
      return;
    }
    const ts = Date.now();
    if (result.data && result.data.byteLength > 0) {
      const buf = result.data.buffer.byteLength === result.data.byteLength
        ? result.data.buffer
        : result.data.slice().buffer;
      opfsSyncPort.postMessage({ op: 'write', path, data: buf, ts } as const, [buf as ArrayBuffer]);
    } else {
      opfsSyncPort.postMessage({ op: 'write', path, data: new ArrayBuffer(0), ts });
    }
    // Cascade: if other symlinks point AT this path (e.g. chained links
    // L1→L2→file), re-mirror them too. Only from the success branch — a
    // dangling/cyclic link reads non-zero and returns above, so a symlink cycle
    // can never reach here and loop.
    resyncSymlinksFor(path);
  } catch { /* best effort — don't crash the relay on sync failures */ }
}

/** Re-mirror any symlinks whose target is `path` (e.g. after the target is written). */
function resyncSymlinksFor(path: string): void {
  const links = symlinkTargets.get(path);
  if (links) for (const link of links) schedulePathSync(link);
}

/**
 * Re-mirror symlinks whose target is `path` OR a descendant of it — used when a
 * target is removed or renamed away so the dependent links flush to their new
 * (usually dangling → empty-placeholder) state. `path` alone covers a single
 * unlinked file; the prefix scan covers a removed/renamed directory subtree.
 */
function resyncSymlinksUnder(path: string): void {
  resyncSymlinksFor(path);
  for (const target of collectKeysUnder(symlinkTargets.keys(), path)) {
    if (target !== path) resyncSymlinksFor(target);
  }
}

// ---- Shared rename/remove bookkeeping (used by BOTH the outbound notify path
// and the inbound external-change path, so external mutations get the same
// pending-reroute and symlink-alias maintenance local mutations do). ----

function cancelPendingSync(path: string): void {
  const t = pendingPathSyncs.get(path);
  if (t) { clearTimeout(t); pendingPathSyncs.delete(path); }
}

/** Re-key pending debounced child syncs from an old directory prefix to the new one. */
function reroutePendingChildSyncs(oldPath: string, newPath: string): void {
  for (const { from, to } of planPendingReroutes(pendingPathSyncs.keys(), oldPath, newPath)) {
    cancelPendingSync(from);
    schedulePathSync(to);
  }
}

/** Re-key symlink aliases the rename moved (the link itself, or links under a renamed dir). */
function rekeySymlinkAliasesForRename(oldPath: string, newPath: string): void {
  for (const oldLink of collectKeysUnder(linkToTarget.keys(), oldPath)) {
    deregisterLink(symlinkTargets, linkToTarget, oldLink);
    registerSymlink(oldLink === oldPath ? newPath : newPath + oldLink.slice(oldPath.length));
  }
}

/** Drop symlink aliases a removal invalidates: one unlinked link, or every link under a removed dir. */
function dropSymlinkAliasesForRemove(path: string, isDir: boolean): void {
  if (isDir) {
    for (const link of collectKeysUnder(linkToTarget.keys(), path)) {
      deregisterLink(symlinkTargets, linkToTarget, link);
    }
  } else {
    deregisterLink(symlinkTargets, linkToTarget, path);
  }
}

function schedulePathSync(path: string): void {
  const prev = pendingPathSyncs.get(path);
  if (prev) clearTimeout(prev);
  pendingPathSyncs.set(path, setTimeout(() => flushPathSync(path), SYNC_DEBOUNCE_MS));
}

function notifyOPFSSync(op: number, path: string, newPath?: string): void {
  if (!opfsSyncPort) return;

  const ts = Date.now();

  switch (op) {
    case OP.WRITE:
    case OP.APPEND:
    case OP.TRUNCATE:
    case OP.FWRITE:
    case OP.FTRUNCATE:
    case OP.COPY:
    case OP.LINK: {
      // Coalesce bursts of writes to the same path — flush once after a
      // short idle period so large chunked writes don't cause N
      // full-file reads that exhaust the worker's heap.
      schedulePathSync(path);
      // If this path is a symlink target, re-mirror the links pointing at it so
      // their snapshot content doesn't go stale.
      resyncSymlinksFor(path);
      break;
    }
    case OP.SYMLINK: {
      // OPFS has no symlinks — mirror as regular file with the target's
      // content. Route through the same debounced flusher so this also
      // benefits from coalescing if the symlink target is being actively
      // written in the same burst.
      registerSymlink(path);
      schedulePathSync(path);
      break;
    }
    case OP.UNLINK:
    case OP.RMDIR: {
      // Cancel any pending debounced sync for this path — the file no
      // longer exists, we'd just fail the read.
      cancelPendingSync(path);
      // Drop symlink aliases this removal invalidates (single link or whole dir).
      dropSymlinkAliasesForRemove(path, op === OP.RMDIR);
      opfsSyncPort.postMessage({ op: 'delete', path, ts });
      // If the removed path was the TARGET of other symlinks, those links are
      // now dangling — re-mirror them so their snapshot becomes the empty
      // placeholder instead of keeping the deleted content.
      resyncSymlinksUnder(path);
      break;
    }
    case OP.MKDIR:
    case OP.MKDTEMP:
      opfsSyncPort.postMessage({ op: 'mkdir', path, ts });
      break;
    case OP.RENAME:
      if (newPath) {
        // Cancel pending syncs for BOTH old and new paths (the source is gone;
        // we emit the destination's content below), then re-key pending child
        // syncs and symlink aliases the rename moved.
        cancelPendingSync(path);
        cancelPendingSync(newPath);
        reroutePendingChildSyncs(path, newPath);
        rekeySymlinkAliasesForRename(path, newPath);
        // Atomic-write pattern: apps write a temp file then rename(temp → final).
        // The temp is frequently created AND renamed within the write-debounce
        // window (SYNC_DEBOUNCE_MS), so it was NEVER mirrored to OPFS —
        // forwarding a 'rename' op then fails in the mirror ("source not found").
        // The destination's authoritative bytes are readable from the engine at
        // `newPath` (the rename already succeeded), so mirror a regular-file
        // rename as write(newPath) + delete(path): deterministic, independent of
        // whether the temp source was ever mirrored. Directory renames
        // (engine.read fails — not a regular file) fall back to a real 'rename'
        // op, which the mirror handles via renameDirInOPFS (the source directory
        // WAS mirrored, unlike a write-temp). See planRenameMirror (unit-tested).
        const plan = planRenameMirror(engine, path, newPath, ts);
        for (const msg of plan.messages) {
          if (msg.op === 'write' && plan.transfers.includes(msg.data)) {
            opfsSyncPort.postMessage(msg, [msg.data]);
          } else {
            opfsSyncPort.postMessage(msg);
          }
        }
        // A symlink stores a LITERAL target, so renaming a target away does not
        // repoint the links at it — they become dangling. Re-mirror any links
        // whose target was `path` (or under it) so their snapshot becomes the
        // empty placeholder rather than keeping the moved content.
        resyncSymlinksUnder(path);
      }
      break;
  }
}

// Apply a change the FileSystemObserver detected in OPFS back into the
// authoritative VFS engine. The external mutation is ALREADY in OPFS, so this
// must NOT re-mirror the primary change — but it must run the same pending-sync
// and symlink-alias bookkeeping the outbound path does, or external mutations
// silently bypass it (stale dependent links, lost pending child writes, leaking
// alias entries). Dependent SYMLINK snapshots are separate files that DO need
// re-mirroring (resyncSymlinks*), and those re-mirror writes are echo-suppressed
// by the mirror worker, so there is no loop.
function handleExternalChange(msg: { op: string; path: string; newPath?: string; data?: ArrayBuffer }): void {
  switch (msg.op) {
    case 'external-write': {
      let result = engine.write(msg.path, new Uint8Array(msg.data!), 0);
      if (result.status === STATUS.EISDIR) {
        // OPFS replaced a directory with a file at this path — converge the VFS
        // by removing the conflicting directory tree, then writing the file.
        engine.rmdir(msg.path, 1);
        result = engine.write(msg.path, new Uint8Array(msg.data!), 0);
      }
      if (result.status === 0) {
        resyncSymlinksFor(msg.path); // links pointing at this now-updated target
        broadcastWatch(OP.WRITE, msg.path);
      }
      console.log('[sync-relay] external-write:', msg.path, `${msg.data?.byteLength ?? 0}B`, `status=${result.status}`);
      break;
    }
    case 'external-delete': {
      cancelPendingSync(msg.path);
      let wasDir = false;
      let ok = engine.unlink(msg.path).status === 0;
      if (!ok) { ok = engine.rmdir(msg.path, 1).status === 0; wasDir = ok; }
      if (ok) {
        dropSymlinkAliasesForRemove(msg.path, wasDir);
        resyncSymlinksUnder(msg.path); // links whose target vanished → placeholder
        broadcastWatch(wasDir ? OP.RMDIR : OP.UNLINK, msg.path);
      }
      console.log('[sync-relay] external-delete:', msg.path, `dir=${wasDir}`, `ok=${ok}`);
      break;
    }
    case 'external-rename':
      if (msg.newPath) {
        const result = engine.rename(msg.path, msg.newPath);
        if (result.status === 0) {
          cancelPendingSync(msg.path);
          cancelPendingSync(msg.newPath);
          reroutePendingChildSyncs(msg.path, msg.newPath); // pending local child writes → new path
          rekeySymlinkAliasesForRename(msg.path, msg.newPath);
          resyncSymlinksUnder(msg.path); // links pointing at the renamed-away target
          broadcastWatch(OP.RENAME, msg.path, msg.newPath);
        }
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
              ? await safeHandleRequestOPFS(tabId || 'nosab', ev.data.buffer)
              : safeHandleRequest(tabId || 'nosab', ev.data.buffer);
            const response = encodeResponse(result.status, result.data);
            port.postMessage({ id: ev.data.id, buffer: response }, [response]);
            if (!opfsMode && result._op !== undefined) notifyOPFSSync(result._op, result._path!, result._newPath);
          } else if (forwarder.hasPort) {
            // Follower mode: forward to leader via leader port. Not tracked
            // by the forwarder — the async-relay matches responses by its
            // own string ids (which can never collide with the forwarder's
            // numeric sequence ids).
            const buf = ev.data.buffer;
            forwarder.postRaw({ id: ev.data.id, tabId, buffer: buf }, [buf]);
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
      startHeartbeat(); // begin pulsing before init work so a slow init isn't mistaken for a dead worker
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
      startLeaderLoop(leaderLoop, 'leaderLoop');
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
      startHeartbeat(); // begin pulsing before init work so a slow init isn't mistaken for a dead worker
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
      startLeaderLoop(leaderLoopOPFS, 'leaderLoopOPFS');
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
      startHeartbeat(); // begin pulsing before init work so a slow init isn't mistaken for a dead worker
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

    // Reconnection: setPort closes the old port and aborts any pending
    // forwardToLeader() with a (correctly-labeled) EIO response.
    forwarder.setPort(newPort);
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
