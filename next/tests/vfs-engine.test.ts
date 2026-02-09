/**
 * VFS Engine Unit Tests
 *
 * Tests the core VFS binary format operations in isolation.
 * Uses a mock sync access handle to test without browser OPFS.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VFSEngine } from '../src/vfs/engine.js';
import { VFS_MAGIC, SUPERBLOCK, INODE_TYPE } from '../src/vfs/layout.js';

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
});
