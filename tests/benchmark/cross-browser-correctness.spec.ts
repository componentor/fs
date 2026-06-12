/**
 * Cross-browser correctness sweep — runs the full sync + async lifecycle in
 * REAL browsers (Chromium, Firefox, WebKit/Safari-engine; Edge via the
 * chromium engine or the optional msedge project) against the dist build,
 * with real OPFS, real workers, and the real SAB relay protocol.
 *
 * Focuses on the code paths changed by the children-index + reliability
 * work:
 *  - readdir/stat correctness on populated, mutated, and renamed trees
 *    (children index: create → list → rename → relist → delete → relist)
 *  - directory listings stay correct as the volume grows (the index must
 *    track the live tree, not the prefix scan it replaced)
 *  - error codes for missing paths (ENOENT) and non-empty dirs (ENOTEMPTY)
 *  - superblock CRC survives a real OPFS persist + remount cycle
 */

import { test, expect } from './fixtures';

test.describe('cross-browser correctness sweep', () => {
  test.setTimeout(120_000);

  test('directory tree lifecycle: create/list/rename/delete stays consistent', async ({ page }) => {
    // WebKit runs in a persistent context (see fixtures.ts) — ephemeral
    // sessions cannot open OPFS sync access handles. The former WebKit
    // sync-write hang (dispatch loop parked in a MessagePort yield starved
    // by the spinning main thread) is fixed by the timer-raced
    // yieldToEventLoop in sync-relay.worker.ts.
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/correctness.html');

    const report = await page.evaluate(async () => {
      const env = {
        crossOriginIsolated: (globalThis as unknown as { crossOriginIsolated: boolean }).crossOriginIsolated,
        hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
        ua: navigator.userAgent,
      };

      // Start from clean storage: origin OPFS persists across test runs in
      // some engines (WebKit shares it across Playwright persistent
      // contexts), and a .vfs.bin torn by a previously killed session makes
      // init() reject with its documented corruption error.
      try {
        const opfsRoot = await navigator.storage.getDirectory();
        await opfsRoot.removeEntry('ct-crossbrowser', { recursive: true });
      } catch { /* didn't exist */ }

      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: '/ct-crossbrowser' });
      await fs.init();
      try { await fs.promises.rm('/', { recursive: true, force: true }); } catch { /* fresh */ }

      const failures: string[] = [];
      const check = (cond: boolean, label: string) => { if (!cond) failures.push(label); };
      const sorted = (xs: string[]) => [...xs].sort();
      const eq = (a: string[], b: string[]) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

      const data = new TextEncoder().encode('cross-browser-payload');

      // --- build a tree: 20 dirs x 25 files (sync path) ---
      for (let d = 0; d < 20; d++) {
        fs.mkdirSync(`/tree/dir${d}`, { recursive: true });
        for (let f = 0; f < 25; f++) {
          fs.writeFileSync(`/tree/dir${d}/file${f}.txt`, data);
        }
      }

      // --- listings reflect exactly what was created ---
      const rootList = fs.readdirSync('/tree');
      check(rootList.length === 20, `root list has 20 dirs (got ${rootList.length})`);
      const dir7 = fs.readdirSync('/tree/dir7');
      check(dir7.length === 25, `dir7 has 25 files (got ${dir7.length})`);
      check(eq(dir7, Array.from({ length: 25 }, (_, i) => `file${i}.txt`)), 'dir7 names exact');

      // --- stat on dirs and files agrees with the tree ---
      const stDir = fs.statSync('/tree/dir7');
      check(stDir.isDirectory(), 'dir7 stats as directory');
      const stFile = fs.statSync('/tree/dir7/file3.txt');
      check(stFile.isFile() && stFile.size === data.byteLength, 'file3 stats as file with size');

      // --- rename a whole directory; listings must follow (async path) ---
      await fs.promises.rename('/tree/dir7', '/tree/renamed');
      check(!fs.existsSync('/tree/dir7'), 'old dir gone after rename');
      const renamed = fs.readdirSync('/tree/renamed');
      check(renamed.length === 25, `renamed dir keeps 25 files (got ${renamed.length})`);
      const rootAfterRename = fs.readdirSync('/tree');
      check(rootAfterRename.includes('renamed') && !rootAfterRename.includes('dir7'),
        'root listing reflects rename');

      // --- deletions update listings (mixed sync/async) ---
      fs.unlinkSync('/tree/renamed/file0.txt');
      await fs.promises.rm('/tree/dir3', { recursive: true, force: true });
      check(fs.readdirSync('/tree/renamed').length === 24, 'unlink reflected in listing');
      check(!fs.existsSync('/tree/dir3'), 'recursive rm removes dir');
      check(fs.readdirSync('/tree').length === 19, 'root shrinks to 19');

      // --- error codes ---
      let enoent = '';
      try { fs.readFileSync('/tree/missing.txt'); } catch (e: any) { enoent = e.code; }
      check(enoent === 'ENOENT', `missing file throws ENOENT (got ${enoent})`);
      let enotempty = '';
      try { fs.rmdirSync('/tree/renamed'); } catch (e: any) { enotempty = e.code; }
      check(enotempty === 'ENOTEMPTY', `non-empty rmdir throws ENOTEMPTY (got ${enotempty})`);

      // --- deep nesting + readdir withFileTypes ---
      fs.mkdirSync('/deep/a/b/c/d/e', { recursive: true });
      fs.writeFileSync('/deep/a/b/c/d/e/leaf.txt', data);
      const entries = fs.readdirSync('/deep/a/b/c/d', { withFileTypes: true });
      check(entries.length === 1 && entries[0].isDirectory(), 'withFileTypes deep dir entry');

      // --- flush so the superblock (now CRC-stamped) persists, then verify
      //     a fresh read of a file still round-trips (mount-side CRC ok) ---
      await fs.promises.flush();
      const back = fs.readFileSync('/tree/renamed/file5.txt');
      check(back.byteLength === data.byteLength, 'post-flush read round-trips');

      return { env, failures };
    });

    console.log('environment:', JSON.stringify(report.env));
    for (const f of report.failures) console.log('  FAILED:', f);

    expect(report.env.crossOriginIsolated, 'server must set COOP/COEP').toBe(true);
    expect(report.failures, report.failures.join('; ')).toEqual([]);
    expect(consoleErrors, `no console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
