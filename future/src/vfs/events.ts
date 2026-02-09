/**
 * VFS Event Tracking - Exact Path-Based System
 */

import type { EventType } from './types'
import { sharedArrayBuffer, isFireAndForgetMode } from './state'
import { normalizePath } from './path'
import { getMetrics, getMetricsInt32, syncPathsToSAB, readPathsFromSAB } from './event-sab'
import {
    METRIC_QUEUED_TOTAL, METRIC_QUEUED_CREATE, METRIC_QUEUED_UPDATE, METRIC_QUEUED_DELETE,
    METRIC_INTERNAL_TOTAL, METRIC_INTERNAL_CREATE, METRIC_INTERNAL_UPDATE, METRIC_INTERNAL_DELETE,
    METRIC_EXTERNAL_TOTAL, METRIC_EXTERNAL_CREATE, METRIC_EXTERNAL_UPDATE, METRIC_EXTERNAL_DELETE,
    METRIC_QUEUE_PATH_COUNT, METRIC_COUNT, PATH_REQUEST_FLAG, PATH_RESPONSE_FLAG,
    PATH_DATA_LENGTH, PATH_DATA_OFFSET, PATH_DATA_MAX_BYTES, RESET_GRACE_COUNTER, RESET_GRACE_PERIOD,
    type PathQueueEntry
} from './event-constants'

export { eventSabMetrics } from './event-metrics'

// The queue - local Map
const pathQueue = new Map<string, PathQueueEntry>()

// Queue an event (UP)
export const queueEvent = (type: EventType, path: string): void => {
    if (isFireAndForgetMode()) return

    const metrics = getMetrics()
    if (metrics) {
        const graceCounter = Atomics.load(metrics, RESET_GRACE_COUNTER)
        if (graceCounter > 0) {
            pathQueue.clear()
            Atomics.store(metrics, RESET_GRACE_COUNTER, 0)
            Atomics.store(metrics, PATH_DATA_LENGTH, 0)
        }
    }

    const normalized = normalizePath(path)
    let entry = pathQueue.get(normalized)

    // Targeted self-consume for delete
    if (type === 'delete' && entry && (entry.creates > 0 || entry.updates > 0)) {
        if (metrics) {
            Atomics.add(metrics, METRIC_QUEUED_TOTAL, 1)
            Atomics.add(metrics, METRIC_QUEUED_DELETE, 1)
        }

        const totalCreates = entry.creates
        const totalUpdates = entry.updates
        const totalDeletes = entry.deletes + 1
        pathQueue.delete(normalized)

        if (metrics) {
            Atomics.add(metrics, METRIC_INTERNAL_TOTAL, totalCreates + totalUpdates + totalDeletes)
            Atomics.add(metrics, METRIC_INTERNAL_CREATE, totalCreates)
            Atomics.add(metrics, METRIC_INTERNAL_UPDATE, totalUpdates)
            Atomics.add(metrics, METRIC_INTERNAL_DELETE, totalDeletes)
        }

        syncPathsToSAB(pathQueue)
        return
    }

    if (!entry) {
        entry = { creates: 0, updates: 0, deletes: 0, lastMtime: 0 }
        pathQueue.set(normalized, entry)
    }

    if (type === 'create') entry.creates++
    else if (type === 'update') entry.updates++
    else entry.deletes++

    entry.lastMtime = Date.now()

    if (metrics) {
        Atomics.add(metrics, METRIC_QUEUED_TOTAL, 1)
        if (type === 'create') Atomics.add(metrics, METRIC_QUEUED_CREATE, 1)
        else if (type === 'update') Atomics.add(metrics, METRIC_QUEUED_UPDATE, 1)
        else Atomics.add(metrics, METRIC_QUEUED_DELETE, 1)
    }

    syncPathsToSAB(pathQueue)
}

