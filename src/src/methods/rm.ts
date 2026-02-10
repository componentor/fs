import type { RmOptions } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';

export function rmSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  options?: RmOptions
): void {
  const flags = (options?.recursive ? 1 : 0) | (options?.force ? 2 : 0);
  const buf = encodeRequest(OP.UNLINK, filePath, flags);
  const { status } = syncRequest(buf);
  if (status === 3) {
    // EISDIR — it's a directory, use rmdir
    const rmdirBuf = encodeRequest(OP.RMDIR, filePath, flags);
    const rmdirResult = syncRequest(rmdirBuf);
    if (rmdirResult.status !== 0) {
      if (options?.force && rmdirResult.status === 1) return;
      throw statusToError(rmdirResult.status, 'rm', filePath);
    }
    return;
  }
  if (status !== 0) {
    if (options?.force && status === 1) return;
    throw statusToError(status, 'rm', filePath);
  }
}

export async function rm(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: RmOptions
): Promise<void> {
  const flags = (options?.recursive ? 1 : 0) | (options?.force ? 2 : 0);
  const { status } = await asyncRequest(OP.UNLINK, filePath, flags);
  if (status === 3) {
    const { status: s2 } = await asyncRequest(OP.RMDIR, filePath, flags);
    if (s2 !== 0) {
      if (options?.force && s2 === 1) return;
      throw statusToError(s2, 'rm', filePath);
    }
    return;
  }
  if (status !== 0) {
    if (options?.force && status === 1) return;
    throw statusToError(status, 'rm', filePath);
  }
}
