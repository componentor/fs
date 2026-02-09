/**
 * FS SAB Utilities - SharedArrayBuffer encoding/decoding
 */

import {
    SAB_SIZES,
    SAB_OFFSETS,
    SAB_STATUS,
    SAB_TYPE,
    LOCKS,
} from './app-constants'

// Re-export from centralized constants for backwards compatibility
// Cast to number to avoid literal type issues with `as const`
export const SYNC_STATUS_OFFSET: number = SAB_OFFSETS.STATUS
export const SYNC_LENGTH_OFFSET: number = SAB_OFFSETS.LENGTH
export const SYNC_TYPE_OFFSET: number = SAB_OFFSETS.TYPE
export const SYNC_DATA_OFFSET: number = SAB_OFFSETS.DATA_FS

export const STATUS_IDLE: number = SAB_STATUS.IDLE
export const STATUS_REQUEST: number = SAB_STATUS.REQUEST
export const STATUS_RESPONSE: number = SAB_STATUS.RESPONSE
export const STATUS_ERROR: number = SAB_STATUS.ERROR

export const REQUEST_TYPE_JSON: number = SAB_TYPE.REQUEST_JSON
export const REQUEST_TYPE_BINARY_ARG: number = SAB_TYPE.REQUEST_BINARY_ARG
export const RESPONSE_TYPE_JSON: number = SAB_TYPE.RESPONSE_JSON
export const RESPONSE_TYPE_BINARY: number = SAB_TYPE.RESPONSE_BINARY

export const SYNC_SAB_SIZE: number = SAB_SIZES.FS_SYNC
export const EVENTS_SAB_SIZE: number = SAB_SIZES.FS_EVENTS
export const FS_LOCK_OFFSET: number = SAB_OFFSETS.FS_LOCK

export const FS_PRIMARY_LOCK: string = LOCKS.FS_PRIMARY

const syncEncoder = new TextEncoder()

/**
 * Acquire exclusive lock on the FS SAB.
 * Uses compare-and-swap (CAS) spinlock at FS_LOCK_OFFSET.
 * This prevents race conditions when both the exec worker and
 * primary tab use the same SAB for sync FS operations.
 *
 * @param isWorkerThread - true if running in a Worker (can use Atomics.wait),
 *                         false for main thread (must busy-wait)
 */
export function acquireSabLock(sab: SharedArrayBuffer, isWorkerThread: boolean): void {
    const lockArray = new Int32Array(sab, FS_LOCK_OFFSET, 1)
    while (true) {
        // Try to set lock from 0 (unlocked) to 1 (locked)
        if (Atomics.compareExchange(lockArray, 0, 0, 1) === 0) {
            return // Lock acquired
        }
        // Lock is held by another thread - wait
        if (isWorkerThread) {
            Atomics.wait(lockArray, 0, 1, 5) // sleep up to 5ms
        }
        // Main thread: just spin (can't use Atomics.wait)
    }
}

/**
 * Release the FS SAB lock.
 */
export function releaseSabLock(sab: SharedArrayBuffer): void {
    const lockArray = new Int32Array(sab, FS_LOCK_OFFSET, 1)
    Atomics.store(lockArray, 0, 0) // Unlock
    Atomics.notify(lockArray, 0, 1) // Wake one waiting thread
}

/**
 * Write a sync request to the SAB with binary encoding for Buffer args
 */
export function writeSyncRequest(sab: SharedArrayBuffer, method: string, args: unknown[]): void {
    const typeView = new Uint8Array(sab, SYNC_TYPE_OFFSET, 1)
    const lengthView = new DataView(sab, SYNC_LENGTH_OFFSET, 4)

    // Check if any arg is a Buffer/Uint8Array
    let bufferArgIndex = -1
    let bufferData: Uint8Array | null = null
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (Buffer.isBuffer(arg)) {
            bufferArgIndex = i
            bufferData = new Uint8Array(arg)
            break
        }
        if (arg instanceof Uint8Array) {
            bufferArgIndex = i
            bufferData = arg
            break
        }
    }

    if (bufferArgIndex >= 0 && bufferData!) {
        const processedArgs = args.slice()
        processedArgs[bufferArgIndex] = null
        const jsonBytes = syncEncoder.encode(JSON.stringify({ method, args: processedArgs }))

        typeView[0] = REQUEST_TYPE_BINARY_ARG
        const headerView = new DataView(sab, SYNC_DATA_OFFSET, 5)
        headerView.setUint32(0, jsonBytes.length)
        headerView.setUint8(4, bufferArgIndex)
        new Uint8Array(sab, SYNC_DATA_OFFSET + 5, jsonBytes.length).set(jsonBytes)
        new Uint8Array(sab, SYNC_DATA_OFFSET + 5 + jsonBytes.length, bufferData.length).set(bufferData)
        lengthView.setUint32(0, 5 + jsonBytes.length + bufferData.length)
    } else {
        const jsonBytes = syncEncoder.encode(JSON.stringify({ method, args }))
        typeView[0] = REQUEST_TYPE_JSON
        new Uint8Array(sab, SYNC_DATA_OFFSET, jsonBytes.length).set(jsonBytes)
        lengthView.setUint32(0, jsonBytes.length)
    }
}

/**
 * Read sync response from SAB
 */
export function readSyncResponse(sab: SharedArrayBuffer): unknown {
    const lengthView = new DataView(sab, SYNC_LENGTH_OFFSET, 4)
    const decoder = new TextDecoder()

    const status = Atomics.load(new Int32Array(sab, SYNC_STATUS_OFFSET, 1), 0)
    const responseType = new Uint8Array(sab, SYNC_TYPE_OFFSET, 1)[0]
    const responseLength = lengthView.getUint32(0)

    Atomics.store(new Int32Array(sab, SYNC_STATUS_OFFSET, 1), 0, STATUS_IDLE)

    if (responseType === RESPONSE_TYPE_BINARY) {
        if (status === STATUS_ERROR) throw new Error('Unexpected binary error response')
        const binaryData = new Uint8Array(sab, SYNC_DATA_OFFSET, responseLength)
        return Buffer.from(binaryData.slice())
    }

    const responseData = new Uint8Array(sab, SYNC_DATA_OFFSET, responseLength).slice()
    const response = JSON.parse(decoder.decode(responseData))

    if (status === STATUS_ERROR) {
        const err = new Error(response.error) as any
        err.code = response.code
        err.errno = response.errno
        err.syscall = response.syscall
        err.path = response.path
        throw err
    }

    return response.result
}

/**
 * Extract transferable objects from a value (ArrayBuffers)
 */
export function extractTransferables(value: unknown): Transferable[] {
    const transferables: Transferable[] = []

    if (value instanceof ArrayBuffer) {
        transferables.push(value)
    } else if (value instanceof Uint8Array || value instanceof Int8Array ||
               value instanceof Uint16Array || value instanceof Int16Array ||
               value instanceof Uint32Array || value instanceof Int32Array ||
               value instanceof Float32Array || value instanceof Float64Array) {
        transferables.push(value.buffer)
    } else if (Array.isArray(value)) {
        for (const item of value) {
            transferables.push(...extractTransferables(item))
        }
    } else if (value && typeof value === 'object') {
        for (const key of Object.keys(value)) {
            transferables.push(...extractTransferables((value as Record<string, unknown>)[key]))
        }
    }

    return transferables
}
