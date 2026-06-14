# Performance & Reliability Improvements — 2026-06-11

Working-tree changes only — **nothing committed or pushed**; every change is
staged for human review. All claims below are backed by checked-in tests or
saved benchmark output.

## Safari multi-tab follower SYNC — fixed via worker-hosted instances (2026-06-14)

**Result: follower sync works on Safari/WebKit, Chromium and Firefox when the
follower instance runs inside a worker.** Verified end-to-end on all three
engines (`tests/benchmark/multitab-worker.spec.ts`): a follower reads the
leader's file and writes its own, synchronously, and the leader sees the write
— 7ms on WebKit.

Why it was thought impossible, and what changed — established with isolated
probes (kept under the session notes, reproducible):

1. **Sync XHR is NOT intercepted by the service worker in WebKit.** An async
   `fetch` to the same path round-trips through the SW fine; a synchronous XHR
   bypasses the SW and hits the network. So the classic "sync-XHR-through-SW"
   (webcontainer) trick is dead on Safari.
2. **A worker's MessagePort delivery is gated on the parent main thread's
   event loop in WebKit.** Probe: a worker that should receive a port message
   and write a SAB received NOTHING during a 3s main-thread spin on WebKit,
   vs 35ms on Chromium. This is the real reason follower sync deadlocked: a
   follower's main-thread spin freezes its relay worker's intake, so the
   leader's reply never arrives.
3. **But from a WORKER context it works** — the sync wait becomes a real
   `Atomics.wait` (allowed off-main-thread), the main thread stays free to
   pump delivery, and the relay receives the leader's reply. Probe: value
   delivered, `waitResult: "ok"`, on both WebKit and Chromium.

The fix (surgical — the only main-thread-only dependency was the SW broker):
- New config `swBridge?: MessagePort` ([types.ts](src/src/types.ts)). When
  set, `getServiceWorker()` returns a proxy that forwards the instance's
  broker `postMessage`s (with transferred ports) through the bridge
  ([filesystem.ts](src/src/filesystem.ts)). Only OUTBOUND forwarding is
  needed — SW→leader→worker replies flow directly through the transferred
  MessageChannel ports.
- New exported helper `createServiceWorkerBridge(peerPort, { ns })`
  ([sw-bridge.ts](src/src/sw-bridge.ts)) — runs on the main thread, owns the
  real `navigator.serviceWorker`, forwards bridge messages to it.
- Everything else the instance needs (`navigator.locks`, `location`,
  SAB/Atomics, nested workers) already works in a worker on WebKit ≥ 16.4.

Deployment pattern (also in the Safari doc): run the follower's VFS instance
in a worker, wire the bridge on the main thread:
```js
// main thread (per follower tab)
const ch = new MessageChannel();
createServiceWorkerBridge(ch.port1, { ns: 'vfs-_app' }); // ns = `vfs-${root with non-alnum → _}`
worker.postMessage({ swBridge: ch.port2 }, [ch.port2]);
// inside the worker
const fs = new VFSFileSystem({ root: '/app', swBridge: receivedPort });
fs.readFileSync('/x'); // works in a follower tab, Safari included
```
Backward compatible: `swBridge` unset → `getServiceWorker()` behaves exactly
as before, so main-thread and Chrome/FF multi-tab paths are unchanged. The
main-thread follower-sync contract on Safari (fail-fast EIO) still stands for
instances that run on the main thread — see `multitab.spec.ts`.

## Summary of changes

### 1. Directory children index — readdir/stat no longer O(total files)

`readdir` and directory `stat` previously scanned **every path in the
volume** per call ([engine.ts](src/src/vfs/engine.ts) `getDirectChildren` /
`getDirectChildrenWithImplicit`). The engine now maintains an incremental
`parent → (child name → refcount)` index (`childIndex`), updated through the
same `setPathIndex`/`deletePathIndex` helpers that already maintain
`descCount`, with the same generation-counter staleness fallback. Listing a
directory is now O(children in that directory).

