/**
 * A synchronous call made straight after `await fs.init()` must work, with the OPFS mirror on.
 *
 * On WebKit it hung: the relay reported ready before the mirror worker it starts had come up, and a
 * worker started from inside another worker needs the page's event loop to do so. The first
 * `*Sync` call spun the page, the mirror never started, the relay made no progress, and the call
 * aborted after 30s — as did every later synchronous call on that page. Waiting ~30ms before the
 * first call avoided it, which is why ordinary pages rarely saw it and test pages always did. The
 * relay now waits for the mirror before reporting ready.
 *
 * No delay between init() and the calls below is the whole point: do not add one.
 */

import { test, expect } from './fixtures';

test.describe('sync call right after init', () => {
  test.setTimeout(60_000);

  for (const opfsSync of [true, false]) {
    test(`works at once with opfsSync: ${opfsSync}`, async ({ page }) => {
      await page.goto('/correctness.html');
      const r = await page.evaluate(async (opfsSync: boolean) => {
        const mod = await import('/index.js') as any;
        const fs = new mod.VFSFileSystem({ root: '/vfs-sync-after-init-' + opfsSync, opfsSync });
        await fs.init();
        const t0 = performance.now();
        try {
          fs.writeFileSync('/a.txt', 'first');
          const read = fs.readFileSync('/a.txt', 'utf8');
          fs.closeSync(fs.openSync('/b.txt', 'w'));
          return { ok: true, read, ms: performance.now() - t0 };
        } catch (e: any) {
          return { ok: false, error: String(e?.message), ms: performance.now() - t0 };
        }
      }, opfsSync);
      expect(r, JSON.stringify(r)).toMatchObject({ ok: true, read: 'first' });
      expect(r.ms).toBeLessThan(5_000);
    });
  }
});
