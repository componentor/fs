/**
 * What OPFS itself costs — the floor everything else is measured against.
 *
 * The op benchmarks say a create takes ~0.83 ms and an overwrite ~0.30 ms. Those numbers only
 * mean something next to what the storage layer charges for a single write, which this measures
 * directly: a bare `FileSystemSyncAccessHandle` in a worker, no VFS involved.
 *
 * The result decides whether there is any point optimising our code: if a raw write already
 * costs most of an operation, the remaining cost is the platform, not us.
 *
 * Run: npx playwright test opfs-floor --project=chromium
 */
import { test } from './fixtures';
test('raw OPFS sync handle write cost', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/correctness.html');
  const out = await page.evaluate(async () => {
    const src = `
      self.onmessage = async () => {
        const root = await navigator.storage.getDirectory();
        try { await root.removeEntry('rawbench'); } catch {}
        const fh = await root.getFileHandle('rawbench', { create: true });
        const h = await fh.createSyncAccessHandle();
        h.truncate(64 * 1024 * 1024);
        const small = new Uint8Array(64), big = new Uint8Array(8192);
        const time = (fn, n) => { const t = performance.now(); for (let i = 0; i < n; i++) fn(i); return (performance.now() - t) / n; };
        const r = {
          write64B: time((i) => h.write(small, { at: (i * 4096) % (32*1024*1024) }), 2000),
          write8KB: time((i) => h.write(big, { at: (i * 8192) % (32*1024*1024) }), 2000),
          writeSameSpot: time(() => h.write(small, { at: 0 }), 2000),
          read64B: time((i) => h.read(small, { at: (i * 4096) % (32*1024*1024) }), 2000),
          flushOnce: time(() => h.flush(), 20),
        };
        h.close();
        self.postMessage(r);
      };
    `;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url, { type: 'module' });
    const res = await new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 60_000);
      w.onmessage = (e) => { clearTimeout(t); resolve(e.data); };
      w.onerror = (e) => { clearTimeout(t); reject(new Error(e.message)); };
      w.postMessage(null);
    });
    w.terminate();
    return res;
  });
  for (const [k, v] of Object.entries(out)) console.log(`    ${k.padEnd(16)} ${(v as number).toFixed(5)} ms`);
});
