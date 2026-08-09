/**
 * *When* a bad path argument is reported, not just what the error is.
 *
 * Node's three APIs disagree, and each difference is observable:
 *
 *   • `fs.statSync(123)`      throws
 *   • `fs.stat(123, cb)`      **throws at the call site** — it does not reach the callback
 *   • `fsPromises.stat(123)`  returns a **rejected promise** — it does not throw
 *
 * Every promise method here used to throw synchronously, because the class methods were not
 * `async` and `toPathString` ran before any promise existed. That breaks the ordinary
 * `fsp.stat(p).catch(…)` form: the exception escapes past the `.catch`, and in a browser it
 * surfaces as an uncaught error rather than a handled rejection.
 *
 * The codes are checked alongside the timing — `toPathString` carries `ERR_INVALID_ARG_TYPE`,
 * as node's does, so callers can branch on the code instead of matching message text.
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
  root = nodefs.mkdtempSync(join(tmpdir(), 'argval-'));
});
afterEach(() => nodefs.rmSync(root, { recursive: true, force: true }));

/** A value that is not a path and — crucially — not an int32, so it is never read as an fd. */
const BAD = {} as never;

type P = Record<string, (...a: never[]) => unknown>;

/** Every promise method that takes a path, with the arguments that follow it. */
const PROMISE_CALLS: Array<[string, (p: P) => unknown]> = [
  ['readFile', (p) => p.readFile(BAD)],
  ['writeFile', (p) => p.writeFile(BAD, 'x' as never)],
  ['appendFile', (p) => p.appendFile(BAD, 'x' as never)],
  ['mkdir', (p) => p.mkdir(BAD)],
  ['rmdir', (p) => p.rmdir(BAD)],
  ['rm', (p) => p.rm(BAD)],
  ['unlink', (p) => p.unlink(BAD)],
  ['readdir', (p) => p.readdir(BAD)],
  ['stat', (p) => p.stat(BAD)],
  ['lstat', (p) => p.lstat(BAD)],
  ['access', (p) => p.access(BAD)],
  ['rename', (p) => p.rename(BAD, BAD)],
  ['copyFile', (p) => p.copyFile(BAD, BAD)],
  ['truncate', (p) => p.truncate(BAD)],
  ['chmod', (p) => p.chmod(BAD, 0o644 as never)],
  ['chown', (p) => p.chown(BAD, 1 as never, 1 as never)],
  ['utimes', (p) => p.utimes(BAD, 1 as never, 1 as never)],
  ['lchmod', (p) => p.lchmod(BAD, 0o644 as never)],
  ['lchown', (p) => p.lchown(BAD, 1 as never, 1 as never)],
  ['lutimes', (p) => p.lutimes(BAD, 1 as never, 1 as never)],
  ['symlink', (p) => p.symlink('t' as never, BAD)],
  ['readlink', (p) => p.readlink(BAD)],
  ['link', (p) => p.link(BAD, BAD)],
  ['open', (p) => p.open(BAD)],
  ['opendir', (p) => p.opendir(BAD)],
  ['mkdtemp', (p) => p.mkdtemp(BAD)],
  ['statfs', (p) => p.statfs(BAD)],
  ['cp', (p) => p.cp(BAD, BAD)],
];

describe('the promise API rejects rather than throwing', () => {
  it.each(PROMISE_CALLS)('promises.%s returns a rejected promise', async (name, call) => {
    let returned: unknown;
    expect(
      () => { returned = call(fs.promises as unknown as P); },
      `promises.${name} threw synchronously; node returns a rejected promise`
    ).not.toThrow();

    expect(returned, `promises.${name} did not return a promise`).toBeInstanceOf(Promise);
    await expect(returned as Promise<unknown>).rejects.toThrow();
  });

  it.each(PROMISE_CALLS)('node:fs/promises.%s does the same', async (name, call) => {
    // The reference half of the pair: confirms the expectation above is node's behaviour and
    // not an assumption, for every method in the table.
    let returned: unknown;
    expect(() => { returned = call(nodefsp as unknown as P); }, `node ${name}`).not.toThrow();
    await expect(returned as Promise<unknown>).rejects.toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' })
    );
  });

  it('a rejection is catchable with .catch(), the form that used to break', async () => {
    let caught: unknown = null;
    await (fs.promises.stat(BAD) as Promise<unknown>).catch((e) => { caught = e; });
    expect(caught).toBeInstanceOf(TypeError);
    expect((caught as NodeJS.ErrnoException).code).toBe('ERR_INVALID_ARG_TYPE');
  });
});

