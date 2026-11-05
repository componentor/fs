import { invalidArgType, invalidArgTypeMessage } from '../errors.js';
import { encodeString } from '../encoding.js';

/**
 * The data argument of write / writeFile / appendFile, taken the way node takes it.
 *
 * Node accepts a string or any `ArrayBufferView` — a `Buffer`, any TypedArray, or a `DataView` —
 * and writes the view's bytes; anything else (an `ArrayBuffer`, a number, a plain object, `null`)
 * is `ERR_INVALID_ARG_TYPE`. Everything below this layer handles a string or a `Uint8Array`, so a
 * view of another kind is handed on as the `Uint8Array` over its bytes.
 *
 * This used to be unchecked. An `ArrayBuffer` — what `file.arrayBuffer()` and `fetch` hand you —
 * became an empty file without a word, a `DataView` wrote zeros, a `Uint16Array` wrote its element
 * values truncated to bytes, and a number or `null` wrote nothing or failed with an internal
 * `RangeError` instead of the error node gives.
 *
 * Strings and Uint8Arrays (Buffers included) return unchanged, so the common case costs one
 * `typeof` and one `instanceof`.
 */
export function toWriteData(data: unknown, name: 'data' | 'buffer'): Uint8Array | string {
  if (typeof data === 'string' || data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw invalidArgType(name, 'string or an instance of Buffer, TypedArray, or DataView', data);
}

/**
 * The data argument of the promise-based writeFile / appendFile (fsPromises and FileHandle).
 *
 * These also take an Iterable or AsyncIterable of chunks — an array, a generator, a Set, a
 * readable stream — and write the chunks in order. Node converts each chunk as
 * `Buffer.from(chunk, encoding)` would: a string in the given encoding, any ArrayBufferView, an
 * ArrayBuffer, a String object, or an array(-like) of byte values; anything else is
 * `Buffer.from`'s own ERR_INVALID_ARG_TYPE. The chunks are gathered and written as one buffer.
 */
export async function toWriteDataAsync(
  data: unknown,
  options: { encoding?: string | null } | string | null | undefined,
): Promise<Uint8Array | string> {
  if (typeof data === 'string' || data instanceof Uint8Array || ArrayBuffer.isView(data)) return toWriteData(data, 'data');
  if (data === null || typeof data !== 'object' || !(Symbol.iterator in data || Symbol.asyncIterator in data)) {
    return toWriteData(data, 'data'); // throws node's "data" error
  }
  const encoding = (typeof options === 'string' ? options : options?.encoding) || 'utf8';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of data as AsyncIterable<unknown>) {
    const bytes = chunkBytes(chunk, encoding);
    chunks.push(bytes);
    total += bytes.byteLength;
  }
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

function chunkBytes(chunk: unknown, encoding: string): Uint8Array {
  if (typeof chunk === 'string') return encodeString(chunk, encoding);
  if (chunk instanceof Uint8Array) return chunk;
  if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  if (chunk instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && chunk instanceof SharedArrayBuffer)) {
    return new Uint8Array(chunk);
  }
  if (chunk instanceof String) return encodeString(chunk.valueOf(), encoding);
  if (chunk !== null && typeof chunk === 'object' && typeof (chunk as { length?: unknown }).length === 'number') {
    return Uint8Array.from(chunk as ArrayLike<number>); // byte values, wrapped like Buffer.from(array)
  }
  throw invalidArgTypeMessage(
    'The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object',
    chunk,
  );
}
