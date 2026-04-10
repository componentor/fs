/**
 * Stats nanosecond timestamp fields and dev/rdev tests.
 */

import { describe, it, expect } from 'vitest';
import { decodeStats } from '../src/stats.js';
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

describe('Stats fields: nanosecond timestamps and dev/rdev', () => {
  it('has atimeNs, mtimeNs, ctimeNs, birthtimeNs as numbers', () => {
    const stats = decodeStats(FILE_BUF);
    expect(typeof stats.atimeNs).toBe('number');
    expect(typeof stats.mtimeNs).toBe('number');
    expect(typeof stats.ctimeNs).toBe('number');
    expect(typeof stats.birthtimeNs).toBe('number');
  });

  it('nanosecond fields equal millisecond fields * 1_000_000', () => {
    const stats = decodeStats(FILE_BUF);
    expect(stats.atimeNs).toBe(stats.atimeMs * 1_000_000);
    expect(stats.mtimeNs).toBe(stats.mtimeMs * 1_000_000);
    expect(stats.ctimeNs).toBe(stats.ctimeMs * 1_000_000);
    expect(stats.birthtimeNs).toBe(stats.birthtimeMs * 1_000_000);
  });

  it('nanosecond fields have expected absolute values', () => {
    const stats = decodeStats(FILE_BUF);
    const expectedNs = 1700000000000 * 1_000_000;
    expect(stats.atimeNs).toBe(expectedNs);
    expect(stats.mtimeNs).toBe(expectedNs);
    expect(stats.ctimeNs).toBe(expectedNs);
    expect(stats.birthtimeNs).toBe(expectedNs);
  });

  it('dev is non-zero', () => {
    const stats = decodeStats(FILE_BUF);
    expect(stats.dev).not.toBe(0);
  });

  it('dev is consistent across file and directory stats', () => {
    const fileStats = decodeStats(FILE_BUF);
    const dirStats = decodeStats(DIR_BUF);
    expect(fileStats.dev).toBe(dirStats.dev);
  });

  it('rdev is 0 for regular files', () => {
    const stats = decodeStats(FILE_BUF);
    expect(stats.rdev).toBe(0);
  });

  it('rdev is 0 for directories', () => {
    const stats = decodeStats(DIR_BUF);
    expect(stats.rdev).toBe(0);
  });
});
