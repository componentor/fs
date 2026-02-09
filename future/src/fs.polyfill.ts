/**
 * FS Polyfill - Main entry point for Node.js fs module polyfill
 */

import { request as asyncRequest } from './fs.worker-pool'
import { setRequestFn, setAsyncRequestFn, setFireAndForgetFn, setSyncRequestFn } from './polyfill'
import { logger, logStart, logEnd } from './logger'
import { configure, getConfig, getStorageMode } from './config'
import { initTabTracker, getTabId } from './utils/tab-tracker'
import type { FsConfig, StorageMode } from './config'
import type { LogLevel, LogEntry, LoggerConfig } from './logger'

import {
    SYNC_STATUS_OFFSET, SYNC_LENGTH_OFFSET, SYNC_TYPE_OFFSET, SYNC_DATA_OFFSET,
    STATUS_REQUEST, STATUS_ERROR, RESPONSE_TYPE_BINARY, SYNC_SAB_SIZE, FS_PRIMARY_LOCK,
    writeSyncRequest, acquireSabLock, releaseSabLock
} from './fs.sab-utils'

import {
    setReadyCallbacks as setPrimaryReadyCallbacks,
    getSyncSAB, getEventsSAB, getSyncWorkerReady, getIsPrimaryTab, getSyncWorker,
    createSABsAndInitPrimary, scheduleSabPersist, setupPrimaryServiceWorkerListener,
    setupTabTrackerCallbacks, fireAndForget, promoteToTruePrimary,
    setActiveServiceWorker, getActiveServiceWorker
} from './fs.primary'

import {
    setReadyCallbacks as setSecondaryReadyCallbacks,
    initSecondary, reconnectToPrimary, isSyncSupported, getSafariPrimaryPort, safariAsyncRequest,
    getRelayWorker
} from './fs.secondary'

import { becomePrimary } from './utils/tab-tracker'
import { Dirent, Stats } from './classes'

// Re-export all methods from polyfill modules
export * from './polyfill'
export { constants } from './constants'
export * from './constants'

// Browser detection
const isFirefox = /Firefox/.test(navigator.userAgent)

// Track sync support
let syncSupported = true

// Export classes
export { Stats, BigIntStats, Dirent, Dir, FileHandle, ReadStream, WriteStream, FSError } from './classes'
export type { FSWatcher } from './polyfill'

// Reconstruct class instances from JSON
function reconstructClasses(value: unknown): unknown {
    if (value === null || value === undefined) return value
    if (Array.isArray(value)) return value.map(reconstructClasses)
    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>
        if (obj.__type === 'Dirent') return Dirent.fromJSON(obj as any)
        if (obj.__type === 'Stats') return Stats.fromJSON(obj as any)
        const result: Record<string, unknown> = {}
        for (const key of Object.keys(obj)) result[key] = reconstructClasses(obj[key])
        return result
    }
    return value
}

// Write methods that trigger persistence
const WRITE_METHODS = new Set([
    'writeFileSync', 'appendFileSync', 'mkdirSync', 'rmdirSync', 'unlinkSync',
    'renameSync', 'copyFileSync', 'rmSync', 'truncateSync', 'chmodSync',
    'chownSync', 'lchmodSync', 'lchownSync', 'linkSync', 'symlinkSync',
    'utimesSync', 'lutimesSync', 'cpSync', 'mkdtempSync', 'writeSync',
    'ftruncateSync', 'fchmodSync', 'fchownSync', 'futimesSync',
    'fsyncSync', 'fdatasyncSync', 'writevSync',
])

const isWorkerContext = typeof window === 'undefined' || (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope)

console.log('[FS] Cross-origin isolated:', crossOriginIsolated)
if (!crossOriginIsolated) {
    console.warn('[FS] Page is NOT cross-origin isolated. SharedArrayBuffer may not work.')
}

