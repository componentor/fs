// src/workers/service.worker.ts
var sw = self;
var serverPort = null;
var pending = [];
sw.addEventListener("install", () => {
  sw.skipWaiting();
});
sw.addEventListener("activate", () => {
});
sw.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "register-server") {
    serverPort = event.ports[0];
    if (!serverPort) return;
    while (pending.length > 0) {
      const entry = pending.shift();
      serverPort.postMessage(
        { type: "client-port", tabId: entry.tabId },
        [entry.port]
      );
    }
    return;
  }
  if (msg.type === "transfer-port") {
    const port = event.ports[0];
    if (!port) return;
    if (serverPort) {
      serverPort.postMessage(
        { type: "client-port", tabId: msg.tabId },
        [port]
      );
    } else {
      pending.push({ tabId: msg.tabId, port });
    }
    return;
  }
});
//# sourceMappingURL=service.worker.js.map