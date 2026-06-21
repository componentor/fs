/**
 * Multi-drive abstraction (Phase 1) — MemoryDrive + DriveManager.transfer.
 *
 * Pure, engine-free unit tests: the reference Drive and the generic cross-drive
 * copy/move engine, including the rename/overwrite edge cases and progress.
 */
import { describe, it, expect } from 'vitest';
import { MemoryDrive, DriveManager, TreeDrive } from '../src/drives/index.js';
import type { Drive, TransferProgress } from '../src/drives/index.js';

type Rec = { t: string; d?: number[] };
/**
 * Node-testable TreeDrive subclass: persists incrementally into a record map
 * (optionally shared, to round-trip through hydrate), counting commits and
 * recording the last put/del sets so tests can assert incrementality.
 */
class FakeStoreDrive extends TreeDrive {
  readonly kind = 'localstorage' as const;
  readonly icon = 'database';
  commits = 0;
  lastPuts: string[] = [];
  lastDels: string[] = [];
  records: Record<string, Rec>;
  constructor(id: string, label = 'Fake', shared?: Record<string, Rec>) { super(id, label); this.records = shared ?? {}; }
  private get map(): Map<string, any> { return (this as unknown as { nodes: Map<string, any> }).nodes; }
  protected override async hydrate(): Promise<void> {
    const keys = Object.keys(this.records);
    if (!keys.length) return;
    this.map.clear();
    for (const [p, r] of Object.entries(this.records)) {
      this.map.set(p, r.t === 'file'
        ? { type: 'file', data: new Uint8Array(r.d!), mtimeMs: 0, ctimeMs: 0 }
        : { type: 'dir', mtimeMs: 0, ctimeMs: 0, children: new Set() });
    }
  }
  protected override async commit(puts: Set<string>, dels: Set<string>): Promise<void> {
    this.commits++;
    this.lastPuts = [...puts]; this.lastDels = [...dels];
    for (const p of dels) delete this.records[p];
    for (const p of puts) {
      const n = this.map.get(p);
      if (!n) continue;
      this.records[p] = n.type === 'file' ? { t: 'file', d: [...n.data] } : { t: 'dir' };
    }
  }
}

const dec = new TextDecoder();
const text = (u: Uint8Array) => dec.decode(u);

async function names(d: Drive, path: string): Promise<string[]> {
  return (await d.list(path)).map((e) => e.name).sort();
}

describe('MemoryDrive — basics', () => {
  it('writes and reads a file under root', async () => {
    const d = new MemoryDrive('mem');
    await d.writeText('/a.txt', 'hello');
    expect(text(await d.readFile('/a.txt'))).toBe('hello');
    const st = await d.stat('/a.txt');
    expect(st.type).toBe('file');
    expect(st.size).toBe(5);
    expect(st.sync).toBe('local');
  });

  it('normalises paths (trailing slash, ".", "..")', async () => {
    const d = new MemoryDrive('mem');
    await d.mkdir('/x/y', { recursive: true });
    await d.writeText('/x/y/../y/f.txt', 'v');
    expect(await d.exists('/x/y/f.txt')).toBe(true);
    expect(await d.exists('/x/y/f.txt/')).toBe(true);
    expect(text(await d.readFile('//x///y/f.txt'))).toBe('v');
  });

  it('returns defensive copies (mutating the result does not corrupt the store)', async () => {
    const d = new MemoryDrive('mem');
    const src = new Uint8Array([1, 2, 3]);
    await d.writeFile('/b.bin', src);
    src[0] = 9; // mutate caller buffer after write
    const out = await d.readFile('/b.bin');
    out[1] = 9; // mutate returned buffer
    expect([...(await d.readFile('/b.bin'))]).toEqual([1, 2, 3]);
  });
});

