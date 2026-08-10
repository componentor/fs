import { invalidArgType } from '../errors.js';

/**
 * The single set of payload encoders, paired with the decoders in [dispatch.ts](./dispatch.ts).
 *
 * These layouts used to be written in two places — the sync method layer encoded them inline,
 * and `async-relay.worker.ts` had its own `encodeFdRequest` — and the two disagreed. `FTRUNCATE`
 * is the case that bit: the sync side wrote `[fd: u32][len: f64]` (12 bytes) while the async side
 * wrote `[fd: u32][len: u32]` (8), so `await fileHandle.truncate(n)` was rejected as EINVAL by the
 * relay's length guard. An encoder and a decoder can only drift when there is more than one of
 * either; there is now exactly one of each, and `payloads.test.ts` round-trips every layout
 * through `dispatchOp` to keep them paired.
 *
 * All fields are little-endian. `f64` is used wherever a value can exceed the uint32 ceiling
 * (file offsets and lengths) or carry sub-integer precision (timestamps).
 */

/** `[mode: u32]` — chmod. */
export function encodeModePayload(mode: number): Uint8Array {
  const buf = new Uint8Array(4);
  writeU32(buf, 0, mode);
  return buf;
}

/** `[len: f64]` — truncate. Float64 so files past the 4 GiB uint32 ceiling can be truncated. */
export function encodeTruncatePayload(len: number): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setFloat64(0, len, true);
  return buf;
}

/** `[uid: u32][gid: u32]` — chown. */
export function encodeChownPayload(uid: number, gid: number): Uint8Array {
  const buf = new Uint8Array(8);
  writeU32(buf, 0, uid);
  writeU32(buf, 4, gid);
  return buf;
}

/** `[atime: f64][mtime: f64]` — utimes, in epoch milliseconds. */
export function encodeTimesPayload(atime: number, mtime: number): Uint8Array {
  const buf = new Uint8Array(16);
  const dv = new DataView(buf.buffer);
  dv.setFloat64(0, atime, true);
  dv.setFloat64(8, mtime, true);
  return buf;
}

/** `[fd: u32]` — close, fstat, fsync. */
export function encodeFdPayload(fd: number): Uint8Array {
  const buf = new Uint8Array(4);
  writeU32(buf, 0, fd);
  return buf;
}

/** `[fd: u32][len: u32][pos: f64]` — fread. `pos` of -1 means "use the fd's own cursor". */
export function encodeFreadPayload(fd: number, length: number, position: number | null): Uint8Array {
  const buf = new Uint8Array(16);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, fd, true);
  dv.setUint32(4, length, true);
  dv.setFloat64(8, position ?? -1, true);
  return buf;
}

/** `[fd: u32][pos: f64][bytes…]` — fwrite. */
export function encodeFwritePayload(fd: number, position: number | null, data: Uint8Array): Uint8Array {
  const buf = new Uint8Array(12 + data.byteLength);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, fd, true);
  dv.setFloat64(4, position ?? -1, true);
  buf.set(data, 12);
  return buf;
}

/** `[fd: u32][len: f64]` — ftruncate. Same float64 length as {@link encodeTruncatePayload}. */
export function encodeFtruncatePayload(fd: number, len: number): Uint8Array {
  const buf = new Uint8Array(12);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, fd, true);
  dv.setFloat64(4, len, true);
  return buf;
}

/** `[fd: u32][mode: u32]` — fchmod. */
export function encodeFchmodPayload(fd: number, mode: number): Uint8Array {
  const buf = new Uint8Array(8);
  writeU32(buf, 0, fd);
  writeU32(buf, 4, mode);
  return buf;
}

/** `[fd: u32][uid: u32][gid: u32]` — fchown. */
export function encodeFchownPayload(fd: number, uid: number, gid: number): Uint8Array {
  const buf = new Uint8Array(12);
  writeU32(buf, 0, fd);
  writeU32(buf, 4, uid);
  writeU32(buf, 8, gid);
  return buf;
}

/**
 * `[fd: u32][pad: u32][atime: f64][mtime: f64]` — futimes.
 *
 * The four padding bytes keep both timestamps 8-byte aligned, which is why this is 24 bytes
 * rather than 20.
 */
export function encodeFutimesPayload(fd: number, atime: number, mtime: number): Uint8Array {
  const buf = new Uint8Array(24);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, fd, true);
  dv.setFloat64(8, atime, true);
  dv.setFloat64(16, mtime, true);
  return buf;
}

/** Write a little-endian uint32 without constructing a DataView — see methods/mode.ts. */
function writeU32(buf: Uint8Array, at: number, value: number): void {
  buf[at] = value;
  buf[at + 1] = value >>> 8;
  buf[at + 2] = value >>> 16;
  buf[at + 3] = value >>> 24;
}

/**
 * Coerce Node's time arguments (`utimes`, `futimes`, `lutimes`) to epoch milliseconds.
 *
 * **Numbers are seconds, not milliseconds** — this is Node's `toUnixTimestamp`, and getting it
 * wrong is a silent 1000× error: `fs.utimesSync(p, 1600000000)` means 2020, and treating that
 * as milliseconds stamps the file 1970. A numeric *string* is accepted and read the same way, a
 * `Date` is used as-is, and anything non-finite or unparseable is rejected the way Node rejects
 * it rather than quietly becoming `NaN` in the payload.
 */
export function toEpochMs(time: Date | number | string, name = 'time'): number {
  return toUnixTimestamp(time, name) * 1000;
}

