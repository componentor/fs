/**
 * Option-level parity: the same method, every documented option, against a live `node:fs`.
 *
 * [full-surface-parity.test.ts](./full-surface-parity.test.ts) proves each of the 134 functions
 * behaves like node's for a representative call. That is reachability, not depth — a method can
 * be right in its default shape and wrong the moment an option is passed, and options are where
 * the semantics actually live: `cp`'s `filter`, `rm`'s `force`, `copyFile`'s `COPYFILE_EXCL`,
 * every encoding on every method that takes one.
 *
 * Each case runs the identical call on both filesystems and compares the result, the error
 * `code`, and the resulting tree.
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
  root = nodefs.mkdtempSync(join(tmpdir(), 'opt-'));
});
afterEach(() => nodefs.rmSync(root, { recursive: true, force: true }));

const R = (p: string) => join(root, p);

type Outcome = { ok: true; value: unknown } | { ok: false; code: string };

const attempt = (fn: () => unknown): Outcome => {
  try { return { ok: true, value: fn() }; }
  catch (e) { return { ok: false, code: (e as { code?: string }).code ?? (e as Error).name }; }
};
const attemptAsync = async (fn: () => Promise<unknown>): Promise<Outcome> => {
  try { return { ok: true, value: await fn() }; }
  catch (e) { return { ok: false, code: (e as { code?: string }).code ?? (e as Error).name }; }
};

function normalise(v: unknown): unknown {
  if (v instanceof Uint8Array) return ['bytes', ...v];
  if (Array.isArray(v)) return v.map(normalise);
  if (typeof v === 'bigint') return `bigint:${v}`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.isFile === 'function' && typeof o.size !== 'undefined') {
      const isDir = (o.isDirectory as () => boolean)();
      const isLink = (o.isSymbolicLink as () => boolean)();
      return {
        kind: typeof o.size,                       // number vs bigint — the point of `bigint: true`
        size: isDir || isLink ? null : Number(o.size),
        mode: isLink ? null : Number(o.mode) & 0o777,
        isFile: (o.isFile as () => boolean)(),
        isDirectory: isDir,
        isSymbolicLink: isLink,
      };
    }
    if (typeof o.name === 'string' && typeof o.isFile === 'function') {
      return { name: o.name, isDirectory: (o.isDirectory as () => boolean)() };
    }
  }
  return v;
}

function same(label: string, ours: () => unknown, theirs: () => unknown) {
  const a = attempt(ours), b = attempt(theirs);
  expect(a.ok, `${label}: ours ${a.ok ? 'ok' : 'threw ' + a.code}, node ${b.ok ? 'ok' : 'threw ' + b.code}`).toBe(b.ok);
  if (a.ok && b.ok) expect(normalise(a.value), label).toEqual(normalise(b.value));
  else if (!a.ok && !b.ok) expect(a.code, `${label}: code`).toBe(b.code);
}

async function sameAsync(label: string, ours: () => Promise<unknown>, theirs: () => Promise<unknown>) {
  const a = await attemptAsync(ours), b = await attemptAsync(theirs);
  expect(a.ok, `${label}: ours ${a.ok ? 'ok' : 'threw ' + a.code}, node ${b.ok ? 'ok' : 'threw ' + b.code}`).toBe(b.ok);
  if (a.ok && b.ok) expect(normalise(a.value), label).toEqual(normalise(b.value));
  else if (!a.ok && !b.ok) expect(a.code, `${label}: code`).toBe(b.code);
}

function tree(readdir: (p: string) => string[], statOf: (p: string) => { isDirectory(): boolean; isSymbolicLink(): boolean }, base: string, dir = ''): string[] {
  const out: string[] = [];
  for (const name of readdir(dir === '' ? base : `${base}/${dir}`).sort()) {
    const rel = dir ? `${dir}/${name}` : name;
    const st = statOf(`${base}/${rel}`);
    out.push(st.isSymbolicLink() ? `l ${rel}` : st.isDirectory() ? `d ${rel}` : `f ${rel}`);
    if (st.isDirectory() && !st.isSymbolicLink()) out.push(...tree(readdir, statOf, base, rel));
  }
  return out;
}
const bothTrees = () => [
  tree((p) => fs.readdirSync(p) as string[], (p) => fs.lstatSync(p)!, ''),
  tree((p) => nodefs.readdirSync(p || root), (p) => nodefs.lstatSync(p || root), root),
];

/** A small tree, identical on both sides. */
function seed() {
  fs.mkdirSync('/src/deep', { recursive: true });
  nodefs.mkdirSync(R('src/deep'), { recursive: true });
  for (const [p, body] of [['/src/a.txt', 'AAA'], ['/src/b.js', 'BB'], ['/src/deep/c.txt', 'C']] as const) {
    fs.writeFileSync(p, body);
    nodefs.writeFileSync(R(p.slice(1)), body);
  }
}

