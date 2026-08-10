/**
 * Three-stage build, because the workers are embedded in the bundles that start them.
 *
 * Order matters and is not obvious:
 *
 *   1. `opfs-sync` is bundled first. It is a **nested** worker — the sync relay starts it, not the
 *      main thread — so its source has to exist as text before the relay is bundled.
 *   2. The relays and the repair worker are bundled, with opfs-sync's text embedded in the relay.
 *   3. The main entries are bundled, with the relays' and repair's text embedded in them.
 *
 * Each stage emits a `.workertext` file that the next stage imports as a plain string (esbuild's
 * `text` loader — see the `loader` option in each tsup config). Those files are build artifacts,
 * not sources: they are generated here and gitignored.
 *
 * The embedded copies are minified even though the standalone `dist/workers/*.js` are not. Nothing
 * loads the standalone files at runtime any more — they are kept readable for debugging and for
 * anyone who wants to host them — but every byte of the embedded copy lands in the consumer's
 * bundle, so those are squeezed.
 *
 * `service.worker` is never embedded: a service worker's scope comes from the URL it was
 * registered from, so it has to stay a real file.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuildBuild, transform } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..');            // the `src` package directory
const distWorkers = join(srcRoot, '..', 'dist', 'workers');
const inlineDir = join(srcRoot, 'src', 'workers', 'inlined');

function tsup(config) {
  execFileSync('npx', ['tsup', '--config', config], { cwd: srcRoot, stdio: 'inherit' });
}

/** Minify a built worker and write it where the next stage will import it as text. */
async function embed(name) {
  const source = readFileSync(join(distWorkers, `${name}.worker.js`), 'utf8');
  const { code } = await transform(source, {
    minify: true,
    // The workers are ESM and may use top-level await; keep the format and target honest.
    format: 'esm',
    target: 'es2022',
    loader: 'js',
  });
  mkdirSync(inlineDir, { recursive: true });
  writeFileSync(join(inlineDir, `${name}.workertext`), code);
  const pct = ((1 - code.length / source.length) * 100).toFixed(0);
  console.log(`  embed ${name.padEnd(12)} ${(source.length / 1024).toFixed(0)}KB → ${(code.length / 1024).toFixed(0)}KB minified (−${pct}%)`);
}

console.log('\n[1/3] nested worker');
tsup('tsup.nested.config.ts');
await embed('opfs-sync');

console.log('\n[2/3] relays, repair, service worker');
tsup('tsup.workers.config.ts');
await embed('sync-relay');
await embed('async-relay');
await embed('repair');

console.log('\n[3/3] main entries');
tsup('tsup.config.ts');

// ── demo: isomorphic-git, bundled same-origin ────────────────────────────────
//
// The Pages demo clones a real repository to show that a third-party library written against
// node's `fs` runs against this one unmodified. isomorphic-git ships ESM with bare imports
// (`sha.js`, `async-lock`, `crc-32`), so it needs bundling; and it has to be served same-origin
// because the demo runs under COEP `require-corp`, which blocks cross-origin scripts that do not
// opt in. Generated rather than committed, so it cannot drift from the installed version.
console.log('\n[demo] isomorphic-git bundle');
{
  const demoDir = join(srcRoot, '..', 'demo');
  const entry = join(demoDir, '.git-entry.js');
  writeFileSync(entry, [
    // isomorphic-git expects a global `Buffer`; browsers have none, and it fails at clone time
    // with "Missing Buffer dependency" rather than at import. Supplying it inside the bundle
    // keeps the demo free of a global polyfill it would otherwise have to install first.
    "import { Buffer } from 'buffer';",
    "globalThis.Buffer ??= Buffer;",
    "export * as git from 'isomorphic-git';",
    "export { default as http } from 'isomorphic-git/http/web';",
  ].join('\n'));
  await esbuildBuild({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: true,
    outfile: join(demoDir, 'vendor-git.js'),
    logLevel: 'warning',
  });
  rmSync(entry, { force: true });
  const size = statSync(join(demoDir, 'vendor-git.js')).size;
  console.log(`  demo/vendor-git.js  ${(size / 1024).toFixed(0)}KB`);
}
