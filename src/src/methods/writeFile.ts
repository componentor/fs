import type { WriteOptions, Encoding } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';

const encoder = new TextEncoder();

export function writeFileSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  data: string | Uint8Array,
  options?: WriteOptions | Encoding
): void {
  const opts = typeof options === 'string' ? { encoding: options } : options;
  const encoded = typeof data === 'string' ? encoder.encode(data) : data;
  const flags = opts?.flush === true ? 1 : 0;
  const buf = encodeRequest(OP.WRITE, filePath, flags, encoded);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'write', filePath);
}

export async function writeFile(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  data: string | Uint8Array,
  options?: WriteOptions | Encoding
): Promise<void> {
  const opts = typeof options === 'string' ? { encoding: options } : options;
  const flags = opts?.flush === true ? 1 : 0;
  const encoded = typeof data === 'string' ? encoder.encode(data) : data;
  const { status } = await asyncRequest(OP.WRITE, filePath, flags, encoded);
  if (status !== 0) throw statusToError(status, 'write', filePath);
}