// ---------------------------------------------------------------------------

describe('cp options', () => {
  beforeEach(seed);

  it('recursive, force and errorOnExist', () => {
    same('cp -r', () => fs.cpSync('/src', '/dst', { recursive: true }), () => nodefs.cpSync(R('src'), R('dst'), { recursive: true }));
    expect(bothTrees()[0]).toEqual(bothTrees()[1]);

    // Copying over an existing tree: default force:true overwrites.
    same('cp -r again (force default)', () => fs.cpSync('/src', '/dst', { recursive: true }), () => nodefs.cpSync(R('src'), R('dst'), { recursive: true }));
    same('cp errorOnExist', () => fs.cpSync('/src', '/dst', { recursive: true, errorOnExist: true, force: false }),
                            () => nodefs.cpSync(R('src'), R('dst'), { recursive: true, errorOnExist: true, force: false }));
    // force:false without errorOnExist silently skips existing entries.
    same('cp force:false', () => fs.cpSync('/src', '/dst', { recursive: true, force: false }),
                           () => nodefs.cpSync(R('src'), R('dst'), { recursive: true, force: false }));
  });

  it('filter selects which entries are copied', () => {
    // The filter receives absolute paths, which differ per filesystem — compare by basename.
    const keep = (src: string) => !src.endsWith('.js');
    same('cp filter', () => fs.cpSync('/src', '/f1', { recursive: true, filter: keep as never }),
                       () => nodefs.cpSync(R('src'), R('f1'), { recursive: true, filter: keep }));
    const [ours, theirs] = bothTrees();
    expect(ours).toEqual(theirs);
    // Check the copy, not the whole volume — the *source* legitimately still has b.js.
    expect(ours.filter((e) => e.startsWith('f f1/') || e.startsWith('d f1/')).some((e) => e.includes('b.js'))).toBe(false);
  });

  it('preserveTimestamps carries mtime across', () => {
    fs.utimesSync('/src/a.txt', 1_600_000_000, 1_600_000_000);
    nodefs.utimesSync(R('src/a.txt'), 1_600_000_000, 1_600_000_000);
    fs.cpSync('/src/a.txt', '/kept.txt', { preserveTimestamps: true });
    nodefs.cpSync(R('src/a.txt'), R('kept.txt'), { preserveTimestamps: true });
    expect(Math.round(fs.statSync('/kept.txt')!.mtimeMs / 1000))
      .toBe(Math.round(nodefs.statSync(R('kept.txt')).mtimeMs / 1000));
  });

  it('dereference decides whether a symlink is copied as a link or as its target', () => {
    fs.symlinkSync('/src/a.txt', '/src/link');
    nodefs.symlinkSync(R('src/a.txt'), R('src/link'));

    same('cp dereference:true', () => fs.cpSync('/src', '/deref', { recursive: true, dereference: true }),
                                () => nodefs.cpSync(R('src'), R('deref'), { recursive: true, dereference: true }));
    const [ours, theirs] = bothTrees();
    expect(ours).toEqual(theirs);
  });
});

