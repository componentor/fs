import type { SymlinkCache, SymlinkDefinition } from './types.js'
import type { HandleManager } from './handle-manager.js'
import { fileLock } from './handle-manager.js'
import { normalize } from './path-utils.js'
import { createELOOP, createEINVAL, createEEXIST } from './errors.js'

const SYMLINK_FILE = '/.opfs-symlinks.json'
const MAX_SYMLINK_DEPTH = 10

/**
 * Manages symbolic link emulation using a JSON metadata file
 */
export class SymlinkManager {
  private cache: SymlinkCache | null = null
  private cacheCount = 0 // Track count to avoid Object.keys() calls
  private resolvedCache: Map<string, string> = new Map() // Cache resolved paths
  private dirty = false
  private handleManager: HandleManager
  private useSync: boolean
  private loadPromise: Promise<SymlinkCache> | null = null // Avoid multiple concurrent loads
  private diskLoaded = false // Track if we've loaded from disk

  constructor(handleManager: HandleManager, useSync: boolean) {
    this.handleManager = handleManager
    this.useSync = useSync
    // Initialize with empty cache - most operations won't need symlinks
    this.cache = {}
    this.cacheCount = 0
  }

  /**
   * Reset all symlink state (called when root directory is cleared)
   */
  reset(): void {
    this.cache = {}
    this.cacheCount = 0
    this.resolvedCache.clear()
    this.dirty = false
    this.loadPromise = null
    this.diskLoaded = false
  }

  /**
   * Load symlinks from metadata file
   * Uses loadPromise to avoid multiple concurrent disk reads
   */
  async load(): Promise<SymlinkCache> {
    // Fast path: if we've already loaded from disk, use cached data
    if (this.diskLoaded) return this.cache!

    // If there's already a load in progress, wait for it
    if (this.loadPromise) return this.loadPromise

    // Load from disk
    this.loadPromise = this.loadFromDisk()
    const result = await this.loadPromise
    this.loadPromise = null
    return result
  }

  /**
   * Actually read from disk
   */
  private async loadFromDisk(): Promise<SymlinkCache> {
    try {
      const { fileHandle } = await this.handleManager.getHandle(SYMLINK_FILE)
      if (!fileHandle) {
        // No symlink file exists - keep empty cache
        this.diskLoaded = true
        return this.cache!
      }

      const file = await fileHandle.getFile()
      const text = await file.text()
      this.cache = JSON.parse(text)
      this.cacheCount = Object.keys(this.cache).length
      this.diskLoaded = true
    } catch {
      // Error reading - keep empty cache
      if (!this.cache) {
        this.cache = {}
        this.cacheCount = 0
      }
      this.diskLoaded = true
    }

    return this.cache!
  }

  /**
   * Save symlinks to metadata file
   */
  async save(): Promise<void> {
    if (!this.cache) return

    // Use compact JSON (no formatting) for better performance
    const data = JSON.stringify(this.cache)
    const { fileHandle } = await this.handleManager.getHandle(SYMLINK_FILE, { create: true })

    if (!fileHandle) return

    const buffer = new TextEncoder().encode(data)

    if (this.useSync) {
      const release = await fileLock.acquire(SYMLINK_FILE)
      try {
        const access = await fileHandle.createSyncAccessHandle()
        try {
          access.truncate(0)
          let written = 0
          while (written < buffer.length) {
            written += access.write(buffer.subarray(written), { at: written })
          }
        } finally {
          access.close()
        }
      } finally {
        release()
      }
    } else {
      const writable = await fileHandle.createWritable()
      await writable.write(buffer)
      await writable.close()
    }

    this.dirty = false
  }

  /**
   * Flush pending changes if dirty
   */
  async flush(): Promise<void> {
    if (this.dirty) {
      await this.save()
    }
  }

  /**
   * Resolve a path through symlinks
   * Fast synchronous path when cache is already loaded
   * Uses resolved cache for O(1) repeated lookups
   *
   * OPTIMIZATION: If we haven't loaded from disk yet AND no symlinks have been
   * created in this session, we skip the disk check entirely. This makes pure
   * file operations (no symlinks) very fast.
   */
  async resolve(path: string, maxDepth = MAX_SYMLINK_DEPTH): Promise<string> {
    // Ultra-fast path: if no symlinks exist in memory, return immediately
    // This covers both: (1) fresh session with no symlinks, (2) loaded from disk with no symlinks
    if (this.cacheCount === 0) {
      // If we've loaded from disk and it's empty, we're done
      // If we haven't loaded from disk, assume no symlinks until a symlink op is called
      return path
    }

    // We have symlinks in memory - resolve them
    // Check resolved cache first for instant lookup
    const cached = this.resolvedCache.get(path)
    if (cached !== undefined) {
      return cached
    }
    return this.resolveSync(path, this.cache!, maxDepth)
  }

