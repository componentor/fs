// Relay Worker for secondary tabs
// Receives sync requests from main thread via SAB, forwards to primary tab via MessagePort
// Returns results back to main thread via SAB

// Import SAB constants from shared utilities (aliased for local naming convention)
import {
  SYNC_STATUS_OFFSET as STATUS_OFFSET,
  SYNC_LENGTH_OFFSET as LENGTH_OFFSET,
  SYNC_TYPE_OFFSET as TYPE_OFFSET,
  SYNC_DATA_OFFSET as DATA_OFFSET,
  STATUS_IDLE,
  STATUS_REQUEST,
  STATUS_RESPONSE,
  STATUS_ERROR,
  REQUEST_TYPE_JSON,
  REQUEST_TYPE_BINARY_ARG,
  RESPONSE_TYPE_JSON,
  RESPONSE_TYPE_BINARY,
  extractTransferables,
} from './fs.sab-utils'

let syncSAB: SharedArrayBuffer | null = null
let tabId: string | null = null
let primaryPort: MessagePort | null = null
let pendingResolve: ((value: unknown) => void) | null = null
let pendingReject: ((error: Error) => void) | null = null
let pendingRequestId: string | null = null

// Handle messages from main thread
self.onmessage = (event) => {
  const { type } = event.data

  if (type === 'init') {
    syncSAB = event.data.syncSAB
    tabId = event.data.tabId
    console.log(`[RelayWorker] Initialized with SAB, tabId: ${tabId}`)
    self.postMessage({ type: 'initialized' })
    return
  }

  if (type === 'set-primary-port') {
    primaryPort = event.ports[0]
    if (primaryPort) {
      primaryPort.onmessage = handlePrimaryMessage
      console.log('[RelayWorker] Primary port set, starting to listen for requests')
      // Start listening for requests from main thread
      startListening()
    }
    return
  }

  if (type === 'primary-disconnected') {
    handlePrimaryDisconnect()
    return
  }
}

function handlePrimaryMessage(event: MessageEvent) {
  const { type, requestId, result, error, code, errno, syscall, path } = event.data

  if (type === 'fs-response') {
    if (requestId === pendingRequestId) {
      console.log(`[RelayWorker] Received response for request ${requestId}`)
      if (error) {
        const err = new Error(error) as any
        err.code = code
        err.errno = errno
        err.syscall = syscall
        err.path = path
        pendingReject?.(err)
      } else {
        pendingResolve?.(result)
      }
      pendingResolve = null
      pendingReject = null
      pendingRequestId = null
    }
  }
}

function startListening() {
  if (!syncSAB) return

  const statusArray = new Int32Array(syncSAB, STATUS_OFFSET, 1)

  const processLoop = async () => {
    // Wait for a request with timeout so we can process MessagePort messages
    const result = Atomics.wait(statusArray, 0, STATUS_IDLE, 100)

    if (result === 'not-equal') {
      const status = Atomics.load(statusArray, 0)
      if (status === STATUS_REQUEST) {
        await handleRequest()
      }
    } else if (result === 'ok') {
      const status = Atomics.load(statusArray, 0)
      if (status === STATUS_REQUEST) {
        await handleRequest()
      }
    }

    // Yield to event loop for MessagePort messages, then continue
    setTimeout(processLoop, 0)
  }

  processLoop()
}

async function handleRequest() {
  if (!syncSAB) return

  const lengthView = new DataView(syncSAB, LENGTH_OFFSET, 4)
  const decoder = new TextDecoder()
  const statusArray = new Int32Array(syncSAB, STATUS_OFFSET, 1)

  // Read request: type byte at offset 8, payload at offset 9
  const requestType = new Uint8Array(syncSAB, TYPE_OFFSET, 1)[0]
  const payloadLength = lengthView.getUint32(0)

  let request: { method: string; args: unknown[] }

  if (requestType === REQUEST_TYPE_BINARY_ARG) {
    // Binary arg request: [jsonLen:4][bufIdx:1][json:jsonLen][buffer:rest]
    const headerView = new DataView(syncSAB, DATA_OFFSET, 5)
    const jsonLen = headerView.getUint32(0)
    const bufferArgIndex = headerView.getUint8(4)

    const jsonView = new Uint8Array(syncSAB, DATA_OFFSET + 5, jsonLen)
    const jsonData = new Uint8Array(jsonView)
    const parsed = JSON.parse(decoder.decode(jsonData))

    // Extract raw buffer bytes and set as Uint8Array arg
    const bufferStart = DATA_OFFSET + 5 + jsonLen
    const bufferLen = payloadLength - 5 - jsonLen
    const bufferView = new Uint8Array(syncSAB, bufferStart, bufferLen)
    parsed.args[bufferArgIndex] = new Uint8Array(bufferView) // copy from SAB
    request = parsed
  } else {
    // Pure JSON request
    const requestDataView = new Uint8Array(syncSAB, DATA_OFFSET, payloadLength)
    const requestData = new Uint8Array(requestDataView)
    request = JSON.parse(decoder.decode(requestData))
  }

  console.log(`[RelayWorker] Handling request: ${request.method}`)

  if (!primaryPort) {
    writeError(new Error('Primary port not connected'))
    return
  }

  try {
    // Forward to primary and wait for response
    const result = await forwardToPrimary(request)
    writeResponse(result)
  } catch (err) {
    writeError(err as Error)
  }
}

