/**
 * FS Secondary Tab - Functions for secondary tabs
 */

import { getTabId, announceToCurrentPrimary } from './utils/tab-tracker'
import { SYNC_STATUS_OFFSET, STATUS_IDLE, SYNC_SAB_SIZE } from './fs.sab-utils'
import { Dirent, Stats } from './classes'
import { setSABs, setWorkerReady, setIsPrimaryTab, getActiveServiceWorker } from './fs.primary'

// Browser detection
const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)

// State
let secondarySyncSAB: SharedArrayBuffer | null = null
let relayWorker: Worker | null = null
let relayWorkerReady = false
let syncSupported = true
let readyResolve: (() => void) | null = null
let readyReject: ((err: Error) => void) | null = null

// Safari async-only mode
let safariPrimaryPort: MessagePort | null = null
const safariPendingRequests = new Map<string, { resolve: (v: unknown) => void, reject: (e: Error) => void }>()

export function setReadyCallbacks(resolve: () => void, reject: (err: Error) => void) {
    readyResolve = resolve
    readyReject = reject
}

export function getRelayWorker() { return relayWorker }
export function getRelayWorkerReady() { return relayWorkerReady }
export function isSyncSupported() { return syncSupported }
export function getSafariPrimaryPort() { return safariPrimaryPort }

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

export function initSecondary() {
    console.log('[FS Secondary] Initializing secondary tab...')

    if (isSafari) {
        console.warn('[FS Secondary] Safari detected - sync operations not supported in secondary tabs.')
        syncSupported = false
        initSecondaryAsyncOnly()
        return
    }

    try {
        secondarySyncSAB = new SharedArrayBuffer(SYNC_SAB_SIZE)
        console.log('[FS Secondary] Local SAB created')

        const statusArray = new Int32Array(secondarySyncSAB, SYNC_STATUS_OFFSET, 1)
        Atomics.store(statusArray, 0, STATUS_IDLE)
    } catch (err) {
        console.error('[FS Secondary] Failed to create local SAB:', err)
        readyReject?.(new Error('Failed to create SharedArrayBuffer for secondary tab'))
        return
    }

    console.log('[FS Secondary] Creating relay worker...')
    relayWorker = new Worker(new URL('./fs.relay.worker.js', import.meta.url), { type: 'module' })

    relayWorker.onmessage = (e) => {
        console.log('[FS Secondary] Relay worker message:', e.data.type)

        if (e.data.type === 'initialized') {
            relayWorkerReady = true
            console.log('[FS Secondary] Relay worker ready')
            connectToPrimary()
        }

        if (e.data.type === 'primary-disconnected') {
            console.log('[FS Secondary] Primary disconnected notification')
        }
    }

    relayWorker.onerror = (e) => {
        console.error('[FS Secondary] Relay worker error:', e)
        readyReject?.(new Error(`Relay worker error: ${e.message}`))
    }

    relayWorker.postMessage({ type: 'init', syncSAB: secondarySyncSAB, tabId: getTabId() })
}

function initSecondaryAsyncOnly() {
    console.log('[FS Secondary] Initializing in async-only mode (Safari)...')

    const channel = new MessageChannel()

    channel.port1.onmessage = (e) => {
        if (e.data.type === 'connected') {
            console.log('[FS Secondary] Connected to primary (async-only mode)!')
            safariPrimaryPort = channel.port1

            channel.port1.onmessage = (event) => {
                const { type, requestId, result, error } = event.data
                if (type === 'fs-response') {
                    const pending = safariPendingRequests.get(requestId)
                    if (pending) {
                        safariPendingRequests.delete(requestId)
                        if (error) pending.reject(new Error(error))
                        else pending.resolve(reconstructClasses(result))
                    }
                }
            }

            setWorkerReady(true)
            announceToCurrentPrimary()
            readyResolve?.()
        }
    }

    getActiveServiceWorker()?.postMessage(
        { type: 'request-connection' },
        [channel.port2]
    )
}

export function safariAsyncRequest(method: string, args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
        if (!safariPrimaryPort) {
            reject(new Error('Not connected to primary'))
            return
        }

        const requestId = Math.random().toString(36).substr(2, 9)
        safariPendingRequests.set(requestId, { resolve, reject })

        setTimeout(() => {
            if (safariPendingRequests.has(requestId)) {
                safariPendingRequests.delete(requestId)
                reject(new Error('Request timeout'))
            }
        }, 30000)

        safariPrimaryPort.postMessage({ type: 'fs-request', requestId, method, args })
    })
}

function connectToPrimary() {
    console.log('[FS Secondary] Connecting to primary via ServiceWorker...')

    const channel = new MessageChannel()

    channel.port1.onmessage = (e) => {
        if (e.data.type === 'connected') {
            console.log('[FS Secondary] Connected to primary!')

            relayWorker?.postMessage({ type: 'set-primary-port' }, [channel.port1])

            setWorkerReady(true)
            setSABs(secondarySyncSAB!, null)
            setIsPrimaryTab(false)

            announceToCurrentPrimary()
            readyResolve?.()
        }
    }

    getActiveServiceWorker()?.postMessage(
        { type: 'request-connection' },
        [channel.port2]
    )
}

export function reconnectToPrimary() {
    console.log('[FS Secondary] Reconnecting to new primary via ServiceWorker...')

    const channel = new MessageChannel()

    channel.port1.onmessage = (e) => {
        if (e.data.type === 'connected') {
            console.log('[FS Secondary] Reconnected to new primary!')
            relayWorker?.postMessage({ type: 'set-primary-port' }, [channel.port1])
            announceToCurrentPrimary()
        }
    }

    getActiveServiceWorker()?.postMessage(
        { type: 'request-connection' },
        [channel.port2]
    )
}
