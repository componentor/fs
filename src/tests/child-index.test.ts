/**
 * Children-index correctness tests.
 *
 * The engine maintains an incremental directory-children index (childIndex)
 * so readdir / directory-stat are O(children) instead of O(total files).
 * These tests verify the index NEVER drifts from the source of truth
 * (pathIndex) under any mutation sequence:
 *
 *  1. Unit tests for every mutation path (write, mkdir, unlink, rmdir,
 *     rename, link, symlink, copy, overwrite-rename, mount/rebuild).
 *  2. A seeded randomized fuzz test that after EVERY operation compares:
 *     a. the incremental childIndex against a from-scratch rebuild, and
 *     b. getDirectChildrenWithImplicit output against an independent
 *        reference implementation (the original O(N) prefix scan).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VFSEngine } from '../src/vfs/engine.js';
import { MockSyncHandle } from './helpers/mock-handle.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const DATA = encoder.encode('child-index-test');

// ---- helpers ----

function makeEngine(handle?: MockSyncHandle): { engine: VFSEngine; handle: MockSyncHandle } {
  const h = handle ?? new MockSyncHandle(0);
  const engine = new VFSEngine();
  engine.init(h as unknown as FileSystemSyncAccessHandle);
  return { engine, handle: h };
}

/** Decode a readdir response (status 0) into a sorted list of names. */
function readdirNames(engine: VFSEngine, path: string): string[] {
  const res = engine.readdir(path);
  expect(res.status).toBe(0);
  // Simple list format: count(u32) then per entry: nameLen(u16) + name
  const view = new DataView(res.data!.buffer, res.data!.byteOffset, res.data!.byteLength);
  const count = view.getUint32(0, true);
  const names: string[] = [];
  let off = 4;
  for (let i = 0; i < count; i++) {
    const nameLen = view.getUint16(off, true);
    off += 2;
    names.push(decoder.decode(res.data!.subarray(off, off + nameLen)));
    off += nameLen;
  }
  return names.sort();
}

/**
 * Reference implementation of "direct children with implicit dirs" — the
 * original full prefix scan over pathIndex, kept here as the independent
 * gold standard the index must always agree with.
 */
function refChildrenWithImplicit(
  pathIndex: Map<string, number>,
  dirPath: string
): { path: string; type: 'real' | 'implicit' }[] {
  const prefix = dirPath === '/' ? '/' : dirPath + '/';
  const childNames = new Map<string, 'real' | 'implicit'>();
  for (const path of pathIndex.keys()) {
    if (path === dirPath) continue;
    if (!path.startsWith(prefix)) continue;
    const rest = path.substring(prefix.length);
    const slashPos = rest.indexOf('/');
    if (slashPos === -1) {
      childNames.set(rest, 'real');
    } else {
      const childName = rest.substring(0, slashPos);
      if (!childNames.has(childName)) {
        childNames.set(childName, pathIndex.has(prefix + childName) ? 'real' : 'implicit');
      }
    }
  }
  const result: { path: string; type: 'real' | 'implicit' }[] = [];
  for (const [name, type] of childNames) result.push({ path: prefix + name, type });
  result.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return result;
}

/** Build a reference childIndex from a set of paths (independent walk). */
function buildRefChildIndex(paths: Iterable<string>): Map<string, Map<string, number>> {
  const index = new Map<string, Map<string, number>>();
  for (const path of paths) {
    if (path === '/' || path.length === 0) continue;
    let parent = '/';
    let start = 1;
    while (start <= path.length) {
      let end = path.indexOf('/', start);
      if (end === -1) end = path.length;
      const name = path.substring(start, end);
      if (name.length > 0) {
        let children = index.get(parent);
        if (!children) {
          children = new Map();
          index.set(parent, children);
        }
        children.set(name, (children.get(name) ?? 0) + 1);
        parent = parent === '/' ? '/' + name : parent + '/' + name;
      }
      start = end + 1;
    }
  }
  return index;
}

/** Assert the engine's incremental childIndex exactly equals a fresh rebuild. */
function assertIndexConsistent(engine: VFSEngine, context: string): void {
  const anyEngine = engine as unknown as {
    pathIndex: Map<string, number>;
    childIndex: Map<string, Map<string, number>>;
    ensureChildIndex(): void;
  };
  anyEngine.ensureChildIndex();
  const actual = anyEngine.childIndex;
  const expected = buildRefChildIndex(anyEngine.pathIndex.keys());

  expect(actual.size, `parent count mismatch (${context})`).toBe(expected.size);
  for (const [parent, expChildren] of expected) {
    const actChildren = actual.get(parent);
    expect(actChildren, `missing parent ${parent} (${context})`).toBeDefined();
    expect(actChildren!.size, `child count for ${parent} (${context})`).toBe(expChildren.size);
    for (const [name, count] of expChildren) {
      expect(actChildren!.get(name), `refcount for ${parent} -> ${name} (${context})`).toBe(count);
    }
  }
}

