/**
 * Dirent parentPath / path property tests
 */

import { describe, it, expect } from 'vitest';
import { decodeDirents } from '../src/stats.js';
import { INODE_TYPE } from '../src/vfs/layout.js';

/** Helper: encode a list of {name, type} entries into the binary readdir format. */
function encodeDirents(entries: { name: string; type: number }[]): Uint8Array {
  const encoder = new TextEncoder();
  const encoded = entries.map(e => ({ bytes: encoder.encode(e.name), type: e.type }));
  let totalSize = 4;
  for (const { bytes } of encoded) totalSize += 2 + bytes.byteLength + 1;

  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);
  view.setUint32(0, entries.length, true);
  let offset = 4;
  for (const { bytes, type } of encoded) {
    view.setUint16(offset, bytes.byteLength, true);
    offset += 2;
    buf.set(bytes, offset);
    offset += bytes.byteLength;
    buf[offset++] = type;
  }
  return buf;
}

describe('Dirent parentPath / path', () => {
  const entries = [
    { name: 'file.txt', type: INODE_TYPE.FILE },
    { name: 'subdir', type: INODE_TYPE.DIRECTORY },
  ];

  it('should set parentPath to the directory that was read', () => {
    const buf = encodeDirents(entries);
    const dirents = decodeDirents(buf, '/home/user/docs');
    for (const d of dirents) {
      expect(d.parentPath).toBe('/home/user/docs');
    }
  });

  it('should set path as a deprecated alias equal to parentPath', () => {
    const buf = encodeDirents(entries);
    const dirents = decodeDirents(buf, '/home/user/docs');
    for (const d of dirents) {
      expect(d.path).toBe(d.parentPath);
    }
  });

  it('should work for root directory', () => {
    const buf = encodeDirents([{ name: 'etc', type: INODE_TYPE.DIRECTORY }]);
    const dirents = decodeDirents(buf, '/');
    expect(dirents[0].parentPath).toBe('/');
    expect(dirents[0].path).toBe('/');
  });

  it('should work for nested directories', () => {
    const buf = encodeDirents([{ name: 'data.json', type: INODE_TYPE.FILE }]);
    const dirents = decodeDirents(buf, '/a/b/c/d');
    expect(dirents[0].parentPath).toBe('/a/b/c/d');
    expect(dirents[0].path).toBe('/a/b/c/d');
  });

  it('should default parentPath to empty string when not provided', () => {
    const buf = encodeDirents([{ name: 'x', type: INODE_TYPE.FILE }]);
    const dirents = decodeDirents(buf);
    expect(dirents[0].parentPath).toBe('');
    expect(dirents[0].path).toBe('');
  });
});
