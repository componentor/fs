import type { WatchOptions, WatchEventType, FSWatcher, WatchListener, WatchFileListener, WatchFileOptions, Stats } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { statSync } from './stat.js';
import * as path from '../path.js';

// ========== Watcher Registry ==========

interface WatchEntry {
  ns: string;
  absPath: string;
  recursive: boolean;
  listener: WatchListener;
  signal?: AbortSignal;
}

interface WatchFileEntry {
  ns: string;
  absPath: string;
  listener: WatchFileListener;
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

function ensureBc(ns: string): void {
  const entry = bcMap.get(ns);
  if (entry) { entry.refCount++; return; }
  const bc = new BroadcastChannel(`${ns}-watch`);
  bcMap.set(ns, { bc, refCount: 1 });
  bc.onmessage = onBroadcast;
}

function releaseBc(ns: string): void {
  const entry = bcMap.get(ns);
  if (!entry) return;
  if (--entry.refCount <= 0) {
    entry.bc.close();
    bcMap.delete(ns);
  }
}

// ========== BroadcastChannel handler ==========

function onBroadcast(event: MessageEvent<{ eventType: 'change' | 'rename'; path: string }>): void {
  const { eventType, path: mutatedPath } = event.data;

  // Notify fs.watch() watchers
  for (const entry of watchers) {
    const filename = matchWatcher(entry, mutatedPath);
    if (filename !== null) {
      try { entry.listener(eventType, filename); } catch { /* swallow */ }
    }
  }

  // Notify fs.watchFile() watchers
  const fileSet = fileWatchers.get(mutatedPath);
  if (fileSet) {
    for (const entry of fileSet) {
      triggerWatchFile(entry);
    }
  }
}

// ========== Path matching ==========

function matchWatcher(entry: WatchEntry, mutatedPath: string): string | null {
  const { absPath, recursive } = entry;

  // Exact match (watching a specific file, or the directory itself was modified)
  if (mutatedPath === absPath) {
    return path.basename(mutatedPath);
  }

  // Check if mutatedPath is inside absPath (directory watching)
  if (!mutatedPath.startsWith(absPath) || mutatedPath.charAt(absPath.length) !== '/') {
    return null;
  }

  const relativePath = mutatedPath.substring(absPath.length + 1);

  if (recursive) return relativePath;

  // Non-recursive: only direct children (no '/' in relative path)
  return relativePath.indexOf('/') === -1 ? relativePath : null;
}

// ========== fs.watch() ==========

export function watch(
  ns: string,
  filePath: string,
  options?: WatchOptions | string,
  listener?: WatchListener
): FSWatcher {
  const opts: WatchOptions = typeof options === 'string'
    ? { encoding: options as any }
    : (options ?? {});

  const cb: WatchListener = listener ?? (() => {});
  const absPath = path.resolve(filePath);
  const signal = opts.signal;

  const entry: WatchEntry = {
    ns,
    absPath,
    recursive: opts.recursive ?? false,
    listener: cb,
    signal,
  };

  ensureBc(ns);
  watchers.add(entry);

  // AbortSignal support
  if (signal) {
    const onAbort = () => {
      watchers.delete(entry);
      releaseBc(ns);
      signal.removeEventListener('abort', onAbort);
    };
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort);
    }
  }

  const watcher: FSWatcher = {
    close() {
      watchers.delete(entry);
      releaseBc(ns);
    },
    ref() { return watcher; },
    unref() { return watcher; },
  };

  return watcher;
}

// ========== fs.watchFile() ==========

export function watchFile(
  ns: string,
  syncRequest: SyncRequestFn,
  filePath: string,
  optionsOrListener?: WatchFileOptions | WatchFileListener,
  listener?: WatchFileListener
): void {
  let opts: WatchFileOptions;
  let cb: WatchFileListener;

  if (typeof optionsOrListener === 'function') {
    cb = optionsOrListener;
    opts = {};
  } else {
    opts = optionsOrListener ?? {};
    cb = listener!;
  }

  if (!cb) return;

  const absPath = path.resolve(filePath);
  const interval = opts.interval ?? 5007; // Node.js default

  let prevStats: Stats | null = null;
  try { prevStats = statSync(syncRequest, absPath); } catch { /* file may not exist */ }

  const entry: WatchFileEntry = {
    ns,
    absPath,
    listener: cb,
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
  try { currStats = statSync(entry.syncRequest, entry.absPath); } catch { /* file gone */ }

  const prev = entry.prevStats ?? emptyStats();
  const curr = currStats ?? emptyStats();

  if (prev.mtimeMs !== curr.mtimeMs || prev.size !== curr.size || prev.ino !== curr.ino) {
    entry.prevStats = currStats;
    try { entry.listener(curr, prev); } catch { /* swallow */ }
  }
}

function emptyStats(): Stats {
  const zero = new Date(0);
  return {
    isFile: () => false,
    isDirectory: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    dev: 0, ino: 0, mode: 0, nlink: 0, uid: 0, gid: 0, rdev: 0,
    size: 0, blksize: 4096, blocks: 0,
    atimeMs: 0, mtimeMs: 0, ctimeMs: 0, birthtimeMs: 0,
    atime: zero, mtime: zero, ctime: zero, birthtime: zero,
  };
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

  const entry: WatchEntry = {
    ns,
    absPath,
    recursive,
    listener: (eventType, filename) => {
      queue.push({ eventType, filename });
      if (resolve) { resolve(); resolve = null; }
    },
    signal,
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
