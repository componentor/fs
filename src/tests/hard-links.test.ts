/**
 * Hard links are real names for one inode — and they survive a remount.
 *
 * `link()` used to copy the file and stamp `nlink: 2` on two unrelated inodes, so the two
 * names had different inode numbers, a write through one was invisible through the other,
 * and deleting one left the survivor claiming a link that no longer existed.
 *
 * Making the in-memory half of that real is easy and was tried once: point the path index
 * at the source inode and bump `nlink`. It does not survive, and that is the whole problem.
 * The path index is REBUILT ON MOUNT by scanning the inode table, and an inode stores
 * exactly one path (INODE.PATH_OFFSET/PATH_LENGTH) — so a second name held only in the map
 * disappears at the next page load. Silent data loss.
 *
 * The fix is an INODE_TYPE.HARDLINK entry: an inode-table record holding the link's own
 * path plus the target's index (INODE.LINK_TARGET, the FIRST_BLOCK field, which such an
 * entry has no use for). The mount scan sees it and re-registers name → target.
 *
 * Hence the shape of this file: nearly every case is asserted twice — once live, once
 * through a second `VFSEngine` mounted on the same handle, which is exactly what a reload
 * does. A test that only checks the live engine cannot tell the durable implementation
 * from the one that was reverted.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VFSEngine } from '../src/vfs/engine.js';
import { MockSyncHandle } from './helpers/mock-handle.js';
import { decodeStats } from '../src/stats.js';
import { INODE_TYPE } from '../src/vfs/layout.js';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

let handle: MockSyncHandle;
let engine: VFSEngine;

beforeEach(() => {
  handle = new MockSyncHandle(0);
  engine = new VFSEngine();
  engine.init(handle as unknown as FileSystemSyncAccessHandle);
});

/** Mount a fresh engine over the same bytes — what a page reload does. */
function remount(): VFSEngine {
  const next = new VFSEngine();
  next.init(handle as unknown as FileSystemSyncAccessHandle);
  return next;
}

function statOf(e: VFSEngine, path: string) {
  const r = e.stat(path);
  expect(r.status, `stat ${path}`).toBe(0);
  return decodeStats(r.data!);
}

function readOf(e: VFSEngine, path: string) {
  const r = e.read(path);
  expect(r.status, `read ${path}`).toBe(0);
  return dec(r.data!);
}

function volume(e: VFSEngine) {
  const r = e.statfs('/');
  const dv = new DataView(r.data!.buffer, r.data!.byteOffset, r.data!.byteLength);
  const blocks = dv.getUint32(8, true);
  const bfree = dv.getUint32(12, true);
  // Used blocks rather than free ones: the volume trims and pre-grows its tail, so the
  // total moves on its own and only the used count is stable across operations.
  return { usedBlocks: blocks - bfree, files: dv.getUint32(16, true), ffree: dv.getUint32(20, true) };
}

/** Every name in the volume, so nothing is left dangling or duplicated. */
function names(e: VFSEngine): string[] {
  return e.getAllFiles().map(f => f.path).sort();
}

