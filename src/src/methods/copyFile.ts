import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeTwoPathRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';

const encoder = new TextEncoder();

export function copyFileSync(
  syncRequest: SyncRequestFn,
  src: string,
  dest: string,
  mode?: number
): void {
  const buf = encodeTwoPathRequest(OP.COPY, src, dest, mode ?? 0);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'copyFile', src);
}

export async function copyFile(
  asyncRequest: AsyncRequestFn,
  src: string,
  dest: string,
  mode?: number
): Promise<void> {
  const path2Bytes = encoder.encode(dest);
  const payload = new Uint8Array(4 + path2Bytes.byteLength);
  new DataView(payload.buffer).setUint32(0, path2Bytes.byteLength, true);
  payload.set(path2Bytes, 4);
  const { status } = await asyncRequest(OP.COPY, src, mode ?? 0, payload);
  if (status !== 0) throw statusToError(status, 'copyFile', src);
}
