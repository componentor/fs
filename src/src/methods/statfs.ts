import type { StatFs } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';

/**
 * Decode the engine's volume statistics.
 *
 * Payload: `[type u32][bsize u32][blocks u32][bfree u32][files u32][ffree u32]`.
 *
 * `bavail` mirrors `bfree`: there is no reserved-for-root notion here, so the blocks a caller
 * may use are exactly the free ones.
 */
function decodeStatFs(data: Uint8Array): StatFs {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const bfree = dv.getUint32(12, true);
  return {
    type: dv.getUint32(0, true),
    bsize: dv.getUint32(4, true),
    blocks: dv.getUint32(8, true),
    bfree,
    bavail: bfree,
    files: dv.getUint32(16, true),
    ffree: dv.getUint32(20, true),
  };
}

export function statfsSync(syncRequest: SyncRequestFn, path = '/'): StatFs {
  const { status, data } = syncRequest(encodeRequest(OP.STATFS, path));
  if (status !== 0) throw statusToError(status, 'statfs', path);
  return decodeStatFs(data!);
}

export async function statfs(asyncRequest: AsyncRequestFn, path = '/'): Promise<StatFs> {
  const { status, data } = await asyncRequest(OP.STATFS, path);
  if (status !== 0) throw statusToError(status, 'statfs', path);
  return decodeStatFs(data!);
}
