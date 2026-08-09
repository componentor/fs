/**
 * `fs.watch` and `fs.watchFile` across tabs, in real browsers.
 *
 * Watch delivery is cross-tab by design: mutations are broadcast over a `BroadcastChannel` keyed
 * by the instance's namespace, so a tab watching a directory should see a *different* tab's
 * writes. Nothing tested that — and the last time `watch` was tested at all, the two-argument
 * form turned out to be completely inert (CHANGELOG 3.3.11), so "untested" here is not a safe
 * assumption about "working".
 *
 * These use two real pages in one browser context, the same shape as
 * [multitab.spec.ts](./multitab.spec.ts): tab A initialises first and becomes leader, tab B
 * joins as a follower. Watchers are registered in one and the mutations made in the other.
 *
 * Only the async API is used for the mutations, so the WebKit follower-sync limitation
 * documented in multitab.spec.ts cannot confound the result — this is about event delivery,
 * not about which API issues the write.
 */

import { test, expect } from './fixtures';

test.describe('watch across tabs', () => {
  test.setTimeout(120_000);

  test('a watcher in one tab sees another tab’s writes', async ({ page }) => {
    await page.goto('/correctness.html');

    // --- Tab A: leader, registers the watchers ---
    await page.evaluate(async () => {
      const opfsRoot = await navigator.storage.getDirectory();
      try { await opfsRoot.removeEntry('mt-watch', { recursive: true }); } catch { /* fresh */ }
      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: '/mt-watch' });
      await fs.init();
      await fs.promises.mkdir('/dir', { recursive: true });

      const seen: string[] = [];
      (self as any).__seen = seen;
      (self as any).__fs = fs;
      (self as any).__watcher = fs.watch('/dir', (event: string, filename: string) => {
        seen.push(`${event}:${filename}`);
      });
    });

    // --- Tab B: follower, makes the changes ---
    const pageB = await page.context().newPage();
    await pageB.goto('/correctness.html');
    await pageB.evaluate(async () => {
      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: '/mt-watch' });
      await fs.init();
      (self as any).__fs = fs;
      await fs.promises.writeFile('/dir/from-b.txt', 'written by tab B');
    });

    // Delivery is asynchronous across a BroadcastChannel; give it room without making the
    // failure mode a silent pass.
    await page.waitForTimeout(600);
    const seenAfterCreate = await page.evaluate(() => (self as any).__seen.slice());
    expect(
      seenAfterCreate.some((e: string) => e.endsWith(':from-b.txt')),
      `tab A should have seen tab B's create, saw ${JSON.stringify(seenAfterCreate)}`
    ).toBe(true);

    // --- and a delete from B, also observed in A ---
    await page.evaluate(() => { (self as any).__seen.length = 0; });
    await pageB.evaluate(async () => { await (self as any).__fs.promises.rm('/dir/from-b.txt'); });
    await page.waitForTimeout(600);
    const seenAfterDelete = await page.evaluate(() => (self as any).__seen.slice());
    expect(
      seenAfterDelete.some((e: string) => e.endsWith(':from-b.txt')),
      `tab A should have seen tab B's delete, saw ${JSON.stringify(seenAfterDelete)}`
    ).toBe(true);

    // --- closing the watcher stops cross-tab delivery too ---
    await page.evaluate(() => { (self as any).__watcher.close(); (self as any).__seen.length = 0; });
    await pageB.evaluate(async () => { await (self as any).__fs.promises.writeFile('/dir/after-close.txt', 'x'); });
    await page.waitForTimeout(600);
    const seenAfterClose = await page.evaluate(() => (self as any).__seen.slice());
    expect(seenAfterClose, 'a closed watcher must not receive cross-tab events').toEqual([]);

    await pageB.close();
  });

  test('watchFile polls and reports stat changes made by another tab', async ({ page }) => {
    await page.goto('/correctness.html');

    await page.evaluate(async () => {
      const opfsRoot = await navigator.storage.getDirectory();
      try { await opfsRoot.removeEntry('mt-watchfile', { recursive: true }); } catch { /* fresh */ }
      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: '/mt-watchfile' });
      await fs.init();
      await fs.promises.writeFile('/tracked.txt', 'small');

      const sizes: Array<[number, number]> = [];
      (self as any).__sizes = sizes;
      (self as any).__fs = fs;
      // A short interval so the test does not wait on Node's 5007 ms default.
      fs.watchFile('/tracked.txt', { interval: 50 }, (curr: any, prev: any) => {
        sizes.push([prev.size, curr.size]);
      });
    });

    const pageB = await page.context().newPage();
    await pageB.goto('/correctness.html');
    await pageB.evaluate(async () => {
      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: '/mt-watchfile' });
      await fs.init();
      (self as any).__fs = fs;
      await fs.promises.writeFile('/tracked.txt', 'considerably longer contents than before');
    });

    // watchFile is a poller, so allow several intervals.
    await page.waitForTimeout(800);
    const sizes = await page.evaluate(() => (self as any).__sizes.slice());
    expect(sizes.length, `watchFile should have fired, saw ${JSON.stringify(sizes)}`).toBeGreaterThan(0);
    const [prevSize, currSize] = sizes[0];
    expect(currSize, 'curr should report the new, larger size').toBeGreaterThan(prevSize);

    // unwatchFile stops the poller.
    await page.evaluate(() => {
      (self as any).__fs.unwatchFile('/tracked.txt');
      (self as any).__sizes.length = 0;
    });
    await pageB.evaluate(async () => { await (self as any).__fs.promises.writeFile('/tracked.txt', 'changed yet again, even longer'); });
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (self as any).__sizes.slice()), 'unwatchFile should stop the poller').toEqual([]);

    await pageB.close();
  });
});
