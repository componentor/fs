import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';

export function utimesSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  atime: Date | number,
  mtime: Date | number
): void {
  const timesBuf = new Uint8Array(16);
  const dv = new DataView(timesBuf.buffer);
  dv.setFloat64(0, typeof atime === 'number' ? atime : atime.getTime(), true);
  dv.setFloat64(8, typeof mtime === 'number' ? mtime : mtime.getTime(), true);
  const buf = encodeRequest(OP.UTIMES, filePath, 0, timesBuf);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'utimes', filePath);
}

export async function utimes(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  atime: Date | number,
  mtime: Date | number
): Promise<void> {
  const buf = new Uint8Array(16);
  const dv = new DataView(buf.buffer);
  dv.setFloat64(0, typeof atime === 'number' ? atime : atime.getTime(), true);
  dv.setFloat64(8, typeof mtime === 'number' ? mtime : mtime.getTime(), true);
  const { status } = await asyncRequest(OP.UTIMES, filePath, 0, buf);
  if (status !== 0) throw statusToError(status, 'utimes', filePath);
}
