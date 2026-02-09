// VFS to OPFS Background Sync Queue
// Collects VFS changes and syncs to OPFS via dedicated worker (hybrid mode only)

import { readFromVfs } from './files'
import { isFireAndForgetMode } from './state'
import { getStorageMode } from '../config'
import { normalizePath } from './path'

// Sync operation types
export type OpfsSyncType = 'write' | 'delete' | 'mkdir' | 'rmdir'

interface OpfsSyncEntry {
    type: OpfsSyncType
    path: string
    timestamp: number
}

interface OpfsSyncWorkerEntry {
    type: OpfsSyncType
    path: string
    data?: Uint8Array
}

// Configuration
// Reduced from 500ms to 100ms for better data consistency
// Lower delay means faster sync to OPFS, reducing data loss risk on crash
const OPFS_SYNC_DEBOUNCE_MS = 100

// Queue state
const pendingOpfsSync = new Map<string, OpfsSyncEntry>()
let opfsSyncScheduled = false
let opfsSyncDebounceTimer: ReturnType<typeof setTimeout> | null = null
let opfsSyncWorker: Worker | null = null
let workerReady = false
let pendingBatchId = 0

// Metrics
export const opfsSyncMetrics = {
    totalSyncs: 0,
    totalWrites: 0,
    totalDeletes: 0,
    totalMkdirs: 0,
    totalRmdirs: 0,
    lastSyncTime: 0,
    lastSyncDuration: 0,
    queueHighWaterMark: 0,
    batchesSent: 0,
    entriesProcessed: 0,
    errors: 0,
}

// Initialize the dedicated sync worker
const ensureWorker = (): Worker => {
    if (!opfsSyncWorker) {
        opfsSyncWorker = new Worker(
            new URL('./opfs-sync.worker.js', import.meta.url),
            { type: 'module' }
        )

        opfsSyncWorker.onmessage = (event) => {
            const { type, id, results } = event.data

            if (type === 'ready' || type === 'initialized') {
                workerReady = true
                // Process any pending queue
                if (pendingOpfsSync.size > 0 && !opfsSyncScheduled) {
                    maybeScheduleOpfsSync()
                }
                return
            }

            if (type === 'batch-complete') {
                const duration = performance.now() - opfsSyncMetrics.lastSyncTime
                opfsSyncMetrics.lastSyncDuration = duration

                let successCount = 0
                let errorCount = 0

                for (const result of results) {
                    if (result.success) {
                        successCount++
                    } else {
                        errorCount++
                        console.warn(`[OPFS Sync] Failed: ${result.path} - ${result.error}`)
                    }
                }

                opfsSyncMetrics.entriesProcessed += successCount
                opfsSyncMetrics.errors += errorCount

                console.log(`[OPFS Sync] Batch ${id} complete: ${successCount} success, ${errorCount} errors in ${duration.toFixed(1)}ms`)

                // Check if more entries queued during processing
                if (pendingOpfsSync.size > 0) {
                    maybeScheduleOpfsSync()
                }
            }
        }

        opfsSyncWorker.onerror = (err) => {
            console.error('[OPFS Sync] Worker error:', err)
            opfsSyncMetrics.errors++
        }

        // Initialize the worker
        opfsSyncWorker.postMessage({ type: 'init' })
    }

    return opfsSyncWorker
}

// Clear scheduling timer
const clearOpfsSyncTimer = () => {
    if (opfsSyncDebounceTimer) {
        clearTimeout(opfsSyncDebounceTimer)
        opfsSyncDebounceTimer = null
    }
}

// Queue an OPFS sync operation (coalesces by path)
export const queueOpfsSync = (type: OpfsSyncType, path: string) => {
    // Only queue in hybrid mode
    if (getStorageMode() !== 'hybrid') return

    // Skip if in fire-and-forget mode (OPFS already has the data from async method)
    if (isFireAndForgetMode()) return

    const normalizedPath = normalizePath(path)
    if (!normalizedPath) return

    // Coalesce by path - newer operation always supersedes older
    // This handles sequences like: write → delete → write (recreate file)
    // The latest operation is what matters for the final OPFS state
    pendingOpfsSync.set(normalizedPath, { type, path: normalizedPath, timestamp: Date.now() })

    // Track high water mark
    if (pendingOpfsSync.size > opfsSyncMetrics.queueHighWaterMark) {
        opfsSyncMetrics.queueHighWaterMark = pendingOpfsSync.size
    }

    maybeScheduleOpfsSync()
}

