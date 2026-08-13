/**
 * statfs reports the real volume, not invented constants.
 *
 * This file previously built an `expectedStatFs()` object locally and asserted the product
 * matched it — and both were fabricated: `statfsSync` returned a fixed ~4 GB capacity with ~2 GB
 * free no matter what the volume held, and the test asserted exactly those constants. Anything
 * checking free space before a large write got an answer unrelated to reality, and the test
 * could never have said so. (It escaped the 3.3.10 audit because it imports one product
 * constant, so it did not look self-referential by that heuristic.)
 *
 * `statfs` now reads the superblock the allocator maintains. These assert it *tracks* the
 * volume — free space falls as data is written and returns when it is freed — which is the only
 * thing that makes the numbers worth reading.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VFS_MAGIC } from '../src/vfs/layout.js';
import { createFsHarness } from './helpers/engine-transport.js';
import type { VFSFileSystem } from '../src/filesystem.js';

let fs: VFSFileSystem;
beforeEach(() => { fs = createFsHarness().fs; });

const body = (n: number) => 'x'.repeat(n);

describe('statfs shape', () => {
  it('reports every field Node reports', () => {
    const st = fs.statfsSync('/');
    for (const field of ['type', 'bsize', 'blocks', 'bfree', 'bavail', 'files', 'ffree']) {
      expect(st, field).toHaveProperty(field);
      expect(typeof (st as unknown as Record<string, unknown>)[field], field).toBe('number');
    }
  });

  it('identifies the filesystem and its block size', () => {
    const st = fs.statfsSync('/');
    expect(st.type).toBe(VFS_MAGIC);
    expect(st.bsize).toBe(4096);
  });

  it('keeps its counts self-consistent', () => {
    const st = fs.statfsSync('/');
    expect(st.bfree).toBeLessThanOrEqual(st.blocks);
    expect(st.ffree).toBeLessThanOrEqual(st.files);
    expect(st.bavail).toBe(st.bfree);
    for (const v of [st.blocks, st.bfree, st.files, st.ffree]) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe('statfs tracks the volume', () => {
  it('free blocks fall by the number of blocks a write consumes', () => {
    const before = fs.statfsSync('/');
    fs.writeFileSync('/f', body(before.bsize * 10));
    const after = fs.statfsSync('/');
    // Exactly ten 4 KB blocks, unless the volume had to grow to fit them.
    const consumed = (before.bfree - after.bfree) + (after.blocks - before.blocks);
    expect(consumed).toBe(10);
  });

  it('free blocks return when the file is deleted', () => {
    const before = fs.statfsSync('/');
    fs.writeFileSync('/f', body(before.bsize * 8));
    expect(fs.statfsSync('/').bfree).toBeLessThan(before.bfree);
    fs.unlinkSync('/f');
    const after = fs.statfsSync('/');
    expect(after.bfree).toBe(before.bfree + (after.blocks - before.blocks));
  });

  it('free inodes fall as entries are created and return as they are removed', () => {
    const before = fs.statfsSync('/');
    for (let i = 0; i < 20; i++) fs.writeFileSync(`/f${i}`, 'x');
    const created = fs.statfsSync('/');
    expect(before.ffree - created.ffree).toBe(20);

    for (let i = 0; i < 20; i++) fs.unlinkSync(`/f${i}`);
    expect(fs.statfsSync('/').ffree).toBe(before.ffree);
  });

  it('a hard link shares the file but still spends an inode-table slot', () => {
    // A hard link adds a NAME: both names resolve to one inode, so no second copy of the
    // data is made and `bfree` does not move. `ffree` does, and that is not the old
    // copy behaviour resurfacing — this format keeps directory entries in the inode
    // table, so the link's own entry (INODE_TYPE.HARDLINK: its path plus the target's
    // index) occupies exactly one slot. `ffree` reports capacity, and that slot is spent.
    fs.writeFileSync('/a', 'shared');
    const before = fs.statfsSync('/');
    fs.linkSync('/a', '/b');
    const after = fs.statfsSync('/');

    expect(after.ffree).toBe(before.ffree - 1);
    expect(after.bfree, 'no data blocks — the file is not copied').toBe(before.bfree);
    expect(fs.statSync('/b').ino).toBe(fs.statSync('/a').ino);
    expect(fs.statSync('/a').nlink).toBe(2);

    // Removing the link returns the slot, and the file it named is untouched.
    fs.unlinkSync('/b');
    expect(fs.statfsSync('/').ffree).toBe(before.ffree);
    expect(fs.readFileSync('/a', 'utf8')).toBe('shared');
  });

  it('does not report the same numbers regardless of contents', () => {
    // The regression guard: the old implementation returned identical constants forever.
    const empty = fs.statfsSync('/');
    fs.writeFileSync('/big', body(empty.bsize * 50));
    const full = fs.statfsSync('/');
    expect(full.bfree, 'free blocks must change when data is written').not.toBe(empty.bfree);
    expect(full.ffree, 'free inodes must change when a file is created').not.toBe(empty.ffree);
  });
});

describe('statfs async forms', () => {
  it('promises.statfs agrees with statfsSync', async () => {
    fs.writeFileSync('/f', body(9000));
    const sync = fs.statfsSync('/');
    const async = await fs.promises.statfs('/');
    expect(async).toEqual(sync);
  });

  it('the callback form delivers the same stats', async () => {
    fs.writeFileSync('/f', body(9000));
    const viaCallback = await new Promise<unknown>((resolve, reject) => {
      fs.statfs('/', (err, stats) => (err ? reject(err) : resolve(stats)));
    });
    expect(viaCallback).toEqual(fs.statfsSync('/'));
  });
});
