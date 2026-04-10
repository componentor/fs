/**
 * NodeReadable unit tests
 *
 * Tests the minimal Node.js-compatible Readable stream implementation
 * in isolation (without VFSFileSystem).
 */

import { describe, it, expect, vi } from 'vitest';
import { NodeReadable } from '../src/node-streams.js';

/** Helper: create a NodeReadable from an array of chunks. */
function fromChunks(chunks: Uint8Array[]): NodeReadable {
  let i = 0;
  return new NodeReadable(async () => {
    if (i >= chunks.length) return { done: true };
    return { done: false, value: chunks[i++] };
  });
}

/** Helper: create a NodeReadable that errors on the Nth read (0-indexed). */
function failOnRead(failAt: number, err: Error): NodeReadable {
  let i = 0;
  return new NodeReadable(async () => {
    if (i === failAt) throw err;
    i++;
    return { done: false, value: new Uint8Array([i]) };
  });
}

/** Collect all data chunks from a readable. */
function collectChunks(stream: NodeReadable): Promise<Uint8Array[]> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    stream.on('data', (chunk: unknown) => chunks.push(chunk as Uint8Array));
    stream.on('end', () => resolve(chunks));
    stream.on('error', reject);
  });
}

describe('NodeReadable', () => {
  // ---- data / end events ----

  it('on("data") receives all chunks', async () => {
    const stream = fromChunks([
      new Uint8Array([1, 2]),
      new Uint8Array([3, 4]),
      new Uint8Array([5]),
    ]);

    const chunks = await collectChunks(stream);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual(new Uint8Array([1, 2]));
    expect(chunks[1]).toEqual(new Uint8Array([3, 4]));
    expect(chunks[2]).toEqual(new Uint8Array([5]));
  });

  it('on("end") fires when all data has been read', async () => {
    const stream = fromChunks([new Uint8Array([1])]);
    const endFn = vi.fn();

    stream.on('end', endFn);

    // Attach data listener to start flowing.
    await new Promise<void>((resolve) => {
      stream.on('data', () => {});
      stream.on('end', resolve);
    });

    expect(endFn).toHaveBeenCalledTimes(1);
  });

  it('on("end") fires for empty stream', async () => {
    const stream = fromChunks([]);
    const endFn = vi.fn();

    stream.on('end', endFn);

    await new Promise<void>((resolve) => {
      stream.on('data', () => {});
      stream.on('end', resolve);
    });

    expect(endFn).toHaveBeenCalledTimes(1);
  });

  // ---- error event ----

  it('on("error") fires on read failure', async () => {
    const stream = failOnRead(0, new Error('boom'));

    const err = await new Promise<Error>((resolve) => {
      stream.on('error', (e: unknown) => resolve(e as Error));
      stream.on('data', () => {}); // start flowing
    });

    expect(err.message).toBe('boom');
  });

  it('on("error") fires mid-stream on read failure', async () => {
    const stream = failOnRead(2, new Error('late boom'));

    const chunks: Uint8Array[] = [];
    const err = await new Promise<Error>((resolve) => {
      stream.on('data', (chunk: unknown) => chunks.push(chunk as Uint8Array));
      stream.on('error', (e: unknown) => resolve(e as Error));
    });

    expect(err.message).toBe('late boom');
    expect(chunks.length).toBe(2); // got 2 chunks before the error
  });

  // ---- pipe ----

  it('pipe() writes chunks to a Node-style writable', async () => {
    const stream = fromChunks([
      new Uint8Array([10, 20]),
      new Uint8Array([30]),
    ]);

    const written: Uint8Array[] = [];
    const dest = {
      write: vi.fn((chunk: Uint8Array) => written.push(chunk)),
      end: vi.fn(),
    };

    stream.pipe(dest);

    await new Promise<void>((resolve) => stream.on('end', resolve));

    expect(written).toHaveLength(2);
    expect(written[0]).toEqual(new Uint8Array([10, 20]));
    expect(written[1]).toEqual(new Uint8Array([30]));
    expect(dest.end).toHaveBeenCalledTimes(1);
  });

  it('pipe() writes chunks to a Web WritableStream', async () => {
    const stream = fromChunks([
      new Uint8Array([1, 2, 3]),
    ]);

    const written: Uint8Array[] = [];
    const webWritable = new WritableStream<Uint8Array>({
      write(chunk) { written.push(chunk); },
    });

    stream.pipe(webWritable);

    await new Promise<void>((resolve) => stream.on('end', resolve));
    // Small delay for the writer.close() promise to settle.
    await new Promise(r => setTimeout(r, 10));

    expect(written).toHaveLength(1);
    expect(written[0]).toEqual(new Uint8Array([1, 2, 3]));
  });

  // ---- pause / resume ----

  it('pause() stops emitting data, resume() continues', async () => {
    let i = 0;
    const stream = new NodeReadable(async () => {
      if (i >= 5) return { done: true };
      return { done: false, value: new Uint8Array([i++]) };
    });

    const chunks: Uint8Array[] = [];
    let pausedAfterFirst = false;

    await new Promise<void>((resolve) => {
      stream.on('data', (chunk: unknown) => {
        chunks.push(chunk as Uint8Array);
        if (chunks.length === 1 && !pausedAfterFirst) {
          pausedAfterFirst = true;
          stream.pause();
          // After a short delay, verify no more chunks arrived, then resume.
          setTimeout(() => {
            expect(chunks).toHaveLength(1);
            stream.resume();
          }, 20);
        }
      });
      stream.on('end', resolve);
    });

    expect(chunks).toHaveLength(5);
  });

  // ---- destroy ----

  it('destroy() stops reading and emits close', async () => {
    let reads = 0;
    const stream = new NodeReadable(async () => {
      reads++;
      return { done: false, value: new Uint8Array([reads]) };
    });

    const closeFn = vi.fn();
    stream.on('close', closeFn);

    await new Promise<void>((resolve) => {
      stream.on('data', () => {
        stream.destroy();
        // Give it a tick.
        setTimeout(resolve, 10);
      });
    });

    expect(closeFn).toHaveBeenCalledTimes(1);
    expect(stream.readable).toBe(false);
  });

  it('destroy(err) emits error then close', async () => {
    const stream = fromChunks([new Uint8Array([1])]);
    const errorFn = vi.fn();
    const closeFn = vi.fn();

    stream.on('error', errorFn);
    stream.on('close', closeFn);

    stream.destroy(new Error('forced'));

    expect(errorFn).toHaveBeenCalledTimes(1);
    expect((errorFn.mock.calls[0][0] as Error).message).toBe('forced');
    expect(closeFn).toHaveBeenCalledTimes(1);
    expect(stream.readable).toBe(false);
  });

  // ---- path and bytesRead properties ----

  it('path property is settable', () => {
    const stream = fromChunks([]);
    stream.path = '/foo/bar.txt';
    expect(stream.path).toBe('/foo/bar.txt');
  });

  it('bytesRead tracks total bytes', async () => {
    const stream = fromChunks([
      new Uint8Array(100),
      new Uint8Array(50),
      new Uint8Array(25),
    ]);

    await collectChunks(stream);

    expect(stream.bytesRead).toBe(175);
  });

  // ---- once / off / removeListener ----

  it('once() fires listener only once', async () => {
    const stream = fromChunks([
      new Uint8Array([1]),
      new Uint8Array([2]),
    ]);

    const onceFn = vi.fn();
    stream.once('data', onceFn);

    // We still need a regular data listener to keep flowing.
    await new Promise<void>((resolve) => {
      stream.on('data', () => {});
      stream.on('end', resolve);
    });

    expect(onceFn).toHaveBeenCalledTimes(1);
  });

  it('off() / removeListener() removes a listener', () => {
    const stream = fromChunks([]);
    const fn = vi.fn();
    stream.on('data', fn);
    stream.off('data', fn);

    // Emit manually to verify removal.
    stream.emit('data', new Uint8Array([1]));
    expect(fn).not.toHaveBeenCalled();
  });

  // ---- readable property ----

  it('readable is true initially and false after end', async () => {
    const stream = fromChunks([new Uint8Array([1])]);
    expect(stream.readable).toBe(true);

    await collectChunks(stream);

    expect(stream.readable).toBe(false);
  });

  // ---- read() method ----

  it('read() returns null when no data buffered', () => {
    const stream = fromChunks([]);
    expect(stream.read()).toBeNull();
  });
});
