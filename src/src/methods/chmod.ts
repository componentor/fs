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

/**
 * fchmodSync — chmod on an open file descriptor. The engine looks up the
 * inode directly from its fd table and mutates the mode bits in place,
 * matching what native Node does at the libuv layer.
 *
 * Payload layout: [fd: u32][mode: u32]
 */
export function fchmodSync(
  syncRequest: SyncRequestFn,
  fd: number,
  mode: number
): void {
  const payload = new Uint8Array(8);
  const dv = new DataView(payload.buffer);
  dv.setUint32(0, fd, true);
  dv.setUint32(4, mode, true);
  const buf = encodeRequest(OP.FCHMOD, '', 0, payload);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'fchmod', String(fd));
}

export async function fchmod(
  asyncRequest: AsyncRequestFn,
  fd: number,
  mode: number
): Promise<void> {
  const payload = new Uint8Array(8);
  const dv = new DataView(payload.buffer);
  dv.setUint32(0, fd, true);
  dv.setUint32(4, mode, true);
  const { status } = await asyncRequest(OP.FCHMOD, '', 0, payload);
  if (status !== 0) throw statusToError(status, 'fchmod', String(fd));
}
