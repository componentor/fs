import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';

const decoder = new TextDecoder();

export function realpathSync(
  syncRequest: SyncRequestFn,
  filePath: string
): string {
  const buf = encodeRequest(OP.REALPATH, filePath);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'realpath', filePath);
  return decoder.decode(data!);
}

export async function realpath(
  asyncRequest: AsyncRequestFn,
  filePath: string
): Promise<string> {
  const { status, data } = await asyncRequest(OP.REALPATH, filePath);
  if (status !== 0) throw statusToError(status, 'realpath', filePath);
  return decoder.decode(data!);
}
