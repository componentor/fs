import type { ReaddirOptions, Encoding, Dirent } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';
import { decodeDirents, decodeNames } from '../stats.js';

export function readdirSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  options?: ReaddirOptions | Encoding | null
): string[] | Dirent[] {
  const opts = typeof options === 'string' ? { encoding: options } : options;
  const flags = opts?.withFileTypes ? 1 : 0;
  const buf = encodeRequest(OP.READDIR, filePath, flags);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'readdir', filePath);
  if (!data) return [];
  return opts?.withFileTypes ? decodeDirents(data) : decodeNames(data);
}

export async function readdir(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: ReaddirOptions | Encoding | null
): Promise<string[] | Dirent[]> {
  const opts = typeof options === 'string' ? { encoding: options } : options;
  const flags = opts?.withFileTypes ? 1 : 0;
  const { status, data } = await asyncRequest(OP.READDIR, filePath, flags);
  if (status !== 0) throw statusToError(status, 'readdir', filePath);
  if (!data) return [];
  return opts?.withFileTypes ? decodeDirents(data) : decodeNames(data);
}