describe('the callback API throws at the call site, as node does', () => {
  const CALLBACK_CALLS: Array<[string, (f: P, cb: () => void) => unknown]> = [
    ['readFile', (f, cb) => f.readFile(BAD, cb as never)],
    ['writeFile', (f, cb) => f.writeFile(BAD, 'x' as never, cb as never)],
    ['appendFile', (f, cb) => f.appendFile(BAD, 'x' as never, cb as never)],
    ['mkdir', (f, cb) => f.mkdir(BAD, cb as never)],
    ['rmdir', (f, cb) => f.rmdir(BAD, cb as never)],
    ['rm', (f, cb) => f.rm(BAD, cb as never)],
    ['unlink', (f, cb) => f.unlink(BAD, cb as never)],
    ['readdir', (f, cb) => f.readdir(BAD, cb as never)],
    ['stat', (f, cb) => f.stat(BAD, cb as never)],
    ['lstat', (f, cb) => f.lstat(BAD, cb as never)],
    ['access', (f, cb) => f.access(BAD, cb as never)],
    ['rename', (f, cb) => f.rename(BAD, BAD, cb as never)],
    ['copyFile', (f, cb) => f.copyFile(BAD, BAD, cb as never)],
    ['truncate', (f, cb) => f.truncate(BAD, cb as never)],
    ['chmod', (f, cb) => f.chmod(BAD, 0o644 as never, cb as never)],
    ['chown', (f, cb) => f.chown(BAD, 1 as never, 1 as never, cb as never)],
    ['utimes', (f, cb) => f.utimes(BAD, 1 as never, 1 as never, cb as never)],
    ['symlink', (f, cb) => f.symlink('t' as never, BAD, cb as never)],
    ['readlink', (f, cb) => f.readlink(BAD, cb as never)],
    ['link', (f, cb) => f.link(BAD, BAD, cb as never)],
    ['open', (f, cb) => f.open(BAD, cb as never)],
  ];

  it.each(CALLBACK_CALLS)('fs.%s(bad, cb) throws instead of calling back', (name, call) => {
    let calledBack = false;
    expect(
      () => call(fs as unknown as P, () => { calledBack = true; }),
      `fs.${name} did not throw at the call site`
    ).toThrow(expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' }));
    expect(calledBack, `fs.${name} also invoked the callback`).toBe(false);
  });

  it.each(CALLBACK_CALLS)('node fs.%s(bad, cb) does the same', (name, call) => {
    expect(() => call(nodefs as unknown as P, () => {}), `node ${name}`).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' })
    );
  });
});

describe('the sync API throws with node’s code', () => {
  it.each([
    ['readFileSync', (f: P) => f.readFileSync(BAD)],
    ['writeFileSync', (f: P) => f.writeFileSync(BAD, 'x' as never)],
    ['statSync', (f: P) => f.statSync(BAD)],
    ['mkdirSync', (f: P) => f.mkdirSync(BAD)],
    ['readdirSync', (f: P) => f.readdirSync(BAD)],
    ['unlinkSync', (f: P) => f.unlinkSync(BAD)],
    ['mkdtempSync', (f: P) => f.mkdtempSync(BAD)],
    ['statfsSync', (f: P) => f.statfsSync(BAD)],
    ['lchmodSync', (f: P) => f.lchmodSync(BAD, 0o644 as never)],
    ['lutimesSync', (f: P) => f.lutimesSync(BAD, 1 as never, 1 as never)],
  ])('%s carries ERR_INVALID_ARG_TYPE', (_name, call) => {
    expect(() => call(fs as unknown as P)).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' })
    );
  });
});

describe('realpath is node’s one exception to path validation', () => {
  // Verified against node:fs — `realpath` is the only method that stringifies its argument
  // instead of type-checking it. Rejecting these would make working node code fail here.
  it('resolves anything with a useful toString, as node does', () => {
    fs.mkdirSync('/d');
    nodefs.mkdirSync(join(root, 'd'));
    expect(fs.realpathSync({ toString: () => '/d' } as never)).toBe('/d');
    expect(nodefs.realpathSync({ toString: () => join(root, 'd') } as never))
      .toBe(nodefs.realpathSync(join(root, 'd')));
  });

  it('reports ENOENT for a non-path value rather than a type error', () => {
    const code = (fn: () => unknown) => {
      try { fn(); return 'no-throw'; } catch (e) { return (e as NodeJS.ErrnoException).code; }
    };
    expect(code(() => fs.realpathSync(BAD))).toBe('ENOENT');
    expect(code(() => nodefs.realpathSync(BAD))).toBe('ENOENT');
  });

  it('rejects rather than throwing on the promise API', async () => {
    let returned: unknown;
    expect(() => { returned = fs.promises.realpath(BAD); }).not.toThrow();
    await expect(returned as Promise<unknown>).rejects.toThrow(
      expect.objectContaining({ code: 'ENOENT' })
    );
  });
});

describe('paths that are valid but unusual still work', () => {
  // The validation above must not have narrowed what a path may be.
  it('accepts Uint8Array and file: URL paths on the widened methods', () => {
    fs.mkdirSync('/d');
    fs.writeFileSync('/d/f', 'body');

    const asBytes = new TextEncoder().encode('/d/f');
    expect(fs.readFileSync(asBytes, 'utf8')).toBe('body');

    fs.lchmodSync(asBytes, 0o600);
    expect(fs.lstatSync('/d/f').mode & 0o777).toBe(0o600);

    fs.lutimesSync(asBytes, 1_600_000_000, 1_600_000_000);
    expect(fs.statfsSync(asBytes).bsize).toBeGreaterThan(0);

    const url = new URL('file:///d/f');
    expect(fs.readFileSync(url, 'utf8')).toBe('body');
  });

  it('mkdtemp accepts a Uint8Array prefix', () => {
    fs.mkdirSync('/tmp2');
    const made = fs.mkdtempSync(new TextEncoder().encode('/tmp2/x-')) as string;
    expect(made.startsWith('/tmp2/x-')).toBe(true);
    expect(fs.statSync(made).isDirectory()).toBe(true);
  });
});
