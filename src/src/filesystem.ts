/**
 * VFSFileSystem — main thread API.
 *
 * Provides Node.js-compatible sync and async filesystem methods.
 * Sync methods use SAB + Atomics to block until the server responds.
 * Async methods use postMessage to the async relay worker.
 *
 * On import, workers are spawned immediately. Every method blocks
 * (or waits) until the worker is ready. This is by design — the library
 * primarily runs inside workers where blocking is fine.
 */

import type {
  Encoding, ReadOptions, WriteOptions, MkdirOptions, RmdirOptions, RmOptions, CpOptions,
  ReaddirOptions, StatOptions, Stats, BigIntStats, StatFs, Dirent, VFSConfig, FSMode, FileHandle, GlobOptions,
  WatchOptions, WatchFileOptions, WatchEventType, FSWatcher, WatchListener, WatchFileListener,
  ReadStreamOptions, WriteStreamOptions, FSReadStream, FSWriteStream, OpenAsBlobOptions, PathLike,
} from './types.js';
import { NodeReadable, NodeWritable } from './node-streams.js';
import type { SyncRequestFn, AsyncRequestFn } from './methods/context.js';
import { SAB_OFFSETS, SIGNAL, OP, encodeRequest, decodeResponse } from './protocol/opcodes.js';

// ---- Method imports ----
import { readFileSync as _readFileSync, readFile as _readFile } from './methods/readFile.js';
import { writeFileSync as _writeFileSync, writeFile as _writeFile } from './methods/writeFile.js';
import { appendFileSync as _appendFileSync, appendFile as _appendFile } from './methods/appendFile.js';
import { existsSync as _existsSync, exists as _exists } from './methods/exists.js';
import { mkdirSync as _mkdirSync, mkdir as _mkdir } from './methods/mkdir.js';
import { rmdirSync as _rmdirSync, rmdir as _rmdir } from './methods/rmdir.js';
import { rmSync as _rmSync, rm as _rm } from './methods/rm.js';
import { unlinkSync as _unlinkSync, unlink as _unlink } from './methods/unlink.js';
import { readdirSync as _readdirSync, readdir as _readdir } from './methods/readdir.js';
import { statSync as _statSync, lstatSync as _lstatSync, stat as _stat, lstat as _lstat } from './methods/stat.js';
import { renameSync as _renameSync, rename as _rename } from './methods/rename.js';
import { copyFileSync as _copyFileSync, copyFile as _copyFile } from './methods/copyFile.js';
import { truncateSync as _truncateSync, truncate as _truncate } from './methods/truncate.js';
import { accessSync as _accessSync, access as _access } from './methods/access.js';
import { realpathSync as _realpathSync, realpath as _realpath } from './methods/realpath.js';
import { chmodSync as _chmodSync, chmod as _chmod } from './methods/chmod.js';
import { chownSync as _chownSync, chown as _chown } from './methods/chown.js';
import { utimesSync as _utimesSync, utimes as _utimes } from './methods/utimes.js';
import { symlinkSync as _symlinkSync, readlinkSync as _readlinkSync, symlink as _symlink, readlink as _readlink } from './methods/symlink.js';
import { linkSync as _linkSync, link as _link } from './methods/link.js';
import { mkdtempSync as _mkdtempSync, mkdtemp as _mkdtemp } from './methods/mkdtemp.js';
import {
  openSync as _openSync, closeSync as _closeSync,
  readSync as _readSync, writeSyncFd as _writeSyncFd,
  fstatSync as _fstatSync, ftruncateSync as _ftruncateSync, fdatasyncSync as _fdatasyncSync,
  open as _open,
} from './methods/open.js';
import { opendir as _opendir } from './methods/opendir.js';
import { watch as _watch, watchFile as _watchFile, unwatchFile as _unwatchFile, watchAsync as _watchAsync } from './methods/watch.js';
import { globSync as _globSync, glob as _glob } from './methods/glob.js';
import { join as pathJoin, toPathString } from './path.js';
import { createError } from './errors.js';
import { constants } from './constants.js';

const encoder = new TextEncoder();

// Default SAB size: 2MB
const DEFAULT_SAB_SIZE = 2 * 1024 * 1024;

// Singleton registry: one VFSFileSystem per root per thread.
// Prevents duplicate workers, leader lock contention, and SW registration conflicts.
const instanceRegistry = new Map<string, VFSFileSystem>();
const HEADER_SIZE = SAB_OFFSETS.HEADER_SIZE;

// Atomics.wait() is disallowed on the browser main thread.
// Use spin-wait (Atomics.load loop) as fallback.
const _canAtomicsWait = typeof globalThis.WorkerGlobalScope !== 'undefined';

// Main-thread spin-wait timeout: 10 seconds.
// If SharedWorker is dead/broken, abort instead of blocking the main thread forever.
const SPIN_TIMEOUT_MS = 10_000;

function spinWait(arr: Int32Array, index: number, value: number): void {
  if (_canAtomicsWait) {
    Atomics.wait(arr, index, value);
  } else {
    const start = performance.now();
    while (Atomics.load(arr, index) === value) {
      if (performance.now() - start > SPIN_TIMEOUT_MS) {
        throw new Error(
          `VFS sync operation timed out after ${SPIN_TIMEOUT_MS / 1000}s — SharedWorker may be unresponsive`
        );
      }
    }
  }
}

export class VFSFileSystem {
  // SAB for sync communication with sync relay worker (null when SAB unavailable)
  private sab!: SharedArrayBuffer;
  private ctrl!: Int32Array;
  private readySab!: SharedArrayBuffer;
  private readySignal!: Int32Array;
  // SAB for async-relay ↔ sync-relay communication
  private asyncSab!: SharedArrayBuffer;
  // Whether SharedArrayBuffer is available (crossOriginIsolated)
  private hasSAB = typeof SharedArrayBuffer !== 'undefined';

  // Workers
  private syncWorker!: Worker;
  private asyncWorker!: Worker;

  // Async request tracking
  private asyncCallId = 0;
  private asyncPending = new Map<number, {
    resolve: (result: { status: number; data: Uint8Array | null }) => void;
    reject: (err: Error) => void;
  }>();

  // Ready promise for async callers
  private readyPromise!: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (err: Error) => void;
  private initError: Error | null = null;
  private isReady = false;


  // Config (definite assignment — always set when constructor doesn't return singleton)
  private config!: Omit<Required<VFSConfig>, 'opfsSyncRoot' | 'swUrl' | 'swScope' | 'mode' | 'limits'> & { opfsSyncRoot?: string; swUrl?: string; swScope?: string; limits?: VFSConfig['limits'] };
  private tabId!: string;
  private _mode!: FSMode;
  private corruptionError: Error | null = null;
  /** Namespace string derived from root — used for lock names, BroadcastChannel, and SW scope
   *  so multiple VFS instances with different roots don't collide. */
  private ns!: string;

  // Service worker registration for multi-tab port transfer
  private swReg: ServiceWorkerRegistration | null = null;
  private isFollower = false;
  private holdingLeaderLock = false;
  private brokerInitialized = false;
  private leaderChangeBc: BroadcastChannel | null = null;

  // Bound request functions for method delegation
  private _sync: SyncRequestFn = (buf) => this.syncRequest(buf);
  private _async: AsyncRequestFn = (op, p, flags, data, path2, fdArgs) =>
    this.asyncRequest(op, p, flags, data, path2, fdArgs);

  // Promises API namespace
  readonly promises!: VFSPromises;

  constructor(config: VFSConfig = {}) {
    const root = config.root ?? '/';
    const ns = `vfs-${root.replace(/[^a-zA-Z0-9]/g, '_')}`;

    // Singleton: return existing instance for the same root on this thread
    const existing = instanceRegistry.get(ns);
    if (existing) return existing;

    // Resolve mode: explicit mode takes priority, else derive from opfsSync
    const mode: FSMode = config.mode ?? 'hybrid';
    this._mode = mode;

    // Derive opfsSync from mode unless explicitly set
    const opfsSync = config.opfsSync ?? (mode === 'hybrid');

    this.config = {
      root,
      opfsSync,
      opfsSyncRoot: config.opfsSyncRoot,
      uid: config.uid ?? 0,
      gid: config.gid ?? 0,
      umask: config.umask ?? 0o022,
      strictPermissions: config.strictPermissions ?? false,
      sabSize: config.sabSize ?? DEFAULT_SAB_SIZE,
      debug: config.debug ?? false,
      swUrl: config.swUrl,
      swScope: config.swScope,
      limits: config.limits,
    };

    this.tabId = crypto.randomUUID();
    this.ns = ns;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.promises = new VFSPromises(this._async, ns);

    instanceRegistry.set(ns, this);
    this.bootstrap();
  }

