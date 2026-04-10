/**
 * Tests for AbortSignal support in readFile/writeFile.
 *
 * Verifies that passing an already-aborted signal throws an AbortError,
 * and that normal operations without a signal still work.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VFSEngine } from '../src/vfs/engine.js';
import { OP, decodeRequest, encodeRequest } from '../src/protocol/opcodes.js';
import { readFileSync, readFile } from '../src/methods/readFile.js';
import { writeFileSync, writeFile } from '../src/methods/writeFile.js';
import type { SyncRequestFn, AsyncRequestFn } from '../src/methods/context.js';

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

/**
 * Create an asyncRequest function backed by a real VFSEngine.
 */
function createAsyncRequest(engine: VFSEngine): AsyncRequestFn {
  const syncReq = createSyncRequest(engine);

  return async (op: number, path: string, flags?: number, data?: Uint8Array) => {
    const buf = encodeRequest(op, path, flags ?? 0, data);
    return syncReq(buf);
  };
}

describe('AbortSignal support', () => {
  let engine: VFSEngine;
  let syncRequest: SyncRequestFn;
  let asyncRequest: AsyncRequestFn;

  beforeEach(() => {
    engine = new VFSEngine();
    const handle = new MockSyncHandle(0);
    engine.init(handle as unknown as FileSystemSyncAccessHandle);
    syncRequest = createSyncRequest(engine);
    asyncRequest = createAsyncRequest(engine);
  });

  describe('readFileSync', () => {
    it('should throw AbortError when signal is already aborted', () => {
      writeFileSync(syncRequest, '/test.txt', 'hello');
      const controller = new AbortController();
      controller.abort();
      expect(() => {
        readFileSync(syncRequest, '/test.txt', { signal: controller.signal });
      }).toThrow();
      try {
        readFileSync(syncRequest, '/test.txt', { signal: controller.signal });
      } catch (err: any) {
        expect(err.name).toBe('AbortError');
        expect(err.message).toBe('The operation was aborted');
      }
    });

    it('should work normally without a signal', () => {
      writeFileSync(syncRequest, '/test.txt', 'hello');
      const content = readFileSync(syncRequest, '/test.txt', { encoding: 'utf8' });
      expect(content).toBe('hello');
    });
  });

  describe('writeFileSync', () => {
    it('should throw AbortError when signal is already aborted', () => {
      const controller = new AbortController();
      controller.abort();
      expect(() => {
        writeFileSync(syncRequest, '/test.txt', 'hello', { signal: controller.signal });
      }).toThrow();
      try {
        writeFileSync(syncRequest, '/test.txt', 'hello', { signal: controller.signal });
      } catch (err: any) {
        expect(err.name).toBe('AbortError');
        expect(err.message).toBe('The operation was aborted');
      }
    });

    it('should work normally without a signal', () => {
      writeFileSync(syncRequest, '/test.txt', 'hello');
      const content = readFileSync(syncRequest, '/test.txt', 'utf8');
      expect(content).toBe('hello');
    });
  });

  describe('readFile (async)', () => {
    it('should throw AbortError when signal is already aborted', async () => {
      writeFileSync(syncRequest, '/test.txt', 'hello');
      const controller = new AbortController();
      controller.abort();
      try {
        await readFile(asyncRequest, '/test.txt', { signal: controller.signal });
        expect.unreachable('should have thrown');
      } catch (err: any) {
        expect(err.name).toBe('AbortError');
        expect(err.message).toBe('The operation was aborted');
      }
    });

    it('should work normally without a signal', async () => {
      writeFileSync(syncRequest, '/test.txt', 'hello');
      const content = await readFile(asyncRequest, '/test.txt', { encoding: 'utf8' });
      expect(content).toBe('hello');
    });
  });

  describe('writeFile (async)', () => {
    it('should throw AbortError when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      try {
        await writeFile(asyncRequest, '/test.txt', 'hello', { signal: controller.signal });
        expect.unreachable('should have thrown');
      } catch (err: any) {
        expect(err.name).toBe('AbortError');
        expect(err.message).toBe('The operation was aborted');
      }
    });

    it('should work normally without a signal', async () => {
      await writeFile(asyncRequest, '/test.txt', 'hello');
      const content = readFileSync(syncRequest, '/test.txt', 'utf8');
      expect(content).toBe('hello');
    });
  });

  describe('error shape', () => {
    it('should produce an error with name AbortError', () => {
      const controller = new AbortController();
      controller.abort();
      try {
        readFileSync(syncRequest, '/test.txt', { signal: controller.signal });
        expect.unreachable('should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(DOMException);
        expect(err.name).toBe('AbortError');
      }
    });
  });
});
