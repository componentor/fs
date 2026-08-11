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
  ReaddirOptions, StatOptions, Stats, BigIntStats, StatFs, BigIntStatFs, StatFsOptions, Dirent, Dir, OpendirOptions, VFSConfig, FSMode, FileHandle, GlobOptions,
  WatchOptions, WatchFileOptions, WatchEventType, FSWatcher, StatWatcher, WatchListener, WatchFileListener,
  ReadStreamOptions, WriteStreamOptions, FSReadStream, FSWriteStream, OpenAsBlobOptions, PathLike, Mode,
} from './types.js';
import { NodeReadable, NodeWritable } from './node-streams.js';
import type { SyncRequestFn, AsyncRequestFn } from './methods/context.js';
import { SAB_OFFSETS, SIGNAL, OP, encodeRequest, decodeResponse } from './protocol/opcodes.js';
import { acquireFsLock, releaseFsLock } from './protocol/fs-lock.js';

// ---- Method imports ----
import { readFileSync as _readFileSync, readFile as _readFile, readFileFdSync as _readFileFdSync, readFileFd as _readFileFd } from './methods/readFile.js';
import { writeFileSync as _writeFileSync, writeFile as _writeFile, writeFileFdSync as _writeFileFdSync, writeFileFd as _writeFileFd } from './methods/writeFile.js';
import { appendFileSync as _appendFileSync, appendFile as _appendFile, appendFileFdSync as _appendFileFdSync, appendFileFd as _appendFileFd } from './methods/appendFile.js';
import { isFdArg, isFileHandle } from './methods/fd-arg.js';
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
import { chmodSync as _chmodSync, chmod as _chmod, fchmodSync as _fchmodSync, fchmod as _fchmod } from './methods/chmod.js';
import { chownSync as _chownSync, chown as _chown, fchownSync as _fchownSync, fchown as _fchown } from './methods/chown.js';
import { utimesSync as _utimesSync, utimes as _utimes, futimesSync as _futimesSync, futimes as _futimes } from './methods/utimes.js';
import { symlinkSync as _symlinkSync, readlinkSync as _readlinkSync, symlink as _symlink, readlink as _readlink } from './methods/symlink.js';
import { linkSync as _linkSync, link as _link } from './methods/link.js';
import { mkdtempSync as _mkdtempSync, mkdtemp as _mkdtemp } from './methods/mkdtemp.js';
import { statfsSync as _statfsSync, statfs as _statfs } from './methods/statfs.js';
import {
  openSync as _openSync, closeSync as _closeSync,
  readSync as _readSync, writeSyncFd as _writeSyncFd,
  fstatSync as _fstatSync, ftruncateSync as _ftruncateSync, fdatasyncSync as _fdatasyncSync,
  open as _open, createFileHandle as _createFileHandle,
} from './methods/open.js';
import { opendir as _opendir } from './methods/opendir.js';
import { Dir as VFSDir } from './dir.js';
import { readStreamFromHandle, writeStreamFromHandle } from './handle-streams.js';
import { workerFromSource, terminateWorker } from './workers/worker-blob.js';
// Bundled worker sources, embedded as text at build time so a worker never needs a URL.
import syncRelaySource from './workers/inlined/sync-relay.workertext';
import asyncRelaySource from './workers/inlined/async-relay.workertext';
import { Stats as StatsClass, BigIntStats as BigIntStatsClass, Dirent as DirentClass } from './stats-classes.js';
import { watch as _watch, watchFile as _watchFile, unwatchFile as _unwatchFile, watchAsync as _watchAsync } from './methods/watch.js';
import { globSync as _globSync, glob as _glob } from './methods/glob.js';
import { join as pathJoin, dirname as pathDirname, toPathString, toRealpathString } from './path.js';
import { createUtf8StreamClass, type Utf8StreamConstructor } from './utf8-stream.js';
import { toUnixTimestamp } from './protocol/payloads.js';
import { createError, cpEisdirNotRecursive, cpTargetExists, cpSameSource, cpIntoSubdirectory, statusToError as _statusToError } from './errors.js';
import { decodeStats as _decodeStats, decodeStatsBigInt as _decodeStatsBigInt } from './stats.js';
import { constants } from './constants.js';

const encoder = new TextEncoder();

// Default SAB size: 2MB
const DEFAULT_SAB_SIZE = 2 * 1024 * 1024;

// Singleton registry: one VFSFileSystem per root per thread.
// Prevents duplicate workers, leader lock contention, and SW registration conflicts.
const instanceRegistry = new Map<string, VFSFileSystem>();
const HEADER_SIZE = SAB_OFFSETS.HEADER_SIZE;

// Atomics.wait() is disallowed on the browser main thread, so the main thread
// falls back to a spin-wait (Atomics.load loop). A spin-wait blocks the event
// loop, so we must bail out if the relay worker servicing us has died — but we
// must *not* bail merely because an op is slow. A single sync rename/copy can
// legitimately stay busy for tens of seconds during e.g. `git add .` over a
// freshly-installed node_modules; aborting it mid-flight is worse than waiting.
//
// So: liveness, not wall-clock. The relay worker bumps a heartbeat counter in
// the control SAB (SAB_OFFSETS.HEARTBEAT) ~once a second whenever its event
// loop is alive — including while it's parked on an `await` inside a long op.
// The main thread watches that counter: while it keeps advancing we keep
// waiting; if it stalls for SPIN_STALL_TIMEOUT_MS the worker is wedged/dead and
// we throw. There is deliberately no upper bound on a *progressing* op.
const _canAtomicsWait = typeof globalThis.WorkerGlobalScope !== 'undefined';

// Int32 index of the heartbeat slot in a control SAB viewed as Int32Array.
const SAB_HEARTBEAT_INDEX = SAB_OFFSETS.HEARTBEAT >> 2;

// How long the heartbeat may stall before we declare the worker unresponsive.
// Must comfortably exceed the worker's heartbeat interval (~1s) plus the
// longest Atomics.wait the relay loop can sit in uninterruptibly (~5s, and
// potentially a couple back-to-back). It must ALSO exceed WebKit's internal
// ~20s storage-IPC wait: an OPFS handle.truncate issued while this thread
// busy-spins can block the worker (frozen heartbeat) for a full 20s and then
// SUCCEED — aborting at 20s turns that recoverable hiccup into a spurious
// failure. Idle pre-growth (engine.maybePreGrow) makes the case rare; 30s
// makes it survivable.
const SPIN_STALL_TIMEOUT_MS = 30_000;

// Fallback timeout for spin-waits without a heartbeat channel (should not occur
// in practice — every caller passes this.ctrl as the heartbeat source — but a
// plain ceiling is safer than spinning forever if one ever doesn't).
const SPIN_NO_HEARTBEAT_TIMEOUT_MS = 30_000;

/**
 * Absolute cap on a main-thread spin in `opfs` mode.
 *
 * Every operation in that mode is async underneath, and `Atomics.wait` is illegal on a page's
 * main thread, so a sync call busy-spins. On Chromium the relay worker progresses anyway and
 * ops finish in milliseconds; on Firefox and WebKit the spinning page starves the worker's OPFS
 * continuations and the response never arrives. The heartbeat check cannot catch that — the
 * worker's timer keeps firing, so it looks alive — and the page spins until the browser kills
 * the tab. Ten seconds is far beyond any healthy op here and turns a dead tab into an error
 * that says what to do.
 */
const OPFS_MAIN_THREAD_SPIN_TIMEOUT_MS = 10_000;

const OPFS_SYNC_STALL_MESSAGE =
  'VFS sync operation stalled in opfs mode. Sync calls from a page main thread are only ' +
  'reliable on Chromium here: every operation is async underneath, and the spin-wait this ' +
  'thread must use (Atomics.wait is illegal on the main thread) starves the relay worker on ' +
  'Firefox and WebKit. Use fs.promises.* instead, or host the filesystem inside a Worker, ' +
  'where the sync API works on every engine.';

/**
 * Block the calling thread until `arr[index]` changes away from `value`.
 *
 * In a worker: plain Atomics.wait. On the main thread: spin-wait, aborting if
 * `heartbeatArr` (whose [SAB_HEARTBEAT_INDEX] slot the relay worker increments
 * while alive) stalls for SPIN_STALL_TIMEOUT_MS — i.e. abort on a dead worker,
 * not on a slow one. Without `heartbeatArr`, falls back to a plain ceiling.
 */
function spinWait(
  arr: Int32Array,
  index: number,
  value: number,
  heartbeatArr?: Int32Array,
  absoluteDeadlineMs?: number,
  deadlineMessage?: string,
): void {
  if (_canAtomicsWait) {
    Atomics.wait(arr, index, value);
    return;
  }
  // An absolute cap on top of the heartbeat check, for the case where the worker is provably
  // alive (its heartbeat timer keeps firing) yet never answers — see the opfs-mode note at the
  // call site. Without it the page spins until the browser kills the tab.
  const deadlineAt = absoluteDeadlineMs !== undefined ? performance.now() + absoluteDeadlineMs : Infinity;
  const checkDeadline = (): void => {
    if (performance.now() > deadlineAt) {
      throw new Error(deadlineMessage ?? `VFS sync operation timed out after ${absoluteDeadlineMs}ms`);
    }
  };
  if (!heartbeatArr) {
    const start = performance.now();
    while (Atomics.load(arr, index) === value) {
      checkDeadline();
      if (performance.now() - start > SPIN_NO_HEARTBEAT_TIMEOUT_MS) {
        throw new Error(
          `VFS sync operation timed out after ${SPIN_NO_HEARTBEAT_TIMEOUT_MS / 1000}s — relay worker did not respond`
        );
      }
    }
    return;
  }
  let lastBeat = Atomics.load(heartbeatArr, SAB_HEARTBEAT_INDEX);
  let lastProgress = performance.now();
  while (Atomics.load(arr, index) === value) {
    checkDeadline();
    const beat = Atomics.load(heartbeatArr, SAB_HEARTBEAT_INDEX);
    if (beat !== lastBeat) {
      lastBeat = beat;
      lastProgress = performance.now();
    } else if (performance.now() - lastProgress > SPIN_STALL_TIMEOUT_MS) {
      throw new Error(
        `VFS sync operation aborted: relay worker heartbeat stalled for ${SPIN_STALL_TIMEOUT_MS / 1000}s — worker is unresponsive`
      );
    }
  }
}

/**
 * Reject a copy whose destination is the source, or lives inside it.
 *
 * The subtree case is the dangerous one: a recursive copy into its own subtree recreates the
 * destination inside itself on every pass and never terminates — an unbounded loop that hangs
 * the tab and fills storage. Node rejects both with ERR_FS_CP_EINVAL before copying anything.
 * Applied once per public `cp` entry point, never inside the recursion, whose destinations are
 * legitimately inside the destination tree.
 */
function assertCopyable(srcPath: string, destPath: string): void {
  if (srcPath === destPath) throw cpSameSource(srcPath);
  // Compare with a trailing separator so '/xy' is not treated as inside '/x'.
  const srcPrefix = srcPath.endsWith('/') ? srcPath : srcPath + '/';
  if (destPath.startsWith(srcPrefix)) throw cpIntoSubdirectory(srcPath, destPath);
}

/**
 * The bytes behind `openAsBlob`, with node's error for a file it could not open.
 *
 * Node does not surface the errno here. Its `createBlobFromFilePath` reports any failure to open
 * as `TypeError: Unable to open file as blob` with `code: 'ERR_INVALID_ARG_VALUE'`, so a caller
 * checking for `ENOENT` would never match — matching node means giving up the better error.
 *
 * The one thing not copied is *when*: node throws this synchronously, out of a function that
 * otherwise returns a promise, so `fs.openAsBlob(missing).catch(…)` crashes rather than being
 * caught. This rejects instead, which is the same for `await` and for `.catch()`, and is the
 * same call made on `readFile(fd)`'s deferred error — see the readme's "Known divergences".
 */
