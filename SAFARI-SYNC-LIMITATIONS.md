# Safari/WebKit and the @componentor/fs Synchronous API

**Status of this document:** research snapshot, June 2026.
**Scope:** why the synchronous (`readFileSync`-style) path of this library is degraded or fragile on Safari/WebKit, what is spec-mandated vs. WebKit-specific, and what WebKit would need to ship for parity with Chromium.

---

## 1. Executive summary

- The single biggest constraint on the sync API — **`Atomics.wait()` being forbidden on the main thread** — is **spec-mandated in every browser**, not a Safari bug. The library works around it with a heartbeat-supervised spin-wait (`spinWait` in [`src/src/filesystem.ts`](src/src/filesystem.ts), lines ~69–135), which burns a CPU core while a sync op is in flight. That cost is identical in Chrome, Firefox and Safari.
- As of **Safari 16.4 (March 2023)** every primitive the sync path *nominally* needs exists in WebKit: `SharedArrayBuffer` + `Atomics` under COOP/COEP (15.2), nested dedicated workers (16.4), module workers (15), fully synchronous `FileSystemSyncAccessHandle` methods (16.4), `Atomics.waitAsync` (16.4), and Web Locks / BroadcastChannel (15.4). The README's blanket "Safari doesn't support SharedArrayBuffer in the required context" footnote reflects the pre-16.4 world and is now an over-simplification.
- What still genuinely hurts on Safari today is **operational, not API-surface**: an observed OPFS write→lookup **visibility lag** after `createSyncAccessHandle` writes (worked around in [`src/src/workers/opfs-sync.worker.ts`](src/src/workers/opfs-sync.worker.ts)); **no `FileSystemObserver`** (external-change sync silently unavailable); **no `createSyncAccessHandle({ mode })`** (always exclusive single-handle locking); historically aggressive **service-worker termination** (the multi-tab port broker depends on a SW); and aggressive **background-tab suspension** that can freeze the leader tab's heartbeat and make follower tabs' spin-waits abort.
- Concrete WebKit wish-list: ship `FileSystemObserver`, ship the `mode` option (`readwrite-unsafe`) for sync access handles, fix OPFS metadata-visibility lag after sync-handle writes, keep service workers with live transferred `MessagePort`s alive, and exempt cross-origin-isolated pages holding Web Locks from full tab suspension. None of these is currently announced for a Safari release.
- **Multi-tab sync is solved for Safari** (§10): single-tab / leader sync works on the main thread, and *follower* sync works too **when the instance runs inside a worker** (the natural shape for an OS/runtime-in-browser). The only combination that is genuinely impossible on Safari is *follower + main-thread caller* — because the blocker is cross-tab MessagePort delivery to the follower's relay worker while the main thread busy-spins, not the SAB transfer itself.

---

## 2. How the library's sync path works (brief)

Reference: [`src/shared-memory-architecture.md`](src/shared-memory-architecture.md), [`src/src/filesystem.ts`](src/src/filesystem.ts).

1. The page must be **cross-origin isolated** (`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`), otherwise `SharedArrayBuffer` is not exposed and `ensureReady()` throws `"Sync API requires crossOriginIsolated (COOP/COEP headers)"` ([`filesystem.ts`](src/src/filesystem.ts) line ~736). The async `promises` API keeps working without isolation via a plain `MessageChannel` fallback.
2. Each tab allocates **SharedArrayBuffers** (`sab`, `readySab`, `asyncSab`) and posts them to its own dedicated **sync-relay worker** ([`filesystem.ts`](src/src/filesystem.ts) `sendLeaderInit`, line ~353). SABs only ever travel main-thread → same-tab dedicated worker, i.e. inside one agent cluster — required by spec (see §4.1).
3. A sync call serializes the request into the SAB, signals via `Atomics.store`/`Atomics.notify`, and **blocks** until the relay worker writes the response:
   - In a worker caller: real `Atomics.wait` (kernel-level park, 0% CPU).
   - On the main thread: **spin-wait** on `Atomics.load`, supervised by a **heartbeat counter** the relay worker bumps ~1×/s (`SAB_OFFSETS.HEARTBEAT`). The spin aborts only if the heartbeat stalls for `SPIN_STALL_TIMEOUT_MS = 20 s` — i.e. it aborts on a *dead* worker, never a *slow* op (`spinWait`, [`filesystem.ts`](src/src/filesystem.ts) lines 98–135).
4. The leader tab's sync-relay worker spawns a **nested worker** ([`src/src/workers/sync-relay.worker.ts`](src/src/workers/sync-relay.worker.ts) line ~1236) that mirrors writes to OPFS using `FileSystemSyncAccessHandle` ([`opfs-sync.worker.ts`](src/src/workers/opfs-sync.worker.ts)).
5. Multi-tab: one tab is elected **leader** via `navigator.locks`; follower tabs' relay workers reach the leader's server worker through `MessagePort`s **transferred through a Service Worker** broker ([`filesystem.ts`](src/src/filesystem.ts) line ~486, `sw.postMessage({type:'transfer-port'}, [mc.port2])`). Only ports and ArrayBuffers cross tabs — never SABs.
6. **External-change detection** (OPFS → VFS) uses `FileSystemObserver` where available.

