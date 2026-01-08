import type {
  OPFSOptions,
  ReadFileOptions,
  WriteFileOptions,
  BatchWriteEntry,
  BatchReadResult,
  ReaddirOptions,
  Dirent,
  Stats,
  StatFs,
  RmOptions,
  CpOptions,
  WatchOptions,
  FSWatcher,
  ReadStreamOptions,
  WriteStreamOptions,
  FileHandle,
  Dir,
  DiskUsage,
  SymlinkDefinition,
  WatchCallback,
  WatchRegistration
} from './types.js'
import { constants, flagsToString } from './constants.js'
import { createENOENT, createEEXIST, createEACCES, createEISDIR, wrapError } from './errors.js'
import { normalize, dirname, basename, join, isRoot, segments } from './path-utils.js'
import { HandleManager } from './handle-manager.js'
import { SymlinkManager } from './symlink-manager.js'
import { PackedStorage } from './packed-storage.js'
import { createFileHandle } from './file-handle.js'
import { createReadStream, createWriteStream } from './streams.js'
import { OPFSHybrid, type OPFSHybridOptions, type Backend } from './opfs-hybrid.js'

export { constants }
export * from './types.js'
export { OPFSHybrid, type OPFSHybridOptions, type Backend }

/** Extended options that include hybrid mode support */
export interface OPFSExtendedOptions extends OPFSOptions {
  /** Worker script URL - when provided, enables hybrid mode (reads on main, writes on worker) */
  workerUrl?: URL | string
  /** Override read backend when using hybrid mode (default: 'main') */
  read?: Backend
  /** Override write backend when using hybrid mode (default: 'worker') */
  write?: Backend
}

/**
 * OPFS-based filesystem implementation compatible with Node.js fs/promises API
 *
 * When `workerUrl` is provided, automatically uses hybrid mode for optimal performance:
 * - Reads on main thread (no message passing overhead)
 * - Writes on worker (sync access handles are faster)
 */
export default class OPFS {
  private useSync: boolean
  private verbose: boolean
  private handleManager: HandleManager
  private symlinkManager: SymlinkManager
  private packedStorage: PackedStorage
  private watchCallbacks: Map<symbol, WatchRegistration> = new Map()
  private tmpCounter = 0

  /** Hybrid instance when workerUrl is provided */
  private hybrid: OPFSHybrid | null = null

  /** File system constants */
  public readonly constants = constants

  constructor(options: OPFSExtendedOptions = {}) {
    const { useSync = true, verbose = false, useCompression = false, useChecksum = true, workerUrl, read, write } = options
    this.verbose = verbose

    // If workerUrl is provided, use hybrid mode
    if (workerUrl) {
      this.hybrid = new OPFSHybrid({
        workerUrl,
        read: read ?? 'main',
        write: write ?? 'worker',
        verbose
      })
      // These won't be used in hybrid mode but need to be initialized
      this.useSync = false
      this.handleManager = new HandleManager()
      this.symlinkManager = new SymlinkManager(this.handleManager, false)
      this.packedStorage = new PackedStorage(this.handleManager, false, useCompression, useChecksum)
    } else {
      this.useSync = useSync && typeof FileSystemFileHandle !== 'undefined' &&
        'createSyncAccessHandle' in FileSystemFileHandle.prototype
      this.handleManager = new HandleManager()
      this.symlinkManager = new SymlinkManager(this.handleManager, this.useSync)
      this.packedStorage = new PackedStorage(this.handleManager, this.useSync, useCompression, useChecksum)
    }
  }

  /**
   * Wait for the filesystem to be ready (only needed for hybrid mode)
   */
  async ready(): Promise<void> {
    if (this.hybrid) {
      await this.hybrid.ready()
    }
  }

  /**
   * Terminate any background workers (only needed for hybrid mode)
   */
  terminate(): void {
    if (this.hybrid) {
      this.hybrid.terminate()
    }
  }

  private log(method: string, ...args: unknown[]): void {
    if (this.verbose) {
      console.log(`[OPFS] ${method}:`, ...args)
    }
  }

  private logError(method: string, err: unknown): void {
    if (this.verbose) {
      console.error(`[OPFS] ${method} error:`, err)
    }
  }

  /**
   * Execute tasks with limited concurrency to avoid overwhelming the system
   * @param items - Array of items to process
   * @param maxConcurrent - Maximum number of concurrent operations (default: 10)
   * @param taskFn - Function to execute for each item
   */
  private async limitConcurrency<T>(
    items: T[],
    maxConcurrent: number,
    taskFn: (item: T) => Promise<void>
  ): Promise<void> {
    if (items.length === 0) return

    // For very small batches, run sequentially (minimal overhead)
    if (items.length <= 2) {
      for (const item of items) {
        await taskFn(item)
      }
      return
    }

    // For medium batches up to maxConcurrent, use Promise.all for true parallelism
    // This is optimal for browser where I/O can truly run in parallel
    if (items.length <= maxConcurrent) {
      await Promise.all(items.map(taskFn))
      return
    }

    // For large batches, use worker pool pattern to limit concurrency
    const queue = [...items]
    const workers = Array.from({ length: maxConcurrent }).map(async () => {
      while (queue.length) {
        const item = queue.shift()
        if (item !== undefined) await taskFn(item)
      }
    })
    await Promise.all(workers)
  }

