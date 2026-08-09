/**
 * Block allocator invariants.
 *
 * `allocateBlocks` uses next-fit: the search resumes where the last allocation ended and wraps
 * once, instead of restarting at block 0. That removed an O(allocated) scan per allocation (file
 * creation degraded from 8 µs to 16 µs as a volume filled to 16k files, and kept climbing), but
 * an allocator bug does not surface as a slow test — it surfaces as two files sharing a block.
 *
 * So these assert the invariants rather than the speed: allocations never overlap, freed space
 * is reused rather than leaked, and the volume only grows when it genuinely has to. The fuzz
 * case is the important one — it is the only thing here that explores wrap-around and
 * fragmentation orderings nobody thought to write down.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createHarness, type Harness } from './helpers/engine-transport.js';
import { writeFileSync } from '../src/methods/writeFile.js';
import { readFileSync } from '../src/methods/readFile.js';
import { unlinkSync } from '../src/methods/unlink.js';
import { statSync } from '../src/methods/stat.js';

let h: Harness;
beforeEach(() => { h = createHarness(); });

const content = (n: number, seed: string) => seed.repeat(Math.ceil(n / seed.length)).slice(0, n);

/**
 * Block accounting straight off the engine.
 *
 * These fields are private, and reached here deliberately: the invariant under test *is* the
 * internal accounting, and `fs.statfs()` cannot stand in for it (see CHANGELOG 3.3.13 — it
 * reported fabricated constants until it was wired to the engine, and even now rounds).
 */
const blocks = (h: Harness) => {
  const e = h.engine as unknown as { totalBlocks: number; freeBlocks: number; blockSize: number };
  return { total: e.totalBlocks, free: e.freeBlocks, size: e.blockSize };
};
const text = (v: unknown) => (typeof v === 'string' ? v : new TextDecoder().decode(v as Uint8Array));

describe('allocations never overlap', () => {
  it('every file keeps its own bytes across many creates', () => {
    // Overlapping block runs show up as one file reading back another's content.
    const expected = new Map<string, string>();
    for (let i = 0; i < 300; i++) {
      const body = content(1 + (i * 37) % 9000, `f${i}-`);
      writeFileSync(h.request, `/f${i}`, body);
      expected.set(`/f${i}`, body);
    }
    for (const [path, body] of expected) {
      expect(text(readFileSync(h.request, path, 'utf8')), path).toBe(body);
    }
  });

  it('survives interleaved creates and deletes', () => {
    // Deleting frees runs in the middle of the volume, which is where next-fit has to wrap and
    // where a stale cursor would hand out a block that is still in use.
    const live = new Map<string, string>();
    for (let round = 0; round < 6; round++) {
      for (let i = 0; i < 60; i++) {
        const path = `/r${round}-${i}`;
        const body = content(1 + (i * 211) % 12000, `r${round}i${i}-`);
        writeFileSync(h.request, path, body);
        live.set(path, body);
      }
      // Drop every third file, fragmenting the space.
      let n = 0;
      for (const path of [...live.keys()]) {
        if (n++ % 3 === 0) { unlinkSync(h.request, path); live.delete(path); }
      }
      for (const [path, body] of live) {
        expect(text(readFileSync(h.request, path, 'utf8')), `${path} after round ${round}`).toBe(body);
      }
    }
  });
});

describe('freed space is reused', () => {
  it('recreating files after deleting them does not grow the volume', () => {
    // Fill, delete everything, refill: the second fill must land in the freed blocks. If the
    // cursor never wrapped, the volume would grow instead and free-block accounting would drift.
    const before = blocks(h);
    for (let i = 0; i < 200; i++) writeFileSync(h.request, `/a${i}`, content(4096, `a${i}-`));
    const filled = blocks(h);
    for (let i = 0; i < 200; i++) unlinkSync(h.request, `/a${i}`);
    const emptied = blocks(h);

    expect(emptied.free, 'deleting everything should return every block').toBe(before.free + (filled.total - before.total));

    for (let i = 0; i < 200; i++) writeFileSync(h.request, `/b${i}`, content(4096, `b${i}-`));
    const refilled = blocks(h);
    expect(refilled.total, 'refilling must reuse freed blocks, not grow the volume').toBe(filled.total);
    for (let i = 0; i < 200; i++) {
      expect(text(readFileSync(h.request, `/b${i}`, 'utf8'))).toBe(content(4096, `b${i}-`));
    }
  });

  it('a large file fits into space freed by many small ones', () => {
    // Requires the wrap: the contiguous run only exists below the cursor.
    for (let i = 0; i < 100; i++) writeFileSync(h.request, `/s${i}`, content(4096, 'x'));
    for (let i = 0; i < 100; i++) unlinkSync(h.request, `/s${i}`);
    const beforeBig = blocks(h);
    const big = content(200 * 1024, 'BIG-');
    writeFileSync(h.request, '/big', big);
    expect(text(readFileSync(h.request, '/big', 'utf8'))).toBe(big);
    expect(blocks(h).total, 'should reuse the freed run rather than grow').toBe(beforeBig.total);
  });
});

describe('free-block accounting stays exact', () => {
  it('reported free blocks match the file sizes actually stored', () => {
    const sizes = [1, 4095, 4096, 4097, 20000, 65536];
    const start = blocks(h);
    let expectedUsed = 0;
    sizes.forEach((size, i) => {
      writeFileSync(h.request, `/z${i}`, content(size, 'z'));
      expectedUsed += Math.ceil(size / start.size);
    });
    const after = blocks(h);
    // Growth adds free blocks, so compare used-block deltas rather than raw free counts.
    expect((after.total - after.free) - (start.total - start.free)).toBe(expectedUsed);
    sizes.forEach((size, i) => {
      expect(statSync(h.request, `/z${i}`).size).toBe(size);
    });
  });
});

describe('fuzz: random allocate/free orderings preserve every file', () => {
  /** Deterministic PRNG so a failure is reproducible from the seed alone. */
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
  }

  it.each([1, 7, 1337, 20260611])('seed %d: 600 random ops never corrupt a file', (seed) => {
    const rand = rng(seed);
    const live = new Map<string, string>();
    let next = 0;

    for (let op = 0; op < 600; op++) {
      const roll = rand();
      if (roll < 0.55 || live.size === 0) {
        const path = `/n${next++}`;
        const body = content(1 + Math.floor(rand() * 20000), `${path}:`);
        writeFileSync(h.request, path, body);
        live.set(path, body);
      } else if (roll < 0.8) {
        const paths = [...live.keys()];
        const path = paths[Math.floor(rand() * paths.length)];
        unlinkSync(h.request, path);
        live.delete(path);
      } else {
        // Rewrite at a different size — frees one run and allocates another.
        const paths = [...live.keys()];
        const path = paths[Math.floor(rand() * paths.length)];
        const body = content(1 + Math.floor(rand() * 20000), `${path}#${op}:`);
        writeFileSync(h.request, path, body);
        live.set(path, body);
      }
    }

    for (const [path, body] of live) {
      expect(text(readFileSync(h.request, path, 'utf8')), `${path} (seed ${seed})`).toBe(body);
    }
  });
});
