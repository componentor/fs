/**
 * Packed Storage - Stores multiple files in a single OPFS file
 *
 * Instead of creating 100 separate files (100 OPFS API calls),
 * we write all data to one pack file with an index (1-2 API calls).
 *
 * Format:
 * [index length: 4 bytes][CRC32: 4 bytes][JSON index][file data...]
 *
 * Index format:
 * { "path": { offset: number, size: number, originalSize?: number }, ... }
 *
 * When originalSize is present, data is compressed (size = compressed, originalSize = uncompressed)
 * CRC32 is calculated over [JSON index][file data...] for integrity verification.
 */

import type { HandleManager } from './handle-manager.js'
import { fileLock } from './handle-manager.js'
import { createECORRUPTED } from './errors.js'

// ============ Compression ============
// Uses browser's native CompressionStream API

async function compress(data: Uint8Array): Promise<Uint8Array> {
  // Skip compression for small data (overhead not worth it)
  if (data.length < 100) return data

  try {
    const stream = new CompressionStream('gzip')
    const writer = stream.writable.getWriter()
    writer.write(data)
    writer.close()

    const chunks: Uint8Array[] = []
    const reader = stream.readable.getReader()
    let totalSize = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      totalSize += value.length
    }

    // Only use compressed if it's actually smaller
    if (totalSize >= data.length) return data

    const result = new Uint8Array(totalSize)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    return result
  } catch {
    // Compression not available, return original
    return data
  }
}

async function decompress(data: Uint8Array): Promise<Uint8Array> {
  // Decompression MUST succeed for compressed data - throw on failure
  const stream = new DecompressionStream('gzip')
  const writer = stream.writable.getWriter()
  writer.write(data)
  writer.close()

  const chunks: Uint8Array[] = []
  const reader = stream.readable.getReader()
  let totalSize = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    totalSize += value.length
  }

  const result = new Uint8Array(totalSize)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

// ============ CRC32 ============

// CRC32 lookup table (pre-computed for performance)
const CRC32_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  CRC32_TABLE[i] = c
}

/**
 * Calculate CRC32 checksum of data
 */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// ============ Types ============

interface PackIndexEntry {
  offset: number
  size: number
  originalSize?: number // Present if compressed
}

interface PackIndex {
  [path: string]: PackIndexEntry
}

const PACK_FILE = '/.opfs-pack'

export class PackedStorage {
  private handleManager: HandleManager
  private useSync: boolean
  private useCompression: boolean
  private useChecksum: boolean
  private index: PackIndex | null = null
  private indexLoaded = false

  constructor(handleManager: HandleManager, useSync: boolean, useCompression = false, useChecksum = true) {
    this.handleManager = handleManager
    this.useSync = useSync
    // Only enable compression if API is available
    this.useCompression = useCompression && typeof CompressionStream !== 'undefined'
    this.useChecksum = useChecksum
  }

  /**
   * Reset pack storage state (memory only)
   */
  reset(): void {
    this.index = null
    this.indexLoaded = false
  }

