import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';
import { toEpochMs } from '../protocol/payloads.js';
import { NOFOLLOW } from '../protocol/dispatch.js';

export function utimesSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  atime: Date | number,
  mtime: Date | number,
  follow = true
): void {
  const timesBuf = new Uint8Array(16);
  const dv = new DataView(timesBuf.buffer);
  dv.setFloat64(0, toEpochMs(atime, 'atime'), true);
  dv.setFloat64(8, toEpochMs(mtime, 'mtime'), true);
  const buf = encodeRequest(OP.UTIMES, filePath, follow ? 0 : NOFOLLOW, timesBuf);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'utimes', filePath);
}

export async function utimes(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  atime: Date | number,
  mtime: Date | number,
  follow = true
): Promise<void> {
  const buf = new Uint8Array(16);
  const dv = new DataView(buf.buffer);
  dv.setFloat64(0, toEpochMs(atime, 'atime'), true);
  dv.setFloat64(8, toEpochMs(mtime, 'mtime'), true);
  const { status } = await asyncRequest(OP.UTIMES, filePath, follow ? 0 : NOFOLLOW, buf);
  if (status !== 0) throw statusToError(status, 'utimes', filePath);
}

/**
 * futimesSync — utimes on an open fd. Payload layout:
 *   [fd: u32][pad: u32][atime: f64][mtime: f64]
 * The 4-byte pad keeps the float64 fields 8-byte aligned so both server and
 * client decode with straight DataView calls.
 */
export function futimesSync(
  syncRequest: SyncRequestFn,
  fd: number,
  atime: Date | number,
  mtime: Date | number
): void {
  const payload = new Uint8Array(24);
  const dv = new DataView(payload.buffer);
  dv.setUint32(0, fd, true);
  dv.setFloat64(8, toEpochMs(atime, 'atime'), true);
  dv.setFloat64(16, toEpochMs(mtime, 'mtime'), true);
  const buf = encodeRequest(OP.FUTIMES, '', 0, payload);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'futimes', String(fd));
}

export async function futimes(
  asyncRequest: AsyncRequestFn,
  fd: number,
  atime: Date | number,
  mtime: Date | number
): Promise<void> {
  const payload = new Uint8Array(24);
  const dv = new DataView(payload.buffer);
  dv.setUint32(0, fd, true);
  dv.setFloat64(8, toEpochMs(atime, 'atime'), true);
  dv.setFloat64(16, toEpochMs(mtime, 'mtime'), true);
  const { status } = await asyncRequest(OP.FUTIMES, '', 0, payload);
  if (status !== 0) throw statusToError(status, 'futimes', String(fd));
}