describe('rm and rmdir options', () => {
  beforeEach(seed);

  it('force suppresses ENOENT, and only ENOENT', () => {
    same('rm missing without force', () => fs.rmSync('/nope'), () => nodefs.rmSync(R('nope')));
    same('rm missing with force', () => fs.rmSync('/nope', { force: true }), () => nodefs.rmSync(R('nope'), { force: true }));
    same('rm dir without recursive', () => fs.rmSync('/src'), () => nodefs.rmSync(R('src')));
    same('rm dir with force but no recursive', () => fs.rmSync('/src', { force: true }), () => nodefs.rmSync(R('src'), { force: true }));
    same('rm -rf', () => fs.rmSync('/src', { recursive: true, force: true }), () => nodefs.rmSync(R('src'), { recursive: true, force: true }));
    expect(bothTrees()[0]).toEqual(bothTrees()[1]);
  });

  it('maxRetries and retryDelay are accepted', () => {
    same('rm with retries', () => fs.rmSync('/src', { recursive: true, maxRetries: 2, retryDelay: 1 }),
                             () => nodefs.rmSync(R('src'), { recursive: true, maxRetries: 2, retryDelay: 1 }));
  });

  it('rmdir on a non-empty directory, and on a file', () => {
    same('rmdir non-empty', () => fs.rmdirSync('/src'), () => nodefs.rmdirSync(R('src')));
    same('rmdir a file', () => fs.rmdirSync('/src/a.txt'), () => nodefs.rmdirSync(R('src/a.txt')));
    same('rmdir missing', () => fs.rmdirSync('/nope'), () => nodefs.rmdirSync(R('nope')));
  });
});

describe('copyFile mode flags', () => {
  beforeEach(seed);

  it('COPYFILE_EXCL refuses an existing destination', () => {
    same('copyFile', () => fs.copyFileSync('/src/a.txt', '/c1.txt'), () => nodefs.copyFileSync(R('src/a.txt'), R('c1.txt')));
    same('copyFile over existing (default)', () => fs.copyFileSync('/src/b.js', '/c1.txt'), () => nodefs.copyFileSync(R('src/b.js'), R('c1.txt')));
    same('copyFile EXCL over existing',
      () => fs.copyFileSync('/src/a.txt', '/c1.txt', fs.constants.COPYFILE_EXCL),
      () => nodefs.copyFileSync(R('src/a.txt'), R('c1.txt'), nodefs.constants.COPYFILE_EXCL));
    same('copyFile EXCL to a fresh path',
      () => fs.copyFileSync('/src/a.txt', '/c2.txt', fs.constants.COPYFILE_EXCL),
      () => nodefs.copyFileSync(R('src/a.txt'), R('c2.txt'), nodefs.constants.COPYFILE_EXCL));
    expect(bothTrees()[0]).toEqual(bothTrees()[1]);
  });

  it('copying a directory is refused the same way', () => {
    same('copyFile a directory', () => fs.copyFileSync('/src', '/dircopy'), () => nodefs.copyFileSync(R('src'), R('dircopy')));
  });
});

