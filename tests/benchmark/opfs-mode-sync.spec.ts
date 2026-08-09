/**
 * The sync API under `mode: 'opfs'`.
 *
 * `opfs` mode is not only an explicit option — it is the **automatic fallback** when VFS
 * corruption is detected at init. So whatever works there is what a user gets on their worst day.
 *
 * Measured state (see CHANGELOG 3.3.15):
 *   Chromium — works.
 *   Firefox  — works, since `read` stopped going through `getFile()`/`arrayBuffer()`.
 *   WebKit   — still stalls, but now fails with a diagnosable error at 10s rather than killing
 *              the tab.
 *
 * The cause is the *caller's* thread, not the mode. Every operation here is async underneath
 * (`createSyncAccessHandle` and friends), and `Atomics.wait` is illegal on a page's main thread,
 * so a sync call there busy-spins instead of blocking. On Chromium the relay worker's event loop
 * progresses anyway; on Firefox and WebKit the spinning page starves its OPFS continuations, so
 * the response never arrives.
 *
 * That prediction is testable, and the third case below tests it: called from inside a Worker —
 * where `Atomics.wait` is legal and nothing spins — the sync API works on **all three engines**.
 * So the workarounds are: use `fs.promises.*`, or host the instance in a Worker.
 *
 * The main-thread case runs on Chromium so a regression there is caught, and is `fixme` on the
 * other two: known-failing work to be done, not a permanent exclusion, and marking it that way
 * keeps it visible in the report instead of silently absent.
 */

import { test, expect } from './fixtures';

test.describe('opfs mode: sync API', () => {
  test.setTimeout(60_000);

  test('sync reads and writes work in opfs mode', async ({ page, browserName }) => {
    test.fixme(
      browserName === 'webkit',
      'WebKit starves the relay worker while the page main thread spins; it now fails with a ' +
      'clear error at 10s instead of killing the tab. Workarounds: fs.promises.*, or host the ' +
      'instance in a Worker (both covered below).'
    );

    await page.goto('/correctness.html');
    const result = await page.evaluate(async () => {
      try {
        const r = await navigator.storage.getDirectory();
        await r.removeEntry('ct-opfs-sync', { recursive: true });
      } catch { /* fresh */ }
      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: '/ct-opfs-sync', mode: 'opfs' });
      await fs.init();

      fs.writeFileSync('/f.txt', 'sync-in-opfs-mode');
      const read = fs.readFileSync('/f.txt', 'utf8');
      fs.mkdirSync('/d');
      const listed = [...fs.readdirSync('/')].sort();
      return { read, listed };
    });

    expect(result.read).toBe('sync-in-opfs-mode');
    expect(result.listed).toContain('f.txt');
    expect(result.listed).toContain('d');
  });

  test('the async API works in opfs mode on every engine', async ({ page }) => {
    // The documented workaround for the above, and the path the fallback should be using.
    await page.goto('/correctness.html');
    const result = await page.evaluate(async () => {
      try {
        const r = await navigator.storage.getDirectory();
        await r.removeEntry('ct-opfs-async', { recursive: true });
      } catch { /* fresh */ }
      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: '/ct-opfs-async', mode: 'opfs' });
      await fs.init();

      await fs.promises.writeFile('/f.txt', 'async-in-opfs-mode');
      const read = await fs.promises.readFile('/f.txt', 'utf8');
      await fs.promises.mkdir('/d');
      const listed = [...(await fs.promises.readdir('/'))].sort();
      const st = await fs.promises.statfs('/');
      return { read, listed, bsize: st.bsize };
    });

    expect(result.read).toBe('async-in-opfs-mode');
    expect(result.listed).toContain('f.txt');
    expect(result.listed).toContain('d');
    expect(result.bsize).toBe(4096);
  });

  test('a stalled main-thread sync call fails with a diagnosable error, not a dead tab',
    async ({ page, browserName }) => {
      // Only WebKit still stalls. Chromium and Firefox service these fine, so there is nothing
      // to bound there — and if that ever changes, their own sync test above fails first.
      test.skip(browserName !== 'webkit', 'Only WebKit stalls here; nothing to bound elsewhere.');

      // The failure mode this bounds: the worker stays alive (its heartbeat keeps firing) but
      // never answers, so the heartbeat check cannot catch it and the page spins until the
      // browser kills the tab. A bounded spin turns that into an error naming the workarounds.
      await page.goto('/correctness.html');
      const outcome = await page.evaluate(async () => {
        try {
          const r = await navigator.storage.getDirectory();
          await r.removeEntry('ct-opfs-stall', { recursive: true });
        } catch { /* fresh */ }
        const mod = await import('/index.js') as any;
        const fs = new mod.VFSFileSystem({ root: '/ct-opfs-stall', mode: 'opfs' });
        await fs.init();
        try {
          fs.writeFileSync('/f.txt', 'x');
          return { threw: false, message: '' };
        } catch (e: any) {
          return { threw: true, message: String(e?.message ?? e) };
        }
      });

      expect(outcome.threw, 'the call should fail rather than hang the tab').toBe(true);
      expect(outcome.message).toContain('opfs mode');
      expect(outcome.message).toContain('fs.promises');
      expect(outcome.message).toContain('Worker');
    });

  test('sync works on every engine when the caller is a Worker', async ({ page }) => {
    // Atomics.wait is legal in a worker, so the caller blocks properly instead of spinning —
    // and the relay's async OPFS work completes. This is the same code path that hangs when
    // called from the page main thread on Firefox and WebKit.
    await page.goto('/correctness.html');
    const result = await page.evaluate(async () => {
      try {
        const r = await navigator.storage.getDirectory();
        await r.removeEntry('ct-opfs-worker', { recursive: true });
      } catch { /* fresh */ }

      const src = `
        import('${location.origin}/index.js').then(async (mod) => {
          try {
            const fs = new mod.VFSFileSystem({ root: '/ct-opfs-worker', mode: 'opfs' });
            await fs.init();
            fs.writeFileSync('/w.txt', 'from-worker');
            fs.mkdirSync('/wd');
            self.postMessage({ ok: true, read: fs.readFileSync('/w.txt', 'utf8'), listed: [...fs.readdirSync('/')].sort() });
          } catch (e) { self.postMessage({ ok: false, err: String((e && e.message) || e) }); }
        }).catch((e) => self.postMessage({ ok: false, err: 'import: ' + String(e.message || e) }));
      `;
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const w = new Worker(url, { type: 'module' });
      const out = await new Promise<any>((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false, err: 'worker timed out' }), 25_000);
        w.onmessage = (e) => { clearTimeout(timer); resolve(e.data); };
        w.onerror = (e) => { clearTimeout(timer); resolve({ ok: false, err: 'worker error: ' + e.message }); };
      });
      w.terminate();
      return out;
    });

    expect(result.err ?? null, 'worker-hosted sync should succeed').toBeNull();
    expect(result.read).toBe('from-worker');
    expect(result.listed).toContain('w.txt');
    expect(result.listed).toContain('wd');
  });
});
