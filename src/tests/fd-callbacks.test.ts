/**
 * File Descriptor Callback API Tests
 *
 * The fd-based callback methods — `fstat`, `ftruncate`, `read`, `write`, `close` — which wrap
 * their `*Sync` counterparts in try/catch and defer the callback with `setTimeout(…, 0)`.
 *
 * These drive the **real** methods: the object under test is built with
 * `Object.create(VFSFileSystem.prototype)` (the constructor needs workers and a
 * SharedArrayBuffer) and only the `*Sync` methods they delegate to are shadowed with mocks. The
 * previous version re-implemented the wrapping and asserted against the copy, so it could not
 * fail if the real error handling or scheduling changed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VFSFileSystem } from '../src/filesystem.js';

/** Build an fs whose fd callback methods are the shipped ones, over mocked *Sync methods. */
function createRealFS() {
  const mockStats = {
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
    size: 256,
    mode: 0o644,
    mtime: new Date(),
    atime: new Date(),
    ctime: new Date(),
    birthtime: new Date(),
  };

  const fstatSyncMock = vi.fn().mockReturnValue(mockStats);
  const ftruncateSyncMock = vi.fn();
  const readSyncMock = vi.fn().mockReturnValue(5);
  const writeSyncMock = vi.fn().mockReturnValue(11);
  const closeSyncMock = vi.fn();

  // Real prototype for the callback methods under test; the *Sync methods they delegate to are
  // shadowed with mocks as own properties. Object.create skips the constructor, which would
  // otherwise need workers and a SharedArrayBuffer.
  const fs = Object.create(VFSFileSystem.prototype) as VFSFileSystem;
  Object.assign(fs, {
    fstatSync: fstatSyncMock,
    ftruncateSync: ftruncateSyncMock,
    readSync: readSyncMock,
    writeSync: writeSyncMock,
    closeSync: closeSyncMock,
  });

  return { fs, mockStats, fstatSyncMock, ftruncateSyncMock, readSyncMock, writeSyncMock, closeSyncMock };
}

