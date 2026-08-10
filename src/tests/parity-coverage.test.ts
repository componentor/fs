/**
 * One differential test per `node:fs` function — 102 on `node:fs`, 32 on `node:fs/promises`.
 *
 * [api-surface.test.ts](./api-surface.test.ts) proves each name *exists*; the suites around this
 * one prove particular behaviours. Neither answers the question this file exists to answer: is
 * every single function actually *compared against a live `node:fs`*, or does the claim rest on
 * whichever ones somebody happened to write a test for?
 *
 * So the mapping from function name to differential case is a table, and the `coverage` block at
 * the bottom checks that table against `Object.keys(nodefs)` in both directions. A function Node
 * adds fails here until a case is written for it; a case for a name Node does not export fails
 * too. Coverage is a property the suite enforces rather than a number in the readme.
 *
 * **A case is written once and run twice.** Each one receives a {@link Ctx} — a filesystem, its
 * promises namespace, and a path mapper — and is invoked with ours and with `node:fs`. The two
 * sides cannot drift in what they were asked to do, because there is only one copy of the ask;
 * that is the failure mode of hand-mirrored parity tests, where the "same" call quietly grows a
 * different argument on one side. The return value is compared, and so is the resulting
 * directory tree, so a call is checked on both what it answered and what it did.
 *
 * Comparisons are narrowed to what two different filesystems can agree on: return values, error
 * `code`s, contents, entry lists, sizes and permission bits. Inode numbers, device ids, block
 * counts and timestamps are not comparable and are dropped by {@link normalise} — the calls whose
 * whole point is a timestamp (`utimes` and its family) read the times back explicitly instead.
 *
 * Where a case is narrowed because the two genuinely disagree, the disagreement is not dropped:
 * it moves to the `known divergences` block at the bottom, which asserts parity inside an
 * `it.fails` so that the day the gap is closed the suite says so.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as nodefs from 'node:fs';
import * as nodefsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFsHarness } from './helpers/engine-transport.js';

/**
 * Both filesystems are driven through the same expressions, so the static types would have to be
 * the *intersection* of `node:fs` and ours — which is what this alias stands in for. The types
 * are checked against `node:fs`'s own declarations in
 * [api-surface.test.ts](./api-surface.test.ts); this suite is about behaviour.
 */
type Any = any;

/** One filesystem under test, plus the mapping between its paths and the comparable form. */
interface Ctx {
  /** `node:fs`, or a `VFSFileSystem` wired to an in-process engine. */
  fs: Any;
  /** `node:fs/promises`, or that instance's `.promises`. */
  fsp: Any;
  /** A relative path, resolved into this filesystem's root. */
  p: (rel: string) => string;
  /** A path this filesystem returned, reduced to the form the other side would report. */
  un: (abs: string) => string;
}

/** A case: driven once per filesystem, its result compared across the two. */
type Case = (c: Ctx) => unknown;

let ours: Ctx;
let theirs: Ctx;
let root: string;

beforeEach(() => {
  const fs = createFsHarness().fs as Any;
  root = nodefs.mkdtempSync(join(tmpdir(), 'parity-cov-'));
  // macOS puts the temp dir under /var, itself a link to /private/var, so a path that came back
  // from `realpath` has to be recognised in either spelling.
  const realRoot = nodefs.realpathSync(root);

  ours = {
    fs,
    fsp: fs.promises,
    p: (rel) => `/${rel}`,
    un: (abs) => abs,
  };
  theirs = {
    fs: nodefs,
    fsp: nodefsp,
    p: (rel) => (rel ? join(root, rel) : root),
    un: (abs) => abs.replace(realRoot, '').replace(root, '') || '/',
  };
  seed(ours);
  seed(theirs);
});

afterEach(() => nodefs.rmSync(root, { recursive: true, force: true }));

/** The same starting layout on both filesystems. */
function seed(c: Ctx): void {
  c.fs.mkdirSync(c.p('dir/sub'), { recursive: true });
  c.fs.writeFileSync(c.p('file.txt'), 'hello');
  c.fs.writeFileSync(c.p('dir/a.txt'), 'AAA');
  c.fs.writeFileSync(c.p('dir/sub/b.txt'), 'BBB');
}

// ---------------------------------------------------------------------------
// Comparing
// ---------------------------------------------------------------------------

/** Reduce a value to what two different filesystems can be expected to agree on. */
function normalise(v: unknown): unknown {
  if (v instanceof Uint8Array) return ['bytes', ...v];
  if (Array.isArray(v)) return v.map(normalise);
  if (v && typeof v === 'object') {
    const o = v as Record<string, Any>;

    // Stats / BigIntStats
    if (typeof o.isFile === 'function' && o.size !== undefined && o.mode !== undefined) {
      const isDir = o.isDirectory();
      const isLink = o.isSymbolicLink();
      return {
        kind: 'stats',
        bigint: typeof o.size === 'bigint',
        // A directory's size is host bookkeeping (128 on APFS, 4096 on ext4, 0 for a VFS with no
        // directory blocks); a symlink's is the byte length of a target path the two filesystems
        // necessarily spell differently.
        size: isDir || isLink ? null : Number(o.size),
        // Symlink permission bits are platform-dependent in Node itself — 0o755 on macOS,
        // 0o777 on Linux. We follow the Linux spelling, as with the errno choices.
        mode: isLink ? null : Number(o.mode) & 0o777,
        isFile: o.isFile(),
        isDirectory: isDir,
        isSymbolicLink: isLink,
        isBlockDevice: o.isBlockDevice(),
        isCharacterDevice: o.isCharacterDevice(),
        isFIFO: o.isFIFO(),
        isSocket: o.isSocket(),
      };
    }

    // Dirent
    if (typeof o.name === 'string' && typeof o.isFile === 'function') {
      return { kind: 'dirent', name: o.name, isFile: o.isFile(), isDirectory: o.isDirectory(), isSymbolicLink: o.isSymbolicLink() };
    }

    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) out[k] = normalise(o[k]);
    return out;
  }
  return v;
}

/** Run a case, reducing a throw to its error code so a failure is comparable to a success. */
async function outcome(fn: () => unknown): Promise<unknown> {
  try {
    return { value: normalise(await fn()) };
  } catch (e: Any) {
    return { threw: e?.code ?? e?.name ?? String(e) };
  }
}

/** One step inside a case: its error code stands in for the value it did not return. */
function step(fn: () => unknown): unknown {
  try {
    return normalise(fn());
  } catch (e: Any) {
    return `E:${e?.code ?? e?.name}`;
  }
}

/** As {@link step}, for anything that returns a promise. */
async function stepAsync(fn: () => unknown): Promise<unknown> {
  try {
    return normalise(await fn());
  } catch (e: Any) {
    return `E:${e?.code ?? e?.name}`;
  }
}

/**
 * A node-style callback, as a promise of a comparable value.
 *
 * `pick` receives the callback's arguments after the error, because several of these hand back
 * more than one — `read` answers `(err, bytesRead, buffer)`.
 */
function viaCallback(invoke: (done: (...args: Any[]) => void) => void, pick: (...rest: Any[]) => unknown = (v) => v): Promise<unknown> {
  return new Promise((resolve) => {
    invoke((err: Any, ...rest: Any[]) => resolve(err ? `E:${err.code ?? err.name}` : normalise(pick(...rest))));
  });
}

/** Every entry in a filesystem, described identically on both sides. */
function tree(c: Ctx, dir = ''): string[] {
  const out: string[] = [];
  for (const name of (c.fs.readdirSync(c.p(dir)) as string[]).sort()) {
    const rel = dir ? `${dir}/${name}` : name;
    const st = c.fs.lstatSync(c.p(rel));
    out.push(st.isDirectory() ? `d ${rel}` : st.isSymbolicLink() ? `l ${rel}` : `f ${rel} ${st.size}`);
    if (st.isDirectory()) out.push(...tree(c, rel));
  }
  // `mkdtemp` invents six random characters, independently on each side.
  return out.map((e) => e.replace(/-[A-Za-z0-9]{6}(?=$|\/| )/g, '-XXXXXX'));
}

/** Drive one case against both filesystems and require them to agree. */
async function parity(name: string, run: Case): Promise<void> {
  const a = await outcome(() => run(ours));
  const b = await outcome(() => run(theirs));
  expect(a, `${name}: result`).toEqual(b);
  expect(tree(ours), `${name}: resulting tree`).toEqual(tree(theirs));
}

/** The owner both filesystems already agree on — the only portable `chown` argument. */
function owner(c: Ctx, rel = 'file.txt'): [number, number] {
  const st = c.fs.statSync(c.p(rel));
  return [st.uid, st.gid];
}

/** A file descriptor, its close deferred to the end of the case. */
function withFd<T>(c: Ctx, rel: string, flags: string, body: (fd: number) => T): T {
  const fd = c.fs.openSync(c.p(rel), flags);
  try {
    return body(fd);
  } finally {
    c.fs.closeSync(fd);
  }
}

/** A `Buffer` (node) or a `Uint8Array` (here) as the text it holds. */
const decode = (b: Uint8Array): string => new TextDecoder().decode(b);

const FIXED_ATIME = 1_600_000_000;
const FIXED_MTIME = 1_600_000_100;

/** Times, to the second — the two filesystems store different sub-second precision. */
function times(c: Ctx, rel: string, lstat = false): [number, number] {
  const st = lstat ? c.fs.lstatSync(c.p(rel)) : c.fs.statSync(c.p(rel));
  return [Math.round(st.atimeMs / 1000), Math.round(st.mtimeMs / 1000)];
}

/**
 * A stream that is inspected and thrown away, with its errors swallowed.
 *
 * Node's streams open asynchronously, so one that is destroyed immediately — or whose temp
 * directory is removed in `afterEach` before its `open` lands — emits an `error` with nothing
 * listening, which node escalates to an uncaught exception and vitest reports as a failure
 * somewhere else entirely.
 */
