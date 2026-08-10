import type { WatchOptions, WatchEventType, FSWatcher, StatWatcher, WatchListener, WatchFileListener, WatchFileOptions, Stats } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { statSync } from './stat.js';
import { createError } from '../errors.js';
import { SimpleEventEmitter } from '../node-streams.js';
import { Stats as StatsClass } from '../stats-classes.js';
import * as path from '../path.js';

// ========== Watcher Registry ==========

interface WatchEntry {
  ns: string;
  absPath: string;
  recursive: boolean;
  listener: WatchListener;
  signal?: AbortSignal;
  /** When true, the listener wants Buffer filenames instead of strings. */
  asBuffer: boolean;
  /**
   * Per-tick coalescing: dedupe `(eventType, filename)` pairs emitted during
   * the same microtask, matching libuv's behavior where the kernel queues
   * multiple inotify events per syscall and libuv delivers the deduplicated
   * set in one batch.
   */
  pendingEvents: Set<string> | null;
}

interface WatchFileEntry {
  ns: string;
  absPath: string;
  listener: WatchFileListener;
  /** The `StatWatcher` handed back to the caller, which emits `'change'` for the same tick. */
  watcher?: { emit(event: string, ...args: unknown[]): boolean };
  interval: number;
  prevStats: Stats | null;
  syncRequest: SyncRequestFn;
  timerId: ReturnType<typeof setInterval> | null;
}

// fs.watch() entries
const watchers = new Set<WatchEntry>();

// fs.watchFile() entries, keyed by absolute path
const fileWatchers = new Map<string, Set<WatchFileEntry>>();

// Lazy BroadcastChannel with ref counting, per namespace
const bcMap = new Map<string, { bc: BroadcastChannel; refCount: number }>();

/** Whether any watcher in this context still depends on `ns`'s channel. */
function hasLiveWatchers(ns: string): boolean {
  for (const entry of watchers) if (entry.ns === ns) return true;
  for (const set of fileWatchers.values()) {
    for (const entry of set) if (entry.ns === ns) return true;
  }
  return false;
}

function ensureBc(ns: string): void {
  let entry = bcMap.get(ns);
  if (!entry) {
    entry = { bc: new BroadcastChannel(`${ns}-watch`), refCount: 0 };
    bcMap.set(ns, entry);
  }
  entry.refCount++;
  // Reattached every time, not only on creation. A handler that has been detached — or a channel
  // reused through a path that never attached one — leaves the tab deaf while every other tab
  // keeps working, and nothing about the symptom points here. Assigning an identical handler is
  // idempotent, so paying for it on every registration costs nothing.
  entry.bc.onmessage = onBroadcast;
}

function releaseBc(ns: string): void {
  const entry = bcMap.get(ns);
  if (!entry) return;
  // Guard the shared channel against an unbalanced release: closing it early silences every
  // watcher in this context, and the symptom (a tab that stops seeing changes) points nowhere
  // near the cause.
  if (entry.refCount <= 0) return;
  entry.refCount--;
  if (entry.refCount > 0) return;
  // The refcount says nobody is left; the registry is what actually knows. If they disagree, the
  // registry wins — closing a channel that a live watcher still needs is the failure this whole
  // guard exists to prevent, and an over-retained channel is merely a channel.
  if (hasLiveWatchers(ns)) {
    entry.refCount = 1;
    return;
  }
  entry.bc.close();
  bcMap.delete(ns);
}

// ========== BroadcastChannel handler ==========

function onBroadcast(event: MessageEvent<{ eventType: 'change' | 'rename'; path: string }>): void {
  const { eventType, path: mutatedPath } = event.data;

  // Notify fs.watch() watchers — dedupe per (event, filename) per microtask
  for (const entry of watchers) {
    const filename = matchWatcher(entry, mutatedPath);
    if (filename === null) continue;
    queueWatchEvent(entry, eventType, filename);
  }

  // Notify fs.watchFile() watchers
  const fileSet = fileWatchers.get(mutatedPath);
  if (fileSet) {
    for (const entry of fileSet) {
      triggerWatchFile(entry);
    }
  }
}

