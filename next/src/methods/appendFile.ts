import type { WriteOptions, Encoding } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';

const encoder = new TextEncoder();

export function appendFileSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  data: string | Uint8Array,
  options?: WriteOptions | Encoding
): void {
  const encoded = typeof data === 'string' ? encoder.encode(data) : data;
  const buf = encodeRequest(OP.APPEND, filePath, 0, encoded);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'appendFile', filePath);
}

export async function appendFile(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  data: string | Uint8Array,
  options?: WriteOptions | Encoding
): Promise<void> {
  const encoded = typeof data === 'string' ? encoder.encode(data) : data;
  const { status } = await asyncRequest(OP.APPEND, filePath, 0, encoded);
  if (status !== 0) throw statusToError(status, 'appendFile', filePath);
}
