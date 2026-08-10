/**
 * The filesystem, hosted in a worker — which on Safari is the difference between working and not.
 *
 * A synchronous call has to block until the relay answers. `Atomics.wait` is illegal on a page's
 * main thread, so a page-hosted instance busy-spins instead; on Chromium the relay progresses
 * anyway and the reply lands in milliseconds, but on WebKit the spinning page starves the
 * worker's continuations, the reply never arrives, and the call sits there until the 30-second
 * stall guard trips. Measured on this very demo before the rewrite: roughly half of all Safari
 * loads took 30.2s to boot, the other half ~200ms.
 *
 * Off WebKit the page hosts the filesystem itself and this worker is never started — see
 * index.html. The operations are identical either way; they live in ops.js.
 */

import { VFSFileSystem } from './vendor/index.js';
import { createOps } from './ops.js';

let fs = null;
let ops = null;

const post = (msg, transfer) => self.postMessage(msg, transfer ?? []);

self.onmessage = async (event) => {
  const msg = event.data;

  // The page hands over a port standing in for `navigator.serviceWorker`, which worker scopes on
  // Safari and Firefox cannot reach. Without it there is no cross-tab coordination.
  if (msg.type === 'init') {
    try {
      fs = new VFSFileSystem({ root: '/demo', swBridge: msg.swBridge });
      await fs.init();
      ops = createOps(fs);

      post({ type: 'role', isLeader: fs.isLeader });
      fs.onLeaderChange((isLeader) => post({ type: 'role', isLeader }));

      try {
        fs.watch('/', { recursive: true }, (eventType, filename) => {
          post({ type: 'watch', eventType, filename: filename ? String(filename) : null });
        });
        post({ type: 'watching', ok: true });
      } catch (err) {
        post({ type: 'watching', ok: false, error: err.message });
      }

      post({ type: 'ready', isLeader: fs.isLeader });
    } catch (err) {
      post({ type: 'ready', error: err.message });
    }
    return;
  }

  // A clean shutdown, so the next instance can have the volume.
  //
  // This used to be a bare `worker.terminate()` from the page, which skips `dispose()` entirely:
  // the leader lock stayed held, the service-worker broker kept routing to a dead port, and the
  // volume's exclusive handle was never released. Swapping host left every tab unable to operate
  // until a manual reload.
  if (msg.type === 'dispose') {
    try { await fs?.dispose(); } catch { /* going away regardless */ }
    post({ type: 'disposed' });
    return;
  }

  const { id, op, arg } = msg;
  try {
    post({ id, ok: true, value: await ops[op](arg) });
  } catch (err) {
    post({ id, ok: false, error: err.message, code: err.code });
  }
};
