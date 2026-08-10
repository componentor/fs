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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileHandle } from '../src/methods/open.js';

/** A handle with a stub transport — this suite only inspects shapes, it performs no I/O. */
const makeHandle = () => createFileHandle(1, (async () => ({ status: 0, data: null })) as never);

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
 * Members of `node:fs` we intentionally do not provide — currently none.
 *
 * The set is kept rather than deleted because it is load-bearing: it is checked in *both*
 * directions, so an entry that gets implemented fails here instead of quietly becoming a lie.
 * That is how `Stats`/`Dirent`/`Dir` sat here for two releases after 3.3.27 made them real
 * classes, and how `Utf8Stream` and `_toUnixTimestamp` were caught the moment 4.0.0 implemented
 * them. Anything added here needs a reason in this comment.
 */
const INTENTIONALLY_ABSENT = new Set<string>([]);

/** Every own or inherited member name, walking the prototype chain. */
function membersOf(instance: object): Set<string> {
  const names = new Set<string>();
  for (let o: object | null = instance; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const k of Object.getOwnPropertyNames(o)) names.add(k);
  }
  return names;
}

/**
 * The denominator is whatever the *running* Node exports, not a fixed list — so this suite
 * re-derives the surface on every run and a new `fs` function in a future Node shows up as a
 * failure here rather than as a quietly stale claim in the readme.
 */
const NODE_VERSION = process.version;

describe('fs surface', () => {
  // The constructor does no I/O, so an un-initialised instance is enough to inspect the shape.
  const fs = new VFSFileSystem();
  const ours = membersOf(fs);

  const nodeMembers = Object.keys(nodefs).filter(
    (k) => typeof (nodefs as Record<string, unknown>)[k] === 'function'
  );

  it.each(nodeMembers.filter((k) => !INTENTIONALLY_ABSENT.has(k)))('provides %s', (name) => {
    expect(ours.has(name), `${name} is missing from VFSFileSystem (node ${NODE_VERSION})`).toBe(true);
  });

  it('documents every omission, and every omission is still an omission', () => {
    for (const name of INTENTIONALLY_ABSENT) {
      if (name.startsWith('_')) continue;
      // Dropped from Node? Then the entry is obsolete.
      expect(Object.keys(nodefs), `${name} is no longer part of node:fs`).toContain(name);
      // Implemented here after all? Then the entry is a lie — this is the direction that went
      // unchecked and let the Stats/Dirent/Dir entry go stale for two releases.
      expect(ours.has(name), `${name} is implemented — remove it from INTENTIONALLY_ABSENT`).toBe(false);
    }
  });

  it('exposes the result classes so instanceof works', () => {
    for (const name of ['Stats', 'Dirent', 'Dir', 'BigIntStats']) {
      expect(typeof (fs as unknown as Record<string, unknown>)[name], name).toBe('function');
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
    expect(ours.has(name), `${name} is missing from fs.promises (node ${NODE_VERSION})`).toBe(true);
  });
});

describe('FileHandle surface', () => {
  it('provides the whole EventEmitter surface node does, not part of it', async () => {
    // node's FileHandle is a real EventEmitter. This forwarded five methods, so the housekeeping
    // ones long-lived code actually reaches for — removeAllListeners, listenerCount — were
    // "is not a function". Compared against a real handle rather than a remembered list.
    const tmp = join(tmpdir(), `handle-surface-${Date.now()}.txt`);
    nodefs.writeFileSync(tmp, 'x');
    const nodeHandle = await nodefsp.open(tmp, 'r');
    const nodeMembers = new Set<string>();
    for (let o: object | null = nodeHandle as unknown as object; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
      for (const k of Object.getOwnPropertyNames(o)) nodeMembers.add(k);
    }
    await nodeHandle.close();
    nodefs.rmSync(tmp, { force: true });

    const emitterApi = [
      'on', 'once', 'off', 'addListener', 'removeListener', 'removeAllListeners',
      'prependListener', 'prependOnceListener', 'listeners', 'rawListeners',
      'listenerCount', 'eventNames', 'setMaxListeners', 'getMaxListeners', 'emit',
    ];
    // Everything asserted below is genuinely part of node's handle.
    for (const name of emitterApi) {
      expect(nodeMembers.has(name), `${name} is not on node's FileHandle`).toBe(true);
    }

    const ourHandle = makeHandle();
    for (const name of emitterApi) {
      expect(typeof (ourHandle as unknown as Record<string, unknown>)[name], name).toBe('function');
    }
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
