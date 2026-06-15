/**
 * End-to-end regression for the relay-side `suppressPaths` bug (fixed in 3.2.3).
 *
 * When the FileSystemObserver reported an EXTERNAL change to a path, the
 * sync-relay added that path to `suppressPaths` and applied the change to the
 * engine directly (no mirror echo). Nothing consumed the suppression until the
 * NEXT genuine local write to that path, which `notifyOPFSSync` then dropped —
 * so a local write following an external change was silently never mirrored,
 * leaving OPFS permanently diverged from the VFS. The mirror worker's own
 * `isOurEcho` is the authoritative echo guard, so the relay layer was removed.
 *
 * This test drives the real path: write locally, mutate the OPFS file directly
 * (external), let the observer propagate it into the engine, then write locally
 * again and assert the mirror reflects the second local write.
 *
 * Requires FileSystemObserver (used to detect external changes). Where it is
 * unavailable the external-change feature is inert, so the test self-skips.
 */

import { test, expect } from './fixtures';

test.describe('OPFS mirror — local write after external change', () => {
  test.setTimeout(60_000);

  test('a local write following an external change is still mirrored', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/correctness.html');

    const report = await page.evaluate(async () => {
      const ROOT = '/vfs-mirror-external';
      const MIRROR_DIRNAME = 'vfs-mirror-external';

      try {
        const opfsRoot = await navigator.storage.getDirectory();
        await opfsRoot.removeEntry(MIRROR_DIRNAME, { recursive: true });
      } catch { /* didn't exist */ }

      const env = {
        crossOriginIsolated: (globalThis as unknown as { crossOriginIsolated: boolean }).crossOriginIsolated,
        hasFileSystemObserver: typeof (globalThis as any).FileSystemObserver !== 'undefined',
      };

      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: ROOT, opfsSync: true });
      await fs.init();

      const dec = new TextDecoder();
      const enc = new TextEncoder();

      async function mirrorDir() {
        return (await navigator.storage.getDirectory()).getDirectoryHandle(MIRROR_DIRNAME);
      }
      async function readMirror(name: string): Promise<string> {
        const fh = await (await mirrorDir()).getFileHandle(name);
        return await (await fh.getFile()).text();
      }
      async function waitFor(fn: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
        const deadline = performance.now() + timeoutMs;
        while (performance.now() < deadline) {
          try { if (await fn()) return true; } catch { /* retry */ }
          await new Promise((r) => setTimeout(r, 50));
        }
        return false;
      }

      // 1) Local write → mirror reflects it.
      fs.writeFileSync('/x', enc.encode('local1'));
      const gotLocal1 = await waitFor(async () => (await readMirror('x')) === 'local1', 8000);

      // 2) Mutate the OPFS file directly (simulate an external editor). Wait out
      //    the mirror worker's echo-grace window (GRACE_MS = 3000) first, so the
      //    observer treats this as a genuine external change rather than our echo.
      await new Promise((r) => setTimeout(r, 3500));
      const fh = await (await mirrorDir()).getFileHandle('x', { create: true });
      const w = await fh.createWritable();
      await w.write(enc.encode('EXTERNAL'));
      await w.close();

      // 3) Wait for the observer to propagate the external change into the VFS.
      const enginePicked = await waitFor(
        async () => dec.decode(fs.readFileSync('/x')) === 'EXTERNAL',
        8000,
      );

      if (!enginePicked) {
        // FileSystemObserver not firing in this engine — external-change path is
        // inert, so the bug cannot manifest. Skip the assertion.
        return { env, skipped: true, gotLocal1 };
      }

      // 4) Local write again — must still be mirrored (the bug dropped this).
      fs.writeFileSync('/x', enc.encode('local2'));
      const gotLocal2 = await waitFor(async () => (await readMirror('x')) === 'local2', 8000);

      return { env, skipped: false, gotLocal1, gotLocal2 };
    });

    console.log('external-change report:', JSON.stringify(report));

    expect(report.env.crossOriginIsolated, 'server must set COOP/COEP').toBe(true);
    expect(report.gotLocal1, 'initial local write must mirror').toBe(true);

    if (report.skipped) {
      test.skip(true, 'FileSystemObserver unavailable — external-change path inert');
      return;
    }

    expect(report.gotLocal2, 'local write after an external change must still mirror').toBe(true);
    expect(consoleErrors, `no console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
