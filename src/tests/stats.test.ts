/**
 * Stats Decoding Tests
 */

import { describe, it, expect } from 'vitest';
import { decodeStats, decodeNames, decodeDirents } from '../src/stats.js';
import { INODE_TYPE } from '../src/vfs/layout.js';

describe('Stats', () => {
  describe('decodeStats', () => {
    it('should decode a file stat', () => {
      const buf = new Uint8Array(49);
      const view = new DataView(buf.buffer);
      view.setUint8(0, INODE_TYPE.FILE);
      view.setUint32(1, 0o100644, true);
      view.setFloat64(5, 1024, true);      // size
      view.setFloat64(13, 1700000000000, true); // mtime
      view.setFloat64(21, 1700000000000, true); // ctime
      view.setFloat64(29, 1700000000000, true); // atime
      view.setUint32(37, 0, true);          // uid
      view.setUint32(41, 0, true);          // gid
      view.setUint32(45, 42, true);         // ino

      const stats = decodeStats(buf);
      expect(stats.isFile()).toBe(true);
      expect(stats.isDirectory()).toBe(false);
      expect(stats.isSymbolicLink()).toBe(false);
      expect(stats.size).toBe(1024);
      expect(stats.mode).toBe(0o100644);
      expect(stats.ino).toBe(42);
      expect(stats.mtime).toBeInstanceOf(Date);
    });

    it('should decode a directory stat', () => {
      const buf = new Uint8Array(49);
      const view = new DataView(buf.buffer);
      view.setUint8(0, INODE_TYPE.DIRECTORY);
      view.setUint32(1, 0o040755, true);

      const stats = decodeStats(buf);
      expect(stats.isDirectory()).toBe(true);
      expect(stats.isFile()).toBe(false);
    });

    it('should decode a symlink stat', () => {
      const buf = new Uint8Array(49);
      const view = new DataView(buf.buffer);
      view.setUint8(0, INODE_TYPE.SYMLINK);
      view.setUint32(1, 0o120777, true);

      const stats = decodeStats(buf);
      expect(stats.isSymbolicLink()).toBe(true);
    });
  });

  describe('decodeNames', () => {
    it('should decode name list', () => {
      const encoder = new TextEncoder();
      const names = ['file.txt', 'dir', 'other.js'];

      let totalSize = 4;
      const encoded = names.map(n => {
        const bytes = encoder.encode(n);
        totalSize += 2 + bytes.byteLength;
        return bytes;
      });

      const buf = new Uint8Array(totalSize);
      const view = new DataView(buf.buffer);
      view.setUint32(0, names.length, true);
      let offset = 4;

      for (const bytes of encoded) {
        view.setUint16(offset, bytes.byteLength, true);
        offset += 2;
        buf.set(bytes, offset);
        offset += bytes.byteLength;
      }

      const result = decodeNames(buf);
      expect(result).toEqual(names);
    });

    it('should handle empty list', () => {
      const buf = new Uint8Array(4);
      new DataView(buf.buffer).setUint32(0, 0, true);
      expect(decodeNames(buf)).toEqual([]);
    });
  });

  describe('decodeDirents', () => {
    it('should decode dirent list', () => {
      const encoder = new TextEncoder();
      const entries = [
        { name: 'file.txt', type: INODE_TYPE.FILE },
        { name: 'dir', type: INODE_TYPE.DIRECTORY },
      ];

      let totalSize = 4;
      const encoded = entries.map(e => {
        const bytes = encoder.encode(e.name);
        totalSize += 2 + bytes.byteLength + 1;
        return { bytes, type: e.type };
      });

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

      const result = decodeDirents(buf);
      expect(result.length).toBe(2);
      expect(result[0].name).toBe('file.txt');
      expect(result[0].isFile()).toBe(true);
      expect(result[1].name).toBe('dir');
      expect(result[1].isDirectory()).toBe(true);
    });
  });
});
