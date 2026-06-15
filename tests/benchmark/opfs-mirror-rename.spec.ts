/**
 * End-to-end OPFS-mirror regression for directory rename, run in a REAL browser
 * against the dist build with real workers, real SAB relay, and the real OPFS
 * mirror (opfs-sync.worker).
 *
 * Reproduces the Vite atomic-deps-commit pattern that motivated the 3.2.1/3.2.2
 * fixes: a temp directory is populated with several files (one nested) and then
 * renamed to its final name — all synchronously, so every child's mirror sync is
 * still inside the 50ms debounce window (un-flushed) when the rename fires.
 *
 *   - 3.2.1: a regular-file atomic rename mirrors as write(final)+delete(temp).
 *   - 3.2.2: a directory rename re-keys the pending child syncs to the new path,
 *            so the freshly-written children are not dropped from the mirror.
 *
 * Before 3.2.2 the renamed children never appeared under the new directory in
 * OPFS (their stale pending syncs read ENOENT at the old path and the directory
 * `rename` op could not move files that were never mirrored). This test fails
 * in that state and passes with the reroute fix.
 */

import { test, expect } from './fixtures';

test.describe('OPFS mirror — directory rename of freshly-written files', () => {
  test.setTimeout(60_000);

  test('renamed temp dir mirrors all (still-debounced) children at the new path', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/correctness.html');

    const report = await page.evaluate(async () => {
      const ROOT = '/vfs-mirror-rename';
      const MIRROR_DIRNAME = 'vfs-mirror-rename'; // OPFS dir = root without leading slash

      // Clean slate — OPFS persists across runs in some engines.
      try {
        const opfsRoot = await navigator.storage.getDirectory();
        await opfsRoot.removeEntry(MIRROR_DIRNAME, { recursive: true });
      } catch { /* didn't exist */ }

      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: ROOT, opfsSync: true });
      await fs.init();

      const env = {
        crossOriginIsolated: (globalThis as unknown as { crossOriginIsolated: boolean }).crossOriginIsolated,
        hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
        ua: navigator.userAgent,
      };

      const enc = new TextEncoder();
      // VFS-relative paths (absolute from '/', the `root` only places them in OPFS).
      const tempFiles: Record<string, string> = {
        '/deps_temp/chunk-A.js': 'export const A = 1;',
        '/deps_temp/chunk-B.js': 'export const B = 22;',
        '/deps_temp/nested/chunk-C.js': 'export const C = 333;',
      };

      // Populate temp dir + rename to final — all synchronous, well within the
      // 50ms debounce, so every child sync is still pending at rename time.
      fs.mkdirSync('/deps_temp/nested', { recursive: true });
      for (const [p, content] of Object.entries(tempFiles)) {
        fs.writeFileSync(p, enc.encode(content));
      }
      fs.renameSync('/deps_temp', '/deps');

      // Sanity: the VFS itself moved everything.
      const vfsOk =
        fs.existsSync('/deps/chunk-A.js') &&
        fs.existsSync('/deps/nested/chunk-C.js') &&
        !fs.existsSync('/deps_temp');

      // Expected mirror tree (final paths) and contents.
      const expected: Record<string, string> = {
        'deps/chunk-A.js': tempFiles['/deps_temp/chunk-A.js'],
        'deps/chunk-B.js': tempFiles['/deps_temp/chunk-B.js'],
        'deps/nested/chunk-C.js': tempFiles['/deps_temp/nested/chunk-C.js'],
      };

      // Read a file directly from the REAL OPFS mirror.
      async function readMirror(rel: string): Promise<string> {
        let dir = await navigator.storage.getDirectory();
        dir = await dir.getDirectoryHandle(MIRROR_DIRNAME);
        const parts = rel.split('/');
        const fname = parts.pop()!;
        for (const seg of parts) dir = await dir.getDirectoryHandle(seg);
        const fh = await dir.getFileHandle(fname);
        return await (await fh.getFile()).text();
      }

      // The mirror is async (debounce + worker queue + ~120ms rename retry on a
      // never-mirrored source dir), so poll until it settles.
      async function waitForMirror(rel: string, want: string, timeoutMs: number) {
        const deadline = performance.now() + timeoutMs;
        let last = 'never read';
        while (performance.now() < deadline) {
          try {
            const got = await readMirror(rel);
            if (got === want) return { ok: true, last: 'match' };
            last = `content mismatch (got ${JSON.stringify(got)})`;
          } catch (e: any) {
            last = e?.name || String(e);
          }
          await new Promise((r) => setTimeout(r, 50));
        }
        return { ok: false, last };
      }

      const mirror: Record<string, { ok: boolean; last: string }> = {};
      for (const [rel, want] of Object.entries(expected)) {
        mirror[rel] = await waitForMirror(rel, want, 8000);
      }

      // The old temp dir must NOT exist in the mirror after the rename.
      let tempGone = true;
      try {
        let dir = await navigator.storage.getDirectory();
        dir = await dir.getDirectoryHandle(MIRROR_DIRNAME);
        await dir.getDirectoryHandle('deps_temp');
        tempGone = false; // still present → bad
      } catch { /* expected: not found */ }

      return { env, vfsOk, mirror, tempGone };
    });

    console.log('environment:', JSON.stringify(report.env));
    console.log('mirror results:', JSON.stringify(report.mirror, null, 2));

    expect(report.env.crossOriginIsolated, 'server must set COOP/COEP').toBe(true);
    expect(report.vfsOk, 'VFS rename moved the whole subtree').toBe(true);
    for (const [rel, res] of Object.entries(report.mirror)) {
      expect(res.ok, `mirror is missing/incorrect for ${rel}: ${res.last}`).toBe(true);
    }
    expect(report.tempGone, 'old temp dir must not remain in the mirror').toBe(true);
    expect(consoleErrors, `no console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
