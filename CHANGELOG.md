# Changelog

## 3.2.12

- **Reserve the free-block bitmap region for the maximum block count, not the initial one — fixes silent data corruption on any VFS that grows past ~62 MB.** The on-disk bitmap region was sized at format time for `INITIAL_DATA_BLOCKS` (1024 → ~1984 bytes after alignment = capacity ~15,872 blocks ≈ 62 MB), but `allocateBlocks`/`maybePreGrow` grow `totalBlocks` and the in-memory bitmap **without enlarging that region**. Once the filesystem exceeded ~62 MB the bitmap spilled past `dataOffset` and overlapped the first data block(s): the bitmap write and the file's bytes clobbered each other, and on the next mount the bitmap read back partly as file data → garbage allocation bits. Continued operation then drove `FREE_BLOCKS` to a u32 underflow (observed as `Corrupt VFS: free blocks (4294942324) exceeds total (594400) — Falling back to OPFS mode`). This was **not** an alloc/free counter desync (the in-memory `FREE_BLOCKS === bitmap-clear-bits` invariant holds for every mutation — verified by a 5-seed fuzz) and **not** a shutdown artifact (reproduces with a clean, fully-flushed remount). The fix ([layout.ts](src/src/vfs/layout.ts) `calculateLayout` now reserves `ceil(MAX_DATA_BLOCKS / 8)` ≈ 500 KB so the bitmap can represent up to ~16 GB and never reaches the data region): `format` reserves for the engine's `maxBlocks`, `growAndAllocate`/`maybePreGrow` are capped at the reserved capacity (throw ENOSPC rather than overflow), and `mount` rejects an already-overflowed legacy file instead of trusting a garbage bitmap. The async server-worker dispatch now also catches engine throws and returns EIO (the sync relay already did) so an ENOSPC can't hang an awaiting client. Adds [bitmap-region-overflow.test.ts](src/tests/bitmap-region-overflow.test.ts) (grows past the old cap + fuzz; asserts the count matches the bitmap in memory and across a remount, with byte-identical file readback). 730 tests pass.

## 3.2.11

- **`growInodeTable` now shifts the post-table region in chunks instead of buffering it whole — fixes "Array buffer allocation failed" when growing the inode table on a large VFS.** When the inode table fills and doubles, everything after it (path table + bitmap + **all file data**) must shift right by the growth amount. The old code did this with a single `new Uint8Array(afterSize)` spanning the entire data region — hundreds of MB for a large bundle (e.g. the Telegram AppDir) — which throws on the transient allocation and aborts the write, corrupting/truncating the store. The shift now streams in 8 MB chunks scanned **end→start**: because every chunk's destination lands `growth` bytes higher than its source and the highest-offset chunk moves first, a write can never clobber bytes an as-yet-unread (lower-offset) chunk still needs, so the overlapping move stays correct. The new-inode zero-fill is chunked the same way (`growth` doubles each grow and can itself exceed a comfortable single allocation). Adds [inode-growth-integrity.test.ts](src/tests/inode-growth-integrity.test.ts) (forces many table doublings with mixed file sizes, asserts every file reads back byte-identically) and [repro-largefile.test.ts](src/tests/repro-largefile.test.ts) (large single-file round-trips, including the observed 542,880-byte ELF). 727 tests pass.

## 3.2.10