---

## 3. What works in Safari today

| Primitive the library needs | Safari since | Source |
|---|---|---|
| `SharedArrayBuffer` + `Atomics` (under COOP/COEP) | 15.2 | [WebKit bug 229559](https://bugs.webkit.org/show_bug.cgi?id=229559), [caniuse](https://caniuse.com/sharedarraybuffer), [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer) |
| `crossOriginIsolated` flag | 15.2 | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated) |
| `Atomics.wait` / `Atomics.notify` (workers) | 15.2 | [BCD Atomics data](https://github.com/mdn/browser-compat-data/blob/main/javascript/builtins/Atomics.json) |
| `Atomics.waitAsync` | 16.4 | [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics/waitAsync), BCD (Chrome 87/90, Firefox 145) |
| `Atomics.pause` (spin-loop hint) | 18.4 | BCD (Chrome 133, Firefox 137); [TC39 microwait proposal](https://github.com/tc39/proposal-atomics-microwait) |
| Growable `SharedArrayBuffer` | 16.4 | [BCD SharedArrayBuffer data](https://github.com/mdn/browser-compat-data/blob/main/javascript/builtins/SharedArrayBuffer.json) |
| Module workers (`new Worker(url, {type:'module'})`) | 15 | [BCD Worker data](https://github.com/mdn/browser-compat-data/blob/main/api/Worker.json) |
| **Nested** dedicated workers (worker spawning a worker) | 16.4 | BCD; [WebKit bug 22723](https://bugs.webkit.org/show_bug.cgi?id=22723), [implementation commit](https://github.com/WebKit/WebKit/commit/48880e342359f100878b1b87373e706db7dfe540) |
| `FileSystemFileHandle.createSyncAccessHandle()` (OPFS, workers) | 15.2 — Safari shipped it first | [WebKit blog: "The File System Access API with OPFS"](https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle) |
| Fully **synchronous** `close/flush/getSize` on sync access handles | 16.4 (15.2–16.3 returned Promises) | [BCD FileSystemSyncAccessHandle data](https://github.com/mdn/browser-compat-data/blob/main/api/FileSystemSyncAccessHandle.json) |
| Web Locks (`navigator.locks`), BroadcastChannel | 15.4 | [MDN Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) |
| Service workers | 11.1 | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorker) |
| `FileSystemFileHandle.createWritable()` (async path nicety) | 26 (2025) | [BCD FileSystemFileHandle data](https://github.com/mdn/browser-compat-data/blob/main/api/FileSystemFileHandle.json); previously missing, see e.g. [eclipse-theia/theia#16107](https://github.com/eclipse-theia/theia/issues/16107) |

**Practical floor: Safari 16.4** — that is the first version with nested workers + truly-sync access-handle methods + `Atomics.waitAsync`, all of which the leader pipeline relies on. (On Safari 15.2–16.3 the architecture cannot work: the sync-relay worker cannot even spawn the OPFS mirror worker — the same failure class documented in [wasm-bindgen#3048](https://github.com/rustwasm/wasm-bindgen/issues/3048), `ReferenceError: Can't find variable: Worker`.)

---

## 4. What doesn't work, and exactly why

### 4.1 Spec-mandated limits — identical in Chrome, Firefox and Safari

These are *not* Safari bugs and WebKit cannot "fix" them unilaterally:

1. **`Atomics.wait` throws on the main thread.** ECMA-262 makes `Atomics.wait` throw a `TypeError` when the agent's `[[CanBlock]]` is false ([spec: Atomics.wait → DoWait → AgentCanSuspend](https://tc39.es/ecma262/multipage/structured-data.html#sec-atomics.wait)), and the HTML spec defines similar-origin window agents with `[[CanBlock]] = false` ([HTML: agent formalism](https://html.spec.whatwg.org/multipage/webappapis.html#integration-with-the-javascript-agent-formalism)). Workers may block; documents may not. This is why `_canAtomicsWait` ([`filesystem.ts`](src/src/filesystem.ts) line 82) checks for `WorkerGlobalScope` and the main thread spin-waits instead.
2. **`SharedArrayBuffer` requires cross-origin isolation** (COOP+COEP) in all engines since 2020-21 ([web.dev: COOP/COEP](https://web.dev/articles/coop-coep)). Without the headers there is no sync API anywhere, Safari included.
3. **SABs cannot cross agent clusters.** Structured serialization of a SAB to a different agent cluster (another tab, a service worker) throws ([HTML: StructuredSerializeInternal](https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal)). This is why the multi-tab design gives *each tab its own SAB* and relays cross-tab traffic over MessagePorts — required behavior, not a workaround for Safari.
4. **`createSyncAccessHandle` is worker-only and (by default) exclusive.** The WHATWG File System spec restricts sync access handles to dedicated workers and the default `"readwrite"` mode takes an exclusive lock — one open handle per file ([MDN createSyncAccessHandle](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle), [WHATWG fs spec](https://fs.spec.whatwg.org/)).

### 4.2 Safari/WebKit-specific gaps and behaviors

1. **No `FileSystemObserver`.** Chrome shipped it in 133 (origin-trialed from 129); Safari and Firefox have **no support** ([BCD FileSystemObserver data](https://github.com/mdn/browser-compat-data/blob/main/api/FileSystemObserver.json)). WebKit has **no published standards position** — the request ([WebKit/standards-positions#291](https://github.com/WebKit/standards-positions/issues/291), opened Dec 2023) sits open with no comments. On Safari, external OPFS modifications are never synced back into the VFS; the feature degrades silently (readme already scopes it "Chrome 129+").
2. **No `createSyncAccessHandle({ mode })`** — `"readwrite-unsafe"` / `"read-only"` modes are Chrome 121+ only ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle)). WebKit's implementation has always been strictly exclusive: *"An access handle must have exclusive access to a file entry... the attempt to create a second FileSystemSyncAccessHandle on an entry will fail"* ([WebKit blog](https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/)). Consequence for this library: the leader's long-lived `.vfs.bin` handle ([`server.worker.ts`](src/src/workers/server.worker.ts) line ~365), the repair worker, and the OPFS mirror must never overlap on the same file — any accidental overlap that Chrome would tolerate under `readwrite-unsafe` is a hard `InvalidStateError`/`NoModificationAllowedError` on Safari, and a handle leaked by a crashed worker stays locked until WebKit collects it.
3. **OPFS visibility lag after sync-handle writes (observed WebKit behavior).** Safari exhibits a brief window where a file just written via `createSyncAccessHandle` is **not yet visible** to a subsequent `getFileHandle()` (`NotFoundError`), and directories can surface as `NotFound` instead of `TypeMismatchError`. This bit this library in production (`printf x > a; mv a b` lost the rename) and is worked around with a bounded retry ladder — 6 attempts, ~120 ms total backoff — in [`opfs-sync.worker.ts`](src/src/workers/opfs-sync.worker.ts) lines ~259–315 (see changelog entries 3.0.54/3.0.55 in [`CHANGELOG.md`](CHANGELOG.md)). No public WebKit bug number is attached to this; it deserves a reduced test case filed at bugs.webkit.org.
4. **SAB sharing bugs on secondary messaging APIs.** WebKit has open reports that SABs posted over some channels are not actually shared: [bug 237144](https://bugs.webkit.org/show_bug.cgi?id=237144) (SAB posted to an `AudioWorkletProcessor` isn't shared with the main thread) and [bug 238442](https://bugs.webkit.org/show_bug.cgi?id=238442) ("SharedArrayBuffers do not get cloned on some messaging APIs"). The library's SAB hops (window → dedicated worker via `Worker.postMessage`, worker → nested worker) are the *mainstream* paths exercised by Wasm-threads apps and are believed solid in 16.4+, but these bugs show WebKit's SAB serialization coverage is historically patchier than Chromium's — any future routing of a SAB over a transferred `MessagePort` should be regression-tested on WebKit first.
5. **Aggressive service-worker termination.** All engines kill idle SWs ("terminated when idle for a few seconds", [MDN ServiceWorkerGlobalScope](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope)), but WebKit is at the aggressive end and has shipped regressions where the SW would die after ~30 s and *never wake again* (iOS 17.4–17.6 era; [Apple Developer Forums thread 735307](https://developer.apple.com/forums/thread/735307), [thread 758346](https://developer.apple.com/forums/thread/758346)). WebKit also throttles SW timers heavily ([bug 185575](https://bugs.webkit.org/show_bug.cgi?id=185575)). The library's port broker already assumes SW death: the leader re-registers its control port on a **5 s heartbeat** and the SW flushes queued `transfer-port` messages (changelog 3.0.x, "Multi-tab broker survives service-worker idle-kill"). On Safari this heartbeat is *essential*, and a follower tab joining while the SW is being restarted sees added latency on its first sync op.
6. **Background-tab suspension can freeze the leader.** Safari throttles/suspends background pages more aggressively than Chrome (tab purging / full process suspension; see [overview of inactive-tab throttling](https://aboutfrontend.blog/tab-throttling-in-browsers/) and [why browsers throttle timers](https://nolanlawson.com/2025/08/31/why-do-browsers-throttle-javascript-timers/)). Dedicated workers are normally exempt from *timer throttling*, but a fully **suspended** leader tab stops its sync-relay worker — and with it the heartbeat — while still holding the `vfs-server` Web Lock (a suspended process does not release locks). Followers then hit the 20 s `SPIN_STALL_TIMEOUT_MS` abort: *"relay worker heartbeat stalled... worker is unresponsive"*. On Chrome this scenario is rare (workers keep running in background tabs); on Safari it is a realistic failure mode for which there is no clean recovery short of the user refocusing or closing the leader tab.
7. **`COEP: credentialless` is not implemented and WebKit has signaled it does not plan to** ([Chrome intent thread noting WebKit's stance](https://groups.google.com/a/chromium.org/g/blink-dev/c/Zr9n9_LG7s4/m/4y-b481hBAAJ); [WebKit standards-positions](https://webkit.org/standards-positions/)). Deployments on Safari must use strict `require-corp`, meaning every cross-origin subresource needs CORP/CORS headers — a deployment-cost difference, not a functional gap.

### 4.3 What this means for the README claim

`readme.md` states "Safari 15.2+ — Sync API: No (Safari doesn't support SharedArrayBuffer in the required context)". Precisely: Safari 15.2–16.3 could not run this architecture (no nested workers, Promise-returning sync-handle methods), but **Safari 16.4+ exposes every required API**. The honest current statement is: *sync API on Safari ≥ 16.4 is unverified/fragile due to §4.2 items 3–6, not API-absent*. Re-testing against current Safari (and adding a WebKit project to [`playwright.config.ts`](playwright.config.ts), which today defines no WebKit target) is the cheapest next step.

---

## 5. What WebKit would need to ship or fix

In priority order for this library:

1. **Fix OPFS post-write visibility lag** — make a file written through a `FileSystemSyncAccessHandle` immediately observable via `getFileHandle()`/`getDirectoryHandle()` in the same worker, and report directories as `TypeMismatchError` (not `NotFoundError`). *(Needs a filed reduction; no known tracking bug — file at [bugs.webkit.org, component File System API](https://bugs.webkit.org/), cf. meta-bug [231706](https://bugs.webkit.org/show_bug.cgi?id=231706).)*
2. **Ship `FileSystemObserver`** — adopt a position on [WebKit/standards-positions#291](https://github.com/WebKit/standards-positions/issues/291) and implement, so external-change sync works. Until then this feature is Chromium-only by necessity.
3. **Ship `createSyncAccessHandle({ mode })`** (`"read-only"`, `"readwrite-unsafe"`) per the [WHATWG fs](https://fs.spec.whatwg.org/) extension implemented in Chrome 121 — removes the hard exclusivity hazard between leader handle, repair worker and mirror worker.
4. **Service-worker lifetime guarantees** — keep a SW (or its queued messages) reliably wake-able when it brokers live `MessagePort`s; fix the "killed and never wakes" class of regressions ([forums 735307](https://developer.apple.com/forums/thread/735307)) and relax SW timer throttling ([bug 185575](https://bugs.webkit.org/show_bug.cgi?id=185575)).
5. **Background-suspension carve-out** — don't fully suspend a cross-origin-isolated page whose workers hold Web Locks that other same-origin pages are queued on (or release/steal the lock on suspension so followers can fail over). Today suspension freezes the leader *while keeping its leadership lock*, the worst of both worlds.
6. **Closed-coverage SAB serialization** — resolve [bug 238442](https://bugs.webkit.org/show_bug.cgi?id=238442) / [bug 237144](https://bugs.webkit.org/show_bug.cgi?id=237144) so a SAB posted over *any* legal channel inside one agent cluster is actually shared.

Not needed from WebKit (already shipped): `Atomics.waitAsync` (16.4), `Atomics.pause` (18.4), growable SAB (16.4), nested workers (16.4), sync access-handle methods (16.4), `createWritable` (26).

Not fixable by WebKit (spec): main-thread `Atomics.wait`, SAB cross-cluster transfer, worker-only sync handles (§4.1).

---

## 6. Workarounds the library uses today, and their costs

| Workaround | Where | Cost |
|---|---|---|
| Main-thread **spin-wait** instead of `Atomics.wait` | `spinWait`, [`filesystem.ts`](src/src/filesystem.ts) 98–135 | Burns ~100% of one core and blocks the event loop for the duration of every main-thread sync op, in **all** browsers (spec limit, §4.1.1). `Atomics.pause` (Safari 18.4+/Chrome 133+) could cut power draw and hyper-thread contention inside the loop, but cannot un-block the event loop or reduce it to a real wait. |
| **Heartbeat-supervised stall detection** (1 s pulse, 20 s stall abort) instead of a wall-clock timeout | [`filesystem.ts`](src/src/filesystem.ts) 76–96; relay worker pulse | Distinguishes dead worker from slow op; but on Safari a *suspended* (not dead) leader looks identical to a dead one → spurious aborts after 20 s (§4.2.6). |
| **Rename retry ladder** for OPFS visibility lag (6 attempts, ~8–48 ms backoff, dir-branch last resort) | [`opfs-sync.worker.ts`](src/src/workers/opfs-sync.worker.ts) 259–315 | Up to ~120 ms added latency on affected renames; masks rather than fixes the WebKit lag. |
| **SW re-registration heartbeat (5 s)** + queued `transfer-port` flush | broker logic, [`filesystem.ts`](src/src/filesystem.ts) ~486–605 | Constant low-rate timer traffic; follower join latency spikes when the SW was just killed. Essential on Safari (§4.2.5). |
| **Graceful no-SAB fallback** — sync API throws a clear error, `promises` API runs over `MessageChannel` | [`filesystem.ts`](src/src/filesystem.ts) 146, 424–434, 736 | On any non-isolated page (or old Safari) you lose the sync API entirely but keep full async functionality. |
| **Per-tab SAB + port relay** through leader (never shipping SABs cross-tab) | architecture §2–4 of [`shared-memory-architecture.md`](src/shared-memory-architecture.md) | Extra hop for follower sync ops; required by spec everywhere (§4.1.3), so no Safari-specific penalty. |
| Exclusive-handle discipline (open→use→close per op in the mirror; single long-lived `.vfs.bin` handle) | [`opfs-engine.ts`](src/src/opfs-engine.ts), [`server.worker.ts`](src/src/workers/server.worker.ts) | Handle churn on every mirrored op; on Safari there is no `readwrite-unsafe` escape hatch if two components ever need the same file simultaneously (§4.2.2). |

---

## 7. Realistic outlook

- **Spec-side:** nothing will ever allow true `Atomics.wait` on the main thread; the committee-blessed alternative is `Atomics.waitAsync` (Safari 16.4+), which helps *async* coordination but by definition cannot back a synchronous `fs` API. [`Atomics.pause`](https://github.com/tc39/proposal-atomics-microwait) (Safari 18.4+) is the only realistic incremental improvement to the spin loop and is worth adopting in `spinWait` now that all engines ship it.
- **WebKit-side:** OPFS investment has been real but async-leaning (`createWritable` in Safari 26, WritableStream-based APIs). There is **no public signal** on `FileSystemObserver` ([position request open since 2023](https://github.com/WebKit/standards-positions/issues/291)) or sync-handle `mode`. Treat both as "not before Safari 27, possibly never" until a position appears.
- **For this library:** Safari ≥ 16.4 should be re-qualified as "sync API: experimental" rather than "No". The decisive work items are on our side (add a WebKit Playwright project; file the OPFS visibility-lag reduction upstream) and on WebKit's side items §5.1–5.5. Until the suspension and SW-lifetime behaviors change, multi-tab sync on Safari should be expected to degrade when the leader tab is backgrounded for long periods — the async `promises` API remains the dependable path on Safari.

---

## 8. MessagePort transfer through the Service Worker broker

> **Added June 2026 — verification of the maintainer's recollection:** *"Safari may block transferring MessagePorts through a service worker, unlike Chrome and Firefox."*
>
> **Verdict: wrong for current Safari; essentially correct for a ~9-month window in 2017–2018.** Transferring `MessagePort`s to and from a service worker was rejected with `NotSupportedError` in the Safari Technology Preview builds that first carried service workers (late 2017, [WebKit bug 178940](https://bugs.webkit.org/show_bug.cgi?id=178940)), and the first stable release, **Safari 11.1 (March 2018), shipped with port-transfer regressions** ([bug 184254](https://bugs.webkit.org/show_bug.cgi?id=184254), [bug 184502](https://bugs.webkit.org/show_bug.cgi?id=184502)). Those were resolved during the 2018 cycle; from **Safari 12 (September 2018) onward** the port relay this library uses is spec-conformant and there is **no open WebKit bug** about dropped/null/blocked ports through a SW. The *adjacent* limitation that is real **today**: Safari (and Firefox) do not expose `navigator.serviceWorker` inside dedicated workers, so the hop *to* the SW can only be made from the window — which is how [`filesystem.ts`](src/src/filesystem.ts) already does it.

### 8.1 What the spec guarantees

`MessagePort` is a transferable object for *every* `postMessage` flavor — `ServiceWorker.postMessage(message, transfer)` from a client, `Client.postMessage(message, transfer)` from SW scope, and `MessagePort.postMessage(message, transfer)` in either direction ([WHATWG HTML, channel messaging / structured serialize with transfer](https://html.spec.whatwg.org/multipage/web-messaging.html); [MDN `ServiceWorker.postMessage`](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorker/postMessage), [MDN `Client.postMessage`](https://developer.mozilla.org/en-US/docs/Web/API/Client/postMessage)). A port arriving in a SW surfaces on [`ExtendableMessageEvent.ports`](https://developer.mozilla.org/en-US/docs/Web/API/ExtendableMessageEvent/ports). Crucially, transferring a port **re-entangles the channel between the new owners**: once the broker in [`service.worker.ts`](src/src/workers/service.worker.ts) has forwarded a follower's port to the leader, the SW holds no endpoint of that channel at all.

### 8.2 Historical record — where the recollection comes from

| When | What | Evidence |
|---|---|---|
| Dec 2017 (STP 46/47 era) | `sw.postMessage(msg, [port])` threw **`NotSupportedError: "Passing MessagePort objects to postMessage is not yet supported"`**. Broke angular.io's ngsw on Safari preview. | [angular/angular#21139](https://github.com/angular/angular/issues/21139) (filed 2017-12-21), which cites [WebKit bug 178940](https://bugs.webkit.org/show_bug.cgi?id=178940) as the underlying issue, with a WebKit engineer noting a fix was planned before stable. |
| Jan–Feb 2018 | WebKit rebuilt `MessagePort` to be **cross-process** (new `MessagePortChannelProvider` abstraction, a `MessageWithMessagePorts` object "used with all forms of postMessage") so ports could reach the out-of-process service worker. | WebKit changesets in the [STP 48/49 window](https://webkit.org/blog/8088/release-notes-for-safari-technology-preview-49/) (r227071–227873); SW announcement: [“Workers at Your Service”](https://webkit.org/blog/8090/workers-at-your-service/). |
| Mar 2018 — **Safari 11.1** | Service workers ship in stable, port transfer nominally included — but the new machinery regressed: **[bug 184254](https://bugs.webkit.org/show_bug.cgi?id=184254) "REGRESSION: MessagePort.postMessage() fails to send transferable objects"** (an ArrayBuffer transferred over a `MessageChannel` port arrived as `null` in 11.1; worked in prior stable) and **[bug 184502](https://bugs.webkit.org/show_bug.cgi?id=184502) "Safari 11.1: MessageChannel no longer works between Workers"** (both filed April 2018). | bugs.webkit.org, titles/repro as linked. |
| Sept 2018 — **Safari 12** | The 11.1 regression class disappears; community reports of "Safari can't do MessageChannel with a SW" stop after this cycle, and contemporaneous workaround articles (e.g. web.dev's two-way-communication guidance steering people to `Client.postMessage` iteration) date from this era. *(Precise fix changesets for 184254/184502 could not be confirmed from this environment — network access to bugs.webkit.org was unavailable; treat "fixed by Safari 12" as inferred-from-absence plus the 2018 fix activity, not a quoted resolution comment.)* | [workbox#1730](https://github.com/GoogleChrome/workbox/issues/1730)-era issue trail; [web.dev two-way communication guide](https://web.dev/articles/two-way-communication-guide). |

So the recollection is a faithful memory of **Safari 11.0–11.1 (2017–2018)**. It does not describe any Safari a user can run in 2026.

### 8.3 Direction 1 — client → SW (`transfer-port` in our protocol)

Works in current Safari **from a window**. Our follower hop ([`filesystem.ts`](src/src/filesystem.ts) line ~486, `sw.postMessage({type:'transfer-port'}, [mc.port2])`) and leader hop (line ~577, `register-server` + control port) both run on the main thread, which is the supported path. Two caveats, neither a port-transfer block:

1. **No `navigator.serviceWorker` in dedicated workers.** `WorkerNavigator.serviceWorker` is Chromium-only; Safari and Firefox never shipped it ([w3c/ServiceWorker#1552](https://github.com/w3c/ServiceWorker/issues/1552), [Mozilla bug 1113522](https://bugzilla.mozilla.org/show_bug.cgi?id=1113522), [MDN ServiceWorkerContainer](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer)). A design that did "client *worker* → postMessage(port) → SW" directly would fail on Safari at the `navigator.serviceWorker` lookup, before any transfer is attempted. This library is already shaped correctly: the relay worker gets `mc.port1` via `Worker.postMessage` and only the window talks to the SW. **Do not "simplify" by moving `getServiceWorker()` into the relay worker.**
2. Ports posted while the SW is being spun up are fine (the `pending[]` queue in [`service.worker.ts`](src/src/workers/service.worker.ts) handles leader-not-yet-registered), but see §8.5 for what happens if WebKit kills the SW while ports sit in that queue.

### 8.4 Direction 2 — SW → client

Current Safari supports both mechanisms for handing a port back out of SW scope: `Client.postMessage(message, transfer)` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Client/postMessage); supported alongside the SW API shipped in 11.1 per [caniuse/BCD](https://caniuse.com/mdn-api_serviceworker_postmessage)) and what this library actually uses — forwarding over an already-held `MessagePort` (`serverPort.postMessage({...}, [port])`, [`service.worker.ts`](src/src/workers/service.worker.ts) lines 44–61). The port-over-port form was exactly the surface broken by [bug 184254](https://bugs.webkit.org/show_bug.cgi?id=184254)/[184502](https://bugs.webkit.org/show_bug.cgi?id=184502) in 11.1 and is exercised today by other OPFS multi-tab brokers (the `SharedService` pattern from the [wa-sqlite ecosystem](https://github.com/rhashimoto/wa-sqlite/discussions/81) ships a service-worker port-passing variant *specifically* for browsers without `SharedWorker`, Safari included). No open WebKit bug reports null/empty `event.ports` on either mechanism.

### 8.5 Do relayed channels survive SW termination?

**Established channels: yes.** After the broker forwards a follower's port, the channel is entangled follower-relay-worker ↔ leader-sync-worker; the SW owns no endpoint, so idle-kill cannot disentangle it (spec consequence of transfer, §8.1). Implementation-wise WebKit routes port traffic through a central cross-process registry (`MessagePortChannelRegistry`/`MessagePortChannelProvider`, the 2018 machinery above, since consolidated process-side — see e.g. [r249801](https://trac.webkit.org/changeset/249801/webkit) keying SW connections stably across **network-process** crashes), not through the SW's process. We found **no report, WebKit bug, or library issue** of an already-relayed channel dying when Safari reaps the SW — including the iOS 17.4–17.6 "SW never wakes again" regression window ([Apple forums 735307](https://developer.apple.com/forums/thread/735307)), which broke *new* joins, not standing channels.

**In-flight ports: no.** A port sitting in the SW's in-memory `pending[]` array ([`service.worker.ts`](src/src/workers/service.worker.ts) line 21) when the instance is terminated is destroyed with the global scope, and the follower's surviving end goes silent — historically with no signal at all (`MessagePort` had no `close` event; one was added to HTML and is only now rolling out across engines — feature-detect before relying on it). This is precisely the hole the 5 s `register-server` heartbeat + pending-flush ([`filesystem.ts`](src/src/filesystem.ts) `initLeaderBroker`) papers over, and on Safari's aggressive SW reaping (§4.2.5) that heartbeat is what makes the broker dependable, not port-transfer support, which is fine.

### 8.6 Bottom line for this library

- The broker architecture requires **zero Safari-specific changes** for port transfer itself (Safari ≥ 12; in practice the §3 floor of 16.4 governs anyway).
- The real Safari risks around the broker are the **lifecycle** ones already documented (§4.2.5–4.2.6): SW idle-kill losing queued ports (mitigated), and leader-tab suspension freezing the far end of a perfectly healthy channel.
- Keep all `navigator.serviceWorker` access on the main thread (§8.3.1) — that is the one hard "Safari blocks this" fact in this area, and it is about API exposure, not port transfer.

---

## 9. Empirically verified on Playwright WebKit (2026-06-12) — and fixed

Hands-on debugging of this library against Playwright's WebKit build
(see `PERF-RELIABILITY-REPORT.md` for methodology and fixes) established
three concrete WebKit behaviors the desk research above could not have
predicted. All three share one root: **WebKit routes MessagePort delivery
and size-changing OPFS operations through machinery that requires the
page's main thread to reach its event loop** — which a busy-spinning
synchronous caller prevents.

1. **MessageChannel self-pings inside a worker do not fire while the
   page's main thread busy-spins.** A dispatch loop awaiting a
   channel-based yield parks forever, while plain timers on the same
   worker keep firing (which also silences heartbeat-based stall
   detection). Library fix: the relay loop's yield races the channel ping
   against a 1ms timer.
2. **Cross-thread `Atomics.notify` (main → worker) can be lost under the
   same conditions.** A worker sleeping in an unbounded `Atomics.wait`
   never wakes even though the value has changed. Library fix: every
   protocol wait is sliced (50ms–1s) and re-reads the value.
3. **`FileSystemSyncAccessHandle.truncate` AND extending `write` both
   block until the main thread returns to its event loop** (verified with
   an isolated two-thread probe: both completed at exactly the moment a
   10s main-thread spin ended). A sync caller spinning on a SAB response
   therefore *deadlocks* any file growth the worker attempts. Library
   fix: 64MB free-tail pre-growth at engine init and during ≥25ms-quiet
   idle, so request-path growth (and the deadlock) effectively never
   happens; the spin-wait stall guard was raised to 30s so a residual
   collision aborts cleanly (EIO) instead of racing the recovery.

Additionally: OPFS sync access handles **cannot be opened in ephemeral
browsing contexts** ("the operation failed for an unknown transient
reason") — relevant to real Safari private browsing as well, and the
reason the WebKit Playwright project uses a persistent context
(`tests/benchmark/fixtures.ts`).

With these fixes the full sync + async correctness suite passes on the
WebKit engine alongside Chromium and Firefox — **and was confirmed by the
maintainer on real Safari (2026-06-12)** via the manual smoke page
(`tests/benchmark/safari-smoke.html`, served by the benchmark server):
crossOriginIsolated init, small sync ops, error codes, 2MB and 5MB
multi-chunk sync/fd/async round-trips (1–2ms writes), a 200-write sync
burst (20ms), and flush all passed in a normal (non-private) window.
Private browsing remains a platform boundary: WebKit refuses OPFS sync
access handles in ephemeral storage, so the sync API is unavailable there
by design.

---

## 10. Multi-tab follower SYNC on Safari — solved via worker-hosted instances (2026-06-14)

Follower tabs (those that don't hold the OPFS sync handle) relay sync ops to
the leader. On Safari this deadlocked from the **main thread**, and three
isolated probes established exactly why — and the way around it:

1. **Sync XHR is not intercepted by the service worker in WebKit.** An async
   `fetch` to a path the SW handles round-trips fine; a *synchronous* XHR to
   the same path bypasses the SW and hits the network. The classic
   "sync-XHR-through-service-worker" (webcontainer) escape hatch therefore
   does **not** work on Safari.
2. **A worker's MessagePort delivery is gated on the parent page's main-thread
   event loop in WebKit.** Probe: a worker that should receive a port message
   and write a `SharedArrayBuffer` got *nothing* during a 3-second main-thread
   spin on WebKit, versus 35 ms on Chromium. This is the actual deadlock: a
   follower's synchronous op busy-spins its main thread, which freezes its own
   relay worker's message intake, so the leader's reply can never arrive →
   the op fails with `EIO` (see `tests/benchmark/multitab.spec.ts`).
3. **From a worker context it works.** When the sync call runs in a worker the
   wait is a real `Atomics.wait` (permitted off-main-thread), the main thread
   stays free to pump the relay worker's delivery, and the leader's reply
   arrives. Probe: value delivered, `waitResult: "ok"`, on WebKit and Chromium
   alike.

### What is *not* the problem: the SAB worker→main transfer

The performant part of the sync path — a relay worker writing the response
into a `SharedArrayBuffer` that the calling thread reads synchronously — works
fine on Safari and is **fully intact**. It is exactly how leader/single-tab
`readFileSync` returns synchronously (0.005–0.15 ms/op on real Safari): the
tab's own relay worker owns the VFS engine, computes the answer locally, and
writes the SAB; nothing has to be *received* from elsewhere.

The follower deadlock is **not** about getting data worker→main; it is about
the follower's relay worker never *receiving* the leader's reply (a cross-tab
MessagePort message) while the same tab's main thread spins. No SAB trick can
substitute, because a `SharedArrayBuffer` cannot be shared across tabs
(separate agent clusters), so the leader can't write the follower's SAB
directly either. Moving the caller into a worker keeps the *same* fast SAB
transfer — just worker→worker, with the main thread free to pump the cross-tab
delivery.

**Solution shipped:** run the follower's VFS instance inside a worker. The one
main-thread-only dependency — `navigator.serviceWorker` (unavailable in worker
scopes on Safari/Firefox, [w3c/ServiceWorker#1552](https://github.com/w3c/ServiceWorker/issues/1552))
— is delegated to a tiny main-thread bridge:

```js
// main thread (per follower tab)
import { createServiceWorkerBridge } from '@componentor/fs';
const ch = new MessageChannel();
createServiceWorkerBridge(ch.port1, { ns: 'vfs-_app' });
worker.postMessage({ swBridge: ch.port2 }, [ch.port2]);

// inside the worker
import { VFSFileSystem } from '@componentor/fs';
const fs = new VFSFileSystem({ root: '/app', swBridge: receivedPort });
fs.readFileSync('/x'); // works in a follower tab — Safari included
```

Verified end-to-end on WebKit, Chromium and Firefox
(`tests/benchmark/multitab-worker.spec.ts`): follower sync read of the
leader's file, follower sync write, leader observing the follower's write —
7 ms on WebKit. Main-thread follower instances keep the fail-fast `EIO`
contract; this is purely additive.

**Try it / benchmark it.** `tests/benchmark/multitab-demo.html` is a runnable
two-tab demo (open in multiple Safari tabs). The benchmark page
(`tests/benchmark/index.html`, `npm run benchmark:open`) has a **"Run in
worker"** checkbox that runs the entire benchmark through this worker-hosted
path — which is what lets it produce results in secondary Safari tabs (with
the box unchecked it runs on the main thread as before, where secondary Safari
tabs cannot do sync). Worker mode measured `vfsSync ≈ 0.49 ms/op` in a Safari
*follower* tab.

---

*Compiled from the sources linked inline; browser version data from [mdn/browser-compat-data](https://github.com/mdn/browser-compat-data) (June 2026). §9–10 added from first-hand debugging in this repository.*
