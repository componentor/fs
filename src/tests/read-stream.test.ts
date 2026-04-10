/**
 * createReadStream Tests
 *
 * Tests the ReadableStream returned by createReadStream,
 * verifying it uses fd-based reads (open/read/close) rather than
 * reading the entire file on every chunk pull.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test createReadStream by constructing a minimal mock that
// exercises the real stream logic. Since VFSFileSystem requires
// workers/SAB, we extract the stream method and bind it to a mock.

interface MockFileHandle {
  fd: number;
  read: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function createMockFS(fileData: Uint8Array) {
  const handle: MockFileHandle = {
    fd: 42,
    read: vi.fn(async (buffer: Uint8Array, offset: number, length: number, position: number) => {
      const available = Math.max(0, fileData.byteLength - position);
      const bytesRead = Math.min(length, available);
      if (bytesRead > 0) {
        buffer.set(fileData.subarray(position, position + bytesRead), offset);
      }
      return { bytesRead, buffer };
    }),
    close: vi.fn(async () => {}),
  };

  const openFn = vi.fn(async (_path: string, _flags: string) => handle);

  // Build a fake "this" context with .promises.open
  const ctx = {
    promises: {
      open: openFn,
    },
  };

  return { ctx, handle, openFn };
}

/**
 * Dynamically import the real createReadStream method and bind it to our mock context.
 * We import the module to get the class prototype method.
 */
async function getCreateReadStream() {
  // Import the module — this will fail if the workers can't be spawned,
  // so we grab the prototype method directly from the class.
  const mod = await import('../src/filesystem.js');
  const proto = mod.VFSFileSystem.prototype;
  return proto.createReadStream as (
    this: { promises: { open: (...args: unknown[]) => Promise<unknown> } },
    filePath: string,
    options?: unknown,
  ) => ReadableStream<Uint8Array>;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLen = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

describe('createReadStream', () => {
  let createReadStream: Awaited<ReturnType<typeof getCreateReadStream>>;

  beforeEach(async () => {
    createReadStream = await getCreateReadStream();
  });

  it('should read file contents correctly', async () => {
    const data = new TextEncoder().encode('Hello, streams!');
    const { ctx, handle, openFn } = createMockFS(data);

    const stream = createReadStream.call(ctx, '/test.txt');
    const result = await readAll(stream);

    expect(new TextDecoder().decode(result)).toBe('Hello, streams!');
    expect(openFn).toHaveBeenCalledWith('/test.txt', 'r');
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it('should not read the entire file for every chunk', async () => {
    // 256 bytes of data, 64-byte highWaterMark = 4 chunks
    const data = new Uint8Array(256);
    for (let i = 0; i < 256; i++) data[i] = i & 0xff;
    const { ctx, handle } = createMockFS(data);

    const stream = createReadStream.call(ctx, '/test.bin', { highWaterMark: 64 });
    await readAll(stream);

    // Should have been called 4 times for data + 1 time that returns 0 bytes
    // Each call should request at most 64 bytes, NOT the entire file
    for (const call of handle.read.mock.calls) {
      const [_buffer, _offset, length] = call;
      expect(length).toBeLessThanOrEqual(64);
    }

    // Verify positions are sequential: 0, 64, 128, 192, 256
    const positions = handle.read.mock.calls.map((c: unknown[]) => c[3]);
    expect(positions).toEqual([0, 64, 128, 192, 256]);
  });

  it('should handle start/end options correctly', async () => {
    const data = new TextEncoder().encode('0123456789');
    const { ctx, handle } = createMockFS(data);

    // Read bytes 3..6 (inclusive), which is "3456"
    const stream = createReadStream.call(ctx, '/test.txt', { start: 3, end: 6 });
    const result = await readAll(stream);

    expect(new TextDecoder().decode(result)).toBe('3456');

    // Verify first read starts at position 3
    expect(handle.read.mock.calls[0][3]).toBe(3);
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it('should respect custom highWaterMark', async () => {
    const data = new Uint8Array(1000);
    const { ctx, handle } = createMockFS(data);

    const stream = createReadStream.call(ctx, '/test.bin', { highWaterMark: 200 });
    await readAll(stream);

    // With 1000 bytes and 200 byte chunks, we expect 5 data reads + 1 EOF read = 6 total
    expect(handle.read.mock.calls.length).toBe(6);

    // Each read should request at most 200 bytes (the highWaterMark)
    for (const call of handle.read.mock.calls) {
      expect(call[2]).toBeLessThanOrEqual(200);
    }
  });

  it('should close the fd when stream completes', async () => {
    const data = new TextEncoder().encode('small');
    const { ctx, handle } = createMockFS(data);

    const stream = createReadStream.call(ctx, '/test.txt');
    await readAll(stream);

    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it('should close the fd when stream is cancelled', async () => {
    const data = new Uint8Array(10000);
    const { ctx, handle } = createMockFS(data);

    const stream = createReadStream.call(ctx, '/test.bin', { highWaterMark: 100 });
    const reader = stream.getReader();

    // Read one chunk then cancel
    await reader.read();
    await reader.cancel();

    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it('should close the fd and error the stream on read failure', async () => {
    const { ctx, handle } = createMockFS(new Uint8Array(0));

    // Override read to throw
    handle.read.mockRejectedValueOnce(new Error('I/O error'));

    const stream = createReadStream.call(ctx, '/test.txt');
    const reader = stream.getReader();

    await expect(reader.read()).rejects.toThrow('I/O error');
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it('should handle start/end with highWaterMark larger than range', async () => {
    const data = new TextEncoder().encode('abcdefghij');
    const { ctx } = createMockFS(data);

    // Range is 2..4 = 3 bytes, but highWaterMark is 64KB (default)
    const stream = createReadStream.call(ctx, '/test.txt', { start: 2, end: 4 });
    const result = await readAll(stream);

    expect(new TextDecoder().decode(result)).toBe('cde');
  });

  it('should handle empty files', async () => {
    const data = new Uint8Array(0);
    const { ctx, handle } = createMockFS(data);

    const stream = createReadStream.call(ctx, '/empty.txt');
    const result = await readAll(stream);

    expect(result.byteLength).toBe(0);
    expect(handle.close).toHaveBeenCalledTimes(1);
  });
});
