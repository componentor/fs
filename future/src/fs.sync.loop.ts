/**
 * FS Sync Worker - Request Processing Loop
 * Handles sync requests via SharedArrayBuffer + Atomics
 */

import type { StorageMode } from './config'
import { getRoot } from './fs.vfs'
import { syncMethods, opfsMethods, asyncVfsMethods } from './fs.sync.methods'
import { processAsyncQueue } from './fs.sync.queue'
import {
  SYNC_STATUS_OFFSET,
  SYNC_LENGTH_OFFSET,
  SYNC_TYPE_OFFSET,
  SYNC_DATA_OFFSET,
  STATUS_IDLE,
  STATUS_REQUEST,
  STATUS_RESPONSE,
  STATUS_ERROR,
  REQUEST_TYPE_BINARY_ARG,
  RESPONSE_TYPE_JSON,
  RESPONSE_TYPE_BINARY,
} from './fs.sab-utils'

// Logging configuration
let loggingEnabled = false
let logLevel: 'none' | 'info' | 'verbose' | 'debug' = 'info'
let nextLogId = 1

export const setLogging = (enabled: boolean, level: 'none' | 'info' | 'verbose' | 'debug') => {
  loggingEnabled = enabled
  logLevel = level
}

function log(method: string, args: unknown[], phase: 'START' | 'END', duration?: number, error?: string) {
  if (!loggingEnabled) return
  const id = phase === 'START' ? nextLogId++ : nextLogId - 1
  const timestamp = performance.now().toFixed(2)
  const argsStr = args.map(a => typeof a === 'string' ? `"${a.slice(0, 30)}"` : String(a)).join(', ')
  if (phase === 'START' && logLevel === 'verbose') {
    console.log(`%c[FS:${id.toString().padStart(3, '0')} +${timestamp}ms] ${method}(${argsStr}) START [sync]`, 'color: #888')
  } else if (phase === 'END') {
    const durStr = duration !== undefined ? ` (${duration.toFixed(2)}ms)` : ''
    const status = error ? '✗' : '✓'
    const color = error ? 'color: #a44' : 'color: #4a4'
    const errMsg = error ? ` - ${error}` : ''
    console.log(`%c[FS:${id.toString().padStart(3, '0')} +${timestamp}ms] ${method}(${argsStr}) END${durStr} ${status}${errMsg}`, color)
  }
}

