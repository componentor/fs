/**
 * Differential fuzz against `node:fs`.
 *
 * The hand-written parity suites check operations someone thought to write down. This runs a
 * random sequence of operations against **both** filesystems with identical arguments, compares
 * the outcome of every single one, and then compares the entire resulting tree — every path,
 * type, size, content and permission bit. Bugs that need a particular *order* of operations to
 * appear are exactly what hand-written cases miss and this finds.
 *
 * Seeds are fixed so any failure is reproducible from the seed alone, and the failing operation
 * is reported with the sequence that produced it.
 *
 * Deliberately excluded, because they are documented divergences rather than bugs to discover:
 *  - `link`: hard links are copies here (see "Known divergences" in the readme), so the trees
 *    diverge by design after any write through a linked name.
 *  - timestamps, inode numbers, and `nlink`: not comparable between two filesystems.
 *  - `cp -r`, permanently, while symlinks are in the operation set — because **node:fs aborts
 *    the process** on two of the combinations the fuzzer generates: copying onto an existing
 *    dangling link ("equivalent: Operation not supported") and copying a tree containing a
 *    cyclic link ("weakly_canonical: Too many levels of symbolic links"). Those are uncaught C++
 *    exceptions, not throwable errors, so a single unlucky seed would kill the runner rather
 *    than report a divergence. Evidence and our (total, never-fatal) behaviour are in
 *    cp-symlink-edges.test.ts; `cp` is otherwise covered by cp-self-copy.test.ts,
 *    instance-parity.spec.ts and overload-audit-sync.test.ts.
 *
 * Symlinks themselves are back in (3.3.17): the dangling-write divergence they exposed is fixed,
 * and symlink *cycles* — which the name pool can generate — are compared like anything else.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as nodefs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFsHarness } from './helpers/engine-transport.js';
import type { VFSFileSystem } from '../src/filesystem.js';

let fs: VFSFileSystem;
let root: string;

beforeEach(() => {
  fs = createFsHarness().fs;
  root = nodefs.mkdtempSync(join(tmpdir(), 'fuzz-parity-'));
});
afterEach(() => nodefs.rmSync(root, { recursive: true, force: true }));

/** Deterministic PRNG — a failing seed reproduces exactly. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

/** Outcome of one operation: its value, or the error code, so both sides compare equal. */
function outcome(fn: () => unknown): unknown {
  try {
    const v = fn();
    return v === undefined ? 'ok' : v;
  } catch (e) {
    return `ERR:${(e as NodeJS.ErrnoException).code ?? (e as Error).name}`;
  }
}

/**
 * The whole tree as comparable lines: type, path, and for files their size, contents and mode.
 *
 * Walks with `readdirSync({recursive: true})` on both sides so the listing itself is part of
 * what is compared, not just the files it happens to find.
 */
function snapshot(read: {
  readdir: (p: string) => string[];
  lstat: (p: string) => { isDirectory(): boolean; isSymbolicLink(): boolean; size: number; mode: number };
  readFile: (p: string) => string;
  readlink: (p: string) => string;
}, base: string): string[] {
  const out: string[] = [];
  for (const rel of read.readdir(base).sort()) {
    const full = base === '' ? rel : `${base}/${rel}`;
    const st = read.lstat(full);
    if (st.isSymbolicLink()) out.push(`l ${rel} -> ${read.readlink(full)}`);
    else if (st.isDirectory()) out.push(`d ${rel} ${(st.mode & 0o777).toString(8)}`);
    else out.push(`f ${rel} ${st.size} ${(st.mode & 0o777).toString(8)} ${read.readFile(full)}`);
  }
  return out;
}

