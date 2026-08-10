# Releasing

**Publish every version. The cadence is the credibility.**

This is the process note, but the reason comes first, because the process is easy and the reason
is what actually got missed.

## Why this matters more than it looks

Between 3.3.5 and 3.3.29 this project did its best work: file-descriptor access modes, four
differential fuzzers against real `node:fs`, the `Stats`/`Dirent` class rewrite, Node-exact mode
parsing, the encoding sweep, `FileHandle` streams. Twenty-three releases.

None of them were published. npm went `3.3.1` (June) → nothing → `3.3.3`, `3.3.5` and `3.3.29`
**on the same day in August**.

Someone evaluating this package reads the npm version history before they read the readme. What
that history showed was a two-month silence followed by an unexplained 24-version jump — which
reads as an abandoned project that got a panicked dump, not a rigorously tested one. The entire
argument for choosing this library over the alternatives existed only in a local git repo.

An unpublished improvement is worth zero to everyone except you.

## The rule

Every version that gets a CHANGELOG entry gets published, the same day. Patch releases included —
*especially* patch releases, because a steady stream of small fixes is the single clearest signal
that a library is maintained.

If a change is not worth publishing, it is not worth a version bump; leave it unreleased and fold
it into the next real one.

## Steps

One command. It verifies, rebuilds `dist/`, and publishes **both** packages in the right order:

```bash
npm run release
```

Useful variants:

```bash
npm run release:dry                  # everything except the two publishes
npm run release -- --browser         # also run the Playwright suite first
npm run release -- --otp=123456      # when npm asks for a 2FA code
npm run release -- --tag             # also create and push the git tag
```

Before running it, bump the version in **both** `package.json` and `sync-opfs/package.json`
(including the pinned dependency), and write the CHANGELOG entry. The script refuses to run
without them.

### What it does, and why in that order

1. **Preflight.** Checks the two versions match and that the alias pins the exact version; that
   `CHANGELOG.md` has a section for it; that you are logged in to npm; and that the version is not
   already published. All of it before anything is uploaded, because a half-release is the one
   state with no clean recovery.
2. **Verify.** `typecheck → tests → build`. `dist/` is rebuilt here, so there is no separate
   `npm run build` to remember and no way to publish a stale bundle by accident.
3. **Publish `@componentor/fs`.**
4. **Publish `sync-opfs`** — always second, because it pins the main package at an exact version;
   published first, it would reference a version that does not exist yet.

Two details the script handles that are easy to get wrong by hand:

- The alias is published as `npm publish ./sync-opfs` from the repo root, **not** by `cd`-ing into
  it. npm resolves the project-level `.npmrc` from the working directory and does not walk up, so
  running it from inside that folder finds no auth token and fails.
- `--ignore-scripts` on the main publish, so `prepublishOnly` does not run the whole verify a
  second time.

Git is left alone by default — this repo's history is managed by hand, so the script prints the
tag commands instead of running them. Pass `--tag` if you want it to do the tagging.

## Changelog style

The existing entries are the reference, and they are unusually good — keep them that way. What
makes them work:

- **Lead with what was broken, from the caller's point of view**, not with the fix. "`utimes` read
  its time arguments as milliseconds where Node reads seconds — a silent 1000× error" tells a
  reader whether it affects them in one line.
- **Say how it was found**, when the answer is interesting. "Found by the fuzzer" and "found by a
  four-line probe before writing the fuzzer" are both worth knowing.
- **Record what was measured, including the losses.** The `Dirent` class being a few nanoseconds
  *slower* is in there. That is what makes the wins believable.
- **Name deliberate divergences from Node** and say why, so they read as decisions rather than
  gaps. Mirror them into the readme's "Known divergences" list.
- Close with the test counts.

## Pre-publish checklist

- [ ] version bumped in `package.json` **and** `sync-opfs/package.json`, including the pinned dependency
- [ ] CHANGELOG entry written, in the house style above
- [ ] readme updated if behaviour or API changed
- [ ] `npm run release:dry` — clean
- [ ] `npm run release` — publishes both
- [ ] `git tag v<version> && git push --tags` (or `npm run release -- --tag`)

`npm run release` covers typecheck, tests and the build itself; the browser suite is opt-in via
`--browser` and worth running for anything touching workers, streams or the engine.
