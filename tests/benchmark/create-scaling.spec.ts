import { test } from './fixtures';

test.describe('create scaling', () => {
  test.setTimeout(300_000);
  test('measure', async ({ page }) => {
    await page.goto('/correctness.html');
    for (const mode of ['vfs', 'hybrid'] as const) {
      const trend = await page.evaluate(async (m) => {
        try {
          const r = await navigator.storage.getDirectory();
          await r.removeEntry('ct-create-' + m, { recursive: true });
        } catch { /* fresh */ }
        const mod = await import('/index.js') as any;
        const fs = new mod.VFSFileSystem({ root: '/ct-create-' + m, mode: m });
        await fs.init();
        try { await fs.promises.rm('/', { recursive: true, force: true }); } catch { /* fresh */ }
        fs.mkdirSync('/many');
        const chunk = 'y'.repeat(64);
        const out: number[] = [];
        let n = 0;
        for (let batch = 0; batch < 10; batch++) {
          const t0 = performance.now();
          for (let i = 0; i < 1500; i++) fs.writeFileSync(`/many/f${n++}`, chunk);
          out.push((performance.now() - t0) / 1500);
        }
        return out;
      }, mode);
      console.log(`  ${mode.padEnd(7)} (1500/batch, to 15k files): ${trend.map((x) => x.toFixed(3)).join(' → ')} ms/op`);
    }
  });
});