  /**
   * Read file contents
   */
  async readFile(path: string, options: ReadFileOptions = {}): Promise<string | Uint8Array> {
    if (this.hybrid) {
      return this.hybrid.readFile(path, options)
    }

    this.log('readFile', path, options)
    try {
      const normalizedPath = normalize(path)
      const resolvedPath = await this.symlinkManager.resolve(normalizedPath)

      // Try individual file first (most common case)
      let fileHandle: FileSystemFileHandle | null = null
      try {
        fileHandle = await this.handleManager.getPooledFileHandle(resolvedPath)
      } catch {
        // File doesn't exist as individual file, will try packed storage
      }

      if (fileHandle) {
        let buffer: Uint8Array

        if (this.useSync) {
          const access = await fileHandle.createSyncAccessHandle()
          try {
            const size = access.getSize()
            buffer = new Uint8Array(size)
            access.read(buffer)
          } finally {
            access.close()
          }
        } else {
          const file = await fileHandle.getFile()
          buffer = new Uint8Array(await file.arrayBuffer())
        }

        return options.encoding
          ? new TextDecoder(options.encoding).decode(buffer)
          : buffer
      }

      // Fall back to packed storage (for batch-written files)
      const packedData = await this.packedStorage.read(resolvedPath)
      if (packedData) {
        return options.encoding
          ? new TextDecoder(options.encoding).decode(packedData)
          : packedData
      }

      throw createENOENT(path)
    } catch (err) {
      this.logError('readFile', err)
      throw wrapError(err)
    }
  }

  /**
   * Read multiple files efficiently in a batch operation
   * Uses packed storage batch read (single index load), falls back to individual files
   * Returns results in the same order as input paths
   */
  async readFileBatch(paths: string[]): Promise<BatchReadResult[]> {
    if (this.hybrid) {
      return this.hybrid.readFileBatch(paths)
    }

    this.log('readFileBatch', `${paths.length} files`)
    if (paths.length === 0) return []

    try {
      // Resolve all symlinks first
      const resolvedPaths = await Promise.all(
        paths.map(async (path) => {
          const normalizedPath = normalize(path)
          return this.symlinkManager.resolve(normalizedPath)
        })
      )

      // Try to read all from packed storage in one operation (single index load)
      const packedResults = await this.packedStorage.readBatch(resolvedPaths)

      // Pre-allocate results array
      const results: BatchReadResult[] = new Array(paths.length)
      const needsIndividualRead: Array<{ index: number; resolvedPath: string }> = []

      // Check which files were found in pack vs need individual read
      for (let i = 0; i < paths.length; i++) {
        const packedData = packedResults.get(resolvedPaths[i])
        if (packedData) {
          results[i] = { path: paths[i], data: packedData }
        } else {
          needsIndividualRead.push({ index: i, resolvedPath: resolvedPaths[i] })
        }
      }

      // Read remaining files individually
      if (needsIndividualRead.length > 0) {
        await Promise.all(
          needsIndividualRead.map(async ({ index, resolvedPath }) => {
            try {
              const fileHandle = await this.handleManager.getPooledFileHandle(resolvedPath)
              if (!fileHandle) {
                results[index] = { path: paths[index], data: null, error: createENOENT(paths[index]) }
                return
              }

              let buffer: Uint8Array
              if (this.useSync) {
                const access = await fileHandle.createSyncAccessHandle()
                try {
                  const size = access.getSize()
                  buffer = new Uint8Array(size)
                  access.read(buffer)
                } finally {
                  access.close()
                }
              } else {
                const file = await fileHandle.getFile()
                buffer = new Uint8Array(await file.arrayBuffer())
              }
              results[index] = { path: paths[index], data: buffer }
            } catch (err) {
              results[index] = { path: paths[index], data: null, error: err as Error }
            }
          })
        )
      }

      return results
    } catch (err) {
      this.logError('readFileBatch', err)
      throw wrapError(err)
    }
  }

  /**
   * Write data to a file
   */
  async writeFile(path: string, data: string | Uint8Array, options: WriteFileOptions = {}): Promise<void> {
    if (this.hybrid) {
      return this.hybrid.writeFile(path, data, options)
    }

    this.log('writeFile', path)
    try {
      const normalizedPath = normalize(path)
      const resolvedPath = await this.symlinkManager.resolve(normalizedPath)

      const { fileHandle } = await this.handleManager.getHandle(resolvedPath, { create: true })
      const buffer = typeof data === 'string' ? new TextEncoder().encode(data) : data

      if (this.useSync) {
        const access = await fileHandle!.createSyncAccessHandle()
        try {
          // Set exact size (more efficient than truncate(0) + write)
          access.truncate(buffer.length)
          access.write(buffer, { at: 0 })
        } finally {
          access.close()
        }
      } else {
        const writable = await fileHandle!.createWritable()
        await writable.write(buffer)
        await writable.close()
      }
    } catch (err) {
      this.logError('writeFile', err)
      throw wrapError(err)
    }
  }

