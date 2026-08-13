/**
 * The repair worker, driven in-process over a mock OPFS.
 *
 * Repair scans a damaged inode table directly and replays what it finds into a fresh
 * volume. Hard links are the one entry type it cannot replay verbatim: an
 * INODE_TYPE.HARDLINK record names an inode by *index*, and the repaired volume assigns
 * its own indices, so the name has to be turned back into a path and re-created with
 * `link()` after its target exists. Get that wrong and repair silently converts shared
 * names into independent copies — the exact defect real hard links were built to remove,
 * reintroduced by the code that runs when a volume is already in trouble.
 *
 * The path matters more than its rarity suggests: an older build meeting a volume that
 * contains hard links rejects it as corrupt (it validates inode types against a range
 * that stops at SYMLINK) and hands it straight to this worker. So repair is not only the
 * damaged-volume path, it is the downgrade path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VFSEngine } from '../src/vfs/engine.js';
import { MockSyncHandle } from './helpers/mock-handle.js';
import { installMockOPFS, snapshot, type MockDirectoryHandle } from './helpers/mock-opfs.js';
import { decodeStats } from '../src/stats.js';
import { SUPERBLOCK, INODE, INODE_SIZE, INODE_TYPE } from '../src/vfs/layout.js';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

interface RepairReport {
  recovered: number;
  lost: number;
  entries: Array<{ path: string; type: string; size: number; contentLost: boolean }>;
}

let opfs: { root: MockDirectoryHandle; restore: () => void };
let onmessage: (event: { data: unknown }) => void;

beforeEach(async () => {
  opfs = installMockOPFS();

  // The worker installs its handler on `self` at import time, so `self` has to exist
  // before the import — and the module is cached, so the handler is captured once and
  // re-pointed at a fresh postMessage per call.
  if (!(globalThis as any).self) (globalThis as any).self = globalThis;
  await import('../src/workers/repair.worker.js');
  onmessage = (globalThis as any).self.onmessage;
  expect(typeof onmessage, 'the worker registered its message handler').toBe('function');
});

afterEach(() => {
  opfs.restore();
});

/** Send the worker a message and settle on the reply it posts back. */
function ask<T>(message: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    (globalThis as any).self.postMessage = (reply: any) => {
      if (reply && reply.error) reject(new Error(reply.error));
      else resolve(reply as T);
    };
    onmessage({ data: message });
  });
}

const repair = () => ask<RepairReport>({ type: 'repair', root: '/' });

/** Build a volume with `build`, then plant its bytes as the `.vfs.bin` repair will find. */
async function plantVolume(build: (engine: VFSEngine) => void): Promise<Uint8Array> {
  const handle = new MockSyncHandle(0);
  const engine = new VFSEngine();
  engine.init(handle as unknown as FileSystemSyncAccessHandle);
  build(engine);
  engine.flush();

  const bytes = snapshot(handle);
  const file = await opfs.root.getFileHandle('.vfs.bin', { create: true });
  file.setBytes(bytes);
  return bytes;
}

/** Overwrite the planted `.vfs.bin` — for the corruption cases. */
async function replantVolume(bytes: Uint8Array): Promise<void> {
  const file = await opfs.root.getFileHandle('.vfs.bin', { create: true });
  file.setBytes(bytes);
}

/** Mount whatever repair left behind at `.vfs.bin`. */
async function mountRepaired(): Promise<VFSEngine> {
  const file = await opfs.root.getFileHandle('.vfs.bin');
  const engine = new VFSEngine();
  engine.init(await file.createSyncAccessHandle() as unknown as FileSystemSyncAccessHandle);
  return engine;
}

const st = (e: VFSEngine, p: string) => {
  const r = e.stat(p);
  expect(r.status, `stat ${p}`).toBe(0);
  return decodeStats(r.data!);
};

const readOf = (e: VFSEngine, p: string) => {
  const r = e.read(p);
  expect(r.status, `read ${p}`).toBe(0);
  return dec(r.data!);
};

/**
 * Walk a raw volume's inode table. Repair reads the table directly, so the corruption
 * cases have to reach in at the same level rather than going through the engine.
 */
