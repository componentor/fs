/**
 * `readFile` / `writeFile` / `appendFile` given a **file descriptor** instead of a path.
 *
 * Node has accepted an fd in the path position for all three since forever, and the semantics
 * are not the path semantics — every expectation below is taken from a live `node:fs` run
 * rather than from the docs:
 *
 *   • the operation starts at the descriptor's *current position* and advances it;
 *   • `writeFile(fd, …)` does not truncate;
 *   • `appendFile(fd, …)` does not seek to EOF — it is `writeFile`, and the appending comes
 *     from having opened with `'a'`;
 *   • the descriptor is left open;
 *   • `flag` and `mode` are ignored.
 *
 * The raw-number form exists on the sync and callback APIs only. `fsPromises.readFile(fd)` is an
 * `ERR_INVALID_ARG_TYPE` in Node — the promise API takes a `FileHandle` instead, which is
 * covered at the bottom of this file.
 *
 * Each case runs the same sequence against both filesystems and compares the resulting bytes.
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
  root = nodefs.mkdtempSync(join(tmpdir(), 'fd-arg-'));
});
afterEach(() => nodefs.rmSync(root, { recursive: true, force: true }));

const real = (p: string) => join(root, p);

/** Seed the same file into both filesystems. */
function seed(name: string, body: string) {
  fs.writeFileSync('/' + name, body);
  nodefs.writeFileSync(real(name), body);
}

/** Run `fn` against both filesystems with a descriptor open on the same file, compare the result. */
function bothFd<T>(
  name: string,
  flag: string,
  fn: (io: { readFileSync: Function; writeFileSync: Function; appendFileSync: Function }, fd: number) => T,
): { ours: T | string; theirs: T | string; ourBody: string; theirBody: string } {
  const attempt = <R>(f: () => R): R | string => {
    try { return f(); } catch (e) { return `ERR:${(e as NodeJS.ErrnoException).code ?? (e as Error).name}`; }
  };

  const ourFd = fs.openSync('/' + name, flag);
  const ours = attempt(() => fn(fs as never, ourFd));
  fs.closeSync(ourFd);

  const theirFd = nodefs.openSync(real(name), flag);
  const theirs = attempt(() => fn(nodefs as never, theirFd));
  nodefs.closeSync(theirFd);

  return {
    ours, theirs,
    ourBody: fs.readFileSync('/' + name, 'utf8') as string,
    theirBody: nodefs.readFileSync(real(name), 'utf8'),
  };
}

describe('readFileSync(fd)', () => {
  it('reads from the current position, not from zero', () => {
    seed('a', '0123456789');
    const r = bothFd('a', 'r', (io, fd) => {
      (io as typeof nodefs).readSync(fd, new Uint8Array(3) as never, 0, 3, null); // cursor -> 3
      return io.readFileSync(fd, 'utf8');
    });
    expect(r.ours).toBe(r.theirs);
    expect(r.ours).toBe('3456789');
  });

  it('advances the cursor, so a second call returns nothing', () => {
    seed('a', 'hello');
    const r = bothFd('a', 'r', (io, fd) => [io.readFileSync(fd, 'utf8'), io.readFileSync(fd, 'utf8')]);
    expect(r.ours).toEqual(r.theirs);
    expect(r.ours).toEqual(['hello', '']);
  });

  it('leaves the descriptor open', () => {
    seed('a', 'hello');
    const fd = fs.openSync('/a', 'r');
    fs.readFileSync(fd);
    expect(() => fs.fstatSync(fd)).not.toThrow();
    fs.closeSync(fd);

    const nfd = nodefs.openSync(real('a'), 'r');
    nodefs.readFileSync(nfd);
    expect(() => nodefs.fstatSync(nfd)).not.toThrow();
    nodefs.closeSync(nfd);
  });

  it('ignores `flag` — the file is already open', () => {
    seed('a', 'hello');
    const r = bothFd('a', 'r', (io, fd) => io.readFileSync(fd, { encoding: 'utf8', flag: 'w' }));
    expect(r.ours).toBe(r.theirs);
    expect(r.ours).toBe('hello');
    // The 'w' must not have truncated anything.
    expect(r.ourBody).toBe('hello');
    expect(r.ourBody).toBe(r.theirBody);
  });

  it('honours the encoding, including non-utf8 ones', () => {
    seed('a', 'hi');
    const r = bothFd('a', 'r', (io, fd) => io.readFileSync(fd, 'hex'));
    expect(r.ours).toBe(r.theirs);
    expect(r.ours).toBe('6869');
  });

  it('returns bytes when no encoding is given', () => {
    seed('a', 'AB');
    const fd = fs.openSync('/a', 'r');
    const out = fs.readFileSync(fd);
    fs.closeSync(fd);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out as Uint8Array)).toEqual([0x41, 0x42]);
  });

  it('reports EISDIR for a descriptor open on a directory', () => {
    // A directory can be opened read-only and fstat-ed, but not read through. This returned an
    // empty buffer before — indistinguishable from an empty file.
    fs.mkdirSync('/dir');
    nodefs.mkdirSync(real('dir'));

    const fd = fs.openSync('/dir', 'r');
    expect(() => fs.fstatSync(fd)).not.toThrow();
    expect(() => fs.readFileSync(fd)).toThrow(expect.objectContaining({ code: 'EISDIR' }));
    fs.closeSync(fd);

    const nfd = nodefs.openSync(real('dir'), 'r');
    expect(() => nodefs.readFileSync(nfd)).toThrow(expect.objectContaining({ code: 'EISDIR' }));
    nodefs.closeSync(nfd);
  });

  it('reports the descriptor error through the callback rather than throwing later', async () => {
    // node defers this one and then throws it *uncaught* from a later tick
    // (`readFileAfterOpen`), which takes the process down instead of reaching the callback.
    // Reporting it to the callback is the deliberate difference.
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      fs.readFile(-1 as never, (e) => resolve(e as NodeJS.ErrnoException));
    });
    expect(err?.code).toBe('ERR_OUT_OF_RANGE');
  });

  it('rejects reading a write-only descriptor, as node does', () => {
    seed('a', 'hello');
    const r = bothFd('a', 'w', (io, fd) => io.readFileSync(fd));
    expect(r.ours).toBe('ERR:EBADF');
    expect(r.ours).toBe(r.theirs);
  });
});

