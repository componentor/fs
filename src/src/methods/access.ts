import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';
import { constants } from '../constants.js';

export function accessSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  mode: number = constants.F_OK
): void {
  const buf = encodeRequest(OP.ACCESS, filePath, mode);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'access', filePath);
}

export async function access(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  mode: number = constants.F_OK
): Promise<void> {
  const { status } = await asyncRequest(OP.ACCESS, filePath, mode);
  if (status !== 0) throw statusToError(status, 'access', filePath);
}
