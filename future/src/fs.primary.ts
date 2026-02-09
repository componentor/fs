/**
 * FS Primary Tab - Functions for the primary tab
 */

import { setSharedArrayBuffer as setPoolSAB } from './fs.worker-pool'
import { getStorageMode } from './config'
import { initSabPersistence, saveEventsSab, saveSyncSab, loadEventsSab, loadSyncSab } from './utils/sab-persistence'
import { becomePrimary, requestAllAnnounce, setTabTrackerCallbacks, type TabInfo } from './utils/tab-tracker'
import {
    SYNC_STATUS_OFFSET, STATUS_IDLE, STATUS_REQUEST, SYNC_SAB_SIZE, EVENTS_SAB_SIZE,
    writeSyncRequest, extractTransferables, readSyncResponse,
    acquireSabLock, releaseSabLock
} from './fs.sab-utils'

// State
let syncSAB: SharedArrayBuffer | null = null
let eventsSAB: SharedArrayBuffer | null = null
let syncWorker: Worker | null = null
let syncWorkerReady = false
let isPrimaryTab = false
let readyResolve: (() => void) | null = null
let readyReject: ((err: Error) => void) | null = null

// Active service worker reference (shared between primary and secondary code)
let activeServiceWorker: ServiceWorker | null = null
export function setActiveServiceWorker(sw: ServiceWorker) { activeServiceWorker = sw }
export function getActiveServiceWorker() { return activeServiceWorker }

// Connected secondaries
const connectedSecondaries: Set<string> = new Set()
const secondaryPorts: Map<string, MessagePort> = new Map()

// Fire-and-forget buffer
const fireAndForgetBuffer: Array<{ method: string; args: unknown[] }> = []

// SAB persistence debouncing
let sabSaveTimeout: ReturnType<typeof setTimeout> | null = null
const SAB_SAVE_DEBOUNCE_MS = 2000

export function setReadyCallbacks(resolve: () => void, reject: (err: Error) => void) {
    readyResolve = resolve
    readyReject = reject
}

export function getSyncSAB() { return syncSAB }
export function getEventsSAB() { return eventsSAB }
export function getSyncWorkerReady() { return syncWorkerReady }
export function getIsPrimaryTab() { return isPrimaryTab }
export function getSyncWorker() { return syncWorker }

export function initPrimarySyncWorker() {
    console.log('[FS] Creating sync worker (primary tab)...')
    syncWorker = new Worker(new URL('./fs.sync.worker.js', import.meta.url), { type: 'module' })

    syncWorker.onmessage = (e) => {
        console.log('[FS] Sync worker message:', e.data.type)
        if (e.data.type === 'initialized') {
            syncWorkerReady = true
            console.log('[FS] FS polyfill ready (primary)!')
            flushFireAndForgetBuffer()
            readyResolve?.()
        }
    }

    syncWorker.onerror = (e) => {
        console.error('[FS] Sync worker error:', e)
        readyReject?.(new Error(`Sync worker error: ${e.message}`))
    }

    syncWorker.postMessage({ type: 'init', syncSAB, eventsSAB, storageMode: getStorageMode() })
    setPoolSAB(eventsSAB!)
}

export async function createSABsAndInitPrimary() {
    console.log('[FS] Creating SABs as primary tab...')

    try {
        syncSAB = new SharedArrayBuffer(SYNC_SAB_SIZE)
        eventsSAB = new SharedArrayBuffer(EVENTS_SAB_SIZE)
        console.log('[FS] SABs created:', { syncSize: SYNC_SAB_SIZE, eventsSize: EVENTS_SAB_SIZE })

        try {
            console.log('[FS] Initializing SAB persistence...')
            await initSabPersistence()
            const [syncLoaded, eventsLoaded] = await Promise.all([
                loadSyncSab(syncSAB),
                loadEventsSab(eventsSAB)
            ])
            if (syncLoaded || eventsLoaded) {
                console.log('[FS] Restored persisted SAB data:', { syncLoaded, eventsLoaded })
            }
        } catch (err) {
            console.warn('[FS] Could not restore persisted SAB data:', err)
        }

        const statusArray = new Int32Array(syncSAB, SYNC_STATUS_OFFSET, 1)
        Atomics.store(statusArray, 0, STATUS_IDLE)

        isPrimaryTab = true
        initPrimarySyncWorker()
    } catch (err) {
        const msg = `Failed to create SharedArrayBuffer: ${(err as Error).message}. Make sure the page is cross-origin isolated.`
        console.error('[FS]', msg)
        readyReject?.(new Error(msg))
    }
}

