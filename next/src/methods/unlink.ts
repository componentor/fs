import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';

export function unlinkSync(
  syncRequest: SyncRequestFn,
  filePath: string
): void {
  const buf = encodeRequest(OP.UNLINK, filePath);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'unlink', filePath);
}

export async function unlink(
  asyncRequest: AsyncRequestFn,
  filePath: string
): Promise<void> {
  const { status } = await asyncRequest(OP.UNLINK, filePath);
  if (status !== 0) throw statusToError(status, 'unlink', filePath);
}
