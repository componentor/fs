import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';
import { assertEncoding, decodeBuffer } from '../encoding.js';

/** Node's `fs.mkdtemp(prefix[, options])`; `'buffer'` returns the created path as raw bytes. */
type PathEncodingOptions = { encoding?: string | null } | string | null;

function decodePath(data: Uint8Array, options?: PathEncodingOptions): string | Uint8Array {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  if (encoding === 'buffer') return new Uint8Array(data);
  if (encoding === undefined || encoding === null) return decoder.decode(data);
  return decodeBuffer(data, assertEncoding(encoding));
}

const decoder = new TextDecoder();

export function mkdtempSync(
  syncRequest: SyncRequestFn,
  prefix: string,
  options?: PathEncodingOptions
): string | Uint8Array {
  const buf = encodeRequest(OP.MKDTEMP, prefix);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'mkdtemp', prefix);
  return decodePath(data!, options);
}

export async function mkdtemp(
  asyncRequest: AsyncRequestFn,
  prefix: string,
  options?: PathEncodingOptions
): Promise<string | Uint8Array> {
  const { status, data } = await asyncRequest(OP.MKDTEMP, prefix);
  if (status !== 0) throw statusToError(status, 'mkdtemp', prefix);
  return decodePath(data!, options);
}
