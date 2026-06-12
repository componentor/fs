/**
 * Tests for the deadline-aware SAB wait primitives used by the relay
 * protocol (sab-wait.ts). These are what turn a dead counterpart from
 * "worker wedged forever on a timeout-less Atomics.wait" into a clean
 * SabWaitTimeoutError → EIO.
 */

import { describe, it, expect } from 'vitest';
import { Worker } from 'node:worker_threads';
import { waitWhile, waitUntil, SabWaitTimeoutError } from '../src/protocol/sab-wait.js';

function makeCtrl(initial: number): Int32Array {
  const sab = new SharedArrayBuffer(32);
  const ctrl = new Int32Array(sab, 0, 8);
  ctrl[0] = initial;
  return ctrl;
}

/** Spawn a worker thread that stores `value` into ctrl[0] after `delayMs`
 *  and notifies waiters — a real cross-thread counterpart. */
function flipLater(ctrl: Int32Array, value: number, delayMs: number): Worker {
  return new Worker(
    `
    const { workerData } = require('node:worker_threads');
    const ctrl = new Int32Array(workerData.sab, 0, 8);
    setTimeout(() => {
      Atomics.store(ctrl, 0, workerData.value);
      Atomics.notify(ctrl, 0);
    }, workerData.delayMs);
    `,
    { eval: true, workerData: { sab: ctrl.buffer, value, delayMs } }
  );
}

describe('waitWhile', () => {
  it('returns immediately when the value already differs', () => {
    const ctrl = makeCtrl(2);
    const start = Date.now();
    waitWhile(ctrl, 1, Date.now() + 5000, 'test');
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('throws SabWaitTimeoutError when the value never changes', () => {
    const ctrl = makeCtrl(1);
    expect(() => waitWhile(ctrl, 1, Date.now() + 60, 'never-changes')).toThrow(SabWaitTimeoutError);
  });

  it('includes the detail string in the error message', () => {
    const ctrl = makeCtrl(1);
    expect(() => waitWhile(ctrl, 1, Date.now() + 30, 'request chunk ack')).toThrow(/request chunk ack/);
  });

  it('wakes when another thread changes the value and notifies', async () => {
    const ctrl = makeCtrl(1);
    const worker = flipLater(ctrl, 2, 30);
    try {
      const start = Date.now();
      waitWhile(ctrl, 1, Date.now() + 5000, 'cross-thread');
      const elapsed = Date.now() - start;
      expect(Atomics.load(ctrl, 0)).toBe(2);
      expect(elapsed).toBeLessThan(2000); // woke via notify, not deadline
    } finally {
      await worker.terminate();
    }
  });

  it('an already-expired deadline still throws rather than blocking', () => {
    const ctrl = makeCtrl(1);
    expect(() => waitWhile(ctrl, 1, Date.now() - 1, 'expired')).toThrow(SabWaitTimeoutError);
  });
});

describe('waitUntil', () => {
  it('returns the matching signal immediately', () => {
    const ctrl = makeCtrl(3);
    expect(waitUntil(ctrl, [2, 3], Date.now() + 5000, 'test')).toBe(3);
  });

  it('throws SabWaitTimeoutError when no accepted signal ever appears', () => {
    const ctrl = makeCtrl(4);
    expect(() => waitUntil(ctrl, [2, 3], Date.now() + 60, 'no-signal')).toThrow(SabWaitTimeoutError);
  });

  it('wakes and returns when another thread sets an accepted signal', async () => {
    const ctrl = makeCtrl(4);
    const worker = flipLater(ctrl, 2, 30);
    try {
      const result = waitUntil(ctrl, [2, 3], Date.now() + 5000, 'cross-thread');
      expect(result).toBe(2);
    } finally {
      await worker.terminate();
    }
  });

  it('keeps waiting through non-accepted intermediate values', async () => {
    const ctrl = makeCtrl(4);
    // 4 → 5 (not accepted) → 2 (accepted)
    const worker = new Worker(
      `
      const { workerData } = require('node:worker_threads');
      const ctrl = new Int32Array(workerData.sab, 0, 8);
      setTimeout(() => { Atomics.store(ctrl, 0, 5); Atomics.notify(ctrl, 0); }, 20);
      setTimeout(() => { Atomics.store(ctrl, 0, 2); Atomics.notify(ctrl, 0); }, 50);
      `,
      { eval: true, workerData: { sab: ctrl.buffer } }
    );
    try {
      const result = waitUntil(ctrl, [2, 3], Date.now() + 5000, 'intermediate');
      expect(result).toBe(2);
    } finally {
      await worker.terminate();
    }
  });
});
