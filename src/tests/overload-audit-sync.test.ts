/**
 * Argument-overload audit for the sync and promise APIs, differential against `node:fs`.
 *
 * [overload-audit.test.ts](./overload-audit.test.ts) swept the *callback* signatures and found
 * three methods broken in an argument position Node's docs lead with. The sync and promise
 * variants take the same optional-middle arguments — `readFileSync(path[, options])`,
 * `open(path[, flags[, mode]])` — and had never been swept.
 *
 * Unlike the callback audit, these can be checked against the real thing: every form is run
 * through the full library stack **and** through `node:fs` on a temp directory, and the results
 * compared. So this verifies each form is accepted *and* that it does what Node does with it.
 *
 * The library object is a real `VFSFileSystem` whose transport is an in-process engine — see
 * `createFsHarness`. That reaches instance-level methods (`cpSync`, `opendirSync`) which
 * previously needed a browser.
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
  root = nodefs.mkdtempSync(join(tmpdir(), 'overload-'));
});
afterEach(() => nodefs.rmSync(root, { recursive: true, force: true }));

const real = (p: string) => join(root, p);

/** Run both sides, comparing the value or the thrown error's code. */
function same<T>(ours: () => T, theirs: () => T, label: string) {
  const run = <R>(fn: () => R): R | string => {
    try { return fn(); } catch (e) { return `ERR:${(e as NodeJS.ErrnoException).code ?? (e as Error).name}`; }
  };
  expect(run(ours), label).toEqual(run(theirs));
}

const text = (v: unknown) => (typeof v === 'string' ? v : new TextDecoder().decode(v as Uint8Array));

