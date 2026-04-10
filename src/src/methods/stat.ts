import type { Stats, BigIntStats, StatOptions } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';
import { decodeStats, decodeStatsBigInt } from '../stats.js';

export function statSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  options?: StatOptions
): Stats | BigIntStats {
  const buf = encodeRequest(OP.STAT, filePath);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'stat', filePath);
  return options?.bigint ? decodeStatsBigInt(data!) : decodeStats(data!);
}

export function lstatSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  options?: StatOptions
): Stats | BigIntStats {
  const buf = encodeRequest(OP.LSTAT, filePath);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'lstat', filePath);
  return options?.bigint ? decodeStatsBigInt(data!) : decodeStats(data!);
}

export async function stat(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: StatOptions
): Promise<Stats | BigIntStats> {
  const { status, data } = await asyncRequest(OP.STAT, filePath);
  if (status !== 0) throw statusToError(status, 'stat', filePath);
  return options?.bigint ? decodeStatsBigInt(data!) : decodeStats(data!);
}

export async function lstat(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: StatOptions
): Promise<Stats | BigIntStats> {
  const { status, data } = await asyncRequest(OP.LSTAT, filePath);
  if (status !== 0) throw statusToError(status, 'lstat', filePath);
  return options?.bigint ? decodeStatsBigInt(data!) : decodeStats(data!);
}
