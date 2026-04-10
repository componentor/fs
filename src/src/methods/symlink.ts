import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function symlinkSync(
  syncRequest: SyncRequestFn,
  target: string,
  linkPath: string,
  type?: string | null
): void {
  const targetBytes = encoder.encode(target);
  const buf = encodeRequest(OP.SYMLINK, linkPath, 0, targetBytes);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'symlink', linkPath);
}

export function readlinkSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  options?: { encoding?: string | null } | string | null
): string | Uint8Array {
  const buf = encodeRequest(OP.READLINK, filePath);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'readlink', filePath);
  const encoding = typeof options === 'string' ? options : options?.encoding;
  if (encoding === 'buffer') return new Uint8Array(data!);
  return decoder.decode(data!);
}

export async function symlink(
  asyncRequest: AsyncRequestFn,
  target: string,
  linkPath: string,
  type?: string | null
): Promise<void> {
  const targetBytes = encoder.encode(target);
  const { status } = await asyncRequest(OP.SYMLINK, linkPath, 0, targetBytes);
  if (status !== 0) throw statusToError(status, 'symlink', linkPath);
}

export async function readlink(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: { encoding?: string | null } | string | null
): Promise<string | Uint8Array> {
  const { status, data } = await asyncRequest(OP.READLINK, filePath);
  if (status !== 0) throw statusToError(status, 'readlink', filePath);
  const encoding = typeof options === 'string' ? options : options?.encoding;
  if (encoding === 'buffer') return new Uint8Array(data!);
  return decoder.decode(data!);
}
