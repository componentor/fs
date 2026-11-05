/**
 * The library must stay silent unless `debug: true`.
 *
 * The sync-relay logged every external change it applied ([sync-relay] external-write/delete/
 * rename) and the OPFS mirror logged its startup ([opfs-sync] initialized ...) unconditionally, so
 * an app deleting a directory in OPFS got one console line per file. Those are diagnostics: they
 * belong behind the same `debug` flag as the relay's per-op timing logs.
 *
 * The debug run is the control: it proves this harness really receives the workers' console
 * output, so the quiet run passing means "no logs", not "logs not captured".
 *
 * External changes need FileSystemObserver; without it the external half self-skips.
 * WebKit does not forward nested-worker console output, so the opfs-sync lines are checked on
 * the other engines only.
 */

import { test, expect } from './fixtures';

const LIBRARY_LOG = /^\[(sync-relay|opfs-sync|leaderLoop)\]/;

async function run(page: any, debug: boolean) {
  const logs: string[] = [];
  page.on('console', (msg: any) => { if (LIBRARY_LOG.test(msg.text())) logs.push(msg.text()); });
  await page.goto('/correctness.html');

  const result = await page.evaluate(async (debug: boolean) => {
    const DIR = debug ? 'vfs-debug-on' : 'vfs-debug-off';
    const opfs = await navigator.storage.getDirectory();
    try { await opfs.removeEntry(DIR, { recursive: true }); } catch { /* fresh */ }
    const hasObserver = typeof (globalThis as any).FileSystemObserver !== 'undefined';

    const mod = await import('/index.js') as any;
    const fs = new mod.VFSFileSystem({ root: '/' + DIR, opfsSync: true, debug });
    await fs.init();

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (check: () => Promise<boolean>, ms = 8000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (await check()) return true; await sleep(50); }
      return false;
    };

    // Local writes that the mirror copies to real OPFS files.
    await fs.promises.mkdir('/dir/sub', { recursive: true });
    for (const name of ['a', 'b', 'c']) await fs.promises.writeFile('/dir/sub/' + name, 'x');
    const mirrored = await waitFor(async () => {
      try { await (await (await (await opfs.getDirectoryHandle(DIR)).getDirectoryHandle('dir')).getDirectoryHandle('sub')).getFileHandle('c'); return true; } catch { return false; }
    });

    let externalApplied = false;
    if (hasObserver && mirrored) {
      // No waiting out the mirror's echo window: an external delete of files we wrote a moment ago
      // must still be applied (it used to be dropped as our own echo for 3 s).
      // External changes: write one file and delete a whole directory straight in OPFS.
      const dir = await (await opfs.getDirectoryHandle(DIR)).getDirectoryHandle('dir');
      const fh = await dir.getFileHandle('external.txt', { create: true });
      const w = await fh.createWritable(); await w.write('from outside'); await w.close();
      await dir.removeEntry('sub', { recursive: true });
      externalApplied = await waitFor(async () => {
        const names: string[] = await fs.promises.readdir('/dir');
        return names.includes('external.txt') && !names.includes('sub');
      });
    }
    await sleep(300); // let any trailing worker logs arrive
    const vfsAfter = await fs.promises.readdir('/dir', { recursive: true });
    return { hasObserver, mirrored, externalApplied, vfsAfter };
  }, debug);

  return { logs, ...result };
}

test.describe('library console output', () => {
  test.setTimeout(60_000);

  test('is silent with debug off, including for external OPFS changes', async ({ page }) => {
    const r = await run(page, false);
    expect(r.mirrored, JSON.stringify({ ...r, logs: r.logs.slice(0, 14) })).toBe(true);
    if (r.hasObserver) expect(r.externalApplied, JSON.stringify({ ...r, logs: r.logs.slice(0, 14) })).toBe(true);
    expect(r.logs).toEqual([]);
  });

  test('still logs with debug on (control: worker logs reach this harness)', async ({ page, browserName }) => {
    const r = await run(page, true);
    expect(r.mirrored, JSON.stringify({ ...r, logs: r.logs.slice(0, 14) })).toBe(true);
    expect(r.logs.some((l) => l.startsWith('[sync-relay] op='))).toBe(true);
    // WebKit does not forward the console of a worker started by another worker (opfs-sync is
    // spawned by the relay) to Playwright, so there this half is covered by the other engines.
    if (browserName !== 'webkit') {
      expect(r.logs.some((l) => l.startsWith('[opfs-sync] initialized'))).toBe(true);
    }
    if (r.hasObserver) {
      expect(r.externalApplied, JSON.stringify({ ...r, logs: r.logs.slice(0, 14) })).toBe(true);
      expect(r.logs.some((l) => l.startsWith('[sync-relay] external-write'))).toBe(true);
      expect(r.logs.some((l) => l.startsWith('[sync-relay] external-delete'))).toBe(true);
    }
  });
});
