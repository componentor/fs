// Async FS Methods - All asynchronous file system operations
// File descriptor operations are in async-fd.ts
// Watch and stream operations are in async-watch.ts

import type { PathLike } from 'node:fs'
import { getStorageMode } from '../config'
import type { Dirent } from '../classes'
import {
    Stats,
    BigIntStats,
    setReadStreamReadFn,
    setReadStreamChunkFn,
    setReadStreamSizeFn,
    setWriteStreamWriteFn,
    setWriteStreamAppendFn,
    setFileHandleAsyncRequestFn,
    Dir as DirClass,
} from '../classes'
import type { Dir } from '../classes'
import { validateEncoding, validateFlag, normalizePath, parseMode } from '../utils'

// Import sub-modules and re-export their functions
import { setFdAsyncRequestFn, setFdFireAndForgetFn } from './async-fd'
export * from './async-fd'

import { setWatchAsyncRequestFn, setWatchSyncRequestFn } from './async-watch'
export * from './async-watch'

// Async request function - passed from main polyfill
let asyncRequestFn: (method: string, args: unknown[]) => Promise<unknown>
let fireAndForgetFn: (method: string, args: unknown[]) => void
let syncRequestFn: (method: string, args: unknown[]) => unknown

// Expose asyncRequest and fireAndForget for sub-modules
export const getAsyncRequest = () => asyncRequest
export const getFireAndForget = () => fireAndForget

export const setAsyncRequestFn = (fn: (method: string, args: unknown[]) => Promise<unknown>) => {
    asyncRequestFn = fn

    // Wire up stream read/write functions
    setReadStreamReadFn(async (path, options) => {
        return asyncRequest('readFile', [path, options]) as Promise<Buffer>
    })
    setReadStreamChunkFn(async (path, start, end) => {
        return asyncRequest('readFileChunk', [path, start, end]) as Promise<Buffer>
    })
    setReadStreamSizeFn(async (path) => {
        return asyncRequest('getFileSize', [path]) as Promise<number>
    })
    setWriteStreamWriteFn(async (path, data, options) => {
        await asyncRequest('writeFile', [path, data, options])
    })
    setWriteStreamAppendFn(async (path, data) => {
        await asyncRequest('appendFile', [path, data])
    })

    // Wire up FileHandle's async request function
    setFileHandleAsyncRequestFn(fn)

    // Wire up sub-modules
    setFdAsyncRequestFn(fn)
    setWatchAsyncRequestFn(fn)
}

export const setFireAndForgetFn = (fn: (method: string, args: unknown[]) => void) => {
    fireAndForgetFn = fn
    setFdFireAndForgetFn(fn)
}

export const setSyncRequestFn = (fn: (method: string, args: unknown[]) => unknown) => {
    syncRequestFn = fn
    setWatchSyncRequestFn(fn)
}

const asyncRequest = (method: string, args: unknown[]): Promise<unknown> => {
    // In VFS-only mode, route async requests through sync methods
    if (getStorageMode() === 'vfs-only') {
        if (!syncRequestFn) throw new Error('Sync request function not initialized')
        // Wrap sync call in a microtask to maintain async semantics
        return Promise.resolve().then(() => syncRequestFn(method, args))
    }

    if (!asyncRequestFn) throw new Error('Async request function not initialized')
    return asyncRequestFn(method, args)
}

const fireAndForget = (method: string, args: unknown[]) => {
    // Skip in opfs-only mode (no VFS to sync) and vfs-only mode (async uses sync, already in VFS)
    const mode = getStorageMode()
    if (mode === 'opfs-only' || mode === 'vfs-only') return

    if (fireAndForgetFn) fireAndForgetFn(method, args)
}

// Helper for AbortSignal support
const checkAborted = (signal?: AbortSignal): void => {
    if (signal?.aborted) {
        const error = new Error('The operation was aborted')
        error.name = 'AbortError'
        ;(error as NodeJS.ErrnoException).code = 'ABORT_ERR'
        throw error
    }
}

const withAbortSignal = async <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
    checkAborted(signal)

    if (!signal) return promise

    return Promise.race([
        promise,
        new Promise<T>((_, reject) => {
            signal.addEventListener('abort', () => {
                const error = new Error('The operation was aborted')
                error.name = 'AbortError'
                ;(error as NodeJS.ErrnoException).code = 'ABORT_ERR'
                reject(error)
            }, { once: true })
        })
    ])
}

