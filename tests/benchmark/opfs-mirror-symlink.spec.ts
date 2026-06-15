/**
 * End-to-end regression for symlink mirroring (fixed in 3.2.3).
 *
 * OPFS has no symlinks, so a symlink is mirrored as a regular file holding its
 * target's content (a snapshot via the following `engine.read`). Two bugs:
 *
 *   1. Dangling symlink (target missing) read ENOENT → silently never mirrored.
 *   2. The snapshot went stale: rewriting the target notified the *target's*
 *      path, not the link's, so the mirrored link kept its old content forever.
 *
 * The relay now tracks symlink→target aliases: a target write re-mirrors its
 * links, and a dangling link is mirrored as an empty placeholder that fills in
 * once the target appears.
 *
 * Verified against the dist build with the real OPFS mirror.
 */

import { test, expect } from './fixtures';

test.describe('OPFS mirror — symlinks', () => {
  test.setTimeout(60_000);

  test('symlink content stays in sync with its target; dangling links are mirrored', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/correctness.html');

    const report = await page.evaluate(async () => {
      const ROOT = '/vfs-mirror-symlink';
      const MIRROR_DIRNAME = 'vfs-mirror-symlink';

      try {
        const opfsRoot = await navigator.storage.getDirectory();
        await opfsRoot.removeEntry(MIRROR_DIRNAME, { recursive: true });
      } catch { /* didn't exist */ }

      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: ROOT, opfsSync: true });
      await fs.init();

      const env = {
        crossOriginIsolated: (globalThis as unknown as { crossOriginIsolated: boolean }).crossOriginIsolated,
      };
      const enc = new TextEncoder();

      async function readMirror(rel: string): Promise<string> {
        let dir = await navigator.storage.getDirectory();
        dir = await dir.getDirectoryHandle(MIRROR_DIRNAME);
        const parts = rel.split('/');
        const fname = parts.pop()!;
        for (const seg of parts) dir = await dir.getDirectoryHandle(seg);
        const fh = await dir.getFileHandle(fname);
        return await (await fh.getFile()).text();
      }
      async function waitMirror(rel: string, want: string, timeoutMs: number) {
        const deadline = performance.now() + timeoutMs;
        let last = 'never read';
        while (performance.now() < deadline) {
          try {
            const got = await readMirror(rel);
            if (got === want) return { ok: true, last: 'match' };
            last = `mismatch (got ${JSON.stringify(got)})`;
          } catch (e: any) { last = e?.name || String(e); }
          await new Promise((r) => setTimeout(r, 50));
        }
        return { ok: false, last };
      }

      // --- 1) absolute symlink: content tracks the target across updates ---
      fs.mkdirSync('/pkg', { recursive: true });
      fs.writeFileSync('/pkg/real.js', enc.encode('v1'));
      fs.symlinkSync('/pkg/real.js', '/pkg/link.js');
      const linkInitial = await waitMirror('pkg/link.js', 'v1', 8000);

      fs.writeFileSync('/pkg/real.js', enc.encode('v2-updated'));
      const linkUpdated = await waitMirror('pkg/link.js', 'v2-updated', 8000); // stale before the fix

      // --- 2) relative symlink resolves against the link's dir ---
      fs.writeFileSync('/pkg/rel-target.js', enc.encode('rel-1'));
      fs.symlinkSync('rel-target.js', '/pkg/rel-link.js');
      const relInitial = await waitMirror('pkg/rel-link.js', 'rel-1', 8000);
      fs.writeFileSync('/pkg/rel-target.js', enc.encode('rel-2'));
      const relUpdated = await waitMirror('pkg/rel-link.js', 'rel-2', 8000);

      // --- 3) dangling symlink: mirrored as an empty placeholder, then heals ---
      fs.symlinkSync('/pkg/not-yet.js', '/pkg/dangling.js');
      const danglingPlaceholder = await waitMirror('pkg/dangling.js', '', 8000); // dropped before the fix
      fs.writeFileSync('/pkg/not-yet.js', enc.encode('now-exists'));
      const danglingHealed = await waitMirror('pkg/dangling.js', 'now-exists', 8000);

      // --- 4) renaming a symlink keeps the alias tracking its target ---
      fs.writeFileSync('/pkg/mv-target.js', enc.encode('mv-1'));
      fs.symlinkSync('/pkg/mv-target.js', '/pkg/mv-link.js');
      const mvInitial = await waitMirror('pkg/mv-link.js', 'mv-1', 8000);
      fs.renameSync('/pkg/mv-link.js', '/pkg/mv-link-renamed.js');
      const mvRenamed = await waitMirror('pkg/mv-link-renamed.js', 'mv-1', 8000);
      fs.writeFileSync('/pkg/mv-target.js', enc.encode('mv-2'));
      const mvTracksAfterRename = await waitMirror('pkg/mv-link-renamed.js', 'mv-2', 8000);

      // --- 5) deleting a link's TARGET re-mirrors the link to the empty
      //        placeholder (was left holding stale deleted content) ---
      fs.writeFileSync('/pkg/del-target.js', enc.encode('present'));
      fs.symlinkSync('/pkg/del-target.js', '/pkg/del-link.js');
      const delInitial = await waitMirror('pkg/del-link.js', 'present', 8000);
      fs.unlinkSync('/pkg/del-target.js');
      const delLinkPlaceholder = await waitMirror('pkg/del-link.js', '', 8000); // stale 'present' before the fix

      // --- 6) chained symlinks: writing the deepest target updates ALL hops ---
      fs.writeFileSync('/pkg/c-file.js', enc.encode('c-1'));
      fs.symlinkSync('/pkg/c-file.js', '/pkg/c-mid.js');   // mid → file
      fs.symlinkSync('/pkg/c-mid.js', '/pkg/c-outer.js');  // outer → mid → file
      const chainInitial = await waitMirror('pkg/c-outer.js', 'c-1', 8000);
      fs.writeFileSync('/pkg/c-file.js', enc.encode('c-2'));
      const chainMidUpdated = await waitMirror('pkg/c-mid.js', 'c-2', 8000);
      const chainOuterUpdated = await waitMirror('pkg/c-outer.js', 'c-2', 8000); // stale before the cascade fix

      return {
        env, linkInitial, linkUpdated, relInitial, relUpdated,
        danglingPlaceholder, danglingHealed, mvInitial, mvRenamed, mvTracksAfterRename,
        delInitial, delLinkPlaceholder, chainInitial, chainMidUpdated, chainOuterUpdated,
      };
    });

    console.log('symlink report:', JSON.stringify(report, null, 2));

    expect(report.env.crossOriginIsolated, 'server must set COOP/COEP').toBe(true);
    expect(report.linkInitial.ok, `link initial: ${report.linkInitial.last}`).toBe(true);
    expect(report.linkUpdated.ok, `link must track target update: ${report.linkUpdated.last}`).toBe(true);
    expect(report.relInitial.ok, `relative link initial: ${report.relInitial.last}`).toBe(true);
    expect(report.relUpdated.ok, `relative link must track update: ${report.relUpdated.last}`).toBe(true);
    expect(report.danglingPlaceholder.ok, `dangling link must be mirrored: ${report.danglingPlaceholder.last}`).toBe(true);
    expect(report.danglingHealed.ok, `dangling link must heal once target appears: ${report.danglingHealed.last}`).toBe(true);
    expect(report.mvInitial.ok, `renamed link initial: ${report.mvInitial.last}`).toBe(true);
    expect(report.mvRenamed.ok, `link content present at the renamed path: ${report.mvRenamed.last}`).toBe(true);
    expect(report.mvTracksAfterRename.ok, `renamed link must still track its target: ${report.mvTracksAfterRename.last}`).toBe(true);
    expect(report.delInitial.ok, `deleted-target link initial: ${report.delInitial.last}`).toBe(true);
    expect(report.delLinkPlaceholder.ok, `deleting a target must re-mirror the link as empty placeholder: ${report.delLinkPlaceholder.last}`).toBe(true);
    expect(report.chainInitial.ok, `chained link initial: ${report.chainInitial.last}`).toBe(true);
    expect(report.chainMidUpdated.ok, `chain mid hop updated: ${report.chainMidUpdated.last}`).toBe(true);
    expect(report.chainOuterUpdated.ok, `chain outer hop must cascade-update: ${report.chainOuterUpdated.last}`).toBe(true);
    expect(consoleErrors, `no console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
