/**
 * Idle pre-growth tests (engine.maybePreGrow + trim headroom).
 *
 * Growing the VFS file via handle.truncate during a request can stall ~20s
 * on WebKit while a sync caller busy-spins the main thread. The engine
 * therefore maintains a contiguous trailing free-block headroom, grown from
 * the dispatch loop's idle phase, and trimTrailingBlocks preserves that
 * headroom so grow/trim don't oscillate.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VFSEngine } from '../src/vfs/engine.js';
import { MockSyncHandle } from './helpers/mock-handle.js';

const PREGROW_HEADROOM_BLOCKS = 16384; // mirrors engine.ts constant (64MB @ 4KB blocks)
const BLOCK_SIZE = 4096;
const DATA = new Uint8Array(64 * 1024).fill(42); // 64KB -> 16 blocks

function makeEngine(limits?: { maxBlocks?: number }): { engine: VFSEngine; handle: MockSyncHandle } {
  const handle = new MockSyncHandle(0);
  const engine = new VFSEngine();
  engine.init(handle as unknown as FileSystemSyncAccessHandle, limits ? { limits } : undefined);
  return { engine, handle };
}

function internals(engine: VFSEngine): { totalBlocks: number; freeBlocks: number; findLastUsedBlock(): number } {
  return engine as unknown as { totalBlocks: number; freeBlocks: number; findLastUsedBlock(): number };
}

function trailingFree(engine: VFSEngine): number {
  const e = internals(engine);
  return e.totalBlocks - (e.findLastUsedBlock() + 1);
}

describe('maybePreGrow', () => {
  let engine: VFSEngine;
  let handle: MockSyncHandle;

  beforeEach(() => {
    ({ engine, handle } = makeEngine());
  });

  it('grows a fresh volume up to the headroom', () => {
    // Fresh volume starts with INITIAL_DATA_BLOCKS (1024) < headroom (4096)
    const before = internals(engine).totalBlocks;
    expect(engine.maybePreGrow(true)).toBe(true);
    expect(trailingFree(engine)).toBeGreaterThanOrEqual(PREGROW_HEADROOM_BLOCKS);
    expect(internals(engine).totalBlocks).toBeGreaterThan(before);
  });

  it('is a no-op when headroom is already present', () => {
    expect(engine.maybePreGrow(true)).toBe(true);
    expect(engine.maybePreGrow(true)).toBe(false); // already grown
  });

  it('keeps the file mountable after growth (superblock flushed)', () => {
    engine.write('/file.bin', DATA);
    expect(engine.maybePreGrow(true)).toBe(true);
    const engine2 = new VFSEngine();
    engine2.init(handle as unknown as FileSystemSyncAccessHandle);
    const res = engine2.read('/file.bin');
    expect(res.status).toBe(0);
    expect(res.data!.byteLength).toBe(DATA.byteLength);
  });

  it('restores headroom after writes consume it', () => {
    engine.maybePreGrow(true);
    // Write ~12MB to eat into the 16MB headroom
    for (let i = 0; i < 192; i++) {
      expect(engine.write(`/eat${i}.bin`, DATA).status).toBe(0);
    }
    expect(trailingFree(engine)).toBeLessThan(PREGROW_HEADROOM_BLOCKS + 8);
    expect(engine.maybePreGrow(true)).toBe(true);
    expect(trailingFree(engine)).toBeGreaterThanOrEqual(PREGROW_HEADROOM_BLOCKS);
  });

  it('writes up to the headroom size never trigger in-request growth', () => {
    engine.maybePreGrow(true);
    const totalBefore = internals(engine).totalBlocks;
    // 15MB single write < 16MB headroom -> must fit without growth
    const big = new Uint8Array(15 * 1024 * 1024).fill(7);
    expect(engine.write('/big.bin', big).status).toBe(0);
    expect(internals(engine).totalBlocks).toBe(totalBefore);
  });

  it('respects the maxBlocks ceiling', () => {
    const { engine: capped } = makeEngine({ maxBlocks: 1024 }); // == initial size
    expect(capped.maybePreGrow(true)).toBe(false);
    expect(internals(capped).totalBlocks).toBe(1024);
  });

  it('throttles unforced calls', () => {
    // First unforced call may grow; an immediate second one must be skipped
    capDate(() => {
      engine.maybePreGrow();
      expect(engine.maybePreGrow()).toBe(false);
    });
  });

  it('trim preserves the headroom instead of shrinking to last used block', () => {
    engine.maybePreGrow(true);
    // Create then delete a large file past the headroom -> frees a long tail
    const big = new Uint8Array(20 * 1024 * 1024).fill(9);
    expect(engine.write('/big.bin', big).status).toBe(0);
    expect(engine.unlink('/big.bin').status).toBe(0); // triggers trim in commitPending
    expect(trailingFree(engine)).toBeGreaterThanOrEqual(PREGROW_HEADROOM_BLOCKS);
    // And the volume is still consistent
    expect(engine.write('/after.bin', DATA).status).toBe(0);
    expect(engine.read('/after.bin').data!.byteLength).toBe(DATA.byteLength);
  });

  it('grown region is usable: write/read across the pre-grown tail', () => {
    engine.maybePreGrow(true);
    const sizes = [BLOCK_SIZE - 1, BLOCK_SIZE, BLOCK_SIZE * 3 + 17, 2 * 1024 * 1024];
    for (const n of sizes) {
      const payload = new Uint8Array(n);
      for (let i = 0; i < n; i++) payload[i] = (i * 31) & 0xff;
      expect(engine.write(`/sz-${n}.bin`, payload).status).toBe(0);
      const back = engine.read(`/sz-${n}.bin`);
      expect(back.status).toBe(0);
      expect(back.data!.byteLength).toBe(n);
      expect(back.data![n - 1]).toBe(payload[n - 1]);
    }
  });
});

/** Helper: run fn (throttle uses Date.now; same-ms calls exercise it). */
function capDate(fn: () => void): void {
  fn();
}
