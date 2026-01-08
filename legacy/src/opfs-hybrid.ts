/**
 * OPFS Hybrid - Routes read/write operations to different backends
 *
 * Allows optimal performance by using:
 * - Main thread for reads (no message passing overhead)
 * - Worker for writes (sync access handles are faster)
 */

import OPFS from './index.js'
import { OPFSWorker } from './opfs-worker-proxy.js'
import type {
  ReadFileOptions,
  WriteFileOptions,
  BatchWriteEntry,
  BatchReadResult,
  ReaddirOptions,
  Stats,
  StatFs,
  RmOptions,
  CpOptions,
  SymlinkDefinition,
  DiskUsage
} from './types.js'

export type Backend = 'main' | 'worker'

export interface OPFSHybridOptions {
  /** Backend for read operations (default: 'main') */
  read?: Backend
  /** Backend for write operations (default: 'worker') */
  write?: Backend
  /** Worker URL (required if using worker backend) */
  workerUrl?: URL | string
  /** Enable verbose logging */
  verbose?: boolean
}

/**
 * Hybrid OPFS implementation that routes operations to optimal backends
 */
export class OPFSHybrid {
  private mainFs: OPFS
  private workerFs: OPFSWorker | null = null
  private readBackend: Backend
  private writeBackend: Backend
  private workerUrl?: URL | string
  private workerReady: Promise<void> | null = null
  private verbose: boolean

  constructor(options: OPFSHybridOptions = {}) {
    this.readBackend = options.read ?? 'main'
    this.writeBackend = options.write ?? 'worker'
    this.workerUrl = options.workerUrl
    this.verbose = options.verbose ?? false

    // Always create main fs (needed for main backend or as fallback)
    this.mainFs = new OPFS({ useSync: false, verbose: this.verbose })

    // Create worker if needed
    if (this.readBackend === 'worker' || this.writeBackend === 'worker') {
      if (!this.workerUrl) {
        throw new Error('workerUrl is required when using worker backend')
      }
      this.workerFs = new OPFSWorker({ workerUrl: this.workerUrl })
      this.workerReady = this.workerFs.ready()
    }
  }

  /**
   * Wait for all backends to be ready
   */
  async ready(): Promise<void> {
    if (this.workerReady) {
      await this.workerReady
    }
  }

  /**
   * Terminate worker if active
   */
  terminate(): void {
    if (this.workerFs) {
      this.workerFs.terminate()
      this.workerFs = null
    }
  }

  private getReadFs(): OPFS | OPFSWorker {
    if (this.readBackend === 'worker' && this.workerFs) {
      return this.workerFs
    }
    return this.mainFs
  }

  private getWriteFs(): OPFS | OPFSWorker {
    if (this.writeBackend === 'worker' && this.workerFs) {
      return this.workerFs
    }
    return this.mainFs
  }

  // ============ Read Operations ============

  async readFile(path: string, options?: ReadFileOptions): Promise<Uint8Array | string> {
    return this.getReadFs().readFile(path, options)
  }

  async readFileBatch(paths: string[]): Promise<BatchReadResult[]> {
    return this.getReadFs().readFileBatch(paths)
  }

  async readdir(path: string, options?: ReaddirOptions): Promise<string[] | import('./types.js').Dirent[]> {
    return this.getReadFs().readdir(path, options)
  }

  async stat(path: string): Promise<Stats> {
    return this.getReadFs().stat(path)
  }

  async lstat(path: string): Promise<Stats> {
    return this.getReadFs().lstat(path)
  }

  async exists(path: string): Promise<boolean> {
    return this.getReadFs().exists(path)
  }

  async access(path: string, mode?: number): Promise<void> {
    return this.getReadFs().access(path, mode)
  }

  async readlink(path: string): Promise<string> {
    return this.getReadFs().readlink(path)
  }

  async realpath(path: string): Promise<string> {
    return this.getReadFs().realpath(path)
  }

  async statfs(path?: string): Promise<StatFs> {
    return this.getReadFs().statfs(path)
  }

  async du(path: string): Promise<DiskUsage> {
    return this.getReadFs().du(path)
  }

  // ============ Write Operations ============

  async writeFile(path: string, data: string | Uint8Array, options?: WriteFileOptions): Promise<void> {
    return this.getWriteFs().writeFile(path, data, options)
  }

  async writeFileBatch(entries: BatchWriteEntry[]): Promise<void> {
    return this.getWriteFs().writeFileBatch(entries)
  }

  async appendFile(path: string, data: string | Uint8Array, options?: WriteFileOptions): Promise<void> {
    return this.getWriteFs().appendFile(path, data, options)
  }

  async mkdir(path: string): Promise<void> {
    return this.getWriteFs().mkdir(path)
  }

  async rmdir(path: string): Promise<void> {
    // rmdir affects both backends' state
    if (this.readBackend !== this.writeBackend && this.workerFs) {
      // Clear via worker (does actual deletion and resets worker's symlink cache)
      await this.workerFs.rmdir(path)
      // Reset main thread's cache (no actual file operations, just cache invalidation)
      this.mainFs.resetCache()
    } else {
      return this.getWriteFs().rmdir(path)
    }
  }

  async unlink(path: string): Promise<void> {
    return this.getWriteFs().unlink(path)
  }

  async truncate(path: string, len?: number): Promise<void> {
    return this.getWriteFs().truncate(path, len)
  }

  async symlink(target: string, path: string): Promise<void> {
    // Symlinks affect both backends' symlink cache
    if (this.readBackend !== this.writeBackend && this.workerFs) {
      await this.workerFs.symlink(target, path)
      // Reset main thread's symlink cache so it reloads from disk
      this.mainFs.resetCache()
    } else {
      return this.getWriteFs().symlink(target, path)
    }
  }

  async symlinkBatch(symlinks: SymlinkDefinition[]): Promise<void> {
    if (this.readBackend !== this.writeBackend && this.workerFs) {
      await this.workerFs.symlinkBatch(symlinks)
      // Reset main thread's symlink cache so it reloads from disk
      this.mainFs.resetCache()
    } else {
      return this.getWriteFs().symlinkBatch(symlinks)
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    return this.getWriteFs().rename(oldPath, newPath)
  }

  async copyFile(src: string, dest: string, mode?: number): Promise<void> {
    return this.getWriteFs().copyFile(src, dest, mode)
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    return this.getWriteFs().cp(src, dest, options)
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    return this.getWriteFs().rm(path, options)
  }

  async chmod(path: string, mode: number): Promise<void> {
    return this.getWriteFs().chmod(path, mode)
  }

  async chown(path: string, uid: number, gid: number): Promise<void> {
    return this.getWriteFs().chown(path, uid, gid)
  }

  async utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void> {
    return this.getWriteFs().utimes(path, atime, mtime)
  }

  async lutimes(path: string, atime: Date | number, mtime: Date | number): Promise<void> {
    return this.getWriteFs().lutimes(path, atime, mtime)
  }

  async mkdtemp(prefix: string): Promise<string> {
    return this.getWriteFs().mkdtemp(prefix)
  }

  /**
   * Reset internal caches on both backends
   */
  async resetCache(): Promise<void> {
    this.mainFs.resetCache()
    if (this.workerFs) {
      await this.workerFs.resetCache()
    }
  }

  /**
   * Force full garbage collection on both backends
   * More aggressive than resetCache() - reinitializes the worker's OPFS instance
   */
  async gc(): Promise<void> {
    this.mainFs.resetCache()
    if (this.workerFs) {
      await this.workerFs.gc()
    }
  }
}

export default OPFSHybrid