describe('sync overloads: every documented form behaves as in node:fs', () => {
  it('readFileSync(path) / (path, encoding) / (path, {encoding})', () => {
    fs.writeFileSync('/f', 'contents');
    nodefs.writeFileSync(real('f'), 'contents');
    same(() => Array.from(fs.readFileSync('/f') as Uint8Array), () => Array.from(nodefs.readFileSync(real('f'))), 'no options → bytes');
    same(() => fs.readFileSync('/f', 'utf8'), () => nodefs.readFileSync(real('f'), 'utf8'), 'string encoding');
    same(() => fs.readFileSync('/f', { encoding: 'utf8' }), () => nodefs.readFileSync(real('f'), { encoding: 'utf8' }), 'options object');
  });

  it('writeFileSync(p, d) / (p, d, encoding) / (p, d, {encoding})', () => {
    same(() => { fs.writeFileSync('/a', 'x'); return text(fs.readFileSync('/a', 'utf8')); },
         () => { nodefs.writeFileSync(real('a'), 'x'); return nodefs.readFileSync(real('a'), 'utf8'); }, 'no options');
    same(() => { fs.writeFileSync('/b', 'é', 'latin1'); return Array.from(fs.readFileSync('/b') as Uint8Array); },
         () => { nodefs.writeFileSync(real('b'), 'é', 'latin1'); return Array.from(nodefs.readFileSync(real('b'))); }, 'string encoding');
    same(() => { fs.writeFileSync('/c', 'é', { encoding: 'latin1' }); return Array.from(fs.readFileSync('/c') as Uint8Array); },
         () => { nodefs.writeFileSync(real('c'), 'é', { encoding: 'latin1' }); return Array.from(nodefs.readFileSync(real('c'))); }, 'options object');
  });

  it('mkdirSync(p) / (p, mode) / (p, {recursive}) / (p, {mode})', () => {
    same(() => { fs.mkdirSync('/a'); return fs.statSync('/a').mode & 0o777; },
         () => { nodefs.mkdirSync(real('a')); return nodefs.statSync(real('a')).mode & 0o777; }, 'no options');
    same(() => { fs.mkdirSync('/b', 0o700); return fs.statSync('/b').mode & 0o777; },
         () => { nodefs.mkdirSync(real('b'), 0o700); return nodefs.statSync(real('b')).mode & 0o777; }, 'numeric mode shorthand');
    same(() => { fs.mkdirSync('/c/d/e', { recursive: true }); return fs.statSync('/c/d/e').isDirectory(); },
         () => { nodefs.mkdirSync(real('c/d/e'), { recursive: true }); return nodefs.statSync(real('c/d/e')).isDirectory(); }, 'recursive');
    same(() => { fs.mkdirSync('/g', { mode: 0o700 }); return fs.statSync('/g').mode & 0o777; },
         () => { nodefs.mkdirSync(real('g'), { mode: 0o700 }); return nodefs.statSync(real('g')).mode & 0o777; }, 'options mode');
  });

  it('readdirSync(p) / (p, encoding) / (p, {withFileTypes}) / (p, {recursive})', () => {
    const setup = (mk: (p: string) => void, wr: (p: string) => void) => { mk('d'); mk('d/sub'); wr('d/f.txt'); wr('d/sub/g.txt'); };
    setup((p) => fs.mkdirSync('/' + p), (p) => fs.writeFileSync('/' + p, ''));
    setup((p) => nodefs.mkdirSync(real(p)), (p) => nodefs.writeFileSync(real(p), ''));

    same(() => [...fs.readdirSync('/d')].sort(), () => nodefs.readdirSync(real('d')).sort(), 'no options');
    same(() => [...fs.readdirSync('/d', 'utf8')].sort(), () => nodefs.readdirSync(real('d'), 'utf8').sort(), 'string encoding');
    same(() => (fs.readdirSync('/d', { withFileTypes: true }) as nodefs.Dirent[]).map((d) => `${d.name}:${d.isDirectory()}`).sort(),
         () => nodefs.readdirSync(real('d'), { withFileTypes: true }).map((d) => `${d.name}:${d.isDirectory()}`).sort(), 'withFileTypes');
    same(() => [...fs.readdirSync('/d', { recursive: true })].sort(), () => nodefs.readdirSync(real('d'), { recursive: true }).sort(), 'recursive');
  });

  it('statSync(p) / (p, {bigint})', () => {
    fs.writeFileSync('/f', 'abc');
    nodefs.writeFileSync(real('f'), 'abc');
    same(() => fs.statSync('/f').size, () => nodefs.statSync(real('f')).size, 'no options');
    same(() => (fs.statSync('/f', { bigint: true }) as nodefs.BigIntStats).size,
         () => nodefs.statSync(real('f'), { bigint: true }).size, 'bigint');
  });

  it('rmSync(p) / (p, {recursive}) / (p, {force})', () => {
    same(() => { fs.writeFileSync('/f', 'x'); fs.rmSync('/f'); return fs.existsSync('/f'); },
         () => { nodefs.writeFileSync(real('f'), 'x'); nodefs.rmSync(real('f')); return nodefs.existsSync(real('f')); }, 'no options');
    same(() => { fs.mkdirSync('/d'); fs.writeFileSync('/d/x', ''); fs.rmSync('/d', { recursive: true }); return fs.existsSync('/d'); },
         () => { nodefs.mkdirSync(real('d')); nodefs.writeFileSync(real('d/x'), ''); nodefs.rmSync(real('d'), { recursive: true }); return nodefs.existsSync(real('d')); }, 'recursive');
    same(() => fs.rmSync('/nope', { force: true }), () => nodefs.rmSync(real('nope'), { force: true }), 'force on missing');
  });

  it('openSync(p) / (p, flags) / (p, flags, mode)', () => {
    fs.writeFileSync('/f', 'x');
    nodefs.writeFileSync(real('f'), 'x');
    same(() => { const fd = fs.openSync('/f'); fs.closeSync(fd); return 'ok'; },
         () => { const fd = nodefs.openSync(real('f')); nodefs.closeSync(fd); return 'ok'; }, 'flags omitted defaults to r');
    same(() => { const fd = fs.openSync('/g', 'w'); fs.closeSync(fd); return fs.existsSync('/g'); },
         () => { const fd = nodefs.openSync(real('g'), 'w'); nodefs.closeSync(fd); return nodefs.existsSync(real('g')); }, 'flags');
    same(() => { const fd = fs.openSync('/h', 'w', 0o600); fs.closeSync(fd); return fs.statSync('/h').mode & 0o777; },
         () => { const fd = nodefs.openSync(real('h'), 'w', 0o600); nodefs.closeSync(fd); return nodefs.statSync(real('h')).mode & 0o777; }, 'flags + mode');
  });

  it('truncateSync(p) / (p, len)', () => {
    same(() => { fs.writeFileSync('/a', 'abcdef'); fs.truncateSync('/a'); return fs.statSync('/a').size; },
         () => { nodefs.writeFileSync(real('a'), 'abcdef'); nodefs.truncateSync(real('a')); return nodefs.statSync(real('a')).size; }, 'len omitted → 0');
    same(() => { fs.writeFileSync('/b', 'abcdef'); fs.truncateSync('/b', 3); return text(fs.readFileSync('/b', 'utf8')); },
         () => { nodefs.writeFileSync(real('b'), 'abcdef'); nodefs.truncateSync(real('b'), 3); return nodefs.readFileSync(real('b'), 'utf8'); }, 'explicit len');
  });

  it('accessSync(p) / (p, mode)', () => {
    fs.writeFileSync('/f', 'x');
    nodefs.writeFileSync(real('f'), 'x');
    same(() => fs.accessSync('/f'), () => nodefs.accessSync(real('f')), 'mode omitted');
    same(() => fs.accessSync('/f', nodefs.constants.R_OK), () => nodefs.accessSync(real('f'), nodefs.constants.R_OK), 'R_OK');
    same(() => fs.accessSync('/gone'), () => nodefs.accessSync(real('gone')), 'missing path');
  });

  it('copyFileSync(s, d) / (s, d, mode)', () => {
    same(() => { fs.writeFileSync('/a', 'v'); fs.copyFileSync('/a', '/b'); return text(fs.readFileSync('/b', 'utf8')); },
         () => { nodefs.writeFileSync(real('a'), 'v'); nodefs.copyFileSync(real('a'), real('b')); return nodefs.readFileSync(real('b'), 'utf8'); }, 'no mode');
    same(() => { fs.writeFileSync('/c', 'v'); fs.writeFileSync('/d', 'w'); fs.copyFileSync('/c', '/d', nodefs.constants.COPYFILE_EXCL); },
         () => { nodefs.writeFileSync(real('c'), 'v'); nodefs.writeFileSync(real('d'), 'w'); nodefs.copyFileSync(real('c'), real('d'), nodefs.constants.COPYFILE_EXCL); }, 'COPYFILE_EXCL');
  });

  it('cpSync(s, d, {recursive}) reproduces the same tree', () => {
    // Reachable in Node for the first time via the instance harness; previously browser-only.
    const build = (mk: (p: string) => void, wr: (p: string, c: string) => void) => {
      mk('src'); mk('src/nested'); wr('src/top.txt', 'top'); wr('src/nested/leaf.txt', 'leaf');
    };
    build((p) => fs.mkdirSync('/' + p), (p, c) => fs.writeFileSync('/' + p, c));
    build((p) => nodefs.mkdirSync(real(p)), (p, c) => nodefs.writeFileSync(real(p), c));

    fs.cpSync('/src', '/dst', { recursive: true });
    nodefs.cpSync(real('src'), real('dst'), { recursive: true });

    const ours = [...fs.readdirSync('/dst', { recursive: true })].sort();
    const theirs = nodefs.readdirSync(real('dst'), { recursive: true }).sort();
    expect(ours).toEqual(theirs);
    expect(text(fs.readFileSync('/dst/nested/leaf.txt', 'utf8'))).toBe('leaf');
  });

  it('cpSync without recursive reports the same error code', () => {
    fs.mkdirSync('/d');
    nodefs.mkdirSync(real('d'));
    same(() => fs.cpSync('/d', '/e'), () => nodefs.cpSync(real('d'), real('e')), 'directory without recursive');
  });

  it('realpathSync(p) / (p, encoding) and mkdtempSync(pre) / (pre, encoding)', () => {
    fs.writeFileSync('/f', 'x');
    nodefs.writeFileSync(real('f'), 'x');
    same(() => typeof fs.realpathSync('/f'), () => typeof nodefs.realpathSync(real('f')), 'realpath default type');
    same(() => fs.realpathSync('/f', 'buffer') instanceof Uint8Array,
         () => nodefs.realpathSync(real('f'), 'buffer') instanceof Uint8Array, 'realpath buffer');
    same(() => typeof fs.mkdtempSync('/t-'), () => typeof nodefs.mkdtempSync(join(root, 't-')), 'mkdtemp default type');
    same(() => fs.mkdtempSync('/u-', 'buffer') instanceof Uint8Array,
         () => nodefs.mkdtempSync(join(root, 'u-'), 'buffer') instanceof Uint8Array, 'mkdtemp buffer');
  });

  it('symlinkSync(t, p) / (t, p, type) and readlinkSync(p) / (p, encoding)', () => {
    same(() => { fs.writeFileSync('/t', 'x'); fs.symlinkSync('t', '/l'); return fs.readlinkSync('/l'); },
         () => { nodefs.writeFileSync(real('t'), 'x'); nodefs.symlinkSync('t', real('l')); return nodefs.readlinkSync(real('l')); }, 'no type');
    same(() => { fs.symlinkSync('t', '/l2', 'file'); return fs.readlinkSync('/l2'); },
         () => { nodefs.symlinkSync('t', real('l2'), 'file'); return nodefs.readlinkSync(real('l2')); }, 'explicit type');
    same(() => fs.readlinkSync('/l', 'buffer') instanceof Uint8Array,
         () => nodefs.readlinkSync(real('l'), 'buffer') instanceof Uint8Array, 'readlink buffer');
  });
});

