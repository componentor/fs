# Performance Tuning (sync FS) — knobs, defaults, and the mobile story

This document tracks the configuration knobs that affect **synchronous** read/write
throughput, what each one does, and **why** it exists. It is the companion to the
embedding app's own tuning layer (in the webcontainer: `src/shell/exec/fs-tuning.ts`)
— keep the two in lockstep.

Context for why this matters: sync FS was **very fast on Chrome/Android before
3.1.0**, then regressed to slow on mobile while staying fast on every desktop
browser. The knobs below exist so a consumer can reproduce the old behavior and
A/B each suspect *on the device*, then settle on the best fit.

---

## The two things that decide mobile sync throughput

### 1. Where the instance runs — main thread (busy-spin) vs worker (`Atomics.wait`)

A sync op posts a request into a `SharedArrayBuffer` and **blocks** until the
relay worker (which owns the OPFS handle) answers. *How* it blocks is decided by
context — see `spinWait` in [filesystem.ts](src/src/filesystem.ts):

```js
const _canAtomicsWait = typeof globalThis.WorkerGlobalScope !== 'undefined' // true only in a worker
// in a worker:        Atomics.wait(...)            → thread parks, CPU freed
// on the main thread:  while (Atomics.load() === v) {}  → 100% CPU busy-spin
```

`Atomics.wait` is **illegal on the main thread**, so a main-thread instance must
busy-spin. On **desktop** that's survivable (spare cores — the relay worker runs
on another one and answers in microseconds; this is why desktop Chrome/Firefox/
Safari are all fine). On a **core-constrained mobile device** (few cores +
big.LITTLE + thermal/background throttling) the spinning thread **starves the very
relay worker it is waiting for** — they contend for a core, and the scheduler
won't promptly hand the worker a core because the spinner looks busy, not blocked.
Every op pays this.

**Guidance:** when targeting Safari (where a follower *must* run in a worker — see
[SAFARI-SYNC-LIMITATIONS.md](SAFARI-SYNC-LIMITATIONS.md)) **or any mobile / core-
constrained device**, host the instance **inside a worker** so its wait is a real
`Atomics.wait`. Use the `swBridge` option + `createServiceWorkerBridge` (3.2.0+)
to give a worker-hosted instance access to the multi-tab broker. The deciding
question is not "is this Safari?" but **"can the main thread afford to busy-spin?"**
— *no* on mobile, *yes* on desktop.

### 2. The OPFS mirror — `mode` / `opfsSync` (the main write-cost knob)

| `mode`     | OPFS mirror | Persistence | Write cost |
|------------|-------------|-------------|------------|
| `'vfs'`    | off         | `.vfs.bin` binary only — no real OPFS files | **lowest** |
| `'hybrid'` | **on** (default) | `.vfs.bin` + every write mirrored to real OPFS files | highest |
| `'opfs'`   | n/a         | real OPFS files only (no binary fast path) | n/a |

`mode` **defaults to `'hybrid'`**, which sets `opfsSync` on and mirrors *every
write* to a real OPFS file tree (for interop — so tools that bypass the VFS binary
still see the files). On a desktop SSD that's cheap; on **mobile flash it is the
dominant write cost**, and it also drives the relay loop's busier path (5 ms idle
park + per-op external-change message processing instead of the quiet 50 ms park).

If the embedding app reads everything *through* this library (never touching real
OPFS files directly), the mirror is pure overhead and **`mode: 'vfs'` is the
fastest, safest win** — especially on mobile. Reads are unaffected by `mode`.

### 3. `forceSpin` — override the WebKit-only workarounds (added 3.2.9)

The relay leader loop carries three WebKit-only workarounds (busy-poll spin,
starvation-timer yield, 5 ms-sliced response wait) gated behind an `IS_WEBKIT` UA
check (3.2.8). They are off on Chromium/Gecko (incl. Android) already. `forceSpin`
overrides that detection from config, mirroring the `self.__fs_force_spin` runtime
global:

- `forceSpin: undefined` (default) → auto (spin only on WebKit)
- `forceSpin: false` → never spin (force the reliable-wake path everywhere)
- `forceSpin: true` → always run the workarounds (mainly for reproducing Safari
  behavior elsewhere)

This is mainly a correctness/A-B lever; on Android the workarounds are already off,
so it is **not** expected to be the regression — `mode` and hosting are.

---

## Config surface

```ts
createFS({
  mode: 'vfs' | 'hybrid' | 'opfs',   // OPFS mirror (default 'hybrid')
  opfsSync: boolean,                 // force mirror on/off independent of mode
  forceSpin: boolean | undefined,    // override IS_WEBKIT spin workarounds (3.2.9+)
  swBridge: MessagePort,             // run hosted-in-worker (Safari + mobile); see readme
  debug: true,                       // per-op timing logs: [syncRequest] roundTrip=…ms + relay handleRequest=…ms
})
```

Runtime escape hatches (no rebuild — set before init):
- `self.__fs_force_spin = true | false` — overrides `forceSpin` live in the relay worker.

---

## Reproducing the pre-3.1.0 "fast on Android" baseline

The relay architecture (separate worker owning the OPFS handle) predates 3.1.0, so
the regression is a *default/mechanism* change, not the relay itself. To bisect,
hold everything else constant and flip one knob at a time on the device:

1. **`mode: 'vfs'`** (disable the OPFS mirror) — the leading suspect. Biggest write
   lever; also quiets the relay loop. Verify nothing in the app depends on real
   OPFS files.
2. **Host the instance in a worker** (`swBridge`) if any sync FS happens on the main
   thread — converts the busy-spin into `Atomics.wait`.
3. **`forceSpin: false`** — confirms the WebKit workarounds aren't leaking onto
   Android (they shouldn't, post-3.2.8).

Use `debug: true` to read `roundTrip` (caller-side, full op) vs `handleRequest`
(relay-side, the OPFS work). If `roundTrip ≫ handleRequest`, the cost is in
scheduling/wakes (hosting / spin); if `handleRequest` itself is large, it's OPFS
(the mirror / `mode`).

Once a combination is confirmed fast on-device, promote it to the library defaults
and record the change below.
