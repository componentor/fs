import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';
import { NOFOLLOW } from '../protocol/dispatch.js';

export function chownSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  uid: number,
  gid: number,
  follow = true
): void {
  const ownerBuf = new Uint8Array(8);
  const dv = new DataView(ownerBuf.buffer);
  dv.setUint32(0, uid, true);
  dv.setUint32(4, gid, true);
  const buf = encodeRequest(OP.CHOWN, filePath, follow ? 0 : NOFOLLOW, ownerBuf);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'chown', filePath);
}

export async function chown(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  uid: number,
  gid: number,
  follow = true
): Promise<void> {
  const buf = new Uint8Array(8);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, uid, true);
  dv.setUint32(4, gid, true);
  const { status } = await asyncRequest(OP.CHOWN, filePath, follow ? 0 : NOFOLLOW, buf);
  if (status !== 0) throw statusToError(status, 'chown', filePath);
}

/**
 * fchownSync — chown on an open fd. Payload: [fd: u32][uid: u32][gid: u32].
 * The engine looks up the inode from the fd table and updates uid/gid directly.
 */
export function fchownSync(
  syncRequest: SyncRequestFn,
  fd: number,
  uid: number,
  gid: number
): void {
  const payload = new Uint8Array(12);
  const dv = new DataView(payload.buffer);
  dv.setUint32(0, fd, true);
  dv.setUint32(4, uid, true);
  dv.setUint32(8, gid, true);
  const buf = encodeRequest(OP.FCHOWN, '', 0, payload);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'fchown', String(fd));
}

export async function fchown(
  asyncRequest: AsyncRequestFn,
  fd: number,
  uid: number,
  gid: number
): Promise<void> {
  const payload = new Uint8Array(12);
  const dv = new DataView(payload.buffer);
  dv.setUint32(0, fd, true);
  dv.setUint32(4, uid, true);
  dv.setUint32(8, gid, true);
  const { status } = await asyncRequest(OP.FCHOWN, '', 0, payload);
  if (status !== 0) throw statusToError(status, 'fchown', String(fd));
}
