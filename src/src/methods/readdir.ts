import type { ReaddirOptions, Encoding, Dirent } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';
import { decodeDirents, decodeNames } from '../stats.js';

const textEncoder = new TextEncoder();

function namesToBuffers(names: string[]): Uint8Array[] {
  return names.map(n => textEncoder.encode(n));
}

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
  withFileTypes: boolean,
  rootPath?: string
): (string | Dirent)[] {
  // Always read dirents so we can detect directories
  const entries = readdirBaseSync(syncRequest, basePath, true) as Dirent[];
  const results: (string | Dirent)[] = [];
  const effectiveRoot = rootPath ?? basePath;

  for (const entry of entries) {
    const relativePath = prefix ? prefix + '/' + entry.name : entry.name;

    if (withFileTypes) {
      const parentPath = prefix || effectiveRoot;
      // Return a Dirent with the relative path as the name
      results.push({
        name: relativePath,
        parentPath,
        path: parentPath,
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
        ...readdirRecursiveSync(syncRequest, childPath, relativePath, withFileTypes, effectiveRoot)
      );
    }
  }

  return results;
}

async function readdirRecursiveAsync(
  asyncRequest: AsyncRequestFn,
  basePath: string,
  prefix: string,
  withFileTypes: boolean,
  rootPath?: string
): Promise<(string | Dirent)[]> {
  const entries = (await readdirBaseAsync(asyncRequest, basePath, true)) as Dirent[];
  const results: (string | Dirent)[] = [];
  const effectiveRoot = rootPath ?? basePath;

  for (const entry of entries) {
    const relativePath = prefix ? prefix + '/' + entry.name : entry.name;

    if (withFileTypes) {
      const parentPath = prefix || effectiveRoot;
      results.push({
        name: relativePath,
        parentPath,
        path: parentPath,
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
        asyncRequest, childPath, relativePath, withFileTypes, effectiveRoot
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
): string[] | Uint8Array[] | Dirent[] {
  const opts = typeof options === 'string' ? { encoding: options } : options;
  const asBuffer = opts?.encoding === 'buffer';

  if (opts?.recursive) {
    const result = readdirRecursiveSync(
      syncRequest, filePath, '', !!opts?.withFileTypes
    );
    if (asBuffer && !opts?.withFileTypes) {
      return namesToBuffers(result as string[]);
    }
    return result as string[] | Dirent[];
  }

  const result = readdirBaseSync(syncRequest, filePath, !!opts?.withFileTypes);
  if (asBuffer && !opts?.withFileTypes) {
    return namesToBuffers(result as string[]);
  }
  return result;
}

export async function readdir(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: ReaddirOptions | Encoding | null
): Promise<string[] | Uint8Array[] | Dirent[]> {
  const opts = typeof options === 'string' ? { encoding: options } : options;
  const asBuffer = opts?.encoding === 'buffer';

  if (opts?.recursive) {
    const result = await readdirRecursiveAsync(
      asyncRequest, filePath, '', !!opts?.withFileTypes
    );
    if (asBuffer && !opts?.withFileTypes) {
      return namesToBuffers(result as string[]);
    }
    return result as string[] | Dirent[];
  }

  const result = await readdirBaseAsync(asyncRequest, filePath, !!opts?.withFileTypes);
  if (asBuffer && !opts?.withFileTypes) {
    return namesToBuffers(result as string[]);
  }
  return result;
}
