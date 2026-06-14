/**
 * Main-thread service-worker bridge for worker-hosted VFS instances.
 *
 * `navigator.serviceWorker` is not exposed in worker scopes on Safari and
 * Firefox, so a VFS instance running inside a worker cannot register or
 * message the multi-tab broker service worker itself. This helper runs on the
 * main thread, owns the real `navigator.serviceWorker`, and forwards the
 * worker instance's broker messages (including transferred MessagePorts) to it.
 *
 * Only OUTBOUND messages (worker → SW) need forwarding: the SW's replies to a
 * leader's control port, and a follower's leader-port traffic, all flow
 * directly through the MessageChannel ports that were transferred along with
 * those outbound messages — they never pass back through this bridge.
 *
 * Usage:
 *   // main thread
 *   const channel = new MessageChannel();
 *   createServiceWorkerBridge(channel.port1, { ns: 'app' });
 *   worker.postMessage({ swBridge: channel.port2 }, [channel.port2]);
 *
 *   // worker
 *   const fs = new VFSFileSystem({ root: '/app', swBridge: receivedPort });
 */

export interface ServiceWorkerBridgeOptions {
  /** Namespace — must match the VFS instance's namespace (derived from root). */
  ns: string;
  /** Service worker script URL. Defaults to the bundled broker resolved
   *  relative to this module. Override when bundled elsewhere. */
  swUrl?: string;
  /** Registration scope. Defaults to `./${ns}/` relative to the SW URL. */
  swScope?: string;
}

/**
 * Begin bridging a worker-hosted VFS instance's service-worker broker
 * messages to the real service worker on this (main) thread.
 *
 * Returns a function that tears the bridge down.
 */
export function createServiceWorkerBridge(
  bridgePort: MessagePort,
  opts: ServiceWorkerBridgeOptions,
): () => void {
  let regPromise: Promise<{ postMessage(message: unknown, transfer?: Transferable[]): void }> | null = null;

  const resolveSW = (): Promise<{ postMessage(message: unknown, transfer?: Transferable[]): void }> => {
    if (regPromise) return regPromise;
    regPromise = (async () => {
      const swUrl = opts.swUrl
        ? new URL(opts.swUrl, location.origin)
        : new URL('./workers/service.worker.js', import.meta.url);
      const scope = opts.swScope ?? new URL(`./${opts.ns}/`, swUrl).href;
      const reg = await navigator.serviceWorker.register(swUrl.href, { scope });
      if (reg.active) return reg.active;
      const sw = reg.installing || reg.waiting;
      if (!sw) throw new Error('No service worker found');
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          sw.removeEventListener('statechange', onState);
          reject(new Error('Service worker activation timeout'));
        }, 5000);
        const onState = (): void => {
          if (sw.state === 'activated') {
            clearTimeout(timer);
            sw.removeEventListener('statechange', onState);
            resolve();
          } else if (sw.state === 'redundant') {
            clearTimeout(timer);
            sw.removeEventListener('statechange', onState);
            reject(new Error('SW redundant'));
          }
        };
        sw.addEventListener('statechange', onState);
        onState();
      });
      return reg.active!;
    })();
    return regPromise;
  };

  const onMessage = (event: MessageEvent): void => {
    // Forward the worker instance's broker message to the real SW, carrying
    // over any transferred ports (the transfer-port / register-server ports).
    const transfer = event.ports.length ? Array.from(event.ports) : undefined;
    resolveSW()
      .then(sw => sw.postMessage(event.data, transfer as Transferable[] | undefined))
      .catch(err => console.error('[VFS sw-bridge] forward failed:', (err as Error).message));
  };

  bridgePort.addEventListener('message', onMessage);
  bridgePort.start();

  return () => {
    bridgePort.removeEventListener('message', onMessage);
    bridgePort.close();
  };
}
