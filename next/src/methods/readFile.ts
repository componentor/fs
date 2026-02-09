import type { ReadOptions, Encoding } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';

const decoder = new TextDecoder();

export function readFileSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  options?: ReadOptions | Encoding | null
): string | Uint8Array {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const buf = encodeRequest(OP.READ, filePath);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'read', filePath);
  const result = data ?? new Uint8Array(0);
  if (encoding) return decoder.decode(result);
  return result;
}

export async function readFile(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: ReadOptions | Encoding | null
): Promise<string | Uint8Array> {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const { status, data } = await asyncRequest(OP.READ, filePath);
  if (status !== 0) throw statusToError(status, 'read', filePath);
  const result = data ?? new Uint8Array(0);
  if (encoding) return decoder.decode(result);
  return result;
}
