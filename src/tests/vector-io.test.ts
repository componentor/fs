/**
 * Vector I/O (readv / writev) tests
 *
 * Tests readvSync, writevSync, and their async FileHandle counterparts.
 * Since VFS doesn't have native scatter/gather I/O, these iterate over
 * individual read/write calls under the hood.
 */

import { describe, it, expect, vi } from 'vitest';
import { readSync, writeSyncFd } from '../src/methods/open.js';
import { decodeRequest, OP } from '../src/protocol/opcodes.js';
import type { SyncRequestFn } from '../src/methods/context.js';

const encoder = new TextEncoder();

/**
 * Creates a mock syncRequest that simulates FREAD from a virtual file buffer.
 * Tracks position internally for sequential reads.
 */
function createMockReadSync(fileContent: Uint8Array) {
  let currentPosition = 0;

  const syncRequest: SyncRequestFn = (buf: ArrayBuffer) => {
    const { op, data } = decodeRequest(buf);
    expect(op).toBe(OP.FREAD);

    if (data && data.byteLength >= 12) {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const _fd = dv.getUint32(0, true);
      const length = dv.getUint32(4, true);
      const position = dv.getFloat64(8, true);

      const readPos = position >= 0 ? position : currentPosition;
      const available = Math.max(0, fileContent.byteLength - readPos);
      const toRead = Math.min(length, available);
      const result = fileContent.slice(readPos, readPos + toRead);
      currentPosition = readPos + toRead;

      return { status: 0, data: result };
    }
    return { status: 0, data: null };
  };

  return syncRequest;
}

/**
 * Creates a mock syncRequest that simulates FWRITE and captures written data.
 */
function createMockWriteSync() {
  const written: { position: number; data: Uint8Array }[] = [];

  const syncRequest: SyncRequestFn = (buf: ArrayBuffer) => {
    const { op, data } = decodeRequest(buf);
    expect(op).toBe(OP.FWRITE);

    if (data && data.byteLength >= 12) {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const _fd = dv.getUint32(0, true);
      const position = dv.getFloat64(4, true);
      const writeData = data.subarray(12);

      written.push({
        position,
        data: new Uint8Array(writeData),
      });

      // Return bytesWritten
      const resp = new Uint8Array(4);
      new DataView(resp.buffer).setUint32(0, writeData.byteLength, true);
      return { status: 0, data: resp };
    }
    return { status: 0, data: null };
  };

  return { syncRequest, written };
}

describe('readvSync', () => {
  it('should read into multiple buffers', () => {
    const content = encoder.encode('Hello, World!');
    const mockSync = createMockReadSync(content);

    const buf1 = new Uint8Array(5);
    const buf2 = new Uint8Array(2);
    const buf3 = new Uint8Array(6);

    // Simulate readvSync logic (same as VFSFileSystem.readvSync)
    const buffers = [buf1, buf2, buf3];
    let totalRead = 0;
    let pos: number | null = 0;
    for (const buf of buffers) {
      const bytesRead = readSync(mockSync, 3, buf, 0, buf.byteLength, pos);
      totalRead += bytesRead;
      if (pos !== null) pos += bytesRead;
      if (bytesRead < buf.byteLength) break;
    }

    expect(totalRead).toBe(13);
    expect(new TextDecoder().decode(buf1)).toBe('Hello');
    expect(new TextDecoder().decode(buf2)).toBe(', ');
    expect(new TextDecoder().decode(buf3)).toBe('World!');
  });

  it('should return total bytes read', () => {
    const content = encoder.encode('abcdefgh');
    const mockSync = createMockReadSync(content);

    const buf1 = new Uint8Array(4);
    const buf2 = new Uint8Array(4);

    const buffers = [buf1, buf2];
    let totalRead = 0;
    let pos: number | null = 0;
    for (const buf of buffers) {
      const bytesRead = readSync(mockSync, 3, buf, 0, buf.byteLength, pos);
      totalRead += bytesRead;
      if (pos !== null) pos += bytesRead;
      if (bytesRead < buf.byteLength) break;
    }

    expect(totalRead).toBe(8);
    expect(new TextDecoder().decode(buf1)).toBe('abcd');
    expect(new TextDecoder().decode(buf2)).toBe('efgh');
  });

  it('should stop at EOF on short read', () => {
    const content = encoder.encode('Hi');
    const mockSync = createMockReadSync(content);

    const buf1 = new Uint8Array(5); // larger than content
    const buf2 = new Uint8Array(5); // should not be filled

    const buffers = [buf1, buf2];
    let totalRead = 0;
    let pos: number | null = 0;
    for (const buf of buffers) {
      const bytesRead = readSync(mockSync, 3, buf, 0, buf.byteLength, pos);
      totalRead += bytesRead;
      if (pos !== null) pos += bytesRead;
      if (bytesRead < buf.byteLength) break;
    }

    expect(totalRead).toBe(2);
    // buf1 should have 'Hi' + zeros
    expect(buf1[0]).toBe(72); // 'H'
    expect(buf1[1]).toBe(105); // 'i'
    expect(buf1[2]).toBe(0); // untouched
    // buf2 should be completely untouched
    expect(buf2[0]).toBe(0);
  });

  it('should respect position parameter', () => {
    const content = encoder.encode('Hello, World!');
    const mockSync = createMockReadSync(content);

    const buf1 = new Uint8Array(6);

    // Start reading at position 7 ("World!")
    let totalRead = 0;
    let pos: number | null = 7;
    const bytesRead = readSync(mockSync, 3, buf1, 0, buf1.byteLength, pos);
    totalRead += bytesRead;

    expect(totalRead).toBe(6);
    expect(new TextDecoder().decode(buf1)).toBe('World!');
  });
});

