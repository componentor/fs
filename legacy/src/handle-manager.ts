import { normalize, segments, dirname } from './path-utils.js'
import { createENOENT } from './errors.js'

export interface HandleResult {
  dir: FileSystemDirectoryHandle
  name: string
  fileHandle: FileSystemFileHandle | null
  dirHandle: FileSystemDirectoryHandle | null
}

export interface GetHandleOptions {
  create?: boolean
  kind?: 'file' | 'directory'
}

const FILE_HANDLE_POOL_SIZE = 50
const DIR_CACHE_MAX_SIZE = 200

/**
 * Simple in-memory lock for preventing concurrent sync access handle creation
 * within the same JavaScript context. This is needed because sync access handles
 * are exclusive per file - only one can exist at a time.
 *
 * Optimized for the uncontended case (no Promise creation when lock is free).
 */
class FileLock {
  private active = new Set<string>()
  private queues = new Map<string, Array<() => void>>()

  async acquire(path: string): Promise<() => void> {
    if (!this.active.has(path)) {
      // Fast path: no contention, just mark as active
      this.active.add(path)
      return this.createRelease(path)
    }

    // Slow path: wait in queue
    await new Promise<void>(resolve => {
      let queue = this.queues.get(path)
      if (!queue) {
        queue = []
        this.queues.set(path, queue)
      }
      queue.push(resolve)
    })

    return this.createRelease(path)
  }

  private createRelease(path: string): () => void {
    return () => {
      const queue = this.queues.get(path)
      if (queue && queue.length > 0) {
        // Pass ownership to next waiter
        const next = queue.shift()!
        if (queue.length === 0) {
          this.queues.delete(path)
        }
        next()
      } else {
        // No waiters, release the lock
        this.active.delete(path)
      }
    }
  }
}

/** Global file lock instance for sync access handle serialization */
export const fileLock = new FileLock()

/**
 * Manages OPFS handles with caching for improved performance
 */
export class HandleManager {
  private rootPromise: Promise<FileSystemDirectoryHandle>
  private dirCache: Map<string, FileSystemDirectoryHandle> = new Map()
  private fileHandlePool: Map<string, FileSystemFileHandle> = new Map()

  constructor() {
    this.rootPromise = navigator.storage.getDirectory()
  }

  /**
   * Get the root directory handle
   */
  async getRoot(): Promise<FileSystemDirectoryHandle> {
    return this.rootPromise
  }

  /**
   * Cache a directory handle with LRU eviction
   */
  private cacheDirHandle(path: string, handle: FileSystemDirectoryHandle): void {
    if (this.dirCache.size >= DIR_CACHE_MAX_SIZE) {
      // Delete oldest entry (first key in Map maintains insertion order)
      const firstKey = this.dirCache.keys().next().value
      if (firstKey) this.dirCache.delete(firstKey)
    }
    this.dirCache.set(path, handle)
  }

  /**
   * Clear directory cache for a path and its children
   */
  clearCache(path = ''): void {
    const normalizedPath = normalize(path)

    // For root path, just clear everything
    if (normalizedPath === '/' || normalizedPath === '') {
      this.dirCache.clear()
      this.fileHandlePool.clear()
      return
    }

    // Clear directory cache
    if (this.dirCache.size > 0) {
      for (const key of this.dirCache.keys()) {
        if (key === normalizedPath || key.startsWith(normalizedPath + '/')) {
          this.dirCache.delete(key)
        }
      }
    }

    // Clear file handle pool for affected paths
    if (this.fileHandlePool.size > 0) {
      for (const key of this.fileHandlePool.keys()) {
        if (key === normalizedPath || key.startsWith(normalizedPath + '/')) {
          this.fileHandlePool.delete(key)
        }
      }
    }
  }