async function _readFileAsBlobBytes(read: Promise<Uint8Array | string>): Promise<Uint8Array> {
  let data: Uint8Array | string;
  try {
    data = await read;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ENOENT' || code === 'EACCES' || code === 'ENOTDIR' || code === 'ELOOP') {
      throw Object.assign(new TypeError('Unable to open file as blob'), { code: 'ERR_INVALID_ARG_VALUE' });
    }
    throw err;
  }
  return data instanceof Uint8Array ? data : new TextEncoder().encode(data);
}

/**
 * Every instance that has not been disposed.
 *
 * Exists so a host can release them all at once — see {@link disposeAll}. Kept as a plain module
 * Set rather than a WeakSet because the point is to be able to *enumerate* them.
 */
const LIVE_KEY = '__componentorFsLiveInstances';
/**
 * Shared across every copy of this module on the origin.
 *
 * More than one copy legitimately coexists — a bundled build alongside a CDN one, or the library
 * loaded from two different URLs in the same page — and each copy would otherwise keep its own
 * registry, so {@link disposeAll} would release only the instances it happened to create. The
 * resources at stake (OPFS handles, and the observer that makes Chromium abort if it outlives
 * its page) are per-origin, not per-module.
 */
const liveInstances: Set<VFSFileSystem> =
  ((globalThis as Record<string, unknown>)[LIVE_KEY] as Set<VFSFileSystem>) ??
  ((globalThis as Record<string, unknown>)[LIVE_KEY] = new Set<VFSFileSystem>());

/**
 * Dispose every live filesystem instance.
 *
 * The reason this is worth an export: each instance owns an OPFS mirror worker holding a
 * recursive `FileSystemObserver`, and an observer still attached when its page is torn down
 * makes Chromium abort the **browser process** (`FATAL: Detected dangling raw_ptr`). `pagehide`
 * is too late to detach reliably — it can post the message but not wait for it — so anything
 * that controls the page lifecycle (a test harness, an app tearing down a route) should call
 * this and await it while the page is still running.
 */
export async function disposeAll(): Promise<void> {
  await Promise.all([...liveInstances].map((fs) => fs.dispose().catch(() => {})));
}

export class VFSFileSystem {
  /**
   * `fs.constants` — the flag/mode constants (`F_OK`, `O_CREAT`, `COPYFILE_EXCL`, …).
   *
   * This existed on `fs.promises.constants` but not on the instance, so the single most common
   * form — `fs.access(p, fs.constants.F_OK)` — read a property of `undefined`.
   */
  get constants() { return constants; }

  // The classes behind `stat`, `readdir({ withFileTypes: true })` and `opendir` results, exposed
  // as node exposes them so `x instanceof fs.Stats` / `fs.Dirent` / `fs.Dir` type-tests work.
  get Stats() { return StatsClass; }
  get Dirent() { return DirentClass; }
  get Dir() { return VFSDir; }

  /**
   * `fs.Utf8Stream` — node 24's buffered append stream, the engine behind fast logging.
   *
   * Built per instance rather than exported as a module constant, because it writes through
   * *this* filesystem; node's can be a free class because there is only one real one. Cached so
   * `fs.Utf8Stream === fs.Utf8Stream` and `instanceof` behaves.
   */
  get Utf8Stream(): Utf8StreamConstructor {
    return (this._utf8StreamClass ??= createUtf8StreamClass({
      openSync: (p, flags, mode) => this.openSync(p, flags, mode),
      writeSync: (fd, data) => this.writeSync(fd, data),
      closeSync: (fd) => this.closeSync(fd),
      fsyncSync: (fd) => this.fsyncSync(fd),
      mkdirSync: (p, o) => { this.mkdirSync(p, o); },
      dirname: pathDirname,
    }));
  }
  /**
   * TypeScript-private rather than a `#` field on purpose: the test harness builds an instance
   * with `Object.create(VFSFileSystem.prototype)` and never runs the constructor, and a real
   * private field would not exist on such an object — reading it throws rather than returning
   * `undefined`.
   */
  private _utf8StreamClass?: Utf8StreamConstructor;

  /**
   * Node's internal time coercion, exposed under the same underscored name node uses.
   *
   * Reduces a `Date`, a number of seconds, or a numeric string to seconds since the epoch. A
   * negative number means *now*, which is the part that surprises people — see
   * {@link toUnixTimestamp}.
   */
  _toUnixTimestamp(time: Date | number | string, name = 'time'): number {
    return toUnixTimestamp(time, name);
  }
  /**
   * Not on node's `fs` — node keeps `BigIntStats` internal — but `stat({ bigint: true })` returns
   * one, and there was no way to `instanceof` the result. Exposed for symmetry with `Stats`.
   */
  get BigIntStats() { return BigIntStatsClass; }

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
  /** Set by {@link dispose}; makes disposal idempotent. */
  private closed = false;
  /** The `pagehide` handler, kept so {@link dispose} can unregister it. */
  private onPageHide: ((event: Event) => void) | null = null;
  /**
   * Watches real OPFS for changes made outside this library.
   *
   * Lives here, in the scope that owns the instance, rather than inside the mirror worker — the
   * whole point is that `disconnect()` is reachable **synchronously** from the unload path. A
   * recursive observer still attached when its page is torn down makes Chromium abort the entire
   * browser process, and an observer inside a nested worker cannot be detached in time: the page
   * can post a shutdown at `pagehide` but cannot wait for it.
   *
   * Only the detected records cross into the worker; the file I/O stays there.
   */
  private externalObserver: FileSystemObserver | null = null;
  /** True while a leader transition is in flight (promotion to leader, etc.).
   *  Cleared the moment the new sync-relay signals `ready`. Consumers can
   *  combine this with `isReady` to know when sync FS ops are safe again. */
  private transitioning = false;
  /** Listeners awaiting the next `ready` signal (used by `whenReady()`). */
  private readyListeners = new Set<() => void>();


  // Config (definite assignment — always set when constructor doesn't return singleton)
  private config!: Omit<Required<VFSConfig>, 'opfsSyncRoot' | 'swUrl' | 'swScope' | 'mode' | 'limits' | 'swBridge' | 'forceSpin'> & { opfsSyncRoot?: string; swUrl?: string; swScope?: string; swBridge?: MessagePort; limits?: VFSConfig['limits']; forceSpin?: boolean };
  private tabId!: string;
  private _mode!: FSMode;
  private corruptionError: Error | null = null;
  /** Namespace string derived from root — used for lock names, BroadcastChannel, and SW scope
   *  so multiple VFS instances with different roots don't collide. */
  private ns!: string;

  // Service worker registration for multi-tab port transfer
  private swReg: ServiceWorkerRegistration | null = null;
  private isFollower = false;
  /** Callbacks for {@link onLeaderChange}. */
  private leaderListeners = new Set<(isLeader: boolean) => void>();
  private holdingLeaderLock = false;
  /** Resolving this releases the leader lock — see {@link acquireLeaderLock}. */
  private releaseLeaderLock: (() => void) | null = null;
  /** Cancels a queued bid for promotion, so a disposed follower cannot later be elected. */
  private leaderLockBid: AbortController | null = null;
  private brokerInitialized = false;
  private brokerHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /** Backoff for reopening a volume whose previous holder has not let go yet. */
  private volumeRetryDelayMs = 0;
  /** The service worker this instance registered its broker with, so it can deregister. */
  private brokerSw: { postMessage(message: unknown, transfer?: Transferable[]): void } | null = null;
  private brokerControlPort: MessagePort | null = null;
  private leaderChangeBc: BroadcastChannel | null = null;

  // Bound request functions for method delegation
  private _sync: SyncRequestFn = (buf) => this.syncRequest(buf);

