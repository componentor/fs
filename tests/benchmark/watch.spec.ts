/**
 * `fs.watch` / `fs.watchFile` behaviour, in real browsers.
 *
 * These are contract tests, not differential ones, and deliberately so. Node's own `watch`
 * event stream is platform-dependent to the point of being untestable by comparison: on macOS,
 * creating, modifying and deleting one file in a watched directory produces
 * `["change:<dirname>", "rename:a.txt", "rename:a.txt", "rename:a.txt"]` — a `rename` for a pure
 * content change, plus an event naming the directory itself. Linux and Windows differ again.
 * Node documents this ("the behaviour is somewhat platform-specific... not always accurate") and
 * asserting an exact sequence would pin one platform's quirks rather than the contract.
 *
 * So these check what is actually promised and what callers rely on: that a watcher observes
 * changes in the directory it watches, names the entry involved, honours `recursive`, respects
 * the requested filename encoding, and stops delivering when closed or aborted.
 *
 * Watching is instance-level and coordinates across tabs over a BroadcastChannel, so a browser
 * is the only place it can be exercised at all — this is its first coverage of any kind.
 */

import { test, expect } from './fixtures';

test.describe('watch', () => {
  test.setTimeout(120_000);

  test('observes creates, changes and deletes in a watched directory', async ({ page }) => {
    await page.goto('/correctness.html');

    const report = await page.evaluate(async () => {
      try {
        const opfsRoot = await navigator.storage.getDirectory();
        await opfsRoot.removeEntry('ct-watch', { recursive: true });
      } catch { /* didn't exist */ }
      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: '/ct-watch' });
      await fs.init();
      try { await fs.promises.rm('/', { recursive: true, force: true }); } catch { /* fresh */ }

      const failures: string[] = [];
      const check = (cond: boolean, label: string) => { if (!cond) failures.push(label); };
      /** Events are delivered asynchronously; give the channel a turn to drain. */
      const settle = () => new Promise((r) => setTimeout(r, 100));

      fs.mkdirSync('/dir');

      // ---- basic delivery ----
      const seen: string[] = [];
      const w = fs.watch('/dir', (event: string, filename: string) => {
        seen.push(`${event}:${filename}`);
      });

      fs.writeFileSync('/dir/a.txt', 'one');
      await settle();
      check(seen.some((e) => e.endsWith(':a.txt')), `create should name a.txt, saw ${JSON.stringify(seen)}`);

      seen.length = 0;
      fs.writeFileSync('/dir/a.txt', 'two-longer');
      await settle();
      check(seen.some((e) => e.endsWith(':a.txt')), `modify should name a.txt, saw ${JSON.stringify(seen)}`);
      check(seen.some((e) => e.startsWith('change:')), `modify should report a change event, saw ${JSON.stringify(seen)}`);

      seen.length = 0;
      fs.unlinkSync('/dir/a.txt');
      await settle();
      check(seen.some((e) => e.endsWith(':a.txt')), `delete should name a.txt, saw ${JSON.stringify(seen)}`);
      check(seen.some((e) => e.startsWith('rename:')), `delete should report a rename event, saw ${JSON.stringify(seen)}`);

      // ---- close() stops delivery ----
      w.close();
      seen.length = 0;
      fs.writeFileSync('/dir/after-close.txt', 'x');
      await settle();
      check(seen.length === 0, `close() must stop delivery, saw ${JSON.stringify(seen)}`);

      // ---- non-recursive ignores nested changes ----
      fs.mkdirSync('/dir/nested');
      const shallow: string[] = [];
      const w2 = fs.watch('/dir', (e: string, f: string) => shallow.push(`${e}:${f}`));
      fs.writeFileSync('/dir/nested/deep.txt', 'x');
      await settle();
      const sawDeepShallow = shallow.some((e) => e.includes('deep.txt'));
      w2.close();

      // ---- recursive sees them ----
      const deep: string[] = [];
      const w3 = fs.watch('/dir', { recursive: true }, (e: string, f: string) => deep.push(`${e}:${f}`));
      fs.writeFileSync('/dir/nested/deep2.txt', 'x');
      await settle();
      check(deep.some((e) => e.includes('deep2.txt')), `recursive should see nested writes, saw ${JSON.stringify(deep)}`);
      w3.close();

      // ---- encoding: 'buffer' yields bytes, not a string ----
      const bufNames: unknown[] = [];
      const w4 = fs.watch('/dir', { encoding: 'buffer' }, (_e: string, f: unknown) => bufNames.push(f));
      fs.writeFileSync('/dir/buf.txt', 'x');
      await settle();
      w4.close();
      check(bufNames.length > 0, 'buffer-encoded watcher should have fired');
      check(bufNames.every((n) => n instanceof Uint8Array), `filenames should be Uint8Array, got ${bufNames.map((n) => typeof n).join(',')}`);

      // ---- AbortSignal stops delivery ----
      const ctrl = new AbortController();
      const aborted: string[] = [];
      fs.watch('/dir', { signal: ctrl.signal }, (e: string, f: string) => aborted.push(`${e}:${f}`));
      ctrl.abort();
      fs.writeFileSync('/dir/after-abort.txt', 'x');
      await settle();
      check(aborted.length === 0, `aborted watcher must not fire, saw ${JSON.stringify(aborted)}`);

      // ---- watching a single file ----
      fs.writeFileSync('/dir/single.txt', 'v1');
      const single: string[] = [];
      const w5 = fs.watch('/dir/single.txt', (e: string, f: string) => single.push(`${e}:${f}`));
      fs.writeFileSync('/dir/single.txt', 'v2');
      await settle();
      w5.close();
      check(single.length > 0, 'watching a file should report its own changes');

      // ---- watchFile / unwatchFile poll for stat changes ----
      fs.writeFileSync('/dir/polled.txt', 'a');
      let polls = 0;
      fs.watchFile('/dir/polled.txt', { interval: 20 }, (curr: any, prev: any) => {
        if (curr.size !== prev.size) polls++;
      });
      fs.writeFileSync('/dir/polled.txt', 'much longer content');
      await new Promise((r) => setTimeout(r, 300));
      fs.unwatchFile('/dir/polled.txt');
      const pollsSeen = polls;
      polls = 0;
      fs.writeFileSync('/dir/polled.txt', 'changed again after unwatch');
      await new Promise((r) => setTimeout(r, 200));
      check(pollsSeen > 0, 'watchFile should report a size change');
      check(polls === 0, 'unwatchFile should stop the poller');

      return { failures, sawDeepShallow };
    });

    expect(report.failures, `failures: ${report.failures.join(' | ')}`).toEqual([]);
    // Recorded rather than asserted: Node's non-recursive watch does report some nested activity
    // on several platforms, so requiring silence here would pin a quirk rather than a contract.
    console.log(`  non-recursive watcher saw nested write: ${report.sawDeepShallow}`);
  });
});
