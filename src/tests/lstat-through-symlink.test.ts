/**
 * Test: lstat through symlink chains
 *
 * Reproduces the pnpm virtual store scenario where:
 * 1. Package files live in a store: /store/pkg/1.0.0/templates/vanilla/...
 * 2. A symlink points to the store: /node_modules/.pnpm/pkg@1.0.0/node_modules/pkg → /store/pkg/1.0.0
 * 3. lstat on /node_modules/.pnpm/pkg@1.0.0/node_modules/pkg/templates/vanilla should work
 *
 * stat() succeeds (follows all symlinks) but lstat() fails because
 * resolvePathFull with followLast=false can't find children of symlink targets.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VFSEngine } from '../src/vfs/engine.js';
import { SUPERBLOCK } from '../src/vfs/layout.js';

class MockSyncHandle {
  private buffer: Uint8Array;
  private size: number;

  constructor(initialSize: number = 0) {
    this.buffer = new Uint8Array(initialSize);
    this.size = initialSize;
  }

  getSize(): number { return this.size; }

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

describe('lstat through symlink chains', () => {
  let engine: VFSEngine;

  beforeEach(() => {
    engine = new VFSEngine();
    const handle = new MockSyncHandle(0);
    engine.init(handle as unknown as FileSystemSyncAccessHandle);

    // Create the store structure (real files)
    engine.mkdir('/store', 0);
    engine.mkdir('/store/pkg', 0);
    engine.mkdir('/store/pkg/1.0.0', 0);
    engine.mkdir('/store/pkg/1.0.0/templates', 0);
    engine.mkdir('/store/pkg/1.0.0/templates/vanilla', 0);
    engine.write('/store/pkg/1.0.0/templates/vanilla/index.ts', new TextEncoder().encode('export default {}'));
    engine.write('/store/pkg/1.0.0/package.json', new TextEncoder().encode('{"name":"pkg"}'));

    // Create the pnpm virtual store structure
    engine.mkdir('/node_modules', 0);
    engine.mkdir('/node_modules/.pnpm', 0);
    engine.mkdir('/node_modules/.pnpm/pkg@1.0.0', 0);
    engine.mkdir('/node_modules/.pnpm/pkg@1.0.0/node_modules', 0);

    // Symlink: pkg → store
    engine.symlink('/store/pkg/1.0.0', '/node_modules/.pnpm/pkg@1.0.0/node_modules/pkg');
  });

  it('stat should resolve files through symlink', () => {
    const result = engine.stat('/node_modules/.pnpm/pkg@1.0.0/node_modules/pkg/templates/vanilla');
    expect(result.status).toBe(0);
  });

  it('lstat should resolve non-symlink files through intermediate symlinks', () => {
    // This is the failing case: lstat on a regular directory behind a symlink
    const result = engine.lstat('/node_modules/.pnpm/pkg@1.0.0/node_modules/pkg/templates/vanilla');
    expect(result.status).toBe(0);
  });

  it('lstat should resolve files through symlink', () => {
    const result = engine.lstat('/node_modules/.pnpm/pkg@1.0.0/node_modules/pkg/templates/vanilla/index.ts');
    expect(result.status).toBe(0);
  });

  it('lstat on the symlink itself should return symlink stats', () => {
    const result = engine.lstat('/node_modules/.pnpm/pkg@1.0.0/node_modules/pkg');
    expect(result.status).toBe(0);
    // Should be a symlink type (type=3)
    if (result.data) {
      expect(result.data[0]).toBe(3); // INODE_TYPE.SYMLINK
    }
  });

  it('stat on the symlink should return target stats (directory)', () => {
    const result = engine.stat('/node_modules/.pnpm/pkg@1.0.0/node_modules/pkg');
    expect(result.status).toBe(0);
    if (result.data) {
      expect(result.data[0]).toBe(2); // INODE_TYPE.DIRECTORY
    }
  });

  it('lstat should work for package.json through symlink', () => {
    const result = engine.lstat('/node_modules/.pnpm/pkg@1.0.0/node_modules/pkg/package.json');
    expect(result.status).toBe(0);
  });

  it('exists should find files through symlink', () => {
    const result = engine.exists('/node_modules/.pnpm/pkg@1.0.0/node_modules/pkg/templates/vanilla');
    expect(result.status).toBe(0);
    expect(result.data).toBeTruthy();
    if (result.data) {
      expect(result.data[0]).toBe(1); // exists = true
    }
  });

  it('readdir should list contents through symlink', () => {
    const result = engine.readdir('/node_modules/.pnpm/pkg@1.0.0/node_modules/pkg/templates', 0);
    expect(result.status).toBe(0);
    // Should contain 'vanilla' directory
    expect(result.data).toBeTruthy();
    if (result.data) {
      const names = new TextDecoder().decode(result.data).split('\0').filter(Boolean);
      expect(names).toContain('vanilla');
    }
  });

  it('readdir should list contents of subdirectory through symlink', () => {
    const result = engine.readdir('/node_modules/.pnpm/pkg@1.0.0/node_modules/pkg/templates/vanilla', 0);
    expect(result.status).toBe(0);
    expect(result.data).toBeTruthy();
    if (result.data) {
      const names = new TextDecoder().decode(result.data).split('\0').filter(Boolean);
      expect(names).toContain('index.ts');
    }
  });

  // Test with VFS reload (simulates browser page reload)
  it('lstat should work after VFS remount (persisted state)', () => {
    // Get the underlying handle from the current engine
    // The mock handle retains all data — simulates OPFS persistence
    const handle = new MockSyncHandle(0);
    const engine1 = new VFSEngine();
    engine1.init(handle as unknown as FileSystemSyncAccessHandle);

    // Create store + symlink in first engine instance
    engine1.mkdir('/store', 0);
    engine1.mkdir('/store/pkg', 0);
    engine1.mkdir('/store/pkg/1.0.0', 0);
    engine1.mkdir('/store/pkg/1.0.0/templates', 0);
    engine1.mkdir('/store/pkg/1.0.0/templates/vanilla', 0);
    engine1.write('/store/pkg/1.0.0/templates/vanilla/index.ts', new TextEncoder().encode('test'));
    engine1.mkdir('/node_modules', 0);
    engine1.mkdir('/node_modules/.pnpm', 0);
    engine1.mkdir('/node_modules/.pnpm/pkg@1.0.0', 0);
    engine1.mkdir('/node_modules/.pnpm/pkg@1.0.0/node_modules', 0);
    engine1.symlink('/store/pkg/1.0.0', '/node_modules/.pnpm/pkg@1.0.0/node_modules/pkg');

    // Verify it works before remount
    expect(engine1.lstat('/node_modules/.pnpm/pkg@1.0.0/node_modules/pkg/templates/vanilla').status).toBe(0);

    // Create second engine from same handle (simulates page reload)
    const engine2 = new VFSEngine();
    engine2.init(handle as unknown as FileSystemSyncAccessHandle);

    // This is the critical test — does lstat work after remount?
    expect(engine2.stat('/node_modules/.pnpm/pkg@1.0.0/node_modules/pkg/templates/vanilla').status).toBe(0);
    expect(engine2.lstat('/node_modules/.pnpm/pkg@1.0.0/node_modules/pkg/templates/vanilla').status).toBe(0);
  });

  // Deeper nesting: symlink chain with multiple levels
  it('lstat should work with deeply nested paths through symlink', () => {
    // Add deeper nesting in store
    engine.mkdir('/store/pkg/1.0.0/templates/vanilla/src', 0);
    engine.write('/store/pkg/1.0.0/templates/vanilla/src/app.ts', new TextEncoder().encode('// app'));

    const result = engine.lstat('/node_modules/.pnpm/pkg@1.0.0/node_modules/pkg/templates/vanilla/src/app.ts');
    expect(result.status).toBe(0);
  });
});