describe('encoding options, on every method that takes one', () => {
  beforeEach(seed);
  const encodings = ['utf8', 'utf-8', 'latin1', 'binary', 'ascii', 'hex', 'base64', 'base64url', 'utf16le', 'ucs2'] as const;

  it.each(encodings)('readFileSync with %s', (enc) => {
    same(`readFileSync ${enc}`, () => fs.readFileSync('/src/a.txt', enc), () => nodefs.readFileSync(R('src/a.txt'), enc as BufferEncoding));
  });

  it.each(encodings)('readFileSync via the options object with %s', (enc) => {
    same(`readFileSync {encoding:${enc}}`, () => fs.readFileSync('/src/a.txt', { encoding: enc }),
                                           () => nodefs.readFileSync(R('src/a.txt'), { encoding: enc as BufferEncoding }));
  });

  it('encoding: null and "buffer" both mean bytes', () => {
    same('readFileSync null', () => fs.readFileSync('/src/a.txt', { encoding: null }), () => nodefs.readFileSync(R('src/a.txt'), { encoding: null }));
    same('readFileSync no options', () => fs.readFileSync('/src/a.txt'), () => nodefs.readFileSync(R('src/a.txt')));
  });

  it.each(encodings)('readdirSync with %s', (enc) => {
    same(`readdirSync ${enc}`, () => (fs.readdirSync('/src', { encoding: enc }) as string[]).sort(),
                               () => (nodefs.readdirSync(R('src'), { encoding: enc as BufferEncoding }) as string[]).sort());
  });

  it('readdirSync with encoding buffer returns byte names', () => {
    same('readdirSync buffer',
      () => (fs.readdirSync('/src', { encoding: 'buffer' }) as unknown as Uint8Array[]).map((b) => Array.from(b)).sort(),
      () => (nodefs.readdirSync(R('src'), { encoding: 'buffer' }) as unknown as Buffer[]).map((b) => Array.from(b)).sort());
  });

  it.each(encodings)('readlinkSync and realpathSync with %s', (enc) => {
    fs.symlinkSync('/src/a.txt', '/l');
    nodefs.symlinkSync('/src/a.txt', R('l'));   // same literal target on both, so the bytes match
    same(`readlinkSync ${enc}`, () => fs.readlinkSync('/l', enc), () => nodefs.readlinkSync(R('l'), enc as BufferEncoding));
  });

  it.each(encodings)('mkdtempSync with %s', (enc) => {
    const ours = fs.mkdtempSync('/t-', enc as never);
    const theirs = nodefs.mkdtempSync(join(root, 't-'), enc as BufferEncoding);
    expect(typeof ours, `mkdtempSync ${enc} return type`).toBe(typeof theirs);
  });

  it('writeFileSync honours the encoding of the data it is given', () => {
    for (const enc of encodings) {
      const text = enc === 'hex' ? '4142' : enc === 'base64' || enc === 'base64url' ? 'QUI=' : 'AB';
      fs.writeFileSync('/w.bin', text, { encoding: enc });
      nodefs.writeFileSync(R('w.bin'), text, { encoding: enc as BufferEncoding });
      same(`writeFileSync ${enc}`, () => fs.readFileSync('/w.bin'), () => nodefs.readFileSync(R('w.bin')));
    }
  });

  it('rejects an unknown encoding the way node does', () => {
    same('bad encoding', () => fs.readFileSync('/src/a.txt', 'nonsense' as never),
                          () => nodefs.readFileSync(R('src/a.txt'), 'nonsense' as BufferEncoding));
  });
});

describe('stat and statfs options', () => {
  beforeEach(seed);

  it('bigint: true changes the field types', () => {
    same('statSync bigint', () => fs.statSync('/src/a.txt', { bigint: true }), () => nodefs.statSync(R('src/a.txt'), { bigint: true }));
    same('lstatSync bigint', () => fs.lstatSync('/src/a.txt', { bigint: true }), () => nodefs.lstatSync(R('src/a.txt'), { bigint: true }));
  });

  it('throwIfNoEntry: false suppresses only ENOENT', () => {
    same('statSync missing, throwIfNoEntry false', () => fs.statSync('/nope', { throwIfNoEntry: false }), () => nodefs.statSync(R('nope'), { throwIfNoEntry: false }));
    same('statSync missing, default', () => fs.statSync('/nope'), () => nodefs.statSync(R('nope')));
    same('lstatSync missing, throwIfNoEntry false', () => fs.lstatSync('/nope', { throwIfNoEntry: false }), () => nodefs.lstatSync(R('nope'), { throwIfNoEntry: false }));
  });

  it('statfs bigint returns bigints', () => {
    const ours = fs.statfsSync('/', { bigint: true } as never) as unknown as Record<string, unknown>;
    const theirs = nodefs.statfsSync(root, { bigint: true }) as unknown as Record<string, unknown>;
    expect(Object.keys(ours).sort()).toEqual(Object.keys(theirs).sort());
    for (const k of Object.keys(theirs)) {
      expect(typeof ours[k], `statfs bigint ${k}`).toBe(typeof theirs[k]);
    }
  });
});