describe('writeFileSync(fd)', () => {
  it('writes at the cursor without truncating', () => {
    seed('b', 'XXXXXXXXXX');
    const r = bothFd('b', 'r+', (io, fd) => io.writeFileSync(fd, 'ab'));
    expect(r.ourBody).toBe('abXXXXXXXX');
    expect(r.ourBody).toBe(r.theirBody);
  });

  it('advances the cursor across successive calls', () => {
    seed('c', '..........');
    const r = bothFd('c', 'r+', (io, fd) => { io.writeFileSync(fd, '1'); io.writeFileSync(fd, '2'); });
    expect(r.ourBody).toBe('12........');
    expect(r.ourBody).toBe(r.theirBody);
  });

  it('appends when the descriptor was opened with `a`', () => {
    seed('d', 'AAA');
    const r = bothFd('d', 'a', (io, fd) => io.writeFileSync(fd, 'B'));
    expect(r.ourBody).toBe('AAAB');
    expect(r.ourBody).toBe(r.theirBody);
  });

  it('honours the encoding of string data', () => {
    seed('e', '');
    const r = bothFd('e', 'r+', (io, fd) => io.writeFileSync(fd, 'é', 'latin1'));
    expect(r.ourBody).toBe(r.theirBody);
    expect(fs.statSync('/e').size).toBe(1); // one byte, not the two of UTF-8
  });

  it('rejects writing a read-only descriptor, as node does', () => {
    seed('f', 'hello');
    const r = bothFd('f', 'r', (io, fd) => io.writeFileSync(fd, 'x'));
    expect(r.ours).toBe('ERR:EBADF');
    expect(r.ours).toBe(r.theirs);
    expect(r.ourBody).toBe('hello');
    expect(r.ourBody).toBe(r.theirBody);
  });
});

describe('appendFileSync(fd)', () => {
  it('writes at the cursor — it is not an append', () => {
    // The surprising one. On an 'r+' descriptor node overwrites from position 0.
    seed('g', 'AAA');
    const r = bothFd('g', 'r+', (io, fd) => io.appendFileSync(fd, 'B'));
    expect(r.ourBody).toBe('BAA');
    expect(r.ourBody).toBe(r.theirBody);
  });

  it('appends when the descriptor was opened with `a`', () => {
    seed('h', 'AAA');
    const r = bothFd('h', 'a', (io, fd) => io.appendFileSync(fd, 'B'));
    expect(r.ourBody).toBe('AAAB');
    expect(r.ourBody).toBe(r.theirBody);
  });
});

