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
  Encoding, ReadOptions, WriteOptions, MkdirOptions, RmdirOptions, RmOptions,
  ReaddirOptions, Stats, Dirent, VFSConfig,
  WatchOptions, WatchFileOptions, WatchEventType, FSWatcher, WatchListener, WatchFileListener,
  ReadStreamOptions, WriteStreamOptions,
} from './types.js';
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

const encoder = new TextEncoder();

// Default SAB size: 2MB
const DEFAULT_SAB_SIZE = 2 * 1024 * 1024;
const HEADER_SIZE = SAB_OFFSETS.HEADER_SIZE;

// Atomics.wait() is disallowed on the browser main thread.
// Use spin-wait (Atomics.load loop) as fallback.
const _canAtomicsWait = typeof globalThis.WorkerGlobalScope !== 'undefined';

function spinWait(arr: Int32Array, index: number, value: number): void {
  if (_canAtomicsWait) {
    Atomics.wait(arr, index, value);
  } else {
    while (Atomics.load(arr, index) === value) {
      // spin
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
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private isReady = false;

  // Config
  private config: Omit<Required<VFSConfig>, 'opfsSyncRoot' | 'swScope'> & { opfsSyncRoot?: string; swScope?: string };
  private tabId: string;
  /** Namespace string derived from root — used for lock names, BroadcastChannel, and SW scope
   *  so multiple VFS instances with different roots don't collide. */
  private ns: string;

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
  readonly promises: VFSPromises;

  constructor(config: VFSConfig = {}) {
    this.config = {
      root: config.root ?? '/',
      opfsSync: config.opfsSync ?? true,
      opfsSyncRoot: config.opfsSyncRoot,
      uid: config.uid ?? 0,
      gid: config.gid ?? 0,
      umask: config.umask ?? 0o022,
      strictPermissions: config.strictPermissions ?? false,
      sabSize: config.sabSize ?? DEFAULT_SAB_SIZE,
      debug: config.debug ?? false,
      swScope: config.swScope,
    };

    this.tabId = crypto.randomUUID();
    this.ns = `vfs-${this.config.root.replace(/[^a-zA-Z0-9]/g, '_')}`;
    this.readyPromise = new Promise(resolve => { this.resolveReady = resolve; });
    this.promises = new VFSPromises(this._async);

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
        this.resolveReady();
        if (!this.isFollower) {
          this.initLeaderBroker();
        }
      } else if (msg.type === 'init-failed') {
        if (this.holdingLeaderLock) {
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

    if (this.hasSAB) {
      // Initialize async relay with SAB (leader mode fast path)
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
        opfsSync: this.config.opfsSync,
        opfsSyncRoot: this.config.opfsSyncRoot,
        uid: this.config.uid,
        gid: this.config.gid,
        umask: this.config.umask,
        strictPermissions: this.config.strictPermissions,
        debug: this.config.debug,
      },
    });
  }

  /** Start as leader — tell sync-relay to init VFS engine + OPFS handle */
  private startAsLeader(): void {
    this.isFollower = false;
    this.sendLeaderInit();
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
      const swUrl = new URL('./workers/service.worker.js', import.meta.url);
      const scope = this.config.swScope ?? new URL(`./${this.ns}/`, swUrl).href;
      this.swReg = await navigator.serviceWorker.register(swUrl.href, { type: 'module', scope });
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
    this.readyPromise = new Promise(resolve => { this.resolveReady = resolve; });

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
        // OPFS handle not yet released by dead leader — retry
        console.warn('[VFS] Promotion: OPFS handle still busy, retrying...');
        setTimeout(() => this.sendLeaderInit(), 500);
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
    this.sendLeaderInit();
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
    if (!this.hasSAB) {
      throw new Error('Sync API requires crossOriginIsolated (COOP/COEP headers). Use the promises API instead.');
    }
    // Check if ready signal is set
    if (Atomics.load(this.readySignal, 0) === 1) {
      this.isReady = true;
      return;
    }
    // Block until ready
    spinWait(this.readySignal, 0, 0);
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

  readFileSync(filePath: string, options?: ReadOptions | Encoding | null): string | Uint8Array {
    return _readFileSync(this._sync, filePath, options);
  }

  writeFileSync(filePath: string, data: string | Uint8Array, options?: WriteOptions | Encoding): void {
    _writeFileSync(this._sync, filePath, data, options);
  }

  appendFileSync(filePath: string, data: string | Uint8Array, options?: WriteOptions | Encoding): void {
    _appendFileSync(this._sync, filePath, data, options);
  }

  existsSync(filePath: string): boolean {
    return _existsSync(this._sync, filePath);
  }

  mkdirSync(filePath: string, options?: MkdirOptions | number): string | undefined {
    return _mkdirSync(this._sync, filePath, options);
  }

  rmdirSync(filePath: string, options?: RmdirOptions): void {
    _rmdirSync(this._sync, filePath, options);
  }

  rmSync(filePath: string, options?: RmOptions): void {
    _rmSync(this._sync, filePath, options);
  }

  unlinkSync(filePath: string): void {
    _unlinkSync(this._sync, filePath);
  }

  readdirSync(filePath: string, options?: ReaddirOptions | Encoding | null): string[] | Dirent[] {
    return _readdirSync(this._sync, filePath, options);
  }

  statSync(filePath: string): Stats {
    return _statSync(this._sync, filePath);
  }

  lstatSync(filePath: string): Stats {
    return _lstatSync(this._sync, filePath);
  }

  renameSync(oldPath: string, newPath: string): void {
    _renameSync(this._sync, oldPath, newPath);
  }

  copyFileSync(src: string, dest: string, mode?: number): void {
    _copyFileSync(this._sync, src, dest, mode);
  }

  truncateSync(filePath: string, len?: number): void {
    _truncateSync(this._sync, filePath, len);
  }

  accessSync(filePath: string, mode?: number): void {
    _accessSync(this._sync, filePath, mode);
  }

  realpathSync(filePath: string): string {
    return _realpathSync(this._sync, filePath);
  }

  chmodSync(filePath: string, mode: number): void {
    _chmodSync(this._sync, filePath, mode);
  }

  chownSync(filePath: string, uid: number, gid: number): void {
    _chownSync(this._sync, filePath, uid, gid);
  }

  utimesSync(filePath: string, atime: Date | number, mtime: Date | number): void {
    _utimesSync(this._sync, filePath, atime, mtime);
  }

  symlinkSync(target: string, linkPath: string): void {
    _symlinkSync(this._sync, target, linkPath);
  }

  readlinkSync(filePath: string): string {
    return _readlinkSync(this._sync, filePath);
  }

  linkSync(existingPath: string, newPath: string): void {
    _linkSync(this._sync, existingPath, newPath);
  }

  mkdtempSync(prefix: string): string {
    return _mkdtempSync(this._sync, prefix);
  }

  // ---- File descriptor sync methods ----

  openSync(filePath: string, flags: string | number = 'r', mode?: number): number {
    return _openSync(this._sync, filePath, flags, mode);
  }

  closeSync(fd: number): void {
    _closeSync(this._sync, fd);
  }

  readSync(fd: number, buffer: Uint8Array, offset = 0, length = buffer.byteLength, position: number | null = null): number {
    return _readSync(this._sync, fd, buffer, offset, length, position);
  }

  writeSync(fd: number, buffer: Uint8Array, offset = 0, length = buffer.byteLength, position: number | null = null): number {
    return _writeSyncFd(this._sync, fd, buffer, offset, length, position);
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

  // ---- Watch methods ----

  watch(filePath: string, options?: WatchOptions | Encoding, listener?: WatchListener): FSWatcher {
    return _watch(filePath, options, listener);
  }

  watchFile(filePath: string, optionsOrListener?: WatchFileOptions | WatchFileListener, listener?: WatchFileListener): void {
    _watchFile(this._sync, filePath, optionsOrListener, listener);
  }

  unwatchFile(filePath: string, listener?: WatchFileListener): void {
    _unwatchFile(filePath, listener);
  }

  // ---- Stream methods ----

  createReadStream(filePath: string, options?: ReadStreamOptions | string): ReadableStream<Uint8Array> {
    const opts = typeof options === 'string' ? { encoding: options as Encoding } : options;
    const start = opts?.start ?? 0;
    const end = opts?.end;
    const highWaterMark = opts?.highWaterMark ?? 64 * 1024;

    let position = start;

    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        try {
          const readLen = end !== undefined
            ? Math.min(highWaterMark, end - position + 1)
            : highWaterMark;

          if (readLen <= 0) {
            controller.close();
            return;
          }

          const result = await this.promises.readFile(filePath);
          const data = result instanceof Uint8Array ? result : encoder.encode(result);
          const chunk = data.subarray(position, position + readLen);

          if (chunk.byteLength === 0) {
            controller.close();
            return;
          }

          controller.enqueue(chunk);
          position += chunk.byteLength;

          if (end !== undefined && position > end) {
            controller.close();
          }
        } catch (err) {
          controller.error(err);
        }
      },
    });
  }

  createWriteStream(filePath: string, options?: WriteStreamOptions | string): WritableStream<Uint8Array> {
    const opts = typeof options === 'string' ? { encoding: options as Encoding } : options;
    let position = opts?.start ?? 0;
    let initialized = false;

    return new WritableStream<Uint8Array>({
      write: async (chunk) => {
        if (!initialized) {
          // Truncate file on first write (unless appending)
          if (opts?.flags !== 'a' && opts?.flags !== 'a+') {
            await this.promises.writeFile(filePath, new Uint8Array(0));
          }
          initialized = true;
        }
        await this.promises.appendFile(filePath, chunk);
        position += chunk.byteLength;
      },
      close: async () => {
        if (opts?.flush) {
          await this.promises.flush();
        }
      },
    });
  }

  // ---- Utility methods ----

  flushSync(): void {
    const buf = encodeRequest(OP.FSYNC, '');
    this.syncRequest(buf);
  }

  purgeSync(): void {
    // No-op — VFS doesn't have external caches to purge
  }

  /** Async init helper — avoid blocking main thread */
  init(): Promise<void> {
    return this.readyPromise;
  }
}

