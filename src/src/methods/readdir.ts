import type { ReaddirOptions, Encoding, Dirent } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';
import { decodeDirents, decodeNames } from '../stats.js';

function readdirBaseSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  withFileTypes: boolean
): string[] | Dirent[] {
  const flags = withFileTypes ? 1 : 0;
  const buf = encodeRequest(OP.READDIR, filePath, flags);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'readdir', filePath);
  if (!data) return [];
  return withFileTypes ? decodeDirents(data, filePath) : decodeNames(data);
}

async function readdirBaseAsync(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  withFileTypes: boolean
): Promise<string[] | Dirent[]> {
  const flags = withFileTypes ? 1 : 0;
  const { status, data } = await asyncRequest(OP.READDIR, filePath, flags);
  if (status !== 0) throw statusToError(status, 'readdir', filePath);
  if (!data) return [];
  return withFileTypes ? decodeDirents(data, filePath) : decodeNames(data);
}

function readdirRecursiveSync(
  syncRequest: SyncRequestFn,
  basePath: string,
  prefix: string,
  withFileTypes: boolean
): (string | Dirent)[] {
  // Always read dirents so we can detect directories
  const entries = readdirBaseSync(syncRequest, basePath, true) as Dirent[];
  const results: (string | Dirent)[] = [];

  for (const entry of entries) {
    const relativePath = prefix ? prefix + '/' + entry.name : entry.name;

    if (withFileTypes) {
      // Return a Dirent with the relative path as the name
      results.push({
        name: relativePath,
        isFile: entry.isFile,
        isDirectory: entry.isDirectory,
        isBlockDevice: entry.isBlockDevice,
        isCharacterDevice: entry.isCharacterDevice,
        isSymbolicLink: entry.isSymbolicLink,
        isFIFO: entry.isFIFO,
        isSocket: entry.isSocket,
      });
    } else {
      results.push(relativePath);
    }

    if (entry.isDirectory()) {
      const childPath = basePath + '/' + entry.name;
      results.push(
        ...readdirRecursiveSync(syncRequest, childPath, relativePath, withFileTypes)
      );
    }
  }

  return results;
}

async function readdirRecursiveAsync(
  asyncRequest: AsyncRequestFn,
  basePath: string,
  prefix: string,
  withFileTypes: boolean
): Promise<(string | Dirent)[]> {
  const entries = (await readdirBaseAsync(asyncRequest, basePath, true)) as Dirent[];
  const results: (string | Dirent)[] = [];

  for (const entry of entries) {
    const relativePath = prefix ? prefix + '/' + entry.name : entry.name;

    if (withFileTypes) {
      results.push({
        name: relativePath,
        isFile: entry.isFile,
        isDirectory: entry.isDirectory,
        isBlockDevice: entry.isBlockDevice,
        isCharacterDevice: entry.isCharacterDevice,
        isSymbolicLink: entry.isSymbolicLink,
        isFIFO: entry.isFIFO,
        isSocket: entry.isSocket,
      });
    } else {
      results.push(relativePath);
    }

    if (entry.isDirectory()) {
      const childPath = basePath + '/' + entry.name;
      const children = await readdirRecursiveAsync(
        asyncRequest, childPath, relativePath, withFileTypes
      );
      results.push(...children);
    }
  }

  return results;
}

export function readdirSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  options?: ReaddirOptions | Encoding | null
): string[] | Dirent[] {
  const opts = typeof options === 'string' ? { encoding: options } : options;

  if (opts?.recursive) {
    return readdirRecursiveSync(
      syncRequest, filePath, '', !!opts?.withFileTypes
    ) as string[] | Dirent[];
  }

  return readdirBaseSync(syncRequest, filePath, !!opts?.withFileTypes);
}

export async function readdir(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: ReaddirOptions | Encoding | null
): Promise<string[] | Dirent[]> {
  const opts = typeof options === 'string' ? { encoding: options } : options;

  if (opts?.recursive) {
    return readdirRecursiveAsync(
      asyncRequest, filePath, '', !!opts?.withFileTypes
    ) as Promise<string[] | Dirent[]>;
  }

  return readdirBaseAsync(asyncRequest, filePath, !!opts?.withFileTypes);
}
