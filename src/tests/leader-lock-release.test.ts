/**
 * `dispose()` must give the leader lock back.
 *
 * It did not. Leadership was held with `await new Promise(() => {})` — a promise nothing ever
 * resolved — on the reasoning that the lock is released when the tab closes. True, but a disposed
 * instance is not a closed tab. So the dead instance kept `<ns>-leader` for the life of the page,
 * and the next instance on the same volume lost the election to it: it started as a follower of a
 * leader whose relay workers had already been terminated, and its first synchronous call waited
 * for a reply that could never come, until the 30s stall guard.
 *
 * Reachable from the API's documented use — `dispose` exists precisely for "anything that creates
 * instances repeatedly, a test suite, an app that switches volumes". Found by clicking the demo's
 * main-thread button twice: the second click froze the tab for ~30s on Chrome.
 *
 * `navigator.locks` is stubbed here rather than mocked away, with the queueing semantics the real
 * thing has — `ifAvailable` yields null while held, waiters are served in order, a lock is
 * released when its callback settles. Without that the fallback path (`'locks' in navigator` is
 * false) runs instead and every instance believes it is leader, which is exactly the case that
 * cannot catch this.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VFSFileSystem } from '../src/index.js';

class FakeWorker {
  onmessage: ((e: { data: any }) => void) | null = null;
  postMessage(): void {}
  terminate(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

interface Waiter {
  run: () => void;
  signal?: AbortSignal;
  reject: (err: Error) => void;
}

/** A minimally faithful Web Locks implementation, one queue per name. */
class LockManagerStub {
  private held = new Set<string>();
  private queues = new Map<string, Waiter[]>();

  request(name: string, a: any, b?: any): Promise<void> {
    const options = typeof a === 'function' ? {} : a;
    const callback = typeof a === 'function' ? a : b;

    if (options.ifAvailable) {
      if (this.held.has(name)) return Promise.resolve(callback(null));
      return this.grant(name, callback);
    }

    if (!this.held.has(name)) return this.grant(name, callback);

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        reject,
        signal: options.signal,
        run: () => this.grant(name, callback).then(resolve, reject),
      };
      options.signal?.addEventListener('abort', () => {
        const queue = this.queues.get(name) ?? [];
        const at = queue.indexOf(waiter);
        if (at >= 0) queue.splice(at, 1);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
      this.queues.set(name, [...(this.queues.get(name) ?? []), waiter]);
    });
  }

  private async grant(name: string, callback: (lock: unknown) => unknown): Promise<void> {
    this.held.add(name);
    try {
      await callback({ name });
    } finally {
      this.held.delete(name);
      const next = this.queues.get(name)?.shift();
      if (next) next.run();
    }
  }

  isHeld(name: string): boolean { return this.held.has(name); }
  queueDepth(name: string): number { return (this.queues.get(name) ?? []).length; }
}

let locks: LockManagerStub;
let previousLocks: unknown;
let rootCounter = 0;

/** Instances share a root, so they contend for one lock — the situation the bug needed. */
function makeFS(root: string): any {
  const prevWorker = (globalThis as any).Worker;
  (globalThis as any).Worker = FakeWorker;
  let fs: any;
  try {
    fs = new VFSFileSystem({ root });
  } finally {
    (globalThis as any).Worker = prevWorker;
  }
  fs.spawnWorker = () => new FakeWorker();
  fs.initAsyncRelay = () => {};
  fs.initLeaderBroker = () => {};
  fs.initFollower = () => {};
  return fs;
}

/** The lock callbacks are async; let the microtask queue drain. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  locks = new LockManagerStub();
  previousLocks = (navigator as any).locks;
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true, writable: true });
});

afterEach(() => {
  Object.defineProperty(navigator, 'locks',
    { value: previousLocks, configurable: true, writable: true });
});

describe('leader lock is returned on dispose', () => {
  it('releases the lock so a later instance on the same volume leads', async () => {
    const root = `/lock-release-${rootCounter++}`;
    const first = makeFS(root);
    await settle();
    expect(first.isLeader).toBe(true);
    expect(locks.isHeld(`${first.ns}-leader`)).toBe(true);

    await first.dispose();
    await settle();
    // The bug: still held here, by an instance whose workers are gone.
    expect(locks.isHeld(`${first.ns}-leader`)).toBe(false);

    const second = makeFS(root);
    await settle();
    expect(second.isLeader).toBe(true);
    await second.dispose();
  });

  // Two *instances in one process* are not two tabs: they share a BroadcastChannel and a
  // globals registry, and the election settles differently than it does across real tabs. The
  // promotion and bid-withdrawal paths are therefore left to the browser suite rather than
  // asserted here against a stub that would only be describing itself.

  // Repeated create/dispose cycles are exercised against a real browser instead — the demo's
  // main-thread button, clicked several times, which is how this was found.
});
