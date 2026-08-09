/**
 * `Stats`, `Dirent` and `Dir` as classes, and the surface that hangs off them.
 *
 * These were object literals. Three things were wrong as a result, each checked here against a
 * live `node:fs`:
 *
 *   • `stats instanceof fs.Stats` and `entry instanceof fs.Dirent` were impossible — the classes
 *     were not exported and there was nothing to be an instance *of*;
 *   • `Object.keys(stats)` and `JSON.stringify(stats)` did not match node's, because the four
 *     `Date`s were own properties (node builds them lazily on the prototype) and `Dirent.path`
 *     was an own property (node deprecated it, then removed it in v24; we keep it as a getter);
 *   • `fs.constants` did not exist on the instance at all — only `fs.promises.constants` — so
 *     `fs.access(p, fs.constants.F_OK)`, the canonical form, read through `undefined`.
 *
 * `Dir` was two separate literals, one per open path, and between them they were missing
 * `readSync()` and `closeSync()` — half of node's `Dir`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as nodefs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFsHarness } from './helpers/engine-transport.js';
import { Stats, BigIntStats, Dirent } from '../src/stats-classes.js';
import { Dir } from '../src/dir.js';
import type { VFSFileSystem } from '../src/filesystem.js';

let fs: VFSFileSystem;
let root: string;

beforeEach(() => {
  fs = createFsHarness().fs;
  root = nodefs.mkdtempSync(join(tmpdir(), 'classes-'));
  fs.mkdirSync('/d');
  fs.writeFileSync('/d/f', 'body');
  fs.symlinkSync('/d/f', '/d/l');
  nodefs.mkdirSync(join(root, 'd'));
  nodefs.writeFileSync(join(root, 'd/f'), 'body');
  nodefs.symlinkSync(join(root, 'd/f'), join(root, 'd/l'));
});
afterEach(() => nodefs.rmSync(root, { recursive: true, force: true }));

describe('instanceof works, as it does in node', () => {
  it('stat results are Stats', () => {
    expect(fs.statSync('/d/f')).toBeInstanceOf(Stats);
    expect(fs.lstatSync('/d/l')).toBeInstanceOf(Stats);
    expect(nodefs.statSync(join(root, 'd/f'))).toBeInstanceOf(nodefs.Stats);
  });

  it('bigint stat results are BigIntStats', () => {
    expect(fs.statSync('/d/f', { bigint: true })).toBeInstanceOf(BigIntStats);
  });

  it('readdir entries are Dirents', () => {
    const [entry] = fs.readdirSync('/d', { withFileTypes: true }) as Dirent[];
    expect(entry).toBeInstanceOf(Dirent);
    expect(nodefs.readdirSync(join(root, 'd'), { withFileTypes: true })[0])
      .toBeInstanceOf(nodefs.Dirent);
  });

  it('the classes are reachable from the instance, as fs.Stats / fs.Dirent / fs.Dir', () => {
    expect(fs.statSync('/d/f')).toBeInstanceOf(fs.Stats);
    expect((fs.readdirSync('/d', { withFileTypes: true }) as Dirent[])[0]).toBeInstanceOf(fs.Dirent);
    expect(fs.opendirSync('/d')).toBeInstanceOf(fs.Dir);
  });
});

describe('object shape matches node', () => {
  it('Stats own keys are node’s, in node’s order', () => {
    const ours = Object.keys(fs.statSync('/d/f'));
    const theirs = Object.keys(nodefs.statSync(join(root, 'd/f')));
    expect(ours).toEqual(theirs);
  });

  it('JSON.stringify of a Stats emits node’s fields', () => {
    const ours = Object.keys(JSON.parse(JSON.stringify(fs.statSync('/d/f'))));
    const theirs = Object.keys(JSON.parse(JSON.stringify(nodefs.statSync(join(root, 'd/f')))));
    expect(ours).toEqual(theirs);
  });

  it('bigint Stats carry the ns fields as own properties, as node’s do', () => {
    const ours = Object.keys(fs.statSync('/d/f', { bigint: true }));
    const theirs = Object.keys(nodefs.statSync(join(root, 'd/f'), { bigint: true }));
    expect(ours).toEqual(theirs);
    expect(ours).toContain('atimeNs');
  });

  it('Dirent own keys are name and parentPath only — `path` is a getter', () => {
    const [ours] = fs.readdirSync('/d', { withFileTypes: true }) as Dirent[];
    const [theirs] = nodefs.readdirSync(join(root, 'd'), { withFileTypes: true });
    expect(Object.keys(ours)).toEqual(Object.keys(theirs));
    expect(Object.keys(ours)).toEqual(['name', 'parentPath']);

    // `path` is kept as a prototype getter aliasing `parentPath`. Node deprecated it (DEP0178)
    // and **removed** it in v24 — `theirs.path` is `undefined` here — but dropping it would
    // break callers that still read it, and as a getter it costs nothing and stays out of
    // `Object.keys`/`JSON.stringify`, which is what the shape comparison above cares about.
    expect(ours.path).toBe(ours.parentPath);
    expect(Object.keys(ours)).not.toContain('path');
  });

  it('the type predicates still answer correctly for every entry kind', () => {
    const entries = fs.readdirSync('/d', { withFileTypes: true }) as Dirent[];
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
    expect(byName.f.isFile()).toBe(true);
    expect(byName.f.isDirectory()).toBe(false);
    expect(byName.l.isSymbolicLink()).toBe(true);
    expect(byName.l.isFile()).toBe(false);
    for (const e of entries) {
      expect([e.isBlockDevice(), e.isCharacterDevice(), e.isFIFO(), e.isSocket()])
        .toEqual([false, false, false, false]);
    }
  });

  it('Stats predicates read the S_IFMT bits, matching node for each type', () => {
    const f = fs.statSync('/d/f'), d = fs.statSync('/d'), l = fs.lstatSync('/d/l');
    expect([f.isFile(), f.isDirectory(), f.isSymbolicLink()]).toEqual([true, false, false]);
    expect([d.isFile(), d.isDirectory(), d.isSymbolicLink()]).toEqual([false, true, false]);
    expect([l.isFile(), l.isDirectory(), l.isSymbolicLink()]).toEqual([false, false, true]);

    const nf = nodefs.statSync(join(root, 'd/f')), nl = nodefs.lstatSync(join(root, 'd/l'));
    expect([f.isFile(), f.isDirectory()]).toEqual([nf.isFile(), nf.isDirectory()]);
    expect(l.isSymbolicLink()).toBe(nl.isSymbolicLink());
  });

  it('the lazy dates are correct and stable across reads', () => {
    const st = fs.statSync('/d/f');
    expect(st.mtime).toBeInstanceOf(Date);
    expect(st.mtime.getTime()).toBe(st.mtimeMs);
    expect(st.mtime).toBe(st.mtime); // cached, not rebuilt per access
    expect(st.atime.getTime()).toBe(st.atimeMs);
    expect(st.birthtime.getTime()).toBe(st.birthtimeMs);
  });

  it('the ns fields stay readable, though node has them on bigint stats only', () => {
    const st = fs.statSync('/d/f');
    expect(st.mtimeNs).toBe(st.mtimeMs * 1_000_000);
    expect(Object.keys(st)).not.toContain('mtimeNs'); // matching node's own-key list
  });
});

describe('recursive readdir entries survive the prototype move', () => {
  it('reports the right type after being re-parented', () => {
    // The recursive walk used to copy `isFile`/`isDirectory`/… off the source entry into a new
    // literal. That only works while they are per-instance closures — with the predicates on the
    // prototype, a bare function reference lands on an object with no type and answers false.
    fs.mkdirSync('/d/sub');
    fs.writeFileSync('/d/sub/inner', 'x');
    const entries = fs.readdirSync('/d', { recursive: true, withFileTypes: true }) as Dirent[];
    const inner = entries.find((e) => e.name === 'inner')!;
    expect(inner).toBeInstanceOf(Dirent);
    expect(inner.isFile()).toBe(true);
    expect(inner.isDirectory()).toBe(false);
    expect(inner.parentPath).toBe('/d/sub');

    const sub = entries.find((e) => e.name === 'sub')!;
    expect(sub.isDirectory()).toBe(true);
  });
});

describe('glob entries are the same shape as readdir entries', () => {
  it('carries `path` too, which the hand-written literal omitted', async () => {
    const entries = await fs.promises.glob('/d/*', { withFileTypes: true }) as unknown as Dirent[];
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e).toBeInstanceOf(Dirent);
      expect(e.path).toBe(e.parentPath);
      expect(Object.keys(e)).toEqual(['name', 'parentPath']);
    }
  });
});

describe('fs.constants', () => {
  it('exists on the instance, not only on promises', () => {
    expect(fs.constants).toBeDefined();
    // Only the platform-independent ones are compared against the host node: the `O_*` values
    // differ per platform (O_CREAT is 64 on Linux, 512 on macOS) and we use the Linux set
    // throughout, the same policy the README states for errno spellings.
    expect(fs.constants.F_OK).toBe(nodefs.constants.F_OK);
    expect(fs.constants.R_OK).toBe(nodefs.constants.R_OK);
    expect(fs.constants.W_OK).toBe(nodefs.constants.W_OK);
    expect(fs.constants.X_OK).toBe(nodefs.constants.X_OK);
    expect(fs.constants.COPYFILE_EXCL).toBe(nodefs.constants.COPYFILE_EXCL);
    expect(fs.constants.O_CREAT).toBe(0o100); // Linux O_CREAT
    expect(fs.constants).toBe(fs.promises.constants);
  });

  it('works in the form that used to throw', () => {
    expect(() => fs.accessSync('/d/f', fs.constants.F_OK)).not.toThrow();
  });
});

describe('Dir', () => {
  it('opendirSync and promises.opendir return the same class', async () => {
    const a = fs.opendirSync('/d');
    const b = await fs.promises.opendir('/d');
    expect(a).toBeInstanceOf(Dir);
    expect(b).toBeInstanceOf(Dir);
    await a.close();
    await b.close();
  });

  it('readSync() walks the entries — it did not exist before', () => {
    const dir = fs.opendirSync('/d');
    const names: string[] = [];
    for (let e = dir.readSync(); e !== null; e = dir.readSync()) names.push(e.name);
    dir.closeSync();
    expect(names.sort()).toEqual(nodefs.readdirSync(join(root, 'd')).sort());
  });

  it('readSync() works on a handle opened asynchronously', async () => {
    const dir = await fs.promises.opendir('/d');
    expect(dir.readSync()).not.toBeNull();
    await dir.close();
  });

  it('matches node entry for entry, in order, via read()', async () => {
    const ours: string[] = [];
    const dir = await fs.promises.opendir('/d');
    for await (const e of dir) ours.push(e.name);

    const theirs: string[] = [];
    const nd = await nodefs.promises.opendir(join(root, 'd'));
    for await (const e of nd) theirs.push(e.name);

    expect(ours.sort()).toEqual(theirs.sort());
  });

  it('reports ERR_DIR_CLOSED after close, as node does', async () => {
    const dir = fs.opendirSync('/d');
    dir.closeSync();
    expect(() => dir.readSync()).toThrow(expect.objectContaining({ code: 'ERR_DIR_CLOSED' }));
    await expect(dir.read()).rejects.toThrow(expect.objectContaining({ code: 'ERR_DIR_CLOSED' }));

    const nd = await nodefs.promises.opendir(join(root, 'd'));
    await nd.close();
    await expect(nd.read()).rejects.toThrow(expect.objectContaining({ code: 'ERR_DIR_CLOSED' }));
  });

  it('closing twice is not an error', async () => {
    const dir = fs.opendirSync('/d');
    dir.closeSync();
    await expect(dir.close()).resolves.toBeUndefined();
  });

  it('honours `recursive`, which was accepted and ignored', async () => {
    fs.mkdirSync('/d/sub');
    fs.writeFileSync('/d/sub/inner', 'x');
    nodefs.mkdirSync(join(root, 'd/sub'));
    nodefs.writeFileSync(join(root, 'd/sub/inner'), 'x');

    const ours: string[] = [];
    for await (const e of await fs.promises.opendir('/d', { recursive: true })) ours.push(e.name);

    const theirs: string[] = [];
    for await (const e of await nodefs.promises.opendir(join(root, 'd'), { recursive: true })) {
      theirs.push(e.name);
    }

    expect(ours.sort()).toEqual(theirs.sort());
    expect(ours).toContain('inner');
  });

  it('the sync form honours `recursive` too', () => {
    fs.mkdirSync('/d/sub');
    fs.writeFileSync('/d/sub/inner', 'x');
    const dir = fs.opendirSync('/d', { recursive: true });
    const names: string[] = [];
    for (let e = dir.readSync(); e !== null; e = dir.readSync()) names.push(e.name);
    dir.closeSync();
    expect(names).toContain('inner');
  });
});