export interface StatOptions {
    bigint?: boolean
}

export interface ReaddirOptions {
    withFileTypes?: boolean
    encoding?: BufferEncoding | 'buffer'
    recursive?: boolean
}

export interface GlobOptions {
    cwd?: string
    withFileTypes?: boolean
    exclude?: (path: string) => boolean
}

export interface ReadFileOptions {
    encoding?: BufferEncoding
    flag?: string
    signal?: AbortSignal
}

export interface WriteFileOptions {
    encoding?: BufferEncoding
    mode?: number
    flag?: string
    signal?: AbortSignal
    flush?: boolean
}

export interface CpOptions {
    recursive?: boolean
    force?: boolean
    signal?: AbortSignal
}

// File read/write
export const readFile = async (path: PathLike, options?: ReadFileOptions | BufferEncoding): Promise<string | Buffer> => {
    const normalizedPath = normalizePath(path as string | Buffer | URL)
    const opts = typeof options === 'string' ? { encoding: options } : options

    validateEncoding(opts?.encoding, 'read', normalizedPath)
    validateFlag(opts?.flag, 'open', normalizedPath)

    return withAbortSignal(
        asyncRequest('readFile', [normalizedPath, opts]) as Promise<string | Buffer>,
        opts?.signal
    )
}

export const writeFile = async (path: PathLike, data: string | Buffer, options?: WriteFileOptions | BufferEncoding): Promise<void> => {
    const normalizedPath = normalizePath(path as string | Buffer | URL)
    const opts = typeof options === 'string' ? { encoding: options } : options

    validateEncoding(opts?.encoding, 'write', normalizedPath)
    validateFlag(opts?.flag, 'open', normalizedPath)

    await withAbortSignal(
        asyncRequest('writeFile', [normalizedPath, data, opts]),
        opts?.signal
    )
    fireAndForget('writeFileSync', [normalizedPath, data, opts])
}

export const appendFile = async (path: PathLike, data: string | Buffer, options?: { encoding?: BufferEncoding; signal?: AbortSignal }): Promise<void> => {
    const normalizedPath = normalizePath(path as string | Buffer | URL)
    validateEncoding(options?.encoding, 'appendFile', normalizedPath)

    await withAbortSignal(
        asyncRequest('appendFile', [normalizedPath, data]),
        options?.signal
    )
    fireAndForget('appendFileSync', [normalizedPath, data])
}

// File existence and access
export function exists(path: PathLike): Promise<boolean>
export function exists(path: PathLike, callback: (exists: boolean) => void): void
export function exists(path: PathLike, callback?: (exists: boolean) => void): Promise<boolean> | void {
    const promise = asyncRequest('exists', [path]) as Promise<boolean>

    if (callback) {
        promise.then(result => callback(result), () => callback(false))
        return
    }
    return promise
}

export const access = async (path: PathLike, mode?: number): Promise<void> => {
    await asyncRequest('access', [path, mode])
}

// File deletion
export const unlink = async (path: PathLike): Promise<void> => {
    await asyncRequest('unlink', [path])
    fireAndForget('unlinkSync', [path])
}

export const rm = async (path: PathLike, options?: { recursive?: boolean; force?: boolean }): Promise<void> => {
    await asyncRequest('rm', [path, options])
    fireAndForget('rmSync', [path, options])
}

// Directory operations
export const mkdir = async (path: PathLike, options?: { recursive?: boolean }): Promise<void> => {
    await asyncRequest('mkdir', [path, options])
    fireAndForget('mkdirSync', [path, options])
}

export const rmdir = async (path: PathLike, options?: { recursive?: boolean }): Promise<void> => {
    await asyncRequest('rmdir', [path, options])
    fireAndForget('rmdirSync', [path, options])
}

export const readdir = async (path: PathLike, options?: ReaddirOptions): Promise<string[] | Dirent[]> => {
    return asyncRequest('readdir', [path, options]) as Promise<string[] | Dirent[]>
}

export const opendir = async (path: PathLike): Promise<Dir> => {
    const pathStr = String(path).replace(/^\/+|\/+$/g, '')
    const entries = await asyncRequest('readdir', [path, { withFileTypes: true }]) as Dirent[]
    return new DirClass({ path: pathStr, entries })
}