  /**
   * Write multiple files efficiently in a batch operation
   * Uses packed storage (single file) for maximum performance
   */
  async writeFileBatch(entries: BatchWriteEntry[]): Promise<void> {
    if (this.hybrid) {
      return this.hybrid.writeFileBatch(entries)
    }

    this.log('writeFileBatch', `${entries.length} files`)
    if (entries.length === 0) return

    try {
      // Reuse encoder for all string conversions
      const encoder = new TextEncoder()

      // Resolve all symlinks and convert data
      const packEntries = await Promise.all(
        entries.map(async ({ path, data }) => {
          const normalizedPath = normalize(path)
          const resolvedPath = await this.symlinkManager.resolve(normalizedPath)
          return {
            path: resolvedPath,
            data: typeof data === 'string' ? encoder.encode(data) : data
          }
        })
      )

      // Write all files to packed storage (single OPFS write!)
      await this.packedStorage.writeBatch(packEntries)
    } catch (err) {
      this.logError('writeFileBatch', err)
      throw wrapError(err)
    }
  }

  /**
   * Create a directory
   */
  async mkdir(path: string): Promise<void> {
    if (this.hybrid) {
      return this.hybrid.mkdir(path)
    }

    this.log('mkdir', path)
    try {
      await this.handleManager.mkdir(path)
    } catch (err) {
      this.logError('mkdir', err)
      throw wrapError(err)
    }
  }

  /**
   * Remove a directory
   */
  async rmdir(path: string): Promise<void> {
    if (this.hybrid) {
      return this.hybrid.rmdir(path)
    }

    this.log('rmdir', path)
    try {
      const normalizedPath = normalize(path)
      this.handleManager.clearCache(normalizedPath)

      if (isRoot(normalizedPath)) {
        const root = await this.handleManager.getRoot()
        const entries: string[] = []
        for await (const [name] of root.entries()) {
          entries.push(name)
        }
        await this.limitConcurrency(entries, 10, (name) =>
          root.removeEntry(name, { recursive: true })
        )
        // Reset all storage state since all files including metadata are gone
        this.symlinkManager.reset()
        this.packedStorage.reset()
        return
      }

      const pathSegments = segments(normalizedPath)
      const name = pathSegments.pop()!
      let dir = await this.handleManager.getRoot()

      for (const part of pathSegments) {
        dir = await dir.getDirectoryHandle(part)
      }

      try {
        await dir.removeEntry(name, { recursive: true })
      } catch {
        throw createENOENT(path)
      }
    } catch (err) {
      this.logError('rmdir', err)
      throw wrapError(err)
    }
  }

  /**
   * Remove a file or symlink
   */
  async unlink(path: string): Promise<void> {
    if (this.hybrid) {
      return this.hybrid.unlink(path)
    }

    this.log('unlink', path)
    try {
      const normalizedPath = normalize(path)
      this.handleManager.clearCache(normalizedPath)

      // Check if it's a symlink
      const isSymlink = await this.symlinkManager.isSymlink(normalizedPath)
      if (isSymlink) {
        await this.symlinkManager.unlink(normalizedPath)
        return
      }

      // Check if it's in packed storage
      const inPack = await this.packedStorage.has(normalizedPath)
      if (inPack) {
        await this.packedStorage.remove(normalizedPath)
        return
      }

      // Otherwise it's a regular file
      const { dir, name, fileHandle } = await this.handleManager.getHandle(normalizedPath)
      if (!fileHandle) throw createENOENT(path)

      try {
        await dir!.removeEntry(name!)
      } catch {
        throw createENOENT(path)
      }
    } catch (err) {
      this.logError('unlink', err)
      throw wrapError(err)
    }
  }