describe('differential fuzz against node:fs', () => {
  it.each([1, 42, 1337, 90210, 20260611])('seed %d: 250 random operations stay in lockstep', (seed) => {
    const rand = rng(seed);
    const real = (p: string) => join(root, p);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];

    // A small fixed name pool so operations collide often — collisions are where the
    // interesting behaviour (EEXIST, ENOTEMPTY, overwrite, rename-onto) lives.
    const names = ['a', 'b', 'c', 'd', 'e'];

    const dirs = ['', 'x', 'y', 'x/z'];
    const somePath = () => {
      const d = pick(dirs);
      return d ? `${d}/${pick(names)}` : pick(names);
    };
    const someDir = () => pick(dirs.filter(Boolean));

    const ops: Array<{ name: string; run: () => [unknown, unknown] }> = [
      { name: 'writeFile', run: () => { const p = somePath(); const c = `v${Math.floor(rand() * 1000)}`;
        return [outcome(() => fs.writeFileSync('/' + p, c)), outcome(() => nodefs.writeFileSync(real(p), c))]; } },
      { name: 'appendFile', run: () => { const p = somePath(); const c = `+${Math.floor(rand() * 100)}`;
        return [outcome(() => fs.appendFileSync('/' + p, c)), outcome(() => nodefs.appendFileSync(real(p), c))]; } },
      { name: 'mkdir', run: () => { const p = someDir();
        return [outcome(() => fs.mkdirSync('/' + p)), outcome(() => nodefs.mkdirSync(real(p)))]; } },
      { name: 'mkdir -p', run: () => { const p = someDir();
        return [outcome(() => fs.mkdirSync('/' + p, { recursive: true })?.replace(/^\//, '')),
                outcome(() => nodefs.mkdirSync(real(p), { recursive: true })?.slice(root.length + 1))]; } },
      { name: 'readdir', run: () => { const p = pick(dirs);
        return [outcome(() => (fs.readdirSync('/' + p) as string[]).sort()),
                outcome(() => nodefs.readdirSync(real(p)).sort())]; } },
      { name: 'stat.size', run: () => { const p = somePath();
        return [outcome(() => fs.statSync('/' + p).size), outcome(() => nodefs.statSync(real(p)).size)]; } },
      { name: 'unlink', run: () => { const p = somePath();
        return [outcome(() => fs.unlinkSync('/' + p)), outcome(() => nodefs.unlinkSync(real(p)))]; } },
      { name: 'rmdir', run: () => { const p = someDir();
        return [outcome(() => fs.rmdirSync('/' + p)), outcome(() => nodefs.rmdirSync(real(p)))]; } },
      { name: 'rm -rf', run: () => { const p = pick([...dirs.filter(Boolean), ...names]);
        return [outcome(() => fs.rmSync('/' + p, { recursive: true, force: true })),
                outcome(() => nodefs.rmSync(real(p), { recursive: true, force: true }))]; } },
      { name: 'rename', run: () => { const a = somePath(); const b = somePath();
        return [outcome(() => fs.renameSync('/' + a, '/' + b)), outcome(() => nodefs.renameSync(real(a), real(b)))]; } },
      { name: 'copyFile', run: () => { const a = somePath(); const b = somePath();
        return [outcome(() => fs.copyFileSync('/' + a, '/' + b)), outcome(() => nodefs.copyFileSync(real(a), real(b)))]; } },
      { name: 'truncate', run: () => { const p = somePath(); const n = Math.floor(rand() * 12);
        return [outcome(() => fs.truncateSync('/' + p, n)), outcome(() => nodefs.truncateSync(real(p), n))]; } },
      { name: 'chmod', run: () => { const p = somePath(); const m = pick([0o600, 0o640, 0o644, 0o700, 0o755]);
        return [outcome(() => fs.chmodSync('/' + p, m)), outcome(() => nodefs.chmodSync(real(p), m))]; } },
      { name: 'symlink', run: () => { const target = pick(names); const p = somePath();
        return [outcome(() => fs.symlinkSync(target, '/' + p)), outcome(() => nodefs.symlinkSync(target, real(p)))]; } },
      { name: 'readlink', run: () => { const p = somePath();
        return [outcome(() => fs.readlinkSync('/' + p)), outcome(() => nodefs.readlinkSync(real(p)))]; } },
      // `cp -r` is deliberately absent — see the header. It is covered by cp-self-copy.test.ts,
      // instance-parity.spec.ts and overload-audit-sync.test.ts.
      { name: 'exists', run: () => { const p = somePath();
        return [outcome(() => fs.existsSync('/' + p)), outcome(() => nodefs.existsSync(real(p)))]; } },
    ];

    const history: string[] = [];
    for (let i = 0; i < 250; i++) {
      const op = pick(ops);
      const [ours, theirs] = op.run();
      history.push(`${i}: ${op.name} -> ${JSON.stringify(ours)}`);
      expect(
        ours,
        `seed ${seed}, op ${i} (${op.name}) diverged\nlast ops:\n${history.slice(-8).join('\n')}`
      ).toEqual(theirs);
    }

    // Whole-tree comparison: catches state that drifted without any single op reporting it.
    const ourSnap = snapshot({
      readdir: (p) => fs.readdirSync('/' + p, { recursive: true }) as string[],
      lstat: (p) => fs.lstatSync('/' + p) as never,
      readFile: (p) => fs.readFileSync('/' + p, 'utf8') as string,
      readlink: (p) => fs.readlinkSync('/' + p) as string,
    }, '');
    const theirSnap = snapshot({
      readdir: (p) => nodefs.readdirSync(real(p), { recursive: true }) as string[],
      lstat: (p) => nodefs.lstatSync(real(p)),
      readFile: (p) => nodefs.readFileSync(real(p), 'utf8'),
      readlink: (p) => nodefs.readlinkSync(real(p)),
    }, '');

    // Compared as one string so a divergence prints the whole tree rather than a truncated
    // array — the entry that differs is the entire point of the failure message.
    expect(ourSnap.join('\n'), `seed ${seed}: final tree diverged`).toEqual(theirSnap.join('\n'));
  });
});
