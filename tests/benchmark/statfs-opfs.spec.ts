import { test, expect } from './fixtures';

test('statfs works in opfs fallback mode too', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/correctness.html');
  const st = await page.evaluate(async () => {
    try {
      const r = await navigator.storage.getDirectory();
      await r.removeEntry('ct-statfs-opfs', { recursive: true });
    } catch { /* fresh */ }
    const mod = await import('/index.js') as any;
    const fs = new mod.VFSFileSystem({ root: '/ct-statfs-opfs', mode: 'opfs' });
    await fs.init();
    // OPFS mode drives everything through the async engine; use the promise API so this does
    // not depend on the sync path being available in the mode under test.
    await fs.promises.writeFile('/f', 'x');
    return await fs.promises.statfs('/');
  });
  console.log('  opfs-mode statfs:', JSON.stringify(st));
  // Quota-derived: real numbers from the Storage API, not invented constants.
  expect(st.bsize).toBe(4096);
  expect(st.blocks).toBeGreaterThan(0);
  expect(st.bfree).toBeGreaterThan(0);
  expect(st.bfree).toBeLessThanOrEqual(st.blocks);
});