  /** Spawn workers and establish communication */
  private bootstrap(): void {
    const sabSize = this.config.sabSize;

    if (this.hasSAB) {
      // Full mode: allocate SABs for sync + async communication
      this.sab = new SharedArrayBuffer(sabSize);
      this.readySab = new SharedArrayBuffer(4);
      this.asyncSab = new SharedArrayBuffer(sabSize);
      this.ctrl = new Int32Array(this.sab, 0, 8);
      this.readySignal = new Int32Array(this.readySab, 0, 1);
    }

    // Spawn workers
    this.syncWorker = this.spawnWorker('sync-relay');
    this.asyncWorker = this.spawnWorker('async-relay');

    // Handle messages from sync-relay
    this.syncWorker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'ready') {
        this.isReady = true;
        // Initialize async-relay AFTER sync-relay is ready to avoid
        // requests arriving before the leader loop is running.
        this.initAsyncRelay();
        this.resolveReady();
        if (!this.isFollower) {
          this.initLeaderBroker();
        }
      } else if (msg.type === 'init-failed') {
        if (msg.error?.startsWith('Corrupt VFS:')) {
          this.handleCorruptVFS(msg.error);
        } else if (this.holdingLeaderLock) {
          // We hold the lock but OPFS handle not released yet — retry
          setTimeout(() => this.sendLeaderInit(), 500);
        } else if (!('locks' in navigator)) {
          // No Web Locks fallback — become follower via OPFS handle detection
          this.startAsFollower();
        }
      }
    };

    // Handle async responses from async-relay
    this.asyncWorker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'response') {
        const pending = this.asyncPending.get(msg.callId);
        if (pending) {
          this.asyncPending.delete(msg.callId);
          pending.resolve({ status: msg.status, data: msg.data });
        }
      }
    };

    // Async-relay is initialized later in the 'ready' handler to avoid
    // requests arriving before the sync-relay's leader loop is running.

    // Leader election via Web Locks
    this.acquireLeaderLock();
  }

  /** Use Web Locks API for leader election. The tab that acquires the lock is
   *  the leader; all others become followers. When the leader dies, the browser
   *  releases the lock and the next waiting tab is promoted. */
  private acquireLeaderLock(): void {
    if (!('locks' in navigator)) {
      this.startAsLeader();
      return;
    }

    // Chrome can invoke the ifAvailable callback twice (once with lock, once
    // with null). The `decided` flag ensures only the first invocation acts.
    let decided = false;
    navigator.locks.request(`${this.ns}-leader`, { ifAvailable: true }, async (lock) => {
      if (decided) return;
      decided = true;
      if (lock) {
        this.holdingLeaderLock = true;
        this.startAsLeader();
        await new Promise(() => {}); // Hold lock forever (released when tab closes)
      } else {
        this.startAsFollower();
        this.waitForLeaderLock();
      }
    });
  }

  /** Queue for leader takeover when the current leader's lock is released */
  private waitForLeaderLock(): void {
    if (!('locks' in navigator)) return;
    navigator.locks.request(`${this.ns}-leader`, async () => {
      console.log('[VFS] Leader lock acquired — promoting to leader');
      this.holdingLeaderLock = true;
      this.promoteToLeader();
      await new Promise(() => {}); // Hold lock as new leader
    });
  }

  /** Send init-leader message to sync-relay worker */
  private sendLeaderInit(): void {
    this.syncWorker.postMessage({
      type: 'init-leader',
      sab: this.hasSAB ? this.sab : null,
      readySab: this.hasSAB ? this.readySab : null,
      asyncSab: this.hasSAB ? this.asyncSab : null,
      tabId: this.tabId,
      config: {
        root: this.config.root,
        ns: this.ns,
        opfsSync: this.config.opfsSync,
        opfsSyncRoot: this.config.opfsSyncRoot,
        uid: this.config.uid,
        gid: this.config.gid,
        umask: this.config.umask,
        strictPermissions: this.config.strictPermissions,
        debug: this.config.debug,
        limits: this.config.limits,
      },
    });
  }

  /** Send init-opfs message to sync-relay for OPFS-direct mode */
  private sendOPFSInit(): void {
    this.syncWorker.postMessage({
      type: 'init-opfs',
      sab: this.hasSAB ? this.sab : null,
      readySab: this.hasSAB ? this.readySab : null,
      asyncSab: this.hasSAB ? this.asyncSab : null,
      tabId: this.tabId,
      config: {
        root: this.config.root,
        ns: this.ns,
        uid: this.config.uid,
        gid: this.config.gid,
        debug: this.config.debug,
      },
    });
  }

  /** Handle VFS corruption: log error, fall back to OPFS-direct mode.
   *  The readyPromise will resolve once OPFS mode is ready, but init()
   *  will reject with the corruption error to inform the caller. */
  private handleCorruptVFS(errorMessage: string): void {
    const err = new Error(`${errorMessage} — Falling back to OPFS mode`);
    this.corruptionError = err;
    console.error(`[VFS] ${err.message}`);

    if (this._mode === 'vfs') {
      // VFS-only mode: no OPFS files to fall back to — reject permanently
      this.initError = err;
      this.rejectReady(err);
      if (this.hasSAB) {
        Atomics.store(this.readySignal, 0, -1);
        Atomics.notify(this.readySignal, 0);
      }
      return;
    }

    // Hybrid/default: fall back to OPFS-direct mode
    this._mode = 'opfs';
    this.sendOPFSInit();
  }

  /** Initialize the async-relay worker. Called after sync-relay signals ready. */
  private initAsyncRelay(): void {
    if (this.hasSAB) {
      this.asyncWorker.postMessage({
        type: 'init-leader',
        asyncSab: this.asyncSab,
        wakeSab: this.sab,
      });
    } else {
      const mc = new MessageChannel();
      this.asyncWorker.postMessage(
        { type: 'init-port', port: mc.port1 },
        [mc.port1],
      );
      this.syncWorker.postMessage(
        { type: 'async-port', port: mc.port2 },
        [mc.port2],
      );
    }
  }

  /** Start as leader — tell sync-relay to init VFS engine + OPFS handle */
  private startAsLeader(): void {
    this.isFollower = false;
    if (this._mode === 'opfs') {
      this.sendOPFSInit();
    } else {
      this.sendLeaderInit();
    }
  }

  /** Start as follower — connect to leader via service worker port brokering */
  private startAsFollower(): void {
    this.isFollower = true;

    // Tell sync-relay to prepare for follower mode (sets SABs, awaits leader-port)
    this.syncWorker.postMessage({
      type: 'init-follower',
      sab: this.hasSAB ? this.sab : null,
      readySab: this.hasSAB ? this.readySab : null,
      asyncSab: this.hasSAB ? this.asyncSab : null,
      tabId: this.tabId,
    });

    // Connect to leader via service worker
    this.connectToLeader();

    // Listen for leader changes (BroadcastChannel is scope-independent, unlike SW clients API)
    this.leaderChangeBc = new BroadcastChannel(`${this.ns}-leader-change`);
    this.leaderChangeBc.onmessage = () => {
      if (this.isFollower) {
        console.log('[VFS] Leader changed — reconnecting');
        this.connectToLeader();
      }
    };
  }

  /** Send a new port to sync-relay for connecting to the current leader */
  private connectToLeader(): void {
    const mc = new MessageChannel();

    // Send leader-port to sync-relay immediately so it can signal 'ready'.
    // Messages posted to port1 queue until port2 is connected to the leader.
    this.syncWorker.postMessage(
      { type: 'leader-port', port: mc.port1 },
      [mc.port1],
    );

    // Asynchronously connect port2 to the leader via service worker broker
    this.getServiceWorker().then(sw => {
      sw.postMessage({ type: 'transfer-port', tabId: this.tabId }, [mc.port2]);
    }).catch(err => {
      console.error('[VFS] Failed to connect to leader:', (err as Error).message);
      mc.port2.close();
    });
  }

  /** Register the VFS service worker and return the active SW */
  private async getServiceWorker(): Promise<ServiceWorker> {
    if (!this.swReg) {
      const swUrl = this.config.swUrl
        ? new URL(this.config.swUrl, location.origin)
        : new URL('./workers/service.worker.js', import.meta.url);
      const scope = this.config.swScope ?? new URL(`./${this.ns}/`, swUrl).href;
      this.swReg = await navigator.serviceWorker.register(swUrl.href, { scope });
    }
    const reg = this.swReg;

    if (reg.active) return reg.active;
    const sw = reg.installing || reg.waiting;
    if (!sw) throw new Error('No service worker found');

    return new Promise<ServiceWorker>((resolve, reject) => {
      const timer = setTimeout(() => {
        sw.removeEventListener('statechange', onState);
        reject(new Error('Service worker activation timeout'));
      }, 5000);
      const onState = () => {
        if (sw.state === 'activated') {
          clearTimeout(timer);
          sw.removeEventListener('statechange', onState);
          resolve(sw);
        } else if (sw.state === 'redundant') {
          clearTimeout(timer);
          sw.removeEventListener('statechange', onState);
          reject(new Error('SW redundant'));
        }
      };
      sw.addEventListener('statechange', onState);
      onState(); // Check immediately — state may have changed before listener was added
    });
  }

  /** Register as leader with SW broker (receives follower ports via control channel) */
  private initLeaderBroker(): void {
    if (this.brokerInitialized) return;
    this.brokerInitialized = true;

    this.getServiceWorker().then(sw => {
      const mc = new MessageChannel();
      sw.postMessage({ type: 'register-server' }, [mc.port2]);

      mc.port1.onmessage = (event: MessageEvent) => {
        if (event.data.type === 'client-port') {
          const clientPort = event.ports[0];
          if (clientPort) {
            this.syncWorker.postMessage(
              { type: 'client-port', tabId: event.data.tabId, port: clientPort },
              [clientPort],
            );
          }
        }
      };
      mc.port1.start();

      // Notify followers that a (new) leader is available — they should reconnect
      const bc = new BroadcastChannel(`${this.ns}-leader-change`);
      bc.postMessage({ type: 'leader-changed' });
      bc.close();
    }).catch(err => {
      console.warn('[VFS] SW broker unavailable, single-tab only:', (err as Error).message);
    });
  }

  /** Promote from follower to leader (after leader tab dies and lock is acquired) */
  private promoteToLeader(): void {
    this.isFollower = false;
    this.isReady = false;
    this.brokerInitialized = false; // Allow re-registration with SW as new leader

    // Stop listening for leader changes (we ARE the leader now)
    if (this.leaderChangeBc) {
      this.leaderChangeBc.close();
      this.leaderChangeBc = null;
    }

    // Reset readyPromise for async callers during transition
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    // Terminate old workers
    this.syncWorker.terminate();
    this.asyncWorker.terminate();

    // Allocate fresh SABs (only if available)
    const sabSize = this.config.sabSize;
    if (this.hasSAB) {
      this.sab = new SharedArrayBuffer(sabSize);
      this.readySab = new SharedArrayBuffer(4);
      this.asyncSab = new SharedArrayBuffer(sabSize);
      this.ctrl = new Int32Array(this.sab, 0, 8);
      this.readySignal = new Int32Array(this.readySab, 0, 1);
    }

    // Spawn new workers
    this.syncWorker = this.spawnWorker('sync-relay');
    this.asyncWorker = this.spawnWorker('async-relay');

    // Handle sync-relay messages
    this.syncWorker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'ready') {
        this.isReady = true;
        this.resolveReady();
        this.initLeaderBroker();
      } else if (msg.type === 'init-failed') {
        if (msg.error?.startsWith('Corrupt VFS:')) {
          this.handleCorruptVFS(msg.error);
        } else {
          // OPFS handle not yet released by dead leader — retry
          console.warn('[VFS] Promotion: OPFS handle still busy, retrying...');
          setTimeout(() => this.sendLeaderInit(), 500);
        }
      }
    };

    // Handle async responses
    this.asyncWorker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'response') {
        const pending = this.asyncPending.get(msg.callId);
        if (pending) {
          this.asyncPending.delete(msg.callId);
          pending.resolve({ status: msg.status, data: msg.data });
        }
      }
    };

    if (this.hasSAB) {
      // Initialize async-relay with SAB
      this.asyncWorker.postMessage({
        type: 'init-leader',
        asyncSab: this.asyncSab,
        wakeSab: this.sab,
      });
    } else {
      // No SAB: connect async-relay ↔ sync-relay via MessagePort
      const mc = new MessageChannel();
      this.asyncWorker.postMessage(
        { type: 'init-port', port: mc.port1 },
        [mc.port1],
      );
      this.syncWorker.postMessage(
        { type: 'async-port', port: mc.port2 },
        [mc.port2],
      );
    }
    if (this._mode === 'opfs') {
      this.sendOPFSInit();
    } else {
      this.sendLeaderInit();
    }
  }

  /** Spawn an inline worker from bundled code */
  private spawnWorker(name: string): Worker {
    // In production, worker code is inlined as blob URLs at build time.
    // For development, we use module workers.
    const workerUrl = new URL(`./workers/${name}.worker.js`, import.meta.url);
    return new Worker(workerUrl, { type: 'module' });
  }

  // ========== Sync operation primitives ==========

  /** Block until workers are ready */
  private ensureReady(): void {
    if (this.isReady) return;
    if (this.initError) throw this.initError;
    if (!this.hasSAB) {
      throw new Error('Sync API requires crossOriginIsolated (COOP/COEP headers). Use the promises API instead.');
    }
    // Check if ready signal is set
    const signal = Atomics.load(this.readySignal, 0);
    if (signal === 1) {
      this.isReady = true;
      return;
    }
    if (signal === -1) {
      // Permanent failure (e.g. VFS corruption in vfs-only mode)
      throw this.initError ?? new Error('VFS initialization failed');
    }
    // Block until ready
    spinWait(this.readySignal, 0, 0);
    // Check again after wake — could be ready (1) or failed (-1)
    const finalSignal = Atomics.load(this.readySignal, 0);
    if (finalSignal === -1) {
      throw this.initError ?? new Error('VFS initialization failed');
    }
    this.isReady = true;
  }

  /** Send a sync request via SAB and wait for response */
  private syncRequest(requestBuf: ArrayBuffer): { status: number; data: Uint8Array | null } {
    this.ensureReady();

    const t0 = this.config.debug ? performance.now() : 0;
    const maxChunk = this.sab.byteLength - HEADER_SIZE;
    const requestBytes = new Uint8Array(requestBuf);
    const totalLenView = new BigUint64Array(this.sab, SAB_OFFSETS.TOTAL_LEN, 1);

    if (requestBytes.byteLength <= maxChunk) {
      // Fast path: single chunk
      new Uint8Array(this.sab, HEADER_SIZE, requestBytes.byteLength).set(requestBytes);
      Atomics.store(this.ctrl, 3, requestBytes.byteLength); // chunk length
      Atomics.store(totalLenView, 0, BigInt(requestBytes.byteLength));
      Atomics.store(this.ctrl, 0, SIGNAL.REQUEST);
      Atomics.notify(this.ctrl, 0);
    } else {
      // Multi-chunk: send in chunks
      let sent = 0;
      while (sent < requestBytes.byteLength) {
        const chunkSize = Math.min(maxChunk, requestBytes.byteLength - sent);
        new Uint8Array(this.sab, HEADER_SIZE, chunkSize).set(
          requestBytes.subarray(sent, sent + chunkSize)
        );
        Atomics.store(this.ctrl, 3, chunkSize);
        Atomics.store(totalLenView, 0, BigInt(requestBytes.byteLength));
        Atomics.store(this.ctrl, 6, Math.floor(sent / maxChunk)); // chunk index

        if (sent === 0) {
          Atomics.store(this.ctrl, 0, SIGNAL.REQUEST);
        } else {
          Atomics.store(this.ctrl, 0, SIGNAL.CHUNK);
        }
        Atomics.notify(this.ctrl, 0);

        sent += chunkSize;
        if (sent < requestBytes.byteLength) {
          // Wait for worker to ack
          spinWait(this.ctrl, 0, sent === chunkSize ? SIGNAL.REQUEST : SIGNAL.CHUNK);
        }
      }
    }

    // Wait for response
    spinWait(this.ctrl, 0, SIGNAL.REQUEST);

    // Read response — may be chunked
    const signal = Atomics.load(this.ctrl, 0);
    const respChunkLen = Atomics.load(this.ctrl, 3);
    const respTotalLen = Number(Atomics.load(totalLenView, 0));

    let responseBytes: Uint8Array;

    if (signal === SIGNAL.RESPONSE && respTotalLen <= maxChunk) {
      // Single chunk response
      responseBytes = new Uint8Array(this.sab, HEADER_SIZE, respChunkLen).slice();
    } else {
      // Multi-chunk response
      responseBytes = new Uint8Array(respTotalLen);
      let received = 0;

      // Read first chunk
      const firstLen = respChunkLen;
      responseBytes.set(new Uint8Array(this.sab, HEADER_SIZE, firstLen), 0);
      received += firstLen;

      while (received < respTotalLen) {
        // Ack and wait for next chunk
        Atomics.store(this.ctrl, 0, SIGNAL.CHUNK_ACK);
        Atomics.notify(this.ctrl, 0);
        spinWait(this.ctrl, 0, SIGNAL.CHUNK_ACK);

        const nextLen = Atomics.load(this.ctrl, 3);
        responseBytes.set(new Uint8Array(this.sab, HEADER_SIZE, nextLen), received);
        received += nextLen;
      }
    }

    // Reset to idle — NO notify: the worker stays asleep until the next request's
    // notify wakes it, giving us ONE cross-thread wake per operation instead of two.
    Atomics.store(this.ctrl, 0, SIGNAL.IDLE);

    const result = decodeResponse(responseBytes.buffer as ArrayBuffer);
    if (this.config.debug) {
      const t1 = performance.now();
      console.log(`[syncRequest] size=${requestBuf.byteLength} roundTrip=${(t1 - t0).toFixed(3)}ms`);
    }
    return result;
  }

  // ========== Async operation primitive ==========

  private asyncRequest(
    op: number,
    filePath: string,
    flags?: number,
    data?: Uint8Array | string | null,
    path2?: string,
    fdArgs?: Record<string, unknown>
  ): Promise<{ status: number; data: Uint8Array | null }> {
    return this.readyPromise.then(() => {
      return new Promise((resolve, reject) => {
        const callId = this.asyncCallId++;
        this.asyncPending.set(callId, { resolve, reject });

        this.asyncWorker.postMessage({
          type: 'request',
          callId,
          op,
          path: filePath,
          flags: flags ?? 0,
          data: data instanceof Uint8Array ? data : (typeof data === 'string' ? data : null),
          path2,
          fdArgs,
        });
      });
    });
  }

  // ========== Sync API ==========

  readFileSync(filePath: PathLike, options?: ReadOptions | Encoding | null): string | Uint8Array {
    return _readFileSync(this._sync, toPathString(filePath), options);
  }

  writeFileSync(filePath: PathLike, data: string | Uint8Array, options?: WriteOptions | Encoding): void {
    _writeFileSync(this._sync, toPathString(filePath), data, options);
  }

  appendFileSync(filePath: PathLike, data: string | Uint8Array, options?: WriteOptions | Encoding): void {
    _appendFileSync(this._sync, toPathString(filePath), data, options);
  }

  existsSync(filePath: PathLike): boolean {
    return _existsSync(this._sync, toPathString(filePath));
  }

  mkdirSync(filePath: PathLike, options?: MkdirOptions | number): string | undefined {
    return _mkdirSync(this._sync, toPathString(filePath), options);
  }

  rmdirSync(filePath: PathLike, options?: RmdirOptions): void {
    _rmdirSync(this._sync, toPathString(filePath), options);
  }

  rmSync(filePath: PathLike, options?: RmOptions): void {
    _rmSync(this._sync, toPathString(filePath), options);
  }

  unlinkSync(filePath: PathLike): void {
    _unlinkSync(this._sync, toPathString(filePath));
  }

  readdirSync(filePath: PathLike, options?: ReaddirOptions | Encoding | null): string[] | Dirent[] {
    return _readdirSync(this._sync, toPathString(filePath), options);
  }

  globSync(pattern: string, options?: GlobOptions): string[] {
    return _globSync(this._sync, pattern, options);
  }

  statSync(filePath: PathLike, options?: StatOptions): Stats | BigIntStats {
    return _statSync(this._sync, toPathString(filePath), options);
  }

  lstatSync(filePath: PathLike, options?: StatOptions): Stats | BigIntStats {
    return _lstatSync(this._sync, toPathString(filePath), options);
  }

  renameSync(oldPath: PathLike, newPath: PathLike): void {
    _renameSync(this._sync, toPathString(oldPath), toPathString(newPath));
  }

  copyFileSync(src: PathLike, dest: PathLike, mode?: number): void {
    _copyFileSync(this._sync, toPathString(src), toPathString(dest), mode);
  }

  cpSync(src: PathLike, dest: PathLike, options?: CpOptions): void {
    const srcPath = toPathString(src);
    const destPath = toPathString(dest);
    const force = options?.force !== false;          // default true
    const errorOnExist = options?.errorOnExist ?? false;
    const dereference = options?.dereference ?? false;
    const preserveTimestamps = options?.preserveTimestamps ?? false;

    const srcStat = dereference ? this.statSync(srcPath) : this.lstatSync(srcPath);

    if (srcStat.isDirectory()) {
      if (!options?.recursive) {
        throw createError('EISDIR', 'cp', srcPath);
      }
      try {
        this.mkdirSync(destPath, { recursive: true });
      } catch (e: any) {
        if (e.code !== 'EEXIST') throw e;
      }
      const entries = this.readdirSync(srcPath, { withFileTypes: true }) as Dirent[];
      for (const entry of entries) {
        const srcChild = pathJoin(srcPath, entry.name);
        const destChild = pathJoin(destPath, entry.name);
        this.cpSync(srcChild, destChild, options);
      }
    } else if (srcStat.isSymbolicLink() && !dereference) {
      const target = this.readlinkSync(srcPath) as string;
      let destExists = false;
      try { this.lstatSync(destPath); destExists = true; } catch {}
      if (destExists) {
        if (errorOnExist) throw createError('EEXIST', 'cp', destPath);
        if (!force) return;
        this.unlinkSync(destPath);
      }
      this.symlinkSync(target, destPath);
    } else {
      let destExists = false;
      try { this.lstatSync(destPath); destExists = true; } catch {}
      if (destExists) {
        if (errorOnExist) throw createError('EEXIST', 'cp', destPath);
        if (!force) return;
      }
      this.copyFileSync(srcPath, destPath, errorOnExist ? constants.COPYFILE_EXCL : 0);
    }

    if (preserveTimestamps) {
      const st = this.statSync(srcPath);
      this.utimesSync(destPath, st.atime, st.mtime);
    }
  }

  private async _cpAsync(src: string, dest: string, options?: CpOptions): Promise<void> {
    const force = options?.force !== false;
    const errorOnExist = options?.errorOnExist ?? false;
    const dereference = options?.dereference ?? false;
    const preserveTimestamps = options?.preserveTimestamps ?? false;

    const srcStat = dereference
      ? await this.promises.stat(src)
      : await this.promises.lstat(src);

    if (srcStat.isDirectory()) {
      if (!options?.recursive) {
        throw createError('EISDIR', 'cp', src);
      }
      try {
        await this.promises.mkdir(dest, { recursive: true });
      } catch (e: any) {
        if (e.code !== 'EEXIST') throw e;
      }
      const entries = await this.promises.readdir(src, { withFileTypes: true }) as Dirent[];
      for (const entry of entries) {
        const srcChild = pathJoin(src, entry.name);
        const destChild = pathJoin(dest, entry.name);
        await this._cpAsync(srcChild, destChild, options);
      }
    } else if (srcStat.isSymbolicLink() && !dereference) {
      const target = await this.promises.readlink(src) as string;
      let destExists = false;
      try { await this.promises.lstat(dest); destExists = true; } catch {}
      if (destExists) {
        if (errorOnExist) throw createError('EEXIST', 'cp', dest);
        if (!force) return;
        await this.promises.unlink(dest);
      }
      await this.promises.symlink(target, dest);
    } else {
      let destExists = false;
      try { await this.promises.lstat(dest); destExists = true; } catch {}
      if (destExists) {
        if (errorOnExist) throw createError('EEXIST', 'cp', dest);
        if (!force) return;
      }
      await this.promises.copyFile(src, dest, errorOnExist ? constants.COPYFILE_EXCL : 0);
    }

    if (preserveTimestamps) {
      const st = await this.promises.stat(src);
      await this.promises.utimes(dest, st.atime, st.mtime);
    }
  }

  truncateSync(filePath: PathLike, len?: number): void {
    _truncateSync(this._sync, toPathString(filePath), len);
  }

  accessSync(filePath: PathLike, mode?: number): void {
    _accessSync(this._sync, toPathString(filePath), mode);
  }

  realpathSync(filePath: PathLike): string {
    return _realpathSync(this._sync, toPathString(filePath));
  }

  chmodSync(filePath: PathLike, mode: number): void {
    _chmodSync(this._sync, toPathString(filePath), mode);
  }

  /** Like chmodSync but operates on the symlink itself. In this VFS, delegates to chmodSync. */
  lchmodSync(filePath: string, mode: number): void {
    _chmodSync(this._sync, filePath, mode);
  }

  /** chmod on an open file descriptor. No-op in this VFS (permissions are cosmetic). */
  fchmodSync(_fd: number, _mode: number): void {
    // No-op: fd-based permission changes are not supported in this OPFS VFS.
  }

  chownSync(filePath: PathLike, uid: number, gid: number): void {
    _chownSync(this._sync, toPathString(filePath), uid, gid);
  }

  /** Like chownSync but operates on the symlink itself. In this VFS, delegates to chownSync. */
  lchownSync(filePath: string, uid: number, gid: number): void {
    _chownSync(this._sync, filePath, uid, gid);
  }

  /** chown on an open file descriptor. No-op in this VFS (permissions are cosmetic). */
  fchownSync(_fd: number, _uid: number, _gid: number): void {
    // No-op: fd-based permission changes are not supported in this OPFS VFS.
  }

  utimesSync(filePath: PathLike, atime: Date | number, mtime: Date | number): void {
    _utimesSync(this._sync, toPathString(filePath), atime, mtime);
  }

  /** Like utimesSync but operates on the symlink itself. In this VFS, delegates to utimesSync. */
  lutimesSync(filePath: string, atime: Date | number, mtime: Date | number): void {
    _utimesSync(this._sync, filePath, atime, mtime);
  }

  symlinkSync(target: PathLike, linkPath: PathLike, type?: string | null): void {
    _symlinkSync(this._sync, toPathString(target), toPathString(linkPath), type);
  }

  readlinkSync(filePath: PathLike, options?: { encoding?: string | null } | string | null): string | Uint8Array {
    return _readlinkSync(this._sync, toPathString(filePath), options);
  }

  linkSync(existingPath: PathLike, newPath: PathLike): void {
    _linkSync(this._sync, toPathString(existingPath), toPathString(newPath));
  }

  mkdtempSync(prefix: string): string {
    return _mkdtempSync(this._sync, prefix);
  }

  // ---- File descriptor sync methods ----

  openSync(filePath: PathLike, flags: string | number = 'r', mode?: number): number {
    return _openSync(this._sync, toPathString(filePath), flags, mode);
  }

  closeSync(fd: number): void {
    _closeSync(this._sync, fd);
  }

  readSync(
    fd: number,
    bufferOrOptions: Uint8Array | { buffer: Uint8Array; offset?: number; length?: number; position?: number | null },
    offsetOrOptions?: number | { offset?: number; length?: number; position?: number | null },
    length?: number,
    position?: number | null
  ): number {
    return _readSync(this._sync, fd, bufferOrOptions, offsetOrOptions, length, position);
  }

  writeSync(
    fd: number,
    bufferOrString: Uint8Array | string,
    offsetOrPositionOrOptions?: number | { offset?: number; length?: number; position?: number | null },
    lengthOrEncoding?: number | string,
    position?: number | null
  ): number {
    return _writeSyncFd(this._sync, fd, bufferOrString, offsetOrPositionOrOptions, lengthOrEncoding, position);
  }

  fstatSync(fd: number): Stats {
    return _fstatSync(this._sync, fd);
  }

  ftruncateSync(fd: number, len?: number): void {
    _ftruncateSync(this._sync, fd, len);
  }

  fdatasyncSync(fd: number): void {
    _fdatasyncSync(this._sync, fd);
  }

  // ---- Vector I/O methods ----

  readvSync(fd: number, buffers: Uint8Array[], position?: number | null): number {
    let totalRead = 0;
    let pos = position ?? null;
    for (const buf of buffers) {
      const bytesRead = this.readSync(fd, buf, 0, buf.byteLength, pos);
      totalRead += bytesRead;
      if (pos !== null) pos += bytesRead;
      if (bytesRead < buf.byteLength) break; // short read = EOF
    }
    return totalRead;
  }

  writevSync(fd: number, buffers: Uint8Array[], position?: number | null): number {
    let totalWritten = 0;
    let pos = position ?? null;
    for (const buf of buffers) {
      const bytesWritten = this.writeSync(fd, buf, 0, buf.byteLength, pos);
      totalWritten += bytesWritten;
      if (pos !== null) pos += bytesWritten;
    }
    return totalWritten;
  }

  readv(fd: number, buffers: Uint8Array[], position: number | null | undefined, callback: (err: Error | null, bytesRead?: number, buffers?: Uint8Array[]) => void): void;
  readv(fd: number, buffers: Uint8Array[], callback: (err: Error | null, bytesRead?: number, buffers?: Uint8Array[]) => void): void;
  readv(fd: number, buffers: Uint8Array[], positionOrCallback: number | null | undefined | ((err: Error | null, bytesRead?: number, buffers?: Uint8Array[]) => void), callback?: (err: Error | null, bytesRead?: number, buffers?: Uint8Array[]) => void): void {
    let pos: number | null | undefined;
    let cb: (err: Error | null, bytesRead?: number, buffers?: Uint8Array[]) => void;
    if (typeof positionOrCallback === 'function') {
      pos = undefined;
      cb = positionOrCallback;
    } else {
      pos = positionOrCallback;
      cb = callback!;
    }
    try {
      const bytesRead = this.readvSync(fd, buffers, pos);
      cb(null, bytesRead, buffers);
    } catch (err: any) {
      cb(err);
    }
  }

  writev(fd: number, buffers: Uint8Array[], position: number | null | undefined, callback: (err: Error | null, bytesWritten?: number, buffers?: Uint8Array[]) => void): void;
  writev(fd: number, buffers: Uint8Array[], callback: (err: Error | null, bytesWritten?: number, buffers?: Uint8Array[]) => void): void;
  writev(fd: number, buffers: Uint8Array[], positionOrCallback: number | null | undefined | ((err: Error | null, bytesWritten?: number, buffers?: Uint8Array[]) => void), callback?: (err: Error | null, bytesWritten?: number, buffers?: Uint8Array[]) => void): void {
    let pos: number | null | undefined;
    let cb: (err: Error | null, bytesWritten?: number, buffers?: Uint8Array[]) => void;
    if (typeof positionOrCallback === 'function') {
      pos = undefined;
      cb = positionOrCallback;
    } else {
      pos = positionOrCallback;
      cb = callback!;
    }
    try {
      const bytesWritten = this.writevSync(fd, buffers, pos);
      cb(null, bytesWritten, buffers);
    } catch (err: any) {
      cb(err);
    }
  }

  // ---- statfs methods ----

  statfsSync(_path?: string): StatFs {
    return {
      type: 0x56465321,       // "VFS!"
      bsize: 4096,
      blocks: 1024 * 1024,    // ~4GB virtual capacity
      bfree: 512 * 1024,      // ~2GB free (estimate)
      bavail: 512 * 1024,
      files: 10000,            // default max inodes
      ffree: 5000,             // estimate half free
    };
  }

  statfs(path: string, callback: (err: Error | null, stats?: StatFs) => void): void;
  statfs(path: string): Promise<StatFs>;
  statfs(path: string, callback?: (err: Error | null, stats?: StatFs) => void): Promise<StatFs> | void {
    const result = this.statfsSync(path);
    if (callback) {
      callback(null, result);
      return;
    }
    return Promise.resolve(result);
  }

  // ---- Watch methods ----

  watch(filePath: PathLike, options?: WatchOptions | Encoding, listener?: WatchListener): FSWatcher {
    return _watch(this.ns, toPathString(filePath), options, listener);
  }

  watchFile(filePath: PathLike, optionsOrListener?: WatchFileOptions | WatchFileListener, listener?: WatchFileListener): void {
    _watchFile(this.ns, this._sync, toPathString(filePath), optionsOrListener, listener);
  }

  unwatchFile(filePath: PathLike, listener?: WatchFileListener): void {
    _unwatchFile(this.ns, toPathString(filePath), listener);
  }

  // ---- openAsBlob (Node.js 19+) ----

  async openAsBlob(filePath: string, options?: OpenAsBlobOptions): Promise<Blob> {
    const data = await this.promises.readFile(filePath);
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data as string);
    return new Blob([bytes as BlobPart], { type: options?.type ?? '' });
  }

  // ---- Stream methods ----

  createReadStream(filePath: PathLike, options?: ReadStreamOptions | string): FSReadStream {
    const opts = typeof options === 'string' ? { encoding: options as Encoding } : options;
    const start = opts?.start ?? 0;
    const end = opts?.end;
    const highWaterMark = opts?.highWaterMark ?? 64 * 1024;

    let position = start;
    let handle: import('./types.js').FileHandle | null = null;
    let finished = false;

    const cleanup = async () => {
      if (handle) {
        try { await handle.close(); } catch { /* ignore close errors */ }
        handle = null;
      }
    };

    const readFn = async (): Promise<{ done: boolean; value?: Uint8Array }> => {
      if (finished) return { done: true };

      // Lazily open the file on first read
      if (!handle) {
        handle = await this.promises.open(toPathString(filePath), opts?.flags ?? 'r');
      }

      const readLen = end !== undefined
        ? Math.min(highWaterMark, end - position + 1)
        : highWaterMark;

      if (readLen <= 0) {
        finished = true;
        await cleanup();
        return { done: true };
      }

      const buffer = new Uint8Array(readLen);
      const { bytesRead } = await handle.read(buffer, 0, readLen, position);

      if (bytesRead === 0) {
        finished = true;
        await cleanup();
        return { done: true };
      }

      position += bytesRead;

      if (end !== undefined && position > end) {
        finished = true;
        await cleanup();
        return { done: false, value: buffer.subarray(0, bytesRead) };
      }

      return { done: false, value: buffer.subarray(0, bytesRead) };
    };

    const stream = new NodeReadable(readFn, cleanup) as unknown as FSReadStream;
    (stream as unknown as NodeReadable).path = toPathString(filePath);

    return stream;
  }

  createWriteStream(filePath: PathLike, options?: WriteStreamOptions | string): FSWriteStream {
    const opts = typeof options === 'string' ? { encoding: options as Encoding } : options;
    let position = opts?.start ?? 0;
    let handle: FileHandle | null = null;

    const writeFn = async (chunk: Uint8Array): Promise<void> => {
      if (!handle) {
        handle = await this.promises.open(toPathString(filePath), opts?.flags ?? 'w');
      }
      const { bytesWritten } = await handle.write(chunk, 0, chunk.byteLength, position);
      position += bytesWritten;
    };

    const closeFn = async (): Promise<void> => {
      if (handle) {
        if (opts?.flush) {
          await handle.sync();
        }
        await handle.close();
        handle = null;
      }
    };

    return new NodeWritable(toPathString(filePath), writeFn, closeFn) as unknown as FSWriteStream;
  }

  // ---- Utility methods ----

  flushSync(): void {
    const buf = encodeRequest(OP.FSYNC, '');
    this.syncRequest(buf);
  }

  purgeSync(): void {
    // No-op — VFS doesn't have external caches to purge
  }

  /** The current filesystem mode. Changes to 'opfs' on corruption fallback. */
  get mode(): FSMode {
    return this._mode;
  }

  /** Async init helper — avoid blocking main thread.
   *  Rejects with corruption error if VFS was corrupt (but system falls back to OPFS mode).
   *  Callers can catch and continue — the fs API works in OPFS mode after rejection. */
  init(): Promise<void> {
    return this.readyPromise.then(() => {
      if (this.corruptionError) {
        throw this.corruptionError;
      }
    });
  }

  /** Switch the filesystem mode at runtime.
   *
   *  Typical flow for IDE corruption recovery:
   *  1. `await fs.init()` throws with corruption error (auto-falls back to opfs)
   *  2. IDE shows warning, user clicks "Repair" → call `repairVFS(root, fs)`
   *  3. After repair: `await fs.setMode('hybrid')` to resume normal VFS+OPFS mode
   *
   *  Returns a Promise that resolves when the new mode is ready. */
  async setMode(newMode: FSMode): Promise<void> {
    if (newMode === this._mode && this.isReady && !this.corruptionError) {
      return; // Already in this mode and healthy
    }

    this._mode = newMode;
    this.corruptionError = null;
    this.initError = null;
    this.isReady = false;
    this.config.opfsSync = newMode === 'hybrid';

    // Reset readyPromise
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    // Terminate old workers and spawn fresh ones
    this.syncWorker.terminate();
    this.asyncWorker.terminate();

    const sabSize = this.config.sabSize;
    if (this.hasSAB) {
      this.sab = new SharedArrayBuffer(sabSize);
      this.readySab = new SharedArrayBuffer(4);
      this.asyncSab = new SharedArrayBuffer(sabSize);
      this.ctrl = new Int32Array(this.sab, 0, 8);
      this.readySignal = new Int32Array(this.readySab, 0, 1);
    }

    this.syncWorker = this.spawnWorker('sync-relay');
    this.asyncWorker = this.spawnWorker('async-relay');

    // Handle sync-relay messages
    this.syncWorker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'ready') {
        this.isReady = true;
        this.resolveReady();
        if (!this.isFollower) {
          this.initLeaderBroker();
        }
      } else if (msg.type === 'init-failed') {
        if (msg.error?.startsWith('Corrupt VFS:')) {
          this.handleCorruptVFS(msg.error);
        } else if (this.holdingLeaderLock) {
          setTimeout(() => this.sendLeaderInit(), 500);
        }
      }
    };

    this.asyncWorker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'response') {
        const pending = this.asyncPending.get(msg.callId);
        if (pending) {
          this.asyncPending.delete(msg.callId);
          pending.resolve({ status: msg.status, data: msg.data });
        }
      }
    };

    if (this.hasSAB) {
      this.asyncWorker.postMessage({
        type: 'init-leader',
        asyncSab: this.asyncSab,
        wakeSab: this.sab,
      });
    } else {
      const mc = new MessageChannel();
      this.asyncWorker.postMessage(
        { type: 'init-port', port: mc.port1 },
        [mc.port1],
      );
      this.syncWorker.postMessage(
        { type: 'async-port', port: mc.port2 },
        [mc.port2],
      );
    }

    if (newMode === 'opfs') {
      this.sendOPFSInit();
    } else {
      this.sendLeaderInit();
    }

    return this.readyPromise;
  }

  // ========== Callback API ==========
  // Node.js-style callback overloads for all async operations.
  // These delegate to this.promises.* and adapt the result to (err, result) callbacks.

  readFile(filePath: string, callback: (err: Error | null, data?: Uint8Array | string) => void): void;
  readFile(filePath: string, options: ReadOptions | Encoding | null, callback: (err: Error | null, data?: Uint8Array | string) => void): void;
  readFile(filePath: string, optionsOrCallback?: any, callback?: any): void {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    this.promises.readFile(filePath, opts).then(
      (result) => cb(null, result),
      (err) => cb(err),
    );
  }

  writeFile(filePath: string, data: string | Uint8Array, callback: (err: Error | null) => void): void;
  writeFile(filePath: string, data: string | Uint8Array, options: WriteOptions | Encoding, callback: (err: Error | null) => void): void;
  writeFile(filePath: string, data: string | Uint8Array, optionsOrCallback?: any, callback?: any): void {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    this.promises.writeFile(filePath, data, opts).then(
      () => cb(null),
      (err) => cb(err),
    );
  }

  appendFile(filePath: string, data: string | Uint8Array, callback: (err: Error | null) => void): void;
  appendFile(filePath: string, data: string | Uint8Array, options: WriteOptions | Encoding, callback: (err: Error | null) => void): void;
  appendFile(filePath: string, data: string | Uint8Array, optionsOrCallback?: any, callback?: any): void {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    this.promises.appendFile(filePath, data, opts).then(
      () => cb(null),
      (err) => cb(err),
    );
  }

  mkdir(filePath: string, callback: (err: Error | null, path?: string) => void): void;
  mkdir(filePath: string, options: MkdirOptions | number, callback: (err: Error | null, path?: string) => void): void;
  mkdir(filePath: string, optionsOrCallback?: any, callback?: any): void {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    this.promises.mkdir(filePath, opts).then(
      (result) => cb(null, result),
      (err) => cb(err),
    );
  }

  rmdir(filePath: string, callback: (err: Error | null) => void): void;
  rmdir(filePath: string, options: RmdirOptions, callback: (err: Error | null) => void): void;
  rmdir(filePath: string, optionsOrCallback?: any, callback?: any): void {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    this.promises.rmdir(filePath, opts).then(
      () => cb(null),
      (err) => cb(err),
    );
  }

  rm(filePath: string, callback: (err: Error | null) => void): void;
  rm(filePath: string, options: RmOptions, callback: (err: Error | null) => void): void;
  rm(filePath: string, optionsOrCallback?: any, callback?: any): void {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    this.promises.rm(filePath, opts).then(
      () => cb(null),
      (err) => cb(err),
    );
  }

  unlink(filePath: string, callback: (err: Error | null) => void): void {
    this.promises.unlink(filePath).then(
      () => callback(null),
      (err) => callback(err),
    );
  }

  readdir(filePath: string, callback: (err: Error | null, files?: string[] | Dirent[]) => void): void;
  readdir(filePath: string, options: ReaddirOptions | Encoding | null, callback: (err: Error | null, files?: string[] | Dirent[]) => void): void;
  readdir(filePath: string, optionsOrCallback?: any, callback?: any): void {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    this.promises.readdir(filePath, opts).then(
      (result) => cb(null, result),
      (err) => cb(err),
    );
  }

  stat(filePath: string, callback: (err: Error | null, stats?: Stats | BigIntStats) => void): void;
  stat(filePath: string, options: StatOptions, callback: (err: Error | null, stats?: Stats | BigIntStats) => void): void;
  stat(filePath: string, optionsOrCallback?: any, callback?: any): void {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    this.promises.stat(filePath, opts).then(
      (result) => cb(null, result),
      (err) => cb(err),
    );
  }

  lstat(filePath: string, callback: (err: Error | null, stats?: Stats | BigIntStats) => void): void;
  lstat(filePath: string, options: StatOptions, callback: (err: Error | null, stats?: Stats | BigIntStats) => void): void;
  lstat(filePath: string, optionsOrCallback?: any, callback?: any): void {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    this.promises.lstat(filePath, opts).then(
      (result) => cb(null, result),
      (err) => cb(err),
    );
  }

  access(filePath: string, callback: (err: Error | null) => void): void;
  access(filePath: string, mode: number, callback: (err: Error | null) => void): void;
  access(filePath: string, modeOrCallback?: any, callback?: any): void {
    const cb = typeof modeOrCallback === 'function' ? modeOrCallback : callback;
    const mode = typeof modeOrCallback === 'function' ? undefined : modeOrCallback;
    this.promises.access(filePath, mode).then(
      () => cb(null),
      (err) => cb(err),
    );
  }

  rename(oldPath: string, newPath: string, callback: (err: Error | null) => void): void {
    this.promises.rename(oldPath, newPath).then(
      () => callback(null),
      (err) => callback(err),
    );
  }

  copyFile(src: string, dest: string, callback: (err: Error | null) => void): void;
  copyFile(src: string, dest: string, mode: number, callback: (err: Error | null) => void): void;
  copyFile(src: string, dest: string, modeOrCallback?: any, callback?: any): void {
    const cb = typeof modeOrCallback === 'function' ? modeOrCallback : callback;
    const mode = typeof modeOrCallback === 'function' ? undefined : modeOrCallback;
    this.promises.copyFile(src, dest, mode).then(
      () => cb(null),
      (err) => cb(err),
    );
  }

  truncate(filePath: string, callback: (err: Error | null) => void): void;
  truncate(filePath: string, len: number, callback: (err: Error | null) => void): void;
  truncate(filePath: string, lenOrCallback?: any, callback?: any): void {
    const cb = typeof lenOrCallback === 'function' ? lenOrCallback : callback;
    const len = typeof lenOrCallback === 'function' ? undefined : lenOrCallback;
    this.promises.truncate(filePath, len).then(
      () => cb(null),
      (err) => cb(err),
    );
  }

  realpath(filePath: string, callback: (err: Error | null, resolvedPath?: string) => void): void {
    this.promises.realpath(filePath).then(
      (result) => callback(null, result),
      (err) => callback(err),
    );
  }

  chmod(filePath: string, mode: number, callback: (err: Error | null) => void): void {
    this.promises.chmod(filePath, mode).then(
      () => callback(null),
      (err) => callback(err),
    );
  }

  chown(filePath: string, uid: number, gid: number, callback: (err: Error | null) => void): void {
    this.promises.chown(filePath, uid, gid).then(
      () => callback(null),
      (err) => callback(err),
    );
  }

  utimes(filePath: string, atime: Date | number, mtime: Date | number, callback: (err: Error | null) => void): void {
    this.promises.utimes(filePath, atime, mtime).then(
      () => callback(null),
      (err) => callback(err),
    );
  }

  symlink(target: string, linkPath: string, callback: (err: Error | null) => void): void;
  symlink(target: string, linkPath: string, type: string | null, callback: (err: Error | null) => void): void;
  symlink(target: string, linkPath: string, typeOrCallback?: any, callback?: any): void {
    const cb = typeof typeOrCallback === 'function' ? typeOrCallback : callback;
    const type = typeof typeOrCallback === 'function' ? undefined : typeOrCallback;
    this.promises.symlink(target, linkPath, type).then(
      () => cb(null),
      (err) => cb(err),
    );
  }

  readlink(filePath: string, callback: (err: Error | null, linkString?: string | Uint8Array) => void): void;
  readlink(filePath: string, options: { encoding?: string | null } | string | null, callback: (err: Error | null, linkString?: string | Uint8Array) => void): void;
  readlink(filePath: string, optionsOrCallback?: any, callback?: any): void {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    this.promises.readlink(filePath, opts).then(
      (result) => cb(null, result),
      (err) => cb(err),
    );
  }

  link(existingPath: string, newPath: string, callback: (err: Error | null) => void): void {
    this.promises.link(existingPath, newPath).then(
      () => callback(null),
      (err) => callback(err),
    );
  }

  open(filePath: string, flags: string | number, callback: (err: Error | null, fd?: number) => void): void;
  open(filePath: string, flags: string | number, mode: number, callback: (err: Error | null, fd?: number) => void): void;
  open(filePath: string, flags: string | number, modeOrCallback?: any, callback?: any): void {
    const cb = typeof modeOrCallback === 'function' ? modeOrCallback : callback;
    const mode = typeof modeOrCallback === 'function' ? undefined : modeOrCallback;
    this.promises.open(filePath, flags, mode).then(
      (handle) => cb(null, handle.fd),
      (err) => cb(err),
    );
  }

  mkdtemp(prefix: string, callback: (err: Error | null, folder?: string) => void): void {
    this.promises.mkdtemp(prefix).then(
      (result) => callback(null, result),
      (err) => callback(err),
    );
  }

  cp(src: string, dest: string, callback: (err: Error | null) => void): void;
  cp(src: string, dest: string, options: CpOptions, callback: (err: Error | null) => void): void;
  cp(src: string, dest: string, optionsOrCallback?: any, callback?: any): void | Promise<void> {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    if (cb) {
      this._cpAsync(src, dest, opts).then(
        () => cb(null),
        (err) => cb(err),
      );
      return;
    }
    // No callback — return promise for backward compat
    return this._cpAsync(src, dest, opts);
  }

  exists(filePath: string, callback: (exists: boolean) => void): void {
    this.promises.exists(filePath).then(
      (result) => callback(result),
      () => callback(false),
    );
  }
}

