/**
 * Fairness ticket lock tests.
 *
 * These run in the browser main thread (vitest browser mode), where
 * `Atomics.wait` is disallowed — so they exercise the lock's main-thread path
 * and, crucially, prove the UNCONTENDED case never blocks (a single client
 * driving one SAB must pay only a couple of atomics and proceed). True multi-
 * client contention / dead-holder recovery is a multi-worker concern verified by
 * the host integration; here we lock down the invariants that guarantee the
 * library's own single-client `syncRequest` behaviour is unchanged.
 */

import { describe, it, expect } from 'vitest';
import { acquireFsLock, releaseFsLock } from '../src/protocol/fs-lock.js';
import { SAB_OFFSETS } from '../src/protocol/opcodes.js';

const NEXT = SAB_OFFSETS.TICKET_NEXT >> 2;
const SERVING = SAB_OFFSETS.TICKET_SERVING >> 2;

function freshCtrl(): Int32Array {
  // A minimal control header (32 bytes = 8 Int32 slots), zero-initialised.
  const sab = new SharedArrayBuffer(SAB_OFFSETS.HEADER_SIZE);
  return new Int32Array(sab, 0, 8);
}

describe('fs-lock ticket lock', () => {
  it('uncontended acquire returns its ticket immediately and starts at 0', () => {
    const ctrl = freshCtrl();
    const t = acquireFsLock(ctrl);
    expect(t).toBe(0);
    // We hold ticket 0; NEXT advanced, SERVING not yet (release advances it).
    expect(Atomics.load(ctrl, NEXT)).toBe(1);
    expect(Atomics.load(ctrl, SERVING)).toBe(0);
    releaseFsLock(ctrl);
    expect(Atomics.load(ctrl, SERVING)).toBe(1);
  });

  it('hands out strictly sequential tickets and keeps NEXT/SERVING in lockstep', () => {
    const ctrl = freshCtrl();
    for (let i = 0; i < 50; i++) {
      const t = acquireFsLock(ctrl);
      expect(t).toBe(i); // FIFO ticket order
      // While held: NEXT is one ahead of SERVING.
      expect(Atomics.load(ctrl, NEXT)).toBe(i + 1);
      expect(Atomics.load(ctrl, SERVING)).toBe(i);
      releaseFsLock(ctrl);
      // After release: NEXT and SERVING march in lockstep (uncontended invariant).
      expect(Atomics.load(ctrl, SERVING)).toBe(Atomics.load(ctrl, NEXT));
    }
  });

  it('release advances SERVING by exactly one', () => {
    const ctrl = freshCtrl();
    acquireFsLock(ctrl);
    const before = Atomics.load(ctrl, SERVING);
    releaseFsLock(ctrl);
    expect(Atomics.load(ctrl, SERVING)).toBe(before + 1);
  });

  it('a long uncontended sequence never blocks', () => {
    const ctrl = freshCtrl();
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      acquireFsLock(ctrl);
      releaseFsLock(ctrl);
    }
    // 10k lock cycles are pure atomics — must complete near-instantly. A blocking
    // bug (e.g. an accidental Atomics.wait on the fast path) would hang for
    // seconds or throw on the main thread; assert a generous ceiling.
    expect(performance.now() - start).toBeLessThan(1000);
    expect(Atomics.load(ctrl, NEXT)).toBe(10_000);
    expect(Atomics.load(ctrl, SERVING)).toBe(10_000);
  });

  it('fast path: when SERVING already equals the drawn ticket, acquire is immediate', () => {
    const ctrl = freshCtrl();
    // Simulate a SAB that has already serviced some ops (NEXT==SERVING==7).
    Atomics.store(ctrl, NEXT, 7);
    Atomics.store(ctrl, SERVING, 7);
    const t0 = performance.now();
    const t = acquireFsLock(ctrl);
    expect(t).toBe(7);
    expect(performance.now() - t0).toBeLessThan(50); // no spin, no wait
    releaseFsLock(ctrl);
    expect(Atomics.load(ctrl, SERVING)).toBe(8);
  });

  it('lock state survives being carried on a populated header without touching other slots', () => {
    const ctrl = freshCtrl();
    // Pre-populate the protocol slots the relay uses; the lock must not disturb
    // them, and they must not disturb the lock.
    Atomics.store(ctrl, SAB_OFFSETS.CONTROL >> 2, 2); // SIGNAL.RESPONSE
    Atomics.store(ctrl, SAB_OFFSETS.CHUNK_LEN >> 2, 1234);
    Atomics.store(ctrl, SAB_OFFSETS.CHUNK_IDX >> 2, 3);
    Atomics.store(ctrl, SAB_OFFSETS.HEARTBEAT >> 2, 99);

    acquireFsLock(ctrl);
    releaseFsLock(ctrl);

    // Untouched by the lock.
    expect(Atomics.load(ctrl, SAB_OFFSETS.CONTROL >> 2)).toBe(2);
    expect(Atomics.load(ctrl, SAB_OFFSETS.CHUNK_LEN >> 2)).toBe(1234);
    expect(Atomics.load(ctrl, SAB_OFFSETS.CHUNK_IDX >> 2)).toBe(3);
    expect(Atomics.load(ctrl, SAB_OFFSETS.HEARTBEAT >> 2)).toBe(99);
    // Lock slots moved as expected.
    expect(Atomics.load(ctrl, NEXT)).toBe(1);
    expect(Atomics.load(ctrl, SERVING)).toBe(1);
  });
});
