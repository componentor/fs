/**
 * Differential parity against real `node:fs`.
 *
 * Every other test in this suite asserts behaviour someone *believed* Node has. These run the
 * same operation twice — once through the full library stack (method layer → wire encoding →
 * `VFSEngine`) and once through `node:fs` on a real temp directory — and compare the outcomes.
 * A divergence is a compatibility bug by construction, with no room for a wrong expectation.
 *
 * Only semantics both filesystems can agree on are compared: contents, entry lists, sizes,
 * permission bits, and the `code` of any thrown error. Timestamps, inode numbers and device
 * ids are inherently different and are excluded.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import * as nodefs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHarness, createFsHarness as createFsHarnessForCp, type Harness } from './helpers/engine-transport.js';
import { OP } from '../src/protocol/opcodes.js';
import { DISPATCHED_OPS } from '../src/protocol/dispatch.js';
import { readFileSync } from '../src/methods/readFile.js';
import { writeFileSync } from '../src/methods/writeFile.js';
import { appendFileSync } from '../src/methods/appendFile.js';
import { mkdirSync } from '../src/methods/mkdir.js';
import { readdirSync } from '../src/methods/readdir.js';
import { statSync, lstatSync } from '../src/methods/stat.js';
import { unlinkSync } from '../src/methods/unlink.js';
import { rmdirSync } from '../src/methods/rmdir.js';
import { renameSync } from '../src/methods/rename.js';
import { copyFileSync } from '../src/methods/copyFile.js';
import { truncateSync } from '../src/methods/truncate.js';
import { symlinkSync, readlinkSync } from '../src/methods/symlink.js';
import { existsSync } from '../src/methods/exists.js';
import { chmodSync } from '../src/methods/chmod.js';
import { rmSync as vfsRmSync } from '../src/methods/rm.js';
import { linkSync } from '../src/methods/link.js';
import { accessSync } from '../src/methods/access.js';
import { realpathSync } from '../src/methods/realpath.js';
import { utimesSync } from '../src/methods/utimes.js';
import { mkdtempSync as vfsMkdtempSync } from '../src/methods/mkdtemp.js';
import { globSync as vfsGlobSync } from '../src/methods/glob.js';
import { statfsSync } from '../src/methods/statfs.js';
import { openSync, closeSync, writeSyncFd, readSync, ftruncateSync } from '../src/methods/open.js';

let harness: Harness;
let root: string;

beforeEach(() => {
  harness = createHarness();
  root = mkdtempSync(join(tmpdir(), 'parity-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Map a library path onto the real temp directory. */
const real = (p: string) => join(root, p);

/** Run `ours` and `theirs`, returning either the value or the thrown error's `code`. */
function compare<T>(ours: () => T, theirs: () => T): { ours: T | string; theirs: T | string } {
  const run = <R>(fn: () => R): R | string => {
    try {
      return fn();
    } catch (e) {
      return `ERR:${(e as NodeJS.ErrnoException).code ?? (e as Error).name}`;
    }
  };
  return { ours: run(ours), theirs: run(theirs) };
}

/** Assert both implementations produce the same outcome. */
function same<T>(ours: () => T, theirs: () => T, label?: string) {
  const r = compare(ours, theirs);
  expect(r.ours, label).toEqual(r.theirs);
  return r.ours;
}

const text = (v: unknown) => (typeof v === 'string' ? v : new TextDecoder().decode(v as Uint8Array));

describe('parity: files', () => {
  it('write then read round-trips identically', () => {
    same(
      () => { writeFileSync(harness.request, '/a.txt', 'hello'); return text(readFileSync(harness.request, '/a.txt', 'utf8')); },
      () => { nodefs.writeFileSync(real('a.txt'), 'hello'); return nodefs.readFileSync(real('a.txt'), 'utf8'); }
    );
  });

  it('reading a missing file gives the same error code', () => {
    same(
      () => readFileSync(harness.request, '/nope.txt', 'utf8'),
      () => nodefs.readFileSync(real('nope.txt'), 'utf8')
    );
  });

  it('reading a directory gives the same error code', () => {
    mkdirSync(harness.request, '/d');
    nodefs.mkdirSync(real('d'));
    same(
      () => readFileSync(harness.request, '/d', 'utf8'),
      () => nodefs.readFileSync(real('d'), 'utf8')
    );
  });

  it('writing over a directory gives the same error code', () => {
    mkdirSync(harness.request, '/d');
    nodefs.mkdirSync(real('d'));
    same(
      () => writeFileSync(harness.request, '/d', 'x'),
      () => nodefs.writeFileSync(real('d'), 'x')
    );
  });

  it('writing into a missing parent gives the same error code', () => {
    same(
      () => writeFileSync(harness.request, '/missing/a.txt', 'x'),
      () => nodefs.writeFileSync(real('missing/a.txt'), 'x')
    );
  });

  it('append creates then extends, identically', () => {
    same(
      () => { appendFileSync(harness.request, '/log', 'aa'); appendFileSync(harness.request, '/log', 'bb'); return text(readFileSync(harness.request, '/log', 'utf8')); },
      () => { nodefs.appendFileSync(real('log'), 'aa'); nodefs.appendFileSync(real('log'), 'bb'); return nodefs.readFileSync(real('log'), 'utf8'); }
    );
  });

  it('empty files behave the same', () => {
    same(
      () => { writeFileSync(harness.request, '/e', ''); return [text(readFileSync(harness.request, '/e', 'utf8')), (statSync(harness.request, '/e') as { size: number }).size]; },
      () => { nodefs.writeFileSync(real('e'), ''); return [nodefs.readFileSync(real('e'), 'utf8'), nodefs.statSync(real('e')).size]; }
    );
  });

  it('overwriting truncates rather than merging', () => {
    same(
      () => { writeFileSync(harness.request, '/o', 'longer-content'); writeFileSync(harness.request, '/o', 'ab'); return text(readFileSync(harness.request, '/o', 'utf8')); },
      () => { nodefs.writeFileSync(real('o'), 'longer-content'); nodefs.writeFileSync(real('o'), 'ab'); return nodefs.readFileSync(real('o'), 'utf8'); }
    );
  });

  it('unicode content round-trips byte-identically', () => {
    const content = 'héllo 😀 世界';
    same(
      () => { writeFileSync(harness.request, '/u', content); return text(readFileSync(harness.request, '/u', 'utf8')); },
      () => { nodefs.writeFileSync(real('u'), content); return nodefs.readFileSync(real('u'), 'utf8'); }
    );
  });

  it('truncate grows with zeros and shrinks, the same way', () => {
    same(
      () => {
        writeFileSync(harness.request, '/t', 'abcdef');
        truncateSync(harness.request, '/t', 3);
        const short = text(readFileSync(harness.request, '/t', 'utf8'));
        truncateSync(harness.request, '/t', 6);
        const grown = Array.from(readFileSync(harness.request, '/t') as Uint8Array);
        return [short, grown];
      },
      () => {
        nodefs.writeFileSync(real('t'), 'abcdef');
        nodefs.truncateSync(real('t'), 3);
        const short = nodefs.readFileSync(real('t'), 'utf8');
        nodefs.truncateSync(real('t'), 6);
        const grown = Array.from(nodefs.readFileSync(real('t')));
        return [short, grown];
      }
    );
  });
});