// ========== Promises API ==========

class VFSPromises {
  private _async: AsyncRequestFn;
  private _ns: string;

  constructor(asyncRequest: AsyncRequestFn, ns: string) {
    this._async = asyncRequest;
    this._ns = ns;
  }

  readFile(filePath: PathLike, options?: ReadOptions | Encoding | null) {
    return _readFile(this._async, toPathString(filePath), options);
  }

  writeFile(filePath: PathLike, data: string | Uint8Array, options?: WriteOptions | Encoding) {
    return _writeFile(this._async, toPathString(filePath), data, options);
  }

  appendFile(filePath: PathLike, data: string | Uint8Array, options?: WriteOptions | Encoding) {
    return _appendFile(this._async, toPathString(filePath), data, options);
  }

  mkdir(filePath: PathLike, options?: MkdirOptions | number) {
    return _mkdir(this._async, toPathString(filePath), options);
  }

  rmdir(filePath: PathLike, options?: RmdirOptions) {
    return _rmdir(this._async, toPathString(filePath), options);
  }

  rm(filePath: PathLike, options?: RmOptions) {
    return _rm(this._async, toPathString(filePath), options);
  }

  unlink(filePath: PathLike) {
    return _unlink(this._async, toPathString(filePath));
  }

  readdir(filePath: PathLike, options?: ReaddirOptions | Encoding | null) {
    return _readdir(this._async, toPathString(filePath), options);
  }

