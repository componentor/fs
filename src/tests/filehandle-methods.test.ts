/**
 * Tests for FileHandle methods: appendFile, chmod, chown, Symbol.asyncDispose
 */

import { describe, it, expect, vi } from 'vitest';
import { open } from '../src/methods/open.js';
import { OP } from '../src/protocol/opcodes.js';
import type { AsyncRequestFn } from '../src/methods/context.js';

const encoder = new TextEncoder();

/**
 * Encode a stat response buffer (53 bytes) for a file with the given size.
 */
function encodeStatData(size: number): Uint8Array {
  const buf = new Uint8Array(53);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, 1); // INODE_TYPE.FILE
  dv.setUint32(1, 0o100644, true); // mode
  dv.setFloat64(5, size, true); // size
  const now = Date.now();
  dv.setFloat64(13, now, true); // mtime
  dv.setFloat64(21, now, true); // ctime
  dv.setFloat64(29, now, true); // atime
  dv.setUint32(37, 0, true); // uid
  dv.setUint32(41, 0, true); // gid
  dv.setUint32(45, 1, true); // ino
  dv.setUint32(49, 1, true); // nlink
  return buf;
}

/**
 * Create a mock asyncRequest that tracks calls and returns appropriate responses.
 */
function createMockAsync(opts?: { fileSize?: number }) {
  const fileSize = opts?.fileSize ?? 0;
  const calls: Array<{ op: number; fdArgs?: Record<string, unknown> }> = [];

  const asyncRequest: AsyncRequestFn = async (op, _path, _flags, _data, _path2, fdArgs) => {
    calls.push({ op, fdArgs: fdArgs as Record<string, unknown> });

    if (op === OP.OPEN) {
      // Return fd = 7
      const resp = new Uint8Array(4);
      new DataView(resp.buffer).setUint32(0, 7, true);
      return { status: 0, data: resp };
    }
    if (op === OP.FSTAT) {
      return { status: 0, data: encodeStatData(fileSize) };
    }
    if (op === OP.FWRITE) {
      const written = (fdArgs as Record<string, unknown>)?.data as Uint8Array;
      const resp = new Uint8Array(4);
      new DataView(resp.buffer).setUint32(0, written?.byteLength ?? 0, true);
      return { status: 0, data: resp };
    }
    if (op === OP.CLOSE) {
      return { status: 0, data: null };
    }
    return { status: 0, data: null };
  };

  return { asyncRequest, calls };
}

describe('FileHandle.appendFile', () => {
  it('appends string data at end of file', async () => {
    const { asyncRequest, calls } = createMockAsync({ fileSize: 10 });
    const handle = await open(asyncRequest, '/test.txt', 'a');

    await handle.appendFile('hello');

    // Should have: OPEN, FSTAT (to get size), FWRITE
    const writeCalls = calls.filter(c => c.op === OP.FWRITE);
    expect(writeCalls).toHaveLength(1);
    const writeArgs = writeCalls[0].fdArgs!;
    expect(writeArgs.position).toBe(10); // file size was 10
    expect(writeArgs.data).toEqual(encoder.encode('hello'));
  });

  it('appends Uint8Array data at end of file', async () => {
    const { asyncRequest, calls } = createMockAsync({ fileSize: 5 });
    const handle = await open(asyncRequest, '/test.bin', 'a');
    const data = new Uint8Array([1, 2, 3, 4]);

    await handle.appendFile(data);

    const writeCalls = calls.filter(c => c.op === OP.FWRITE);
    expect(writeCalls).toHaveLength(1);
    const writeArgs = writeCalls[0].fdArgs!;
    expect(writeArgs.position).toBe(5);
    expect(writeArgs.data).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('appends to an empty file (position 0)', async () => {
    const { asyncRequest, calls } = createMockAsync({ fileSize: 0 });
    const handle = await open(asyncRequest, '/empty.txt', 'a');

    await handle.appendFile('first');

    const writeCalls = calls.filter(c => c.op === OP.FWRITE);
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0].fdArgs!.position).toBe(0);
  });
});

describe('FileHandle.chmod', () => {
  it('does not throw', async () => {
    const { asyncRequest } = createMockAsync();
    const handle = await open(asyncRequest, '/test.txt', 'r');

    await expect(handle.chmod(0o755)).resolves.toBeUndefined();
  });
});

describe('FileHandle.chown', () => {
  it('does not throw', async () => {
    const { asyncRequest } = createMockAsync();
    const handle = await open(asyncRequest, '/test.txt', 'r');

    await expect(handle.chown(1000, 1000)).resolves.toBeUndefined();
  });
});

describe('FileHandle[Symbol.asyncDispose]', () => {
  it('calls close', async () => {
    const { asyncRequest, calls } = createMockAsync();
    const handle = await open(asyncRequest, '/test.txt', 'r');

    await handle[Symbol.asyncDispose]();

    const closeCalls = calls.filter(c => c.op === OP.CLOSE);
    expect(closeCalls).toHaveLength(1);
  });

  it('returns a promise', async () => {
    const { asyncRequest } = createMockAsync();
    const handle = await open(asyncRequest, '/test.txt', 'r');

    const result = handle[Symbol.asyncDispose]();
    expect(result).toBeInstanceOf(Promise);
    await result;
  });
});
