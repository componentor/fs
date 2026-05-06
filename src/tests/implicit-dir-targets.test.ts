/**
 * Regression tests for the "implicit directory" target family of bugs.
 *
 * An implicit directory is a path that has no inode of its own but does
 * have descendants in pathIndex (e.g. produced by bulk OPFS import — see
 * vfs-engine.test.ts > "implicit directories"). Several write-side guards
 * historically only checked `pathIndex.has(path)`, missing this case and
 * silently producing impossible filesystem states (file with children,
 * stale descendants surviving a rename, EXCL flags being ignored, etc.).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VFSEngine } from '../src/vfs/engine.js';

class MockSyncHandle {
  private buffer: Uint8Array;
  private size: number;
  constructor(initialSize = 0) { this.buffer = new Uint8Array(initialSize); this.size = initialSize; }
  getSize() { return this.size; }
  truncate(newSize: number) {
    if (newSize > this.buffer.byteLength) {
      const nb = new Uint8Array(newSize);
      nb.set(this.buffer.subarray(0, this.size));
      this.buffer = nb;
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
      const nb = new Uint8Array(end);
      nb.set(this.buffer.subarray(0, this.size));
      this.buffer = nb;
    }
    this.buffer.set(buf, at);
    if (end > this.size) this.size = end;
    return buf.byteLength;
  }
  flush() {}
  close() {}
}

describe('implicit-dir target guards', () => {
  let engine: VFSEngine;

  beforeEach(() => {
    engine = new VFSEngine();
    engine.init(new MockSyncHandle(0) as unknown as FileSystemSyncAccessHandle);
  });

  function makeImplicitDir(path: string, child: string, content = 'child') {
    engine.mkdir(path, 1);
    engine.write(`${path}/${child}`, new TextEncoder().encode(content));
    const pi = (engine as any).pathIndex as Map<string, number>;
    pi.delete(path);
    (engine as any).pathIndexGen++;
  }

  it('rename over an implicit directory cleans up the implicit dir\'s descendants', () => {
    makeImplicitDir('/dst', 'old.js', 'OLD');
    expect(engine.stat('/dst').status).toBe(0);
    expect(engine.read('/dst/old.js').status).toBe(0);

    engine.mkdir('/src', 1);
    engine.write('/src/new.js', new TextEncoder().encode('NEW'));

    const r = engine.rename('/src', '/dst');
    expect(r.status).toBe(0);

    expect(new TextDecoder().decode(engine.read('/dst/new.js').data!)).toBe('NEW');
    expect(engine.read('/dst/old.js').status).not.toBe(0);
  });

  it('write at an implicit directory path returns EISDIR', () => {
    makeImplicitDir('/a', 'b.txt');
    const r = engine.write('/a', new TextEncoder().encode('file-at-a'));
    // EISDIR (CODE_TO_STATUS.EISDIR), not 0
    expect(r.status).not.toBe(0);
    // Implicit dir must remain intact
    expect(engine.read('/a/b.txt').status).toBe(0);
  });

  it('symlink at an implicit directory path returns EEXIST', () => {
    makeImplicitDir('/lnk', 'inside.txt');
    const r = engine.symlink('/elsewhere', '/lnk');
    expect(r.status).not.toBe(0);
    expect(engine.read('/lnk/inside.txt').status).toBe(0);
  });

  it('link at an implicit directory path returns EEXIST', () => {
    engine.write('/source.txt', new TextEncoder().encode('S'));
    makeImplicitDir('/target', 'inside.txt');
    const r = engine.link('/source.txt', '/target');
    expect(r.status).not.toBe(0);
    expect(engine.read('/target/inside.txt').status).toBe(0);
  });

  it('copy with COPYFILE_EXCL to an implicit directory path returns EEXIST', () => {
    engine.write('/source.txt', new TextEncoder().encode('S'));
    makeImplicitDir('/target', 'inside.txt');
    const r = engine.copy('/source.txt', '/target', 1); // COPYFILE_EXCL
    expect(r.status).not.toBe(0);
    expect(engine.read('/target/inside.txt').status).toBe(0);
  });
});
