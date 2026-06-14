/**
 * Multi-tab correctness: leader election + follower relay through the
 * service-worker port broker, in real browsers.
 *
 * Tab A inits first (becomes leader) and writes. Tab B inits second
 * (becomes follower via the SW broker) and must see A's data and write
 * back — via BOTH the async (promises) and sync APIs.
 *
 * Engine expectations:
 *  - Chromium / Firefox: everything works, including follower SYNC ops
 *    (worker MessagePort delivery does not involve the page's main thread).
 *  - WebKit: async ops work; follower SYNC ops fail with EIO — the
 *    follower's sync caller busy-spins its main thread, and WebKit brokers
 *    that tab's port traffic through that same main thread, so the leader's
 *    response cannot arrive. This is architectural (verified: the identical
 *    deadlock exists on unmodified 3.0.55, where it hung forever instead of
 *    failing with EIO). The forwarder fails fast after the first timeout;
 *    async delivery heals it. See PERF-RELIABILITY-REPORT.md.
 */

import { test, expect } from './fixtures';

test.describe('multi-tab leader/follower', () => {
  test.setTimeout(120_000);

  test('follower sees leader data; sync + async per engine contract', async ({ page, browserName }) => {
    await page.goto('/correctness.html');

    // Tab A: leader
    const aInit = await page.evaluate(async () => {
      const opfsRoot = await navigator.storage.getDirectory();
      try { await opfsRoot.removeEntry('mt-spec', { recursive: true }); } catch { /* fresh */ }
      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: '/mt-spec' });
      await fs.init();
      fs.writeFileSync('/from-a.txt', new TextEncoder().encode('from tab A'));
      (self as any).__fs = fs;
      return 'ok';
    });
    expect(aInit).toBe('ok');

    // Tab B: follower (same context)
    const pageB = await page.context().newPage();
    await pageB.goto('/correctness.html');
    const b = await pageB.evaluate(async () => {
      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: '/mt-spec' });
      await fs.init();
      const out: Record<string, string> = {};
      out.asyncRead = new TextDecoder().decode(await fs.promises.readFile('/from-a.txt'));
      await fs.promises.writeFile('/from-b-async.txt', new TextEncoder().encode('async from B'));
      out.asyncWrite = 'ok';
      try {
        out.syncRead = new TextDecoder().decode(fs.readFileSync('/from-a.txt'));
      } catch (e: any) { out.syncRead = 'THREW:' + e.code; }
      try {
        fs.writeFileSync('/from-b-sync.txt', new TextEncoder().encode('sync from B'));
        out.syncWrite = 'ok';
      } catch (e: any) { out.syncWrite = 'THREW:' + e.code; }
      // After a sync failure, async must still work (and heal the port)
      out.asyncAfterSync = new TextDecoder().decode(await fs.promises.readFile('/from-a.txt'));
      return out;
    });

    // Async cross-tab works everywhere
    expect(b.asyncRead).toBe('from tab A');
    expect(b.asyncWrite).toBe('ok');
    expect(b.asyncAfterSync).toBe('from tab A');

    if (browserName === 'webkit') {
      // Architectural limitation: follower sync fails (EIO), must not hang
      expect(b.syncRead).toBe('THREW:EIO');
      expect(b.syncWrite).toBe('THREW:EIO');
    } else {
      expect(b.syncRead).toBe('from tab A');
      expect(b.syncWrite).toBe('ok');
    }

    // Leader sees follower's async write
    const aVerify = await page.evaluate(async () => {
      const fs = (self as any).__fs;
      return new TextDecoder().decode(await fs.promises.readFile('/from-b-async.txt'));
    });
    expect(aVerify).toBe('async from B');

    await pageB.close();
  });
});