// ========== Promises API ==========

class VFSPromises {
  private _async: AsyncRequestFn;

  constructor(asyncRequest: AsyncRequestFn) {
    this._async = asyncRequest;
  }

  readFile(filePath: string, options?: ReadOptions | Encoding | null) {
    return _readFile(this._async, filePath, options);
  }

  writeFile(filePath: string, data: string | Uint8Array, options?: WriteOptions | Encoding) {
    return _writeFile(this._async, filePath, data, options);
  }

  appendFile(filePath: string, data: string | Uint8Array, options?: WriteOptions | Encoding) {
    return _appendFile(this._async, filePath, data, options);
  }

  mkdir(filePath: string, options?: MkdirOptions | number) {
    return _mkdir(this._async, filePath, options);
  }

  rmdir(filePath: string, options?: RmdirOptions) {
    return _rmdir(this._async, filePath, options);
  }

  rm(filePath: string, options?: RmOptions) {
    return _rm(this._async, filePath, options);
  }

  unlink(filePath: string) {
    return _unlink(this._async, filePath);
  }

  readdir(filePath: string, options?: ReaddirOptions | Encoding | null) {
    return _readdir(this._async, filePath, options);
  }

  stat(filePath: string) {
    return _stat(this._async, filePath);
  }

  lstat(filePath: string) {
    return _lstat(this._async, filePath);
  }

