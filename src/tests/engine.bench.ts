/**
 * VFS Engine micro-benchmarks — directory-operation hot paths.
 *
 * Run with: npx vitest bench engine.bench
 * (bench files are NOT picked up by `vitest run`, so the normal suite is unaffected)
 *
 * These benchmarks exist to prove the readdir children-index change is a real
 * improvement: run them on the code before and after the change and compare.
 * The volume shape is deliberately adversarial for a prefix-scan readdir:
 * many files spread over many directories, so listing ONE directory under a
 * full-index scan is O(total files), while an indexed listing is O(children).
 *
 * Every setup operation asserts status === 0 — a benchmark built on silently
 * failed operations measures nothing.
 */
import { bench, describe } from 'vitest';
import { VFSEngine } from '../src/vfs/engine.js';
import { MockSyncHandle } from './helpers/mock-handle.js';

const encoder = new TextEncoder();
const PAYLOAD = encoder.encode('benchmark-payload');

function ok(status: number, what: string): void {
  if (status !== 0) throw new Error(`benchmark setup failed: ${what} -> status ${status}`);
}

function buildVolume(dirs: number, filesPerDir: number): VFSEngine {
  const engine = new VFSEngine();
  const handle = new MockSyncHandle(0);
  engine.init(handle as unknown as FileSystemSyncAccessHandle);
  for (let d = 0; d < dirs; d++) {
    ok(engine.mkdir(`/dir${d}`).status, `mkdir /dir${d}`);
    for (let f = 0; f < filesPerDir; f++) {
      ok(engine.write(`/dir${d}/file${f}.txt`, PAYLOAD).status, `write /dir${d}/file${f}.txt`);
    }
  }
  // A deep explicit chain so nested-path handling is exercised
  ok(engine.mkdir('/deep/a/b/c/d/e/f/g', 1).status, 'mkdir -p /deep/.../g');
  ok(engine.write('/deep/a/b/c/d/e/f/g/leaf.txt', PAYLOAD).status, 'write deep leaf');
  // Sanity: listing must actually return entries
  const probe = engine.readdir(`/dir${dirs - 1}`);
  ok(probe.status, `readdir /dir${dirs - 1}`);
  if (!probe.data || probe.data.byteLength === 0) {
    throw new Error('benchmark setup failed: readdir returned no entries');
  }
  return engine;
}

// 100 dirs x 100 files = 10k files
const engine10k = buildVolume(100, 100);
// 500 dirs x 100 files = 50k files
const engine50k = buildVolume(500, 100);

describe('readdir hot path', () => {
  bench('readdir one dir (100 entries) in 10k-file volume', () => {
    engine10k.readdir('/dir50');
  });

  bench('readdir one dir (100 entries) in 50k-file volume', () => {
    engine50k.readdir('/dir250');
  });

  bench('readdir root (500+ entries) in 50k-file volume', () => {
    engine50k.readdir('/');
  });

  bench('readdir deep dir (1 entry) in 50k-file volume', () => {
    engine50k.readdir('/deep/a/b/c/d/e/f/g');
  });
});

describe('stat hot path', () => {
  bench('stat dir in 50k-file volume', () => {
    engine50k.stat('/dir250');
  });

  bench('stat file in 50k-file volume', () => {
    engine50k.stat('/dir250/file50.txt');
  });
});

describe('mixed OS-like workload', () => {
  // Simulates what a dev-tool / OS-in-browser actually does: walk + stat
  bench('list-and-stat sweep of 10 dirs in 50k-file volume', () => {
    for (let d = 240; d < 250; d++) {
      engine50k.readdir(`/dir${d}`);
      engine50k.stat(`/dir${d}`);
    }
  });
});
