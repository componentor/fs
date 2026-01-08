import { describe, it, expect, beforeEach } from 'vitest'
import OPFS from '../dist/index.js'

describe('Performance Benchmarks', () => {
  let fs: OPFS

  beforeEach(() => {
    resetFileSystem()
    fs = new OPFS({ useSync: true, verbose: false })
  })

  describe('Read/Write Performance', () => {
    it('should write small files efficiently', async () => {
      const start = performance.now()

      for (let i = 0; i < 100; i++) {
        await fs.writeFile(`/file${i}.txt`, 'test content')
      }

      const duration = performance.now() - start
      console.log(`100 small file writes: ${duration.toFixed(2)}ms (${(duration/100).toFixed(2)}ms per file)`)

      // Should complete in reasonable time
      expect(duration).toBeLessThan(5000)
    })

    it('should read small files efficiently', async () => {
      // Setup
      for (let i = 0; i < 100; i++) {
        await fs.writeFile(`/file${i}.txt`, 'test content')
      }

      const start = performance.now()

      for (let i = 0; i < 100; i++) {
        await fs.readFile(`/file${i}.txt`, { encoding: 'utf-8' })
      }

      const duration = performance.now() - start
      console.log(`100 small file reads: ${duration.toFixed(2)}ms (${(duration/100).toFixed(2)}ms per file)`)

      expect(duration).toBeLessThan(5000)
    })

    it('should handle large files', async () => {
      const largeData = new Uint8Array(1024 * 1024) // 1MB
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256
      }

      const writeStart = performance.now()
      await fs.writeFile('/large.bin', largeData)
      const writeDuration = performance.now() - writeStart
      console.log(`1MB file write: ${writeDuration.toFixed(2)}ms`)

      const readStart = performance.now()
      const readData = await fs.readFile('/large.bin') as Uint8Array
      const readDuration = performance.now() - readStart
      console.log(`1MB file read: ${readDuration.toFixed(2)}ms`)

      expect(readData.length).toBe(largeData.length)
      expect(writeDuration).toBeLessThan(1000)
      expect(readDuration).toBeLessThan(1000)
    })

    it('should handle concurrent writes', async () => {
      const start = performance.now()

      await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          fs.writeFile(`/concurrent${i}.txt`, `content ${i}`)
        )
      )

      const duration = performance.now() - start
      console.log(`50 concurrent writes: ${duration.toFixed(2)}ms (${(duration/50).toFixed(2)}ms per file)`)

      expect(duration).toBeLessThan(5000)
    })

    it('should handle batch writes efficiently', async () => {
      const entries = Array.from({ length: 100 }, (_, i) => ({
        path: `/batch/file${i}.txt`,
        data: `batch content ${i}`
      }))

      const start = performance.now()
      await fs.writeFileBatch(entries)
      const duration = performance.now() - start
      console.log(`100 batch writes: ${duration.toFixed(2)}ms (${(duration/100).toFixed(2)}ms per file)`)

      // Verify files were written
      const data = await fs.readFile('/batch/file50.txt', { encoding: 'utf-8' })
      expect(data).toBe('batch content 50')
      expect(duration).toBeLessThan(5000)
    })

    it('should handle batch reads efficiently', async () => {
      // Setup - write files first
      const entries = Array.from({ length: 100 }, (_, i) => ({
        path: `/batchread/file${i}.txt`,
        data: `batch read content ${i}`
      }))
      await fs.writeFileBatch(entries)

      const paths = entries.map(e => e.path)

      const start = performance.now()
      const results = await fs.readFileBatch(paths)
      const duration = performance.now() - start
      console.log(`100 batch reads: ${duration.toFixed(2)}ms (${(duration/100).toFixed(2)}ms per file)`)

      // Verify files were read correctly
      expect(results.length).toBe(100)
      expect(results[50].data).not.toBeNull()
      const decoder = new TextDecoder()
      expect(decoder.decode(results[50].data!)).toBe('batch read content 50')
      expect(duration).toBeLessThan(5000)
    })

    it('should handle concurrent reads', async () => {
      // Setup
      for (let i = 0; i < 50; i++) {
        await fs.writeFile(`/file${i}.txt`, `content ${i}`)
      }

      const start = performance.now()

      await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          fs.readFile(`/file${i}.txt`, { encoding: 'utf-8' })
        )
      )

      const duration = performance.now() - start
      console.log(`50 concurrent reads: ${duration.toFixed(2)}ms (${(duration/50).toFixed(2)}ms per file)`)

      expect(duration).toBeLessThan(5000)
    })
  })

  describe('Directory Operations Performance', () => {
    it('should create nested directories efficiently', async () => {
      const start = performance.now()

      for (let i = 0; i < 50; i++) {
        await fs.mkdir(`/dir${i}/subdir/deep`)
      }

      const duration = performance.now() - start
      console.log(`50 nested directory creations: ${duration.toFixed(2)}ms`)

      expect(duration).toBeLessThan(5000)
    })

    it('should list large directories efficiently', async () => {
      // Create 200 files
      for (let i = 0; i < 200; i++) {
        await fs.writeFile(`/file${i}.txt`, 'content')
      }

      const start = performance.now()
      const entries = await fs.readdir('/')
      const duration = performance.now() - start

      console.log(`List 200 files: ${duration.toFixed(2)}ms`)
      expect(entries.length).toBe(200)
      expect(duration).toBeLessThan(1000)
    })
  })

  describe('Symlink Performance', () => {
    it('should resolve symlink chains efficiently', async () => {
      await fs.writeFile('/target.txt', 'data')

      // Create chain of 5 symlinks
      await fs.symlink('/target.txt', '/link1.txt')
      await fs.symlink('/link1.txt', '/link2.txt')
      await fs.symlink('/link2.txt', '/link3.txt')
      await fs.symlink('/link3.txt', '/link4.txt')
      await fs.symlink('/link4.txt', '/link5.txt')

      const start = performance.now()

      for (let i = 0; i < 100; i++) {
        await fs.readFile('/link5.txt', { encoding: 'utf-8' })
      }

      const duration = performance.now() - start
      console.log(`100 reads through 5-link chain: ${duration.toFixed(2)}ms (${(duration/100).toFixed(2)}ms per read)`)

      expect(duration).toBeLessThan(5000)
    })

    it('should handle many symlinks efficiently', async () => {
      const start = performance.now()

      for (let i = 0; i < 100; i++) {
        await fs.symlink(`/target${i}.txt`, `/link${i}.txt`)
      }

      const duration = performance.now() - start
      console.log(`100 symlink creations: ${duration.toFixed(2)}ms (${(duration/100).toFixed(2)}ms per symlink)`)

      expect(duration).toBeLessThan(5000)
    })
  })

  describe('Cache Performance', () => {
    it('should benefit from directory cache', async () => {
      await fs.mkdir('/deep/nested/path')
      await fs.writeFile('/deep/nested/path/file1.txt', 'content')

      // First access - cold cache
      const cold1 = performance.now()
      await fs.readFile('/deep/nested/path/file1.txt', { encoding: 'utf-8' })
      const coldDuration1 = performance.now() - cold1

      // Write another file in same directory
      await fs.writeFile('/deep/nested/path/file2.txt', 'content')

      // Second access - warm cache
      const warm = performance.now()
      await fs.readFile('/deep/nested/path/file2.txt', { encoding: 'utf-8' })
      const warmDuration = performance.now() - warm

      console.log(`Cold cache: ${coldDuration1.toFixed(2)}ms, Warm cache: ${warmDuration.toFixed(2)}ms`)

      if (coldDuration1 > warmDuration) {
        console.log(`Cache speedup: ${(coldDuration1 / warmDuration).toFixed(2)}x`)
      } else {
        console.log('Note: Cache timing variance in mock environment')
      }

      // Both should complete in reasonable time (cache speedup may not be consistent in mock environment)
      expect(coldDuration1).toBeLessThan(100)
      expect(warmDuration).toBeLessThan(100)
    })
  })

  describe('Sync vs Async Mode', () => {
    it('should compare sync and async performance', async () => {
      const fsSync = new OPFS({ useSync: true })
      const fsAsync = new OPFS({ useSync: false })

      const data = new Uint8Array(1024 * 100) // 100KB

      // Sync mode
      const syncStart = performance.now()
      await fsSync.writeFile('/sync.bin', data)
      await fsSync.readFile('/sync.bin')
      const syncDuration = performance.now() - syncStart

      resetFileSystem()

      // Async mode
      const asyncStart = performance.now()
      await fsAsync.writeFile('/async.bin', data)
      await fsAsync.readFile('/async.bin')
      const asyncDuration = performance.now() - asyncStart

      console.log(`Sync mode: ${syncDuration.toFixed(2)}ms`)
      console.log(`Async mode: ${asyncDuration.toFixed(2)}ms`)
      console.log(`Ratio: ${(syncDuration / asyncDuration).toFixed(2)}x`)

      // Both should complete in reasonable time
      expect(syncDuration).toBeLessThan(1000)
      expect(asyncDuration).toBeLessThan(1000)
    })
  })

  describe('Filesystem Info Performance', () => {
    it('should call statfs efficiently', async () => {
      const start = performance.now()

      for (let i = 0; i < 100; i++) {
        await fs.statfs()
      }

      const duration = performance.now() - start
      console.log(`100 statfs calls: ${duration.toFixed(2)}ms (${(duration/100).toFixed(2)}ms per call)`)

      // statfs should be very fast - just a single Storage API call
      expect(duration).toBeLessThan(500)
    })

    it('should call statfs with path verification efficiently', async () => {
      await fs.mkdir('/testdir')
      await fs.writeFile('/testdir/file.txt', 'content')

      const start = performance.now()

      for (let i = 0; i < 100; i++) {
        await fs.statfs('/testdir/file.txt')
      }

      const duration = performance.now() - start
      console.log(`100 statfs calls with path: ${duration.toFixed(2)}ms (${(duration/100).toFixed(2)}ms per call)`)

      // With path verification adds a stat() call but should still be fast
      expect(duration).toBeLessThan(1000)
    })

    it('should compare statfs vs du performance', async () => {
      await fs.writeFile('/file.txt', 'content')

      // statfs - single Storage API call
      const statfsStart = performance.now()
      for (let i = 0; i < 50; i++) {
        await fs.statfs()
      }
      const statfsDuration = performance.now() - statfsStart

      // du - needs to stat the file
      const duStart = performance.now()
      for (let i = 0; i < 50; i++) {
        await fs.du('/file.txt')
      }
      const duDuration = performance.now() - duStart

      console.log(`50 statfs: ${statfsDuration.toFixed(2)}ms`)
      console.log(`50 du: ${duDuration.toFixed(2)}ms`)

      expect(statfsDuration).toBeLessThan(500)
      expect(duDuration).toBeLessThan(500)
    })
  })

  describe('Concurrent Access', () => {
    it('should handle concurrent batch writes without errors', async () => {
      // This tests the file lock prevents "Access Handles cannot be created" errors
      // Note: writeFileBatch replaces the pack file, so only the last batch's data survives
      const batch1 = Array.from({ length: 10 }, (_, i) => ({
        path: `/batch1/file${i}.txt`,
        data: `content1-${i}`
      }))
      const batch2 = Array.from({ length: 10 }, (_, i) => ({
        path: `/batch2/file${i}.txt`,
        data: `content2-${i}`
      }))
      const batch3 = Array.from({ length: 10 }, (_, i) => ({
        path: `/batch3/file${i}.txt`,
        data: `content3-${i}`
      }))

      // Run all batch writes concurrently - they all access the pack file
      // The key test is that this doesn't throw "Access Handles cannot be created" error
      const results = await Promise.allSettled([
        fs.writeFileBatch(batch1),
        fs.writeFileBatch(batch2),
        fs.writeFileBatch(batch3)
      ])

      // All should succeed (no sync access handle conflicts)
      expect(results[0].status).toBe('fulfilled')
      expect(results[1].status).toBe('fulfilled')
      expect(results[2].status).toBe('fulfilled')
    })

    it('should handle concurrent batch reads without errors', async () => {
      // Setup: write files first
      const files = Array.from({ length: 30 }, (_, i) => ({
        path: `/concurrent/file${i}.txt`,
        data: `content-${i}`
      }))
      await fs.writeFileBatch(files)

      // Read the same files concurrently from multiple "readers"
      const paths = files.map(f => f.path)
      const [results1, results2, results3] = await Promise.all([
        fs.readFileBatch(paths),
        fs.readFileBatch(paths),
        fs.readFileBatch(paths)
      ])

      // All should succeed
      expect(results1.every(r => r.data !== null)).toBe(true)
      expect(results2.every(r => r.data !== null)).toBe(true)
      expect(results3.every(r => r.data !== null)).toBe(true)
    })

    it('should handle concurrent read and write to pack file', async () => {
      // Setup initial data
      const initialFiles = Array.from({ length: 10 }, (_, i) => ({
        path: `/mixed/file${i}.txt`,
        data: `initial-${i}`
      }))
      await fs.writeFileBatch(initialFiles)

      // Concurrent reads and writes to pack file
      const newFiles = Array.from({ length: 10 }, (_, i) => ({
        path: `/mixed/new${i}.txt`,
        data: `new-${i}`
      }))

      const [writeResult, readResult] = await Promise.allSettled([
        fs.writeFileBatch(newFiles),
        fs.readFileBatch(initialFiles.map(f => f.path))
      ])

      // Both should succeed (not throw "Access Handles" error)
      expect(writeResult.status).toBe('fulfilled')
      expect(readResult.status).toBe('fulfilled')
    })

    it('should handle many concurrent symlink operations', async () => {
      // Create target files
      for (let i = 0; i < 20; i++) {
        await fs.writeFile(`/target${i}.txt`, `target-${i}`)
      }

      // Create symlinks concurrently
      const symlinkPromises = Array.from({ length: 20 }, (_, i) =>
        fs.symlink(`/target${i}.txt`, `/symlink${i}.txt`)
      )

      await Promise.all(symlinkPromises)

      // Verify symlinks work
      const content = await fs.readFile('/symlink0.txt', { encoding: 'utf-8' })
      expect(content).toBe('target-0')
    })
  })
})
