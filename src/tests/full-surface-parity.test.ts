/**
 * Every one of the 132 `node:fs` / `node:fs/promises` functions, run against the real thing.
 *
 * [api-surface.test.ts](./api-surface.test.ts) proves each name *exists*. That is a weaker claim
 * than it sounds: a method can be present, typed, and wrong. This drives every function with a
 * real call — plus its common error path — against `node:fs` on a temp directory and compares
 * what came back and what it did to the filesystem.
 *
 * Comparisons are deliberately narrow to what both filesystems can agree on: return values,
 * error `code`s, file contents, entry lists, sizes and permission bits. Inode numbers, device
 * ids and timestamps are inherently different. Documented divergences (see the readme's "Known
 * divergences") are asserted as divergences rather than skipped, so if one is ever fixed the
 * test says so instead of silently passing.
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
/** `root` after symlink resolution — macOS puts the temp dir under /var, a link to /private/var. */
let realRoot: string;

beforeEach(() => {
  fs = createFsHarness().fs;
  root = nodefs.mkdtempSync(join(tmpdir(), 'surface-'));
  realRoot = nodefs.realpathSync(root);
});
afterEach(() => nodefs.rmSync(root, { recursive: true, force: true }));

/** The same relative path on each filesystem. */
const R = (p: string) => join(root, p);
/** A node-side absolute path, reduced to the form our filesystem would report. */
const rel = (p: string) => p.replace(realRoot, '').replace(root, '') || '/';

type Outcome = { ok: true; value: unknown } | { ok: false; code: string };

function attempt(fn: () => unknown): Outcome {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, code: (e as { code?: string }).code ?? (e as Error).name };
  }
}

async function attemptAsync(fn: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, code: (e as { code?: string }).code ?? (e as Error).name };
  }
}

/** Reduce a value to something comparable across the two filesystems. */
function normalise(v: unknown): unknown {
  if (v instanceof Uint8Array) return Array.from(v);
  if (Array.isArray(v)) return v.map(normalise);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    // Stats-like
    if (typeof o.isFile === 'function' && typeof o.size !== 'undefined') {
      const isDir = (o.isDirectory as () => boolean)();
      const isLink = (o.isSymbolicLink as () => boolean)();
      return {
        // A directory's reported size is whatever the host filesystem uses for its own
        // bookkeeping — 128 on APFS, 4096 on ext4, 0 for a VFS with no directory blocks. A
        // symlink's size is the byte length of its target path, and the two filesystems store
        // the same link under different absolute paths, so neither is comparable.
        size: isDir || isLink ? null : Number(o.size),
        // Symlink permission bits are platform-dependent in Node itself — 0o755 on macOS,
        // 0o777 on Linux. We follow the Linux spelling, as with the errno choices.
        mode: isLink ? null : Number(o.mode) & 0o777,
        // nlink is not comparable in either direction. For a directory it is filesystem-
        // specific — the POSIX rule is 2 + subdirectories, which is what ext4 and this VFS
        // report, while APFS answers 4 where ext4 answers 3. For a file, hard links are copies
        // here, which is a documented divergence. Our own rule is pinned separately, below.
        isFile: (o.isFile as () => boolean)(),
        isDirectory: (o.isDirectory as () => boolean)(),
        isSymbolicLink: (o.isSymbolicLink as () => boolean)(),
      };
    }
    // Dirent-like
    if (typeof o.name === 'string' && typeof o.isFile === 'function') {
      return { name: o.name, isFile: (o.isFile as () => boolean)(), isDirectory: (o.isDirectory as () => boolean)() };
    }
  }
  return v;
}

/** Run the same operation on both filesystems and assert they agree. */
function same(label: string, ours: () => unknown, theirs: () => unknown) {
  const a = attempt(ours);
  const b = attempt(theirs);
  expect(a.ok, `${label}: ours ${a.ok ? 'succeeded' : 'threw ' + a.code}, node ${b.ok ? 'succeeded' : 'threw ' + b.code}`).toBe(b.ok);
  if (a.ok && b.ok) expect(normalise(a.value), label).toEqual(normalise(b.value));
  else if (!a.ok && !b.ok) expect(a.code, `${label}: error code`).toBe(b.code);
}

async function sameAsync(label: string, ours: () => Promise<unknown>, theirs: () => Promise<unknown>) {
  const a = await attemptAsync(ours);
  const b = await attemptAsync(theirs);
  expect(a.ok, `${label}: ours ${a.ok ? 'succeeded' : 'threw ' + a.code}, node ${b.ok ? 'succeeded' : 'threw ' + b.code}`).toBe(b.ok);
  if (a.ok && b.ok) expect(normalise(a.value), label).toEqual(normalise(b.value));
  else if (!a.ok && !b.ok) expect(a.code, `${label}: error code`).toBe(b.code);
}

/** Both trees, described identically, so a mutation can be compared by its effect. */
function tree(readdir: (p: string) => string[], statOf: (p: string) => { isDirectory(): boolean }, base: string, dir = ''): string[] {
  const out: string[] = [];
  for (const name of readdir(dir === '' ? base : `${base}/${dir}`).sort()) {
    const rel = dir ? `${dir}/${name}` : name;
    const st = statOf(`${base}/${rel}`);
    out.push(st.isDirectory() ? `d ${rel}` : `f ${rel}`);
    if (st.isDirectory()) out.push(...tree(readdir, statOf, base, rel));
  }
  return out;
}

/** `mkdtemp` invents six random characters, independently on each side. */
const maskTemp = (entries: string[]) => entries.map((e) => e.replace(/-[A-Za-z0-9]{6}(?=$|\/)/g, '-XXXXXX'));

