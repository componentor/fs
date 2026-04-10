/**
 * Symlink type parameter tests.
 *
 * Verifies that symlinkSync and symlink accept the optional `type` parameter
 * ('file', 'dir', 'junction', or null) for Node.js API compatibility.
 * The type parameter is accepted but ignored in the VFS implementation
 * (it is only meaningful on Windows).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VFSEngine } from '../src/vfs/engine.js';
import { symlinkSync, readlinkSync, symlink, readlink } from '../src/methods/symlink.js';
import { OP, decodeRequest } from '../src/protocol/opcodes.js';
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

  getSize(): number {
    return this.size;
  }

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
 * Create a syncRequest function backed by a VFSEngine.
 */
function makeSyncRequest(engine: VFSEngine): SyncRequestFn {
  return (buf: ArrayBuffer) => {
    const { op, path, data } = decodeRequest(buf);

    switch (op) {
      case OP.SYMLINK:
        return engine.symlink(new TextDecoder().decode(data!), path);
      case OP.READLINK:
        return engine.readlink(path);
      default:
        return { status: -1, data: null };
    }
  };
}

/**
 * Create an asyncRequest function backed by a VFSEngine.
 */
function makeAsyncRequest(engine: VFSEngine): AsyncRequestFn {
  return async (
    op: number,
    path: string,
    flags?: number,
    data?: Uint8Array | string | null,
    path2?: string,
  ) => {
    switch (op) {
      case OP.SYMLINK: {
        const target = typeof data === 'string'
          ? data
          : data instanceof Uint8Array
            ? new TextDecoder().decode(data)
            : '';
        return engine.symlink(target, path);
      }
      case OP.READLINK:
        return engine.readlink(path);
      default:
        return { status: -1, data: null };
    }
  };
}

describe('symlink type parameter', () => {
  let engine: VFSEngine;
  let syncReq: SyncRequestFn;
  let asyncReq: AsyncRequestFn;

  beforeEach(() => {
    engine = new VFSEngine();
    const handle = new MockSyncHandle(0);
    engine.init(handle as unknown as FileSystemSyncAccessHandle);
    syncReq = makeSyncRequest(engine);
    asyncReq = makeAsyncRequest(engine);
  });

  describe('symlinkSync', () => {
    it('should work without type parameter (existing behavior)', () => {
      engine.write('/target.txt', new TextEncoder().encode('hello'));
      expect(() => symlinkSync(syncReq, '/target.txt', '/link.txt')).not.toThrow();
      expect(readlinkSync(syncReq, '/link.txt')).toBe('/target.txt');
    });

    it('should work with type "file"', () => {
      engine.write('/target-file.txt', new TextEncoder().encode('file content'));
      expect(() => symlinkSync(syncReq, '/target-file.txt', '/link-file.txt', 'file')).not.toThrow();
      expect(readlinkSync(syncReq, '/link-file.txt')).toBe('/target-file.txt');
    });

    it('should work with type "dir"', () => {
      engine.mkdir('/target-dir', 0);
      expect(() => symlinkSync(syncReq, '/target-dir', '/link-dir', 'dir')).not.toThrow();
      expect(readlinkSync(syncReq, '/link-dir')).toBe('/target-dir');
    });

    it('should work with type null', () => {
      engine.write('/target-null.txt', new TextEncoder().encode('null type'));
      expect(() => symlinkSync(syncReq, '/target-null.txt', '/link-null.txt', null)).not.toThrow();
      expect(readlinkSync(syncReq, '/link-null.txt')).toBe('/target-null.txt');
    });
  });

  describe('symlink async', () => {
    it('should work with type parameter', async () => {
      engine.write('/async-target.txt', new TextEncoder().encode('async content'));
      await expect(symlink(asyncReq, '/async-target.txt', '/async-link.txt', 'file')).resolves.not.toThrow();
      const target = await readlink(asyncReq, '/async-link.txt');
      expect(target).toBe('/async-target.txt');
    });
  });

  describe('readlinkSync returns correct target regardless of type', () => {
    it('should return the same target for all type values', () => {
      engine.write('/common-target.txt', new TextEncoder().encode('data'));

      symlinkSync(syncReq, '/common-target.txt', '/link-no-type');
      symlinkSync(syncReq, '/common-target.txt', '/link-type-file', 'file');
      symlinkSync(syncReq, '/common-target.txt', '/link-type-dir', 'dir');
      symlinkSync(syncReq, '/common-target.txt', '/link-type-null', null);

      expect(readlinkSync(syncReq, '/link-no-type')).toBe('/common-target.txt');
      expect(readlinkSync(syncReq, '/link-type-file')).toBe('/common-target.txt');
      expect(readlinkSync(syncReq, '/link-type-dir')).toBe('/common-target.txt');
      expect(readlinkSync(syncReq, '/link-type-null')).toBe('/common-target.txt');
    });
  });
});