  /**
   * Read directory contents
   */
  async readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[]> {
    if (this.hybrid) {
      return this.hybrid.readdir(path, options)
    }

    this.log('readdir', path, options)
    try {
      const normalizedPath = normalize(path)
      const resolvedPath = await this.symlinkManager.resolve(normalizedPath)

      const dir = await this.handleManager.getDirectoryHandle(resolvedPath)
      const withFileTypes = options?.withFileTypes === true

      // Pre-fetch symlinks only once - skip if no symlinks exist (common case)
      const symlinksInDir = await this.symlinkManager.getSymlinksInDir(resolvedPath)
      const hasSymlinks = symlinksInDir.length > 0
      const symlinkSet = hasSymlinks ? new Set(symlinksInDir) : null

      // Collect entries from OPFS directory
      const entryNames = new Set<string>()
      const entries: (string | Dirent)[] = []

      for await (const [name, handle] of dir.entries()) {
        if (this.symlinkManager.isMetadataFile(name)) continue

        entryNames.add(name)

        if (withFileTypes) {
          // Only check symlink if there are symlinks
          const isSymlink = hasSymlinks && symlinkSet!.has(name)
          entries.push({
            name,
            isFile: () => !isSymlink && handle.kind === 'file',
            isDirectory: () => !isSymlink && handle.kind === 'directory',
            isSymbolicLink: () => isSymlink
          })
        } else {
          entries.push(name)
        }
      }

      // Add symlinks that don't have corresponding OPFS entries (only if there are symlinks)
      if (hasSymlinks) {
        for (const name of symlinksInDir) {
          if (!entryNames.has(name)) {
            if (withFileTypes) {
              entries.push({
                name,
                isFile: () => false,
                isDirectory: () => false,
                isSymbolicLink: () => true
              })
            } else {
              entries.push(name)
            }
          }
        }
      }

      return entries as string[] | Dirent[]
    } catch (err) {
      this.logError('readdir', err)
      throw wrapError(err)
    }
  }

  /**
   * Get file/directory statistics (follows symlinks)
   */
  async stat(path: string): Promise<Stats> {
    if (this.hybrid) {
      return this.hybrid.stat(path)
    }

    this.log('stat', path)
    try {
      const normalizedPath = normalize(path)
      const resolvedPath = await this.symlinkManager.resolve(normalizedPath)
      const defaultDate = new Date(0)

      if (isRoot(resolvedPath)) {
        return {
          type: 'dir',
          size: 0,
          mode: 0o040755,
          ctime: defaultDate,
          ctimeMs: 0,
          mtime: defaultDate,
          mtimeMs: 0,
          isFile: () => false,
          isDirectory: () => true,
          isSymbolicLink: () => false
        }
      }

      const pathSegments = segments(resolvedPath)
      const name = pathSegments.pop()!
      let dir = await this.handleManager.getRoot()

      for (const part of pathSegments) {
        try {
          dir = await dir.getDirectoryHandle(part)
        } catch {
          throw createENOENT(path)
        }
      }

      // Check both file and directory in parallel for best performance
      const [fileResult, dirResult] = await Promise.allSettled([
        dir.getFileHandle(name),
        dir.getDirectoryHandle(name)
      ])

      if (fileResult.status === 'fulfilled') {
        const fileHandle = fileResult.value
        const file = await fileHandle.getFile()
        const mtime = file.lastModified ? new Date(file.lastModified) : defaultDate

        return {
          type: 'file',
          size: file.size,
          mode: 0o100644,
          ctime: mtime,
          ctimeMs: mtime.getTime(),
          mtime,
          mtimeMs: mtime.getTime(),
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false
        }
      }

      if (dirResult.status === 'fulfilled') {
        return {
          type: 'dir',
          size: 0,
          mode: 0o040755,
          ctime: defaultDate,
          ctimeMs: 0,
          mtime: defaultDate,
          mtimeMs: 0,
          isFile: () => false,
          isDirectory: () => true,
          isSymbolicLink: () => false
        }
      }

      // Check packed storage as fallback
      const packedSize = await this.packedStorage.getSize(resolvedPath)
      if (packedSize !== null) {
        return {
          type: 'file',
          size: packedSize,
          mode: 0o100644,
          ctime: defaultDate,
          ctimeMs: 0,
          mtime: defaultDate,
          mtimeMs: 0,
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false
        }
      }

      throw createENOENT(path)
    } catch (err) {
      this.logError('stat', err)
      throw wrapError(err)
    }
  }

  /**
   * Get file/directory statistics (does not follow symlinks)
   */
  async lstat(path: string): Promise<Stats> {
    if (this.hybrid) {
      return this.hybrid.lstat(path)
    }

    this.log('lstat', path)
    try {
      const normalizedPath = normalize(path)
      const isSymlink = await this.symlinkManager.isSymlink(normalizedPath)

      if (isSymlink) {
        const target = await this.symlinkManager.readlink(normalizedPath)
        return {
          type: 'symlink',
          target,
          size: target.length,
          mode: 0o120777,
          ctime: new Date(0),
          ctimeMs: 0,
          mtime: new Date(0),
          mtimeMs: 0,
          isFile: () => false,
          isDirectory: () => false,
          isSymbolicLink: () => true
        }
      }

      return this.stat(path)
    } catch (err) {
      this.logError('lstat', err)
      throw wrapError(err)
    }
  }

