import type { WriteOptions, Encoding } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';
import { parseFlags, openSync, closeSync, writeSyncFd, fdatasyncSync, open } from './open.js';
import { encodeString } from '../encoding.js';

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

  // Fast path: default flag or no flag specified, and no mode to honour. A mode has to ride
  // along with the *creation* (see below), which the single-op WRITE path cannot express.
  if ((!flag || flag === 'w') && opts?.mode === undefined) {
    const flags = opts?.flush === true ? 1 : 0;
    const buf = encodeRequest(OP.WRITE, filePath, flags, encoded);
    const { status } = syncRequest(buf);
    if (status !== 0) throw statusToError(status, 'write', filePath);
    return;
  }

  // Non-default flag, or an explicit mode: fd-based open → write → close.
  //
  // The mode must be applied by the open, not chmod-ed on afterwards. Node's semantics, both
  // verified against node:fs: the umask is subtracted from it (mode 0o777 yields 0o755), and it
  // is ignored entirely when the file already exists. A trailing chmod got both wrong — it
  // applied the raw mode, and it re-permissioned files it had not created.
  const fd = openSync(syncRequest, filePath, flag ?? 'w', opts?.mode);
  try {
    writeSyncFd(syncRequest, fd, encoded, 0, encoded.byteLength, 0);
    if (opts?.flush === true) fdatasyncSync(syncRequest, fd);
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

  // Fast path: default flag or no flag specified, and no mode to honour — see writeFileSync.
  if ((!flag || flag === 'w') && opts?.mode === undefined) {
    const flags = opts?.flush === true ? 1 : 0;
    const { status } = await asyncRequest(OP.WRITE, filePath, flags, encoded);
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    if (status !== 0) throw statusToError(status, 'write', filePath);
    return;
  }

  // Non-default flag, or an explicit mode: the mode must ride along with the open that creates
  // the file, not a chmod afterwards — see writeFileSync.
  const handle = await open(asyncRequest, filePath, flag ?? 'w', opts?.mode);
  try {
    await handle.writeFile(encoded);
    if (opts?.flush === true) await handle.datasync();
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
  } finally {
    await handle.close();
  }
}