describe('descriptor argument validation', () => {
  it('rejects a negative descriptor with ERR_OUT_OF_RANGE', () => {
    for (const call of [
      () => fs.readFileSync(-1),
      () => fs.writeFileSync(-1, 'x'),
      () => fs.appendFileSync(-1, 'x'),
    ]) {
      expect(call).toThrow(expect.objectContaining({ code: 'ERR_OUT_OF_RANGE' }));
    }
    expect(() => nodefs.readFileSync(-1)).toThrow(expect.objectContaining({ code: 'ERR_OUT_OF_RANGE' }));
  });

  it('treats a number outside int32 as a path, not a descriptor', () => {
    // node only reads a number as an fd when it is an int32; everything else falls through to
    // path validation and fails as a *path*, which is a different error entirely.
    for (const bad of [1.5, NaN, 2 ** 31, -(2 ** 31) - 1]) {
      expect(() => fs.readFileSync(bad), `ours: ${bad}`).toThrow(TypeError);
      expect(() => nodefs.readFileSync(bad as never), `node: ${bad}`).toThrow(
        expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' })
      );
    }
  });

  it('reports EBADF for a descriptor that was never opened', () => {
    expect(() => fs.readFileSync(9999)).toThrow(expect.objectContaining({ code: 'EBADF' }));
    expect(() => nodefs.readFileSync(9999)).toThrow(expect.objectContaining({ code: 'EBADF' }));
  });

  it('reports EBADF for a descriptor that was already closed', () => {
    seed('a', 'x');
    const fd = fs.openSync('/a', 'r');
    fs.closeSync(fd);
    expect(() => fs.readFileSync(fd)).toThrow(expect.objectContaining({ code: 'EBADF' }));
  });
});

describe('the callback API takes a descriptor too', () => {
  const call = <T>(fn: (cb: (e: Error | null, d?: T) => void) => void) =>
    new Promise<T | string>((resolve) => fn((e, d) => resolve(e ? `ERR:${(e as NodeJS.ErrnoException).code}` : d as T)));

  it('readFile(fd, cb) reads from the cursor', async () => {
    seed('a', 'hello');
    const fd = fs.openSync('/a', 'r');
    const ours = await call<string>((cb) => fs.readFile(fd, 'utf8', cb as never));
    fs.closeSync(fd);

    const nfd = nodefs.openSync(real('a'), 'r');
    const theirs = await call<string>((cb) => nodefs.readFile(nfd, 'utf8', cb as never));
    nodefs.closeSync(nfd);

    expect(ours).toBe(theirs);
    expect(ours).toBe('hello');
  });

  it('writeFile(fd, data, cb) does not truncate', async () => {
    seed('b', 'XXXXXXXXXX');
    const fd = fs.openSync('/b', 'r+');
    await call((cb) => fs.writeFile(fd, 'ab', cb as never));
    fs.closeSync(fd);

    const nfd = nodefs.openSync(real('b'), 'r+');
    await call((cb) => nodefs.writeFile(nfd, 'ab', cb as never));
    nodefs.closeSync(nfd);

    expect(fs.readFileSync('/b', 'utf8')).toBe('abXXXXXXXX');
    expect(fs.readFileSync('/b', 'utf8')).toBe(nodefs.readFileSync(real('b'), 'utf8'));
  });

  it('appendFile(fd, data, cb) writes at the cursor', async () => {
    seed('c', 'AAA');
    const fd = fs.openSync('/c', 'r+');
    await call((cb) => fs.appendFile(fd, 'B', cb as never));
    fs.closeSync(fd);

    const nfd = nodefs.openSync(real('c'), 'r+');
    await call((cb) => nodefs.appendFile(nfd, 'B', cb as never));
    nodefs.closeSync(nfd);

    expect(fs.readFileSync('/c', 'utf8')).toBe('BAA');
    expect(fs.readFileSync('/c', 'utf8')).toBe(nodefs.readFileSync(real('c'), 'utf8'));
  });
});

