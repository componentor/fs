/**
 * Differential fuzz of the file-descriptor API against `node:fs`.
 *
 * [fuzz-parity.test.ts](./fuzz-parity.test.ts) fuzzes path operations, which are stateless: each
 * call stands alone. File descriptors are the opposite — an fd carries a position and a set of
 * flags that every read and write mutates, so behaviour depends on the *sequence*, and a bug can
 * need a specific interleaving to surface. Nothing fuzzed them.
 *
 * Each step opens, reads, writes, truncates, stats or closes through both filesystems with the
 * same arguments, and compares the result. Between steps the file's whole contents are compared,
 * so a divergence is caught at the operation that caused it rather than at the end.
 *
 * The fd *numbers* are deliberately not compared: they are allocator identities, not semantics,
 * and Node's start above stdio while ours do not. Explicit write positions on append-mode
 * descriptors are also skipped — see the note at that call site; the behaviour differs between
 * Linux and macOS, so comparing there would test the host platform rather than this library.
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
  root = nodefs.mkdtempSync(join(tmpdir(), 'fuzz-fd-'));
});
afterEach(() => nodefs.rmSync(root, { recursive: true, force: true }));

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

const outcome = (fn: () => unknown): unknown => {
  try {
    const v = fn();
    return v === undefined ? 'ok' : v;
  } catch (e) {
    return `ERR:${(e as NodeJS.ErrnoException).code ?? (e as Error).name}`;
  }
};

describe('differential fuzz: file descriptors', () => {
  it.each([1, 42, 1337, 90210, 20260611])('seed %d: 150 fd operations stay in lockstep', (seed) => {
    const rand = rng(seed);
    const real = (p: string) => join(root, p);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];

    const files = ['a.bin', 'b.bin'];
    // 'a' is opened with every flag combination that matters; 'r' on a missing file must fail
    // identically, so both sides start from the same seeded contents.
    for (const f of files) {
      fs.writeFileSync('/' + f, 'seed-contents');
      nodefs.writeFileSync(real(f), 'seed-contents');
    }

    /** Open fds, paired: ours and Node's for the same file and flags. */
    const open: Array<{ ours: number; theirs: number; file: string; append: boolean }> = [];
    const history: string[] = [];

    const record = (label: string, ours: unknown, theirs: unknown) => {
      history.push(`${history.length}: ${label} -> ${JSON.stringify(ours)}`);
      expect(
        ours,
        `seed ${seed} diverged at ${label}\nlast steps:\n${history.slice(-8).join('\n')}`
      ).toEqual(theirs);
    };

    /** Contents of both files must match after every step, not merely at the end. */
    const compareContents = (label: string) => {
      for (const f of files) {
        const ours = outcome(() => fs.readFileSync('/' + f, 'utf8'));
        const theirs = outcome(() => nodefs.readFileSync(real(f), 'utf8'));
        expect(ours, `seed ${seed}: ${f} diverged after ${label}\nlast steps:\n${history.slice(-8).join('\n')}`).toEqual(theirs);
      }
    };

    for (let step = 0; step < 150; step++) {
      const roll = rand();

      if (roll < 0.2 || open.length === 0) {
        const file = pick(files);
        const flags = pick(['r', 'r+', 'w', 'w+', 'a', 'a+']);
        const ours = outcome(() => fs.openSync('/' + file, flags));
        const theirs = outcome(() => nodefs.openSync(real(file), flags));
        // Compare only success-vs-failure: fd numbers are allocator identities.
        record(`open(${file}, ${flags})`, typeof ours === 'number' ? 'opened' : ours,
               typeof theirs === 'number' ? 'opened' : theirs);
        if (typeof ours === 'number' && typeof theirs === 'number') {
          open.push({ ours, theirs, file, append: flags.startsWith('a') });
        }
        compareContents(`open(${file}, ${flags})`);
        continue;
      }

      const fd = pick(open);

      if (roll < 0.45) {
        // Write at an explicit position, or at the fd's own cursor (position null).
        const text = `w${step}`;
        const bytes = new TextEncoder().encode(text);
        // Explicit positions are not exercised on append-mode descriptors: whether O_APPEND
        // overrides an explicit offset is genuinely platform-split. POSIX and macOS honour the
        // position; Linux appends regardless, a deviation its own `man pwrite` documents. We
        // follow Linux, so comparing against macOS Node here would test the platform, not us.
        const position = fd.append ? null : (rand() < 0.5 ? Math.floor(rand() * 20) : null);
        const ours = outcome(() => fs.writeSync(fd.ours, bytes, 0, bytes.length, position));
        const theirs = outcome(() => nodefs.writeSync(fd.theirs, Buffer.from(text), 0, bytes.length, position));
        record(`write(${fd.file}, pos=${position})`, ours, theirs);
        compareContents(`write(${fd.file}, pos=${position})`);
      } else if (roll < 0.7) {
        const len = 1 + Math.floor(rand() * 10);
        const position = rand() < 0.5 ? Math.floor(rand() * 20) : null;
        const ourBuf = new Uint8Array(len);
        const theirBuf = Buffer.alloc(len);
        const ours = outcome(() => fs.readSync(fd.ours, ourBuf, 0, len, position));
        const theirs = outcome(() => nodefs.readSync(fd.theirs, theirBuf, 0, len, position));
        record(`read(${fd.file}, len=${len}, pos=${position})`, ours, theirs);
        // Bytes actually delivered must match, not merely the count.
        if (typeof ours === 'number' && typeof theirs === 'number') {
          expect(Array.from(ourBuf.subarray(0, ours as number)),
            `seed ${seed}: read bytes diverged\nlast steps:\n${history.slice(-8).join('\n')}`)
            .toEqual(Array.from(theirBuf.subarray(0, theirs as number)));
        }
      } else if (roll < 0.8) {
        const len = Math.floor(rand() * 16);
        const ours = outcome(() => fs.ftruncateSync(fd.ours, len));
        const theirs = outcome(() => nodefs.ftruncateSync(fd.theirs, len));
        record(`ftruncate(${fd.file}, ${len})`, ours, theirs);
        compareContents(`ftruncate(${fd.file}, ${len})`);
      } else if (roll < 0.9) {
        const ours = outcome(() => fs.fstatSync(fd.ours).size);
        const theirs = outcome(() => nodefs.fstatSync(fd.theirs).size);
        record(`fstat(${fd.file}).size`, ours, theirs);
      } else {
        const ours = outcome(() => fs.closeSync(fd.ours));
        const theirs = outcome(() => nodefs.closeSync(fd.theirs));
        record(`close(${fd.file})`, ours, theirs);
        open.splice(open.indexOf(fd), 1);
      }
    }

    // Close whatever is still open; a close must not fail on either side.
    for (const fd of open) {
      expect(outcome(() => fs.closeSync(fd.ours))).toEqual(outcome(() => nodefs.closeSync(fd.theirs)));
    }
    compareContents('final');
  });
});
