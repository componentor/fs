import type { ReaddirOptions, Encoding, Dirent } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequest } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';
import { normalizeEncoding, assertEncoding, encodeString, decodeBuffer } from '../encoding.js';
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

/**
 * Resolve readdir's `encoding`. 'buffer' asks for raw name bytes; anything else must be a real
 * encoding — Node throws ERR_INVALID_ARG_VALUE on a typo rather than quietly returning UTF-8.
 * Returns the canonical encoding to re-decode names with, or null to keep the UTF-8 strings.
 */
function resolveNameEncoding(encoding: unknown): 'buffer' | string | null {
  if (encoding === undefined || encoding === null || encoding === 'buffer') {
    return encoding === 'buffer' ? 'buffer' : null;
  }
  const canonical = assertEncoding(encoding);
  return canonical === 'utf8' ? null : canonical;
}

/** Re-decode UTF-8 names into the requested encoding, as Node does from the raw bytes. */
function recodeNames(names: string[], encoding: string): string[] {
  return names.map(n => decodeBuffer(encodeString(n, 'utf8'), encoding));
}

export function readdirSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  options?: ReaddirOptions | Encoding | null
): string[] | Uint8Array[] | Dirent[] {
  const opts = typeof options === 'string' ? { encoding: options } : options;
  const nameEncoding = resolveNameEncoding(opts?.encoding);
  const recode = (names: (string | Dirent)[]): string[] | Uint8Array[] | Dirent[] => {
    if (opts?.withFileTypes || nameEncoding === null) return names as string[] | Dirent[];
    if (nameEncoding === 'buffer') return namesToBuffers(names as string[]);
    return recodeNames(names as string[], nameEncoding);
  };

  if (opts?.recursive) {
    return recode(readdirRecursiveSync(syncRequest, filePath, '', !!opts?.withFileTypes));
  }
  return recode(readdirBaseSync(syncRequest, filePath, !!opts?.withFileTypes));
}

export async function readdir(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: ReaddirOptions | Encoding | null
): Promise<string[] | Uint8Array[] | Dirent[]> {
  const opts = typeof options === 'string' ? { encoding: options } : options;
  const nameEncoding = resolveNameEncoding(opts?.encoding);
  const recode = (names: (string | Dirent)[]): string[] | Uint8Array[] | Dirent[] => {
    if (opts?.withFileTypes || nameEncoding === null) return names as string[] | Dirent[];
    if (nameEncoding === 'buffer') return namesToBuffers(names as string[]);
    return recodeNames(names as string[], nameEncoding);
  };

  if (opts?.recursive) {
    return recode(await readdirRecursiveAsync(asyncRequest, filePath, '', !!opts?.withFileTypes));
  }
  return recode(await readdirBaseAsync(asyncRequest, filePath, !!opts?.withFileTypes));
}
