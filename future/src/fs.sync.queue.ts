/**
 * FS Sync Worker - Fire-and-Forget Queue
 * Handles queued async operations that don't need responses
 */

import { enterFireAndForgetMode, exitFireAndForgetMode } from './fs.vfs'
import { syncMethods } from './fs.sync.methods'

// Fire-and-forget queue configuration
export const MAX_ASYNC_QUEUE_SIZE = 1000 // Maximum pending fire-and-forget operations

// Fire-and-forget queue metrics
export const asyncQueueMetrics = {
  totalQueued: 0,
  totalProcessed: 0,
  totalDropped: 0,
  peakQueueSize: 0,
}

// Queue for fire-and-forget requests (via postMessage)
export const asyncQueue: Array<{ method: string; args: unknown[] }> = []

// Process queued fire-and-forget requests
export const processAsyncQueue = () => {
  while (asyncQueue.length > 0) {
    const { method, args } = asyncQueue.shift()!
    try {
      const fn = syncMethods[method]
      if (fn) {
        // Enter fire-and-forget mode so VFS writes don't trigger OPFS sync
        // (OPFS already has the data from the async method that triggered this)
        // Using counter-based enter/exit handles nested operations correctly
        enterFireAndForgetMode()
        try {
          fn(...args)
        } finally {
          exitFireAndForgetMode()
        }
      }
      asyncQueueMetrics.totalProcessed++
    } catch (err) {
      console.error('[SyncWorker] Fire-and-forget error:', err)
      asyncQueueMetrics.totalProcessed++ // Still count as processed even on error
    }
  }
}

// Add item to the queue with overflow protection
export const enqueueFireAndForget = (method: string, args: unknown[]) => {
  // Enforce queue size limit - drop oldest if over limit
  if (asyncQueue.length >= MAX_ASYNC_QUEUE_SIZE) {
    const dropped = asyncQueue.shift()
    asyncQueueMetrics.totalDropped++
    console.warn(`[SyncWorker] Fire-and-forget queue overflow, dropped oldest: ${dropped?.method}`)
  }
  asyncQueue.push({ method, args })
  asyncQueueMetrics.totalQueued++
  if (asyncQueue.length > asyncQueueMetrics.peakQueueSize) {
    asyncQueueMetrics.peakQueueSize = asyncQueue.length
  }
}
