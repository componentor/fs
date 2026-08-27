#!/usr/bin/env node
/**
 * Generate `sync-opfs/readme.md` from the root `readme.md`.
 *
 * The two packages are the same code under two names, so they get the same readme — anyone who
 * finds `sync-opfs` on npm should see everything, not a stub pointing elsewhere. Keeping that by
 * hand guarantees drift: the root readme changes every release and the alias copy quietly stops
 * matching. So the alias copy is generated, and `npm run release` regenerates it.
 *
 * Two things have to change on the way across, and nothing else:
 *
 * 1. **Links must become absolute.** The alias tarball ships five files and a readme — no `docs/`,
 *    no `src/`, no `examples/`. Every relative link would 404 on npm, so repo-relative targets are
 *    rewritten to `blob/main` URLs and the screenshot to a `raw.githubusercontent.com` one.
 *    In-page anchors are left alone; they resolve against the rendered page either way.
 * 2. **The install line and imports use the alias name**, because that is the package the reader
 *    just installed.
 *
 * Everything else — the title, the prose, the structure — is copied verbatim. Edit `readme.md`
 * and rerun; this script has no opinions of its own to reapply on top of yours.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BLOB = 'https://github.com/componentor/fs/blob/main/';
const RAW = 'https://raw.githubusercontent.com/componentor/fs/main/';

let s = readFileSync(join(root, 'readme.md'), 'utf8');

// 1. Repo-relative links → absolute. Anchors, http(s) and mailto are already fine.
s = s.replace(/\]\(([^)]+)\)/g, (whole, target) => {
  if (/^(https?:|#|mailto:)/.test(target)) return whole;
  const clean = target.replace(/^\.\//, '');
  return `](${(clean.startsWith('assets/') ? RAW : BLOB) + clean})`;
});

// 2a. The install line names BOTH packages, so the blanket rename below would hit it twice and
//     leave it offering `sync-opfs` "or" `sync-opfs`. Swap the pair first, in one move.
s = s.replace(
  'npm install @componentor/fs      # or: npm install sync-opfs — same package, two names',
  'npm install sync-opfs            # or: npm install @componentor/fs — same package, two names',
);

// 2. The reader installed `sync-opfs`; show them that name.
s = s.replace(/from '@componentor\/fs'/g, "from 'sync-opfs'");
s = s.replace(/npm install @componentor\/fs/g, 'npm install sync-opfs');
s = s.replace(/pnpm add @componentor\/fs/g, 'pnpm add sync-opfs');
s = s.replace(/yarn add @componentor\/fs/g, 'yarn add sync-opfs');

writeFileSync(join(root, 'sync-opfs', 'readme.md'), s);
console.log(`sync-opfs/readme.md regenerated from readme.md (${s.split('\n').length} lines)`);
