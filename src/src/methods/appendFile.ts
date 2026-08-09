import type { WriteOptions, Encoding } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';
import { openSync, closeSync, writeSyncFd, fdatasyncSync, open } from './open.js';
import { encodeString } from '../encoding.js';

const encoder = new TextEncoder();

/**
 * `appendFile` used to ignore its `options` argument outright — `mode`, `flag`, `encoding` and
 * `signal` all silently dropped, so `appendFileSync(p, 'é', 'latin1')` wrote UTF-8 and
 * `{ flag: 'w' }` appended instead of truncating.
 *
 * The single-op APPEND remains the fast path for the default case. Anything the APPEND opcode
 * cannot express — a creation mode, a non-'a' flag, or a flush (engine.append takes no flags) —
 * goes through open → write → close, where the flag and mode land on the open itself.
 */
function resolveOptions(options?: WriteOptions | Encoding) {
  const opts = typeof options === 'string' ? { encoding: options as Encoding } : options;
  const flag = opts?.flag;
  return {
    opts,
    flag,
    /** True when APPEND alone can express the request. */
    fastPath: (!flag || flag === 'a') && opts?.mode === undefined && opts?.flush !== true,
  };
}

/** Encode string data with the requested encoding; Buffers pass through untouched, as in Node. */
function encodeData(data: string | Uint8Array, encoding?: Encoding): Uint8Array {
  if (typeof data !== 'string') return data;
  return encoding ? encodeString(data, encoding) : encoder.encode(data);
}

export function appendFileSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  data: string | Uint8Array,
  options?: WriteOptions | Encoding
): void {
  const { opts, flag, fastPath } = resolveOptions(options);
  const encoded = encodeData(data, opts?.encoding);
  if (opts?.signal?.aborted) {
    throw new DOMException('The operation was aborted', 'AbortError');
  }

  if (fastPath) {
    const buf = encodeRequest(OP.APPEND, filePath, 0, encoded);
    const { status } = syncRequest(buf);
    if (status !== 0) throw statusToError(status, 'appendFile', filePath);
    return;
  }

  // O_APPEND makes the engine write at end-of-file regardless of position, so the fd path
  // appends for flag 'a' and truncates for 'w' — exactly as the flag says.
  const fd = openSync(syncRequest, filePath, flag ?? 'a', opts?.mode);
  try {
    writeSyncFd(syncRequest, fd, encoded, 0, encoded.byteLength, 0);
    if (opts?.flush === true) fdatasyncSync(syncRequest, fd);
  } finally {
    closeSync(syncRequest, fd);
  }
}

export async function appendFile(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  data: string | Uint8Array,
  options?: WriteOptions | Encoding
): Promise<void> {
  const { opts, flag, fastPath } = resolveOptions(options);
  const encoded = encodeData(data, opts?.encoding);
  const signal = opts?.signal;
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted', 'AbortError');
  }

  if (fastPath) {
    const { status } = await asyncRequest(OP.APPEND, filePath, 0, encoded);
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    if (status !== 0) throw statusToError(status, 'appendFile', filePath);
    return;
  }

  const handle = await open(asyncRequest, filePath, flag ?? 'a', opts?.mode);
  try {
    await handle.writeFile(encoded);
    if (opts?.flush === true) await handle.datasync();
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
  } finally {
    await handle.close();
  }
}
