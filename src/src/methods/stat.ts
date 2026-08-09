import type { Stats, BigIntStats, StatOptions } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';
import { decodeStats, decodeStatsBigInt } from '../stats.js';
import { CODE_TO_STATUS } from '../errors.js';

/**
 * Node's `throwIfNoEntry: false` turns a missing path into `undefined` rather than a throw.
 *
 * Only ENOENT is suppressed — a path that fails for any other reason (ENOTDIR on a non-directory
 * component, ELOOP on a symlink cycle) still throws, so this cannot mask a real problem as
 * "not there".
 */
function suppressesMissing(options: StatOptions | undefined, status: number): boolean {
  return options?.throwIfNoEntry === false && status === CODE_TO_STATUS.ENOENT;
}

export function statSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  options?: StatOptions & { throwIfNoEntry?: true }
): Stats | BigIntStats;
export function statSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  options: StatOptions & { throwIfNoEntry: false }
): Stats | BigIntStats | undefined;
export function statSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  options?: StatOptions
): Stats | BigIntStats | undefined {
  const buf = encodeRequest(OP.STAT, filePath);
  const { status, data } = syncRequest(buf);
  if (status !== 0) {
    if (suppressesMissing(options, status)) return undefined;
    throw statusToError(status, 'stat', filePath);
  }
  return options?.bigint ? decodeStatsBigInt(data!) : decodeStats(data!);
}

export function lstatSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  options?: StatOptions & { throwIfNoEntry?: true }
): Stats | BigIntStats;
export function lstatSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  options: StatOptions & { throwIfNoEntry: false }
): Stats | BigIntStats | undefined;
export function lstatSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  options?: StatOptions
): Stats | BigIntStats | undefined {
  const buf = encodeRequest(OP.LSTAT, filePath);
  const { status, data } = syncRequest(buf);
  if (status !== 0) {
    if (suppressesMissing(options, status)) return undefined;
    throw statusToError(status, 'lstat', filePath);
  }
  return options?.bigint ? decodeStatsBigInt(data!) : decodeStats(data!);
}

export function stat(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: StatOptions & { throwIfNoEntry?: true }
): Promise<Stats | BigIntStats>;
export function stat(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options: StatOptions & { throwIfNoEntry: false }
): Promise<Stats | BigIntStats | undefined>;
export async function stat(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: StatOptions
): Promise<Stats | BigIntStats | undefined> {
  const { status, data } = await asyncRequest(OP.STAT, filePath);
  if (status !== 0) {
    if (suppressesMissing(options, status)) return undefined;
    throw statusToError(status, 'stat', filePath);
  }
  return options?.bigint ? decodeStatsBigInt(data!) : decodeStats(data!);
}

export function lstat(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: StatOptions & { throwIfNoEntry?: true }
): Promise<Stats | BigIntStats>;
export function lstat(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options: StatOptions & { throwIfNoEntry: false }
): Promise<Stats | BigIntStats | undefined>;
export async function lstat(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: StatOptions
): Promise<Stats | BigIntStats | undefined> {
  const { status, data } = await asyncRequest(OP.LSTAT, filePath);
  if (status !== 0) {
    if (suppressesMissing(options, status)) return undefined;
    throw statusToError(status, 'lstat', filePath);
  }
  return options?.bigint ? decodeStatsBigInt(data!) : decodeStats(data!);
}
