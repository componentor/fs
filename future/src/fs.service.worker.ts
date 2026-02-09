// ServiceWorker "Port Shuttle" + VFS Module Server
// Version: 2024-02-02-v2 (force update)
// MessagePorts CAN be transferred to/from ServiceWorkers (unlike SABs)
// Primary tab handles all FS operations, secondaries forward requests via MessageChannel
// Tab disconnect detection is handled by Web Locks (not ServiceWorker)
//
// ESM Module Server: Serves modules from VFS via fetch interception
// - rollup/* -> @rolldown/browser shim
// - esbuild -> @rolldown/browser shim

import { handleModuleFetch, isModuleRequest, invalidateIndexCache, handleFileReadResponse, setPrimaryClientIdGetter, storeBundledConfigInSW, storeWorkerModuleInSW } from './fs.module-server'

// Type the ServiceWorker global scope
const sw = self as unknown as ServiceWorkerGlobalScope

// Store pending ports from secondary tabs waiting to connect to primary
const pendingPorts: Array<{ clientId: string; port: MessagePort }> = []
let primaryClientId: string | null = null
// Control port from primary — used to forward secondary ports (scope-independent)
let primaryPort: MessagePort | null = null

// Provide primary client ID to module server
setPrimaryClientIdGetter(() => primaryClientId)

console.log('[ServiceWorker] Starting (Port Shuttle mode)...')

// Take control of all clients immediately
sw.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activating...')
  ;(event as ExtendableEvent).waitUntil(sw.clients.claim())
})

// Skip waiting to activate immediately
sw.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Installing...')
  ;(event as ExtendableEvent).waitUntil(sw.skipWaiting())
})

// Fetch interception for VFS module serving
// Intercepts /vfs-module/* requests and serves them from VFS
sw.addEventListener('fetch', (event) => {
  const fetchEvent = event as FetchEvent

  // Only intercept module requests
  if (!isModuleRequest(fetchEvent.request)) {
    return // Let the browser handle it normally
  }

  console.log('[ServiceWorker] Intercepting module request:', fetchEvent.request.url)

  fetchEvent.respondWith(
    (async () => {
      try {
        const response = await handleModuleFetch(fetchEvent.request)
        if (response) {
          return response
        }
        // Fallback to network if not found in VFS
        return fetch(fetchEvent.request)
      } catch (err) {
        console.error('[ServiceWorker] Module fetch error:', err)
        return new Response(`// Module fetch error: ${(err as Error).message}`, {
          status: 500,
          headers: {
            'Content-Type': 'application/javascript',
            'Cross-Origin-Resource-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
          }
        })
      }
    })()
  )
})

async function sendToClient(clientId: string, message: object, transfer?: Transferable[]) {
  try {
    const client = await sw.clients.get(clientId)
    if (client) {
      if (transfer && transfer.length > 0) {
        client.postMessage(message, transfer)
      } else {
        client.postMessage(message)
      }
      return true
    }
  } catch (err) {
    console.error(`[ServiceWorker] Failed to send to client ${clientId}:`, err)
  }
  return false
}