const ourTree = () => maskTemp(tree((p) => fs.readdirSync(p) as string[], (p) => fs.lstatSync(p)!, ''));
const nodeTree = () => maskTemp(tree((p) => nodefs.readdirSync(p || root), (p) => nodefs.lstatSync(p || root), root));

/** Seed both filesystems with the same starting layout. */
function seed() {
  fs.mkdirSync('/dir/sub', { recursive: true });
  nodefs.mkdirSync(R('dir/sub'), { recursive: true });
  for (const [p, body] of [['/file.txt', 'hello'], ['/dir/a.txt', 'AAA'], ['/dir/sub/b.txt', 'BBB']] as const) {
    fs.writeFileSync(p, body);
    nodefs.writeFileSync(R(p.slice(1)), body);
  }
}

// ===========================================================================
// Sync API — 44 functions
// ===========================================================================

describe('sync API parity', () => {
  beforeEach(seed);

  it('readFileSync / writeFileSync / appendFileSync', () => {
    same('readFileSync utf8', () => fs.readFileSync('/file.txt', 'utf8'), () => nodefs.readFileSync(R('file.txt'), 'utf8'));
    same('readFileSync bytes', () => fs.readFileSync('/file.txt'), () => nodefs.readFileSync(R('file.txt')));
    same('readFileSync ENOENT', () => fs.readFileSync('/nope'), () => nodefs.readFileSync(R('nope')));
    same('readFileSync EISDIR', () => fs.readFileSync('/dir'), () => nodefs.readFileSync(R('dir')));

    fs.writeFileSync('/w.txt', 'written');
    nodefs.writeFileSync(R('w.txt'), 'written');
    same('after writeFileSync', () => fs.readFileSync('/w.txt', 'utf8'), () => nodefs.readFileSync(R('w.txt'), 'utf8'));

    fs.appendFileSync('/w.txt', '+more');
    nodefs.appendFileSync(R('w.txt'), '+more');
    same('after appendFileSync', () => fs.readFileSync('/w.txt', 'utf8'), () => nodefs.readFileSync(R('w.txt'), 'utf8'));
  });

  it('statSync / lstatSync / fstatSync / statfsSync / existsSync / accessSync', () => {
    same('statSync', () => fs.statSync('/file.txt'), () => nodefs.statSync(R('file.txt')));
    same('statSync dir', () => fs.statSync('/dir'), () => nodefs.statSync(R('dir')));
    same('statSync ENOENT', () => fs.statSync('/nope'), () => nodefs.statSync(R('nope')));
    same('statSync throwIfNoEntry:false', () => fs.statSync('/nope', { throwIfNoEntry: false }), () => nodefs.statSync(R('nope'), { throwIfNoEntry: false }));
    same('lstatSync', () => fs.lstatSync('/file.txt'), () => nodefs.lstatSync(R('file.txt')));
    same('existsSync true', () => fs.existsSync('/file.txt'), () => nodefs.existsSync(R('file.txt')));
    same('existsSync false', () => fs.existsSync('/nope'), () => nodefs.existsSync(R('nope')));
    same('accessSync ok', () => fs.accessSync('/file.txt'), () => nodefs.accessSync(R('file.txt')));
    same('accessSync ENOENT', () => fs.accessSync('/nope'), () => nodefs.accessSync(R('nope')));

    // statfs reports volume-level numbers that cannot match; check the shape only.
    const ours = fs.statfsSync('/') as Record<string, number>;
    const theirs = nodefs.statfsSync(root) as unknown as Record<string, number>;
    expect(Object.keys(ours).sort()).toEqual(Object.keys(theirs).sort());

    const fd = fs.openSync('/file.txt', 'r');
    const nfd = nodefs.openSync(R('file.txt'), 'r');
    same('fstatSync', () => fs.fstatSync(fd), () => nodefs.fstatSync(nfd));
    fs.closeSync(fd);
    nodefs.closeSync(nfd);
  });

  it('readdirSync in every option shape', () => {
    same('readdirSync', () => (fs.readdirSync('/dir') as string[]).sort(), () => nodefs.readdirSync(R('dir')).sort());
    same('readdirSync recursive', () => (fs.readdirSync('/dir', { recursive: true }) as string[]).sort(), () => nodefs.readdirSync(R('dir'), { recursive: true }).sort());
    same('readdirSync withFileTypes',
      () => (fs.readdirSync('/dir', { withFileTypes: true }) as never[]).sort((a: never, b: never) => (a as { name: string }).name.localeCompare((b as { name: string }).name)),
      () => nodefs.readdirSync(R('dir'), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)));
    same('readdirSync ENOENT', () => fs.readdirSync('/nope'), () => nodefs.readdirSync(R('nope')));
    same('readdirSync ENOTDIR', () => fs.readdirSync('/file.txt'), () => nodefs.readdirSync(R('file.txt')));
  });

  it('mkdirSync / rmdirSync / rmSync / unlinkSync', () => {
    same('mkdirSync', () => fs.mkdirSync('/fresh'), () => nodefs.mkdirSync(R('fresh')));
    same('mkdirSync EEXIST', () => fs.mkdirSync('/fresh'), () => nodefs.mkdirSync(R('fresh')));
    same('mkdirSync recursive returns the first directory created', () => fs.mkdirSync('/a/b/c', { recursive: true }), () => rel(nodefs.mkdirSync(R('a/b/c'), { recursive: true })!));
    same('mkdirSync ENOENT', () => fs.mkdirSync('/no/parent'), () => nodefs.mkdirSync(R('no/parent')));

    same('rmdirSync', () => fs.rmdirSync('/fresh'), () => nodefs.rmdirSync(R('fresh')));
    same('rmdirSync ENOTEMPTY', () => fs.rmdirSync('/dir'), () => nodefs.rmdirSync(R('dir')));
    same('unlinkSync', () => fs.unlinkSync('/file.txt'), () => nodefs.unlinkSync(R('file.txt')));
    same('unlinkSync ENOENT', () => fs.unlinkSync('/file.txt'), () => nodefs.unlinkSync(R('file.txt')));
    same('rmSync recursive', () => fs.rmSync('/a', { recursive: true }), () => nodefs.rmSync(R('a'), { recursive: true }));
    same('rmSync force missing', () => fs.rmSync('/gone', { force: true }), () => nodefs.rmSync(R('gone'), { force: true }));
    same('rmSync dir without recursive', () => fs.rmSync('/dir'), () => nodefs.rmSync(R('dir')));
    expect(ourTree()).toEqual(nodeTree());
  });

  it('renameSync / copyFileSync / cpSync / linkSync', () => {
    same('renameSync', () => fs.renameSync('/file.txt', '/moved.txt'), () => nodefs.renameSync(R('file.txt'), R('moved.txt')));
    same('renameSync ENOENT', () => fs.renameSync('/nope', '/x'), () => nodefs.renameSync(R('nope'), R('x')));
    same('copyFileSync', () => fs.copyFileSync('/moved.txt', '/copy.txt'), () => nodefs.copyFileSync(R('moved.txt'), R('copy.txt')));
    same('copyFileSync EEXIST', () => fs.copyFileSync('/moved.txt', '/copy.txt', 1), () => nodefs.copyFileSync(R('moved.txt'), R('copy.txt'), 1));
    same('cpSync recursive', () => fs.cpSync('/dir', '/dir-copy', { recursive: true }), () => nodefs.cpSync(R('dir'), R('dir-copy'), { recursive: true }));
    same('cpSync dir without recursive', () => fs.cpSync('/dir', '/nope-copy'), () => nodefs.cpSync(R('dir'), R('nope-copy')));
    same('linkSync', () => fs.linkSync('/moved.txt', '/hard.txt'), () => nodefs.linkSync(R('moved.txt'), R('hard.txt')));
    expect(ourTree()).toEqual(nodeTree());
  });

  it('symlinkSync / readlinkSync / realpathSync', () => {
    same('symlinkSync', () => fs.symlinkSync('/file.txt', '/link'), () => nodefs.symlinkSync(R('file.txt'), R('link')));
    same('readlinkSync', () => fs.readlinkSync('/link'), () => rel(nodefs.readlinkSync(R('link')) as string));
    same('readlinkSync EINVAL', () => fs.readlinkSync('/file.txt'), () => nodefs.readlinkSync(R('file.txt')));
    same('realpathSync', () => fs.realpathSync('/link'), () => rel(nodefs.realpathSync(R('link')) as string));
    same('lstat on link', () => fs.lstatSync('/link'), () => nodefs.lstatSync(R('link')));
    same('stat through link', () => fs.statSync('/link'), () => nodefs.statSync(R('link')));
  });

  it('truncateSync / ftruncateSync', () => {
    same('truncateSync shrink', () => fs.truncateSync('/file.txt', 2), () => nodefs.truncateSync(R('file.txt'), 2));
    same('after shrink', () => fs.readFileSync('/file.txt', 'utf8'), () => nodefs.readFileSync(R('file.txt'), 'utf8'));
    same('truncateSync grow', () => fs.truncateSync('/file.txt', 8), () => nodefs.truncateSync(R('file.txt'), 8));
    same('after grow', () => fs.readFileSync('/file.txt'), () => nodefs.readFileSync(R('file.txt')));

    const fd = fs.openSync('/file.txt', 'r+');
    const nfd = nodefs.openSync(R('file.txt'), 'r+');
    same('ftruncateSync', () => fs.ftruncateSync(fd, 1), () => nodefs.ftruncateSync(nfd, 1));
    fs.closeSync(fd); nodefs.closeSync(nfd);
    same('after ftruncateSync', () => fs.readFileSync('/file.txt', 'utf8'), () => nodefs.readFileSync(R('file.txt'), 'utf8'));
  });

  it('openSync / readSync / writeSync / readvSync / writevSync / closeSync', () => {
    const fd = fs.openSync('/rw.txt', 'w+');
    const nfd = nodefs.openSync(R('rw.txt'), 'w+');
    same('writeSync string', () => fs.writeSync(fd, 'abcdef'), () => nodefs.writeSync(nfd, 'abcdef'));

    const b1 = new Uint8Array(3), nb1 = Buffer.alloc(3);
    same('readSync at offset', () => fs.readSync(fd, b1, 0, 3, 1), () => nodefs.readSync(nfd, nb1, 0, 3, 1));
    expect(Array.from(b1)).toEqual(Array.from(nb1));

    same('writevSync', () => fs.writevSync(fd, [new Uint8Array([1, 2]), new Uint8Array([3])], 0),
                        () => nodefs.writevSync(nfd, [Buffer.from([1, 2]), Buffer.from([3])], 0));
    const r1 = new Uint8Array(2), r2 = new Uint8Array(1);
    const nr1 = Buffer.alloc(2), nr2 = Buffer.alloc(1);
    same('readvSync', () => fs.readvSync(fd, [r1, r2], 0), () => nodefs.readvSync(nfd, [nr1, nr2], 0));
    expect([...r1, ...r2]).toEqual([...nr1, ...nr2]);

    same('closeSync', () => fs.closeSync(fd), () => nodefs.closeSync(nfd));
    same('closeSync EBADF', () => fs.closeSync(fd), () => nodefs.closeSync(nfd));
    same('openSync ENOENT', () => fs.openSync('/nope', 'r'), () => nodefs.openSync(R('nope'), 'r'));
  });

  it('chmodSync / fchmodSync / lchmodSync / chownSync / fchownSync / lchownSync', () => {
    same('chmodSync', () => fs.chmodSync('/file.txt', 0o600), () => nodefs.chmodSync(R('file.txt'), 0o600));
    same('mode after chmod', () => fs.statSync('/file.txt'), () => nodefs.statSync(R('file.txt')));
    same('chmodSync ENOENT', () => fs.chmodSync('/nope', 0o600), () => nodefs.chmodSync(R('nope'), 0o600));

    const fd = fs.openSync('/file.txt', 'r+');
    const nfd = nodefs.openSync(R('file.txt'), 'r+');
    same('fchmodSync', () => fs.fchmodSync(fd, 0o640), () => nodefs.fchmodSync(nfd, 0o640));
    same('mode after fchmod', () => fs.fstatSync(fd), () => nodefs.fstatSync(nfd));
    // chown to the current owner is the only portable no-op that both accept.
    const { uid, gid } = nodefs.statSync(R('file.txt'));
    same('chownSync', () => fs.chownSync('/file.txt', uid, gid), () => nodefs.chownSync(R('file.txt'), uid, gid));
    same('fchownSync', () => fs.fchownSync(fd, uid, gid), () => nodefs.fchownSync(nfd, uid, gid));
    fs.closeSync(fd); nodefs.closeSync(nfd);
  });

  it('utimesSync / futimesSync / lutimesSync', () => {
    const at = 1_600_000_000, mt = 1_600_000_100;
    fs.utimesSync('/file.txt', at, mt);
    nodefs.utimesSync(R('file.txt'), at, mt);
    expect(Math.round(fs.statSync('/file.txt')!.mtimeMs / 1000)).toBe(Math.round(nodefs.statSync(R('file.txt')).mtimeMs / 1000));

    const fd = fs.openSync('/file.txt', 'r+');
    const nfd = nodefs.openSync(R('file.txt'), 'r+');
    fs.futimesSync(fd, at, mt);
    nodefs.futimesSync(nfd, at, mt);
    expect(Math.round(fs.fstatSync(fd)!.mtimeMs / 1000)).toBe(Math.round(nodefs.fstatSync(nfd).mtimeMs / 1000));
    fs.closeSync(fd); nodefs.closeSync(nfd);

    fs.symlinkSync('/file.txt', '/l2');
    nodefs.symlinkSync(R('file.txt'), R('l2'));
    fs.lutimesSync('/l2', at, mt);
    nodefs.lutimesSync(R('l2'), at, mt);
  });

  it('fsyncSync / fdatasyncSync', () => {
    const fd = fs.openSync('/file.txt', 'r+');
    const nfd = nodefs.openSync(R('file.txt'), 'r+');
    same('fsyncSync', () => fs.fsyncSync(fd), () => nodefs.fsyncSync(nfd));
    same('fdatasyncSync', () => fs.fdatasyncSync(fd), () => nodefs.fdatasyncSync(nfd));
    fs.closeSync(fd); nodefs.closeSync(nfd);
  });

  it('mkdtempSync / mkdtempDisposableSync', () => {
    const ours = fs.mkdtempSync('/tmp-');
    const theirs = nodefs.mkdtempSync(join(root, 'tmp-'));
    expect(ours.startsWith('/tmp-')).toBe(true);
    expect(ours.length).toBe(theirs.replace(root, '').length);
    expect(fs.statSync(ours)!.isDirectory()).toBe(nodefs.statSync(theirs).isDirectory());

    const d1 = fs.mkdtempDisposableSync('/dis-');
    const d2 = nodefs.mkdtempDisposableSync(join(root, 'dis-'));
    expect(Object.keys(d1).sort()).toEqual(Object.keys(d2).sort());
    d1.remove(); d2.remove();
    expect(fs.existsSync(d1.path)).toBe(nodefs.existsSync(d2.path));
  });

  it('opendirSync', () => {
    const d = fs.opendirSync('/dir');
    const nd = nodefs.opendirSync(R('dir'));
    const ours: string[] = [];
    const theirs: string[] = [];
    for (let e = d.readSync(); e; e = d.readSync()) ours.push(e.name);
    for (let e = nd.readSync(); e; e = nd.readSync()) theirs.push(e.name);
    d.closeSync(); nd.closeSync();
    expect(ours.sort()).toEqual(theirs.sort());
  });

  it('globSync', () => {
    same('globSync **/*.txt',
      () => (fs.globSync('/dir/**/*.txt') as string[]).map((p) => p.replace(/^\//, '')).sort(),
      () => (nodefs.globSync(`${root}/dir/**/*.txt`) as string[]).map((p) => p.replace(`${root}/`, '')).sort());
  });

  it('directory nlink follows the POSIX rule: 2 + subdirectories', () => {
    // Guarded on its own rather than against node, because the host filesystem does not
    // necessarily use the POSIX rule (APFS does not). This is the invariant `countSubdirectories`
    // exists to compute, and computing it used to build and *sort* an array of every child.
    fs.mkdirSync('/n/one', { recursive: true });
    fs.mkdirSync('/n/two', { recursive: true });
    fs.writeFileSync('/n/f1.txt', 'x');
    fs.writeFileSync('/n/f2.txt', 'y');
    expect(fs.statSync('/n')!.nlink).toBe(4);            // 2 + two subdirectories, files ignored

    fs.mkdirSync('/n/three');
    expect(fs.statSync('/n')!.nlink).toBe(5);
    fs.rmSync('/n/three', { recursive: true });
    expect(fs.statSync('/n')!.nlink).toBe(4);

    fs.mkdirSync('/empty');
    expect(fs.statSync('/empty')!.nlink).toBe(2);        // no children at all

    // Nested directories count for their own parent only, never transitively.
    fs.mkdirSync('/n/deep/nested', { recursive: true });
    expect(fs.statSync('/n')!.nlink).toBe(5);            // gained 'deep'
    expect(fs.statSync('/n/deep')!.nlink).toBe(3);       // contains 'nested'
    expect(fs.statSync('/n/deep/nested')!.nlink).toBe(2);
  });
});

// ===========================================================================
// Promises API — 32 functions
// ===========================================================================

describe('promises API parity', () => {
  beforeEach(seed);

  it('mirrors the sync results for every path-based method', async () => {
    await sameAsync('readFile', () => fs.promises.readFile('/file.txt', 'utf8'), () => nodefsp.readFile(R('file.txt'), 'utf8'));
    await sameAsync('readFile ENOENT', () => fs.promises.readFile('/nope'), () => nodefsp.readFile(R('nope')));
    await sameAsync('writeFile', () => fs.promises.writeFile('/p.txt', 'p'), () => nodefsp.writeFile(R('p.txt'), 'p'));
    await sameAsync('appendFile', () => fs.promises.appendFile('/p.txt', '!'), () => nodefsp.appendFile(R('p.txt'), '!'));
    await sameAsync('readFile after append', () => fs.promises.readFile('/p.txt', 'utf8'), () => nodefsp.readFile(R('p.txt'), 'utf8'));
    await sameAsync('stat', () => fs.promises.stat('/file.txt'), () => nodefsp.stat(R('file.txt')));
    await sameAsync('lstat', () => fs.promises.lstat('/file.txt'), () => nodefsp.lstat(R('file.txt')));
    await sameAsync('access', () => fs.promises.access('/file.txt'), () => nodefsp.access(R('file.txt')));
    await sameAsync('access ENOENT', () => fs.promises.access('/nope'), () => nodefsp.access(R('nope')));
    await sameAsync('readdir', async () => ((await fs.promises.readdir('/dir')) as string[]).sort(), async () => (await nodefsp.readdir(R('dir'))).sort());
    await sameAsync('mkdir', () => fs.promises.mkdir('/pm'), () => nodefsp.mkdir(R('pm')));
    await sameAsync('mkdir EEXIST', () => fs.promises.mkdir('/pm'), () => nodefsp.mkdir(R('pm')));
    await sameAsync('rmdir', () => fs.promises.rmdir('/pm'), () => nodefsp.rmdir(R('pm')));
    await sameAsync('copyFile', () => fs.promises.copyFile('/file.txt', '/pc.txt'), () => nodefsp.copyFile(R('file.txt'), R('pc.txt')));
    await sameAsync('rename', () => fs.promises.rename('/pc.txt', '/pr.txt'), () => nodefsp.rename(R('pc.txt'), R('pr.txt')));
    await sameAsync('unlink', () => fs.promises.unlink('/pr.txt'), () => nodefsp.unlink(R('pr.txt')));
    await sameAsync('truncate', () => fs.promises.truncate('/file.txt', 2), () => nodefsp.truncate(R('file.txt'), 2));
    await sameAsync('chmod', () => fs.promises.chmod('/file.txt', 0o644), () => nodefsp.chmod(R('file.txt'), 0o644));
    await sameAsync('symlink', () => fs.promises.symlink('/file.txt', '/plink'), () => nodefsp.symlink(R('file.txt'), R('plink')));
    await sameAsync('readlink', () => fs.promises.readlink('/plink'), async () => rel((await nodefsp.readlink(R('plink'))) as string));
    await sameAsync('realpath', () => fs.promises.realpath('/plink'), async () => rel((await nodefsp.realpath(R('plink'))) as string));
    await sameAsync('link', () => fs.promises.link('/file.txt', '/plink2'), () => nodefsp.link(R('file.txt'), R('plink2')));
    await sameAsync('cp', () => fs.promises.cp('/dir', '/dir-p', { recursive: true }), () => nodefsp.cp(R('dir'), R('dir-p'), { recursive: true }));
    await sameAsync('rm', () => fs.promises.rm('/dir-p', { recursive: true }), () => nodefsp.rm(R('dir-p'), { recursive: true }));
    await sameAsync('utimes', () => fs.promises.utimes('/file.txt', 1_600_000_000, 1_600_000_000), () => nodefsp.utimes(R('file.txt'), 1_600_000_000, 1_600_000_000));
    await sameAsync('lutimes', () => fs.promises.lutimes('/plink', 1_600_000_000, 1_600_000_000), () => nodefsp.lutimes(R('plink'), 1_600_000_000, 1_600_000_000));
    const { uid, gid } = nodefs.statSync(R('file.txt'));
    await sameAsync('chown', () => fs.promises.chown('/file.txt', uid, gid), () => nodefsp.chown(R('file.txt'), uid, gid));
    await sameAsync('lchown', () => fs.promises.lchown('/plink', uid, gid), () => nodefsp.lchown(R('plink'), uid, gid));
    await sameAsync('glob', async () => (await Array.fromAsync(fs.promises.glob('/dir/**/*.txt') as AsyncIterable<string>)).map((p) => p.replace(/^\//, '')).sort(),
                            async () => (await Array.fromAsync(nodefsp.glob(`${root}/dir/**/*.txt`) as AsyncIterable<string>)).map((p) => p.replace(`${root}/`, '')).sort());
    expect(ourTree()).toEqual(nodeTree());
  });

  it('statfs / mkdtemp / mkdtempDisposable / opendir', async () => {
    const ours = await fs.promises.statfs('/') as Record<string, number>;
    const theirs = await nodefsp.statfs(root) as unknown as Record<string, number>;
    expect(Object.keys(ours).sort()).toEqual(Object.keys(theirs).sort());

    const d = await fs.promises.mkdtemp('/pt-');
    expect(d.startsWith('/pt-')).toBe(true);

    const dis = await fs.promises.mkdtempDisposable('/pd-');
    const ndis = await nodefsp.mkdtempDisposable(join(root, 'pd-'));
    expect(Object.keys(dis).sort()).toEqual(Object.keys(ndis).sort());
    await dis.remove(); await ndis.remove();

    const dir = await fs.promises.opendir('/dir');
    const ndir = await nodefsp.opendir(R('dir'));
    const a: string[] = [], b: string[] = [];
    for await (const e of dir) a.push(e.name);
    for await (const e of ndir) b.push(e.name);
    expect(a.sort()).toEqual(b.sort());
  });

  it('open + every FileHandle method', async () => {
    const h = await fs.promises.open('/fh.txt', 'w+');
    const nh = await nodefsp.open(R('fh.txt'), 'w+');
    try {
      await sameAsync('handle.write', async () => (await h.write('abcdef')).bytesWritten, async () => (await nh.write('abcdef')).bytesWritten);
      await sameAsync('handle.stat', () => h.stat(), () => nh.stat());
      await sameAsync('handle.truncate', () => h.truncate(3), () => nh.truncate(3));
      await sameAsync('handle.chmod', () => h.chmod(0o600), () => nh.chmod(0o600));
      await sameAsync('handle.sync', () => h.sync(), () => nh.sync());
      await sameAsync('handle.datasync', () => h.datasync(), () => nh.datasync());
      await sameAsync('handle.utimes', () => h.utimes(1_600_000_000, 1_600_000_000), () => nh.utimes(1_600_000_000, 1_600_000_000));

      const b = new Uint8Array(3), nb = Buffer.alloc(3);
      await sameAsync('handle.read', async () => (await h.read(b, 0, 3, 0)).bytesRead, async () => (await nh.read(nb, 0, 3, 0)).bytesRead);
      expect(Array.from(b)).toEqual(Array.from(nb));

      await sameAsync('handle.writev', async () => (await h.writev([new Uint8Array([9])], 0)).bytesWritten,
                                        async () => (await nh.writev([Buffer.from([9])], 0)).bytesWritten);
      const rv = new Uint8Array(1), nrv = Buffer.alloc(1);
      await sameAsync('handle.readv', async () => (await h.readv([rv], 0)).bytesRead, async () => (await nh.readv([nrv], 0)).bytesRead);
      expect(Array.from(rv)).toEqual(Array.from(nrv));

      await sameAsync('handle.readFile', () => h.readFile('utf8' as never), () => nh.readFile('utf8'));
      const { uid, gid } = nodefs.statSync(R('fh.txt'));
      await sameAsync('handle.chown', () => h.chown(uid, gid), () => nh.chown(uid, gid));
    } finally {
      await h.close(); await nh.close();
    }
    same('contents after handle ops', () => fs.readFileSync('/fh.txt'), () => nodefs.readFileSync(R('fh.txt')));
  });
});

// ===========================================================================
// Callback API — 49 functions
// ===========================================================================

describe('callback API parity', () => {
  beforeEach(seed);

  const cb = <T>(fn: (done: (e: unknown, v?: T) => void) => void) =>
    new Promise<Outcome>((resolve) => fn((e, v) => resolve(e ? { ok: false, code: (e as { code?: string }).code ?? (e as Error).name } : { ok: true, value: v })));

  async function sameCb(label: string, ours: (d: (e: unknown, v?: unknown) => void) => void, theirs: (d: (e: unknown, v?: unknown) => void) => void) {
    const a = await cb(ours);
    const b = await cb(theirs);
    expect(a.ok, `${label}: ours ${a.ok ? 'ok' : a.code}, node ${b.ok ? 'ok' : b.code}`).toBe(b.ok);
    if (a.ok && b.ok) expect(normalise(a.value), label).toEqual(normalise(b.value));
    else if (!a.ok && !b.ok) expect(a.code, `${label}: code`).toBe(b.code);
  }

  it('delivers the same results and errors through callbacks', async () => {
    await sameCb('readFile', (d) => fs.readFile('/file.txt', 'utf8', d as never), (d) => nodefs.readFile(R('file.txt'), 'utf8', d as never));
    await sameCb('readFile ENOENT', (d) => fs.readFile('/nope', d as never), (d) => nodefs.readFile(R('nope'), d as never));
    await sameCb('writeFile', (d) => fs.writeFile('/cb.txt', 'x', d as never), (d) => nodefs.writeFile(R('cb.txt'), 'x', d as never));
    await sameCb('appendFile', (d) => fs.appendFile('/cb.txt', 'y', d as never), (d) => nodefs.appendFile(R('cb.txt'), 'y', d as never));
    await sameCb('stat', (d) => fs.stat('/file.txt', d as never), (d) => nodefs.stat(R('file.txt'), d as never));
    await sameCb('lstat', (d) => fs.lstat('/file.txt', d as never), (d) => nodefs.lstat(R('file.txt'), d as never));
    await sameCb('access', (d) => fs.access('/file.txt', d as never), (d) => nodefs.access(R('file.txt'), d as never));
    await sameCb('readdir', (d) => fs.readdir('/dir', (e, v) => d(e, (v as string[])?.sort())), (d) => nodefs.readdir(R('dir'), (e, v) => d(e, v?.sort())));
    await sameCb('mkdir', (d) => fs.mkdir('/cbd', d as never), (d) => nodefs.mkdir(R('cbd'), d as never));
    await sameCb('rmdir', (d) => fs.rmdir('/cbd', d as never), (d) => nodefs.rmdir(R('cbd'), d as never));
    await sameCb('copyFile', (d) => fs.copyFile('/file.txt', '/cbc.txt', d as never), (d) => nodefs.copyFile(R('file.txt'), R('cbc.txt'), d as never));
    await sameCb('rename', (d) => fs.rename('/cbc.txt', '/cbr.txt', d as never), (d) => nodefs.rename(R('cbc.txt'), R('cbr.txt'), d as never));
    await sameCb('unlink', (d) => fs.unlink('/cbr.txt', d as never), (d) => nodefs.unlink(R('cbr.txt'), d as never));
    await sameCb('truncate', (d) => fs.truncate('/file.txt', 3, d as never), (d) => nodefs.truncate(R('file.txt'), 3, d as never));
    await sameCb('chmod', (d) => fs.chmod('/file.txt', 0o644, d as never), (d) => nodefs.chmod(R('file.txt'), 0o644, d as never));
    await sameCb('symlink', (d) => fs.symlink('/file.txt', '/cbl', d as never), (d) => nodefs.symlink(R('file.txt'), R('cbl'), d as never));
    await sameCb('readlink', (d) => fs.readlink('/cbl', (e, v) => d(e, v)), (d) => nodefs.readlink(R('cbl'), (e, v) => d(e, v && rel(v as string))));
    await sameCb('realpath', (d) => fs.realpath('/cbl', (e, v) => d(e, v)), (d) => nodefs.realpath(R('cbl'), (e, v) => d(e, v && rel(v as string))));
    await sameCb('link', (d) => fs.link('/file.txt', '/cbh', d as never), (d) => nodefs.link(R('file.txt'), R('cbh'), d as never));
    await sameCb('cp', (d) => fs.cp('/dir', '/dir-cb', { recursive: true }, d as never), (d) => nodefs.cp(R('dir'), R('dir-cb'), { recursive: true }, d as never));
    await sameCb('rm', (d) => fs.rm('/dir-cb', { recursive: true }, d as never), (d) => nodefs.rm(R('dir-cb'), { recursive: true }, d as never));
    await sameCb('utimes', (d) => fs.utimes('/file.txt', 1_600_000_000, 1_600_000_000, d as never), (d) => nodefs.utimes(R('file.txt'), 1_600_000_000, 1_600_000_000, d as never));
    await sameCb('lutimes', (d) => fs.lutimes('/cbl', 1_600_000_000, 1_600_000_000, d as never), (d) => nodefs.lutimes(R('cbl'), 1_600_000_000, 1_600_000_000, d as never));
    await sameCb('mkdtemp', (d) => fs.mkdtemp('/cbt-', (e, v) => d(e, typeof v === 'string')), (d) => nodefs.mkdtemp(join(root, 'cbt-'), (e, v) => d(e, typeof v === 'string')));
    await sameCb('statfs', (d) => fs.statfs('/', (e, v) => d(e, Object.keys(v ?? {}).sort())), (d) => nodefs.statfs(root, (e, v) => d(e, Object.keys(v ?? {}).sort())));
    await sameCb('glob', (d) => fs.glob('/dir/**/*.txt', (e, v) => d(e, (v as string[])?.map((p) => p.replace(/^\//, '')).sort())),
                        (d) => nodefs.glob(`${root}/dir/**/*.txt`, (e, v) => d(e, (v as string[])?.map((p) => p.replace(`${root}/`, '')).sort())));
    expect(ourTree()).toEqual(nodeTree());
  });

  it('exists (legacy, no error argument)', async () => {
    const ours = await new Promise<boolean>((r) => fs.exists('/file.txt', r));
    const theirs = await new Promise<boolean>((r) => nodefs.exists(R('file.txt'), r));
    expect(ours).toBe(theirs);
    const oursMissing = await new Promise<boolean>((r) => fs.exists('/nope', r));
    const theirsMissing = await new Promise<boolean>((r) => nodefs.exists(R('nope'), r));
    expect(oursMissing).toBe(theirsMissing);
  });

  it('fd-based callbacks: open, read, write, fstat, ftruncate, fsync, fdatasync, close', async () => {
    const fd = await new Promise<number>((r, j) => fs.open('/cbfd.txt', 'w+', (e, v) => (e ? j(e) : r(v!))));
    const nfd = await new Promise<number>((r, j) => nodefs.open(R('cbfd.txt'), 'w+', (e, v) => (e ? j(e) : r(v!))));

    await sameCb('write', (d) => fs.write(fd, 'hello', (e, n) => d(e, n)), (d) => nodefs.write(nfd, 'hello', (e, n) => d(e, n)));
    const b = new Uint8Array(5), nb = Buffer.alloc(5);
    await sameCb('read', (d) => fs.read(fd, b, 0, 5, 0, (e, n) => d(e, n)), (d) => nodefs.read(nfd, nb, 0, 5, 0, (e, n) => d(e, n)));
    expect(Array.from(b)).toEqual(Array.from(nb));
    await sameCb('fstat', (d) => fs.fstat(fd, d as never), (d) => nodefs.fstat(nfd, d as never));
    await sameCb('fchmod', (d) => fs.fchmod(fd, 0o600, d as never), (d) => nodefs.fchmod(nfd, 0o600, d as never));
    await sameCb('futimes', (d) => fs.futimes(fd, 1_600_000_000, 1_600_000_000, d as never), (d) => nodefs.futimes(nfd, 1_600_000_000, 1_600_000_000, d as never));
    await sameCb('ftruncate', (d) => fs.ftruncate(fd, 2, d as never), (d) => nodefs.ftruncate(nfd, 2, d as never));
    await sameCb('fsync', (d) => fs.fsync(fd, d as never), (d) => nodefs.fsync(nfd, d as never));
    await sameCb('fdatasync', (d) => fs.fdatasync(fd, d as never), (d) => nodefs.fdatasync(nfd, d as never));
    await sameCb('writev', (d) => fs.writev(fd, [new Uint8Array([7])], 0, (e, n) => d(e, n)), (d) => nodefs.writev(nfd, [Buffer.from([7])], 0, (e, n) => d(e, n)));
    const rv = new Uint8Array(1), nrv = Buffer.alloc(1);
    await sameCb('readv', (d) => fs.readv(fd, [rv], 0, (e, n) => d(e, n)), (d) => nodefs.readv(nfd, [nrv], 0, (e, n) => d(e, n)));
    expect(Array.from(rv)).toEqual(Array.from(nrv));
    await sameCb('close', (d) => fs.close(fd, d as never), (d) => nodefs.close(nfd, d as never));
    same('contents after fd callbacks', () => fs.readFileSync('/cbfd.txt'), () => nodefs.readFileSync(R('cbfd.txt')));
  });

  it('openAsBlob', async () => {
    const ours = await fs.openAsBlob('/file.txt');
    const theirs = await nodefs.openAsBlob(R('file.txt'));
    expect(ours.size).toBe(theirs.size);
    expect(await ours.text()).toBe(await theirs.text());
  });

  it('opendir (callback form)', async () => {
    const names = await new Promise<string[]>((res, rej) => {
      fs.opendir('/dir', async (e, d) => {
        if (e) return rej(e);
        const out: string[] = [];
        for await (const ent of d!) out.push(ent.name);
        res(out.sort());
      });
    });
    const nodeNames = await new Promise<string[]>((res, rej) => {
      nodefs.opendir(R('dir'), async (e, d) => {
        if (e) return rej(e);
        const out: string[] = [];
        for await (const ent of d!) out.push(ent.name);
        res(out.sort());
      });
    });
    expect(names).toEqual(nodeNames);
  });

  it('watch / watchFile / unwatchFile exist and are callable', async () => {
    // Event *timing* is platform-dependent in Node itself; this checks the contract, not delivery.
    const w = fs.watch('/dir', () => {});
    expect(typeof w.close).toBe('function');
    w.close();

    fs.watchFile('/file.txt', () => {});
    fs.unwatchFile('/file.txt');
  });
});

describe('the link-and-descriptor metadata calls', () => {
  beforeEach(seed);

  // These five had no differential coverage until a check of the coverage itself found them:
  // `lchmod`/`lchmodSync` and `lchown`'s sync form act on the *link* rather than its target, and
  // `fchown`'s callback form was only ever exercised through its sync sibling.
  it('lchmodSync / lchownSync act on the link, matching node', () => {
    fs.symlinkSync('/file.txt', '/lnk');
    nodefs.symlinkSync(R('file.txt'), R('lnk'));
    const { uid, gid } = nodefs.statSync(R('file.txt'));

    // `lchmod` exists only where the platform has lchmod(2) — macOS does, Linux does not, and
    // node reports ENOSYS there. Comparing outcomes covers both without branching on platform.
    same('lchmodSync', () => fs.lchmodSync('/lnk', 0o600), () => nodefs.lchmodSync(R('lnk'), 0o600));
    same('lchownSync', () => fs.lchownSync('/lnk', uid, gid), () => nodefs.lchownSync(R('lnk'), uid, gid));

    // The target must be untouched by either — that is what makes them "l" calls.
    same('target after lchmod', () => fs.statSync('/file.txt'), () => nodefs.statSync(R('file.txt')));

    same('lchmodSync ENOENT', () => fs.lchmodSync('/missing', 0o600), () => nodefs.lchmodSync(R('missing'), 0o600));
    same('lchownSync ENOENT', () => fs.lchownSync('/missing', uid, gid), () => nodefs.lchownSync(R('missing'), uid, gid));
  });

  it('fchown and lchmod through their callback forms', async () => {
    fs.symlinkSync('/file.txt', '/lnk2');
    nodefs.symlinkSync(R('file.txt'), R('lnk2'));
    const { uid, gid } = nodefs.statSync(R('file.txt'));

    const run = (fn: (d: (e: unknown) => void) => void) =>
      new Promise<string>((res) => fn((e) => res(e ? ((e as { code?: string }).code ?? 'ERR') : 'ok')));

    const fd = fs.openSync('/file.txt', 'r+');
    const nfd = nodefs.openSync(R('file.txt'), 'r+');
    expect(await run((d) => fs.fchown(fd, uid, gid, d as never)))
      .toBe(await run((d) => nodefs.fchown(nfd, uid, gid, d as never)));
    fs.closeSync(fd);
    nodefs.closeSync(nfd);

    expect(await run((d) => fs.lchmod('/lnk2', 0o600, d as never)))
      .toBe(await run((d) => nodefs.lchmod(R('lnk2'), 0o600, d as never)));
  });

  it('promises.lchmod matches node', async () => {
    fs.symlinkSync('/file.txt', '/lnk3');
    nodefs.symlinkSync(R('file.txt'), R('lnk3'));
    await sameAsync('promises.lchmod', () => fs.promises.lchmod('/lnk3', 0o600), () => nodefsp.lchmod(R('lnk3'), 0o600));
    await sameAsync('promises.lchmod ENOENT', () => fs.promises.lchmod('/nope', 0o600), () => nodefsp.lchmod(R('nope'), 0o600));
  });
});

// ===========================================================================
// Constructors — 7
// ===========================================================================

describe('exported classes', () => {
  beforeEach(seed);

  it('stat and readdir results are instances of the exported classes', () => {
    expect(fs.statSync('/file.txt')).toBeInstanceOf(fs.Stats);
    const [entry] = fs.readdirSync('/dir', { withFileTypes: true }) as never[];
    expect(entry).toBeInstanceOf(fs.Dirent);
    const d = fs.opendirSync('/dir');
    expect(d).toBeInstanceOf(fs.Dir);
    d.closeSync();
  });

  it('stream constructors are the same objects Node aliases', () => {
    expect(fs.FileReadStream).toBe(fs.ReadStream);
    expect(fs.FileWriteStream).toBe(fs.WriteStream);
    expect(fs.createReadStream('/file.txt')).toBeInstanceOf(fs.ReadStream);
    expect(fs.createWriteStream('/ws.txt')).toBeInstanceOf(fs.WriteStream);
  });
});
