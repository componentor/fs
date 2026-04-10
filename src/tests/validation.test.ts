/**
 * Validation Tests
 *
 * Tests for argument validation in the VFS filesystem polyfill:
 * - Callback methods throw TypeError when callback is missing
 * - Path methods throw TypeError for null/undefined paths
 * - statfs callback fires asynchronously (via setTimeout)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toPathString } from '../src/path.js';

// ---------- Callback validation ----------
// We replicate the _validateCb + callback wiring pattern from filesystem.ts
// since VFSFileSystem cannot be instantiated in Node (requires browser workers).

function _validateCb(cb: any): asserts cb is Function {
  if (typeof cb !== 'function') {
    throw new TypeError('The "cb" argument must be of type function. Received ' + typeof cb);
  }
}

function createMockFS() {
  const mockPromises = {
    readFile: vi.fn().mockResolvedValue(new Uint8Array([72, 105])),
    writeFile: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ size: 42 }),
  };

  const statfsSync = () => ({
    type: 0x56465321,
    bsize: 4096,
    blocks: 1024 * 1024,
    bfree: 512 * 1024,
    bavail: 512 * 1024,
    files: 10000,
    ffree: 5000,
  });

  const fs = {
    promises: mockPromises,

    readFile(filePath: string, optionsOrCallback?: any, callback?: any) {
      const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      _validateCb(cb);
      const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
      this.promises.readFile(filePath, opts).then(
        (result: any) => setTimeout(() => cb(null, result), 0),
        (err: any) => setTimeout(() => cb(err), 0),
      );
    },

    writeFile(filePath: string, data: string | Uint8Array, optionsOrCallback?: any, callback?: any) {
      const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      _validateCb(cb);
      const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
      this.promises.writeFile(filePath, data, opts).then(
        () => setTimeout(() => cb(null), 0),
        (err: any) => setTimeout(() => cb(err), 0),
      );
    },

    stat(filePath: string, optionsOrCallback?: any, callback?: any) {
      const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      _validateCb(cb);
      const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
      this.promises.stat(filePath, opts).then(
        (result: any) => setTimeout(() => cb(null, result), 0),
        (err: any) => setTimeout(() => cb(err), 0),
      );
    },

    statfs(path: string, callback?: (err: Error | null, stats?: any) => void) {
      const result = statfsSync();
      if (callback) {
        setTimeout(() => callback(null, result), 0);
        return;
      }
      return Promise.resolve(result);
    },
  };

  return { fs };
}

describe('Validation', () => {
  describe('callback validation', () => {
    let fs: ReturnType<typeof createMockFS>['fs'];

    beforeEach(() => {
      const mock = createMockFS();
      fs = mock.fs;
    });

    it('readFile without callback throws TypeError', () => {
      expect(() => {
        (fs as any).readFile('/test.txt');
      }).toThrow(TypeError);
      expect(() => {
        (fs as any).readFile('/test.txt');
      }).toThrow(/must be of type function/);
    });

    it('writeFile without callback throws TypeError', () => {
      expect(() => {
        (fs as any).writeFile('/test.txt', 'data');
      }).toThrow(TypeError);
      expect(() => {
        (fs as any).writeFile('/test.txt', 'data');
      }).toThrow(/must be of type function/);
    });

    it('stat without callback throws TypeError', () => {
      expect(() => {
        (fs as any).stat('/test.txt');
      }).toThrow(TypeError);
      expect(() => {
        (fs as any).stat('/test.txt');
      }).toThrow(/must be of type function/);
    });
  });

  describe('path validation', () => {
    it('null path throws TypeError', () => {
      expect(() => {
        toPathString(null as any);
      }).toThrow(TypeError);
      expect(() => {
        toPathString(null as any);
      }).toThrow(/must be of type string, Uint8Array, or URL/);
    });

    it('undefined path throws TypeError', () => {
      expect(() => {
        toPathString(undefined as any);
      }).toThrow(TypeError);
      expect(() => {
        toPathString(undefined as any);
      }).toThrow(/must be of type string, Uint8Array, or URL/);
    });

    it('number path throws TypeError', () => {
      expect(() => {
        toPathString(42 as any);
      }).toThrow(TypeError);
      expect(() => {
        toPathString(42 as any);
      }).toThrow(/Received number/);
    });
  });

  describe('statfs async timing', () => {
    let fs: ReturnType<typeof createMockFS>['fs'];

    beforeEach(() => {
      vi.useFakeTimers();
      const mock = createMockFS();
      fs = mock.fs;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('statfs callback fires asynchronously via setTimeout', () => {
      let called = false;
      fs.statfs('/', (err: Error | null, stats?: any) => {
        called = true;
      });

      // Callback must NOT have fired synchronously
      expect(called).toBe(false);

      // Drain the macrotask queue
      vi.runAllTimers();

      // Now it should have fired
      expect(called).toBe(true);
    });

    it('statfs callback receives correct result', () => {
      let receivedStats: any = null;
      fs.statfs('/', (err: Error | null, stats?: any) => {
        receivedStats = stats;
      });

      vi.runAllTimers();

      expect(receivedStats).not.toBeNull();
      expect(receivedStats.type).toBe(0x56465321);
      expect(receivedStats.bsize).toBe(4096);
    });
  });
});
