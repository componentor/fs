import type { RmdirOptions } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';

export function rmdirSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  options?: RmdirOptions
): void {
  const flags = options?.recursive ? 1 : 0;
  const buf = encodeRequest(OP.RMDIR, filePath, flags);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'rmdir', filePath);
}

export async function rmdir(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: RmdirOptions
): Promise<void> {
  const flags = options?.recursive ? 1 : 0;
  const { status } = await asyncRequest(OP.RMDIR, filePath, flags);
  if (status !== 0) throw statusToError(status, 'rmdir', filePath);
}
