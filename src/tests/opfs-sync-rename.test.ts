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
import { planRenameMirror, type OpfsSyncMessage } from '../src/workers/opfs-sync-plan.js';

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