  /**
   * Rename a file or directory
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    if (this.hybrid) {
      return this.hybrid.rename(oldPath, newPath)
    }

    this.log('rename', oldPath, newPath)
    try {
      const normalizedOld = normalize(oldPath)
      const normalizedNew = normalize(newPath)

      this.handleManager.clearCache(normalizedOld)
      this.handleManager.clearCache(normalizedNew)

      // Handle symlink rename
      const renamed = await this.symlinkManager.rename(normalizedOld, normalizedNew)
      if (renamed) return

      const stat = await this.stat(normalizedOld)

      if (stat.isFile()) {
        // Run readFile and ensureParentDir in parallel (no dependency)
        const [data] = await Promise.all([
          this.readFile(normalizedOld),
          this.handleManager.ensureParentDir(normalizedNew)
        ])
        await this.writeFile(normalizedNew, data as Uint8Array)
        await this.unlink(normalizedOld)
      } else if (stat.isDirectory()) {
        await this.mkdir(normalizedNew)
        const entries = await this.readdir(normalizedOld) as string[]
        // Use concurrency limiter to avoid Promise overhead for small batches
        await this.limitConcurrency(entries, 10, entry =>
          this.rename(`${normalizedOld}/${entry}`, `${normalizedNew}/${entry}`)
        )
        await this.rmdir(normalizedOld)
      }
    } catch (err) {
      this.logError('rename', err)
      throw wrapError(err)
    }
  }

  /**
   * Create a symbolic link
   */
  async symlink(target: string, path: string): Promise<void> {
    if (this.hybrid) {
      return this.hybrid.symlink(target, path)
    }

    this.log('symlink', target, path)
    try {
      const normalizedPath = normalize(path)
      this.handleManager.clearCache(normalizedPath)

      // Fast existence check - just try to get handle, much faster than full stat()
      await this.symlinkManager.symlink(target, path, async () => {
        const { fileHandle, dirHandle } = await this.handleManager.getHandle(normalizedPath)
        if (fileHandle || dirHandle) {
          throw createEEXIST(path)
        }
      })
    } catch (err) {
      this.logError('symlink', err)
      throw wrapError(err)
    }
  }

  /**
   * Read symlink target
   */
  async readlink(path: string): Promise<string> {
    if (this.hybrid) {
      return this.hybrid.readlink(path)
    }

    this.log('readlink', path)
    try {
      return await this.symlinkManager.readlink(path)
    } catch (err) {
      this.logError('readlink', err)
      throw wrapError(err)
    }
  }

  /**
   * Create multiple symlinks efficiently
   */
  async symlinkBatch(links: SymlinkDefinition[]): Promise<void> {
    if (this.hybrid) {
      return this.hybrid.symlinkBatch(links)
    }

    this.log('symlinkBatch', links.length, 'links')
    try {
      // Clear cache once at the start for all paths
      for (const { path } of links) {
        this.handleManager.clearCache(normalize(path))
      }

      // Fast existence check - if parent doesn't exist, symlink path is available
      await this.symlinkManager.symlinkBatch(links, async (normalizedPath) => {
        try {
          const { fileHandle, dirHandle } = await this.handleManager.getHandle(normalizedPath)
          if (fileHandle || dirHandle) {
            throw createEEXIST(normalizedPath)
          }
        } catch (err) {
          // If ENOENT (parent doesn't exist), the path is available for symlink
          if ((err as { code?: string }).code === 'ENOENT') return
          throw err
        }
      })
    } catch (err) {
      this.logError('symlinkBatch', err)
      throw wrapError(err)
    }
  }

  /**
   * Check file accessibility
   */
  async access(path: string, mode = constants.F_OK): Promise<void> {
    if (this.hybrid) {
      return this.hybrid.access(path, mode)
    }

    this.log('access', path, mode)
    try {
      const normalizedPath = normalize(path)
      await this.stat(normalizedPath)
      // OPFS doesn't have permissions, existence check is enough
    } catch (err) {
      this.logError('access', err)
      throw createEACCES(path)
    }
  }

  /**
   * Append data to a file
   */
  async appendFile(path: string, data: string | Uint8Array, options: WriteFileOptions = {}): Promise<void> {
    if (this.hybrid) {
      return this.hybrid.appendFile(path, data, options)
    }

    this.log('appendFile', path)
    try {
      const normalizedPath = normalize(path)
      const resolvedPath = await this.symlinkManager.resolve(normalizedPath)

      let existingData: Uint8Array = new Uint8Array(0)
      try {
        const result = await this.readFile(resolvedPath)
        existingData = result instanceof Uint8Array ? result : new TextEncoder().encode(result)
      } catch (err) {
        if ((err as { code?: string }).code !== 'ENOENT') throw err
      }

      const newData = typeof data === 'string'
        ? new TextEncoder().encode(data)
        : data

      const combined = new Uint8Array(existingData.length + newData.length)
      combined.set(existingData, 0)
      combined.set(newData, existingData.length)

      await this.writeFile(resolvedPath, combined, options)
    } catch (err) {
      this.logError('appendFile', err)
      throw wrapError(err)
    }
  }

