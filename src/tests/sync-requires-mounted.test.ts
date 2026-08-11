/**
 * Synchronous calls require a mounted volume, and never wait for one.
 *
 * Waiting is not something a synchronous call can do here, however it is dressed up. Mounting runs
 * on an event loop — the retry is a `setTimeout`, the first attempt comes from a `navigator.locks`
 * callback — and a synchronous call blocks that event loop: a page's main thread has to busy-loop,
 * `Atomics.wait` being illegal there, and in a worker `Atomics.wait` blocks the agent just as
 * completely. The thread that would perform the mount is the thread waiting for it, so the volume
 * never arrives and the wait ends at whatever watchdog notices first — a frozen tab, and nothing
 * mounted at the end of it.
 *
 * So an unmounted volume refuses synchronous callers outright, and the rule is the same everywhere:
 * no thread, no elapsed time, no first-call-versus-handover distinction enters into it. Note what
 * these do NOT assert, because it is the other half of the design: nothing here limits how long a
 * mounted filesystem may take to serve a call. A large read or write takes as long as it takes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VFSFileSystem } from '../src/index.js';

/** Minimal Worker stub — nothing answers, so the volume stays unmounted for as long as we like. */
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  postMessage(): void {}
  terminate(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

let rootCounter = 0;

function makeFS(): any {
  const prevWorker = (globalThis as any).Worker;
  (globalThis as any).Worker = FakeWorker;
  let fs: any;
  try {
    fs = new VFSFileSystem({ root: `/sync-mount-${rootCounter++}` });
  } finally {
    (globalThis as any).Worker = prevWorker;
  }
  fs.spawnWorker = () => new FakeWorker();
  fs.initAsyncRelay = () => {};
  fs.initLeaderBroker = () => {};
  return fs;
}

/** 0 = not mounted, 1 = mounted, -1 = permanently failed. */
const setSignal = (f: any, v: number) => Atomics.store(f.readySignal, 0, v);

let fs: any;
beforeEach(() => { fs = makeFS(); });
afterEach(() => { fs = undefined; });

describe('an unmounted volume', () => {
  it('refuses a synchronous call rather than waiting for a mount it is blocking', () => {
    setSignal(fs, 0);
    expect(() => fs.ensureReady()).toThrow(/not mounted yet/i);
  });

  it('refuses immediately — there is no wait to sit through', () => {
    setSignal(fs, 0);
    const started = performance.now();
    expect(() => fs.ensureReady()).toThrow();
    // The old behaviour spun until a watchdog fired, which took 30s. This is a state check.
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('refuses every synchronous entry point, not just one', () => {
    setSignal(fs, 0);
    // The rule is about the filesystem's state, so it cannot depend on which call arrives first.
    expect(() => fs.readFileSync('/a')).toThrow(/not mounted yet/i);
    expect(() => fs.writeFileSync('/a', 'x')).toThrow(/not mounted yet/i);
    expect(() => fs.statSync('/a')).toThrow(/not mounted yet/i);
    expect(() => fs.readdirSync('/')).toThrow(/not mounted yet/i);
    expect(() => fs.mkdirSync('/d')).toThrow(/not mounted yet/i);
  });

  it('says what to do about it, in each of the three forms', () => {
    setSignal(fs, 0);
    expect(() => fs.ensureReady()).toThrow(/fs\.init\(\)/i);
    expect(() => fs.ensureReady()).toThrow(/whenReady/i);
    expect(() => fs.ensureReady()).toThrow(/fs\.promises/i);
  });

  it('explains that waiting is futile rather than merely discouraged', () => {
    setSignal(fs, 0);
    // Someone reading this error should not go looking for a way to wait longer.
    expect(() => fs.ensureReady()).toThrow(/futile|blocks/i);
  });
});

describe('a mounted volume', () => {
  it('serves synchronous calls, and stops re-checking once it has', () => {
    setSignal(fs, 1);
    expect(() => fs.ensureReady()).not.toThrow();
    expect(fs.isReady).toBe(true);

    // Unmounting the signal underneath a filesystem that has already mounted must not start
    // refusing mid-session: readiness is latched, and a handover routes through its own path.
    setSignal(fs, 0);
    expect(() => fs.ensureReady()).not.toThrow();
  });
});

describe('a volume that failed permanently', () => {
  it('reports the cause, not the state it left behind', () => {
    setSignal(fs, -1);
    fs.initError = new Error('Corrupt VFS: bad magic');
    // "Not mounted yet" would be true and useless; the caller needs the reason it never will be.
    expect(() => fs.ensureReady()).toThrow(/corrupt vfs/i);
    expect(() => fs.ensureReady()).not.toThrow(/not mounted yet/i);
  });

  it('still reports something when the cause was never recorded', () => {
    setSignal(fs, -1);
    fs.initError = null;
    expect(() => fs.ensureReady()).toThrow(/initialization failed/i);
  });
});
