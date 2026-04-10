import type { WriteOptions, Encoding } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';
import { parseFlags, openSync, closeSync, writeSyncFd, open } from './open.js';
import { encodeString } from '../encoding.js';
import { chmodSync, chmod as chmodAsync } from './chmod.js';

const encoder = new TextEncoder();

export function writeFileSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  data: string | Uint8Array,
  options?: WriteOptions | Encoding
): void {
  const opts = typeof options === 'string' ? { encoding: options } : options;
  const encoded = typeof data === 'string' ? (opts?.encoding ? encodeString(data, opts.encoding) : encoder.encode(data)) : data;
  const flag = opts?.flag;
  const signal = opts?.signal;
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted', 'AbortError');
  }

  // Fast path: default flag or no flag specified
  if (!flag || flag === 'w') {
    const flags = opts?.flush === true ? 1 : 0;
    const buf = encodeRequest(OP.WRITE, filePath, flags, encoded);
    const { status } = syncRequest(buf);
    if (status !== 0) throw statusToError(status, 'write', filePath);
    if (opts?.mode !== undefined) {
      chmodSync(syncRequest, filePath, opts.mode);
    }
    return;
  }

  // Non-default flag: use fd-based open → write → close
  const fd = openSync(syncRequest, filePath, flag, opts?.mode);
  try {
    writeSyncFd(syncRequest, fd, encoded, 0, encoded.byteLength, 0);
  } finally {
    closeSync(syncRequest, fd);
  }
}

export async function writeFile(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  data: string | Uint8Array,
  options?: WriteOptions | Encoding
): Promise<void> {
  const opts = typeof options === 'string' ? { encoding: options } : options;
  const encoded = typeof data === 'string' ? (opts?.encoding ? encodeString(data, opts.encoding) : encoder.encode(data)) : data;
  const flag = opts?.flag;
  const signal = opts?.signal;
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted', 'AbortError');
  }

  // Fast path: default flag or no flag specified
  if (!flag || flag === 'w') {
    const flags = opts?.flush === true ? 1 : 0;
    const { status } = await asyncRequest(OP.WRITE, filePath, flags, encoded);
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    if (status !== 0) throw statusToError(status, 'write', filePath);
    if (opts?.mode !== undefined) {
      await chmodAsync(asyncRequest, filePath, opts.mode);
    }
    return;
  }

  // Non-default flag: use FileHandle-based open → writeFile → close
  const handle = await open(asyncRequest, filePath, flag, opts?.mode);
  try {
    await handle.writeFile(encoded);
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
  } finally {
    await handle.close();
  }
}