sw.addEventListener('message', async (event) => {
  const { type } = event.data
  const clientId = (event.source as Client | null)?.id

  if (!clientId) {
    console.error('[ServiceWorker] Message received without client ID')
    return
  }

  console.log(`[ServiceWorker] Message from ${clientId}: ${type}`)

  // Primary tab registering
  if (type === 'register-primary') {
    console.log(`[ServiceWorker] Primary registered: ${clientId}`)
    primaryClientId = clientId

    // If a control port is provided, use it for forwarding (avoids scope issues)
    if (event.ports[0]) {
      primaryPort = event.ports[0]
    }

    // Send all pending ports to primary
    console.log(`[ServiceWorker] Sending ${pendingPorts.length} pending ports to primary`)
    for (const { clientId: secondaryId, port } of pendingPorts) {
      console.log(`[ServiceWorker] Forwarding port from ${secondaryId} to primary`)
      if (primaryPort) {
        primaryPort.postMessage({ type: 'secondary-port', secondaryClientId: secondaryId }, [port])
      } else {
        await sendToClient(clientId, { type: 'secondary-port', secondaryClientId: secondaryId }, [port])
      }
    }
    pendingPorts.length = 0 // Clear pending ports
    return
  }

  // Secondary tab requesting connection to primary - sends a port for direct communication
  if (type === 'request-connection') {
    const port = event.ports[0]
    if (!port) {
      console.error(`[ServiceWorker] request-connection from ${clientId} has no port!`)
      return
    }

    console.log(`[ServiceWorker] Secondary ${clientId} requesting connection with port`)

    if (primaryPort) {
      // Forward via control port (scope-independent)
      console.log(`[ServiceWorker] Forwarding port to primary via control port`)
      primaryPort.postMessage({ type: 'secondary-port', secondaryClientId: clientId }, [port])
    } else if (primaryClientId) {
      // Fallback: forward via clients API (requires page in scope)
      console.log(`[ServiceWorker] Forwarding port to primary ${primaryClientId}`)
      const sent = await sendToClient(primaryClientId, {
        type: 'secondary-port',
        secondaryClientId: clientId
      }, [port])

      if (!sent) {
        console.log(`[ServiceWorker] Primary not available, queuing port`)
        primaryClientId = null
        pendingPorts.push({ clientId, port })
      }
    } else {
      // No primary yet - queue the port and broadcast discovery request
      console.log(`[ServiceWorker] No primary yet, queuing port from ${clientId}`)
      pendingPorts.push({ clientId, port })

      // Ask all clients: "who's the primary?" — handles SW restart/update losing primaryClientId
      try {
        const allClients = await sw.clients.matchAll({ type: 'window' })
        console.log(`[ServiceWorker] Broadcasting discover-primary to ${allClients.length} clients`)
        for (const client of allClients) {
          if (client.id !== clientId) {
            client.postMessage({ type: 'discover-primary' })
          }
        }
      } catch (err) {
        console.error('[ServiceWorker] Failed to broadcast discover-primary:', err)
      }
    }
    return
  }

  // Client disconnecting (explicit notification)
  if (type === 'disconnect') {
    console.log(`[ServiceWorker] Client ${clientId} disconnecting`)
    if (clientId === primaryClientId) {
      primaryClientId = null
      primaryPort = null
    }
    // Remove any pending ports for this client
    const idx = pendingPorts.findIndex(p => p.clientId === clientId)
    if (idx !== -1) {
      pendingPorts.splice(idx, 1)
    }
    return
  }

  // VFS changed notification - invalidate module cache
  if (type === 'vfs-changed') {
    console.log('[ServiceWorker] VFS changed, invalidating module cache')
    invalidateIndexCache()
    return
  }

  // File read response from client (for module serving)
  if (type === 'vfs-read-response') {
    const { requestId, content, error } = event.data
    // Convert array back to Uint8Array if needed
    const contentArray = content ? new Uint8Array(content) : null
    handleFileReadResponse(requestId, contentArray, error)
    return
  }

  // Store bundled config code (from esbuild.build)
  if (type === 'store-bundled-config') {
    const { pattern, code } = event.data
    console.log(`[ServiceWorker] Storing bundled config for pattern "${pattern}" (${code?.length || 0} bytes)`)
    storeBundledConfigInSW(pattern, code)
    return
  }

  // Store worker module code (pre-registered by exec worker for rayon sub-workers)
  if (type === 'store-worker-module') {
    const { filePath, code } = event.data
    console.log(`[ServiceWorker] Storing worker module: ${filePath} (${code?.length || 0} bytes)`)
    storeWorkerModuleInSW(filePath, code)
    return
  }
})

// Periodically clean up stale state (primary gone, pending ports for closed tabs)
// Note: This does NOT notify about disconnects - Web Locks handles that instantly
setInterval(async () => {
  const allClients = await sw.clients.matchAll()
  const activeClientIds = new Set(allClients.map((c: Client) => c.id))

  // Check if primary is still alive
  if (primaryClientId && !activeClientIds.has(primaryClientId)) {
    console.log(`[ServiceWorker] Primary ${primaryClientId} no longer exists, clearing`)
    primaryClientId = null
  }

  // Remove pending ports for disconnected clients
  for (let i = pendingPorts.length - 1; i >= 0; i--) {
    if (!activeClientIds.has(pendingPorts[i].clientId)) {
      console.log(`[ServiceWorker] Removing pending port for disconnected ${pendingPorts[i].clientId}`)
      pendingPorts.splice(i, 1)
    }
  }
}, 5000)  // Less frequent - just for cleanup, not detection
