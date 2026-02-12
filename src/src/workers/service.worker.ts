/**
 * Service Worker — port transfer broker for multi-tab VFS.
 *
 * Transfers MessageChannel ports from follower tabs to the leader tab.
 * Uses MessagePorts for all communication (no clients.get() / scope dependency).
 *
 * Protocol:
 *   Leader:   { type: 'register-server' } + [controlPort]
 *   Follower: { type: 'transfer-port', tabId } + [dataPort]
 *   → Leader receives on controlPort: { type: 'client-port', tabId } + [dataPort]
 */

export {}; // Module boundary (avoids global scope conflicts)

const sw = self as unknown as ServiceWorkerGlobalScope;

// Leader's control port — used to forward follower ports to the leader
let serverPort: MessagePort | null = null;

// Ports received before the leader registered
const pending: Array<{ tabId: string; port: MessagePort }> = [];

sw.addEventListener('install', () => {
  sw.skipWaiting();
});

sw.addEventListener('activate', () => {
  // No clients.claim() — this SW is a port broker only, it does not need to
  // control any pages. Claiming clients could interfere with the host app's
  // own service worker.
});

sw.addEventListener('message', (event: ExtendableMessageEvent) => {
  const msg = event.data;

  if (msg.type === 'register-server') {
    // Leader sends a control port for receiving follower ports
    serverPort = event.ports[0];
    if (!serverPort) return;

    // Flush any ports that arrived before the leader registered
    while (pending.length > 0) {
      const entry = pending.shift()!;
      serverPort.postMessage(
        { type: 'client-port', tabId: entry.tabId },
        [entry.port as unknown as Transferable],
      );
    }
    return;
  }

  if (msg.type === 'transfer-port') {
    // Follower sends a port to be forwarded to the leader
    const port = event.ports[0];
    if (!port) return;

    if (serverPort) {
      serverPort.postMessage(
        { type: 'client-port', tabId: msg.tabId },
        [port as unknown as Transferable],
      );
    } else {
      // Leader not registered yet — queue for later
      pending.push({ tabId: msg.tabId, port });
    }
    return;
  }
});
