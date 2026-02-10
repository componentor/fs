import type { MkdirOptions } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';

const decoder = new TextDecoder();

export function mkdirSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  options?: MkdirOptions | number
): string | undefined {
  const opts = typeof options === 'number' ? { mode: options } : options;
  const flags = opts?.recursive ? 1 : 0;
  const buf = encodeRequest(OP.MKDIR, filePath, flags);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'mkdir', filePath);
  return data ? decoder.decode(data) : undefined;
}

export async function mkdir(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: MkdirOptions | number
): Promise<string | undefined> {
  const opts = typeof options === 'number' ? { mode: options } : options;
  const flags = opts?.recursive ? 1 : 0;
  const { status, data } = await asyncRequest(OP.MKDIR, filePath, flags);
  if (status !== 0) throw statusToError(status, 'mkdir', filePath);
  return data ? decoder.decode(data) : undefined;
}
