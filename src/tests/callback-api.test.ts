/**
 * Callback API Tests
 *
 * Node.js-style callback overloads on `VFSFileSystem`: callback detection, option extraction,
 * and promise-to-callback bridging.
 *
 * These drive the **real** methods. `VFSFileSystem` cannot be constructed in Node (it spawns
 * workers and allocates a SharedArrayBuffer), so the object under test is built with
 * `Object.create(VFSFileSystem.prototype)` — every method is the shipped one, and only
 * `this.promises` is stubbed. The previous version of this file re-implemented the callback
 * wiring and asserted against the copy, which could not fail when the product changed. It was
 * also already wrong: the copy resolved callbacks straight out of `.then()`, while the real
 * `_cb` schedules them with `setTimeout(…, 0)` to honour Node's guarantee that a callback never
 * fires in the same microtask turn.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VFSFileSystem } from '../src/filesystem.js';

/** Let queued macrotask callbacks run — the real `_cb` defers with setTimeout(…, 0). */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function createRealFS() {
  const mockPromises = {
    readFile: vi.fn().mockResolvedValue(new Uint8Array([72, 101, 108, 108, 111])),
    writeFile: vi.fn().mockResolvedValue(undefined),
    appendFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue('/test'),
    rmdir: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue(['file1.txt', 'file2.txt']),
    stat: vi.fn().mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
      size: 100,
      mode: 0o644,
      mtime: new Date(),
      atime: new Date(),
      ctime: new Date(),
      birthtime: new Date(),
    }),
    lstat: vi.fn().mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
      size: 100,
    }),
    access: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    truncate: vi.fn().mockResolvedValue(undefined),
    realpath: vi.fn().mockResolvedValue('/resolved/path'),
    chmod: vi.fn().mockResolvedValue(undefined),
    chown: vi.fn().mockResolvedValue(undefined),
    utimes: vi.fn().mockResolvedValue(undefined),
    symlink: vi.fn().mockResolvedValue(undefined),
    readlink: vi.fn().mockResolvedValue('/target'),
    link: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue({ fd: 42 }),
    mkdtemp: vi.fn().mockResolvedValue('/tmp/prefix-abc123'),
    exists: vi.fn().mockResolvedValue(true),
    cp: vi.fn().mockResolvedValue(undefined),
  };

  // The real prototype: every callback method under test is the shipped implementation,
  // including the private _cb/_cbVoid bridges. Object.create skips the constructor, which is
  // what would otherwise demand workers and a SharedArrayBuffer.
  const fs = Object.create(VFSFileSystem.prototype) as VFSFileSystem;
  (fs as unknown as { promises: unknown }).promises = mockPromises;

  return { fs, mockPromises };
}

describe('Callback API', () => {
  let fs: ReturnType<typeof createRealFS>['fs'];
  let mockPromises: ReturnType<typeof createRealFS>['mockPromises'];

  beforeEach(() => {
    const mock = createRealFS();
    fs = mock.fs;
    mockPromises = mock.mockPromises;
  });

  it('readFile with callback receives data', async () => {
    const result = await new Promise<Uint8Array>((resolve, reject) => {
      fs.readFile('/test.txt', (err: Error | null, data?: Uint8Array) => {
        if (err) return reject(err);
        resolve(data!);
      });
    });
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).toEqual(new Uint8Array([72, 101, 108, 108, 111]));
    expect(mockPromises.readFile).toHaveBeenCalledWith('/test.txt', undefined);
  });

  it('writeFile with callback completes', async () => {
    const err = await new Promise<Error | null>((resolve) => {
      fs.writeFile('/test.txt', 'hello', (err: Error | null) => {
        resolve(err);
      });
    });
    expect(err).toBeNull();
    expect(mockPromises.writeFile).toHaveBeenCalledWith('/test.txt', 'hello', undefined);
  });

  it('readFile with options and callback works', async () => {
    mockPromises.readFile.mockResolvedValue('Hello');
    const result = await new Promise<string>((resolve, reject) => {
      fs.readFile('/test.txt', { encoding: 'utf8' }, (err: Error | null, data?: string) => {
        if (err) return reject(err);
        resolve(data!);
      });
    });
    expect(result).toBe('Hello');
    expect(mockPromises.readFile).toHaveBeenCalledWith('/test.txt', { encoding: 'utf8' });
  });

  it('error is passed to callback on failure', async () => {
    const testError = new Error('ENOENT: no such file or directory');
    mockPromises.readFile.mockRejectedValue(testError);

    const err = await new Promise<Error>((resolve) => {
      fs.readFile('/nonexistent.txt', (err: Error | null) => {
        resolve(err!);
      });
    });
    expect(err).toBe(testError);
    expect(err.message).toContain('ENOENT');
  });

  it('exists callback receives boolean', async () => {
    const result = await new Promise<boolean>((resolve) => {
      fs.exists('/test.txt', (exists: boolean) => {
        resolve(exists);
      });
    });
    expect(result).toBe(true);
  });

  it('exists callback receives false when file does not exist', async () => {
    mockPromises.exists.mockResolvedValue(false);
    const result = await new Promise<boolean>((resolve) => {
      fs.exists('/missing.txt', (exists: boolean) => {
        resolve(exists);
      });
    });
    expect(result).toBe(false);
  });

  it('exists callback receives false on error', async () => {
    mockPromises.exists.mockRejectedValue(new Error('internal error'));
    const result = await new Promise<boolean>((resolve) => {
      fs.exists('/broken.txt', (exists: boolean) => {
        resolve(exists);
      });
    });
    expect(result).toBe(false);
  });

  it('stat callback receives Stats object', async () => {
    const stats = await new Promise<any>((resolve, reject) => {
      fs.stat('/test.txt', (err: Error | null, stats?: any) => {
        if (err) return reject(err);
        resolve(stats);
      });
    });
    expect(stats).toBeDefined();
    expect(stats.isFile()).toBe(true);
    expect(stats.isDirectory()).toBe(false);
    expect(stats.size).toBe(100);
  });

  it('mkdir with callback works', async () => {
    const result = await new Promise<string>((resolve, reject) => {
      fs.mkdir('/newdir', (err: Error | null, path?: string) => {
        if (err) return reject(err);
        resolve(path!);
      });
    });
    expect(result).toBe('/test');
    expect(mockPromises.mkdir).toHaveBeenCalledWith('/newdir', undefined);
  });

  it('mkdir with options and callback works', async () => {
    const result = await new Promise<string>((resolve, reject) => {
      fs.mkdir('/newdir', { recursive: true }, (err: Error | null, path?: string) => {
        if (err) return reject(err);
        resolve(path!);
      });
    });
    expect(result).toBe('/test');
    expect(mockPromises.mkdir).toHaveBeenCalledWith('/newdir', { recursive: true });
  });
});
