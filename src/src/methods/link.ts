import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeTwoPathRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';

const encoder = new TextEncoder();

export function linkSync(
  syncRequest: SyncRequestFn,
  existingPath: string,
  newPath: string
): void {
  const buf = encodeTwoPathRequest(OP.LINK, existingPath, newPath);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'link', existingPath);
}

export async function link(
  asyncRequest: AsyncRequestFn,
  existingPath: string,
  newPath: string
): Promise<void> {
  const path2Bytes = encoder.encode(newPath);
  const payload = new Uint8Array(4 + path2Bytes.byteLength);
  new DataView(payload.buffer).setUint32(0, path2Bytes.byteLength, true);
  payload.set(path2Bytes, 4);
  const { status } = await asyncRequest(OP.LINK, existingPath, 0, payload);
  if (status !== 0) throw statusToError(status, 'link', existingPath);
}