function discard(stream: Any): Any {
  stream.on('error', () => {});
  return stream;
}

/** Everything a readable stream produced, or the code it failed with. */
function drain(stream: Any): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Any[] = [];
    stream.on('data', (chunk: Any) => chunks.push(chunk));
    stream.on('error', (e: Any) => resolve(`E:${e.code ?? e.name}`));
    stream.on('end', () => resolve(typeof chunks[0] === 'string' ? chunks.join('') : normalise(concat(chunks))));
  });
}

/** A writable stream, closed and flushed — or the code it failed with. */
function finished(stream: Any): Promise<unknown> {
  return new Promise((resolve) => {
    stream.on('error', (e: Any) => resolve(`E:${e.code ?? e.name}`));
    stream.end(() => resolve(undefined));
  });
}

/** The bytes of every chunk, as one array — chunk *boundaries* are not part of the contract. */
function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, ch) => n + ch.length, 0));
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}

/**
 * Grow the watched file until the watcher notices, or until the window closes.
 *
 * Used only by the `watchFile` pair, and it writes repeatedly rather than once because of *when*
 * a poller takes its baseline: node samples on its first tick, so a single write issued in the
 * same tick as the registration is already in that first sample and reads as "nothing changed".
 * Ours snapshots eagerly at registration and would report the very same write. Neither is wrong,
 * and one fixed sleep only moves the race — a file that keeps growing is a change no baseline
 * can swallow. The window is long because the whole suite runs 88 files in parallel, and a tick
 * that normally lands in 10ms can be far behind on a loaded machine; a deadline tight enough to
 * fail on that would be measuring the machine rather than the filesystem.
 */
function restore(c: Ctx): void {
  // Each side stops writing as soon as *its* watcher fires, so they stop at different lengths.
  // The tree is compared after every case; put the file back the way it was seeded.
  c.fs.writeFileSync(c.p('file.txt'), 'hello');
}

async function keepGrowing(c: Ctx, done: () => boolean, ms = 15_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (let n = 1; !done() && Date.now() < deadline; n++) {
    c.fs.writeFileSync(c.p('file.txt'), 'growing'.repeat(n));
    await new Promise((r) => setTimeout(r, 25));
  }
  return done();
}

// ===========================================================================
// node:fs — 102
// ===========================================================================

