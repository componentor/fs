/**
 * Directory mtime/ctime are applied to the cached inode immediately (stat is always right) and
 * written to disk in batches, so a burst of creates in one directory costs no extra I/O per create:
 * at most once per DIR_TIMES_PERSIST_MS (1 s) from the per-op commit, and always on flush() and
 * closeHandle(). These tests remount a second engine on the same bytes to see what reached disk.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VFSEngine } from '../src/vfs/engine.js';
import { MockSyncHandle } from './helpers/mock-handle.js';

const T0 = 1_700_000_000_000;

const times = (engine: VFSEngine, path: string) => {
  const r = engine.stat(path);
  expect(r.status).toBe(0);
  const v = new DataView(r.data!.buffer, r.data!.byteOffset, r.data!.byteLength);
  return { mtime: v.getFloat64(13, true), ctime: v.getFloat64(21, true) };
};
const remount = (handle: MockSyncHandle) => {
  const e = new VFSEngine();
  e.init(handle as unknown as FileSystemSyncAccessHandle);
  return e;
};
const enc = new TextEncoder();

let handle: MockSyncHandle;
let engine: VFSEngine;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  handle = new MockSyncHandle(0);
  engine = new VFSEngine();
  engine.init(handle as unknown as FileSystemSyncAccessHandle);
  engine.mkdir('/d');
  engine.flush();
});
afterEach(() => vi.useRealTimers());

describe('directory timestamps on disk', () => {
  it('writes the first change after an idle period at once, then batches the next ones', () => {
    vi.setSystemTime(T0 + 10);
    engine.write('/d/a', enc.encode('x')); // nothing written recently: persisted by this commit
    expect(times(remount(handle), '/d')).toEqual({ mtime: T0 + 10, ctime: T0 + 10 });
    vi.setSystemTime(T0 + 20);
    engine.write('/d/b', enc.encode('x')); // within the interval: batched
    expect(times(engine, '/d')).toEqual({ mtime: T0 + 20, ctime: T0 + 20 }); // stat sees it at once
    expect(times(remount(handle), '/d')).toEqual({ mtime: T0 + 10, ctime: T0 + 10 }); // disk: later
  });

  it('are written by flush()', () => {
    vi.setSystemTime(T0 + 10);
    engine.write('/d/a', enc.encode('x'));
    engine.flush();
    expect(times(remount(handle), '/d')).toEqual({ mtime: T0 + 10, ctime: T0 + 10 });
  });

  it('are written by closeHandle()', () => {
    vi.setSystemTime(T0 + 10);
    engine.write('/d/a', enc.encode('x'));
    engine.closeHandle();
    expect(times(remount(handle), '/d')).toEqual({ mtime: T0 + 10, ctime: T0 + 10 });
  });

  it('are written by the first commit once the interval has passed, including all pending dirs', () => {
    engine.mkdir('/e');
    engine.flush();
    vi.setSystemTime(T0 + 10);
    engine.write('/d/a', enc.encode('x'));
    vi.setSystemTime(T0 + 20);
    engine.write('/e/a', enc.encode('x'));
    vi.setSystemTime(T0 + 1_100);
    engine.write('/d/b', enc.encode('x')); // this op's commit persists everything pending
    const disk = remount(handle);
    expect(times(disk, '/d')).toEqual({ mtime: T0 + 1_100, ctime: T0 + 1_100 });
    expect(times(disk, '/e')).toEqual({ mtime: T0 + 20, ctime: T0 + 20 });
  });

  it('writes nothing to the directory inode during a burst of creates within the interval', () => {
    const e = engine as any;
    const dirAt = e.inodeTableOffset + e.pathIndex.get('/d') * 64;
    vi.setSystemTime(T0 + 10);
    engine.write('/d/a', enc.encode('x')); // first change after idle: written at once
    const writes = vi.spyOn(handle, 'write');
    for (let i = 0; i < 50; i++) {
      vi.setSystemTime(T0 + 11 + i);
      engine.write('/d/f' + i, enc.encode('x'));
    }
    const touchedDir = writes.mock.calls.filter((c: any) => (c[1]?.at ?? 0) >= dirAt && (c[1]?.at ?? 0) < dirAt + 64);
    expect(touchedDir).toEqual([]);
    // path table, data, new inode, bitmap, superblock: the same five writes a create always did
    expect(writes.mock.calls.length).toBe(50 * 5);
    expect(times(engine, '/d')).toEqual({ mtime: T0 + 60, ctime: T0 + 60 });
  });

  it('survive the directory being removed before they are written', () => {
    vi.setSystemTime(T0 + 10);
    engine.write('/d/a', enc.encode('x'));
    engine.unlink('/d/a');
    engine.rmdir('/d');
    expect(() => engine.flush()).not.toThrow();
    expect(remount(handle).stat('/d').status).not.toBe(0);
  });
});
