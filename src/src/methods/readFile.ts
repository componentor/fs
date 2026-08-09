import type { ReadOptions, Encoding } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';
import { parseFlags, openSync, closeSync, readSync, open, createFileHandle } from './open.js';
import { encodeFreadPayload } from '../protocol/payloads.js';
import { validateFdArg } from './fd-arg.js';
import { decodeBuffer } from '../encoding.js';

const decoder = new TextDecoder();

/** Everything from the cursor to EOF — the engine clamps to the remaining bytes. */
const TO_EOF = 0xffffffff;

/**
 * `fs.readFileSync(fd)` — reads from the descriptor's current position to EOF, advances it, and
 * leaves the descriptor open. `flag` is ignored: the file is already open. See [fd-arg.ts](./fd-arg.ts).
 */
export function readFileFdSync(
  syncRequest: SyncRequestFn,
  fd: number,
  options?: ReadOptions | Encoding | null
): string | Uint8Array {
  validateFdArg(fd);
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const signal = typeof options === 'string' ? undefined : options?.signal;
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');

  const buf = encodeRequest(OP.FREAD, '', 0, encodeFreadPayload(fd, TO_EOF, null));
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'read', String(fd));
  const result = data ?? new Uint8Array(0);
  return encoding ? decodeBuffer(result, encoding) : result;
}

/** `fs.readFile(fd, cb)` — the callback form. Same semantics as {@link readFileFdSync}. */
export async function readFileFd(
  asyncRequest: AsyncRequestFn,
  fd: number,
  options?: ReadOptions | Encoding | null
): Promise<string | Uint8Array> {
  validateFdArg(fd);
  const signal = typeof options === 'string' ? undefined : options?.signal;
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
  // Through the handle rather than a second copy of the wire shaping — the encoder/decoder
  // pairs are the one place this codebase has repeatedly grown divergent duplicates.
  const result = await createFileHandle(fd, asyncRequest).readFile(options);
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
  return result;
}

export function readFileSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  options?: ReadOptions | Encoding | null
): string | Uint8Array {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const flag = typeof options === 'string' ? undefined : options?.flag;
  const signal = typeof options === 'string' ? undefined : options?.signal;
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted', 'AbortError');
  }

  // Fast path: default flag or no flag specified
  if (!flag || flag === 'r') {
    const buf = encodeRequest(OP.READ, filePath);
    const { status, data } = syncRequest(buf);
    if (status !== 0) throw statusToError(status, 'read', filePath);
    const result = data ?? new Uint8Array(0);
    if (encoding) return decodeBuffer(result, encoding);
    return result;
  }

  // Non-default flag: use fd-based open → read → close
  const fd = openSync(syncRequest, filePath, flag);
  try {
    // Read in chunks until EOF
    const chunks: Uint8Array[] = [];
    let totalRead = 0;
    const chunkSize = 64 * 1024;
    while (true) {
      const chunk = new Uint8Array(chunkSize);
      const bytesRead = readSync(syncRequest, fd, chunk, 0, chunkSize, totalRead);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      totalRead += bytesRead;
      if (bytesRead < chunkSize) break;
    }
    let result: Uint8Array;
    if (chunks.length === 0) {
      result = new Uint8Array(0);
    } else if (chunks.length === 1) {
      result = chunks[0];
    } else {
      result = new Uint8Array(totalRead);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
    }
    if (encoding) return decodeBuffer(result, encoding);
    return result;
  } finally {
    closeSync(syncRequest, fd);
  }
}

export async function readFile(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: ReadOptions | Encoding | null
): Promise<string | Uint8Array> {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const flag = typeof options === 'string' ? undefined : options?.flag;
  const signal = typeof options === 'string' ? undefined : options?.signal;
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted', 'AbortError');
  }

  // Fast path: default flag or no flag specified
  if (!flag || flag === 'r') {
    const { status, data } = await asyncRequest(OP.READ, filePath);
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    if (status !== 0) throw statusToError(status, 'read', filePath);
    const result = data ?? new Uint8Array(0);
    if (encoding) return decodeBuffer(result, encoding);
    return result;
  }

  // Non-default flag: use FileHandle-based open → readFile → close
  const handle = await open(asyncRequest, filePath, flag);
  try {
    const result = await handle.readFile(encoding ? encoding : undefined);
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    return result;
  } finally {
    await handle.close();
  }
}