// File stats
export const stat = async (path: PathLike, options?: StatOptions): Promise<Stats | BigIntStats> => {
    const result = await asyncRequest('stat', [path, options]) as Record<string, unknown>
    if (options?.bigint) {
        return new BigIntStats(result as unknown as ConstructorParameters<typeof BigIntStats>[0])
    }
    return new Stats(result as unknown as ConstructorParameters<typeof Stats>[0])
}

export const lstat = async (path: PathLike, options?: StatOptions): Promise<Stats | BigIntStats> => {
    const result = await asyncRequest('lstat', [path, options]) as Record<string, unknown>
    if (options?.bigint) {
        return new BigIntStats(result as unknown as ConstructorParameters<typeof BigIntStats>[0])
    }
    return new Stats(result as unknown as ConstructorParameters<typeof Stats>[0])
}

export const statfs = async (path: PathLike): Promise<unknown> => {
    return asyncRequest('statfs', [path])
}

// Glob (Node.js 22+)
export async function* glob(
    pattern: string | string[],
    options?: GlobOptions
): AsyncGenerator<string | Dirent, void, unknown> {
    const results = await asyncRequest('glob', [pattern, options]) as (string | Dirent)[]
    for (const result of results) {
        yield result
    }
}

// File operations
export const rename = async (oldPath: PathLike, newPath: PathLike): Promise<void> => {
    await asyncRequest('rename', [oldPath, newPath])
    fireAndForget('renameSync', [oldPath, newPath])
}

export const copyFile = async (src: PathLike, dest: PathLike, mode?: number): Promise<void> => {
    await asyncRequest('copyFile', [src, dest, mode])
    fireAndForget('copyFileSync', [src, dest, mode])
}

export const cp = async (src: PathLike, dest: PathLike, options?: CpOptions): Promise<void> => {
    await withAbortSignal(asyncRequest('cp', [src, dest, options]), options?.signal)
    fireAndForget('cpSync', [src, dest, options])
}

export const truncate = async (path: PathLike, len?: number): Promise<void> => {
    await asyncRequest('truncate', [path, len])
    fireAndForget('truncateSync', [path, len])
}

// Permissions
export const chmod = async (path: PathLike, mode: number | string): Promise<void> => {
    const normalizedPath = normalizePath(path as string | Buffer | URL)
    const numericMode = parseMode(mode)
    await asyncRequest('chmod', [normalizedPath, numericMode])
    fireAndForget('chmodSync', [normalizedPath, numericMode])
}

export const chown = async (path: PathLike, uid: number, gid: number): Promise<void> => {
    await asyncRequest('chown', [path, uid, gid])
    fireAndForget('chownSync', [path, uid, gid])
}

export const lchmod = async (path: PathLike, mode: number | string): Promise<void> => {
    const normalizedPath = normalizePath(path as string | Buffer | URL)
    const numericMode = parseMode(mode)
    await asyncRequest('lchmod', [normalizedPath, numericMode])
    fireAndForget('lchmodSync', [normalizedPath, numericMode])
}

export const lchown = async (path: PathLike, uid: number, gid: number): Promise<void> => {
    await asyncRequest('lchown', [path, uid, gid])
    fireAndForget('lchownSync', [path, uid, gid])
}

// Links
export const link = async (existingPath: PathLike, newPath: PathLike): Promise<void> => {
    await asyncRequest('link', [existingPath, newPath])
    fireAndForget('linkSync', [existingPath, newPath])
}

export const symlink = async (target: PathLike, path: PathLike, type?: string): Promise<void> => {
    await asyncRequest('symlink', [target, path, type])
    fireAndForget('symlinkSync', [target, path, type])
}

export const readlink = async (path: PathLike): Promise<string> => {
    return asyncRequest('readlink', [path]) as Promise<string>
}

// Paths
export const realpath = async (path: PathLike): Promise<string> => {
    return asyncRequest('realpath', [path]) as Promise<string>
}

export const mkdtemp = async (prefix: string): Promise<string> => {
    return asyncRequest('mkdtemp', [prefix]) as Promise<string>
}

// Times
export const utimes = async (path: PathLike, atime: number | Date, mtime: number | Date): Promise<void> => {
    await asyncRequest('utimes', [path, atime, mtime])
    fireAndForget('utimesSync', [path, atime, mtime])
}

export const lutimes = async (path: PathLike, atime: number | Date, mtime: number | Date): Promise<void> => {
    await asyncRequest('lutimes', [path, atime, mtime])
    fireAndForget('lutimesSync', [path, atime, mtime])
}
