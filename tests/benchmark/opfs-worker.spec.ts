/**
 * Head-to-head against `opfs-worker`, the closest comparable library.
 *
 * The main benchmark page measures against LightningFS (IndexedDB) and memfs (pure memory).
 * Neither is really a peer: one is a different storage backend, the other never persists.
 * `opfs-worker` is the like-for-like case — a Node-style `fs` API over OPFS, running the work
 * in a worker, same as this library. So it is the one comparison that says something about the
 * design rather than about the storage medium.
 *
 * Two things are held fixed so the numbers mean something:
 *
 *   • **Async is compared against async.** `opfs-worker` has no synchronous API, so its facade
 *     is timed against `fs.promises`, not against `fs.*Sync`. The sync column is printed
 *     separately and is not part of the comparison — it is a capability the other library does
 *     not have, not a faster way of doing the same thing.
 *   • **Both of our storage modes are shown.** `vfs` is the fast path; `hybrid` is the default
 *     and additionally mirrors every mutation into real OPFS files, which costs sustained
 *     throughput (see the readme's cost section). Reporting only `vfs` would be picking the
 *     flattering half of our own configuration.
 *
 * Everything runs in one browser context against real OPFS, back to back, in the same page.
 * Each library is warmed up before timing, so worker startup is not charged to the first call.
 *
 * Two mappings are not identical calls, and are worth knowing when reading the table:
 *
 *   • `exists` — `opfs-worker` has `exists()`; `fs.promises` does not, because node's does not
 *     either, so it is timed as `access()` on a path that is present (the same lookup, minus
 *     the boolean). The throwing path is not measured, which would favour neither side.
 *   • `rename` — OPFS has no rename primitive, so a library working directly on OPFS files has
 *     to copy and delete. Ours renames an entry in the VFS index. The gap there is a
 *     consequence of the storage design, not of tighter code.
 *
 * Run: npx playwright test opfs-worker --project=chromium
 */
import { test } from './fixtures';

/** Pinned so a competitor release cannot silently change the numbers. */
const OPFS_WORKER = 'https://esm.sh/opfs-worker@2.2.1';

interface Timings { [op: string]: number }

/** Iteration counts — enough to be stable, low enough that OPFS writes finish in time. */
const N = { create: 150, overwrite: 150, read: 300, stat: 400, exists: 400, readdir: 60, mkdir: 100, rename: 100, unlink: 100, append: 100 };

