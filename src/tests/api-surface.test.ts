/**
 * API surface parity with `node:fs`.
 *
 * Guards the *shape* of the public API rather than any behaviour: every function `node:fs` and
 * `node:fs/promises` expose should exist here too, so a Node-targeted codebase does not hit an
 * "is not a function" at runtime. Deliberate omissions are listed with the reason, which keeps
 * the gap visible instead of silently growing.
 */

import { describe, it, expect } from 'vitest';
import * as nodefs from 'node:fs';
import * as nodefsp from 'node:fs/promises';
import { VFSFileSystem } from '../src/filesystem.js';

// The constructor spawns Workers and touches SharedArrayBuffer, neither of which exists in the
// Node test runner. This suite only inspects shapes, so stand in the minimum needed to build an
// instance; nothing here performs I/O.
class StubWorker {
  onmessage: unknown = null;
  onerror: unknown = null;
  postMessage(): void {}
  terminate(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}
(globalThis as Record<string, unknown>).Worker ??= StubWorker;

/**
 * Members of `node:fs` we intentionally do not provide.
 *
 * `Stats`/`Dirent`/`Dir` are structural interfaces in this library rather than runtime classes;
 * exposing a constructor that nothing is actually an instance of would make `instanceof` lie.
 * `Utf8Stream` is a Node-24 internal logging stream with no filesystem semantics, and
 * `_toUnixTimestamp` is a private helper Node itself marks with an underscore.
 */
const INTENTIONALLY_ABSENT = new Set(['Stats', 'Dirent', 'Dir', 'Utf8Stream', '_toUnixTimestamp']);

/** Every own or inherited member name, walking the prototype chain. */
function membersOf(instance: object): Set<string> {
  const names = new Set<string>();
  for (let o: object | null = instance; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const k of Object.getOwnPropertyNames(o)) names.add(k);
  }
  return names;
}

describe('fs surface', () => {
  // The constructor does no I/O, so an un-initialised instance is enough to inspect the shape.
  const fs = new VFSFileSystem();
  const ours = membersOf(fs);

  const nodeMembers = Object.keys(nodefs).filter(
    (k) => typeof (nodefs as Record<string, unknown>)[k] === 'function'
  );

  it.each(nodeMembers.filter((k) => !INTENTIONALLY_ABSENT.has(k)))('provides %s', (name) => {
    expect(ours.has(name), `${name} is missing from VFSFileSystem`).toBe(true);
  });

  it('documents every omission', () => {
    // If an omission becomes available, drop it from the list rather than leaving it stale.
    for (const name of INTENTIONALLY_ABSENT) {
      if (name.startsWith('_')) continue;
      expect(Object.keys(nodefs), `${name} is no longer part of node:fs`).toContain(name);
    }
  });

  it('exposes the stream constructors Node exposes', () => {
    for (const name of ['ReadStream', 'WriteStream', 'FileReadStream', 'FileWriteStream']) {
      expect(typeof (fs as unknown as Record<string, unknown>)[name], name).toBe('function');
    }
    expect(fs.FileReadStream).toBe(fs.ReadStream);
    expect(fs.FileWriteStream).toBe(fs.WriteStream);
  });
});

describe('fs.promises surface', () => {
  const fs = new VFSFileSystem();
  const ours = membersOf(fs.promises);

  const nodeMembers = Object.keys(nodefsp).filter(
    (k) => typeof (nodefsp as Record<string, unknown>)[k] === 'function'
  );

  it.each(nodeMembers)('provides %s', (name) => {
    expect(ours.has(name), `${name} is missing from fs.promises`).toBe(true);
  });
});

describe('mkdtempDisposable', () => {
  it('exposes the same shape as Node', () => {
    // Node returns { path, remove } plus Symbol.dispose (sync) / Symbol.asyncDispose (async).
    const fs = new VFSFileSystem();
    expect(typeof fs.mkdtempDisposableSync).toBe('function');
    expect(typeof fs.promises.mkdtempDisposable).toBe('function');
  });
});
