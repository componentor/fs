/**
 * `glob`'s `exclude` option, compared against a live `node:fs`.
 *
 * Two forms, two different contracts, both taken from node rather than the docs:
 *
 *   • **function** — receives a `Dirent` when `withFileTypes: true`, otherwise the entry's
 *     **basename**. We passed the absolute path, so `exclude: (n) => n === 'node_modules'` —
 *     the form nearly everyone writes — matched nothing and excluded nothing.
 *   • **glob patterns** — matched against the path relative to `cwd`. Unsupported here; it threw.
 *
 * One case is deliberately *not* reproduced, and is asserted below so the difference stays
 * visible: node's function form fails to drop **nested files**. `(n) => n.endsWith('.js')`
 * removes `top.js` but leaves `a/drop.js`, while node's own pattern form removes both. Copying
 * that would silently keep files the caller asked to drop.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as nodefs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFsHarness } from './helpers/engine-transport.js';
import type { VFSFileSystem } from '../src/filesystem.js';

let fs: VFSFileSystem;
let root: string;

/** a/keep.txt, a/drop.js, top.js, and a `skip` directory. */
beforeEach(() => {
  fs = createFsHarness().fs;
  root = nodefs.mkdtempSync(join(tmpdir(), 'glob-exclude-'));
  for (const d of ['a', 'skip']) { fs.mkdirSync('/' + d); nodefs.mkdirSync(join(root, d)); }
  for (const f of ['a/keep.txt', 'a/drop.js', 'top.js', 'skip/inner.txt']) {
    fs.writeFileSync('/' + f, 'x');
    nodefs.writeFileSync(join(root, f), 'x');
  }
});
afterEach(() => nodefs.rmSync(root, { recursive: true, force: true }));

type G = { globSync(p: string, o?: Record<string, unknown>): unknown[] };
const ourGlob = (pattern: string, opts: Record<string, unknown> = {}) =>
  ((fs as unknown as G).globSync(pattern, { cwd: '/', ...opts }) as string[]).sort();
const nodeGlob = (pattern: string, opts: Record<string, unknown> = {}) =>
  (nodefs.globSync(pattern, { cwd: root, ...opts } as never) as string[]).sort();

describe('the function form receives a basename', () => {
  it('sees exactly the basenames node sees', () => {
    const ours: string[] = [];
    const theirs: string[] = [];
    ourGlob('**/*', { exclude: (n: string) => { ours.push(n); return false; } });
    nodeGlob('**/*', { exclude: (n: string) => { theirs.push(n); return false; } });

    // Order is an implementation detail; the set of values, and their *shape*, is the contract.
    expect(ours.every((n) => !n.includes('/')), `we passed paths: ${JSON.stringify(ours)}`).toBe(true);
    expect(new Set(ours)).toEqual(new Set(theirs));
  });

  it('excludes a directory by name, pruning its whole subtree — matching node', () => {
    const ours = ourGlob('**/*', { exclude: (n: string) => n === 'skip' });
    const theirs = nodeGlob('**/*', { exclude: (n: string) => n === 'skip' });
    expect(ours).toEqual(theirs);
    expect(ours).toEqual(['a', 'a/drop.js', 'a/keep.txt', 'top.js']);
  });

  it('excludes a top-level file by name, matching node', () => {
    const ours = ourGlob('**/*', { exclude: (n: string) => n === 'top.js' });
    const theirs = nodeGlob('**/*', { exclude: (n: string) => n === 'top.js' });
    expect(ours).toEqual(theirs);
    expect(ours).not.toContain('top.js');
  });

  it('excluding everything yields nothing, matching node', () => {
    expect(ourGlob('**/*', { exclude: () => true })).toEqual(nodeGlob('**/*', { exclude: () => true }));
    expect(ourGlob('**/*', { exclude: () => true })).toEqual([]);
  });

  it('receives a Dirent when withFileTypes is set', () => {
    const kinds: string[] = [];
    (fs as unknown as G).globSync('**/*', {
      cwd: '/',
      withFileTypes: true,
      exclude: (d: unknown) => { kinds.push(typeof d === 'string' ? 'string' : 'dirent'); return false; },
    });
    expect(kinds.length).toBeGreaterThan(0);
    expect(new Set(kinds)).toEqual(new Set(['dirent']));
  });
});

