/**
 * Benchmark worker — runs the shared benchmark-core inside a worker so the
 * benchmark works in multi-tab Safari (follower tabs). The VFS instance is
 * created with the `swBridge` port; the page owns the real service worker and
 * forwards broker messages via createServiceWorkerBridge.
 *
 * Protocol:
 *   main → worker: { type:'init', swBridge }            → { type:'inited' }
 *   main → worker: { type:'run', op, a, b, id,
 *                    flush, debug, opfsSync }            → { type:'result', id, result }
 *                                                          | { type:'error', id, message }
 *   worker → main: { type:'log', msg, level }            (streamed during runs)
 */
import { createBenchmark } from '/benchmark-core.js';

let bench = null;
let ctx = null;

self.onmessage = async (e) => {
  const m = e.data;

  if (m.type === 'init') {
    ctx = {
      swBridge: m.swBridge,
      flush: false,
      debug: false,
      opfsSync: false,
      log: (msg, level) => self.postMessage({ type: 'log', msg, level }),
    };
    bench = createBenchmark(ctx);
    self.postMessage({ type: 'inited' });
    return;
  }

  if (m.type === 'run') {
    // Apply the page's current checkbox state for this run.
    ctx.flush = m.flush;
    ctx.debug = m.debug;
    ctx.opfsSync = m.opfsSync;
    try {
      const result = await bench.run(m.op, m.a, m.b);
      self.postMessage({ type: 'result', id: m.id, result });
    } catch (err) {
      self.postMessage({ type: 'error', id: m.id, message: err.message });
    }
    return;
  }
};