export function scheduleSabPersist() {
    if (!isPrimaryTab || !syncSAB || !eventsSAB) return

    if (sabSaveTimeout) clearTimeout(sabSaveTimeout)

    sabSaveTimeout = setTimeout(async () => {
        console.log('[FS] Persisting SAB data to IndexedDB...')
        try {
            await Promise.all([saveSyncSab(syncSAB!), saveEventsSab(eventsSAB!)])
            console.log('[FS] SAB data persisted successfully')
        } catch (err) {
            console.warn('[FS] Failed to persist SAB data:', err)
        }
    }, SAB_SAVE_DEBOUNCE_MS)
}

export function primaryExecuteSync(method: string, args: unknown[]): unknown {
    if (!syncSAB || !syncWorkerReady) throw new Error('Primary not ready')

    // Acquire lock to prevent race with exec worker's polyfill request()
    // Primary tab is main thread → isWorkerThread = false (busy-wait)
    acquireSabLock(syncSAB, false)

    try {
        const statusArray = new Int32Array(syncSAB, SYNC_STATUS_OFFSET, 1)
        writeSyncRequest(syncSAB, method, args)
        Atomics.store(statusArray, 0, STATUS_REQUEST)
        Atomics.notify(statusArray, 0)

        while (Atomics.load(statusArray, 0) === STATUS_REQUEST) {}

        return readSyncResponse(syncSAB)
    } finally {
        releaseSabLock(syncSAB)
    }
}

function handleSecondaryFsRequest(port: MessagePort, requestId: string, method: string, args: unknown[]) {
    console.log(`[FS Primary] Request: ${method}`)

    try {
        const result = primaryExecuteSync(method, args)
        const message = { type: 'fs-response', requestId, result }
        const transferables = extractTransferables(result)
        if (transferables.length > 0) port.postMessage(message, transferables)
        else port.postMessage(message)
    } catch (err) {
        const e = err as any
        port.postMessage({
            type: 'fs-response', requestId, error: e.message,
            code: e.code, errno: e.errno, syscall: e.syscall, path: e.path
        })
    }
}

/**
 * Handle VFS read request from Service Worker (for ESM module serving)
 */
function handleVfsReadRequest(requestId: string, filePath: string) {
    const sw = activeServiceWorker
    if (!sw) {
        console.error('[FS Primary] No active service worker for VFS read response')
        return
    }

    try {
        // Use sync FS to read the file
        const content = primaryExecuteSync('readFileSync', [filePath]) as Buffer | null

        if (content) {
            // Convert Buffer to Uint8Array for transfer
            const data = content instanceof Uint8Array ? content : new Uint8Array(content)
            sw.postMessage({
                type: 'vfs-read-response',
                requestId,
                content: Array.from(data) // Convert to array for structured clone
            })
        } else {
            sw.postMessage({
                type: 'vfs-read-response',
                requestId,
                content: null
            })
        }
    } catch (err) {
        // File doesn't exist or read error
        sw.postMessage({
            type: 'vfs-read-response',
            requestId,
            content: null,
            error: (err as Error).message
        })
    }
}