/** Assert listing for a dir agrees with the reference prefix scan. */
function assertListingMatchesReference(engine: VFSEngine, dirPath: string, context: string): void {
  const anyEngine = engine as unknown as {
    pathIndex: Map<string, number>;
    getDirectChildrenWithImplicit(p: string): { path: string; type: 'real' | 'implicit' }[];
  };
  const actual = anyEngine.getDirectChildrenWithImplicit(dirPath);
  const expected = refChildrenWithImplicit(anyEngine.pathIndex, dirPath);
  expect(actual, `listing of ${dirPath} (${context})`).toEqual(expected);
}

// Deterministic PRNG (mulberry32) so fuzz failures are reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- unit tests ----

describe('childIndex — unit', () => {
  let engine: VFSEngine;

  beforeEach(() => {
    ({ engine } = makeEngine());
  });

  it('write creates child entries for the whole ancestor chain', () => {
    expect(engine.mkdir('/a/b/c', 1).status).toBe(0); // recursive
    expect(engine.write('/a/b/c/file.txt', DATA).status).toBe(0);
    expect(readdirNames(engine, '/')).toContain('a');
    expect(readdirNames(engine, '/a')).toEqual(['b']);
    expect(readdirNames(engine, '/a/b')).toEqual(['c']);
    expect(readdirNames(engine, '/a/b/c')).toEqual(['file.txt']);
    assertIndexConsistent(engine, 'after writes');
  });

  it('unlink removes the child entry; siblings unaffected', () => {
    engine.mkdir('/d');
    engine.write('/d/one.txt', DATA);
    engine.write('/d/two.txt', DATA);
    expect(engine.unlink('/d/one.txt').status).toBe(0);
    expect(readdirNames(engine, '/d')).toEqual(['two.txt']);
    assertIndexConsistent(engine, 'after unlink');
  });

  it('unlink of last file keeps the explicit dir but drops the file edge', () => {
    engine.mkdir('/d');
    engine.write('/d/only.txt', DATA);
    expect(engine.unlink('/d/only.txt').status).toBe(0);
    expect(readdirNames(engine, '/d')).toEqual([]);
    expect(engine.stat('/d').status).toBe(0);
    assertIndexConsistent(engine, 'after last unlink');
  });

  it('rmdir recursive removes the whole subtree from the index', () => {
    engine.mkdir('/r/s/t', 1);
    engine.write('/r/s/t/deep.txt', DATA);
    engine.write('/r/top.txt', DATA);
    expect(engine.rmdir('/r', 1).status).toBe(0);
    expect(readdirNames(engine, '/')).not.toContain('r');
    assertIndexConsistent(engine, 'after recursive rmdir');
  });

  it('rename of a file moves the child edge', () => {
    engine.mkdir('/src');
    engine.mkdir('/dst');
    engine.write('/src/f.txt', DATA);
    expect(engine.rename('/src/f.txt', '/dst/g.txt').status).toBe(0);
    expect(readdirNames(engine, '/src')).toEqual([]);
    expect(readdirNames(engine, '/dst')).toEqual(['g.txt']);
    assertIndexConsistent(engine, 'after file rename');
  });

  it('rename of a directory moves all descendant edges', () => {
    engine.mkdir('/old/x/y', 1);
    engine.write('/old/x/y/a.txt', DATA);
    engine.write('/old/x/b.txt', DATA);
    expect(engine.rename('/old', '/new').status).toBe(0);
    expect(readdirNames(engine, '/new')).toEqual(['x']);
    expect(readdirNames(engine, '/new/x')).toEqual(['b.txt', 'y']);
    expect(readdirNames(engine, '/new/x/y')).toEqual(['a.txt']);
    expect(engine.readdir('/old').status).not.toBe(0);
    assertIndexConsistent(engine, 'after dir rename');
  });

  it('rename onto an existing directory target replaces it cleanly', () => {
    engine.mkdir('/a', 0);
    engine.write('/a/inner.txt', DATA);
    engine.mkdir('/b', 0);
    engine.write('/b/old.txt', DATA);
    const res = engine.rename('/a', '/b');
    if (res.status === 0) {
      expect(readdirNames(engine, '/b')).toEqual(['inner.txt']);
    }
    assertIndexConsistent(engine, 'after overwrite rename');
  });

  it('link and symlink create child edges', () => {
    engine.mkdir('/links');
    engine.write('/links/target.txt', DATA);
    expect(engine.symlink('/links/target.txt', '/links/sym').status).toBe(0);
    expect(engine.link('/links/target.txt', '/links/hard').status).toBe(0);
    expect(readdirNames(engine, '/links')).toEqual(['hard', 'sym', 'target.txt']);
    assertIndexConsistent(engine, 'after link/symlink');
  });

  it('copy creates a child edge at the destination', () => {
    engine.mkdir('/c1');
    engine.mkdir('/c2');
    engine.write('/c1/f.txt', DATA);
    expect(engine.copy('/c1/f.txt', '/c2/f.txt', 0).status).toBe(0);
    expect(readdirNames(engine, '/c2')).toEqual(['f.txt']);
    assertIndexConsistent(engine, 'after copy');
  });

  it('names that are prefixes of each other do not collide', () => {
    engine.mkdir('/p', 0);
    engine.mkdir('/p/ab', 0);
    engine.write('/p/a', DATA);
    engine.write('/p/ab/x.txt', DATA);
    expect(readdirNames(engine, '/p')).toEqual(['a', 'ab']);
    expect(readdirNames(engine, '/p/ab')).toEqual(['x.txt']);
    expect(engine.unlink('/p/a').status).toBe(0);
    expect(readdirNames(engine, '/p')).toEqual(['ab']);
    assertIndexConsistent(engine, 'after prefix-name ops');
  });

  it('unicode names survive the index round-trip', () => {
    engine.mkdir('/uni');
    engine.write('/uni/日本語ファイル.txt', DATA);
    engine.write('/uni/émoji-🚀.bin', DATA);
    expect(readdirNames(engine, '/uni').length).toBe(2);
    assertIndexConsistent(engine, 'after unicode writes');
  });

  it('survives mount: index rebuilt from disk matches reference', () => {
    const { engine: e1, handle } = makeEngine();
    e1.mkdir('/persisted/sub', 1);
    e1.write('/persisted/sub/data.txt', DATA);
    e1.write('/persisted/root.txt', DATA);
    // Second engine mounts the same backing buffer (rebuildIndex path)
    const { engine: e2 } = makeEngine(handle);
    expect(readdirNames(e2, '/persisted')).toEqual(['root.txt', 'sub']);
    expect(readdirNames(e2, '/persisted/sub')).toEqual(['data.txt']);
    assertIndexConsistent(e2, 'after mount');
  });

  it('stale index after direct pathIndex mutation is rebuilt on demand', () => {
    // Mirrors the existing implicit-directory test scaffolding: mutate
    // pathIndex directly (bypassing helpers) and bump the generation —
    // the index must notice and resync rather than serve stale data.
    engine.mkdir('/ghost-parent');
    const anyEngine = engine as unknown as {
      pathIndex: Map<string, number>;
      pathIndexGen: number;
    };
    anyEngine.pathIndex.delete('/ghost-parent');
    anyEngine.pathIndexGen++;
    assertIndexConsistent(engine, 'after direct mutation');
    assertListingMatchesReference(engine, '/', 'after direct mutation');
  });

  it('implicit directories are listed and typed correctly', () => {
    // Implicit dirs arise from edge states (e.g. repair); simulate via the
    // same direct-mutation route the existing implicit-dir tests use.
    engine.mkdir('/imp', 0);
    engine.mkdir('/imp/mid', 0);
    engine.write('/imp/mid/leaf.txt', DATA);
    const anyEngine = engine as unknown as {
      pathIndex: Map<string, number>;
      pathIndexGen: number;
    };
    // Remove the middle dir's inode entry -> '/imp/mid' becomes implicit
    anyEngine.pathIndex.delete('/imp/mid');
    anyEngine.pathIndexGen++;
    assertListingMatchesReference(engine, '/imp', 'implicit middle dir');
    expect(readdirNames(engine, '/imp')).toEqual(['mid']);
    expect(readdirNames(engine, '/imp/mid')).toEqual(['leaf.txt']);
    assertIndexConsistent(engine, 'after implicit dir setup');
  });
});

