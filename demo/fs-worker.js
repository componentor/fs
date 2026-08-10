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
 * In here the wait is a real `Atomics.wait`, the page's main thread stays free, and the sync API
 * behaves the same on every engine. The page drives it over the small RPC below, and the
 * benchmark runs in here too — so it measures the sync path at full speed rather than a
 * main-thread spin.
 */

import { VFSFileSystem } from './vendor/index.js';

let fs = null;

const post = (msg, transfer) => self.postMessage(msg, transfer ?? []);
const join = (dir, name) => (dir === '/' ? '' : dir) + '/' + name;

/** Every operation the page can ask for. Each returns a structured-cloneable value. */
const ops = {
  list(path) {
    // `statSync` with no await, on the fast path — the thing the demo exists to show.
    return fs.readdirSync(path, { withFileTypes: true })
      .map((entry) => {
        const isDirectory = entry.isDirectory();
        return {
          name: entry.name,
          isDirectory,
          size: isDirectory ? null : fs.statSync(join(path, entry.name)).size,
        };
      })
      .sort((a, b) => (b.isDirectory - a.isDirectory) || a.name.localeCompare(b.name));
  },

  read(path) {
    const bytes = fs.readFileSync(path);
    return { size: bytes.length, head: new TextDecoder().decode(bytes.subarray(0, 2000)) };
  },

  remove(path) { fs.rmSync(path, { recursive: true, force: true }); },
  mkdir(path) { fs.mkdirSync(path, { recursive: true }); },

  write({ path, data, text }) {
    const parent = path.replace(/\/[^/]+$/, '') || '/';
    if (parent !== '/') fs.mkdirSync(parent, { recursive: true });
    fs.writeFileSync(path, data ? new Uint8Array(data) : text);
  },

  /** A batch import — one message for a whole dropped folder, rather than one per file. */
  importFiles(files) {
    for (const file of files) ops.write(file);
    return files.length;
  },

  seed(cwd) {
    fs.mkdirSync(join(cwd, 'src/components'), { recursive: true });
    fs.writeFileSync(join(cwd, 'src/index.js'), 'export * from "./components/button.js";\n');
    fs.writeFileSync(join(cwd, 'src/components/button.js'), 'export const Button = () => "click";\n');
    fs.writeFileSync(join(cwd, 'readme.md'), '# Sample tree\n\nCreated with mkdirSync + writeFileSync.\n');
  },

  wipe() { fs.rmSync('/', { recursive: true, force: true }); },

  ping() {
    const stamp = new Date().toLocaleTimeString();
    fs.writeFileSync('/tab-ping.txt', `written at ${stamp}\n`);
    return stamp;
  },

  /**
   * Timed in here on purpose: these are real `Atomics.wait` round trips, not a main-thread spin,
   * so the numbers are the sync path's actual cost on this machine and engine.
   */
  bench() {
    fs.mkdirSync('/.bench', { recursive: true });
    const body = 'x'.repeat(1024);
    const time = (label, n, fn) => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) fn(i);
      const per = (performance.now() - t0) / n;
      return { label, per, ops: Math.round(1000 / per) };
    };

    const rows = [];
    rows.push(time('writeFileSync 1KB (create)', 150, (n) => fs.writeFileSync(`/.bench/c${n}.txt`, body)));
    fs.writeFileSync('/.bench/fixed.txt', body);
    rows.push(time('writeFileSync 1KB (overwrite)', 200, () => fs.writeFileSync('/.bench/fixed.txt', body)));
    rows.push(time('readFileSync 1KB', 400, () => fs.readFileSync('/.bench/fixed.txt')));
    rows.push(time('statSync', 800, () => fs.statSync('/.bench/fixed.txt')));
    rows.push(time('existsSync', 800, () => fs.existsSync('/.bench/fixed.txt')));
    rows.push(time('readdirSync (150 entries)', 60, () => fs.readdirSync('/.bench')));
    let i = 0;
    rows.push(time('unlinkSync', 140, () => fs.unlinkSync(`/.bench/c${i++}.txt`)));

    fs.rmSync('/.bench', { recursive: true, force: true });
    return { rows, isLeader: fs.isLeader };
  },
};

self.onmessage = async (event) => {
  const msg = event.data;

  // The page hands over a port standing in for `navigator.serviceWorker`, which worker scopes on
  // Safari and Firefox cannot reach. Without it there is no cross-tab coordination.
  if (msg.type === 'init') {
    try {
      fs = new VFSFileSystem({ root: '/demo', swBridge: msg.swBridge });
      await fs.init();

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

  const { id, op, arg } = msg;
  try {
    post({ id, ok: true, value: await ops[op](arg) });
  } catch (err) {
    post({ id, ok: false, error: err.message, code: err.code });
  }
};
