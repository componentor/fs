/**
 * Browser regression sweep for the fixes in 3.3.6–3.3.8.
 *
 * Those bugs were all found and fixed against an in-memory handle in Node. That proves the
 * layouts agree, but not that the *shipped* path agrees: the real request crosses a
 * SharedArrayBuffer to the sync relay, or a postMessage to the async relay, and lands on real
 * OPFS. This runs each fixed behaviour through that whole stack, in real browsers.
 *
 * Covered:
 *  - truncate/ftruncate to a non-zero length (used to zero the file: float64 length read as u32)
 *  - await fileHandle.truncate(n) (used to reject EINVAL: async relay encoded an 8-byte frame)
 *  - append growth across block boundaries (rewritten to write in place when the run has room)
 *  - rm on a directory without recursive (used to delete it; Node throws ERR_FS_EISDIR)
 *  - readdir names-only fast path, including multi-byte names
 *  - mkdir/open mode plumbing end to end
 */

import { test, expect } from './fixtures';

test.describe('regression sweep (3.3.6–3.3.8 fixes)', () => {
  test.setTimeout(120_000);

  test('fixed behaviours hold through the real relay and OPFS', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/correctness.html');

    const report = await page.evaluate(async () => {
      // Start from clean storage — OPFS persists across runs in some engines.
      try {
        const opfsRoot = await navigator.storage.getDirectory();
        await opfsRoot.removeEntry('ct-regressions', { recursive: true });
      } catch { /* didn't exist */ }

      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: '/ct-regressions' });
      await fs.init();
      try { await fs.promises.rm('/', { recursive: true, force: true }); } catch { /* fresh */ }

      const failures: string[] = [];
      const check = (cond: boolean, label: string) => { if (!cond) failures.push(label); };

      // ---- truncate to a non-zero length ----
      fs.writeFileSync('/t.txt', 'abcdef');
      fs.truncateSync('/t.txt', 4);
      check(fs.readFileSync('/t.txt', 'utf8') === 'abcd', 'truncateSync(4) should leave "abcd"');
      check(fs.statSync('/t.txt').size === 4, 'truncateSync(4) size should be 4');

      // Grow: the tail must read back as zeros, not stale bytes.
      fs.truncateSync('/t.txt', 8);
      const grown = fs.readFileSync('/t.txt');
      check(grown.length === 8, 'truncate grow length');
      check(grown[4] === 0 && grown[7] === 0, 'truncate grow zero-fills');

      // ---- ftruncate (sync fd) ----
      fs.writeFileSync('/ft.txt', 'abcdef');
      const fd = fs.openSync('/ft.txt', 'r+');
      fs.ftruncateSync(fd, 3);
      fs.closeSync(fd);
      check(fs.readFileSync('/ft.txt', 'utf8') === 'abc', 'ftruncateSync(3) should leave "abc"');

      // ---- await fileHandle.truncate() — went through a different encoder ----
      await fs.promises.writeFile('/fh.txt', 'abcdef');
      const fh = await fs.promises.open('/fh.txt', 'r+');
      await fh.truncate(2);
      await fh.close();
      check(await fs.promises.readFile('/fh.txt', 'utf8') === 'ab', 'fileHandle.truncate(2) should leave "ab"');

      // ---- append across block boundaries (4 KB blocks) ----
      fs.writeFileSync('/log.txt', 'a'.repeat(4090));
      fs.appendFileSync('/log.txt', 'b'.repeat(12));    // crosses 4096
      fs.appendFileSync('/log.txt', 'c'.repeat(9000));  // crosses several
      fs.appendFileSync('/log.txt', 'd');               // back in place
      const log = fs.readFileSync('/log.txt', 'utf8');
      check(log.length === 4090 + 12 + 9000 + 1, 'append total length');
      check(log.slice(0, 4090) === 'a'.repeat(4090), 'append preserved the original bytes');
      check(log.slice(4090, 4102) === 'b'.repeat(12), 'append preserved the boundary-crossing chunk');
      check(log.endsWith('d'), 'append preserved the final in-place byte');

      // Appending after a shrink must not resurrect the discarded tail.
      fs.writeFileSync('/s.txt', 'x'.repeat(3000));
      fs.truncateSync('/s.txt', 10);
      fs.appendFileSync('/s.txt', 'END');
      check(fs.readFileSync('/s.txt', 'utf8') === 'x'.repeat(10) + 'END', 'append after shrink');

      // ---- rm requires recursive for directories ----
      fs.mkdirSync('/emptydir');
      let rmCode = 'no-throw';
      try { fs.rmSync('/emptydir'); } catch (e: any) { rmCode = e.code; }
      check(rmCode === 'ERR_FS_EISDIR', `rm(dir) should throw ERR_FS_EISDIR, got ${rmCode}`);
      check(fs.existsSync('/emptydir'), 'rm(dir) must not have removed it');
      fs.rmSync('/emptydir', { recursive: true });
      check(!fs.existsSync('/emptydir'), 'rm(dir, {recursive}) should remove it');

      // ---- readdir fast path, including multi-byte names ----
      fs.mkdirSync('/d');
      const names = ['plain.txt', 'héllo.txt', '世界.txt', '😀.txt', 'z-last'];
      for (const n of names) fs.writeFileSync(`/d/${n}`, '');
      const listed = [...fs.readdirSync('/d')].sort();
      check(JSON.stringify(listed) === JSON.stringify([...names].sort()),
        `readdir names mismatch: ${JSON.stringify(listed)}`);
      const typed = fs.readdirSync('/d', { withFileTypes: true }).map((e: any) => e.name).sort();
      check(JSON.stringify(typed) === JSON.stringify(listed), 'withFileTypes must list the same names');

      // ---- mode plumbing ----
      fs.mkdirSync('/priv', { mode: 0o700 });
      check((fs.statSync('/priv').mode & 0o777) === 0o700, 'mkdir mode 0700');
      fs.mkdirSync('/pub');
      check((fs.statSync('/pub').mode & 0o777) === 0o755, 'mkdir default mode 0755');
      const tmp = fs.mkdtempSync('/tmp-');
      check((fs.statSync(tmp).mode & 0o777) === 0o700, 'mkdtemp is private (0700)');
      fs.writeFileSync('/m.txt', 'x', { mode: 0o600 });
      check((fs.statSync('/m.txt').mode & 0o777) === 0o600, 'writeFile mode 0600');
      // An octal string mode must be parsed as octal, not coerced to decimal.
      fs.mkdirSync('/strmode', { mode: '0700' });
      check((fs.statSync('/strmode').mode & 0o777) === 0o700, 'mkdir octal-string mode');

      // ---- statfs reports the real volume, in both modes ----
      const stEmpty = fs.statfsSync('/');
      check(stEmpty.bsize === 4096, `statfs bsize ${stEmpty.bsize}`);
      check(stEmpty.blocks > 0, 'statfs should report a block count');
      fs.writeFileSync('/stat-big.bin', 'q'.repeat(4096 * 40));
      const stFull = fs.statfsSync('/');
      check(stFull.bfree !== stEmpty.bfree, 'statfs free blocks must move when data is written');
      check(stFull.bavail === stFull.bfree, 'bavail should mirror bfree');
      const stAsync = await fs.promises.statfs('/');
      check(stAsync.bfree === fs.statfsSync('/').bfree, 'promises.statfs should agree with the sync form');

      // ---- encoding parity ----
      fs.writeFileSync('/hex.bin', '4142', 'hex');
      const hexBytes = fs.readFileSync('/hex.bin');
      check(hexBytes.length === 2 && hexBytes[0] === 0x41 && hexBytes[1] === 0x42, 'hex encoding writes bytes');
      fs.writeFileSync('/b64.bin', 'aGVsbG8', 'base64');  // unpadded: atob would have thrown
      check(fs.readFileSync('/b64.bin', 'utf8') === 'hello', 'unpadded base64 decodes');
      let encErr = 'no-throw';
      try { fs.writeFileSync('/bad.bin', 'x', 'utf9' as any); } catch (e: any) { encErr = e.code; }
      check(encErr === 'ERR_INVALID_ARG_VALUE', `invalid encoding should throw, got ${encErr}`);

      return { failures };
    });

    expect(report.failures, `failures: ${report.failures.join(' | ')}`).toEqual([]);
    expect(consoleErrors.filter((e) => !e.includes('favicon'))).toEqual([]);
  });
});
