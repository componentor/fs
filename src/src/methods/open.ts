import type {
  Stats, BigIntStats, StatOptions, FileHandle, ReadOptions, WriteOptions, Encoding, Mode,
  ReadStreamOptions, WriteStreamOptions, FSReadStream, FSWriteStream,
} from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest, encodeRequestU32 } from '../protocol/opcodes.js';
import { statusToError, invalidArgValue } from '../errors.js';
import { toEpochMs } from '../protocol/payloads.js';
import { parseFileMode, encodeMode } from './mode.js';
import {
  encodeFdPayload, encodeFreadPayload, encodeFwritePayload, encodeFtruncatePayload,
} from '../protocol/payloads.js';
import { decodeStats, decodeStatsBigInt } from '../stats.js';
import { decodeBuffer, encodeString } from '../encoding.js';
import { SimpleEventEmitter } from '../node-streams.js';
import {
  readStreamFromHandle, writeStreamFromHandle, linesFromStream, webStreamFromHandle,
  type HandleSource,
} from '../handle-streams.js';
import { constants } from '../constants.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Node's flag strings → `O_*` bits.
 *
 * The `s` variants (`rs`, `rs+`, `as`, `as+`) were missing and fell through to the default
 * `O_RDONLY`. That was invisible while access modes went unchecked; once they were enforced
 * (3.3.19) an `as` descriptor would have rejected the very writes it was opened for. `s` means
 * O_SYNC — "do not return until written" — which the engine already satisfies: every write goes
 * through to the backing handle before the call returns, so the bit affects nothing beyond the
 * access mode here.
 *
 * An unrecognised string is rejected rather than silently treated as read-only, matching Node:
 * `fs.openSync(p, 'zz')` raises ERR_INVALID_ARG_VALUE rather than handing back a descriptor that
 * cannot do what the caller asked.
 */
export function parseFlags(flags: string): number {
  const { O_RDONLY, O_RDWR, O_WRONLY, O_CREAT, O_TRUNC, O_APPEND, O_EXCL } = constants;
  switch (flags) {
    case 'r': return O_RDONLY;
    case 'rs': return O_RDONLY;                                    // O_SYNC — see above
    case 'r+': return O_RDWR;
    case 'rs+': return O_RDWR;
    case 'w': return O_WRONLY | O_CREAT | O_TRUNC;
    case 'wx': return O_WRONLY | O_CREAT | O_TRUNC | O_EXCL;
    case 'w+': return O_RDWR | O_CREAT | O_TRUNC;
    case 'wx+': return O_RDWR | O_CREAT | O_TRUNC | O_EXCL;
    case 'a': return O_WRONLY | O_CREAT | O_APPEND;
    case 'ax': return O_WRONLY | O_CREAT | O_APPEND | O_EXCL;
    case 'as': return O_WRONLY | O_CREAT | O_APPEND;
    case 'a+': return O_RDWR | O_CREAT | O_APPEND;
    case 'ax+': return O_RDWR | O_CREAT | O_APPEND | O_EXCL;
    case 'as+': return O_RDWR | O_CREAT | O_APPEND;
    default:
      throw invalidArgValue('flags', flags, 'is invalid');
  }
}

/**
 * Node's `fs.open` defaults `mode` to 0o666; the engine subtracts its umask, exactly as
 * open(2) does. With the default 0o022 that yields the historical 0o644, so callers that pass
 * no mode are unaffected. The mode is only consulted when O_CREAT actually creates the file.
 */
export const DEFAULT_OPEN_MODE = 0o666;

/** Resolve open's mode argument the way Node does — absent means 0o666, not "no mode". */
export function resolveOpenMode(mode?: Mode): number {
  return mode === undefined ? DEFAULT_OPEN_MODE : parseFileMode(mode, 'mode');
}

export function openSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  flags: string | number = 'r',
  mode?: Mode
): number {
  const numFlags = typeof flags === 'string' ? parseFlags(flags) : flags;
  // Zero-allocation encode: the mode goes straight into the request buffer.
  const buf = encodeRequestU32(OP.OPEN, filePath, numFlags, resolveOpenMode(mode));
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'open', filePath);
  return new DataView(data!.buffer, data!.byteOffset, data!.byteLength).getUint32(0, true);
}

