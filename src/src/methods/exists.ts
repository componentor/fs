import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';

export function existsSync(
  syncRequest: SyncRequestFn,
  filePath: string
): boolean {
  const buf = encodeRequest(OP.EXISTS, filePath);
  const { data } = syncRequest(buf);
  return data ? data[0] === 1 : false;
}

export async function exists(
  asyncRequest: AsyncRequestFn,
  filePath: string
): Promise<boolean> {
  const { data } = await asyncRequest(OP.EXISTS, filePath);
  return data ? data[0] === 1 : false;
}
