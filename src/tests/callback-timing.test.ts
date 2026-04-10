/**
 * Callback Timing Tests
 *
 * Verifies that callback-style fs methods fire callbacks as macrotasks
 * (via setTimeout) rather than microtasks (via Promise.then). This matches
 * the Node.js guarantee that callbacks are always asynchronous and scheduled
 * on the macrotask queue.
 *
 * Since VFSFileSystem requires browser workers, we replicate the callback
 * wiring pattern from filesystem.ts and verify the scheduling behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Creates a mock fs object that mirrors the VFSFileSystem callback wiring,
 * including the setTimeout macrotask scheduling.
 */
function createMockFS() {
  const mockPromises = {
    readFile: vi.fn().mockResolvedValue(new Uint8Array([72, 105])),
    writeFile: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ size: 42 }),
    exists: vi.fn().mockResolvedValue(true),
  };

  const fs = {
    promises: mockPromises,

    readFile(filePath: string, optionsOrCallback?: any, callback?: any) {
      const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
      this.promises.readFile(filePath, opts).then(
        (result: any) => setTimeout(() => cb(null, result), 0),
        (err: any) => setTimeout(() => cb(err), 0),
      );
    },

    writeFile(filePath: string, data: string | Uint8Array, optionsOrCallback?: any, callback?: any) {
      const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
      this.promises.writeFile(filePath, data, opts).then(
        () => setTimeout(() => cb(null), 0),
        (err: any) => setTimeout(() => cb(err), 0),
      );
    },

    stat(filePath: string, optionsOrCallback?: any, callback?: any) {
      const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
      this.promises.stat(filePath, opts).then(
        (result: any) => setTimeout(() => cb(null, result), 0),
        (err: any) => setTimeout(() => cb(err), 0),
      );
    },

    exists(filePath: string, callback: (exists: boolean) => void) {
      this.promises.exists(filePath).then(
        (result: boolean) => setTimeout(() => callback(result), 0),
        () => setTimeout(() => callback(false), 0),
      );
    },
  };

  return { fs, mockPromises };
}

describe('Callback Timing', () => {
  let fs: ReturnType<typeof createMockFS>['fs'];
  let mockPromises: ReturnType<typeof createMockFS>['mockPromises'];

  beforeEach(() => {
    vi.useFakeTimers();
    const mock = createMockFS();
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