Measured with `src/tests/engine.bench.ts` (self-validating volume builder;
saved outputs: [ENGINE-BENCH-BEFORE.txt](tests/benchmark/ENGINE-BENCH-BEFORE.txt),
[ENGINE-BENCH-AFTER.txt](tests/benchmark/ENGINE-BENCH-AFTER.txt)):

| Benchmark (50k-file volume)      | Before   | After     | Speedup |
|----------------------------------|----------|-----------|---------|
| readdir 100-entry dir            | 0.830 ms | 0.045 ms  | **18×** |
| readdir deep dir (1 entry)       | 0.198 ms | 0.0017 ms | **119×**|
| readdir root (500 entries)       | 2.35 ms  | 0.20 ms   | **12×** |
| stat on a directory              | 0.857 ms | 0.025 ms  | **34×** |
| 10-dir list-and-stat sweep       | 15.9 ms  | 0.96 ms   | **17×** |
| stat on a file (control)         | 0.0006 ms| 0.0006 ms | none (no regression) |

Key scaling property: readdir of a 100-entry dir now costs the same in a
10k-file volume and a 50k-file volume (21.3k vs 22.3k ops/s). Before, it
degraded 4× between those sizes.

Tests: `src/tests/child-index.test.ts` — 14 unit tests covering every
mutation path (write/mkdir/unlink/rmdir/rename/overwrite-rename/link/
symlink/copy/mount-rebuild/direct-mutation staleness/implicit dirs/unicode/
prefix-collision names) plus a 4-seed × 800-op randomized fuzz that after
EVERY operation verifies (a) the incremental index equals a from-scratch
rebuild and (b) listings equal an independent reimplementation of the old
full prefix scan.

### 2. Follower→leader request deadline (no more infinite hangs)

A follower whose request response was lost (leader tab frozen/throttled,
response dropped during leader handoff, dead MessagePort) previously hung
**forever**: the spin-wait stall detection watches the follower's own relay
worker heartbeat, which keeps ticking while the request is lost.

The forwarding logic is extracted to
[follower-forward.ts](src/src/protocol/follower-forward.ts)
(`FollowerForwarder`), used by the sync-relay worker:

- every request carries a unique sequence id; only the response echoing the
  current id resolves it — a late/stale response can never resolve a newer
  request with wrong data (previously possible: responses were matched by
  arrival order only)
- 10s deadline → the request resolves with **EIO** instead of hanging
- deliberately **no automatic retry**: a timed-out mutation may have been
  applied; EIO means "outcome unknown — retry at the app level if safe"
- reconnection aborts in-flight requests with EIO (previously this path
  returned status 5, which is **ENOTEMPTY**, mislabeled as EIO in a comment
  — a real EIO status (11) now exists across opcodes.ts/errors.ts)

Tests: `src/tests/follower-forward.test.ts` — 15 tests (fake ports + fake
timers): sequencing, deadline→EIO, late-echo swallowing, stale responses
vs newer requests, reconnect abort, timer hygiene, payload-copy semantics.

### 3. Async-relay SAB protocol deadlines

Four blocking `Atomics.wait` points in the async-relay's `sabRequest`
(request chunk acks, response wait, response chunk waits) had no overall
deadline — a sync-relay death mid-protocol wedged the async worker (and the
whole async queue) forever, pinned at 100% CPU in one case. All four now go
through deadline-aware primitives
([sab-wait.ts](src/src/protocol/sab-wait.ts), 120s overall budget — it only
needs to beat "never") and fail the single request with EIO after a
best-effort protocol reset.

Tests: `src/tests/sab-wait.test.ts` — 9 tests, including REAL cross-thread
wake verification via `worker_threads` and deadline expiry under a
never-changing signal.

### 4. Superblock CRC-32 (torn-write detection) + repair hardening

The superblock's reserved field (offset 60) now stores a CRC-32 of bytes
0–59, written atomically with the same 64-byte write
([crc32.ts](src/src/vfs/crc32.ts), [engine.ts](src/src/vfs/engine.ts)
`writeSuperblock`/`mount`):

- mount validates the CRC **before trusting any layout field**; mismatch →
  `Corrupt VFS: superblock checksum mismatch` → existing repair fallback