// Request processing loop
// Uses a tight synchronous loop for minimal latency on sync operations.
// Only yields to event loop (setTimeout) when idle, to process fire-and-forget postMessages.
export const startRequestLoop = (syncSAB: SharedArrayBuffer, storageMode: StorageMode) => {
  const statusArray = new Int32Array(syncSAB, SYNC_STATUS_OFFSET, 1)
  const lengthView = new DataView(syncSAB, SYNC_LENGTH_OFFSET, 4)
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  const processLoop = () => {
    // Process any queued fire-and-forget requests (filled by postMessage while we were yielded)
    processAsyncQueue()

    // Tight loop for handling sync requests - no yielding between requests
    while (true) {
      // Wait for a request (with timeout to periodically yield for fire-and-forget)
      const waitResult = Atomics.wait(statusArray, 0, STATUS_IDLE, 100)

      if (waitResult === 'timed-out') {
        // No sync request - yield to event loop for postMessages, then continue
        setTimeout(processLoop, 0)
        return
      }

      // Got notified or status changed - check if it's a request
      const status = Atomics.load(statusArray, 0)
      if (status !== STATUS_REQUEST) {
        continue // Spurious wakeup, keep waiting
      }

      // Read request: type byte at offset 8, payload at offset 9
      const requestType = new Uint8Array(syncSAB, SYNC_TYPE_OFFSET, 1)[0]
      const payloadLength = lengthView.getUint32(0)

      // Validate payload length to catch corruption early
      if (payloadLength > 60 * 1024 * 1024) { // Max ~60MB
        console.error('[SyncWorker] Invalid payload length:', payloadLength)
        Atomics.store(statusArray, 0, STATUS_IDLE)
        continue
      }

      let method: string
      let args: unknown[]

      try {
        if (requestType === REQUEST_TYPE_BINARY_ARG) {
          // Binary arg request: [jsonLen:4][bufIdx:1][json:jsonLen][buffer:rest]
          const headerView = new DataView(syncSAB, SYNC_DATA_OFFSET, 5)
          const jsonLen = headerView.getUint32(0)
          const bufferArgIndex = headerView.getUint8(4)

          // Validate json length
          if (jsonLen > payloadLength - 5) {
            console.error('[SyncWorker] Invalid JSON length:', jsonLen, 'payload:', payloadLength)
            Atomics.store(statusArray, 0, STATUS_IDLE)
            continue
          }

          const jsonData = new Uint8Array(syncSAB, SYNC_DATA_OFFSET + 5, jsonLen).slice()
          const parsed = JSON.parse(decoder.decode(jsonData))
          method = parsed.method
          args = parsed.args

          // Extract raw buffer bytes and reconstruct Buffer at the right arg index
          const bufferStart = SYNC_DATA_OFFSET + 5 + jsonLen
          const bufferLen = payloadLength - 5 - jsonLen
          if (bufferLen > 0) {
            const bufferView = new Uint8Array(syncSAB, bufferStart, bufferLen)
            args[bufferArgIndex] = Buffer.from(new Uint8Array(bufferView))
          }
        } else {
          // Pure JSON request
          const requestData = new Uint8Array(syncSAB, SYNC_DATA_OFFSET, payloadLength).slice()
          const parsed = JSON.parse(decoder.decode(requestData))
          method = parsed.method
          args = parsed.args
        }
      } catch (parseErr) {
        console.error('[SyncWorker] Failed to parse request:', parseErr)
        Atomics.store(statusArray, 0, STATUS_IDLE)
        continue
      }

      let responseStatus = STATUS_RESPONSE
      let responseData: Uint8Array
      let responseType = RESPONSE_TYPE_JSON

      const startTime = performance.now()
      log(method, args, 'START')

      try {
        let result: unknown

        // Check for async VFS methods first (vfsLoad, vfsExtract, etc.)
        const asyncVfsFn = asyncVfsMethods[method]
        if (asyncVfsFn) {
          // Async VFS methods need to break out of sync loop
          // Run async method, then re-enter loop via setTimeout
          ;(async () => {
            try {
              result = await asyncVfsFn(...(args as unknown[]))
              writeResponse(result)
            } catch (err) {
              writeError((err as Error).message)
            }
            log(method, args, 'END', performance.now() - startTime)
            setTimeout(processLoop, 0)
          })()
          return // Exit sync loop, will re-enter after async completes
        } else if (storageMode === 'opfs-only') {
          // OPFS-only mode: use async OPFS methods
          const fn = opfsMethods[method]
          if (!fn) throw new Error(`Unknown method: ${method}`)

          const root = getRoot()
          if (!root) throw new Error('OPFS root not initialized')

          // Async - need to break out of sync loop
          ;(async () => {
            try {
              result = await fn(root, ...(args as unknown[]))
              writeResponse(result)
            } catch (err) {
              writeError((err as Error).message)
            }
            log(method, args, 'END', performance.now() - startTime)
            setTimeout(processLoop, 0)
          })()
          return // Exit sync loop
        } else {
          // Hybrid or VFS-only mode: use sync VFS methods (stays in loop)
          const fn = syncMethods[method]
          if (!fn) throw new Error(`Unknown method: ${method}`)
          result = fn(...(args as unknown[]))
        }

        // Use binary response for Buffer results (much more efficient than JSON)
        if (Buffer.isBuffer(result)) {
          responseType = RESPONSE_TYPE_BINARY
          responseData = new Uint8Array(result)
        } else if (result instanceof Uint8Array) {
          responseType = RESPONSE_TYPE_BINARY
          responseData = result
        } else {
          responseType = RESPONSE_TYPE_JSON
          responseData = encoder.encode(JSON.stringify({ result }))
        }
        log(method, args, 'END', performance.now() - startTime)
      } catch (err) {
        responseStatus = STATUS_ERROR
        responseType = RESPONSE_TYPE_JSON
        const e = err as any
        responseData = encoder.encode(JSON.stringify({
          error: e.message,
          code: e.code,
          errno: e.errno,
          syscall: e.syscall,
          path: e.path
        }))
        log(method, args, 'END', performance.now() - startTime, (err as Error).message)
      }

      // Write response: type byte at offset 8, data at offset 9
      const typeView = new Uint8Array(syncSAB, SYNC_TYPE_OFFSET, 1)
      typeView[0] = responseType
      lengthView.setUint32(0, responseData.length)

      new Uint8Array(syncSAB, SYNC_DATA_OFFSET, responseData.length).set(responseData)
      Atomics.store(statusArray, 0, responseStatus)
      Atomics.notify(statusArray, 0)

      // Wait briefly for main thread to reset to IDLE, then reset ourselves if needed
      const resetResult = Atomics.wait(statusArray, 0, responseStatus, 10)
      if (resetResult === 'timed-out') {
        Atomics.store(statusArray, 0, STATUS_IDLE)
      }

      // Continue loop immediately - no yielding for sequential sync operations
    }
  }

  // Helper to write response for async methods
  const writeResponse = (result: unknown) => {
    let responseType = RESPONSE_TYPE_JSON
    let responseData: Uint8Array

    if (Buffer.isBuffer(result)) {
      responseType = RESPONSE_TYPE_BINARY
      responseData = new Uint8Array(result)
    } else if (result instanceof Uint8Array) {
      responseType = RESPONSE_TYPE_BINARY
      responseData = result
    } else {
      responseType = RESPONSE_TYPE_JSON
      responseData = encoder.encode(JSON.stringify({ result }))
    }

    const typeView = new Uint8Array(syncSAB, SYNC_TYPE_OFFSET, 1)
    typeView[0] = responseType
    lengthView.setUint32(0, responseData.length)
    new Uint8Array(syncSAB, SYNC_DATA_OFFSET, responseData.length).set(responseData)
    Atomics.store(statusArray, 0, STATUS_RESPONSE)
    Atomics.notify(statusArray, 0)
  }

  // Helper to write error for async methods
  const writeError = (error: string) => {
    const typeView = new Uint8Array(syncSAB, SYNC_TYPE_OFFSET, 1)
    typeView[0] = RESPONSE_TYPE_JSON
    const responseData = encoder.encode(JSON.stringify({ error }))
    lengthView.setUint32(0, responseData.length)
    new Uint8Array(syncSAB, SYNC_DATA_OFFSET, responseData.length).set(responseData)
    Atomics.store(statusArray, 0, STATUS_ERROR)
    Atomics.notify(statusArray, 0)
  }

  processLoop()
}
