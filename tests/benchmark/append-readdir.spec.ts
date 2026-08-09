/**
 * Targeted benchmark for the append and readdir changes, against **real OPFS**.
 *
 * The Node microbenchmark (`npx vitest bench ops`) runs against an in-memory handle, so it
 * measures our code and nothing else. That is the right tool for catching a regression in the
 * layers around the engine, but it cannot show whether a win survives real storage — where a
 * single `handle.write` may cost more than everything else in the operation put together.
 *
 * Both changes are algorithmic rather than constant-factor, which is exactly why they need
 * checking here:
 *  - `append` used to relocate the whole file on every call (O(size)); it now writes in place
 *    when the block run has room. If real OPFS write cost dominates, the win should be *larger*
 *    here than in Node, not smaller.
 *  - `readdir` (names-only) dropped a path concatenation, a Map probe and an intermediate
 *    Uint8Array per entry. That is pure CPU, so real storage could easily swamp it.
 *
 * Run: npx playwright test append-readdir --project=chromium
 */

import { test } from './fixtures';

test.describe('append / readdir against real OPFS', () => {
  test.setTimeout(180_000);

  test('measure', async ({ page }) => {
    await page.goto('/correctness.html');

    const results = await page.evaluate(async () => {
      try {
        const opfsRoot = await navigator.storage.getDirectory();
        await opfsRoot.removeEntry('ct-bench-ar', { recursive: true });
      } catch { /* didn't exist */ }

      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: '/ct-bench-ar' });
      await fs.init();
      try { await fs.promises.rm('/', { recursive: true, force: true }); } catch { /* fresh */ }

      const time = (fn: () => void, n: number) => {
        const t0 = performance.now();
        for (let i = 0; i < n; i++) fn();
        return (performance.now() - t0) / n;
      };

      // --- append to a growing log ---------------------------------------------------------
      // The shape the old code was quadratic in: each append had to copy everything written so
      // far. 2000 × 64 B ends at ~128 KB, so the old cost per call climbs the whole way.
      const APPENDS = 2000;
      const chunk = 'y'.repeat(64);
      fs.writeFileSync('/log.txt', '');
      const appendMsPerOp = time(() => fs.appendFileSync('/log.txt', chunk), APPENDS);
      const finalSize = fs.statSync('/log.txt').size;

      // Appending to an already-large file isolates the O(size) term most sharply.
      fs.writeFileSync('/big.txt', 'x'.repeat(512 * 1024));
      const appendToLargeMs = time(() => fs.appendFileSync('/big.txt', chunk), 200);

      // --- file creation into a filling volume ------------------------------------------------
      // The shape the old bitmap scan was quadratic in: every allocation restarted at block 0,
      // so each create first walked past all blocks already in use. Measured in batches so the
      // trend is visible, not just the average — a flat series is the whole point of the change.
      const CREATE_BATCH = 400;
      const createTrend: number[] = [];
      fs.mkdirSync('/many');
      for (let batch = 0; batch < 6; batch++) {
        createTrend.push(time(() => {
          fs.writeFileSync(`/many/c${batch}-${createTrend.length}-${Math.round(performance.now() * 1000)}`, chunk);
        }, CREATE_BATCH));
      }

      // --- readdir ---------------------------------------------------------------------------
      fs.mkdirSync('/d');
      for (let i = 0; i < 500; i++) fs.writeFileSync(`/d/file-${i}.txt`, '');
      const readdirMs = time(() => fs.readdirSync('/d'), 500);
      const readdirTypedMs = time(() => fs.readdirSync('/d', { withFileTypes: true }), 200);

      return {
        appendMsPerOp, finalSize, appendToLargeMs, readdirMs, readdirTypedMs, createTrend,
      };
    });

    const fmt = (ms: number) => `${ms.toFixed(4)} ms/op  (${Math.round(1000 / ms)} ops/s)`;
    console.log('\n  append 64B to growing log   ', fmt(results.appendMsPerOp), `→ final ${results.finalSize} B`);
    console.log('  append 64B to 512KB file    ', fmt(results.appendToLargeMs));
    console.log('  readdir 500 entries         ', fmt(results.readdirMs));
    console.log('  readdir 500 withFileTypes   ', fmt(results.readdirTypedMs));
    console.log('  create trend (400/batch)    ',
      results.createTrend.map((ms: number) => ms.toFixed(3)).join(' → '), 'ms/op');
  });
});
