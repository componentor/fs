/**
 * Free-block bitmap must never overflow the data region.
 *
 * Regression for a silent data-corruption bug: the on-disk bitmap region was
 * reserved at format time for only INITIAL_DATA_BLOCKS (1024 → ~1984 bytes after
 * alignment = capacity ~15,872 blocks ≈ 62 MB). But `allocateBlocks` /
 * `maybePreGrow` grow `totalBlocks` and the in-memory bitmap without enlarging
 * that region, so once the FS exceeded ~62 MB the bitmap spilled past
 * `dataOffset` and overlapped the first data block(s). The bitmap write and the
 * file's bytes then clobbered each other; on the next mount the bitmap read back
 * as garbage, the free-block count diverged from it, and continued operation
 * drove FREE_BLOCKS to a u32 underflow ("free blocks (4294942324) exceeds
 * total"). The fix reserves the bitmap region for `maxBlocks` so it can never
 * overflow, and caps growth at that capacity.
 *
 * The invariant under test, after every op AND across a remount:
 *   FREE_BLOCKS  ===  number of clear bits in the bitmap over [0, totalBlocks)
 * which only holds if the persisted bitmap == the in-memory bitmap, i.e. the
 * bitmap never overlapped data.
 */
import { describe, it, expect } from 'vitest';
import { VFSEngine } from '../src/vfs/engine.js';
import { MockSyncHandle } from './helpers/mock-handle.js';
import { calculateLayout, MAX_DATA_BLOCKS, INITIAL_DATA_BLOCKS, DEFAULT_BLOCK_SIZE } from '../src/vfs/layout.js';

function internals(engine: VFSEngine) {
  return engine as unknown as {
    freeBlocks: number;
    totalBlocks: number;
    bitmap: Uint8Array;
    bitmapOffset: number;
    dataOffset: number;
    maybePreGrow(force?: boolean): boolean;
    commitPending(): void;
  };
}

