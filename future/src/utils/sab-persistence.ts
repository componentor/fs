/**
 * SAB Persistence - Save/restore SharedArrayBuffer state to IndexedDB
 *
 * Persists:
 * - Events SAB: File system event subscriptions and state
 * - Sync SAB: Communication buffer state (for restoring after tab change)
 *
 * VFS data is NOT stored here - it's already persisted in OPFS.
 */

const DB_NAME = 'fs_sab_store'
const DB_VERSION = 1
const STORE_NAME = 'sab_data'
const EVENTS_KEY = 'events_sab'
const SYNC_KEY = 'sync_sab'

// Format version - increment when SAB format changes to invalidate old data
const EVENTS_FORMAT_VERSION = 2 // v2: header is now 12 bytes (added writeOffset)
const SYNC_FORMAT_VERSION = 1

let db: IDBDatabase | null = null

/**
 * Initialize IndexedDB connection
 */
export async function initSabPersistence(): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)

        request.onerror = () => {
            console.error('[SAB Persistence] Failed to open IndexedDB:', request.error)
            reject(request.error)
        }

        request.onsuccess = () => {
            db = request.result
            console.log('[SAB Persistence] IndexedDB opened')
            resolve()
        }

        request.onupgradeneeded = (event) => {
            const database = (event.target as IDBOpenDBRequest).result
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME)
                console.log('[SAB Persistence] Created object store')
            }
        }
    })
}

/**
 * Save events SAB data to IndexedDB
 */
export async function saveEventsSab(sab: SharedArrayBuffer): Promise<void> {
    if (!db) {
        console.warn('[SAB Persistence] DB not initialized, skipping save')
        return
    }

    // Copy SAB to regular ArrayBuffer for storage
    const data = new Uint8Array(sab).slice().buffer

    return new Promise((resolve, reject) => {
        const transaction = db!.transaction([STORE_NAME], 'readwrite')
        const store = transaction.objectStore(STORE_NAME)

        const request = store.put({
            data,
            timestamp: Date.now(),
            size: data.byteLength,
            formatVersion: EVENTS_FORMAT_VERSION
        }, EVENTS_KEY)

        request.onerror = () => {
            console.error('[SAB Persistence] Failed to save events:', request.error)
            reject(request.error)
        }

        request.onsuccess = () => {
            console.log(`[SAB Persistence] Saved events SAB (${(data.byteLength / 1024).toFixed(1)}KB)`)
            resolve()
        }
    })
}

/**
 * Save sync SAB data to IndexedDB
 */
export async function saveSyncSab(sab: SharedArrayBuffer): Promise<void> {
    if (!db) {
        console.warn('[SAB Persistence] DB not initialized, skipping save')
        return
    }

    // Copy SAB to regular ArrayBuffer for storage
    const data = new Uint8Array(sab).slice().buffer

    return new Promise((resolve, reject) => {
        const transaction = db!.transaction([STORE_NAME], 'readwrite')
        const store = transaction.objectStore(STORE_NAME)

        const request = store.put({
            data,
            timestamp: Date.now(),
            size: data.byteLength,
            formatVersion: SYNC_FORMAT_VERSION
        }, SYNC_KEY)

        request.onerror = () => {
            console.error('[SAB Persistence] Failed to save sync:', request.error)
            reject(request.error)
        }

        request.onsuccess = () => {
            console.log(`[SAB Persistence] Saved sync SAB (${(data.byteLength / 1024).toFixed(1)}KB)`)
            resolve()
        }
    })
}

/**
 * Load events SAB data from IndexedDB into existing SAB
 */
export async function loadEventsSab(targetSab: SharedArrayBuffer): Promise<boolean> {
    if (!db) {
        try {
            await initSabPersistence()
        } catch {
            return false
        }
    }

    return new Promise((resolve, reject) => {
        const transaction = db!.transaction([STORE_NAME], 'readonly')
        const store = transaction.objectStore(STORE_NAME)
        const request = store.get(EVENTS_KEY)

        request.onerror = () => {
            console.error('[SAB Persistence] Failed to load events:', request.error)
            reject(request.error)
        }

        request.onsuccess = () => {
            const result = request.result
            if (result && result.data) {
                // Check format version - skip if mismatched (format changed)
                if (result.formatVersion !== EVENTS_FORMAT_VERSION) {
                    console.log(`[SAB Persistence] Events SAB format version mismatch (stored: ${result.formatVersion}, current: ${EVENTS_FORMAT_VERSION}) - starting fresh`)
                    resolve(false)
                    return
                }

                // Copy stored data into the SAB
                const storedData = new Uint8Array(result.data)
                const targetView = new Uint8Array(targetSab)

                // Only copy up to the size of the target SAB
                const copyLength = Math.min(storedData.length, targetView.length)
                targetView.set(storedData.subarray(0, copyLength))

                console.log(`[SAB Persistence] Loaded events SAB (${(copyLength / 1024).toFixed(1)}KB) from ${new Date(result.timestamp).toISOString()}`)
                resolve(true)
            } else {
                console.log('[SAB Persistence] No saved events data found')
                resolve(false)
            }
        }
    })
}

/**
 * Load sync SAB data from IndexedDB into existing SAB
 */
export async function loadSyncSab(targetSab: SharedArrayBuffer): Promise<boolean> {
    if (!db) {
        try {
            await initSabPersistence()
        } catch {
            return false
        }
    }

    return new Promise((resolve, reject) => {
        const transaction = db!.transaction([STORE_NAME], 'readonly')
        const store = transaction.objectStore(STORE_NAME)
        const request = store.get(SYNC_KEY)

        request.onerror = () => {
            console.error('[SAB Persistence] Failed to load sync:', request.error)
            reject(request.error)
        }

        request.onsuccess = () => {
            const result = request.result
            if (result && result.data) {
                // Check format version - skip if mismatched
                if (result.formatVersion !== SYNC_FORMAT_VERSION) {
                    console.log(`[SAB Persistence] Sync SAB format version mismatch (stored: ${result.formatVersion}, current: ${SYNC_FORMAT_VERSION}) - starting fresh`)
                    resolve(false)
                    return
                }

                // Copy stored data into the SAB
                const storedData = new Uint8Array(result.data)
                const targetView = new Uint8Array(targetSab)

                // Only copy up to the size of the target SAB
                const copyLength = Math.min(storedData.length, targetView.length)
                targetView.set(storedData.subarray(0, copyLength))

                console.log(`[SAB Persistence] Loaded sync SAB (${(copyLength / 1024).toFixed(1)}KB) from ${new Date(result.timestamp).toISOString()}`)
                resolve(true)
            } else {
                console.log('[SAB Persistence] No saved sync data found')
                resolve(false)
            }
        }
    })
}

/**
 * Clear all saved SAB data
 */
export async function clearSabData(): Promise<void> {
    if (!db) return

    return new Promise((resolve, reject) => {
        const transaction = db!.transaction([STORE_NAME], 'readwrite')
        const store = transaction.objectStore(STORE_NAME)

        const req1 = store.delete(EVENTS_KEY)
        const req2 = store.delete(SYNC_KEY)

        transaction.oncomplete = () => {
            console.log('[SAB Persistence] Cleared all saved data')
            resolve()
        }

        transaction.onerror = () => reject(transaction.error)
    })
}

/**
 * Close the database connection
 */
export function closeSabPersistence(): void {
    if (db) {
        db.close()
        db = null
    }
}
