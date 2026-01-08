import { describe, it, expect, beforeEach } from 'vitest'
import OPFS from '../dist/index.js'
import type { Dirent } from '../dist/index.js'

describe('Symlink Support', () => {
  let fs: OPFS

  beforeEach(() => {
    resetFileSystem()
    fs = new OPFS({ useSync: true, verbose: false })
  })

  describe('symlink() and readlink()', () => {
    it('should create a symlink', async () => {
      await fs.writeFile('/target.txt', 'hello')
      await fs.symlink('/target.txt', '/link.txt')

      const target = await fs.readlink('/link.txt')
      expect(target).toBe('/target.txt')
    })

    it('should throw EEXIST if symlink path already exists as file', async () => {
      await fs.writeFile('/existing.txt', 'content')

      await expect(
        fs.symlink('/target.txt', '/existing.txt')
      ).rejects.toMatchObject({ code: 'EEXIST' })
    })

    it('should throw EEXIST if symlink path already exists as symlink', async () => {
      await fs.symlink('/target1.txt', '/link.txt')

      await expect(
        fs.symlink('/target2.txt', '/link.txt')
      ).rejects.toMatchObject({ code: 'EEXIST' })
    })

    it('should throw EINVAL when reading non-existent symlink', async () => {
      await expect(
        fs.readlink('/nonexistent.txt')
      ).rejects.toMatchObject({ code: 'EINVAL' })
    })

    it('should allow symlink to non-existent target', async () => {
      await fs.symlink('/nonexistent.txt', '/link.txt')
      const target = await fs.readlink('/link.txt')
      expect(target).toBe('/nonexistent.txt')
    })

    it('should normalize paths in symlinks', async () => {
      await fs.symlink('/./target/../target.txt', '//link.txt')
      const target = await fs.readlink('/link.txt')
      expect(target).toBe('/target.txt')
    })
  })

  describe('readFile() with symlinks', () => {
    it('should follow symlink when reading', async () => {
      await fs.writeFile('/target.txt', 'hello world')
      await fs.symlink('/target.txt', '/link.txt')

      const content = await fs.readFile('/link.txt', { encoding: 'utf-8' })
      expect(content).toBe('hello world')
    })

    it('should follow chain of symlinks', async () => {
      await fs.writeFile('/target.txt', 'data')
      await fs.symlink('/target.txt', '/link1.txt')
      await fs.symlink('/link1.txt', '/link2.txt')
      await fs.symlink('/link2.txt', '/link3.txt')

      const content = await fs.readFile('/link3.txt', { encoding: 'utf-8' })
      expect(content).toBe('data')
    })

    it('should throw ENOENT when symlink target does not exist', async () => {
      await fs.symlink('/nonexistent.txt', '/link.txt')

      await expect(
        fs.readFile('/link.txt')
      ).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  describe('writeFile() with symlinks', () => {
    it('should write through symlink to target', async () => {
      await fs.writeFile('/target.txt', 'initial')
      await fs.symlink('/target.txt', '/link.txt')

      await fs.writeFile('/link.txt', 'updated')

      const targetContent = await fs.readFile('/target.txt', { encoding: 'utf-8' })
      const linkContent = await fs.readFile('/link.txt', { encoding: 'utf-8' })
      expect(targetContent).toBe('updated')
      expect(linkContent).toBe('updated')
    })

    it('should create target file if symlink points to non-existent file', async () => {
      await fs.symlink('/target.txt', '/link.txt')
      await fs.writeFile('/link.txt', 'new content')

      const content = await fs.readFile('/target.txt', { encoding: 'utf-8' })
      expect(content).toBe('new content')
    })
  })

  describe('stat() vs lstat()', () => {
    it('stat() should follow symlink and return target info', async () => {
      await fs.writeFile('/target.txt', 'hello')
      await fs.symlink('/target.txt', '/link.txt')

      const stat = await fs.stat('/link.txt')
      expect(stat.isFile()).toBe(true)
      expect(stat.isDirectory()).toBe(false)
      expect(stat.isSymbolicLink()).toBe(false)
      expect(stat.size).toBe(5)
    })

    it('lstat() should return symlink info without following', async () => {
      await fs.writeFile('/target.txt', 'hello')
      await fs.symlink('/target.txt', '/link.txt')

      const lstat = await fs.lstat('/link.txt')
      expect(lstat.isFile()).toBe(false)
      expect(lstat.isDirectory()).toBe(false)
      expect(lstat.isSymbolicLink()).toBe(true)
      expect(lstat.type).toBe('symlink')
      expect(lstat.target).toBe('/target.txt')
      expect(lstat.mode).toBe(0o120777)
    })

    it('lstat() should work same as stat() for non-symlinks', async () => {
      await fs.writeFile('/file.txt', 'content')

      const stat = await fs.stat('/file.txt')
      const lstat = await fs.lstat('/file.txt')

      expect(stat.isFile()).toBe(lstat.isFile())
      expect(stat.isSymbolicLink()).toBe(lstat.isSymbolicLink())
      expect(stat.size).toBe(lstat.size)
    })

    it('stat() should throw ENOENT when symlink target does not exist', async () => {
      await fs.symlink('/nonexistent.txt', '/link.txt')

      await expect(
        fs.stat('/link.txt')
      ).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('lstat() should work even when symlink target does not exist', async () => {
      await fs.symlink('/nonexistent.txt', '/link.txt')

      const lstat = await fs.lstat('/link.txt')
      expect(lstat.isSymbolicLink()).toBe(true)
      expect(lstat.target).toBe('/nonexistent.txt')
    })
  })

  describe('unlink() with symlinks', () => {
    it('should remove symlink without affecting target', async () => {
      await fs.writeFile('/target.txt', 'content')
      await fs.symlink('/target.txt', '/link.txt')

      await fs.unlink('/link.txt')

      await expect(fs.readlink('/link.txt')).rejects.toMatchObject({ code: 'EINVAL' })

      const targetContent = await fs.readFile('/target.txt', { encoding: 'utf-8' })
      expect(targetContent).toBe('content')
    })

    it('should be able to unlink target file independently', async () => {
      await fs.writeFile('/target.txt', 'content')
      await fs.symlink('/target.txt', '/link.txt')

      await fs.unlink('/target.txt')

      const lstat = await fs.lstat('/link.txt')
      expect(lstat.isSymbolicLink()).toBe(true)

      await expect(fs.readFile('/link.txt')).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  describe('rename() with symlinks', () => {
    it('should rename symlink and preserve target', async () => {
      await fs.writeFile('/target.txt', 'content')
      await fs.symlink('/target.txt', '/old-link.txt')

      await fs.rename('/old-link.txt', '/new-link.txt')

      await expect(fs.readlink('/old-link.txt')).rejects.toMatchObject({ code: 'EINVAL' })

      const target = await fs.readlink('/new-link.txt')
      expect(target).toBe('/target.txt')

      const content = await fs.readFile('/new-link.txt', { encoding: 'utf-8' })
      expect(content).toBe('content')
    })

    it('should rename symlink to different directory', async () => {
      await fs.mkdir('/dir1')
      await fs.mkdir('/dir2')
      await fs.writeFile('/target.txt', 'data')
      await fs.symlink('/target.txt', '/dir1/link.txt')

      await fs.rename('/dir1/link.txt', '/dir2/link.txt')

      const target = await fs.readlink('/dir2/link.txt')
      expect(target).toBe('/target.txt')
    })
  })

  describe('readdir() with symlinks', () => {
    it('should list symlinks in directory', async () => {
      await fs.writeFile('/file.txt', 'content')
      await fs.symlink('/target.txt', '/link.txt')

      const entries = await fs.readdir('/')
      expect(entries).toContain('file.txt')
      expect(entries).toContain('link.txt')
    })

    it('should identify symlinks with withFileTypes option', async () => {
      await fs.writeFile('/file.txt', 'content')
      await fs.mkdir('/dir')
      await fs.symlink('/target.txt', '/link.txt')

      const entries = await fs.readdir('/', { withFileTypes: true }) as Dirent[]

      const file = entries.find(e => e.name === 'file.txt')!
      expect(file.isFile()).toBe(true)
      expect(file.isSymbolicLink()).toBe(false)

      const dir = entries.find(e => e.name === 'dir')!
      expect(dir.isDirectory()).toBe(true)
      expect(dir.isSymbolicLink()).toBe(false)

      const link = entries.find(e => e.name === 'link.txt')!
      expect(link.isSymbolicLink()).toBe(true)
      expect(link.isFile()).toBe(false)
      expect(link.isDirectory()).toBe(false)
    })

    it('should not show symlink metadata file', async () => {
      await fs.symlink('/target.txt', '/link.txt')

      const entries = await fs.readdir('/')
      expect(entries).not.toContain('.opfs-symlinks.json')
    })

    it('should show symlinks in subdirectories', async () => {
      await fs.mkdir('/subdir')
      await fs.symlink('/target.txt', '/subdir/link.txt')

      const entries = await fs.readdir('/subdir')
      expect(entries).toContain('link.txt')

      const entriesWithTypes = await fs.readdir('/subdir', { withFileTypes: true }) as Dirent[]
      const link = entriesWithTypes.find(e => e.name === 'link.txt')!
      expect(link.isSymbolicLink()).toBe(true)
    })
  })

  describe('circular symlinks', () => {
    it('should detect circular symlinks and throw ELOOP', async () => {
      await fs.symlink('/link2.txt', '/link1.txt')
      await fs.symlink('/link1.txt', '/link2.txt')

      await expect(
        fs.readFile('/link1.txt')
      ).rejects.toMatchObject({ code: 'ELOOP' })
    })

    it('should detect self-referencing symlink', async () => {
      await fs.symlink('/link.txt', '/link.txt')

      await expect(
        fs.readFile('/link.txt')
      ).rejects.toMatchObject({ code: 'ELOOP' })
    })

    it('should handle deep symlink chains up to limit', async () => {
      await fs.writeFile('/target.txt', 'data')

      for (let i = 0; i < 9; i++) {
        const from = i === 0 ? '/target.txt' : `/link${i}.txt`
        await fs.symlink(from, `/link${i + 1}.txt`)
      }

      const content = await fs.readFile('/link9.txt', { encoding: 'utf-8' })
      expect(content).toBe('data')
    })

    it('should throw ELOOP when exceeding max symlink depth', async () => {
      await fs.writeFile('/target.txt', 'data')

      for (let i = 0; i < 11; i++) {
        const from = i === 0 ? '/target.txt' : `/link${i}.txt`
        await fs.symlink(from, `/link${i + 1}.txt`)
      }

      await expect(
        fs.readFile('/link11.txt')
      ).rejects.toMatchObject({ code: 'ELOOP' })
    })
  })

  describe('symlinks with directories', () => {
    it('should allow symlinks pointing to directories', async () => {
      await fs.mkdir('/targetdir')
      await fs.writeFile('/targetdir/file.txt', 'content')
      await fs.symlink('/targetdir', '/linkdir')

      const stat = await fs.stat('/linkdir')
      expect(stat.isDirectory()).toBe(true)
    })

    it('should read directory through symlink', async () => {
      await fs.mkdir('/targetdir')
      await fs.writeFile('/targetdir/file.txt', 'content')
      await fs.symlink('/targetdir', '/linkdir')

      const entries = await fs.readdir('/linkdir')
      expect(entries).toContain('file.txt')
    })

    it('lstat should identify directory symlink as symlink', async () => {
      await fs.mkdir('/targetdir')
      await fs.symlink('/targetdir', '/linkdir')

      const lstat = await fs.lstat('/linkdir')
      expect(lstat.isSymbolicLink()).toBe(true)
      expect(lstat.isDirectory()).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('should handle multiple symlinks in same directory', async () => {
      await fs.writeFile('/target1.txt', 'content1')
      await fs.writeFile('/target2.txt', 'content2')
      await fs.symlink('/target1.txt', '/link1.txt')
      await fs.symlink('/target2.txt', '/link2.txt')

      const content1 = await fs.readFile('/link1.txt', { encoding: 'utf-8' })
      const content2 = await fs.readFile('/link2.txt', { encoding: 'utf-8' })
      expect(content1).toBe('content1')
      expect(content2).toBe('content2')
    })

    it('should handle symlinks across directories', async () => {
      await fs.mkdir('/dir1')
      await fs.mkdir('/dir2')
      await fs.writeFile('/dir1/target.txt', 'data')
      await fs.symlink('/dir1/target.txt', '/dir2/link.txt')

      const content = await fs.readFile('/dir2/link.txt', { encoding: 'utf-8' })
      expect(content).toBe('data')
    })

    it('should persist symlinks across instance creation', async () => {
      await fs.writeFile('/target.txt', 'content')
      await fs.symlink('/target.txt', '/link.txt')

      // Create new instance that shares the same storage
      // The cache is instance-specific but loads from the same file
      const fs2 = new OPFS({ useSync: true })

      // The new instance should load symlinks from the metadata file
      const target = await fs2.readlink('/link.txt')
      expect(target).toBe('/target.txt')

      const content = await fs2.readFile('/link.txt', { encoding: 'utf-8' })
      expect(content).toBe('content')
    })

    it('should handle symlink with relative-like path components', async () => {
      await fs.writeFile('/target.txt', 'data')
      await fs.symlink('/target.txt', '/./link.txt')

      const target = await fs.readlink('/link.txt')
      expect(target).toBe('/target.txt')
    })

    it('should create multiple symlinks efficiently with symlinkBatch', async () => {
      await fs.writeFile('/target1.txt', 'data1')
      await fs.writeFile('/target2.txt', 'data2')
      await fs.writeFile('/target3.txt', 'data3')

      await fs.symlinkBatch([
        { target: '/target1.txt', path: '/link1.txt' },
        { target: '/target2.txt', path: '/link2.txt' },
        { target: '/target3.txt', path: '/link3.txt' }
      ])

      const target1 = await fs.readlink('/link1.txt')
      const target2 = await fs.readlink('/link2.txt')
      const target3 = await fs.readlink('/link3.txt')

      expect(target1).toBe('/target1.txt')
      expect(target2).toBe('/target2.txt')
      expect(target3).toBe('/target3.txt')

      const content1 = await fs.readFile('/link1.txt', { encoding: 'utf-8' })
      expect(content1).toBe('data1')
    })
  })
})
