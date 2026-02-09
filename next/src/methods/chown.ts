import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';

export function chownSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  uid: number,
  gid: number
): void {
  const ownerBuf = new Uint8Array(8);
  const dv = new DataView(ownerBuf.buffer);
  dv.setUint32(0, uid, true);
  dv.setUint32(4, gid, true);
  const buf = encodeRequest(OP.CHOWN, filePath, 0, ownerBuf);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'chown', filePath);
}

export async function chown(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  uid: number,
  gid: number
): Promise<void> {
  const buf = new Uint8Array(8);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, uid, true);
  dv.setUint32(4, gid, true);
  const { status } = await asyncRequest(OP.CHOWN, filePath, 0, buf);
  if (status !== 0) throw statusToError(status, 'chown', filePath);
}