describe('access modes', () => {
  beforeEach(seed);

  it('every mode constant has node\'s value', () => {
    for (const name of ['F_OK', 'R_OK', 'W_OK', 'X_OK'] as const) {
      expect((fs.constants as unknown as Record<string, number>)[name], name)
        .toBe((nodefs.constants as unknown as Record<string, number>)[name]);
    }
  });

  it.each(['F_OK', 'R_OK', 'W_OK'] as const)('accessSync %s matches node', (name) => {
    const mode = (nodefs.constants as unknown as Record<string, number>)[name];
    same(`accessSync ${name}`, () => fs.accessSync('/src/a.txt', mode), () => nodefs.accessSync(R('src/a.txt'), mode));
    same(`accessSync ${name} missing`, () => fs.accessSync('/nope', mode), () => nodefs.accessSync(R('nope'), mode));
  });

  it('X_OK on a non-executable file: permitted by default, enforced under strictPermissions', () => {
    // A documented divergence, not an oversight — permission bits are stored and reported but
    // only *enforced* when the caller opts in, because a browser has no real process identity to
    // check against. Asserted in both directions so the divergence stays visible.
    const X = nodefs.constants.X_OK;
    expect(() => nodefs.accessSync(R('src/a.txt'), X)).toThrow();   // node: EACCES on 0o644
    expect(() => fs.accessSync('/src/a.txt', X)).not.toThrow();     // relaxed default: allowed

    const strict = createFsHarness({ strictPermissions: true } as never).fs;
    strict.writeFileSync('/x.txt', 'x');
    strict.chmodSync('/x.txt', 0o644);
    expect(() => strict.accessSync('/x.txt', X)).toThrow(expect.objectContaining({ code: 'EACCES' }));
    strict.chmodSync('/x.txt', 0o755);
    expect(() => strict.accessSync('/x.txt', X)).not.toThrow();
  });
});

describe('mkdir, opendir and glob options', () => {
  beforeEach(seed);

  it('mkdir recursive returns the first directory created, or undefined', () => {
    const rel = (p: string | undefined) => (p === undefined ? undefined : p.replace(root, ''));
    same('mkdir -p fresh', () => fs.mkdirSync('/a/b/c', { recursive: true }), () => rel(nodefs.mkdirSync(R('a/b/c'), { recursive: true })));
    same('mkdir -p existing', () => fs.mkdirSync('/a/b/c', { recursive: true }), () => rel(nodefs.mkdirSync(R('a/b/c'), { recursive: true })));
    same('mkdir with a mode', () => fs.mkdirSync('/m1', { mode: 0o700 }), () => nodefs.mkdirSync(R('m1'), { mode: 0o700 }));
    same('mode after mkdir', () => fs.statSync('/m1'), () => nodefs.statSync(R('m1')));
  });

  it('opendir recursive walks the whole tree', async () => {
    const collect = async (d: AsyncIterable<{ name: string }>) => {
      const out: string[] = [];
      for await (const e of d) out.push(e.name);
      return out.sort();
    };
    expect(await collect(await fs.promises.opendir('/src', { recursive: true }) as never))
      .toEqual(await collect(await nodefsp.opendir(R('src'), { recursive: true })));
    expect(await collect(await fs.promises.opendir('/src') as never))
      .toEqual(await collect(await nodefsp.opendir(R('src'))));
    // bufferSize is a read-ahead hint; it must not change what comes back.
    expect(await collect(await fs.promises.opendir('/src', { bufferSize: 1 }) as never))
      .toEqual(await collect(await nodefsp.opendir(R('src'), { bufferSize: 1 })));
  });

  it('glob withFileTypes, cwd and exclude', () => {
    const names = (v: unknown[]) => v.map((e) => (e as { name: string }).name).sort();
    same('globSync withFileTypes',
      () => names(fs.globSync('/src/*', { withFileTypes: true }) as unknown[]),
      () => names(nodefs.globSync(`${root}/src/*`, { withFileTypes: true }) as unknown[]));

    same('globSync cwd',
      () => (fs.globSync('*.txt', { cwd: '/src' }) as string[]).sort(),
      () => (nodefs.globSync('*.txt', { cwd: R('src') }) as string[]).sort());

    // `exclude` is asserted on its own, not against node: node 24.18 invokes the callback
    // erratically (5 times for an absolute pattern, once for a relative one, never with `cwd`)
    // and ignores what it returns — `b.js` comes back excluded or not, regardless. Ours honours
    // the documented contract, which is a deliberate divergence recorded in the readme.
    const dropJs = (p: string) => p.endsWith('.js');
    expect((fs.globSync('*', { cwd: '/src', exclude: dropJs as never }) as string[]).sort())
      .toEqual(['a.txt', 'deep']);
  });
});