  /**
   * Get a file handle from the pool or create a new one
   */
  async getPooledFileHandle(path: string, create = false): Promise<FileSystemFileHandle | null> {
    const normalizedPath = normalize(path)

    // Check pool first
    const pooled = this.fileHandlePool.get(normalizedPath)
    if (pooled) {
      return pooled
    }

    // Get handle the normal way
    const { fileHandle } = await this.getHandle(normalizedPath, { create })
    if (!fileHandle) return null

    // Add to pool with LRU eviction
    if (this.fileHandlePool.size >= FILE_HANDLE_POOL_SIZE) {
      // Delete oldest entry (first key in Map maintains insertion order)
      const firstKey = this.fileHandlePool.keys().next().value
      if (firstKey) this.fileHandlePool.delete(firstKey)
    }
    this.fileHandlePool.set(normalizedPath, fileHandle)

    return fileHandle
  }

  /**
   * Invalidate a specific file handle from the pool
   */
  invalidateFileHandle(path: string): void {
    const normalizedPath = normalize(path)
    this.fileHandlePool.delete(normalizedPath)
  }

  /**
   * Get file or directory handle for a path
   */
  async getHandle(path: string, opts: GetHandleOptions = {}): Promise<HandleResult> {
    // Use segments() for optimized path parsing (leverages normalize cache)
    const parts = segments(path)

    // Handle root or empty path
    if (parts.length === 0) {
      const root = await this.rootPromise
      return { dir: root, name: '', fileHandle: null, dirHandle: root }
    }

    let dir = await this.rootPromise
    let currentPath = ''

    // Navigate to parent directory using cache
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath += '/' + parts[i]

      // Check cache first for better performance
      if (this.dirCache.has(currentPath)) {
        dir = this.dirCache.get(currentPath)!
        continue
      }

      try {
        dir = await dir.getDirectoryHandle(parts[i], { create: opts.create })
        this.cacheDirHandle(currentPath, dir)
      } catch {
        throw createENOENT(path)
      }
    }

    const name = parts[parts.length - 1]

    try {
      if (opts.kind === 'directory') {
        const dirHandle = await dir.getDirectoryHandle(name, { create: opts.create })
        return { dir, name, fileHandle: null, dirHandle }
      } else {
        const fileHandle = await dir.getFileHandle(name, { create: opts.create })
        return { dir, name, fileHandle, dirHandle: null }
      }
    } catch {
      if (!opts.create) {
        return { dir, name, fileHandle: null, dirHandle: null }
      }
      throw createENOENT(path)
    }
  }

  /**
   * Get directory handle with caching
   */
  async getDirectoryHandle(path: string): Promise<FileSystemDirectoryHandle> {
    const normalizedPath = normalize(path)

    if (normalizedPath === '/' || normalizedPath === '') {
      return this.rootPromise
    }

    // Check cache first
    if (this.dirCache.has(normalizedPath)) {
      return this.dirCache.get(normalizedPath)!
    }

    const parts = segments(normalizedPath)
    let dir = await this.rootPromise
    let currentPath = ''

    for (const part of parts) {
      currentPath += '/' + part

      if (this.dirCache.has(currentPath)) {
        dir = this.dirCache.get(currentPath)!
        continue
      }

      dir = await dir.getDirectoryHandle(part)
      this.cacheDirHandle(currentPath, dir)
    }

    return dir
  }

  /**
   * Ensure parent directory exists
   */
  async ensureParentDir(path: string): Promise<void> {
    const parentPath = dirname(path)
    if (parentPath === '/' || parentPath === '') return

    const parts = segments(parentPath)
    let dir = await this.rootPromise
    let currentPath = ''

    for (const part of parts) {
      currentPath += '/' + part

      // Check cache first for better performance
      if (this.dirCache.has(currentPath)) {
        dir = this.dirCache.get(currentPath)!
        continue
      }

      dir = await dir.getDirectoryHandle(part, { create: true })
      this.cacheDirHandle(currentPath, dir)
    }
  }

  /**
   * Create directory (with automatic parent creation)
   */
  async mkdir(path: string): Promise<void> {
    const normalizedPath = normalize(path)
    this.clearCache(normalizedPath)

    const parts = segments(normalizedPath)
    let dir = await this.rootPromise

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const subPath = '/' + parts.slice(0, i + 1).join('/')

      if (this.dirCache.has(subPath)) {
        dir = this.dirCache.get(subPath)!
      } else {
        dir = await dir.getDirectoryHandle(part, { create: true })
        this.cacheDirHandle(subPath, dir)
      }
    }
  }
}