  glob(pattern: string, options?: GlobOptions): Promise<string[]> {
    return _glob(this._async, pattern, options);
  }

  stat(filePath: PathLike, options?: StatOptions) {
    return _stat(this._async, toPathString(filePath), options);
  }

  lstat(filePath: PathLike, options?: StatOptions) {
    return _lstat(this._async, toPathString(filePath), options);
  }

  access(filePath: PathLike, mode?: number) {
    return _access(this._async, toPathString(filePath), mode);
  }

  rename(oldPath: PathLike, newPath: PathLike) {
    return _rename(this._async, toPathString(oldPath), toPathString(newPath));
  }

  copyFile(src: PathLike, dest: PathLike, mode?: number) {
    return _copyFile(this._async, toPathString(src), toPathString(dest), mode);
  }

  async cp(src: PathLike, dest: PathLike, options?: CpOptions): Promise<void> {
    const srcPath = toPathString(src);
    const destPath = toPathString(dest);
    const force = options?.force !== false;
    const errorOnExist = options?.errorOnExist ?? false;
    const dereference = options?.dereference ?? false;
    const preserveTimestamps = options?.preserveTimestamps ?? false;

    const srcStat = dereference
      ? await this.stat(srcPath)
      : await this.lstat(srcPath);

    if (srcStat.isDirectory()) {
      if (!options?.recursive) {
        throw createError('EISDIR', 'cp', srcPath);
      }
      try {
        await this.mkdir(destPath, { recursive: true });
      } catch (e: any) {
        if (e.code !== 'EEXIST') throw e;
      }
      const entries = await this.readdir(srcPath, { withFileTypes: true }) as Dirent[];
      for (const entry of entries) {
        const srcChild = pathJoin(srcPath, entry.name);
        const destChild = pathJoin(destPath, entry.name);
        await this.cp(srcChild, destChild, options);
      }
    } else if (srcStat.isSymbolicLink() && !dereference) {
      const target = await this.readlink(srcPath) as string;
      let destExists = false;
      try { await this.lstat(destPath); destExists = true; } catch {}
      if (destExists) {
        if (errorOnExist) throw createError('EEXIST', 'cp', destPath);
        if (!force) return;
        await this.unlink(destPath);
      }
      await this.symlink(target, destPath);
    } else {
      let destExists = false;
      try { await this.lstat(destPath); destExists = true; } catch {}
      if (destExists) {
        if (errorOnExist) throw createError('EEXIST', 'cp', destPath);
        if (!force) return;
      }
      await this.copyFile(srcPath, destPath, errorOnExist ? constants.COPYFILE_EXCL : 0);
    }

    if (preserveTimestamps) {
      const st = await this.stat(srcPath);
      await this.utimes(destPath, st.atime, st.mtime);
    }
  }

