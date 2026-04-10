/**
 * File Descriptor Callback API Tests
 *
 * Tests for fd-based callback methods: fstat, ftruncate, read, write, close.
 * Since VFSFileSystem requires browser workers, we test by creating a
 * minimal mock that mirrors the callback wiring pattern from filesystem.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Creates a mock fs object that mirrors VFSFileSystem fd callback methods.
 * Each callback method wraps the corresponding sync mock in try/catch with
 * setTimeout, matching the real implementation pattern.
 */
function createMockFS() {
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

  const fs = {
    fstatSync: fstatSyncMock,
    ftruncateSync: ftruncateSyncMock,
    readSync: readSyncMock,
    writeSync: writeSyncMock,
    closeSync: closeSyncMock,

    fstat(fd: number, optionsOrCallback: any, callback?: any): void {
      const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      try {
        const result = this.fstatSync(fd);
        setTimeout(() => cb(null, result), 0);
      } catch (err) {
        setTimeout(() => cb(err), 0);
      }
    },

    ftruncate(fd: number, lenOrCallback?: any, callback?: any): void {
      const cb = typeof lenOrCallback === 'function' ? lenOrCallback : callback;
      const len = typeof lenOrCallback === 'function' ? 0 : lenOrCallback;
      try {
        this.ftruncateSync(fd, len);
        setTimeout(() => cb(null), 0);
      } catch (err) {
        setTimeout(() => cb(err), 0);
      }
    },

    read(fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null, callback: (err: Error | null, bytesRead?: number, buffer?: Uint8Array) => void): void {
      try {
        const bytesRead = this.readSync(fd, buffer, offset, length, position);
        setTimeout(() => callback(null, bytesRead, buffer), 0);
      } catch (err) {
        setTimeout(() => callback(err as Error), 0);
      }
    },

    write(fd: number, bufferOrString: Uint8Array | string, offsetOrPosition?: any, lengthOrEncoding?: any, position?: any, callback?: any): void {
      const cb = [offsetOrPosition, lengthOrEncoding, position, callback].find(a => typeof a === 'function');
      try {
        let bytesWritten: number;
        if (typeof bufferOrString === 'string') {
          const pos = typeof offsetOrPosition === 'function' ? undefined : offsetOrPosition;
          const enc = typeof lengthOrEncoding === 'function' ? undefined : lengthOrEncoding;
          bytesWritten = this.writeSync(fd, bufferOrString, pos, enc);
        } else {
          const off = typeof offsetOrPosition === 'function' ? undefined : offsetOrPosition;
          const len = typeof lengthOrEncoding === 'function' ? undefined : lengthOrEncoding;
          const pos2 = typeof position === 'function' ? undefined : position;
          bytesWritten = this.writeSync(fd, bufferOrString, off, len, pos2);
        }
        setTimeout(() => cb(null, bytesWritten, bufferOrString), 0);
      } catch (err) {
        setTimeout(() => cb(err), 0);
      }
    },

    close(fd: number, callback?: (err: Error | null) => void): void {
      try {
        this.closeSync(fd);
        if (callback) setTimeout(() => callback(null), 0);
      } catch (err) {
        if (callback) setTimeout(() => callback(err as Error), 0);
        else throw err;
      }
    },
  };

  return { fs, mockStats, fstatSyncMock, ftruncateSyncMock, readSyncMock, writeSyncMock, closeSyncMock };
}

describe('fd callback API', () => {
  let mock: ReturnType<typeof createMockFS>;

  beforeEach(() => {
    mock = createMockFS();
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
    expect(mock.fstatSyncMock).toHaveBeenCalledWith(3);
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