- **Gate idle/init pre-growth (`maybePreGrow`) behind the WebKit check — fixes a major Chromium/Android sync-FS regression introduced in 3.1.0.** The 64 MB free-tail headroom (`maybePreGrow`, added 3.1.0) exists for **one reason**: on WebKit a size-changing OPFS call (`truncate` / extending `write`) blocks until the page main thread returns to its event loop, so a spinning sync caller deadlocks any in-request growth — growth must therefore be done proactively at idle. On Chromium/Gecko there is **no such deadlock**; in-request growth via `allocateBlocks` is safe (and is exactly what pre-3.1.0 did). There the proactive growth was pure overhead: a forced OPFS `truncate` + flush run from the dispatch loop after every 25 ms-quiet gap, plus a one-time 64 MB `truncate` at init — cheap on desktop SSD but **slow on mobile flash, stalling the relay loop between ops** (read *and* write latency, since a busy relay can't service the next request). It is the same class of WebKit-only workaround that 3.2.8 gated behind `IS_WEBKIT`; pre-growth was simply missed. Both call sites (`preGrowIfQuiet` in the dispatch loop, and the init pre-grow) now run only when `spinningNeeded()` is true (WebKit, or forced via `forceSpin` / `self.__fs_force_spin`). WebKit behavior is unchanged; Chromium/Firefox/Android fall back to on-demand growth — measured **superfast again on Android Chrome, matching 3.0.55**. The engine's `maybePreGrow` method is untouched (unit tests unchanged); only the worker's *calls* to it are gated. 718 tests pass.

## 3.2.9

- **New `forceSpin?: boolean` config option** ([types.ts](src/src/types.ts), threaded through [filesystem.ts](src/src/filesystem.ts) → the `init-leader` message → [sync-relay.worker.ts](src/src/workers/sync-relay.worker.ts) `spinningNeeded()`). Lets the embedding app override the relay worker's `IS_WEBKIT` auto-detection for the three WebKit-only dispatch-loop workarounds (busy-poll spin, starvation-timer yield, 5 ms-sliced response wait) **from config** instead of only via the `self.__fs_force_spin` worker global — which a consumer can't set inside the lib-spawned relay worker. Precedence: `self.__fs_force_spin` (live runtime override) → `forceSpin` config → `IS_WEBKIT` UA auto-detect. Purpose: A/B the sync hot path on a specific device (notably the **Chrome/Android sync regression vs. pre-3.1.0**) without a rebuild. Default `undefined` = unchanged behavior; no effect on Safari/Chromium/Firefox unless set.
- **New `PERFORMANCE-TUNING.md`** documenting the knobs that decide mobile sync throughput and why: (1) instance hosting — main-thread busy-spin vs worker `Atomics.wait` (deciding axis is "can the main thread afford to spin?" → no on core-constrained mobile, yes on desktop); (2) the OPFS mirror (`mode`/`opfsSync`) as the main write-cost knob; (3) `forceSpin`. Includes a recipe for reproducing the pre-3.1.0 "fast on Android" baseline and a `debug: true` measurement guide (`roundTrip` vs `handleRequest`). No behavior change — docs + the opt-in config above only.

## 3.2.8

- **Gate the three WebKit-only dispatch-loop workarounds behind an engine check so they no longer run on Chromium/Firefox.** The sync-relay leader loop carries three mechanisms that exist solely to defeat WebKit's lost cross-thread `Atomics.notify` + main-thread-brokered MessagePort delivery (a sync caller busy-spinning the page main thread starves both): (1) the post-response **busy-poll spin** (0.25ms `performance.now()` spin to catch the next request without a park), (2) the `yieldToEventLoop` **1ms starvation-timer race** against the self-ping, and (3) `awaitResponseConsumed`'s **5ms-sliced** lost-wake-proof wait. On Chromium and Gecko these wakes are reliable, so the workarounds are pure overhead — and on a core-constrained device (e.g. Android phones, few cores + big.LITTLE + thermal/background-thread throttling) the relay worker's spinning contends for a CPU with the busy-spinning leader main thread and the requesting worker, prolonging every op across the tens of thousands issued during an install/build. A single `IS_WEBKIT` UA check (`/AppleWebKit/ && !/Chrome|Chromium|Android|Edg|OPR/`) now gates all three: WebKit keeps its exact current behavior; elsewhere the loop relies on the reliable self-ping and a single bounded `Atomics.wait` (mirroring pre-3.2.0). A runtime escape hatch — `self.__fs_force_spin = true|false` in the worker — overrides the detection for A/B verification without a rebuild. No behavior change on Safari; no API change.

## 3.2.7

- Docs only. Overhauled the README: sharper intro + badges, a "Choosing a mode (performance)" section documenting the `vfs`/`hybrid`/`opfs` trade-off (the OPFS mirror is the main write-cost knob; reads are unaffected), and honest benchmark framing. Removed the ~320-line stale inline changelog (it duplicated and lagged `CHANGELOG.md`). Corrected the browser-support table: Safari 16.4+ sync is supported (with the documented main-thread-follower limitation), and Firefox needs no flag on 114+ (module workers have been default since then). Fixed a stale test count. No code or behavior changes.

## 3.2.6

Fixes the three audit findings deferred from 3.2.5.

- **The inbound external-change path now runs the same bookkeeping as the outbound path.** `handleExternalChange` (applied when the `FileSystemObserver` detects an external OPFS change) updated the engine directly but skipped all the symlink-alias and pending-sync maintenance `notifyOPFSSync` does, so external mutations silently bypassed it. Extracted that maintenance into shared helpers (`cancelPendingSync`, `reroutePendingChildSyncs`, `rekeySymlinkAliasesForRename`, `dropSymlinkAliasesForRemove`) used by both paths. Now an external write to a symlink's target re-mirrors the dependent links; an external rename reroutes pending child syncs and re-keys aliases; an external delete drops aliases and re-mirrors now-dangling links; and an external write onto a path that is a directory in the VFS converges (removes the dir, writes the file) instead of being dropped with `EISDIR`
- **Echo suppression is now content-based, so a genuine external write within the 3 s grace window is no longer mistaken for our own echo.** The mirror worker records a content hash of every byte range it writes; an observed `modified`/`appeared` is suppressed only when the bytes match what we wrote (within the window) rather than on timestamp alone. A freshly-created file can fire `appeared` with a stale empty snapshot that wouldn't match our hash — so when the observed bytes differ but we recently wrote the path, the worker re-reads the current bytes once before treating it as external, preventing a 0-byte bounce that would clobber the file. (`disappeared`/`moved`, which carry no content, keep the time-based check.)
- **`rename()` now rejects POSIX type conflicts.** The engine would overwrite a directory with a file (or vice versa), diverging from Node and producing a mirror that can't represent the result (a `write` can't turn an OPFS directory into a file). `rename` now returns `EISDIR` for file→existing-directory and `ENOTDIR` for directory→existing-file. Replacing a non-empty *directory* with another directory stays allowed — Vite's `.vite/deps_temp_<hash>` → `.vite/deps` commit relies on it, and the mirror handles it via `renameDirInOPFS`
- Tests: unit tests for the rename type guards (file→dir / dir→file rejected; file→file and dir→dir replace still allowed); the `opfs-mirror-external` E2E spec now asserts a within-grace external write reaches the VFS (#2) and that an external target change re-mirrors its dependent link (inbound symlink) — both verified to fail before these fixes

## 3.2.5

Fixes from a multi-agent adversarial audit of the OPFS-mirroring system. Five confirmed mirror-vs-VFS divergences, all affecting normal (single-tab, local) usage:

- **Write-coalescing could reorder a write ahead of an intervening delete, losing the file.** The mirror worker coalesces queued `write` events for the same path, but the scan skipped past a `delete`/`rename` sitting between two writes and merged the new payload onto the *earlier* write — turning queue `[write, delete, write]` into `[write, delete]` and dropping the re-created file from OPFS. Coalescing now stops at the first intervening op for that path (`coalesceWriteIndex`, unit-tested) and appends in order instead. Needed queue backpressure (large/slow writes) to trigger
- **A mirror op that threw was dropped and never retried.** `processNext` treated success and failure identically — on any throw it logged and marked the event completed, permanently diverging the OPFS file from the VFS. Transient WebKit failures (`NoModificationAllowedError`/`NotFound` under sync-access-handle contention, which Chromium never throws) hit exactly this. Write/delete/mkdir now retry with backoff before giving up, matching the hardening the rename path already had
- **`open()` that creates or truncates a file was never mirrored.** `OP.OPEN` set no sync metadata, so `open(p,'w')`+close (a touch), and `open(existing,'w')`+close (which truncates inside `engine.open`, bypassing `OP.TRUNCATE`), left the mirror missing the file or holding stale pre-truncate bytes. `OP.OPEN` now mirrors on `O_TRUNC` or a creating `O_CREAT` (a cheap `exists()` pre-check avoids re-mirroring an `O_CREAT` open of an already-present file)
- **Removing or renaming-away a symlink's target left dependent links stale.** The 3.2.3/3.2.4 alias re-sync only fired when a target was *written*; `unlink`/`rmdir`/`rename` of a target never re-mirrored the links pointing at it, so they kept the deleted content instead of becoming the empty dangling-placeholder. The UNLINK/RMDIR/RENAME branches now `resyncSymlinksUnder` the removed path (covering a single file or a whole removed/renamed subtree)
- **Chained symlinks didn't cascade.** Writing the final target of `L1 → L2 → file` re-mirrored only `L2`; `L1`'s snapshot stayed stale. `flushPathSync` now cascades the re-sync to links pointing at the just-flushed path (success branch only, so a symlink cycle — which reads non-zero — can't loop)
- Tests: unit tests for `coalesceWriteIndex` (incl. the reorder-across-delete case); E2E `opfs-mirror-open` spec and new cases in `opfs-mirror-symlink` (target deletion → placeholder, chained-link cascade) — all verified to fail before these fixes

Audit findings deferred as out-of-scope or design-level (not fixed here): the inbound `handleExternalChange` path bypasses symlink-alias and pending-reroute bookkeeping (only matters with external `FileSystemObserver` changes); the 3 s echo-grace window can suppress a genuine external write that lands within 3 s of our own write to the same path (fundamental to timestamp-only echo suppression — needs content/version tagging); and `rename(file → existing-dir)` mirrors as a write that can't replace an OPFS directory (stems from the engine permitting a non-POSIX file-over-directory rename).

## 3.2.4

- Tighten the symlink→target alias tracking added in 3.2.3 so it no longer leaks entries. The map was forward-only (target → links), so a link removed by `unlink`, moved by `rename`, or replaced by a re-created symlink left a stale entry that accumulated over a long session. Added a reverse map (link → target) and routed all mutations through `registerLink`/`deregisterLink`, which keep both maps consistent and prune a target's set once it empties. A single `unlink` deregisters in O(1); a recursive `rmdir` or a directory `rename` deregisters every link under the prefix (`collectKeysUnder`), and a `rename` re-registers the moved links at their new paths so they keep tracking their target. Stale entries no longer accumulate
- Tests: unit tests for `registerLink`/`deregisterLink` (no-leak/prune-on-empty/move-on-recreate) and `collectKeysUnder` (exact + strict-descendant matching); the `opfs-mirror-symlink` E2E spec gained a case that renames a symlink and confirms it still re-syncs when its target is later rewritten

## 3.2.3

Two more OPFS-mirror divergence bugs found while auditing the mirroring path (separate from the 3.2.1/3.2.2 rename family). Neither touches the read/write hot path — the changes are confined to the symlink and external-change branches.

- **Local write after an external change was silently dropped from the mirror.** When the `FileSystemObserver` reported an external OPFS change, the relay added the path to `suppressPaths` and applied the change to the engine *directly* (no mirror echo). Nothing consumed that suppression until the next genuine local write to the same path, which `notifyOPFSSync` then skipped — so a `writeFileSync` following an external edit updated the VFS but never reached OPFS, diverging permanently. The mirror worker's own `isOurEcho` (pending/completed tracking) is the authoritative echo guard, so the redundant, buggy relay-side `suppressPaths` layer is removed entirely. Only affected setups using external-change sync
- **Symlinks mirrored as files went stale and dangling links were dropped.** OPFS has no symlinks, so a symlink is mirrored as a regular file holding its target's content (a snapshot). (1) A dangling symlink (target missing) read `ENOENT` and was silently never mirrored. (2) The snapshot went stale when the target was later rewritten, because a write notifies the *target's* path, not the link's. The relay now tracks symlink→target aliases (`resolveLinkTarget`, keyed by resolved absolute target, resolving relative targets against the link's directory): a target write re-mirrors its links, and a dangling link is mirrored as an empty placeholder that fills in once the target appears. Alias lookup is a single `Map.get` per write that only iterates when the written path is actually a symlink target
- Tests: `resolveLinkTarget` unit tests (relative/absolute/`..` resolution); end-to-end Playwright specs against the dist build with the real OPFS mirror — `opfs-mirror-external` (local write survives an external change; self-skips where `FileSystemObserver` is unavailable) and `opfs-mirror-symlink` (link tracks target updates, relative-target resolution, dangling placeholder + heal). Both verified to fail before these fixes
- Added `tests/benchmark/opfs-mirror-rename.spec.ts` (3.2.2's directory-rename fix) as a real-browser end-to-end regression alongside the existing unit coverage

## 3.2.2

- Fix recently-written files being lost from the OPFS mirror when their parent **directory is renamed** — the same class of bug as 3.2.1, found while auditing for more. `engine.rename` of a directory moves the entire subtree to the new path in a single op, but pending debounced child syncs (`pendingPathSyncs`) are keyed by absolute path: after the rename a child's old key no longer resolves, so when its 50 ms flush fires `engine.read` returns `ENOENT` and the child is silently dropped. The directory itself is mirrored via `renameDirInOPFS`, which only moves files **already** in the OPFS mirror — so a child written inside the debounce window (never flushed) was lost entirely. This hits the exact Vite `.vite/deps_temp_<hash>` → `.vite/deps` commit the rename path targets: the most-recently-written deps chunks could vanish from the mirror
- The RENAME handler now re-keys every pending child sync from the old directory prefix to the new one (`planPendingReroutes`) before emitting the rename op, so each child flushes against its real post-rename location and lands in the mirror after the directory rename. Strict-descendant matching only (`oldDir + '/'`), so file renames and sibling paths sharing a name prefix (`/d` vs `/d2`) are unaffected
- Confirmed the analogous paths are already safe and need no change: recursive `cp`/`cp -r` recurses in JS and emits a per-leaf op (file → `copyFileSync`, dir → `mkdirSync`, symlink → `symlinkSync`), so every file is mirrored individually; and `rm -rf` / `rmdir` strand no content because a stale child flush reads `ENOENT` and correctly no-ops (the desired end state is "deleted"). Only directory **rename** preserves the subtree under a new path, which is why it alone needed rerouting
- Add `planPendingReroutes` unit tests (Vite deps case, strict-descendant matching, file-rename no-op) alongside the existing `planRenameMirror` coverage

## 3.2.1

- Fix atomic-write renames (`write temp → rename(temp, final)`) silently dropping from the OPFS mirror. The relay's `notifyOPFSSync` debounces write bursts (`SYNC_DEBOUNCE_MS`) before reading the file and mirroring it; but a temp file in the atomic-write pattern is created *and* renamed within that window, so its pending sync was cancelled and it was **never** mirrored. Forwarding a plain `rename` op to the sync worker then failed with "source not found" because the source never existed in OPFS — the destination diverged from the VFS. (This is the root cause the 3.0.54/3.0.55 mirror-side retries were papering over for the file-rename case.)
- A regular-file rename is now mirrored deterministically as `write(newPath)` + `delete(path)` using the destination's authoritative bytes read straight from the engine at `newPath` (the rename already succeeded in the VFS), instead of a copy-the-source `rename` op — so it no longer depends on whether the temp source was ever mirrored. The pending debounced syncs for **both** the old and new paths are cancelled first. Directory renames (`engine.read` returns `EISDIR`) still fall back to a real `rename` op, which the sync worker handles via `renameDirInOPFS` — the source directory *was* mirrored, unlike a write-temp
- Add `tests/opfs-sync-rename.test.ts` covering the `notifyOPFSSync` RENAME branch: an atomic-write rename whose temp source was never mirrored emits `write(final)` + `delete(temp)` (not a `rename` op); a directory rename (engine reports `EISDIR`) falls back to a `rename` op; and pending debounced syncs on both the old and new paths are cancelled

## 3.2.0

- Multi-tab synchronous FS now works on Safari for **follower** tabs, by running the VFS instance inside a worker. A follower's sync op busy-waits the calling thread; on the main thread that is a spin-loop, and WebKit gates a worker's MessagePort delivery on the parent page's main thread — so the leader's reply can never arrive and the op deadlocks. Run the instance in a worker and the wait becomes a real `Atomics.wait`, the main thread stays free to pump delivery, and follower sync works (the same fast SAB transfer, worker→worker). The only combination still impossible on Safari is *follower + main-thread caller* (a fundamental WebKit limit); leader/single-tab sync and the async API are unaffected
- New `createServiceWorkerBridge(port, { ns })` export + `swBridge?: MessagePort` config option: `navigator.serviceWorker` is not exposed in worker scopes on Safari/Firefox, so a worker-hosted instance delegates its multi-tab broker `postMessage`s (with transferred ports) to a tiny main-thread bridge. Fully optional and backward compatible — when `swBridge` is unset the initialization path is unchanged. Verified follower sync read/write across tabs on WebKit, Chromium and Firefox (`tests/benchmark/multitab-worker.spec.ts`)
- Follower→leader sync requests now **fail fast** after a transport timeout instead of freezing the tab: a main-thread follower on Safari (where the relay can't deliver) gets an immediate `EIO` for ~30 s after the first timeout and self-heals on any delivered async response, rather than a 10 s hang per op
- Benchmark page (`tests/benchmark/index.html`) gained a **"Run in worker"** toggle that runs the whole suite through the worker-hosted path, so it produces results in secondary Safari tabs (unchecked = main-thread, as before). Logic extracted to a shared `benchmark-core.js` used by both the page and a benchmark worker. Added `tests/benchmark/multitab-demo.html` (runnable two-tab demo) and `multitab.spec.ts` / `multitab-worker.spec.ts`
- See `SAFARI-SYNC-LIMITATIONS.md` §10 for the full investigation (three isolated probes establishing exactly why main-thread follower sync is impossible and why the worker path works)

## 3.1.0

- fs sync support on safari

## 3.0.55

- Stop OPFS renames from silently leaving the source behind when the post-copy removal fails. Both rename paths copy the source to the destination and then delete the original, but the delete was fire-and-forget: in the relay-worker `OPFSEngine.rename` the `unlink`/`rmdir` result was discarded, and in the sync worker `removeEntry` was a bare `await` whose rejection only surfaced as a generic warning. A transient OPFS lock/consistency hiccup right after a bulk copy/close (a child handle that hasn't fully released yet) could therefore report a successful rename while the file/tree still existed in *both* locations — a divergence the next reconcile wouldn't necessarily repair
- The removal is now retried with incremental backoff before giving up: `OPFSEngine.removeSourceWithRetry` (engine side, up to 3 retries at 10/20/30 ms) propagates the final non-`OK` status so a genuine failure is returned to the caller instead of a false success; the sync worker's `removeEntryWithRetry` (4 attempts at 10/20/30 ms) treats `NotFoundError` as success (already gone) and rethrows the last error only after exhausting retries
- `OPFSEngine.rename`'s directory branch now also clears a pre-existing destination before recreating it (recursive `rmdir` for a dir target, `unlink` for a file target) and tolerates `EEXIST` from the subsequent `mkdir`, matching the "replace target" semantics the sync worker's `renameDirInOPFS` already had — previously the engine copied *into* an existing target directory, merging the two trees instead of replacing

## 3.0.54

- Fix dropped OPFS file renames on Safari caused by a transient `NotFoundError`. `renameInOPFS` resolves the source via `getFileHandle`; 3.0.50 routed *both* `TypeMismatchError` (genuinely a directory) and `NotFoundError` to the directory-aware branch. But Safari's OPFS has a brief consistency lag between a `createSyncAccessHandle` write and a subsequent `getFileHandle`, so a just-written source (e.g. `printf x > a; mv a b`) can momentarily report `NotFound` — which then *also* failed in the dir branch (`renameDirInOPFS` can't find the entry either), logging `rename (dir) failed: … NotFoundError` and silently dropping the rename, leaving the OPFS mirror diverged from the VFS
- Now only `TypeMismatchError` (and the equivalent `not a file` / `not an entry of requested type` messages) routes straight to the directory branch. A `NotFoundError` instead triggers a bounded retry of the file lookup (6 attempts with incremental 8 ms backoff, ~120 ms total) to let OPFS catch up, falling back to the directory branch only as a last resort before warning
- Fix a TypeScript regression along the way: the retry loop left `oldDir`/`oldHandle` flagged as possibly-unassigned at the file-rename use sites; added definite-assignment assertions (type-only, no change to emitted JS)

## 3.0.53

- Add leader-transition readiness tracking so callers can tell when sync FS ops are actually safe across a leader handoff. New `fs.whenReady(): Promise<void>` resolves once the filesystem is fully ready *including* any in-flight promotion-to-leader, and a new `fs.ready: boolean` getter reports the moment-in-time state (`isReady && !transitioning`). Motivation: an embedding app that runs its own `navigator.locks`-based leader election independently of the FS can win its lock and start issuing sync calls while the FS is still mid-promotion — at which point the relay worker isn't looping yet and the call stalls against the 20 s heartbeat watchdog
- The subtlety `whenReady()` handles: during `promoteToLeader` the existing `readyPromise` is *stale* — it was already resolved by the previous lifecycle and isn't reset until the method runs — so awaiting it would return immediately even though the new sync-relay hasn't signalled `ready` yet. A `transitioning` flag is now set at the very start of `promoteToLeader` and cleared only when the new sync-relay posts `ready`; while it's set, `whenReady()` parks the caller on a listener that fires on the *next* `ready` rather than the stale promise
- Make all three sync-relay `ready` handlers (initial bootstrap, `promoteToLeader`, and `setMode`) consistently clear `transitioning` and flush waiting `whenReady()` listeners. Previously the `setMode` path did neither, so a `setMode` that interrupted an in-flight promotion would have left `ready` wedged at `false` and `whenReady()` callers hung
- Add `tests/leader-transition.test.ts` covering the `ready` getter across all four `(isReady, transitioning)` states, `whenReady()` resolution in each branch (already-ready, initial-not-ready, and waiting-through-a-transition for the *next* ready), the `promoteToLeader` flag wiring, and `fireReadyListeners()` snapshot/clear/throw-isolation semantics

## 3.0.52

- Replace the main-thread spin-wait's fixed wall-clock timeout (10 s, briefly bumped to 60 s) with a worker-liveness heartbeat. `Atomics.wait` is disallowed on the browser main thread, so sync FS calls spin on `Atomics.load`; the old code aborted the call — and the in-flight FS operation — after a fixed elapsed time, which is wrong both directions. A genuinely slow op gets killed mid-flight (a single `rename`/`copy` over a freshly-installed `node_modules` is thousands of OPFS handle awaits and can legitimately take tens of seconds — 10 s was being hit during `create-strapi-app`'s git init), while a truly wedged worker still blocks for the full timeout. The relay worker now bumps a counter in the control SAB (`SAB_OFFSETS.HEARTBEAT`, the previously-reserved Int32 slot) on a 1 s `setInterval` started before init begins; because that timer keeps firing while the worker is parked on an `await` inside a long op, the main thread can tell "slow" from "dead". The spin-wait aborts only if the heartbeat stalls for `SPIN_STALL_TIMEOUT_MS` (20 s) — there is no upper bound on a *progressing* op
- Fix a latent corruption/hang in `syncRequest`'s multi-chunk send path — a single sync write whose encoded request exceeds the SAB data window (`sabSize - HEADER_SIZE` ≈ 2 MB by default), i.e. `writeFileSync`/`writeSync`/`appendFileSync` of more than ~2 MB. The final request chunk is sent with `SIGNAL.CHUNK` and the worker never acks it (only non-final chunks get a `CHUNK_ACK`), so after the send `ctrl[0] === CHUNK` — but the response-wait waited on `SIGNAL.REQUEST`, so the spin-wait fell through immediately and read the still-stale request bytes as the response, then wedged spamming `CHUNK_ACK`s. It now waits on the frame it actually wrote last (`CHUNK` for multi-chunk requests, `REQUEST` otherwise), mirroring the async-relay's send path. Combined with the heartbeat change above, this would otherwise have been an unkillable hang
- Add a Playwright regression test (`tests/benchmark/sab-chunking.spec.ts` plus a minimal `correctness.html` harness) that round-trips ≈2 MB and ≈5 MB payloads through `writeFileSync`, `writeSync(fd)`, and `promises.writeFile`/`readFile` against the dist build with byte-for-byte verification — it hangs without the multi-chunk fix
- `playwright-report/` and `test-results/` are now gitignored

## 3.0.51

- Fix O(N²) regression introduced in 3.0.49. The implicit-directory guard added in 3.0.49 (`isImplicitDirectory(path)` checks in `write`, `symlink`, `link`, `copy`, plus `mkdir`, `stat`, `lstat`, `access`, `realpath`, `exists`) called `rebuildImplicitDirs` on every invocation, which is O(N×depth) over total pathIndex entries. Combined with `pathIndexGen` being bumped on every pathIndex mutation (cache always invalid by the next call), batch operations like Vite/pnpm/Strapi unpacking thousands of files went quadratic. Measured on a synthetic 5000-file write benchmark: **3.0.48 baseline 26 ms → 3.0.50 1725 ms (66× slower) → 3.0.51 23 ms (back to baseline)**
- Replace the on-demand rebuild with an incrementally maintained `descCount` map (number of pathIndex entries that have a given path as a strict ancestor). `isImplicitDirectory(P)` is now O(1): `!pathIndex.has(P) && descCount[P] > 0`. Maintenance is O(depth) per pathIndex mutation, hidden behind two new helpers (`setPathIndex`, `deletePathIndex`) that wrap the 12 mutation sites in `mount`, `createInode`, `unlink`, `rmdir`, and `rename`
- For test scaffolding that pokes `pathIndex` directly to construct implicit-dir scenarios (see vfs-engine.test.ts), `descCountGen` falls behind `pathIndexGen` and `isImplicitDirectory` does a one-shot rebuild to resync. Production code never hits this path

## 3.0.50

- Fix OPFS mirror divergence when the rename source is a directory. `renameInOPFS` previously called `getFileHandle(basename(oldPath))` unconditionally — for a directory rename this throws `TypeMismatchError` (or `NotFoundError` depending on engine), so the worker logged a warning and skipped the operation entirely. The in-memory VFS rename fixed in 3.0.49 (e.g. Vite's `.vite/deps_temp_<hash>` → `.vite/deps`) therefore succeeded in the VFS but left the on-disk OPFS state diverged until the next full reconcile
- On the file-handle TypeMismatchError, fall through to a new directory-aware path that removes the destination entry recursively (matching Node `rename` semantics for the common "replace target" case), recreates it as an empty directory, then walks the source tree copying every file via two sync access handles in 2 MB chunks. Peak memory stays at `RENAME_CHUNK` regardless of subtree size
- Source is then removed via `removeEntry({ recursive: true })`

## 3.0.49

- Fix `rename` over a non-empty directory leaving stale descendants behind. The previous behavior freed only the target directory's own inode and removed only its top-level pathIndex entry — descendant entries (e.g. `dst/foo.js`) survived, pointing at non-freed inodes. Source descendants were then renamed onto the same paths, overwriting some pathIndex entries (leaking those inodes) and leaving any descendant unique to the target as a zombie still reachable via `read`. Concrete consequence: Vite's deps optimization commit (`.vite/deps_temp_<hash>` → `.vite/deps`) on the second run produced a corrupt `.vite/deps` directory — requests for `vue.js`, `@unhead/vue`, etc. resolved to stale chunks from the previous round (or 404'd entirely). `rename(x, x)` was also corrupting: it freed the file's blocks and marked its inode FREE before re-pointing pathIndex at the same now-freed inode
- Fix the same family of bugs across implicit-directory targets — paths with no inode of their own but with descendants in pathIndex (the state produced by bulk OPFS import). Several write-side guards historically only checked `pathIndex.has(path)`, missing this case and silently producing impossible filesystem states:
  - `rename` over an implicit dir now frees its descendants (matching the explicit-dir branch)
  - `write` at an implicit-dir path returns EISDIR instead of registering a regular FILE inode there while children remain — the resulting "file with children" state broke every subsequent read of the path and its subtree
  - `symlink`, `link`, and `copy` (with `COPYFILE_EXCL`) now return EEXIST when the target is an implicit dir, instead of clobbering it
- Add 5 regression tests in `implicit-dir-targets.test.ts` covering each fixed call site

## 3.0.48

- Eliminate residual race in the SW broker heartbeat: stop calling `close()` on the previous control port at all. The 3.0.47 fix posted `register-server` before closing, but `close()` sends its disentangle signal to the SW on a separate IPC pipe with no FIFO guarantee against the SW main-channel queue. If the disentangle landed before the SW processed `register-server`, any follower `transfer-port` already in the SW inbox was dispatched against a now-detached `serverPort` and silently dropped (postMessage to a disentangled peer is a no-op per spec)
- Leaving the old port open keeps it routable until the SW processes `register-server` and overwrites `serverPort`. Both endpoints of the old channel become unreferenced after that (leader replaced `brokerControlPort`; SW replaced `serverPort`) and the pair is GC-eligible — no leak in steady state, and a port that can't receive messages can't keep itself alive via its onmessage listener

## 3.0.47

- Fix multi-tab broker death after the service worker is idle-killed (≥30s on Chrome). When the SW restarts, its `serverPort` is null and any follower `transfer-port` queued in `pending` would never reach the leader, so secondary tabs failed with `[Shell] Failed to load cwd` until refresh
- Leader now re-registers with the SW broker on a 5 s heartbeat. Re-posting `register-server` is idempotent in the SW handler — it replaces `serverPort` and flushes `pending` — so any followers stuck against a dead broker get unstuck within one tick
- Heartbeat re-registration posts the new control port to the SW *before* closing the old one. Closing first opens a race where any follower `transfer-port` already in the SW inbox queue gets forwarded to the now-detached old port and is silently dropped (`postMessage` to a port whose peer is detached is a no-op per spec), leaving that follower stuck
- `leader-changed` BroadcastChannel notification now fires exactly once at initial registration (not on every heartbeat tick). Broadcasting on every tick would call `connectToLeader()` on every follower, which tears down the existing `leader-port` and resolves any in-flight sync FS request with EIO via the sync-relay reconnect path
- `promoteToLeader` tears down the prior heartbeat timer and orphaned control port before allowing re-registration as the new leader

## 3.0.46

- Implicit directory support: directories implied by file paths (e.g. `/a/b` when `/a/b/c/file.txt` exists without an explicit `mkdir`) are now recognized by `stat`, `lstat`, `readdir`, `opendir`, `access`, `realpath`, `exists`, `mkdir` (EEXIST guard), and `ensureParent`
- Fix crash when calling `fstat`/`fchmod`/`fchown`/`futimes` on an fd opened via `opendir` on an implicit directory (`inodeIdx: -1` previously caused garbage reads from negative file offsets)
- `rmdir` on implicit directories: non-recursive returns ENOTEMPTY when children exist; recursive deletes all real descendants and the implicit dir vanishes automatically
- `encodeStatResponse` for real directories now counts implicit subdirectories in `nlink`, consistent with what `readdir` reports
- Implicit directory timestamps are now stable across repeated `stat()` calls (stored on first discovery, preserved across cache rebuilds)
- Generation-counter cache (`pathIndexGen`) for lazy implicit-dir rebuild — only recomputed when `pathIndex` actually changes
- Add 14 tests for implicit directory behavior (stat, lstat, readdir, exists, access, realpath, opendir+fstat, fchmod/fchown/futimes no-op, rmdir non-recursive/recursive, mkdir EEXIST, mkdirRecursive materialization, nlink with implicit subdirs)

## 3.0.45

- Fix "Array buffer allocation failed" on multi-hundred-MB VFS operations by streaming all large-buffer paths through a bounded 4 MB scratch buffer instead of materializing the whole thing at once:
  - `growPathTable`: shift the data region back-to-front in chunks rather than reading/writing it as one `Uint8Array(dataSize)`. Root cause of the pnpm/Directus crash (~1300 packages → hundreds of MB data section)
  - `fwrite` grow path: allocate new blocks, copy old contents chunked, then write caller data at offset — no more `new Uint8Array(endPos)` staging
  - `append`: same chunked relocate pattern, no more `new Uint8Array(existing + data)`
  - `truncate` extend: chunked old→new copy plus chunked zero-fill of the extension
  - `copy`: chunked block-to-block copy via the file handle, no `readData(srcInode.size)` full-file buffer
- Fix POSIX "hole" semantics for writes past EOF: when a write starts beyond the current file size, the gap bytes now read back as zeros rather than whatever stale data lived in the underlying storage blocks. Covers `fwrite` (grow and in-place branches) and `truncate` extend (both same-blockcount and grow branches). `allocateBlocks` only flips bitmap bits, so zeroing has to happen explicitly
- Add `zeroFileRange` helper for chunked zero-fill
- Add tests for sparse writes (3 cases) and for 5 MB buffers crossing the 4 MB chunk boundary in `append`, `fwrite` grow, `truncate` extend, and `copy`, plus self-copy and `COPYFILE_EXCL` coverage

## 3.0.44

- Fix OOM during large streamed writes: coalesce per-path OPFS sync notifications in `sync-relay.worker.ts` so a single 100 MB chunked upload triggers one full-file read instead of one per chunk (~1500×). Eliminates `RangeError: Array buffer allocation failed` on repeated large uploads (e.g. Strapi multipart)
- Cancel pending debounced syncs on `UNLINK`/`RMDIR`; reroute pending syncs on `RENAME` to the new path
- Route `OP.SYMLINK` mirror through the same debounced flusher
- Replace `scanOPFSEntries` with streaming `populateVFSFromOPFS`: directories created before files at each level, files copied via `SyncAccessHandle` + 2 MB chunked `engine.append`. Init peak memory bounded by chunk size instead of the sum of all OPFS file sizes
- `renameInOPFS` (in `opfs-sync.worker.ts`) now copies via two `SyncAccessHandle`s in 2 MB chunks instead of materializing the whole file via `file.arrayBuffer()`
- Coalesce pending `write` events for the same path in the OPFS sync queue — newer payload supersedes older, freeing the stale `ArrayBuffer` for GC while preserving ordering for non-write ops
- Update `vfs-engine` test for the 100K default inode count

## 3.0.43

- Update README changelog section and link to `CHANGELOG.md`

## 3.0.42

- Implement real `fchmod`/`fchown`/`futimes` (sync, promises, and `FileHandle.utimes`) — previously no-ops
- Add new wire opcodes `FCHMOD`/`FCHOWN`/`FUTIMES` (31/32/33) wired through VFS and OPFS engines, server worker, and sync-relay
- Sync-relay broadcasts fd-based ops as path-based equivalents via `getPathForFd` so watchers still fire
- Rewrite `glob`/`globSync`: brace expansion, character classes with `[!...]` negation, escapes, `withFileTypes`, `string[]` patterns, `URL` cwd, dedupe, trailing-`**` self-match
- `watch`: per-microtask `(event, filename)` coalescing, `encoding: 'buffer'` support, reclassify `COPY` as `change` to match libuv

## 3.0.41

- Increase default inode count from 10,000 to 100,000 to support large projects (e.g. Strapi)
- Strengthen readdir-through-symlink test assertions

## 3.0.34 - 3.0.39

- Fix lstat for deeply nested symlink chains: fallback to full resolution when intermediate path lookup fails
- Add lstat through symlink chain tests including VFS remount persistence scenario

## 3.0.33

- Callback methods now return the promise when no callback is given (hybrid API)
- Relax callback validation to allow undefined/null (matches real-world polyfill usage)
- Refactor callback API with `_cb`/`_cbVoid` helpers, eliminating repetitive setTimeout wrappers
- Guard all sync-based callback methods with `if (cb)` checks

## 3.0.32

- Add `promises.fstat()` and `promises.ftruncate()`
- Export `fstat`, `ftruncate`, `lchmod`, `lchown`, `lutimes`, `fsync`, `fdatasync` from promises module
- Add `rawListeners()`, `prependListener()`, `prependOnceListener()`, `eventNames()` to stream EventEmitter
- `fstat`/`fstatSync` now accept `{bigint: true}` option returning `BigIntStats`
- Add callback validation to `cp`, `readv`, `writev`, `statfs`
- Add `read(fd, {buffer, ...}, callback)` object-form overload

## 3.0.31

- Fix `statfs` callback to fire asynchronously (macrotask)
- `createReadStream`/`createWriteStream` now support `fd` option for pre-opened file descriptors
- Add `'buffer'` to Encoding type (fixes TypeScript error with `readdir({encoding: 'buffer'})`)
- Throw `TypeError` when callback argument is missing (matches Node.js behavior)
- Throw `TypeError` on null/undefined paths (matches Node.js behavior)

## 3.0.30

- Add missing callback versions: `lchmod`, `lchown`, `lutimes`
- Fix `readv`, `writev`, `fsync`, `fdatasync` callbacks to fire as macrotasks (setTimeout)

## 3.0.29

Complete Node.js fs API coverage.

- Add callback versions: `fstat`, `ftruncate`, `read`, `write`, `close`, `opendir`, `glob`, `fchmod`, `fchown`, `futimes`
- Add `futimes`/`futimesSync` (fd timestamp methods)
- Add `opendirSync` returning `Dir` with sync readdir-based iteration
- Add `realpath.native`/`realpathSync.native` aliases
- Add `fs.promises.constants`
- Export `ReadStream`/`WriteStream` classes from index
- `writeFile` now respects `mode` option (applies chmod after write)
- `readdir` with `encoding: 'buffer'` now returns `Uint8Array[]` names

## 3.0.28

Final Node.js fs compatibility fixes.

- Fix `emptyStats()` in watchFile missing nanosecond timestamp fields
- Callback-style methods now fire via macrotask (`setTimeout`) matching Node.js timing guarantee
- Add `fsync(fd)`/`fsyncSync(fd)` and `fdatasync(fd)` to main fs object
- Add `setEncoding(encoding)` on readable streams (emits strings instead of Uint8Array)
- Add `cork()`/`uncork()` on writable streams

## 3.0.27

Node.js fs compatibility — 15 more fixes closing the remaining gaps.

- Add callback API for all async methods (`fs.readFile(path, cb)` style)
- `createReadStream` now returns Node.js-compatible `Readable` with `.on('data')`, `.pipe()`, etc.
- `createWriteStream` now returns Node.js-compatible `Writable` with `.write()`, `.end()`, events
- Fix `Dirent.parentPath`/`path` missing on recursive readdir results
- Add nanosecond timestamp fields (`atimeNs`, `mtimeNs`, `ctimeNs`, `birthtimeNs`) to `Stats`
- Set `Stats.dev` to non-zero synthetic device number
- Add `lutimes`/`lchmod`/`lchown` (symlink permission methods)
- Add `fchmod`/`fchown` (file descriptor permission methods)
- Add `readv`/`writev` (vector I/O)
- Add `signal: AbortSignal` support on `readFile`/`writeFile` options
- Add `maxRetries`/`retryDelay` to `RmOptions`
- Add `openAsBlob(path, options?)` method
- Accept `Uint8Array` and `file:` URL as paths (`PathLike`)
- Add `readSync(fd, {buffer, ...})` and `writeSync(fd, buffer, {offset, ...})` object forms
- Add `FileHandle.appendFile`, `chmod`, `chown`, `[Symbol.asyncDispose]`
- `mkdir` recursive now correctly returns first created directory path
- Add missing platform constants (`O_NONBLOCK`, `O_DSYNC`, `O_DIRECTORY`, `O_NOFOLLOW`, etc.)

## 3.0.26

Node.js fs compatibility improvements — 17 fixes bringing the API closer to native behavior.

- Support `flag` option in `readFile`/`writeFile` (e.g. `'wx'` for exclusive create)
- Use float64 for file positions in `readSync`/`writeSync`, removing 2GB limit
- Use float64 for `truncate`/`ftruncate` length, removing 4GB limit
- Fix `access` async default mode to `constants.F_OK`
- Rewrite `createReadStream` to use fd-based reads instead of reading entire file per chunk
- Rewrite `createWriteStream` to use fd-based writes with proper position tracking
- Add `recursive` option for `readdir`/`readdirSync`
- Add `parentPath`/`path` properties to `Dirent` objects (Node 20+)
- Add encoding option to `readlink`/`readlinkSync`
- Add `type` parameter to `symlink`/`symlinkSync`
- Add `latin1`, `ucs2`, `utf16le` encodings with proper encode/decode
- Add `writeSync(fd, string, position?, encoding?)` overload
- Add `cp`/`cpSync` for recursive directory copying
- Add `statfs`/`statfsSync`
- Add `glob`/`globSync` with `*`, `**`, `?` pattern support
- Add `bigint` option to `stat`/`lstat` returning `BigIntStats`
- Track `nlink` (hard link count) in inode structure

## 3.0.24

- Fix EXISTS fallback: OPFS returns OK with data[0]=0 instead of ENOENT for missing paths, so VFS fallback now triggers correctly

## 3.0.23

- Fix lstat to follow intermediate symlinks via resolvePathComponents
- Fix VFS readdir for symlinked directories, async OPFS fallback

## 3.0.22

- Fix multi-chunk signal protocol: async-relay now waits for last chunk ack before reading response, preventing signal confusion
- Defer async-relay initialization until sync-relay is ready, eliminating startup race condition
- Increase `Atomics.wait` timeouts from 10ms to 100ms across all relay paths
- Replace aggressive polling loop with proper `Atomics.wait` for async response consumption

## 3.0.20

- Bump dependencies

## 3.0.18

- Add 10s timeout to main-thread spin-wait

## 3.0.15

- Fix path out of bounds

## 3.0.13

- Fix helper methods

## 3.0.11

- Faster initialization and auto shrink

## 3.0.10

- Add namespace

## 3.0.8

- Add vfs helpers
- Fix watcher

## 3.0.1

- Add watchers
- Fix symlink resolution