// Schedule OPFS sync with debouncing
const maybeScheduleOpfsSync = () => {
    if (pendingOpfsSync.size === 0) return
    if (opfsSyncScheduled) {
        // Already scheduled, just reset debounce timer
        clearOpfsSyncTimer()
    }

    opfsSyncScheduled = true

    // Debounce: wait for activity to settle
    opfsSyncDebounceTimer = setTimeout(() => {
        dispatchToWorker()
    }, OPFS_SYNC_DEBOUNCE_MS)
}

// Dispatch pending entries to the worker
const dispatchToWorker = () => {
    if (pendingOpfsSync.size === 0) {
        opfsSyncScheduled = false
        return
    }

    // Ensure worker is ready
    const worker = ensureWorker()
    if (!workerReady) {
        // Worker not ready yet, will be called when ready
        opfsSyncScheduled = false
        return
    }

    // Prepare batch with file content for writes
    const entries: OpfsSyncWorkerEntry[] = []

    for (const [path, entry] of pendingOpfsSync) {
        const workerEntry: OpfsSyncWorkerEntry = {
            type: entry.type,
            path: entry.path,
        }

        // For writes, include the current VFS content
        if (entry.type === 'write') {
            const content = readFromVfs(entry.path)
            if (content) {
                workerEntry.data = content
            } else {
                // File no longer in VFS, skip or convert to delete
                continue
            }
        }

        entries.push(workerEntry)

        // Update metrics
        switch (entry.type) {
            case 'write': opfsSyncMetrics.totalWrites++; break
            case 'delete': opfsSyncMetrics.totalDeletes++; break
            case 'mkdir': opfsSyncMetrics.totalMkdirs++; break
            case 'rmdir': opfsSyncMetrics.totalRmdirs++; break
        }
    }

    // Clear pending queue
    pendingOpfsSync.clear()
    opfsSyncScheduled = false

    if (entries.length === 0) return

    // Send batch to worker
    const batchId = ++pendingBatchId
    opfsSyncMetrics.batchesSent++
    opfsSyncMetrics.totalSyncs++
    opfsSyncMetrics.lastSyncTime = performance.now()

    // Transfer ArrayBuffers for zero-copy
    const transferables: ArrayBuffer[] = entries
        .filter(e => e.data)
        .map(e => e.data!.buffer as ArrayBuffer)

    worker.postMessage(
        { type: 'process-batch', id: batchId, entries },
        transferables
    )

    console.log(`[OPFS Sync] Dispatched batch ${batchId} with ${entries.length} entries`)
}

// Force immediate sync (for testing or explicit flush)
export const flushOpfsSync = async (): Promise<void> => {
    clearOpfsSyncTimer()

    if (pendingOpfsSync.size > 0) {
        dispatchToWorker()
    }

    // Wait a bit for worker to process
    // In a real implementation, we'd wait for batch-complete message
    await new Promise(resolve => setTimeout(resolve, 100))
}

// Get sync queue status
export const getOpfsSyncStatus = () => ({
    scheduled: opfsSyncScheduled,
    workerReady,
    pendingCount: pendingOpfsSync.size,
    pendingPaths: Array.from(pendingOpfsSync.keys()),
    ...opfsSyncMetrics,
})

// Clear the queue (for testing)
export const clearOpfsSyncQueue = () => {
    clearOpfsSyncTimer()
    pendingOpfsSync.clear()
    opfsSyncScheduled = false
}

// Terminate the worker (for cleanup)
export const terminateOpfsSyncWorker = () => {
    if (opfsSyncWorker) {
        opfsSyncWorker.terminate()
        opfsSyncWorker = null
        workerReady = false
    }
}
