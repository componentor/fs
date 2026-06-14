/**
 * Worker-hosted follower: full multi-tab SYNC on every engine, including Safari.
 *
 * A follower's synchronous FS op busy-waits. On the MAIN thread that means a
 * spin-loop, and WebKit gates a worker's MessagePort delivery on the parent
 * main thread's event loop — so the leader's reply can never arrive and
 * follower sync fails with EIO (see multitab.spec.ts for that contract).
 *
 * Run the follower instance INSIDE a worker instead: the wait becomes a real
 * `Atomics.wait`, the main thread stays free to pump the relay worker's
 * delivery, and follower sync works on Safari too. `navigator.serviceWorker`
 * is unavailable in worker scopes on Safari/Firefox, so the multi-tab broker
 * is delegated to the main thread via `createServiceWorkerBridge`.
 *
 * Tab A: leader on its main thread. Tab B: follower hosted in a worker, main
 * thread runs the bridge. The worker reads the leader's file and writes its
 * own, all synchronously; the leader then sees the follower's write.
 */

import { test, expect } from './fixtures';

const ROOT = '/mt-worker-spec';
const NS = 'vfs-' + ROOT.replace(/[^a-zA-Z0-9]/g, '_');

test.describe('worker-hosted follower — multi-tab sync on all engines', () => {
  test.setTimeout(120_000);

  test('follower sync read/write from a worker, brokered via main thread', async ({ page }) => {
    // Tab A — leader
    await page.goto('/correctness.html');
    await page.evaluate(async (root) => {
      const opfsRoot = await navigator.storage.getDirectory();
      try { await opfsRoot.removeEntry(root.slice(1), { recursive: true }); } catch { /* fresh */ }
      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root });
      await fs.init();
      fs.writeFileSync('/leader-file.txt', new TextEncoder().encode('hello from leader'));
      (self as any).__fs = fs;
    }, ROOT);

    // Tab B — follower hosted in a worker (same context as the leader)
    const b = await page.context().newPage();
    await b.goto('/correctness.html');
    const r = await b.evaluate(async ({ root, ns }) => {
      const mod = await import('/index.js') as any;
      const worker = new Worker('/follower-worker.js', { type: 'module' });
      const ch = new MessageChannel();
      mod.createServiceWorkerBridge(ch.port1, { ns });

      const waitMsg = (pred: (d: any) => boolean, ms: number) => Promise.race([
        new Promise<any>(res => {
          const h = (e: MessageEvent) => { if (pred(e.data)) { worker.removeEventListener('message', h); res(e.data); } };
          worker.addEventListener('message', h);
        }),
        new Promise<any>(res => setTimeout(() => res({ timeout: true }), ms)),
      ]);

      const initted = waitMsg(d => d.type === 'inited', 20000);
      worker.postMessage({ type: 'init', root, swBridge: ch.port2 }, [ch.port2]);
      const init = await initted;
      if (init.timeout || init.error) return { init: 'FAIL:' + (init.error ?? 'timeout') };

      const rd = waitMsg(d => d.type === 'read-result', 20000);
      worker.postMessage({ type: 'sync-read', path: '/leader-file.txt' });
      const read = await rd;

      const wr = waitMsg(d => d.type === 'write-result', 20000);
      worker.postMessage({ type: 'sync-write', path: '/follower-file.txt', text: 'hello from follower worker' });
      const write = await wr;

      return { ready: init.ready, read, write };
    }, { root: ROOT, ns: NS });

    expect(r.init, 'follower worker init').toBeUndefined();
    expect(r.ready).toBe(true);
    expect(r.read?.text, 'follower sync read of leader file').toBe('hello from leader');
    expect(r.write?.ok, 'follower sync write').toBe(true);

    // Leader sees the follower's synchronous write
    const leaderSees = await page.evaluate(async () =>
      new TextDecoder().decode(await (self as any).__fs.promises.readFile('/follower-file.txt')));
    expect(leaderSees).toBe('hello from follower worker');

    await b.close();
  });
});