describe('a hard link is a second name for one inode', () => {
  it('both names report the same inode number and nlink 2', () => {
    engine.write('/a.txt', enc('data'));
    expect(engine.link('/a.txt', '/b.txt').status).toBe(0);

    const a = statOf(engine, '/a.txt');
    const b = statOf(engine, '/b.txt');
    expect(b.ino).toBe(a.ino);
    expect(a.nlink).toBe(2);
    expect(b.nlink).toBe(2);
    // `[ a -ef b ]` and `find -samefile` are exactly this comparison.
    expect(a.dev).toBe(b.dev);
  });

  it('a write through one name is visible through the other', () => {
    engine.write('/a.txt', enc('first'));
    engine.link('/a.txt', '/b.txt');

    engine.write('/b.txt', enc('second, and longer than the first'));
    expect(readOf(engine, '/a.txt')).toBe('second, and longer than the first');
    expect(statOf(engine, '/a.txt').size).toBe(statOf(engine, '/b.txt').size);

    // Shrinking back through the original name too — the block run is shared, and a
    // relocation must not leave one name pointing at the freed range.
    engine.write('/a.txt', enc('c'));
    expect(readOf(engine, '/b.txt')).toBe('c');
  });

  it('truncate and append through one name are visible through the other', () => {
    engine.write('/a.txt', enc('hello world'));
    engine.link('/a.txt', '/b.txt');

    engine.truncate('/b.txt', 5);
    expect(readOf(engine, '/a.txt')).toBe('hello');

    engine.append('/a.txt', enc('!!'));
    expect(readOf(engine, '/b.txt')).toBe('hello!!');
  });

  it('metadata changes through one name are visible through the other', () => {
    engine.write('/a.txt', enc('x'));
    engine.link('/a.txt', '/b.txt');

    engine.chmod('/b.txt', 0o600);
    expect(statOf(engine, '/a.txt').mode & 0o777).toBe(0o600);

    engine.utimes('/a.txt', 111000, 222000);
    expect(statOf(engine, '/b.txt').mtimeMs).toBe(222000);
  });

  it('copies no data: the link consumes an inode slot and no blocks', () => {
    engine.write('/a.txt', enc('x'.repeat(9000))); // 3 blocks
    const before = volume(engine);

    engine.link('/a.txt', '/b.txt');
    const after = volume(engine);

    expect(after.usedBlocks).toBe(before.usedBlocks);
    expect(after.ffree).toBe(before.ffree - 1); // the HARDLINK entry's own slot
  });

  it('shows up in readdir under its own name', () => {
    engine.mkdir('/d', 0);
    engine.write('/d/a.txt', enc('x'));
    engine.link('/d/a.txt', '/d/b.txt');

    const r = engine.readdir('/d', 0);
    expect(r.status).toBe(0);
    const view = new DataView(r.data!.buffer, r.data!.byteOffset, r.data!.byteLength);
    const count = view.getUint32(0, true);
    const out: string[] = [];
    let off = 4;
    for (let i = 0; i < count; i++) {
      const len = view.getUint16(off, true);
      out.push(dec(r.data!.subarray(off + 2, off + 2 + len)));
      off += 2 + len;
    }
    expect(out.sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('reports the target type, never the link record type, to readdir', () => {
    engine.write('/a.txt', enc('x'));
    engine.link('/a.txt', '/b.txt');

    const r = engine.readdir('/', 1); // withFileTypes
    expect(r.status).toBe(0);
    const view = new DataView(r.data!.buffer, r.data!.byteOffset, r.data!.byteLength);
    const count = view.getUint32(0, true);
    let off = 4;
    for (let i = 0; i < count; i++) {
      const len = view.getUint16(off, true);
      const name = dec(r.data!.subarray(off + 2, off + 2 + len));
      const type = r.data![off + 2 + len];
      off += 2 + len + 1;
      if (name === 'b.txt') expect(type).toBe(INODE_TYPE.FILE);
    }
  });

  it('copying ONTO one name writes through to the shared file', () => {
    // copyFile(2) opens the destination and writes it — it does not replace the inode, so
    // the other name sees the new bytes. The stage-1 empty write inside `copy` frees the
    // shared block run and reallocates; if either name were left pointing at the old run
    // this is where it would show.
    engine.write('/a.txt', enc('original'));
    engine.link('/a.txt', '/b.txt');
    engine.write('/src', enc('copied in'));

    expect(engine.copy('/src', '/b.txt', 0).status).toBe(0);
    expect(readOf(engine, '/a.txt')).toBe('copied in');
    expect(statOf(engine, '/a.txt').ino).toBe(statOf(engine, '/b.txt').ino);
    expect(statOf(engine, '/a.txt').nlink).toBe(2);

    const e2 = remount();
    expect(readOf(e2, '/a.txt')).toBe('copied in');
    expect(readOf(e2, '/b.txt')).toBe('copied in');
    expect(statOf(e2, '/a.txt').ino).toBe(statOf(e2, '/b.txt').ino);
  });

  it('a descriptor opened on one name writes the file both names read', () => {
    engine.write('/a.txt', enc('....'));
    engine.link('/a.txt', '/b.txt');

    const opened = engine.open('/b.txt', 2 /* O_RDWR */, 'tab');
    expect(opened.status).toBe(0);
    const fd = new DataView(opened.data!.buffer, opened.data!.byteOffset).getUint32(0, true);

    expect(engine.fwrite(fd, enc('abcd'), 0).status).toBe(0);
    const st = engine.fstat(fd);
    expect(decodeStats(st.data!).ino).toBe(statOf(engine, '/a.txt').ino);
    expect(decodeStats(st.data!).nlink).toBe(2);
    engine.close(fd);

    expect(readOf(engine, '/a.txt')).toBe('abcd');
    expect(readOf(remount(), '/a.txt')).toBe('abcd');
  });

  it('exports both names with the shared content', () => {
    // The OPFS mirror and `saveToOPFS` walk this list. OPFS cannot express sharing, so both
    // names must come out as full files rather than one name and one hole.
    engine.write('/a.txt', enc('shared'));
    engine.link('/a.txt', '/b.txt');

    const exported = remount().exportAll().filter(e => e.path !== '/');
    expect(exported.map(e => e.path).sort()).toEqual(['/a.txt', '/b.txt']);
    for (const entry of exported) {
      expect(entry.type, entry.path).toBe(INODE_TYPE.FILE);
      expect(dec(entry.data!), entry.path).toBe('shared');
    }
  });

  it('reports the other names of a shared inode, and nothing for a lone file', () => {
    engine.write('/a.txt', enc('x'));
    engine.write('/alone', enc('x'));
    engine.link('/a.txt', '/b.txt');
    engine.link('/a.txt', '/c.txt');

    const e2 = remount();
    expect(e2.linkNamesFor('/alone')).toEqual([]);
    expect(e2.linkNamesFor('/nothing-here')).toEqual([]);
    expect(e2.linkNamesFor('/a.txt').sort()).toEqual(['/b.txt', '/c.txt']);
    expect(e2.linkNamesFor('/b.txt').sort()).toEqual(['/a.txt', '/c.txt']);
  });

  it('rejects the cases link(2) rejects', () => {
    engine.write('/a.txt', enc('x'));
    engine.mkdir('/d', 0);

    expect(engine.link('/nope', '/x').status).not.toBe(0);      // ENOENT
    expect(engine.link('/d', '/x').status).not.toBe(0);         // EPERM — no directory links
    engine.link('/a.txt', '/b.txt');
    expect(engine.link('/a.txt', '/b.txt').status).not.toBe(0); // EEXIST
    expect(engine.link('/a.txt', '/missing/x').status).not.toBe(0); // ENOENT — no parent
  });
});

describe('a hard link survives a remount', () => {
  it('both names still resolve to one inode, with the same content', () => {
    engine.write('/a.txt', enc('shared bytes'));
    engine.link('/a.txt', '/b.txt');
    const inoBefore = statOf(engine, '/a.txt').ino;

    const e2 = remount();

    // The name exists at all — this is what the in-memory-only version lost.
    expect(readOf(e2, '/b.txt')).toBe('shared bytes');
    expect(readOf(e2, '/a.txt')).toBe('shared bytes');

    const a = statOf(e2, '/a.txt');
    const b = statOf(e2, '/b.txt');
    expect(b.ino).toBe(a.ino);
    expect(a.ino).toBe(inoBefore);
    expect(a.nlink).toBe(2);
    expect(b.nlink).toBe(2);
  });

  it('is still ONE inode afterwards: a write through either name moves both', () => {
    engine.write('/a.txt', enc('before'));
    engine.link('/a.txt', '/b.txt');

    const e2 = remount();
    e2.write('/b.txt', enc('after'));
    expect(readOf(e2, '/a.txt')).toBe('after');

    // And again across a second remount, from the name written through.
    const e3 = remount();
    expect(readOf(e3, '/a.txt')).toBe('after');
    expect(readOf(e3, '/b.txt')).toBe('after');
    expect(statOf(e3, '/a.txt').ino).toBe(statOf(e3, '/b.txt').ino);
  });

  it('carries a whole set of links, in nested directories', () => {
    engine.mkdir('/d', 0);
    engine.mkdir('/d/e', 0);
    engine.write('/d/orig', enc('payload'));
    engine.link('/d/orig', '/l1');
    engine.link('/l1', '/d/e/l2');   // linking THROUGH a link points at the same file
    engine.link('/d/orig', '/d/l3');

    const e2 = remount();
    const ino = statOf(e2, '/d/orig').ino;
    for (const p of ['/l1', '/d/e/l2', '/d/l3']) {
      expect(readOf(e2, p), p).toBe('payload');
      expect(statOf(e2, p).ino, p).toBe(ino);
      expect(statOf(e2, p).nlink, p).toBe(4);
    }
  });

  it('a link created AFTER a remount works the same', () => {
    engine.write('/a.txt', enc('x'));
    const e2 = remount();
    expect(e2.link('/a.txt', '/b.txt').status).toBe(0);

    const e3 = remount();
    expect(statOf(e3, '/b.txt').ino).toBe(statOf(e3, '/a.txt').ino);
    expect(statOf(e3, '/b.txt').nlink).toBe(2);
  });

  it('keeps free-space accounting honest across the remount', () => {
    engine.write('/a.txt', enc('y'.repeat(20000)));
    engine.link('/a.txt', '/b.txt');
    const before = volume(engine);

    const e2 = remount();
    expect(volume(e2)).toEqual(before);
  });
});

describe('unlink frees the data only when the last name goes', () => {
  it('removing the link leaves the file, live and after a remount', () => {
    engine.write('/a.txt', enc('kept'));
    engine.link('/a.txt', '/b.txt');
    const used = volume(engine).usedBlocks;

    expect(engine.unlink('/b.txt').status).toBe(0);
    expect(readOf(engine, '/a.txt')).toBe('kept');
    expect(statOf(engine, '/a.txt').nlink).toBe(1);
    expect(volume(engine).usedBlocks).toBe(used); // data untouched
    expect(names(engine)).toEqual(['/', '/a.txt']);

    const e2 = remount();
    expect(readOf(e2, '/a.txt')).toBe('kept');
    expect(statOf(e2, '/a.txt').nlink).toBe(1);
    expect(e2.read('/b.txt').status).not.toBe(0);
    expect(names(e2)).toEqual(['/', '/a.txt']);
  });

  it('removing the ORIGINAL name promotes the link — durably', () => {
    // The hard case: the inode stores one path, and that path is the one being removed.
    // The surviving name has to become the inode's own, or the file is unreachable after
    // the next mount even though it is still in the index right now.
    engine.write('/a.txt', enc('promoted'));
    engine.link('/a.txt', '/b.txt');
    const ino = statOf(engine, '/a.txt').ino;

    expect(engine.unlink('/a.txt').status).toBe(0);
    expect(readOf(engine, '/b.txt')).toBe('promoted');
    expect(statOf(engine, '/b.txt').nlink).toBe(1);

    const e2 = remount();
    expect(readOf(e2, '/b.txt')).toBe('promoted');
    expect(statOf(e2, '/b.txt').ino).toBe(ino);
    expect(statOf(e2, '/b.txt').nlink).toBe(1);
    expect(names(e2)).toEqual(['/', '/b.txt']);

    // The promoted name is a normal file now: it can be linked again.
    expect(e2.link('/b.txt', '/c.txt').status).toBe(0);
    expect(statOf(remount(), '/c.txt').ino).toBe(ino);
  });

  it('promotion works through a chain of removals', () => {
    engine.write('/n1', enc('survivor'));
    engine.link('/n1', '/n2');
    engine.link('/n1', '/n3');

    engine.unlink('/n1');           // promote one of n2/n3
    expect(statOf(engine, '/n2').nlink).toBe(2);
    engine.unlink('/n2');
    const e2 = remount();
    expect(readOf(e2, '/n3')).toBe('survivor');
    expect(statOf(e2, '/n3').nlink).toBe(1);
    expect(names(e2)).toEqual(['/', '/n3']);
  });

  it('the blocks come back only when the last name is gone', () => {
    const base = volume(engine).usedBlocks;
    engine.write('/a.txt', enc('z'.repeat(9000)));
    engine.link('/a.txt', '/b.txt');
    const withData = volume(engine).usedBlocks;
    expect(withData).toBeGreaterThan(base);

    engine.unlink('/a.txt');
    expect(volume(engine).usedBlocks).toBe(withData);

    engine.unlink('/b.txt');
    expect(volume(engine).usedBlocks).toBe(base);
    expect(volume(engine).ffree).toBe(volume(remount()).ffree);
    expect(names(remount())).toEqual(['/']);
  });

  it('a rewrite after one name is gone does not disturb the survivor', () => {
    // Regression guard for the freed-blocks-still-referenced shape: if unlink had freed
    // the shared run, this write would hand those blocks to another file.
    engine.write('/a.txt', enc('original'));
    engine.link('/a.txt', '/b.txt');
    engine.unlink('/a.txt');
    engine.write('/other', enc('q'.repeat(9000)));

    expect(readOf(engine, '/b.txt')).toBe('original');
    expect(readOf(remount(), '/b.txt')).toBe('original');
  });
});

describe('renaming a name that is a link — or that has links', () => {
  it('renaming the link moves the link, and it survives a remount', () => {
    engine.mkdir('/d', 0);
    engine.write('/a.txt', enc('body'));
    engine.link('/a.txt', '/b.txt');

    expect(engine.rename('/b.txt', '/d/moved').status).toBe(0);
    expect(engine.read('/b.txt').status).not.toBe(0);
    expect(readOf(engine, '/d/moved')).toBe('body');
    expect(statOf(engine, '/d/moved').ino).toBe(statOf(engine, '/a.txt').ino);

    const e2 = remount();
    expect(readOf(e2, '/d/moved')).toBe('body');
    expect(statOf(e2, '/d/moved').ino).toBe(statOf(e2, '/a.txt').ino);
    expect(statOf(e2, '/a.txt').nlink).toBe(2);
    expect(names(e2)).toEqual(['/', '/a.txt', '/d', '/d/moved']);
  });

  it('renaming the original leaves the link pointing at it', () => {
    engine.write('/a.txt', enc('body'));
    engine.link('/a.txt', '/b.txt');

    expect(engine.rename('/a.txt', '/renamed').status).toBe(0);

    const e2 = remount();
    expect(readOf(e2, '/b.txt')).toBe('body');
    expect(readOf(e2, '/renamed')).toBe('body');
    expect(statOf(e2, '/b.txt').ino).toBe(statOf(e2, '/renamed').ino);
    expect(statOf(e2, '/b.txt').nlink).toBe(2);
  });

  it('renaming a directory carries the links inside it', () => {
    engine.mkdir('/d', 0);
    engine.write('/target', enc('body'));
    engine.link('/target', '/d/inside');

    expect(engine.rename('/d', '/moved').status).toBe(0);

    const e2 = remount();
    expect(readOf(e2, '/moved/inside')).toBe('body');
    expect(statOf(e2, '/moved/inside').ino).toBe(statOf(e2, '/target').ino);
    expect(names(e2)).toEqual(['/', '/moved', '/moved/inside', '/target']);
  });

  it('renaming ONTO a link removes that name only', () => {
    engine.write('/a.txt', enc('shared'));
    engine.link('/a.txt', '/b.txt');
    engine.write('/src', enc('replacement'));

    expect(engine.rename('/src', '/b.txt').status).toBe(0);

    const e2 = remount();
    expect(readOf(e2, '/b.txt')).toBe('replacement');
    expect(readOf(e2, '/a.txt')).toBe('shared'); // the file the link named is untouched
    expect(statOf(e2, '/a.txt').nlink).toBe(1);
    expect(statOf(e2, '/b.txt').ino).not.toBe(statOf(e2, '/a.txt').ino);
  });

  it('renaming ONTO the original keeps the link holding the file', () => {
    engine.write('/a.txt', enc('shared'));
    engine.link('/a.txt', '/b.txt');
    engine.write('/src', enc('replacement'));

    expect(engine.rename('/src', '/a.txt').status).toBe(0);

    const e2 = remount();
    expect(readOf(e2, '/a.txt')).toBe('replacement');
    expect(readOf(e2, '/b.txt')).toBe('shared');
    expect(statOf(e2, '/b.txt').nlink).toBe(1);
  });

  it('renaming one name of a pair onto the other is a no-op, both ways', () => {
    // rename(2): "if old and new resolve to different directory entries for the same
    // existing file, return successfully and perform no other action".
    engine.write('/a.txt', enc('body'));
    engine.link('/a.txt', '/b.txt');

    expect(engine.rename('/a.txt', '/b.txt').status).toBe(0);
    expect(engine.rename('/b.txt', '/a.txt').status).toBe(0);

    const e2 = remount();
    expect(readOf(e2, '/a.txt')).toBe('body');
    expect(readOf(e2, '/b.txt')).toBe('body');
    expect(statOf(e2, '/a.txt').ino).toBe(statOf(e2, '/b.txt').ino);
    expect(statOf(e2, '/a.txt').nlink).toBe(2);
  });
});

describe('recursive removal with links crossing the boundary', () => {
  it('a link inside a removed tree does not take the outside file with it', () => {
    engine.mkdir('/d', 0);
    engine.write('/outside', enc('keep me'));
    engine.link('/outside', '/d/link');

    expect(engine.rmdir('/d', 1).status).toBe(0);

    const e2 = remount();
    expect(readOf(e2, '/outside')).toBe('keep me');
    expect(statOf(e2, '/outside').nlink).toBe(1);
    expect(names(e2)).toEqual(['/', '/outside']);
  });

  it('a file inside a removed tree survives under a link outside it', () => {
    engine.mkdir('/d', 0);
    engine.write('/d/file', enc('rescued'));
    engine.link('/d/file', '/outside');

    expect(engine.rmdir('/d', 1).status).toBe(0);

    const e2 = remount();
    expect(readOf(e2, '/outside')).toBe('rescued');
    expect(statOf(e2, '/outside').nlink).toBe(1);
    expect(names(e2)).toEqual(['/', '/outside']);
  });

  it('both names inside the removed tree take the file with them', () => {
    const base = volume(engine).usedBlocks;
    engine.mkdir('/d', 0);
    engine.write('/d/file', enc('w'.repeat(9000)));
    engine.link('/d/file', '/d/link');

    expect(engine.rmdir('/d', 1).status).toBe(0);
    expect(volume(engine).usedBlocks).toBe(base);
    expect(names(remount())).toEqual(['/']);
  });
});

describe('symlinks are unaffected', () => {
  it('a symlink is still a symlink, before and after a remount', () => {
    engine.write('/file', enc('body'));
    engine.symlink('/file', '/sym');
    engine.link('/file', '/hard');

    const e2 = remount();
    expect(dec(e2.readlink('/sym').data!)).toBe('/file');
    expect(e2.lstat('/sym').data![0]).toBe(INODE_TYPE.SYMLINK);

    // A hard link is NOT a symlink: readlink on it is an error, and lstat reports the file.
    expect(e2.readlink('/hard').status).not.toBe(0);
    expect(e2.lstat('/hard').data![0]).toBe(INODE_TYPE.FILE);
    expect(statOf(e2, '/hard').ino).toBe(statOf(e2, '/file').ino);
    // The symlink is a name in the directory but not a name for the inode.
    expect(statOf(e2, '/file').nlink).toBe(2);
  });

  it('a symlink pointing at a hard link resolves to the shared file', () => {
    engine.write('/file', enc('body'));
    engine.link('/file', '/hard');
    engine.symlink('/hard', '/sym');

    const e2 = remount();
    expect(readOf(e2, '/sym')).toBe('body');
    e2.write('/sym', enc('through the symlink'));
    expect(readOf(e2, '/file')).toBe('through the symlink');
    expect(readOf(e2, '/hard')).toBe('through the symlink');
  });

  it('removing a symlink to a linked file leaves both names alone', () => {
    engine.write('/file', enc('body'));
    engine.link('/file', '/hard');
    engine.symlink('/file', '/sym');

    expect(engine.unlink('/sym').status).toBe(0);
    const e2 = remount();
    expect(readOf(e2, '/file')).toBe('body');
    expect(readOf(e2, '/hard')).toBe('body');
    expect(statOf(e2, '/file').nlink).toBe(2);
  });
});

describe('randomized: names, sharing and free space stay consistent — across remounts', () => {
  // The failure mode being hunted here is a wrong free: releasing a block run while a name
  // still reaches it, or leaking one when the last name goes. Neither shows up as an error
  // at the time — it shows up later as a file quietly holding another file's bytes. So the
  // model tracks which names share which content, and every iteration re-checks all of it
  // through a freshly mounted engine, not just the live one.

  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Count clear (free) bits — the authoritative free-block count. */
  function clearBits(e: VFSEngine): number {
    const inner = e as unknown as { totalBlocks: number; bitmap: Uint8Array };
    let free = 0;
    for (let i = 0; i < inner.totalBlocks; i++) {
      if (((inner.bitmap[i >>> 3] >>> (i & 7)) & 1) === 0) free++;
    }
    return free;
  }

  function freeBlocksOf(e: VFSEngine): number {
    return (e as unknown as { freeBlocks: number }).freeBlocks;
  }

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`seed ${seed}`, () => {
      const rand = mulberry32(seed);
      const h = new MockSyncHandle(0);
      let e = new VFSEngine();
      e.init(h as unknown as FileSystemSyncAccessHandle);

      const baseUsed = volume(e).usedBlocks;

      // name → group id; group id → the bytes every name in that group must read.
      const group = new Map<string, number>();
      const content = new Map<number, string>();
      const dirs = ['/'];
      let counter = 0;
      let nextGroup = 0;

      const pick = <T>(a: T[]): T => a[Math.floor(rand() * a.length)];
      const join = (d: string, n: string) => (d === '/' ? '/' + n : d + '/' + n);
      const bodyFor = (n: number) => `${n}:` + 'x'.repeat(Math.floor(rand() * 9000));

      const check = (target: VFSEngine, ctx: string) => {
        // Every tracked name reads its group's bytes…
        const inoByGroup = new Map<number, number>();
        for (const [name, g] of group) {
          expect(readOf(target, name), `${ctx} content ${name}`).toBe(content.get(g));
          const st = statOf(target, name);
          // …and names in a group share one inode, while names in different groups do not.
          const seen = inoByGroup.get(g);
          if (seen === undefined) inoByGroup.set(g, st.ino);
          else expect(st.ino, `${ctx} shared ino ${name}`).toBe(seen);
          expect(st.nlink, `${ctx} nlink ${name}`).toBe(
            [...group.values()].filter(x => x === g).length,
          );
        }
        expect(new Set(inoByGroup.values()).size, `${ctx} distinct inos`).toBe(inoByGroup.size);
        // No name exists that the model does not know about.
        const live = names(target).filter(p => p !== '/' && !dirs.includes(p));
        expect(live.sort(), `${ctx} name set`).toEqual([...group.keys()].sort());
        // Free-block accounting agrees with the bitmap.
        expect(freeBlocksOf(target), `${ctx} freeBlocks`).toBe(clearBits(target));
      };

      for (let op = 0; op < 60; op++) {
        const ctx = `seed ${seed} op ${op}`;
        const roll = rand();
        const linked = [...group.keys()];

        if (roll < 0.26 || linked.length === 0) {
          // create or overwrite a file
          const path = rand() < 0.75 || linked.length === 0
            ? join(pick(dirs), `f${counter++}`)
            : pick(linked);
          const g = group.get(path) ?? nextGroup++;
          const body = bodyFor(g);
          expect(e.write(path, enc(body)).status, ctx).toBe(0);
          group.set(path, g);
          content.set(g, body); // a write through one name moves the whole group
        } else if (roll < 0.38) {
          // mkdir
          const path = join(pick(dirs), `d${counter++}`);
          if (e.mkdir(path, 0).status === 0) dirs.push(path);
        } else if (roll < 0.58) {
          // hard link
          const src = pick(linked);
          const dst = join(pick(dirs), `l${counter++}`);
          expect(e.link(src, dst).status, `${ctx} link ${src}→${dst}`).toBe(0);
          group.set(dst, group.get(src)!);
        } else if (roll < 0.74) {
          // unlink
          const path = pick(linked);
          expect(e.unlink(path).status, ctx).toBe(0);
          const g = group.get(path)!;
          group.delete(path);
          if (![...group.values()].includes(g)) content.delete(g);
        } else if (roll < 0.86) {
          // rename
          const from = pick(linked);
          const to = join(pick(dirs), `r${counter++}`);
          expect(e.rename(from, to).status, ctx).toBe(0);
          group.set(to, group.get(from)!);
          group.delete(from);
        } else if (dirs.length > 1) {
          // recursive rmdir — takes every name under it, and any group whose names are all gone
          const path = pick(dirs.filter(d => d !== '/'));
          expect(e.rmdir(path, 1).status, ctx).toBe(0);
          for (let i = dirs.length - 1; i >= 0; i--) {
            if (dirs[i] === path || dirs[i].startsWith(path + '/')) dirs.splice(i, 1);
          }
          for (const name of [...group.keys()]) {
            if (name === path || name.startsWith(path + '/')) group.delete(name);
          }
          for (const g of [...content.keys()]) {
            if (![...group.values()].includes(g)) content.delete(g);
          }
        } else {
          continue;
        }

        check(e, `${ctx} live`);
        e = remountOf(h);
        check(e, `${ctx} remounted`);
      }

      // Everything removed → every block handed back. A leak here is a free that never
      // happened; a negative would be a double free.
      for (const name of [...group.keys()]) expect(e.unlink(name).status).toBe(0);
      for (const d of dirs.filter(x => x !== '/').sort((a, b) => b.length - a.length)) e.rmdir(d, 1);
      expect(volume(e).usedBlocks, `seed ${seed} final`).toBe(baseUsed);
      expect(names(remountOf(h))).toEqual(['/']);
    });
  }
});

/** `remount()` against an explicit handle — the fuzz drives its own volume. */
function remountOf(h: MockSyncHandle): VFSEngine {
  const next = new VFSEngine();
  next.init(h as unknown as FileSystemSyncAccessHandle);
  return next;
}

describe('mount rejects a corrupt hard-link entry rather than mounting a lie', () => {
  it('a link whose target inode is free fails the mount', () => {
    engine.write('/a.txt', enc('x'));
    engine.link('/a.txt', '/b.txt');

    // Free the target inode behind the engine's back, the way a torn write would.
    const raw = new Uint8Array(handle.getSize());
    handle.read(raw, { at: 0 });
    // Inode 0 is '/', 1 is /a.txt, 2 is the link entry for /b.txt.
    const INODE_TABLE_OFFSET = 64;
    raw[INODE_TABLE_OFFSET + 1 * 64] = INODE_TYPE.FREE;
    handle.write(raw, { at: 0 });

    expect(() => remount()).toThrow(/Corrupt VFS/);
  });
});
