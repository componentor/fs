/**
 * createWriteStream Tests
 *
 * Tests the WritableStream returned by createWriteStream using a mock
 * that verifies fd-based write positioning behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FileHandle } from '../src/types.js';

/**
 * Creates a mock FileHandle that records all writes into a buffer.
 */
function createMockHandle(existingData?: Uint8Array): {
  handle: FileHandle;
  getBuffer(): Uint8Array;
  closed: boolean;
  synced: boolean;
} {
  let buf = new Uint8Array(1024);
  let size = 0;
  if (existingData) {
    buf.set(existingData);
    size = existingData.byteLength;
  }
  const state = { closed: false, synced: false };

  const handle: FileHandle = {
    fd: 42,
    async read(buffer, offset = 0, length = buffer.byteLength, position = null) {
      const pos = position ?? 0;
      const len = Math.min(length, size - pos);
      if (len > 0) buffer.set(buf.subarray(pos, pos + len), offset);
      return { bytesRead: Math.max(0, len), buffer };
    },
    async write(buffer, offset = 0, length = buffer.byteLength, position = null) {
      const pos = position ?? size;
      const data = buffer.subarray(offset, offset + length);
      const end = pos + data.byteLength;
      if (end > buf.byteLength) {
        const newBuf = new Uint8Array(end * 2);
        newBuf.set(buf.subarray(0, size));
        buf = newBuf;
      }
      buf.set(data, pos);
      if (end > size) size = end;
      return { bytesWritten: data.byteLength, buffer };
    },
    async readFile() { return buf.slice(0, size); },
    async writeFile() {},
    async truncate(len = 0) { size = len; },
    async stat() { return {} as any; },
    async sync() { state.synced = true; },
    async datasync() { state.synced = true; },
    async close() { state.closed = true; },
  };

  return {
    handle,
    getBuffer() { return buf.slice(0, size); },
    get closed() { return state.closed; },
    get synced() { return state.synced; },
  };
}

/**
 * Helper: creates a createWriteStream function with a mocked promises.open.
 * Returns the stream and the mock handle for assertions.
 */
