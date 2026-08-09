/**
 * Callback Timing Tests
 *
 * Node guarantees a callback-style `fs` method never invokes its callback in the same turn:
 * callbacks are scheduled as macrotasks (`setTimeout`), not microtasks (`Promise.then`). Code
 * that relies on finishing its synchronous work before the callback runs depends on it.
 *
 * These drive the **real** methods via `Object.create(VFSFileSystem.prototype)` with only
 * `this.promises` stubbed, because the constructor needs workers and a SharedArrayBuffer. The
 * previous version re-implemented the scheduling it was checking, so it asserted that a
 * `setTimeout` in the test file calls `setTimeout` — true regardless of what the product does.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VFSFileSystem } from '../src/filesystem.js';

/** Build an fs whose callback methods are the shipped ones, over stubbed promises. */
function createRealFS() {
  const mockPromises = {
    readFile: vi.fn().mockResolvedValue(new Uint8Array([72, 105])),
    writeFile: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ size: 42 }),
    exists: vi.fn().mockResolvedValue(true),
  };

  const fs = Object.create(VFSFileSystem.prototype) as VFSFileSystem;
  (fs as unknown as { promises: unknown }).promises = mockPromises;

  return { fs, mockPromises };
}


describe('Callback Timing', () => {
  let fs: ReturnType<typeof createRealFS>['fs'];
  let mockPromises: ReturnType<typeof createRealFS>['mockPromises'];

  beforeEach(() => {
    vi.useFakeTimers();
    const mock = createRealFS();
    fs = mock.fs;
    mockPromises = mock.mockPromises;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('callback does not fire synchronously', () => {
    let called = false;
    fs.readFile('/test.txt', () => {
      called = true;
    });
    // Callback must not have fired yet -- the call just initiated async work
    expect(called).toBe(false);
  });

  it('callback does not fire as a microtask (Promise.then)', async () => {
    let called = false;
    fs.readFile('/test.txt', () => {
      called = true;
    });

    // Flush all microtasks by awaiting a resolved promise.
    // If the callback were scheduled via .then() without setTimeout,
    // it would fire during microtask draining.
    await Promise.resolve();
    await Promise.resolve(); // extra tick for the .then chain

    // Still not called -- setTimeout has not been drained yet
    expect(called).toBe(false);
  });

  it('callback fires after setTimeout(0) is drained (macrotask)', async () => {
    let callbackResult: any = null;
    fs.readFile('/test.txt', (err: Error | null, data?: Uint8Array) => {
      callbackResult = { err, data };
    });

    // Flush microtasks first (the promise resolves, setTimeout is queued)
    await Promise.resolve();
    await Promise.resolve();

    // Now advance timers to drain the macrotask queue
    vi.runAllTimers();

    expect(callbackResult).not.toBeNull();
    expect(callbackResult.err).toBeNull();
    expect(callbackResult.data).toEqual(new Uint8Array([72, 105]));
  });

  it('error callback fires as macrotask, not microtask', async () => {
    const testError = new Error('ENOENT');
    mockPromises.readFile.mockRejectedValue(testError);

    let receivedErr: Error | null = null;
    fs.readFile('/missing.txt', (err: Error | null) => {
      receivedErr = err;
    });

    // Flush microtasks
    await Promise.resolve();
    await Promise.resolve();

    // Error callback should NOT have fired yet
    expect(receivedErr).toBeNull();

    // Drain macrotask queue
    vi.runAllTimers();

    expect(receivedErr).toBe(testError);
  });

  it('multiple callbacks maintain invocation order', async () => {
    const order: string[] = [];

    fs.readFile('/a.txt', () => {
      order.push('readFile');
    });
    fs.writeFile('/b.txt', 'data', () => {
      order.push('writeFile');
    });
    fs.stat('/c.txt', () => {
      order.push('stat');
    });

    // Flush all microtasks so the setTimeout calls are queued
    await Promise.resolve();
    await Promise.resolve();

    // Drain all macrotasks
    vi.runAllTimers();

    // All three should have fired in the order they were called
    expect(order).toEqual(['readFile', 'writeFile', 'stat']);
  });

  it('exists callback fires as macrotask', async () => {
    let result: boolean | null = null;
    fs.exists('/test.txt', (exists: boolean) => {
      result = exists;
    });

    // Flush microtasks
    await Promise.resolve();
    await Promise.resolve();

    // Not yet -- still in setTimeout queue
    expect(result).toBeNull();

    vi.runAllTimers();
    expect(result).toBe(true);
  });
});
