/**
 * Where the time goes in a realistic workload, against real OPFS.
 *
 * The op microbenchmarks measure one call shape at a time. This measures a mix closer to what
 * actually drives this library — a bundler or git-style pass over many small files — and splits
 * the cost by mode so the OPFS mirror's share is visible rather than inferred.
 *
 * Run: npx playwright test profile-hotpath --project=chromium
 */
import { test } from './fixtures';

test.describe('hot-path profile', () => {
  test.setTimeout(300_000);

  test('measure', async ({ page }) => {
    await page.goto('/correctness.html');

    for (const mode of ['vfs', 'hybrid'] as const) {
      const r = await page.evaluate(async (m) => {
        try {
          const root = await navigator.storage.getDirectory();
          await root.removeEntry('ct-prof-' + m, { recursive: true });
        } catch { /* fresh */ }
        const mod = await import('/index.js') as any;
        const fs = new mod.VFSFileSystem({ root: '/ct-prof-' + m, mode: m });
        await fs.init();
        try { await fs.promises.rm('/', { recursive: true, force: true }); } catch { /* fresh */ }

        const time = (fn: () => void, n: number) => {
          const t0 = performance.now();
          for (let i = 0; i < n; i++) fn();
          return (performance.now() - t0) / n;
        };

        const small = 'x'.repeat(256);
        const medium = 'y'.repeat(8 * 1024);

        fs.mkdirSync('/w');
        let n = 0;
        const createSmall = time(() => fs.writeFileSync(`/w/s${n++}.js`, small), 600);
        let k = 0;
        const createMedium = time(() => fs.writeFileSync(`/w/m${k++}.js`, medium), 200);

        fs.writeFileSync('/w/fixed.js', medium);
        const overwrite = time(() => fs.writeFileSync('/w/fixed.js', medium), 300);
        const readMedium = time(() => fs.readFileSync('/w/fixed.js'), 500);
        const statOne = time(() => fs.statSync('/w/fixed.js'), 1000);
        const existsOne = time(() => fs.existsSync('/w/fixed.js'), 1000);
        const listDir = time(() => fs.readdirSync('/w'), 100);
        const unlinkOne = (() => { let i = 0; return time(() => fs.unlinkSync(`/w/s${i++}.js`), 400); })();

        return { createSmall, createMedium, overwrite, readMedium, statOne, existsOne, listDir, unlinkOne };
      }, mode);

      const row = (label: string, ms: number) =>
        `    ${label.padEnd(22)} ${ms.toFixed(4).padStart(9)} ms  ${String(Math.round(1000 / ms)).padStart(7)} ops/s`;
      console.log(`\n  ── ${mode} mode ──`);
      console.log(row('create 256B', r.createSmall));
      console.log(row('create 8KB', r.createMedium));
      console.log(row('overwrite 8KB', r.overwrite));
      console.log(row('read 8KB', r.readMedium));
      console.log(row('stat', r.statOne));
      console.log(row('exists', r.existsOne));
      console.log(row('readdir (~800)', r.listDir));
      console.log(row('unlink', r.unlinkOne));
    }
  });
});