export function closeSync(
  syncRequest: SyncRequestFn,
  fd: number
): void {
  const buf = encodeRequest(OP.CLOSE, '', 0, encodeFdPayload(fd));
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'close', String(fd));
}

export function readSync(
  syncRequest: SyncRequestFn,
  fd: number,
  bufferOrOptions: Uint8Array | { buffer: Uint8Array; offset?: number; length?: number; position?: number | null },
  offsetOrOptions?: number | { offset?: number; length?: number; position?: number | null },
  length?: number,
  position?: number | null
): number {
  let buffer: Uint8Array;
  let off: number, len: number, pos: number | null;

  if (bufferOrOptions instanceof Uint8Array) {
    buffer = bufferOrOptions;
    if (offsetOrOptions != null && typeof offsetOrOptions === 'object') {
      // readSync(fd, buffer, { offset?, length?, position? })
      off = offsetOrOptions.offset ?? 0;
      len = offsetOrOptions.length ?? buffer.byteLength;
      pos = offsetOrOptions.position ?? null;
    } else {
      // readSync(fd, buffer, offset?, length?, position?)
      off = offsetOrOptions ?? 0;
      len = length ?? buffer.byteLength;
      pos = position ?? null;
    }
  } else {
    // readSync(fd, { buffer, offset?, length?, position? })
    buffer = bufferOrOptions.buffer;
    off = bufferOrOptions.offset ?? 0;
    len = bufferOrOptions.length ?? buffer.byteLength;
    pos = bufferOrOptions.position ?? null;
  }

  const buf = encodeRequest(OP.FREAD, '', 0, encodeFreadPayload(fd, len, pos));
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'read', String(fd));
  if (data) {
    buffer.set(data.subarray(0, Math.min(data.byteLength, len)), off);
    return data.byteLength;
  }
  return 0;
}

export function writeSyncFd(
  syncRequest: SyncRequestFn,
  fd: number,
  bufferOrString: Uint8Array | string,
  offsetOrPositionOrOptions?: number | { offset?: number; length?: number; position?: number | null },
  lengthOrEncoding?: number | string,
  position?: number | null
): number {
  let writeData: Uint8Array;
  let pos: number | null;

  if (typeof bufferOrString === 'string') {
    // writeSync(fd, string, position?, encoding?)
    writeData = encoder.encode(bufferOrString);
    pos = (offsetOrPositionOrOptions != null && typeof offsetOrPositionOrOptions === 'number') ? offsetOrPositionOrOptions : null;
    // lengthOrEncoding is encoding (ignored — always utf-8)
  } else if (offsetOrPositionOrOptions != null && typeof offsetOrPositionOrOptions === 'object') {
    // writeSync(fd, buffer, { offset?, length?, position? })
    const offset = offsetOrPositionOrOptions.offset ?? 0;
    const length = offsetOrPositionOrOptions.length ?? bufferOrString.byteLength;
    pos = offsetOrPositionOrOptions.position ?? null;
    writeData = bufferOrString.subarray(offset, offset + length);
  } else {
    // writeSync(fd, buffer, offset?, length?, position?)
    const offset = offsetOrPositionOrOptions ?? 0;
    const length = lengthOrEncoding != null ? lengthOrEncoding as number : bufferOrString.byteLength;
    pos = position ?? null;
    writeData = bufferOrString.subarray(offset, offset + length);
  }
  const buf = encodeRequest(OP.FWRITE, '', 0, encodeFwritePayload(fd, pos, writeData));
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'write', String(fd));
  return data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
}

export function fstatSync(
  syncRequest: SyncRequestFn,
  fd: number,
  options?: StatOptions
): Stats | BigIntStats {
  const buf = encodeRequest(OP.FSTAT, '', 0, encodeFdPayload(fd));
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'fstat', String(fd));
  return options?.bigint ? decodeStatsBigInt(data!) : decodeStats(data!);
}

