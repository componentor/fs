// Sync FS Methods - All synchronous file system operations

import type { PathLike } from 'node:fs'
import { Stats, BigIntStats, type Dirent, type Dir } from '../classes'
import { validateEncoding, validateFlag, normalizePath, parseMode } from '../utils'
import { CHUNK_SIZES } from '../app-constants'

// Sync request function - passed from main polyfill
let requestFn: (method: string, args: unknown[]) => unknown

export const setRequestFn = (fn: (method: string, args: unknown[]) => unknown) => {
    requestFn = fn
}

const request = (method: string, args: unknown[]): unknown => {
    if (!requestFn) throw new Error('Sync request function not initialized')
    return requestFn(method, args)
}

export interface StatSyncOptions {
    bigint?: boolean
}

export interface ReaddirSyncOptions {
    withFileTypes?: boolean
    encoding?: BufferEncoding | 'buffer'
    recursive?: boolean
}

export interface GlobSyncOptions {
    cwd?: string
    withFileTypes?: boolean
    exclude?: (path: string) => boolean
}

// Chunking configuration for large files (from centralized constants)
const CHUNK_THRESHOLD = CHUNK_SIZES.FILE_THRESHOLD
const CHUNK_SIZE = CHUNK_SIZES.FILE_CHUNK

// File read/write
export const readFileSync = (path: PathLike, options?: { encoding?: BufferEncoding; flag?: string } | BufferEncoding): string | Buffer => {
    const normalizedPath = normalizePath(path as string | Buffer | URL)
    const opts = typeof options === 'string' ? { encoding: options } : options

    // Validate encoding and flag
    validateEncoding(opts?.encoding, 'read', normalizedPath)
    validateFlag(opts?.flag, 'open', normalizedPath)

    // Check file size first to determine if chunking is needed
    const fileSize = request('getFileSizeSync', [normalizedPath]) as number

    if (fileSize <= CHUNK_THRESHOLD) {
        // Small file - read in one go
        return request('readFileSync', [normalizedPath, opts]) as string | Buffer
    }

    // Large file - read in chunks and combine
    const chunks: Buffer[] = []
    let offset = 0

    while (offset < fileSize) {
        const chunkLength = Math.min(CHUNK_SIZE, fileSize - offset)
        const chunk = request('readFileSyncChunk', [normalizedPath, offset, chunkLength]) as Buffer
        chunks.push(chunk)
        offset += chunkLength
    }

    // Combine all chunks
    const combined = Buffer.concat(chunks)

    // Apply encoding if specified
    if (opts?.encoding) {
        return combined.toString(opts.encoding)
    }

    return combined
}

export const writeFileSync = (path: PathLike, data: string | Buffer, options?: { encoding?: BufferEncoding; mode?: number; flag?: string } | BufferEncoding): void => {
    const normalizedPath = normalizePath(path as string | Buffer | URL)
    const opts = typeof options === 'string' ? { encoding: options } : options

    // Validate encoding and flag
    validateEncoding(opts?.encoding, 'write', normalizedPath)
    validateFlag(opts?.flag, 'open', normalizedPath)

    request('writeFileSync', [normalizedPath, data, opts])
}

export const appendFileSync = (path: PathLike, data: string | Buffer, options?: { encoding?: BufferEncoding }): void => {
    const normalizedPath = normalizePath(path as string | Buffer | URL)

    // Validate encoding
    validateEncoding(options?.encoding, 'appendFile', normalizedPath)

    request('appendFileSync', [normalizedPath, data])
}

// File existence and access
export const existsSync = (path: PathLike): boolean => {
    return request('existsSync', [path]) as boolean
}

export const accessSync = (path: PathLike, mode?: number): void => {
    request('accessSync', [path, mode])
}

// File deletion
export const unlinkSync = (path: PathLike): void => {
    request('unlinkSync', [path])
}

export const rmSync = (path: PathLike, options?: { recursive?: boolean; force?: boolean }): void => {
    request('rmSync', [path, options])
}

// Directory operations
export const mkdirSync = (path: PathLike, options?: { recursive?: boolean }): void => {
    request('mkdirSync', [path, options])
}

export const rmdirSync = (path: PathLike, options?: { recursive?: boolean }): void => {
    request('rmdirSync', [path, options])
}

export const readdirSync = (path: PathLike, options?: ReaddirSyncOptions): string[] | Dirent[] => {
    return request('readdirSync', [path, options]) as string[] | Dirent[]
}

export const opendirSync = (path: PathLike): Dir => {
    return request('opendirSync', [path]) as Dir
}

// File stats
export const statSync = (path: PathLike, options?: StatSyncOptions): Stats | BigIntStats => {
    const result = request('statSync', [path, options]) as Record<string, unknown>
    // Reconstruct Stats object (JSON serialization loses methods)
    if (options?.bigint) {
        return new BigIntStats(result as unknown as ConstructorParameters<typeof BigIntStats>[0])
    }
    return new Stats(result as unknown as ConstructorParameters<typeof Stats>[0])
}

