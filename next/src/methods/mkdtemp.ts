import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';

const decoder = new TextDecoder();

export function mkdtempSync(
  syncRequest: SyncRequestFn,
  prefix: string
): string {
  const buf = encodeRequest(OP.MKDTEMP, prefix);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'mkdtemp', prefix);
  return decoder.decode(data!);
}

export async function mkdtemp(
  asyncRequest: AsyncRequestFn,
  prefix: string
): Promise<string> {
  const { status, data } = await asyncRequest(OP.MKDTEMP, prefix);
  if (status !== 0) throw statusToError(status, 'mkdtemp', prefix);
  return decoder.decode(data!);
}