  truncate(filePath: PathLike, len?: number) {
    return _truncate(this._async, toPathString(filePath), len);
  }

  realpath(filePath: PathLike) {
    return _realpath(this._async, toPathString(filePath));
  }

  exists(filePath: PathLike) {
    return _exists(this._async, toPathString(filePath));
  }

  chmod(filePath: PathLike, mode: number) {
    return _chmod(this._async, toPathString(filePath), mode);
  }

  /** Like chmod but operates on the symlink itself. In this VFS, delegates to chmod. */
  lchmod(filePath: string, mode: number) {
    return _chmod(this._async, filePath, mode);
  }

  /** chmod on an open file descriptor. No-op in this VFS (permissions are cosmetic). */
  async fchmod(_fd: number, _mode: number): Promise<void> {
    // No-op: fd-based permission changes are not supported in this OPFS VFS.
  }

  chown(filePath: PathLike, uid: number, gid: number) {
    return _chown(this._async, toPathString(filePath), uid, gid);
  }

  /** Like chown but operates on the symlink itself. In this VFS, delegates to chown. */
  lchown(filePath: string, uid: number, gid: number) {
    return _chown(this._async, filePath, uid, gid);
  }

  /** chown on an open file descriptor. No-op in this VFS (permissions are cosmetic). */
  async fchown(_fd: number, _uid: number, _gid: number): Promise<void> {
    // No-op: fd-based permission changes are not supported in this OPFS VFS.
  }

