/**
 * Publish both packages, in the one order that works.
 *
 * `npm publish` from the root ships `@componentor/fs` and nothing else — `sync-opfs/` is a
 * separate package that npm has no reason to know about, so releasing by hand means remembering
 * a second publish in a second directory. Forgetting it is not a loud failure either: the alias
 * simply stays on the previous version, and anyone who installed it gets older code than the
 * headline package, silently.
 *
 * Order is not arbitrary. `sync-opfs` pins `@componentor/fs` to an exact version, so publishing
 * it first would put a package on the registry whose dependency does not exist yet.
 *
 * Usage:
 *   npm run release                 # verify, then publish both
 *   npm run release -- --dry-run    # everything except the two publishes
 *   npm run release -- --otp=123456 # when npm asks for a 2FA code
 *   npm run release -- --browser    # also run the Playwright suite first
 *   npm run release -- --tag        # additionally create and push a git tag
 *
 * Git is left alone by default: this repo's history is managed by hand, so the script prints the
 * commands rather than running them.
 */

import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (name) => args.find((a) => a.startsWith(`${name}=`))?.split('=')[1];

const dryRun = has('--dry-run');
const otp = valueOf('--otp');
const runBrowser = has('--browser');
const doTag = has('--tag');
const allowDirty = has('--allow-dirty');

const ALIAS_DIR = 'sync-opfs';

let step = 0;
const say = (msg) => console.log(`\n[${++step}] ${msg}`);
const ok = (msg) => console.log(`    ✓ ${msg}`);
const die = (msg, hint) => {
  console.error(`\n✘ ${msg}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
};

const run = (cmd, cmdArgs, cwd = root) =>
  execFileSync(cmd, cmdArgs, { cwd, stdio: 'inherit' });
const capture = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();

const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

// ---------------------------------------------------------------------------
// Preflight — everything that can be known before anything is published
// ---------------------------------------------------------------------------

say('Preflight');

const main = readJson('package.json');
const alias = readJson(`${ALIAS_DIR}/package.json`);
const version = main.version;

// The alias re-exports the main package at an exact version. A mismatch means someone installs
// `sync-opfs@x` and gets `@componentor/fs@y` — the failure mode this check exists to prevent.
if (alias.version !== version) {
  die(`version mismatch: ${main.name} is ${version} but ${alias.name} is ${alias.version}`,
      `Set both to the same version in package.json and ${ALIAS_DIR}/package.json.`);
}
if (alias.dependencies?.[main.name] !== version) {
  die(`${alias.name} pins ${main.name}@${alias.dependencies?.[main.name]}, expected ${version}`,
      `Update dependencies["${main.name}"] in ${ALIAS_DIR}/package.json.`);
}
ok(`${main.name} and ${alias.name} both at ${version}, pin matches`);

// A release with no changelog entry is a release nobody can evaluate.
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
if (!new RegExp(`^##\\s+${version.replace(/\./g, '\\.')}\\b`, 'm').test(changelog)) {
  die(`CHANGELOG.md has no "## ${version}" section`,
      'Write the entry before publishing — see RELEASING.md for the house style.');
}
ok(`CHANGELOG.md has an entry for ${version}`);

try {
  ok(`npm user: ${capture('npm whoami')}`);
} catch {
  die('not logged in to npm', 'Run `npm login` first.');
}

// Republishing an existing version is rejected by the registry, but the error arrives after the
// whole verify run. Better to say so now.
for (const name of [main.name, alias.name]) {
  let published = '';
  try {
    published = capture(`npm view ${name}@${version} version 2>/dev/null`);
  } catch { /* not published, which is what we want */ }
  if (published) die(`${name}@${version} is already on npm`, 'Bump the version first.');
}
ok(`${version} is unpublished for both packages`);

const branch = capture('git rev-parse --abbrev-ref HEAD');
if (branch !== 'main') console.log(`    ! on branch "${branch}", not main`);

const dirty = capture('git status --porcelain');
if (dirty && !allowDirty) {
  console.log(`    ! working tree has uncommitted changes:`);
  console.log(dirty.split('\n').slice(0, 10).map((l) => `      ${l}`).join('\n'));
  console.log('      Publishing anyway — pass --allow-dirty to silence this, or commit first.');
}

// ---------------------------------------------------------------------------
// Verify — the same gate `prepublishOnly` runs, but before anything is uploaded
// ---------------------------------------------------------------------------

// `verify` is typecheck → tests → build, so `dist/` is rebuilt from the current sources here.
// There is no separate `npm run build` to remember before releasing: a stale `dist/` cannot be
// published by accident, because it is regenerated seconds before the tarball is packed.
say('Verify — typecheck, tests, and a fresh build of dist/');
run('npm', ['run', 'verify']);
ok('typecheck clean, Node suite passed, dist/ rebuilt');

if (runBrowser) {
  say('Browser suite');
  run('npx', ['playwright', 'test', '--project=chromium']);
  ok('browser suite passed');
} else {
  console.log('    (skipping the browser suite — pass --browser to include it)');
}

// ---------------------------------------------------------------------------
// Publish — main first, because the alias pins it
// ---------------------------------------------------------------------------

const publishArgs = ['publish', '--access', 'public'];
if (otp) publishArgs.push(`--otp=${otp}`);
if (dryRun) publishArgs.push('--dry-run');

say(`Publish ${main.name}@${version}${dryRun ? ' (dry run)' : ''}`);
// `prepublishOnly` would re-run verify here; it already passed, so skip the second run.
run('npm', [...publishArgs, '--ignore-scripts']);
ok(`${main.name}@${version} ${dryRun ? 'would be published' : 'published'}`);

// Published as a folder from the repo root rather than by `cd`-ing into it. npm resolves the
// project-level `.npmrc` relative to the working directory, and the auth token lives in the root
// one — running this from inside `sync-opfs/` finds no config there, does not walk up, and fails
// authentication. `npm publish <folder>` keeps the root as cwd and packs the folder.
say(`Publish ${alias.name}@${version}${dryRun ? ' (dry run)' : ''}`);
run('npm', ['publish', `./${ALIAS_DIR}`, ...publishArgs.slice(1)]);
ok(`${alias.name}@${version} ${dryRun ? 'would be published' : 'published'}`);

// ---------------------------------------------------------------------------
// Git — printed rather than run, unless asked
// ---------------------------------------------------------------------------

if (doTag && !dryRun) {
  say(`Tag v${version}`);
  run('git', ['tag', `v${version}`]);
  run('git', ['push', 'origin', `v${version}`]);
  ok(`tagged and pushed v${version}`);
}

console.log(`\n${dryRun ? 'Dry run complete — nothing was published.' : `Released ${version}.`}`);
if (!dryRun) {
  console.log(`  https://www.npmjs.com/package/${main.name}`);
  console.log(`  https://www.npmjs.com/package/${alias.name}`);
  if (!doTag) {
    console.log('\nGit was not touched. To tag this release:');
    console.log(`  git tag v${version} && git push origin v${version}`);
  }
}