  /**
   * Spin cap for the current mode: bounded in `opfs` mode, unbounded otherwise.
   *
   * `undefined` keeps hybrid/vfs behaviour exactly as it was — those service sync requests
   * synchronously in the relay, so a long spin there means a genuinely slow op, not a stall.
   */
  private _opfsSpinCap(): number | undefined {
    return this._mode === 'opfs' ? OPFS_MAIN_THREAD_SPIN_TIMEOUT_MS : undefined;
  }
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
      forceSpin: config.forceSpin,
      swUrl: config.swUrl,
      swScope: config.swScope,
      swBridge: config.swBridge,
      limits: config.limits,
    };

    this.tabId = crypto.randomUUID();
    this.ns = ns;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.promises = new VFSPromises(this._async, ns);

    // Attach .native aliases (Node.js compat: fs.realpath.native, fs.realpathSync.native)
    // We create bound own-property functions so .native can be set on them.
    const boundRealpath = this.realpath.bind(this);
    (boundRealpath as any).native = boundRealpath;
    (this as any).realpath = boundRealpath;

    const boundRealpathSync = this.realpathSync.bind(this);
    (boundRealpathSync as any).native = boundRealpathSync;
    (this as any).realpathSync = boundRealpathSync;

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
    liveInstances.add(this);
    this.installUnloadTeardown();
    void this.watchExternalChanges();

    // Handle messages from sync-relay
    this.syncWorker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      // The relay's port to the leader went unanswered. `leader-changed` is announced once, so a
      // follower that arrived after the announcement has no other way to find the current leader.
      if (msg.type === 'need-leader') {
        if (this.isFollower && !this.closed) this.connectToLeader();
        return;
      }
      if (msg.type === 'ready') {
        this.isReady = true;
        this.transitioning = false;
        // Opened — so a later volume handoff starts from the fast retry again.
        this.volumeRetryDelayMs = 0;
        // Initialize async-relay AFTER sync-relay is ready to avoid
        // requests arriving before the leader loop is running.
        this.initAsyncRelay();
        this.resolveReady();
        this.fireReadyListeners();
        if (!this.isFollower) {
          this.initLeaderBroker();
        }
      } else if (msg.type === 'init-failed') {
        if (msg.error?.startsWith('Corrupt VFS:')) {
          this.handleCorruptVFS(msg.error);
        } else if (this.holdingLeaderLock) {
          // We hold the lock but the OPFS handle has not been released yet — retry.
          //
          // Backed off from a flat 500ms, because that interval is the whole cost when the
          // handle is released a moment after the first attempt: the boot waits out the rest
          // of the tick for nothing. A departing leader now hands the volume back explicitly
          // (see installUnloadTeardown), so the common case is "free within a few ms" — but a
          // tab that was killed, crashed, or force-quit never got to say anything, and only
          // the browser's own reclaim ends that wait. Start fast for the first case, and grow
          // to the old interval so the second cannot spin.
          this.volumeRetryDelayMs = Math.min((this.volumeRetryDelayMs || 0) * 2 || 25, 500);
          setTimeout(() => this.sendLeaderInit(), this.volumeRetryDelayMs);
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
        // Held until the tab closes *or* the instance is disposed. It used to be
        // `new Promise(() => {})` — never resolved — so a disposed leader kept the lock for the
        // life of the page. The next instance on the same volume then started as a follower of a
        // leader whose workers were already terminated, and its first synchronous call spun until
        // the 30s stall guard. Creating and disposing instances in a loop is exactly what
        // `dispose` is documented for, so the lock has to come back.
        await new Promise<void>((resolve) => { this.releaseLeaderLock = resolve; });
      } else {
        this.startAsFollower();
        this.waitForLeaderLock();
      }
    });
  }

  /** Queue for leader takeover when the current leader's lock is released */
  private waitForLeaderLock(): void {
    if (!('locks' in navigator)) return;
    // Abortable: without it a disposed follower stays queued and gets promoted once the current
    // leader goes away, taking ownership of a volume it can no longer serve.
    const bid = new AbortController();
    this.leaderLockBid = bid;
    navigator.locks.request(`${this.ns}-leader`, { signal: bid.signal }, async () => {
      this.leaderLockBid = null;
      if (this.closed) return;
      this.holdingLeaderLock = true;
      this.promoteToLeader();
      await new Promise<void>((resolve) => { this.releaseLeaderLock = resolve; });
    }).catch(() => { /* aborted on dispose, or the page is going away */ });
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
        forceSpin: this.config.forceSpin,
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
    this.announceRole();
    if (this._mode === 'opfs') {
      this.sendOPFSInit();
    } else {
      this.sendLeaderInit();
    }
  }

  /** Start as follower — connect to leader via service worker port brokering */
  private startAsFollower(): void {
    this.isFollower = true;
    this.announceRole();

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

  /** Register the VFS service worker and return something that can post
   *  messages to it. When running inside a worker (`swBridge` provided),
   *  returns a proxy that forwards postMessages — including transferred
   *  ports — to a main-thread bridge that owns the real `navigator.serviceWorker`. */
  private async getServiceWorker(): Promise<{ postMessage(message: unknown, transfer?: Transferable[]): void }> {
    if (this.config.swBridge) {
      const bridge = this.config.swBridge;
      return {
        postMessage: (message: unknown, transfer?: Transferable[]) =>
          bridge.postMessage(message, (transfer ?? []) as Transferable[]),
      };
    }
    if (!this.swReg) {
      // Resolved against the **document**, not the origin. Against the origin, a relative
      // `swUrl` silently jumped to the site root — so an app served from a subpath
      // (`/fs/` on GitHub project pages, `/app/` behind a proxy) asked for a script that was
      // never there and got a 404 at registration. An absolute `/path.js` still means exactly
      // what it says; only the relative form changes, and only to what it should always have
      // meant.
      // `document` does not exist in a worker. A worker-hosted instance normally returns above
      // via `swBridge`, but one configured with `swUrl` and no bridge would otherwise throw a
      // ReferenceError instead of failing on the registration it cannot do anyway.
      const base = typeof document !== 'undefined' ? document.baseURI : location.href;
      const swUrl = this.config.swUrl
        ? new URL(this.config.swUrl, base)
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

  /** Register as leader with SW broker (receives follower ports via control channel).
   *
   *  Re-registers on a heartbeat so the broker survives SW idle-kill. Without this,
   *  a follower opening a tab after the SW has been killed (≥30s idle on Chrome)
   *  sees its `transfer-port` queued in the new SW's `pending` array forever:
   *  the prior leader's `port2` was held by the dead SW instance, the new SW
   *  starts with `serverPort=null`, and the leader has no way to know to
   *  re-register.
   *
   *  Re-posting `register-server` is idempotent in the SW handler — it replaces
   *  `serverPort` and flushes `pending` — so the heartbeat alone unsticks
   *  followers without needing to disturb anyone else. The follower's queued
   *  `mc.port2` rides through the pending-flush, and because it's a
   *  MessageChannel, any messages the follower's sync-relay had already posted
   *  on `port1` are buffered on `port2` until the leader's syncWorker starts
   *  the received port. Standard MessageChannel semantics — no follower-side
   *  notification required.
   *
   *  We deliberately do NOT broadcast `leader-changed` from the heartbeat:
   *  followers receiving it call `connectToLeader()`, which tears down the
   *  existing `leader-port` and resolves any in-flight sync FS request with
   *  EIO (sync-relay.worker.ts: `pendingResolve(EIO)`). Broadcasting on every
   *  tick would inject random EIOs into long-running ops on every connected
   *  follower. Broadcast only fires once, at initial registration, to wake any
   *  pre-existing followers (e.g. left over from a previous leader). */
  private initLeaderBroker(): void {
    if (this.brokerInitialized) return;
    this.brokerInitialized = true;

    const register = (): void => {
      this.getServiceWorker().then(sw => {
        this.brokerSw = sw;
        // Deliberately do NOT close the previous control port. Closing it
        // sends a disentangle signal to the SW on a separate IPC pipe from
        // the one carrying `register-server`, with no FIFO guarantee between
        // them. If the disentangle lands first, any follower `transfer-port`
        // already in the SW's inbox is dispatched against the still-current
        // `serverPort = old.port2`, which is now detached — postMessage to a
        // disentangled port is a silent no-op per spec, so the follower's
        // port disappears and the tab stays stuck.
        //
        // Leaving the old port open keeps it routable for any in-flight
        // `transfer-port` until the SW processes `register-server` and
        // overwrites `serverPort` with the new port. After that, both
        // endpoints of the old channel are unreferenced (leader replaced
        // `brokerControlPort`; SW replaced `serverPort`) and the pair is
        // GC-eligible. The onmessage listener doesn't keep port1 alive — a
        // port that can't receive messages can't fire events.
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
        this.brokerControlPort = mc.port1;
      }).catch(err => {
        console.warn('[VFS] SW broker unavailable, single-tab only:', (err as Error).message);
      });
    };

    register();

    // Notify pre-existing followers (if any) that a leader is now available.
    // Fired exactly once — see comment above for why this MUST NOT happen on
    // every heartbeat.
    const bc = new BroadcastChannel(`${this.ns}-leader-change`);
    bc.postMessage({ type: 'leader-changed' });
    bc.close();

    // 5s tick — worst-case wait for a follower opened against a dead SW broker.
    if (this.brokerHeartbeatTimer) clearInterval(this.brokerHeartbeatTimer);
    this.brokerHeartbeatTimer = setInterval(register, 5000);
  }

  /** Promote from follower to leader (after leader tab dies and lock is acquired) */
  private promoteToLeader(): void {
    this.isFollower = false;
    this.announceRole();
    this.isReady = false;
    // Mark transition first thing so concurrent `whenReady()` callers wait
    // for the new sync-relay 'ready' signal rather than seeing the stale
    // resolved readyPromise from the previous lifecycle.
    this.transitioning = true;
    this.brokerInitialized = false; // Allow re-registration with SW as new leader

    // Tear down the prior broker plumbing — initLeaderBroker will rebuild it
    // when sync-relay signals 'ready'. Without this, the old heartbeat keeps
    // running against a stale control port that no longer routes to anything.
    if (this.brokerHeartbeatTimer) {
      clearInterval(this.brokerHeartbeatTimer);
      this.brokerHeartbeatTimer = null;
    }
    if (this.brokerControlPort) {
      try { this.brokerControlPort.close(); } catch { /* ignore */ }
      this.brokerControlPort = null;
    }
    this.deregisterBroker();

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
    terminateWorker(this.syncWorker);
    terminateWorker(this.asyncWorker);

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
        this.transitioning = false;
        this.resolveReady();
        this.fireReadyListeners();
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
  /**
   * Start one of the relay workers from source embedded in this bundle.
   *
   * This used to resolve `new URL('./workers/<name>.worker.js', import.meta.url)`, which meant
   * the package could not be loaded from a CDN at all (a cross-origin `new Worker()` is a
   * `SecurityError`) and needed `optimizeDeps.exclude` under Vite, whose pre-bundling rewrites
   * that URL. See [worker-blob.ts](./workers/worker-blob.ts).
   */
  private spawnWorker(name: 'sync-relay' | 'async-relay'): Worker {
    return workerFromSource(name === 'sync-relay' ? syncRelaySource : asyncRelaySource, `vfs-${name}`);
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
    // Block until ready (heartbeat lives in the control SAB, which is allocated
    // before init starts, so it advances even while the worker is initializing).
    spinWait(this.readySignal, 0, 0, this.ctrl);
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

    // Take a turn on the shared control SAB. Uncontended (a single client driving
    // this SAB) this is a couple of atomics and never blocks; when several sync
    // clients share ONE SAB it serializes them in fair arrival order so their
    // request frames never interleave. Captured once so a leader handoff that
    // swaps `this.ctrl` mid-op can't release a different SAB than we acquired.
    const lockCtrl = this.ctrl;
    acquireFsLock(lockCtrl);
    try {
      return this.syncRequestLocked(requestBuf);
    } finally {
      releaseFsLock(lockCtrl);
    }
  }

  private syncRequestLocked(requestBuf: ArrayBuffer): { status: number; data: Uint8Array | null } {
    const t0 = this.config.debug ? performance.now() : 0;
    const maxChunk = this.sab.byteLength - HEADER_SIZE;
    const requestBytes = new Uint8Array(requestBuf);
    const totalLenView = new BigUint64Array(this.sab, SAB_OFFSETS.TOTAL_LEN, 1);

    const multiChunkRequest = requestBytes.byteLength > maxChunk;

    if (!multiChunkRequest) {
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
          spinWait(this.ctrl, 0, sent === chunkSize ? SIGNAL.REQUEST : SIGNAL.CHUNK, this.ctrl, this._opfsSpinCap(), OPFS_SYNC_STALL_MESSAGE);
        }
      }
    }

    // Wait for the worker to produce the response.
    //
    // The frame the worker must transition away from is whatever we wrote last:
    // REQUEST for a single-chunk request, or — for a multi-chunk request — the
    // final chunk's CHUNK frame, since the worker only emits a CHUNK_ACK for
    // *non-final* chunks (see readPayload in sync-relay.worker.ts; mirrors the
    // async-relay's send path). Waiting on the wrong sentinel here makes the
    // spin-wait fall through immediately and read the response area while it
    // still holds stale request bytes.
    //
    // NOTE: this assumes a multi-chunk request is never answered by a
    // multi-chunk response (the worker would set ctrl[0]=CHUNK again, an
    // invisible no-op transition). True today — a request only exceeds maxChunk
    // for WRITE/FWRITE/APPEND, whose responses are 8 bytes — but if that ever
    // changes, readPayload must be made to ack the final chunk too.
    spinWait(this.ctrl, 0, multiChunkRequest ? SIGNAL.CHUNK : SIGNAL.REQUEST, this.ctrl, this._opfsSpinCap(), OPFS_SYNC_STALL_MESSAGE);

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
        spinWait(this.ctrl, 0, SIGNAL.CHUNK_ACK, this.ctrl, this._opfsSpinCap(), OPFS_SYNC_STALL_MESSAGE);

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

  readFileSync(filePath: PathLike | number, options?: ReadOptions | Encoding | null): string | Uint8Array {
    if (isFdArg(filePath)) return _readFileFdSync(this._sync, filePath, options);
    return _readFileSync(this._sync, toPathString(filePath), options);
  }

  writeFileSync(filePath: PathLike | number, data: string | Uint8Array, options?: WriteOptions | Encoding): void {
    if (isFdArg(filePath)) return _writeFileFdSync(this._sync, filePath, data, options);
    _writeFileSync(this._sync, toPathString(filePath), data, options);
  }

  appendFileSync(filePath: PathLike | number, data: string | Uint8Array, options?: WriteOptions | Encoding): void {
    if (isFdArg(filePath)) return _appendFileFdSync(this._sync, filePath, data, options);
    _appendFileSync(this._sync, toPathString(filePath), data, options);
  }

  existsSync(filePath: PathLike): boolean {
    return _existsSync(this._sync, toPathString(filePath));
  }

  mkdirSync(filePath: PathLike, options?: MkdirOptions | Mode): string | undefined {
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

  readdirSync(filePath: PathLike, options?: ReaddirOptions | Encoding | null): string[] | Uint8Array[] | Dirent[] {
    return _readdirSync(this._sync, toPathString(filePath), options);
  }

  globSync(pattern: string | string[], options?: GlobOptions): string[] | Dirent[] {
    return _globSync(this._sync, pattern, options);
  }

  opendirSync(filePath: PathLike, options?: OpendirOptions): Dir {
    const dirPath = toPathString(filePath);
    const entries = this.readdirSync(dirPath, {
      withFileTypes: true,
      recursive: options?.recursive,
    }) as Dirent[];
    // No descriptor to release — the entries were read eagerly.
    return new VFSDir(dirPath, entries);
  }

  statSync(filePath: PathLike, options?: StatOptions & { throwIfNoEntry?: true }): Stats | BigIntStats;
  statSync(filePath: PathLike, options: StatOptions & { throwIfNoEntry: false }): Stats | BigIntStats | undefined;
  statSync(filePath: PathLike, options?: StatOptions): Stats | BigIntStats | undefined {
    return _statSync(this._sync, toPathString(filePath), options as StatOptions & { throwIfNoEntry: false });
  }

  lstatSync(filePath: PathLike, options?: StatOptions & { throwIfNoEntry?: true }): Stats | BigIntStats;
  lstatSync(filePath: PathLike, options: StatOptions & { throwIfNoEntry: false }): Stats | BigIntStats | undefined;
  lstatSync(filePath: PathLike, options?: StatOptions): Stats | BigIntStats | undefined {
    return _lstatSync(this._sync, toPathString(filePath), options as StatOptions & { throwIfNoEntry: false });
  }

  renameSync(oldPath: PathLike, newPath: PathLike): void {
    _renameSync(this._sync, toPathString(oldPath), toPathString(newPath));
  }

  copyFileSync(src: PathLike, dest: PathLike, mode?: number): void {
    _copyFileSync(this._sync, toPathString(src), toPathString(dest), mode);
  }

  /**
   * Reject a copy whose destination is the source, or lives inside it.
   *
   * The subtree case is the dangerous one: a recursive copy into its own subtree recreates the
   * destination inside itself on every pass and never terminates — an unbounded loop that hangs
   * the tab and fills storage. Node rejects both with ERR_FS_CP_EINVAL before copying anything.
   *
   * Called once per public `cp` entry point rather than inside the recursion, so the recursive
   * calls (whose dest is legitimately inside the destination tree) are unaffected.
   */
  private _assertCopyable(srcPath: string, destPath: string): void {
    assertCopyable(srcPath, destPath);
  }

  cpSync(src: PathLike, dest: PathLike, options?: CpOptions): void {
    this._assertCopyable(toPathString(src), toPathString(dest));
    this._cpSyncInner(src, dest, options);
  }

  /** The recursive worker. Its destinations are legitimately inside the destination tree. */
  private _cpSyncInner(src: PathLike, dest: PathLike, options?: CpOptions): void {
    const srcPath = toPathString(src);
    const destPath = toPathString(dest);
    // `filter` was declared nowhere and consulted nowhere, so every entry was copied.
    if (options?.filter && !options.filter(srcPath, destPath)) return;
    const force = options?.force !== false;          // default true
    const errorOnExist = options?.errorOnExist ?? false;
    const dereference = options?.dereference ?? false;
    const preserveTimestamps = options?.preserveTimestamps ?? false;

    // Always `lstat` for the branch decision: `dereference` must not decide whether a symlink is
    // *recognised* as one, or `statSync` follows it and the link is copied as a plain file.
    // Node keeps links as links under `cp -r` whether or not `dereference` is set — see
    // {@link CpOptions.dereference} for why chasing node's `dereference` further is not useful.
    void dereference;
    const srcStat = this.lstatSync(srcPath);

    if (srcStat.isDirectory()) {
      if (!options?.recursive) {
        throw cpEisdirNotRecursive(srcPath);
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
        this._cpSyncInner(srcChild, destChild, options);
      }
    } else if (srcStat.isSymbolicLink()) {
      const target = this.readlinkSync(srcPath) as string;
      let destExists = false;
      try { this.lstatSync(destPath); destExists = true; } catch {}
      if (destExists) {
        if (errorOnExist) throw cpTargetExists(destPath);
        if (!force) return;
        this.unlinkSync(destPath);
      }
      this.symlinkSync(target, destPath);
    } else {
      let destExists = false;
      try { this.lstatSync(destPath); destExists = true; } catch {}
      if (destExists) {
        if (errorOnExist) throw cpTargetExists(destPath);
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
    if (options?.filter && !options.filter(src, dest)) return;
    const force = options?.force !== false;
    const errorOnExist = options?.errorOnExist ?? false;
    const dereference = options?.dereference ?? false;
    const preserveTimestamps = options?.preserveTimestamps ?? false;

    // See the sync path: the branch decision is always on the link itself.
    void dereference;
    const srcStat = await this.promises.lstat(src);

    if (srcStat.isDirectory()) {
      if (!options?.recursive) {
        throw cpEisdirNotRecursive(src);
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
    } else if (srcStat.isSymbolicLink()) {
      const target = await this.promises.readlink(src) as string;
      let destExists = false;
      try { await this.promises.lstat(dest); destExists = true; } catch {}
      if (destExists) {
        if (errorOnExist) throw cpTargetExists(dest);
        if (!force) return;
        await this.promises.unlink(dest);
      }
      await this.promises.symlink(target, dest);
    } else {
      let destExists = false;
      try { await this.promises.lstat(dest); destExists = true; } catch {}
      if (destExists) {
        if (errorOnExist) throw cpTargetExists(dest);
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

  realpathSync(filePath: PathLike, options?: { encoding?: string | null } | string | null): string | Uint8Array {
    return _realpathSync(this._sync, toRealpathString(filePath), options);
  }

  chmodSync(filePath: PathLike, mode: Mode): void {
    _chmodSync(this._sync, toPathString(filePath), mode);
  }

  /**
   * `chmod` on the symlink itself rather than on what it points at.
   *
   * This used to delegate straight to `chmodSync`, which follows the link — so it changed the
   * **target's** permissions, the one outcome the `l` prefix exists to rule out.
   */
  lchmodSync(filePath: PathLike, mode: Mode): void {
    _chmodSync(this._sync, toPathString(filePath), mode, false);
  }

  /** chmod on an open file descriptor. Resolves the fd to its inode on the
   *  server side and mutates the inode's mode bits directly, matching what
   *  native Node's libuv does. */
  fchmodSync(fd: number, mode: Mode): void {
    _fchmodSync(this._sync, fd, mode);
  }

  chownSync(filePath: PathLike, uid: number, gid: number): void {
    _chownSync(this._sync, toPathString(filePath), uid, gid);
  }

  /** `chown` on the symlink itself rather than its target — see {@link lchmodSync}. */
  lchownSync(filePath: PathLike, uid: number, gid: number): void {
    _chownSync(this._sync, toPathString(filePath), uid, gid, false);
  }

  /** chown on an open file descriptor. Mutates the underlying inode's uid/gid. */
  fchownSync(fd: number, uid: number, gid: number): void {
    _fchownSync(this._sync, fd, uid, gid);
  }

  utimesSync(filePath: PathLike, atime: Date | number, mtime: Date | number): void {
    _utimesSync(this._sync, toPathString(filePath), atime, mtime);
  }

  /** utimes on an open file descriptor. Mutates the underlying inode's atime/mtime. */
  futimesSync(fd: number, atime: Date | number, mtime: Date | number): void {
    _futimesSync(this._sync, fd, atime, mtime);
  }

  /** Timestamps on the symlink itself rather than its target — see {@link lchmodSync}. */
  lutimesSync(filePath: PathLike, atime: Date | number, mtime: Date | number): void {
    _utimesSync(this._sync, toPathString(filePath), atime, mtime, false);
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

  mkdtempSync(prefix: PathLike, options?: { encoding?: string | null } | string | null): string | Uint8Array {
    return _mkdtempSync(this._sync, toPathString(prefix), options);
  }

  /**
   * The stream constructors, exposed as properties the way `node:fs` exposes them, so
   * `x instanceof fs.ReadStream` and `fs.FileReadStream` resolve for code written against Node.
   * `Stats`, `Dirent` and `Dir` are exposed the same way — see the getters near the top of the
   * class. They became real classes in 3.3.27; before that they were object literals and there
   * was nothing for `instanceof` to test against.
   */
  get ReadStream(): typeof NodeReadable { return NodeReadable; }
  get WriteStream(): typeof NodeWritable { return NodeWritable; }
  /** Node's legacy aliases for the same two constructors. */
  get FileReadStream(): typeof NodeReadable { return NodeReadable; }
  get FileWriteStream(): typeof NodeWritable { return NodeWritable; }

  /**
   * `mkdtempSync` whose result cleans itself up — Node 24's explicit-resource-management form.
   *
   * ```js
   * using dir = fs.mkdtempDisposableSync('/tmp/build-');
   * // dir.path is removed when the block exits, however it exits
   * ```
   * `remove()` is idempotent so an explicit call followed by the implicit `Symbol.dispose`
   * does not throw ENOENT.
   */
  mkdtempDisposableSync(prefix: string): { path: string; remove(): void; [Symbol.dispose](): void } {
    const path = _mkdtempSync(this._sync, prefix) as string;
    const remove = () => { this.rmSync(path, { recursive: true, force: true }); };
    return { path, remove, [Symbol.dispose]: remove };
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

  fstatSync(fd: number, options?: StatOptions): Stats | BigIntStats {
    return _fstatSync(this._sync, fd, options);
  }

  ftruncateSync(fd: number, len?: number): void {
    _ftruncateSync(this._sync, fd, len);
  }

  fdatasyncSync(fd: number): void {
    _fdatasyncSync(this._sync, fd);
  }

  fsyncSync(fd: number): void {
    // Same call underneath — the syscall name only shapes the error message.
    _fdatasyncSync(this._sync, fd, 'fsync');
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
    this._validateCb(cb);
    try {
      const bytesRead = this.readvSync(fd, buffers, pos);
      if (cb) setTimeout(() => cb(null, bytesRead, buffers), 0);
    } catch (err: any) {
      if (cb) setTimeout(() => cb(err), 0);
      else throw err;
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
    this._validateCb(cb);
    try {
      const bytesWritten = this.writevSync(fd, buffers, pos);
      if (cb) setTimeout(() => cb(null, bytesWritten, buffers), 0);
    } catch (err: any) {
      if (cb) setTimeout(() => cb(err), 0);
      else throw err;
    }
  }

  // ---- statfs methods ----

  /**
   * Real volume statistics, read from the VFS superblock.
   *
   * This used to return fixed constants — always ~4 GB capacity with ~2 GB free, whatever the
   * volume actually held — so code checking free space before a large write got an answer
   * unrelated to reality, and never saw a full disk coming.
   */
  statfsSync(path: PathLike = '/', options?: StatFsOptions): StatFs | BigIntStatFs {
    return _statfsSync(this._sync, toPathString(path), options);
  }

  statfs(path: string, callback: (err: Error | null, stats?: StatFs) => void): void;
  statfs(path: string): Promise<StatFs>;
  statfs(path: string = '/', callback?: (err: Error | null, stats?: StatFs) => void): Promise<StatFs> | void {
    // Route through the async transport rather than the sync one: the callback form must work
    // without crossOriginIsolated, where the sync path is unavailable.
    const promise = _statfs(this._async, path) as Promise<StatFs>;
    if (callback) {
      this._validateCb(callback);
      return this._cb(promise, callback) as void;
    }
    return promise;
  }

  // ---- Watch methods ----

  watch(filePath: PathLike, options?: WatchOptions | Encoding | WatchListener, listener?: WatchListener): FSWatcher {
    return _watch(this.ns, this._sync, toPathString(filePath), options, listener);
  }

  watchFile(filePath: PathLike, optionsOrListener?: WatchFileOptions | WatchFileListener, listener?: WatchFileListener): StatWatcher {
    return _watchFile(this.ns, this._sync, toPathString(filePath), optionsOrListener, listener);
  }

  unwatchFile(filePath: PathLike, listener?: WatchFileListener): void {
    _unwatchFile(this.ns, toPathString(filePath), listener);
  }

  // ---- openAsBlob (Node.js 19+) ----

  async openAsBlob(filePath: string, options?: OpenAsBlobOptions): Promise<Blob> {
    const data = await _readFileAsBlobBytes(this.promises.readFile(filePath));
    return new Blob([data as BlobPart], { type: options?.type ?? '' });
  }

  // ---- Stream methods ----

  createReadStream(filePath: PathLike, options?: ReadStreamOptions | string): FSReadStream {
    const opts = typeof options === 'string' ? undefined : options;
    const providedFd = opts?.fd;
    const stream = readStreamFromHandle({
      // Opened lazily on first read, as before — creating the stream must not touch the disk.
      acquire: async () => providedFd != null
        ? _createFileHandle(providedFd, this._async)
        : await this.promises.open(toPathString(filePath), opts?.flags ?? 'r'),
      // A caller-supplied fd stays the caller's to close.
      autoClose: providedFd == null && opts?.autoClose !== false,
      path: toPathString(filePath),
      // A descriptor handed in by the caller has its own position, and node reads from it; one we
      // opened ourselves is at zero, where the two are the same.
      followCursor: providedFd != null,
    }, options);
    return stream as unknown as FSReadStream;
  }

  createWriteStream(filePath: PathLike, options?: WriteStreamOptions | string): FSWriteStream {
    const opts = typeof options === 'string' ? undefined : options;
    const providedFd = opts?.fd;
    const stream = writeStreamFromHandle({
      acquire: async () => providedFd != null
        ? _createFileHandle(providedFd, this._async)
        : await this.promises.open(toPathString(filePath), opts?.flags ?? 'w'),
      autoClose: providedFd == null && opts?.autoClose !== false,
      path: toPathString(filePath),
      followCursor: providedFd != null,
    }, options);
    return stream as unknown as FSWriteStream;
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

  /** True only while the filesystem is fully ready for synchronous operations
   *  AND no leader transition is in progress. Reflects the moment-in-time state;
   *  use `whenReady()` to await readiness reliably. */
  get ready(): boolean {
    return this.isReady && !this.transitioning;
  }

  /** Resolves once the filesystem is fully ready for synchronous operations,
   *  including any in-flight leader transition (promotion-to-leader, etc.).
   *  If already ready and no transition is pending, resolves immediately.
   *
   *  Use this when coordinating with other Web-Lock-based systems (e.g. a
   *  parent app that elects its own leader independently of the FS) — the
   *  timing of the two elections isn't synchronized, so the FS may still be
   *  reinitialising when the parent's lock fires. Calling `whenReady()`
   *  after your own leader-acquisition guarantees the FS is back in a state
   *  where sync ops won't stall the 20-second relay-worker heartbeat. */
  whenReady(): Promise<void> {
    if (this.isReady && !this.transitioning) return Promise.resolve();
    if (this.transitioning) {
      // Wait for the *next* ready signal — the readyPromise may be stale
      // (resolved from the previous lifecycle and not yet reset).
      return new Promise<void>((resolve) => {
        this.readyListeners.add(resolve);
      });
    }
    // Not yet ready, no transition recorded — wait on the current promise.
    return this.readyPromise.then(() => {});
  }

  /** Internal — called by lifecycle handlers when sync-relay says 'ready'. */
  private fireReadyListeners(): void {
    const listeners = Array.from(this.readyListeners);
    this.readyListeners.clear();
    for (const l of listeners) {
      try {
        l();
      } catch (e) {
        console.warn('[VFS] readyListener threw:', e);
      }
    }
  }

  /**
   * Register the external-change observer, if this mode wants one and the browser has the API.
   *
   * Records are forwarded to the mirror worker, which reads the files and applies them; see
   * `applyExternalRecords` in opfs-sync.worker.ts.
   */
  private async watchExternalChanges(): Promise<void> {
    if (!this.config.opfsSync) return;
    if (typeof FileSystemObserver === 'undefined') return;   // Chrome 129+ only

    // A `FileSystemObserver` may only be created somewhere that can `disconnect()` it
    // **synchronously** before that scope is destroyed. Chromium aborts the entire browser
    // process on one that outlives its owner — `FATAL: Detected dangling raw_ptr`, a
    // use-after-free in its own C++, which no amount of care on this side prevents.
    //
    // A page qualifies: `pagehide` runs synchronously before teardown. A worker does not — the
    // page kills it outright, and a `postMessage` sent on the way out cannot be waited for. So a
    // worker-hosted instance does not watch for external changes at all; mirroring outward is
    // unaffected. Having the page host the observer on the worker's behalf was tried and measured
    // *worse* — it is one more observer that nothing reliably detaches — so the feature stays off
    // there rather than risking the browser.
    if (typeof document === 'undefined') return;

    try {
      let dir = await navigator.storage.getDirectory();
      const root = this.config.opfsSyncRoot ?? this.config.root;
      for (const segment of (root ?? '/').split('/').filter(Boolean)) {
        dir = await dir.getDirectoryHandle(segment, { create: true });
      }
      if (this.closed) return;   // disposed while we were awaiting

      const observer = new FileSystemObserver((records) => {
        this.forwardExternalRecords(records.map((record) => ({
          kind: record.type,
          path: '/' + record.relativePathComponents.join('/'),
          from: record.relativePathMovedFrom ? '/' + record.relativePathMovedFrom.join('/') : undefined,
          handle: record.changedHandle,
        })));
      });
      await observer.observe(dir, { recursive: true });
      if (this.closed) { try { observer.disconnect(); } catch { /* ignore */ } return; }
      this.externalObserver = observer;
    } catch (err) {
      console.warn('[VFS] external-change watching unavailable:', (err as Error)?.message);
    }
  }

  /** Hand detected records to the mirror worker, which does the file I/O. */
  private forwardExternalRecords(records: unknown[]): void {
    try { this.syncWorker?.postMessage({ type: 'external-records', records }); }
    catch { /* relay already gone */ }
  }

  /** Detach the observer. Synchronous on purpose — the unload path cannot await. */
  private stopWatchingExternalChanges(): void {
    if (!this.externalObserver) return;
    try { this.externalObserver.disconnect(); } catch { /* already gone */ }
    this.externalObserver = null;
  }

  /**
   * Give back what the page owns when it goes away, without needing the caller to remember.
   *
   * Two things must not survive the page, and they need opposite treatment.
   *
   * The `FileSystemObserver` must be **detached synchronously**: Chromium aborts the whole
   * **browser process** — `FATAL: Detected dangling raw_ptr in unretained` — on a page destroyed
   * with a recursive one still attached. That is why the observer lives on this side rather than
   * in the mirror worker (see {@link watchExternalChanges}); here `disconnect()` is an
   * ordinary synchronous call on the unload path, and it is the first thing this does.
   *
   * The volume's exclusive `createSyncAccessHandle` must be **handed back**, and terminating the
   * relay does not do it — the browser reclaims such a handle whenever it gets round to it, and
   * the next leader cannot open the volume until then. So the relay is asked to shut down instead:
   * `postMessage` still reaches a live worker during `pagehide`, and the relay closes the handle
   * synchronously on its own thread. Neither relay is terminated here — they die with the page
   * anyway, and killing the sync relay is precisely what removed its chance to let go first.
   *
   * `event.persisted` means the page is going into the back/forward cache and may be restored,
   * so the filesystem is left alone in that case.
   */
  private installUnloadTeardown(): void {
    if (typeof addEventListener !== 'function' || typeof document === 'undefined') return;
    this.onPageHide = (event: Event) => {
      if ((event as PageTransitionEvent).persisted) return;

      // Synchronous, and the reason the observer lives on this side: it is guaranteed detached
      // before the page is destroyed, which is the state Chromium aborts on.
      this.stopWatchingExternalChanges();

      // The sync relay is ASKED, not killed, so it can give the volume back.
      //
      // A reloading leader that merely terminated its relay left the volume locked behind it, and
      // the tab coming back — which wins the leader lock immediately, because the old holder's tab
      // is gone — could not open the volume and sat in `sendLeaderInit`'s retry loop until the
      // handle happened to be released. Measured in a two-tab reload storm: 4.8s, 6.1s and 12.1s
      // boots, always in the tab that had been the leader.
      //
      // The async relay holds no volume handle, so killing it outright costs nothing.
      try { this.syncWorker?.postMessage({ type: 'shutdown' }); } catch { /* already gone */ }
      terminateWorker(this.asyncWorker);
    };
    addEventListener('pagehide', this.onPageHide);
  }

  /**
   * Ask the sync relay to release what it owns, and wait briefly for it to confirm.
   *
   * The thing that actually has to happen here is the volume's exclusive sync access handle going
   * back: the browser does not reclaim it promptly on its own, and until it does, nothing — not
   * the next leader, not this instance reopening the same root — can open the volume. The wait is
   * for `shutdown-done`, which also means the mirror worker has stopped and closed its port, and
   * it is bounded because a close must not be able to hang.
   */
  private async shutdownRelay(): Promise<void> {
    if (!this.syncWorker) return;
    const worker = this.syncWorker;
    const previous = worker.onmessage;
    try {
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); worker.onmessage = previous; resolve(); };
        const timer = setTimeout(done, 750);
        worker.onmessage = (e: MessageEvent) => {
          if (e.data?.type === 'shutdown-done') done();
          else if (typeof previous === 'function') previous.call(worker, e);
        };
        worker.postMessage({ type: 'shutdown' });
      });
    } catch { /* closing is best-effort */ }
  }

  /**
   * Release every resource this instance owns: the relay workers, the OPFS mirror worker, and
   * the `FileSystemObserver` registered on the origin's storage.
   *
   * Worth calling explicitly in anything that creates instances repeatedly — a test suite, an
   * app that switches volumes — because the observer is the one thing that does not simply die
   * with the page. The instance is unusable afterwards; construct a new one to reopen the volume.
   *
   * Named `dispose` rather than `close` because `close(fd)` is already node's descriptor API and
   * means something entirely different. `await using fs = new VFSFileSystem()` works too.
   */
  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    liveInstances.delete(this);
    this.stopWatchingExternalChanges();
    if (this.onPageHide) {
      removeEventListener('pagehide', this.onPageHide);
      this.onPageHide = null;
    }
    // Before anything is torn down: a follower routed to this instance must be re-queued rather
    // than posted into a port that is about to detach.
    if (this.brokerHeartbeatTimer) {
      clearInterval(this.brokerHeartbeatTimer);
      this.brokerHeartbeatTimer = null;
    }
    this.deregisterBroker();

    await this.shutdownRelay();
    terminateWorker(this.syncWorker);
    terminateWorker(this.asyncWorker);
    // Last, so a tab promoted by this release does not race the relay we just shut down.
    this.leaderLockBid?.abort();
    this.leaderLockBid = null;
    this.releaseLeaderLock?.();
    this.releaseLeaderLock = null;
    this.holdingLeaderLock = false;
    this.isReady = false;
  }

  /**
   * Tell the service-worker broker this instance is no longer serving.
   *
   * The broker holds one `serverPort` for the volume. If a leader goes away without saying so,
   * that slot keeps a detached port, and posting to a detached port is a silent no-op — so
   * followers' ports were dropped on the floor instead of being queued for the next leader, and
   * every call they made waited out the 10s forward deadline. Clearing it is what lets the
   * broker queue arrivals and flush them the moment a new leader registers.
   */
  private deregisterBroker(): void {
    if (!this.brokerSw) return;
    try { this.brokerSw.postMessage({ type: 'deregister-server' }); } catch { /* SW already gone */ }
    this.brokerSw = null;
  }

  /** `await using` support, so an instance can be scoped to a block. */
  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }

  /**
   * Whether this tab owns the volume.
   *
   * One tab per origin holds the lock and does the actual work; the rest relay their calls to it.
   * Which one you are is worth knowing for two reasons. A follower's synchronous calls cost a
   * round trip to the leader, so they measure slower — a benchmark that does not say which role
   * it ran in is not comparable. And on Safari a follower's *main-thread* sync call cannot work
   * at all (see the readme), so code that must be synchronous everywhere runs the instance in a
   * worker.
   *
   * Leadership moves: close the leader and a follower is promoted, without reloading. Use
   * {@link onLeaderChange} rather than reading this once.
   */
  get isLeader(): boolean {
    return !this.isFollower;
  }

  /**
   * Observe leadership changes. Returns an unsubscribe function.
   *
   * Fires on election and on promotion when the previous leader goes away.
   */
  onLeaderChange(listener: (isLeader: boolean) => void): () => void {
    this.leaderListeners.add(listener);
    return () => { this.leaderListeners.delete(listener); };
  }

  private announceRole(): void {
    const isLeader = !this.isFollower;
    for (const listener of this.leaderListeners) {
      try { listener(isLeader); } catch (err) { console.warn('[VFS] leader listener threw:', err); }
    }
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

    // Terminate old workers and spawn fresh ones. The relay is asked to shut down first so the
    // OPFS mirror worker it owns can detach its FileSystemObserver — terminating the relay
    // outright orphans that worker, and the observer with it.
    await this.shutdownRelay();
    terminateWorker(this.syncWorker);
    terminateWorker(this.asyncWorker);

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
        // Clear any stale transition flag (e.g. a setMode that interrupted an
        // in-flight promoteToLeader) so `ready`/`whenReady()` don't wedge.
        this.transitioning = false;
        this.resolveReady();
        this.fireReadyListeners();
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

  private _validateCb(cb: any): void {
    // Allow missing callbacks — Node.js tolerates fs.mkdir(path, opts) without callback
    // (returns undefined, errors are silently lost). Callers like webcontainer's polyfill
    // layer strip callbacks before calling native methods, then handle results separately.
    if (cb !== undefined && cb !== null && typeof cb !== 'function') {
      throw new TypeError('The "cb" argument must be of type function. Received ' + typeof cb);
    }
  }

  /** Adapt a promise to optional Node.js callback style.
   *  If cb is a function: calls cb(err, result) via setTimeout. Returns void.
   *  If cb is missing: returns the promise (allows .then() or await). */
  private _cb<T>(promise: Promise<T>, cb: any, mapResult?: (val: T) => any[]): any {
    if (typeof cb === 'function') {
      promise.then(
        (val) => setTimeout(() => cb(null, ...(mapResult ? mapResult(val) : [val])), 0),
        (err) => setTimeout(() => cb(err), 0),
      );
      return;
    }
    return promise;
  }

  /** Like _cb but for void-returning promises (no result value). */
  private _cbVoid(promise: Promise<any>, cb: any): any {
    if (typeof cb === 'function') {
      promise.then(
        () => setTimeout(() => cb(null), 0),
        (err) => setTimeout(() => cb(err), 0),
      );
      return;
    }
    return promise;
  }

  // The callback API accepts a file descriptor where a path goes; `fsPromises` does not (it
  // takes a FileHandle instead), so these route to the fd path directly rather than through
  // `this.promises`.
  // Node's two async APIs disagree about *when* a bad path is reported, and both behaviours are
  // observable: the callback API validates synchronously and **throws** (`fs.stat(123, cb)`
  // throws ERR_INVALID_ARG_TYPE at the call site), while `fsPromises.stat(123)` returns a
  // rejected promise. The methods below therefore call `toPathString` themselves before handing
  // off to `this.promises`, which is `async` and would otherwise turn the throw into a rejection.
  readFile(filePath: string | number, callback: (err: Error | null, data?: Uint8Array | string) => void): void;
  readFile(filePath: string | number, options: ReadOptions | Encoding | null, callback: (err: Error | null, data?: Uint8Array | string) => void): void;
  readFile(filePath: any, optionsOrCallback?: any, callback?: any): any {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    if (isFdArg(filePath)) return this._cb(_readFileFd(this._async, filePath, opts), cb);
    toPathString(filePath);
    return this._cb(this.promises.readFile(filePath, opts), cb);
  }

  writeFile(filePath: string | number, data: string | Uint8Array, callback: (err: Error | null) => void): void;
  writeFile(filePath: string | number, data: string | Uint8Array, options: WriteOptions | Encoding, callback: (err: Error | null) => void): void;
  writeFile(filePath: any, data: string | Uint8Array, optionsOrCallback?: any, callback?: any): any {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    if (isFdArg(filePath)) return this._cbVoid(_writeFileFd(this._async, filePath, data, opts), cb);
    toPathString(filePath);
    return this._cbVoid(this.promises.writeFile(filePath, data, opts), cb);
  }

  appendFile(filePath: string | number, data: string | Uint8Array, callback: (err: Error | null) => void): void;
  appendFile(filePath: string | number, data: string | Uint8Array, options: WriteOptions | Encoding, callback: (err: Error | null) => void): void;
  appendFile(filePath: any, data: string | Uint8Array, optionsOrCallback?: any, callback?: any): any {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    if (isFdArg(filePath)) return this._cbVoid(_appendFileFd(this._async, filePath, data, opts), cb);
    toPathString(filePath);
    return this._cbVoid(this.promises.appendFile(filePath, data, opts), cb);
  }

  mkdir(filePath: string, callback: (err: Error | null, path?: string) => void): void;
  mkdir(filePath: string, options: MkdirOptions | Mode, callback: (err: Error | null, path?: string) => void): void;
  mkdir(filePath: string, optionsOrCallback?: any, callback?: any): any {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    toPathString(filePath);
    return this._cb(this.promises.mkdir(filePath, opts), cb);
  }

  rmdir(filePath: string, callback: (err: Error | null) => void): void;
  rmdir(filePath: string, options: RmdirOptions, callback: (err: Error | null) => void): void;
  rmdir(filePath: string, optionsOrCallback?: any, callback?: any): any {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    toPathString(filePath);
    return this._cbVoid(this.promises.rmdir(filePath, opts), cb);
  }

  rm(filePath: string, callback: (err: Error | null) => void): void;
  rm(filePath: string, options: RmOptions, callback: (err: Error | null) => void): void;
  rm(filePath: string, optionsOrCallback?: any, callback?: any): any {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    toPathString(filePath);
    return this._cbVoid(this.promises.rm(filePath, opts), cb);
  }

  unlink(filePath: string, callback?: (err: Error | null) => void): any {
    this._validateCb(callback);
    toPathString(filePath);
    return this._cbVoid(this.promises.unlink(filePath), callback);
  }

  readdir(filePath: string, callback: (err: Error | null, files?: string[] | Dirent[]) => void): void;
  readdir(filePath: string, options: ReaddirOptions | Encoding | null, callback: (err: Error | null, files?: string[] | Dirent[]) => void): void;
  readdir(filePath: string, optionsOrCallback?: any, callback?: any): any {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    toPathString(filePath);
    return this._cb(this.promises.readdir(filePath, opts), cb);
  }

  stat(filePath: string, callback: (err: Error | null, stats?: Stats | BigIntStats) => void): void;
  stat(filePath: string, options: StatOptions, callback: (err: Error | null, stats?: Stats | BigIntStats) => void): void;
  stat(filePath: string, optionsOrCallback?: any, callback?: any): any {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    toPathString(filePath);
    return this._cb(this.promises.stat(filePath, opts), cb);
  }

  lstat(filePath: string, callback: (err: Error | null, stats?: Stats | BigIntStats) => void): void;
  lstat(filePath: string, options: StatOptions, callback: (err: Error | null, stats?: Stats | BigIntStats) => void): void;
  lstat(filePath: string, optionsOrCallback?: any, callback?: any): any {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    toPathString(filePath);
    return this._cb(this.promises.lstat(filePath, opts), cb);
  }

  access(filePath: string, callback: (err: Error | null) => void): void;
  access(filePath: string, mode: number, callback: (err: Error | null) => void): void;
  access(filePath: string, modeOrCallback?: any, callback?: any): any {
    const cb = typeof modeOrCallback === 'function' ? modeOrCallback : callback;
    this._validateCb(cb);
    const mode = typeof modeOrCallback === 'function' ? undefined : modeOrCallback;
    toPathString(filePath);
    return this._cbVoid(this.promises.access(filePath, mode), cb);
  }

  rename(oldPath: string, newPath: string, callback?: (err: Error | null) => void): any {
    this._validateCb(callback);
    toPathString(oldPath); toPathString(newPath);
    return this._cbVoid(this.promises.rename(oldPath, newPath), callback);
  }

  copyFile(src: string, dest: string, callback: (err: Error | null) => void): void;
  copyFile(src: string, dest: string, mode: number, callback: (err: Error | null) => void): void;
  copyFile(src: string, dest: string, modeOrCallback?: any, callback?: any): any {
    const cb = typeof modeOrCallback === 'function' ? modeOrCallback : callback;
    this._validateCb(cb);
    const mode = typeof modeOrCallback === 'function' ? undefined : modeOrCallback;
    toPathString(src); toPathString(dest);
    return this._cbVoid(this.promises.copyFile(src, dest, mode), cb);
  }

  truncate(filePath: string, callback: (err: Error | null) => void): void;
  truncate(filePath: string, len: number, callback: (err: Error | null) => void): void;
  truncate(filePath: string, lenOrCallback?: any, callback?: any): any {
    const cb = typeof lenOrCallback === 'function' ? lenOrCallback : callback;
    this._validateCb(cb);
    const len = typeof lenOrCallback === 'function' ? undefined : lenOrCallback;
    toPathString(filePath);
    return this._cbVoid(this.promises.truncate(filePath, len), cb);
  }

  realpath(filePath: string, callback?: (err: Error | null, resolvedPath?: string | Uint8Array) => void): any;
  realpath(filePath: string, options: { encoding?: string | null } | string | null, callback?: (err: Error | null, resolvedPath?: string | Uint8Array) => void): any;
  realpath(filePath: string, optionsOrCallback?: any, callback?: any): any {
    // Node: fs.realpath(path[, options], callback). The options argument was missing entirely
    // here, so the documented three-argument form threw "cb must be of type function".
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    this._validateCb(cb);
    return this._cb(this.promises.realpath(filePath, opts), cb);
  }

  chmod(filePath: string, mode: Mode, callback?: (err: Error | null) => void): any {
    this._validateCb(callback);
    toPathString(filePath);
    return this._cbVoid(this.promises.chmod(filePath, mode), callback);
  }

  chown(filePath: string, uid: number, gid: number, callback?: (err: Error | null) => void): any {
    this._validateCb(callback);
    toPathString(filePath);
    return this._cbVoid(this.promises.chown(filePath, uid, gid), callback);
  }

  utimes(filePath: string, atime: Date | number, mtime: Date | number, callback?: (err: Error | null) => void): any {
    this._validateCb(callback);
    toPathString(filePath);
    return this._cbVoid(this.promises.utimes(filePath, atime, mtime), callback);
  }

  symlink(target: string, linkPath: string, callback: (err: Error | null) => void): void;
  symlink(target: string, linkPath: string, type: string | null, callback: (err: Error | null) => void): void;
  symlink(target: string, linkPath: string, typeOrCallback?: any, callback?: any): any {
    const cb = typeof typeOrCallback === 'function' ? typeOrCallback : callback;
    this._validateCb(cb);
    const type = typeof typeOrCallback === 'function' ? undefined : typeOrCallback;
    toPathString(target); toPathString(linkPath);
    return this._cbVoid(this.promises.symlink(target, linkPath, type), cb);
  }

  readlink(filePath: string, callback: (err: Error | null, linkString?: string | Uint8Array) => void): void;
  readlink(filePath: string, options: { encoding?: string | null } | string | null, callback: (err: Error | null, linkString?: string | Uint8Array) => void): void;
  readlink(filePath: string, optionsOrCallback?: any, callback?: any): any {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    toPathString(filePath);
    return this._cb(this.promises.readlink(filePath, opts), cb);
  }

  link(existingPath: string, newPath: string, callback?: (err: Error | null) => void): any {
    this._validateCb(callback);
    toPathString(existingPath); toPathString(newPath);
    return this._cbVoid(this.promises.link(existingPath, newPath), callback);
  }

  open(filePath: string, callback: (err: Error | null, fd?: number) => void): void;
  open(filePath: string, flags: string | number, callback: (err: Error | null, fd?: number) => void): void;
  open(filePath: string, flags: string | number, mode: Mode, callback: (err: Error | null, fd?: number) => void): void;
  open(filePath: string, flagsOrCallback?: any, modeOrCallback?: any, callback?: any): any {
    // Node: fs.open(path[, flags[, mode]], callback) — BOTH middle arguments are optional, so the
    // callback can arrive in any of three positions. `flags` used to be required here, which meant
    // `fs.open(path, cb)` consumed the callback as the flags string: the open still ran, but the
    // callback was never invoked and no error was reported. Same failure shape as fs.watch's.
    let flags: string | number = 'r';
    let mode: Mode | undefined;
    let cb: any;

    if (typeof flagsOrCallback === 'function') {
      cb = flagsOrCallback;
    } else {
      flags = flagsOrCallback ?? 'r';
      if (typeof modeOrCallback === 'function') {
        cb = modeOrCallback;
      } else {
        mode = modeOrCallback;
        cb = callback;
      }
    }

    this._validateCb(cb);
    toPathString(filePath);
    return this._cb(this.promises.open(filePath, flags, mode), cb, (handle: any) => [handle.fd]);
  }

  mkdtemp(prefix: string, callback?: (err: Error | null, folder?: string | Uint8Array) => void): any;
  mkdtemp(prefix: string, options: { encoding?: string | null } | string | null, callback?: (err: Error | null, folder?: string | Uint8Array) => void): any;
  mkdtemp(prefix: string, optionsOrCallback?: any, callback?: any): any {
    // Node: fs.mkdtemp(prefix[, options], callback) — same missing middle argument as realpath.
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    this._validateCb(cb);
    toPathString(prefix);
    return this._cb(this.promises.mkdtemp(prefix, opts), cb);
  }

  cp(src: string, dest: string, callback: (err: Error | null) => void): void;
  cp(src: string, dest: string, options: CpOptions, callback: (err: Error | null) => void): void;
  cp(src: string, dest: string, optionsOrCallback?: any, callback?: any): void | Promise<void> {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    if (cb) {
      this._validateCb(cb);
      this._cpAsync(src, dest, opts).then(
        () => setTimeout(() => cb(null), 0),
        (err) => setTimeout(() => cb(err), 0),
      );
      return;
    }
    // No callback — return promise for backward compat
    return this._cpAsync(src, dest, opts);
  }

  fdatasync(fd: number, callback?: (err: Error | null) => void): void {
    this._validateCb(callback);
    try {
      this.fdatasyncSync(fd);
      if (callback) setTimeout(() => callback(null), 0);
    } catch (err: any) {
      if (callback) setTimeout(() => callback(err), 0);
      else throw err;
    }
  }

  fsync(fd: number, callback?: (err: Error | null) => void): void {
    this._validateCb(callback);
    try {
      this.fsyncSync(fd);
      if (callback) setTimeout(() => callback(null), 0);
    } catch (err: any) {
      if (callback) setTimeout(() => callback(err), 0);
      else throw err;
    }
  }

  fstat(fd: number, callback: (err: Error | null, stats?: Stats | BigIntStats) => void): void;
  fstat(fd: number, options: any, callback: (err: Error | null, stats?: Stats | BigIntStats) => void): void;
  fstat(fd: number, optionsOrCallback?: any, callback?: any): void {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    try {
      const result = this.fstatSync(fd, opts);
      if (cb) setTimeout(() => cb(null, result), 0);
    } catch (err) {
      if (cb) setTimeout(() => cb(err), 0);
      else throw err;
    }
  }

  ftruncate(fd: number, callback: (err: Error | null) => void): void;
  ftruncate(fd: number, len: number, callback: (err: Error | null) => void): void;
  ftruncate(fd: number, lenOrCallback?: any, callback?: any): void {
    const cb = typeof lenOrCallback === 'function' ? lenOrCallback : callback;
    this._validateCb(cb);
    const len = typeof lenOrCallback === 'function' ? 0 : lenOrCallback;
    try {
      this.ftruncateSync(fd, len);
      if (cb) setTimeout(() => cb(null), 0);
    } catch (err) {
      if (cb) setTimeout(() => cb(err), 0);
      else throw err;
    }
  }

  read(fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null, callback: (err: Error | null, bytesRead?: number, buffer?: Uint8Array) => void): void;
  read(fd: number, options: { buffer: Uint8Array; offset?: number; length?: number; position?: number | null }, callback: (err: Error | null, bytesRead?: number, buffer?: Uint8Array) => void): void;
  read(fd: number, buffer: any, offset?: any, length?: any, position?: any, callback?: any): void {
    let cb: Function;
    let buf: Uint8Array;
    let off: number;
    let len: number;
    let pos: number | null;
    if (typeof buffer === 'object' && !(buffer instanceof Uint8Array) && buffer !== null && 'buffer' in buffer) {
      // Object form: read(fd, { buffer, offset?, length?, position? }, callback)
      cb = offset;
      buf = buffer.buffer;
      off = buffer.offset ?? 0;
      len = buffer.length ?? buf.byteLength;
      pos = buffer.position ?? null;
    } else {
      cb = callback;
      buf = buffer;
      off = offset;
      len = length;
      pos = position;
    }
    this._validateCb(cb);
    try {
      const bytesRead = this.readSync(fd, buf, off, len, pos);
      if (cb) setTimeout(() => cb(null, bytesRead, buf), 0);
    } catch (err) {
      if (cb) setTimeout(() => cb(err as Error), 0);
      else throw err;
    }
  }

  write(fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null, callback: (err: Error | null, bytesWritten?: number, buffer?: Uint8Array) => void): void;
  write(fd: number, data: string, position: number | null | undefined, encoding: string | undefined, callback: (err: Error | null, bytesWritten?: number, data?: string) => void): void;
  write(fd: number, bufferOrString: Uint8Array | string, offsetOrPosition?: any, lengthOrEncoding?: any, position?: any, callback?: any): void {
    const cb = [offsetOrPosition, lengthOrEncoding, position, callback].find(a => typeof a === 'function');
    this._validateCb(cb);
    try {
      let bytesWritten: number;
      if (typeof bufferOrString === 'string') {
        const pos = typeof offsetOrPosition === 'function' ? undefined : offsetOrPosition;
        const enc = typeof lengthOrEncoding === 'function' ? undefined : lengthOrEncoding;
        bytesWritten = this.writeSync(fd, bufferOrString, pos, enc);
      } else {
        const off = typeof offsetOrPosition === 'function' ? undefined : offsetOrPosition;
        const len = typeof lengthOrEncoding === 'function' ? undefined : lengthOrEncoding;
        const pos = typeof position === 'function' ? undefined : position;
        bytesWritten = this.writeSync(fd, bufferOrString, off, len, pos);
      }
      if (cb) setTimeout(() => cb(null, bytesWritten, bufferOrString), 0);
    } catch (err) {
      if (cb) setTimeout(() => cb(err), 0);
      else throw err;
    }
  }

  close(fd: number, callback?: (err: Error | null) => void): void {
    try {
      this.closeSync(fd);
      if (callback) setTimeout(() => callback(null), 0);
    } catch (err) {
      if (callback) setTimeout(() => callback(err as Error), 0);
      else throw err;
    }
  }

  exists(filePath: string, callback?: (exists: boolean) => void): any {
    const p = this.promises.exists(filePath);
    if (typeof callback === 'function') {
      p.then(
        (result) => setTimeout(() => callback(result), 0),
        () => setTimeout(() => callback(false), 0),
      );
      return;
    }
    return p;
  }

  opendir(filePath: string, callback?: (err: Error | null, dir?: Dir) => void): any {
    this._validateCb(callback);
    toPathString(filePath);
    return this._cb(this.promises.opendir(filePath), callback);
  }

  glob(pattern: string, callback: (err: Error | null, matches?: string[]) => void): void;
  glob(pattern: string, options: GlobOptions, callback: (err: Error | null, matches?: string[]) => void): void;
  glob(pattern: string, optionsOrCallback?: any, callback?: any): any {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    // Straight to the engine, not through `promises.glob` — that returns an async iterator now,
    // as node's does, while the callback form hands back the whole array in one go.
    return this._cb(_glob(this._async, pattern, opts), cb);
  }

  futimes(fd: number, atime: Date | number, mtime: Date | number, callback?: (err: Error | null) => void): void {
    this._validateCb(callback);
    return this._cbVoid(this.promises.futimes(fd, atime, mtime), callback);
  }

  fchmod(fd: number, mode: Mode, callback?: (err: Error | null) => void): void {
    this._validateCb(callback);
    return this._cbVoid(this.promises.fchmod(fd, mode), callback);
  }

  fchown(fd: number, uid: number, gid: number, callback?: (err: Error | null) => void): void {
    this._validateCb(callback);
    return this._cbVoid(this.promises.fchown(fd, uid, gid), callback);
  }

  lchmod(filePath: PathLike, mode: Mode, callback?: (err: Error | null) => void): any {
    this._validateCb(callback);
    toPathString(filePath);
    return this._cbVoid(this.promises.lchmod(filePath, mode), callback);
  }

  lchown(filePath: PathLike, uid: number, gid: number, callback?: (err: Error | null) => void): any {
    this._validateCb(callback);
    toPathString(filePath);
    return this._cbVoid(this.promises.lchown(filePath, uid, gid), callback);
  }

  lutimes(filePath: PathLike, atime: Date | number, mtime: Date | number, callback?: (err: Error | null) => void): any {
    this._validateCb(callback);
    toPathString(filePath);
    return this._cbVoid(this.promises.lutimes(filePath, atime, mtime), callback);
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

  /** Node.js compat: fs.promises.constants (same as fs.constants) */
  get constants() { return constants; }

  // Unlike the callback API, the promise API takes a **FileHandle** rather than a raw descriptor
  // in the path position — `fsPromises.readFile(fd)` is an ERR_INVALID_ARG_TYPE in Node, and
  // stays one here because `toPathString` rejects numbers.
  async readFile(filePath: PathLike | FileHandle, options?: ReadOptions | Encoding | null) {
    if (isFileHandle(filePath)) return filePath.readFile(options);
    return _readFile(this._async, toPathString(filePath), options);
  }

  async writeFile(filePath: PathLike | FileHandle, data: string | Uint8Array, options?: WriteOptions | Encoding) {
    if (isFileHandle(filePath)) return filePath.writeFile(data, options);
    return _writeFile(this._async, toPathString(filePath), data, options);
  }

  async appendFile(filePath: PathLike | FileHandle, data: string | Uint8Array, options?: WriteOptions | Encoding) {
    if (isFileHandle(filePath)) return filePath.appendFile(data, options);
    return _appendFile(this._async, toPathString(filePath), data, options);
  }

  async mkdir(filePath: PathLike, options?: MkdirOptions | Mode) {
    return _mkdir(this._async, toPathString(filePath), options);
  }

  async rmdir(filePath: PathLike, options?: RmdirOptions) {
    return _rmdir(this._async, toPathString(filePath), options);
  }

  async rm(filePath: PathLike, options?: RmOptions) {
    return _rm(this._async, toPathString(filePath), options);
  }

  async unlink(filePath: PathLike) {
    return _unlink(this._async, toPathString(filePath));
  }

  async readdir(filePath: PathLike, options?: ReaddirOptions | Encoding | null) {
    return _readdir(this._async, toPathString(filePath), options);
  }

  /**
   * `fsPromises.glob` — an **async iterator** of matches, which is what node returns.
   *
   * This used to be `async glob(): Promise<string[]>`, so the documented way to consume it —
   * `for await (const p of fsp.glob(pattern))` — got a promise, which is not async-iterable, and
   * silently produced nothing. `await`ing it worked, which is why it looked fine: the shape was
   * only wrong for the usage node's own docs show.
   *
   * Matches are gathered before the first yield rather than streamed. Observably identical for a
   * consumer, and the engine answers a glob in one round trip, so there is nothing to stream.
   */
  async *glob(pattern: string | string[], options?: GlobOptions): AsyncGenerator<string | Dirent> {
    const matches = await _glob(this._async, pattern, options);
    for (const match of matches) yield match;
  }

  stat(filePath: PathLike, options?: StatOptions & { throwIfNoEntry?: true }): Promise<Stats | BigIntStats>;
  stat(filePath: PathLike, options: StatOptions & { throwIfNoEntry: false }): Promise<Stats | BigIntStats | undefined>;
  async stat(filePath: PathLike, options?: StatOptions): Promise<Stats | BigIntStats | undefined> {
    return _stat(this._async, toPathString(filePath), options as StatOptions & { throwIfNoEntry: false });
  }

  lstat(filePath: PathLike, options?: StatOptions & { throwIfNoEntry?: true }): Promise<Stats | BigIntStats>;
  lstat(filePath: PathLike, options: StatOptions & { throwIfNoEntry: false }): Promise<Stats | BigIntStats | undefined>;
  async lstat(filePath: PathLike, options?: StatOptions): Promise<Stats | BigIntStats | undefined> {
    return _lstat(this._async, toPathString(filePath), options as StatOptions & { throwIfNoEntry: false });
  }

  async access(filePath: PathLike, mode?: number) {
    return _access(this._async, toPathString(filePath), mode);
  }

  async rename(oldPath: PathLike, newPath: PathLike) {
    return _rename(this._async, toPathString(oldPath), toPathString(newPath));
  }

  async copyFile(src: PathLike, dest: PathLike, mode?: number) {
    return _copyFile(this._async, toPathString(src), toPathString(dest), mode);
  }

  async cp(src: PathLike, dest: PathLike, options?: CpOptions): Promise<void> {
    // Same self/subtree guard as the sync form — an unguarded recursive copy into its own
    // subtree never terminates. See VFSFileSystem._assertCopyable.
    assertCopyable(toPathString(src), toPathString(dest));
    return this._cpInner(src, dest, options);
  }

  /** The recursive worker; its destinations are legitimately inside the destination tree. */
  private async _cpInner(src: PathLike, dest: PathLike, options?: CpOptions): Promise<void> {
    const srcPath = toPathString(src);
    const destPath = toPathString(dest);
    if (options?.filter && !options.filter(srcPath, destPath)) return;
    const force = options?.force !== false;
    const errorOnExist = options?.errorOnExist ?? false;
    const dereference = options?.dereference ?? false;
    const preserveTimestamps = options?.preserveTimestamps ?? false;

    // See VFSFileSystem's sync path: the branch decision is always on the link itself.
    void dereference;
    const srcStat = await this.lstat(srcPath);

    if (srcStat.isDirectory()) {
      if (!options?.recursive) {
        throw cpEisdirNotRecursive(srcPath);
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
        await this._cpInner(srcChild, destChild, options);
      }
    } else if (srcStat.isSymbolicLink()) {
      const target = await this.readlink(srcPath) as string;
      let destExists = false;
      try { await this.lstat(destPath); destExists = true; } catch {}
      if (destExists) {
        if (errorOnExist) throw cpTargetExists(destPath);
        if (!force) return;
        await this.unlink(destPath);
      }
      await this.symlink(target, destPath);
    } else {
      let destExists = false;
      try { await this.lstat(destPath); destExists = true; } catch {}
      if (destExists) {
        if (errorOnExist) throw cpTargetExists(destPath);
        if (!force) return;
      }
      await this.copyFile(srcPath, destPath, errorOnExist ? constants.COPYFILE_EXCL : 0);
    }

    if (preserveTimestamps) {
      const st = await this.stat(srcPath);
      await this.utimes(destPath, st.atime, st.mtime);
    }
  }

  async truncate(filePath: PathLike, len?: number) {
    return _truncate(this._async, toPathString(filePath), len);
  }

  async realpath(filePath: PathLike, options?: { encoding?: string | null } | string | null) {
    return _realpath(this._async, toRealpathString(filePath), options);
  }

  async exists(filePath: PathLike) {
    return _exists(this._async, toPathString(filePath));
  }

  async chmod(filePath: PathLike, mode: Mode) {
    return _chmod(this._async, toPathString(filePath), mode);
  }

  /** `chmod` on the symlink itself — see {@link lchmodSync}. */
  async lchmod(filePath: PathLike, mode: Mode) {
    return _chmod(this._async, toPathString(filePath), mode, false);
  }

  /** chmod on an open file descriptor. Engine resolves fd → inode and
   *  mutates the mode bits directly. */
  async fchmod(fd: number, mode: Mode): Promise<void> {
    return _fchmod(this._async, fd, mode);
  }

  async chown(filePath: PathLike, uid: number, gid: number) {
    return _chown(this._async, toPathString(filePath), uid, gid);
  }

  /** `chown` on the symlink itself rather than its target — see {@link lchmodSync}. */
  async lchown(filePath: PathLike, uid: number, gid: number) {
    return _chown(this._async, toPathString(filePath), uid, gid, false);
  }

  /** chown on an open file descriptor. Engine resolves fd → inode and
   *  mutates uid/gid directly. */
  async fchown(fd: number, uid: number, gid: number): Promise<void> {
    return _fchown(this._async, fd, uid, gid);
  }

  async utimes(filePath: PathLike, atime: Date | number, mtime: Date | number) {
    return _utimes(this._async, toPathString(filePath), atime, mtime);
  }

  /** utimes on an open file descriptor. Engine resolves fd → inode and
   *  mutates atime/mtime directly. */
  async futimes(fd: number, atime: Date | number, mtime: Date | number): Promise<void> {
    return _futimes(this._async, fd, atime, mtime);
  }

  /** Timestamps on the symlink itself rather than its target — see {@link lchmodSync}. */
  async lutimes(filePath: PathLike, atime: Date | number, mtime: Date | number) {
    return _utimes(this._async, toPathString(filePath), atime, mtime, false);
  }

  async symlink(target: PathLike, linkPath: PathLike, type?: string | null) {
    return _symlink(this._async, toPathString(target), toPathString(linkPath), type);
  }

  async readlink(filePath: PathLike, options?: { encoding?: string | null } | string | null) {
    return _readlink(this._async, toPathString(filePath), options);
  }

  async link(existingPath: PathLike, newPath: PathLike) {
    return _link(this._async, toPathString(existingPath), toPathString(newPath));
  }

  async open(filePath: PathLike, flags?: string | number, mode?: Mode) {
    return _open(this._async, toPathString(filePath), flags, mode);
  }

  async opendir(filePath: PathLike, options?: OpendirOptions) {
    return _opendir(this._async, toPathString(filePath), options);
  }

  /**
   * `mkdtemp` whose result cleans itself up — see `mkdtempDisposableSync`. Disposal is async
   * here (`await using`), so the symbol is `Symbol.asyncDispose` and `remove()` returns a promise.
   */
  async mkdtempDisposable(prefix: string): Promise<{ path: string; remove(): Promise<void>; [Symbol.asyncDispose](): Promise<void> }> {
    const path = (await _mkdtemp(this._async, prefix)) as string;
    const remove = () => this.rm(path, { recursive: true, force: true });
    return { path, remove, [Symbol.asyncDispose]: remove };
  }

  async mkdtemp(prefix: PathLike, options?: { encoding?: string | null } | string | null) {
    return _mkdtemp(this._async, toPathString(prefix), options);
  }

  async openAsBlob(filePath: string, options?: OpenAsBlobOptions): Promise<Blob> {
    const data = await _readFileAsBlobBytes(this.readFile(filePath));
    return new Blob([data as BlobPart], { type: options?.type ?? '' });
  }

  /** Real volume statistics — see the note on `VFSFileSystem.statfsSync`. */
  async statfs(path: PathLike = '/', options?: StatFsOptions): Promise<StatFs | BigIntStatFs> {
    return _statfs(this._async, toPathString(path), options);
  }

  async *watch(filePath: string, options?: WatchOptions): AsyncIterable<WatchEventType> {
    yield* _watchAsync(this._ns, this._async, filePath, options);
  }

  async fstat(fd: number, options?: StatOptions): Promise<Stats | BigIntStats> {
    const { status, data } = await this._async(OP.FSTAT, '', 0, null, undefined, { fd });
    if (status !== 0) throw _statusToError(status, 'fstat', String(fd));
    return options?.bigint ? _decodeStatsBigInt(data!) : _decodeStats(data!);
  }

  async ftruncate(fd: number, len: number = 0): Promise<void> {
    const { status } = await this._async(OP.FTRUNCATE, '', 0, null, undefined, { fd, length: len });
    if (status !== 0) throw _statusToError(status, 'ftruncate', String(fd));
  }

  async fsync(fd: number): Promise<void> {
    const { status } = await this._async(OP.FSYNC, '', 0, null, undefined, { fd });
    if (status !== 0) throw _statusToError(status, 'fsync', String(fd));
  }

  async fdatasync(fd: number): Promise<void> {
    const { status } = await this._async(OP.FSYNC, '', 0, null, undefined, { fd });
    if (status !== 0) throw _statusToError(status, 'fdatasync', String(fd));
  }

  /** The volume-wide flush: no descriptor, so nothing to validate. */
  async flush(): Promise<void> {
    await this._async(OP.FSYNC, '');
  }

  async purge(): Promise<void> {
    // No-op
  }
}
