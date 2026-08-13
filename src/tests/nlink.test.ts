/**
 * nlink (hard link count) Tests
 *
 * Verifies that nlink is correctly tracked across link/unlink operations
 * and properly encoded in stat responses.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VFSEngine } from '../src/vfs/engine.js';
import { decodeStats } from '../src/stats.js';
import { INODE_TYPE } from '../src/vfs/layout.js';

/**
 * Mock FileSystemSyncAccessHandle backed by an ArrayBuffer.
 */
class MockSyncHandle {
  private buffer: Uint8Array;
  private size: number;

  constructor(initialSize: number = 0) {
    this.buffer = new Uint8Array(initialSize);
    this.size = initialSize;
  }

  getSize(): number {
    return this.size;
  }

  truncate(newSize: number): void {
    if (newSize > this.buffer.byteLength) {
      const newBuf = new Uint8Array(newSize);
      newBuf.set(this.buffer.subarray(0, this.size));
      this.buffer = newBuf;
    }
    this.size = newSize;
  }

  read(buf: Uint8Array, opts?: { at?: number }): number {
    const at = opts?.at ?? 0;
    const len = Math.min(buf.byteLength, this.size - at);
    if (len <= 0) return 0;
    buf.set(this.buffer.subarray(at, at + len));
    return len;
  }

  write(buf: Uint8Array, opts?: { at?: number }): number {
    const at = opts?.at ?? 0;
    const end = at + buf.byteLength;
    if (end > this.buffer.byteLength) {
      const newBuf = new Uint8Array(end * 2);
      newBuf.set(this.buffer.subarray(0, this.size));
      this.buffer = newBuf;
    }
    this.buffer.set(buf, at);
    if (end > this.size) this.size = end;
    return buf.byteLength;
  }

  flush(): void {}
  close(): void {}
}

function statOf(engine: VFSEngine, path: string) {
  const result = engine.stat(path);
  expect(result.status).toBe(0);
  return decodeStats(result.data!);
}

function lstatOf(engine: VFSEngine, path: string) {
  const result = engine.lstat(path);
  expect(result.status).toBe(0);
  return decodeStats(result.data!);
}

describe('nlink', () => {
  let engine: VFSEngine;
  let handle: MockSyncHandle;

  beforeEach(() => {
    engine = new VFSEngine();
    handle = new MockSyncHandle(0);
    engine.init(handle as unknown as FileSystemSyncAccessHandle);
  });

  it('newly created file has nlink=1', () => {
    engine.write('/file.txt', new TextEncoder().encode('hello'));
    const stats = statOf(engine, '/file.txt');
    expect(stats.nlink).toBe(1);
  });

  it('after link(), both source and dest have nlink=2', () => {
    engine.write('/a.txt', new TextEncoder().encode('data'));
    engine.link('/a.txt', '/b.txt');

    const statsA = statOf(engine, '/a.txt');
    const statsB = statOf(engine, '/b.txt');
    expect(statsA.nlink).toBe(2);
    expect(statsB.nlink).toBe(2);
  });

  it('after unlink of one link, remaining has nlink=1', () => {
    engine.write('/a.txt', new TextEncoder().encode('data'));
    engine.link('/a.txt', '/b.txt');

    // Both should be 2
    expect(statOf(engine, '/a.txt').nlink).toBe(2);
    expect(statOf(engine, '/b.txt').nlink).toBe(2);

    // Unlink one. `link()` adds a name to one inode rather than copying the file, so
    // removing that name leaves a single-named file behind — not, as it once did, a
    // second independent copy still claiming a link that no longer exists.
    engine.unlink('/b.txt');

    expect(statOf(engine, '/a.txt').nlink).toBe(1);
    // The remaining name still has the data; nothing was freed underneath it.
    expect(new TextDecoder().decode(engine.read('/a.txt').data!)).toBe('data');
  });

  it('unlinking the ORIGINAL name leaves the link holding the file', () => {
    engine.write('/a.txt', new TextEncoder().encode('data'));
    engine.link('/a.txt', '/b.txt');
    const ino = statOf(engine, '/a.txt').ino;

    engine.unlink('/a.txt');

    // The inode outlives the name it was created under: same inode, same bytes.
    const statsB = statOf(engine, '/b.txt');
    expect(statsB.nlink).toBe(1);
    expect(statsB.ino).toBe(ino);
    expect(new TextDecoder().decode(engine.read('/b.txt').data!)).toBe('data');
    expect(engine.read('/a.txt').status).not.toBe(0);
  });

  it('directory has nlink >= 2', () => {
    engine.mkdir('/mydir', 0);
    const stats = statOf(engine, '/mydir');
    expect(stats.nlink).toBe(2);
  });

  it('directory nlink increases with subdirectories', () => {
    engine.mkdir('/parent', 0);
    expect(statOf(engine, '/parent').nlink).toBe(2);

    engine.mkdir('/parent/child1', 0);
    expect(statOf(engine, '/parent').nlink).toBe(3);

    engine.mkdir('/parent/child2', 0);
    expect(statOf(engine, '/parent').nlink).toBe(4);
  });

  it('directory nlink does not count files as subdirectories', () => {
    engine.mkdir('/dir', 0);
    engine.write('/dir/file.txt', new TextEncoder().encode('data'));
    // nlink should still be 2 (only subdirs count)
    expect(statOf(engine, '/dir').nlink).toBe(2);
  });

  it('root directory has nlink >= 2', () => {
    const stats = statOf(engine, '/');
    expect(stats.nlink).toBeGreaterThanOrEqual(2);
  });

  it('stat and lstat both return correct nlink for regular files', () => {
    engine.write('/test.txt', new TextEncoder().encode('hello'));
    const stat = statOf(engine, '/test.txt');
    const lstat = lstatOf(engine, '/test.txt');
    expect(stat.nlink).toBe(1);
    expect(lstat.nlink).toBe(1);
  });

  it('stat and lstat both return correct nlink for directories', () => {
    engine.mkdir('/testdir', 0);
    engine.mkdir('/testdir/sub', 0);
    const stat = statOf(engine, '/testdir');
    const lstat = lstatOf(engine, '/testdir');
    expect(stat.nlink).toBe(3); // 2 + 1 subdir
    expect(lstat.nlink).toBe(3);
  });

  it('multiple links increment nlink correctly', () => {
    engine.write('/orig.txt', new TextEncoder().encode('data'));
    engine.link('/orig.txt', '/link1.txt');
    engine.link('/orig.txt', '/link2.txt');

    // Three names, one inode — so every name reports the same count of three. (When
    // links were copies each name reported whatever the count happened to be at the
    // moment it was made: 3, 2 and 3 for these three names.)
    for (const p of ['/orig.txt', '/link1.txt', '/link2.txt']) {
      expect(statOf(engine, p).nlink, p).toBe(3);
    }

    // …and the count falls back as names go, from every name.
    engine.unlink('/link1.txt');
    expect(statOf(engine, '/orig.txt').nlink).toBe(2);
    expect(statOf(engine, '/link2.txt').nlink).toBe(2);
  });

  it('stat response is 53 bytes with nlink field', () => {
    engine.write('/file.txt', new TextEncoder().encode('test'));
    const result = engine.stat('/file.txt');
    expect(result.status).toBe(0);
    expect(result.data!.byteLength).toBe(53);
  });
});
