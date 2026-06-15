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

      // 2) Mutate the OPFS file directly (simulate an external editor) WITHIN the
      //    echo-grace window (GRACE_MS = 3000). With the old timestamp-only echo
      //    suppression this genuine external change was wrongly dropped; the
      //    content-based check (different bytes than we wrote) now forwards it.
      await new Promise((r) => setTimeout(r, 300));
      const fh = await (await mirrorDir()).getFileHandle('x', { create: true });
      const w = await fh.createWritable();
      await w.write(enc.encode('EXTERNAL'));
      await w.close();

      // 3) Wait for the observer to propagate the external change into the VFS.
      const enginePicked = await waitFor(
        async () => dec.decode(fs.readFileSync('/x')) === 'EXTERNAL',
        8000,
      );

      // 4) Local write again — must still be mirrored (finding F dropped this).
      const gotLocal2 = enginePicked
        ? await (async () => {
            fs.writeFileSync('/x', enc.encode('local2'));
            return waitFor(async () => (await readMirror('x')) === 'local2', 8000);
          })()
        : false;

      return { env, enginePicked, gotLocal1, gotLocal2 };
    });

    console.log('external-change report:', JSON.stringify(report));

    expect(report.env.crossOriginIsolated, 'server must set COOP/COEP').toBe(true);
    expect(report.gotLocal1, 'initial local write must mirror').toBe(true);

    if (!report.env.hasFileSystemObserver) {
      test.skip(true, 'FileSystemObserver unavailable — external-change path inert');
      return;
    }

    // #2: a genuine external change landing INSIDE the grace window must reach the
    // engine (content-based echo). Old timestamp-only suppression dropped it.
    expect(report.enginePicked, 'external write within the grace window must reach the VFS').toBe(true);
    // Finding F: a local write following an external change must still mirror.
    expect(report.gotLocal2, 'local write after an external change must still mirror').toBe(true);
    expect(consoleErrors, `no console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('an external change to a symlink TARGET re-mirrors the dependent link', async ({ page }) => {
    await page.goto('/correctness.html');

    const report = await page.evaluate(async () => {
      const ROOT = '/vfs-mirror-ext-symlink';
      const MIRROR_DIRNAME = 'vfs-mirror-ext-symlink';
      try {
        const r = await navigator.storage.getDirectory();
        await r.removeEntry(MIRROR_DIRNAME, { recursive: true });
      } catch { /* didn't exist */ }

      const env = { hasFileSystemObserver: typeof (globalThis as any).FileSystemObserver !== 'undefined' };
      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: ROOT, opfsSync: true });
      await fs.init();
      const enc = new TextEncoder();

      async function mirrorDir() { return (await navigator.storage.getDirectory()).getDirectoryHandle(MIRROR_DIRNAME); }
      async function readMirror(name: string): Promise<string> {
        return (await (await (await mirrorDir()).getFileHandle(name)).getFile()).text();
      }
      async function waitFor(fn: () => Promise<boolean>, timeoutMs: number) {
        const deadline = performance.now() + timeoutMs;
        while (performance.now() < deadline) {
          try { if (await fn()) return true; } catch { /* retry */ }
          await new Promise((r) => setTimeout(r, 50));
        }
        return false;
      }

      // target + symlink → both mirrored, link snapshots the target's content.
      fs.writeFileSync('/target.js', enc.encode('v1'));
      fs.symlinkSync('/target.js', '/link.js');
      const linkInitial = await waitFor(async () => (await readMirror('link.js')) === 'v1', 8000);

      // External tool overwrites the OPFS target file (within the grace window).
      await new Promise((r) => setTimeout(r, 300));
      const fh = await (await mirrorDir()).getFileHandle('target.js', { create: true });
      const w = await fh.createWritable(); await w.write(enc.encode('EXT')); await w.close();

      // The engine should pick up the external change, and — the fix — the
      // dependent link's mirror snapshot should be re-synced to the new content.
      const enginePicked = await waitFor(async () => new TextDecoder().decode(fs.readFileSync('/target.js')) === 'EXT', 8000);
      const linkResynced = enginePicked ? await waitFor(async () => (await readMirror('link.js')) === 'EXT', 8000) : false;

      return { env, linkInitial, enginePicked, linkResynced };
    });

    console.log('ext-symlink report:', JSON.stringify(report));
    expect(report.linkInitial, 'link initially mirrors target content').toBe(true);
    if (!report.env.hasFileSystemObserver) { test.skip(true, 'FileSystemObserver unavailable'); return; }
    expect(report.enginePicked, 'external target write reaches the VFS').toBe(true);
    expect(report.linkResynced, 'external target change must re-mirror the dependent link').toBe(true);
  });
});