  utimes(filePath: PathLike, atime: Date | number, mtime: Date | number) {
    return _utimes(this._async, toPathString(filePath), atime, mtime);
  }

  /** Like utimes but operates on the symlink itself. In this VFS, delegates to utimes. */
  lutimes(filePath: string, atime: Date | number, mtime: Date | number) {
    return _utimes(this._async, filePath, atime, mtime);
  }

  symlink(target: PathLike, linkPath: PathLike, type?: string | null) {
    return _symlink(this._async, toPathString(target), toPathString(linkPath), type);
  }

  readlink(filePath: PathLike, options?: { encoding?: string | null } | string | null) {
    return _readlink(this._async, toPathString(filePath), options);
  }

  link(existingPath: PathLike, newPath: PathLike) {
    return _link(this._async, toPathString(existingPath), toPathString(newPath));
  }

  open(filePath: PathLike, flags?: string | number, mode?: number) {
    return _open(this._async, toPathString(filePath), flags, mode);
  }

  opendir(filePath: PathLike) {
    return _opendir(this._async, toPathString(filePath));
  }

  mkdtemp(prefix: string) {
    return _mkdtemp(this._async, prefix);
  }

  async openAsBlob(filePath: string, options?: OpenAsBlobOptions): Promise<Blob> {
    const data = await this.readFile(filePath);
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data as string);
    return new Blob([bytes as BlobPart], { type: options?.type ?? '' });
  }

  async statfs(path: string): Promise<StatFs> {
    return {
      type: 0x56465321,       // "VFS!"
      bsize: 4096,
      blocks: 1024 * 1024,    // ~4GB virtual capacity
      bfree: 512 * 1024,      // ~2GB free (estimate)
      bavail: 512 * 1024,
      files: 10000,            // default max inodes
      ffree: 5000,             // estimate half free
    };
  }

  async *watch(filePath: string, options?: WatchOptions): AsyncIterable<WatchEventType> {
    yield* _watchAsync(this._ns, this._async, filePath, options);
  }

  async flush(): Promise<void> {
    await this._async(OP.FSYNC, '');
  }

  async purge(): Promise<void> {
    // No-op
  }
}