function inodeTable(bytes: Uint8Array) {
  const sb = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const inodeCount = sb.getUint32(SUPERBLOCK.INODE_COUNT, true);
  const inodeOffset = sb.getFloat64(SUPERBLOCK.INODE_OFFSET, true);
  const pathOffset = sb.getFloat64(SUPERBLOCK.PATH_OFFSET, true);
  const decoder = new TextDecoder();

  const entries: Array<{ index: number; offset: number; type: number; path: string }> = [];
  for (let i = 0; i < inodeCount; i++) {
    const off = inodeOffset + i * INODE_SIZE;
    if (off + INODE_SIZE > bytes.byteLength) break;
    const type = bytes[off + INODE.TYPE];
    if (type === INODE_TYPE.FREE) continue;
    const view = new DataView(bytes.buffer, bytes.byteOffset + off, INODE_SIZE);
    const po = view.getUint32(INODE.PATH_OFFSET, true);
    const pl = view.getUint16(INODE.PATH_LENGTH, true);
    const start = pathOffset + po;
    entries.push({
      index: i,
      offset: off,
      type,
      path: decoder.decode(bytes.subarray(start, start + pl)),
    });
  }
  return entries;
}

describe('repair rebuilds hard links as links, not as copies', () => {
  it('a file and its two extra names come back sharing one inode', async () => {
    await plantVolume(e => {
      e.write('/a', enc('shared bytes'));
      e.link('/a', '/b');
      e.link('/a', '/c');
    });

    const report = await repair();
    expect(report.lost).toBe(0);

    const e = await mountRepaired();
    for (const p of ['/a', '/b', '/c']) expect(readOf(e, p)).toBe('shared bytes');

    const ino = st(e, '/a').ino;
    expect(st(e, '/b').ino, '/b shares the inode').toBe(ino);
    expect(st(e, '/c').ino, '/c shares the inode').toBe(ino);
    for (const p of ['/a', '/b', '/c']) expect(st(e, p).nlink, p).toBe(3);
  });

  it('the repaired names are still ONE file: a write through any of them moves all', async () => {
    // The assertion that separates a rebuilt link from a rebuilt copy. A copy passes
    // every check above and fails this one.
    await plantVolume(e => {
      e.write('/a', enc('before'));
      e.link('/a', '/b');
    });
    await repair();

    const e = await mountRepaired();
    e.write('/b', enc('after, and longer'));
    expect(readOf(e, '/a')).toBe('after, and longer');
    expect(st(e, '/a').size).toBe('after, and longer'.length);
  });

  it('does not copy the data: one set of blocks backs every name', async () => {
    const used = (e: VFSEngine) => {
      const r = e.statfs('/');
      const dv = new DataView(r.data!.buffer, r.data!.byteOffset, r.data!.byteLength);
      return dv.getUint32(8, true) - dv.getUint32(12, true);
    };

    await plantVolume(e => { e.write('/a', enc('x'.repeat(20000))); });
    await repair();
    const alone = used(await mountRepaired());

    await plantVolume(e => {
      e.write('/a', enc('x'.repeat(20000)));
      e.link('/a', '/b');
      e.link('/a', '/c');
    });
    await repair();
    const linked = await mountRepaired();

    expect(used(linked), 'three names, one copy of the data').toBe(alone);
    expect(readOf(linked, '/c')).toBe('x'.repeat(20000));
  });

  it('rebuilds links in nested directories, under their own paths', async () => {
    await plantVolume(e => {
      e.mkdir('/src/deep', 1, 0o755);
      e.mkdir('/other', 1, 0o755);
      e.write('/src/deep/file.txt', enc('nested'));
      e.link('/src/deep/file.txt', '/other/alias.txt');
      e.link('/src/deep/file.txt', '/top.txt');
    });

    const report = await repair();
    expect(report.lost).toBe(0);

    const e = await mountRepaired();
    const ino = st(e, '/src/deep/file.txt').ino;
    expect(st(e, '/other/alias.txt').ino).toBe(ino);
    expect(st(e, '/top.txt').ino).toBe(ino);
    expect(readOf(e, '/other/alias.txt')).toBe('nested');
  });

  it('reports the rebuilt name as the file it now is', async () => {
    await plantVolume(e => {
      e.write('/a', enc('twelve bytes'));
      e.link('/a', '/b');
    });

    const report = await repair();
    const b = report.entries.find(x => x.path === '/b');
    expect(b, 'the link name is reported').toBeDefined();
    expect(b!.type).toBe('file');
    expect(b!.size).toBe('twelve bytes'.length);
    expect(b!.contentLost).toBe(false);
    expect(report.recovered).toBe(report.entries.length);
  });

  it('a link surviving alongside a target whose content was lost still resolves', async () => {
    // The target's blocks are out of bounds, so it is recovered empty and flagged
    // contentLost. The NAME survived, which is all the link needs to be rebuilt.
    const bytes = await plantVolume(e => {
      e.write('/a', enc('doomed content'));
      e.link('/a', '/b');
    });

    const target = inodeTable(bytes).find(x => x.path === '/a' && x.type === INODE_TYPE.FILE)!;
    const view = new DataView(bytes.buffer, bytes.byteOffset + target.offset, INODE_SIZE);
    view.setUint32(INODE.FIRST_BLOCK, 0xffffff, true); // far past the data region
    await replantVolume(bytes);

    const report = await repair();
    expect(report.entries.find(x => x.path === '/a')!.contentLost).toBe(true);

    const e = await mountRepaired();
    expect(readOf(e, '/b')).toBe('');
    expect(st(e, '/b').ino).toBe(st(e, '/a').ino);
    expect(st(e, '/a').nlink).toBe(2);
  });

  it('a file whose own name was lost is recovered under a hard link that named it', async () => {
    // The one damaged thing about this file is the single path its inode stored. Its data
    // is intact and a second name for it is sitting in the table — so the file comes back
    // under that name rather than being discarded with the path.
    const bytes = await plantVolume(e => {
      e.write('/a', enc('unreachable by its own name'));
      e.link('/a', '/b');
      e.write('/keep', enc('fine'));
    });

    const target = inodeTable(bytes).find(x => x.path === '/a' && x.type === INODE_TYPE.FILE)!;
    const view = new DataView(bytes.buffer, bytes.byteOffset + target.offset, INODE_SIZE);
    view.setUint16(INODE.PATH_LENGTH, 0, true); // the stored path is now unreadable
    await replantVolume(bytes);

    const report = await repair();
    expect(report.lost, 'nothing was lost — the data and a name for it both survived').toBe(0);
    expect(report.entries.map(x => x.path)).toContain('/b');
    expect(report.entries.map(x => x.path), 'the damaged name is gone').not.toContain('/a');

    const e = await mountRepaired();
    expect(readOf(e, '/b')).toBe('unreachable by its own name');
    expect(st(e, '/b').nlink, 'one name now, not a link to a file that has none').toBe(1);
    expect(e.read('/a').status).not.toBe(0);
    expect(readOf(e, '/keep'), 'the rest of the volume is unaffected').toBe('fine');
  });

  it('the other links to a rescued file are still links to it', async () => {
    // Two names reached the inode. One becomes the name the file is recovered under; the
    // rest have to be replayed against it, or the rescue would split the file into copies.
    const bytes = await plantVolume(e => {
      e.write('/a', enc('two names left'));
      e.link('/a', '/b');
      e.link('/a', '/c');
    });

    const target = inodeTable(bytes).find(x => x.path === '/a' && x.type === INODE_TYPE.FILE)!;
    new DataView(bytes.buffer, bytes.byteOffset + target.offset, INODE_SIZE)
      .setUint16(INODE.PATH_LENGTH, 0, true);
    await replantVolume(bytes);

    const report = await repair();
    expect(report.lost).toBe(0);

    const e = await mountRepaired();
    expect(readOf(e, '/b')).toBe('two names left');
    expect(readOf(e, '/c')).toBe('two names left');
    expect(st(e, '/c').ino, 'still one inode').toBe(st(e, '/b').ino);
    expect(st(e, '/b').nlink).toBe(2);

    e.write('/c', enc('and still shared'));
    expect(readOf(e, '/b')).toBe('and still shared');
  });

  it('a rescued file whose content was also lost comes back empty, under the link name', async () => {
    const bytes = await plantVolume(e => {
      e.write('/a', enc('doomed twice over'));
      e.link('/a', '/b');
    });

    const target = inodeTable(bytes).find(x => x.path === '/a' && x.type === INODE_TYPE.FILE)!;
    const view = new DataView(bytes.buffer, bytes.byteOffset + target.offset, INODE_SIZE);
    view.setUint16(INODE.PATH_LENGTH, 0, true);
    view.setUint32(INODE.FIRST_BLOCK, 0xffffff, true);
    await replantVolume(bytes);

    const report = await repair();
    const b = report.entries.find(x => x.path === '/b')!;
    expect(b.contentLost, 'the name was rescued, the bytes were not').toBe(true);
    expect(report.lost).toBe(1);
    expect(readOf(await mountRepaired(), '/b')).toBe('');
  });

  it('a file no surviving name reaches at all is lost', async () => {
    // The counterpart to the rescue: with no link naming it, an inode whose path is
    // unreadable has nothing to be recovered as.
    const bytes = await plantVolume(e => {
      e.write('/a', enc('nothing names this'));
      e.write('/keep', enc('fine'));
    });

    const target = inodeTable(bytes).find(x => x.path === '/a' && x.type === INODE_TYPE.FILE)!;
    new DataView(bytes.buffer, bytes.byteOffset + target.offset, INODE_SIZE)
      .setUint16(INODE.PATH_LENGTH, 0, true);
    await replantVolume(bytes);

    const report = await repair();
    expect(report.lost).toBe(1);
    expect(report.entries.map(x => x.path)).toEqual(['/keep']);
    expect(readOf(await mountRepaired(), '/keep')).toBe('fine');
  });

  it('a link with no readable name of its own is dropped', async () => {
    // It names something, but under no name anyone could reach. The file it named is
    // untouched by that.
    const bytes = await plantVolume(e => {
      e.write('/a', enc('intact'));
      e.link('/a', '/b');
    });

    const link = inodeTable(bytes).find(x => x.type === INODE_TYPE.HARDLINK)!;
    new DataView(bytes.buffer, bytes.byteOffset + link.offset, INODE_SIZE)
      .setUint16(INODE.PATH_LENGTH, 0, true);
    await replantVolume(bytes);

    const report = await repair();
    expect(report.lost).toBe(1);

    const e = await mountRepaired();
    expect(readOf(e, '/a')).toBe('intact');
    expect(st(e, '/a').nlink).toBe(1);
    expect(e.read('/b').status).not.toBe(0);
  });

  it('a link pointing at a directory inode is refused rather than replayed', async () => {
    // Unreachable through `link()`, which is EPERM on a directory — so this is corruption,
    // and repair has to reject the entry instead of building something a mount will throw on.
    const bytes = await plantVolume(e => {
      e.mkdir('/d', 1, 0o755);
      e.write('/a', enc('x'));
      e.link('/a', '/b');
    });

    const table = inodeTable(bytes);
    const dir = table.find(x => x.path === '/d' && x.type === INODE_TYPE.DIRECTORY)!;
    const link = table.find(x => x.type === INODE_TYPE.HARDLINK)!;
    const view = new DataView(bytes.buffer, bytes.byteOffset + link.offset, INODE_SIZE);
    view.setUint32(INODE.LINK_TARGET, dir.index, true);
    await replantVolume(bytes);

    const report = await repair();
    expect(report.lost).toBe(1);
    expect(report.entries.map(x => x.path)).not.toContain('/b');

    // The repaired volume mounts — which is the point: an entry repair could not replay
    // must not become an entry the mount scan rejects.
    const e = await mountRepaired();
    expect(readOf(e, '/a')).toBe('x');
    expect(st(e, '/a').nlink).toBe(1);
    expect(e.readdir('/d').status).toBe(0);
  });

  it('leaves no temp file behind', async () => {
    await plantVolume(e => {
      e.write('/a', enc('x'));
      e.link('/a', '/b');
    });
    await repair();
    expect(opfs.root.children.has('.vfs.bin.tmp')).toBe(false);
    expect(opfs.root.children.has('.vfs.bin')).toBe(true);
  });
});

describe('repair leaves the rest of the volume alone', () => {
  it('files, directories and symlinks come back with hard links in the mix', async () => {
    await plantVolume(e => {
      e.mkdir('/dir', 1, 0o755);
      e.write('/dir/one.txt', enc('one'));
      e.write('/two.txt', enc('two'));
      e.symlink('/two.txt', '/link-to-two');
      e.link('/dir/one.txt', '/dir/one-again.txt');
    });

    const report = await repair();
    expect(report.lost).toBe(0);

    const e = await mountRepaired();
    expect(readOf(e, '/dir/one.txt')).toBe('one');
    expect(readOf(e, '/two.txt')).toBe('two');
    expect(dec(e.readlink('/link-to-two').data!)).toBe('/two.txt');
    expect(st(e, '/dir/one-again.txt').ino).toBe(st(e, '/dir/one.txt').ino);
    expect(e.readdir('/dir').status).toBe(0);
  });
});
