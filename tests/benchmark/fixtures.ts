/**
 * Shared Playwright fixtures for the correctness specs.
 *
 * WebKit quirk: in EPHEMERAL browsing contexts (Playwright's default),
 * OPFS `createSyncAccessHandle()` fails with "the operation failed for an
 * unknown transient reason" — sync access handles appear to require
 * disk-backed storage. Real Safari hits the same wall in private browsing.
 * So on WebKit the specs run in a persistent context backed by a temp
 * profile directory; Chromium/Firefox keep the default ephemeral context.
 */

import { test as base, webkit, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Release every filesystem the page created, before the page is torn down.
 *
 * Each instance owns an OPFS mirror worker holding a **recursive `FileSystemObserver`**, and a
 * page destroyed with one still attached makes Chromium abort the entire browser process —
 * `FATAL: Detected dangling raw_ptr` — which kills whichever test happens to be next and shows
 * up as an unrelated flake. Confirmed by construction: disabling the observer removes the crash
 * completely, restoring it brings it back within a few specs.
 *
 * `pagehide` cannot fix this on its own — it can post the shutdown message but not wait for it —
 * so the harness detaches explicitly while the page is still running.
 */
async function releaseFilesystems(page: Page): Promise<void> {
  // Every page in the context, not just the fixture's own: the multi-tab specs open further
  // pages, each with its own instance and its own observer, and any one of them left attached is
  // enough to take the browser down at teardown.
  const pages = (() => { try { return page.context().pages(); } catch { return [page]; } })();
  await Promise.all(pages.map((p) => releaseOne(p)));
}

async function releaseOne(page: Page): Promise<void> {
  try {
    await page.evaluate(async () => {
      // Any copy of the module will do — the registry is shared on `globalThis` — but the page
      // may have loaded it from either URL, and importing one that was never served 404s.
      for (const url of ['/index.js', '/vendor/index.js']) {
        try {
          const mod = await import(/* @vite-ignore */ url) as { disposeAll?: () => Promise<void> };
          await mod.disposeAll?.();
          return;
        } catch { /* not this one */ }
      }
    });
  } catch { /* page already gone, or never loaded the library */ }
}

export const test = base.extend<{ page: Page }>({
  page: async ({ browserName, page, baseURL }, use) => {
    if (browserName !== 'webkit') {
      await use(page);
      await releaseFilesystems(page);
      return;
    }
    const profileDir = mkdtempSync(join(tmpdir(), 'vfs-webkit-profile-'));
    const ctx = await webkit.launchPersistentContext(profileDir, { baseURL });
    const persistentPage = await ctx.newPage();
    try {
      await use(persistentPage);
      await releaseFilesystems(persistentPage);
    } finally {
      await ctx.close();
      rmSync(profileDir, { recursive: true, force: true });
    }
  },
});

export { expect } from '@playwright/test';
