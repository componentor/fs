/**
 * Tests for object-form overloads of readSync and writeSyncFd.
 *
 * Node.js supports:
 *   readSync(fd, buffer, { offset?, length?, position? })
 *   readSync(fd, { buffer, offset?, length?, position? })
 *   writeSync(fd, buffer, { offset?, length?, position? })
 * These tests verify that our implementations handle all forms.
 */

import { describe, it, expect } from 'vitest';
import { readSync, writeSyncFd } from '../src/methods/open.js';
import { decodeRequest, OP } from '../src/protocol/opcodes.js';
import type { SyncRequestFn } from '../src/methods/context.js';

const encoder = new TextEncoder();

/**
 * Creates a mock syncRequest for FREAD that returns the given data.
 * Captures the decoded request parameters.
 */
function createReadMock(responseData: Uint8Array) {
  let captured: { fd: number; length: number; position: number } | null = null;

  const syncRequest: SyncRequestFn = (buf: ArrayBuffer) => {
    const { op, data } = decodeRequest(buf);
    expect(op).toBe(OP.FREAD);
    if (data && data.byteLength >= 16) {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      captured = {
        fd: dv.getUint32(0, true),
        length: dv.getUint32(4, true),
        position: dv.getFloat64(8, true),
      };
    }
    return { status: 0, data: responseData };
  };

  return { syncRequest, getCaptured: () => captured };
}

/**
 * Creates a mock syncRequest for FWRITE that captures the decoded payload.
 */
function createWriteMock() {
  let captured: { fd: number; position: number; writeData: Uint8Array } | null = null;

  const syncRequest: SyncRequestFn = (buf: ArrayBuffer) => {
    const { op, data } = decodeRequest(buf);
    expect(op).toBe(OP.FWRITE);
    if (data && data.byteLength >= 12) {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      captured = {
        fd: dv.getUint32(0, true),
        position: dv.getFloat64(4, true),
        writeData: new Uint8Array(data.subarray(12)),
      };
      const resp = new Uint8Array(4);
      new DataView(resp.buffer).setUint32(0, data.byteLength - 12, true);
      return { status: 0, data: resp };
    }
    return { status: 0, data: null };
  };

  return { syncRequest, getCaptured: () => captured };
}

describe('readSync object-form overloads', () => {
  it('readSync(fd, buffer, { offset, length, position }) works', () => {
    const payload = encoder.encode('hello');
    const mock = createReadMock(payload);
    const buffer = new Uint8Array(20);

    const bytesRead = readSync(mock.syncRequest, 3, buffer, { offset: 5, length: 5, position: 10 });

    expect(bytesRead).toBe(5);
    expect(buffer.subarray(5, 10)).toEqual(payload);
    const captured = mock.getCaptured()!;
    expect(captured.fd).toBe(3);
    expect(captured.length).toBe(5);
    expect(captured.position).toBe(10);
  });

  it('readSync(fd, { buffer, offset, length, position }) works', () => {
    const payload = encoder.encode('world');
    const mock = createReadMock(payload);
    const buffer = new Uint8Array(20);

    const bytesRead = readSync(mock.syncRequest, 5, { buffer, offset: 2, length: 5, position: 42 });

    expect(bytesRead).toBe(5);
    expect(buffer.subarray(2, 7)).toEqual(payload);
    const captured = mock.getCaptured()!;
    expect(captured.fd).toBe(5);
    expect(captured.length).toBe(5);
    expect(captured.position).toBe(42);
  });

  it('readSync(fd, buffer, {}) uses defaults for omitted options', () => {
    const payload = encoder.encode('abc');
    const mock = createReadMock(payload);
    const buffer = new Uint8Array(10);

    const bytesRead = readSync(mock.syncRequest, 1, buffer, {});

    expect(bytesRead).toBe(3);
    // Default offset=0, so data starts at index 0
    expect(buffer.subarray(0, 3)).toEqual(payload);
    const captured = mock.getCaptured()!;
    // Default length = buffer.byteLength
    expect(captured.length).toBe(10);
    // Default position = null maps to -1
    expect(captured.position).toBe(-1);
  });

  it('readSync(fd, { buffer }) uses defaults for omitted options', () => {
    const payload = encoder.encode('xy');
    const mock = createReadMock(payload);
    const buffer = new Uint8Array(8);

    const bytesRead = readSync(mock.syncRequest, 2, { buffer });

    expect(bytesRead).toBe(2);
    expect(buffer.subarray(0, 2)).toEqual(payload);
    const captured = mock.getCaptured()!;
    expect(captured.length).toBe(8);
    expect(captured.position).toBe(-1);
  });

  it('readSync(fd, buffer, offset, length, position) still works (positional args)', () => {
    const payload = encoder.encode('test');
    const mock = createReadMock(payload);
    const buffer = new Uint8Array(20);

    const bytesRead = readSync(mock.syncRequest, 7, buffer, 3, 4, 100);

    expect(bytesRead).toBe(4);
    expect(buffer.subarray(3, 7)).toEqual(payload);
    const captured = mock.getCaptured()!;
    expect(captured.fd).toBe(7);
    expect(captured.length).toBe(4);
    expect(captured.position).toBe(100);
  });
});

describe('writeSyncFd object-form overloads', () => {
  it('writeSync(fd, buffer, { offset, length, position }) works', () => {
    const mock = createWriteMock();
    const buffer = encoder.encode('hello world');

    const bytesWritten = writeSyncFd(mock.syncRequest, 4, buffer, { offset: 6, length: 5, position: 20 });

    expect(bytesWritten).toBe(5);
    const captured = mock.getCaptured()!;
    expect(captured.fd).toBe(4);
    expect(captured.position).toBe(20);
    expect(captured.writeData).toEqual(encoder.encode('world'));
  });

  it('writeSync(fd, buffer, {}) uses defaults for omitted options', () => {
    const mock = createWriteMock();
    const buffer = encoder.encode('abc');

    const bytesWritten = writeSyncFd(mock.syncRequest, 2, buffer, {});

    expect(bytesWritten).toBe(3);
    const captured = mock.getCaptured()!;
    // Default offset=0, length=buffer.byteLength, position=null -> -1
    expect(captured.writeData).toEqual(encoder.encode('abc'));
    expect(captured.position).toBe(-1);
  });

  it('writeSync(fd, buffer, { position }) sets position only', () => {
    const mock = createWriteMock();
    const buffer = encoder.encode('data');

    const bytesWritten = writeSyncFd(mock.syncRequest, 3, buffer, { position: 50 });

    expect(bytesWritten).toBe(4);
    const captured = mock.getCaptured()!;
    expect(captured.writeData).toEqual(encoder.encode('data'));
    expect(captured.position).toBe(50);
  });

  it('writeSync(fd, buffer, offset, length, position) still works (positional args)', () => {
    const mock = createWriteMock();
    const buffer = encoder.encode('hello world');

    const bytesWritten = writeSyncFd(mock.syncRequest, 4, buffer, 0, 5, 10);

    expect(bytesWritten).toBe(5);
    const captured = mock.getCaptured()!;
    expect(captured.fd).toBe(4);
    expect(captured.position).toBe(10);
    expect(captured.writeData).toEqual(encoder.encode('hello'));
  });

  it('writeSync(fd, string, ...) still works (string overload unaffected)', () => {
    const mock = createWriteMock();

    const bytesWritten = writeSyncFd(mock.syncRequest, 1, 'hello', 5);

    expect(bytesWritten).toBe(5);
    const captured = mock.getCaptured()!;
    expect(captured.position).toBe(5);
    expect(captured.writeData).toEqual(encoder.encode('hello'));
  });
});