test.describe('vs opfs-worker', () => {
  test.setTimeout(300_000);

  test('like-for-like async comparison against real OPFS', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto('/correctness.html');

    const results = await page.evaluate(async ({ url, counts }) => {
      const time = async (fn: (i: number) => Promise<unknown>, n: number) => {
        const t0 = performance.now();
        for (let i = 0; i < n; i++) await fn(i);
        return (performance.now() - t0) / n;
      };
      const timeSync = (fn: (i: number) => unknown, n: number) => {
        const t0 = performance.now();
        for (let i = 0; i < n; i++) fn(i);
        return (performance.now() - t0) / n;
      };

      const body = 'x'.repeat(1024);
      const out: { label: string; timings: Timings; error?: string }[] = [];

      // ---- competitor: opfs-worker -------------------------------------------------
      let owError: string | undefined;
      const owTimings: Timings = {};
      try {
        const mod: any = await import(/* @vite-ignore */ url);
        const create = mod.createOPFS ?? mod.default?.createOPFS;
        if (typeof create !== 'function') throw new Error('createOPFS not found in ' + Object.keys(mod).join(','));

        const fs = create({ root: '/bench-ow-' + Date.now() });
        // Warm up: the first call pays worker startup, which is not what we are measuring.
        await fs.mkdir('/w', { recursive: true });
        await fs.writeFile('/w/warm.txt', body);
        await fs.readFile('/w/warm.txt', 'utf8');

        let a = 0;
        owTimings.create = await time((i) => fs.writeFile(`/w/c${i}.txt`, body), counts.create);
        owTimings.overwrite = await time(() => fs.writeFile('/w/warm.txt', body), counts.overwrite);
        owTimings.read = await time(() => fs.readFile('/w/warm.txt', 'utf8'), counts.read);
        owTimings.stat = await time(() => fs.stat('/w/warm.txt'), counts.stat);
        owTimings.exists = await time(() => fs.exists('/w/warm.txt'), counts.exists);
        owTimings.readdir = await time(() => fs.readDir('/w'), counts.readdir);
        owTimings.mkdir = await time((i) => fs.mkdir(`/w/d${i}`, { recursive: true }), counts.mkdir);
        owTimings.append = await time(() => fs.appendFile('/w/app.txt', 'z'), counts.append);
        owTimings.rename = await time((i) => fs.rename(`/w/c${i}.txt`, `/w/r${i}.txt`), counts.rename);
        owTimings.unlink = await time((i) => fs.unlink(`/w/r${a++}.txt`), counts.unlink);

        fs.dispose?.();
      } catch (e) {
        owError = (e as Error).message;
      }
      out.push({ label: 'opfs-worker (async)', timings: owTimings, error: owError });

      // ---- this library, both modes ------------------------------------------------
      const mod: any = await import('/index.js');

      for (const mode of ['vfs', 'hybrid'] as const) {
        const rootDir = '/bench-vfs-' + mode + '-' + Date.now();
        try {
          const root = await navigator.storage.getDirectory();
          await root.removeEntry(rootDir.slice(1), { recursive: true });
        } catch { /* fresh */ }

        const fs = new mod.VFSFileSystem({ root: rootDir, mode });
        await fs.init();

        // --- promises API: the like-for-like column ---
        const p = fs.promises;
        await p.mkdir('/w', { recursive: true });
        await p.writeFile('/w/warm.txt', body);
        await p.readFile('/w/warm.txt', 'utf8');

        const t: Timings = {};
        let a = 0;
        t.create = await time((i) => p.writeFile(`/w/c${i}.txt`, body), counts.create);
        t.overwrite = await time(() => p.writeFile('/w/warm.txt', body), counts.overwrite);
        t.read = await time(() => p.readFile('/w/warm.txt', 'utf8'), counts.read);
        t.stat = await time(() => p.stat('/w/warm.txt'), counts.stat);
        t.exists = await time(async () => { try { await p.access('/w/warm.txt'); return true; } catch { return false; } }, counts.exists);
        t.readdir = await time(() => p.readdir('/w'), counts.readdir);
        t.mkdir = await time((i) => p.mkdir(`/w/d${i}`, { recursive: true }), counts.mkdir);
        t.append = await time(() => p.appendFile('/w/app.txt', 'z'), counts.append);
        t.rename = await time((i) => p.rename(`/w/c${i}.txt`, `/w/r${i}.txt`), counts.rename);
        t.unlink = await time((i) => p.unlink(`/w/r${a++}.txt`), counts.unlink);
        out.push({ label: `@componentor/fs promises (${mode})`, timings: t });

        // --- sync API: reported, not compared ---
        const s: Timings = {};
        fs.mkdirSync('/s', { recursive: true });
        fs.writeFileSync('/s/warm.txt', body);
        let b = 0;
        s.create = timeSync((i) => fs.writeFileSync(`/s/c${i}.txt`, body), counts.create);
        s.overwrite = timeSync(() => fs.writeFileSync('/s/warm.txt', body), counts.overwrite);
        s.read = timeSync(() => fs.readFileSync('/s/warm.txt', 'utf8'), counts.read);
        s.stat = timeSync(() => fs.statSync('/s/warm.txt'), counts.stat);
        s.exists = timeSync(() => fs.existsSync('/s/warm.txt'), counts.exists);
        s.readdir = timeSync(() => fs.readdirSync('/s'), counts.readdir);
        s.mkdir = timeSync((i) => fs.mkdirSync(`/s/d${i}`, { recursive: true }), counts.mkdir);
        s.append = timeSync(() => fs.appendFileSync('/s/app.txt', 'z'), counts.append);
        s.rename = timeSync((i) => fs.renameSync(`/s/c${i}.txt`, `/s/r${i}.txt`), counts.rename);
        s.unlink = timeSync((i) => fs.unlinkSync(`/s/r${b++}.txt`), counts.unlink);
        out.push({ label: `@componentor/fs sync (${mode})`, timings: s });
      }

      return out;
    }, { url: OPFS_WORKER, counts: N });

    // ---- report -------------------------------------------------------------------
    const ops = Object.keys(N);
    const competitor = results.find(r => r.label.startsWith('opfs-worker'));

    if (competitor?.error) {
      console.log(`\n  ⚠  opfs-worker did not load: ${competitor.error}`);
      console.log('     (needs network access to esm.sh — the columns below are ours only)\n');
    }

    const label = (s: string) => s.padEnd(34);
    const cell = (ms: number | undefined) =>
      ms === undefined ? '        —' : `${ms.toFixed(4).padStart(9)}`;

    console.log('\n  ── per-operation cost, ms (lower is better) ──\n');
    console.log(`  ${label('')}${ops.map(o => o.padStart(10)).join('')}`);
    for (const r of results) {
      console.log(`  ${label(r.label)}${ops.map(o => cell(r.timings[o]).padStart(10)).join('')}`);
    }

    // Speed ratios, competitor / ours — only for the like-for-like async pairing.
    if (competitor && !competitor.error) {
      for (const mode of ['vfs', 'hybrid']) {
        const mine = results.find(r => r.label === `@componentor/fs promises (${mode})`);
        if (!mine) continue;
        console.log(`\n  ── @componentor/fs promises (${mode}) vs opfs-worker ──`);
        for (const op of ops) {
          const theirs = competitor.timings[op];
          const ours = mine.timings[op];
          if (theirs === undefined || ours === undefined || ours === 0) continue;
          const ratio = theirs / ours;
          const verdict = ratio >= 1 ? `${ratio.toFixed(2)}× faster` : `${(1 / ratio).toFixed(2)}× SLOWER`;
          console.log(`    ${op.padEnd(12)} ${verdict}`);
        }
      }
    }

    if (pageErrors.length) console.log('\n  page errors:', pageErrors.join(' | '));
    console.log('');
  });
});
