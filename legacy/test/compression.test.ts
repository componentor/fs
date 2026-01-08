import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import OPFS from '../dist/index.js'

// Mock CompressionStream and DecompressionStream for compression tests only
// These use a simple identity transform with gzip magic header
class MockCompressionStream {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>

  constructor(_format: string) {
    let controller: ReadableStreamDefaultController<Uint8Array>

    this.readable = new ReadableStream({
      start(c) {
        controller = c
      }
    })

    this.writable = new WritableStream({
      write(chunk) {
        // Add gzip magic header to identify as "compressed"
        const compressed = new Uint8Array(chunk.length + 2)
        compressed[0] = 0x1f // gzip magic byte 1
        compressed[1] = 0x8b // gzip magic byte 2
        compressed.set(chunk, 2)
        controller.enqueue(compressed)
      },
      close() {
        controller.close()
      }
    })
  }
}

class MockDecompressionStream {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>

  constructor(_format: string) {
    let controller: ReadableStreamDefaultController<Uint8Array>

    this.readable = new ReadableStream({
      start(c) {
        controller = c
      }
    })

    this.writable = new WritableStream({
      write(chunk) {
        // Check for gzip magic header and remove it
        if (chunk.length >= 2 && chunk[0] === 0x1f && chunk[1] === 0x8b) {
          controller.enqueue(chunk.slice(2))
        } else {
          throw new Error('Invalid gzip data')
        }
      },
      close() {
        controller.close()
      }
    })
  }
}

