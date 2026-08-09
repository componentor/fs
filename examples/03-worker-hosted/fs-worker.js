/**
 * The filesystem instance, hosted inside a worker.
 *
 * This is the arrangement to copy if you need the **synchronous** API to work in more than one
 * tab at once. In a follower tab a sync call blocks until the leader answers; on the main thread
 * that deadlocks on Safari, because WebKit delivers a worker's messages on the page's main
 * thread — the very thread that is spinning. Inside a worker the wait is a genuine
 * `Atomics.wait`, the main thread stays free, and every tab gets the sync API.
 *
 * Single-tab apps do not need any of this: `new VFSFileSystem()` on the main thread is enough.
 */

import { VFSFileSystem } from '/vendor/index.js';

let fs;

self.onmessage = async (e) => {
  // The main thread hands over a port that stands in for `navigator.serviceWorker`, which is
  // not reachable from worker scope on Safari/Firefox.
  if (e.data.swBridge) {
    fs = new VFSFileSystem({ root: '/worker-demo', swBridge: e.data.swBridge });
    await fs.init();

    if (!fs.existsSync('/shared.log')) fs.writeFileSync('/shared.log', '');
    self.postMessage({ ready: true });
    self.postMessage({ log: read() });
    return;
  }

  if (e.data.write) {
    // A plain synchronous append — the whole point of the arrangement above.
    fs.appendFileSync('/shared.log', `${new Date().toISOString()} from tab ${tabId}\n`);
    self.postMessage({ log: read() });
  }
};

const tabId = Math.random().toString(36).slice(2, 7);

function read() {
  const body = fs.readFileSync('/shared.log', 'utf8');
  const count = body.trim() === '' ? 0 : body.trim().split('\n').length;
  return `/shared.log — ${count} line(s):\n${body}`;
}