describe('promise overloads: every documented form behaves as in node:fs', () => {
  const p = () => fs.promises;

  it('readFile / writeFile with and without options', async () => {
    await p().writeFile('/a', 'x');
    await nodefs.promises.writeFile(real('a'), 'x');
    expect(text(await p().readFile('/a', 'utf8'))).toBe(await nodefs.promises.readFile(real('a'), 'utf8'));
    expect(Array.from(await p().readFile('/a') as Uint8Array)).toEqual(Array.from(await nodefs.promises.readFile(real('a'))));
  });

  it('open with flags omitted, flags only, and flags + mode', async () => {
    await p().writeFile('/f', 'x');
    await nodefs.promises.writeFile(real('f'), 'x');

    const h1 = await p().open('/f');
    await h1.close();
    const n1 = await nodefs.promises.open(real('f'));
    await n1.close();

    const h2 = await p().open('/g', 'w');
    await h2.close();
    const n2 = await nodefs.promises.open(real('g'), 'w');
    await n2.close();
    expect(fs.existsSync('/g')).toBe(nodefs.existsSync(real('g')));

    const h3 = await p().open('/h', 'w', 0o600);
    await h3.close();
    const n3 = await nodefs.promises.open(real('h'), 'w', 0o600);
    await n3.close();
    expect(fs.statSync('/h').mode & 0o777).toBe(nodefs.statSync(real('h')).mode & 0o777);
  });

  it('mkdir with a numeric mode shorthand and with an options object', async () => {
    await p().mkdir('/a', 0o700);
    await nodefs.promises.mkdir(real('a'), 0o700);
    expect(fs.statSync('/a').mode & 0o777).toBe(nodefs.statSync(real('a')).mode & 0o777);

    await p().mkdir('/b/c', { recursive: true });
    await nodefs.promises.mkdir(real('b/c'), { recursive: true });
    expect(fs.statSync('/b/c').isDirectory()).toBe(nodefs.statSync(real('b/c')).isDirectory());
  });

  it('realpath and mkdtemp accept an encoding', async () => {
    await p().writeFile('/f', 'x');
    expect(typeof await p().realpath('/f')).toBe('string');
    expect(await p().realpath('/f', 'buffer')).toBeInstanceOf(Uint8Array);
    expect(typeof await p().mkdtemp('/t-')).toBe('string');
    expect(await p().mkdtemp('/u-', 'buffer')).toBeInstanceOf(Uint8Array);
  });
});
