// Async FS Methods - File Descriptor Operations

import type { PathLike } from 'node:fs'
import { Stats, FileHandle as FileHandleClass } from '../classes'
import { validateFlag, normalizePath, parseMode } from '../utils'

// Re-export types
export type { FileHandle } from '../classes'

// Request functions - set from async.ts
let asyncRequestFn: (method: string, args: unknown[]) => Promise<unknown>
let fireAndForgetFn: (method: string, args: unknown[]) => void

export const setFdAsyncRequestFn = (fn: (method: string, args: unknown[]) => Promise<unknown>) => {
    asyncRequestFn = fn
}

export const setFdFireAndForgetFn = (fn: (method: string, args: unknown[]) => void) => {
    fireAndForgetFn = fn
}

const asyncRequest = (method: string, args: unknown[]): Promise<unknown> => {
    if (!asyncRequestFn) throw new Error('Async request function not initialized')
    return asyncRequestFn(method, args)
}

const fireAndForget = (method: string, args: unknown[]) => {
    if (fireAndForgetFn) fireAndForgetFn(method, args)
}

// File descriptor operations
export const open = async (path: PathLike, flags?: string, mode?: number): Promise<FileHandleClass> => {
    const normalizedPath = normalizePath(path as string | Buffer | URL)
    const flag = flags ?? 'r'

    // Validate flag
    validateFlag(flag, 'open', normalizedPath)

    const fd = await asyncRequest('open', [normalizedPath, flag, mode]) as number
    return new FileHandleClass(fd)
}

export const close = async (fd: number): Promise<void> => {
    await asyncRequest('close', [fd])
    fireAndForget('closeSync', [fd])
}

export const read = async (fd: number, buffer: Buffer | Uint8Array, offset: number, length: number, position: number | null): Promise<{ bytesRead: number; buffer: Buffer | Uint8Array }> => {
    return asyncRequest('read', [fd, buffer, offset, length, position]) as Promise<{ bytesRead: number; buffer: Buffer | Uint8Array }>
}

export const write = async (fd: number, buffer: Buffer | Uint8Array | string, offset?: number, length?: number, position?: number | null): Promise<{ bytesWritten: number; buffer: Buffer | Uint8Array | string }> => {
    return asyncRequest('write', [fd, buffer, offset, length, position]) as Promise<{ bytesWritten: number; buffer: Buffer | Uint8Array | string }>
}

export const fstat = async (fd: number): Promise<Stats> => {
    return asyncRequest('fstat', [fd]) as Promise<Stats>
}

export const fsync = async (fd: number): Promise<void> => {
    await asyncRequest('fsync', [fd])
    fireAndForget('fsyncSync', [fd])
}

export const fdatasync = async (fd: number): Promise<void> => {
    await asyncRequest('fdatasync', [fd])
    fireAndForget('fdatasyncSync', [fd])
}

export const ftruncate = async (fd: number, len?: number): Promise<void> => {
    await asyncRequest('ftruncate', [fd, len])
    fireAndForget('ftruncateSync', [fd, len])
}

export const fchmod = async (fd: number, mode: number | string): Promise<void> => {
    const numericMode = parseMode(mode)
    await asyncRequest('fchmod', [fd, numericMode])
    fireAndForget('fchmodSync', [fd, numericMode])
}

export const fchown = async (fd: number, uid: number, gid: number): Promise<void> => {
    await asyncRequest('fchown', [fd, uid, gid])
    fireAndForget('fchownSync', [fd, uid, gid])
}

export const futimes = async (fd: number, atime: number | Date, mtime: number | Date): Promise<void> => {
    await asyncRequest('futimes', [fd, atime, mtime])
    fireAndForget('futimesSync', [fd, atime, mtime])
}

export const readv = async (fd: number, buffers: ArrayBufferView[]): Promise<{ bytesRead: number; buffers: ArrayBufferView[] }> => {
    return asyncRequest('readv', [fd, buffers]) as Promise<{ bytesRead: number; buffers: ArrayBufferView[] }>
}

export const writev = async (fd: number, buffers: ArrayBufferView[]): Promise<{ bytesWritten: number; buffers: ArrayBufferView[] }> => {
    return asyncRequest('writev', [fd, buffers]) as Promise<{ bytesWritten: number; buffers: ArrayBufferView[] }>
}
