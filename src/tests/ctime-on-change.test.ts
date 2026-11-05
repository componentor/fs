/**
 * ctime must change whenever a file's content changes, like node:fs: a write sets mtime and ctime
 * to the same moment. The engine used to set only mtime on every content write (writeFile,
 * appendFile on both paths, truncate, copyFile's destination, fd writes), so ctime stayed at
 * creation time — and anything comparing ctime (isomorphic-git's stat cache does) saw no change.
 *
 * The clock is frozen per step with vi.setSystemTime so each assertion names an exact time.
 * Node itself is used as the oracle for which operations touch which timestamps.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as nodefs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFsHarness } from './helpers/engine-transport.js';

const T0 = 1_700_000_000_000;
const T1 = T0 + 60_000;

let fs: any;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  fs = createFsHarness().fs;
});
afterEach(() => vi.useRealTimers());

const times = (p: string) => { const s = fs.statSync(p); return { mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs }; };
const at = (t: number, fn: () => void) => { vi.setSystemTime(t); fn(); };

describe('ctime follows content changes', () => {
  it('starts equal to mtime at creation', () => {
    fs.writeFileSync('/a', 'x');
    expect(times('/a')).toEqual({ mtimeMs: T0, ctimeMs: T0 });
  });

  const contentChanges: [string, (p: string) => void][] = [
    ['writeFileSync, same size', (p) => fs.writeFileSync(p, 'y')],
    ['writeFileSync, larger (relocates blocks)', (p) => fs.writeFileSync(p, 'z'.repeat(10_000))],
    ['appendFileSync, fits the reserved blocks', (p) => fs.appendFileSync(p, 'more')],
    ['appendFileSync, outgrows them (relocates)', (p) => fs.appendFileSync(p, 'q'.repeat(10_000))],
    ['truncateSync, shrink', (p) => fs.truncateSync(p, 0)],
    ['truncateSync, extend', (p) => fs.truncateSync(p, 5_000)],
    ['ftruncateSync', (p) => { const fd = fs.openSync(p, 'r+'); fs.ftruncateSync(fd, 1); fs.closeSync(fd); }],
    ['writeSync on an fd', (p) => { const fd = fs.openSync(p, 'r+'); fs.writeSync(fd, 'w'); fs.closeSync(fd); }],
    ['writeSync past the end on an fd', (p) => { const fd = fs.openSync(p, 'r+'); fs.writeSync(fd, 'w', 9_000); fs.closeSync(fd); }],
    ['copyFileSync onto an existing destination', (p) => { const now = Date.now(); at(T0, () => fs.writeFileSync('/src', 'copied')); vi.setSystemTime(now); fs.copyFileSync('/src', p); }],
  ];

  for (const [name, change] of contentChanges) {
    it(`${name}: sets mtime and ctime to the same new time`, () => {
      fs.writeFileSync('/a', 'x');
      at(T1, () => change('/a'));
      expect(times('/a')).toEqual({ mtimeMs: T1, ctimeMs: T1 });
    });
  }

  it('rename moves ctime of the renamed file but not its mtime, like node', () => {
    fs.writeFileSync('/a', 'x');
    at(T1, () => fs.renameSync('/a', '/b'));
    expect(times('/b')).toEqual({ mtimeMs: T0, ctimeMs: T1 });
  });

  it('metadata-only changes still move ctime but not mtime', () => {
    fs.writeFileSync('/a', 'x');
    at(T1, () => fs.chmodSync('/a', 0o600));
    expect(times('/a')).toEqual({ mtimeMs: T0, ctimeMs: T1 });
  });

  it('reads leave both alone', () => {
    fs.writeFileSync('/a', 'x');
    at(T1, () => { fs.readFileSync('/a'); fs.statSync('/a'); fs.readdirSync('/'); });
    expect(times('/a')).toEqual({ mtimeMs: T0, ctimeMs: T0 });
  });
});

describe('node:fs agrees (oracle)', () => {
  it('a write moves ctime together with mtime', () => {
    vi.useRealTimers();
    const dir = nodefs.mkdtempSync(join(tmpdir(), 'ctime-'));
    const f = join(dir, 'a');
    try {
      nodefs.writeFileSync(f, 'x');
      const before = nodefs.statSync(f);
      const until = Date.now() + 25; while (Date.now() < until) { /* let the clock move */ }
      nodefs.appendFileSync(f, 'y');
      const after = nodefs.statSync(f);
      expect(after.mtimeMs).toBeGreaterThan(before.mtimeMs);
      expect(after.ctimeMs).toBeGreaterThan(before.ctimeMs);
      expect(after.ctimeMs).toBe(after.mtimeMs);
    } finally {
      nodefs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