  access(filePath: string, mode?: number) {
    return _access(this._async, filePath, mode);
  }

  rename(oldPath: string, newPath: string) {
    return _rename(this._async, oldPath, newPath);
  }

  copyFile(src: string, dest: string, mode?: number) {
    return _copyFile(this._async, src, dest, mode);
  }

  truncate(filePath: string, len?: number) {
    return _truncate(this._async, filePath, len);
  }

  realpath(filePath: string) {
    return _realpath(this._async, filePath);
  }

  exists(filePath: string) {
    return _exists(this._async, filePath);
  }

  chmod(filePath: string, mode: number) {
    return _chmod(this._async, filePath, mode);
  }

  chown(filePath: string, uid: number, gid: number) {
    return _chown(this._async, filePath, uid, gid);
  }

  utimes(filePath: string, atime: Date | number, mtime: Date | number) {
    return _utimes(this._async, filePath, atime, mtime);
  }

  symlink(target: string, linkPath: string) {
    return _symlink(this._async, target, linkPath);
  }

  readlink(filePath: string) {
    return _readlink(this._async, filePath);
  }

  link(existingPath: string, newPath: string) {
    return _link(this._async, existingPath, newPath);
  }

  open(filePath: string, flags?: string | number, mode?: number) {
    return _open(this._async, filePath, flags, mode);
  }

  opendir(filePath: string) {
    return _opendir(this._async, filePath);
  }

  mkdtemp(prefix: string) {
    return _mkdtemp(this._async, prefix);
  }

  async *watch(filePath: string, options?: WatchOptions): AsyncIterable<WatchEventType> {
    yield* _watchAsync(this._async, filePath, options);
  }

  async flush(): Promise<void> {
    await this._async(OP.FSYNC, '');
  }

  async purge(): Promise<void> {
    // No-op
  }
}
