/**
 * Stats and Dirent object construction.
 * Decodes binary stat responses from the server into Node.js-compatible objects.
 */

import type { Stats, Dirent } from './types.js';
import { INODE_TYPE } from './vfs/layout.js';

/**
 * Decode a binary stat response (49 bytes) into a Stats object.
 *
 * Format:
 *   byte 0:    type (uint8)
 *   bytes 1-4: mode (uint32)
 *   bytes 5-12: size (float64)
 *   bytes 13-20: mtime (float64)
 *   bytes 21-28: ctime (float64)
 *   bytes 29-36: atime (float64)
 *   bytes 37-40: uid (uint32)
 *   bytes 41-44: gid (uint32)
 *   bytes 45-48: ino (uint32)
 */
export function decodeStats(data: Uint8Array): Stats {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const type = view.getUint8(0);
  const mode = view.getUint32(1, true);
  const size = view.getFloat64(5, true);
  const mtimeMs = view.getFloat64(13, true);
  const ctimeMs = view.getFloat64(21, true);
  const atimeMs = view.getFloat64(29, true);
  const uid = view.getUint32(37, true);
  const gid = view.getUint32(41, true);
  const ino = view.getUint32(45, true);

  const isFile = type === INODE_TYPE.FILE;
  const isDirectory = type === INODE_TYPE.DIRECTORY;
  const isSymlink = type === INODE_TYPE.SYMLINK;

  return {
    isFile: () => isFile,
    isDirectory: () => isDirectory,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => isSymlink,
    isFIFO: () => false,
    isSocket: () => false,
    dev: 0,
    ino,
    mode,
    nlink: 1,
    uid,
    gid,
    rdev: 0,
    size,
    blksize: 4096,
    blocks: Math.ceil(size / 512),
    atimeMs,
    mtimeMs,
    ctimeMs,
    birthtimeMs: ctimeMs,
    atime: new Date(atimeMs),
    mtime: new Date(mtimeMs),
    ctime: new Date(ctimeMs),
    birthtime: new Date(ctimeMs),
  };
}

/**
 * Decode a readdir response with file types.
 *
 * Format:
 *   bytes 0-3: count (uint32)
 *   Then for each entry:
 *     bytes 0-1: nameLen (uint16)
 *     bytes 2+: name (UTF-8)
 *     byte after name: type (uint8)
 */
export function decodeDirents(data: Uint8Array): Dirent[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(0, true);
  const decoder = new TextDecoder();
  const entries: Dirent[] = [];
  let offset = 4;

  for (let i = 0; i < count; i++) {
    const nameLen = view.getUint16(offset, true);
    offset += 2;
    const name = decoder.decode(data.subarray(offset, offset + nameLen));
    offset += nameLen;
    const type = data[offset++];

    const isFile = type === INODE_TYPE.FILE;
    const isDirectory = type === INODE_TYPE.DIRECTORY;
    const isSymlink = type === INODE_TYPE.SYMLINK;

    entries.push({
      name,
      isFile: () => isFile,
      isDirectory: () => isDirectory,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isSymbolicLink: () => isSymlink,
      isFIFO: () => false,
      isSocket: () => false,
    });
  }

  return entries;
}

/**
 * Decode a simple readdir response (names only).
 *
 * Format:
 *   bytes 0-3: count (uint32)
 *   Then for each entry:
 *     bytes 0-1: nameLen (uint16)
 *     bytes 2+: name (UTF-8)
 */
export function decodeNames(data: Uint8Array): string[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(0, true);
  const decoder = new TextDecoder();
  const names: string[] = [];
  let offset = 4;

  for (let i = 0; i < count; i++) {
    const nameLen = view.getUint16(offset, true);
    offset += 2;
    names.push(decoder.decode(data.subarray(offset, offset + nameLen)));
    offset += nameLen;
  }

  return names;
}