- CRC = 0 means a legacy pre-checksum file: mounts exactly as before, and
  upgrades to checksummed on its next superblock write — **full backward
  compatibility, no format version bump**
- the repair worker now includes the CRC in its "is the superblock
  trustworthy" decision: a corrupt-but-plausible `INODE_COUNT` (e.g. 3)
  previously truncated the recovery scan to 3 inodes silently; with a CRC
  mismatch it now falls back to the conservative default layout

Tests: `src/tests/superblock-crc.test.ts` — 12 tests (CRC vectors, write
side, mount side, torn-field/garbage detection, legacy mount + upgrade
path). The 11 pre-existing corruption tests were updated to reseal the CRC
after patching fields so they keep testing the field validators (torn-write
behavior is covered by the new file).

## Cross-browser verification

`playwright.config.ts` now has **firefox** and **webkit** (Safari engine)
projects alongside chromium, plus an opt-in **msedge** project (Edge runs
the Chromium engine, so the chromium project covers it; the msedge channel
runs when Edge is installed). Benchmark specs stay chromium-only for
comparability; correctness specs run on all engines:

```
npx playwright test sab-chunking cross-browser-correctness \
  --project=chromium --project=firefox --project=webkit
```

New spec `tests/benchmark/cross-browser-correctness.spec.ts` runs the full
lifecycle in real browsers (real OPFS, real workers, real SAB relay):
tree build → listings → rename → deletions → error codes → deep nesting →
flush/CRC persistence.

**Results: Chromium ✅, Firefox ✅, WebKit ✅ — all engines pass both
correctness specs (6/6).** Getting WebKit green required root-causing and
fixing three **pre-existing** incompatibilities (each verified identical on
the unmodified 3.0.55 build), all stemming from one WebKit architectural
fact: *MessagePort delivery and all size-changing OPFS operations are
brokered through the page's main thread* — which a busy-spinning sync
caller blocks.

1. **Dispatch loop parked forever on first sync op.** The leader loop's
   `yieldToEventLoop()` was a MessageChannel self-ping; with the main
   thread spinning, WebKit never delivered it, so the loop never read the
   request — while the heartbeat (a plain timer, unaffected) kept ticking,
   correctly silencing the stall guard. Fix: race the self-ping against a
   1ms timer ([sync-relay.worker.ts](src/src/workers/sync-relay.worker.ts)
   `yieldToEventLoop`). Chromium/Firefox behavior unchanged (the ping wins).
2. **Multi-chunk transfers wedged on a lost cross-thread wake.** The chunk
   handshake had two *unbounded* `Atomics.wait`s (readPayload, chunked
   writeResponse); WebKit can fail to deliver a main-thread `Atomics.notify`
   to a worker under spin, sleeping the worker forever. Fix: all protocol
   waits now go through `waitWhile` with 50ms slices — a lost wake costs
   50ms, a dead counterpart throws into the crash-restart machinery.
3. **File growth deadlocks against a spinning sync caller.** Empirically
   (probe in the session log): BOTH `truncate` and extending `write` block
   until the main thread returns to its event loop — a sync caller
   therefore deadlocks any growth until its stall guard aborts (this also
   explained an earlier mystery: an FWRITE measuring exactly ~20s — the
   abort itself un-deadlocked the growth). Since a sync caller can never
   yield, growth must only happen at provably-safe moments: the engine now
   maintains a **64MB free-tail headroom** (`maybePreGrow`), grown at init
   (main thread awaiting) and replenished from the dispatch loop only after
   **25ms of quiet** ; `trimTrailingBlocks` preserves the headroom so
   grow/trim don't oscillate. Bursts of back-to-back sync writes totalling
   >64MB between quiet periods still fall back to in-request growth — on
   WebKit that costs one stall-guard abort (EIO at 30s, raised from 20s so
   a recovered growth survives) with state kept consistent.

Also fixed as part of this work (all browsers benefit):
- engine exceptions can no longer kill the dispatch loop silently: every
  dispatch site goes through `safeHandleRequest` (EIO for that request),
  the loops restart on crash (bounded, then `leader-loop-fatal`), and the
  worker logs uncaught errors/rejections.