const CASES: Record<string, Case> = {
  // --- reading and writing whole files ---

  readFile: async (c) => [
    await viaCallback((d) => c.fs.readFile(c.p('file.txt'), 'utf8', d)),
    await viaCallback((d) => c.fs.readFile(c.p('file.txt'), d)),
    await viaCallback((d) => c.fs.readFile(c.p('file.txt'), { encoding: 'hex' }, d)),
    await viaCallback((d) => c.fs.readFile(c.p('nope'), d)),
    await viaCallback((d) => c.fs.readFile(c.p('dir'), d)),
  ],

  readFileSync: (c) => [
    step(() => c.fs.readFileSync(c.p('file.txt'), 'utf8')),
    step(() => c.fs.readFileSync(c.p('file.txt'))),
    step(() => c.fs.readFileSync(c.p('file.txt'), { encoding: 'base64' })),
    step(() => c.fs.readFileSync(c.p('nope'))),
    step(() => c.fs.readFileSync(c.p('dir'))),
  ],

  writeFile: async (c) => [
    await viaCallback((d) => c.fs.writeFile(c.p('w.txt'), 'written', d)),
    c.fs.readFileSync(c.p('w.txt'), 'utf8'),
    await viaCallback((d) => c.fs.writeFile(c.p('w.txt'), new Uint8Array([1, 2, 3]), d)),
    step(() => c.fs.readFileSync(c.p('w.txt'))),
    await viaCallback((d) => c.fs.writeFile(c.p('w2.txt'), 'x', { mode: 0o600 }, d)),
    step(() => c.fs.statSync(c.p('w2.txt'))),
    await viaCallback((d) => c.fs.writeFile(c.p('nodir/x.txt'), 'x', d)),
  ],

  writeFileSync: (c) => [
    step(() => c.fs.writeFileSync(c.p('w.txt'), 'written')),
    c.fs.readFileSync(c.p('w.txt'), 'utf8'),
    step(() => c.fs.writeFileSync(c.p('w.txt'), 'shorter')),
    c.fs.readFileSync(c.p('w.txt'), 'utf8'),
    step(() => c.fs.writeFileSync(c.p('w3.txt'), 'ff00', { encoding: 'hex' })),
    step(() => c.fs.readFileSync(c.p('w3.txt'))),
    step(() => c.fs.writeFileSync(c.p('dir'), 'x')),
  ],

  appendFile: async (c) => [
    await viaCallback((d) => c.fs.appendFile(c.p('file.txt'), ' more', d)),
    c.fs.readFileSync(c.p('file.txt'), 'utf8'),
    await viaCallback((d) => c.fs.appendFile(c.p('fresh.txt'), 'created', d)),
    c.fs.readFileSync(c.p('fresh.txt'), 'utf8'),
    await viaCallback((d) => c.fs.appendFile(c.p('dir'), 'x', d)),
  ],

  appendFileSync: (c) => [
    step(() => c.fs.appendFileSync(c.p('file.txt'), ' more')),
    c.fs.readFileSync(c.p('file.txt'), 'utf8'),
    step(() => c.fs.appendFileSync(c.p('fresh.txt'), 'created', { mode: 0o600 })),
    step(() => c.fs.statSync(c.p('fresh.txt'))),
    step(() => c.fs.appendFileSync(c.p('fresh.txt'), new Uint8Array([65]))),
    c.fs.readFileSync(c.p('fresh.txt'), 'utf8'),
  ],

  // --- metadata ---

  stat: async (c) => [
    await viaCallback((d) => c.fs.stat(c.p('file.txt'), d)),
    await viaCallback((d) => c.fs.stat(c.p('dir'), d)),
    await viaCallback((d) => c.fs.stat(c.p('nope'), d)),
    await viaCallback((d) => c.fs.stat(c.p('file.txt'), { bigint: true }, d)),
  ],

  statSync: (c) => [
    step(() => c.fs.statSync(c.p('file.txt'))),
    step(() => c.fs.statSync(c.p('dir'))),
    step(() => c.fs.statSync(c.p('nope'))),
    step(() => c.fs.statSync(c.p('nope'), { throwIfNoEntry: false })),
    step(() => c.fs.statSync(c.p('file.txt'), { bigint: true })),
  ],

  lstat: async (c) => {
    c.fs.symlinkSync(c.p('file.txt'), c.p('link'));
    return [
      await viaCallback((d) => c.fs.lstat(c.p('link'), d)),
      await viaCallback((d) => c.fs.lstat(c.p('file.txt'), d)),
      await viaCallback((d) => c.fs.lstat(c.p('nope'), d)),
    ];
  },

  lstatSync: (c) => {
    c.fs.symlinkSync(c.p('file.txt'), c.p('link'));
    return [
      step(() => c.fs.lstatSync(c.p('link'))),
      // The link resolves; `stat` follows it and `lstat` does not — the pair is the assertion.
      step(() => c.fs.statSync(c.p('link'))),
      step(() => c.fs.lstatSync(c.p('nope'))),
      step(() => c.fs.lstatSync(c.p('nope'), { throwIfNoEntry: false })),
    ];
  },

  fstat: async (c) => {
    const fd = c.fs.openSync(c.p('file.txt'), 'r');
    const out = [
      await viaCallback((d) => c.fs.fstat(fd, d)),
      await viaCallback((d) => c.fs.fstat(fd, { bigint: true }, d)),
    ];
    c.fs.closeSync(fd);
    return [...out, await viaCallback((d) => c.fs.fstat(fd, d))];
  },

  fstatSync: (c) => {
    const fd = c.fs.openSync(c.p('file.txt'), 'r');
    const out = [step(() => c.fs.fstatSync(fd)), step(() => c.fs.fstatSync(fd, { bigint: true }))];
    c.fs.closeSync(fd);
    return [...out, step(() => c.fs.fstatSync(fd))];
  },

  // `statfs` reports volume-level numbers a VFS cannot match a real disk on — the comparable
  // part is the field set and their types, which is what a caller reads.
  statfs: async (c) => [
    await viaCallback((d) => c.fs.statfs(c.p(''), d), (v) => Object.keys(v).sort().map((k) => `${k}:${typeof v[k]}`)),
    await viaCallback((d) => c.fs.statfs(c.p('nope'), d)),
  ],

  statfsSync: (c) => [
    step(() => Object.entries(c.fs.statfsSync(c.p(''))).map(([k, v]) => `${k}:${typeof v}`).sort()),
    step(() => Object.entries(c.fs.statfsSync(c.p(''), { bigint: true })).map(([k, v]) => `${k}:${typeof v}`).sort()),
    step(() => c.fs.statfsSync(c.p('nope'))),
  ],

  exists: (c) => Promise.all([
    new Promise((r) => c.fs.exists(c.p('file.txt'), r)),
    new Promise((r) => c.fs.exists(c.p('nope'), r)),
    new Promise((r) => c.fs.exists(c.p('dir'), r)),
  ]),

  existsSync: (c) => [
    c.fs.existsSync(c.p('file.txt')),
    c.fs.existsSync(c.p('nope')),
    c.fs.existsSync(c.p('dir')),
    c.fs.existsSync(c.p('dir/sub/b.txt')),
  ],

  access: async (c) => [
    await viaCallback((d) => c.fs.access(c.p('file.txt'), d)),
    await viaCallback((d) => c.fs.access(c.p('nope'), d)),
    await viaCallback((d) => c.fs.access(c.p('file.txt'), c.fs.constants.R_OK | c.fs.constants.W_OK, d)),
    await viaCallback((d) => c.fs.access(c.p('dir'), c.fs.constants.X_OK, d)),
  ],

  accessSync: (c) => [
    step(() => c.fs.accessSync(c.p('file.txt'))),
    step(() => c.fs.accessSync(c.p('nope'))),
    step(() => c.fs.accessSync(c.p('file.txt'), c.fs.constants.F_OK)),
    step(() => c.fs.accessSync(c.p('dir'), c.fs.constants.R_OK)),
  ],

  // --- directories ---

  readdir: async (c) => [
    await viaCallback((d) => c.fs.readdir(c.p('dir'), d), (v) => v.sort()),
    await viaCallback((d) => c.fs.readdir(c.p('dir'), { recursive: true }, d), (v) => v.sort()),
    await viaCallback((d) => c.fs.readdir(c.p('dir'), { withFileTypes: true }, d), (v) => v.map((e: Any) => e.name).sort()),
    await viaCallback((d) => c.fs.readdir(c.p('nope'), d)),
    await viaCallback((d) => c.fs.readdir(c.p('file.txt'), d)),
  ],

  readdirSync: (c) => [
    step(() => (c.fs.readdirSync(c.p('dir')) as string[]).sort()),
    step(() => (c.fs.readdirSync(c.p('dir'), { recursive: true }) as string[]).sort()),
    step(() => (c.fs.readdirSync(c.p('dir'), { withFileTypes: true }) as Any[]).map((e) => normalise(e)).sort((a: Any, b: Any) => a.name.localeCompare(b.name))),
    // `encoding: 'buffer'` answers `Buffer`s in node and `Uint8Array`s here — there is no Buffer
    // in a browser. Decoding both is the comparison; `Buffer` is itself a `Uint8Array` subclass.
    step(() => (c.fs.readdirSync(c.p('dir'), 'buffer') as Uint8Array[]).map(decode).sort()),
    step(() => c.fs.readdirSync(c.p('nope'))),
    step(() => c.fs.readdirSync(c.p('file.txt'))),
  ],

  mkdir: async (c) => [
    await viaCallback((d) => c.fs.mkdir(c.p('fresh'), d)),
    await viaCallback((d) => c.fs.mkdir(c.p('fresh'), d)),
    await viaCallback((d) => c.fs.mkdir(c.p('a/b/c'), { recursive: true }, d), (v) => (v ? c.un(v) : v)),
    await viaCallback((d) => c.fs.mkdir(c.p('no/parent'), d)),
    await viaCallback((d) => c.fs.mkdir(c.p('moded'), { mode: 0o700 }, d)),
    step(() => c.fs.statSync(c.p('moded'))),
  ],

  mkdirSync: (c) => [
    step(() => c.fs.mkdirSync(c.p('fresh'))),
    step(() => c.fs.mkdirSync(c.p('fresh'))),
    // Node answers with the *first* directory it had to create, not the deepest.
    step(() => c.un(c.fs.mkdirSync(c.p('a/b/c'), { recursive: true }) as string)),
    step(() => c.fs.mkdirSync(c.p('a/b/c'), { recursive: true })),
    step(() => c.fs.mkdirSync(c.p('no/parent'))),
    step(() => c.fs.mkdirSync(c.p('file.txt'))),
  ],

  rmdir: async (c) => [
    await viaCallback((d) => c.fs.rmdir(c.p('dir/sub/deeper'), d)),
    await viaCallback((d) => (c.fs.mkdirSync(c.p('empty')), c.fs.rmdir(c.p('empty'), d))),
    await viaCallback((d) => c.fs.rmdir(c.p('dir'), d)),
    await viaCallback((d) => c.fs.rmdir(c.p('file.txt'), d)),
  ],

  rmdirSync: (c) => [
    step(() => (c.fs.mkdirSync(c.p('empty')), c.fs.rmdirSync(c.p('empty')))),
    step(() => c.fs.rmdirSync(c.p('dir'))),
    step(() => c.fs.rmdirSync(c.p('nope'))),
    step(() => c.fs.rmdirSync(c.p('file.txt'))),
  ],

  rm: async (c) => [
    await viaCallback((d) => c.fs.rm(c.p('file.txt'), d)),
    await viaCallback((d) => c.fs.rm(c.p('file.txt'), d)),
    await viaCallback((d) => c.fs.rm(c.p('gone'), { force: true }, d)),
    await viaCallback((d) => c.fs.rm(c.p('dir'), d)),
    await viaCallback((d) => c.fs.rm(c.p('dir'), { recursive: true }, d)),
  ],

  rmSync: (c) => [
    step(() => c.fs.rmSync(c.p('file.txt'))),
    step(() => c.fs.rmSync(c.p('file.txt'))),
    step(() => c.fs.rmSync(c.p('file.txt'), { force: true })),
    step(() => c.fs.rmSync(c.p('dir'))),
    step(() => c.fs.rmSync(c.p('dir'), { recursive: true })),
    c.fs.existsSync(c.p('dir')),
  ],

  opendir: async (c) => {
    const names: string[] = [];
    const err = await new Promise((res) => {
      c.fs.opendir(c.p('dir'), async (e: Any, dir: Any) => {
        if (e) return res(`E:${e.code}`);
        for await (const ent of dir) names.push(ent.name);
        res(null);
      });
    });
    return [err, names.sort(), await viaCallback((d) => c.fs.opendir(c.p('nope'), d))];
  },

  opendirSync: (c) => {
    const dir = c.fs.opendirSync(c.p('dir'));
    const names: string[] = [];
    for (let e = dir.readSync(); e; e = dir.readSync()) names.push(e.name);
    const after = step(() => dir.readSync());
    dir.closeSync();
    return [names.sort(), after, c.un(dir.path), step(() => c.fs.opendirSync(c.p('file.txt')))];
  },

  glob: async (c) => [
    await viaCallback((d) => c.fs.glob(`${c.p('dir')}/**/*.txt`, d), (v) => (v as string[]).map(c.un).sort()),
    await viaCallback((d) => c.fs.glob(`${c.p('')}/*.txt`.replace('//', '/'), d), (v) => (v as string[]).map(c.un).sort()),
    await viaCallback((d) => c.fs.glob(`${c.p('dir')}/*.nomatch`, d), (v) => (v as string[]).length),
  ],

  globSync: (c) => [
    (c.fs.globSync(`${c.p('dir')}/**/*.txt`) as string[]).map(c.un).sort(),
    (c.fs.globSync(`${c.p('dir')}/*`) as string[]).map(c.un).sort(),
    (c.fs.globSync(`${c.p('dir')}/*.nomatch`) as string[]).length,
  ],

  // --- moving, copying, linking ---

  rename: async (c) => [
    await viaCallback((d) => c.fs.rename(c.p('file.txt'), c.p('moved.txt'), d)),
    c.fs.readFileSync(c.p('moved.txt'), 'utf8'),
    c.fs.existsSync(c.p('file.txt')),
    await viaCallback((d) => c.fs.rename(c.p('nope'), c.p('x'), d)),
    await viaCallback((d) => c.fs.rename(c.p('dir'), c.p('dir2'), d)),
  ],

  renameSync: (c) => [
    step(() => c.fs.renameSync(c.p('file.txt'), c.p('moved.txt'))),
    c.fs.readFileSync(c.p('moved.txt'), 'utf8'),
    step(() => c.fs.renameSync(c.p('nope'), c.p('x'))),
    // Renaming onto an existing file replaces it, silently.
    step(() => c.fs.renameSync(c.p('dir/a.txt'), c.p('moved.txt'))),
    c.fs.readFileSync(c.p('moved.txt'), 'utf8'),
  ],

  copyFile: async (c) => [
    await viaCallback((d) => c.fs.copyFile(c.p('file.txt'), c.p('copy.txt'), d)),
    c.fs.readFileSync(c.p('copy.txt'), 'utf8'),
    await viaCallback((d) => c.fs.copyFile(c.p('file.txt'), c.p('copy.txt'), c.fs.constants.COPYFILE_EXCL, d)),
    await viaCallback((d) => c.fs.copyFile(c.p('nope'), c.p('x.txt'), d)),
    await viaCallback((d) => c.fs.copyFile(c.p('dir'), c.p('y.txt'), d)),
  ],

  copyFileSync: (c) => [
    step(() => c.fs.copyFileSync(c.p('file.txt'), c.p('copy.txt'))),
    c.fs.readFileSync(c.p('copy.txt'), 'utf8'),
    step(() => c.fs.copyFileSync(c.p('file.txt'), c.p('copy.txt'), c.fs.constants.COPYFILE_EXCL)),
    // An existing destination is overwritten, and truncated to the source's length.
    step(() => c.fs.copyFileSync(c.p('dir/a.txt'), c.p('copy.txt'))),
    c.fs.readFileSync(c.p('copy.txt'), 'utf8'),
    step(() => c.fs.copyFileSync(c.p('nope'), c.p('x.txt'))),
  ],

  cp: async (c) => [
    await viaCallback((d) => c.fs.cp(c.p('dir'), c.p('dir-copy'), { recursive: true }, d)),
    (c.fs.readdirSync(c.p('dir-copy'), { recursive: true }) as string[]).sort(),
    await viaCallback((d) => c.fs.cp(c.p('dir'), c.p('flat'), d)),
    await viaCallback((d) => c.fs.cp(c.p('file.txt'), c.p('f2.txt'), d)),
    c.fs.readFileSync(c.p('f2.txt'), 'utf8'),
  ],

  cpSync: (c) => [
    step(() => c.fs.cpSync(c.p('dir'), c.p('dir-copy'), { recursive: true })),
    (c.fs.readdirSync(c.p('dir-copy'), { recursive: true }) as string[]).sort(),
    step(() => c.fs.cpSync(c.p('dir'), c.p('flat'))),
    step(() => c.fs.cpSync(c.p('file.txt'), c.p('f2.txt'), { errorOnExist: true, force: false })),
    step(() => c.fs.cpSync(c.p('file.txt'), c.p('f2.txt'), { errorOnExist: true, force: false })),
    step(() => c.fs.cpSync(c.p('nope'), c.p('f3.txt'))),
  ],

  // `link` duplicates the file rather than sharing an inode — a documented divergence. What is
  // comparable is the call's result, the contents at the new name, and the reported `nlink`.
  link: async (c) => [
    await viaCallback((d) => c.fs.link(c.p('file.txt'), c.p('hard.txt'), d)),
    c.fs.readFileSync(c.p('hard.txt'), 'utf8'),
    c.fs.statSync(c.p('hard.txt')).nlink,
    c.fs.statSync(c.p('file.txt')).nlink,
    await viaCallback((d) => c.fs.link(c.p('file.txt'), c.p('hard.txt'), d)),
    await viaCallback((d) => c.fs.link(c.p('nope'), c.p('x.txt'), d)),
  ],

  linkSync: (c) => [
    step(() => c.fs.linkSync(c.p('file.txt'), c.p('hard.txt'))),
    c.fs.readFileSync(c.p('hard.txt'), 'utf8'),
    c.fs.statSync(c.p('hard.txt')).nlink,
    step(() => c.fs.linkSync(c.p('file.txt'), c.p('hard.txt'))),
    step(() => c.fs.linkSync(c.p('nope'), c.p('x.txt'))),
  ],

  // Unlinking a *directory* is left out on purpose: node's answer is the host kernel's, EPERM on
  // macOS and EISDIR on Linux, so there is nothing stable to compare. We answer EISDIR, matching
  // Linux, which is the same choice made for the other errno spellings.
  unlink: async (c) => [
    await viaCallback((d) => c.fs.unlink(c.p('file.txt'), d)),
    c.fs.existsSync(c.p('file.txt')),
    await viaCallback((d) => c.fs.unlink(c.p('file.txt'), d)),
  ],

  unlinkSync: (c) => {
    c.fs.symlinkSync(c.p('file.txt'), c.p('link'));
    return [
      step(() => c.fs.unlinkSync(c.p('file.txt'))),
      step(() => c.fs.unlinkSync(c.p('nope'))),
      // Unlinking a link removes the link, never its target.
      step(() => c.fs.unlinkSync(c.p('link'))),
      c.fs.existsSync(c.p('dir/a.txt')),
    ];
  },

  symlink: async (c) => [
    await viaCallback((d) => c.fs.symlink(c.p('file.txt'), c.p('link'), d)),
    c.fs.readFileSync(c.p('link'), 'utf8'),
    c.fs.lstatSync(c.p('link')).isSymbolicLink(),
    await viaCallback((d) => c.fs.symlink(c.p('dir'), c.p('dlink'), 'dir', d)),
    await viaCallback((d) => c.fs.symlink(c.p('file.txt'), c.p('link'), d)),
    // A link to nowhere is legal; it is reading through it that fails.
    await viaCallback((d) => c.fs.symlink(c.p('nothing'), c.p('dangling'), d)),
    step(() => c.fs.statSync(c.p('dangling'))),
    c.fs.lstatSync(c.p('dangling')).isSymbolicLink(),
  ],

  symlinkSync: (c) => [
    step(() => c.fs.symlinkSync(c.p('file.txt'), c.p('link'))),
    c.fs.readFileSync(c.p('link'), 'utf8'),
    step(() => c.fs.symlinkSync(c.p('file.txt'), c.p('link'))),
    step(() => c.fs.symlinkSync(c.p('file.txt'), c.p('no/where/link'))),
  ],

  readlink: async (c) => {
    c.fs.symlinkSync(c.p('file.txt'), c.p('link'));
    return [
      await viaCallback((d) => c.fs.readlink(c.p('link'), d), (v) => c.un(v)),
      await viaCallback((d) => c.fs.readlink(c.p('link'), 'buffer', d), (v) => c.un(decode(v))),
      await viaCallback((d) => c.fs.readlink(c.p('file.txt'), d)),
      await viaCallback((d) => c.fs.readlink(c.p('nope'), d)),
    ];
  },

  readlinkSync: (c) => {
    c.fs.symlinkSync(c.p('file.txt'), c.p('link'));
    return [
      step(() => c.un(c.fs.readlinkSync(c.p('link')) as string)),
      step(() => c.un(decode(c.fs.readlinkSync(c.p('link'), 'buffer') as Uint8Array))),
      step(() => c.fs.readlinkSync(c.p('dir'))),
      step(() => c.fs.readlinkSync(c.p('nope'))),
    ];
  },

  realpath: async (c) => {
    c.fs.symlinkSync(c.p('file.txt'), c.p('link'));
    return [
      await viaCallback((d) => c.fs.realpath(c.p('link'), d), (v) => c.un(v)),
      await viaCallback((d) => c.fs.realpath(c.p('dir/sub'), d), (v) => c.un(v)),
      await viaCallback((d) => c.fs.realpath(c.p('nope'), d)),
    ];
  },

  realpathSync: (c) => {
    c.fs.symlinkSync(c.p('dir'), c.p('dlink'));
    return [
      step(() => c.un(c.fs.realpathSync(c.p('dlink')) as string)),
      // A link in the middle of a path resolves too.
      step(() => c.un(c.fs.realpathSync(c.p('dlink/sub/b.txt')) as string)),
      step(() => c.un(c.fs.realpathSync(c.p('file.txt')) as string)),
      step(() => c.fs.realpathSync(c.p('nope'))),
    ];
  },

  truncate: async (c) => [
    await viaCallback((d) => c.fs.truncate(c.p('file.txt'), 2, d)),
    c.fs.readFileSync(c.p('file.txt'), 'utf8'),
    // Growing pads with zero bytes.
    await viaCallback((d) => c.fs.truncate(c.p('file.txt'), 6, d)),
    step(() => c.fs.readFileSync(c.p('file.txt'))),
    await viaCallback((d) => c.fs.truncate(c.p('file.txt'), d)),
    c.fs.statSync(c.p('file.txt')).size,
    await viaCallback((d) => c.fs.truncate(c.p('nope'), 1, d)),
  ],

  truncateSync: (c) => [
    step(() => c.fs.truncateSync(c.p('file.txt'), 2)),
    c.fs.readFileSync(c.p('file.txt'), 'utf8'),
    step(() => c.fs.truncateSync(c.p('file.txt'), 8)),
    step(() => c.fs.readFileSync(c.p('file.txt'))),
    step(() => c.fs.truncateSync(c.p('file.txt'))),
    c.fs.statSync(c.p('file.txt')).size,
    step(() => c.fs.truncateSync(c.p('nope'), 1)),
  ],

  // --- permissions and ownership ---

  chmod: async (c) => [
    await viaCallback((d) => c.fs.chmod(c.p('file.txt'), 0o600, d)),
    c.fs.statSync(c.p('file.txt')).mode & 0o777,
    await viaCallback((d) => c.fs.chmod(c.p('dir'), 0o700, d)),
    c.fs.statSync(c.p('dir')).mode & 0o777,
    await viaCallback((d) => c.fs.chmod(c.p('nope'), 0o600, d)),
  ],

  chmodSync: (c) => [
    step(() => c.fs.chmodSync(c.p('file.txt'), 0o600)),
    c.fs.statSync(c.p('file.txt')).mode & 0o777,
    // A string mode is accepted and parsed as octal.
    step(() => c.fs.chmodSync(c.p('file.txt'), '644')),
    c.fs.statSync(c.p('file.txt')).mode & 0o777,
    step(() => c.fs.chmodSync(c.p('nope'), 0o600)),
  ],

  fchmod: async (c) => {
    const fd = c.fs.openSync(c.p('file.txt'), 'r+');
    const out = [
      await viaCallback((d) => c.fs.fchmod(fd, 0o640, d)),
      c.fs.fstatSync(fd).mode & 0o777,
    ];
    c.fs.closeSync(fd);
    return [...out, await viaCallback((d) => c.fs.fchmod(fd, 0o600, d))];
  },

  fchmodSync: (c) => {
    const out = withFd(c, 'file.txt', 'r+', (fd) => [
      step(() => c.fs.fchmodSync(fd, 0o640)),
      c.fs.fstatSync(fd).mode & 0o777,
    ]);
    return [...out, c.fs.statSync(c.p('file.txt')).mode & 0o777];
  },

  // `lchmod` exists only where the platform has lchmod(2) — macOS does, Linux answers ENOSYS.
  // Comparing outcomes covers both without branching on the platform.
  lchmod: async (c) => {
    c.fs.symlinkSync(c.p('file.txt'), c.p('link'));
    return [
      await viaCallback((d) => c.fs.lchmod(c.p('link'), 0o600, d)),
      // Whatever happened, it must not have touched the target.
      c.fs.statSync(c.p('file.txt')).mode & 0o777,
      await viaCallback((d) => c.fs.lchmod(c.p('nope'), 0o600, d)),
    ];
  },

  lchmodSync: (c) => {
    c.fs.symlinkSync(c.p('file.txt'), c.p('link'));
    return [
      step(() => c.fs.lchmodSync(c.p('link'), 0o600)),
      c.fs.statSync(c.p('file.txt')).mode & 0o777,
      step(() => c.fs.lchmodSync(c.p('nope'), 0o600)),
    ];
  },

  // Ownership is only portably testable as a no-op: chown to the owner it already has. Anything
  // else needs root on the node side, so the comparison would be ours-succeeds/node-EPERM.
  chown: async (c) => {
    const [uid, gid] = owner(c);
    return [
      await viaCallback((d) => c.fs.chown(c.p('file.txt'), uid, gid, d)),
      await viaCallback((d) => c.fs.chown(c.p('nope'), uid, gid, d)),
    ];
  },

  chownSync: (c) => {
    const [uid, gid] = owner(c);
    return [
      step(() => c.fs.chownSync(c.p('file.txt'), uid, gid)),
      step(() => c.fs.chownSync(c.p('dir'), uid, gid)),
      step(() => c.fs.chownSync(c.p('nope'), uid, gid)),
    ];
  },

  fchown: async (c) => {
    const [uid, gid] = owner(c);
    const fd = c.fs.openSync(c.p('file.txt'), 'r+');
    const out = await viaCallback((d) => c.fs.fchown(fd, uid, gid, d));
    c.fs.closeSync(fd);
    return [out, await viaCallback((d) => c.fs.fchown(fd, uid, gid, d))];
  },

  fchownSync: (c) => {
    const [uid, gid] = owner(c);
    return withFd(c, 'file.txt', 'r+', (fd) => [step(() => c.fs.fchownSync(fd, uid, gid))]);
  },

  lchown: async (c) => {
    const [uid, gid] = owner(c);
    c.fs.symlinkSync(c.p('file.txt'), c.p('link'));
    return [
      await viaCallback((d) => c.fs.lchown(c.p('link'), uid, gid, d)),
      await viaCallback((d) => c.fs.lchown(c.p('nope'), uid, gid, d)),
    ];
  },

  lchownSync: (c) => {
    const [uid, gid] = owner(c);
    c.fs.symlinkSync(c.p('file.txt'), c.p('link'));
    return [
      step(() => c.fs.lchownSync(c.p('link'), uid, gid)),
      step(() => c.fs.lchownSync(c.p('nope'), uid, gid)),
    ];
  },

  // --- timestamps ---

  utimes: async (c) => [
    await viaCallback((d) => c.fs.utimes(c.p('file.txt'), FIXED_ATIME, FIXED_MTIME, d)),
    times(c, 'file.txt'),
    await viaCallback((d) => c.fs.utimes(c.p('file.txt'), new Date(FIXED_MTIME * 1000), new Date(FIXED_ATIME * 1000), d)),
    times(c, 'file.txt'),
    await viaCallback((d) => c.fs.utimes(c.p('nope'), FIXED_ATIME, FIXED_MTIME, d)),
  ],

  utimesSync: (c) => [
    step(() => c.fs.utimesSync(c.p('file.txt'), FIXED_ATIME, FIXED_MTIME)),
    times(c, 'file.txt'),
    step(() => c.fs.utimesSync(c.p('dir'), FIXED_ATIME, FIXED_MTIME)),
    times(c, 'dir'),
    step(() => c.fs.utimesSync(c.p('nope'), FIXED_ATIME, FIXED_MTIME)),
  ],

  futimes: async (c) => {
    const fd = c.fs.openSync(c.p('file.txt'), 'r+');
    const out = await viaCallback((d) => c.fs.futimes(fd, FIXED_ATIME, FIXED_MTIME, d));
    c.fs.closeSync(fd);
    return [out, times(c, 'file.txt')];
  },

  futimesSync: (c) => {
    withFd(c, 'file.txt', 'r+', (fd) => c.fs.futimesSync(fd, FIXED_ATIME, FIXED_MTIME));
    return times(c, 'file.txt');
  },

  lutimes: async (c) => {
    c.fs.symlinkSync(c.p('file.txt'), c.p('link'));
    const before = times(c, 'file.txt');
    return [
      await viaCallback((d) => c.fs.lutimes(c.p('link'), FIXED_ATIME, FIXED_MTIME, d)),
      // The link's own times move and the target's do not — the "l" is the whole point.
      times(c, 'link', true),
      times(c, 'file.txt')[1] === before[1],
      await viaCallback((d) => c.fs.lutimes(c.p('nope'), FIXED_ATIME, FIXED_MTIME, d)),
    ];
  },

  lutimesSync: (c) => {
    c.fs.symlinkSync(c.p('file.txt'), c.p('link'));
    const before = times(c, 'file.txt');
    return [
      step(() => c.fs.lutimesSync(c.p('link'), FIXED_ATIME, FIXED_MTIME)),
      times(c, 'link', true),
      times(c, 'file.txt')[1] === before[1],
      // On anything that is not a link it is plain `utimes`.
      step(() => c.fs.lutimesSync(c.p('dir'), FIXED_ATIME, FIXED_MTIME)),
      times(c, 'dir'),
      step(() => c.fs.lutimesSync(c.p('nope'), FIXED_ATIME, FIXED_MTIME)),
    ];
  },

  _toUnixTimestamp: (c) => {
    // A negative or non-finite time means "now" in node — `time < 0` returns `Date.now() / 1000`
    // rather than the number it was given. The two filesystems are asked microseconds apart, so
    // those answers are compared as "a timestamp from about now" instead of by value.
    const now = Date.now() / 1000;
    const recent = (v: unknown) => typeof v === 'number' && Math.abs(v - now) < 60;
    return [
      step(() => c.fs._toUnixTimestamp(1_700_000_000)),
      step(() => c.fs._toUnixTimestamp(1_700_000_000.5)),
      step(() => c.fs._toUnixTimestamp(new Date(1_700_000_000_000))),
      step(() => c.fs._toUnixTimestamp('1700000000')),
      step(() => recent(c.fs._toUnixTimestamp(-1))),
      step(() => recent(c.fs._toUnixTimestamp(NaN))),
      step(() => recent(c.fs._toUnixTimestamp(Infinity))),
      step(() => c.fs._toUnixTimestamp({} as Any)),
    ];
  },

  // --- descriptors ---

  open: async (c) => {
    // Descriptor *numbers* are allocator state, not semantics — node's start above stderr and
    // ours at 3 for its own reasons, so what is compared is what the descriptor can do.
    const fd = (await new Promise<number>((res, rej) => c.fs.open(c.p('new.txt'), 'w+', (e: Any, v: number) => (e ? rej(e) : res(v))))) as number;
    const out = [
      typeof fd,
      c.fs.fstatSync(fd).size,
      await viaCallback((d) => c.fs.open(c.p('nope'), 'r', d)),
      await viaCallback((d) => c.fs.open(c.p('file.txt'), 'wx', d)),
      await viaCallback((d) => c.fs.open(c.p('nope/deeper'), 'w', d)),
      // A directory opens read-only and refuses write access.
      await viaCallback((d) => c.fs.open(c.p('dir'), 'w', d), () => 'opened'),
      await viaCallback((d) => c.fs.open(c.p('dir'), 'a', d), () => 'opened'),
    ];
    c.fs.closeSync(fd);
    return out;
  },

  openSync: (c) => {
    const fd = c.fs.openSync(c.p('file.txt'), 'r');
    const out = [
      typeof fd,
      fd > 2,
      c.fs.fstatSync(fd).size,
      step(() => c.fs.openSync(c.p('nope'), 'r')),
      step(() => c.fs.openSync(c.p('file.txt'), 'wx')),
      step(() => c.fs.openSync(c.p('nope/deeper'), 'w')),
      // A directory can be opened read-only — `fstat` through the descriptor is the reason —
      // but every flavour of write access is EISDIR.
      step(() => withFd(c, 'dir', 'r', (dirFd) => c.fs.fstatSync(dirFd).isDirectory())),
      step(() => c.fs.openSync(c.p('dir'), 'w')),
      step(() => c.fs.openSync(c.p('dir'), 'r+')),
      step(() => c.fs.openSync(c.p('dir'), 'a')),
    ];
    c.fs.closeSync(fd);
    // 'w' truncates on open; 'a' does not; both create.
    withFd(c, 'file.txt', 'w', () => {});
    const sizes = [c.fs.statSync(c.p('file.txt')).size];
    withFd(c, 'created.txt', 'a', () => {});
    sizes.push(c.fs.statSync(c.p('created.txt')).size);
    // A mode given to `open` applies only when it creates the file.
    withFd(c, 'moded.txt', 'w', () => {});
    return [...out, sizes];
  },

  close: async (c) => {
    const fd = c.fs.openSync(c.p('file.txt'), 'r');
    return [
      await viaCallback((d) => c.fs.close(fd, d)),
      await viaCallback((d) => c.fs.close(fd, d)),
      await viaCallback((d) => c.fs.close(9999, d)),
    ];
  },

  closeSync: (c) => {
    const fd = c.fs.openSync(c.p('file.txt'), 'r');
    return [
      step(() => c.fs.closeSync(fd)),
      step(() => c.fs.closeSync(fd)),
      step(() => c.fs.readSync(fd, new Uint8Array(1), 0, 1, 0)),
    ];
  },

  read: async (c) => {
    const fd = c.fs.openSync(c.p('file.txt'), 'r');
    const buf = new Uint8Array(5);
    const partial = new Uint8Array(3);
    const out = [
      await viaCallback((d) => c.fs.read(fd, buf, 0, 5, 0, d), (n) => n),
      [...buf],
      await viaCallback((d) => c.fs.read(fd, partial, 0, 3, 2, d), (n) => n),
      [...partial],
      // Reading past the end answers zero bytes rather than failing.
      await viaCallback((d) => c.fs.read(fd, new Uint8Array(4), 0, 4, 99, d), (n) => n),
    ];
    c.fs.closeSync(fd);
    return out;
  },

  readSync: (c) => withFd(c, 'file.txt', 'r', (fd) => {
    const buf = new Uint8Array(5);
    const off = new Uint8Array(5);
    const seq = new Uint8Array(2);
    return [
      step(() => c.fs.readSync(fd, buf, 0, 5, 0)),
      [...buf],
      // An offset into the *buffer*, not the file.
      step(() => c.fs.readSync(fd, off, 2, 3, 0)),
      [...off],
      // position: null reads from, and advances, the descriptor's own cursor.
      step(() => c.fs.readSync(fd, seq, 0, 2, null)),
      [...seq],
      step(() => c.fs.readSync(fd, seq, 0, 2, null)),
      [...seq],
      step(() => c.fs.readSync(fd, new Uint8Array(4), 0, 4, 99)),
    ];
  }),

  readv: async (c) => {
    const fd = c.fs.openSync(c.p('file.txt'), 'r');
    const a = new Uint8Array(2);
    const b = new Uint8Array(3);
    const out = [
      await viaCallback((d) => c.fs.readv(fd, [a, b], 0, d), (n) => n),
      [...a],
      [...b],
    ];
    c.fs.closeSync(fd);
    return out;
  },

  readvSync: (c) => withFd(c, 'file.txt', 'r', (fd) => {
    const a = new Uint8Array(2);
    const b = new Uint8Array(3);
    const past = new Uint8Array(4);
    return [
      step(() => c.fs.readvSync(fd, [a, b], 0)),
      [...a],
      [...b],
      step(() => c.fs.readvSync(fd, [past], 99)),
      [...past],
    ];
  }),

  write: async (c) => {
    const fd = c.fs.openSync(c.p('rw.txt'), 'w+');
    const out = [
      await viaCallback((d) => c.fs.write(fd, 'abcdef', d), (n) => n),
      await viaCallback((d) => c.fs.write(fd, new Uint8Array([65, 66]), 0, 2, 0, d), (n) => n),
    ];
    c.fs.closeSync(fd);
    return [...out, c.fs.readFileSync(c.p('rw.txt'), 'utf8')];
  },

  writeSync: (c) => {
    withFd(c, 'rw.txt', 'w+', (fd) => {
      c.fs.writeSync(fd, 'abcdef');
      // A string at an explicit position, then a slice of a buffer.
      c.fs.writeSync(fd, 'XY', 1);
      c.fs.writeSync(fd, new Uint8Array([48, 49, 50]), 1, 2, 4);
    });
    const written = withFd(c, 'rw.txt', 'a', (fd) => c.fs.writeSync(fd, 'Z'));
    return [c.fs.readFileSync(c.p('rw.txt'), 'utf8'), written, step(() => c.fs.writeSync(9999, 'x'))];
  },

  writev: async (c) => {
    const fd = c.fs.openSync(c.p('rw.txt'), 'w+');
    const out = await viaCallback((d) => c.fs.writev(fd, [new Uint8Array([1, 2]), new Uint8Array([3])], 0, d), (n) => n);
    c.fs.closeSync(fd);
    return [out, step(() => c.fs.readFileSync(c.p('rw.txt')))];
  },

  writevSync: (c) => {
    const n = withFd(c, 'rw.txt', 'w+', (fd) => c.fs.writevSync(fd, [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])], 0));
    return [n, step(() => c.fs.readFileSync(c.p('rw.txt')))];
  },

  ftruncate: async (c) => {
    const fd = c.fs.openSync(c.p('file.txt'), 'r+');
    const out = [
      await viaCallback((d) => c.fs.ftruncate(fd, 2, d)),
      c.fs.fstatSync(fd).size,
      await viaCallback((d) => c.fs.ftruncate(fd, d)),
      c.fs.fstatSync(fd).size,
    ];
    c.fs.closeSync(fd);
    return [...out, c.fs.readFileSync(c.p('file.txt'), 'utf8'), await viaCallback((d) => c.fs.ftruncate(fd, 1, d))];
  },

  ftruncateSync: (c) => {
    const out = withFd(c, 'file.txt', 'r+', (fd) => [
      step(() => c.fs.ftruncateSync(fd, 3)),
      c.fs.fstatSync(fd).size,
      step(() => c.fs.ftruncateSync(fd, 6)),
      step(() => c.fs.readFileSync(c.p('file.txt'))),
    ]);
    return [...out, step(() => c.fs.ftruncateSync(9999, 0))];
  },

  fsync: async (c) => {
    const fd = c.fs.openSync(c.p('file.txt'), 'r+');
    c.fs.writeSync(fd, 'sync me', 0);
    const out = await viaCallback((d) => c.fs.fsync(fd, d));
    c.fs.closeSync(fd);
    return [
      out,
      c.fs.readFileSync(c.p('file.txt'), 'utf8'),
      // Syncing a closed descriptor is EBADF, not a quiet success — the whole point of the call
      // is to confirm the data is safe.
      await viaCallback((d) => c.fs.fsync(fd, d)),
    ];
  },

  fsyncSync: (c) => {
    const fd = c.fs.openSync(c.p('file.txt'), 'r+');
    const out = step(() => c.fs.fsyncSync(fd));
    c.fs.closeSync(fd);
    return [out, step(() => c.fs.fsyncSync(fd)), step(() => c.fs.fsyncSync(9999))];
  },

  fdatasync: async (c) => {
    const fd = c.fs.openSync(c.p('file.txt'), 'r+');
    const out = await viaCallback((d) => c.fs.fdatasync(fd, d));
    c.fs.closeSync(fd);
    return [out, await viaCallback((d) => c.fs.fdatasync(fd, d))];
  },

  fdatasyncSync: (c) => {
    const fd = c.fs.openSync(c.p('file.txt'), 'r+');
    const out = step(() => c.fs.fdatasyncSync(fd));
    c.fs.closeSync(fd);
    return [out, step(() => c.fs.fdatasyncSync(fd)), step(() => c.fs.fdatasyncSync(9999))];
  },

  // --- temp directories ---

  // The six random characters differ by construction, so what is compared is the shape of the
  // name, that the directory is real, and where it landed.
  mkdtemp: async (c) => {
    const made = await new Promise<string>((res, rej) => c.fs.mkdtemp(c.p('tmp-'), (e: Any, v: string) => (e ? rej(e) : res(v))));
    return [
      c.un(made).startsWith('/tmp-'),
      c.un(made).length,
      c.fs.statSync(made).isDirectory(),
      await viaCallback((d) => c.fs.mkdtemp(c.p('no/where/t-'), d)),
    ];
  },

  mkdtempSync: (c) => {
    const made = c.fs.mkdtempSync(c.p('tmp-')) as string;
    return [
      c.un(made).startsWith('/tmp-'),
      c.un(made).length,
      c.fs.statSync(made).isDirectory(),
      (c.fs.readdirSync(made) as string[]).length,
      // Two calls with the same prefix land on different names.
      c.un(c.fs.mkdtempSync(c.p('tmp-')) as string) === c.un(made),
      step(() => c.fs.mkdtempSync(c.p('no/where/t-'))),
    ];
  },

  mkdtempDisposableSync: (c) => {
    const d = c.fs.mkdtempDisposableSync(c.p('dis-'));
    return [
      Object.keys(d).sort(),
      typeof d[Symbol.dispose],
      c.un(d.path).startsWith('/dis-'),
      c.fs.statSync(d.path).isDirectory(),
      step(() => d.remove()),
      c.fs.existsSync(d.path),
      // `remove` is idempotent, which is what makes it safe in a `finally`.
      step(() => d.remove()),
    ];
  },

  // --- streams and blobs ---

  createReadStream: async (c) => [
    await drain(c.fs.createReadStream(c.p('file.txt'), { encoding: 'utf8' })),
    await drain(c.fs.createReadStream(c.p('file.txt'))),
    // `start`/`end` are inclusive on both ends, which is the trap in this API.
    await drain(c.fs.createReadStream(c.p('file.txt'), { start: 1, end: 3 })),
    await drain(c.fs.createReadStream(c.p('nope'))),
  ],

  createWriteStream: async (c) => {
    const stream = c.fs.createWriteStream(c.p('out.txt'));
    stream.write('one ');
    stream.write(new Uint8Array([116, 119, 111]));
    await finished(stream);
    const appended = c.fs.createWriteStream(c.p('out.txt'), { flags: 'a' });
    appended.write(' three');
    await finished(appended);
    return [c.fs.readFileSync(c.p('out.txt'), 'utf8'), c.fs.statSync(c.p('out.txt')).size];
  },

  openAsBlob: async (c) => {
    const blob = await c.fs.openAsBlob(c.p('file.txt'));
    return [
      blob.size,
      blob.type,
      await blob.text(),
      [...new Uint8Array(await blob.arrayBuffer())],
      (await c.fs.openAsBlob(c.p('file.txt'), { type: 'text/plain' })).type,
      // Node reports any failure to open as ERR_INVALID_ARG_VALUE, never as the errno.
      await stepAsync(() => c.fs.openAsBlob(c.p('nope'))),
    ];
  },

  // --- watching ---

  /**
   * `watch` *delivery* is not comparable in this harness, and that is a property of the harness
   * rather than of either filesystem: our change events are published to a `BroadcastChannel` by
   * the sync-relay worker (`sync-relay.worker.ts`), and these tests dispatch straight to the
   * engine with no worker in the picture, so nothing is ever published. Delivery — and the
   * documented `change`-instead-of-`rename` divergence — belongs to the browser specs. What is
   * comparable here is the watcher contract, which is most of what callers touch.
   */
  watch: (c) => {
    const w = c.fs.watch(c.p('dir'), () => {});
    const shape = ['close', 'ref', 'unref', 'on', 'once', 'off', 'removeAllListeners', 'emit', 'listenerCount']
      .map((m) => typeof w[m]);
    // The watcher is an EventEmitter, which is how the docs show it used when the listener is
    // not passed inline: `fs.watch(dir).on('change', …)`.
    w.on('change', () => {});
    const listeners = w.listenerCount('change');
    w.close();
    // Closing twice is a no-op rather than a throw, which is what makes it safe in a `finally`.
    return [
      ...shape,
      listeners,
      step(() => w.close()),
      // Watching something that is not there is an error, not a watcher that can never fire.
      step(() => c.fs.watch(c.p('nope'), () => {})),
    ];
  },

  watchFile: async (c) => {
    const seen: Array<[number, number]> = [];
    const watcher = c.fs.watchFile(c.p('file.txt'), { interval: 10 }, (curr: Any, prev: Any) => seen.push([Number(curr.size), Number(prev.size)]));
    // Node hands back a StatWatcher, which is also an EventEmitter carrying the same `'change'`.
    const shape = ['stop', 'ref', 'unref', 'on', 'once', 'off'].map((m) => typeof watcher?.[m]);
    const viaEvent: Array<[number, number]> = [];
    watcher.on('change', (curr: Any, prev: Any) => viaEvent.push([Number(curr.size), Number(prev.size)]));
    const delivered = await keepGrowing(c, () => seen.length > 0 && viaEvent.length > 0);
    c.fs.unwatchFile(c.p('file.txt'));
    restore(c);
    // *Which* write a poll caught is the machine's business, so what is compared is that the
    // listener was handed two stat snapshots of a file that had grown between them.
    const [curr, prev] = seen[0] ?? [0, 0];
    return [...shape, delivered, curr > prev, viaEvent.length > 0];
  },

  unwatchFile: async (c) => {
    let calls = 0;
    const listener = () => { calls++; };
    c.fs.watchFile(c.p('file.txt'), { interval: 10 }, listener);
    const delivered = await keepGrowing(c, () => calls > 0);

    // By the listener it was given — the form that has to keep working now that the watcher is
    // an object of its own, since a wrapped listener would no longer be findable.
    c.fs.unwatchFile(c.p('file.txt'), listener);
    const after = calls;
    // Changes made after unwatching must reach nobody — that is the whole contract.
    await keepGrowing(c, () => false, 400);
    restore(c);
    return [delivered, calls === after, step(() => c.fs.unwatchFile(c.p('never-watched')))];
  },

  // --- classes ---

  Stats: (c) => {
    const st = c.fs.statSync(c.p('file.txt'));
    return [
      st instanceof c.fs.Stats,
      c.fs.lstatSync(c.p('file.txt')) instanceof c.fs.Stats,
      c.fs.statSync(c.p('file.txt'), { bigint: true }) instanceof c.fs.Stats,
      typeof c.fs.Stats,
      // The predicates live on the prototype chain, not copied onto each instance — node hangs
      // them off a `StatsBase` one level further up, so where exactly is not the assertion.
      Object.prototype.hasOwnProperty.call(st, 'isFile'),
      ['isFile', 'isDirectory', 'isSymbolicLink'].map((m) => typeof c.fs.Stats.prototype[m]),
    ];
  },

  Dirent: (c) => {
    const [entry] = c.fs.readdirSync(c.p('dir'), { withFileTypes: true }) as Any[];
    return [
      entry instanceof c.fs.Dirent,
      typeof c.fs.Dirent,
      Object.prototype.hasOwnProperty.call(c.fs.Dirent.prototype, 'isFile'),
      c.fs.opendirSync(c.p('dir')).readSync() instanceof c.fs.Dirent,
    ];
  },

  Dir: (c) => {
    const dir = c.fs.opendirSync(c.p('dir'));
    const out = [dir instanceof c.fs.Dir, typeof c.fs.Dir, typeof dir.read, typeof dir.close, c.un(dir.path)];
    dir.closeSync();
    return out;
  },

  ReadStream: (c) => {
    const stream = discard(c.fs.createReadStream(c.p('file.txt')));
    const out = [stream instanceof c.fs.ReadStream, typeof c.fs.ReadStream, c.fs.FileReadStream === c.fs.ReadStream];
    stream.destroy();
    return out;
  },

  WriteStream: (c) => {
    const stream = discard(c.fs.createWriteStream(c.p('ws.txt')));
    const out = [stream instanceof c.fs.WriteStream, typeof c.fs.WriteStream, c.fs.FileWriteStream === c.fs.WriteStream];
    stream.destroy();
    return out;
  },

  // Node aliases these to the same objects; the aliases are what older code imports.
  FileReadStream: (c) => [
    c.fs.FileReadStream === c.fs.ReadStream,
    discard(c.fs.createReadStream(c.p('file.txt'))) instanceof c.fs.FileReadStream,
  ],
  FileWriteStream: (c) => [
    c.fs.FileWriteStream === c.fs.WriteStream,
    discard(c.fs.createWriteStream(c.p('fws.txt'))) instanceof c.fs.FileWriteStream,
  ],

  Utf8Stream: (c) => {
    const stream = new c.fs.Utf8Stream({ dest: c.p('log.txt'), sync: true });
    stream.write('first\n');
    stream.write('second\n');
    stream.flushSync();
    const written = c.fs.readFileSync(c.p('log.txt'), 'utf8');
    const appended = new c.fs.Utf8Stream({ dest: c.p('log.txt'), sync: true, append: true });
    appended.write('third\n');
    appended.flushSync();
    return [written, c.fs.readFileSync(c.p('log.txt'), 'utf8'), stream.file === c.p('log.txt'), typeof stream.flush, typeof stream.destroy];
  },
};

