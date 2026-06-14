// Worker-hosted follower VFS instance — proves Safari follower sync works when
// the sync call runs in a worker (Atomics.wait, main thread free).
import { VFSFileSystem } from '/index.js';

let fs;
self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    fs = new VFSFileSystem({ root: msg.root, swBridge: msg.swBridge });
    try {
      await fs.init();
      self.postMessage({ type: 'inited', ready: fs.ready });
    } catch (err) {
      self.postMessage({ type: 'inited', error: err.message });
    }
    return;
  }
  if (msg.type === 'sync-read') {
    try {
      const t0 = performance.now();
      const data = fs.readFileSync(msg.path); // SYNC in a worker -> Atomics.wait
      self.postMessage({ type: 'read-result', text: new TextDecoder().decode(data), ms: Math.round(performance.now() - t0) });
    } catch (err) {
      self.postMessage({ type: 'read-result', error: err.code || err.message });
    }
    return;
  }
  if (msg.type === 'sync-write') {
    try {
      fs.writeFileSync(msg.path, new TextEncoder().encode(msg.text));
      self.postMessage({ type: 'write-result', ok: true });
    } catch (err) {
      self.postMessage({ type: 'write-result', error: err.code || err.message });
    }
    return;
  }
  if (msg.type === 'list') {
    // Synchronous readdir + read of every file — exercises the relay each tick.
    try {
      const names = fs.readdirSync('/');
      const files = names.map((n) => {
        try { return { name: n, text: new TextDecoder().decode(fs.readFileSync('/' + n)) }; }
        catch { return { name: n, text: '<dir/err>' }; }
      });
      self.postMessage({ type: 'list-result', files });
    } catch (err) {
      self.postMessage({ type: 'list-result', error: err.code || err.message });
    }
    return;
  }
};
