/**
 * VFS Engine Unit Tests
 *
 * Tests the core VFS binary format operations in isolation.
 * Uses a mock sync access handle to test without browser OPFS.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VFSEngine } from '../src/vfs/engine.js';
import { VFS_MAGIC, VFS_VERSION, SUPERBLOCK, INODE_TYPE, INODE_SIZE, DEFAULT_INODE_COUNT, DEFAULT_BLOCK_SIZE, INITIAL_DATA_BLOCKS, INITIAL_PATH_TABLE_SIZE, calculateLayout } from '../src/vfs/layout.js';

/**
 * Mock FileSystemSyncAccessHandle backed by an ArrayBuffer.
 * Simulates sync read/write/truncate/flush/getSize.
 */
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

  flush(): void {
    // No-op in mock
  }

  close(): void {
    // No-op in mock
  }
}

describe('VFSEngine', () => {
  let engine: VFSEngine;
  let handle: MockSyncHandle;

  beforeEach(() => {
    engine = new VFSEngine();
    handle = new MockSyncHandle(0);
    engine.init(handle as unknown as FileSystemSyncAccessHandle);
  });

  describe('format and mount', () => {
    it('should format a new VFS', () => {
      // Verify superblock
      const superblock = new Uint8Array(SUPERBLOCK.SIZE);
      handle.read(superblock, { at: 0 });
      const view = new DataView(superblock.buffer);
      expect(view.getUint32(SUPERBLOCK.MAGIC, true)).toBe(VFS_MAGIC);
    });

    it('should mount an existing VFS', () => {
      // Create a second engine and mount from same handle
      const engine2 = new VFSEngine();
      engine2.init(handle as unknown as FileSystemSyncAccessHandle);
      // Should not throw
    });

    it('should have root directory after format', () => {
      const result = engine.stat('/');
      expect(result.status).toBe(0);
    });
  });

  describe('read/write', () => {
    it('should write and read a file', () => {
      const data = new TextEncoder().encode('Hello, VFS!');
      const writeResult = engine.write('/test.txt', data);
      expect(writeResult.status).toBe(0);

      const readResult = engine.read('/test.txt');
      expect(readResult.status).toBe(0);
      expect(new TextDecoder().decode(readResult.data!)).toBe('Hello, VFS!');
    });

    it('should overwrite an existing file', () => {
      engine.write('/test.txt', new TextEncoder().encode('version 1'));
      engine.write('/test.txt', new TextEncoder().encode('version 2'));

      const result = engine.read('/test.txt');
      expect(new TextDecoder().decode(result.data!)).toBe('version 2');
    });

    it('should write empty file', () => {
      engine.write('/empty.txt', new Uint8Array(0));
      const result = engine.read('/empty.txt');
      expect(result.status).toBe(0);
      expect(result.data!.byteLength).toBe(0);
    });

    it('should return ENOENT for non-existent file', () => {
      const result = engine.read('/nonexistent.txt');
      expect(result.status).toBe(1); // ENOENT
    });

    it('should auto-create parent directories on write', () => {
      const data = new TextEncoder().encode('nested');
      engine.mkdir('/a', 1); // recursive
      engine.mkdir('/a/b', 1);
      engine.write('/a/b/file.txt', data);

      const result = engine.read('/a/b/file.txt');
      expect(result.status).toBe(0);
      expect(new TextDecoder().decode(result.data!)).toBe('nested');
    });

    it('should handle large file writes', () => {
      const data = new Uint8Array(100000);
      for (let i = 0; i < data.byteLength; i++) data[i] = i & 0xFF;

      engine.write('/large.bin', data);
      const result = engine.read('/large.bin');
      expect(result.status).toBe(0);
      expect(result.data!.byteLength).toBe(100000);
      expect(result.data![0]).toBe(0);
      expect(result.data![255]).toBe(255);
    });
  });

  describe('append', () => {
    it('should append to existing file', () => {
      engine.write('/log.txt', new TextEncoder().encode('line 1\n'));
      engine.append('/log.txt', new TextEncoder().encode('line 2\n'));

      const result = engine.read('/log.txt');
      expect(new TextDecoder().decode(result.data!)).toBe('line 1\nline 2\n');
    });

    it('should create file if not exists', () => {
      engine.append('/new.txt', new TextEncoder().encode('content'));
      const result = engine.read('/new.txt');
      expect(new TextDecoder().decode(result.data!)).toBe('content');
    });
  });

  describe('unlink', () => {
    it('should delete a file', () => {
      engine.write('/toDelete.txt', new TextEncoder().encode('bye'));
      const result = engine.unlink('/toDelete.txt');
      expect(result.status).toBe(0);

      const readResult = engine.read('/toDelete.txt');
      expect(readResult.status).toBe(1); // ENOENT
    });

    it('should return ENOENT for non-existent file', () => {
      const result = engine.unlink('/nope.txt');
      expect(result.status).toBe(1);
    });

    it('should return EISDIR for directory', () => {
      engine.mkdir('/mydir');
      const result = engine.unlink('/mydir');
      expect(result.status).toBe(3); // EISDIR
    });
  });

  describe('stat', () => {
    it('should stat a file', () => {
      engine.write('/file.txt', new TextEncoder().encode('hello'));
      const result = engine.stat('/file.txt');
      expect(result.status).toBe(0);
      expect(result.data).toBeTruthy();

      const view = new DataView(result.data!.buffer, result.data!.byteOffset);
      const type = view.getUint8(0);
      const size = view.getFloat64(5, true);
      expect(type).toBe(INODE_TYPE.FILE);
      expect(size).toBe(5); // "hello".length
    });

    it('should stat a directory', () => {
      engine.mkdir('/dir');
      const result = engine.stat('/dir');
      expect(result.status).toBe(0);

      const view = new DataView(result.data!.buffer, result.data!.byteOffset);
      expect(view.getUint8(0)).toBe(INODE_TYPE.DIRECTORY);
    });

    it('should stat root', () => {
      const result = engine.stat('/');
      expect(result.status).toBe(0);
    });
  });

  describe('mkdir', () => {
    it('should create a directory', () => {
      const result = engine.mkdir('/newdir');
      expect(result.status).toBe(0);
    });

    it('should return EEXIST for existing directory', () => {
      engine.mkdir('/existing');
      const result = engine.mkdir('/existing');
      expect(result.status).toBe(2); // EEXIST
    });

    it('should create directories recursively', () => {
      const result = engine.mkdir('/a/b/c/d', 1);
      expect(result.status).toBe(0);

      expect(engine.stat('/a').status).toBe(0);
      expect(engine.stat('/a/b').status).toBe(0);
      expect(engine.stat('/a/b/c').status).toBe(0);
      expect(engine.stat('/a/b/c/d').status).toBe(0);
    });
  });

  describe('rmdir', () => {
    it('should remove empty directory', () => {
      engine.mkdir('/emptydir');
      const result = engine.rmdir('/emptydir');
      expect(result.status).toBe(0);
    });

    it('should return ENOTEMPTY for non-empty directory', () => {
      engine.mkdir('/fulldir');
      engine.write('/fulldir/file.txt', new TextEncoder().encode('data'));
      const result = engine.rmdir('/fulldir');
      expect(result.status).toBe(5); // ENOTEMPTY
    });

    it('should remove recursively', () => {
      engine.mkdir('/root/sub', 1);
      engine.write('/root/sub/file.txt', new TextEncoder().encode('data'));
      const result = engine.rmdir('/root', 1);
      expect(result.status).toBe(0);
      expect(engine.stat('/root').status).toBe(1); // ENOENT
    });
  });

  describe('readdir', () => {
    it('should list directory contents', () => {
      engine.mkdir('/listdir');
      engine.write('/listdir/a.txt', new TextEncoder().encode('a'));
      engine.write('/listdir/b.txt', new TextEncoder().encode('b'));
      engine.mkdir('/listdir/sub');

      const result = engine.readdir('/listdir');
      expect(result.status).toBe(0);

      const view = new DataView(result.data!.buffer, result.data!.byteOffset);
      const count = view.getUint32(0, true);
      expect(count).toBe(3);
    });

    it('should return empty for empty directory', () => {
      engine.mkdir('/emptylist');
      const result = engine.readdir('/emptylist');
      expect(result.status).toBe(0);
      const view = new DataView(result.data!.buffer, result.data!.byteOffset);
      expect(view.getUint32(0, true)).toBe(0);
    });

    it('should list with file types', () => {
      engine.mkdir('/typedir');
      engine.write('/typedir/file.txt', new TextEncoder().encode('f'));
      engine.mkdir('/typedir/subdir');

      const result = engine.readdir('/typedir', 1); // withFileTypes flag
      expect(result.status).toBe(0);
    });
  });

  describe('rename', () => {
    it('should rename a file', () => {
      engine.write('/old.txt', new TextEncoder().encode('content'));
      const result = engine.rename('/old.txt', '/new.txt');
      expect(result.status).toBe(0);

      expect(engine.read('/old.txt').status).toBe(1); // ENOENT
      expect(new TextDecoder().decode(engine.read('/new.txt').data!)).toBe('content');
    });

    it('should rename a directory with contents', () => {
      engine.mkdir('/src/deep', 1);
      engine.write('/src/deep/file.txt', new TextEncoder().encode('data'));
      engine.rename('/src', '/dest');

      expect(engine.stat('/src').status).toBe(1);
      expect(engine.stat('/dest').status).toBe(0);
      expect(new TextDecoder().decode(engine.read('/dest/deep/file.txt').data!)).toBe('data');
    });
  });

  describe('exists', () => {
    it('should return true for existing file', () => {
      engine.write('/exists.txt', new TextEncoder().encode('yes'));
      const result = engine.exists('/exists.txt');
      expect(result.data![0]).toBe(1);
    });

    it('should return false for non-existent file', () => {
      const result = engine.exists('/nope.txt');
      expect(result.data![0]).toBe(0);
    });
  });

  describe('truncate', () => {
    it('should truncate file to zero', () => {
      engine.write('/trunc.txt', new TextEncoder().encode('hello world'));
      engine.truncate('/trunc.txt', 0);

      const result = engine.read('/trunc.txt');
      expect(result.data!.byteLength).toBe(0);
    });

    it('should truncate to specific length', () => {
      engine.write('/trunc.txt', new TextEncoder().encode('hello world'));
      engine.truncate('/trunc.txt', 5);

      const result = engine.read('/trunc.txt');
      expect(new TextDecoder().decode(result.data!)).toBe('hello');
    });
  });

  describe('copy', () => {
    it('should copy a file', () => {
      engine.write('/original.txt', new TextEncoder().encode('data'));
      const result = engine.copy('/original.txt', '/copy.txt');
      expect(result.status).toBe(0);

      expect(new TextDecoder().decode(engine.read('/copy.txt').data!)).toBe('data');
    });

    it('should fail with COPYFILE_EXCL if target exists', () => {
      engine.write('/a.txt', new TextEncoder().encode('a'));
      engine.write('/b.txt', new TextEncoder().encode('b'));
      const result = engine.copy('/a.txt', '/b.txt', 1); // COPYFILE_EXCL
      expect(result.status).toBe(2); // EEXIST
    });
  });

  describe('symlink', () => {
    it('should create and read a symlink', () => {
      engine.write('/target.txt', new TextEncoder().encode('target data'));
      engine.symlink('/target.txt', '/link.txt');

      const linkResult = engine.readlink('/link.txt');
      expect(linkResult.status).toBe(0);
      expect(new TextDecoder().decode(linkResult.data!)).toBe('/target.txt');
    });

    it('should follow symlinks on read (via stat)', () => {
      engine.write('/real.txt', new TextEncoder().encode('real'));
      engine.symlink('/real.txt', '/sym.txt');

      const statResult = engine.stat('/sym.txt');
      expect(statResult.status).toBe(0);
      // stat follows symlinks, should return the file's stat
      const view = new DataView(statResult.data!.buffer, statResult.data!.byteOffset);
      expect(view.getUint8(0)).toBe(INODE_TYPE.FILE);
    });

    it('should return symlink inode on lstat', () => {
      engine.write('/real2.txt', new TextEncoder().encode('data'));
      engine.symlink('/real2.txt', '/sym2.txt');

      const lstatResult = engine.lstat('/sym2.txt');
      expect(lstatResult.status).toBe(0);
      const view = new DataView(lstatResult.data!.buffer, lstatResult.data!.byteOffset);
      expect(view.getUint8(0)).toBe(INODE_TYPE.SYMLINK);
    });

    it('should follow absolute symlink on read', () => {
      engine.write('/abs-target.txt', new TextEncoder().encode('absolute target content'));
      engine.symlink('/abs-target.txt', '/abs-link.txt');

      const readResult = engine.read('/abs-link.txt');
      expect(readResult.status).toBe(0);
      expect(new TextDecoder().decode(readResult.data!)).toBe('absolute target content');
    });

    it('should follow relative symlink on read (npm .bin pattern)', () => {
      // Simulates: node_modules/.bin/vite -> ../vite/bin/vite.cjs
      engine.mkdir('/node_modules', 0);
      engine.mkdir('/node_modules/.bin', 0);
      engine.mkdir('/node_modules/vite', 0);
      engine.mkdir('/node_modules/vite/bin', 0);
      engine.write('/node_modules/vite/bin/vite.cjs', new TextEncoder().encode('#!/usr/bin/env node\nconsole.log("vite")'));
      engine.symlink('../vite/bin/vite.cjs', '/node_modules/.bin/vite');

      const readResult = engine.read('/node_modules/.bin/vite');
      expect(readResult.status).toBe(0);
      expect(new TextDecoder().decode(readResult.data!)).toBe('#!/usr/bin/env node\nconsole.log("vite")');
    });

    it('should follow symlink chains', () => {
      engine.write('/chain-target.txt', new TextEncoder().encode('chain end'));
      engine.symlink('/chain-target.txt', '/chain-mid.txt');
      engine.symlink('/chain-mid.txt', '/chain-start.txt');

      const readResult = engine.read('/chain-start.txt');
      expect(readResult.status).toBe(0);
      expect(new TextDecoder().decode(readResult.data!)).toBe('chain end');
    });

    it('should resolve symlinks in intermediate path components', () => {
      // /real-dir/file.txt exists, /link-dir -> /real-dir
      engine.mkdir('/real-dir', 0);
      engine.write('/real-dir/file.txt', new TextEncoder().encode('through dir symlink'));
      engine.symlink('/real-dir', '/link-dir');

      const readResult = engine.read('/link-dir/file.txt');
      expect(readResult.status).toBe(0);
      expect(new TextDecoder().decode(readResult.data!)).toBe('through dir symlink');
    });

    it('should return ENOENT for symlink to non-existent target', () => {
      engine.symlink('/does-not-exist.txt', '/dangling-link.txt');

      const readResult = engine.read('/dangling-link.txt');
      expect(readResult.status).not.toBe(0); // ENOENT
    });

    it('should follow symlink whose target goes through another symlink', () => {
      // /real-lib/util.js exists
      // /lib -> /real-lib (directory symlink)
      // /app/link -> /lib/util.js (target traverses /lib symlink)
      engine.mkdir('/real-lib', 0);
      engine.write('/real-lib/util.js', new TextEncoder().encode('export default 42'));
      engine.symlink('/real-lib', '/lib');
      engine.mkdir('/app', 0);
      engine.symlink('/lib/util.js', '/app/link');

      const readResult = engine.read('/app/link');
      expect(readResult.status).toBe(0);
      expect(new TextDecoder().decode(readResult.data!)).toBe('export default 42');
    });

    it('should follow symlinks with custom root-like prefix paths', () => {
      // Simulates custom root: /vfs-bench/node_modules/.bin/vite -> ../vite/bin/vite.cjs
      engine.mkdir('/vfs-bench', 0);
      engine.mkdir('/vfs-bench/node_modules', 0);
      engine.mkdir('/vfs-bench/node_modules/.bin', 0);
      engine.mkdir('/vfs-bench/node_modules/vite', 0);
      engine.mkdir('/vfs-bench/node_modules/vite/bin', 0);
      engine.write('/vfs-bench/node_modules/vite/bin/vite.cjs', new TextEncoder().encode('vite-cli'));
      engine.symlink('../vite/bin/vite.cjs', '/vfs-bench/node_modules/.bin/vite');

      const readResult = engine.read('/vfs-bench/node_modules/.bin/vite');
      expect(readResult.status).toBe(0);
      expect(new TextDecoder().decode(readResult.data!)).toBe('vite-cli');

      // Also verify stat follows through
      const statResult = engine.stat('/vfs-bench/node_modules/.bin/vite');
      expect(statResult.status).toBe(0);
      const view = new DataView(statResult.data!.buffer, statResult.data!.byteOffset);
      expect(view.getUint8(0)).toBe(INODE_TYPE.FILE);

      // And realpath resolves to the actual file path
      const realpathResult = engine.realpath('/vfs-bench/node_modules/.bin/vite');
      expect(realpathResult.status).toBe(0);
      expect(new TextDecoder().decode(realpathResult.data!)).toBe('/vfs-bench/node_modules/vite/bin/vite.cjs');
    });
  });

  describe('chmod/chown', () => {
    it('should change file mode', () => {
      engine.write('/perm.txt', new TextEncoder().encode('data'));
      engine.chmod('/perm.txt', 0o755);

      const result = engine.stat('/perm.txt');
      const view = new DataView(result.data!.buffer, result.data!.byteOffset);
      const mode = view.getUint32(1, true);
      expect(mode & 0o777).toBe(0o755);
    });

    it('should change file owner', () => {
      engine.write('/owned.txt', new TextEncoder().encode('data'));
      engine.chown('/owned.txt', 1000, 1000);

      const result = engine.stat('/owned.txt');
      const view = new DataView(result.data!.buffer, result.data!.byteOffset);
      expect(view.getUint32(37, true)).toBe(1000); // uid
      expect(view.getUint32(41, true)).toBe(1000); // gid
    });
  });

  describe('utimes', () => {
    it('should update timestamps', () => {
      engine.write('/time.txt', new TextEncoder().encode('data'));
      const now = Date.now();
      engine.utimes('/time.txt', now, now);

      const result = engine.stat('/time.txt');
      const view = new DataView(result.data!.buffer, result.data!.byteOffset);
      const mtime = view.getFloat64(13, true);
      expect(mtime).toBe(now);
    });
  });

  describe('file descriptors', () => {
    it('should open, write, read, close a file', () => {
      const openResult = engine.open('/fd.txt', 64 | 512, 'tab1'); // O_CREAT | O_TRUNC
      expect(openResult.status).toBe(0);
      const fd = new DataView(openResult.data!.buffer, openResult.data!.byteOffset).getUint32(0, true);

      const writeResult = engine.fwrite(fd, new TextEncoder().encode('fd data'), null);
      expect(writeResult.status).toBe(0);

      const readResult = engine.fread(fd, 100, 0);
      expect(readResult.status).toBe(0);
      expect(new TextDecoder().decode(readResult.data!)).toBe('fd data');

      const closeResult = engine.close(fd);
      expect(closeResult.status).toBe(0);
    });

    it('should return EBADF for invalid fd', () => {
      expect(engine.fread(999, 100, 0).status).toBe(8); // EBADF
      expect(engine.close(999).status).toBe(8);
    });
  });

  describe('mkdtemp', () => {
    it('should create a temp directory with prefix', () => {
      const result = engine.mkdtemp('/tmp/test-');
      expect(result.status).toBe(0);
      const path = new TextDecoder().decode(result.data!);
      expect(path.startsWith('/tmp/test-')).toBe(true);
      expect(engine.stat(path).status).toBe(0);
    });
  });

  describe('access', () => {
    it('should succeed for existing file with F_OK', () => {
      engine.write('/acc.txt', new TextEncoder().encode('data'));
      expect(engine.access('/acc.txt', 0).status).toBe(0);
    });

    it('should fail for non-existent file', () => {
      expect(engine.access('/no.txt', 0).status).toBe(1); // ENOENT
    });
  });

  describe('realpath', () => {
    it('should return the resolved path', () => {
      engine.write('/real.txt', new TextEncoder().encode('data'));
      const result = engine.realpath('/real.txt');
      expect(result.status).toBe(0);
      expect(new TextDecoder().decode(result.data!)).toBe('/real.txt');
    });
  });

  describe('tab cleanup', () => {
    it('should clean up fds when tab dies', () => {
      const r1 = engine.open('/fd1.txt', 64, 'dying-tab');
      expect(r1.status).toBe(0);
      const fd = new DataView(r1.data!.buffer, r1.data!.byteOffset).getUint32(0, true);

      engine.cleanupTab('dying-tab');

      // fd should be invalid now
      expect(engine.fread(fd, 100, 0).status).toBe(8); // EBADF
    });
  });

  describe('corruption detection', () => {
    /** Creates a valid formatted VFS handle that can be corrupted before mounting */
    function createFormattedHandle(): MockSyncHandle {
      const fmt = new VFSEngine();
      const h = new MockSyncHandle(0);
      fmt.init(h as unknown as FileSystemSyncAccessHandle);
      return h;
    }

    /** Overwrite uint32 at byte offset */
    function patchU32(h: MockSyncHandle, offset: number, value: number): void {
      const buf = new Uint8Array(4);
      new DataView(buf.buffer).setUint32(0, value, true);
      h.write(buf, { at: offset });
    }

    /** Overwrite float64 at byte offset */
    function patchF64(h: MockSyncHandle, offset: number, value: number): void {
      const buf = new Uint8Array(8);
      new DataView(buf.buffer).setFloat64(0, value, true);
      h.write(buf, { at: offset });
    }

    it('should reject file too small for superblock', () => {
      const h = new MockSyncHandle(0);
      // Write only 10 bytes — smaller than SUPERBLOCK.SIZE (64)
      h.write(new Uint8Array(10), { at: 0 });
      const e = new VFSEngine();
      expect(() => e.init(h as unknown as FileSystemSyncAccessHandle))
        .toThrow('Corrupt VFS: file too small');
    });

    it('should reject bad magic', () => {
      const h = createFormattedHandle();
      patchU32(h, SUPERBLOCK.MAGIC, 0xDEADBEEF);
      const e = new VFSEngine();
      expect(() => e.init(h as unknown as FileSystemSyncAccessHandle))
        .toThrow('Corrupt VFS: bad magic 0xdeadbeef');
    });

    it('should reject unsupported version', () => {
      const h = createFormattedHandle();
      patchU32(h, SUPERBLOCK.VERSION, 99);
      const e = new VFSEngine();
      expect(() => e.init(h as unknown as FileSystemSyncAccessHandle))
        .toThrow('Corrupt VFS: unsupported version 99');
    });

    it('should reject block size of 0', () => {
      const h = createFormattedHandle();
      patchU32(h, SUPERBLOCK.BLOCK_SIZE, 0);
      const e = new VFSEngine();
      expect(() => e.init(h as unknown as FileSystemSyncAccessHandle))
        .toThrow('Corrupt VFS: invalid block size 0');
    });

    it('should reject non-power-of-2 block size', () => {
      const h = createFormattedHandle();
      patchU32(h, SUPERBLOCK.BLOCK_SIZE, 3000);
      const e = new VFSEngine();
      expect(() => e.init(h as unknown as FileSystemSyncAccessHandle))
        .toThrow('Corrupt VFS: invalid block size 3000');
    });

    it('should reject inode count of 0', () => {
      const h = createFormattedHandle();
      patchU32(h, SUPERBLOCK.INODE_COUNT, 0);
      const e = new VFSEngine();
      expect(() => e.init(h as unknown as FileSystemSyncAccessHandle))
        .toThrow('Corrupt VFS: inode count is 0');
    });

    it('should reject free blocks exceeding total', () => {
      const h = createFormattedHandle();
      patchU32(h, SUPERBLOCK.FREE_BLOCKS, 999999);
      const e = new VFSEngine();
      expect(() => e.init(h as unknown as FileSystemSyncAccessHandle))
        .toThrow('Corrupt VFS: free blocks');
    });

    it('should reject wrong inode table offset', () => {
      const h = createFormattedHandle();
      patchF64(h, SUPERBLOCK.INODE_OFFSET, 999);
      const e = new VFSEngine();
      expect(() => e.init(h as unknown as FileSystemSyncAccessHandle))
        .toThrow('Corrupt VFS: inode table offset');
    });

    it('should reject path used exceeding path table size', () => {
      const h = createFormattedHandle();
      patchU32(h, SUPERBLOCK.PATH_USED, 999999999);
      const e = new VFSEngine();
      expect(() => e.init(h as unknown as FileSystemSyncAccessHandle))
        .toThrow('Corrupt VFS: path used');
    });

    it('should reject file too small for declared layout', () => {
      const h = createFormattedHandle();
      // Set total blocks to a huge number, but file is still the same small size
      patchU32(h, SUPERBLOCK.TOTAL_BLOCKS, 1000000);
      const e = new VFSEngine();
      expect(() => e.init(h as unknown as FileSystemSyncAccessHandle))
        .toThrow('Corrupt VFS: file size');
    });

    it('should reject VFS with missing root directory', () => {
      const h = createFormattedHandle();
      // Zero out the entire inode table to remove root dir inode
      const layout = calculateLayout(DEFAULT_INODE_COUNT, DEFAULT_BLOCK_SIZE, INITIAL_DATA_BLOCKS);
      const zeroBuf = new Uint8Array(layout.inodeTableSize);
      h.write(zeroBuf, { at: layout.inodeTableOffset });
      const e = new VFSEngine();
      expect(() => e.init(h as unknown as FileSystemSyncAccessHandle))
        .toThrow('Corrupt VFS: root directory "/" not found');
    });

    it('should call closeHandle without error on a valid engine', () => {
      // closeHandle on the already-initialized engine from beforeEach
      expect(() => engine.closeHandle()).not.toThrow();
    });

    it('should accept a valid formatted VFS on remount', () => {
      const h = createFormattedHandle();
      const e = new VFSEngine();
      // Should not throw — valid VFS
      expect(() => e.init(h as unknown as FileSystemSyncAccessHandle)).not.toThrow();
    });

    it('should reject inode count exceeding default max', () => {
      const h = createFormattedHandle();
      patchU32(h, SUPERBLOCK.INODE_COUNT, 5_000_000);
      const e = new VFSEngine();
      expect(() => e.init(h as unknown as FileSystemSyncAccessHandle))
        .toThrow('Corrupt VFS: inode count 5000000 exceeds maximum 4000000');
    });

    it('should reject total blocks exceeding default max', () => {
      const h = createFormattedHandle();
      patchU32(h, SUPERBLOCK.TOTAL_BLOCKS, 5_000_000);
      const e = new VFSEngine();
      expect(() => e.init(h as unknown as FileSystemSyncAccessHandle))
        .toThrow('Corrupt VFS: total blocks 5000000 exceeds maximum 4000000');
    });

    it('should reject non-finite section offsets', () => {
      const h = createFormattedHandle();
      patchF64(h, SUPERBLOCK.INODE_OFFSET, NaN);
      const e = new VFSEngine();
      expect(() => e.init(h as unknown as FileSystemSyncAccessHandle))
        .toThrow('Corrupt VFS: non-finite or negative section offset');
    });

    it('should reject negative section offsets', () => {
      const h = createFormattedHandle();
      patchF64(h, SUPERBLOCK.DATA_OFFSET, -1);
      const e = new VFSEngine();
      expect(() => e.init(h as unknown as FileSystemSyncAccessHandle))
        .toThrow('Corrupt VFS: non-finite or negative section offset');
    });

    it('should reject path table exceeding max size via custom limit', () => {
      const h = createFormattedHandle();
      // Default path table is 256KB — set max to 10 bytes to trigger rejection
      const e = new VFSEngine();
      expect(() => e.init(h as unknown as FileSystemSyncAccessHandle, { limits: { maxPathTable: 10 } }))
        .toThrow('Corrupt VFS: path table size');
    });

    it('should respect custom limits.maxInodes', () => {
      const h = createFormattedHandle();
      // Default inode count is 100000, set max to 100
      const e = new VFSEngine();
      expect(() => e.init(h as unknown as FileSystemSyncAccessHandle, { limits: { maxInodes: 100 } }))
        .toThrow('Corrupt VFS: inode count 100000 exceeds maximum 100');
    });

    it('should respect custom limits.maxBlocks', () => {
      const h = createFormattedHandle();
      // Default blocks is 1024, set max to 100
      const e = new VFSEngine();
      expect(() => e.init(h as unknown as FileSystemSyncAccessHandle, { limits: { maxBlocks: 100 } }))
        .toThrow('Corrupt VFS: total blocks 1024 exceeds maximum 100');
    });

    it('should respect custom limits.maxVFSSize', () => {
      const h = createFormattedHandle();
      // Set max VFS size to 1KB — any valid VFS is bigger than that
      const e = new VFSEngine();
      expect(() => e.init(h as unknown as FileSystemSyncAccessHandle, { limits: { maxVFSSize: 1024 } }))
        .toThrow('Corrupt VFS: file size');
    });

    it('should respect custom limits.maxPathTable', () => {
      const h = createFormattedHandle();
      // Default path table is 256KB, set max to 100 bytes
      const e = new VFSEngine();
      expect(() => e.init(h as unknown as FileSystemSyncAccessHandle, { limits: { maxPathTable: 100 } }))
        .toThrow('Corrupt VFS: path table size');
    });

    it('should accept valid VFS with elevated limits', () => {
      const h = createFormattedHandle();
      const e = new VFSEngine();
      // Huge limits — should not affect a normal VFS
      expect(() => e.init(h as unknown as FileSystemSyncAccessHandle, {
        limits: { maxInodes: 100_000_000, maxBlocks: 100_000_000, maxVFSSize: 1e15, maxPathTable: 1e12 },
      })).not.toThrow();
    });
  });

  describe('sparse writes (POSIX hole semantics)', () => {
    // POSIX guarantees that a write past the current end-of-file creates
    // a "hole" — the bytes between the old EOF and the write position
    // must read back as zeros, not whatever stale data lived in the
    // underlying storage blocks. Covers every grow path in `fwrite`:
    //   1. Hole fits inside existing blocks (no allocation).
    //   2. Hole spans into newly-allocated blocks (growth path).
    //   3. Write position coincides with end-of-file (no hole).

    function openForWrite(path: string): number {
      // O_CREAT | O_WRONLY = 64 | 1 = 65
      const r = engine.open(path, 64 | 1, 'tab1');
      return new DataView((r.data as Uint8Array).buffer, (r.data as Uint8Array).byteOffset, 4).getUint32(0, true);
    }

    it('should zero-fill a hole that fits inside existing blocks', () => {
      // Pre-populate a 10-byte file so inode has one block already.
      engine.write('/hole.bin', new TextEncoder().encode('0123456789'));
      const fd = openForWrite('/hole.bin');
      // Write 4 bytes at position 100 — gap is [10, 100), well inside
      // the first 512-byte block. No new blocks needed.
      engine.fwrite(fd, new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]), 100);
      const r = engine.read('/hole.bin');
      expect(r.status).toBe(0);
      const data = r.data!;
      expect(data.byteLength).toBe(104);
      // Original bytes preserved.
      expect(new TextDecoder().decode(data.subarray(0, 10))).toBe('0123456789');
      // Hole reads as zeros.
      for (let i = 10; i < 100; i++) expect(data[i]).toBe(0);
      // Caller's bytes landed at the right offset.
      expect(data[100]).toBe(0xaa);
      expect(data[103]).toBe(0xdd);
    });

    it('should zero-fill a hole that spans into newly-allocated blocks', () => {
      engine.write('/bighole.bin', new TextEncoder().encode('head'));
      const fd = openForWrite('/bighole.bin');
      // Block size is 512, write 4 bytes at position 8192 — forces the
      // file to grow across many new blocks.
      const pos = 8192;
      engine.fwrite(fd, new Uint8Array([1, 2, 3, 4]), pos);
      const r = engine.read('/bighole.bin');
      expect(r.status).toBe(0);
      const data = r.data!;
      expect(data.byteLength).toBe(pos + 4);
      expect(new TextDecoder().decode(data.subarray(0, 4))).toBe('head');
      // Every byte in the hole must be zero.
      let nonZero = 0;
      for (let i = 4; i < pos; i++) if (data[i] !== 0) nonZero++;
      expect(nonZero).toBe(0);
      expect(data[pos]).toBe(1);
      expect(data[pos + 3]).toBe(4);
    });

    it('should not allocate an unnecessary hole when pos === size', () => {
      engine.write('/nohole.bin', new TextEncoder().encode('abc'));
      const fd = openForWrite('/nohole.bin');
      engine.fwrite(fd, new Uint8Array([4, 5, 6]), 3);
      const r = engine.read('/nohole.bin');
      const data = r.data!;
      expect(data.byteLength).toBe(6);
      expect(Array.from(data)).toEqual([0x61, 0x62, 0x63, 4, 5, 6]);
    });
  });

  describe('chunked large-buffer operations', () => {
    // These regression-guard the chunked-copy rewrites in `fwrite` grow,
    // `append`, `truncate` extend, and `copy`. The mock handle can't
    // simulate the ~2 GB Chrome allocation cap that motivated the
    // rewrites, so instead we use a moderately sized buffer (5 MB) that
    // crosses the 4 MB internal scratch-chunk boundary and verify the
    // resulting bytes are byte-identical — proving the chunk loop
    // reassembles correctly.

    const FIVE_MB = 5 * 1024 * 1024;

    function pattern(len: number): Uint8Array {
      const buf = new Uint8Array(len);
      for (let i = 0; i < len; i++) buf[i] = (i * 31 + 7) & 0xff;
      return buf;
    }

    it('should append across the 4 MB chunk boundary and preserve bytes', () => {
      const head = pattern(FIVE_MB);
      const tail = pattern(1024);
      engine.write('/a.bin', head);
      engine.append('/a.bin', tail);
      const r = engine.read('/a.bin');
      expect(r.status).toBe(0);
      const data = r.data!;
      expect(data.byteLength).toBe(FIVE_MB + 1024);
      // Check a few bytes at the boundaries and across the 4 MB split.
      expect(data[0]).toBe(head[0]);
      expect(data[FIVE_MB - 1]).toBe(head[FIVE_MB - 1]);
      expect(data[FIVE_MB]).toBe(tail[0]);
      expect(data[FIVE_MB + 1023]).toBe(tail[1023]);
      // Spot-check the middle of the first chunk and the second chunk.
      const midFirst = 2 * 1024 * 1024;
      const midSecond = 4 * 1024 * 1024 + 512 * 1024;
      expect(data[midFirst]).toBe(head[midFirst]);
      expect(data[midSecond]).toBe(head[midSecond]);
    });

    it('should fwrite-grow across the 4 MB chunk boundary and preserve bytes', () => {
      const base = pattern(FIVE_MB);
      engine.write('/b.bin', base);
      const openR = engine.open('/b.bin', 64 | 1, 'tab1');
      const fd = new DataView((openR.data as Uint8Array).buffer, (openR.data as Uint8Array).byteOffset, 4).getUint32(0, true);
      // Append 1 KB at the tail via fwrite — must trigger the grow path
      // and copy existing 5 MB through the chunk loop.
      const tail = pattern(1024);
      engine.fwrite(fd, tail, FIVE_MB);
      const r = engine.read('/b.bin');
      const data = r.data!;
      expect(data.byteLength).toBe(FIVE_MB + 1024);
      expect(data[0]).toBe(base[0]);
      expect(data[FIVE_MB - 1]).toBe(base[FIVE_MB - 1]);
      expect(data[FIVE_MB]).toBe(tail[0]);
      expect(data[FIVE_MB + 1023]).toBe(tail[1023]);
    });

    it('should truncate-extend with zero-fill across the 4 MB chunk boundary', () => {
      engine.write('/t.bin', new TextEncoder().encode('seed'));
      const newLen = FIVE_MB;
      engine.truncate('/t.bin', newLen);
      const r = engine.read('/t.bin');
      const data = r.data!;
      expect(data.byteLength).toBe(newLen);
      expect(new TextDecoder().decode(data.subarray(0, 4))).toBe('seed');
      // Every byte past the seed must be zero.
      let nonZero = 0;
      // Sample across the chunk boundary instead of scanning the whole
      // buffer — much faster and still catches a bogus loop.
      for (let i = 4; i < 8192; i++) if (data[i] !== 0) nonZero++;
      for (let i = FIVE_MB - 8192; i < FIVE_MB; i++) if (data[i] !== 0) nonZero++;
      const near4MB = 4 * 1024 * 1024;
      for (let i = near4MB - 1024; i < near4MB + 1024; i++) if (data[i] !== 0) nonZero++;
      expect(nonZero).toBe(0);
    });

    it('should copy a file across the 4 MB chunk boundary and preserve bytes', () => {
      const src = pattern(FIVE_MB);
      engine.write('/src.bin', src);
      const status = engine.copy('/src.bin', '/dst.bin');
      expect(status.status).toBe(0);
      const r = engine.read('/dst.bin');
      const data = r.data!;
      expect(data.byteLength).toBe(FIVE_MB);
      expect(data[0]).toBe(src[0]);
      expect(data[FIVE_MB - 1]).toBe(src[FIVE_MB - 1]);
      // Spot-check across the 4 MB chunk boundary.
      const near4MB = 4 * 1024 * 1024;
      expect(data[near4MB - 1]).toBe(src[near4MB - 1]);
      expect(data[near4MB]).toBe(src[near4MB]);
      expect(data[near4MB + 1]).toBe(src[near4MB + 1]);
    });

    it('should copy-self as a no-op', () => {
      engine.write('/self.bin', new TextEncoder().encode('keep'));
      expect(engine.copy('/self.bin', '/self.bin').status).toBe(0);
      const r = engine.read('/self.bin');
      expect(new TextDecoder().decode(r.data!)).toBe('keep');
    });

    it('should honor COPYFILE_EXCL when destination exists', () => {
      engine.write('/a.bin', new TextEncoder().encode('a'));
      engine.write('/b.bin', new TextEncoder().encode('b'));
      const r = engine.copy('/a.bin', '/b.bin', 1);
      // EEXIST
      expect(r.status).not.toBe(0);
      // Destination unchanged.
      const got = engine.read('/b.bin');
      expect(new TextDecoder().decode(got.data!)).toBe('b');
    });
  });

  describe('implicit directories', () => {
    // An implicit directory exists because files exist beneath it, even
    // though no explicit mkdir() was ever called for that path.

    function createImplicitSetup() {
      // Create files via normal write (which requires parent dirs), then
      // remove the directory inodes to simulate the implicit-dir scenario
      // that occurs during bulk OPFS import or direct pathIndex population.
      engine.mkdir('/a', 1);
      engine.mkdir('/a/b', 1);
      engine.mkdir('/a/b/c', 1);
      engine.write('/a/b/c/file1.txt', new TextEncoder().encode('one'));
      engine.write('/a/b/c/file2.txt', new TextEncoder().encode('two'));
      engine.write('/a/b/other.txt', new TextEncoder().encode('other'));
      // Remove the intermediate dir inodes — files stay in pathIndex but
      // their parent dirs become implicit (no inode, only implied by
      // child file paths).
      const pi = (engine as any).pathIndex as Map<string, number>;
      pi.delete('/a');
      pi.delete('/a/b');
      pi.delete('/a/b/c');
      (engine as any).pathIndexGen++;
    }

    function decodeFd(data: Uint8Array): number {
      return new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true);
    }

    it('should stat an implicit directory', () => {
      createImplicitSetup();
      const r = engine.stat('/a/b');
      expect(r.status).toBe(0);
      const view = new DataView(r.data!.buffer, r.data!.byteOffset, r.data!.byteLength);
      // type byte = DIRECTORY (2)
      expect(view.getUint8(0)).toBe(2);
    });

    it('should lstat an implicit directory', () => {
      createImplicitSetup();
      const r = engine.lstat('/a/b');
      expect(r.status).toBe(0);
      expect(new DataView(r.data!.buffer, r.data!.byteOffset).getUint8(0)).toBe(2);
    });

    it('should return stable timestamps across repeated stat calls', () => {
      createImplicitSetup();
      const r1 = engine.stat('/a/b');
      const r2 = engine.stat('/a/b');
      const mtime1 = new DataView(r1.data!.buffer, r1.data!.byteOffset).getFloat64(13, true);
      const mtime2 = new DataView(r2.data!.buffer, r2.data!.byteOffset).getFloat64(13, true);
      expect(mtime1).toBe(mtime2);
    });

    it('should readdir an implicit directory', () => {
      createImplicitSetup();
      // /a/b has direct children: /a/b/c (implicit subdir) and /a/b/other.txt
      const r = engine.readdir('/a/b');
      expect(r.status).toBe(0);
      // Decode plain readdir response: count(u32) + entries[nameLen(u16) + name]
      const view = new DataView(r.data!.buffer, r.data!.byteOffset, r.data!.byteLength);
      const count = view.getUint32(0, true);
      expect(count).toBe(2); // 'c' and 'other.txt'
      const names: string[] = [];
      let off = 4;
      for (let i = 0; i < count; i++) {
        const nameLen = view.getUint16(off, true); off += 2;
        names.push(new TextDecoder().decode(r.data!.subarray(off, off + nameLen)));
        off += nameLen;
      }
      expect(names.sort()).toEqual(['c', 'other.txt']);
    });

    it('should report exists=true for implicit directory', () => {
      createImplicitSetup();
      const r = engine.exists('/a/b');
      expect(r.data![0]).toBe(1);
    });

    it('should access an implicit directory', () => {
      createImplicitSetup();
      expect(engine.access('/a/b').status).toBe(0);
    });

    it('should realpath an implicit directory', () => {
      createImplicitSetup();
      const r = engine.realpath('/a/b');
      expect(r.status).toBe(0);
      expect(new TextDecoder().decode(r.data!)).toBe('/a/b');
    });

    it('should opendir + fstat an implicit directory without crash', () => {
      createImplicitSetup();
      const openR = engine.opendir('/a/b', 'tab1');
      expect(openR.status).toBe(0);
      const fd = decodeFd(openR.data!);
      // fstat must return synthetic dir stats, not crash via readInode(-1)
      const statR = engine.fstat(fd);
      expect(statR.status).toBe(0);
      expect(new DataView(statR.data!.buffer, statR.data!.byteOffset).getUint8(0)).toBe(2);
    });

    it('should no-op fchmod/fchown/futimes on implicit dir fd', () => {
      createImplicitSetup();
      const fd = decodeFd(engine.opendir('/a/b', 'tab1').data!);
      expect(engine.fchmod(fd, 0o755).status).toBe(0);
      expect(engine.fchown(fd, 1000, 1000).status).toBe(0);
      expect(engine.futimes(fd, 100, 200).status).toBe(0);
    });

    it('should rmdir non-recursive on non-empty implicit dir → ENOTEMPTY', () => {
      createImplicitSetup();
      const r = engine.rmdir('/a/b');
      // ENOTEMPTY
      expect(r.status).not.toBe(0);
    });

    it('should rmdir recursive on implicit dir and delete descendants', () => {
      createImplicitSetup();
      const r = engine.rmdir('/a/b', 1); // recursive
      expect(r.status).toBe(0);
      // Children should be gone.
      expect(engine.read('/a/b/c/file1.txt').status).not.toBe(0);
      expect(engine.read('/a/b/other.txt').status).not.toBe(0);
      // Implicit dir itself should no longer exist.
      expect(engine.exists('/a/b').data![0]).toBe(0);
    });

    it('should mkdir(EEXIST) on implicit dir', () => {
      createImplicitSetup();
      const r = engine.mkdir('/a/b');
      expect(r.status).not.toBe(0); // EEXIST
    });

    it('should mkdirRecursive materialize implicit segments as real dirs', () => {
      createImplicitSetup();
      // /a and /a/b are implicit. mkdir -p should materialize them as
      // real inodes so path resolution works for the new leaf.
      engine.mkdir('/a/b/newdir', 1); // recursive
      // /a/b/newdir should exist as a real dir.
      const r = engine.stat('/a/b/newdir');
      expect(r.status).toBe(0);
      expect(new DataView(r.data!.buffer, r.data!.byteOffset).getUint8(0)).toBe(2);
      // /a and /a/b should now be real dirs too (materialized).
      expect(engine.stat('/a').status).toBe(0);
      expect(engine.stat('/a/b').status).toBe(0);
    });

    it('should include implicit subdirs in nlink of real parent dir', () => {
      // Create a real parent, a real child dir (so write succeeds), write
      // a file, then delete the child dir inode to make it implicit.
      engine.mkdir('/realparent');
      engine.mkdir('/realparent/implicitchild');
      engine.write('/realparent/implicitchild/file.txt', new TextEncoder().encode('x'));
      const pi = (engine as any).pathIndex as Map<string, number>;
      pi.delete('/realparent/implicitchild');
      (engine as any).pathIndexGen++;

      const r = engine.stat('/realparent');
      expect(r.status).toBe(0);
      const view = new DataView(r.data!.buffer, r.data!.byteOffset, r.data!.byteLength);
      const nlink = view.getUint32(49, true);
      // nlink = 2 (self + parent) + 1 implicit subdir = 3
      expect(nlink).toBe(3);
    });
  });
});
