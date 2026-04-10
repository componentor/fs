/**
 * createWriteStream Tests
 *
 * Tests the Node.js-compatible writable stream returned by createWriteStream,
 * verifying fd-based write positioning behavior via a mock.
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
 * Helper: dynamically import the real createWriteStream from VFSFileSystem
 * prototype and call it with a mocked promises.open context.
 */
async function getCreateWriteStream() {
  const mod = await import('../src/filesystem.js');
  const proto = mod.VFSFileSystem.prototype;
  return proto.createWriteStream as (
    this: { promises: { open: (...args: unknown[]) => Promise<unknown> } },
    filePath: string,
    options?: unknown,
  ) => import('../src/types.js').FSWriteStream;
}

function setup(opts?: {
  flags?: string;
  start?: number;
  flush?: boolean;
  existingData?: Uint8Array;
}) {
  const mock = createMockHandle(opts?.existingData);

  const fakeFs = {
    promises: {
      open: vi.fn().mockResolvedValue(mock.handle),
    },
  };

  return { mock, fakeFs };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe('createWriteStream', () => {
  let createWriteStream: Awaited<ReturnType<typeof getCreateWriteStream>>;

  beforeEach(async () => {
    createWriteStream = await getCreateWriteStream();
  });

  it('should write data correctly', async () => {
    const { mock, fakeFs } = setup();
    const stream = createWriteStream.call(fakeFs, '/test.txt');

    await new Promise<void>((resolve) => {
      stream.write('hello ', () => {
        stream.write('world', () => {
          stream.end(() => resolve());
        });
      });
    });

    expect(decoder.decode(mock.getBuffer())).toBe('hello world');
    expect(mock.closed).toBe(true);
  });

  it('should write at correct position when start option is provided', async () => {
    const { mock, fakeFs } = setup({
      start: 5,
      existingData: encoder.encode('AAAAAAAAAA'), // 10 A's
    });
    const stream = createWriteStream.call(fakeFs, '/test.txt', { start: 5 });

    await new Promise<void>((resolve) => {
      stream.write('BBBBB', () => {
        stream.end(() => resolve());
      });
    });

    expect(decoder.decode(mock.getBuffer())).toBe('AAAAABBBBB');
    expect(mock.closed).toBe(true);
  });

  it('should append when flags is "a"', async () => {
    const { mock, fakeFs } = setup({ flags: 'a' });
    const stream = createWriteStream.call(fakeFs, '/test.txt', { flags: 'a' });

    await new Promise<void>((resolve) => {
      stream.write('data', () => {
        stream.end(() => resolve());
      });
    });

    expect(fakeFs.promises.open).toHaveBeenCalledWith('/test.txt', 'a');
    expect(decoder.decode(mock.getBuffer())).toBe('data');
    expect(mock.closed).toBe(true);
  });

  it('should open with "w" flag by default', async () => {
    const { fakeFs } = setup();
    const stream = createWriteStream.call(fakeFs, '/test.txt');

    await new Promise<void>((resolve) => {
      stream.write('x', () => {
        stream.end(() => resolve());
      });
    });

    expect(fakeFs.promises.open).toHaveBeenCalledWith('/test.txt', 'w');
  });

  it('should close the handle on end', async () => {
    const { mock, fakeFs } = setup();
    const stream = createWriteStream.call(fakeFs, '/test.txt');

    await new Promise<void>((resolve) => {
      stream.write('test', () => {
        expect(mock.closed).toBe(false);
        stream.end(() => {
          expect(mock.closed).toBe(true);
          resolve();
        });
      });
    });
  });

  it('should close the handle on destroy', async () => {
    const { mock, fakeFs } = setup();
    const stream = createWriteStream.call(fakeFs, '/test.txt');

    await new Promise<void>((resolve) => {
      stream.write('test', () => {
        expect(mock.closed).toBe(false);
        stream.on('close', () => {
          expect(mock.closed).toBe(true);
          resolve();
        });
        stream.destroy();
      });
    });
  });

  it('should sync before close when flush option is true', async () => {
    const { mock, fakeFs } = setup({ flush: true });
    const stream = createWriteStream.call(fakeFs, '/test.txt', { flush: true });

    await new Promise<void>((resolve) => {
      stream.write('data', () => {
        expect(mock.synced).toBe(false);
        stream.end(() => {
          expect(mock.synced).toBe(true);
          expect(mock.closed).toBe(true);
          resolve();
        });
      });
    });
  });

  it('should not sync on close when flush option is false', async () => {
    const { mock, fakeFs } = setup();
    const stream = createWriteStream.call(fakeFs, '/test.txt');

    await new Promise<void>((resolve) => {
      stream.write('data', () => {
        stream.end(() => {
          expect(mock.synced).toBe(false);
          expect(mock.closed).toBe(true);
          resolve();
        });
      });
    });
  });

  it('should track position correctly across multiple writes', async () => {
    const { mock, fakeFs } = setup({ start: 2 });
    const stream = createWriteStream.call(fakeFs, '/test.txt', { start: 2 });

    await new Promise<void>((resolve) => {
      stream.write('AB', () => {
        stream.write('CD', () => {
          stream.end(() => resolve());
        });
      });
    });

    const result = mock.getBuffer();
    expect(result[2]).toBe(65); // 'A'
    expect(result[3]).toBe(66); // 'B'
    expect(result[4]).toBe(67); // 'C'
    expect(result[5]).toBe(68); // 'D'
  });

  it('should handle end without any writes gracefully', async () => {
    const { mock, fakeFs } = setup();
    const stream = createWriteStream.call(fakeFs, '/test.txt');

    await new Promise<void>((resolve) => {
      stream.end(() => resolve());
    });

    // Handle was never opened, so it shouldn't be closed
    expect(mock.closed).toBe(false);
  });

  it('should have a path property', () => {
    const { fakeFs } = setup();
    const stream = createWriteStream.call(fakeFs, '/my/file.txt');
    expect(stream.path).toBe('/my/file.txt');
  });

  it('should track bytesWritten', async () => {
    const { fakeFs } = setup();
    const stream = createWriteStream.call(fakeFs, '/test.txt');

    expect(stream.bytesWritten).toBe(0);

    await new Promise<void>((resolve) => {
      stream.write('hello', () => {
        expect(stream.bytesWritten).toBe(5);
        stream.write('!!', () => {
          expect(stream.bytesWritten).toBe(7);
          stream.end(() => resolve());
        });
      });
    });
  });

  it('should emit finish and close events on end', async () => {
    const { fakeFs } = setup();
    const stream = createWriteStream.call(fakeFs, '/test.txt');
    const finishFn = vi.fn();
    const closeFn = vi.fn();

    stream.on('finish', finishFn);
    stream.on('close', closeFn);

    await new Promise<void>((resolve) => {
      stream.end(() => resolve());
    });

    expect(finishFn).toHaveBeenCalledTimes(1);
    expect(closeFn).toHaveBeenCalledTimes(1);
  });
});