/**
 * Coalesce events for a single watcher during one microtask. Node/libuv
 * collapses runs of rapid inotify events so the listener observes at most one
 * `(event, filename)` per tick — we match that to avoid firing e.g. two
 * `change` events when a single write touches both the file and its inode.
 */
function queueWatchEvent(entry: WatchEntry, eventType: 'change' | 'rename', filename: string): void {
  const key = eventType + ':' + filename;
  if (!entry.pendingEvents) {
    entry.pendingEvents = new Set();
    queueMicrotask(() => {
      const pending = entry.pendingEvents!;
      entry.pendingEvents = null;
      for (const k of pending) {
        const colon = k.indexOf(':');
        const et = k.slice(0, colon) as 'change' | 'rename';
        const name = k.slice(colon + 1);
        try {
          entry.listener(et, entry.asBuffer ? encodeFilename(name) : name);
        } catch { /* swallow */ }
      }
    });
  }
  entry.pendingEvents.add(key);
}

function encodeFilename(name: string): Uint8Array {
  // Node returns a Buffer when encoding='buffer'; Buffer is a Uint8Array
  // subclass, and our wrapper layer (fs.polyfill.ts in the webcontainer)
  // wraps this with Buffer.from() if the host environment has Buffer.
  return new TextEncoder().encode(name);
}

// ========== Path matching ==========

function matchWatcher(entry: WatchEntry, mutatedPath: string): string | null {
  const { absPath, recursive } = entry;

  // Exact match (watching a specific file, or the directory itself was modified)
  if (mutatedPath === absPath) {
    return path.basename(mutatedPath);
  }

  // Build the prefix that child paths must start with.
  // For root '/', prefix stays '/' — every absolute path is inside root.
  // For '/foo', prefix becomes '/foo/' — prevents matching '/foobar/x'.
  const prefix = absPath.endsWith('/') ? absPath : absPath + '/';
  if (!mutatedPath.startsWith(prefix)) {
    return null;
  }

  const relativePath = mutatedPath.substring(prefix.length);

  if (recursive) return relativePath;

  // Non-recursive: only direct children (no '/' in relative path)
  return relativePath.indexOf('/') === -1 ? relativePath : null;
}

// ========== fs.watch() ==========

/**
 * The object `fs.watch` hands back.
 *
 * Node's is an `EventEmitter`, and `watcher.on('change', …)` is how the docs show a watcher used
 * once the listener is not passed inline — code written that way against a plain
 * `{ close, ref, unref }` object died on `watcher.on is not a function`. The listener argument is
 * simply registered for `'change'`, which is what node does with it too, so both spellings drive
 * the same list.
 */
class VFSWatcher extends SimpleEventEmitter implements FSWatcher {
  #stop: () => void;
  #closed = false;

  constructor(stop: () => void) {
    super();
    this.#stop = stop;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#stop();
    this.emit('close');
  }

  /**
   * Node's watchers hold the event loop open and `ref`/`unref` say whether they should. There is
   * no loop to hold open in a browser, so these keep the chainable shape and do nothing.
   */
  ref(): this { return this; }
  unref(): this { return this; }
}

/**
 * The object `fs.watchFile` hands back — node's `StatWatcher`.
 *
 * It answered `undefined`, so `fs.watchFile(p, cb).unref()` threw, and the `'change'` event this
 * emits alongside the listener had nowhere to be registered.
 */
class VFSStatWatcher extends SimpleEventEmitter {
  #stop: () => void;

  constructor(stop: () => void) {
    super();
    this.#stop = stop;
  }