describe('Compression', () => {
  let fs: OPFS

  // Store original values
  const originalCompressionStream = globalThis.CompressionStream
  const originalDecompressionStream = globalThis.DecompressionStream

  beforeAll(() => {
    // Install mock for compression tests
    // @ts-expect-error - mock
    globalThis.CompressionStream = MockCompressionStream
    // @ts-expect-error - mock
    globalThis.DecompressionStream = MockDecompressionStream
  })

  afterAll(() => {
    // Restore original values
    // @ts-expect-error - restore
    globalThis.CompressionStream = originalCompressionStream
    // @ts-expect-error - restore
    globalThis.DecompressionStream = originalDecompressionStream
  })

  beforeEach(() => {
    resetFileSystem()
  })

  describe('with compression enabled', () => {
    beforeEach(() => {
      fs = new OPFS({ useSync: true, useCompression: true })
    })

    it('should compress and decompress data in batch writes', async () => {
      const entries = [
        { path: '/file1.txt', data: 'Hello World! This is a test file with enough content to be compressed.' },
        { path: '/file2.txt', data: 'Another file with some more content that should also be compressed properly.' },
        { path: '/file3.txt', data: 'Third file in the batch write operation with compression enabled by default.' }
      ]

      await fs.writeFileBatch(entries)

      // Read back and verify content
      const content1 = await fs.readFile('/file1.txt', { encoding: 'utf-8' })
      const content2 = await fs.readFile('/file2.txt', { encoding: 'utf-8' })
      const content3 = await fs.readFile('/file3.txt', { encoding: 'utf-8' })

      expect(content1).toBe(entries[0].data)
      expect(content2).toBe(entries[1].data)
      expect(content3).toBe(entries[2].data)
    })

    it('should handle batch read with compressed files', async () => {
      const entries = [
        { path: '/a.txt', data: 'Content for file A - needs to be long enough for compression' },
        { path: '/b.txt', data: 'Content for file B - also needs to be long enough for compression' },
        { path: '/c.txt', data: 'Content for file C - must be long enough for compression to kick in' }
      ]

      await fs.writeFileBatch(entries)

      const results = await fs.readFileBatch(['/a.txt', '/b.txt', '/c.txt'])

      expect(new TextDecoder().decode(results[0].data!)).toBe(entries[0].data)
      expect(new TextDecoder().decode(results[1].data!)).toBe(entries[1].data)
      expect(new TextDecoder().decode(results[2].data!)).toBe(entries[2].data)
    })

    it('should not compress small files (< 100 bytes)', async () => {
      const smallContent = 'tiny'
      await fs.writeFileBatch([{ path: '/small.txt', data: smallContent }])

      const content = await fs.readFile('/small.txt', { encoding: 'utf-8' })
      expect(content).toBe(smallContent)
    })

    it('should handle binary data with compression', async () => {
      // Create binary data large enough to be compressed (> 100 bytes)
      const binaryData = new Uint8Array(200)
      for (let i = 0; i < binaryData.length; i++) {
        binaryData[i] = i % 256
      }

      await fs.writeFileBatch([{ path: '/binary.bin', data: binaryData }])

      const content = await fs.readFile('/binary.bin') as Uint8Array
      expect(content).toEqual(binaryData)
    })

    it('should return correct file size via stat (original size, not compressed)', async () => {
      const content = 'This is a longer piece of content that will be compressed when written to the pack file.'
      await fs.writeFileBatch([{ path: '/sized.txt', data: content }])

      const stat = await fs.stat('/sized.txt')
      expect(stat.size).toBe(content.length)
    })

    it('should handle mixed compressed and uncompressed files', async () => {
      const entries = [
        { path: '/big.txt', data: 'A'.repeat(200) }, // Will be compressed
        { path: '/small.txt', data: 'B'.repeat(50) }  // Too small, won't be compressed
      ]

      await fs.writeFileBatch(entries)

      const big = await fs.readFile('/big.txt', { encoding: 'utf-8' })
      const small = await fs.readFile('/small.txt', { encoding: 'utf-8' })

      expect(big).toBe(entries[0].data)
      expect(small).toBe(entries[1].data)
    })
  })

  describe('with compression disabled', () => {
    beforeEach(() => {
      fs = new OPFS({ useSync: true, useCompression: false })
    })

    it('should not compress files when disabled', async () => {
      const content = 'This content would normally be compressed but compression is disabled.'
      await fs.writeFileBatch([{ path: '/uncompressed.txt', data: content }])

      const result = await fs.readFile('/uncompressed.txt', { encoding: 'utf-8' })
      expect(result).toBe(content)
    })

    it('should handle batch operations without compression', async () => {
      const entries = [
        { path: '/x.txt', data: 'File X content that is long enough to normally trigger compression.' },
        { path: '/y.txt', data: 'File Y content that is also long enough to normally trigger compression.' }
      ]

      await fs.writeFileBatch(entries)

      const results = await fs.readFileBatch(['/x.txt', '/y.txt'])
      expect(new TextDecoder().decode(results[0].data!)).toBe(entries[0].data)
      expect(new TextDecoder().decode(results[1].data!)).toBe(entries[1].data)
    })
  })

  describe('compression edge cases', () => {
    beforeEach(() => {
      fs = new OPFS({ useSync: true, useCompression: true })
    })

    it('should handle empty batch write', async () => {
      await fs.writeFileBatch([])
      // Should not throw
    })

    it('should handle single file batch', async () => {
      const content = 'Single file content that is long enough to be compressed in batch mode.'
      await fs.writeFileBatch([{ path: '/single.txt', data: content }])

      const result = await fs.readFile('/single.txt', { encoding: 'utf-8' })
      expect(result).toBe(content)
    })

    it('should handle files with special characters in path', async () => {
      const content = 'Content with special path that needs compression to work correctly.'
      await fs.writeFileBatch([{ path: '/special-file_2024.data.txt', data: content }])

      const result = await fs.readFile('/special-file_2024.data.txt', { encoding: 'utf-8' })
      expect(result).toBe(content)
    })

    it('should handle multiple batch writes (pack file replacement)', async () => {
      // First batch
      await fs.writeFileBatch([
        { path: '/first.txt', data: 'First batch content that is long enough for compression.' }
      ])

      // Second batch replaces the pack
      await fs.writeFileBatch([
        { path: '/second.txt', data: 'Second batch content that is also long enough for compression.' }
      ])

      // First file should no longer exist (pack was replaced)
      await expect(fs.readFile('/first.txt')).rejects.toMatchObject({ code: 'ENOENT' })

      // Second file should exist
      const result = await fs.readFile('/second.txt', { encoding: 'utf-8' })
      expect(result).toBe('Second batch content that is also long enough for compression.')
    })

    it('should handle very large files', async () => {
      const largeContent = 'X'.repeat(100000) // 100KB
      await fs.writeFileBatch([{ path: '/large.txt', data: largeContent }])

      const result = await fs.readFile('/large.txt', { encoding: 'utf-8' })
      expect(result.length).toBe(largeContent.length)
      expect(result).toBe(largeContent)
    })
  })

  describe('async mode compression', () => {
    beforeEach(() => {
      fs = new OPFS({ useSync: false, useCompression: true })
    })

    it('should work with async mode and compression', async () => {
      const content = 'Async mode content that should be compressed and decompressed correctly.'
      await fs.writeFileBatch([{ path: '/async.txt', data: content }])

      const result = await fs.readFile('/async.txt', { encoding: 'utf-8' })
      expect(result).toBe(content)
    })

    it('should handle batch read in async mode', async () => {
      const entries = [
        { path: '/async1.txt', data: 'First async file with enough content for compression to work.' },
        { path: '/async2.txt', data: 'Second async file with enough content for compression to work.' }
      ]

      await fs.writeFileBatch(entries)

      const results = await fs.readFileBatch(['/async1.txt', '/async2.txt'])
      expect(new TextDecoder().decode(results[0].data!)).toBe(entries[0].data)
      expect(new TextDecoder().decode(results[1].data!)).toBe(entries[1].data)
    })
  })
})