// ---- fuzz test ----

describe('childIndex — randomized fuzz vs reference model', () => {
  // Multiple seeds; each runs a long random op sequence. Failures print the
  // seed and op number, so any regression is exactly reproducible.
  const SEEDS = [1, 42, 1337, 20260611];
  const OPS_PER_SEED = 800;

  for (const seed of SEEDS) {
    it(`seed ${seed}: ${OPS_PER_SEED} random ops never desync the index`, () => {
      const rand = mulberry32(seed);
      const { engine } = makeEngine();
      const anyEngine = engine as unknown as { pathIndex: Map<string, number> };

      const dirs: string[] = ['/'];
      const files: string[] = [];
      let nameCounter = 0;

      const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
      const newName = (kind: string) => `${kind}${nameCounter++}`;
      const join = (dir: string, name: string) => (dir === '/' ? '/' + name : dir + '/' + name);

      for (let op = 0; op < OPS_PER_SEED; op++) {
        const roll = rand();
        const ctx = `seed ${seed} op ${op}`;
        let touched: string[] = ['/'];

        if (roll < 0.35) {
          // write a new file (or overwrite an existing one)
          const dir = pick(dirs);
          const path = rand() < 0.8 || files.length === 0 ? join(dir, newName('f')) : pick(files);
          const res = engine.write(path, DATA);
          if (res.status === 0 && !files.includes(path)) files.push(path);
          touched = [dir];
        } else if (roll < 0.5) {
          // mkdir (sometimes nested-recursive)
          const dir = pick(dirs);
          const path =
            rand() < 0.3
              ? join(join(dir, newName('d')), newName('d'))
              : join(dir, newName('d'));
          const res = engine.mkdir(path, rand() < 0.5 ? 1 : 0);
          if (res.status === 0) {
            dirs.push(path);
            // recursive mkdir may have created intermediate dirs too
            const parent = path.substring(0, path.lastIndexOf('/'));
            if (parent.length > 0 && !dirs.includes(parent)) dirs.push(parent);
          }
          touched = [dir, path];
        } else if (roll < 0.62 && files.length > 0) {
          // unlink a file
          const path = pick(files);
          const res = engine.unlink(path);
          if (res.status === 0) files.splice(files.indexOf(path), 1);
          touched = [path.substring(0, path.lastIndexOf('/')) || '/'];
        } else if (roll < 0.72 && dirs.length > 1) {
          // rmdir (recursive half the time)
          const path = pick(dirs.filter(d => d !== '/'));
          const recursive = rand() < 0.5;
          const res = engine.rmdir(path, recursive ? 1 : 0);
          if (res.status === 0) {
            // drop the dir and (if recursive) everything under it from tracking
            for (let i = dirs.length - 1; i >= 0; i--) {
              if (dirs[i] === path || dirs[i].startsWith(path + '/')) dirs.splice(i, 1);
            }
            for (let i = files.length - 1; i >= 0; i--) {
              if (files[i].startsWith(path + '/')) files.splice(i, 1);
            }
          }
          touched = [path, path.substring(0, path.lastIndexOf('/')) || '/'];
        } else if (roll < 0.84 && files.length > 0) {
          // rename a file
          const oldPath = pick(files);
          const newPath = join(pick(dirs), newName('rn'));
          const res = engine.rename(oldPath, newPath);
          if (res.status === 0) {
            files.splice(files.indexOf(oldPath), 1);
            files.push(newPath);
          }
          touched = [
            oldPath.substring(0, oldPath.lastIndexOf('/')) || '/',
            newPath.substring(0, newPath.lastIndexOf('/')) || '/',
          ];
        } else if (roll < 0.92 && dirs.length > 1) {
          // rename a whole directory
          const oldPath = pick(dirs.filter(d => d !== '/'));
          const newPath = join('/', newName('mv'));
          const res = engine.rename(oldPath, newPath);
          if (res.status === 0) {
            const remap = (p: string) =>
              p === oldPath ? newPath : p.startsWith(oldPath + '/') ? newPath + p.substring(oldPath.length) : p;
            for (let i = 0; i < dirs.length; i++) dirs[i] = remap(dirs[i]);
            for (let i = 0; i < files.length; i++) files[i] = remap(files[i]);
          }
          touched = [oldPath.substring(0, oldPath.lastIndexOf('/')) || '/', '/'];
        } else if (files.length > 0) {
          // hard link
          const target = pick(files);
          const linkPath = join(pick(dirs), newName('ln'));
          const res = engine.link(target, linkPath);
          if (res.status === 0) files.push(linkPath);
          touched = [linkPath.substring(0, linkPath.lastIndexOf('/')) || '/'];
        }

        // Invariant 1: incremental index identical to from-scratch rebuild
        assertIndexConsistent(engine, ctx);

        // Invariant 2: listings agree with the reference prefix scan for
        // every touched parent plus a random sample of known dirs.
        const sample = new Set(touched);
        sample.add('/');
        if (dirs.length > 0) sample.add(pick(dirs));
        for (const d of sample) {
          assertListingMatchesReference(engine, d, ctx);
        }
      }

      // Final exhaustive check: every directory the model knows about, plus
      // every parent key in pathIndex, agrees with the reference.
      const allParents = new Set<string>(['/']);
      for (const p of anyEngine.pathIndex.keys()) {
        let pos = p.length;
        while (true) {
          pos = p.lastIndexOf('/', pos - 1);
          if (pos <= 0) break;
          allParents.add(p.substring(0, pos));
        }
      }
      for (const d of allParents) {
        assertListingMatchesReference(engine, d, `seed ${seed} final sweep`);
      }
    });
  }
});