  /** `stop()` is `unwatchFile` for this listener alone — see node's `StatWatcher#stop`. */
  stop(): void { this.#stop(); }
  ref(): this { return this; }
  unref(): this { return this; }
}

export function watch(
  ns: string,
  syncRequest: SyncRequestFn,
  filePath: string,
  options?: WatchOptions | string | WatchListener,
  listener?: WatchListener
): FSWatcher {
  // Node's signature is `fs.watch(filename[, options][, listener])` — options is optional in the
  // middle, so the listener frequently arrives in its slot. `fs.watch(dir, cb)` is the form the
  // docs lead with and the one nearly all callers use.
  //
  // This used to accept the listener only in the third position: a two-argument call stored the
  // callback as the options object and installed a no-op listener, so the watcher registered
  // successfully, reported no error, and never fired. Three-argument calls worked, which is why
  // it went unnoticed.
  const listenerInOptions = typeof options === 'function';
  const cb: WatchListener | undefined = listenerInOptions ? options as WatchListener : listener;
  const opts: WatchOptions = typeof options === 'string'
    ? { encoding: options as any }
    : (listenerInOptions || options == null ? {} : options as WatchOptions);
  const absPath = path.resolve(filePath);
  const signal = opts.signal;
  const asBuffer = (opts as { encoding?: string }).encoding === 'buffer';

  // Node throws ENOENT here rather than handing back a watcher that can never fire — inotify and
  // FSEvents both need something to watch. Registering silently is worse than it sounds: the
  // caller's watch appears to be running, so a mistyped path looks like a filesystem that never
  // changes. Reported as `watch` rather than the `stat` that discovered it, which is the call the
  // caller actually made.
  try {
    statSync(syncRequest, absPath);
  } catch (err) {
    const code = (err as { code?: string }).code;
    // `EIO` is not an answer about the path — it is the transport declining to give one.
    //
    // A follower's first synchronous call can fail this way while its leader port is still
    // unproven: the call is refused quickly by design, because the alternative is a ten-second
    // stall. `fs.watch` making an existence check its very first call meant a tab could lose the
    // election, have this check refused, and throw — registering no watcher at all. That tab
    // then never saw another change for the rest of its life, while every other tab worked.
    // Measured at roughly one tab in sixteen, and the counters are unambiguous: `watch()` was
    // entered and never reached the channel registration below.
    //
    // Node throws here to catch a path that does not exist, which is a permanent fact about the
    // filesystem. A transport hiccup is not, so it must not be treated as one — register the
    // watcher and let it deliver once the leader is reachable.
    if (code !== 'EIO') {
      // Only a filesystem error is restated as `watch`; anything else — a transport that is not
      // wired up, say — is a different failure and travels unchanged rather than being disguised
      // as a missing file.
      throw code ? createError(code, 'watch', filePath) : err;
    }
  }

  // One watcher, one release — however many times it is torn down.
  //
  // Closing and aborting both used to release, and `close()` can be called more than once, so a
  // watcher could give back more references than it took. The channel is shared by every watcher
  // in the context, so the refcount hitting zero early closed it *while other watchers were still
  // registered* — and those watchers went silent for good. Reported as one tab out of four whose
  // watcher stopped firing, which is exactly what a prematurely closed channel looks like.
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    watchers.delete(entry);
    releaseBc(ns);
  };

  const watcher = new VFSWatcher(release);
  if (cb) watcher.on('change', cb as (...args: unknown[]) => void);

  const entry: WatchEntry = {
    ns,
    absPath,
    recursive: opts.recursive ?? false,
    listener: (eventType, filename) => watcher.emit('change', eventType, filename),
    signal,
    asBuffer,
    pendingEvents: null,
  };

  ensureBc(ns);
  watchers.add(entry);

  // AbortSignal support
  if (signal) {
    const onAbort = () => {
      release();
      signal.removeEventListener('abort', onAbort);
    };
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort);
    }
  }

  return watcher;
}

// ========== fs.watchFile() ==========

