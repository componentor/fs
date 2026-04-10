/**
 * writeSync / FileHandle.write string overload tests
 *
 * Tests that writeSyncFd correctly handles the string overload
 * (fd, string, position?, encoding?) in addition to the existing
 * buffer overload (fd, buffer, offset?, length?, position?).
 */

import { describe, it, expect, vi } from 'vitest';
import { writeSyncFd } from '../src/methods/open.js';
import { decodeRequest, OP } from '../src/protocol/opcodes.js';
import type { SyncRequestFn } from '../src/methods/context.js';

const encoder = new TextEncoder();

/**
 * Creates a mock syncRequest that captures the decoded FWRITE payload
 * and returns a bytesWritten response.
 */
function createMockSync() {
  let captured: { fd: number; position: number; writeData: Uint8Array } | null = null;

  const syncRequest: SyncRequestFn = (buf: ArrayBuffer) => {
    const { op, data } = decodeRequest(buf);
    expect(op).toBe(OP.FWRITE);
    if (data && data.byteLength >= 12) {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const fd = dv.getUint32(0, true);
      const position = dv.getFloat64(4, true);
      const writeData = data.subarray(12);
      captured = { fd, position, writeData: new Uint8Array(writeData) };

      // Return bytesWritten as a Uint8Array-wrapped uint32
      const resp = new Uint8Array(4);
      new DataView(resp.buffer).setUint32(0, writeData.byteLength, true);
      return { status: 0, data: resp };
    }
    return { status: 0, data: null };
  };

  return {
    syncRequest,
    getCaptured: () => captured,
  };
}

describe('writeSyncFd string overload', () => {
  it('writes a string correctly (no position)', () => {
    const mock = createMockSync();
    const result = writeSyncFd(mock.syncRequest, 3, 'hello');

    const captured = mock.getCaptured()!;
    expect(captured).not.toBeNull();
    expect(captured.fd).toBe(3);
    expect(captured.position).toBe(-1); // null maps to -1
    expect(captured.writeData).toEqual(encoder.encode('hello'));
    expect(result).toBe(5);
  });

  it('writes a string at a specific position', () => {
    const mock = createMockSync();
    const result = writeSyncFd(mock.syncRequest, 5, 'hello', 10);

    const captured = mock.getCaptured()!;
    expect(captured.fd).toBe(5);
    expect(captured.position).toBe(10);
    expect(captured.writeData).toEqual(encoder.encode('hello'));
    expect(result).toBe(5);
  });

  it('writes a string with position and encoding (encoding ignored)', () => {
    const mock = createMockSync();
    const result = writeSyncFd(mock.syncRequest, 5, 'hello', 20, 'utf-8');

    const captured = mock.getCaptured()!;
    expect(captured.position).toBe(20);
    expect(captured.writeData).toEqual(encoder.encode('hello'));
    expect(result).toBe(5);
  });

  it('writes a buffer with offset and length (existing behavior)', () => {
    const mock = createMockSync();
    const buf = encoder.encode('hello world');
    const result = writeSyncFd(mock.syncRequest, 4, buf, 0, 5, null);

    const captured = mock.getCaptured()!;
    expect(captured.fd).toBe(4);
    expect(captured.position).toBe(-1);
    expect(captured.writeData).toEqual(encoder.encode('hello'));
    expect(result).toBe(5);
  });

  it('writes a buffer at a specific position', () => {
    const mock = createMockSync();
    const buf = encoder.encode('world');
    const result = writeSyncFd(mock.syncRequest, 4, buf, 0, 5, 10);

    const captured = mock.getCaptured()!;
    expect(captured.fd).toBe(4);
    expect(captured.position).toBe(10);
    expect(captured.writeData).toEqual(encoder.encode('world'));
    expect(result).toBe(5);
  });

  it('writes a buffer with default offset/length', () => {
    const mock = createMockSync();
    const buf = encoder.encode('abc');
    const result = writeSyncFd(mock.syncRequest, 2, buf);

    const captured = mock.getCaptured()!;
    expect(captured.writeData).toEqual(encoder.encode('abc'));
    expect(result).toBe(3);
  });

  it('handles multi-byte UTF-8 strings', () => {
    const mock = createMockSync();
    const str = '\u00e9\u00e0\u00fc'; // e-acute, a-grave, u-umlaut
    const result = writeSyncFd(mock.syncRequest, 1, str);

    const captured = mock.getCaptured()!;
    const expected = encoder.encode(str);
    expect(captured.writeData).toEqual(expected);
    expect(result).toBe(expected.byteLength);
  });
});
