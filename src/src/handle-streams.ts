/**
 * Read/write streams built over a `FileHandle`.
 *
 * `fs.createReadStream` and `filehandle.createReadStream` are the same machinery differing only
 * in where the handle comes from and who owns it, so they share one implementation here. The two
 * used to be one implementation and one *absent* implementation — `filehandle.createReadStream`,
 * `createWriteStream`, `readLines` and `readableWebStream` were all missing from `FileHandle`.
 *
 * Ownership is the subtle part, and it was read off a live `node:fs`: a stream created from a
 * handle **closes that handle** when it ends, so `handle.stat()` afterwards is `EBADF`. Passing
 * `autoClose: false` keeps it open.
 */

import type { FileHandle, ReadStreamOptions, WriteStreamOptions, Encoding } from './types.js';
import { NodeReadable, NodeWritable } from './node-streams.js';

/** How a stream gets its handle, and whether it may close it. */
export interface HandleSource {
  acquire(): Promise<FileHandle>;
  /** True when the stream is responsible for closing the handle once it finishes. */
  autoClose: boolean;
  /** Reported as `stream.path`; empty for a handle-backed stream, as in node. */
  path: string;
  /**
   * Whether an absent `start` means "the handle's current position" rather than byte zero.
   *
   * True for a handle-backed stream. Node reads such a stream from wherever the handle's cursor
   * happens to be and advances it: after `handle.read(buf, 0, 2)` on `'ABCDEFGHIJ'`,
   * `handle.createReadStream()` yields `'CDEFGHIJ'`. Reading from zero regardless is the same
   * mistake 3.3.26 fixed in `FileHandle.readFile()`.
   *
   * False for a path-backed stream, which opens its own descriptor at zero — where the two
   * agree, since a fresh descriptor's cursor *is* zero.
   */
  followCursor?: boolean;
}

/**
 * Byte budget for a stream's `end` option.
 *
 * `end` is documented as an offset, but node counts it as a length from `start ?? 0` — which is
 * only the same thing when the stream begins at `start`. Read off a live `node:fs`: a handle
 * whose cursor sits at 2 given `{ end: 3 }` yields **four** bytes (`'CDEF'`), not two; the same
 * handle given `{ start: 1, end: 3 }` yields three (`'BCD'`). For a path-backed stream, whose
 * cursor is always zero, this is identical to the absolute-offset reading it replaces.
 */
function byteBudget(start: number | undefined, end: number | undefined): number {
  return end === undefined ? Infinity : end - (start ?? 0) + 1;
}

export function readStreamFromHandle(
  source: HandleSource,
  options?: ReadStreamOptions | string,
): NodeReadable {
  const opts = typeof options === 'string' ? { encoding: options as Encoding } : options;
  const start = opts?.start;
  const highWaterMark = opts?.highWaterMark ?? 64 * 1024;

  // `undefined` means "wherever the handle is"; `null` tells `read` to use and advance the cursor.
  let position = start ?? (source.followCursor ? undefined : 0);
  let remaining = byteBudget(start, opts?.end);
  let handle: FileHandle | null = null;
  let finished = false;

  const cleanup = async () => {
    if (handle && source.autoClose) {
      try { await handle.close(); } catch { /* ignore close errors */ }
    }
    handle = null;
  };

  const readFn = async (): Promise<{ done: boolean; value?: Uint8Array }> => {
    if (finished) return { done: true };
    if (!handle) handle = await source.acquire();

    const readLen = Math.min(highWaterMark, remaining);
    if (readLen <= 0) {
      finished = true;
      await cleanup();
      return { done: true };
    }

    const buffer = new Uint8Array(readLen);
    const { bytesRead } = await handle.read(buffer, 0, readLen, position ?? null);
    if (bytesRead === 0) {
      finished = true;
      await cleanup();
      return { done: true };
    }

    if (position !== undefined) position += bytesRead;
    remaining -= bytesRead;
    if (remaining <= 0) {
      finished = true;
      await cleanup();
    }
    return { done: false, value: buffer.subarray(0, bytesRead) };
  };

  const stream = new NodeReadable(readFn, cleanup);
  stream.path = source.path;
  if (opts?.encoding) stream.setEncoding(opts.encoding);
  return stream;
}

export function writeStreamFromHandle(
  source: HandleSource,
  options?: WriteStreamOptions | string,
): NodeWritable {
  const opts = typeof options === 'string' ? { encoding: options as Encoding } : options;
  // As with reads: absent `start` on a handle-backed stream means the handle's own position.
  let position = opts?.start ?? (source.followCursor ? undefined : 0);
  let handle: FileHandle | null = null;

  const writeFn = async (chunk: Uint8Array): Promise<void> => {
    if (!handle) handle = await source.acquire();
    const { bytesWritten } = await handle.write(chunk, 0, chunk.byteLength, position ?? null);
    if (position !== undefined) position += bytesWritten;
  };

  const closeFn = async (): Promise<void> => {
    if (!handle) return;
    if (opts?.flush) await handle.sync();
    if (source.autoClose) await handle.close();
    handle = null;
  };

  return new NodeWritable(source.path, writeFn, closeFn, opts?.encoding ?? 'utf8');
}

/**
 * `filehandle.readLines()` — the file split into lines.
 *
 * Node builds this on `readline`, which drops the trailing empty string after a final newline
 * (`'a\nb\n'` yields `['a', 'b']`) and understands CRLF. Both verified against `node:fs`.
 */
export async function* linesFromStream(stream: NodeReadable): AsyncIterableIterator<string> {
  const decoder = new TextDecoder();
  let carry = '';

  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array | string>) {
    carry += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let nl = carry.indexOf('\n');
    while (nl !== -1) {
      const line = carry.slice(0, nl);
      yield line.endsWith('\r') ? line.slice(0, -1) : line;
      carry = carry.slice(nl + 1);
      nl = carry.indexOf('\n');
    }
  }

  carry += decoder.decode();
  // A trailing newline does not produce a final empty line, matching readline.
  if (carry.length > 0) yield carry.endsWith('\r') ? carry.slice(0, -1) : carry;
}

/**
 * `filehandle.readableWebStream()` — a WHATWG `ReadableStream` of `Uint8Array` chunks.
 *
 * Present in every browser this library targets, so it is used directly rather than shimmed.
 */
export function webStreamFromHandle(source: HandleSource, highWaterMark = 64 * 1024): ReadableStream<Uint8Array> {
  let handle: FileHandle | null = null;
  // Follows the handle's cursor for the same reason `createReadStream` does.
  let position: number | undefined = source.followCursor ? undefined : 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!handle) handle = await source.acquire();
      const buffer = new Uint8Array(highWaterMark);
      const { bytesRead } = await handle.read(buffer, 0, highWaterMark, position ?? null);
      if (bytesRead === 0) {
        controller.close();
        if (source.autoClose) { try { await handle.close(); } catch { /* ignore */ } }
        handle = null;
        return;
      }
      if (position !== undefined) position += bytesRead;
      controller.enqueue(buffer.subarray(0, bytesRead));
    },
    async cancel() {
      if (handle && source.autoClose) { try { await handle.close(); } catch { /* ignore */ } }
      handle = null;
    },
  });
}