function handleSecondaryPort(secondaryClientId: string, port: MessagePort) {
    console.log(`[FS Primary] Received port from secondary: ${secondaryClientId}`)
    secondaryPorts.set(secondaryClientId, port)
    connectedSecondaries.add(secondaryClientId)

    port.onmessage = (e: MessageEvent) => {
        const { type: msgType, requestId, method, args } = e.data
        if (msgType === 'fs-request') {
            handleSecondaryFsRequest(port, requestId, method, args)
        }
    }

    port.postMessage({ type: 'connected' })
}

export function setupPrimaryServiceWorkerListener() {
    // Register with SW using a control port (scope-independent communication)
    const sw = activeServiceWorker
    if (sw) {
        const mc = new MessageChannel()
        sw.postMessage({ type: 'register-primary' }, [mc.port2])

        // Listen for secondary ports on the control port
        mc.port1.onmessage = (event: MessageEvent) => {
            if (event.data.type === 'secondary-port') {
                const port = event.ports[0]
                if (port) handleSecondaryPort(event.data.secondaryClientId, port)
            }
        }
        mc.port1.start()
    }

    // Also listen on navigator.serviceWorker for backwards compat (when page is in scope)
    navigator.serviceWorker.addEventListener('message', (event) => {
        const { type, secondaryClientId, requestId, filePath } = event.data

        if (type === 'vfs-read-request') {
            handleVfsReadRequest(requestId, filePath)
            return
        }

        if (type === 'discover-primary') {
            if (isPrimaryTab) {
                console.log('[FS Primary] Re-registering with ServiceWorker (discover-primary)')
                activeServiceWorker?.postMessage({ type: 'register-primary' })
            }
            return
        }

        if (type === 'secondary-port') {
            const port = event.ports[0]
            if (port) handleSecondaryPort(secondaryClientId, port)
        }
    })
    console.log('[FS Primary] Listening for secondary ports via ServiceWorker')
}

export function setupTabTrackerCallbacks(reconnectFn: () => void) {
    setTabTrackerCallbacks({
        onSecondaryConnected: (tab: TabInfo) => {
            console.log(`[FS Primary] Secondary connected (tab tracker): ${tab.tabId}`)
            connectedSecondaries.add(tab.tabId)
        },
        onSecondaryDisconnected: (tab: TabInfo) => {
            console.log(`[FS Primary] Secondary disconnected: ${tab.tabId}`)
            connectedSecondaries.delete(tab.tabId)
        },
        onPrimaryChanged: () => {
            console.log('[FS] Primary changed notification received')
            if (!isPrimaryTab) {
                console.log('[FS Secondary] Reconnecting to new primary...')
                reconnectFn()
            }
        }
    })
}

export function flushFireAndForgetBuffer() {
    if (!syncWorker || !syncWorkerReady || !isPrimaryTab) return
    while (fireAndForgetBuffer.length > 0) {
        const { method, args } = fireAndForgetBuffer.shift()!
        syncWorker.postMessage({ type: 'fireAndForget', method, args })
    }
}

export function fireAndForget(method: string, args: unknown[]) {
    if (!isPrimaryTab) return
    if (!syncWorker || !syncWorkerReady) {
        fireAndForgetBuffer.push({ method, args })
        return
    }
    syncWorker.postMessage({ type: 'fireAndForget', method, args })
}

export function promoteToTruePrimary(relayWorker: Worker | null) {
    console.log('[FS] Acquired primary lock - promoted to primary!')
    isPrimaryTab = true
    syncWorkerReady = false // Reset — new sync worker needs to initialize
    if (relayWorker) {
        relayWorker.terminate()
    }
    setupPrimaryServiceWorkerListener()
    becomePrimary()
    requestAllAnnounce()
    createSABsAndInitPrimary()
}

export function setSABs(sync: SharedArrayBuffer, events: SharedArrayBuffer | null) {
    syncSAB = sync
    if (events) eventsSAB = events
}

export function setWorkerReady(ready: boolean) {
    syncWorkerReady = ready
}

export function setIsPrimaryTab(primary: boolean) {
    isPrimaryTab = primary
}