/** Count clear (free) bits over [0, totalBlocks) — the authoritative free count. */
function clearBits(e: ReturnType<typeof internals>): number {
  let free = 0;
  for (let i = 0; i < e.totalBlocks; i++) {
    if (((e.bitmap[i >>> 3] >>> (i & 7)) & 1) === 0) free++;
  }
  return free;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('bitmap region — layout', () => {
  it('reserves the bitmap region for the maximum block count, not the initial one', () => {
    const layout = calculateLayout(undefined, DEFAULT_BLOCK_SIZE, INITIAL_DATA_BLOCKS, MAX_DATA_BLOCKS);
    const regionBytes = layout.dataOffset - layout.bitmapOffset;
    // The reserved region must hold a bit for every block up to maxBlocks.
    expect(regionBytes * 8).toBeGreaterThanOrEqual(MAX_DATA_BLOCKS);
    // Initial file stays small (data region sized for the initial blocks only).
    expect(layout.totalBlocks).toBe(INITIAL_DATA_BLOCKS);
  });
});

describe('bitmap region — no overflow as the FS grows', () => {
  it('grows well past the old ~62MB cap and stays consistent across a remount', () => {
    const handle = new MockSyncHandle(0);
    const engine = new VFSEngine();
    engine.init(handle as unknown as FileSystemSyncAccessHandle);
    const e = internals(engine);

    const OLD_CAP_BLOCKS = 15872; // capacity of the pre-fix reserved region
    // Write enough distinct files to push totalBlocks well past the old cap.
    // ~40,000 blocks ≈ 160 MB of data region — far beyond the overflow point.
    const FILES = 80;
    const PER_FILE = 600 * 1024; // ~150 blocks each → ~12,000 blocks; plus growth headroom
    const payloads = new Map<string, number>();
    for (let i = 0; i < FILES; i++) {
      const data = new Uint8Array(PER_FILE);
      data[0] = i & 0xff;
      data[data.length - 1] = (i * 7) & 0xff;
      const path = `/big-${i}.bin`;
      expect(engine.write(path, data).status).toBe(0);
      payloads.set(path, i);
      // exercise idle pre-grow too
      e.maybePreGrow(true);
    }
    e.commitPending();

    expect(e.totalBlocks).toBeGreaterThan(OLD_CAP_BLOCKS); // we really crossed it
    // In-memory invariant holds.
    expect(e.freeBlocks).toBe(clearBits(e));
    // The bitmap never reached the data region.
    expect(e.bitmapOffset + Math.ceil(e.totalBlocks / 8)).toBeLessThanOrEqual(e.dataOffset);

    // REMOUNT from the same backing buffer — the pre-fix bug surfaced here.
    const e2raw = new VFSEngine();
    e2raw.init(handle as unknown as FileSystemSyncAccessHandle);
    const e2 = internals(e2raw);
    expect(e2.freeBlocks).toBe(clearBits(e2));

    // Every file still reads back byte-identically.
    for (const [path, i] of payloads) {
      const r = e2raw.read(path);
      expect(r.status).toBe(0);
      expect(r.data).not.toBeNull();
      expect(r.data!.length).toBe(PER_FILE);
      expect(r.data![0]).toBe(i & 0xff);
      expect(r.data![PER_FILE - 1]).toBe((i * 7) & 0xff);
    }
  });

  it('randomized op mix keeps FREE_BLOCKS == bitmap clear-bits, in memory and after remount', () => {
    const SEEDS = [1, 42, 1337, 20260611, 7];
    for (const seed of SEEDS) {
      const rand = mulberry32(seed);
      const handle = new MockSyncHandle(0);
      const engine = new VFSEngine();
      engine.init(handle as unknown as FileSystemSyncAccessHandle);
      const e = internals(engine);

      const dirs = ['/'];
      const files: string[] = [];
      let n = 0;
      const pick = <T>(a: T[]): T => a[Math.floor(rand() * a.length)];
      const nm = (k: string) => `${k}${n++}`;
      const join = (d: string, x: string) => (d === '/' ? '/' + x : d + '/' + x);
      const mkData = () => {
        const kind = rand();
        const len = kind < 0.15 ? 0
          : kind < 0.6 ? 1 + Math.floor(rand() * 4000)
          : kind < 0.92 ? 1 + Math.floor(rand() * 60000)
          : 1 + Math.floor(rand() * 1_200_000);
        const b = new Uint8Array(len);
        if (len > 0) { b[0] = n & 0xff; b[len - 1] = (n >> 8) & 0xff; }
        return b;
      };

      for (let op = 0; op < 600; op++) {
        const roll = rand();
        if (roll < 0.32) {
          const path = rand() < 0.7 || files.length === 0 ? join(pick(dirs), nm('f')) : pick(files);
          if (engine.write(path, mkData()).status === 0 && !files.includes(path)) files.push(path);
        } else if (roll < 0.44) {
          const path = join(pick(dirs), nm('d'));
          if (engine.mkdir(path, rand() < 0.5 ? 1 : 0).status === 0) dirs.push(path);
        } else if (roll < 0.58 && files.length > 0) {
          const path = pick(files);
          if (engine.unlink(path).status === 0) files.splice(files.indexOf(path), 1);
        } else if (roll < 0.7 && files.length > 0) {
          engine.truncate(pick(files), Math.floor(rand() * 150000));
        } else if (roll < 0.82 && files.length > 0) {
          engine.append(pick(files), mkData());
        } else if (roll < 0.92 && files.length > 0) {
          const oldP = pick(files);
          const newP = join(pick(dirs), nm('rn'));
          if (engine.rename(oldP, newP).status === 0) { files.splice(files.indexOf(oldP), 1); files.push(newP); }
        } else if (files.length > 0) {
          const dst = join(pick(dirs), nm('cp'));
          if (engine.copy(pick(files), dst, 0).status === 0) files.push(dst);
        }
        if (rand() < 0.1) e.maybePreGrow(true);
        expect(e.freeBlocks, `seed ${seed} op ${op}`).toBe(clearBits(e));
      }
      e.maybePreGrow(true);
      e.commitPending();

      const e2raw = new VFSEngine();
      e2raw.init(handle as unknown as FileSystemSyncAccessHandle);
      const e2 = internals(e2raw);
      expect(e2.freeBlocks, `seed ${seed} remount`).toBe(clearBits(e2));
    }
  });
});