describe('parity: directories', () => {
  it('mkdir on an existing path gives the same error code', () => {
    same(
      () => { mkdirSync(harness.request, '/d'); mkdirSync(harness.request, '/d'); },
      () => { nodefs.mkdirSync(real('d')); nodefs.mkdirSync(real('d')); }
    );
  });

  it('recursive mkdir over an existing tree is a no-op for both', () => {
    same(
      () => { mkdirSync(harness.request, '/a/b/c', { recursive: true }); return mkdirSync(harness.request, '/a/b/c', { recursive: true }); },
      () => { nodefs.mkdirSync(real('a/b/c'), { recursive: true }); return nodefs.mkdirSync(real('a/b/c'), { recursive: true }); }
    );
  });

  it('recursive mkdir returns the first created directory', () => {
    same(
      () => mkdirSync(harness.request, '/x/y/z', { recursive: true })?.replace(/^\//, ''),
      () => nodefs.mkdirSync(real('x/y/z'), { recursive: true })?.slice(root.length + 1)
    );
  });

  it('mkdir without a parent gives the same error code', () => {
    same(
      () => mkdirSync(harness.request, '/no/parent'),
      () => nodefs.mkdirSync(real('no/parent'))
    );
  });

  it('readdir lists the same sorted entries', () => {
    same(
      () => {
        mkdirSync(harness.request, '/d');
        writeFileSync(harness.request, '/d/b.txt', '');
        writeFileSync(harness.request, '/d/a.txt', '');
        mkdirSync(harness.request, '/d/sub');
        return (readdirSync(harness.request, '/d') as string[]).slice().sort();
      },
      () => {
        nodefs.mkdirSync(real('d'));
        nodefs.writeFileSync(real('d/b.txt'), '');
        nodefs.writeFileSync(real('d/a.txt'), '');
        nodefs.mkdirSync(real('d/sub'));
        return nodefs.readdirSync(real('d')).slice().sort();
      }
    );
  });

  it('readdir on a file gives the same error code', () => {
    writeFileSync(harness.request, '/f', 'x');
    nodefs.writeFileSync(real('f'), 'x');
    same(
      () => readdirSync(harness.request, '/f'),
      () => nodefs.readdirSync(real('f'))
    );
  });

  it('readdir on a missing directory gives the same error code', () => {
    same(
      () => readdirSync(harness.request, '/gone'),
      () => nodefs.readdirSync(real('gone'))
    );
  });

  it('rmdir on a non-empty directory gives the same error code', () => {
    same(
      () => { mkdirSync(harness.request, '/d'); writeFileSync(harness.request, '/d/f', 'x'); rmdirSync(harness.request, '/d'); },
      () => { nodefs.mkdirSync(real('d')); nodefs.writeFileSync(real('d/f'), 'x'); nodefs.rmdirSync(real('d')); }
    );
  });

  it('rmdir on a file gives the same error code', () => {
    writeFileSync(harness.request, '/f', 'x');
    nodefs.writeFileSync(real('f'), 'x');
    same(
      () => rmdirSync(harness.request, '/f'),
      () => nodefs.rmdirSync(real('f'))
    );
  });

  it('unlink on a directory fails for both', () => {
    // errno here is platform-dependent — EISDIR on Linux, EPERM on macOS/BSD — and Node reports
    // whatever the host kernel returns. We always report the Linux spelling, so compare only
    // that both refuse, not which errno they pick.
    mkdirSync(harness.request, '/d');
    nodefs.mkdirSync(real('d'));
    const r = compare(() => unlinkSync(harness.request, '/d'), () => nodefs.unlinkSync(real('d')));
    expect(String(r.ours)).toMatch(/^ERR:/);
    expect(String(r.theirs)).toMatch(/^ERR:/);
  });

  it('recursive readdir lists the same tree', () => {
    same(
      () => {
        mkdirSync(harness.request, '/r/a/b', { recursive: true });
        writeFileSync(harness.request, '/r/top.txt', '');
        writeFileSync(harness.request, '/r/a/mid.txt', '');
        writeFileSync(harness.request, '/r/a/b/deep.txt', '');
        return (readdirSync(harness.request, '/r', { recursive: true }) as string[]).slice().sort();
      },
      () => {
        nodefs.mkdirSync(real('r/a/b'), { recursive: true });
        nodefs.writeFileSync(real('r/top.txt'), '');
        nodefs.writeFileSync(real('r/a/mid.txt'), '');
        nodefs.writeFileSync(real('r/a/b/deep.txt'), '');
        return nodefs.readdirSync(real('r'), { recursive: true }).slice().sort();
      }
    );
  });
});

describe('parity: stat', () => {
  it('reports the same type, size and permission bits for a file', () => {
    same(
      () => {
        writeFileSync(harness.request, '/f', 'abcdef');
        const s = statSync(harness.request, '/f') as nodefs.Stats;
        return [s.isFile(), s.isDirectory(), s.isSymbolicLink(), s.size, s.mode & 0o777];
      },
      () => {
        nodefs.writeFileSync(real('f'), 'abcdef');
        const s = nodefs.statSync(real('f'));
        return [s.isFile(), s.isDirectory(), s.isSymbolicLink(), s.size, s.mode & 0o777];
      }
    );
  });

  it('reports the same type and permission bits for a directory', () => {
    same(
      () => {
        mkdirSync(harness.request, '/d');
        const s = statSync(harness.request, '/d') as nodefs.Stats;
        return [s.isFile(), s.isDirectory(), s.mode & 0o777];
      },
      () => {
        nodefs.mkdirSync(real('d'));
        const s = nodefs.statSync(real('d'));
        return [s.isFile(), s.isDirectory(), s.mode & 0o777];
      }
    );
  });

  it('stat of a missing path gives the same error code', () => {
    same(
      () => statSync(harness.request, '/nope'),
      () => nodefs.statSync(real('nope'))
    );
  });

  it('chmod is reflected in stat identically', () => {
    same(
      () => { writeFileSync(harness.request, '/f', 'x'); chmodSync(harness.request, '/f', 0o640); return (statSync(harness.request, '/f') as nodefs.Stats).mode & 0o777; },
      () => { nodefs.writeFileSync(real('f'), 'x'); nodefs.chmodSync(real('f'), 0o640); return nodefs.statSync(real('f')).mode & 0o777; }
    );
  });

  it('exists agrees for files, directories and missing paths', () => {
    writeFileSync(harness.request, '/f', 'x');
    mkdirSync(harness.request, '/d');
    nodefs.writeFileSync(real('f'), 'x');
    nodefs.mkdirSync(real('d'));
    for (const p of ['f', 'd', 'nope']) {
      expect(existsSync(harness.request, '/' + p), p).toBe(nodefs.existsSync(real(p)));
    }
  });
});

describe('parity: rename, copy, link', () => {
  it('rename moves content and removes the source', () => {
    same(
      () => {
        writeFileSync(harness.request, '/a', 'data');
        renameSync(harness.request, '/a', '/b');
        return [existsSync(harness.request, '/a'), text(readFileSync(harness.request, '/b', 'utf8'))];
      },
      () => {
        nodefs.writeFileSync(real('a'), 'data');
        nodefs.renameSync(real('a'), real('b'));
        return [nodefs.existsSync(real('a')), nodefs.readFileSync(real('b'), 'utf8')];
      }
    );
  });

  it('rename over an existing file overwrites it', () => {
    same(
      () => {
        writeFileSync(harness.request, '/a', 'new');
        writeFileSync(harness.request, '/b', 'old');
        renameSync(harness.request, '/a', '/b');
        return text(readFileSync(harness.request, '/b', 'utf8'));
      },
      () => {
        nodefs.writeFileSync(real('a'), 'new');
        nodefs.writeFileSync(real('b'), 'old');
        nodefs.renameSync(real('a'), real('b'));
        return nodefs.readFileSync(real('b'), 'utf8');
      }
    );
  });

  it('renaming a missing source gives the same error code', () => {
    same(
      () => renameSync(harness.request, '/gone', '/b'),
      () => nodefs.renameSync(real('gone'), real('b'))
    );
  });

  it('copyFile duplicates content and leaves the source', () => {
    same(
      () => {
        writeFileSync(harness.request, '/a', 'data');
        copyFileSync(harness.request, '/a', '/b');
        return [text(readFileSync(harness.request, '/a', 'utf8')), text(readFileSync(harness.request, '/b', 'utf8'))];
      },
      () => {
        nodefs.writeFileSync(real('a'), 'data');
        nodefs.copyFileSync(real('a'), real('b'));
        return [nodefs.readFileSync(real('a'), 'utf8'), nodefs.readFileSync(real('b'), 'utf8')];
      }
    );
  });

  it('copyFile with COPYFILE_EXCL onto an existing target gives the same error code', () => {
    same(
      () => {
        writeFileSync(harness.request, '/a', 'x');
        writeFileSync(harness.request, '/b', 'y');
        copyFileSync(harness.request, '/a', '/b', nodefs.constants.COPYFILE_EXCL);
      },
      () => {
        nodefs.writeFileSync(real('a'), 'x');
        nodefs.writeFileSync(real('b'), 'y');
        nodefs.copyFileSync(real('a'), real('b'), nodefs.constants.COPYFILE_EXCL);
      }
    );
  });

  it('symlink target round-trips through readlink verbatim', () => {
    // readlink returns the target exactly as given — it is not resolved. Both sides use the
    // same relative target so the comparison is apples to apples.
    same(
      () => { writeFileSync(harness.request, '/t', 'x'); symlinkSync(harness.request, 't', '/l'); return readlinkSync(harness.request, '/l'); },
      () => { nodefs.writeFileSync(real('t'), 'x'); nodefs.symlinkSync('t', real('l')); return nodefs.readlinkSync(real('l')); }
    );
  });

  it('lstat sees the link where stat follows it', () => {
    same(
      () => {
        writeFileSync(harness.request, '/t', 'abc');
        symlinkSync(harness.request, '/t', '/l');
        const l = lstatSync(harness.request, '/l') as nodefs.Stats;
        const s = statSync(harness.request, '/l') as nodefs.Stats;
        return [l.isSymbolicLink(), l.isFile(), s.isSymbolicLink(), s.isFile(), s.size];
      },
      () => {
        nodefs.writeFileSync(real('t'), 'abc');
        nodefs.symlinkSync(real('t'), real('l'));
        const l = nodefs.lstatSync(real('l'));
        const s = nodefs.statSync(real('l'));
        return [l.isSymbolicLink(), l.isFile(), s.isSymbolicLink(), s.isFile(), s.size];
      }
    );
  });

  it('readlink on a regular file gives the same error code', () => {
    writeFileSync(harness.request, '/f', 'x');
    nodefs.writeFileSync(real('f'), 'x');
    same(
      () => readlinkSync(harness.request, '/f'),
      () => nodefs.readlinkSync(real('f'))
    );
  });

  it('reading through a dangling symlink gives the same error code', () => {
    same(
      () => { symlinkSync(harness.request, '/missing', '/l'); return readFileSync(harness.request, '/l', 'utf8'); },
      () => { nodefs.symlinkSync(real('missing'), real('l')); return nodefs.readFileSync(real('l'), 'utf8'); }
    );
  });
});

describe('parity: file descriptors', () => {
  it('open/write/read/close round-trips the same bytes', () => {
    same(
      () => {
        const fd = openSync(harness.request, '/fd.txt', 'w');
        writeSyncFd(harness.request, fd, new TextEncoder().encode('hello fd'), 0, 8, 0);
        closeSync(harness.request, fd);
        return text(readFileSync(harness.request, '/fd.txt', 'utf8'));
      },
      () => {
        const fd = nodefs.openSync(real('fd.txt'), 'w');
        nodefs.writeSync(fd, Buffer.from('hello fd'), 0, 8, 0);
        nodefs.closeSync(fd);
        return nodefs.readFileSync(real('fd.txt'), 'utf8');
      }
    );
  });

  it('reads at an explicit position identically', () => {
    same(
      () => {
        writeFileSync(harness.request, '/p.txt', 'abcdefgh');
        const fd = openSync(harness.request, '/p.txt', 'r');
        const buf = new Uint8Array(4);
        const n = readSync(harness.request, fd, buf, 0, 4, 2);
        closeSync(harness.request, fd);
        return [n, text(buf)];
      },
      () => {
        nodefs.writeFileSync(real('p.txt'), 'abcdefgh');
        const fd = nodefs.openSync(real('p.txt'), 'r');
        const buf = Buffer.alloc(4);
        const n = nodefs.readSync(fd, buf, 0, 4, 2);
        nodefs.closeSync(fd);
        return [n, buf.toString()];
      }
    );
  });

  it('reading past EOF returns zero bytes for both', () => {
    same(
      () => {
        writeFileSync(harness.request, '/s.txt', 'ab');
        const fd = openSync(harness.request, '/s.txt', 'r');
        const buf = new Uint8Array(8);
        const n = readSync(harness.request, fd, buf, 0, 8, 100);
        closeSync(harness.request, fd);
        return n;
      },
      () => {
        nodefs.writeFileSync(real('s.txt'), 'ab');
        const fd = nodefs.openSync(real('s.txt'), 'r');
        const buf = Buffer.alloc(8);
        const n = nodefs.readSync(fd, buf, 0, 8, 100);
        nodefs.closeSync(fd);
        return n;
      }
    );
  });

  it("opening a missing file with 'r' gives the same error code", () => {
    same(
      () => openSync(harness.request, '/gone', 'r'),
      () => nodefs.openSync(real('gone'), 'r')
    );
  });

  it("'wx' onto an existing file gives the same error code", () => {
    writeFileSync(harness.request, '/x', 'a');
    nodefs.writeFileSync(real('x'), 'a');
    same(
      () => openSync(harness.request, '/x', 'wx'),
      () => nodefs.openSync(real('x'), 'wx')
    );
  });

  it('ftruncate shortens the file identically', () => {
    same(
      () => {
        writeFileSync(harness.request, '/ft', 'abcdef');
        const fd = openSync(harness.request, '/ft', 'r+');
        ftruncateSync(harness.request, fd, 2);
        closeSync(harness.request, fd);
        return text(readFileSync(harness.request, '/ft', 'utf8'));
      },
      () => {
        nodefs.writeFileSync(real('ft'), 'abcdef');
        const fd = nodefs.openSync(real('ft'), 'r+');
        nodefs.ftruncateSync(fd, 2);
        nodefs.closeSync(fd);
        return nodefs.readFileSync(real('ft'), 'utf8');
      }
    );
  });

  it('operating on a closed fd gives the same error code', () => {
    same(
      () => {
        const fd = openSync(harness.request, '/c', 'w');
        closeSync(harness.request, fd);
        return readSync(harness.request, fd, new Uint8Array(4), 0, 4, 0);
      },
      () => {
        const fd = nodefs.openSync(real('c'), 'w');
        nodefs.closeSync(fd);
        return nodefs.readSync(fd, Buffer.alloc(4), 0, 4, 0);
      }
    );
  });
});

describe('parity: payload layouts (regression guards)', () => {
  // Each of these encodes through the real method layer and decodes through the real shared
  // dispatch. A layout disagreement between the two shows up here as wrong data, which is how
  // the uint32/float64 truncate bug went unnoticed: the old tests encoded and decoded
  // themselves, so they agreed with each other and not with the shipped worker.

  it('truncate honours the requested length instead of emptying the file', () => {
    writeFileSync(harness.request, '/t', 'abcdef');
    truncateSync(harness.request, '/t', 4);
    // Regression: the length was decoded as uint32 from a float64 field, whose low four bytes
    // are zero for every small integer — so this used to produce ''.
    expect(text(readFileSync(harness.request, '/t', 'utf8'))).toBe('abcd');
  });

  it('ftruncate honours the requested length', () => {
    writeFileSync(harness.request, '/ft', 'abcdef');
    const fd = openSync(harness.request, '/ft', 'r+');
    ftruncateSync(harness.request, fd, 4);
    closeSync(harness.request, fd);
    expect(text(readFileSync(harness.request, '/ft', 'utf8'))).toBe('abcd');
  });

  // The 4GB case proves a length above 2^32 survives the payload encoding rather than being
  // silently cut to 32 bits. It used to cost about a second and 4GB of resident memory — growing
  // a file wrote its extension out as zeros — and tripped the 5s default once, under load, during
  // a release. It is ~35ms now that the engine skips the part of an extension the volume's own
  // growth already zeroed, so it needs no special timeout; see vfs-engine's "truncate that grows
  // a file", which guards that directly.
  it.each([0, 1, 3, 1024, 4096, 0xffffffff + 1])('truncates to length %d exactly', (len) => {
    writeFileSync(harness.request, '/big', 'x'.repeat(16));
    truncateSync(harness.request, '/big', len);
    expect((statSync(harness.request, '/big') as nodefs.Stats).size).toBe(len);
  });

  it('every opcode the method layer can emit has a decoder', () => {
    // Guards the failure mode this whole file exists for: an op added to the protocol without a
    // matching case falls through to EINVAL, which is easy to miss until something breaks.
    const known = new Set(Object.values(OP));
    for (const op of known) {
      expect(DISPATCHED_OPS.has(op as number), `OP ${op} has no dispatch case`).toBe(true);
    }
  });
});

describe('parity: append growth (block-boundary regression)', () => {
  // `append` now writes in place when the file's existing 4 KB block run has room, instead of
  // relocating and copying the whole file every time. These pin the boundary behaviour that
  // fast path could plausibly get wrong.

  it('many small appends build the same file as Node', () => {
    same(
      () => {
        for (let i = 0; i < 500; i++) appendFileSync(harness.request, '/log', `line ${i}\n`);
        return text(readFileSync(harness.request, '/log', 'utf8'));
      },
      () => {
        for (let i = 0; i < 500; i++) nodefs.appendFileSync(real('log'), `line ${i}\n`);
        return nodefs.readFileSync(real('log'), 'utf8');
      }
    );
  });

  it('appends spanning a block boundary keep every byte', () => {
    // 4 KB blocks: start just under one, then cross it, then cross several at once.
    same(
      () => {
        writeFileSync(harness.request, '/b', 'a'.repeat(4090));
        appendFileSync(harness.request, '/b', 'b'.repeat(12));      // crosses 4096
        appendFileSync(harness.request, '/b', 'c'.repeat(9000));    // crosses several
        appendFileSync(harness.request, '/b', 'd');                 // back to in-place
        const out = text(readFileSync(harness.request, '/b', 'utf8'));
        return [out.length, out.slice(4085, 4105), out.slice(-1)];
      },
      () => {
        nodefs.writeFileSync(real('b'), 'a'.repeat(4090));
        nodefs.appendFileSync(real('b'), 'b'.repeat(12));
        nodefs.appendFileSync(real('b'), 'c'.repeat(9000));
        nodefs.appendFileSync(real('b'), 'd');
        const out = nodefs.readFileSync(real('b'), 'utf8');
        return [out.length, out.slice(4085, 4105), out.slice(-1)];
      }
    );
  });

  it('appending after a shrink does not resurrect the discarded bytes', () => {
    // The in-place path writes at `size`, inside a run that still holds the old tail. If it
    // used the run's capacity instead of the logical size, that stale data would reappear.
    same(
      () => {
        writeFileSync(harness.request, '/s', 'x'.repeat(3000));
        truncateSync(harness.request, '/s', 10);
        appendFileSync(harness.request, '/s', 'END');
        return text(readFileSync(harness.request, '/s', 'utf8'));
      },
      () => {
        nodefs.writeFileSync(real('s'), 'x'.repeat(3000));
        nodefs.truncateSync(real('s'), 10);
        nodefs.appendFileSync(real('s'), 'END');
        return nodefs.readFileSync(real('s'), 'utf8');
      }
    );
  });

  it('appending to an empty and to a missing file both work', () => {
    same(
      () => {
        writeFileSync(harness.request, '/empty', '');
        appendFileSync(harness.request, '/empty', 'first');
        appendFileSync(harness.request, '/fresh', 'new');
        return [text(readFileSync(harness.request, '/empty', 'utf8')), text(readFileSync(harness.request, '/fresh', 'utf8'))];
      },
      () => {
        nodefs.writeFileSync(real('empty'), '');
        nodefs.appendFileSync(real('empty'), 'first');
        nodefs.appendFileSync(real('fresh'), 'new');
        return [nodefs.readFileSync(real('empty'), 'utf8'), nodefs.readFileSync(real('fresh'), 'utf8')];
      }
    );
  });

  it('size and content stay consistent across a remount', () => {
    // In-place appends mutate the inode without relocating; make sure the inode that lands on
    // disk still describes the data.
    for (let i = 0; i < 50; i++) appendFileSync(harness.request, '/p', 'chunk');
    const before = text(readFileSync(harness.request, '/p', 'utf8'));
    expect((statSync(harness.request, '/p') as nodefs.Stats).size).toBe(before.length);
    expect(before).toBe('chunk'.repeat(50));
  });
});

describe('parity: rm, link, access, realpath, utimes, glob', () => {
  it('rm recursive removes a whole tree', () => {
    same(
      () => {
        mkdirSync(harness.request, '/t/a/b', { recursive: true });
        writeFileSync(harness.request, '/t/f', 'x');
        writeFileSync(harness.request, '/t/a/g', 'y');
        vfsRmSync(harness.request, '/t', { recursive: true });
        return existsSync(harness.request, '/t');
      },
      () => {
        nodefs.mkdirSync(real('t/a/b'), { recursive: true });
        nodefs.writeFileSync(real('t/f'), 'x');
        nodefs.writeFileSync(real('t/a/g'), 'y');
        nodefs.rmSync(real('t'), { recursive: true });
        return nodefs.existsSync(real('t'));
      }
    );
  });

  it('rm on a directory without recursive gives the same error code', () => {
    mkdirSync(harness.request, '/d');
    nodefs.mkdirSync(real('d'));
    same(
      () => vfsRmSync(harness.request, '/d'),
      () => nodefs.rmSync(real('d'))
    );
  });

  it('rm on a missing path errors, and force silences it for both', () => {
    same(() => vfsRmSync(harness.request, '/gone'), () => nodefs.rmSync(real('gone')));
    same(() => vfsRmSync(harness.request, '/gone', { force: true }), () => nodefs.rmSync(real('gone'), { force: true }));
  });

  it('hard links share content and nlink', () => {
    same(
      () => {
        writeFileSync(harness.request, '/a', 'shared');
        linkSync(harness.request, '/a', '/b');
        const s = statSync(harness.request, '/b') as nodefs.Stats;
        return [text(readFileSync(harness.request, '/b', 'utf8')), s.nlink];
      },
      () => {
        nodefs.writeFileSync(real('a'), 'shared');
        nodefs.linkSync(real('a'), real('b'));
        const s = nodefs.statSync(real('b'));
        return [nodefs.readFileSync(real('b'), 'utf8'), s.nlink];
      }
    );
  });

  it('unlinking one hard link leaves the other readable', () => {
    same(
      () => {
        writeFileSync(harness.request, '/a', 'keep');
        linkSync(harness.request, '/a', '/b');
        unlinkSync(harness.request, '/a');
        return [existsSync(harness.request, '/a'), text(readFileSync(harness.request, '/b', 'utf8'))];
      },
      () => {
        nodefs.writeFileSync(real('a'), 'keep');
        nodefs.linkSync(real('a'), real('b'));
        nodefs.unlinkSync(real('a'));
        return [nodefs.existsSync(real('a')), nodefs.readFileSync(real('b'), 'utf8')];
      }
    );
  });

  it('link onto an existing path gives the same error code', () => {
    writeFileSync(harness.request, '/a', 'x');
    writeFileSync(harness.request, '/b', 'y');
    nodefs.writeFileSync(real('a'), 'x');
    nodefs.writeFileSync(real('b'), 'y');
    same(() => linkSync(harness.request, '/a', '/b'), () => nodefs.linkSync(real('a'), real('b')));
  });

  it('access agrees on existence checks', () => {
    writeFileSync(harness.request, '/f', 'x');
    nodefs.writeFileSync(real('f'), 'x');
    same(() => accessSync(harness.request, '/f'), () => nodefs.accessSync(real('f')));
    same(() => accessSync(harness.request, '/gone'), () => nodefs.accessSync(real('gone')));
  });

  it('realpath resolves a symlink chain to the same relative target', () => {
    same(
      () => {
        mkdirSync(harness.request, '/real');
        writeFileSync(harness.request, '/real/f', 'x');
        symlinkSync(harness.request, '/real', '/link');
        return realpathSync(harness.request, '/link/f');
      },
      () => {
        nodefs.mkdirSync(real('real'));
        nodefs.writeFileSync(real('real/f'), 'x');
        nodefs.symlinkSync(real('real'), real('link'));
        return nodefs.realpathSync(real('link/f')).slice(nodefs.realpathSync(root).length);
      }
    );
  });

  it('realpath of a missing path gives the same error code', () => {
    same(() => realpathSync(harness.request, '/nope'), () => nodefs.realpathSync(real('nope')));
  });

  it('utimes takes seconds, like Node', () => {
    // This test used to divide by 1000 for the Node side, which hid a real 1000× divergence:
    // we read a bare number as milliseconds where Node reads it as seconds, so
    // `utimesSync(p, 1600000000)` stamped 1970 instead of 2020. Both sides now pass the same
    // value, which is the whole point.
    const atime = 1_600_000_000;
    const mtime = 1_600_000_123;
    same(
      () => {
        writeFileSync(harness.request, '/u', 'x');
        utimesSync(harness.request, '/u', atime, mtime);
        const s = statSync(harness.request, '/u') as nodefs.Stats;
        return [s.atimeMs, s.mtimeMs];
      },
      () => {
        nodefs.writeFileSync(real('u'), 'x');
        nodefs.utimesSync(real('u'), atime, mtime);
        const s = nodefs.statSync(real('u'));
        return [s.atimeMs, s.mtimeMs];
      }
    );
  });

  it('utimes accepts Dates and numeric strings, and rejects what Node rejects', () => {
    writeFileSync(harness.request, '/u', 'x');
    nodefs.writeFileSync(real('u'), 'x');
    same(
      () => { utimesSync(harness.request, '/u', new Date(1e12), new Date(1e12)); return (statSync(harness.request, '/u') as nodefs.Stats).mtimeMs; },
      () => { nodefs.utimesSync(real('u'), new Date(1e12), new Date(1e12)); return nodefs.statSync(real('u')).mtimeMs; }
    );
    same(
      () => { utimesSync(harness.request, '/u', '1600000000' as never, '1600000000' as never); return (statSync(harness.request, '/u') as nodefs.Stats).mtimeMs; },
      () => { nodefs.utimesSync(real('u'), '1600000000' as never, '1600000000' as never); return nodefs.statSync(real('u')).mtimeMs; }
    );
    for (const bad of [NaN, Infinity, 'abc']) {
      expect(() => utimesSync(harness.request, '/u', bad as never, bad as never), String(bad))
        .toThrow(expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' }));
    }
  });

  it('mkdtemp creates a unique directory from the prefix', () => {
    const oursPath = vfsMkdtempSync(harness.request, '/tmp-');
    const theirsPath = nodefs.mkdtempSync(join(root, 'tmp-'));
    // Same shape: prefix preserved, six random characters appended, and it is a real directory.
    expect(oursPath.startsWith('/tmp-')).toBe(true);
    expect(oursPath.length).toBe('/tmp-'.length + 6);
    expect(theirsPath.slice(root.length + 1).length).toBe('tmp-'.length + 6);
    expect((statSync(harness.request, oursPath) as nodefs.Stats).isDirectory()).toBe(true);
    expect(nodefs.statSync(theirsPath).isDirectory()).toBe(true);
    // Two calls never collide.
    expect(vfsMkdtempSync(harness.request, '/tmp-')).not.toBe(oursPath);
  });

  it('glob matches the same files', () => {
    same(
      () => {
        mkdirSync(harness.request, '/g/sub', { recursive: true });
        writeFileSync(harness.request, '/g/a.ts', '');
        writeFileSync(harness.request, '/g/b.js', '');
        writeFileSync(harness.request, '/g/sub/c.ts', '');
        return (vfsGlobSync(harness.request, '/g/**/*.ts') as string[]).slice().sort();
      },
      () => {
        nodefs.mkdirSync(real('g/sub'), { recursive: true });
        nodefs.writeFileSync(real('g/a.ts'), '');
        nodefs.writeFileSync(real('g/b.js'), '');
        nodefs.writeFileSync(real('g/sub/c.ts'), '');
        return nodefs.globSync(real('g/**/*.ts')).map((p) => p.slice(root.length)).sort();
      }
    );
  });

  it('readdir withFileTypes reports the same kinds', () => {
    same(
      () => {
        mkdirSync(harness.request, '/wt/sub', { recursive: true });
        writeFileSync(harness.request, '/wt/f.txt', '');
        return (readdirSync(harness.request, '/wt', { withFileTypes: true }) as nodefs.Dirent[])
          .map((d) => [d.name, d.isDirectory(), d.isFile()])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      },
      () => {
        nodefs.mkdirSync(real('wt/sub'), { recursive: true });
        nodefs.writeFileSync(real('wt/f.txt'), '');
        return nodefs.readdirSync(real('wt'), { withFileTypes: true })
          .map((d) => [d.name, d.isDirectory(), d.isFile()])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      }
    );
  });
});

describe('parity: readdir encoding (fast-path regression)', () => {
  // The names-only path writes UTF-8 straight into an over-allocated buffer via encodeInto and
  // trims it, instead of building one Uint8Array per name. These pin what that could get wrong:
  // the capacity bound for multi-byte names, the sort order, and the empty case.

  it('multi-byte names survive the sized-by-estimate buffer', () => {
    const names = ['plain.txt', 'héllo.txt', '世界.txt', '😀-emoji.txt', 'ünïcödé', 'а-cyrillic'];
    same(
      () => {
        mkdirSync(harness.request, '/u');
        for (const n of names) writeFileSync(harness.request, `/u/${n}`, '');
        return (readdirSync(harness.request, '/u') as string[]).slice().sort();
      },
      () => {
        nodefs.mkdirSync(real('u'));
        for (const n of names) nodefs.writeFileSync(real(`u/${n}`), '');
        return nodefs.readdirSync(real('u')).slice().sort();
      }
    );
  });

  it('an empty directory lists as empty, not as an error', () => {
    same(
      () => { mkdirSync(harness.request, '/e'); return readdirSync(harness.request, '/e') as string[]; },
      () => { nodefs.mkdirSync(real('e')); return nodefs.readdirSync(real('e')); }
    );
  });

  it('names-only and withFileTypes list exactly the same entries', () => {
    mkdirSync(harness.request, '/m/sub', { recursive: true });
    writeFileSync(harness.request, '/m/f.txt', '');
    writeFileSync(harness.request, '/m/héllo', '');
    const plain = (readdirSync(harness.request, '/m') as string[]).slice().sort();
    const typed = (readdirSync(harness.request, '/m', { withFileTypes: true }) as nodefs.Dirent[])
      .map((d) => d.name).sort();
    expect(plain).toEqual(typed);
  });

  it('a long multi-byte name is not truncated by the capacity estimate', () => {
    // 120 UTF-16 units → 240 UTF-8 bytes, just under the 255-byte per-component limit real
    // filesystems enforce. (We do not enforce that limit — see the known divergence in the
    // readme; Node answers ENAMETOOLONG above it and we accept the name.)
    const long = 'ä'.repeat(120);
    same(
      () => { mkdirSync(harness.request, '/l'); writeFileSync(harness.request, `/l/${long}`, ''); return readdirSync(harness.request, '/l') as string[]; },
      () => { nodefs.mkdirSync(real('l')); nodefs.writeFileSync(real(`l/${long}`), ''); return nodefs.readdirSync(real('l')); }
    );
  });

  it('entries come back in the same order for a large directory', () => {
    same(
      () => {
        mkdirSync(harness.request, '/big');
        for (let i = 0; i < 150; i++) writeFileSync(harness.request, `/big/f${i}`, '');
        return (readdirSync(harness.request, '/big') as string[]).slice().sort();
      },
      () => {
        nodefs.mkdirSync(real('big'));
        for (let i = 0; i < 150; i++) nodefs.writeFileSync(real(`big/f${i}`), '');
        return nodefs.readdirSync(real('big')).slice().sort();
      }
    );
  });
});

describe('parity: realpath and mkdtemp encoding options', () => {
  // Both methods gained the `options` argument Node documents but they were missing entirely —
  // the three-argument callback form threw "cb must be of type function". These check the
  // option actually does something, not merely that it is accepted.

  it('realpath returns bytes for encoding "buffer", like Node', () => {
    same(
      () => {
        mkdirSync(harness.request, '/r');
        writeFileSync(harness.request, '/r/f', 'x');
        const buf = realpathSync(harness.request, '/r/f', 'buffer') as Uint8Array;
        return [buf instanceof Uint8Array, new TextDecoder().decode(buf)];
      },
      () => {
        nodefs.mkdirSync(real('r'));
        nodefs.writeFileSync(real('r/f'), 'x');
        const buf = nodefs.realpathSync(real('r/f'), 'buffer');
        return [buf instanceof Uint8Array, buf.toString().slice(nodefs.realpathSync(root).length)];
      }
    );
  });

  it('realpath returns a string by default and for utf8', () => {
    mkdirSync(harness.request, '/r');
    writeFileSync(harness.request, '/r/f', 'x');
    expect(typeof realpathSync(harness.request, '/r/f')).toBe('string');
    expect(typeof realpathSync(harness.request, '/r/f', 'utf8')).toBe('string');
    expect(realpathSync(harness.request, '/r/f', { encoding: 'utf8' })).toBe(realpathSync(harness.request, '/r/f'));
  });

  it('realpath rejects an unknown encoding rather than ignoring it', () => {
    writeFileSync(harness.request, '/f', 'x');
    expect(() => realpathSync(harness.request, '/f', 'utf9')).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_VALUE' })
    );
  });

  it('mkdtemp returns bytes for encoding "buffer", like Node', () => {
    const ours = vfsMkdtempSync(harness.request, '/t-', 'buffer') as Uint8Array;
    const theirs = nodefs.mkdtempSync(join(root, 't-'), 'buffer');
    expect(ours).toBeInstanceOf(Uint8Array);
    expect(theirs).toBeInstanceOf(Uint8Array);
    // Same shape: the prefix plus six random characters.
    expect(new TextDecoder().decode(ours)).toMatch(/^\/t-.{6}$/);
  });

  it('mkdtemp returns a string by default', () => {
    expect(typeof vfsMkdtempSync(harness.request, '/t-')).toBe('string');
  });
});

describe('parity: symlink loops report ELOOP', () => {
  // Path resolution returns "not found" for both a missing path and a symlink chain that went
  // in circles, so every caller reported ENOENT where Node reports ELOOP — a caller cannot tell
  // a broken link from an absent file. The resolvers now record *why* they gave up.
  // Found by the differential fuzzer generating a self-referential symlink.

  it('a self-referential symlink reports ELOOP, not ENOENT', () => {
    same(
      () => { symlinkSync(harness.request, 'a', '/a'); return statSync(harness.request, '/a'); },
      () => { nodefs.symlinkSync('a', real('a')); return nodefs.statSync(real('a')); }
    );
  });

  it('readFile and truncate through a self-loop give the same code', () => {
    symlinkSync(harness.request, 'a', '/a');
    nodefs.symlinkSync('a', real('a'));
    same(() => readFileSync(harness.request, '/a', 'utf8'), () => nodefs.readFileSync(real('a'), 'utf8'));
    same(() => truncateSync(harness.request, '/a', 0), () => nodefs.truncateSync(real('a'), 0));
    same(() => chmodSync(harness.request, '/a', 0o644), () => nodefs.chmodSync(real('a'), 0o644));
  });

  it('a mutual loop reports ELOOP too', () => {
    same(
      () => {
        symlinkSync(harness.request, 'q', '/p');
        symlinkSync(harness.request, 'p', '/q');
        return statSync(harness.request, '/p');
      },
      () => {
        nodefs.symlinkSync('q', real('p'));
        nodefs.symlinkSync('p', real('q'));
        return nodefs.statSync(real('p'));
      }
    );
  });

  it('lstat still describes the link itself rather than following it', () => {
    same(
      () => { symlinkSync(harness.request, 'a', '/a'); return (lstatSync(harness.request, '/a') as nodefs.Stats).isSymbolicLink(); },
      () => { nodefs.symlinkSync('a', real('a')); return nodefs.lstatSync(real('a')).isSymbolicLink(); }
    );
  });

  it('a plain missing path still reports ENOENT, not ELOOP', () => {
    // The flag must not leak from an earlier resolve into an unrelated lookup.
    symlinkSync(harness.request, 'a', '/a');
    nodefs.symlinkSync('a', real('a'));
    same(() => statSync(harness.request, '/a'), () => nodefs.statSync(real('a')));
    same(() => statSync(harness.request, '/definitely-missing'), () => nodefs.statSync(real('definitely-missing')));
  });
});

describe('parity: copy preserves permissions', () => {
  // The destination is created by the write path, which applies the default file mode, so a
  // 0600 source produced a 0644 copy. copyFile(2) and Node both give the copy the source's
  // permissions. Found by the differential fuzzer as a one-entry difference in the final tree.

  it('copyFile carries the source mode over', () => {
    same(
      () => { writeFileSync(harness.request, '/a', 'x'); chmodSync(harness.request, '/a', 0o600);
              copyFileSync(harness.request, '/a', '/b'); return statSync(harness.request, '/b').mode & 0o777; },
      () => { nodefs.writeFileSync(real('a'), 'x'); nodefs.chmodSync(real('a'), 0o600);
              nodefs.copyFileSync(real('a'), real('b')); return nodefs.statSync(real('b')).mode & 0o777; }
    );
  });

  it('an empty source keeps its mode too', () => {
    same(
      () => { writeFileSync(harness.request, '/e', ''); chmodSync(harness.request, '/e', 0o640);
              copyFileSync(harness.request, '/e', '/f'); return statSync(harness.request, '/f').mode & 0o777; },
      () => { nodefs.writeFileSync(real('e'), ''); nodefs.chmodSync(real('e'), 0o640);
              nodefs.copyFileSync(real('e'), real('f')); return nodefs.statSync(real('f')).mode & 0o777; }
    );
  });

  it('overwriting an existing destination adopts the source mode', () => {
    same(
      () => { writeFileSync(harness.request, '/a', 'x'); chmodSync(harness.request, '/a', 0o600);
              writeFileSync(harness.request, '/b', 'yyyy'); chmodSync(harness.request, '/b', 0o755);
              copyFileSync(harness.request, '/a', '/b');
              return [statSync(harness.request, '/b').mode & 0o777, text(readFileSync(harness.request, '/b', 'utf8'))]; },
      () => { nodefs.writeFileSync(real('a'), 'x'); nodefs.chmodSync(real('a'), 0o600);
              nodefs.writeFileSync(real('b'), 'yyyy'); nodefs.chmodSync(real('b'), 0o755);
              nodefs.copyFileSync(real('a'), real('b'));
              return [nodefs.statSync(real('b')).mode & 0o777, nodefs.readFileSync(real('b'), 'utf8')]; }
    );
  });

  it('cp -r preserves each file’s mode through the tree', () => {
    same(
      () => { mkdirSync(harness.request, '/d'); writeFileSync(harness.request, '/d/f', 'x');
              chmodSync(harness.request, '/d/f', 0o600); return 'set'; },
      () => { nodefs.mkdirSync(real('d')); nodefs.writeFileSync(real('d/f'), 'x');
              nodefs.chmodSync(real('d/f'), 0o600); return 'set'; }
    );
    // cp is instance-level; drive it through the harness filesystem.
    const { fs: instanceFs } = createFsHarnessForCp();
    instanceFs.mkdirSync('/d');
    instanceFs.writeFileSync('/d/f', 'x');
    instanceFs.chmodSync('/d/f', 0o600);
    instanceFs.cpSync('/d', '/e', { recursive: true });
    nodefs.cpSync(real('d'), real('e'), { recursive: true });
    expect(instanceFs.statSync('/e/f').mode & 0o777).toBe(nodefs.statSync(real('e/f')).mode & 0o777);
  });
});

describe('parity: writing through a symlink', () => {
  // Resolution gives up when a link's target does not exist, and the create path then wrote at
  // the literal path — destroying the link instead of creating its target. Node follows the link
  // and creates the target, leaving the link intact. Found by the differential fuzzer.

  it('writeFile through a dangling link creates the target and keeps the link', () => {
    same(
      () => {
        symlinkSync(harness.request, 't3', '/l');
        writeFileSync(harness.request, '/l', 'Y');
        return [
          [...(readdirSync(harness.request, '/') as string[])].sort(),
          (lstatSync(harness.request, '/l') as nodefs.Stats).isSymbolicLink(),
          text(readFileSync(harness.request, '/t3', 'utf8')),
        ];
      },
      () => {
        nodefs.symlinkSync('t3', real('l'));
        nodefs.writeFileSync(real('l'), 'Y');
        return [
          nodefs.readdirSync(root).sort(),
          nodefs.lstatSync(real('l')).isSymbolicLink(),
          nodefs.readFileSync(real('t3'), 'utf8'),
        ];
      }
    );
  });

  it('appendFile through a dangling link appends to the target', () => {
    same(
      () => { symlinkSync(harness.request, 't', '/l'); appendFileSync(harness.request, '/l', 'A');
              appendFileSync(harness.request, '/l', 'B'); return text(readFileSync(harness.request, '/t', 'utf8')); },
      () => { nodefs.symlinkSync('t', real('l')); nodefs.appendFileSync(real('l'), 'A');
              nodefs.appendFileSync(real('l'), 'B'); return nodefs.readFileSync(real('t'), 'utf8'); }
    );
  });

  it('open with O_CREAT through a dangling link creates the target', () => {
    same(
      () => {
        symlinkSync(harness.request, 'tgt', '/l');
        closeSync(harness.request, openSync(harness.request, '/l', 'w'));
        return [[...(readdirSync(harness.request, '/') as string[])].sort(),
                (lstatSync(harness.request, '/l') as nodefs.Stats).isSymbolicLink()];
      },
      () => {
        nodefs.symlinkSync('tgt', real('l'));
        nodefs.closeSync(nodefs.openSync(real('l'), 'w'));
        return [nodefs.readdirSync(root).sort(), nodefs.lstatSync(real('l')).isSymbolicLink()];
      }
    );
  });

  it('writing through a link whose target exists still updates the target', () => {
    same(
      () => { writeFileSync(harness.request, '/t', 'old'); symlinkSync(harness.request, 't', '/l');
              writeFileSync(harness.request, '/l', 'new'); return text(readFileSync(harness.request, '/t', 'utf8')); },
      () => { nodefs.writeFileSync(real('t'), 'old'); nodefs.symlinkSync('t', real('l'));
              nodefs.writeFileSync(real('l'), 'new'); return nodefs.readFileSync(real('t'), 'utf8'); }
    );
  });

  it('writing through a cyclic link reports ELOOP rather than writing somewhere', () => {
    // The walk must not simply stop after MAX_SYMLINK_DEPTH and create a file wherever it
    // happened to land — that is what it did before, silently.
    same(
      () => { symlinkSync(harness.request, 'a', '/a'); return writeFileSync(harness.request, '/a', 'x'); },
      () => { nodefs.symlinkSync('a', real('a')); return nodefs.writeFileSync(real('a'), 'x'); }
    );
  });
});

describe('parity: file-descriptor access modes are enforced', () => {
  // Open flags carry an access mode in their low two bits (O_RDONLY/O_WRONLY/O_RDWR). It was not
  // checked: reading through a descriptor opened 'w' returned 0 bytes instead of EBADF, and
  // writing through one opened 'r' succeeded. Code that relies on the error to notice a
  // mis-opened file got silence. Found by the fd differential fuzzer.

  const withFd = <T>(flags: string, ours: (fd: number) => T, theirs: (fd: number) => T) => {
    writeFileSync(harness.request, '/f', 'contents!!');
    nodefs.writeFileSync(real('f'), 'contents!!');
    const a = openSync(harness.request, '/f', flags);
    const b = nodefs.openSync(real('f'), flags);
    try {
      same(() => ours(a), () => theirs(b), `flags=${flags}`);
    } finally {
      closeSync(harness.request, a);
      nodefs.closeSync(b);
    }
  };

  it.each(['r', 'r+', 'w', 'w+', 'a', 'a+'])('read through %s matches Node', (flags) => {
    withFd(flags,
      (fd) => readSync(harness.request, fd, new Uint8Array(4), 0, 4, 0),
      (fd) => nodefs.readSync(fd, Buffer.alloc(4), 0, 4, 0));
  });

  it.each(['r', 'r+', 'w', 'w+', 'a', 'a+'])('write through %s matches Node', (flags) => {
    withFd(flags,
      (fd) => writeSyncFd(harness.request, fd, new TextEncoder().encode('X'), 0, 1, 0),
      (fd) => nodefs.writeSync(fd, Buffer.from('X'), 0, 1, 0));
  });

  it.each(['r', 'r+', 'w', 'w+', 'a', 'a+'])('ftruncate through %s matches Node', (flags) => {
    // Read-only gives EINVAL here, not the EBADF a read or write gets.
    withFd(flags,
      (fd) => ftruncateSync(harness.request, fd, 3),
      (fd) => nodefs.ftruncateSync(fd, 3));
  });

  it('a write-only descriptor reports EBADF rather than silently reading nothing', () => {
    writeFileSync(harness.request, '/f', 'abc');
    const fd = openSync(harness.request, '/f', 'a');
    try {
      expect(() => readSync(harness.request, fd, new Uint8Array(4), 0, 4, 0))
        .toThrow(expect.objectContaining({ code: 'EBADF' }));
    } finally {
      closeSync(harness.request, fd);
    }
  });
});

describe('parity: ELOOP across every operation that follows symlinks', () => {
  // 3.3.16 taught stat/read/truncate/chmod to distinguish a symlink cycle from a missing path.
  // The async fuzzer then caught `access` still reporting ENOENT, so this pins the whole set —
  // including the three operations that act on the *link itself* and must NOT report ELOOP.
  // Every expectation was captured from real node:fs.

  const cycle = () => {
    symlinkSync(harness.request, 'cyc', '/cyc');
    nodefs.symlinkSync('cyc', real('cyc'));
  };

  it('access reports ELOOP', () => {
    cycle();
    same(() => accessSync(harness.request, '/cyc'), () => nodefs.accessSync(real('cyc')));
  });

  it('realpath reports ELOOP', () => {
    cycle();
    same(() => realpathSync(harness.request, '/cyc'), () => nodefs.realpathSync(real('cyc')));
  });

  it('copyFile reports ELOOP for a cyclic source', () => {
    cycle();
    same(() => copyFileSync(harness.request, '/cyc', '/dst'), () => nodefs.copyFileSync(real('cyc'), real('dst')));
  });

  it('link reports ELOOP for a cyclic source', () => {
    cycle();
    same(() => linkSync(harness.request, '/cyc', '/n'), () => nodefs.linkSync(real('cyc'), real('n')));
  });

  it('unlink, rename and readlink act on the link itself and succeed', () => {
    // These must not follow, so a cycle is irrelevant to them — removing a broken link has to
    // keep working, or a cycle would be impossible to clean up.
    cycle();
    same(() => readlinkSync(harness.request, '/cyc'), () => nodefs.readlinkSync(real('cyc')));
    same(() => renameSync(harness.request, '/cyc', '/moved'), () => nodefs.renameSync(real('cyc'), real('moved')));
    same(() => unlinkSync(harness.request, '/moved'), () => nodefs.unlinkSync(real('moved')));
    same(() => existsSync(harness.request, '/moved'), () => nodefs.existsSync(real('moved')));
  });
});

describe('parity: stat options and errno details', () => {
  // Found by sweeping option-level behaviour against node:fs — none of these had coverage.

  it('throwIfNoEntry:false yields undefined for a missing path', () => {
    same(
      () => statSync(harness.request, '/nope', { throwIfNoEntry: false }),
      () => nodefs.statSync(real('nope'), { throwIfNoEntry: false })
    );
    same(
      () => lstatSync(harness.request, '/nope', { throwIfNoEntry: false }),
      () => nodefs.lstatSync(real('nope'), { throwIfNoEntry: false })
    );
  });

  it('throwIfNoEntry:false still returns real stats when the path exists', () => {
    same(
      () => { writeFileSync(harness.request, '/f', 'abc'); return (statSync(harness.request, '/f', { throwIfNoEntry: false }) as nodefs.Stats).size; },
      () => { nodefs.writeFileSync(real('f'), 'abc'); return nodefs.statSync(real('f'), { throwIfNoEntry: false })!.size; }
    );
  });

  it('throwIfNoEntry:true and the default both throw', () => {
    same(() => statSync(harness.request, '/nope', { throwIfNoEntry: true }), () => nodefs.statSync(real('nope'), { throwIfNoEntry: true }));
    same(() => statSync(harness.request, '/nope'), () => nodefs.statSync(real('nope')));
  });

  it('throwIfNoEntry:false does not mask a non-ENOENT failure', () => {
    // Only "not there" is suppressed. A symlink cycle is a different problem and must still
    // throw, or the option would turn every failure into "the file does not exist".
    symlinkSync(harness.request, 'cyc', '/cyc');
    nodefs.symlinkSync('cyc', real('cyc'));
    same(
      () => statSync(harness.request, '/cyc', { throwIfNoEntry: false }),
      () => nodefs.statSync(real('cyc'), { throwIfNoEntry: false })
    );
  });

  it('statfs on a missing path reports ENOENT rather than describing the volume', () => {
    same(
      () => (statfsSync(harness.request, '/nope') as nodefs.StatsFs).bsize,
      () => nodefs.statfsSync(real('nope')).bsize
    );
  });

  it('copyFile of a directory reports ENOTSUP', () => {
    mkdirSync(harness.request, '/d');
    nodefs.mkdirSync(real('d'));
    same(
      () => copyFileSync(harness.request, '/d', '/x'),
      () => nodefs.copyFileSync(real('d'), real('x'))
    );
  });
});

describe('parity: clearing the volume root', () => {
  // `rm('/', { recursive: true })` is the ordinary way to empty a volume, and it used to delete
  // the root inode along with the children: `getAllDescendants('/')` used the prefix '/', which
  // every path starts with — including '/' itself. Afterwards `stat('/')` and `readdir('/')`
  // both answered ENOENT, leaving a filesystem with no root. Found while wiring statfs to check
  // its path argument, which is what finally made the broken state visible.

  it('removing everything leaves an empty, usable root', () => {
    mkdirSync(harness.request, '/d/nested', { recursive: true });
    writeFileSync(harness.request, '/a', 'x');
    writeFileSync(harness.request, '/d/nested/b', 'y');

    vfsRmSync(harness.request, '/', { recursive: true, force: true });

    expect((statSync(harness.request, '/') as nodefs.Stats).isDirectory(), 'root must survive').toBe(true);
    expect([...(readdirSync(harness.request, '/') as string[])], 'root must be empty').toEqual([]);
    expect(existsSync(harness.request, '/a')).toBe(false);
    expect(existsSync(harness.request, '/d')).toBe(false);
  });

  it('the volume is fully usable afterwards', () => {
    writeFileSync(harness.request, '/old', 'x');
    vfsRmSync(harness.request, '/', { recursive: true, force: true });
    writeFileSync(harness.request, '/fresh', 'z');
    mkdirSync(harness.request, '/dir');
    expect([...(readdirSync(harness.request, '/') as string[])].sort()).toEqual(['dir', 'fresh']);
    expect(text(readFileSync(harness.request, '/fresh', 'utf8'))).toBe('z');
  });

  it('a nested recursive remove still removes the directory itself', () => {
    // The root is the exception; everything else must still disappear.
    same(
      () => {
        mkdirSync(harness.request, '/keep/gone', { recursive: true });
        writeFileSync(harness.request, '/keep/gone/f', 'x');
        vfsRmSync(harness.request, '/keep/gone', { recursive: true });
        return [existsSync(harness.request, '/keep/gone'), existsSync(harness.request, '/keep')];
      },
      () => {
        nodefs.mkdirSync(real('keep/gone'), { recursive: true });
        nodefs.writeFileSync(real('keep/gone/f'), 'x');
        nodefs.rmSync(real('keep/gone'), { recursive: true });
        return [nodefs.existsSync(real('keep/gone')), nodefs.existsSync(real('keep'))];
      }
    );
  });
});

describe('parity: readdir recursive Dirent shape and open flags', () => {
  it('recursive withFileTypes reports basenames with the containing directory', () => {
    // Ours put the relative path in `name` and an unrelated value in `parentPath`, so an entry
    // could not be joined back into a usable location. Only the names-only recursive form uses
    // relative paths — this asserts both, since the difference between them is the bug.
    same(
      () => {
        mkdirSync(harness.request, '/d/sub/deep', { recursive: true });
        writeFileSync(harness.request, '/d/top', '1');
        writeFileSync(harness.request, '/d/sub/x', '1');
        writeFileSync(harness.request, '/d/sub/deep/y', '1');
        return (readdirSync(harness.request, '/d', { recursive: true, withFileTypes: true }) as nodefs.Dirent[])
          .map((e) => `${e.parentPath.replace('/d', '<d>')}/${e.name}${e.isDirectory() ? '/' : ''}`).sort();
      },
      () => {
        nodefs.mkdirSync(real('d/sub/deep'), { recursive: true });
        nodefs.writeFileSync(real('d/top'), '1');
        nodefs.writeFileSync(real('d/sub/x'), '1');
        nodefs.writeFileSync(real('d/sub/deep/y'), '1');
        return nodefs.readdirSync(real('d'), { recursive: true, withFileTypes: true })
          .map((e) => `${e.parentPath.replace(real('d'), '<d>')}/${e.name}${e.isDirectory() ? '/' : ''}`).sort();
      }
    );
  });

  it('names-only recursive still yields relative paths', () => {
    same(
      () => {
        mkdirSync(harness.request, '/r/sub', { recursive: true });
        writeFileSync(harness.request, '/r/sub/f', '1');
        return [...(readdirSync(harness.request, '/r', { recursive: true }) as string[])].sort();
      },
      () => {
        nodefs.mkdirSync(real('r/sub'), { recursive: true });
        nodefs.writeFileSync(real('r/sub/f'), '1');
        return nodefs.readdirSync(real('r'), { recursive: true }).sort();
      }
    );
  });

  it.each(['r', 'rs', 'r+', 'rs+', 'w', 'w+', 'a', 'a+', 'as', 'as+'])('open flag %s behaves as in Node', (flag) => {
    // 'as'/'as+' were missing from the flag table and fell through to O_RDONLY — harmless until
    // access modes were enforced, at which point an append-mode descriptor would have rejected
    // its own writes.
    same(
      () => {
        writeFileSync(harness.request, '/f', 'abc');
        const fd = openSync(harness.request, '/f', flag);
        try {
          const canWrite = (() => { try { writeSyncFd(harness.request, fd, new TextEncoder().encode('Z'), 0, 1, 0); return true; } catch { return false; } })();
          const canRead = (() => { try { readSync(harness.request, fd, new Uint8Array(1), 0, 1, 0); return true; } catch { return false; } })();
          return [canWrite, canRead];
        } finally { closeSync(harness.request, fd); }
      },
      () => {
        nodefs.writeFileSync(real('f'), 'abc');
        const fd = nodefs.openSync(real('f'), flag);
        try {
          const canWrite = (() => { try { nodefs.writeSync(fd, Buffer.from('Z'), 0, 1, 0); return true; } catch { return false; } })();
          const canRead = (() => { try { nodefs.readSync(fd, Buffer.alloc(1), 0, 1, 0); return true; } catch { return false; } })();
          return [canWrite, canRead];
        } finally { nodefs.closeSync(fd); }
      }
    );
  });

  it.each(['zz', '', 'R'])('an invalid flag string %o is rejected', (flag) => {
    writeFileSync(harness.request, '/f', 'x');
    nodefs.writeFileSync(real('f'), 'x');
    same(() => openSync(harness.request, '/f', flag), () => nodefs.openSync(real('f'), flag as never));
  });
});
