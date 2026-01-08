/**
 * Integration tests for OPFS FileSystem
 *
 * These tests require a browser environment with OPFS support.
 * Run with: npm run test:browser
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Note: This test file is designed for browser testing
// It will be skipped in Node.js environment

const isBrowser = typeof window !== 'undefined' && 'storage' in navigator;

describe.skipIf(!isBrowser)('OPFSFileSystem', () => {
  let fs: typeof import('../../src/index.js').fs;
  const testDir = '/test-' + Date.now();

  beforeEach(async () => {
    const module = await import('../../src/index.js');
    fs = module.fs;
    await fs.promises.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('promises.writeFile / promises.readFile', () => {
    it('should write and read string data', async () => {
      const filePath = `${testDir}/test.txt`;
      const content = 'Hello, OPFS!';

      await fs.promises.writeFile(filePath, content);
      const result = await fs.promises.readFile(filePath, 'utf8');

      expect(result).toBe(content);
    });

    it('should write and read binary data', async () => {
      const filePath = `${testDir}/test.bin`;
      const content = new Uint8Array([1, 2, 3, 4, 5]);

      await fs.promises.writeFile(filePath, content);
      const result = await fs.promises.readFile(filePath);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(Array.from(result as Uint8Array)).toEqual([1, 2, 3, 4, 5]);
    });

    it('should overwrite existing file', async () => {
      const filePath = `${testDir}/overwrite.txt`;

      await fs.promises.writeFile(filePath, 'first');
      await fs.promises.writeFile(filePath, 'second');
      const result = await fs.promises.readFile(filePath, 'utf8');

      expect(result).toBe('second');
    });
  });

  describe('promises.appendFile', () => {
    it('should append to existing file', async () => {
      const filePath = `${testDir}/append.txt`;

      await fs.promises.writeFile(filePath, 'Hello');
      await fs.promises.appendFile(filePath, ' World');
      const result = await fs.promises.readFile(filePath, 'utf8');

      expect(result).toBe('Hello World');
    });

    it('should create file if not exists', async () => {
      const filePath = `${testDir}/new-append.txt`;

      await fs.promises.appendFile(filePath, 'New file');
      const result = await fs.promises.readFile(filePath, 'utf8');

      expect(result).toBe('New file');
    });
  });

  describe('promises.mkdir / promises.rmdir', () => {
    it('should create directory', async () => {
      const dirPath = `${testDir}/newdir`;

      await fs.promises.mkdir(dirPath);
      const stat = await fs.promises.stat(dirPath);

      expect(stat.isDirectory()).toBe(true);
    });

    it('should create nested directories with recursive option', async () => {
      const dirPath = `${testDir}/a/b/c`;

      await fs.promises.mkdir(dirPath, { recursive: true });
      const stat = await fs.promises.stat(dirPath);

      expect(stat.isDirectory()).toBe(true);
    });

    it('should remove empty directory', async () => {
      const dirPath = `${testDir}/emptydir`;

      await fs.promises.mkdir(dirPath);
      await fs.promises.rmdir(dirPath);

      await expect(fs.promises.stat(dirPath)).rejects.toThrow();
    });

    it('should remove directory recursively', async () => {
      const dirPath = `${testDir}/recursivedir`;
      const filePath = `${dirPath}/file.txt`;

      await fs.promises.mkdir(dirPath);
      await fs.promises.writeFile(filePath, 'test');
      await fs.promises.rmdir(dirPath, { recursive: true });

      await expect(fs.promises.stat(dirPath)).rejects.toThrow();
    });
  });

  describe('promises.readdir', () => {
    it('should list directory contents', async () => {
      await fs.promises.writeFile(`${testDir}/a.txt`, 'a');
      await fs.promises.writeFile(`${testDir}/b.txt`, 'b');
      await fs.promises.mkdir(`${testDir}/subdir`);

      const entries = await fs.promises.readdir(testDir);

      expect(entries).toContain('a.txt');
      expect(entries).toContain('b.txt');
      expect(entries).toContain('subdir');
    });

    it('should return Dirent objects with withFileTypes', async () => {
      await fs.promises.writeFile(`${testDir}/file.txt`, 'content');
      await fs.promises.mkdir(`${testDir}/dir`);

      const entries = await fs.promises.readdir(testDir, { withFileTypes: true });
      const file = entries.find((e) => e.name === 'file.txt');
      const dir = entries.find((e) => e.name === 'dir');

      expect(file?.isFile()).toBe(true);
      expect(file?.isDirectory()).toBe(false);
      expect(dir?.isFile()).toBe(false);
      expect(dir?.isDirectory()).toBe(true);
    });
  });

  describe('promises.stat', () => {
    it('should return stats for file', async () => {
      const filePath = `${testDir}/stat-test.txt`;
      const content = 'Hello World';

      await fs.promises.writeFile(filePath, content);
      const stat = await fs.promises.stat(filePath);

      expect(stat.isFile()).toBe(true);
      expect(stat.isDirectory()).toBe(false);
      expect(stat.size).toBe(content.length);
    });

    it('should return stats for directory', async () => {
      const stat = await fs.promises.stat(testDir);

      expect(stat.isFile()).toBe(false);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should throw for non-existent path', async () => {
      await expect(fs.promises.stat(`${testDir}/nonexistent`)).rejects.toThrow();
    });
  });

  describe('promises.unlink', () => {
    it('should delete file', async () => {
      const filePath = `${testDir}/to-delete.txt`;

      await fs.promises.writeFile(filePath, 'delete me');
      await fs.promises.unlink(filePath);

      await expect(fs.promises.stat(filePath)).rejects.toThrow();
    });
  });

  describe('promises.rename', () => {
    it('should rename file', async () => {
      const oldPath = `${testDir}/old-name.txt`;
      const newPath = `${testDir}/new-name.txt`;

      await fs.promises.writeFile(oldPath, 'content');
      await fs.promises.rename(oldPath, newPath);

      await expect(fs.promises.stat(oldPath)).rejects.toThrow();
      const content = await fs.promises.readFile(newPath, 'utf8');
      expect(content).toBe('content');
    });

    it('should move file to different directory', async () => {
      const oldPath = `${testDir}/source.txt`;
      const newDir = `${testDir}/destination`;
      const newPath = `${newDir}/moved.txt`;

      await fs.promises.writeFile(oldPath, 'content');
      await fs.promises.mkdir(newDir);
      await fs.promises.rename(oldPath, newPath);

      await expect(fs.promises.stat(oldPath)).rejects.toThrow();
      const content = await fs.promises.readFile(newPath, 'utf8');
      expect(content).toBe('content');
    });
  });

  describe('promises.copyFile', () => {
    it('should copy file', async () => {
      const srcPath = `${testDir}/source.txt`;
      const dstPath = `${testDir}/copy.txt`;
      const content = 'copy me';

      await fs.promises.writeFile(srcPath, content);
      await fs.promises.copyFile(srcPath, dstPath);

      const srcContent = await fs.promises.readFile(srcPath, 'utf8');
      const dstContent = await fs.promises.readFile(dstPath, 'utf8');

      expect(srcContent).toBe(content);
      expect(dstContent).toBe(content);
    });
  });

  describe('promises.access', () => {
    it('should not throw for existing path', async () => {
      const filePath = `${testDir}/exists.txt`;
      await fs.promises.writeFile(filePath, 'content');

      await expect(fs.promises.access(filePath)).resolves.toBeUndefined();
    });

    it('should throw for non-existent path', async () => {
      await expect(fs.promises.access(`${testDir}/not-exists.txt`)).rejects.toThrow();
    });
  });

  describe('promises.rm', () => {
    it('should remove file', async () => {
      const filePath = `${testDir}/rm-file.txt`;
      await fs.promises.writeFile(filePath, 'content');
      await fs.promises.rm(filePath);

      await expect(fs.promises.stat(filePath)).rejects.toThrow();
    });

    it('should remove directory recursively', async () => {
      const dirPath = `${testDir}/rm-dir`;
      await fs.promises.mkdir(`${dirPath}/subdir`, { recursive: true });
      await fs.promises.writeFile(`${dirPath}/file.txt`, 'content');

      await fs.promises.rm(dirPath, { recursive: true });

      await expect(fs.promises.stat(dirPath)).rejects.toThrow();
    });

    it('should not throw with force option for non-existent path', async () => {
      await expect(fs.promises.rm(`${testDir}/nonexistent`, { force: true })).resolves.toBeUndefined();
    });
  });
});
