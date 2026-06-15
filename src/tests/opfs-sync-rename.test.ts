/**
 * planRenameMirror — how a VFS rename is mirrored to the OPFS sync worker.
 *
 * Regression coverage for the atomic-write rename bug (write temp; rename
 * temp → final): the temp is created and renamed inside the sync debounce
 * window, so it is never mirrored to OPFS, and forwarding a plain 'rename' op
 * then fails in the mirror with "source not found". The fix mirrors a regular
 * file as write(newPath) + delete(path) from the destination's authoritative
 * bytes, and only falls back to a 'rename' op for directories.
 *
 * Runs against VFSEngine directly (no browser/SAB), matching the other engine
 * tests. By the time notifyOPFSSync fires, the rename has already committed in
 * the VFS, so the destination path holds the content and the source is gone.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VFSEngine } from '../src/vfs/engine.js';
import {
  planRenameMirror,
  planPendingReroutes,
  resolveLinkTarget,
  registerLink,
  deregisterLink,
  collectKeysUnder,
  coalesceWriteIndex,
  type OpfsSyncMessage,
} from '../src/workers/opfs-sync-plan.js';

// Minimal in-memory sync access handle (same shape used by the other engine tests).
class MockSyncHandle {
  private buffer: Uint8Array;
  private size: number;
  constructor(initialSize = 0) {
    this.buffer = new Uint8Array(initialSize);
    this.size = initialSize;
  }
  getSize(): number { return this.size; }
  truncate(newSize: number): void {
    if (newSize > this.buffer.byteLength) {
      const next = new Uint8Array(newSize);
      next.set(this.buffer.subarray(0, this.size));
      this.buffer = next;
    }
    this.size = newSize;
  }
  read(buf: Uint8Array, opts?: { at?: number }): number {
    const at = opts?.at ?? 0;
    const len = Math.min(buf.byteLength, this.size - at);
    if (len <= 0) return 0;
    buf.set(this.buffer.subarray(at, at + len));
    return len;
  }
  write(buf: Uint8Array, opts?: { at?: number }): number {
    const at = opts?.at ?? 0;
    const end = at + buf.byteLength;
    if (end > this.buffer.byteLength) {
      const next = new Uint8Array(end * 2);
      next.set(this.buffer.subarray(0, this.size));
      this.buffer = next;
    }
    this.buffer.set(buf, at);
    if (end > this.size) this.size = end;
    return buf.byteLength;
  }
  flush(): void {}
  close(): void {}
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const TS = 12345;

const bytes = (m: OpfsSyncMessage) =>
  m.op === 'write' ? new Uint8Array(m.data) : new Uint8Array(0);

describe('engine.rename POSIX type-conflict guards', () => {
  let engine: VFSEngine;
  // Status codes from protocol/opcodes CODE_TO_STATUS.
  const EISDIR = 3, ENOTDIR = 4;

  beforeEach(() => {
    engine = new VFSEngine();
    engine.init(new MockSyncHandle(0) as unknown as FileSystemSyncAccessHandle);
  });

  it('rejects renaming a FILE onto an existing DIRECTORY with EISDIR', () => {
    engine.write('/a', enc.encode('file'));
    engine.mkdir('/b');
    engine.write('/b/child.txt', enc.encode('x'));
    expect(engine.rename('/a', '/b').status).toBe(EISDIR);
    // Nothing changed: /a still a file, /b still a dir with its child.
    expect(engine.read('/a').status).toBe(0);
    expect(engine.read('/b/child.txt').status).toBe(0);
  });

  it('rejects renaming a DIRECTORY onto an existing FILE with ENOTDIR', () => {
    engine.mkdir('/d');
    engine.write('/d/x', enc.encode('x'));
    engine.write('/f', enc.encode('file'));
    expect(engine.rename('/d', '/f').status).toBe(ENOTDIR);
    expect(engine.read('/f').status).toBe(0);
    expect(engine.read('/d/x').status).toBe(0);
  });

  it('still allows file→file and dir→dir (incl. non-empty target) replacement', () => {
    engine.write('/src.txt', enc.encode('new'));
    engine.write('/dst.txt', enc.encode('old'));
    expect(engine.rename('/src.txt', '/dst.txt').status).toBe(0);
    expect(dec.decode(engine.read('/dst.txt').data!)).toBe('new');

    // dir → non-empty dir replace is deliberately permitted (Vite deps commit).
    engine.mkdir('/srcdir');
    engine.write('/srcdir/keep.js', enc.encode('keep'));
    engine.mkdir('/dstdir');
    engine.write('/dstdir/stale.js', enc.encode('stale'));
    expect(engine.rename('/srcdir', '/dstdir').status).toBe(0);
    expect(engine.read('/dstdir/keep.js').status).toBe(0);
    expect(engine.read('/dstdir/stale.js').status).not.toBe(0); // replaced, not merged
  });
});

describe('planRenameMirror', () => {
  let engine: VFSEngine;

  beforeEach(() => {
    engine = new VFSEngine();
    engine.init(new MockSyncHandle(0) as unknown as FileSystemSyncAccessHandle);
  });

  it('mirrors an atomic-write rename (temp never mirrored) as write(final) + delete(temp)', () => {
    // Rename has already committed: content lives at the destination, source is gone.
    engine.mkdir('/app');
    engine.write('/app/config.json', enc.encode('{"final":true}'));

    const plan = planRenameMirror(engine, '/app/.config.json.tmp', '/app/config.json', TS);

    expect(plan.messages.map((m) => m.op)).toEqual(['write', 'delete']);

    const [write, del] = plan.messages;
    expect(write).toMatchObject({ op: 'write', path: '/app/config.json', ts: TS });
    expect(dec.decode(bytes(write))).toBe('{"final":true}');
    expect(del).toEqual({ op: 'delete', path: '/app/.config.json.tmp', ts: TS });

    // The non-empty write payload is offered to the postMessage transfer list.
    expect(plan.transfers).toHaveLength(1);
    expect(plan.transfers[0]).toBe((write as { data: ArrayBuffer }).data);

    // Crucially: it is NOT a 'rename' op, which the mirror could not satisfy
    // because the temp source was never written to OPFS.
    expect(plan.messages.some((m) => m.op === 'rename')).toBe(false);
  });

  it('mirrors an empty destination file as a 0-byte write + delete (nothing to transfer)', () => {
    engine.write('/touched', new Uint8Array(0));

    const plan = planRenameMirror(engine, '/touched.tmp', '/touched', TS);

    expect(plan.messages.map((m) => m.op)).toEqual(['write', 'delete']);
    const [write] = plan.messages;
    expect((write as { data: ArrayBuffer }).data.byteLength).toBe(0);
    expect(plan.transfers).toHaveLength(0);
  });

  it('falls back to a real rename op for a directory rename (engine reports EISDIR)', () => {
    engine.mkdir('/src-dir');
    engine.write('/src-dir/file.txt', enc.encode('x'));

    const plan = planRenameMirror(engine, '/src-dir', '/dst-dir', TS);

    expect(plan.messages).toEqual([
      { op: 'rename', path: '/src-dir', newPath: '/dst-dir', ts: TS },
    ]);
    expect(plan.transfers).toHaveLength(0);
  });

  it('falls back to a rename op when the destination does not exist (non-zero read status)', () => {
    const plan = planRenameMirror(engine, '/gone', '/also-gone', TS);

    expect(plan.messages).toEqual([
      { op: 'rename', path: '/gone', newPath: '/also-gone', ts: TS },
    ]);
  });
});

describe('planPendingReroutes', () => {
  it('re-keys pending child syncs from the old dir prefix to the new one', () => {
    // The Vite case: deps_temp_X is populated then renamed to deps; recently
    // written children are still pending when the directory rename fires.
    const pending = [
      '/app/.vite/deps_temp_abc/vue.js',
      '/app/.vite/deps_temp_abc/sub/chunk.js',
    ];

    const reroutes = planPendingReroutes(pending, '/app/.vite/deps_temp_abc', '/app/.vite/deps');

    expect(reroutes).toEqual([
      { from: '/app/.vite/deps_temp_abc/vue.js', to: '/app/.vite/deps/vue.js' },
      { from: '/app/.vite/deps_temp_abc/sub/chunk.js', to: '/app/.vite/deps/sub/chunk.js' },
    ]);
  });

  it('only matches strict descendants — not the dir itself or sibling prefixes', () => {
    const pending = [
      '/d',            // the renamed dir's own key (never debounced, but guard anyway)
      '/d2/x.js',      // sibling sharing a name prefix — must NOT match
      '/d/a.js',       // genuine descendant
    ];

    const reroutes = planPendingReroutes(pending, '/d', '/e');

    expect(reroutes).toEqual([{ from: '/d/a.js', to: '/e/a.js' }]);
  });

  it('returns nothing for a file rename (no descendants under path + "/")', () => {
    const pending = ['/dir/a.tmp', '/other.txt'];

    expect(planPendingReroutes(pending, '/dir/a.tmp', '/dir/a.txt')).toEqual([]);
  });
});

describe('resolveLinkTarget', () => {
  it('resolves a relative target against the link directory', () => {
    expect(resolveLinkTarget('/dir/link', 'target.js')).toBe('/dir/target.js');
    expect(resolveLinkTarget('/a/b/link', './x')).toBe('/a/b/x');
    expect(resolveLinkTarget('/dir/link', '../shared/t')).toBe('/shared/t');
    expect(resolveLinkTarget('/a/b/c/link', '../../t')).toBe('/a/t');
  });

  it('normalizes an absolute target as-is', () => {
    expect(resolveLinkTarget('/dir/link', '/abs/t')).toBe('/abs/t');
    expect(resolveLinkTarget('/dir/link', '/a/./b/../t')).toBe('/a/t');
  });

  it('resolves a relative target for a link at the root', () => {
    expect(resolveLinkTarget('/link', 't')).toBe('/t');
  });
});

describe('symlink alias bookkeeping (registerLink / deregisterLink)', () => {
  let forward: Map<string, Set<string>>;
  let reverse: Map<string, string>;
  beforeEach(() => { forward = new Map(); reverse = new Map(); });

  it('registers a link under its target and reverse-maps it', () => {
    registerLink(forward, reverse, '/link', '/target');
    expect([...forward.get('/target')!]).toEqual(['/link']);
    expect(reverse.get('/link')).toBe('/target');
  });

  it('deregister fully removes the link and prunes an emptied target set (no leak)', () => {
    registerLink(forward, reverse, '/link', '/target');
    deregisterLink(forward, reverse, '/link');
    expect(reverse.has('/link')).toBe(false);
    expect(forward.has('/target')).toBe(false); // set emptied → key pruned
  });

  it('keeps other links when one of several under the same target is removed', () => {
    registerLink(forward, reverse, '/a', '/target');
    registerLink(forward, reverse, '/b', '/target');
    deregisterLink(forward, reverse, '/a');
    expect([...forward.get('/target')!]).toEqual(['/b']);
    expect(reverse.has('/a')).toBe(false);
  });

  it('re-registering a link to a new target moves it (clears the old mapping)', () => {
    registerLink(forward, reverse, '/link', '/old');
    registerLink(forward, reverse, '/link', '/new');
    expect(forward.has('/old')).toBe(false);            // old target pruned
    expect([...forward.get('/new')!]).toEqual(['/link']);
    expect(reverse.get('/link')).toBe('/new');
  });

  it('deregister is a no-op for an unknown link', () => {
    registerLink(forward, reverse, '/link', '/target');
    deregisterLink(forward, reverse, '/missing');
    expect([...forward.get('/target')!]).toEqual(['/link']);
  });
});

describe('collectKeysUnder', () => {
  it('matches the exact path and strict descendants, not sibling prefixes', () => {
    const keys = ['/d', '/d/a', '/d/sub/b', '/d2/x', '/other'];
    expect(collectKeysUnder(keys, '/d').sort()).toEqual(['/d', '/d/a', '/d/sub/b']);
  });

  it('matches a single exact key (unlinked link)', () => {
    expect(collectKeysUnder(['/link', '/link2'], '/link')).toEqual(['/link']);
  });

  it('returns nothing when no key is under the dir', () => {
    expect(collectKeysUnder(['/a', '/b'], '/c')).toEqual([]);
  });
});

describe('coalesceWriteIndex', () => {
  const W = (path: string) => ({ op: 'write', path });
  const D = (path: string) => ({ op: 'delete', path });
  const R = (path: string, newPath: string) => ({ op: 'rename', path, newPath });

  it('coalesces onto a queued write for the same path', () => {
    expect(coalesceWriteIndex([W('/f')], '/f')).toBe(0);
    expect(coalesceWriteIndex([W('/a'), W('/f')], '/f')).toBe(1);
    expect(coalesceWriteIndex([W('/f'), W('/a')], '/f')).toBe(0);
  });

  it('does NOT coalesce across an intervening delete of the same path (the data-loss bug)', () => {
    // queue [write /f, delete /f] + write /f must append, not merge onto index 0,
    // else execution becomes write,delete and the re-created file is lost.
    expect(coalesceWriteIndex([W('/f'), D('/f')], '/f')).toBe(-1);
  });

  it('does NOT coalesce across an intervening rename touching the path', () => {
    expect(coalesceWriteIndex([W('/f'), R('/f', '/g')], '/f')).toBe(-1); // /f renamed away
    expect(coalesceWriteIndex([W('/g'), R('/x', '/g')], '/g')).toBe(-1); // /g is a rename destination
  });

  it('skips unrelated paths while scanning', () => {
    expect(coalesceWriteIndex([W('/f'), D('/a'), W('/b')], '/f')).toBe(0);
  });

  it('returns -1 when there is no queued write for the path', () => {
    expect(coalesceWriteIndex([], '/f')).toBe(-1);
    expect(coalesceWriteIndex([D('/f')], '/f')).toBe(-1);
    expect(coalesceWriteIndex([W('/a')], '/f')).toBe(-1);
  });
});
