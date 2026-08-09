/**
 * `cp` where symlinks are involved — and why this is not a parity target.
 *
 * Two divergences were recorded in 3.3.16 as "cp bugs to fix". Characterising them against real
 * `node:fs` (v24) showed something else: **Node aborts the process** in half these cases, with an
 * uncaught C++ exception rather than a throwable error.
 *
 *   cp(file → existing dangling link)     libc++abi: … filesystem error: in equivalent:
 *                                         Operation not supported
 *   cp -r(dir containing a cyclic link)   libc++abi: … filesystem error: in weakly_canonical:
 *                                         Too many levels of symbolic links
 *
 * Those are not `catch`-able — the process is gone. Matching them is impossible in a browser
 * (the equivalent would be killing the tab) and undesirable if it were possible. The two cases
 * Node *does* handle cleanly are its `equivalent()` same-file check firing on the top-level pair,
 * which is the same check that crashes in the other two.
 *
 * So the decision is to keep our behaviour: total, well-defined, and never fatal. These tests pin
 * that — every combination completes and leaves the filesystem in a sensible state — rather than
 * asserting parity we have deliberately declined. `cp -r` therefore stays out of the differential
 * fuzzer while symlinks are in its operation set, because the fuzzer would abort the runner.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createFsHarness } from './helpers/engine-transport.js';
import type { VFSFileSystem } from '../src/filesystem.js';

let fs: VFSFileSystem;
beforeEach(() => { fs = createFsHarness().fs; });

/** Run and report: the value, or the error code — never a hang, never a crash. */
const outcome = (fn: () => unknown): string => {
  try { fn(); return 'ok'; } catch (e) { return (e as NodeJS.ErrnoException).code ?? 'ERR'; }
};

describe('cp with symlinks completes and stays well-defined', () => {
  it('copying a dangling link copies the link itself', () => {
    fs.symlinkSync('missing', '/dead');
    expect(outcome(() => fs.cpSync('/dead', '/copy'))).toBe('ok');
    expect(fs.lstatSync('/copy').isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync('/copy')).toBe('missing');
  });

  it('copying a cyclic link terminates', () => {
    // Node reports ELOOP here (its same-file check follows the link); we copy the link. Both are
    // defensible; what matters is that this returns at all, which the cyclic case must.
    fs.symlinkSync('a', '/a');
    expect(outcome(() => fs.cpSync('/a', '/b'))).toBe('ok');
    expect(fs.lstatSync('/b').isSymbolicLink()).toBe(true);
  });

  it('copying a tree containing a dangling link preserves it as a link', () => {
    fs.mkdirSync('/src');
    fs.symlinkSync('missing', '/src/dead');
    fs.writeFileSync('/src/ok', 'v');
    expect(outcome(() => fs.cpSync('/src', '/out', { recursive: true }))).toBe('ok');
    expect([...fs.readdirSync('/out')].sort()).toEqual(['dead', 'ok']);
    expect(fs.lstatSync('/out/dead').isSymbolicLink()).toBe(true);
    expect(fs.readFileSync('/out/ok', 'utf8')).toBe('v');
  });

  it('copying a tree containing a cyclic link terminates — Node aborts the process here', () => {
    // The case that makes `cp -r` unusable in the differential fuzzer: real node:fs dies with
    // "weakly_canonical: Too many levels of symbolic links" and takes the runner with it.
    fs.mkdirSync('/s');
    fs.symlinkSync('cyc', '/s/cyc');
    expect(outcome(() => fs.cpSync('/s', '/o', { recursive: true }))).toBe('ok');
    expect(fs.lstatSync('/o/cyc').isSymbolicLink()).toBe(true);
  });

  it('copying onto an existing dangling link terminates — Node aborts the process here too', () => {
    // node:fs dies with "equivalent: Operation not supported".
    fs.writeFileSync('/f', 'v');
    fs.symlinkSync('other', '/link');
    expect(outcome(() => fs.cpSync('/f', '/link'))).toBe('ok');
    expect(fs.readFileSync('/link', 'utf8')).toBe('v');
  });

  it('a tree of links round-trips through cp -r without losing link-ness', () => {
    fs.mkdirSync('/t');
    fs.writeFileSync('/t/target', 'T');
    fs.symlinkSync('target', '/t/link');
    expect(outcome(() => fs.cpSync('/t', '/t2', { recursive: true }))).toBe('ok');
    expect(fs.lstatSync('/t2/link').isSymbolicLink()).toBe(true);
    expect(fs.readFileSync('/t2/link', 'utf8')).toBe('T');
  });
});
