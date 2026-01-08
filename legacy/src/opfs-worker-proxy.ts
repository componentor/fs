/**
 * OPFS Worker Proxy
 * Main thread class that communicates with an OPFS worker
 *
 * This allows non-blocking OPFS operations on the main thread
 * while the actual work happens in a dedicated Web Worker
 */

import type {
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
  DiskUsage,
  SymlinkDefinition
} from './types.js'
import { constants } from './constants.js'
import { FSError } from './errors.js'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

interface WorkerResponse {
  id?: number
  type?: string
  result?: unknown
  error?: { message: string; code?: string }
}

export interface OPFSWorkerOptions {
  /** URL to the worker script (default: auto-detect) */
  workerUrl?: string | URL
  /** Worker initialization options */
  workerOptions?: WorkerOptions
}

/**
 * OPFS Worker Proxy - runs OPFS operations in a Web Worker
 *
 * Benefits:
 * - Non-blocking main thread
 * - Uses sync access handles (faster) in the worker
 * - Compatible with libraries that reuse buffers (e.g., isomorphic-git)
 */
export class OPFSWorker {
  private worker: Worker | null = null
  private pendingRequests = new Map<number, PendingRequest>()
  private nextId = 1
  private readyPromise: Promise<void>
  private readyResolve!: () => void

  /** File system constants */
  public readonly constants = constants

