import { describe, it, expect, beforeEach } from 'vitest'
import OPFS from '../dist/index.js'
import type { Dirent } from '../dist/index.js'

describe('OPFS Core Functionality', () => {
  let fs: OPFS

  beforeEach(() => {
    resetFileSystem()
    fs = new OPFS({ useSync: true, verbose: false })
  })

  describe('readFile() and writeFile()', () => {
    it('should write and read a text file', async () => {
      await fs.writeFile('/test.txt', 'hello world')
      const content = await fs.readFile('/test.txt', { encoding: 'utf-8' })
      expect(content).toBe('hello world')
    })

    it('should write and read binary data', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5])
      await fs.writeFile('/test.bin', data)
      const content = await fs.readFile('/test.bin')
      expect(content).toEqual(data)
    })

    it('should overwrite existing file', async () => {
      await fs.writeFile('/test.txt', 'first')
      await fs.writeFile('/test.txt', 'second')
      const content = await fs.readFile('/test.txt', { encoding: 'utf-8' })
      expect(content).toBe('second')
    })

    it('should throw ENOENT when reading non-existent file', async () => {
      await expect(
        fs.readFile('/nonexistent.txt')
      ).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('should handle empty files', async () => {
      await fs.writeFile('/empty.txt', '')
      const content = await fs.readFile('/empty.txt', { encoding: 'utf-8' })
      expect(content).toBe('')
    })

    it('should write files in subdirectories', async () => {
      await fs.mkdir('/dir1/dir2')
      await fs.writeFile('/dir1/dir2/file.txt', 'nested')
      const content = await fs.readFile('/dir1/dir2/file.txt', { encoding: 'utf-8' })
      expect(content).toBe('nested')
    })

    it('should handle large files', async () => {
      const largeData = new Uint8Array(10000).fill(42)
      await fs.writeFile('/large.bin', largeData)
      const content = await fs.readFile('/large.bin') as Uint8Array
      expect(content.length).toBe(10000)
      expect(content[0]).toBe(42)
      expect(content[9999]).toBe(42)
    })

    it('should handle UTF-8 encoding', async () => {
      const text = 'Hello 世界 🌍'
      await fs.writeFile('/utf8.txt', text)
      const content = await fs.readFile('/utf8.txt', { encoding: 'utf-8' })
      expect(content).toBe(text)
    })
  })

  describe('mkdir() and rmdir()', () => {
    it('should create a directory', async () => {
      await fs.mkdir('/testdir')
      const entries = await fs.readdir('/')
      expect(entries).toContain('testdir')
    })

    it('should create nested directories', async () => {
      await fs.mkdir('/dir1/dir2/dir3')
      const entries1 = await fs.readdir('/dir1')
      expect(entries1).toContain('dir2')
      const entries2 = await fs.readdir('/dir1/dir2')
      expect(entries2).toContain('dir3')
    })

    it('should be idempotent (creating existing directory should work)', async () => {
      await fs.mkdir('/testdir')
      await fs.mkdir('/testdir')
      const entries = await fs.readdir('/')
      expect(entries).toContain('testdir')
    })

    it('should remove empty directory', async () => {
      await fs.mkdir('/testdir')
      await fs.rmdir('/testdir')
      const entries = await fs.readdir('/')
      expect(entries).not.toContain('testdir')
    })

    it('should remove directory with contents recursively', async () => {
      await fs.mkdir('/dir')
      await fs.writeFile('/dir/file1.txt', 'content1')
      await fs.writeFile('/dir/file2.txt', 'content2')
      await fs.mkdir('/dir/subdir')
      await fs.writeFile('/dir/subdir/file3.txt', 'content3')

      await fs.rmdir('/dir')

      const entries = await fs.readdir('/')
      expect(entries).not.toContain('dir')
    })

    it('should remove all files when removing root', async () => {
      await fs.writeFile('/file1.txt', 'content1')
      await fs.writeFile('/file2.txt', 'content2')
      await fs.mkdir('/dir')

      await fs.rmdir('/')

      const entries = await fs.readdir('/')
      expect(entries.length).toBe(0)
    })

    it('should throw ENOENT when removing non-existent directory', async () => {
      await expect(
        fs.rmdir('/nonexistent')
      ).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  describe('stat() and lstat()', () => {
    it('should return file stats', async () => {
      await fs.writeFile('/test.txt', 'hello')
      const stat = await fs.stat('/test.txt')

      expect(stat.type).toBe('file')
      expect(stat.size).toBe(5)
      expect(stat.mode).toBe(0o100644)
      expect(stat.isFile()).toBe(true)
      expect(stat.isDirectory()).toBe(false)
      expect(stat.isSymbolicLink()).toBe(false)
      expect(stat.mtime).toBeInstanceOf(Date)
      expect(stat.ctime).toBeInstanceOf(Date)
    })

    it('should return directory stats', async () => {
      await fs.mkdir('/testdir')
      const stat = await fs.stat('/testdir')

      expect(stat.type).toBe('dir')
      expect(stat.size).toBe(0)
      expect(stat.mode).toBe(0o040755)
      expect(stat.isFile()).toBe(false)
      expect(stat.isDirectory()).toBe(true)
      expect(stat.isSymbolicLink()).toBe(false)
    })

    it('should return root directory stats', async () => {
      const stat = await fs.stat('/')

      expect(stat.type).toBe('dir')
      expect(stat.isDirectory()).toBe(true)
      expect(stat.isFile()).toBe(false)
    })

    it('should throw ENOENT for non-existent path', async () => {
      await expect(
        fs.stat('/nonexistent')
      ).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('should handle nested paths', async () => {
      await fs.mkdir('/dir1/dir2')
      await fs.writeFile('/dir1/dir2/file.txt', 'content')

      const stat = await fs.stat('/dir1/dir2/file.txt')
      expect(stat.isFile()).toBe(true)
      expect(stat.size).toBe(7)
    })
  })

  describe('readdir()', () => {
    it('should list files in root directory', async () => {
      await fs.writeFile('/file1.txt', 'content1')
      await fs.writeFile('/file2.txt', 'content2')
      await fs.mkdir('/dir1')

      const entries = await fs.readdir('/')
      expect(entries).toContain('file1.txt')
      expect(entries).toContain('file2.txt')
      expect(entries).toContain('dir1')
    })

    it('should list files in subdirectory', async () => {
      await fs.mkdir('/dir')
      await fs.writeFile('/dir/file1.txt', 'content1')
      await fs.writeFile('/dir/file2.txt', 'content2')

      const entries = await fs.readdir('/dir')
      expect(entries).toContain('file1.txt')
      expect(entries).toContain('file2.txt')
      expect(entries.length).toBe(2)
    })

    it('should return empty array for empty directory', async () => {
      await fs.mkdir('/emptydir')
      const entries = await fs.readdir('/emptydir')
      expect(entries).toEqual([])
    })

    it('should return entries with file types', async () => {
      await fs.writeFile('/file.txt', 'content')
      await fs.mkdir('/dir')

      const entries = await fs.readdir('/', { withFileTypes: true }) as Dirent[]

      const file = entries.find(e => e.name === 'file.txt')!
      expect(file.isFile()).toBe(true)
      expect(file.isDirectory()).toBe(false)

      const dir = entries.find(e => e.name === 'dir')!
      expect(dir.isFile()).toBe(false)
      expect(dir.isDirectory()).toBe(true)
    })

    it('should not show hidden metadata files', async () => {
      await fs.writeFile('/file.txt', 'content')
      const entries = await fs.readdir('/')
      expect(entries).not.toContain('.opfs-symlinks.json')
    })

    it('should throw ENOENT for non-existent directory', async () => {
      await expect(
        fs.readdir('/nonexistent')
      ).rejects.toThrow()
    })
  })

  describe('unlink()', () => {
    it('should remove a file', async () => {
      await fs.writeFile('/test.txt', 'content')
      await fs.unlink('/test.txt')

      await expect(
        fs.readFile('/test.txt')
      ).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('should throw ENOENT when removing non-existent file', async () => {
      await expect(
        fs.unlink('/nonexistent.txt')
      ).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('should remove file from subdirectory', async () => {
      await fs.mkdir('/dir')
      await fs.writeFile('/dir/file.txt', 'content')
      await fs.unlink('/dir/file.txt')

      const entries = await fs.readdir('/dir')
      expect(entries).not.toContain('file.txt')
    })

    it('should not affect other files', async () => {
      await fs.writeFile('/file1.txt', 'content1')
      await fs.writeFile('/file2.txt', 'content2')
      await fs.unlink('/file1.txt')

      const content = await fs.readFile('/file2.txt', { encoding: 'utf-8' })
      expect(content).toBe('content2')
    })
  })

  describe('rename()', () => {
    it('should rename a file', async () => {
      await fs.writeFile('/old.txt', 'content')
      await fs.rename('/old.txt', '/new.txt')

      await expect(
        fs.readFile('/old.txt')
      ).rejects.toMatchObject({ code: 'ENOENT' })

      const content = await fs.readFile('/new.txt', { encoding: 'utf-8' })
      expect(content).toBe('content')
    })

    it('should move file to different directory', async () => {
      await fs.mkdir('/dir1')
      await fs.mkdir('/dir2')
      await fs.writeFile('/dir1/file.txt', 'content')

      await fs.rename('/dir1/file.txt', '/dir2/file.txt')

      const entries1 = await fs.readdir('/dir1')
      expect(entries1).not.toContain('file.txt')

      const entries2 = await fs.readdir('/dir2')
      expect(entries2).toContain('file.txt')

      const content = await fs.readFile('/dir2/file.txt', { encoding: 'utf-8' })
      expect(content).toBe('content')
    })

    it('should rename a directory', async () => {
      await fs.mkdir('/olddir')
      await fs.writeFile('/olddir/file.txt', 'content')

      await fs.rename('/olddir', '/newdir')

      await expect(
        fs.readdir('/olddir')
      ).rejects.toThrow()

      const entries = await fs.readdir('/newdir')
      expect(entries).toContain('file.txt')

      const content = await fs.readFile('/newdir/file.txt', { encoding: 'utf-8' })
      expect(content).toBe('content')
    })

    it('should rename nested directories recursively', async () => {
      await fs.mkdir('/olddir/subdir')
      await fs.writeFile('/olddir/file1.txt', 'content1')
      await fs.writeFile('/olddir/subdir/file2.txt', 'content2')

      await fs.rename('/olddir', '/newdir')

      const content1 = await fs.readFile('/newdir/file1.txt', { encoding: 'utf-8' })
      expect(content1).toBe('content1')

      const content2 = await fs.readFile('/newdir/subdir/file2.txt', { encoding: 'utf-8' })
      expect(content2).toBe('content2')
    })

    it('should create parent directories if needed', async () => {
      await fs.writeFile('/file.txt', 'content')
      await fs.rename('/file.txt', '/new/nested/file.txt')

      const content = await fs.readFile('/new/nested/file.txt', { encoding: 'utf-8' })
      expect(content).toBe('content')
    })

    it('should throw ENOENT when source does not exist', async () => {
      await expect(
        fs.rename('/nonexistent.txt', '/new.txt')
      ).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  describe('backFile()', () => {
    it('should return stat for existing file', async () => {
      await fs.writeFile('/test.txt', 'content')
      const stat = await fs.backFile('/test.txt')

      expect(stat.isFile()).toBe(true)
      expect(stat.size).toBe(7)
    })

    it('should return stat for directory', async () => {
      await fs.mkdir('/testdir')
      const stat = await fs.backFile('/testdir')

      expect(stat.isDirectory()).toBe(true)
    })

    it('should throw ENOENT for non-existent path', async () => {
      await expect(
        fs.backFile('/nonexistent.txt')
      ).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  describe('du()', () => {
    it('should return disk usage for file', async () => {
      await fs.writeFile('/test.txt', 'hello')
      const du = await fs.du('/test.txt')

      expect(du.path).toBe('/test.txt')
      expect(du.size).toBe(5)
    })

    it('should return disk usage for directory', async () => {
      await fs.mkdir('/testdir')
      const du = await fs.du('/testdir')

      expect(du.path).toBe('/testdir')
      expect(du.size).toBe(0)
    })

    it('should work with nested paths', async () => {
      await fs.mkdir('/dir')
      await fs.writeFile('/dir/file.txt', 'content here')
      const du = await fs.du('/dir/file.txt')

      expect(du.size).toBe(12)
    })
  })

  describe('path normalization', () => {
    it('should normalize paths with double slashes', async () => {
      await fs.writeFile('/test.txt', 'content')
      const content = await fs.readFile('//test.txt', { encoding: 'utf-8' })
      expect(content).toBe('content')
    })

    it('should handle current directory references', async () => {
      await fs.writeFile('/test.txt', 'content')
      const content = await fs.readFile('/./test.txt', { encoding: 'utf-8' })
      expect(content).toBe('content')
    })

    it('should handle parent directory references', async () => {
      await fs.mkdir('/dir1')
      await fs.writeFile('/file.txt', 'content')
      const content = await fs.readFile('/dir1/../file.txt', { encoding: 'utf-8' })
      expect(content).toBe('content')
    })

    it('should normalize complex paths', async () => {
      await fs.mkdir('/dir1/dir2')
      await fs.writeFile('/dir1/dir2/file.txt', 'content')
      const content = await fs.readFile('/dir1/./dir2/../dir2/file.txt', { encoding: 'utf-8' })
      expect(content).toBe('content')
    })

    it('should handle trailing slashes', async () => {
      await fs.mkdir('/testdir')
      await fs.writeFile('/testdir/file.txt', 'content')
      const entries = await fs.readdir('/testdir/')
      expect(entries).toContain('file.txt')
    })
  })

  describe('useSync option', () => {
    it('should work with useSync disabled', async () => {
      const fsNoSync = new OPFS({ useSync: false })
      await fsNoSync.writeFile('/test.txt', 'content')
      const content = await fsNoSync.readFile('/test.txt', { encoding: 'utf-8' })
      expect(content).toBe('content')
    })
  })

  describe('edge cases', () => {
    it('should handle file names with special characters', async () => {
      await fs.writeFile('/file-name_test.txt', 'content')
      const content = await fs.readFile('/file-name_test.txt', { encoding: 'utf-8' })
      expect(content).toBe('content')
    })

    it('should handle multiple operations in sequence', async () => {
      await fs.writeFile('/test.txt', 'v1')
      await fs.writeFile('/test.txt', 'v2')
      await fs.writeFile('/test.txt', 'v3')
      const content = await fs.readFile('/test.txt', { encoding: 'utf-8' })
      expect(content).toBe('v3')
    })

    it('should handle concurrent operations', async () => {
      await Promise.all([
        fs.writeFile('/file1.txt', 'content1'),
        fs.writeFile('/file2.txt', 'content2'),
        fs.writeFile('/file3.txt', 'content3')
      ])

      const [c1, c2, c3] = await Promise.all([
        fs.readFile('/file1.txt', { encoding: 'utf-8' }),
        fs.readFile('/file2.txt', { encoding: 'utf-8' }),
        fs.readFile('/file3.txt', { encoding: 'utf-8' })
      ])

      expect(c1).toBe('content1')
      expect(c2).toBe('content2')
      expect(c3).toBe('content3')
    })

    it('should maintain directory cache correctly', async () => {
      await fs.mkdir('/dir')
      await fs.writeFile('/dir/file1.txt', 'content1')
      await fs.writeFile('/dir/file2.txt', 'content2')

      const entries1 = await fs.readdir('/dir')
      const entries2 = await fs.readdir('/dir')

      expect(entries1).toEqual(entries2)
      expect(entries1.length).toBe(2)
    })

    it('should clear directory cache on modifications', async () => {
      await fs.mkdir('/dir')
      await fs.writeFile('/dir/file1.txt', 'content')

      const entries1 = await fs.readdir('/dir')
      expect(entries1.length).toBe(1)

      await fs.writeFile('/dir/file2.txt', 'content')

      const entries2 = await fs.readdir('/dir')
      expect(entries2.length).toBe(2)
    })
  })
})
