import type { Stats, FileHandle, ReadOptions, WriteOptions, Encoding } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';
import { decodeStats } from '../stats.js';
import { constants } from '../constants.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function parseFlags(flags: string): number {
  switch (flags) {
    case 'r': return constants.O_RDONLY;
    case 'r+': return constants.O_RDWR;
    case 'w': return constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC;
    case 'w+': return constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC;
    case 'a': return constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND;
    case 'a+': return constants.O_RDWR | constants.O_CREAT | constants.O_APPEND;
    case 'wx': return constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_EXCL;
    case 'wx+': return constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC | constants.O_EXCL;
    case 'ax': return constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_EXCL;
    case 'ax+': return constants.O_RDWR | constants.O_CREAT | constants.O_APPEND | constants.O_EXCL;
    default: return constants.O_RDONLY;
  }
}

export function openSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  flags: string | number = 'r',
  _mode?: number
): number {
  const numFlags = typeof flags === 'string' ? parseFlags(flags) : flags;
  const buf = encodeRequest(OP.OPEN, filePath, numFlags);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'open', filePath);
  return new DataView(data!.buffer, data!.byteOffset, data!.byteLength).getUint32(0, true);
}

export function closeSync(
  syncRequest: SyncRequestFn,
  fd: number
): void {
  const fdBuf = new Uint8Array(4);
  new DataView(fdBuf.buffer).setUint32(0, fd, true);
  const buf = encodeRequest(OP.CLOSE, '', 0, fdBuf);
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

  const fdBuf = new Uint8Array(16);
  const dv = new DataView(fdBuf.buffer);
  dv.setUint32(0, fd, true);
  dv.setUint32(4, len, true);
  dv.setFloat64(8, pos ?? -1, true);
  const buf = encodeRequest(OP.FREAD, '', 0, fdBuf);
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
  const fdBuf = new Uint8Array(12 + writeData.byteLength);
  const dv = new DataView(fdBuf.buffer);
  dv.setUint32(0, fd, true);
  dv.setFloat64(4, pos ?? -1, true);
  fdBuf.set(writeData, 12);
  const buf = encodeRequest(OP.FWRITE, '', 0, fdBuf);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'write', String(fd));
  return data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
}

export function fstatSync(
  syncRequest: SyncRequestFn,
  fd: number
): Stats {
  const fdBuf = new Uint8Array(4);
  new DataView(fdBuf.buffer).setUint32(0, fd, true);
  const buf = encodeRequest(OP.FSTAT, '', 0, fdBuf);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'fstat', String(fd));
  return decodeStats(data!);
}

export function ftruncateSync(
  syncRequest: SyncRequestFn,
  fd: number,
  len: number = 0
): void {
  const fdBuf = new Uint8Array(12);
  const dv = new DataView(fdBuf.buffer);
  dv.setUint32(0, fd, true);
  dv.setFloat64(4, len, true);
  const buf = encodeRequest(OP.FTRUNCATE, '', 0, fdBuf);
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
  _mode?: number
): Promise<FileHandle> {
  const numFlags = typeof flags === 'string' ? parseFlags(flags ?? 'r') : (flags ?? 0);
  const { status, data } = await asyncRequest(OP.OPEN, filePath, numFlags);
  if (status !== 0) throw statusToError(status, 'open', filePath);
  const fd = new DataView(data!.buffer, data!.byteOffset, data!.byteLength).getUint32(0, true);
  return createFileHandle(fd, asyncRequest);
}

export function createFileHandle(fd: number, asyncRequest: AsyncRequestFn): FileHandle {
  return {
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
      const { status, data } = await asyncRequest(OP.FREAD, '', 0, null, undefined, { fd, length: Number.MAX_SAFE_INTEGER, position: 0 });
      if (status !== 0) throw statusToError(status, 'read', String(fd));
      const result = data ?? new Uint8Array(0);
      if (encoding) return decoder.decode(result);
      return result;
    },

    async writeFile(data: string | Uint8Array, _options?: WriteOptions | Encoding) {
      const encoded = typeof data === 'string' ? encoder.encode(data) : data;
      const { status } = await asyncRequest(OP.FWRITE, '', 0, null, undefined, { fd, data: encoded, position: 0 });
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

    async appendFile(data: string | Uint8Array, _options?: WriteOptions | Encoding) {
      const encoded = typeof data === 'string' ? encoder.encode(data) : data;
      const st = await this.stat();
      const { status } = await asyncRequest(OP.FWRITE, '', 0, null, undefined, { fd, data: encoded, position: st.size });
      if (status !== 0) throw statusToError(status, 'write', String(fd));
    },

    async chmod(_mode: number) {
      // Permissions are cosmetic in a browser VFS — silently succeed
    },

    async chown(_uid: number, _gid: number) {
      // Ownership is cosmetic in a browser VFS — silently succeed
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
    },

    [Symbol.asyncDispose]() {
      return this.close();
    },
  };
}
