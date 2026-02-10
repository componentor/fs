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
  buffer: Uint8Array,
  offset: number = 0,
  length: number = buffer.byteLength,
  position: number | null = null
): number {
  const fdBuf = new Uint8Array(12);
  const dv = new DataView(fdBuf.buffer);
  dv.setUint32(0, fd, true);
  dv.setUint32(4, length, true);
  dv.setInt32(8, position ?? -1, true);
  const buf = encodeRequest(OP.FREAD, '', 0, fdBuf);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'read', String(fd));
  if (data) {
    buffer.set(data.subarray(0, Math.min(data.byteLength, length)), offset);
    return data.byteLength;
  }
  return 0;
}

export function writeSyncFd(
  syncRequest: SyncRequestFn,
  fd: number,
  buffer: Uint8Array,
  offset: number = 0,
  length: number = buffer.byteLength,
  position: number | null = null
): number {
  const writeData = buffer.subarray(offset, offset + length);
  const fdBuf = new Uint8Array(8 + writeData.byteLength);
  const dv = new DataView(fdBuf.buffer);
  dv.setUint32(0, fd, true);
  dv.setInt32(4, position ?? -1, true);
  fdBuf.set(writeData, 8);
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
  const fdBuf = new Uint8Array(8);
  const dv = new DataView(fdBuf.buffer);
  dv.setUint32(0, fd, true);
  dv.setUint32(4, len, true);
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

function createFileHandle(fd: number, asyncRequest: AsyncRequestFn): FileHandle {
  return {
    fd,

    async read(buffer: Uint8Array, offset = 0, length = buffer.byteLength, position: number | null = null) {
      const { status, data } = await asyncRequest(OP.FREAD, '', 0, null, undefined, { fd, length, position: position ?? -1 });
      if (status !== 0) throw statusToError(status, 'read', String(fd));
      const bytesRead = data ? data.byteLength : 0;
      if (data) buffer.set(data.subarray(0, Math.min(bytesRead, length)), offset);
      return { bytesRead, buffer };
    },

    async write(buffer: Uint8Array, offset = 0, length = buffer.byteLength, position: number | null = null) {
      const writeData = buffer.subarray(offset, offset + length);
      const { status, data } = await asyncRequest(OP.FWRITE, '', 0, null, undefined, { fd, data: writeData, position: position ?? -1 });
      if (status !== 0) throw statusToError(status, 'write', String(fd));
      const bytesWritten = data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
      return { bytesWritten, buffer };
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
  };
}
