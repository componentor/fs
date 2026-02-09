/**
 * FS Sync Worker Entry Point
 * Web Worker that handles synchronous filesystem operations via SharedArrayBuffer
 */

import { init, setSharedArrayBuffer, validateAndClearCorruptedEventsSAB, enterDeferredFlushMode, exitDeferredFlushMode } from './fs.vfs'
import type { StorageMode } from './config'
import { startRequestLoop, setLogging } from './fs.sync.loop'
import { asyncQueue, asyncQueueMetrics, MAX_ASYNC_QUEUE_SIZE, enqueueFireAndForget } from './fs.sync.queue'

// Worker-side configuration
let storageMode: StorageMode = 'hybrid'
let syncSAB: SharedArrayBuffer | null = null

self.onmessage = async (event) => {
  const { type, syncSAB: sync, eventsSAB: events, method, args, logging, storageMode: mode } = event.data

  if (type === 'init') {
    syncSAB = sync
    setSharedArrayBuffer(events) // Pass events SAB to VFS

    // Validate events SAB and clear if corrupted (handles persisted bad data from IndexedDB)
    validateAndClearCorruptedEventsSAB()

    // Set storage mode before initialization (startup-only setting)
    if (mode) {
      storageMode = mode as StorageMode
    }

    await init()
    self.postMessage({ type: 'initialized' })

    // Start the request loop after init
    if (syncSAB) {
      startRequestLoop(syncSAB, storageMode)
    }
  } else if (type === 'fireAndForget') {
    // Queue fire-and-forget request - will be processed between SAB requests
    enqueueFireAndForget(method, args)
  } else if (type === 'setLogging') {
    // Update logging configuration
    setLogging(logging?.enabled ?? false, logging?.level ?? 'info')
  } else if (type === 'getMetrics') {
    // Return queue metrics for monitoring
    self.postMessage({
      type: 'metrics',
      asyncQueue: {
        ...asyncQueueMetrics,
        currentSize: asyncQueue.length,
        maxSize: MAX_ASYNC_QUEUE_SIZE,
      },
    })
  } else if (type === 'enterDeferredFlush') {
    // Enable deferred flush mode for bulk operations (trades durability for speed)
    enterDeferredFlushMode()
  } else if (type === 'exitDeferredFlush') {
    // Disable deferred flush mode and flush pending data
    exitDeferredFlushMode()
  }
}

self.postMessage({ type: 'ready' })
