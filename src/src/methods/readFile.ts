import type { ReadOptions, Encoding } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';
import { parseFlags, openSync, closeSync, readSync, open } from './open.js';
import { decodeBuffer } from '../encoding.js';

const decoder = new TextDecoder();

export function readFileSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  options?: ReadOptions | Encoding | null
): string | Uint8Array {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const flag = typeof options === 'string' ? undefined : options?.flag;

  // Fast path: default flag or no flag specified
  if (!flag || flag === 'r') {
    const buf = encodeRequest(OP.READ, filePath);
    const { status, data } = syncRequest(buf);
    if (status !== 0) throw statusToError(status, 'read', filePath);
    const result = data ?? new Uint8Array(0);
    if (encoding) return decodeBuffer(result, encoding);
    return result;
  }

  // Non-default flag: use fd-based open → read → close
  const fd = openSync(syncRequest, filePath, flag);
  try {
    // Read in chunks until EOF
    const chunks: Uint8Array[] = [];
    let totalRead = 0;
    const chunkSize = 64 * 1024;
    while (true) {
      const chunk = new Uint8Array(chunkSize);
      const bytesRead = readSync(syncRequest, fd, chunk, 0, chunkSize, totalRead);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      totalRead += bytesRead;
      if (bytesRead < chunkSize) break;
    }
    let result: Uint8Array;
    if (chunks.length === 0) {
      result = new Uint8Array(0);
    } else if (chunks.length === 1) {
      result = chunks[0];
    } else {
      result = new Uint8Array(totalRead);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
    }
    if (encoding) return decodeBuffer(result, encoding);
    return result;
  } finally {
    closeSync(syncRequest, fd);
  }
}

export async function readFile(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: ReadOptions | Encoding | null
): Promise<string | Uint8Array> {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const flag = typeof options === 'string' ? undefined : options?.flag;

  // Fast path: default flag or no flag specified
  if (!flag || flag === 'r') {
    const { status, data } = await asyncRequest(OP.READ, filePath);
    if (status !== 0) throw statusToError(status, 'read', filePath);
    const result = data ?? new Uint8Array(0);
    if (encoding) return decodeBuffer(result, encoding);
    return result;
  }

  // Non-default flag: use FileHandle-based open → readFile → close
  const handle = await open(asyncRequest, filePath, flag);
  try {
    const result = await handle.readFile(encoding ? encoding : undefined);
    return result;
  } finally {
    await handle.close();
  }
}
