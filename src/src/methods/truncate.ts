import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';
import { encodeTruncatePayload } from '../protocol/payloads.js';

export function truncateSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  len: number = 0
): void {
  const buf = encodeRequest(OP.TRUNCATE, filePath, 0, encodeTruncatePayload(len));
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'truncate', filePath);
}

export async function truncate(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  len?: number
): Promise<void> {
  const { status } = await asyncRequest(OP.TRUNCATE, filePath, 0, encodeTruncatePayload(len ?? 0));
  if (status !== 0) throw statusToError(status, 'truncate', filePath);
}
