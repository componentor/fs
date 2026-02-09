/**
 * VFS Event SAB Helpers - SharedArrayBuffer access for metrics
 */

import { sharedArrayBuffer } from './state'
import {
    METRICS_OFFSET, METRIC_COUNT, PATH_DATA_OFFSET, PATH_DATA_MAX_BYTES,
    PATH_DATA_LENGTH, METRIC_QUEUE_PATH_COUNT, METRIC_PENDING_CREATE,
    METRIC_PENDING_UPDATE, METRIC_PENDING_DELETE, type PathQueueEntry
} from './event-constants'

// Get metrics array view (Uint32 for counters)
export const getMetrics = (): Uint32Array | null => {
    if (!sharedArrayBuffer) return null
    return new Uint32Array(sharedArrayBuffer, METRICS_OFFSET, METRIC_COUNT)
}

// Get metrics as Int32Array (required for Atomics.notify)
export const getMetricsInt32 = (): Int32Array | null => {
    if (!sharedArrayBuffer) return null
    return new Int32Array(sharedArrayBuffer, METRICS_OFFSET, METRIC_COUNT)
}

// Sync pathQueue to SAB so main thread can read it directly
export const syncPathsToSAB = (pathQueue: Map<string, PathQueueEntry>): void => {
    if (!sharedArrayBuffer) return

    const metrics = getMetrics()
    if (metrics) {
        let pendingCreates = 0, pendingUpdates = 0, pendingDeletes = 0
        for (const entry of pathQueue.values()) {
            pendingCreates += entry.creates
            pendingUpdates += entry.updates
            pendingDeletes += entry.deletes
        }

        Atomics.store(metrics, METRIC_QUEUE_PATH_COUNT, pathQueue.size)
        Atomics.store(metrics, METRIC_PENDING_CREATE, pendingCreates)
        Atomics.store(metrics, METRIC_PENDING_UPDATE, pendingUpdates)
        Atomics.store(metrics, METRIC_PENDING_DELETE, pendingDeletes)
    }

    if (pathQueue.size === 0) return

    const paths: string[] = []
    let estimatedSize = 2

    for (const [path, entry] of pathQueue.entries()) {
        const item = `${path} (c=${entry.creates} u=${entry.updates} d=${entry.deletes})`
        const itemSize = item.length + 4
        if (estimatedSize + itemSize > PATH_DATA_MAX_BYTES - 50) {
            const remaining = pathQueue.size - paths.length
            paths.push(`... and ${remaining} more paths`)
            break
        }
        paths.push(item)
        estimatedSize += itemSize
    }

    const json = JSON.stringify(paths)
    const bytes = new TextEncoder().encode(json)

    const sabBytes = new Uint8Array(sharedArrayBuffer, PATH_DATA_OFFSET, PATH_DATA_MAX_BYTES)
    sabBytes.set(bytes)

    if (metrics) {
        Atomics.store(metrics, PATH_DATA_LENGTH, bytes.length)
    }
}

// Read paths from SAB
export const readPathsFromSAB = (): string[] => {
    if (!sharedArrayBuffer) return []
    const metrics = getMetrics()
    if (!metrics) return []

    const length = Atomics.load(metrics, PATH_DATA_LENGTH)
    if (length === 0) return []

    const sabBytes = new Uint8Array(sharedArrayBuffer, PATH_DATA_OFFSET, length)
    const copyBuffer = new Uint8Array(length)
    copyBuffer.set(sabBytes)
    const json = new TextDecoder().decode(copyBuffer)

    try {
        return JSON.parse(json)
    } catch {
        return [`(${length} bytes of path data - JSON truncated)`]
    }
}