  constructor(options: OPFSWorkerOptions = {}) {
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve
    })

    this.initWorker(options)
  }

  private initWorker(options: OPFSWorkerOptions): void {
    const { workerUrl, workerOptions = { type: 'module' } } = options

    if (workerUrl) {
      this.worker = new Worker(workerUrl, workerOptions)
    } else {
      // Try to create worker from the bundled script
      // Users should provide workerUrl in production
      throw new Error(
        'OPFSWorker requires a workerUrl option pointing to the worker script. ' +
        'Example: new OPFSWorker({ workerUrl: new URL("./opfs-worker.js", import.meta.url) })'
      )
    }

    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { id, type, result, error } = event.data

      // Handle ready signal
      if (type === 'ready') {
        this.readyResolve()
        return
      }

      // Handle response to a request
      if (id !== undefined) {
        const pending = this.pendingRequests.get(id)
        if (pending) {
          this.pendingRequests.delete(id)
          if (error) {
            const fsError = new FSError(error.message, error.code || 'UNKNOWN')
            pending.reject(fsError)
          } else {
            pending.resolve(result)
          }
        }
      }
    }

    this.worker.onerror = (event) => {
      console.error('[OPFSWorker] Worker error:', event)
    }
  }

  /**
   * Wait for the worker to be ready
   */
  async ready(): Promise<void> {
    return this.readyPromise
  }

  /**
   * Terminate the worker
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null

      // Reject all pending requests
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error('Worker terminated'))
      }
      this.pendingRequests.clear()
    }
  }

  private call<T>(method: string, args: unknown[], transfer?: Transferable[]): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not initialized or terminated'))
        return
      }

      const id = this.nextId++
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject
      })

      const message = { id, method, args }
      if (transfer && transfer.length > 0) {
        this.worker.postMessage(message, transfer)
      } else {
        this.worker.postMessage(message)
      }
    })
  }

  // File operations

  async readFile(path: string, options?: ReadFileOptions): Promise<string | Uint8Array> {
    const result = await this.call<string | Uint8Array>('readFile', [path, options])
    return result
  }

  async writeFile(path: string, data: string | Uint8Array, options?: WriteFileOptions): Promise<void> {
    // Note: We don't use Transferables here because the caller may reuse the buffer
    // (e.g., isomorphic-git reuses buffers). Structured cloning copies the data.
    await this.call<void>('writeFile', [path, data, options])
  }

  async readFileBatch(paths: string[]): Promise<BatchReadResult[]> {
    return this.call<BatchReadResult[]>('readFileBatch', [paths])
  }

  async writeFileBatch(entries: BatchWriteEntry[]): Promise<void> {
    // Note: We don't use Transferables here because the caller may reuse the buffers
    await this.call<void>('writeFileBatch', [entries])
  }

  async appendFile(path: string, data: string | Uint8Array, options?: WriteFileOptions): Promise<void> {
    // Note: We don't use Transferables here because the caller may reuse the buffer
    await this.call<void>('appendFile', [path, data, options])
  }

  async copyFile(src: string, dest: string, mode?: number): Promise<void> {
    await this.call<void>('copyFile', [src, dest, mode])
  }

  async unlink(path: string): Promise<void> {
    await this.call<void>('unlink', [path])
  }

  async truncate(path: string, len?: number): Promise<void> {
    await this.call<void>('truncate', [path, len])
  }

  // Directory operations

  async mkdir(path: string): Promise<void> {
    await this.call<void>('mkdir', [path])
  }

  async rmdir(path: string): Promise<void> {
    await this.call<void>('rmdir', [path])
  }

  async readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[]> {
    const result = await this.call<string[] | { name: string }[]>('readdir', [path, options])

    // Reconstruct Dirent objects with methods
    if (options?.withFileTypes && Array.isArray(result)) {
      return result.map((item) => {
        if (typeof item === 'object' && 'name' in item) {
          const entry = item as { name: string; _isFile?: boolean; _isDir?: boolean; _isSymlink?: boolean }
          return {
            name: entry.name,
            isFile: () => entry._isFile ?? false,
            isDirectory: () => entry._isDir ?? false,
            isSymbolicLink: () => entry._isSymlink ?? false
          }
        }
        return item as unknown as Dirent
      })
    }

    return result as string[]
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    await this.call<void>('cp', [src, dest, options])
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    await this.call<void>('rm', [path, options])
  }

  // Stat operations

  async stat(path: string): Promise<Stats> {
    const result = await this.call<{
      type: string
      size: number
      mode: number
      ctime: string
      ctimeMs: number
      mtime: string
      mtimeMs: number
      target?: string
    }>('stat', [path])

    return this.deserializeStats(result)
  }

  async lstat(path: string): Promise<Stats> {
    const result = await this.call<{
      type: string
      size: number
      mode: number
      ctime: string
      ctimeMs: number
      mtime: string
      mtimeMs: number
      target?: string
    }>('lstat', [path])

    return this.deserializeStats(result)
  }

  private deserializeStats(data: {
    type: string
    size: number
    mode: number
    ctime: string
    ctimeMs: number
    mtime: string
    mtimeMs: number
    target?: string
  }): Stats {
    const ctime = new Date(data.ctime)
    const mtime = new Date(data.mtime)

    return {
      type: data.type as 'file' | 'dir' | 'symlink',
      size: data.size,
      mode: data.mode,
      ctime,
      ctimeMs: data.ctimeMs,
      mtime,
      mtimeMs: data.mtimeMs,
      target: data.target,
      isFile: () => data.type === 'file',
      isDirectory: () => data.type === 'dir',
      isSymbolicLink: () => data.type === 'symlink'
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.call<boolean>('exists', [path])
  }

  async access(path: string, mode?: number): Promise<void> {
    await this.call<void>('access', [path, mode])
  }

  async statfs(path?: string): Promise<StatFs> {
    return this.call<StatFs>('statfs', [path])
  }

  async du(path: string): Promise<DiskUsage> {
    return this.call<DiskUsage>('du', [path])
  }

  // Symlink operations

  async symlink(target: string, path: string): Promise<void> {
    await this.call<void>('symlink', [target, path])
  }

  async readlink(path: string): Promise<string> {
    return this.call<string>('readlink', [path])
  }

  async symlinkBatch(links: SymlinkDefinition[]): Promise<void> {
    await this.call<void>('symlinkBatch', [links])
  }

  async realpath(path: string): Promise<string> {
    return this.call<string>('realpath', [path])
  }

  // Other operations

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.call<void>('rename', [oldPath, newPath])
  }

  async mkdtemp(prefix: string): Promise<string> {
    return this.call<string>('mkdtemp', [prefix])
  }

  async chmod(path: string, mode: number): Promise<void> {
    await this.call<void>('chmod', [path, mode])
  }

  async chown(path: string, uid: number, gid: number): Promise<void> {
    await this.call<void>('chown', [path, uid, gid])
  }

  async utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void> {
    await this.call<void>('utimes', [path, atime, mtime])
  }

  async lutimes(path: string, atime: Date | number, mtime: Date | number): Promise<void> {
    await this.call<void>('lutimes', [path, atime, mtime])
  }

  /**
   * Reset internal caches to free memory
   * Useful for long-running benchmarks or after bulk operations
   */
  async resetCache(): Promise<void> {
    await this.call<void>('resetCache', [])
  }

  /**
   * Force full garbage collection by reinitializing the OPFS instance in the worker
   * This completely releases all handles and caches, preventing memory leaks in long-running operations
   * More aggressive than resetCache() - use when resetCache() isn't sufficient
   */
  async gc(): Promise<void> {
    await this.call<void>('gc', [])
  }
}