  /**
   * Clear pack storage completely (deletes pack file from disk)
   */
  async clear(): Promise<void> {
    this.index = null
    this.indexLoaded = false

    try {
      const root = await this.handleManager.getRoot()
      await root.removeEntry(PACK_FILE.replace(/^\//, ''))
    } catch {
      // Pack file doesn't exist, that's fine
    }
  }

  /**
   * Load pack index from disk (always reloads to support hybrid mode)
   * Verifies CRC32 checksum for integrity
   * Note: Caller must hold the lock
   */
  private async loadIndex(): Promise<PackIndex> {
    try {
      const { fileHandle } = await this.handleManager.getHandle(PACK_FILE)
      if (!fileHandle) {
        return {}
      }

      if (this.useSync) {
        const release = await fileLock.acquire(PACK_FILE)
        try {
          const access = await fileHandle.createSyncAccessHandle()
          try {
            const size = access.getSize()
            if (size < 8) {
              return {}
            }

            // Read header: index length + CRC32
            const header = new Uint8Array(8)
            access.read(header, { at: 0 })
            const view = new DataView(header.buffer)
            const indexLen = view.getUint32(0, true)
            const storedCrc = view.getUint32(4, true)

            // Read everything after header (index + data) for CRC verification
            const contentSize = size - 8
            const content = new Uint8Array(contentSize)
            access.read(content, { at: 8 })

            // Verify CRC32 if enabled
            if (this.useChecksum && storedCrc !== 0) {
              const calculatedCrc = crc32(content)
              if (calculatedCrc !== storedCrc) {
                throw createECORRUPTED(PACK_FILE)
              }
            }

            // Parse index from content
            const indexJson = new TextDecoder().decode(content.subarray(0, indexLen))
            return JSON.parse(indexJson)
          } finally {
            access.close()
          }
        } finally {
          release()
        }
      } else {
        const file = await fileHandle.getFile()
        const data = new Uint8Array(await file.arrayBuffer())
        if (data.length < 8) {
          return {}
        }

        const view = new DataView(data.buffer)
        const indexLen = view.getUint32(0, true)
        const storedCrc = view.getUint32(4, true)

        // Verify CRC32 over content (everything after header) if enabled
        const content = data.subarray(8)
        if (this.useChecksum && storedCrc !== 0) {
          const calculatedCrc = crc32(content)
          if (calculatedCrc !== storedCrc) {
            throw createECORRUPTED(PACK_FILE)
          }
        }

        const indexJson = new TextDecoder().decode(content.subarray(0, indexLen))
        return JSON.parse(indexJson)
      }
    } catch {
      return {}
    }
  }

  /**
   * Check if a path exists in the pack
   */
  async has(path: string): Promise<boolean> {
    const index = await this.loadIndex()
    return path in index
  }

  /**
   * Get file size from pack (for stat)
   * Returns originalSize if compressed, otherwise size
   */
  async getSize(path: string): Promise<number | null> {
    const index = await this.loadIndex()
    const entry = index[path]
    if (!entry) return null
    return entry.originalSize ?? entry.size
  }

  /**
   * Read a file from the pack
   * Handles decompression if file was stored compressed
   */
  async read(path: string): Promise<Uint8Array | null> {
    const index = await this.loadIndex()
    const entry = index[path]
    if (!entry) return null

    const { fileHandle } = await this.handleManager.getHandle(PACK_FILE)
    if (!fileHandle) return null

    let buffer: Uint8Array

    if (this.useSync) {
      const release = await fileLock.acquire(PACK_FILE)
      try {
        const access = await fileHandle.createSyncAccessHandle()
        try {
          buffer = new Uint8Array(entry.size)
          access.read(buffer, { at: entry.offset })
        } finally {
          access.close()
        }
      } finally {
        release()
      }
    } else {
      const file = await fileHandle.getFile()
      const data = new Uint8Array(await file.arrayBuffer())
      buffer = data.slice(entry.offset, entry.offset + entry.size)
    }

    // Decompress if needed
    if (entry.originalSize !== undefined) {
      return decompress(buffer)
    }

    return buffer
  }

  /**
   * Read multiple files from the pack in a single operation
   * Loads index once, reads all data in parallel
   * Handles decompression if files were stored compressed
   */
  async readBatch(paths: string[]): Promise<Map<string, Uint8Array | null>> {
    const results = new Map<string, Uint8Array | null>()
    if (paths.length === 0) return results

    const index = await this.loadIndex()

    // Find which paths are in the pack
    const toRead: Array<{ path: string; offset: number; size: number; originalSize?: number }> = []
    for (const path of paths) {
      const entry = index[path]
      if (entry) {
        toRead.push({ path, offset: entry.offset, size: entry.size, originalSize: entry.originalSize })
      } else {
        results.set(path, null)
      }
    }

    if (toRead.length === 0) return results

    const { fileHandle } = await this.handleManager.getHandle(PACK_FILE)
    if (!fileHandle) {
      for (const { path } of toRead) {
        results.set(path, null)
      }
      return results
    }

    // Read all files
    const decompressPromises: Array<{ path: string; promise: Promise<Uint8Array> }> = []

    if (this.useSync) {
      const release = await fileLock.acquire(PACK_FILE)
      try {
        const access = await fileHandle.createSyncAccessHandle()
        try {
          for (const { path, offset, size, originalSize } of toRead) {
            const buffer = new Uint8Array(size)
            access.read(buffer, { at: offset })

            if (originalSize !== undefined) {
              // Queue for decompression
              decompressPromises.push({ path, promise: decompress(buffer) })
            } else {
              results.set(path, buffer)
            }
          }
        } finally {
          access.close()
        }
      } finally {
        release()
      }
    } else {
      const file = await fileHandle.getFile()
      const data = new Uint8Array(await file.arrayBuffer())
      for (const { path, offset, size, originalSize } of toRead) {
        const buffer = data.slice(offset, offset + size)

        if (originalSize !== undefined) {
          decompressPromises.push({ path, promise: decompress(buffer) })
        } else {
          results.set(path, buffer)
        }
      }
    }

    // Wait for all decompressions
    for (const { path, promise } of decompressPromises) {
      results.set(path, await promise)
    }

    return results
  }

  /**
   * Write multiple files to the pack in a single operation
   * This is the key optimization - 100 files become 1 write!
   * Includes CRC32 checksum for integrity verification.
   * Optionally compresses data for smaller storage.
   * Note: This replaces the entire pack with the new entries
   */
  async writeBatch(entries: Array<{ path: string; data: Uint8Array }>): Promise<void> {
    if (entries.length === 0) return

    const encoder = new TextEncoder()

    // Compress data if enabled
    let processedEntries: Array<{ path: string; data: Uint8Array; originalSize?: number }>
    if (this.useCompression) {
      processedEntries = await Promise.all(
        entries.map(async ({ path, data }) => {
          const compressed = await compress(data)
          // Only use compressed if it's actually smaller
          if (compressed.length < data.length) {
            return { path, data: compressed, originalSize: data.length }
          }
          return { path, data }
        })
      )
    } else {
      processedEntries = entries
    }

    // Calculate total data size (using compressed sizes where applicable)
    let totalDataSize = 0
    for (const { data } of processedEntries) {
      totalDataSize += data.length
    }

    // Build index - iterate until offsets stabilize
    // (offset changes -> JSON length changes -> header size changes -> offset changes)
    // Header format: [index length: 4][CRC32: 4][JSON index][file data...]
    const newIndex: PackIndex = {}
    let headerSize = 8 // 4 bytes index length + 4 bytes CRC32
    let prevHeaderSize = 0

    // Iterate until stable (usually 2-3 iterations)
    while (headerSize !== prevHeaderSize) {
      prevHeaderSize = headerSize

      let currentOffset = headerSize
      for (const { path, data, originalSize } of processedEntries) {
        const entry: PackIndexEntry = { offset: currentOffset, size: data.length }
        if (originalSize !== undefined) {
          entry.originalSize = originalSize
        }
        newIndex[path] = entry
        currentOffset += data.length
      }

      const indexBuf = encoder.encode(JSON.stringify(newIndex))
      headerSize = 8 + indexBuf.length
    }

    // Build the complete pack file
    const finalIndexBuf = encoder.encode(JSON.stringify(newIndex))
    const totalSize = headerSize + totalDataSize
    const packBuffer = new Uint8Array(totalSize)
    const view = new DataView(packBuffer.buffer)

    // Write index JSON at offset 8
    packBuffer.set(finalIndexBuf, 8)

    // Write data at correct offsets
    for (const { path, data } of processedEntries) {
      const entry = newIndex[path]
      packBuffer.set(data, entry.offset)
    }

    // Calculate CRC32 over content (index + data, everything after header) if enabled
    const content = packBuffer.subarray(8)
    const checksum = this.useChecksum ? crc32(content) : 0

    // Write header (index length + CRC32)
    view.setUint32(0, finalIndexBuf.length, true)
    view.setUint32(4, checksum, true)

    await this.writePackFile(packBuffer)
    this.index = newIndex
  }

  /**
   * Write the pack file to OPFS
   * Note: Caller must hold the lock
   */
  private async writePackFile(data: Uint8Array): Promise<void> {
    const { fileHandle } = await this.handleManager.getHandle(PACK_FILE, { create: true })
    if (!fileHandle) return

    if (this.useSync) {
      const release = await fileLock.acquire(PACK_FILE)
      try {
        const access = await fileHandle.createSyncAccessHandle()
        try {
          access.truncate(data.length)
          access.write(data, { at: 0 })
        } finally {
          access.close()
        }
      } finally {
        release()
      }
    } else {
      const writable = await fileHandle.createWritable()
      await writable.write(data)
      await writable.close()
    }
  }

  /**
   * Remove a path from the pack index
   * Note: Doesn't reclaim space, just removes from index and recalculates CRC32
   */
  async remove(path: string): Promise<boolean> {
    const index = await this.loadIndex()
    if (!(path in index)) return false

    delete index[path]

    const { fileHandle } = await this.handleManager.getHandle(PACK_FILE)
    if (!fileHandle) return true

    // Need to read existing file to recalculate CRC32
    const encoder = new TextEncoder()
    const newIndexBuf = encoder.encode(JSON.stringify(index))

    if (this.useSync) {
      const release = await fileLock.acquire(PACK_FILE)
      try {
        const access = await fileHandle.createSyncAccessHandle()
        try {
          const size = access.getSize()

          // Read old header to get old index length
          const oldHeader = new Uint8Array(8)
          access.read(oldHeader, { at: 0 })
          const oldIndexLen = new DataView(oldHeader.buffer).getUint32(0, true)

          // Read data portion (after old index)
          const dataStart = 8 + oldIndexLen
          const dataSize = size - dataStart
          const dataPortion = new Uint8Array(dataSize)
          if (dataSize > 0) {
            access.read(dataPortion, { at: dataStart })
          }

          // Build new content (new index + data)
          const newContent = new Uint8Array(newIndexBuf.length + dataSize)
          newContent.set(newIndexBuf, 0)
          if (dataSize > 0) {
            newContent.set(dataPortion, newIndexBuf.length)
          }

          // Calculate new CRC32 if enabled
          const checksum = this.useChecksum ? crc32(newContent) : 0

          // Build new header
          const newHeader = new Uint8Array(8)
          const view = new DataView(newHeader.buffer)
          view.setUint32(0, newIndexBuf.length, true)
          view.setUint32(4, checksum, true)

          // Write new file
          const newFile = new Uint8Array(8 + newContent.length)
          newFile.set(newHeader, 0)
          newFile.set(newContent, 8)

          access.truncate(newFile.length)
          access.write(newFile, { at: 0 })
        } finally {
          access.close()
        }
      } finally {
        release()
      }
    } else {
      // For non-sync, rewrite the whole file
      const file = await fileHandle.getFile()
      const oldData = new Uint8Array(await file.arrayBuffer())

      if (oldData.length < 8) return true

      const oldIndexLen = new DataView(oldData.buffer).getUint32(0, true)
      const dataStart = 8 + oldIndexLen
      const dataPortion = oldData.subarray(dataStart)

      // Build new content
      const newContent = new Uint8Array(newIndexBuf.length + dataPortion.length)
      newContent.set(newIndexBuf, 0)
      newContent.set(dataPortion, newIndexBuf.length)

      // Calculate CRC32 if enabled
      const checksum = this.useChecksum ? crc32(newContent) : 0

      // Build new file
      const newFile = new Uint8Array(8 + newContent.length)
      const view = new DataView(newFile.buffer)
      view.setUint32(0, newIndexBuf.length, true)
      view.setUint32(4, checksum, true)
      newFile.set(newContent, 8)

      const writable = await fileHandle.createWritable()
      await writable.write(newFile)
      await writable.close()
    }

    return true
  }

  /**
   * Check if pack file is being used (has entries)
   */
  async isEmpty(): Promise<boolean> {
    const index = await this.loadIndex()
    return Object.keys(index).length === 0
  }
}