describe('the glob-pattern form', () => {
  it.each([
    ['a/*'],
    ['*.js'],
    ['**/*.js'],
    ['drop.js'],
    ['skip/**'],
  ])('exclude: [%s] matches node exactly', (pattern) => {
    expect(ourGlob('**/*', { exclude: [pattern] })).toEqual(nodeGlob('**/*', { exclude: [pattern] }));
  });

  it.each([
    ['**'],
    ['skip'],
    ['a/**'],
    ['**/*'],
  ])('exclude: [%s] matches node exactly (trailing ** and pruning)', (pattern) => {
    // `skip/**` keeps `skip` and drops what is under it; `skip` alone drops both, because
    // excluding a directory prunes its subtree. A trailing `**` needs at least one segment.
    expect(ourGlob('**/*', { exclude: [pattern] })).toEqual(nodeGlob('**/*', { exclude: [pattern] }));
  });

  it('accepts several patterns at once', () => {
    const opts = { exclude: ['**/*.js', 'skip/**'] };
    expect(ourGlob('**/*', opts)).toEqual(nodeGlob('**/*', opts));
  });

  it('expands brace alternations in a pattern', () => {
    expect(ourGlob('**/*', { exclude: ['**/*.{js,txt}'] })).toEqual(['a', 'skip']);
  });
});

describe('excluding a directory prunes its subtree', () => {
  // Asserted by counting filesystem operations rather than by timing: the point of pruning is
  // that the walk never enters the directory, which is a property of the work done, not of how
  // fast the machine ran. A timer cannot separate the two here — repeated runs of the *same*
  // build spread from 576 to 881 ops/sec.
  it('does a fraction of the work, in both exclude forms', () => {
    fs.mkdirSync('/tree');
    for (let d = 0; d < 5; d++) {
      fs.mkdirSync(`/tree/d${d}`);
      for (let f = 0; f < 10; f++) fs.writeFileSync(`/tree/d${d}/f${f}.ts`, 'x');
    }
    fs.mkdirSync('/tree/node_modules');
    for (let f = 0; f < 200; f++) fs.writeFileSync(`/tree/node_modules/m${f}.ts`, 'x');

    const measure = (exclude?: unknown) => {
      const holder = fs as unknown as { _sync: (b: Uint8Array) => unknown };
      const inner = holder._sync;
      let ops = 0;
      holder._sync = (b: Uint8Array) => { ops++; return inner.call(fs, b); };
      try {
        const opts: Record<string, unknown> = { cwd: '/tree' };
        if (exclude !== undefined) opts.exclude = exclude;
        const results = ((fs as unknown as G).globSync('**/*.ts', opts) as string[]).length;
        return { ops, results };
      } finally {
        holder._sync = inner;
      }
    };

    const plain = measure();
    const byName = measure((n: string) => n === 'node_modules');
    const byPattern = measure(['node_modules']);

    // Same answer from all three…
    expect(plain.results).toBe(250);
    expect(byName.results).toBe(50);
    expect(byPattern.results).toBe(50);

    // …but the pruning forms never walk into node_modules, so they cost a fraction.
    expect(byName.ops, `${byName.ops} vs ${plain.ops}`).toBeLessThan(plain.ops / 2);
    expect(byPattern.ops, `${byPattern.ops} vs ${plain.ops}`).toBeLessThan(plain.ops / 2);
  });

  it('a pattern that does not match the directory cannot prune it', () => {
    // `skip/**` matches what is *inside* the directory, not the directory itself, so the walk
    // still enters it and filters at match time. Worth knowing when writing an exclude.
    fs.mkdirSync('/t2');
    fs.mkdirSync('/t2/skip');
    fs.writeFileSync('/t2/keep.ts', 'x');
    for (let f = 0; f < 20; f++) fs.writeFileSync(`/t2/skip/s${f}.ts`, 'x');

    const results = ((fs as unknown as G).globSync('**/*.ts', { cwd: '/t2', exclude: ['skip/**'] }) as string[]);
    expect(results).toEqual(['keep.ts']);
  });
});

describe('the one deliberate difference: nested files', () => {
  it('node keeps a nested file its own exclude asked to drop; we drop it', () => {
    const predicate = (n: string) => n.endsWith('.js');

    // node's own pattern form removes both .js files…
    expect(nodeGlob('**/*', { exclude: ['**/*.js'] })).not.toContain('a/drop.js');
    // …but its function form leaves the nested one behind. Asserted so that if node fixes this,
    // this test fails and the divergence note in the readme can go.
    expect(nodeGlob('**/*', { exclude: predicate })).toContain('a/drop.js');

    // We apply the predicate at every depth, which is what the option documents.
    expect(ourGlob('**/*', { exclude: predicate })).not.toContain('a/drop.js');
    expect(ourGlob('**/*', { exclude: predicate })).toEqual(['a', 'a/keep.txt', 'skip', 'skip/inner.txt']);
  });
});
