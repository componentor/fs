import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeTwoPathRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';

const encoder = new TextEncoder();

export function renameSync(
  syncRequest: SyncRequestFn,
  oldPath: string,
  newPath: string
): void {
  const buf = encodeTwoPathRequest(OP.RENAME, oldPath, newPath);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'rename', oldPath);
}

export async function rename(
  asyncRequest: AsyncRequestFn,
  oldPath: string,
  newPath: string
): Promise<void> {
  const path2Bytes = encoder.encode(newPath);
  const payload = new Uint8Array(4 + path2Bytes.byteLength);
  new DataView(payload.buffer).setUint32(0, path2Bytes.byteLength, true);
  payload.set(path2Bytes, 4);
  const { status } = await asyncRequest(OP.RENAME, oldPath, 0, payload);
  if (status !== 0) throw statusToError(status, 'rename', oldPath);
}
