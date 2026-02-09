// Async FS Methods - Watch and Stream Operations

import type { PathLike } from 'node:fs'
import type { Dirent, ReadStream, WriteStream, ReadStreamOptions, WriteStreamOptions } from '../classes'
import { Stats, ReadStream as ReadStreamClass, WriteStream as WriteStreamClass } from '../classes'

// Request functions - set from async.ts
let asyncRequestFn: (method: string, args: unknown[]) => Promise<unknown>
let syncRequestFn: (method: string, args: unknown[]) => unknown

export const setWatchAsyncRequestFn = (fn: (method: string, args: unknown[]) => Promise<unknown>) => {
    asyncRequestFn = fn
}

export const setWatchSyncRequestFn = (fn: (method: string, args: unknown[]) => unknown) => {
    syncRequestFn = fn
}

const asyncRequest = (method: string, args: unknown[]): Promise<unknown> => {
    if (!asyncRequestFn) throw new Error('Async request function not initialized')
    return asyncRequestFn(method, args)
}

// Stat function for watchFile (duplicated here to avoid circular deps)
const stat = async (path: PathLike, options?: { bigint?: boolean }): Promise<Stats> => {
    const result = await asyncRequest('stat', [path, options]) as Record<string, unknown>
    return new Stats(result as unknown as ConstructorParameters<typeof Stats>[0])
}

// Watch types
export interface FSWatcher {
    close(): void
    on(event: 'change', listener: (eventType: string, filename: string) => void): this
    on(event: 'error', listener: (error: Error) => void): this
    on(event: 'close', listener: () => void): this
}

export interface WatchFileOptions {
    bigint?: boolean
    persistent?: boolean
    interval?: number
}

export type WatchFileListener = (curr: Stats, prev: Stats) => void

// Watch
export const watch = (path: PathLike, options?: { persistent?: boolean; recursive?: boolean; encoding?: BufferEncoding } | ((eventType: string, filename: string) => void), listener?: (eventType: string, filename: string) => void): FSWatcher => {
    const actualListener = typeof options === 'function' ? options : listener
    const actualOptions = typeof options === 'object' ? options : undefined

    const listeners: Map<string, Set<Function>> = new Map()

    const watcher: FSWatcher = {
        close: () => {
            asyncRequest('watch', [path, { ...actualOptions, close: true }]).catch(() => {})
            listeners.clear()
        },
        on: (event: string, fn: Function) => {
            if (!listeners.has(event)) listeners.set(event, new Set())
            listeners.get(event)!.add(fn)
            return watcher
        }
    }

    asyncRequest('watch', [path, actualOptions]).then(() => {
        // The watch method in async worker returns immediately
        // Events will be propagated through the VFS watch system
    }).catch((err: Error) => {
        const errorListeners = listeners.get('error')
        if (errorListeners) {
            errorListeners.forEach(fn => fn(err))
        }
    })

    if (actualListener) {
        watcher.on('change', actualListener)
    }

    return watcher
}

// watchFile / unwatchFile (deprecated but still used)
const watchFileListeners = new Map<string, Map<WatchFileListener, ReturnType<typeof setInterval>>>()

export const watchFile = (
    filename: PathLike,
    optionsOrListener?: WatchFileOptions | WatchFileListener,
    listener?: WatchFileListener
): void => {
    let options: WatchFileOptions = {}
    let callback: WatchFileListener | undefined

    if (typeof optionsOrListener === 'function') {
        callback = optionsOrListener
    } else if (optionsOrListener) {
        options = optionsOrListener
        callback = listener
    }

    if (!callback) return

    const path = String(filename)
    const interval = options.interval ?? 5007

    if (!watchFileListeners.has(path)) {
        watchFileListeners.set(path, new Map())
    }

    let prevStats: Stats | null = null

    const timer = setInterval(async () => {
        try {
            const currStats = await stat(path, { bigint: options.bigint }) as Stats
            if (prevStats && (prevStats.mtimeMs !== currStats.mtimeMs || prevStats.size !== currStats.size)) {
                callback!(currStats, prevStats)
            }
            prevStats = currStats
        } catch {
            // File doesn't exist or error - use zeroed stats
            const emptyStats = { size: 0, mtimeMs: 0 } as Stats
            if (prevStats) {
                callback!(emptyStats, prevStats)
            }
            prevStats = emptyStats
        }
    }, interval)

    if (!options.persistent && timer.unref) {
        timer.unref()
    }

    watchFileListeners.get(path)!.set(callback, timer)
}

export const unwatchFile = (filename: PathLike, listener?: WatchFileListener): void => {
    const path = String(filename)
    const listeners = watchFileListeners.get(path)

    if (!listeners) return

    if (listener) {
        const timer = listeners.get(listener)
        if (timer) {
            clearInterval(timer)
            listeners.delete(listener)
        }
        if (listeners.size === 0) {
            watchFileListeners.delete(path)
        }
    } else {
        // Remove all listeners for this file
        for (const timer of listeners.values()) {
            clearInterval(timer)
        }
        watchFileListeners.delete(path)
    }
}

// Streams
export const createReadStream = (
    path: PathLike,
    options?: ReadStreamOptions | string
): ReadStream => {
    const opts: ReadStreamOptions = typeof options === 'string'
        ? { encoding: options as BufferEncoding }
        : options ?? {}

    return new ReadStreamClass(String(path), opts) as unknown as ReadStream
}

export const createWriteStream = (
    path: PathLike,
    options?: WriteStreamOptions | string
): WriteStream => {
    const opts: WriteStreamOptions = typeof options === 'string'
        ? { encoding: options as BufferEncoding }
        : options ?? {}

    return new WriteStreamClass(String(path), opts) as unknown as WriteStream
}

// VFS Management
// These run in the sync worker where VFS state is initialized
// Must use syncRequest because VFS state is only in the sync worker
export const vfsLoad = async (): Promise<void> => {
    if (!syncRequestFn) throw new Error('Sync request function not initialized')
    syncRequestFn('vfsLoad', [])
}

export const vfsExtract = async (): Promise<void> => {
    if (!syncRequestFn) throw new Error('Sync request function not initialized')
    syncRequestFn('vfsExtract', [])
}