export const lstatSync = (path: PathLike, options?: StatSyncOptions): Stats | BigIntStats => {
    const result = request('lstatSync', [path, options]) as Record<string, unknown>
    // Reconstruct Stats object (JSON serialization loses methods)
    if (options?.bigint) {
        return new BigIntStats(result as unknown as ConstructorParameters<typeof BigIntStats>[0])
    }
    return new Stats(result as unknown as ConstructorParameters<typeof Stats>[0])
}

export const statfsSync = (path: PathLike): unknown => {
    return request('statfsSync', [path])
}

// Glob (Node.js 22+)
export const globSync = (pattern: string | string[], options?: GlobSyncOptions): string[] | Dirent[] => {
    return request('globSync', [pattern, options]) as string[] | Dirent[]
}

// File operations
export const renameSync = (oldPath: PathLike, newPath: PathLike): void => {
    request('renameSync', [oldPath, newPath])
}

export const copyFileSync = (src: PathLike, dest: PathLike): void => {
    request('copyFileSync', [src, dest])
}

export const cpSync = (src: PathLike, dest: PathLike, options?: { recursive?: boolean; force?: boolean }): void => {
    request('cpSync', [src, dest, options])
}

export const truncateSync = (path: PathLike, len?: number): void => {
    request('truncateSync', [path, len])
}

// Permissions
export const chmodSync = (path: PathLike, mode: number | string): void => {
    const normalizedPath = normalizePath(path as string | Buffer | URL)
    const numericMode = parseMode(mode)
    request('chmodSync', [normalizedPath, numericMode])
}

export const chownSync = (path: PathLike, uid: number, gid: number): void => {
    request('chownSync', [path, uid, gid])
}

export const lchmodSync = (path: PathLike, mode: number | string): void => {
    const normalizedPath = normalizePath(path as string | Buffer | URL)
    const numericMode = parseMode(mode)
    request('lchmodSync', [normalizedPath, numericMode])
}

export const lchownSync = (path: PathLike, uid: number, gid: number): void => {
    request('lchownSync', [path, uid, gid])
}

// Links
export const linkSync = (existingPath: PathLike, newPath: PathLike): void => {
    request('linkSync', [existingPath, newPath])
}

export const symlinkSync = (target: PathLike, path: PathLike, type?: string): void => {
    request('symlinkSync', [target, path, type])
}

export const readlinkSync = (path: PathLike): string => {
    return request('readlinkSync', [path]) as string
}

// Paths
export const realpathSync = (path: PathLike): string => {
    return request('realpathSync', [path]) as string
}

export const mkdtempSync = (prefix: string): string => {
    return request('mkdtempSync', [prefix]) as string
}

// Times
export const utimesSync = (path: PathLike, atime: number | Date, mtime: number | Date): void => {
    request('utimesSync', [path, atime, mtime])
}

export const lutimesSync = (path: PathLike, atime: number | Date, mtime: number | Date): void => {
    request('lutimesSync', [path, atime, mtime])
}

// File descriptor operations
export const openSync = (path: PathLike, flags: string, mode?: number): number => {
    const normalizedPath = normalizePath(path as string | Buffer | URL)

    // Validate flag
    validateFlag(flags, 'open', normalizedPath)

    return request('openSync', [normalizedPath, flags, mode]) as number
}

export const closeSync = (fd: number): void => {
    request('closeSync', [fd])
}

export const readSync = (fd: number, buffer: Buffer | Uint8Array, offset: number, length: number, position: number | null): number => {
    return request('readSync', [fd, buffer, offset, length, position]) as number
}

export const writeSync = (fd: number, buffer: Buffer | Uint8Array | string, offset?: number, length?: number, position?: number | null): number => {
    return request('writeSync', [fd, buffer, offset, length, position]) as number
}

export const fstatSync = (fd: number): Stats => {
    const result = request('fstatSync', [fd]) as Record<string, unknown>
    return new Stats(result as unknown as ConstructorParameters<typeof Stats>[0])
}

export const fsyncSync = (fd: number): void => {
    request('fsyncSync', [fd])
}

export const fdatasyncSync = (fd: number): void => {
    request('fdatasyncSync', [fd])
}

export const ftruncateSync = (fd: number, len?: number): void => {
    request('ftruncateSync', [fd, len])
}

export const fchmodSync = (fd: number, mode: number | string): void => {
    const numericMode = parseMode(mode)
    request('fchmodSync', [fd, numericMode])
}

export const fchownSync = (fd: number, uid: number, gid: number): void => {
    request('fchownSync', [fd, uid, gid])
}

export const futimesSync = (fd: number, atime: number | Date, mtime: number | Date): void => {
    request('futimesSync', [fd, atime, mtime])
}

export const readvSync = (fd: number, buffers: ArrayBufferView[]): number => {
    return request('readvSync', [fd, buffers]) as number
}

export const writevSync = (fd: number, buffers: ArrayBufferView[]): number => {
    return request('writevSync', [fd, buffers]) as number
}
