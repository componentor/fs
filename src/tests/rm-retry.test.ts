/**
 * rm / rmSync retry tests
 *
 * Tests maxRetries and retryDelay options for rm and rmSync.
 */

import { describe, it, expect, vi } from 'vitest';
import { rmSync, rm } from '../src/methods/rm.js';
import { FSError } from '../src/errors.js';
import { OP, encodeRequest } from '../src/protocol/opcodes.js';
import type { RmOptions } from '../src/types.js';

/**
 * Helper: create a mock SyncRequestFn that fails N times with a given error
 * status, then succeeds.
 */
function makeSyncRequest(failCount: number, failStatus: number) {
  let calls = 0;
  return {
    fn: (_buf: ArrayBuffer) => {
      calls++;
      if (calls <= failCount) {
        return { status: failStatus, data: null };
      }
      return { status: 0, data: null };
    },
    getCalls: () => calls,
  };
}

/**
 * Helper: create a mock AsyncRequestFn that fails N times with a given error
 * status, then succeeds.
 */
function makeAsyncRequest(failCount: number, failStatus: number) {
  let calls = 0;
  return {
    fn: async (_op: number, _path: string, _flags?: number) => {
      calls++;
      if (calls <= failCount) {
        return { status: failStatus, data: null };
      }
      return { status: 0, data: null };
    },
    getCalls: () => calls,
  };
}

// Status codes from errors.ts: ENOTEMPTY=5, ENOENT=1
const STATUS_ENOTEMPTY = 5;
const STATUS_ENOENT = 1;

describe('rm retry options', () => {
  describe('RmOptions type', () => {
    it('should accept maxRetries and retryDelay', () => {
      const opts: RmOptions = {
        recursive: true,
        force: false,
        maxRetries: 3,
        retryDelay: 200,
      };
      expect(opts.maxRetries).toBe(3);
      expect(opts.retryDelay).toBe(200);
    });
  });

  describe('rmSync', () => {
    it('should not retry when maxRetries is 0 (default)', () => {
      const mock = makeSyncRequest(1, STATUS_ENOTEMPTY);
      expect(() => rmSync(mock.fn, '/test', { recursive: false })).toThrow();
      expect(mock.getCalls()).toBe(1);
    });

    it('should retry up to maxRetries on retryable error (ENOTEMPTY)', () => {
      // Fail twice, succeed on third attempt
      const mock = makeSyncRequest(2, STATUS_ENOTEMPTY);
      rmSync(mock.fn, '/test', { maxRetries: 3 });
      expect(mock.getCalls()).toBe(3);
    });

    it('should throw after exhausting maxRetries', () => {
      // Fail 4 times, maxRetries=2 means 3 total attempts
      const mock = makeSyncRequest(4, STATUS_ENOTEMPTY);
      expect(() => rmSync(mock.fn, '/test', { maxRetries: 2 })).toThrow();
      expect(mock.getCalls()).toBe(3); // initial + 2 retries
    });

    it('should not retry non-retryable errors (ENOENT)', () => {
      const mock = makeSyncRequest(3, STATUS_ENOENT);
      expect(() => rmSync(mock.fn, '/test', { maxRetries: 5 })).toThrow();
      expect(mock.getCalls()).toBe(1);
    });

    it('should not throw with force on ENOENT', () => {
      const mock = makeSyncRequest(1, STATUS_ENOENT);
      rmSync(mock.fn, '/test', { force: true });
      expect(mock.getCalls()).toBe(1);
    });
  });

  describe('rm (async)', () => {
    it('should not retry when maxRetries is 0 (default)', async () => {
      const mock = makeAsyncRequest(1, STATUS_ENOTEMPTY);
      await expect(rm(mock.fn as any, '/test', { recursive: false })).rejects.toThrow();
      expect(mock.getCalls()).toBe(1);
    });

    it('should retry up to maxRetries on retryable error (ENOTEMPTY)', async () => {
      // Fail twice, succeed on third
      const mock = makeAsyncRequest(2, STATUS_ENOTEMPTY);
      await rm(mock.fn as any, '/test', { maxRetries: 3, retryDelay: 1 });
      expect(mock.getCalls()).toBe(3);
    });

    it('should throw after exhausting maxRetries', async () => {
      const mock = makeAsyncRequest(4, STATUS_ENOTEMPTY);
      await expect(
        rm(mock.fn as any, '/test', { maxRetries: 2, retryDelay: 1 })
      ).rejects.toThrow();
      expect(mock.getCalls()).toBe(3); // initial + 2 retries
    });

    it('should not retry non-retryable errors (ENOENT)', async () => {
      const mock = makeAsyncRequest(3, STATUS_ENOENT);
      await expect(
        rm(mock.fn as any, '/test', { maxRetries: 5, retryDelay: 1 })
      ).rejects.toThrow();
      expect(mock.getCalls()).toBe(1);
    });

    it('should delay between retries', async () => {
      const mock = makeAsyncRequest(1, STATUS_ENOTEMPTY);
      const start = Date.now();
      await rm(mock.fn as any, '/test', { maxRetries: 1, retryDelay: 50 });
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40); // allow some timing slack
    });

    it('should not throw with force on ENOENT', async () => {
      const mock = makeAsyncRequest(1, STATUS_ENOENT);
      await rm(mock.fn as any, '/test', { force: true });
      expect(mock.getCalls()).toBe(1);
    });
  });

  describe('basic rm still works with new options present', () => {
    it('rmSync succeeds with maxRetries and retryDelay set', () => {
      const mock = makeSyncRequest(0, 0);
      rmSync(mock.fn, '/test', { maxRetries: 3, retryDelay: 100 });
      expect(mock.getCalls()).toBe(1);
    });

    it('rm succeeds with maxRetries and retryDelay set', async () => {
      const mock = makeAsyncRequest(0, 0);
      await rm(mock.fn as any, '/test', { maxRetries: 3, retryDelay: 100 });
      expect(mock.getCalls()).toBe(1);
    });
  });
});
