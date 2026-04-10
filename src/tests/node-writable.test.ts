/**
 * NodeWritable Tests
 *
 * Tests the Node.js-compatible writable stream returned by createWriteStream,
 * verifying .write(), .end(), event emission, destroy, bytesWritten tracking,
 * and path property.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NodeWritable } from '../src/node-streams.js';

const encoder = new TextEncoder();

function createTestStream(opts?: { writeFail?: boolean; closeFail?: boolean }) {
  const chunks: Uint8Array[] = [];
  const closeFn = vi.fn(async () => {
    if (opts?.closeFail) throw new Error('close failed');
  });
  const writeFn = vi.fn(async (chunk: Uint8Array) => {
    if (opts?.writeFail) throw new Error('write failed');
    chunks.push(chunk.slice());
  });

  const stream = new NodeWritable('/test/file.txt', writeFn, closeFn);
  return { stream, chunks, writeFn, closeFn };
}

describe('NodeWritable', () => {
  it('write() accepts Uint8Array', async () => {
    const { stream, chunks } = createTestStream();
    const data = encoder.encode('hello');

    await new Promise<void>((resolve) => {
      stream.write(data, () => resolve());
    });

    expect(chunks.length).toBe(1);
    expect(new TextDecoder().decode(chunks[0])).toBe('hello');
  });

  it('write() accepts string', async () => {
    const { stream, chunks } = createTestStream();

    await new Promise<void>((resolve) => {
      stream.write('hello string', () => resolve());
    });

    expect(chunks.length).toBe(1);
    expect(new TextDecoder().decode(chunks[0])).toBe('hello string');
  });

  it('write() callback is called on success', async () => {
    const { stream } = createTestStream();
    const cb = vi.fn();

    await new Promise<void>((resolve) => {
      stream.write('data', () => {
        cb();
        resolve();
      });
    });

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('write() callback receives error on failure', async () => {
    const { stream } = createTestStream({ writeFail: true });

    const err = await new Promise<unknown>((resolve) => {
      stream.write('data', (e: unknown) => resolve(e));
    });

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('write failed');
  });

  it('end() emits finish and close events', async () => {
    const { stream } = createTestStream();
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

  it('end(chunk) writes final chunk before finishing', async () => {
    const { stream, chunks } = createTestStream();

    // Write some data first
    await new Promise<void>((resolve) => {
      stream.write('first ', () => resolve());
    });

    // End with a final chunk
    await new Promise<void>((resolve) => {
      stream.on('finish', () => resolve());
      stream.end('last');
    });

    expect(chunks.length).toBe(2);
    expect(new TextDecoder().decode(chunks[0])).toBe('first ');
    expect(new TextDecoder().decode(chunks[1])).toBe('last');
  });

  it('on("error") fires on write error', async () => {
    const { stream } = createTestStream({ writeFail: true });
    const errorFn = vi.fn();
    stream.on('error', errorFn);

    await new Promise<void>((resolve) => {
      stream.write('data', () => {
        // Wait a tick for the error event to fire
        resolve();
      });
    });

    expect(errorFn).toHaveBeenCalledTimes(1);
    expect(errorFn.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((errorFn.mock.calls[0][0] as Error).message).toBe('write failed');
  });

  it('destroy() stops writing and emits close', async () => {
    const { stream } = createTestStream();
    const closeFn = vi.fn();
    stream.on('close', closeFn);

    stream.destroy();

    // Give the async close a tick to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(closeFn).toHaveBeenCalledTimes(1);
    expect(stream.writable).toBe(false);
  });

  it('destroy(err) emits error then close', async () => {
    const { stream } = createTestStream();
    const errorFn = vi.fn();
    const closeFn = vi.fn();
    stream.on('error', errorFn);
    stream.on('close', closeFn);

    stream.destroy(new Error('forced'));

    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(errorFn).toHaveBeenCalledTimes(1);
    expect((errorFn.mock.calls[0][0] as Error).message).toBe('forced');
    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  it('path property is set', () => {
    const { stream } = createTestStream();
    expect(stream.path).toBe('/test/file.txt');
  });

  it('bytesWritten tracks total bytes', async () => {
    const { stream } = createTestStream();

    expect(stream.bytesWritten).toBe(0);

    await new Promise<void>((resolve) => {
      stream.write('hello', () => resolve()); // 5 bytes
    });
    expect(stream.bytesWritten).toBe(5);

    await new Promise<void>((resolve) => {
      stream.write(new Uint8Array(10), () => resolve());
    });
    expect(stream.bytesWritten).toBe(15);
  });

  it('writable is true initially and false after end', async () => {
    const { stream } = createTestStream();

    expect(stream.writable).toBe(true);

    await new Promise<void>((resolve) => {
      stream.end(() => resolve());
    });

    expect(stream.writable).toBe(false);
  });

  it('write after end returns false and calls callback with error', async () => {
    const { stream } = createTestStream();

    await new Promise<void>((resolve) => {
      stream.end(() => resolve());
    });

    const result = stream.write('late', (err: unknown) => {
      expect(err).toBeInstanceOf(Error);
    });

    expect(result).toBe(false);
  });

  it('emits drain after each successful write', async () => {
    const { stream } = createTestStream();
    const drainFn = vi.fn();
    stream.on('drain', drainFn);

    await new Promise<void>((resolve) => {
      stream.write('a', () => resolve());
    });

    expect(drainFn).toHaveBeenCalledTimes(1);
  });

  it('once() listener fires only once', async () => {
    const { stream } = createTestStream();
    const drainFn = vi.fn();
    stream.once('drain', drainFn);

    await new Promise<void>((resolve) => {
      stream.write('a', () => resolve());
    });
    await new Promise<void>((resolve) => {
      stream.write('b', () => resolve());
    });

    expect(drainFn).toHaveBeenCalledTimes(1);
  });

  it('off() / removeListener() removes listener', async () => {
    const { stream } = createTestStream();
    const drainFn = vi.fn();
    stream.on('drain', drainFn);
    stream.off('drain', drainFn);

    await new Promise<void>((resolve) => {
      stream.write('a', () => resolve());
    });

    expect(drainFn).toHaveBeenCalledTimes(0);
  });

  it('end() callback is called', async () => {
    const { stream } = createTestStream();
    const endCb = vi.fn();

    await new Promise<void>((resolve) => {
      stream.end(() => {
        endCb();
        resolve();
      });
    });

    expect(endCb).toHaveBeenCalledTimes(1);
  });

  it('end() with just a callback (no chunk)', async () => {
    const { stream, chunks } = createTestStream();

    await new Promise<void>((resolve) => {
      stream.end(() => resolve());
    });

    expect(chunks.length).toBe(0);
  });
});
