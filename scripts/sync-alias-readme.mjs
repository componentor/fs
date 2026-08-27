#!/usr/bin/env node
/**
 * Generate `sync-opfs/readme.md` from the root `readme.md`.
 *
 * The two packages are the same code under two names, so they get the same readme — anyone who
 * finds `sync-opfs` on npm should see everything, not a stub pointing elsewhere. Keeping that by
 * hand guarantees drift: the root readme changes every release and the alias copy quietly stops
 * matching. So the alias copy is generated, and `npm run release` regenerates it.
 *
 * Three things have to change on the way across:
 *
 * 1. **Links must become absolute.** The alias tarball ships five files and a readme — no `docs/`,
 *    no `src/`, no `examples/`. Every relative link would 404 on npm, so repo-relative targets are
 *    rewritten to `blob/main` URLs and the screenshot to a `raw.githubusercontent.com` one.
 *    In-page anchors are left alone; they resolve against the rendered page either way.
 * 2. **The install line and imports use the alias name**, because that is the package the reader
 *    just installed.
 * 3. **A banner up top says the two names are the same package**, so nobody has to wonder whether
 *    they picked the wrong one, or ends up depending on both.
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

// 2. The reader installed `sync-opfs`; show them that name.
s = s.replace(/from '@componentor\/fs'/g, "from 'sync-opfs'");
s = s.replace(/npm install @componentor\/fs/g, 'npm install sync-opfs');
s = s.replace(/pnpm add @componentor\/fs/g, 'pnpm add sync-opfs');
s = s.replace(/yarn add @componentor\/fs/g, 'yarn add sync-opfs');

// 2b. The "also published as" pointer has to face the other way in the alias copy, or it
//     tells the reader to install the package they are already reading about.
s = s.replace(
  "The same package is also published as [`sync-opfs`](https://www.npmjs.com/package/sync-opfs) if\nyou prefer that name: `npm install sync-opfs`.",
  "The same package is also published as\n[`@componentor/fs`](https://www.npmjs.com/package/@componentor/fs), which is the canonical name:\n`npm install @componentor/fs`.",
);

// 3. The banner, immediately after the badge block.
const banner = `
> **\`sync-opfs\` and [\`@componentor/fs\`](https://www.npmjs.com/package/@componentor/fs) are the
> same package under two names** — same code, same version, published together. Install whichever
> name you prefer; you never need both. The canonical package is
> [\`@componentor/fs\`](https://www.npmjs.com/package/@componentor/fs), and the source, issues and
> full docs live at [github.com/componentor/fs](https://github.com/componentor/fs).
`;
const marker = '[![types: included]';
const lineEnd = s.indexOf('\n', s.indexOf(marker));
s = s.slice(0, lineEnd + 1) + banner + s.slice(lineEnd + 1);

writeFileSync(join(root, 'sync-opfs', 'readme.md'), s);
console.log(`sync-opfs/readme.md regenerated from readme.md (${s.split('\n').length} lines)`);