  /**
   * Copy a file
   */
  async copyFile(src: string, dest: string, mode = 0): Promise<void> {
    if (this.hybrid) {
      return this.hybrid.copyFile(src, dest, mode)
    }

    this.log('copyFile', src, dest, mode)
    try {
      const normalizedSrc = normalize(src)
      const normalizedDest = normalize(dest)
      const resolvedSrc = await this.symlinkManager.resolve(normalizedSrc)

      // Check COPYFILE_EXCL flag
      if (mode & constants.COPYFILE_EXCL) {
        try {
          await this.stat(normalizedDest)
          throw createEEXIST(dest)
        } catch (err) {
          if ((err as { code?: string }).code !== 'ENOENT') throw err
        }
      }

      // Run readFile and ensureParentDir in parallel (no dependency)
      const [data] = await Promise.all([
        this.readFile(resolvedSrc),
        this.handleManager.ensureParentDir(normalizedDest)
      ])
      await this.writeFile(normalizedDest, data as Uint8Array)
    } catch (err) {
      this.logError('copyFile', err)
      throw wrapError(err)
    }
  }

  /**
   * Copy files/directories recursively
   */
  async cp(src: string, dest: string, options: CpOptions = {}): Promise<void> {
    if (this.hybrid) {
      return this.hybrid.cp(src, dest, options)
    }

    this.log('cp', src, dest, options)
    try {
      const normalizedSrc = normalize(src)
      const normalizedDest = normalize(dest)
      const { recursive = false, force = false, errorOnExist = false } = options

      const srcStat = await this.stat(normalizedSrc)

      if (srcStat.isDirectory()) {
        if (!recursive) {
          throw createEISDIR(src)
        }

        let destExists = false
        try {
          await this.stat(normalizedDest)
          destExists = true
          if (errorOnExist && !force) {
            throw createEEXIST(dest)
          }
        } catch (err) {
          if ((err as { code?: string }).code !== 'ENOENT') throw err
        }

        if (!destExists) {
          await this.mkdir(normalizedDest)
        }

        const entries = await this.readdir(normalizedSrc) as string[]
        // Use concurrency limiter to avoid Promise overhead for small batches
        await this.limitConcurrency(entries, 10, entry =>
          this.cp(`${normalizedSrc}/${entry}`, `${normalizedDest}/${entry}`, options)
        )
      } else {
        if (errorOnExist) {
          try {
            await this.stat(normalizedDest)
            throw createEEXIST(dest)
          } catch (err) {
            if ((err as { code?: string }).code !== 'ENOENT') throw err
          }
        }
        await this.copyFile(normalizedSrc, normalizedDest)
      }
    } catch (err) {
      this.logError('cp', err)
      throw wrapError(err)
    }
  }

  /**
   * Check if path exists
   */
  async exists(path: string): Promise<boolean> {
    if (this.hybrid) {
      return this.hybrid.exists(path)
    }

    this.log('exists', path)
    try {
      await this.stat(normalize(path))
      return true
    } catch {
      return false
    }
  }

  /**
   * Resolve symlinks to get real path
   */
  async realpath(path: string): Promise<string> {
    if (this.hybrid) {
      return this.hybrid.realpath(path)
    }

    this.log('realpath', path)
    const normalizedPath = normalize(path)
    return this.symlinkManager.resolve(normalizedPath)
  }

  /**
   * Remove files and directories
   */
  async rm(path: string, options: RmOptions = {}): Promise<void> {
    if (this.hybrid) {
      return this.hybrid.rm(path, options)
    }

    this.log('rm', path, options)
    try {
      const normalizedPath = normalize(path)
      const { recursive = false, force = false } = options

      try {
        const stat = await this.lstat(normalizedPath)

        if (stat.isSymbolicLink()) {
          await this.unlink(normalizedPath)
        } else if (stat.isDirectory()) {
          if (!recursive) {
            throw createEISDIR(path)
          }
          await this.rmdir(normalizedPath)
        } else {
          await this.unlink(normalizedPath)
        }
      } catch (err) {
        if ((err as { code?: string }).code === 'ENOENT' && force) {
          return
        }
        throw err
      }
    } catch (err) {
      this.logError('rm', err)
      throw wrapError(err)
    }
  }

  /**
   * Truncate file to specified length
   */
  async truncate(path: string, len = 0): Promise<void> {
    if (this.hybrid) {
      return this.hybrid.truncate(path, len)
    }

    this.log('truncate', path, len)
    try {
      const normalizedPath = normalize(path)
      const resolvedPath = await this.symlinkManager.resolve(normalizedPath)
      this.handleManager.clearCache(resolvedPath)

      const { fileHandle } = await this.handleManager.getHandle(resolvedPath)
      if (!fileHandle) throw createENOENT(path)

      if (this.useSync) {
        const access = await fileHandle.createSyncAccessHandle()
        try {
          access.truncate(len)
        } finally {
          access.close()
        }
      } else {
        const file = await fileHandle.getFile()
        const data = new Uint8Array(await file.arrayBuffer())

        // Create a new array with the truncated/padded size
        const finalData = new Uint8Array(len)
        // Copy up to len bytes from original data using set() for performance
        const copyLen = Math.min(len, data.length)
        if (copyLen > 0) {
          finalData.set(data.subarray(0, copyLen), 0)
        }
        // Remaining bytes (if any) are already zero from Uint8Array initialization

        const writable = await fileHandle.createWritable()
        await writable.write(finalData)
        await writable.close()
      }
    } catch (err) {
      this.logError('truncate', err)
      throw wrapError(err)
    }
  }

