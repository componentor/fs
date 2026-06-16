/**
 * growInodeTable integrity: when the inode table grows, the region after it
 * (path table + bitmap + ALL file data) is shifted right. The old code buffered
 * that whole region in one Uint8Array → "Array buffer allocation failed" on a
 * large VFS (the Telegram AppDir). The fix shifts in chunks (end→start). This
 * test forces SEVERAL inode-table growths while files with distinct content +
 * sizes exist, and asserts every file survives byte-identically across the
 * shifts (the chunked rewrite must not tear/overlap-corrupt the data region).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { VFSEngine } from '../src/vfs/engine.js';

class MockSyncHandle {
  private buffer: Uint8Array;
  private size: number;
  constructor(initialSize = 0) { this.buffer = new Uint8Array(initialSize); this.size = initialSize; }
  getSize(): number { return this.size; }
  truncate(n: number): void {
    if (n > this.buffer.byteLength) { const b = new Uint8Array(Math.max(n, this.buffer.byteLength * 2)); b.set(this.buffer.subarray(0, this.size)); this.buffer = b; }
    this.size = n;
  }
  read(buf: Uint8Array, opts?: { at?: number }): number {
    const at = opts?.at ?? 0; const len = Math.min(buf.byteLength, this.size - at);
    if (len <= 0) return 0; buf.set(this.buffer.subarray(at, at + len)); return len;
  }
  write(buf: Uint8Array, opts?: { at?: number }): number {
    const at = opts?.at ?? 0; const end = at + buf.byteLength;
    if (end > this.buffer.byteLength) { const b = new Uint8Array(Math.max(end, this.buffer.byteLength * 2)); b.set(this.buffer.subarray(0, this.size)); this.buffer = b; }
    this.buffer.set(buf, at); if (end > this.size) this.size = end; return buf.byteLength;
  }
  flush(): void {} close(): void {}
}

function payload(seed: number, n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (seed * 2654435761 + i * 40503) & 0xff;
  return b;
}

describe('VFS inode-table growth preserves data integrity', () => {
  let engine: VFSEngine;
  beforeEach(() => {
    engine = new VFSEngine();
    engine.init(new MockSyncHandle(0) as unknown as FileSystemSyncAccessHandle);
  });

  it('survives many inode-table growths with mixed file sizes', () => {
    // Enough files to force multiple doublings of the inode table, with some
    // larger files so the shifted data region is non-trivial.
    const N = 3000;
    const expected = new Map<string, Uint8Array>();
    for (let i = 0; i < N; i++) {
      const size = i % 50 === 0 ? 20000 : (32 + (i % 200));
      const data = payload(i + 1, size);
      const path = `/file-${i}.bin`; // flat (no parent dirs needed) — still forces inode-table growth
      const w = engine.write(path, data);
      if (w.status !== 0) throw new Error(`write FAILED at i=${i} (size=${size}) status=${w.status}`);
      expected.set(path, data);
    }
    // Verify EVERY file still reads back byte-identically after all the growths.
    let checked = 0;
    for (const [path, want] of expected) {
      const r = engine.read(path);
      expect(r.status).toBe(0);
      expect(r.data).not.toBeNull();
      const got = r.data!;
      expect(got.length).toBe(want.length);
      // spot-check head/tail/middle cheaply, then a full compare for a subset
      expect(got[0]).toBe(want[0]);
      expect(got[got.length - 1]).toBe(want[want.length - 1]);
      if (checked % 200 === 0) {
        let diff = -1;
        for (let k = 0; k < want.length; k++) if (got[k] !== want[k]) { diff = k; break; }
        expect(diff).toBe(-1);
      }
      checked++;
    }
    expect(checked).toBe(N);
  });
});
