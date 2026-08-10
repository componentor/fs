/**
 * Cross-origin isolation on a host that cannot set headers.
 *
 * The sync API needs `SharedArrayBuffer`, which needs `crossOriginIsolated`, which needs two
 * response headers. GitHub Pages — and most static hosts — will not send them. A service worker
 * can: it sits in front of every request from this scope and adds the headers to the response on
 * the way back, which the browser honours exactly as if the server had sent them.
 *
 * So the demo can show the *real* synchronous API on a host that has no header configuration at
 * all. The same trick works for any static deploy of your own app.
 *
 * Two caveats worth knowing before copying this into production:
 *   • the first load registers the worker and reloads once — unavoidable, since isolation is
 *     decided when the document is created, and the worker is not in control of that first
 *     response;
 *   • `require-corp` means every cross-origin subresource must opt in with CORP/CORS headers, so
 *     third-party images and scripts can break. That is a property of isolation itself, not of
 *     this workaround.
 */

if (typeof window === 'undefined') {
  // ---- service worker side ----
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

  self.addEventListener('fetch', (event) => {
    const request = event.request;
    // A range request's 206 must be passed through untouched, or media/streaming breaks.
    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 0) return response; // opaque; nothing to rewrite
          const headers = new Headers(response.headers);
          headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
          headers.set('Cross-Origin-Opener-Policy', 'same-origin');
          // Our own assets have to opt in to being embedded under require-corp.
          headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
        })
        .catch((err) => new Response(String(err), { status: 500 })),
    );
  });
} else {
  // ---- page side ----
  (() => {
    // Already isolated (a host that does send the headers, or our worker is live): nothing to do.
    if (window.crossOriginIsolated) return;
    if (!window.isSecureContext || !navigator.serviceWorker) return;

    navigator.serviceWorker.register(window.document.currentScript.src).then(
      (registration) => {
        // Reload once, and only once, so a registration failure cannot loop.
        registration.addEventListener('updatefound', () => window.location.reload());
        if (registration.active && !navigator.serviceWorker.controller) window.location.reload();
      },
      (err) => console.error('[coi] service worker registration failed:', err),
    );
  })();
}
