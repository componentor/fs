// Node.js fs.watchFile / fs.unwatchFile implementation
// https://nodejs.org/api/fs.html#fswatchfilefilename-options-listener
// Note: These are deprecated in Node.js but still used by some packages

import { EventEmitter } from 'events'
import { Stats, createStats } from '../classes'
import { S_IFREG } from '../constants'

export interface WatchFileOptions {
    bigint?: boolean
    persistent?: boolean
    interval?: number
}

export type WatchFileListener = (curr: Stats, prev: Stats) => void

// Store for active file watchers
const fileWatchers = new Map<string, StatWatcher>()

// Function to get stats (to be injected)
type GetStatsFn = (path: string) => { size: number; mode: number; uid: number; gid: number; atimeMs: number; mtimeMs: number } | null

let getStatsFn: GetStatsFn | null = null

export const setWatchFileStatsFn = (fn: GetStatsFn) => {
    getStatsFn = fn
}

class StatWatcher extends EventEmitter {
    #path: string
    #interval: number
    #persistent: boolean
    #bigint: boolean
    #timer: ReturnType<typeof setInterval> | null = null
    #prevStats: Stats | null = null
    #stopped: boolean = false

    constructor(path: string, options: WatchFileOptions = {}) {
        super()
        this.#path = path
        this.#interval = options.interval ?? 5007 // Node.js default
        this.#persistent = options.persistent ?? true
        this.#bigint = options.bigint ?? false

        // Get initial stats
        this.#prevStats = this.#getStats()

        // Start polling
        this.#start()
    }

    #getStats(): Stats {
        if (!getStatsFn) {
            // Return empty stats if function not set
            return createStats(0, S_IFREG | 0o644, 0, 0, 0, 0, 0, this.#bigint) as Stats
        }

        const statData = getStatsFn(this.#path)

        if (!statData) {
            // File doesn't exist - return zeroed stats
            return createStats(0, 0, 0, 0, 0, 0, 0, this.#bigint) as Stats
        }

        return createStats(
            statData.size,
            statData.mode,
            statData.uid,
            statData.gid,
            statData.atimeMs,
            statData.mtimeMs,
            statData.mtimeMs,
            this.#bigint
        ) as Stats
    }

    #start(): void {
        this.#timer = setInterval(() => {
            if (this.#stopped) return

            const currStats = this.#getStats()

            // Check if stats changed
            if (this.#hasChanged(this.#prevStats!, currStats)) {
                this.emit('change', currStats, this.#prevStats)
                this.#prevStats = currStats
            }
        }, this.#interval)

        // If not persistent, allow process to exit
        if (!this.#persistent && this.#timer.unref) {
            this.#timer.unref()
        }
    }

    #hasChanged(prev: Stats, curr: Stats): boolean {
        return (
            prev.size !== curr.size ||
            prev.mode !== curr.mode ||
            prev.mtimeMs !== curr.mtimeMs ||
            prev.ino !== curr.ino
        )
    }

    stop(): void {
        this.#stopped = true
        if (this.#timer) {
            clearInterval(this.#timer)
            this.#timer = null
        }
        this.emit('stop')
    }

    ref(): this {
        if (this.#timer && (this.#timer as any).ref) {
            (this.#timer as any).ref()
        }
        return this
    }

    unref(): this {
        if (this.#timer && (this.#timer as any).unref) {
            (this.#timer as any).unref()
        }
        return this
    }
}

// watchFile - start watching a file for changes
export const watchFile = (
    filename: string,
    optionsOrListener?: WatchFileOptions | WatchFileListener,
    listener?: WatchFileListener
): StatWatcher => {
    let options: WatchFileOptions = {}
    let callback: WatchFileListener | undefined

    if (typeof optionsOrListener === 'function') {
        callback = optionsOrListener
    } else if (optionsOrListener) {
        options = optionsOrListener
        callback = listener
    }

    // Check if already watching
    let watcher = fileWatchers.get(filename)

    if (!watcher) {
        watcher = new StatWatcher(filename, options)
        fileWatchers.set(filename, watcher)
    }

    if (callback) {
        watcher.on('change', callback)
    }

    return watcher
}

// unwatchFile - stop watching a file
export const unwatchFile = (
    filename: string,
    listener?: WatchFileListener
): void => {
    const watcher = fileWatchers.get(filename)

    if (!watcher) {
        return
    }

    if (listener) {
        watcher.removeListener('change', listener)

        // If no more listeners, stop watching
        if (watcher.listenerCount('change') === 0) {
            watcher.stop()
            fileWatchers.delete(filename)
        }
    } else {
        // Remove all listeners and stop
        watcher.stop()
        fileWatchers.delete(filename)
    }
}

export { StatWatcher }

export default { watchFile, unwatchFile, StatWatcher }
