/**
 * Differential fuzz of the promise API against `node:fs/promises`.
 *
 * [fuzz-parity.test.ts](./fuzz-parity.test.ts) fuzzes the sync API. The async path is not the
 * same code underneath: it hands `(op, path, data, fdArgs)` to a relay that *re-shapes* the
 * request there, and that second shaping step is exactly where a wire-format bug once lived
 * (`FTRUNCATE` was encoded with a uint32 length on the async side and a float64 everywhere else,
 * so `await fileHandle.truncate(n)` was rejected outright — CHANGELOG 3.3.7).
 *
 * Same method as the sync fuzzer: a random sequence of operations against both filesystems with
 * identical arguments, every outcome compared, then the whole resulting tree — path, type, size,
 * contents, permission bits. Seeds are fixed so a failure reproduces exactly.
 *
 * Excluded for the same reasons as the sync fuzzer: `link` (hard links are copies here) and
 * `cp -r` (node:fs aborts the process on symlink combinations — see cp-symlink-edges.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as nodefs from 'node:fs';
import * as nodefsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFsHarness } from './helpers/engine-transport.js';
import type { VFSFileSystem } from '../src/filesystem.js';

let fs: VFSFileSystem;
let root: string;

beforeEach(() => {
  fs = createFsHarness().fs;
  root = nodefs.mkdtempSync(join(tmpdir(), 'fuzz-async-'));
});
afterEach(() => nodefs.rmSync(root, { recursive: true, force: true }));

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

async function outcome(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    const v = await fn();
    return v === undefined ? 'ok' : v;
  } catch (e) {
    return `ERR:${(e as NodeJS.ErrnoException).code ?? (e as Error).name}`;
  }
}

/** The whole tree as comparable lines — see the sync fuzzer. */
function snapshot(read: {
  readdir: (p: string) => string[];
  lstat: (p: string) => { isDirectory(): boolean; isSymbolicLink(): boolean; size: number; mode: number };
  readFile: (p: string) => string;
  readlink: (p: string) => string;
}): string[] {
  const out: string[] = [];
  for (const rel of read.readdir('').sort()) {
    const st = read.lstat(rel);
    if (st.isSymbolicLink()) out.push(`l ${rel} -> ${read.readlink(rel)}`);
    else if (st.isDirectory()) out.push(`d ${rel} ${(st.mode & 0o777).toString(8)}`);
    else out.push(`f ${rel} ${st.size} ${(st.mode & 0o777).toString(8)} ${read.readFile(rel)}`);
  }
  return out;
}

