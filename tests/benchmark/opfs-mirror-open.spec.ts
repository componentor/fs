/**
 * End-to-end regression: open() that creates or truncates a file must be
 * mirrored to OPFS (fixed in 3.2.5).
 *
 * OP.OPEN previously set no sync metadata, so `open(p,'w')`+close (a touch) and
 * `open(existing,'w')`+close (truncate, which engine.open does internally,
 * bypassing OP.TRUNCATE) left the OPFS mirror missing the file or holding stale
 * pre-truncate bytes.
 */

import { test, expect } from './fixtures';

test.describe('OPFS mirror — open() create/truncate', () => {
  test.setTimeout(60_000);

  test('open(w)/open(a) create and open(w) truncate are mirrored', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    await page.goto('/correctness.html');

    const report = await page.evaluate(async () => {
      const ROOT = '/vfs-mirror-open';
      const MIRROR_DIRNAME = 'vfs-mirror-open';
      try {
        const r = await navigator.storage.getDirectory();
        await r.removeEntry(MIRROR_DIRNAME, { recursive: true });
      } catch { /* didn't exist */ }

      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: ROOT, opfsSync: true });
      await fs.init();
      const env = { crossOriginIsolated: (globalThis as any).crossOriginIsolated };
      const enc = new TextEncoder();

      async function readMirror(name: string): Promise<string> {
        const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(MIRROR_DIRNAME);
        return await (await (await dir.getFileHandle(name)).getFile()).text();
      }
      async function waitExists(name: string, timeoutMs: number): Promise<boolean> {
        const deadline = performance.now() + timeoutMs;
        while (performance.now() < deadline) {
          try { await readMirror(name); return true; } catch { /* not yet */ }
          await new Promise((r) => setTimeout(r, 50));
        }
        return false;
      }
      async function waitMirror(name: string, want: string, timeoutMs: number) {
        const deadline = performance.now() + timeoutMs;
        let last = 'never read';
        while (performance.now() < deadline) {
          try { const g = await readMirror(name); if (g === want) return { ok: true, last: 'match' }; last = `got ${JSON.stringify(g)}`; }
          catch (e: any) { last = e?.name || String(e); }
          await new Promise((r) => setTimeout(r, 50));
        }
        return { ok: false, last };
      }

      // 1) touch: open('w')+close creates an empty file → mirror has it (empty).
      fs.closeSync(fs.openSync('/touched.txt', 'w'));
      const touched = await waitMirror('touched.txt', '', 8000);

      // 2) truncate: write content, then open('w')+close empties it → mirror emptied.
      fs.writeFileSync('/trunc.txt', enc.encode('FULL CONTENT'));
      const truncBefore = await waitMirror('trunc.txt', 'FULL CONTENT', 8000);
      fs.closeSync(fs.openSync('/trunc.txt', 'w'));
      const truncAfter = await waitMirror('trunc.txt', '', 8000); // stale 'FULL CONTENT' before the fix

      // 3) append-create: open('a')+close on a new path creates it → mirror has it.
      fs.closeSync(fs.openSync('/appended.txt', 'a'));
      const appended = await waitExists('appended.txt', 8000);

      return { env, touched, truncBefore, truncAfter, appended };
    });

    console.log('open report:', JSON.stringify(report));
    expect(report.env.crossOriginIsolated).toBe(true);
    expect(report.touched.ok, `touch must create an empty mirror file: ${report.touched.last}`).toBe(true);
    expect(report.truncBefore.ok, `pre-truncate content mirrored: ${report.truncBefore.last}`).toBe(true);
    expect(report.truncAfter.ok, `open(w) truncate must empty the mirror file: ${report.truncAfter.last}`).toBe(true);
    expect(report.appended, 'open(a) of a new path must create the mirror file').toBe(true);
    expect(consoleErrors, `no console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
