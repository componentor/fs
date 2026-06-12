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

export const test = base.extend<{ page: Page }>({
  page: async ({ browserName, page, baseURL }, use) => {
    if (browserName !== 'webkit') {
      await use(page);
      return;
    }
    const profileDir = mkdtempSync(join(tmpdir(), 'vfs-webkit-profile-'));
    const ctx = await webkit.launchPersistentContext(profileDir, { baseURL });
    const persistentPage = await ctx.newPage();
    try {
      await use(persistentPage);
    } finally {
      await ctx.close();
      rmSync(profileDir, { recursive: true, force: true });
    }
  },
});

export { expect } from '@playwright/test';
