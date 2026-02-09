/**
 * VFS Event Metrics - Accessor object for SAB metrics
 */

import { sharedArrayBuffer } from './state'
import { getMetrics, readPathsFromSAB } from './event-sab'
import {
    METRIC_QUEUED_TOTAL, METRIC_QUEUED_CREATE, METRIC_QUEUED_UPDATE, METRIC_QUEUED_DELETE,
    METRIC_INTERNAL_TOTAL, METRIC_INTERNAL_CREATE, METRIC_INTERNAL_UPDATE, METRIC_INTERNAL_DELETE,
    METRIC_EXTERNAL_TOTAL, METRIC_EXTERNAL_CREATE, METRIC_EXTERNAL_UPDATE, METRIC_EXTERNAL_DELETE,
    METRIC_QUEUE_PATH_COUNT, METRIC_PENDING_CREATE, METRIC_PENDING_UPDATE, METRIC_PENDING_DELETE,
    PATH_DATA_OFFSET, PATH_DATA_LENGTH
} from './event-constants'

export const eventSabMetrics = {
    // Queued totals
    get totalQueued(): number {
        const metrics = getMetrics()
        return metrics ? Atomics.load(metrics, METRIC_QUEUED_TOTAL) : 0
    },
    get queuedCreate(): number {
        const metrics = getMetrics()
        return metrics ? Atomics.load(metrics, METRIC_QUEUED_CREATE) : 0
    },
    get queuedUpdate(): number {
        const metrics = getMetrics()
        return metrics ? Atomics.load(metrics, METRIC_QUEUED_UPDATE) : 0
    },
    get queuedDelete(): number {
        const metrics = getMetrics()
        return metrics ? Atomics.load(metrics, METRIC_QUEUED_DELETE) : 0
    },
    // Internal consumed totals
    get totalInternal(): number {
        const metrics = getMetrics()
        return metrics ? Atomics.load(metrics, METRIC_INTERNAL_TOTAL) : 0
    },
    get internalCreate(): number {
        const metrics = getMetrics()
        return metrics ? Atomics.load(metrics, METRIC_INTERNAL_CREATE) : 0
    },
    get internalUpdate(): number {
        const metrics = getMetrics()
        return metrics ? Atomics.load(metrics, METRIC_INTERNAL_UPDATE) : 0
    },
    get internalDelete(): number {
        const metrics = getMetrics()
        return metrics ? Atomics.load(metrics, METRIC_INTERNAL_DELETE) : 0
    },
    // External detected totals
    get totalExternal(): number {
        const metrics = getMetrics()
        return metrics ? Atomics.load(metrics, METRIC_EXTERNAL_TOTAL) : 0
    },
    get externalCreate(): number {
        const metrics = getMetrics()
        return metrics ? Atomics.load(metrics, METRIC_EXTERNAL_CREATE) : 0
    },
    get externalUpdate(): number {
        const metrics = getMetrics()
        return metrics ? Atomics.load(metrics, METRIC_EXTERNAL_UPDATE) : 0
    },
    get externalDelete(): number {
        const metrics = getMetrics()
        return metrics ? Atomics.load(metrics, METRIC_EXTERNAL_DELETE) : 0
    },
    // Queue size
    get queueSize(): number {
        const metrics = getMetrics()
        return metrics ? Atomics.load(metrics, METRIC_QUEUE_PATH_COUNT) : 0
    },
    // Authoritative pending counts
    get pendingCreate(): number {
        const metrics = getMetrics()
        return metrics ? Atomics.load(metrics, METRIC_PENDING_CREATE) : 0
    },
    get pendingUpdate(): number {
        const metrics = getMetrics()
        return metrics ? Atomics.load(metrics, METRIC_PENDING_UPDATE) : 0
    },
    get pendingDelete(): number {
        const metrics = getMetrics()
        return metrics ? Atomics.load(metrics, METRIC_PENDING_DELETE) : 0
    },
    get totalPending(): number {
        const metrics = getMetrics()
        if (!metrics) return 0
        return Atomics.load(metrics, METRIC_PENDING_CREATE) +
               Atomics.load(metrics, METRIC_PENDING_UPDATE) +
               Atomics.load(metrics, METRIC_PENDING_DELETE)
    },
    // Pending paths from SAB
    get pendingPaths(): string[] {
        return readPathsFromSAB()
    },
}
