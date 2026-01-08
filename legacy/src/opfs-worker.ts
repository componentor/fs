/**
 * OPFS Worker Script
 * Runs OPFS operations in a dedicated Web Worker for non-blocking main thread
 *
 * Usage: Create a worker with this script and communicate via postMessage
 */

import OPFS from './index.js'
import type { BatchWriteEntry, SymlinkDefinition } from './types.js'

// Message types
interface WorkerRequest {
  id: number
  method: string
  args: unknown[]
}

interface WorkerResponse {
  id: number
  result?: unknown
  error?: { message: string; code?: string }
  // For transferable arrays
  transfer?: ArrayBuffer[]
}

// Initialize OPFS with sync mode (available in workers)
let fs: OPFS | null = null

function getFS(): OPFS {
  if (!fs) {
    fs = new OPFS({ useSync: true, verbose: false })
  }
  return fs
}

// Handle incoming messages
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, method, args } = event.data

  try {
    const opfs = getFS()
    let result: unknown
    const transfer: ArrayBuffer[] = []

    // Route to appropriate method
    switch (method) {
      // File operations
      case 'readFile': {
        const data = await opfs.readFile(args[0] as string, args[1] as { encoding?: string })
        if (data instanceof Uint8Array) {
          // Transfer the buffer for zero-copy
          result = data
          transfer.push(data.buffer)
        } else {
          result = data
        }
        break
      }

      case 'writeFile':
        await opfs.writeFile(args[0] as string, args[1] as string | Uint8Array, args[2] as object)
        result = undefined
        break

      case 'readFileBatch': {
        const results = await opfs.readFileBatch(args[0] as string[])
        // Transfer all buffers
        for (const r of results) {
          if (r.data) {
            transfer.push(r.data.buffer)
          }
        }
        result = results
        break
      }

      case 'writeFileBatch':
        await opfs.writeFileBatch(args[0] as BatchWriteEntry[])
        result = undefined
        break

      case 'appendFile':
        await opfs.appendFile(args[0] as string, args[1] as string | Uint8Array, args[2] as object)
        result = undefined
        break

      case 'copyFile':
        await opfs.copyFile(args[0] as string, args[1] as string, args[2] as number)
        result = undefined
        break

      case 'unlink':
        await opfs.unlink(args[0] as string)
        result = undefined
        break

      case 'truncate':
        await opfs.truncate(args[0] as string, args[1] as number)
        result = undefined
        break

      // Directory operations
      case 'mkdir':
        await opfs.mkdir(args[0] as string)
        result = undefined
        break

      case 'rmdir':
        await opfs.rmdir(args[0] as string)
        result = undefined
        break

      case 'readdir':
        result = await opfs.readdir(args[0] as string, args[1] as object)
        break

      case 'cp':
        await opfs.cp(args[0] as string, args[1] as string, args[2] as object)
        result = undefined
        break

      case 'rm':
        await opfs.rm(args[0] as string, args[1] as object)
        result = undefined
        break

      // Stat operations
      case 'stat':
        result = serializeStats(await opfs.stat(args[0] as string))
        break

      case 'lstat':
        result = serializeStats(await opfs.lstat(args[0] as string))
        break

      case 'exists':
        result = await opfs.exists(args[0] as string)
        break

      case 'access':
        await opfs.access(args[0] as string, args[1] as number)
        result = undefined
        break

      case 'statfs':
        result = await opfs.statfs(args[0] as string | undefined)
        break

      case 'du':
        result = await opfs.du(args[0] as string)
        break

      // Symlink operations
      case 'symlink':
        await opfs.symlink(args[0] as string, args[1] as string)
        result = undefined
        break

      case 'readlink':
        result = await opfs.readlink(args[0] as string)
        break

      case 'symlinkBatch':
        await opfs.symlinkBatch(args[0] as SymlinkDefinition[])
        result = undefined
        break

      case 'realpath':
        result = await opfs.realpath(args[0] as string)
        break

      // Other operations
      case 'rename':
        await opfs.rename(args[0] as string, args[1] as string)
        result = undefined
        break

      case 'mkdtemp':
        result = await opfs.mkdtemp(args[0] as string)
        break

      case 'chmod':
        await opfs.chmod(args[0] as string, args[1] as number)
        result = undefined
        break

      case 'chown':
        await opfs.chown(args[0] as string, args[1] as number, args[2] as number)
        result = undefined
        break

      case 'utimes':
        await opfs.utimes(args[0] as string, args[1] as Date | number, args[2] as Date | number)
        result = undefined
        break

      case 'lutimes':
        await opfs.lutimes(args[0] as string, args[1] as Date | number, args[2] as Date | number)
        result = undefined
        break

      case 'resetCache':
        opfs.resetCache()
        result = undefined
        break

      case 'gc':
        // Force full garbage collection by completely reinitializing the OPFS instance
        // This releases all handles and caches, allowing browser to clean up resources
        fs = null
        fs = new OPFS({ useSync: true, verbose: false })
        result = undefined
        break

      default:
        throw new Error(`Unknown method: ${method}`)
    }

    const response: WorkerResponse = { id, result }
    if (transfer.length > 0) {
      self.postMessage(response, transfer)
    } else {
      self.postMessage(response)
    }
  } catch (err) {
    const error = err as Error & { code?: string }
    const response: WorkerResponse = {
      id,
      error: {
        message: error.message,
        code: error.code
      }
    }
    self.postMessage(response)
  }
}

// Serialize Stats object (functions can't be transferred)
function serializeStats(stats: { type: string; size: number; mode: number; ctime: Date; ctimeMs: number; mtime: Date; mtimeMs: number; target?: string }) {
  return {
    type: stats.type,
    size: stats.size,
    mode: stats.mode,
    ctime: stats.ctime.toISOString(),
    ctimeMs: stats.ctimeMs,
    mtime: stats.mtime.toISOString(),
    mtimeMs: stats.mtimeMs,
    target: stats.target
  }
}

// Signal that worker is ready
self.postMessage({ type: 'ready' })