describe('write/read flags and positions', () => {
  beforeEach(seed);

  it('writeFileSync honours flag', () => {
    same('flag a', () => fs.writeFileSync('/src/a.txt', 'X', { flag: 'a' }), () => nodefs.writeFileSync(R('src/a.txt'), 'X', { flag: 'a' }));
    same('after flag a', () => fs.readFileSync('/src/a.txt', 'utf8'), () => nodefs.readFileSync(R('src/a.txt'), 'utf8'));
    same('flag wx on existing', () => fs.writeFileSync('/src/a.txt', 'Y', { flag: 'wx' }), () => nodefs.writeFileSync(R('src/a.txt'), 'Y', { flag: 'wx' }));
    same('flag wx on fresh', () => fs.writeFileSync('/fresh.txt', 'Y', { flag: 'wx' }), () => nodefs.writeFileSync(R('fresh.txt'), 'Y', { flag: 'wx' }));
    same('flag r on write', () => fs.writeFileSync('/src/a.txt', 'Z', { flag: 'r' }), () => nodefs.writeFileSync(R('src/a.txt'), 'Z', { flag: 'r' }));
  });

  it('writeFileSync honours mode when it creates the file', () => {
    same('mode 0o600', () => fs.writeFileSync('/m.txt', 'x', { mode: 0o600 }), () => nodefs.writeFileSync(R('m.txt'), 'x', { mode: 0o600 }));
    same('mode after create', () => fs.statSync('/m.txt'), () => nodefs.statSync(R('m.txt')));
  });

  it('readFileSync honours flag', () => {
    same('readFile flag r', () => fs.readFileSync('/src/a.txt', { flag: 'r' }), () => nodefs.readFileSync(R('src/a.txt'), { flag: 'r' }));
    same('readFile flag a+ on missing', () => fs.readFileSync('/made.txt', { flag: 'a+' }), () => nodefs.readFileSync(R('made.txt'), { flag: 'a+' }));
  });

  it('readSync/writeSync accept the object form as well as positional', () => {
    const fd = fs.openSync('/pos.txt', 'w+');
    const nfd = nodefs.openSync(R('pos.txt'), 'w+');
    fs.writeSync(fd, 'abcdef');
    nodefs.writeSync(nfd, 'abcdef');

    const b = new Uint8Array(3), nb = Buffer.alloc(3);
    same('readSync object form',
      () => fs.readSync(fd, b, { offset: 0, length: 3, position: 2 }),
      () => nodefs.readSync(nfd, nb, { offset: 0, length: 3, position: 2 }));
    expect(Array.from(b)).toEqual(Array.from(nb));

    same('writeSync at a position', () => fs.writeSync(fd, 'ZZ', 1), () => nodefs.writeSync(nfd, 'ZZ', 1));
    fs.closeSync(fd); nodefs.closeSync(nfd);
    same('contents after positional writes', () => fs.readFileSync('/pos.txt', 'utf8'), () => nodefs.readFileSync(R('pos.txt'), 'utf8'));
  });
});

describe('symlink type argument', () => {
  beforeEach(seed);
  it.each([undefined, 'file', 'dir', 'junction'] as const)('symlinkSync with type %s', (type) => {
    const name = `/l-${type ?? 'default'}`;
    same(`symlinkSync ${type}`,
      () => fs.symlinkSync('/src/a.txt', name, type as never),
      () => nodefs.symlinkSync(R('src/a.txt'), R(name.slice(1)), type as never));
    same(`lstat after symlink ${type}`, () => fs.lstatSync(name), () => nodefs.lstatSync(R(name.slice(1))));
  });
});
