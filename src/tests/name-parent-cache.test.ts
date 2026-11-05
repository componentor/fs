/**
 * The engine remembers, per name, the inode of the directory holding it (`nameParent`), so that
 * unlink/rmdir/rename can stamp the parent directory's mtime/ctime without a path lookup. A wrong
 * entry would silently stamp the wrong directory, so this checks it two ways over a long random
 * sequence of namespace operations (files, directories, hard links, renames across and over
 * existing entries, recursive removal, remounts):
 *
 *  - the cache itself: every non-zero entry names the directory its name really lives in, and
 *    freed slots are cleared;
 *  - the result: a second engine with the cache disabled (always looking the parent up) reports
 *    identical mtime/ctime for every path after every step.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { VFSEngine } from '../src/vfs/engine.js';
import { MockSyncHandle } from './helpers/mock-handle.js';

const enc = new TextEncoder();

function mount(handle: MockSyncHandle, cacheDisabled: boolean): VFSEngine {
  const e = new VFSEngine();
  if (cacheDisabled) {
    // Reads always answer "unknown", writes go nowhere: every lookup takes the slow path.
    const blind = new Proxy(new Int32Array(0), {
      get: (t, k) => (k === 'subarray' ? () => new Int32Array(0) : typeof k === 'string' && /^\d+$/.test(k) ? 0 : (t as any)[k]),
      set: () => true,
    });
    Object.defineProperty(e, 'nameParent', { get: () => blind, set: () => {} });
  }
  e.init(handle as unknown as FileSystemSyncAccessHandle);
  return e;
}

/** Every non-zero cache entry points at the directory that holds the slot's name. */
function checkCache(engine: VFSEngine): void {
  const e = engine as any;
  const np: Int32Array = e.nameParent;
  const nameOfSlot = new Map<number, string>();
  for (const [path, idx] of e.pathIndex as Map<string, number>) {
    nameOfSlot.set(e.linkInodes.get(path) ?? idx, path);
  }
  for (let slot = 0; slot < np.length; slot++) {
    if (np[slot] === 0) continue;
    const name = nameOfSlot.get(slot);
    expect(name, `slot ${slot} has a parent entry but no name`).toBeDefined();
    const slash = name!.lastIndexOf('/');
    const parentIdx = e.pathIndex.get(slash > 0 ? name!.substring(0, slash) : '/');
    expect(np[slot] - 1, `parent of ${name}`).toBe(parentIdx);
  }
}

function allTimes(engine: VFSEngine): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const path of [...(engine as any).pathIndex.keys()].sort()) {
    const r = engine.lstat(path);
    const v = new DataView(r.data!.buffer, r.data!.byteOffset, r.data!.byteLength);
    out[path] = [v.getFloat64(13, true), v.getFloat64(21, true)];
  }
  return out;
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

afterEach(() => vi.useRealTimers());

describe('per-name parent directory cache', () => {
  it('stays exact, and changes no timestamp, across random namespace operations', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let now = 1_700_000_000_000;
    vi.setSystemTime(now);
    const handles = [new MockSyncHandle(0), new MockSyncHandle(0)];
    let fast = mount(handles[0], false);
    let slow = mount(handles[1], true);
    const rand = rng(7);
    const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
    const dirs = ['/', '/a', '/a/b', '/c', '/c/d/e'];
    const names = ['x', 'y', 'z', 'w'];
    const anyPath = () => pick(dirs).replace(/\/$/, '') + '/' + pick(names);
    const succeeded = new Set<string>();

    for (let step = 0; step < 3000; step++) {
      now += 1 + Math.floor(rand() * 3); // every step at a new millisecond, some ops sharing one
      vi.setSystemTime(now);
      // Every random choice is made here, once, so both engines run exactly the same operation.
      const r = rand();
      let op: [string, ...unknown[]];
      if (r < 0.2) op = ['write', anyPath(), enc.encode('v' + step)];
      else if (r < 0.3) op = ['mkdir', pick(dirs), 1];
      else if (r < 0.4) op = ['mkdir', anyPath(), 0];
      else if (r < 0.52) op = ['unlink', anyPath()];
      else if (r < 0.75) op = ['rename', rand() < 0.3 ? pick(dirs) : anyPath(), anyPath()];
      else if (r < 0.85) op = ['link', anyPath(), anyPath()];
      else if (r < 0.92) op = ['rmdir', rand() < 0.5 ? pick(dirs) : anyPath(), rand() < 0.5 ? 1 : 0];
      else if (r < 0.95) op = ['symlink', '/a', anyPath()];
      else if (r < 0.97) op = ['truncate', anyPath(), 3];
      else {
        // Remount both: the cache starts empty again and must refill correctly.
        fast.flush(); slow.flush();
        fast = mount(handles[0], false);
        slow = mount(handles[1], true);
        continue;
      }
      const [name, ...args] = op;
      const label = `step ${step}: ${name}(${args.filter((x) => typeof x !== 'object').join(', ')})`;
      const a = (fast as any)[name](...args);
      const b = (slow as any)[name](...args);
      expect(a?.status, label).toBe(b?.status);
      if (a?.status === 0) succeeded.add(name);
      checkCache(fast);
      expect(allTimes(fast), label).toEqual(allTimes(slow));
    }
    // The sequence must actually have exercised the interesting cases.
    expect([...succeeded].sort()).toEqual(['link', 'mkdir', 'rename', 'rmdir', 'symlink', 'truncate', 'unlink', 'write']);
    expect((fast as any).pathIndex.size).toBeGreaterThan(5);
  });

  it('survives the inode table growing', () => {
    const e = mount(new MockSyncHandle(0), false) as any;
    e.mkdir('/d');
    e.write('/d/f', enc.encode('x'));
    const idx = e.pathIndex.get('/d/f');
    const before = e.nameParent[idx];
    expect(before - 1).toBe(e.pathIndex.get('/d'));
    e.growInodeTable();
    expect(e.nameParent.length).toBe(e.inodeCount);
    expect(e.nameParent[idx]).toBe(before);
    checkCache(e);
  });

  it('follows a hard link promoted to the inode\'s own name', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_700_000_000_000);
    const e = mount(new MockSyncHandle(0), false) as any;
    e.mkdir('/a'); e.mkdir('/b');
    e.write('/a/f', enc.encode('x'));
    e.link('/a/f', '/b/g');
    e.unlink('/a/f'); // /b/g becomes the inode's own name
    checkCache(e);
    vi.setSystemTime(1_700_000_005_000);
    e.unlink('/b/g');
    const v = (p: string) => { const r = e.stat(p); return new DataView(r.data.buffer, r.data.byteOffset).getFloat64(13, true); };
    expect(v('/b')).toBe(1_700_000_005_000);
    expect(v('/a')).toBe(1_700_000_000_000);
  });
});
