/**
 * What `Stats` and `Dirent` cost to build.
 *
 * The object-literal versions allocated eleven objects per `stat`: seven closures for the type
 * predicates and four `Date`s, eagerly, whether or not the caller read them. As classes the
 * predicates live on the prototype (zero per instance) and the dates are lazy getters.
 *
 * The `literal` benches below reconstruct the old shapes exactly, so the comparison is against
 * the code that was actually there rather than an estimate. Decoding is held constant — both
 * sides start from the same DataView reads.
 */

import { bench, describe } from 'vitest';
import { Stats, Dirent } from '../src/stats-classes.js';
import { createFsHarness } from './helpers/engine-transport.js';

const { fs } = createFsHarness();
fs.mkdirSync('/bench');
for (let i = 0; i < 200; i++) fs.writeFileSync(`/bench/f${i}`, 'x');

const now = Date.now();

/** Exactly the object literal `decodeStats` used to return. */
function statsLiteral() {
  const mode = 0o100644, size = 1, atimeMs = now, mtimeMs = now, ctimeMs = now;
  const isFile = true, isDirectory = false, isSymlink = false;
  return {
    isFile: () => isFile,
    isDirectory: () => isDirectory,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => isSymlink,
    isFIFO: () => false,
    isSocket: () => false,
    dev: 1, ino: 7, mode, nlink: 1, uid: 0, gid: 0, rdev: 0,
    size, blksize: 4096, blocks: Math.ceil(size / 512),
    atimeMs, mtimeMs, ctimeMs, birthtimeMs: ctimeMs,
    atime: new Date(atimeMs), mtime: new Date(mtimeMs),
    ctime: new Date(ctimeMs), birthtime: new Date(ctimeMs),
    atimeNs: atimeMs * 1_000_000, mtimeNs: mtimeMs * 1_000_000,
    ctimeNs: ctimeMs * 1_000_000, birthtimeNs: ctimeMs * 1_000_000,
  };
}

function statsClass() {
  return new Stats(1, 0o100644, 1, 0, 0, 0, 4096, 7, 1, 1, now, now, now, now);
}

describe('Stats construction', () => {
  bench('literal — the previous implementation', () => { statsLiteral(); });
  bench('class', () => { statsClass(); });

  // The predicates have to keep working, and a caller that reads one should not pay more.
  bench('literal + isFile()', () => { statsLiteral().isFile(); });
  bench('class + isFile()', () => { statsClass().isFile(); });

  // A caller that does want a Date pays for it on the class, once.
  bench('literal + .mtime', () => { statsLiteral().mtime; });
  bench('class + .mtime', () => { statsClass().mtime; });
});

// Unlike Stats, the Dirent class is *not* faster to construct — the private type slot costs
// more than the seven closures it replaces. Measured and kept anyway: it buys `instanceof`,
// node's own-property shape, and one definition shared by readdir and glob. Recorded here so the
// trade-off stays visible rather than being assumed to be a win.
describe('Dirent construction', () => {
  bench('literal — the previous implementation', () => {
    const isFile = true, isDirectory = false, isSymlink = false;
    ({
      name: 'f', parentPath: '/bench', path: '/bench',
      isFile: () => isFile,
      isDirectory: () => isDirectory,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isSymbolicLink: () => isSymlink,
      isFIFO: () => false,
      isSocket: () => false,
    });
  });
  bench('class', () => { new Dirent('f', 1, '/bench'); });
});

describe('end to end, through the real engine', () => {
  bench('statSync', () => { fs.statSync('/bench/f0'); });
  bench('readdirSync withFileTypes (200 entries)', () => {
    fs.readdirSync('/bench', { withFileTypes: true });
  });
  bench('readdir + stat walk (200 entries)', () => {
    for (const e of fs.readdirSync('/bench') as string[]) fs.statSync('/bench/' + e);
  });
});