// ServiceWorker registration
async function registerServiceWorker(): Promise<ServiceWorker | null> {
    if (!('serviceWorker' in navigator)) return null

    try {
        const reg = await navigator.serviceWorker.register('/future/fs.service.worker.js')
        const waitForActive = async (): Promise<ServiceWorker> => {
            if (reg.active) return reg.active
            const sw = reg.installing || reg.waiting
            if (!sw) throw new Error('No service worker found')

            return new Promise((resolve, reject) => {
                const onStateChange = () => {
                    if (sw.state === 'activated') { sw.removeEventListener('statechange', onStateChange); resolve(sw) }
                    else if (sw.state === 'redundant') { sw.removeEventListener('statechange', onStateChange); reject(new Error('SW redundant')) }
                }
                sw.addEventListener('statechange', onStateChange)
            })
        }

        const activeSw = await waitForActive()
        // Store active SW ref — use reg.active directly (works even when page is outside SW scope)
        setActiveServiceWorker(activeSw)

        // Update stored ref if SW updates and page is in scope
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (navigator.serviceWorker.controller) {
                setActiveServiceWorker(navigator.serviceWorker.controller)
            }
        })

        return activeSw
    } catch (err) {
        console.error('[FS] ServiceWorker registration failed:', err)
        return null
    }
}

// Initialize using Web Locks API
async function initializeFS() {
    console.log('[FS] Initializing...')

    if (isWorkerContext) {
        syncSupported = false
        readyResolve?.()
        return
    }

    if (!('locks' in navigator)) {
        console.warn('[FS] Web Locks API not supported')
        createSABsAndInitPrimary()
        return
    }

    initTabTracker()
    console.log(`[FS] Tab ID: ${getTabId()}`)

    setupTabTrackerCallbacks(reconnectToPrimary)
    await registerServiceWorker()

    const lockAcquired = await navigator.locks.request(FS_PRIMARY_LOCK, { ifAvailable: true }, async (lock) => {
        if (lock) {
            console.log('[FS] Acquired primary lock - this tab is primary')
            setupPrimaryServiceWorkerListener()
            becomePrimary()
            createSABsAndInitPrimary()
            await new Promise(() => {})
        }
        return lock !== null
    })

    if (!lockAcquired) {
        console.log('[FS] Primary lock held by another tab - this tab is secondary')
        initSecondary()

        navigator.locks.request(FS_PRIMARY_LOCK, async () => {
            promoteToTruePrimary(getRelayWorker())
            await new Promise(() => {})
        })
    }
}

// Ready promise
let readyResolve: (() => void) | null = null
let readyReject: ((error: Error) => void) | null = null
let readyPromise: Promise<void> | null = null
let initStarted = false

function createReadyPromise() {
    if (readyPromise) return readyPromise
    readyPromise = new Promise<void>((resolve, reject) => {
        readyResolve = resolve
        readyReject = reject
        setPrimaryReadyCallbacks(resolve, reject)
        setSecondaryReadyCallbacks(resolve, reject)
        setTimeout(() => reject(new Error('FS worker initialization timed out')), 10000)
    })
    return readyPromise
}

/**
 * Wait for the FS polyfill to be fully initialized
 *
 * Use this when you need to ensure the filesystem is ready before making calls.
 * Must be called after init().
 *
 * @returns Promise that resolves when FS is ready
 * @throws Error if init() hasn't been called yet
 *
 * @example
 * ```typescript
 * await fs.init()
 * await fs.whenReady()
 * // FS is now ready to use
 * const content = fs.readFileSync('/file.txt', 'utf8')
 * ```
 */
export const whenReady = () => {
    if (!initStarted) throw new Error('FS not initialized. Call fs.init() first.')
    return createReadyPromise()
}

/**
 * Initialize the FS polyfill
 *
 * This sets up the filesystem with OPFS backing storage and SharedArrayBuffer
 * for synchronous operations. In a multi-tab environment, one tab becomes the
 * "primary" that owns OPFS access, while others relay through it.
 *
 * Call this once during app startup, then use whenReady() to wait for completion.
 *
 * @returns Promise that resolves when FS is initialized
 *
 * @example
 * ```typescript
 * // During app startup
 * await fs.init()
 *
 * // Then use filesystem normally
 * fs.writeFileSync('/hello.txt', 'Hello World')
 * ```
 */