describe('fd callback API', () => {
  let mock: ReturnType<typeof createRealFS>;

  beforeEach(() => {
    mock = createRealFS();
  });

  it('fstat callback receives Stats', async () => {
    const stats = await new Promise<any>((resolve, reject) => {
      mock.fs.fstat(3, (err: Error | null, stats?: any) => {
        if (err) return reject(err);
        resolve(stats);
      });
    });
    expect(stats).toBeDefined();
    expect(stats.isFile()).toBe(true);
    expect(stats.isDirectory()).toBe(false);
    expect(stats.size).toBe(256);
    // The real fstat forwards its (possibly undefined) options through to fstatSync; the
    // re-implemented model this test used to run against passed the fd alone.
    expect(mock.fstatSyncMock).toHaveBeenCalledWith(3, undefined);
  });

  it('fstat with options still calls callback', async () => {
    const stats = await new Promise<any>((resolve, reject) => {
      mock.fs.fstat(3, { bigint: false }, (err: Error | null, stats?: any) => {
        if (err) return reject(err);
        resolve(stats);
      });
    });
    expect(stats).toBeDefined();
    expect(stats.size).toBe(256);
  });

  it('ftruncate callback fires on success', async () => {
    const err = await new Promise<Error | null>((resolve) => {
      mock.fs.ftruncate(3, 100, (err: Error | null) => {
        resolve(err);
      });
    });
    expect(err).toBeNull();
    expect(mock.ftruncateSyncMock).toHaveBeenCalledWith(3, 100);
  });

  it('ftruncate with only callback defaults len to 0', async () => {
    const err = await new Promise<Error | null>((resolve) => {
      mock.fs.ftruncate(3, (err: Error | null) => {
        resolve(err);
      });
    });
    expect(err).toBeNull();
    expect(mock.ftruncateSyncMock).toHaveBeenCalledWith(3, 0);
  });

  it('read callback receives bytesRead and buffer', async () => {
    const buf = new Uint8Array(10);
    const result = await new Promise<{ bytesRead: number; buffer: Uint8Array }>((resolve, reject) => {
      mock.fs.read(3, buf, 0, 10, 0, (err: Error | null, bytesRead?: number, buffer?: Uint8Array) => {
        if (err) return reject(err);
        resolve({ bytesRead: bytesRead!, buffer: buffer! });
      });
    });
    expect(result.bytesRead).toBe(5);
    expect(result.buffer).toBe(buf);
    expect(mock.readSyncMock).toHaveBeenCalledWith(3, buf, 0, 10, 0);
  });

  it('write callback receives bytesWritten', async () => {
    const buf = new Uint8Array([72, 101, 108, 108, 111]);
    const result = await new Promise<{ bytesWritten: number; buffer: Uint8Array }>((resolve, reject) => {
      mock.fs.write(3, buf, 0, 5, 0, (err: Error | null, bytesWritten?: number, buffer?: Uint8Array) => {
        if (err) return reject(err);
        resolve({ bytesWritten: bytesWritten!, buffer: buffer! });
      });
    });
    expect(result.bytesWritten).toBe(11);
    expect(result.buffer).toBe(buf);
    expect(mock.writeSyncMock).toHaveBeenCalledWith(3, buf, 0, 5, 0);
  });

  it('write with string calls writeSync correctly', async () => {
    const result = await new Promise<{ bytesWritten: number; data: string }>((resolve, reject) => {
      mock.fs.write(3, 'hello world', null, 'utf8', (err: Error | null, bytesWritten?: number, data?: string) => {
        if (err) return reject(err);
        resolve({ bytesWritten: bytesWritten!, data: data as string });
      });
    });
    expect(result.bytesWritten).toBe(11);
    expect(result.data).toBe('hello world');
    expect(mock.writeSyncMock).toHaveBeenCalledWith(3, 'hello world', null, 'utf8');
  });

  it('close callback fires on success', async () => {
    const err = await new Promise<Error | null>((resolve) => {
      mock.fs.close(3, (err: Error | null) => {
        resolve(err);
      });
    });
    expect(err).toBeNull();
    expect(mock.closeSyncMock).toHaveBeenCalledWith(3);
  });

  it('close without callback does not throw on success', () => {
    expect(() => mock.fs.close(3)).not.toThrow();
    expect(mock.closeSyncMock).toHaveBeenCalledWith(3);
  });

  it('close without callback throws on error', () => {
    const testError = new Error('EBADF: bad file descriptor');
    mock.closeSyncMock.mockImplementation(() => { throw testError; });
    expect(() => mock.fs.close(3)).toThrow(testError);
  });

  it('error passed to fstat callback on failure', async () => {
    const testError = new Error('EBADF: bad file descriptor');
    mock.fstatSyncMock.mockImplementation(() => { throw testError; });

    const err = await new Promise<Error>((resolve) => {
      mock.fs.fstat(99, (err: Error | null) => {
        resolve(err!);
      });
    });
    expect(err).toBe(testError);
    expect(err.message).toContain('EBADF');
  });

  it('error passed to ftruncate callback on failure', async () => {
    const testError = new Error('EBADF: bad file descriptor');
    mock.ftruncateSyncMock.mockImplementation(() => { throw testError; });

    const err = await new Promise<Error>((resolve) => {
      mock.fs.ftruncate(99, 0, (err: Error | null) => {
        resolve(err!);
      });
    });
    expect(err).toBe(testError);
  });

  it('error passed to read callback on failure', async () => {
    const testError = new Error('EBADF: bad file descriptor');
    mock.readSyncMock.mockImplementation(() => { throw testError; });

    const err = await new Promise<Error>((resolve) => {
      mock.fs.read(99, new Uint8Array(10), 0, 10, 0, (err: Error | null) => {
        resolve(err!);
      });
    });
    expect(err).toBe(testError);
  });

  it('error passed to write callback on failure', async () => {
    const testError = new Error('EBADF: bad file descriptor');
    mock.writeSyncMock.mockImplementation(() => { throw testError; });

    const err = await new Promise<Error>((resolve) => {
      mock.fs.write(99, new Uint8Array(5), 0, 5, 0, (err: Error | null) => {
        resolve(err!);
      });
    });
    expect(err).toBe(testError);
  });

  it('error passed to close callback on failure', async () => {
    const testError = new Error('EBADF: bad file descriptor');
    mock.closeSyncMock.mockImplementation(() => { throw testError; });

    const err = await new Promise<Error>((resolve) => {
      mock.fs.close(99, (err: Error | null) => {
        resolve(err!);
      });
    });
    expect(err).toBe(testError);
  });
});