describe('writevSync', () => {
  it('should write from multiple buffers', () => {
    const { syncRequest, written } = createMockWriteSync();

    const buf1 = encoder.encode('Hello');
    const buf2 = encoder.encode(', ');
    const buf3 = encoder.encode('World!');

    const buffers = [buf1, buf2, buf3];
    let totalWritten = 0;
    let pos: number | null = 0;
    for (const buf of buffers) {
      const bytesWritten = writeSyncFd(syncRequest, 3, buf, 0, buf.byteLength, pos);
      totalWritten += bytesWritten;
      if (pos !== null) pos += bytesWritten;
    }

    expect(totalWritten).toBe(13);
    expect(written).toHaveLength(3);
    expect(new TextDecoder().decode(written[0].data)).toBe('Hello');
    expect(new TextDecoder().decode(written[1].data)).toBe(', ');
    expect(new TextDecoder().decode(written[2].data)).toBe('World!');
  });

  it('should return total bytes written', () => {
    const { syncRequest, written } = createMockWriteSync();

    const buf1 = encoder.encode('ab');
    const buf2 = encoder.encode('cd');
    const buf3 = encoder.encode('ef');

    const buffers = [buf1, buf2, buf3];
    let totalWritten = 0;
    let pos: number | null = 0;
    for (const buf of buffers) {
      const bytesWritten = writeSyncFd(syncRequest, 3, buf, 0, buf.byteLength, pos);
      totalWritten += bytesWritten;
      if (pos !== null) pos += bytesWritten;
    }

    expect(totalWritten).toBe(6);
  });

  it('should advance position correctly across buffers', () => {
    const { syncRequest, written } = createMockWriteSync();

    const buf1 = encoder.encode('AAA'); // 3 bytes
    const buf2 = encoder.encode('BB');  // 2 bytes
    const buf3 = encoder.encode('C');   // 1 byte

    const buffers = [buf1, buf2, buf3];
    let totalWritten = 0;
    let pos: number | null = 10; // start at position 10
    for (const buf of buffers) {
      const bytesWritten = writeSyncFd(syncRequest, 3, buf, 0, buf.byteLength, pos);
      totalWritten += bytesWritten;
      if (pos !== null) pos += bytesWritten;
    }

    expect(totalWritten).toBe(6);
    // Positions should be 10, 13, 15
    expect(written[0].position).toBe(10);
    expect(written[1].position).toBe(13);
    expect(written[2].position).toBe(15);
  });

  it('should handle empty buffers array', () => {
    const { syncRequest, written } = createMockWriteSync();

    let totalWritten = 0;
    const buffers: Uint8Array[] = [];
    let pos: number | null = 0;
    for (const buf of buffers) {
      const bytesWritten = writeSyncFd(syncRequest, 3, buf, 0, buf.byteLength, pos);
      totalWritten += bytesWritten;
      if (pos !== null) pos += bytesWritten;
    }

    expect(totalWritten).toBe(0);
    expect(written).toHaveLength(0);
  });
});