- WebKit cannot open OPFS sync access handles in **ephemeral** browsing
  contexts ("unknown transient reason") — true for real Safari private
  browsing too. The Playwright webkit project runs in a persistent context
  via [tests/benchmark/fixtures.ts](tests/benchmark/fixtures.ts).
- WebKit shares origin OPFS across Playwright persistent contexts, so the
  specs now delete their root before init (test hygiene; also exercised the
  documented corruption contract: a torn `.vfs.bin` from a killed session
  makes `init()` reject with its corruption error while falling back to
  OPFS mode, exactly as designed).

Diagnostic scripts preserved: `tests/benchmark/webkit-sync-hang-repro.mjs`
(now passes; start the server with `PORT=3519` first).

**Safari sync throughput (added after maintainer benchmark feedback):**
with `opfsSync` enabled the dispatch loop previously never blocked on the
SAB, so on WebKit — where a spinning sync caller starves MessageChannel
pings — every sync op paid the yield's 1ms fallback-timer tick (~2ms/op
measured in the maintainer's Safari benchmark run). The idle branch now
parks in a bounded `Atomics.wait` (5ms cap with opfsSync, 50ms without,
never with client tabs connected), so the next request's notify wakes the
loop instantly. Measured on Playwright WebKit, benchmark-equivalent
workload: batch write 2.07 → ~0.58ms/op, batch read 0.68 → ~0.05ms/op.
Chromium unchanged (1.25ms/op headless baseline vs 1.18–1.37 after, same
band; interactive Chrome is ~0.07ms/op in the maintainer's runs — headless
OPFS is simply slower, both before and after).

The first iteration of this change had a bug the maintainer's benchmark
run caught: the idle block only checked the SYNC SAB for a pending
request, so an ASYNC request landing during a yield sat out the full
timeout (promises path ~25× slower on Chrome). Fixed by guarding the
block on BOTH SABs; verified async ≈ sync throughput on Chromium and
async writes at ~0.13ms/op on WebKit. The throughput probe now measures
sync AND async paths so this class of miss can't slip through again.

