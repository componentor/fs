// Worker pool with auto-scaling for async FS operations

import { logStart, logEnd, type LogHandle } from './logger'
import { WORKER_POOL, TIMEOUTS } from './app-constants'

// Configuration (from centralized constants)
const MAX_WORKERS = WORKER_POOL.MAX_WORKERS
const MIN_WORKERS = WORKER_POOL.MIN_WORKERS
const WORKER_IDLE_TIMEOUT = TIMEOUTS.WORKER_IDLE
const SCALE_UP_QUEUE_THRESHOLD = WORKER_POOL.SCALE_UP_THRESHOLD
const SCALE_CHECK_INTERVAL = TIMEOUTS.SCALE_CHECK

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  logHandle: LogHandle | null
}

interface PooledWorker {
  worker: Worker
  busy: boolean
  initialized: boolean
  lastActivity: number // Timestamp of last activity
  id: number // Unique worker ID for debugging
}

const workers: PooledWorker[] = []
const pending = new Map<number, PendingRequest>()
const queue: Array<{ id: number; method: string; args: unknown[] }> = []
let nextId = 0
let nextWorkerId = 0
let eventsSAB: SharedArrayBuffer | null = null
let scaleCheckTimer: ReturnType<typeof setInterval> | null = null
let initialized = false

// Metrics for monitoring (exported for debugging)
export const metrics = {
  totalRequests: 0,
  peakQueueDepth: 0,
  peakWorkerCount: 0,
  workersCreated: 0,
  workersTerminated: 0,
}

export const setSharedArrayBuffer = (sab: SharedArrayBuffer) => {
  eventsSAB = sab
  // Initialize any existing workers
  for (const pooled of workers) {
    if (!pooled.initialized) {
      pooled.worker.postMessage({ type: 'init', eventsSAB: sab })
      pooled.initialized = true
    }
  }

  // Start auto-scaling if not already started
  if (!initialized) {
    initialized = true
    startAutoScaling()
    // Create initial minimum workers
    ensureMinWorkers()
  }

  // Process any queued requests now that workers are initialized
  processQueue()
}

function ensureMinWorkers() {
  while (workers.length < MIN_WORKERS) {
    createWorker()
  }
}

const createWorker = (): PooledWorker => {
  const worker = new Worker(new URL('./fs.async.worker.js', import.meta.url), { type: 'module' })
  const pooled: PooledWorker = {
    worker,
    busy: false,
    initialized: false,
    lastActivity: Date.now(),
    id: nextWorkerId++,
  }
  worker.onmessage = (event) => handleMessage(pooled, event)
  workers.push(pooled)
  metrics.workersCreated++

  // Update peak worker count
  if (workers.length > metrics.peakWorkerCount) {
    metrics.peakWorkerCount = workers.length
  }

  // Initialize with SAB if available
  if (eventsSAB) {
    worker.postMessage({ type: 'init', eventsSAB })
    pooled.initialized = true
  }

  return pooled
}

function terminateWorker(pooled: PooledWorker) {
  const index = workers.indexOf(pooled)
  if (index !== -1) {
    workers.splice(index, 1)
    pooled.worker.terminate()
    metrics.workersTerminated++
  }
}

function getIdleWorker(): PooledWorker | null {
  // Find an existing idle AND initialized worker
  // Workers must be initialized (have received SAB) before they can process requests
  const idle = workers.find(w => !w.busy && w.initialized)
  if (idle) {
    idle.lastActivity = Date.now()
    return idle
  }

  // Scale up if under max - only if SAB is available (workers will be initialized immediately)
  if (workers.length < MAX_WORKERS && eventsSAB) {
    return createWorker()
  }

  return null
}

function processQueue() {
  // Update peak queue depth metric
  if (queue.length > metrics.peakQueueDepth) {
    metrics.peakQueueDepth = queue.length
  }

  while (queue.length > 0) {
    const pooled = getIdleWorker()
    if (!pooled) break
    const task = queue.shift()!
    pooled.busy = true
    pooled.lastActivity = Date.now()
    pooled.worker.postMessage(task)
  }

  // Trigger immediate scale-up if queue is getting deep
  // Only scale up if SAB is available so workers can be initialized
  if (queue.length >= SCALE_UP_QUEUE_THRESHOLD && workers.length < MAX_WORKERS && eventsSAB) {
    const newWorker = createWorker()
    // Only dispatch if worker was initialized (SAB was available)
    if (newWorker.initialized && queue.length > 0) {
      const task = queue.shift()!
      newWorker.busy = true
      newWorker.lastActivity = Date.now()
      newWorker.worker.postMessage(task)
    }
  }
}

function handleMessage(pooled: PooledWorker, event: MessageEvent) {
  const { id, result, error } = event.data
  const req = pending.get(id)
  if (req) {
    pending.delete(id)
    if (error) {
      logEnd(req.logHandle, 'error', error)
      req.reject(new Error(error))
    } else {
      logEnd(req.logHandle, 'success')
      req.resolve(result)
    }
  }
  pooled.busy = false
  pooled.lastActivity = Date.now()
  processQueue()
}

// Auto-scaling: periodically check and terminate idle workers
function startAutoScaling() {
  if (scaleCheckTimer) return

  scaleCheckTimer = setInterval(() => {
    const now = Date.now()

    // Find workers that have been idle too long
    const idleWorkers = workers.filter(
      w => !w.busy && (now - w.lastActivity) > WORKER_IDLE_TIMEOUT
    )

    // Terminate idle workers, but keep at least MIN_WORKERS
    for (const worker of idleWorkers) {
      if (workers.length > MIN_WORKERS) {
        terminateWorker(worker)
      }
    }
  }, SCALE_CHECK_INTERVAL)
}

// Stop auto-scaling (for cleanup)
export function stopAutoScaling() {
  if (scaleCheckTimer) {
    clearInterval(scaleCheckTimer)
    scaleCheckTimer = null
  }
}

// Get current pool status (for debugging/monitoring)
export function getPoolStatus() {
  return {
    workers: workers.length,
    busy: workers.filter(w => w.busy).length,
    idle: workers.filter(w => !w.busy).length,
    queueLength: queue.length,
    pendingRequests: pending.size,
    ...metrics,
  }
}

export function request(method: string, args: unknown[]): Promise<unknown> {
  metrics.totalRequests++

  // Start logging
  const logHandle = logStart(method, args, 'async')

  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject, logHandle })

    const pooled = getIdleWorker()
    if (pooled) {
      pooled.busy = true
      pooled.lastActivity = Date.now()
      pooled.worker.postMessage({ id, method, args })
    } else {
      queue.push({ id, method, args })

      // Update peak queue depth
      if (queue.length > metrics.peakQueueDepth) {
        metrics.peakQueueDepth = queue.length
      }
    }
  })
}