// ===========================================================================
// node:fs/promises — 32
// ===========================================================================

const PROMISE_CASES: Record<string, Case> = {
  readFile: async (c) => [
    await stepAsync(() => c.fsp.readFile(c.p('file.txt'), 'utf8')),
    await stepAsync(() => c.fsp.readFile(c.p('file.txt'))),
    await stepAsync(() => c.fsp.readFile(c.p('nope'))),
    await stepAsync(() => c.fsp.readFile(c.p('dir'))),
  ],

  writeFile: async (c) => [
    await stepAsync(() => c.fsp.writeFile(c.p('w.txt'), 'promised')),
    c.fs.readFileSync(c.p('w.txt'), 'utf8'),
    await stepAsync(() => c.fsp.writeFile(c.p('w.txt'), new Uint8Array([7, 8]))),
    step(() => c.fs.readFileSync(c.p('w.txt'))),
    await stepAsync(() => c.fsp.writeFile(c.p('dir'), 'x')),
  ],

  appendFile: async (c) => [
    await stepAsync(() => c.fsp.appendFile(c.p('file.txt'), '!')),
    c.fs.readFileSync(c.p('file.txt'), 'utf8'),
    await stepAsync(() => c.fsp.appendFile(c.p('new.txt'), 'created')),
    c.fs.readFileSync(c.p('new.txt'), 'utf8'),
  ],

  stat: async (c) => [
    await stepAsync(() => c.fsp.stat(c.p('file.txt'))),
    await stepAsync(() => c.fsp.stat(c.p('dir'))),
    await stepAsync(() => c.fsp.stat(c.p('nope'))),
    await stepAsync(() => c.fsp.stat(c.p('file.txt'), { bigint: true })),
  ],

  lstat: async (c) => {
    c.fs.symlinkSync(c.p('file.txt'), c.p('link'));
    return [
      await stepAsync(() => c.fsp.lstat(c.p('link'))),
      await stepAsync(() => c.fsp.stat(c.p('link'))),
      await stepAsync(() => c.fsp.lstat(c.p('nope'))),
    ];
  },

  statfs: async (c) => [
    await stepAsync(async () => Object.entries(await c.fsp.statfs(c.p(''))).map(([k, v]) => `${k}:${typeof v}`).sort()),
    await stepAsync(() => c.fsp.statfs(c.p('nope'))),
  ],

  access: async (c) => [
    await stepAsync(() => c.fsp.access(c.p('file.txt'))),
    await stepAsync(() => c.fsp.access(c.p('nope'))),
    await stepAsync(() => c.fsp.access(c.p('file.txt'), c.fs.constants.R_OK)),
  ],

  readdir: async (c) => [
    await stepAsync(async () => ((await c.fsp.readdir(c.p('dir'))) as string[]).sort()),
    await stepAsync(async () => ((await c.fsp.readdir(c.p('dir'), { recursive: true })) as string[]).sort()),
    await stepAsync(async () => ((await c.fsp.readdir(c.p('dir'), { withFileTypes: true })) as Any[]).map((e) => e.name).sort()),
    await stepAsync(() => c.fsp.readdir(c.p('nope'))),
  ],

  mkdir: async (c) => [
    await stepAsync(() => c.fsp.mkdir(c.p('fresh'))),
    await stepAsync(() => c.fsp.mkdir(c.p('fresh'))),
    await stepAsync(async () => c.un((await c.fsp.mkdir(c.p('a/b/c'), { recursive: true })) as string)),
    await stepAsync(() => c.fsp.mkdir(c.p('no/parent'))),
  ],

  rmdir: async (c) => [
    await stepAsync(async () => { c.fs.mkdirSync(c.p('empty')); return c.fsp.rmdir(c.p('empty')); }),
    await stepAsync(() => c.fsp.rmdir(c.p('dir'))),
    await stepAsync(() => c.fsp.rmdir(c.p('nope'))),
  ],

  rm: async (c) => [
    await stepAsync(() => c.fsp.rm(c.p('file.txt'))),
    await stepAsync(() => c.fsp.rm(c.p('file.txt'))),
    await stepAsync(() => c.fsp.rm(c.p('file.txt'), { force: true })),
    await stepAsync(() => c.fsp.rm(c.p('dir'), { recursive: true })),
    c.fs.existsSync(c.p('dir')),
  ],

  // A directory is left out for the reason given on `CASES.unlink`.
  unlink: async (c) => [
    await stepAsync(() => c.fsp.unlink(c.p('file.txt'))),
    await stepAsync(() => c.fsp.unlink(c.p('file.txt'))),
    c.fs.existsSync(c.p('file.txt')),
  ],

  rename: async (c) => [
    await stepAsync(() => c.fsp.rename(c.p('file.txt'), c.p('moved.txt'))),
    c.fs.readFileSync(c.p('moved.txt'), 'utf8'),
    await stepAsync(() => c.fsp.rename(c.p('nope'), c.p('x'))),
  ],

  copyFile: async (c) => [
    await stepAsync(() => c.fsp.copyFile(c.p('file.txt'), c.p('copy.txt'))),
    c.fs.readFileSync(c.p('copy.txt'), 'utf8'),
    await stepAsync(() => c.fsp.copyFile(c.p('file.txt'), c.p('copy.txt'), c.fs.constants.COPYFILE_EXCL)),
    await stepAsync(() => c.fsp.copyFile(c.p('nope'), c.p('x.txt'))),
  ],

  cp: async (c) => [
    await stepAsync(() => c.fsp.cp(c.p('dir'), c.p('dir-copy'), { recursive: true })),
    (c.fs.readdirSync(c.p('dir-copy'), { recursive: true }) as string[]).sort(),
    await stepAsync(() => c.fsp.cp(c.p('dir'), c.p('flat'))),
  ],

  link: async (c) => [
    await stepAsync(() => c.fsp.link(c.p('file.txt'), c.p('hard.txt'))),
    c.fs.readFileSync(c.p('hard.txt'), 'utf8'),
    await stepAsync(() => c.fsp.link(c.p('file.txt'), c.p('hard.txt'))),
  ],

  symlink: async (c) => [
    await stepAsync(() => c.fsp.symlink(c.p('file.txt'), c.p('link'))),
    c.fs.readFileSync(c.p('link'), 'utf8'),
    await stepAsync(() => c.fsp.symlink(c.p('file.txt'), c.p('link'))),
  ],

  readlink: async (c) => {
    c.fs.symlinkSync(c.p('file.txt'), c.p('link'));
    return [
      await stepAsync(async () => c.un((await c.fsp.readlink(c.p('link'))) as string)),
      await stepAsync(() => c.fsp.readlink(c.p('file.txt'))),
    ];
  },

  realpath: async (c) => {
    c.fs.symlinkSync(c.p('dir'), c.p('dlink'));
    return [
      await stepAsync(async () => c.un((await c.fsp.realpath(c.p('dlink'))) as string)),
      await stepAsync(async () => c.un((await c.fsp.realpath(c.p('dlink/sub'))) as string)),
      await stepAsync(() => c.fsp.realpath(c.p('nope'))),
    ];
  },

  truncate: async (c) => [
    await stepAsync(() => c.fsp.truncate(c.p('file.txt'), 2)),
    c.fs.readFileSync(c.p('file.txt'), 'utf8'),
    await stepAsync(() => c.fsp.truncate(c.p('file.txt'))),
    c.fs.statSync(c.p('file.txt')).size,
    await stepAsync(() => c.fsp.truncate(c.p('nope'), 1)),
  ],

  chmod: async (c) => [
    await stepAsync(() => c.fsp.chmod(c.p('file.txt'), 0o600)),
    c.fs.statSync(c.p('file.txt')).mode & 0o777,
    await stepAsync(() => c.fsp.chmod(c.p('nope'), 0o600)),
  ],

  lchmod: async (c) => {
    c.fs.symlinkSync(c.p('file.txt'), c.p('link'));
    return [
      await stepAsync(() => c.fsp.lchmod(c.p('link'), 0o600)),
      c.fs.statSync(c.p('file.txt')).mode & 0o777,
      await stepAsync(() => c.fsp.lchmod(c.p('nope'), 0o600)),
    ];
  },

  chown: async (c) => {
    const [uid, gid] = owner(c);
    return [
      await stepAsync(() => c.fsp.chown(c.p('file.txt'), uid, gid)),
      await stepAsync(() => c.fsp.chown(c.p('nope'), uid, gid)),
    ];
  },

  lchown: async (c) => {
    const [uid, gid] = owner(c);
    c.fs.symlinkSync(c.p('file.txt'), c.p('link'));
    return [
      await stepAsync(() => c.fsp.lchown(c.p('link'), uid, gid)),
      await stepAsync(() => c.fsp.lchown(c.p('nope'), uid, gid)),
    ];
  },

  utimes: async (c) => [
    await stepAsync(() => c.fsp.utimes(c.p('file.txt'), FIXED_ATIME, FIXED_MTIME)),
    times(c, 'file.txt'),
    await stepAsync(() => c.fsp.utimes(c.p('nope'), FIXED_ATIME, FIXED_MTIME)),
  ],

  lutimes: async (c) => {
    c.fs.symlinkSync(c.p('file.txt'), c.p('link'));
    const before = times(c, 'file.txt');
    return [
      await stepAsync(() => c.fsp.lutimes(c.p('link'), FIXED_ATIME, FIXED_MTIME)),
      times(c, 'link', true),
      times(c, 'file.txt')[1] === before[1],
      await stepAsync(() => c.fsp.lutimes(c.p('nope'), FIXED_ATIME, FIXED_MTIME)),
    ];
  },

  mkdtemp: async (c) => {
    const made = (await c.fsp.mkdtemp(c.p('pt-'))) as string;
    return [c.un(made).startsWith('/pt-'), c.un(made).length, c.fs.statSync(made).isDirectory(), await stepAsync(() => c.fsp.mkdtemp(c.p('no/where/t-')))];
  },

  mkdtempDisposable: async (c) => {
    const d = await c.fsp.mkdtempDisposable(c.p('pd-'));
    return [
      Object.keys(d).sort(),
      typeof d[Symbol.asyncDispose],
      c.un(d.path).startsWith('/pd-'),
      await stepAsync(() => d.remove()),
      c.fs.existsSync(d.path),
    ];
  },

  glob: async (c) => [
    (await Array.fromAsync(c.fsp.glob(`${c.p('dir')}/**/*.txt`) as AsyncIterable<string>)).map(c.un).sort(),
    (await Array.fromAsync(c.fsp.glob(`${c.p('dir')}/*.nomatch`) as AsyncIterable<string>)).length,
  ],

  opendir: async (c) => {
    const dir = await c.fsp.opendir(c.p('dir'));
    const names: string[] = [];
    for await (const entry of dir) names.push(entry.name);
    return [names.sort(), c.un(dir.path), await stepAsync(() => c.fsp.opendir(c.p('nope')))];
  },

  // `open` answers a FileHandle, so this drives the handle's whole surface — it is the only
  // route to those methods, and none of them have a `node:fs` function of their own.
  open: async (c) => {
    const handle = await c.fsp.open(c.p('fh.txt'), 'w+');
    const buf = new Uint8Array(3);
    const rv = new Uint8Array(1);
    try {
      const [uid, gid] = owner(c);
      return [
        typeof handle.fd,
        (await handle.write('abcdef')).bytesWritten,
        await stepAsync(() => handle.stat()),
        await stepAsync(() => handle.truncate(3)),
        await stepAsync(() => handle.chmod(0o600)),
        await stepAsync(() => handle.chown(uid, gid)),
        await stepAsync(() => handle.utimes(FIXED_ATIME, FIXED_MTIME)),
        await stepAsync(() => handle.sync()),
        await stepAsync(() => handle.datasync()),
        (await handle.read(buf, 0, 3, 0)).bytesRead,
        [...buf],
        (await handle.writev([new Uint8Array([9])], 0)).bytesWritten,
        (await handle.readv([rv], 0)).bytesRead,
        [...rv],
        await stepAsync(() => handle.readFile('utf8')),
        await stepAsync(() => handle.appendFile('!')),
        await stepAsync(() => handle.readFile('utf8')),
      ];
    } finally {
      await handle.close();
    }
  },

  // Delivery is not comparable in this harness, for the reason given on `CASES.watch`. The
  // comparable part is the iterator contract: an async iterable that ends when it is told to.
  watch: async (c) => {
    const controller = new AbortController();
    const watcher = c.fsp.watch(c.p('dir'), { signal: controller.signal });
    const iterator = watcher[Symbol.asyncIterator]();
    const out = [
      typeof watcher[Symbol.asyncIterator],
      typeof iterator.next,
      typeof iterator.return,
      // Returning early finishes the iterator, per the async-iteration protocol.
      await stepAsync(() => iterator.return()),
      await stepAsync(() => iterator.next()),
    ];
    controller.abort();
    return out;
  },
};

