/**
 * Reproduction: large single-file write→read round-trip in the VFS engine.
 * Mirrors the observed browser corruption of a 542,880-byte ELF (libOpenGL.so.0):
 * stored with the right SIZE but garbage CONTENT. If the VFS engine corrupts a
 * large file here, this localizes the bug to vfs/engine.ts (independent of OPFS
 * mirror / SAB transport / fetch).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { VFSEngine } from '../src/vfs/engine.js';

class MockSyncHandle {
  private buffer: Uint8Array;
  private size: number;
  constructor(initialSize: number = 0) { this.buffer = new Uint8Array(initialSize); this.size = initialSize; }
  getSize(): number { return this.size; }
  truncate(newSize: number): void {
    if (newSize > this.buffer.byteLength) { const n = new Uint8Array(newSize); n.set(this.buffer.subarray(0, this.size)); this.buffer = n; }
    this.size = newSize;
  }
  read(buf: Uint8Array, opts?: { at?: number }): number {
    const at = opts?.at ?? 0; const len = Math.min(buf.byteLength, this.size - at);
    if (len <= 0) return 0; buf.set(this.buffer.subarray(at, at + len)); return len;
  }
  write(buf: Uint8Array, opts?: { at?: number }): number {
    const at = opts?.at ?? 0; const end = at + buf.byteLength;
    if (end > this.buffer.byteLength) { const n = new Uint8Array(end * 2); n.set(this.buffer.subarray(0, this.size)); this.buffer = n; }
    this.buffer.set(buf, at); if (end > this.size) this.size = end; return buf.byteLength;
  }
  flush(): void {} close(): void {}
}

// Recognizable content: ELF magic, then a deterministic per-offset pattern so any
// corruption is obvious AND localizable (we can see WHICH region is wrong).
function makePayload(n: number): Uint8Array {
  const b = new Uint8Array(n);
  b[0] = 0x7f; b[1] = 0x45; b[2] = 0x4c; b[3] = 0x46; // \x7fELF
  for (let i = 4; i < n; i++) b[i] = (i * 2654435761) & 0xff; // Knuth hash → spread
  return b;
}
function firstDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

describe('VFS large-file round-trip (libOpenGL repro)', () => {
  let engine: VFSEngine;
  beforeEach(() => {
    engine = new VFSEngine();
    engine.init(new MockSyncHandle(0) as unknown as FileSystemSyncAccessHandle);
  });

  const SIZES = [4096, 65536, 524287, 524288, 542880 /* libOpenGL */, 600000, 1048576, 5_000_000];
  for (const n of SIZES) {
    it(`round-trips a ${n}-byte file byte-identically`, () => {
      const payload = makePayload(n);
      const w = engine.write(`/lib-${n}.so`, payload);
      expect(w.status).toBe(0);
      const r = engine.read(`/lib-${n}.so`);
      expect(r.status).toBe(0);
      expect(r.data).not.toBeNull();
      const got = r.data!;
      expect(got.length).toBe(n);
      const d = firstDiff(payload, got);
      if (d !== -1) {
        const ctx = (arr: Uint8Array) => Array.from(arr.subarray(Math.max(0, d - 2), d + 6)).map((x) => x.toString(16).padStart(2, '0')).join(' ');
        throw new Error(`size=${n}: first diff at byte ${d} (block ${Math.floor(d / 4096)}); want [${ctx(payload)}] got [${ctx(got)}]; head got [${Array.from(got.subarray(0, 8)).map((x) => x.toString(16).padStart(2, '0')).join(' ')}]`);
      }
      expect(d).toBe(-1);
    });
  }
});
