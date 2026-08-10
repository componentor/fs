import type { Mode } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest, encodeRequestU32 } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';
import { parseFileMode, encodeMode } from './mode.js';
import { NOFOLLOW } from '../protocol/dispatch.js';

/** The flags word for a chmod/chown: `lchmod`/`lchown` set NOFOLLOW so the *link* is changed. */
const followFlag = (follow: boolean) => (follow ? 0 : NOFOLLOW);

/**
 * chmod's mode is required — passing no `def` makes `undefined` a type error rather than
 * some mode the caller never asked for. (It used to coerce to NaN → 0: chmod 000.)
 */
function requireMode(mode: Mode): number {
  return parseFileMode(mode, 'mode');
}

export function chmodSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  mode: Mode,
  follow = true
): void {
  // Zero-allocation encode: the mode goes straight into the request buffer.
  const buf = encodeRequestU32(OP.CHMOD, filePath, followFlag(follow), requireMode(mode));
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'chmod', filePath);
}

export async function chmod(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  mode: Mode,
  follow = true
): Promise<void> {
  // Async path posts to a relay worker, so it needs a real (and per-call fresh) Uint8Array.
  const { status } = await asyncRequest(OP.CHMOD, filePath, followFlag(follow), encodeMode(requireMode(mode)));
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
  mode: Mode
): void {
  const buf = encodeRequest(OP.FCHMOD, '', 0, encodeFdMode(fd, requireMode(mode)));
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'fchmod', String(fd));
}

export async function fchmod(
  asyncRequest: AsyncRequestFn,
  fd: number,
  mode: Mode
): Promise<void> {
  const { status } = await asyncRequest(OP.FCHMOD, '', 0, encodeFdMode(fd, requireMode(mode)));
  if (status !== 0) throw statusToError(status, 'fchmod', String(fd));
}

/** [fd: u32][mode: u32], written without a DataView — see encodeMode. */
function encodeFdMode(fd: number, mode: number): Uint8Array {
  const payload = new Uint8Array(8);
  payload[0] = fd; payload[1] = fd >>> 8; payload[2] = fd >>> 16; payload[3] = fd >>> 24;
  payload[4] = mode; payload[5] = mode >>> 8; payload[6] = mode >>> 16; payload[7] = mode >>> 24;
  return payload;
}