// ===========================================================================

/** Generous, because a case waiting on `watchFile` waits on both filesystems in turn. */
const TIMEOUT = 40_000;

describe('node:fs — every function, against the real thing', () => {
  for (const [name, run] of Object.entries(CASES)) {
    it(name, () => parity(name, run), TIMEOUT);
  }
});

describe('node:fs/promises — every function, against the real thing', () => {
  for (const [name, run] of Object.entries(PROMISE_CASES)) {
    it(name, () => parity(`promises.${name}`, run), TIMEOUT);
  }
});

/**
 * The coverage guard.
 *
 * The denominator is enumerated from the *running* Node rather than written down, so a function
 * added in a future release fails here — with its name — instead of quietly leaving the "100% of
 * the surface" claim one function short.
 */
describe('coverage', () => {
  const exportedFunctions = (mod: object) =>
    Object.keys(mod).filter((k) => typeof (mod as Record<string, unknown>)[k] === 'function');

  it('has a differential case for every node:fs function', () => {
    const missing = exportedFunctions(nodefs).filter((name) => !(name in CASES));
    expect(missing, `node:fs functions with no parity case (${process.version})`).toEqual([]);
  });

  it('has a differential case for every node:fs/promises function', () => {
    const missing = exportedFunctions(nodefsp).filter((name) => !(name in PROMISE_CASES));
    expect(missing, `node:fs/promises functions with no parity case (${process.version})`).toEqual([]);
  });

  it('has no case for anything node does not export', () => {
    expect(Object.keys(CASES).filter((name) => !(name in nodefs))).toEqual([]);
    expect(Object.keys(PROMISE_CASES).filter((name) => !(name in nodefsp))).toEqual([]);
  });

  it('covers the whole surface, and says how big it is', () => {
    const total = exportedFunctions(nodefs).length + exportedFunctions(nodefsp).length;
    expect(Object.keys(CASES).length + Object.keys(PROMISE_CASES).length).toBe(total);
    // Node 24.18 exports 102 + 32. A change here is a change in Node, and the readme's headline
    // number has to move with it.
    expect(total).toBe(134);
  });
});