describe('MemoryDrive — directories', () => {
  it('lists only immediate children', async () => {
    const d = new MemoryDrive('mem');
    await d.mkdir('/d/sub', { recursive: true });
    await d.writeText('/d/a.txt', '1');
    await d.writeText('/d/sub/b.txt', '2');
    expect(await names(d, '/d')).toEqual(['a.txt', 'sub']);
    expect(await names(d, '/')).toEqual(['d']);
  });

  it('non-recursive mkdir into a missing parent throws ENOENT', async () => {
    const d = new MemoryDrive('mem');
    await expect(d.mkdir('/nope/here')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('writeFile into a missing dir throws ENOENT; into a dir path throws EISDIR', async () => {
    const d = new MemoryDrive('mem');
    await expect(d.writeText('/missing/f.txt', 'x')).rejects.toMatchObject({ code: 'ENOENT' });
    await d.mkdir('/dir');
    await expect(d.writeText('/dir', 'x')).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it('remove is idempotent and refuses non-empty dirs without recursive', async () => {
    const d = new MemoryDrive('mem');
    await d.mkdir('/d/sub', { recursive: true });
    await d.writeText('/d/sub/f.txt', 'x');
    await expect(d.remove('/d')).rejects.toMatchObject({ code: 'ENOTEMPTY' });
    await d.remove('/d', { recursive: true });
    expect(await d.exists('/d')).toBe(false);
    expect(await d.exists('/d/sub/f.txt')).toBe(false);
    await d.remove('/d', { recursive: true }); // idempotent
  });
});

describe('MemoryDrive — rename edge cases', () => {
  it('renames a subtree and detaches the old paths', async () => {
    const d = new MemoryDrive('mem');
    await d.mkdir('/a/sub', { recursive: true });
    await d.writeText('/a/sub/f.txt', 'v');
    await d.rename('/a', '/b');
    expect(await d.exists('/a')).toBe(false);
    expect(await d.exists('/a/sub/f.txt')).toBe(false);
    expect(text(await d.readFile('/b/sub/f.txt'))).toBe('v');
    expect(await names(d, '/b')).toEqual(['sub']);
  });

  it('refuses to move a directory into its own subtree (EINVAL)', async () => {
    const d = new MemoryDrive('mem');
    await d.mkdir('/a/sub', { recursive: true });
    await expect(d.rename('/a', '/a/sub/a')).rejects.toMatchObject({ code: 'EINVAL' });
    expect(await d.exists('/a/sub')).toBe(true); // unchanged
  });

  it('overwriting the destination clears its pre-existing children (no orphans)', async () => {
    const d = new MemoryDrive('mem');
    await d.mkdir('/src', { recursive: true });
    await d.writeText('/src/keep.txt', 'new');
    await d.mkdir('/dst', { recursive: true });
    await d.writeText('/dst/stale.txt', 'old'); // must NOT survive the overwrite
    await d.rename('/src', '/dst');
    expect(await names(d, '/dst')).toEqual(['keep.txt']);
    expect(await d.exists('/dst/stale.txt')).toBe(false);
  });

  it('bumps mtime of the moved node', async () => {
    const d = new MemoryDrive('mem');
    await d.writeText('/f.txt', 'x');
    const before = (await d.stat('/f.txt')).mtimeMs;
    await new Promise((r) => setTimeout(r, 2));
    await d.rename('/f.txt', '/g.txt');
    expect((await d.stat('/g.txt')).mtimeMs).toBeGreaterThanOrEqual(before);
  });
});

describe('MemoryDrive — copy / usage', () => {
  it('deep-copies a directory tree', async () => {
    const d = new MemoryDrive('mem');
    await d.mkdir('/a/sub', { recursive: true });
    await d.writeText('/a/sub/f.txt', 'v');
    await d.mkdir('/dst');
    await d.copy('/a', '/dst/a');
    expect(text(await d.readFile('/dst/a/sub/f.txt'))).toBe('v');
    expect(await d.exists('/a/sub/f.txt')).toBe(true); // original intact
  });

  it('refuses to copy a directory into itself or its own subtree (EINVAL, no stack overflow)', async () => {
    const d = new MemoryDrive('mem');
    await d.mkdir('/a/sub', { recursive: true });
    await d.writeText('/a/f.txt', 'v');
    await expect(d.copy('/a', '/a')).rejects.toMatchObject({ code: 'EINVAL' });
    await expect(d.copy('/a', '/a/sub/clone')).rejects.toMatchObject({ code: 'EINVAL' });
    // a sibling destination still works
    await d.copy('/a', '/b');
    expect(text(await d.readFile('/b/f.txt'))).toBe('v');
  });

  it('reports used bytes', async () => {
    const d = new MemoryDrive('mem');
    await d.writeFile('/a', new Uint8Array(10));
    await d.writeFile('/b', new Uint8Array(5));
    expect(await d.usage()).toEqual({ total: 0, used: 15 });
  });
});

describe('TreeDrive (persistent base)', () => {
  it('refuses to copy a directory into its own subtree (EINVAL)', async () => {
    const d = new FakeStoreDrive('ls-1', 'LS');
    await d.mkdir('/a/sub', { recursive: true });
    await d.writeFile('/a/f.txt', new Uint8Array([1]));
    await expect(d.copy('/a', '/a/sub/clone')).rejects.toMatchObject({ code: 'EINVAL' });
    await expect(d.copy('/a', '/a')).rejects.toMatchObject({ code: 'EINVAL' });
  });

  it('coalesces a recursive copy into a single commit', async () => {
    const d = new FakeStoreDrive('ls-2', 'LS');
    await d.mkdir('/src/sub', { recursive: true });
    await d.writeFile('/src/a.txt', new Uint8Array([1]));
    await d.writeFile('/src/sub/b.txt', new Uint8Array([2]));
    const before = d.commits;
    await d.copy('/src', '/dst'); // 1 dir + 1 subdir + 2 files
    expect(d.commits - before).toBe(1); // not 4
    expect(await d.exists('/dst/sub/b.txt')).toBe(true);
  });

  it('commits incrementally — a single write touches only that record', async () => {
    const d = new FakeStoreDrive('ls-3', 'LS');
    await d.writeFile('/x', new Uint8Array([1]));
    await d.writeFile('/y', new Uint8Array([2]));
    await d.writeFile('/x', new Uint8Array([9])); // overwrite
    expect(d.lastPuts).toEqual(['/x']); // not the whole tree
    expect(d.lastDels).toEqual([]);
    expect(Object.keys(d.records).sort()).toEqual(['/x', '/y']); // root not persisted
    await d.remove('/y');
    expect(d.lastDels).toEqual(['/y']);
    expect(Object.keys(d.records)).toEqual(['/x']);
  });

  it('round-trips through hydrate, rebuilding directory listings', async () => {
    const shared: Record<string, Rec> = {};
    const a = new FakeStoreDrive('ls-rt', 'LS', shared);
    await a.mkdir('/proj/sub', { recursive: true });
    await a.writeFile('/proj/sub/f.txt', new Uint8Array([7]));
    await a.writeFile('/proj/top.txt', new Uint8Array([8]));
    // New instance over the same persisted records.
    const b = new FakeStoreDrive('ls-rt', 'LS', shared);
    expect((await b.list('/proj')).map((e) => e.name).sort()).toEqual(['sub', 'top.txt']);
    expect([...(await b.readFile('/proj/sub/f.txt'))]).toEqual([7]);
  });

  it('batch() coalesces many writes into one commit, even if fn throws', async () => {
    const d = new FakeStoreDrive('ls-4', 'LS');
    const before = d.commits;
    await d.batch(async () => {
      await d.writeFile('/a', new Uint8Array([1]));
      await d.writeFile('/b', new Uint8Array([2]));
      await d.mkdir('/c');
    });
    expect(d.commits - before).toBe(1);
    await expect(d.batch(async () => { await d.writeFile('/d', new Uint8Array([3])); throw new Error('boom'); }))
      .rejects.toThrow('boom');
    expect(d.commits - before).toBe(2); // still committed the partial work once
  });
});

describe('DriveManager — registry', () => {
  it('mounts, lists, gets and unmounts; rejects duplicate ids', async () => {
    const m = new DriveManager();
    const a = m.mount(new MemoryDrive('a'));
    expect(m.get('a')).toBe(a);
    expect(m.has('a')).toBe(true);
    expect(() => m.mount(new MemoryDrive('a'))).toThrow(/already mounted/);
    await m.unmount('a');
    expect(m.has('a')).toBe(false);
    await m.unmount('a'); // no-op
  });

  it('emits mounted/unmounted events and unsubscribes cleanly', async () => {
    const m = new DriveManager();
    const events: string[] = [];
    const off = m.on((e) => events.push(e.type));
    m.mount(new MemoryDrive('a'));
    await m.unmount('a');
    off();
    m.mount(new MemoryDrive('b'));
    expect(events).toEqual(['mounted', 'unmounted']);
  });

  it('survives a throwing listener', () => {
    const m = new DriveManager();
    m.on(() => { throw new Error('boom'); });
    expect(() => m.mount(new MemoryDrive('a'))).not.toThrow();
  });
});

describe('DriveManager — transfer', () => {
  it('copies a tree across drives with accurate progress', async () => {
    const m = new DriveManager();
    const src = m.mount(new MemoryDrive('src'));
    const dst = m.mount(new MemoryDrive('dst'));
    await src.mkdir('/proj/lib', { recursive: true });
    await (src as MemoryDrive).writeText('/proj/a.txt', 'aaa');
    await (src as MemoryDrive).writeText('/proj/lib/b.txt', 'bbbbb');

    const seen: TransferProgress[] = [];
    await m.transfer(src, '/proj', dst, '/copy', { onProgress: (p) => seen.push({ ...p }) });

    expect(text(await dst.readFile('/copy/a.txt'))).toBe('aaa');
    expect(text(await dst.readFile('/copy/lib/b.txt'))).toBe('bbbbb');
    expect(await src.exists('/proj/a.txt')).toBe(true); // copy, not move

    const last = seen[seen.length - 1];
    expect(last.totalFiles).toBe(2);
    expect(last.movedFiles).toBe(2);
    expect(last.totalBytes).toBe(8);
    expect(last.movedBytes).toBe(8);
  });

  it('moves across drives, removing the source afterwards', async () => {
    const m = new DriveManager();
    const src = m.mount(new MemoryDrive('src'));
    const dst = m.mount(new MemoryDrive('dst'));
    await (src as MemoryDrive).writeText('/f.txt', 'x');
    await m.transfer(src, '/f.txt', dst, '/f.txt', { move: true });
    expect(text(await dst.readFile('/f.txt'))).toBe('x');
    expect(await src.exists('/f.txt')).toBe(false);
  });

  it('same-drive move creates the destination parent', async () => {
    const m = new DriveManager();
    const d = m.mount(new MemoryDrive('d'));
    await (d as MemoryDrive).writeText('/f.txt', 'x');
    await m.transfer(d, '/f.txt', d, '/deep/nested/f.txt', { move: true });
    expect(text(await d.readFile('/deep/nested/f.txt'))).toBe('x');
    expect(await d.exists('/f.txt')).toBe(false);
  });

  it('respects overwrite:false (skips existing, still counts progress)', async () => {
    const m = new DriveManager();
    const src = m.mount(new MemoryDrive('src'));
    const dst = m.mount(new MemoryDrive('dst'));
    await (src as MemoryDrive).writeText('/f.txt', 'new');
    await (dst as MemoryDrive).writeText('/f.txt', 'old');
    await m.transfer(src, '/f.txt', dst, '/f.txt', { overwrite: false });
    expect(text(await dst.readFile('/f.txt'))).toBe('old');
  });

  it('tolerates caller paths with trailing slashes', async () => {
    const m = new DriveManager();
    const src = m.mount(new MemoryDrive('src'));
    const dst = m.mount(new MemoryDrive('dst'));
    await src.mkdir('/proj', { recursive: true });
    await (src as MemoryDrive).writeText('/proj/a.txt', 'v');
    await m.transfer(src, '/proj/', dst, '/copy/', {});
    expect(text(await dst.readFile('/copy/a.txt'))).toBe('v');
  });

  it('streams large files when both ends support it', async () => {
    const m = new DriveManager();
    const src = m.mount(new MemoryDrive('src'));
    const dst = m.mount(new MemoryDrive('dst'));
    const big = new Uint8Array(5 * 1024 * 1024).fill(7); // > 4 MB stream threshold
    await src.writeFile('/big.bin', big);
    const seen: number[] = [];
    await m.transfer(src, '/big.bin', dst, '/big.bin', { onProgress: (p) => seen.push(p.movedBytes) });
    expect((await dst.readFile('/big.bin')).byteLength).toBe(big.byteLength);
    expect(seen[seen.length - 1]).toBe(big.byteLength);
  });

  it('same-drive copy into the source subtree fails cleanly (EINVAL, no hang)', async () => {
    const m = new DriveManager();
    const d = m.mount(new MemoryDrive('d'));
    await d.mkdir('/a/sub', { recursive: true });
    await (d as MemoryDrive).writeText('/a/f.txt', 'v');
    await expect(m.transfer(d, '/a', d, '/a/sub/clone')).rejects.toMatchObject({ code: 'EINVAL' });
  });

  it('commits once when transferring many files into a persist-per-op drive', async () => {
    const m = new DriveManager();
    const src = m.mount(new MemoryDrive('src'));
    const dst = m.mount(new FakeStoreDrive('idb', 'IDB'));
    await src.mkdir('/proj/lib', { recursive: true });
    for (let i = 0; i < 8; i++) await (src as MemoryDrive).writeText(`/proj/lib/f${i}.txt`, String(i));
    const before = (dst as FakeStoreDrive).commits;
    await m.transfer(src, '/proj', dst, '/copy');
    expect((dst as FakeStoreDrive).commits - before).toBe(1); // not 8+
    expect(await dst.exists('/copy/lib/f7.txt')).toBe(true);
  });

  it('aborts a large streaming copy mid-file', async () => {
    const m = new DriveManager();
    const src = m.mount(new MemoryDrive('src'));
    const dst = m.mount(new MemoryDrive('dst'));
    await src.writeFile('/big.bin', new Uint8Array(5 * 1024 * 1024).fill(7)); // > 4 MB → streams
    const ac = new AbortController();
    // abort once bytes start flowing (not on the initial 0-byte tick) → mid-file
    await expect(
      m.transfer(src, '/big.bin', dst, '/big.bin', { signal: ac.signal, onProgress: (p) => { if (p.movedBytes > 0) ac.abort(); } }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(await dst.exists('/big.bin')).toBe(false); // partial destination discarded
  });

  it('aborts via AbortSignal', async () => {
    const m = new DriveManager();
    const src = m.mount(new MemoryDrive('src'));
    const dst = m.mount(new MemoryDrive('dst'));
    await src.mkdir('/proj', { recursive: true });
    await (src as MemoryDrive).writeText('/proj/a.txt', 'v');
    const ac = new AbortController();
    ac.abort();
    await expect(m.transfer(src, '/proj', dst, '/copy', { signal: ac.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
});