// Consume an event (DOWN)
export const consumeEvent = (type: EventType, path: string, observerMtime?: number, skipExternalCount = false): boolean => {
    const normalized = normalizePath(path)
    const metrics = getMetrics()

    if (metrics) {
        const graceCounter = Atomics.load(metrics, RESET_GRACE_COUNTER)
        if (graceCounter > 0) {
            Atomics.sub(metrics, RESET_GRACE_COUNTER, 1)
            return true
        }
    }

    const pathsToConsume: string[] = []
    const prefix = normalized + '/'

    for (const queuedPath of pathQueue.keys()) {
        if (queuedPath === normalized || queuedPath.startsWith(prefix)) {
            pathsToConsume.push(queuedPath)
        }
    }

    const parts = normalized.split('/').filter(p => p.length > 0)
    for (let i = 1; i < parts.length; i++) {
        const parentPath = parts.slice(0, i).join('/')
        if (pathQueue.has(parentPath) && !pathsToConsume.includes(parentPath)) {
            pathsToConsume.push(parentPath)
        }
    }

    if (pathsToConsume.length === 0) {
        if (skipExternalCount) return true

        if (type === 'update') console.log(`[EXTERNAL UPDATE] ${normalized}`)

        if (metrics) {
            Atomics.add(metrics, METRIC_EXTERNAL_TOTAL, 1)
            if (type === 'create') Atomics.add(metrics, METRIC_EXTERNAL_CREATE, 1)
            else if (type === 'update') Atomics.add(metrics, METRIC_EXTERNAL_UPDATE, 1)
            else Atomics.add(metrics, METRIC_EXTERNAL_DELETE, 1)
        }
        return false
    }

    let totalCreates = 0, totalUpdates = 0, totalDeletes = 0
    let latestMtime = 0

    for (const p of pathsToConsume) {
        const entry = pathQueue.get(p)
        if (entry) {
            totalCreates += entry.creates
            totalUpdates += entry.updates
            totalDeletes += entry.deletes
            if (entry.lastMtime > latestMtime) latestMtime = entry.lastMtime
            pathQueue.delete(p)
        }
    }

    if (metrics) {
        Atomics.add(metrics, METRIC_INTERNAL_TOTAL, totalCreates + totalUpdates + totalDeletes)
        Atomics.add(metrics, METRIC_INTERNAL_CREATE, totalCreates)
        Atomics.add(metrics, METRIC_INTERNAL_UPDATE, totalUpdates)
        Atomics.add(metrics, METRIC_INTERNAL_DELETE, totalDeletes)
    }

    const isAlsoExternal = observerMtime !== undefined && observerMtime > latestMtime
    if (isAlsoExternal && metrics) {
        Atomics.add(metrics, METRIC_EXTERNAL_TOTAL, 1)
        if (type === 'create') Atomics.add(metrics, METRIC_EXTERNAL_CREATE, 1)
        else if (type === 'update') Atomics.add(metrics, METRIC_EXTERNAL_UPDATE, 1)
        else Atomics.add(metrics, METRIC_EXTERNAL_DELETE, 1)
    }

    syncPathsToSAB(pathQueue)
    return !isAlsoExternal
}

export const incrementExternalEvents = (type: EventType): void => {
    const metrics = getMetrics()
    if (!metrics) return

    Atomics.add(metrics, METRIC_EXTERNAL_TOTAL, 1)
    if (type === 'create') Atomics.add(metrics, METRIC_EXTERNAL_CREATE, 1)
    else if (type === 'update') Atomics.add(metrics, METRIC_EXTERNAL_UPDATE, 1)
    else Atomics.add(metrics, METRIC_EXTERNAL_DELETE, 1)
}

export const resetEventMetrics = (): void => {
    pathQueue.clear()
    const metrics = getMetrics()
    if (metrics) {
        for (let i = 0; i < METRIC_COUNT; i++) Atomics.store(metrics, i, 0)
        Atomics.store(metrics, RESET_GRACE_COUNTER, RESET_GRACE_PERIOD)
    }
}

export const getPendingCount = (): number => {
    let total = 0
    for (const entry of pathQueue.values()) {
        total += entry.creates + entry.updates + entry.deletes
    }
    return total
}