  /**
   * Synchronous resolution helper - caches the result
   */
  private resolveSync(path: string, symlinks: SymlinkCache, maxDepth: number): string {
    let currentPath = path
    let depth = 0

    while (symlinks[currentPath] && depth < maxDepth) {
      currentPath = symlinks[currentPath]
      depth++
    }

    if (depth >= maxDepth) {
      throw createELOOP(path)
    }

    // Cache the resolved path if it was actually a symlink
    if (currentPath !== path) {
      this.resolvedCache.set(path, currentPath)
    }

    return currentPath
  }

  /**
   * Clear the resolved path cache (called when symlinks change)
   */
  private clearResolvedCache(): void {
    this.resolvedCache.clear()
  }

  /**
   * Check if a path is a symlink
   */
  async isSymlink(path: string): Promise<boolean> {
    const symlinks = await this.load()
    return !!symlinks[path]
  }

  /**
   * Get symlink target
   */
  async readlink(path: string): Promise<string> {
    const normalizedPath = normalize(path)
    const symlinks = await this.load()

    if (!symlinks[normalizedPath]) {
      throw createEINVAL(path)
    }

    return symlinks[normalizedPath]
  }

  /**
   * Create a symlink
   */
  async symlink(target: string, path: string, checkExists: () => Promise<void>): Promise<void> {
    const normalizedPath = normalize(path)
    const normalizedTarget = normalize(target)

    const symlinks = await this.load()

    if (symlinks[normalizedPath]) {
      throw createEEXIST(normalizedPath)
    }

    await checkExists()

    symlinks[normalizedPath] = normalizedTarget
    this.cacheCount++
    this.clearResolvedCache() // Invalidate resolved cache
    this.dirty = true
    await this.flush()
  }

  /**
   * Create multiple symlinks efficiently
   */
  async symlinkBatch(
    links: SymlinkDefinition[],
    checkExists: (path: string) => Promise<void>
  ): Promise<void> {
    const symlinks = await this.load()

    // Prepare all normalized paths first
    const normalizedLinks = links.map(({ target, path }) => ({
      normalizedPath: normalize(path),
      normalizedTarget: normalize(target)
    }))

    // Check for existing symlinks in memory (fast)
    for (const { normalizedPath } of normalizedLinks) {
      if (symlinks[normalizedPath]) {
        throw createEEXIST(normalizedPath)
      }
    }

    // Check filesystem existence in parallel (I/O bound)
    await Promise.all(normalizedLinks.map(({ normalizedPath }) => checkExists(normalizedPath)))

    // Add all symlinks at once
    for (const { normalizedPath, normalizedTarget } of normalizedLinks) {
      symlinks[normalizedPath] = normalizedTarget
    }

    this.cacheCount += links.length
    this.clearResolvedCache() // Invalidate resolved cache
    this.dirty = true
    await this.flush()
  }

  /**
   * Remove a symlink
   */
  async unlink(path: string): Promise<boolean> {
    const symlinks = await this.load()

    if (symlinks[path]) {
      delete symlinks[path]
      this.cacheCount--
      this.clearResolvedCache() // Invalidate resolved cache
      this.dirty = true
      await this.flush()
      return true
    }

    return false
  }

  /**
   * Rename/move a symlink
   */
  async rename(oldPath: string, newPath: string): Promise<boolean> {
    const symlinks = await this.load()

    if (symlinks[oldPath]) {
      const target = symlinks[oldPath]
      delete symlinks[oldPath]
      symlinks[newPath] = target
      this.clearResolvedCache() // Invalidate resolved cache
      this.dirty = true
      await this.flush()
      return true
    }

    return false
  }

  /**
   * Get all symlinks in a directory
   */
  async getSymlinksInDir(dirPath: string): Promise<string[]> {
    const symlinks = await this.load()
    const result: string[] = []

    for (const symlinkPath of Object.keys(symlinks)) {
      const parts = symlinkPath.split('/').filter(Boolean)
      const parentPath = '/' + parts.slice(0, -1).join('/')

      if (parentPath === dirPath || (dirPath === '/' && parts.length === 1)) {
        result.push(parts[parts.length - 1])
      }
    }

    return result
  }

  /**
   * Check if path is the symlink metadata file
   */
  isMetadataFile(name: string): boolean {
    return name === SYMLINK_FILE.replace(/^\/+/, '')
  }
}