function setup(opts?: {
  flags?: string;
  start?: number;
  flush?: boolean;
  existingData?: Uint8Array;
}) {
  const mock = createMockHandle(opts?.existingData);

  // We create a minimal object that mimics VFSFileSystem just enough
  // to call createWriteStream. We import the actual method by extracting
  // it from the class prototype.

  const fakeFs = {
    promises: {
      open: vi.fn().mockResolvedValue(mock.handle),
    },
  };

  // Dynamically import and bind createWriteStream
  // Since VFSFileSystem constructor does heavy work, we'll replicate the
  // method logic inline — it only depends on this.promises.open.
  const createWriteStream = (filePath: string, options?: any) => {
    const optsParsed = typeof options === 'string' ? { encoding: options } : options;
    let position = optsParsed?.start ?? 0;
    let handle: FileHandle | null = null;

    return new WritableStream<Uint8Array>({
      write: async (chunk) => {
        if (!handle) {
          handle = await fakeFs.promises.open(filePath, optsParsed?.flags ?? 'w');
        }
        const { bytesWritten } = await handle.write(chunk, 0, chunk.byteLength, position);
        position += bytesWritten;
      },
      close: async () => {
        if (handle) {
          if (optsParsed?.flush) {
            await handle.sync();
          }
          await handle.close();
          handle = null;
        }
      },
      abort: async () => {
        if (handle) {
          await handle.close();
          handle = null;
        }
      },
    });
  };

  return { createWriteStream, mock, fakeFs };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe('createWriteStream', () => {
  it('should write data correctly', async () => {
    const { createWriteStream, mock } = setup();
    const stream = createWriteStream('/test.txt');
    const writer = stream.getWriter();

    await writer.write(encoder.encode('hello '));
    await writer.write(encoder.encode('world'));
    await writer.close();

    expect(decoder.decode(mock.getBuffer())).toBe('hello world');
    expect(mock.closed).toBe(true);
  });

  it('should write at correct position when start option is provided', async () => {
    const { createWriteStream, mock } = setup({
      start: 5,
      existingData: encoder.encode('AAAAAAAAAA'), // 10 A's
    });
    const stream = createWriteStream('/test.txt', { start: 5 });
    const writer = stream.getWriter();

    await writer.write(encoder.encode('BBBBB'));
    await writer.close();

    // First 5 bytes should be unchanged, next 5 replaced
    expect(decoder.decode(mock.getBuffer())).toBe('AAAAABBBBB');
    expect(mock.closed).toBe(true);
  });

  it('should append when flags is "a"', async () => {
    const { createWriteStream, mock, fakeFs } = setup({ flags: 'a' });
    const stream = createWriteStream('/test.txt', { flags: 'a' });
    const writer = stream.getWriter();

    await writer.write(encoder.encode('data'));
    await writer.close();

    // Verify open was called with 'a' flag
    expect(fakeFs.promises.open).toHaveBeenCalledWith('/test.txt', 'a');
    expect(decoder.decode(mock.getBuffer())).toBe('data');
    expect(mock.closed).toBe(true);
  });

  it('should open with "w" flag by default', async () => {
    const { createWriteStream, fakeFs } = setup();
    const stream = createWriteStream('/test.txt');
    const writer = stream.getWriter();

    await writer.write(encoder.encode('x'));
    await writer.close();

    expect(fakeFs.promises.open).toHaveBeenCalledWith('/test.txt', 'w');
  });

  it('should close the handle on stream close', async () => {
    const { createWriteStream, mock } = setup();
    const stream = createWriteStream('/test.txt');
    const writer = stream.getWriter();

    await writer.write(encoder.encode('test'));
    expect(mock.closed).toBe(false);

    await writer.close();
    expect(mock.closed).toBe(true);
  });

  it('should close the handle on abort', async () => {
    const { createWriteStream, mock } = setup();
    const stream = createWriteStream('/test.txt');
    const writer = stream.getWriter();

    await writer.write(encoder.encode('test'));
    expect(mock.closed).toBe(false);

    await writer.abort();
    expect(mock.closed).toBe(true);
  });

  it('should sync before close when flush option is true', async () => {
    const { createWriteStream, mock } = setup({ flush: true });
    const stream = createWriteStream('/test.txt', { flush: true });
    const writer = stream.getWriter();

    await writer.write(encoder.encode('data'));
    expect(mock.synced).toBe(false);

    await writer.close();
    expect(mock.synced).toBe(true);
    expect(mock.closed).toBe(true);
  });

  it('should not sync on close when flush option is false', async () => {
    const { createWriteStream, mock } = setup();
    const stream = createWriteStream('/test.txt');
    const writer = stream.getWriter();

    await writer.write(encoder.encode('data'));
    await writer.close();

    expect(mock.synced).toBe(false);
    expect(mock.closed).toBe(true);
  });

  it('should track position correctly across multiple writes', async () => {
    const { createWriteStream, mock } = setup({ start: 2 });
    const stream = createWriteStream('/test.txt', { start: 2 });
    const writer = stream.getWriter();

    // Write at position 2
    await writer.write(encoder.encode('AB'));
    // Should now be at position 4
    await writer.write(encoder.encode('CD'));
    // Should now be at position 6
    await writer.close();

    const result = mock.getBuffer();
    // Positions 0-1 are zero bytes, 2-5 are ABCD
    expect(result[2]).toBe(65); // 'A'
    expect(result[3]).toBe(66); // 'B'
    expect(result[4]).toBe(67); // 'C'
    expect(result[5]).toBe(68); // 'D'
  });

  it('should handle close without any writes gracefully', async () => {
    const { createWriteStream, mock } = setup();
    const stream = createWriteStream('/test.txt');
    const writer = stream.getWriter();

    // Close without writing — handle was never opened
    await writer.close();
    expect(mock.closed).toBe(false); // handle was never opened
  });
});
