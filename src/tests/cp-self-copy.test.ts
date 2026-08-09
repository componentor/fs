/**
 * `cp` must refuse to copy something onto itself or into its own subtree.
 *
 * The subtree case is not a nicety: an unguarded recursive copy recreates the destination inside
 * itself on every pass and **never terminates** — it hung the test runner for four minutes when
 * the differential fuzzer first produced it, and in a browser that is a frozen tab and a filling
 * disk. The drives layer guarded this in 3.3.0; `VFSFileSystem.cp` did not until 3.3.16.
 *
 * Found by [fuzz-parity.test.ts](./fuzz-parity.test.ts) generating the combination, which is
 * exactly what hand-written cases had missed for two releases.
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
  root = nodefs.mkdtempSync(join(tmpdir(), 'cp-self-'));
  fs.mkdirSync('/x');
  fs.writeFileSync('/x/f', 'v');
  fs.mkdirSync('/x/deep');
  nodefs.mkdirSync(join(root, 'x'));
  nodefs.writeFileSync(join(root, 'x/f'), 'v');
  nodefs.mkdirSync(join(root, 'x/deep'));
});
afterEach(() => nodefs.rmSync(root, { recursive: true, force: true }));

const codeOf = (fn: () => unknown): string => {
  try { fn(); return 'ok'; } catch (e) { return (e as NodeJS.ErrnoException).code ?? 'ERR'; }
};
const real = (p: string) => join(root, p);

describe('cpSync self-copy guards', () => {
  it('refuses a directory onto itself, with the same code as node:fs', () => {
    expect(codeOf(() => fs.cpSync('/x', '/x', { recursive: true })))
      .toBe(codeOf(() => nodefs.cpSync(real('x'), real('x'), { recursive: true })));
    expect(codeOf(() => fs.cpSync('/x', '/x', { recursive: true }))).toBe('ERR_FS_CP_EINVAL');
  });

  it('refuses a file onto itself', () => {
    expect(codeOf(() => fs.cpSync('/x/f', '/x/f')))
      .toBe(codeOf(() => nodefs.cpSync(real('x/f'), real('x/f'))));
    expect(codeOf(() => fs.cpSync('/x/f', '/x/f'))).toBe('ERR_FS_CP_EINVAL');
  });

  it('refuses a directory into its own immediate subtree, and terminates', () => {
    // The non-terminating case. If the guard regresses this test hangs rather than fails, which
    // is why the assertion is on the error code and not merely on "did not throw something else".
    expect(codeOf(() => fs.cpSync('/x', '/x/z', { recursive: true }))).toBe('ERR_FS_CP_EINVAL');
    expect(codeOf(() => nodefs.cpSync(real('x'), real('x/z'), { recursive: true }))).toBe('ERR_FS_CP_EINVAL');
    expect(fs.existsSync('/x/z'), 'nothing should have been copied').toBe(false);
  });

  it('refuses a directory into a deeper part of its own subtree', () => {
    expect(codeOf(() => fs.cpSync('/x', '/x/deep/z', { recursive: true }))).toBe('ERR_FS_CP_EINVAL');
    expect(codeOf(() => nodefs.cpSync(real('x'), real('x/deep/z'), { recursive: true }))).toBe('ERR_FS_CP_EINVAL');
  });

  it('still allows a sibling whose name merely shares a prefix', () => {
    // '/xy' is not inside '/x'; a naive startsWith check without the separator would reject it.
    fs.mkdirSync('/xy');
    fs.writeFileSync('/xy/g', 'w');
    nodefs.mkdirSync(real('xy'));
    nodefs.writeFileSync(real('xy/g'), 'w');
    expect(codeOf(() => fs.cpSync('/x', '/xy2', { recursive: true }))).toBe('ok');
    expect(codeOf(() => nodefs.cpSync(real('x'), real('xy2'), { recursive: true }))).toBe('ok');
    expect(fs.readFileSync('/xy2/f', 'utf8')).toBe('v');
  });

  it('still allows an ordinary copy elsewhere', () => {
    expect(codeOf(() => fs.cpSync('/x', '/y', { recursive: true }))).toBe('ok');
    expect([...fs.readdirSync('/y')].sort()).toEqual(['deep', 'f']);
  });
});

describe('promises.cp self-copy guards', () => {
  const codeOfAsync = async (fn: () => Promise<unknown>): Promise<string> => {
    try { await fn(); return 'ok'; } catch (e) { return (e as NodeJS.ErrnoException).code ?? 'ERR'; }
  };

  it('refuses self and subtree copies, and allows ordinary ones', async () => {
    expect(await codeOfAsync(() => fs.promises.cp('/x', '/x', { recursive: true }))).toBe('ERR_FS_CP_EINVAL');
    expect(await codeOfAsync(() => fs.promises.cp('/x', '/x/z', { recursive: true }))).toBe('ERR_FS_CP_EINVAL');
    expect(await codeOfAsync(() => fs.promises.cp('/x', '/ok', { recursive: true }))).toBe('ok');
    expect([...fs.readdirSync('/ok')].sort()).toEqual(['deep', 'f']);
  });
});