describe('differential fuzz: the promise API', () => {
  it.each([1, 42, 1337, 90210, 20260611])('seed %d: 200 random async operations stay in lockstep', async (seed) => {
    const rand = rng(seed);
    const real = (p: string) => join(root, p);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
    const p = () => fs.promises;

    const names = ['a', 'b', 'c', 'd'];
    const dirs = ['', 'x', 'y', 'x/z'];
    const somePath = () => { const d = pick(dirs); return d ? `${d}/${pick(names)}` : pick(names); };
    const someDir = () => pick(dirs.filter(Boolean));

    const ops: Array<{ name: string; run: () => Promise<[unknown, unknown]> }> = [
      { name: 'writeFile', run: async () => { const q = somePath(); const c = `v${Math.floor(rand() * 1000)}`;
        return [await outcome(() => p().writeFile('/' + q, c)), await outcome(() => nodefsp.writeFile(real(q), c))]; } },
      { name: 'appendFile', run: async () => { const q = somePath(); const c = `+${Math.floor(rand() * 100)}`;
        return [await outcome(() => p().appendFile('/' + q, c)), await outcome(() => nodefsp.appendFile(real(q), c))]; } },
      { name: 'readFile', run: async () => { const q = somePath();
        return [await outcome(() => p().readFile('/' + q, 'utf8')), await outcome(() => nodefsp.readFile(real(q), 'utf8'))]; } },
      { name: 'mkdir', run: async () => { const q = someDir();
        return [await outcome(() => p().mkdir('/' + q)), await outcome(() => nodefsp.mkdir(real(q)))]; } },
      { name: 'mkdir -p', run: async () => { const q = someDir();
        return [await outcome(async () => (await p().mkdir('/' + q, { recursive: true }))?.replace(/^\//, '')),
                await outcome(async () => (await nodefsp.mkdir(real(q), { recursive: true }))?.slice(root.length + 1))]; } },
      { name: 'readdir', run: async () => { const q = pick(dirs);
        return [await outcome(async () => (await p().readdir('/' + q) as string[]).sort()),
                await outcome(async () => (await nodefsp.readdir(real(q))).sort())]; } },
      { name: 'stat.size', run: async () => { const q = somePath();
        return [await outcome(async () => (await p().stat('/' + q)).size),
                await outcome(async () => (await nodefsp.stat(real(q))).size)]; } },
      { name: 'unlink', run: async () => { const q = somePath();
        return [await outcome(() => p().unlink('/' + q)), await outcome(() => nodefsp.unlink(real(q)))]; } },
      { name: 'rmdir', run: async () => { const q = someDir();
        return [await outcome(() => p().rmdir('/' + q)), await outcome(() => nodefsp.rmdir(real(q)))]; } },
      { name: 'rm -rf', run: async () => { const q = pick([...dirs.filter(Boolean), ...names]);
        return [await outcome(() => p().rm('/' + q, { recursive: true, force: true })),
                await outcome(() => nodefsp.rm(real(q), { recursive: true, force: true }))]; } },
      { name: 'rename', run: async () => { const a = somePath(); const b = somePath();
        return [await outcome(() => p().rename('/' + a, '/' + b)), await outcome(() => nodefsp.rename(real(a), real(b)))]; } },
      { name: 'copyFile', run: async () => { const a = somePath(); const b = somePath();
        return [await outcome(() => p().copyFile('/' + a, '/' + b)), await outcome(() => nodefsp.copyFile(real(a), real(b)))]; } },
      { name: 'truncate', run: async () => { const q = somePath(); const n = Math.floor(rand() * 12);
        return [await outcome(() => p().truncate('/' + q, n)), await outcome(() => nodefsp.truncate(real(q), n))]; } },
      { name: 'chmod', run: async () => { const q = somePath(); const m = pick([0o600, 0o640, 0o644, 0o700, 0o755]);
        return [await outcome(() => p().chmod('/' + q, m)), await outcome(() => nodefsp.chmod(real(q), m))]; } },
      { name: 'symlink', run: async () => { const t = pick(names); const q = somePath();
        return [await outcome(() => p().symlink(t, '/' + q)), await outcome(() => nodefsp.symlink(t, real(q)))]; } },
      { name: 'readlink', run: async () => { const q = somePath();
        return [await outcome(() => p().readlink('/' + q)), await outcome(() => nodefsp.readlink(real(q)))]; } },
      { name: 'access', run: async () => { const q = somePath();
        return [await outcome(() => p().access('/' + q)), await outcome(() => nodefsp.access(real(q)))]; } },

      // --- FileHandle: the path the async relay shapes differently from everything else ---
      { name: 'handle.truncate', run: async () => { const q = somePath(); const n = Math.floor(rand() * 8);
        return [
          await outcome(async () => { const h = await p().open('/' + q, 'r+'); try { await h.truncate(n); } finally { await h.close(); } }),
          await outcome(async () => { const h = await nodefsp.open(real(q), 'r+'); try { await h.truncate(n); } finally { await h.close(); } }),
        ]; } },
      { name: 'handle.write+read', run: async () => { const q = somePath(); const text = `h${Math.floor(rand() * 100)}`;
        return [
          await outcome(async () => { const h = await p().open('/' + q, 'w+');
            try { await h.write(new TextEncoder().encode(text), 0, text.length, 0); return (await h.stat()).size; }
            finally { await h.close(); } }),
          await outcome(async () => { const h = await nodefsp.open(real(q), 'w+');
            try { await h.write(Buffer.from(text), 0, text.length, 0); return (await h.stat()).size; }
            finally { await h.close(); } }),
        ]; } },
      { name: 'handle.readFile', run: async () => { const q = somePath();
        return [
          await outcome(async () => { const h = await p().open('/' + q, 'r'); try { return new TextDecoder().decode(await h.readFile() as Uint8Array); } finally { await h.close(); } }),
          await outcome(async () => { const h = await nodefsp.open(real(q), 'r'); try { return (await h.readFile()).toString(); } finally { await h.close(); } }),
        ]; } },
    ];

    const history: string[] = [];
    for (let i = 0; i < 200; i++) {
      const op = pick(ops);
      const [ours, theirs] = await op.run();
      history.push(`${i}: ${op.name} -> ${JSON.stringify(ours)}`);
      expect(
        ours,
        `seed ${seed}, op ${i} (${op.name}) diverged\nlast ops:\n${history.slice(-8).join('\n')}`
      ).toEqual(theirs);
    }

    const ourSnap = snapshot({
      readdir: () => fs.readdirSync('/', { recursive: true }) as string[],
      lstat: (q) => fs.lstatSync('/' + q) as never,
      readFile: (q) => fs.readFileSync('/' + q, 'utf8') as string,
      readlink: (q) => fs.readlinkSync('/' + q) as string,
    });
    const theirSnap = snapshot({
      readdir: () => nodefs.readdirSync(root, { recursive: true }) as string[],
      lstat: (q) => nodefs.lstatSync(real(q)),
      readFile: (q) => nodefs.readFileSync(real(q), 'utf8'),
      readlink: (q) => nodefs.readlinkSync(real(q)),
    });
    expect(ourSnap.join('\n'), `seed ${seed}: final tree diverged`).toEqual(theirSnap.join('\n'));
  });
});