describe('the promise API takes a FileHandle, not a raw descriptor', () => {
  it('rejects a raw number, as node does', async () => {
    seed('a', 'hello');
    const fd = fs.openSync('/a', 'r');
    await expect(fs.promises.readFile(fd as never)).rejects.toThrow(TypeError);
    fs.closeSync(fd);

    const nfd = nodefs.openSync(real('a'), 'r');
    await expect(nodefsp.readFile(nfd as never)).rejects.toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' })
    );
    nodefs.closeSync(nfd);
  });

  it('readFile(handle) reads the file', async () => {
    seed('a', 'hello');
    const h = await fs.promises.open('/a', 'r');
    const ours = await fs.promises.readFile(h as never, 'utf8');
    await h.close();

    const nh = await nodefsp.open(real('a'), 'r');
    const theirs = await nodefsp.readFile(nh, 'utf8');
    await nh.close();

    expect(ours).toBe(theirs);
    expect(ours).toBe('hello');
  });

  it('writeFile(handle) writes at the cursor without truncating', async () => {
    seed('b', 'XXXXXXXXXX');
    const h = await fs.promises.open('/b', 'r+');
    await fs.promises.writeFile(h as never, 'ab');
    await h.close();

    const nh = await nodefsp.open(real('b'), 'r+');
    await nodefsp.writeFile(nh, 'ab');
    await nh.close();

    expect(fs.readFileSync('/b', 'utf8')).toBe('abXXXXXXXX');
    expect(fs.readFileSync('/b', 'utf8')).toBe(nodefs.readFileSync(real('b'), 'utf8'));
  });

  it('appendFile(handle) writes at the cursor', async () => {
    seed('c', 'AAA');
    const h = await fs.promises.open('/c', 'r+');
    await fs.promises.appendFile(h as never, 'B');
    await h.close();

    const nh = await nodefsp.open(real('c'), 'r+');
    await nodefsp.appendFile(nh, 'B');
    await nh.close();

    expect(fs.readFileSync('/c', 'utf8')).toBe('BAA');
    expect(fs.readFileSync('/c', 'utf8')).toBe(nodefs.readFileSync(real('c'), 'utf8'));
  });
});

describe('FileHandle read/write/append position semantics', () => {
  it('handle.readFile() starts at the cursor and advances it', async () => {
    seed('a', '0123456789');
    const h = await fs.promises.open('/a', 'r');
    await h.read(new Uint8Array(3), 0, 3, null);
    const first = await h.readFile('utf8');
    const second = await h.readFile('utf8');
    await h.close();

    const nh = await nodefsp.open(real('a'), 'r');
    await nh.read(Buffer.alloc(3), 0, 3, null);
    const nFirst = await nh.readFile('utf8');
    const nSecond = await nh.readFile('utf8');
    await nh.close();

    expect([first, second]).toEqual([nFirst, nSecond]);
    expect([first, second]).toEqual(['3456789', '']);
  });

  it('handle.writeFile() writes at the cursor', async () => {
    seed('b', '..........');
    const h = await fs.promises.open('/b', 'r+');
    await h.write(new TextEncoder().encode('XX'), 0, 2, null); // cursor -> 2
    await h.writeFile('ab');
    await h.close();

    const nh = await nodefsp.open(real('b'), 'r+');
    await nh.write(Buffer.from('XX'), 0, 2, null);
    await nh.writeFile('ab');
    await nh.close();

    expect(fs.readFileSync('/b', 'utf8')).toBe('XXab......');
    expect(fs.readFileSync('/b', 'utf8')).toBe(nodefs.readFileSync(real('b'), 'utf8'));
  });

  it('handle.appendFile() is an alias of writeFile, not a seek to EOF', async () => {
    seed('c', '..........');
    const h = await fs.promises.open('/c', 'r+');
    await h.write(new TextEncoder().encode('YY'), 0, 2, null); // cursor -> 2
    await h.appendFile('zz');
    await h.close();

    const nh = await nodefsp.open(real('c'), 'r+');
    await nh.write(Buffer.from('YY'), 0, 2, null);
    await nh.appendFile('zz');
    await nh.close();

    expect(fs.readFileSync('/c', 'utf8')).toBe('YYzz......');
    expect(fs.readFileSync('/c', 'utf8')).toBe(nodefs.readFileSync(real('c'), 'utf8'));
  });

  it('handle.appendFile() on an `a` handle still appends', async () => {
    seed('d', 'AAA');
    const h = await fs.promises.open('/d', 'a');
    await h.appendFile('B');
    await h.close();

    const nh = await nodefsp.open(real('d'), 'a');
    await nh.appendFile('B');
    await nh.close();

    expect(fs.readFileSync('/d', 'utf8')).toBe('AAAB');
    expect(fs.readFileSync('/d', 'utf8')).toBe(nodefs.readFileSync(real('d'), 'utf8'));
  });

  it('handle.readFile() honours a non-utf8 encoding', async () => {
    seed('e', 'hi');
    const h = await fs.promises.open('/e', 'r');
    const ours = await h.readFile('hex');
    await h.close();

    const nh = await nodefsp.open(real('e'), 'r');
    const theirs = await nh.readFile('hex');
    await nh.close();

    expect(ours).toBe(theirs);
    expect(ours).toBe('6869');
  });
});