export async function init(): Promise<void> {
    if (initStarted) return createReadyPromise()
    initStarted = true
    createReadyPromise()
    console.log('[FS] init() called - starting initialization...')
    initializeFS()
    return readyPromise!
}

// Sync request function
const request = (method: string, args: unknown[]): unknown => {
    if (!initStarted) throw new Error('FS not initialized. Call fs.init() first.')
    if (!isSyncSupported()) {
        throw new Error(`Sync fs operations not supported. Use async methods instead: fs.promises.${method.replace('Sync', '')}()`)
    }

    const syncSAB = getSyncSAB()
    if (!syncSAB || !getSyncWorkerReady()) throw new Error('FS not ready')

    const logHandle = logStart(method, args, 'main')
    const statusArray = new Int32Array(syncSAB, SYNC_STATUS_OFFSET, 1)
    const lengthView = new DataView(syncSAB, SYNC_LENGTH_OFFSET, 4)
    const decoder = new TextDecoder()

    // Acquire exclusive SAB lock to prevent race with primary tab's primaryExecuteSync
    acquireSabLock(syncSAB, isWorkerContext)

    try {
        writeSyncRequest(syncSAB, method, args)
        Atomics.store(statusArray, 0, STATUS_REQUEST)
        Atomics.notify(statusArray, 0)

        let iterations = 0
        while (Atomics.load(statusArray, 0) === STATUS_REQUEST) {
            if (!isFirefox) continue
            iterations++
            if (iterations > 50000) throw new Error('FS request timeout')
            const xhr = new XMLHttpRequest()
            xhr.open('GET', `data:,${iterations}`, false)
            try { xhr.send() } catch {}
        }

        const status = Atomics.load(statusArray, 0)
        const responseType = new Uint8Array(syncSAB, SYNC_TYPE_OFFSET, 1)[0]
        const responseLength = lengthView.getUint32(0)

        if (responseLength > SYNC_SAB_SIZE - SYNC_DATA_OFFSET || responseLength < 0) {
            Atomics.store(statusArray, 0, 0)
            throw new Error(`Invalid response length: ${responseLength}`)
        }

        Atomics.store(statusArray, 0, 0)

        if (responseType === RESPONSE_TYPE_BINARY) {
            if (status === STATUS_ERROR) throw new Error('Unexpected binary error')
            logEnd(logHandle, 'success')
            if (WRITE_METHODS.has(method)) scheduleSabPersist()
            return Buffer.from(new Uint8Array(syncSAB, SYNC_DATA_OFFSET, responseLength).slice())
        }

        const response = JSON.parse(decoder.decode(new Uint8Array(syncSAB, SYNC_DATA_OFFSET, responseLength).slice()))

        if (status === STATUS_ERROR) {
            logEnd(logHandle, 'error', response.error)
            const err = new Error(response.error) as any
            err.code = response.code; err.errno = response.errno; err.syscall = response.syscall; err.path = response.path
            throw err
        }

        logEnd(logHandle, 'success')
        if (WRITE_METHODS.has(method)) scheduleSabPersist()
        return reconstructClasses(response.result)
    } catch (err) {
        logEnd(logHandle, 'error', (err as Error).message)
        throw err
    } finally {
        releaseSabLock(syncSAB)
    }
}

const asyncRequestWrapper = (method: string, args: unknown[]): Promise<unknown> => {
    if (getIsPrimaryTab()) return asyncRequest(method, args)
    else if (!isSyncSupported() && getSafariPrimaryPort()) return safariAsyncRequest(method, args)
    else return Promise.resolve(request(method, args))
}

setRequestFn(request)
setAsyncRequestFn(asyncRequestWrapper)
setFireAndForgetFn(fireAndForget)
setSyncRequestFn(request)

// Exports
export { scheduleSabPersist }
export { getSyncSAB, getEventsSAB }
export const isReady = getSyncWorkerReady
export { isSyncSupported }