  /**
   * Create a unique temporary directory
   */
  async mkdtemp(prefix: string): Promise<string> {
    if (this.hybrid) {
      return this.hybrid.mkdtemp(prefix)
    }

    this.log('mkdtemp', prefix)
    try {
      const normalizedPrefix = normalize(prefix)
      const suffix = `${Date.now()}-${++this.tmpCounter}-${Math.random().toString(36).slice(2, 8)}`
      const path = `${normalizedPrefix}${suffix}`
      await this.mkdir(path)
      return path
    } catch (err) {
      this.logError('mkdtemp', err)
      throw wrapError(err)
    }
  }

  /**
   * Change file mode (no-op for OPFS compatibility)
   */
  async chmod(path: string, mode: number): Promise<void> {
    if (this.hybrid) {
      return this.hybrid.chmod(path, mode)
    }

    this.log('chmod', path, mode)
    await this.stat(normalize(path))
    // OPFS doesn't support file modes
  }

  /**
   * Change file owner (no-op for OPFS compatibility)
   */
  async chown(path: string, uid: number, gid: number): Promise<void> {
    if (this.hybrid) {
      return this.hybrid.chown(path, uid, gid)
    }

    this.log('chown', path, uid, gid)
    await this.stat(normalize(path))
    // OPFS doesn't support file ownership
  }

  /**
   * Update file timestamps (no-op for OPFS compatibility)
   */
  async utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void> {
    if (this.hybrid) {
      return this.hybrid.utimes(path, atime, mtime)
    }

    this.log('utimes', path, atime, mtime)
    await this.stat(normalize(path))
    // OPFS doesn't support setting timestamps
  }

  /**
   * Update symlink timestamps (no-op)
   */
  async lutimes(path: string, atime: Date | number, mtime: Date | number): Promise<void> {
    if (this.hybrid) {
      return this.hybrid.lutimes(path, atime, mtime)
    }

    this.log('lutimes', path, atime, mtime)
    await this.lstat(normalize(path))
    // OPFS doesn't support setting timestamps
  }

  /**
   * Open file and return FileHandle
   */
  async open(path: string, flags: string | number = 'r', mode = 0o666): Promise<FileHandle> {
    this.log('open', path, flags, mode)
    try {
      const normalizedPath = normalize(path)
      const flagStr = flagsToString(flags)
      const shouldCreate = flagStr.includes('w') || flagStr.includes('a') || flagStr.includes('+')
      const shouldTruncate = flagStr.includes('w')
      const shouldAppend = flagStr.includes('a')

      if (shouldCreate) {
        await this.handleManager.ensureParentDir(normalizedPath)
      }

      const resolvedPath = await this.symlinkManager.resolve(normalizedPath)
      const { fileHandle } = await this.handleManager.getHandle(resolvedPath, { create: shouldCreate })

      if (!fileHandle && !shouldCreate) {
        throw createENOENT(path)
      }

      if (shouldTruncate && fileHandle) {
        await this.truncate(resolvedPath, 0)
      }

      const initialPosition = shouldAppend ? (await this.stat(resolvedPath)).size : 0

      return createFileHandle(resolvedPath, initialPosition, {
        readFile: (p, o) => this.readFile(p, o),
        writeFile: (p, d) => this.writeFile(p, d),
        stat: (p) => this.stat(p),
        truncate: (p, l) => this.truncate(p, l),
        appendFile: (p, d, o) => this.appendFile(p, d, o)
      })
    } catch (err) {
      this.logError('open', err)
      throw wrapError(err)
    }
  }

  /**
   * Open directory for iteration
   */
  async opendir(path: string): Promise<Dir> {
    this.log('opendir', path)
    try {
      const normalizedPath = normalize(path)
      const entries = await this.readdir(normalizedPath, { withFileTypes: true }) as Dirent[]
      let index = 0

      return {
        path: normalizedPath,

        async read(): Promise<Dirent | null> {
          if (index >= entries.length) return null
          return entries[index++]
        },

        async close(): Promise<void> {
          index = entries.length
        },

        async *[Symbol.asyncIterator](): AsyncIterableIterator<Dirent> {
          for (const entry of entries) {
            yield entry
          }
        }
      }
    } catch (err) {
      this.logError('opendir', err)
      throw wrapError(err)
    }
  }

