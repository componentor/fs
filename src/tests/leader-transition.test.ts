/**
 * Tests for leader-transition readiness tracking:
 * - `transitioning` flag set during promoteToLeader and cleared on the new
 *   sync-relay's 'ready' signal
 * - `ready` getter (isReady && !transitioning)
 * - `whenReady()` resolution across the three states (ready, transitioning,
 *   initial-not-ready) and that it waits for the *next* ready after a promotion
 * - `fireReadyListeners()` snapshot/clear/guard semantics
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VFSFileSystem } from '../src/index.js';

/** Minimal Worker stub — records the latest onmessage handler so tests can
 *  drive lifecycle messages, and no-ops everything the FS posts at it. */
class FakeWorker {
  onmessage: ((e: { data: any }) => void) | null = null;
  postMessage(): void {}
  terminate(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

let rootCounter = 0;

/** Construct a VFSFileSystem with workers stubbed out and the broker/async
 *  init side-effects neutralized, so we can drive the readiness state machine
 *  deterministically without a browser. Each call uses a unique root so the
 *  singleton registry and Web-Lock names don't collide across tests. */
function makeFS(): any {
  const prevWorker = (globalThis as any).Worker;
  (globalThis as any).Worker = FakeWorker;
  let fs: any;
  try {
    fs = new VFSFileSystem({ root: `/leader-transition-${rootCounter++}` });
  } finally {
    (globalThis as any).Worker = prevWorker;
  }
  // promoteToLeader re-spawns workers via spawnWorker — keep that returning a
  // stub so it works without the global Worker.
  fs.spawnWorker = () => new FakeWorker();
  // Neutralize the heavy side-effects the 'ready' handlers trigger so the
  // tests isolate the readiness state machine.
  fs.initAsyncRelay = () => {};
  fs.initLeaderBroker = () => {};
  return fs;
}

/** Simulate the sync-relay posting its 'ready' message to the main thread. */
function signalReady(fs: any): void {
  fs.syncWorker.onmessage({ data: { type: 'ready' } });
}

describe('leader transition — ready getter', () => {
  let fs: any;
  beforeEach(() => { fs = makeFS(); });
  afterEach(() => { fs = undefined; });

  it('is false before the first ready signal', () => {
    expect(fs.ready).toBe(false);
  });

  it('is true after ready with no transition in flight', () => {
    signalReady(fs);
    expect(fs.ready).toBe(true);
  });

  it('is false while transitioning even if isReady is true', () => {
    fs.isReady = true;
    fs.transitioning = true;
    expect(fs.ready).toBe(false);
  });

  it('is false when neither ready nor transitioning has resolved', () => {
    fs.isReady = false;
    fs.transitioning = false;
    expect(fs.ready).toBe(false);
  });
});

describe('leader transition — whenReady()', () => {
  let fs: any;
  beforeEach(() => { fs = makeFS(); });
  afterEach(() => { fs = undefined; });

  it('resolves immediately once ready and not transitioning', async () => {
    signalReady(fs);
    await expect(Promise.race([
      fs.whenReady().then(() => 'ready'),
      Promise.resolve('pending').then(() => 'pending'),
    ])).resolves.toBe('ready');
  });

  it('before first ready, resolves when the initial ready arrives', async () => {
    let resolved = false;
    const p = fs.whenReady().then(() => { resolved = true; });
    expect(resolved).toBe(false);
    signalReady(fs);
    await p;
    expect(resolved).toBe(true);
  });

  it('during a transition, waits for the NEXT ready (not the stale promise)', async () => {
    signalReady(fs); // first lifecycle ready — readyPromise is now resolved
    expect(fs.ready).toBe(true);

    fs.promoteToLeader(); // sets transitioning = true, isReady = false
    expect(fs.transitioning).toBe(true);
    expect(fs.ready).toBe(false);

    let resolved = false;
    const p = fs.whenReady().then(() => { resolved = true; });
    // Must NOT resolve off the stale (already-resolved) readyPromise.
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(fs.readyListeners.size).toBe(1);

    signalReady(fs); // new sync-relay ready
    await p;
    expect(resolved).toBe(true);
    expect(fs.ready).toBe(true);
    expect(fs.readyListeners.size).toBe(0);
  });
});

describe('leader transition — promoteToLeader wiring', () => {
  it('sets transitioning and clears isReady, then clears transitioning on ready', () => {
    const fs = makeFS();
    signalReady(fs);
    expect(fs.isReady).toBe(true);
    expect(fs.transitioning).toBe(false);

    fs.promoteToLeader();
    expect(fs.isFollower).toBe(false);
    expect(fs.isReady).toBe(false);
    expect(fs.transitioning).toBe(true);

    signalReady(fs);
    expect(fs.isReady).toBe(true);
    expect(fs.transitioning).toBe(false);
  });
});

describe('leader transition — fireReadyListeners()', () => {
  it('invokes every listener once and clears the set', () => {
    const fs = makeFS();
    let a = 0;
    let b = 0;
    fs.readyListeners.add(() => { a++; });
    fs.readyListeners.add(() => { b++; });
    fs.fireReadyListeners();
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(fs.readyListeners.size).toBe(0);
    fs.fireReadyListeners(); // no listeners left — must not re-fire
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it('a throwing listener does not prevent the others from running', () => {
    const fs = makeFS();
    let reached = false;
    fs.readyListeners.add(() => { throw new Error('boom'); });
    fs.readyListeners.add(() => { reached = true; });
    expect(() => fs.fireReadyListeners()).not.toThrow();
    expect(reached).toBe(true);
    expect(fs.readyListeners.size).toBe(0);
  });
});
