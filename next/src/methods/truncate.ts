import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';

export function truncateSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  len: number = 0
): void {
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, len, true);
  const buf = encodeRequest(OP.TRUNCATE, filePath, 0, lenBuf);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'truncate', filePath);
}

export async function truncate(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  len?: number
): Promise<void> {
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, len ?? 0, true);
  const { status } = await asyncRequest(OP.TRUNCATE, filePath, 0, lenBuf);
  if (status !== 0) throw statusToError(status, 'truncate', filePath);
}
