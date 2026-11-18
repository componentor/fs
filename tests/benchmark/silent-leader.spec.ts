/**
 * A leader that stops answering, in a real browser, without crossOriginIsolated (promises only: the mode
 * of an app served without COOP/COEP, which is where it was found).
 *
 * Tab A becomes leader and writes. Then A's relay workers stop (as when they crash, or a stale page's
 * workers are gone): the page lives on and keeps the leader lock, but nothing answers. Tab B starts as A's
 * follower. Before 4.3.6 B's first promise call never settled, so an app waiting for it stayed blank. Now:
 *  - B's calls settle (EIO, outcome unknown) instead of hanging;
 *  - B, finding the leader silent, takes the lock over (A's page, its lock taken, steps down), opens the
 *    volume, and its calls succeed as the leader, with A's data.
 *
 * (Freezing the page through the DevTools protocol does not do it: Chrome freezes the page, not its
 * workers, and the leader's relay goes on answering.)
 */

import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';

const PORT = 3150;
const BASE = `http://localhost:${PORT}`;
let server: ChildProcess | null = null;

test.beforeAll(async () => {
  server = spawn(process.execPath, ['tests/benchmark/server.js', '--no-coep'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/correctness.html')).ok) return; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('test server did not start');
});
test.afterAll(() => { server?.kill(); });

test.describe('a leader that stops answering (no crossOriginIsolated)', () => {
  test.setTimeout(180_000);

  test('the follower never hangs, takes over, and reads the data as the new leader', async ({ browser, browserName }) => {
    // (WebKit fails before the test begins: opening OPFS in a fresh context without COOP/COEP throws
    // "UnknownError" at the first `getDirectory`. A separate matter; Chromium and Firefox cover the path.)
    test.skip(browserName === 'webkit', 'OPFS setup fails in a fresh non-isolated WebKit context');
    const context = await browser.newContext();
    const a = await context.newPage();
    await a.goto(BASE + '/correctness.html');
    expect(await a.evaluate(() => crossOriginIsolated)).toBe(false);
    await a.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      try { await root.removeEntry('silent-spec', { recursive: true }); } catch { /* fresh */ }
      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: '/silent-spec' });
      await fs.init();
      await fs.promises.writeFile('/from-a.txt', new TextEncoder().encode('from tab A'));
      (self as any).__fs = fs;
    });

    // A's relays stop; its page and its lock remain
    await a.evaluate(() => { const fs = (self as any).__fs; fs.syncWorker.terminate(); fs.asyncWorker.terminate(); });

    const b = await context.newPage();
    await b.goto(BASE + '/correctness.html');
    // B's first call settles quickly instead of hanging
    const first = await b.evaluate(async () => {
      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: '/silent-spec' });
      await fs.init();
      (self as any).__fs = fs;
      const started = Date.now();
      const out = await Promise.race([
        fs.promises.readFile('/from-a.txt').then((v: Uint8Array) => 'read:' + new TextDecoder().decode(v), (e: any) => 'error:' + (e?.code || e?.message)),
        new Promise(r => setTimeout(() => r('HUNG'), 15_000)),
      ]);
      return { out, ms: Date.now() - started };
    });
    expect(first.out).not.toBe('HUNG');
    expect(first.out).toBe('error:EIO');

    // B keeps asking; every call settles, and within the takeover window one reads as the new leader
    const after = await b.evaluate(async () => {
      const fs = (self as any).__fs;
      const tries: string[] = [];
      const until = Date.now() + 45_000;
      while (Date.now() < until) {
        const r = await Promise.race([
          fs.promises.readFile('/from-a.txt').then((v: Uint8Array) => 'read:' + new TextDecoder().decode(v), (e: any) => 'error:' + (e?.code || e?.message)),
          new Promise(res => setTimeout(() => res('HUNG'), 15_000)),
        ]) as string;
        tries.push(r);
        if (r.startsWith('read:') || r === 'HUNG') break;
        await new Promise(res => setTimeout(res, 1000));
      }
      return tries;
    });
    expect(after).not.toContain('HUNG');
    expect(after.at(-1)).toBe('read:from tab A');
    const leader = await b.evaluate(() => !(self as any).__fs.isFollower);
    expect(leader).toBe(true);
    await context.close();
  });
});