/**
 * Node's `toUnixTimestamp` — a time argument reduced to **seconds** since the epoch.
 *
 * Exported as `fs._toUnixTimestamp`, which node exposes too. The underscore is node's own: it is
 * an internal helper that leaked into the public object and stayed, and code that reproduces
 * node's time coercion reaches for it.
 *
 * The rule that is easy to miss, and that this got wrong: **a negative number means "now"**, not
 * a pre-epoch instant. `fs.utimesSync(p, -1, -1)` stamps the current time in node; here it used
 * to stamp one second *before* 1970. Verified against a live `node:fs` rather than the docs,
 * which do not mention it.
 */
export function toUnixTimestamp(time: Date | number | string, name = 'time'): number {
  // A numeric string behaves like the number: '1600000000' is accepted.
  if (typeof time === 'string' && String(Number(time)) === time.trim() && time.trim() !== '') {
    return Number(time);
  }
  if (typeof time === 'number' && Number.isFinite(time)) {
    return time < 0 ? Date.now() / 1000 : time;
  }
  if (time instanceof Date) return time.getTime() / 1000;
  throw invalidArgType(name, 'number | string | Date', time);
}

// ---- Decoders ----
//
// Each pairs with the encoder above it. They live here, next to the encoder, so a layout is
// described in exactly one place for both directions — the `dispatchOp` decode path (VFS) and
// the OPFS-mode handler both call these. Every decoder returns `null` for a frame too short to
// hold its fields, which is what puts the length guard in one place too: reading past the
// payload would pull in whatever follows it in the request buffer.
//
// The returned objects are short-lived and fully scalar-replaced by V8 — measured at ~1.9 ns/op
// over reading the fields inline, against ops costing three orders of magnitude more.

const viewOf = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.byteLength);
const tooShort = (d: Uint8Array | null | undefined, n: number): boolean => !d || d.byteLength < n;

/** `[mode: u32]`. */
export function decodeModeArg(data: Uint8Array | null): number | null {
  return tooShort(data, 4) ? null : viewOf(data!).getUint32(0, true);
}

/** `[len: f64]`. */
export function decodeTruncateArgs(data: Uint8Array | null): number | null {
  return tooShort(data, 8) ? null : viewOf(data!).getFloat64(0, true);
}

/** `[uid: u32][gid: u32]`. */
export function decodeChownArgs(data: Uint8Array | null): { uid: number; gid: number } | null {
  if (tooShort(data, 8)) return null;
  const dv = viewOf(data!);
  return { uid: dv.getUint32(0, true), gid: dv.getUint32(4, true) };
}

/** `[atime: f64][mtime: f64]`. */
export function decodeTimesArgs(data: Uint8Array | null): { atime: number; mtime: number } | null {
  if (tooShort(data, 16)) return null;
  const dv = viewOf(data!);
  return { atime: dv.getFloat64(0, true), mtime: dv.getFloat64(8, true) };
}

/** `[fd: u32]`. */
export function decodeFdArg(data: Uint8Array | null): number | null {
  return tooShort(data, 4) ? null : viewOf(data!).getUint32(0, true);
}

/** `[fd: u32][len: u32][pos: f64]`. A position of -1 becomes `null` — use the fd's own cursor. */
export function decodeFreadArgs(data: Uint8Array | null): { fd: number; length: number; position: number | null } | null {
  if (tooShort(data, 16)) return null;
  const dv = viewOf(data!);
  const pos = dv.getFloat64(8, true);
  return { fd: dv.getUint32(0, true), length: dv.getUint32(4, true), position: pos === -1 ? null : pos };
}

/** `[fd: u32][pos: f64][bytes…]`. `bytes` is a view into the request buffer, not a copy. */
export function decodeFwriteArgs(data: Uint8Array | null): { fd: number; position: number | null; bytes: Uint8Array } | null {
  if (tooShort(data, 12)) return null;
  const dv = viewOf(data!);
  const pos = dv.getFloat64(4, true);
  return { fd: dv.getUint32(0, true), position: pos === -1 ? null : pos, bytes: data!.subarray(12) };
}

/** `[fd: u32][len: f64]`. */
export function decodeFtruncateArgs(data: Uint8Array | null): { fd: number; len: number } | null {
  if (tooShort(data, 12)) return null;
  const dv = viewOf(data!);
  return { fd: dv.getUint32(0, true), len: dv.getFloat64(4, true) };
}

/** `[fd: u32][mode: u32]`. */
export function decodeFchmodArgs(data: Uint8Array | null): { fd: number; mode: number } | null {
  if (tooShort(data, 8)) return null;
  const dv = viewOf(data!);
  return { fd: dv.getUint32(0, true), mode: dv.getUint32(4, true) };
}

/** `[fd: u32][uid: u32][gid: u32]`. */
export function decodeFchownArgs(data: Uint8Array | null): { fd: number; uid: number; gid: number } | null {
  if (tooShort(data, 12)) return null;
  const dv = viewOf(data!);
  return { fd: dv.getUint32(0, true), uid: dv.getUint32(4, true), gid: dv.getUint32(8, true) };
}

/** `[fd: u32][pad: u32][atime: f64][mtime: f64]`. */
export function decodeFutimesArgs(data: Uint8Array | null): { fd: number; atime: number; mtime: number } | null {
  if (tooShort(data, 24)) return null;
  const dv = viewOf(data!);
  return { fd: dv.getUint32(0, true), atime: dv.getFloat64(8, true), mtime: dv.getFloat64(16, true) };
}