export function watchFile(
  ns: string,
  syncRequest: SyncRequestFn,
  filePath: string,
  optionsOrListener?: WatchFileOptions | WatchFileListener,
  listener?: WatchFileListener
): VFSStatWatcher {
  let opts: WatchFileOptions;
  let cb: WatchFileListener;

  if (typeof optionsOrListener === 'function') {
    cb = optionsOrListener;
    opts = {};
  } else {
    opts = optionsOrListener ?? {};
    cb = listener!;
  }

  const absPath = path.resolve(filePath);
  // A listener is not strictly required — node still hands back a watcher, and `'change'` can be
  // subscribed to afterwards. Nothing is polled until there is somewhere to deliver.
  if (!cb) return new VFSStatWatcher(() => {});
  const interval = opts.interval ?? 5007; // Node.js default

  let prevStats: Stats | null = null;
  try { prevStats = statSync(syncRequest, absPath) as Stats; } catch { /* file may not exist */ }

  // `stop()` is `unwatchFile` for this listener alone. The watcher rides *alongside* the
  // listener rather than wrapping it, because `unwatchFile(path, listener)` finds an entry by
  // comparing against the function the caller passed — a wrapper would make it unfindable.
  const watcher = new VFSStatWatcher(() => unwatchFile(ns, filePath, cb));

  const entry: WatchFileEntry = {
    ns,
    absPath,
    listener: cb,
    watcher,
    interval,
    prevStats,
    syncRequest,
    timerId: null,
  };

  ensureBc(ns);
  let set = fileWatchers.get(absPath);
  if (!set) {
    set = new Set();
    fileWatchers.set(absPath, set);
  }
  set.add(entry);

  // Fallback polling (Node.js watchFile uses stat polling)
  entry.timerId = setInterval(() => triggerWatchFile(entry), interval);

  return watcher;
}

// ========== fs.unwatchFile() ==========

export function unwatchFile(
  ns: string,
  filePath: string,
  listener?: WatchFileListener
): void {
  const absPath = path.resolve(filePath);
  const set = fileWatchers.get(absPath);
  if (!set) return;

  if (listener) {
    for (const entry of set) {
      if (entry.listener === listener) {
        if (entry.timerId !== null) clearInterval(entry.timerId);
        set.delete(entry);
        releaseBc(ns);
        break;
      }
    }
    if (set.size === 0) fileWatchers.delete(absPath);
  } else {
    for (const entry of set) {
      if (entry.timerId !== null) clearInterval(entry.timerId);
      releaseBc(ns);
    }
    fileWatchers.delete(absPath);
  }
}

// ========== watchFile trigger ==========

function triggerWatchFile(entry: WatchFileEntry): void {
  let currStats: Stats | null = null;
  try { currStats = statSync(entry.syncRequest, entry.absPath) as Stats; } catch { /* file gone */ }

  const prev = entry.prevStats ?? emptyStats();
  const curr = currStats ?? emptyStats();

  if (prev.mtimeMs !== curr.mtimeMs || prev.size !== curr.size || prev.ino !== curr.ino) {
    entry.prevStats = currStats;
    try { entry.listener(curr, prev); } catch { /* swallow */ }
    try { entry.watcher?.emit('change', curr, prev); } catch { /* swallow */ }
  }
}

export function emptyStats(): Stats {
  // Every field zero, including `mode` — so the prototype's S_IFMT checks all report false,
  // which is what the previous hand-written literal did explicitly.
  return new StatsClass(0, 0, 0, 0, 0, 0, 4096, 0, 0, 0, 0, 0, 0, 0);
}

// ========== promises.watch() ==========

export async function* watchAsync(
  ns: string,
  _asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: WatchOptions
): AsyncIterable<WatchEventType> {
  const absPath = path.resolve(filePath);
  const recursive = options?.recursive ?? false;
  const signal = options?.signal;

  const queue: WatchEventType[] = [];
  let resolve: (() => void) | null = null;

  const asBuffer = (options as { encoding?: string } | undefined)?.encoding === 'buffer';
  const entry: WatchEntry = {
    ns,
    absPath,
    recursive,
    listener: (eventType, filename) => {
      queue.push({ eventType, filename });
      if (resolve) { resolve(); resolve = null; }
    },
    signal,
    asBuffer,
    pendingEvents: null,
  };

  ensureBc(ns);
  watchers.add(entry);

  try {
    while (!signal?.aborted) {
      if (queue.length === 0) {
        await new Promise<void>(r => { resolve = r; });
      }
      while (queue.length > 0) {
        yield queue.shift()!;
      }
    }
  } finally {
    watchers.delete(entry);
    releaseBc(ns);
  }
}
