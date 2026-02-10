/**
 * Binary protocol operation codes and header encoding/decoding.
 * All inter-worker messages use this minimal binary protocol — no JSON, no strings.
 */

// Operation codes
export const OP = {
  READ: 1,
  WRITE: 2,
  UNLINK: 3,
  STAT: 4,
  LSTAT: 5,
  MKDIR: 6,
  RMDIR: 7,
  READDIR: 8,
  RENAME: 9,
  EXISTS: 10,
  TRUNCATE: 11,
  APPEND: 12,
  COPY: 13,
  ACCESS: 14,
  REALPATH: 15,
  CHMOD: 16,
  CHOWN: 17,
  UTIMES: 18,
  SYMLINK: 19,
  READLINK: 20,
  LINK: 21,
  OPEN: 22,
  CLOSE: 23,
  FREAD: 24,
  FWRITE: 25,
  FSTAT: 26,
  FTRUNCATE: 27,
  FSYNC: 28,
  OPENDIR: 29,
  MKDTEMP: 30,
} as const;

export type OpCode = (typeof OP)[keyof typeof OP];

// Response status codes
export const STATUS = {
  OK: 0,
  ENOENT: 1,
  EEXIST: 2,
  EISDIR: 3,
  ENOTDIR: 4,
  ENOTEMPTY: 5,
  EACCES: 6,
  EINVAL: 7,
  EBADF: 8,
  ELOOP: 9,
  ENOSPC: 10,
} as const;

// SAB layout offsets
export const SAB_OFFSETS = {
  CONTROL: 0,       // Int32 - signal (0=idle, 1=request, 2=response, 3=chunk, 4=ack)
  OPCODE: 4,        // Int32 - operation code
  STATUS: 8,        // Int32 - response status / error
  CHUNK_LEN: 12,    // Int32 - bytes in this chunk
  TOTAL_LEN: 16,    // BigUint64 - full data size across all chunks
  CHUNK_IDX: 24,    // Int32 - 0-based chunk index
  RESERVED: 28,     // Int32 - reserved
  HEADER_SIZE: 32,  // Data payload starts here
} as const;

// SAB control signals
export const SIGNAL = {
  IDLE: 0,
  REQUEST: 1,
  RESPONSE: 2,
  CHUNK: 3,
  CHUNK_ACK: 4,
} as const;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Encode a request into an ArrayBuffer for MessageChannel transfer.
 *
 * Request format (16-byte header + path + data):
 *   bytes 0-3:   operation (uint32)
 *   bytes 4-7:   flags (uint32)
 *   bytes 8-11:  pathLen (uint32)
 *   bytes 12-15: dataLen (uint32)
 *   bytes 16+:   path (UTF-8)
 *   bytes 16+pathLen: data payload
 */
export function encodeRequest(
  op: number,
  path: string,
  flags: number = 0,
  data?: Uint8Array
): ArrayBuffer {
  const pathBytes = encoder.encode(path);
  const dataLen = data ? data.byteLength : 0;
  const totalLen = 16 + pathBytes.byteLength + dataLen;
  const buf = new ArrayBuffer(totalLen);
  const view = new DataView(buf);

  view.setUint32(0, op, true);
  view.setUint32(4, flags, true);
  view.setUint32(8, pathBytes.byteLength, true);
  view.setUint32(12, dataLen, true);

  const bytes = new Uint8Array(buf);
  bytes.set(pathBytes, 16);
  if (data) {
    bytes.set(data, 16 + pathBytes.byteLength);
  }

  return buf;
}

/**
 * Decode a request ArrayBuffer.
 */
export function decodeRequest(buf: ArrayBuffer): {
  op: number;
  flags: number;
  path: string;
  data: Uint8Array | null;
} {
  const view = new DataView(buf);
  const op = view.getUint32(0, true);
  const flags = view.getUint32(4, true);
  const pathLen = view.getUint32(8, true);
  const dataLen = view.getUint32(12, true);

  const bytes = new Uint8Array(buf);
  const path = decoder.decode(bytes.subarray(16, 16 + pathLen));
  const data = dataLen > 0
    ? bytes.subarray(16 + pathLen, 16 + pathLen + dataLen)
    : null;

  return { op, flags, path, data };
}

/**
 * Encode a response into an ArrayBuffer.
 *
 * Response format (8-byte header + data):
 *   bytes 0-3: status (uint32)
 *   bytes 4-7: dataLen (uint32)
 *   bytes 8+:  data payload
 */
export function encodeResponse(status: number, data?: Uint8Array): ArrayBuffer {
  const dataLen = data ? data.byteLength : 0;
  const buf = new ArrayBuffer(8 + dataLen);
  const view = new DataView(buf);

  view.setUint32(0, status, true);
  view.setUint32(4, dataLen, true);

  if (data) {
    new Uint8Array(buf).set(data, 8);
  }

  return buf;
}

/**
 * Decode a response ArrayBuffer.
 */
export function decodeResponse(buf: ArrayBuffer): {
  status: number;
  data: Uint8Array | null;
} {
  const view = new DataView(buf);
  const status = view.getUint32(0, true);
  const dataLen = view.getUint32(4, true);

  const data = dataLen > 0
    ? new Uint8Array(buf, 8, dataLen)
    : null;

  return { status, data };
}

/**
 * Encode a two-path request (rename, copy, symlink, link).
 * Data payload contains: [pathLen2:u32] [path2 bytes]
 */
export function encodeTwoPathRequest(
  op: number,
  path1: string,
  path2: string,
  flags: number = 0
): ArrayBuffer {
  const path2Bytes = encoder.encode(path2);
  const payload = new Uint8Array(4 + path2Bytes.byteLength);
  const pv = new DataView(payload.buffer);
  pv.setUint32(0, path2Bytes.byteLength, true);
  payload.set(path2Bytes, 4);

  return encodeRequest(op, path1, flags, payload);
}

/**
 * Decode the second path from a two-path request's data payload.
 */
export function decodeSecondPath(data: Uint8Array): string {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const pathLen = view.getUint32(0, true);
  return decoder.decode(data.subarray(4, 4 + pathLen));
}
