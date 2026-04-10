import type { RmOptions } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';
import { FSError } from '../errors.js';

const RETRYABLE_CODES = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM']);

function isRetryable(e: unknown): boolean {
  return e instanceof FSError && RETRYABLE_CODES.has(e.code);
}

function rmSyncCore(
  syncRequest: SyncRequestFn,
  filePath: string,
  options?: RmOptions
): void {
  const flags = (options?.recursive ? 1 : 0) | (options?.force ? 2 : 0);
  const buf = encodeRequest(OP.UNLINK, filePath, flags);
  const { status } = syncRequest(buf);
  if (status === 3) {
    // EISDIR — it's a directory, use rmdir
    const rmdirBuf = encodeRequest(OP.RMDIR, filePath, flags);
    const rmdirResult = syncRequest(rmdirBuf);
    if (rmdirResult.status !== 0) {
      if (options?.force && rmdirResult.status === 1) return;
      throw statusToError(rmdirResult.status, 'rm', filePath);
    }
    return;
  }
  if (status !== 0) {
    if (options?.force && status === 1) return;
    throw statusToError(status, 'rm', filePath);
  }
}

export function rmSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  options?: RmOptions
): void {
  const maxRetries = options?.maxRetries ?? 0;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      rmSyncCore(syncRequest, filePath, options);
      return;
    } catch (e) {
      lastError = e;
      if (attempt < maxRetries && isRetryable(e)) {
        // For sync, we cannot delay without blocking APIs, so retry immediately.
        continue;
      }
      throw e;
    }
  }
  /* istanbul ignore next -- safety net; loop always throws or returns */
  throw lastError;
}

async function rmAsyncCore(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: RmOptions
): Promise<void> {
  const flags = (options?.recursive ? 1 : 0) | (options?.force ? 2 : 0);
  const { status } = await asyncRequest(OP.UNLINK, filePath, flags);
  if (status === 3) {
    const { status: s2 } = await asyncRequest(OP.RMDIR, filePath, flags);
    if (s2 !== 0) {
      if (options?.force && s2 === 1) return;
      throw statusToError(s2, 'rm', filePath);
    }
    return;
  }
  if (status !== 0) {
    if (options?.force && status === 1) return;
    throw statusToError(status, 'rm', filePath);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function rm(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: RmOptions
): Promise<void> {
  const maxRetries = options?.maxRetries ?? 0;
  const retryDelay = options?.retryDelay ?? 100;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await rmAsyncCore(asyncRequest, filePath, options);
      return;
    } catch (e) {
      lastError = e;
      if (attempt < maxRetries && isRetryable(e)) {
        await delay(retryDelay);
        continue;
      }
      throw e;
    }
  }
  /* istanbul ignore next -- safety net; loop always throws or returns */
  throw lastError;
}