function forwardToPrimary(request: { method: string; args: unknown[] }): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!primaryPort) {
      reject(new Error('Primary port not connected'))
      return
    }

    const requestId = Math.random().toString(36).substr(2, 9)
    pendingResolve = resolve
    pendingReject = reject
    pendingRequestId = requestId

    // Timeout after 30 seconds
    const timeout = setTimeout(() => {
      if (pendingRequestId === requestId) {
        pendingResolve = null
        pendingReject = null
        pendingRequestId = null
        reject(new Error('Request timeout - primary tab may be unresponsive'))
      }
    }, 30000)

    // Modify resolve/reject to clear timeout
    const originalResolve = resolve
    const originalReject = reject
    pendingResolve = (value) => {
      clearTimeout(timeout)
      originalResolve(value)
    }
    pendingReject = (err) => {
      clearTimeout(timeout)
      originalReject(err)
    }

    // Send request via MessagePort with transferables for zero-copy
    const message = {
      type: 'fs-request',
      requestId,
      method: request.method,
      args: request.args
    }
    const transferables = extractTransferables(request.args)
    if (transferables.length > 0) {
      primaryPort.postMessage(message, transferables)
    } else {
      primaryPort.postMessage(message)
    }
  })
}

function handlePrimaryDisconnect() {
  console.log('[RelayWorker] Primary disconnected')
  primaryPort = null

  // If we have a pending request, reject it
  if (pendingReject) {
    pendingReject(new Error('Primary tab disconnected'))
    pendingResolve = null
    pendingReject = null
    pendingRequestId = null
  }

  // Notify main thread
  self.postMessage({ type: 'primary-disconnected' })
}

function writeResponse(result: unknown) {
  if (!syncSAB) return

  const statusArray = new Int32Array(syncSAB, STATUS_OFFSET, 1)
  const lengthView = new DataView(syncSAB, LENGTH_OFFSET, 4)
  const typeView = new Uint8Array(syncSAB, TYPE_OFFSET, 1)

  // Check if result is binary (Buffer or Uint8Array)
  if (result instanceof Uint8Array || (result && typeof result === 'object' && 'type' in result && (result as any).type === 'Buffer')) {
    // Binary response - convert Buffer-like objects to Uint8Array
    let binaryData: Uint8Array
    if (result instanceof Uint8Array) {
      binaryData = result
    } else {
      // Buffer from JSON: { type: 'Buffer', data: [...] }
      binaryData = new Uint8Array((result as any).data)
    }

    typeView[0] = RESPONSE_TYPE_BINARY
    lengthView.setUint32(0, binaryData.length)
    new Uint8Array(syncSAB, DATA_OFFSET, binaryData.length).set(binaryData)
  } else {
    // JSON response
    const encoder = new TextEncoder()
    const responseData = encoder.encode(JSON.stringify({ result }))
    typeView[0] = RESPONSE_TYPE_JSON
    lengthView.setUint32(0, responseData.length)
    new Uint8Array(syncSAB, DATA_OFFSET, responseData.length).set(responseData)
  }

  Atomics.store(statusArray, 0, STATUS_RESPONSE)
  Atomics.notify(statusArray, 0)
}

function writeError(err: Error) {
  if (!syncSAB) return

  const encoder = new TextEncoder()
  const statusArray = new Int32Array(syncSAB, STATUS_OFFSET, 1)
  const lengthView = new DataView(syncSAB, LENGTH_OFFSET, 4)
  const typeView = new Uint8Array(syncSAB, TYPE_OFFSET, 1)

  const e = err as any
  typeView[0] = RESPONSE_TYPE_JSON
  const responseData = encoder.encode(JSON.stringify({
    error: e.message,
    code: e.code,
    errno: e.errno,
    syscall: e.syscall,
    path: e.path
  }))
  lengthView.setUint32(0, responseData.length)
  new Uint8Array(syncSAB, DATA_OFFSET, responseData.length).set(responseData)

  Atomics.store(statusArray, 0, STATUS_ERROR)
  Atomics.notify(statusArray, 0)
}

// Make this a module to avoid global scope conflicts
export {}
