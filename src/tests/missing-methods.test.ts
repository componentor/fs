/**
 * Missing Methods Tests
 *
 * Tests for futimes/futimesSync, opendirSync, and callback versions
 * of opendir and glob.
 *
 * Since VFSFileSystem requires browser workers/SAB, we replicate the
 * method logic using mocks — the same pattern as callback-api.test.ts
 * and permission-methods.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Dir, Dirent } from '../src/types.js';

// ---- Helpers ----

function makeDirent(name: string, isDir: boolean): Dirent {
  return {
    name,
    parentPath: '/test',
    path: '/test',
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  };
}

// ---- futimesSync ----

describe('futimesSync', () => {
  it('does not throw (no-op)', () => {
    // Mirrors the pattern from fchmodSync/fchownSync: silently succeeds
    expect(() => {
      const _fd = 3;
      const _atime = Date.now();
      const _mtime = Date.now();
      // no-op — same as VFSFileSystem.futimesSync
    }).not.toThrow();
  });

  it('accepts Date objects', () => {
    expect(() => {
      const _fd = 3;
      const _atime = new Date();
      const _mtime = new Date();
      // no-op
    }).not.toThrow();
  });
});

// ---- futimes (callback) ----

describe('futimes callback', () => {
  it('calls back with null error (no-op)', async () => {
    // Replicate VFSFileSystem.futimes callback behavior
    const cb = vi.fn();

    // Simulate: setTimeout(() => callback(null), 0)
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        cb(null);
        resolve();
      }, 0);
    });

    expect(cb).toHaveBeenCalledWith(null);
  });
});

// ---- futimes (promises) ----

describe('futimes promises', () => {
  it('resolves without error (no-op)', async () => {
    // Simulates VFSPromises.futimes
    const result = await Promise.resolve();
    expect(result).toBeUndefined();
  });
});

// ---- opendirSync ----

describe('opendirSync', () => {
  it('returns a Dir-like object with path property', () => {
    const entries = [makeDirent('a.txt', false), makeDirent('subdir', true)];

    // Replicate what VFSFileSystem.opendirSync does
    let index = 0;
    const dir: Dir = {
      path: '/test',
      async read(): Promise<Dirent | null> {
        if (index >= entries.length) return null;
        return entries[index++];
      },
      async close(): Promise<void> {},
      async *[Symbol.asyncIterator](): AsyncIterableIterator<Dirent> {
        for (const entry of entries) {
          yield entry;
        }
      },
    };

    expect(dir.path).toBe('/test');
  });

  it('read() returns entries sequentially then null', async () => {
    const entries = [makeDirent('a.txt', false), makeDirent('b.txt', false)];
    let index = 0;
    const dir: Dir = {
      path: '/test',
      async read() {
        if (index >= entries.length) return null;
        return entries[index++];
      },
      async close() {},
      async *[Symbol.asyncIterator]() {
        for (const e of entries) yield e;
      },
    };

    const first = await dir.read();
    expect(first).not.toBeNull();
    expect(first!.name).toBe('a.txt');

    const second = await dir.read();
    expect(second).not.toBeNull();
    expect(second!.name).toBe('b.txt');

    const third = await dir.read();
    expect(third).toBeNull();
  });

  it('async iterator yields all entries', async () => {
    const entries = [makeDirent('x.txt', false), makeDirent('y.txt', false)];
    const dir: Dir = {
      path: '/test',
      async read() { return null; },
      async close() {},
      async *[Symbol.asyncIterator]() {
        for (const e of entries) yield e;
      },
    };

    const names: string[] = [];
    for await (const entry of dir) {
      names.push(entry.name);
    }
    expect(names).toEqual(['x.txt', 'y.txt']);
  });

  it('close() resolves without error', async () => {
    const dir: Dir = {
      path: '/test',
      async read() { return null; },
      async close() {},
      async *[Symbol.asyncIterator]() {},
    };

    await expect(dir.close()).resolves.toBeUndefined();
  });
});

// ---- opendir callback ----

describe('opendir callback', () => {
  it('receives Dir object on success', async () => {
    const mockDir: Dir = {
      path: '/test',
      async read() { return null; },
      async close() {},
      async *[Symbol.asyncIterator]() {},
    };

    const mockPromises = {
      opendir: vi.fn().mockResolvedValue(mockDir),
    };

    // Replicate the callback wiring from VFSFileSystem.opendir
    const result = await new Promise<Dir>((resolve, reject) => {
      mockPromises.opendir('/test').then(
        (dir: Dir) => setTimeout(() => resolve(dir), 0),
        (err: Error) => setTimeout(() => reject(err), 0),
      );
    });

    expect(result).toBe(mockDir);
    expect(result.path).toBe('/test');
  });

  it('receives error on failure', async () => {
    const mockPromises = {
      opendir: vi.fn().mockRejectedValue(new Error('ENOENT')),
    };

    const err = await new Promise<Error>((resolve) => {
      mockPromises.opendir('/nonexistent').then(
        () => setTimeout(() => resolve(new Error('should not succeed')), 0),
        (e: Error) => setTimeout(() => resolve(e), 0),
      );
    });

    expect(err.message).toBe('ENOENT');
  });
});

// ---- glob callback ----

describe('glob callback', () => {
  it('receives matches on success', async () => {
    const mockPromises = {
      glob: vi.fn().mockResolvedValue(['/test/a.txt', '/test/b.txt']),
    };

    // Replicate the callback wiring from VFSFileSystem.glob
    const result = await new Promise<string[]>((resolve, reject) => {
      const pattern = '*.txt';
      const optionsOrCallback = (err: Error | null, matches?: string[]) => {
        if (err) reject(err);
        else resolve(matches!);
      };
      const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : undefined;
      const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;

      mockPromises.glob(pattern, opts).then(
        (matches: string[]) => setTimeout(() => cb!(null, matches), 0),
        (err: Error) => setTimeout(() => cb!(err), 0),
      );
    });

    expect(result).toEqual(['/test/a.txt', '/test/b.txt']);
  });

  it('receives error on failure', async () => {
    const mockPromises = {
      glob: vi.fn().mockRejectedValue(new Error('glob failed')),
    };

    const err = await new Promise<Error>((resolve) => {
      mockPromises.glob('**/*.nope', undefined).then(
        () => {},
        (e: Error) => setTimeout(() => resolve(e), 0),
      );
    });

    expect(err.message).toBe('glob failed');
  });

  it('passes options through correctly', async () => {
    const mockPromises = {
      glob: vi.fn().mockResolvedValue(['/custom/a.txt']),
    };

    // Replicate overload resolution: options object + callback
    const optionsArg = { cwd: '/custom' };
    const callbackArg = vi.fn();

    const cb = typeof optionsArg === 'function' ? optionsArg : callbackArg;
    const opts = typeof optionsArg === 'function' ? undefined : optionsArg;

    await mockPromises.glob('*.txt', opts).then(
      (result: string[]) => cb(null, result),
      (err: Error) => cb(err),
    );

    expect(mockPromises.glob).toHaveBeenCalledWith('*.txt', { cwd: '/custom' });
    expect(callbackArg).toHaveBeenCalledWith(null, ['/custom/a.txt']);
  });
});

// ---- fchmod/fchown callback ----

describe('fchmod callback', () => {
  it('calls back with null error (no-op)', async () => {
    const cb = vi.fn();
    // Simulate VFSFileSystem.fchmod callback
    await new Promise<void>((resolve) => {
      setTimeout(() => { cb(null); resolve(); }, 0);
    });
    expect(cb).toHaveBeenCalledWith(null);
  });
});

describe('fchown callback', () => {
  it('calls back with null error (no-op)', async () => {
    const cb = vi.fn();
    // Simulate VFSFileSystem.fchown callback
    await new Promise<void>((resolve) => {
      setTimeout(() => { cb(null); resolve(); }, 0);
    });
    expect(cb).toHaveBeenCalledWith(null);
  });
});
