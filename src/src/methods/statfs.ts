import type { StatFs, BigIntStatFs, StatFsOptions } from '../types.js';
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
 *
 * `frsize` mirrors `bsize`. Node reports **eight** fields and this returned seven — `frsize` was
 * simply absent, so `statfs().frsize` was `undefined` and any arithmetic on it produced `NaN`.
 * On a real filesystem `frsize` is the fragment size and `bsize` the preferred I/O block size;
 * they are equal on every modern one, and the VFS has a single block size, so equal is also the
 * truthful answer here. Derived rather than added to the wire format, which keeps a bundle built
 * against an older worker working unchanged.
 */
function decodeStatFs(data: Uint8Array): StatFs {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const bfree = dv.getUint32(12, true);
  const bsize = dv.getUint32(4, true);
  return {
    type: dv.getUint32(0, true),
    bsize,
    frsize: bsize,
    blocks: dv.getUint32(8, true),
    bfree,
    bavail: bfree,
    files: dv.getUint32(16, true),
    ffree: dv.getUint32(20, true),
  };
}

/**
 * `{ bigint: true }` returns every field as a `bigint`, as node's does.
 *
 * The option was accepted and ignored, so `statfs(p, { bigint: true }).blocks` came back a
 * `number` — and mixing it with a real bigint throws `TypeError: Cannot mix BigInt and other
 * types`, which is a confusing way to learn the option did nothing.
 */
function asBigInt(s: StatFs): BigIntStatFs {
  const out = {} as Record<string, bigint>;
  for (const [k, v] of Object.entries(s)) out[k] = BigInt(Math.trunc(v as number));
  return out as unknown as BigIntStatFs;
}

export function statfsSync(syncRequest: SyncRequestFn, path = '/', options?: StatFsOptions): StatFs | BigIntStatFs {
  const { status, data } = syncRequest(encodeRequest(OP.STATFS, path));
  if (status !== 0) throw statusToError(status, 'statfs', path);
  const stats = decodeStatFs(data!);
  return options?.bigint ? asBigInt(stats) : stats;
}

export async function statfs(asyncRequest: AsyncRequestFn, path = '/', options?: StatFsOptions): Promise<StatFs | BigIntStatFs> {
  const { status, data } = await asyncRequest(OP.STATFS, path);
  if (status !== 0) throw statusToError(status, 'statfs', path);
  const stats = decodeStatFs(data!);
  return options?.bigint ? asBigInt(stats) : stats;
}
