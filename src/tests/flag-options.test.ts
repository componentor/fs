/**
 * Tests for readFile/writeFile flag option support.
 *
 * Verifies that the `flag` option in ReadOptions/WriteOptions is properly
 * extracted and honored, using a VFSEngine-backed mock syncRequest.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VFSEngine } from '../src/vfs/engine.js';
import { OP, decodeRequest, encodeResponse } from '../src/protocol/opcodes.js';
import { readFileSync } from '../src/methods/readFile.js';
import { writeFileSync } from '../src/methods/writeFile.js';
import type { SyncRequestFn } from '../src/methods/context.js';

/**
 * Mock FileSystemSyncAccessHandle backed by an ArrayBuffer.
 */
class MockSyncHandle {
  private buffer: Uint8Array;
  private size: number;

  constructor(initialSize: number = 0) {
    this.buffer = new Uint8Array(initialSize);
    this.size = initialSize;
  }

  getSize(): number { return this.size; }

  truncate(newSize: number): void {
    if (newSize > this.buffer.byteLength) {
      const newBuf = new Uint8Array(newSize);
      newBuf.set(this.buffer.subarray(0, this.size));
      this.buffer = newBuf;
    }
    this.size = newSize;
  }

  read(buf: Uint8Array, opts?: { at?: number }): number {
    const at = opts?.at ?? 0;
    const len = Math.min(buf.byteLength, this.size - at);
    if (len <= 0) return 0;
    buf.set(this.buffer.subarray(at, at + len));
    return len;
  }

  write(buf: Uint8Array, opts?: { at?: number }): number {
    const at = opts?.at ?? 0;
    const end = at + buf.byteLength;
    if (end > this.buffer.byteLength) {
      const newBuf = new Uint8Array(end * 2);
      newBuf.set(this.buffer.subarray(0, this.size));
      this.buffer = newBuf;
    }
    this.buffer.set(buf, at);
    if (end > this.size) this.size = end;
    return buf.byteLength;
  }

  flush(): void {}
  close(): void {}
}

/**
 * Create a syncRequest function backed by a real VFSEngine.
 * Dispatches protocol messages the same way the server worker does.
 */
function createSyncRequest(engine: VFSEngine): SyncRequestFn {
  const tabId = 'test-tab';

  return (buf: ArrayBuffer) => {
    const { op, flags, path, data } = decodeRequest(buf);
    let result: { status: number; data?: Uint8Array | null };

    switch (op) {
      case OP.READ:
        result = engine.read(path);
        break;

      case OP.WRITE:
        result = engine.write(path, data ?? new Uint8Array(0), flags);
        break;

      case OP.OPEN:
        result = engine.open(path, flags, tabId);
        break;

      case OP.CLOSE: {
        const fd = data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
        result = engine.close(fd);
        break;
      }

      case OP.FREAD: {
        if (!data || data.byteLength < 16) {
          result = { status: 7 };
          break;
        }
        const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const fd = dv.getUint32(0, true);
        const length = dv.getUint32(4, true);
        const pos = dv.getFloat64(8, true);
        result = engine.fread(fd, length, pos === -1 ? null : pos);
        break;
      }

      case OP.FWRITE: {
        if (!data || data.byteLength < 12) {
          result = { status: 7 };
          break;
        }
        const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const fd = dv.getUint32(0, true);
        const pos = dv.getFloat64(4, true);
        const writeData = data.subarray(12);
        result = engine.fwrite(fd, writeData, pos === -1 ? null : pos);
        break;
      }

      default:
        result = { status: 7 }; // EINVAL
    }

    return {
      status: result.status,
      data: result.data ?? null,
    };
  };
}

describe('readFile/writeFile flag options', () => {
  let engine: VFSEngine;
  let syncRequest: SyncRequestFn;

  beforeEach(() => {
    engine = new VFSEngine();
    const handle = new MockSyncHandle(0);
    engine.init(handle as unknown as FileSystemSyncAccessHandle);
    syncRequest = createSyncRequest(engine);
  });

  describe('writeFileSync with flag option', () => {
    it('should write normally with default flag (no flag specified)', () => {
      writeFileSync(syncRequest, '/test.txt', 'hello');
      const content = readFileSync(syncRequest, '/test.txt', 'utf8');
      expect(content).toBe('hello');
    });

    it('should write normally with explicit flag "w"', () => {
      writeFileSync(syncRequest, '/test.txt', 'hello', { flag: 'w' });
      const content = readFileSync(syncRequest, '/test.txt', 'utf8');
      expect(content).toBe('hello');
    });

    it('should succeed with flag "wx" for a new file', () => {
      writeFileSync(syncRequest, '/new.txt', 'exclusive', { flag: 'wx' });
      const content = readFileSync(syncRequest, '/new.txt', 'utf8');
      expect(content).toBe('exclusive');
    });

    it('should fail with flag "wx" when file already exists (EEXIST)', () => {
      writeFileSync(syncRequest, '/exists.txt', 'first');
      expect(() => {
        writeFileSync(syncRequest, '/exists.txt', 'second', { flag: 'wx' });
      }).toThrow(/EEXIST/);
    });

    it('should still work with the fast path (no options at all)', () => {
      writeFileSync(syncRequest, '/fast.txt', 'fast');
      const content = readFileSync(syncRequest, '/fast.txt', 'utf8');
      expect(content).toBe('fast');
    });

    it('should still work with string encoding option (fast path)', () => {
      writeFileSync(syncRequest, '/enc.txt', 'encoded', 'utf8');
      const content = readFileSync(syncRequest, '/enc.txt', 'utf8');
      expect(content).toBe('encoded');
    });
  });

  describe('readFileSync with flag option', () => {
    it('should read normally with default flag (no flag specified)', () => {
      writeFileSync(syncRequest, '/read.txt', 'data');
      const content = readFileSync(syncRequest, '/read.txt', 'utf8');
      expect(content).toBe('data');
    });

    it('should read with explicit flag "r"', () => {
      writeFileSync(syncRequest, '/read.txt', 'data');
      const content = readFileSync(syncRequest, '/read.txt', { encoding: 'utf8', flag: 'r' });
      expect(content).toBe('data');
    });

    it('should read with flag "r+" (read-write)', () => {
      writeFileSync(syncRequest, '/rw.txt', 'read-write');
      const content = readFileSync(syncRequest, '/rw.txt', { encoding: 'utf8', flag: 'r+' });
      expect(content).toBe('read-write');
    });

    it('should return Uint8Array when no encoding is specified', () => {
      writeFileSync(syncRequest, '/bin.txt', 'binary');
      const result = readFileSync(syncRequest, '/bin.txt');
      expect(result).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(result as Uint8Array)).toBe('binary');
    });

    it('should return Uint8Array with non-default flag and no encoding', () => {
      writeFileSync(syncRequest, '/bin2.txt', 'binary2');
      const result = readFileSync(syncRequest, '/bin2.txt', { flag: 'r+' });
      expect(result).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(result as Uint8Array)).toBe('binary2');
    });

    it('should still work with the fast path (no options at all)', () => {
      writeFileSync(syncRequest, '/fast-read.txt', 'fast');
      const content = readFileSync(syncRequest, '/fast-read.txt', 'utf8');
      expect(content).toBe('fast');
    });
  });
});
