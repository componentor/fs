import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';

export function chmodSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  mode: number
): void {
  const modeBuf = new Uint8Array(4);
  new DataView(modeBuf.buffer).setUint32(0, mode, true);
  const buf = encodeRequest(OP.CHMOD, filePath, 0, modeBuf);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'chmod', filePath);
}

export async function chmod(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  mode: number
): Promise<void> {
  const modeBuf = new Uint8Array(4);
  new DataView(modeBuf.buffer).setUint32(0, mode, true);
  const { status } = await asyncRequest(OP.CHMOD, filePath, 0, modeBuf);
  if (status !== 0) throw statusToError(status, 'chmod', filePath);
}
