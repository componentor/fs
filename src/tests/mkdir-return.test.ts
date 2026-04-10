/**
 * mkdir return value tests
 *
 * Verifies that mkdirSync/mkdir return the correct values per Node.js spec:
 * - recursive: true returns the first directory that was created, or undefined if all existed
 * - recursive: false (or omitted) returns undefined on success
 *
 * Tests both the method layer (with mocks) and the VFS engine directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, mkdir } from '../src/methods/mkdir.js';
import { OP } from '../src/protocol/opcodes.js';
import { VFSEngine } from '../src/vfs/engine.js';

const encoder = new TextEncoder();

// ---- Method-level tests (mocked transport) ----

describe('mkdir return values (method layer)', () => {
  it('mkdirSync recursive returns first created path from data', () => {
    const syncRequest = vi.fn().mockReturnValue({
      status: 0,
      data: encoder.encode('/a'),
    });

    const result = mkdirSync(syncRequest, '/a/b/c', { recursive: true });
    expect(result).toBe('/a');
  });

  it('mkdirSync recursive returns undefined when all dirs existed', () => {
    const syncRequest = vi.fn().mockReturnValue({
      status: 0,
      data: null,
    });

    const result = mkdirSync(syncRequest, '/existing', { recursive: true });
    expect(result).toBeUndefined();
  });

  it('mkdirSync without recursive returns undefined on success', () => {
    const syncRequest = vi.fn().mockReturnValue({
      status: 0,
      data: null,
    });

    const result = mkdirSync(syncRequest, '/newdir');
    expect(result).toBeUndefined();
  });

  it('async mkdir recursive returns first created path', async () => {
    const asyncRequest = vi.fn().mockResolvedValue({
      status: 0,
      data: encoder.encode('/a'),
    });

    const result = await mkdir(asyncRequest, '/a/b/c', { recursive: true });
    expect(result).toBe('/a');
  });

  it('async mkdir recursive returns undefined when all existed', async () => {
    const asyncRequest = vi.fn().mockResolvedValue({
      status: 0,
      data: null,
    });

    const result = await mkdir(asyncRequest, '/existing', { recursive: true });
    expect(result).toBeUndefined();
  });

  it('async mkdir without recursive returns undefined on success', async () => {
    const asyncRequest = vi.fn().mockResolvedValue({
      status: 0,
      data: null,
    });

    const result = await mkdir(asyncRequest, '/newdir');
    expect(result).toBeUndefined();
  });
});

// ---- VFS Engine-level tests ----

class MockSyncHandle {
  private buffer: Uint8Array;
  private size: number;

  constructor(initialSize: number = 0) {
    this.buffer = new Uint8Array(initialSize);
    this.size = initialSize;
  }

  getSize(): number {
    return this.size;
  }

  truncate(newSize: number): void {
    if (newSize > this.buffer.byteLength) {
      const newBuf = new Uint8Array(newSize);
      newBuf.set(this.buffer.subarray(0, this.size));
      this.buffer = newBuf;
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
      const newBuf = new Uint8Array(end * 2);
      newBuf.set(this.buffer.subarray(0, this.size));
      this.buffer = newBuf;
    }
    this.buffer.set(buf, at);
    if (end > this.size) this.size = end;
    return buf.byteLength;
  }

  flush(): void {}
  close(): void {}
}

const decoder = new TextDecoder();

describe('mkdir return values (VFS engine)', () => {
  let engine: VFSEngine;

  beforeEach(() => {
    engine = new VFSEngine();
    const handle = new MockSyncHandle(0);
    engine.init(handle as unknown as FileSystemSyncAccessHandle);
  });

  it('recursive mkdir returns first created directory path', () => {
    const result = engine.mkdir('/a/b/c', 1); // flags=1 means recursive
    expect(result.status).toBe(0);
    expect(result.data).not.toBeNull();
    expect(decoder.decode(result.data!)).toBe('/a');
  });

  it('recursive mkdir on fully existing path returns null data', () => {
    engine.mkdir('/a/b/c', 1);
    const result = engine.mkdir('/a/b/c', 1);
    expect(result.status).toBe(0);
    expect(result.data).toBeNull();
  });

  it('recursive mkdir returns first new segment when partial path exists', () => {
    engine.mkdir('/a', 1);
    const result = engine.mkdir('/a/b/c', 1);
    expect(result.status).toBe(0);
    expect(result.data).not.toBeNull();
    expect(decoder.decode(result.data!)).toBe('/a/b');
  });

  it('non-recursive mkdir returns null data on success', () => {
    const result = engine.mkdir('/newdir', 0);
    expect(result.status).toBe(0);
    expect(result.data).toBeNull();
  });
});
