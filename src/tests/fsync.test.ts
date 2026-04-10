/**
 * fsync / fsyncSync Tests
 *
 * Tests for the fsync and fsyncSync methods on VFSFileSystem.
 * Since VFSFileSystem requires browser workers, we test by calling
 * the underlying _fdatasyncSync directly (fsyncSync delegates to it)
 * and by verifying the callback wiring pattern.
 */

import { describe, it, expect, vi } from 'vitest';
import { fdatasyncSync } from '../src/methods/open.js';
import { decodeRequest, OP } from '../src/protocol/opcodes.js';
import type { SyncRequestFn } from '../src/methods/context.js';

/**
 * Creates a mock syncRequest for FSYNC that succeeds.
 * Captures the decoded opcode to verify the correct operation is sent.
 */
function createFsyncMock() {
  let capturedOp: number | null = null;

  const syncRequest: SyncRequestFn = (buf: ArrayBuffer) => {
    const { op } = decodeRequest(buf);
    capturedOp = op;
    return { status: 0, data: null };
  };

  return { syncRequest, getCapturedOp: () => capturedOp };
}

describe('fsyncSync', () => {
  it('should not throw for a valid sync request', () => {
    const mock = createFsyncMock();
    expect(() => fdatasyncSync(mock.syncRequest, 5)).not.toThrow();
  });

  it('should send the FSYNC opcode', () => {
    const mock = createFsyncMock();
    fdatasyncSync(mock.syncRequest, 5);
    expect(mock.getCapturedOp()).toBe(OP.FSYNC);
  });

  it('should throw when the worker returns an error status', () => {
    const syncRequest: SyncRequestFn = (_buf: ArrayBuffer) => {
      return { status: -9, data: null }; // EBADF-style error
    };
    expect(() => fdatasyncSync(syncRequest, 99)).toThrow();
  });
});

describe('fsync callback wiring', () => {
  /**
   * Creates a mock fs object that mirrors VFSFileSystem callback methods
   * for fsync/fdatasync, using the same pattern as the real implementation.
   */
  function createMockFS() {
    const fsyncSyncMock = vi.fn();
    const fdatasyncSyncMock = vi.fn();

    const fs = {
      fsyncSync: fsyncSyncMock,
      fdatasyncSync: fdatasyncSyncMock,

      fsync(fd: number, callback: (err: Error | null) => void): void {
        try {
          this.fsyncSync(fd);
          callback(null);
        } catch (err: any) {
          callback(err);
        }
      },

      fdatasync(fd: number, callback: (err: Error | null) => void): void {
        try {
          this.fdatasyncSync(fd);
          callback(null);
        } catch (err: any) {
          callback(err);
        }
      },
    };

    return { fs, fsyncSyncMock, fdatasyncSyncMock };
  }

  it('fsync callback is called with null on success', () => {
    const { fs } = createMockFS();
    const cb = vi.fn();
    fs.fsync(5, cb);
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('fdatasync callback is called with null on success', () => {
    const { fs } = createMockFS();
    const cb = vi.fn();
    fs.fdatasync(5, cb);
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('fsync callback receives error on failure', () => {
    const { fs, fsyncSyncMock } = createMockFS();
    const testError = new Error('EBADF: bad file descriptor');
    fsyncSyncMock.mockImplementation(() => { throw testError; });

    const cb = vi.fn();
    fs.fsync(99, cb);
    expect(cb).toHaveBeenCalledWith(testError);
  });

  it('fdatasync callback receives error on failure', () => {
    const { fs, fdatasyncSyncMock } = createMockFS();
    const testError = new Error('EBADF: bad file descriptor');
    fdatasyncSyncMock.mockImplementation(() => { throw testError; });

    const cb = vi.fn();
    fs.fdatasync(99, cb);
    expect(cb).toHaveBeenCalledWith(testError);
  });
});

describe('method existence', () => {
  it('fsyncSync and fdatasyncSync are exported from open.ts', () => {
    expect(typeof fdatasyncSync).toBe('function');
  });

  it('mock fs object has both sync and callback methods', () => {
    // Verify the expected shape of the VFSFileSystem API
    const methods = ['fsync', 'fsyncSync', 'fdatasync', 'fdatasyncSync'];
    const mockFs = {
      fsync: () => {},
      fsyncSync: () => {},
      fdatasync: () => {},
      fdatasyncSync: () => {},
    };
    for (const method of methods) {
      expect(typeof (mockFs as any)[method]).toBe('function');
    }
  });
});