A second real-Safari run then showed ERRATIC sync latency (0.12 →
2.65ms/op across sections): with the worker now sleeping in Atomics.wait
between ops, each LOST main→worker notify (a proven real-Safari behavior
that Playwright's WebKit build does not reproduce) cost the wait's full
100ms budget — a dozen lost wakes across a 500-op batch ≈ the measured
excess. All six post-response waits (leader, OPFS-mode, and follower
loops) now go through `awaitResponseConsumed`, which sleeps in 5ms
slices and re-reads the value, capping a lost wake at 5ms. Verified: no
regression on Chromium/Playwright-WebKit; the improvement itself is only
observable on real Safari (where the wake loss occurs).

Finally, **spin-then-park** removed the remaining per-op exit cost from
the sync hot path: between back-to-back ops the dispatch loop used to
fall out to yield+park (on Safari: a 1ms starved-timer tick, or a park
whose wake can be lost). The inner loop now busy-polls both SABs for
0.25ms before sleeping — but only mid-stream (last request < 20ms ago),
so an idle worker still parks. In a stream, requests are caught by value
with no yields, parks, or cross-thread wakes at all. Measured on
Playwright WebKit: sync writes 0.55 → **0.065ms/op**, sync reads 0.068 →
**0.031ms/op** — the sync path now outruns the async path on the WebKit
engine. Chromium unchanged within its noise band.

**Real-Safari validation: PASSED (2026-06-12).** The maintainer ran the
manual smoke page (`tests/benchmark/safari-smoke.html`) in Safari proper:
full PASS — crossOriginIsolated init, small sync ops, error codes, 2MB and
5MB multi-chunk sync/fd/async round-trips (1–2ms writes), 200-write sync
burst (20ms), flush. Private browsing remains unavailable for the sync API
(WebKit refuses OPFS sync access handles in ephemeral storage).

Note: the local Playwright config now honors `PORT` (another dev server
was squatting :3000 and silently serving 404s to the test pages —
`reuseExistingServer` trusted it; run with `PORT=<free port>` if :3000 is
taken).

## Verification status

- `vitest run`: **680 tests, 0 failures** (was 626 before; +54 new)
- `tsc --noEmit`: clean except one **pre-existing** error in
  `methods/watch.ts:100` (present on the unmodified tree)
- `npm run build`: clean
- micro-benchmarks: before/after outputs saved under `tests/benchmark/`
- Safari deep-dive: see [SAFARI-SYNC-LIMITATIONS.md](SAFARI-SYNC-LIMITATIONS.md)
  (researched + written this session; notable: all APIs the sync path needs
  exist in Safari ≥ 16.4 — the README's Safari footnote describes pre-16.4.
  §8 verifies the MessagePort-through-service-worker question: transfers
  were genuinely broken in Safari TP/11.1 (2017–18, WebKit bugs 178940,
  184254, 184502), fixed by Safari 12; the remaining real constraint is
  that Safari/Firefox don't expose `navigator.serviceWorker` in dedicated
  workers, so the SW hop must stay on the main thread — which
  `filesystem.ts` already does)

## Round 2 (2026-06-12): WebKit fixes + pre-existing errors

- Fixed the WebKit sync-path hang (3 root causes — see cross-browser
  section above). WebKit/Safari-engine now passes the full correctness
  matrix alongside Chromium and Firefox.
- Fixed the pre-existing type error in `methods/watch.ts` by widening
  `WatchListener` / `WatchEventType.filename` to `string | Uint8Array |
  null` ([types.ts](src/src/types.ts)) — the runtime already passed
  `Uint8Array` filenames for `encoding: 'buffer'` watchers (matching
  Node's Buffer behavior); the type now admits it. `tsc` over the project
  tsconfig is **0 errors**.
- New tests: `src/tests/pregrow.test.ts` (9 tests: headroom growth,
  mount-after-growth, burst consumption/replenish, maxBlocks ceiling,
  throttle, trim preservation, grown-region round-trips). Suite total:
  **689 tests, 0 failures**.
- Engine micro-benchmarks re-run after the growth/trim changes: identical
  to the children-index numbers (no regression).

## Explicitly out of scope (candidates for a follow-up)

- `findFreeInode` bulk scanning (1-byte OPFS reads per slot after deletes)
- read-path copy reduction (direct-to-SAB reads would cut 2 of 3 memcpys)
- `allocateBlocks` rotating start cursor for fragmented volumes
- heartbeat bumps from inside long single engine ops (long ops can still
  trip the main-thread stall guard, since `setInterval` can't fire while
  the worker is executing synchronously)
- `getAllDescendants` could reuse the children index (rmdir/rename of huge
  trees still does a full path scan)
- multi-tab WebKit followers — INVESTIGATED AND CHARACTERIZED (see
  `tests/benchmark/multitab.spec.ts`): multi-tab sync + async works fully
  on Chromium and Firefox (verified both directions, current build). On
  WebKit, async cross-tab works fully; follower SYNC ops are
  architecturally blocked: the sync caller busy-spins the follower's main
  thread, and WebKit brokers that tab's MessagePort traffic through that
  same main thread, so the leader's response cannot arrive (identical
  deadlock on unmodified 3.0.55, where it hung the tab forever; now it
  fails with EIO). The forwarder additionally fails FAST after the first
  timeout (instant EIO for ~30s instead of 10s of frozen tab per op) and
  self-heals on any delivered response — async ops keep working throughout
  and clear the suspicion. A real fix would need a transport whose
  delivery doesn't depend on the spinning tab's main thread; the known
  candidate is synchronous XHR intercepted by the service worker (the
  webcontainer-style escape hatch) — a substantial feature, listed below.
- the 64MB pre-growth headroom is a constant (`PREGROW_HEADROOM_BLOCKS`);
  consider exposing it via `limits` config for quota-sensitive deployments
- Safari follower SYNC transport: implement sync-XHR-through-service-worker
  relay (request encoded into a synchronous XMLHttpRequest the SW
  intercepts and forwards to the leader; sync XHR blocks the main thread
  below the JS event loop, so SW fetch handling proceeds in its own
  process). This is the only known way to give WebKit follower tabs a
  working sync API.
