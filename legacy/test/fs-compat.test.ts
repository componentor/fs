import { describe, it, expect, beforeEach } from 'vitest'
import OPFS, { constants } from '../dist/index.js'
import type { Dirent, FileHandle, Dir } from '../dist/index.js'

describe('Node.js fs Compatibility', () => {
  let fs: OPFS

  beforeEach(() => {
    resetFileSystem()
    fs = new OPFS({ useSync: true, verbose: false })
  })

  describe('constants', () => {
    it('should export fs constants', () => {
      expect(constants.F_OK).toBe(0)
      expect(constants.R_OK).toBe(4)
      expect(constants.W_OK).toBe(2)
      expect(constants.X_OK).toBe(1)
      expect(constants.COPYFILE_EXCL).toBe(1)
      expect(constants.O_RDONLY).toBe(0)
      expect(constants.O_WRONLY).toBe(1)
      expect(constants.O_RDWR).toBe(2)
      expect(constants.S_IFREG).toBe(32768)
      expect(constants.S_IFDIR).toBe(16384)
      expect(constants.S_IFLNK).toBe(40960)
    })

    it('should have constants on instance', () => {
      expect(fs.constants).toBeDefined()
      expect(fs.constants.F_OK).toBe(0)
    })
  })

  describe('access()', () => {
    it('should resolve for existing file', async () => {
      await fs.writeFile('/test.txt', 'content')
      await expect(fs.access('/test.txt')).resolves.toBeUndefined()
    })

    it('should resolve for existing directory', async () => {
      await fs.mkdir('/testdir')
      await expect(fs.access('/testdir')).resolves.toBeUndefined()
    })

    it('should reject for non-existent path', async () => {
      await expect(fs.access('/nonexistent'))
        .rejects.toMatchObject({ code: 'EACCES' })
    })

    it('should accept mode parameter', async () => {
      await fs.writeFile('/test.txt', 'content')
      await expect(fs.access('/test.txt', constants.R_OK)).resolves.toBeUndefined()
      await expect(fs.access('/test.txt', constants.W_OK)).resolves.toBeUndefined()
    })
  })

  describe('appendFile()', () => {
    it('should append to existing file', async () => {
      await fs.writeFile('/test.txt', 'hello')
      await fs.appendFile('/test.txt', ' world')
      const content = await fs.readFile('/test.txt', { encoding: 'utf-8' })
      expect(content).toBe('hello world')
    })

    it('should create file if it does not exist', async () => {
      await fs.appendFile('/new.txt', 'content')
      const content = await fs.readFile('/new.txt', { encoding: 'utf-8' })
      expect(content).toBe('content')
    })

    it('should handle binary data', async () => {
      await fs.writeFile('/test.bin', new Uint8Array([1, 2, 3]))
      await fs.appendFile('/test.bin', new Uint8Array([4, 5, 6]))
      const data = await fs.readFile('/test.bin') as Uint8Array
      expect(Array.from(data)).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('should append multiple times', async () => {
      await fs.appendFile('/test.txt', 'a')
      await fs.appendFile('/test.txt', 'b')
      await fs.appendFile('/test.txt', 'c')
      const content = await fs.readFile('/test.txt', { encoding: 'utf-8' })
      expect(content).toBe('abc')
    })
  })

  describe('copyFile()', () => {
    it('should copy file content', async () => {
      await fs.writeFile('/source.txt', 'content')
      await fs.copyFile('/source.txt', '/dest.txt')
      const content = await fs.readFile('/dest.txt', { encoding: 'utf-8' })
      expect(content).toBe('content')
    })

    it('should overwrite existing file by default', async () => {
      await fs.writeFile('/source.txt', 'new content')
      await fs.writeFile('/dest.txt', 'old content')
      await fs.copyFile('/source.txt', '/dest.txt')
      const content = await fs.readFile('/dest.txt', { encoding: 'utf-8' })
      expect(content).toBe('new content')
    })

    it('should fail with COPYFILE_EXCL if dest exists', async () => {
      await fs.writeFile('/source.txt', 'content')
      await fs.writeFile('/dest.txt', 'exists')
      await expect(fs.copyFile('/source.txt', '/dest.txt', constants.COPYFILE_EXCL))
        .rejects.toMatchObject({ code: 'EEXIST' })
    })

    it('should create parent directories', async () => {
      await fs.writeFile('/source.txt', 'content')
      await fs.copyFile('/source.txt', '/nested/dir/dest.txt')
      const content = await fs.readFile('/nested/dir/dest.txt', { encoding: 'utf-8' })
      expect(content).toBe('content')
    })

    it('should copy binary files', async () => {
      const data = new Uint8Array([0, 1, 2, 255, 254, 253])
      await fs.writeFile('/source.bin', data)
      await fs.copyFile('/source.bin', '/dest.bin')
      const copied = await fs.readFile('/dest.bin') as Uint8Array
      expect(Array.from(copied)).toEqual(Array.from(data))
    })
  })

  describe('cp()', () => {
    it('should copy a single file', async () => {
      await fs.writeFile('/file.txt', 'content')
      await fs.cp('/file.txt', '/copy.txt')
      const content = await fs.readFile('/copy.txt', { encoding: 'utf-8' })
      expect(content).toBe('content')
    })

    it('should fail on directory without recursive', async () => {
      await fs.mkdir('/dir')
      await expect(fs.cp('/dir', '/copy'))
        .rejects.toMatchObject({ code: 'EISDIR' })
    })

    it('should copy directory recursively', async () => {
      await fs.mkdir('/dir/subdir')
      await fs.writeFile('/dir/file1.txt', 'file1')
      await fs.writeFile('/dir/subdir/file2.txt', 'file2')

      await fs.cp('/dir', '/copy', { recursive: true })

      expect(await fs.readFile('/copy/file1.txt', { encoding: 'utf-8' })).toBe('file1')
      expect(await fs.readFile('/copy/subdir/file2.txt', { encoding: 'utf-8' })).toBe('file2')
    })

    it('should respect errorOnExist option', async () => {
      await fs.writeFile('/source.txt', 'content')
      await fs.writeFile('/dest.txt', 'exists')

      await expect(fs.cp('/source.txt', '/dest.txt', { errorOnExist: true }))
        .rejects.toMatchObject({ code: 'EEXIST' })
    })
  })

  describe('exists()', () => {
    it('should return true for existing file', async () => {
      await fs.writeFile('/test.txt', 'content')
      expect(await fs.exists('/test.txt')).toBe(true)
    })

    it('should return true for existing directory', async () => {
      await fs.mkdir('/testdir')
      expect(await fs.exists('/testdir')).toBe(true)
    })

    it('should return false for non-existent path', async () => {
      expect(await fs.exists('/nonexistent')).toBe(false)
    })

    it('should return true for root', async () => {
      expect(await fs.exists('/')).toBe(true)
    })
  })

  describe('realpath()', () => {
    it('should resolve regular path', async () => {
      await fs.writeFile('/test.txt', 'content')
      const resolved = await fs.realpath('/test.txt')
      expect(resolved).toBe('/test.txt')
    })

    it('should resolve symlink to target', async () => {
      await fs.writeFile('/target.txt', 'content')
      await fs.symlink('/target.txt', '/link.txt')
      const resolved = await fs.realpath('/link.txt')
      expect(resolved).toBe('/target.txt')
    })

    it('should resolve symlink chain', async () => {
      await fs.writeFile('/target.txt', 'content')
      await fs.symlink('/target.txt', '/link1.txt')
      await fs.symlink('/link1.txt', '/link2.txt')
      const resolved = await fs.realpath('/link2.txt')
      expect(resolved).toBe('/target.txt')
    })
  })

  describe('rm()', () => {
    it('should remove a file', async () => {
      await fs.writeFile('/test.txt', 'content')
      await fs.rm('/test.txt')
      expect(await fs.exists('/test.txt')).toBe(false)
    })

    it('should remove a symlink', async () => {
      await fs.writeFile('/target.txt', 'content')
      await fs.symlink('/target.txt', '/link.txt')
      await fs.rm('/link.txt')
      expect(await fs.exists('/link.txt')).toBe(false)
      expect(await fs.exists('/target.txt')).toBe(true)
    })

    it('should fail on directory without recursive', async () => {
      await fs.mkdir('/dir')
      await expect(fs.rm('/dir'))
        .rejects.toMatchObject({ code: 'EISDIR' })
    })

    it('should remove directory with recursive', async () => {
      await fs.mkdir('/dir/subdir')
      await fs.writeFile('/dir/file.txt', 'content')
      await fs.rm('/dir', { recursive: true })
      expect(await fs.exists('/dir')).toBe(false)
    })

    it('should ignore non-existent path with force', async () => {
      await expect(fs.rm('/nonexistent', { force: true })).resolves.toBeUndefined()
    })

    it('should fail on non-existent path without force', async () => {
      await expect(fs.rm('/nonexistent'))
        .rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  describe('truncate()', () => {
    it('should truncate file to zero', async () => {
      await fs.writeFile('/test.txt', 'hello world')
      await fs.truncate('/test.txt', 0)
      const content = await fs.readFile('/test.txt', { encoding: 'utf-8' })
      expect(content).toBe('')
    })

    it('should truncate file to specified length', async () => {
      await fs.writeFile('/test.txt', 'hello world')
      await fs.truncate('/test.txt', 5)
      const content = await fs.readFile('/test.txt', { encoding: 'utf-8' })
      expect(content).toBe('hello')
    })

    it('should fail on non-existent file', async () => {
      await expect(fs.truncate('/nonexistent', 0))
        .rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  describe('mkdtemp()', () => {
    it('should create unique directory', async () => {
      const dir1 = await fs.mkdtemp('/tmp/test-')
      const dir2 = await fs.mkdtemp('/tmp/test-')

      expect(dir1).not.toBe(dir2)
      expect(dir1.startsWith('/tmp/test-')).toBe(true)
      expect(dir2.startsWith('/tmp/test-')).toBe(true)

      expect(await fs.exists(dir1)).toBe(true)
      expect(await fs.exists(dir2)).toBe(true)
    })

    it('should create directory with prefix', async () => {
      const dir = await fs.mkdtemp('/myprefix')
      expect(dir.startsWith('/myprefix')).toBe(true)
      expect(await fs.exists(dir)).toBe(true)
    })
  })

  describe('chmod()', () => {
    it('should not throw for existing file', async () => {
      await fs.writeFile('/test.txt', 'content')
      await expect(fs.chmod('/test.txt', 0o755)).resolves.toBeUndefined()
    })

    it('should verify path exists', async () => {
      await expect(fs.chmod('/nonexistent', 0o755))
        .rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  describe('chown()', () => {
    it('should not throw for existing file', async () => {
      await fs.writeFile('/test.txt', 'content')
      await expect(fs.chown('/test.txt', 1000, 1000)).resolves.toBeUndefined()
    })

    it('should verify path exists', async () => {
      await expect(fs.chown('/nonexistent', 1000, 1000))
        .rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  describe('utimes()', () => {
    it('should not throw for existing file', async () => {
      await fs.writeFile('/test.txt', 'content')
      await expect(fs.utimes('/test.txt', new Date(), new Date())).resolves.toBeUndefined()
    })

    it('should verify path exists', async () => {
      await expect(fs.utimes('/nonexistent', new Date(), new Date()))
        .rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  describe('lutimes()', () => {
    it('should not throw for existing symlink', async () => {
      await fs.writeFile('/target.txt', 'content')
      await fs.symlink('/target.txt', '/link.txt')
      await expect(fs.lutimes('/link.txt', new Date(), new Date())).resolves.toBeUndefined()
    })

    it('should verify path exists', async () => {
      await expect(fs.lutimes('/nonexistent', new Date(), new Date()))
        .rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  describe('open()', () => {
    it('should open file for reading', async () => {
      await fs.writeFile('/test.txt', 'hello world')
      const handle = await fs.open('/test.txt', 'r')

      expect(handle.fd).toBeDefined()

      const buffer = new Uint8Array(5)
      const { bytesRead } = await handle.read(buffer)
      expect(bytesRead).toBe(5)
      expect(new TextDecoder().decode(buffer)).toBe('hello')

      await handle.close()
    })

    it('should open file for writing', async () => {
      const handle = await fs.open('/new.txt', 'w')
      const buffer = new TextEncoder().encode('hello')
      await handle.write(buffer)
      await handle.close()

      const content = await fs.readFile('/new.txt', { encoding: 'utf-8' })
      expect(content).toBe('hello')
    })

    it('should support readFile on handle', async () => {
      await fs.writeFile('/test.txt', 'content')
      const handle = await fs.open('/test.txt', 'r')

      const content = await handle.readFile({ encoding: 'utf-8' })
      expect(content).toBe('content')

      await handle.close()
    })

    it('should support writeFile on handle', async () => {
      const handle = await fs.open('/test.txt', 'w')
      await handle.writeFile('new content')
      await handle.close()

      const content = await fs.readFile('/test.txt', { encoding: 'utf-8' })
      expect(content).toBe('new content')
    })

    it('should support stat on handle', async () => {
      await fs.writeFile('/test.txt', 'hello')
      const handle = await fs.open('/test.txt', 'r')

      const stat = await handle.stat()
      expect(stat.size).toBe(5)
      expect(stat.isFile()).toBe(true)

      await handle.close()
    })

    it('should support truncate on handle', async () => {
      await fs.writeFile('/test.txt', 'hello world')
      const handle = await fs.open('/test.txt', 'r+')

      await handle.truncate(5)
      await handle.close()

      const content = await fs.readFile('/test.txt', { encoding: 'utf-8' })
      expect(content).toBe('hello')
    })

    it('should truncate file when opened with w flag', async () => {
      await fs.writeFile('/test.txt', 'existing content')
      const handle = await fs.open('/test.txt', 'w')
      await handle.write(new TextEncoder().encode('new'))
      await handle.close()

      const content = await fs.readFile('/test.txt', { encoding: 'utf-8' })
      expect(content).toBe('new')
    })

    it('should append when opened with a flag', async () => {
      await fs.writeFile('/test.txt', 'hello')
      const handle = await fs.open('/test.txt', 'a')
      await handle.write(new TextEncoder().encode(' world'))
      await handle.close()

      const content = await fs.readFile('/test.txt', { encoding: 'utf-8' })
      expect(content).toBe('hello world')
    })
  })

  describe('opendir()', () => {
    it('should open directory for iteration', async () => {
      await fs.mkdir('/dir')
      await fs.writeFile('/dir/file1.txt', 'content')
      await fs.writeFile('/dir/file2.txt', 'content')

      const dir = await fs.opendir('/dir')
      const entries: string[] = []

      let entry: Dirent | null
      while ((entry = await dir.read()) !== null) {
        entries.push(entry.name)
      }

      await dir.close()

      expect(entries).toContain('file1.txt')
      expect(entries).toContain('file2.txt')
    })

    it('should support async iteration', async () => {
      await fs.mkdir('/dir')
      await fs.writeFile('/dir/a.txt', 'a')
      await fs.writeFile('/dir/b.txt', 'b')

      const dir = await fs.opendir('/dir')
      const entries: string[] = []

      for await (const entry of dir) {
        entries.push(entry.name)
      }

      expect(entries).toContain('a.txt')
      expect(entries).toContain('b.txt')
    })

    it('should have path property', async () => {
      await fs.mkdir('/mydir')
      const dir = await fs.opendir('/mydir')
      expect(dir.path).toBe('/mydir')
      await dir.close()
    })
  })

  describe('createReadStream()', () => {
    it('should create readable stream', async () => {
      await fs.writeFile('/test.txt', 'hello world')

      const stream = fs.createReadStream('/test.txt')
      const reader = stream.getReader()

      const chunks: Uint8Array[] = []
      let result: ReadableStreamReadResult<Uint8Array>
      while (!(result = await reader.read()).done) {
        chunks.push(result.value)
      }

      const combined = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0))
      let offset = 0
      for (const chunk of chunks) {
        combined.set(chunk, offset)
        offset += chunk.length
      }

      expect(new TextDecoder().decode(combined)).toBe('hello world')
    })

    it('should support start and end options', async () => {
      await fs.writeFile('/test.txt', 'hello world')

      const stream = fs.createReadStream('/test.txt', { start: 0, end: 5 })
      const reader = stream.getReader()

      const chunks: Uint8Array[] = []
      let result: ReadableStreamReadResult<Uint8Array>
      while (!(result = await reader.read()).done) {
        chunks.push(result.value)
      }

      const combined = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0))
      let offset = 0
      for (const chunk of chunks) {
        combined.set(chunk, offset)
        offset += chunk.length
      }

      expect(new TextDecoder().decode(combined)).toBe('hello')
    })
  })

  describe('createWriteStream()', () => {
    it('should create writable stream', async () => {
      const stream = fs.createWriteStream('/test.txt')
      const writer = stream.getWriter()

      await writer.write(new TextEncoder().encode('hello'))
      await writer.write(new TextEncoder().encode(' world'))
      await writer.close()

      const content = await fs.readFile('/test.txt', { encoding: 'utf-8' })
      expect(content).toBe('hello world')
    })
  })

  describe('watch()', () => {
    it('should return watcher object', async () => {
      await fs.mkdir('/watchdir')
      const watcher = fs.watch('/watchdir')

      expect(watcher.close).toBeDefined()
      expect(watcher.ref).toBeDefined()
      expect(watcher.unref).toBeDefined()
      expect(watcher[Symbol.asyncIterator]).toBeDefined()

      watcher.close()
    })

    it('should support abort signal', async () => {
      await fs.mkdir('/watchdir')
      const controller = new AbortController()
      const watcher = fs.watch('/watchdir', { signal: controller.signal })

      controller.abort()
      // Should not throw
    })
  })

  describe('Performance with new methods', () => {
    it('should copy many files efficiently', async () => {
      // Create 20 files
      const promises: Promise<void>[] = []
      for (let i = 0; i < 20; i++) {
        promises.push(fs.writeFile(`/source/file${i}.txt`, `content ${i}`))
      }
      await fs.mkdir('/source')
      await Promise.all(promises)

      const start = performance.now()
      await fs.cp('/source', '/dest', { recursive: true })
      const duration = performance.now() - start

      console.log(`Copy 20 files recursively: ${duration.toFixed(2)}ms`)
      expect(duration).toBeLessThan(1000)

      // Verify
      for (let i = 0; i < 20; i++) {
        const content = await fs.readFile(`/dest/file${i}.txt`, { encoding: 'utf-8' })
        expect(content).toBe(`content ${i}`)
      }
    })

    it('should append many times efficiently', async () => {
      const start = performance.now()

      for (let i = 0; i < 50; i++) {
        await fs.appendFile('/append.txt', `line ${i}\n`)
      }

      const duration = performance.now() - start
      console.log(`50 appends: ${duration.toFixed(2)}ms`)
      expect(duration).toBeLessThan(2000)

      const content = await fs.readFile('/append.txt', { encoding: 'utf-8' }) as string
      expect(content.split('\n').filter(Boolean)).toHaveLength(50)
    })
  })

  describe('statfs()', () => {
    it('should return filesystem statistics', async () => {
      const stats = await fs.statfs()

      expect(stats.type).toBe(0)
      expect(stats.bsize).toBe(4096)
      expect(stats.blocks).toBeGreaterThan(0)
      expect(stats.bfree).toBeGreaterThan(0)
      expect(stats.bavail).toBeGreaterThan(0)
      expect(stats.files).toBe(0)
      expect(stats.ffree).toBe(0)
      expect(stats.usage).toBeGreaterThan(0)
      expect(stats.quota).toBeGreaterThan(0)
    })

    it('should return usage and quota from Storage API', async () => {
      const stats = await fs.statfs()

      // Mock returns 50MB usage, 10GB quota
      expect(stats.usage).toBe(1024 * 1024 * 50)
      expect(stats.quota).toBe(1024 * 1024 * 1024 * 10)
    })

    it('should calculate blocks correctly', async () => {
      const stats = await fs.statfs()
      const bsize = 4096

      expect(stats.blocks).toBe(Math.floor(stats.quota / bsize))
      expect(stats.bfree).toBe(Math.floor((stats.quota - stats.usage) / bsize))
      expect(stats.bavail).toBe(stats.bfree)
    })

    it('should verify path exists when provided', async () => {
      await fs.writeFile('/test.txt', 'content')
      const stats = await fs.statfs('/test.txt')
      expect(stats.quota).toBeGreaterThan(0)
    })

    it('should throw for non-existent path', async () => {
      await expect(fs.statfs('/nonexistent'))
        .rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('should work with directory path', async () => {
      await fs.mkdir('/testdir')
      const stats = await fs.statfs('/testdir')
      expect(stats.quota).toBeGreaterThan(0)
    })
  })
})
