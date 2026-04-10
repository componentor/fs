/**
 * createReadStream Tests
 *
 * Tests the NodeReadable stream returned by createReadStream,
 * verifying it uses fd-based reads (open/read/close) rather than
 * reading the entire file on every chunk pull, and that the stream
 * exposes the Node.js Readable interface (.on, .pipe, .pause, etc.).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

  const ctx = {
    promises: {
      open: openFn,
    },
  };

  return { ctx, handle, openFn };
}

async function getCreateReadStream() {
  const mod = await import('../src/filesystem.js');
  const proto = mod.VFSFileSystem.prototype;
  return proto.createReadStream as (
    this: { promises: { open: (...args: unknown[]) => Promise<unknown> } },
    filePath: string,
    options?: unknown,
  ) => import('../src/node-streams.js').NodeReadable;
}

/** Collect all chunks from a NodeReadable via the 'data' event. */
function readAll(stream: import('../src/node-streams.js').NodeReadable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    stream.on('data', (chunk: unknown) => {
      chunks.push(chunk as Uint8Array);
    });
    stream.on('end', () => {
      const totalLen = chunks.reduce((sum, c) => sum + c.byteLength, 0);
      const result = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(result);
    });
    stream.on('error', reject);
  });
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
    const data = new Uint8Array(256);
    for (let i = 0; i < 256; i++) data[i] = i & 0xff;
    const { ctx, handle } = createMockFS(data);

    const stream = createReadStream.call(ctx, '/test.bin', { highWaterMark: 64 });
    await readAll(stream);

    for (const call of handle.read.mock.calls) {
      const [_buffer, _offset, length] = call;
      expect(length).toBeLessThanOrEqual(64);
    }

    const positions = handle.read.mock.calls.map((c: unknown[]) => c[3]);
    expect(positions).toEqual([0, 64, 128, 192, 256]);
  });

  it('should handle start/end options correctly', async () => {
    const data = new TextEncoder().encode('0123456789');
    const { ctx, handle } = createMockFS(data);

    const stream = createReadStream.call(ctx, '/test.txt', { start: 3, end: 6 });
    const result = await readAll(stream);

    expect(new TextDecoder().decode(result)).toBe('3456');
    expect(handle.read.mock.calls[0][3]).toBe(3);
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it('should respect custom highWaterMark', async () => {
    const data = new Uint8Array(1000);
    const { ctx, handle } = createMockFS(data);

    const stream = createReadStream.call(ctx, '/test.bin', { highWaterMark: 200 });
    await readAll(stream);

    expect(handle.read.mock.calls.length).toBe(6);

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

  it('should close the fd when stream is destroyed', async () => {
    const data = new Uint8Array(10000);
    const { ctx, handle } = createMockFS(data);

    const stream = createReadStream.call(ctx, '/test.bin', { highWaterMark: 100 });

    // Read one chunk then destroy, wait for 'close' which fires after cleanup.
    await new Promise<void>((resolve) => {
      stream.on('close', () => resolve());
      stream.once('data', () => {
        stream.destroy();
      });
    });

    expect(handle.close).toHaveBeenCalled();
  });

  it('should emit error on read failure', async () => {
    const { ctx, handle } = createMockFS(new Uint8Array(0));
    handle.read.mockRejectedValueOnce(new Error('I/O error'));

    const stream = createReadStream.call(ctx, '/test.txt');

    const err = await new Promise<Error>((resolve) => {
      stream.on('error', (e: unknown) => resolve(e as Error));
      // Need a 'data' listener to start flowing mode.
      stream.on('data', () => {});
    });

    expect(err.message).toBe('I/O error');
  });

  it('should handle start/end with highWaterMark larger than range', async () => {
    const data = new TextEncoder().encode('abcdefghij');
    const { ctx } = createMockFS(data);

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

  it('should set the path property', async () => {
    const data = new TextEncoder().encode('test');
    const { ctx } = createMockFS(data);

    const stream = createReadStream.call(ctx, '/my/file.txt');
    expect(stream.path).toBe('/my/file.txt');
  });

  it('should track bytesRead', async () => {
    const data = new Uint8Array(300);
    const { ctx } = createMockFS(data);

    const stream = createReadStream.call(ctx, '/test.bin', { highWaterMark: 100 });
    await readAll(stream);

    expect(stream.bytesRead).toBe(300);
  });
});