export function ftruncateSync(
  syncRequest: SyncRequestFn,
  fd: number,
  len: number = 0
): void {
  const buf = encodeRequest(OP.FTRUNCATE, '', 0, encodeFtruncatePayload(fd, len));
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'ftruncate', String(fd));
}

export function fdatasyncSync(
  syncRequest: SyncRequestFn,
  fd: number
): void {
  const buf = encodeRequest(OP.FSYNC, '');
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'fdatasync', String(fd));
}

// ========== Async FileHandle ==========

export async function open(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  flags?: string | number,
  mode?: Mode
): Promise<FileHandle> {
  const numFlags = typeof flags === 'string' ? parseFlags(flags ?? 'r') : (flags ?? 0);
  // Async path posts to a relay worker, so it needs a real (and per-call fresh) Uint8Array.
  const { status, data } = await asyncRequest(OP.OPEN, filePath, numFlags, encodeMode(resolveOpenMode(mode)));
  if (status !== 0) throw statusToError(status, 'open', filePath);
  const fd = new DataView(data!.buffer, data!.byteOffset, data!.byteLength).getUint32(0, true);
  return createFileHandle(fd, asyncRequest);
}

export function createFileHandle(fd: number, asyncRequest: AsyncRequestFn): FileHandle {
  const events = new SimpleEventEmitter();

  const handle: FileHandle = {
    fd,

    async read(
      bufferOrOptions: Uint8Array | { buffer: Uint8Array; offset?: number; length?: number; position?: number | null },
      offsetOrOptions?: number | { offset?: number; length?: number; position?: number | null },
      length?: number,
      position?: number | null
    ) {
      let buffer: Uint8Array;
      let off: number, len: number, pos: number | null;

      if (bufferOrOptions instanceof Uint8Array) {
        buffer = bufferOrOptions;
        if (offsetOrOptions != null && typeof offsetOrOptions === 'object') {
          off = offsetOrOptions.offset ?? 0;
          len = offsetOrOptions.length ?? buffer.byteLength;
          pos = offsetOrOptions.position ?? null;
        } else {
          off = offsetOrOptions ?? 0;
          len = length ?? buffer.byteLength;
          pos = position ?? null;
        }
      } else {
        buffer = bufferOrOptions.buffer;
        off = bufferOrOptions.offset ?? 0;
        len = bufferOrOptions.length ?? buffer.byteLength;
        pos = bufferOrOptions.position ?? null;
      }

      const { status, data } = await asyncRequest(OP.FREAD, '', 0, null, undefined, { fd, length: len, position: pos ?? -1 });
      if (status !== 0) throw statusToError(status, 'read', String(fd));
      const bytesRead = data ? data.byteLength : 0;
      if (data) buffer.set(data.subarray(0, Math.min(bytesRead, len)), off);
      return { bytesRead, buffer };
    },

    async write(bufferOrString: Uint8Array | string, offsetOrPositionOrOptions?: number | { offset?: number; length?: number; position?: number | null }, lengthOrEncoding?: number | string, position?: number | null) {
      let writeData: Uint8Array;
      let pos: number;
      let resultBuffer: Uint8Array;

      if (typeof bufferOrString === 'string') {
        resultBuffer = encoder.encode(bufferOrString);
        writeData = resultBuffer;
        pos = (offsetOrPositionOrOptions != null && typeof offsetOrPositionOrOptions === 'number') ? offsetOrPositionOrOptions : -1;
      } else if (offsetOrPositionOrOptions != null && typeof offsetOrPositionOrOptions === 'object') {
        resultBuffer = bufferOrString;
        const offset = offsetOrPositionOrOptions.offset ?? 0;
        const length = offsetOrPositionOrOptions.length ?? bufferOrString.byteLength;
        pos = (offsetOrPositionOrOptions.position != null) ? offsetOrPositionOrOptions.position : -1;
        writeData = bufferOrString.subarray(offset, offset + length);
      } else {
        resultBuffer = bufferOrString;
        const offset = offsetOrPositionOrOptions ?? 0;
        const length = lengthOrEncoding != null ? lengthOrEncoding as number : bufferOrString.byteLength;
        pos = (position != null) ? position : -1;
        writeData = bufferOrString.subarray(offset, offset + length);
      }

      const { status, data } = await asyncRequest(OP.FWRITE, '', 0, null, undefined, { fd, data: writeData, position: pos });
      if (status !== 0) throw statusToError(status, 'write', String(fd));
      const bytesWritten = data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
      return { bytesWritten, buffer: resultBuffer };
    },

    async readv(buffers: Uint8Array[], position?: number | null) {
      let totalRead = 0;
      let pos = position ?? null;
      for (const buf of buffers) {
        const { bytesRead } = await this.read(buf, 0, buf.byteLength, pos);
        totalRead += bytesRead;
        if (pos !== null) pos += bytesRead;
        if (bytesRead < buf.byteLength) break; // short read = EOF
      }
      return { bytesRead: totalRead, buffers };
    },

    async writev(buffers: Uint8Array[], position?: number | null) {
      let totalWritten = 0;
      let pos = position ?? null;
      for (const buf of buffers) {
        const { bytesWritten } = await this.write(buf, 0, buf.byteLength, pos);
        totalWritten += bytesWritten;
        if (pos !== null) pos += bytesWritten;
      }
      return { bytesWritten: totalWritten, buffers };
    },

    async readFile(options?: ReadOptions | Encoding | null) {
      const encoding = typeof options === 'string' ? options : options?.encoding;
      // From the *cursor*, not from zero. `open` leaves the cursor at 0, so the difference only
      // shows once the handle has been read from: in Node a second `readFile()` returns '' and
      // one that follows `read(buf, 0, 3)` starts at byte 3. Position 0 replayed the file
      // instead, and left the cursor where it was.
      const { status, data } = await asyncRequest(OP.FREAD, '', 0, null, undefined, { fd, length: Number.MAX_SAFE_INTEGER, position: -1 });
      if (status !== 0) throw statusToError(status, 'read', String(fd));
      const result = data ?? new Uint8Array(0);
      if (encoding) return decodeBuffer(result, encoding);
      return result;
    },

    async writeFile(data: string | Uint8Array, options?: WriteOptions | Encoding) {
      const encoding = typeof options === 'string' ? options : options?.encoding;
      const encoded = typeof data === 'string'
        ? (encoding ? encodeString(data, encoding) : encoder.encode(data))
        : data;
      const { status } = await asyncRequest(OP.FWRITE, '', 0, null, undefined, { fd, data: encoded, position: -1 });
      if (status !== 0) throw statusToError(status, 'write', String(fd));
    },

    async truncate(len = 0) {
      const { status } = await asyncRequest(OP.FTRUNCATE, '', 0, null, undefined, { fd, length: len });
      if (status !== 0) throw statusToError(status, 'ftruncate', String(fd));
    },

    async stat() {
      const { status, data } = await asyncRequest(OP.FSTAT, '', 0, null, undefined, { fd });
      if (status !== 0) throw statusToError(status, 'fstat', String(fd));
      return decodeStats(data!);
    },

    /**
     * In Node this is a documented **alias of `writeFile`** — the appending comes from opening
     * with `'a'` (O_APPEND), not from the method. Seeking to end-of-file here made
     * `handle.appendFile()` on an `'r+'` handle write past the cursor, where Node overwrites at
     * it, and cost an extra `fstat` round-trip per call.
     */
    async appendFile(data: string | Uint8Array, options?: WriteOptions | Encoding) {
      return this.writeFile(data, options);
    },

    async chmod(mode: number) {
      // Payload: [fd: u32][mode: u32] — engine resolves fd → inode and
      // updates its mode bits directly, matching native libuv.
      const payload = new Uint8Array(8);
      const dv = new DataView(payload.buffer);
      dv.setUint32(0, fd, true);
      dv.setUint32(4, mode, true);
      const { status } = await asyncRequest(OP.FCHMOD, '', 0, payload);
      if (status !== 0) throw statusToError(status, 'fchmod', String(fd));
    },

    async chown(uid: number, gid: number) {
      // Payload: [fd: u32][uid: u32][gid: u32]
      const payload = new Uint8Array(12);
      const dv = new DataView(payload.buffer);
      dv.setUint32(0, fd, true);
      dv.setUint32(4, uid, true);
      dv.setUint32(8, gid, true);
      const { status } = await asyncRequest(OP.FCHOWN, '', 0, payload);
      if (status !== 0) throw statusToError(status, 'fchown', String(fd));
    },

    async utimes(atime: Date | number, mtime: Date | number) {
      // Payload: [fd: u32][pad: u32][atime: f64][mtime: f64] — 4-byte pad
      // keeps f64 fields 8-byte aligned for DataView access on both sides.
      const payload = new Uint8Array(24);
      const dv = new DataView(payload.buffer);
      dv.setUint32(0, fd, true);
      dv.setFloat64(8, toEpochMs(atime, 'atime'), true);
      dv.setFloat64(16, toEpochMs(mtime, 'mtime'), true);
      const { status } = await asyncRequest(OP.FUTIMES, '', 0, payload);
      if (status !== 0) throw statusToError(status, 'futimes', String(fd));
    },

    async sync() {
      await asyncRequest(OP.FSYNC, '');
    },

    async datasync() {
      await asyncRequest(OP.FSYNC, '');
    },

    async close() {
      const { status } = await asyncRequest(OP.CLOSE, '', 0, null, undefined, { fd });
      if (status !== 0) throw statusToError(status, 'close', String(fd));
      // node's FileHandle is an EventEmitter and emits 'close' here.
      events.emit('close');
    },

    [Symbol.asyncDispose]() {
      return this.close();
    },

    // ---- Streams over this handle ----
    //
    // All four were missing. A stream built from a handle **owns** it: node closes the handle
    // when the stream ends, so `handle.stat()` afterwards is EBADF. `autoClose: false` opts out.
    // The machinery is shared with `fs.createReadStream`/`createWriteStream` so the two cannot
    // drift — see [handle-streams.ts](../handle-streams.ts).

    createReadStream(options?: ReadStreamOptions | Encoding) {
      return readStreamFromHandle(handleSource(options), options) as unknown as FSReadStream;
    },

    createWriteStream(options?: WriteStreamOptions | Encoding) {
      return writeStreamFromHandle(handleSource(options), options) as unknown as FSWriteStream;
    },

    readLines(options?: ReadStreamOptions | Encoding) {
      return linesFromStream(readStreamFromHandle(handleSource(options), options));
    },

    readableWebStream(_options?: { type?: 'bytes' }) {
      return webStreamFromHandle(handleSource(undefined));
    },

    // ---- EventEmitter surface ----
    on(event: string, listener: (...args: never[]) => void) { events.on(event, listener as never); return this; },
    once(event: string, listener: (...args: never[]) => void) { events.once(event, listener as never); return this; },
    off(event: string, listener: (...args: never[]) => void) { events.off(event, listener as never); return this; },
    removeListener(event: string, listener: (...args: never[]) => void) { events.off(event, listener as never); return this; },
    emit(event: string, ...args: never[]) { return events.emit(event, ...args); },
  };

  /**
   * Streams take the handle as-is and close it when they finish, which is node's default for a
   * handle-backed stream. `autoClose: false` leaves it to the caller.
   *
   * `followCursor` is what makes this a stream over *this handle* rather than over its file: with
   * no explicit `start` it picks up at the handle's current position and advances it, as node
   * does — see {@link HandleSource.followCursor}.
   */
  function handleSource(options?: ReadStreamOptions | WriteStreamOptions | Encoding): HandleSource {
    const opts = typeof options === 'string' ? undefined : options;
    return {
      acquire: async () => handle,
      autoClose: opts?.autoClose !== false,
      path: '', // node reports no path for a handle-backed stream
      followCursor: true,
    };
  }

  return handle;
}
