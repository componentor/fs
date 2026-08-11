/**
 * The bounded wait for a volume that will not open.
 *
 * Retrying an `init-failed` is right when the previous leader's exclusive handle has simply not
 * been reclaimed yet: that clears on its own, usually in milliseconds. It is wrong when the origin
 * has no usable OPFS at all — private browsing, blocked site data, an ephemeral automation profile
 * — which fails the same way and forever. Retried without a bound, `init()` never settles: no
 * resolve, no reject, nothing logged.
 *
 * So the retries carry a deadline, and what these pin down is its *scope*. The deadline measures
 * one run of retries, which means the success that ends a run has to reset it — on both paths that
 * retry, first open and promotion. A clock left running is worse than having no deadline, because
 * the next ordinary handoff is then abandoned on its first attempt, as though a handle that needed
 * 25ms were an origin with no storage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VFSFileSystem } from '../src/index.js';

/** Minimal Worker stub — the FS only needs somewhere to post and an `onmessage` to drive. */
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  postMessage(): void {}
  terminate(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

let rootCounter = 0;

/**
 * A filesystem with its workers stubbed out, so the retry state machine can be driven directly.
 *
 * `sendLeaderInit` is neutralized along with the other side-effects: the scheduled retry is not
 * what is under test here, and letting it run would put a second `init-failed` into the sequence
 * that the test did not write.
 */
function makeFS(): any {
  const prevWorker = (globalThis as any).Worker;
  (globalThis as any).Worker = FakeWorker;
  let fs: any;
  try {
    fs = new VFSFileSystem({ root: `/volume-deadline-${rootCounter++}` });
  } finally {
    (globalThis as any).Worker = prevWorker;
  }
  fs.spawnWorker = () => new FakeWorker();
  fs.initAsyncRelay = () => {};
  fs.initLeaderBroker = () => {};
  fs.sendLeaderInit = () => {};
  return fs;
}

const BUSY = 'NoModificationAllowedError: handle still held';
const failOpen = (fs: any, error = BUSY) => fs.syncWorker.onmessage({ data: { type: 'init-failed', error } });
const signalReady = (fs: any) => fs.syncWorker.onmessage({ data: { type: 'ready' } });

/** Swallow the rejection this run is expected to produce, and hand back the error it carries. */
const captureFailure = (fs: any): Promise<Error> => fs.readyPromise.catch((e: Error) => e);

let fs: any;

beforeEach(() => {
  vi.useFakeTimers();
  fs = makeFS();
  fs.holdingLeaderLock = true;   // the first-open path only retries while this instance is leader
});
afterEach(() => { vi.useRealTimers(); fs = undefined; });

describe('while the deadline has not passed', () => {
  it('retries, starting fast and backing off', () => {
    failOpen(fs);
    expect(fs.volumeRetryDelayMs).toBe(25);
    failOpen(fs);
    expect(fs.volumeRetryDelayMs).toBe(50);
    failOpen(fs);
    expect(fs.volumeRetryDelayMs).toBe(100);
    expect(fs.initError).toBe(null);
  });

  it('caps the backoff rather than growing without limit', () => {
    for (let i = 0; i < 12; i++) failOpen(fs);
    expect(fs.volumeRetryDelayMs).toBe(500);
    expect(fs.initError).toBe(null);
  });
});

describe('once the deadline passes', () => {
  it('fails the instance instead of retrying forever', async () => {
    const failure = captureFailure(fs);
    failOpen(fs, 'SecurityError: storage is not available');
    expect(fs.initError).toBe(null);   // the first failure only starts the clock

    vi.setSystemTime(Date.now() + 16_000);
    failOpen(fs, 'SecurityError: storage is not available');

    expect(fs.initError).toBeInstanceOf(Error);
    const err = await failure;
    // The message has to name the likely cause: the whole point is that this used to surface as
    // nothing at all.
    expect(err.message).toContain('SecurityError: storage is not available');
    expect(err.message).toContain('OPFS');
  });

  it('gives the leader lock back so another tab can try', async () => {
    const failure = captureFailure(fs);
    let released = 0;
    fs.releaseLeaderLock = () => { released++; };

    failOpen(fs);
    vi.setSystemTime(Date.now() + 16_000);
    failOpen(fs);
    await failure;

    // Holding it while permanently failed would queue every other tab behind an instance that
    // will never serve them.
    expect(released).toBe(1);
    expect(fs.holdingLeaderLock).toBe(false);
    expect(fs.releaseLeaderLock).toBe(null);
  });

  it('does not report an uncaught rejection when nothing is awaiting', async () => {
    // Deliberately no `captureFailure`: a promotion happens because a lock came free, not because
    // a caller asked, so there is frequently nothing attached at the moment this rejects. An
    // unhandled rejection here fails the run, which is the assertion — there is nothing else to
    // observe, since a handled rejection and an unhandled one look identical from inside.
    failOpen(fs);
    vi.setSystemTime(Date.now() + 16_000);
    failOpen(fs);
    expect(fs.initError).toBeInstanceOf(Error);

    // Let the runtime get to the point where it would report one.
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 10));
  });

  it('wakes a blocked sync caller with the permanent-failure signal', async () => {
    const failure = captureFailure(fs);
    failOpen(fs);
    vi.setSystemTime(Date.now() + 16_000);
    failOpen(fs);
    await failure;

    expect(Atomics.load(fs.readySignal, 0)).toBe(-1);
    // `ensureReady` reads that signal and throws rather than spinning on a volume that is not
    // coming.
    expect(() => fs.ensureReady()).toThrow(/Could not open the volume/);
  });
});

describe('the deadline measures one run of retries', () => {
  it('is reset by a first open that eventually succeeds', () => {
    failOpen(fs);
    expect(fs.volumeRetryStartedAt).not.toBe(0);
    signalReady(fs);
    expect(fs.volumeRetryStartedAt).toBe(0);
    expect(fs.volumeRetryDelayMs).toBe(0);
  });

  it('is reset by a promotion that eventually succeeds', () => {
    fs.promoteToLeader();
    failOpen(fs);
    expect(fs.volumeRetryStartedAt).not.toBe(0);
    signalReady(fs);
    expect(fs.volumeRetryStartedAt).toBe(0);
    expect(fs.volumeRetryDelayMs).toBe(0);
  });

  it('does not let a promotion that retried abandon the next wait', () => {
    // The consequence of leaving the clock running, and the reason it is worth asserting twice:
    // a promotion that needed one retry, an hour of ordinary use, and then a handoff that needs
    // the same 25ms wait — which must be waited for, not declared permanent.
    fs.promoteToLeader();
    failOpen(fs);
    signalReady(fs);

    vi.setSystemTime(Date.now() + 3_600_000);

    failOpen(fs);
    expect(fs.initError).toBe(null);
    expect(fs.volumeRetryDelayMs).toBe(25);
  });
});