export const enterDeferredFlushMode = () => { getSyncWorker()?.postMessage({ type: 'enterDeferredFlush' }) }
export const exitDeferredFlushMode = () => { getSyncWorker()?.postMessage({ type: 'exitDeferredFlush' }) }

// Import methods for promises/default exports
import {
    readFileSync, writeFileSync, appendFileSync, existsSync, accessSync,
    unlinkSync, rmSync, mkdirSync, rmdirSync, readdirSync, opendirSync,
    statSync, lstatSync, statfsSync, renameSync, copyFileSync, cpSync,
    truncateSync, chmodSync, chownSync, lchmodSync, lchownSync,
    linkSync, symlinkSync, readlinkSync, realpathSync, mkdtempSync,
    utimesSync, lutimesSync, openSync, closeSync, readSync, writeSync,
    fstatSync, fsyncSync, fdatasyncSync, ftruncateSync, fchmodSync,
    fchownSync, futimesSync, readvSync, writevSync, globSync,
    readFile, writeFile, appendFile, exists, access,
    unlink, rm, mkdir, rmdir, readdir, opendir,
    stat, lstat, statfs, rename, copyFile, cp,
    truncate, chmod, chown, lchmod, lchown,
    link, symlink, readlink, realpath, mkdtemp,
    utimes, lutimes, open, close, read, write,
    fstat, fsync, fdatasync, ftruncate, fchmod,
    fchown, futimes, readv, writev, watch,
    glob, watchFile, unwatchFile, createReadStream, createWriteStream,
    vfsLoad, vfsExtract,
} from './polyfill'

import { constants } from './constants'

export const promises = {
    readFile, writeFile, appendFile, exists, access, unlink, rm, mkdir, rmdir,
    readdir, opendir, stat, lstat, statfs, rename, copyFile, cp, truncate,
    chmod, chown, lchmod, lchown, link, symlink, readlink, realpath, mkdtemp,
    utimes, lutimes, open, close, read, write, fstat, fsync, fdatasync,
    ftruncate, fchmod, fchown, futimes, readv, writev, glob, watch,
}

export const logging = {
    enable: () => logger.enable(), disable: () => logger.disable(),
    isEnabled: () => logger.isEnabled(), setLevel: (l: LogLevel) => logger.setLevel(l),
    setMethods: (m: string[] | undefined) => logger.setMethods(m),
    setConsole: (e: boolean) => logger.setConsole(e),
    setBuffer: (e: boolean, s?: number) => logger.setBuffer(e, s),
    getEntries: () => logger.getEntries(), clear: () => logger.clear(),
    export: () => logger.export(), getConfig: () => logger.getConfig(),
}

export default {
    readFileSync, writeFileSync, appendFileSync, existsSync, accessSync,
    unlinkSync, rmSync, mkdirSync, rmdirSync, readdirSync, opendirSync,
    statSync, lstatSync, statfsSync, renameSync, copyFileSync, cpSync,
    truncateSync, chmodSync, chownSync, lchmodSync, lchownSync,
    linkSync, symlinkSync, readlinkSync, realpathSync, mkdtempSync,
    utimesSync, lutimesSync, openSync, closeSync, readSync, writeSync,
    fstatSync, fsyncSync, fdatasyncSync, ftruncateSync, fchmodSync,
    fchownSync, futimesSync, readvSync, writevSync, globSync,
    readFile, writeFile, appendFile, exists, access, unlink, rm, mkdir, rmdir,
    readdir, opendir, stat, lstat, statfs, rename, copyFile, cp, truncate,
    chmod, chown, lchmod, lchown, link, symlink, readlink, realpath, mkdtemp,
    utimes, lutimes, open, close, read, write, fstat, fsync, fdatasync,
    ftruncate, fchmod, fchown, futimes, readv, writev, watch, glob,
    watchFile, unwatchFile, createReadStream, createWriteStream,
    constants, promises, logging, configure, getConfig, getStorageMode, init,
    vfsLoad, vfsExtract,
}

export { configure, getConfig, getStorageMode }
export { vfsLoad, vfsExtract }
export type { FsConfig, StorageMode, LogLevel, LogEntry, LoggerConfig }
