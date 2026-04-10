/**
 * BigIntStats Decoding Tests
 */

import { describe, it, expect } from 'vitest';
import { decodeStats, decodeStatsBigInt } from '../src/stats.js';
import { INODE_TYPE } from '../src/vfs/layout.js';

function makeStatBuffer(opts: {
  type: number;
  mode: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  atimeMs: number;
  uid: number;
  gid: number;
  ino: number;
}): Uint8Array {
  const buf = new Uint8Array(49);
  const view = new DataView(buf.buffer);
  view.setUint8(0, opts.type);
  view.setUint32(1, opts.mode, true);
  view.setFloat64(5, opts.size, true);
  view.setFloat64(13, opts.mtimeMs, true);
  view.setFloat64(21, opts.ctimeMs, true);
  view.setFloat64(29, opts.atimeMs, true);
  view.setUint32(37, opts.uid, true);
  view.setUint32(41, opts.gid, true);
  view.setUint32(45, opts.ino, true);
  return buf;
}

const FILE_BUF = makeStatBuffer({
  type: INODE_TYPE.FILE,
  mode: 0o100644,
  size: 1024,
  mtimeMs: 1700000000000,
  ctimeMs: 1700000000000,
  atimeMs: 1700000000000,
  uid: 1000,
  gid: 1000,
  ino: 42,
});

const DIR_BUF = makeStatBuffer({
  type: INODE_TYPE.DIRECTORY,
  mode: 0o040755,
  size: 4096,
  mtimeMs: 1700000000000,
  ctimeMs: 1700000000000,
  atimeMs: 1700000000000,
  uid: 0,
  gid: 0,
  ino: 2,
});

const SYMLINK_BUF = makeStatBuffer({
  type: INODE_TYPE.SYMLINK,
  mode: 0o120777,
  size: 10,
  mtimeMs: 1700000000000,
  ctimeMs: 1700000000000,
  atimeMs: 1700000000000,
  uid: 0,
  gid: 0,
  ino: 99,
});

describe('BigIntStats', () => {
  describe('decodeStats without bigint returns number-based Stats', () => {
    it('should return number values', () => {
      const stats = decodeStats(FILE_BUF);
      expect(typeof stats.size).toBe('number');
      expect(typeof stats.ino).toBe('number');
      expect(typeof stats.mode).toBe('number');
      expect(typeof stats.mtimeMs).toBe('number');
      expect(stats.size).toBe(1024);
    });
  });

  describe('decodeStatsBigInt returns BigInt-based stats', () => {
    it('should return BigInt values for numeric fields', () => {
      const stats = decodeStatsBigInt(FILE_BUF);
      expect(typeof stats.size).toBe('bigint');
      expect(typeof stats.ino).toBe('bigint');
      expect(typeof stats.mode).toBe('bigint');
      expect(typeof stats.uid).toBe('bigint');
      expect(typeof stats.gid).toBe('bigint');
      expect(typeof stats.dev).toBe('bigint');
      expect(typeof stats.rdev).toBe('bigint');
      expect(typeof stats.nlink).toBe('bigint');
      expect(typeof stats.blksize).toBe('bigint');
      expect(typeof stats.blocks).toBe('bigint');
    });

    it('size is a bigint with correct value', () => {
      const stats = decodeStatsBigInt(FILE_BUF);
      expect(stats.size).toBe(1024n);
    });

    it('ino, mode, uid, gid have correct values', () => {
      const stats = decodeStatsBigInt(FILE_BUF);
      expect(stats.ino).toBe(42n);
      expect(stats.mode).toBe(BigInt(0o100644));
      expect(stats.uid).toBe(1000n);
      expect(stats.gid).toBe(1000n);
    });

    it('has atimeNs, mtimeNs, ctimeNs, birthtimeNs as bigint', () => {
      const stats = decodeStatsBigInt(FILE_BUF);
      expect(typeof stats.atimeNs).toBe('bigint');
      expect(typeof stats.mtimeNs).toBe('bigint');
      expect(typeof stats.ctimeNs).toBe('bigint');
      expect(typeof stats.birthtimeNs).toBe('bigint');
    });

    it('nanosecond timestamps are milliseconds * 1_000_000', () => {
      const stats = decodeStatsBigInt(FILE_BUF);
      expect(stats.atimeNs).toBe(1700000000000n * 1_000_000n);
      expect(stats.mtimeNs).toBe(1700000000000n * 1_000_000n);
      expect(stats.ctimeNs).toBe(1700000000000n * 1_000_000n);
      expect(stats.birthtimeNs).toBe(1700000000000n * 1_000_000n);
    });

    it('millisecond timestamps are bigint', () => {
      const stats = decodeStatsBigInt(FILE_BUF);
      expect(typeof stats.atimeMs).toBe('bigint');
      expect(typeof stats.mtimeMs).toBe('bigint');
      expect(typeof stats.ctimeMs).toBe('bigint');
      expect(typeof stats.birthtimeMs).toBe('bigint');
      expect(stats.mtimeMs).toBe(1700000000000n);
    });

    it('Date fields are still Date objects', () => {
      const stats = decodeStatsBigInt(FILE_BUF);
      expect(stats.atime).toBeInstanceOf(Date);
      expect(stats.mtime).toBeInstanceOf(Date);
      expect(stats.ctime).toBeInstanceOf(Date);
      expect(stats.birthtime).toBeInstanceOf(Date);
    });
  });

  describe('BigIntStats methods return boolean', () => {
    it('isFile returns boolean true for files', () => {
      const stats = decodeStatsBigInt(FILE_BUF);
      expect(stats.isFile()).toBe(true);
      expect(stats.isDirectory()).toBe(false);
      expect(stats.isSymbolicLink()).toBe(false);
    });

    it('isDirectory returns boolean true for directories', () => {
      const stats = decodeStatsBigInt(DIR_BUF);
      expect(stats.isDirectory()).toBe(true);
      expect(stats.isFile()).toBe(false);
    });

    it('isSymbolicLink returns boolean true for symlinks', () => {
      const stats = decodeStatsBigInt(SYMLINK_BUF);
      expect(stats.isSymbolicLink()).toBe(true);
      expect(stats.isFile()).toBe(false);
      expect(stats.isDirectory()).toBe(false);
    });

    it('utility methods return false as expected', () => {
      const stats = decodeStatsBigInt(FILE_BUF);
      expect(stats.isBlockDevice()).toBe(false);
      expect(stats.isCharacterDevice()).toBe(false);
      expect(stats.isFIFO()).toBe(false);
      expect(stats.isSocket()).toBe(false);
    });
  });
});