  /**
   * Watch for file changes
   */
  watch(path: string, options: WatchOptions = {}): FSWatcher {
    this.log('watch', path, options)
    const normalizedPath = normalize(path)
    const { recursive = false, signal } = options

    const callbacks = new Set<WatchCallback>()
    const id = Symbol('watcher')

    this.watchCallbacks.set(id, { path: normalizedPath, callbacks, recursive })

    if (signal) {
      signal.addEventListener('abort', () => {
        this.watchCallbacks.delete(id)
      })
    }

    const self = this

    return {
      close(): void {
        self.watchCallbacks.delete(id)
      },

      ref(): FSWatcher {
        return this
      },

      unref(): FSWatcher {
        return this
      },

      [Symbol.asyncIterator](): AsyncIterator<{ eventType: 'rename' | 'change'; filename: string }> {
        const queue: { eventType: 'rename' | 'change'; filename: string }[] = []
        let resolver: ((value: IteratorResult<{ eventType: 'rename' | 'change'; filename: string }>) => void) | null = null

        callbacks.add((eventType, filename) => {
          const event = { eventType: eventType as 'rename' | 'change', filename }
          if (resolver) {
            resolver({ value: event, done: false })
            resolver = null
          } else {
            queue.push(event)
          }
        })

        return {
          next(): Promise<IteratorResult<{ eventType: 'rename' | 'change'; filename: string }>> {
            if (queue.length > 0) {
              return Promise.resolve({ value: queue.shift()!, done: false })
            }
            return new Promise(resolve => {
              resolver = resolve
            })
          },
          return(): Promise<IteratorResult<{ eventType: 'rename' | 'change'; filename: string }>> {
            return Promise.resolve({ done: true, value: undefined })
          }
        }
      }
    }
  }

  /**
   * Create read stream
   */
  createReadStream(path: string, options: ReadStreamOptions = {}): ReadableStream<Uint8Array> {
    this.log('createReadStream', path, options)
    const normalizedPath = normalize(path)
    return createReadStream(normalizedPath, options, {
      readFile: (p) => this.readFile(p) as Promise<Uint8Array>
    })
  }

  /**
   * Create write stream
   */
  createWriteStream(path: string, options: WriteStreamOptions = {}): WritableStream<Uint8Array> {
    this.log('createWriteStream', path, options)
    const normalizedPath = normalize(path)
    return createWriteStream(normalizedPath, options, {
      readFile: (p) => this.readFile(p) as Promise<Uint8Array>,
      writeFile: (p, d) => this.writeFile(p, d)
    })
  }

  /**
   * Get file statistics (alias for stat)
   */
  async backFile(path: string): Promise<Stats> {
    this.log('backFile', path)
    try {
      return await this.stat(normalize(path))
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') throw err
      throw createENOENT(path)
    }
  }

  /**
   * Get disk usage for a path
   */
  async du(path: string): Promise<DiskUsage> {
    if (this.hybrid) {
      return this.hybrid.du(path)
    }

    this.log('du', path)
    const normalizedPath = normalize(path)
    const stat = await this.stat(normalizedPath)
    return { path: normalizedPath, size: stat.size }
  }

  /**
   * Get filesystem statistics (similar to Node.js fs.statfs)
   * Uses the Storage API to get quota and usage information
   * Note: Values are estimates for the entire origin, not per-path
   */
  async statfs(path?: string): Promise<StatFs> {
    if (this.hybrid) {
      return this.hybrid.statfs(path)
    }

    this.log('statfs', path)
    try {
      // Verify path exists if provided
      if (path) {
        await this.stat(normalize(path))
      }

      if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
        throw new Error('Storage API not available')
      }

      const estimate = await navigator.storage.estimate()
      const usage = estimate.usage ?? 0
      const quota = estimate.quota ?? 0
      const bsize = 4096 // Simulated block size

      return {
        type: 0,
        bsize,
        blocks: Math.floor(quota / bsize),
        bfree: Math.floor((quota - usage) / bsize),
        bavail: Math.floor((quota - usage) / bsize),
        files: 0,
        ffree: 0,
        usage,
        quota
      }
    } catch (err) {
      this.logError('statfs', err)
      throw wrapError(err)
    }
  }

  /**
   * Reset internal caches
   * Useful when external processes modify the filesystem
   */
  resetCache(): void {
    if (this.hybrid) {
      // For hybrid, this is async but we provide a sync interface for compatibility
      // Use gc() for guaranteed cleanup
      this.hybrid.resetCache()
      return
    }

    this.symlinkManager.reset()
    this.packedStorage.reset()
    this.handleManager.clearCache()
  }

  /**
   * Force full garbage collection
   * Releases all handles and caches, reinitializes the worker in hybrid mode
   * Use this for long-running operations to prevent memory leaks
   */
  async gc(): Promise<void> {
    if (this.hybrid) {
      await this.hybrid.gc()
      return
    }

    this.symlinkManager.reset()
    await this.packedStorage.clear()
    this.handleManager.clearCache()
  }
}