export const getPendingPaths = (): string[] => {
    if (pathQueue.size > 0) {
        const result: string[] = []
        for (const [path, entry] of pathQueue.entries()) {
            result.push(`${path} (c=${entry.creates} u=${entry.updates} d=${entry.deletes})`)
        }
        return result
    }
    return readPathsFromSAB()
}

export const getTotalPending = getPendingCount

export const clearEventCounters = (): void => {
    const metrics = getMetrics()
    if (metrics) Atomics.store(metrics, METRIC_QUEUE_PATH_COUNT, 0)
    pathQueue.clear()
}

export const dumpEventQueue = (): void => {
    const metrics = getMetrics()
    const sabPathCount = metrics ? Atomics.load(metrics, METRIC_QUEUE_PATH_COUNT) : 0
    console.log(`[PENDING PATHS] SAB says ${sabPathCount} paths, local map has ${pathQueue.size}`)

    if (pathQueue.size > 0) {
        const paths: string[] = []
        for (const [path, entry] of pathQueue.entries()) {
            paths.push(`${path} (c=${entry.creates} u=${entry.updates} d=${entry.deletes})`)
        }
        console.log(`[PENDING PATHS]`, paths)
    }
}

export const checkPathDumpRequest = (): void => {
    if (!sharedArrayBuffer) return
    const metrics = getMetrics()
    if (!metrics) return

    if (Atomics.load(metrics, PATH_REQUEST_FLAG) !== 1) return

    const paths: string[] = []
    for (const [path, entry] of pathQueue.entries()) {
        paths.push(`${path} (c=${entry.creates} u=${entry.updates} d=${entry.deletes})`)
    }
    const json = JSON.stringify(paths)
    const bytes = new TextEncoder().encode(json)

    const writeLen = Math.min(bytes.length, PATH_DATA_MAX_BYTES)
    const sabBytes = new Uint8Array(sharedArrayBuffer, PATH_DATA_OFFSET, PATH_DATA_MAX_BYTES)
    sabBytes.set(bytes.subarray(0, writeLen))

    Atomics.store(metrics, PATH_DATA_LENGTH, writeLen)
    Atomics.store(metrics, PATH_REQUEST_FLAG, 0)
    Atomics.store(metrics, PATH_RESPONSE_FLAG, 1)

    const metricsInt32 = getMetricsInt32()
    if (metricsInt32) Atomics.notify(metricsInt32, PATH_RESPONSE_FLAG)
}

export const requestPendingPathsAsync = async (timeoutMs = 1000): Promise<string[]> => {
    if (!sharedArrayBuffer) return []
    const metrics = getMetrics()
    if (!metrics) return []

    if (Atomics.load(metrics, METRIC_QUEUE_PATH_COUNT) === 0) return []

    Atomics.store(metrics, PATH_RESPONSE_FLAG, 0)
    Atomics.store(metrics, PATH_REQUEST_FLAG, 1)

    const startTime = Date.now()
    while (Date.now() - startTime < timeoutMs) {
        if (Atomics.load(metrics, PATH_RESPONSE_FLAG) === 1) {
            const length = Atomics.load(metrics, PATH_DATA_LENGTH)
            if (length === 0) return []

            const sabBytes = new Uint8Array(sharedArrayBuffer, PATH_DATA_OFFSET, length)
            const copyBuffer = new Uint8Array(length)
            copyBuffer.set(sabBytes)
            const json = new TextDecoder().decode(copyBuffer)

            Atomics.store(metrics, PATH_RESPONSE_FLAG, 0)
            try { return JSON.parse(json) } catch { return ['(failed to parse)'] }
        }
        await new Promise(r => setTimeout(r, 10))
    }

    Atomics.store(metrics, PATH_REQUEST_FLAG, 0)
    return ['(timeout)']
}

// Legacy exports
export const readEventsFromSAB = () => []
export const writeEventsToSAB = () => {}
export const clearEventsSAB = () => { clearEventCounters() }
export const validateAndClearCorruptedEventsSAB = () => true
export const isEventQueuingDisabled = () => false
export const enableEventQueuing = () => {}
export const disableEventQueuing = () => {}
export const cleanupExpiredEvents = () => 0
