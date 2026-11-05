/**
 * Differential test: which timestamps an operation changes must match real node:fs.
 *
 * For each scenario the same fixture is built in a temp dir (node:fs) and in the VFS, one
 * operation runs, and for every observed path — the target and the directories involved — we
 * record whether mtime and ctime moved. The two patterns must be identical. atime is left out:
 * node's depends on mount options (relatime/noatime), so it has no portable answer.
 *
 * Node runs on the real clock with a short wait before the operation so a change is visible;
 * the VFS runs on a frozen clock (T0 for setup, T1 for the operation).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as nodefs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFsHarness } from './helpers/engine-transport.js';

type FsLike = typeof nodefs;
interface Scenario {
  name: string;
  /** Paths (relative, no leading slash) to observe before and after; 'a>b' follows a rename. */
  observe: string[];
  op: (fs: FsLike, p: (rel: string) => string) => void;
  setup?: (fs: FsLike, p: (rel: string) => string) => void;
}

// Shared fixture: d/ with files f and g, an empty subdir d/empty, and a second dir e/.
const baseSetup = (fs: FsLike, p: (rel: string) => string) => {
  fs.mkdirSync(p('d'));
  fs.mkdirSync(p('e'));
  fs.mkdirSync(p('d/empty'));
  fs.writeFileSync(p('d/f'), 'x');
  fs.writeFileSync(p('d/g'), 'old');
};

const scenarios: Scenario[] = [
  { name: 'writeFile overwrite', observe: ['d/f', 'd'], op: (fs, p) => fs.writeFileSync(p('d/f'), 'new content') },
  { name: 'writeFile new file', observe: ['d'], op: (fs, p) => fs.writeFileSync(p('d/new'), '1') },
  { name: 'appendFile', observe: ['d/f', 'd'], op: (fs, p) => fs.appendFileSync(p('d/f'), 'more') },
  { name: 'truncate', observe: ['d/f', 'd'], op: (fs, p) => fs.truncateSync(p('d/f'), 0) },
  { name: 'ftruncate', observe: ['d/f'], op: (fs, p) => { const fd = fs.openSync(p('d/f'), 'r+'); fs.ftruncateSync(fd, 0); fs.closeSync(fd); } },
  { name: 'write on an fd', observe: ['d/f'], op: (fs, p) => { const fd = fs.openSync(p('d/f'), 'r+'); fs.writeSync(fd, 'z'); fs.closeSync(fd); } },
  { name: 'open for write without writing', observe: ['d/f'], op: (fs, p) => { const fd = fs.openSync(p('d/f'), 'r+'); fs.closeSync(fd); } },
  { name: 'copyFile onto existing', observe: ['d/g', 'd/f', 'd'], op: (fs, p) => fs.copyFileSync(p('d/f'), p('d/g')) },
  { name: 'copyFile to new', observe: ['d/f', 'd'], op: (fs, p) => fs.copyFileSync(p('d/f'), p('d/c')) },
  { name: 'rename in same dir', observe: ['d'], op: (fs, p) => fs.renameSync(p('d/f'), p('d/r')) },
  { name: 'rename: the renamed file', observe: ['d/f>d/r'], op: (fs, p) => fs.renameSync(p('d/f'), p('d/r')) },
  { name: 'rename: the moved file', observe: ['d/f>e/f'], op: (fs, p) => fs.renameSync(p('d/f'), p('e/f')) },
  { name: 'rename across dirs', observe: ['d', 'e'], op: (fs, p) => fs.renameSync(p('d/f'), p('e/f')) },
  { name: 'rename over an existing file', observe: ['d'], op: (fs, p) => fs.renameSync(p('d/f'), p('d/g')) },
  { name: 'unlink', observe: ['d', 'd/g'], op: (fs, p) => fs.unlinkSync(p('d/f')) },
  { name: 'mkdir', observe: ['d'], op: (fs, p) => fs.mkdirSync(p('d/sub')) },
  { name: 'rmdir', observe: ['d'], op: (fs, p) => fs.rmdirSync(p('d/empty')) },
  { name: 'rm -r', observe: ['.'], op: (fs, p) => fs.rmSync(p('d'), { recursive: true }) },
  { name: 'chmod', observe: ['d/f', 'd'], op: (fs, p) => fs.chmodSync(p('d/f'), 0o600) },
  { name: 'link', observe: ['d/f', 'd'], op: (fs, p) => fs.linkSync(p('d/f'), p('d/l')) },
  { name: 'symlink', observe: ['d', 'd/f'], op: (fs, p) => fs.symlinkSync(p('d/f'), p('d/s')) },
  { name: 'reads', observe: ['d/f', 'd'], op: (fs, p) => { fs.readFileSync(p('d/f')); fs.statSync(p('d/f')); fs.readdirSync(p('d')); fs.existsSync(p('d/f')); fs.accessSync(p('d/f')); } },
];

type Pattern = Record<string, { mtime: boolean; ctime: boolean } | 'missing'>;

const capture = (fs: FsLike, p: (rel: string) => string, paths: string[], side: 0 | 1) =>
  Object.fromEntries(paths.map((key) => {
    const rel = key.split('>')[side] ?? key;
    try { const s = fs.lstatSync(p(rel)); return [key, { m: s.mtimeMs, c: s.ctimeMs }]; } catch { return [key, null]; }
  }));

const diff = (before: any, after: any): Pattern =>
  Object.fromEntries(Object.keys(before).map((k) => [
    k,
    before[k] && after[k] ? { mtime: after[k].m !== before[k].m, ctime: after[k].c !== before[k].c } : 'missing',
  ]));

function nodePattern(s: Scenario): Pattern {
  const dir = nodefs.mkdtempSync(join(tmpdir(), 'ts-parity-'));
  const p = (rel: string) => (rel === '.' ? dir : join(dir, rel));
  try {
    baseSetup(nodefs, p);
    s.setup?.(nodefs, p);
    const before = capture(nodefs, p, s.observe, 0);
    const until = Date.now() + 20; while (Date.now() < until) { /* let the clock move */ }
    s.op(nodefs, p);
    return diff(before, capture(nodefs, p, s.observe, 1));
  } finally {
    nodefs.rmSync(dir, { recursive: true, force: true });
  }
}

function vfsPattern(s: Scenario): Pattern {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_700_000_000_000);
  const { fs } = createFsHarness();
  const p = (rel: string) => (rel === '.' ? '/root' : '/root/' + rel);
  fs.mkdirSync('/root');
  baseSetup(fs as any, p);
  s.setup?.(fs as any, p);
  const before = capture(fs as any, p, s.observe, 0);
  vi.setSystemTime(1_700_000_060_000);
  s.op(fs as any, p);
  return diff(before, capture(fs as any, p, s.observe, 1));
}

afterEach(() => vi.useRealTimers());

describe('timestamp changes match node:fs', () => {
  for (const s of scenarios) {
    it(s.name, () => {
      const node = nodePattern(s);
      expect(vfsPattern(s)).toEqual(node);
    });
  }
});
