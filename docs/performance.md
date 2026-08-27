# Performance and benchmarks

Measured against real OPFS: what each engine is bottlenecked on, and how this compares to the alternatives.

← Back to the [readme](../readme.md).

---

## Benchmarks

Versus LightningFS (IndexedDB-based), in Chrome with `crossOriginIsolated` enabled, hybrid mode:

| Operation | LightningFS | VFS Sync | VFS Promises |
|-----------|------------|----------|-------------|
| Write 100 × 1KB | 46ms | **12ms** | 23ms |
| Write 100 × 4KB | 36ms | **13ms** | 22ms |
| Read 100 × 1KB | 19ms | **2ms** | 14ms |
| Read 100 × 4KB | 62ms | **2ms** | 13ms |
| Large 10 × 1MB | 11ms | **10ms** | 17ms |
| Batch write 500 × 256B | 138ms | **50ms** | 75ms |
| Batch read 500 × 256B | 73ms | **7ms** | 91ms |

**Takeaways:**
- **Reads are 9–28× faster** — the binary VFS format avoids per-entry IndexedDB/OPFS overhead, and the sync path (SharedArrayBuffer + Atomics) has no async overhead.
- **Writes are ~3–4× faster** here, and faster still in `vfs` mode where the OPFS mirror is off.

**Reading these honestly:** numbers vary by browser and warm/cold state — measure your own workload. In-memory libraries like `memfs` will beat this on raw ops (no persistence to do), so the fair comparison is against other *persistent* browser filesystems. Writes are the work; reads are essentially free. On Safari, writes cost more because of slower OPFS sync-access handles (see [Filesystem Modes](./filesystem-modes.md#filesystem-modes)).

### Versus `opfs-worker`

LightningFS stores in IndexedDB and `memfs` never persists, so neither really tests the design —
they test the storage medium. [`opfs-worker`](https://www.npmjs.com/package/opfs-worker) is the
like-for-like case: a Node-style `fs` API over OPFS, doing its work in a worker. Per-operation
cost in Chromium against real OPFS, from
[opfs-worker.spec.ts](../tests/benchmark/opfs-worker.spec.ts):

| Operation | opfs-worker | ours (`hybrid`, default) | ours (`vfs`) |
|---|---|---|---|
| create 1KB | 1.81 ms | **1.06 ms** (1.7×) | **0.71 ms** (2.6×) |
| overwrite | 1.62 ms | **0.42 ms** (3.8×) | **0.26 ms** (6.2×) |
| read | 1.27 ms | **0.12 ms** (11×) | **0.10 ms** (12×) |
| stat | 0.38 ms | **0.03 ms** (12×) | **0.03 ms** (12×) |
| readdir | 2.43 ms | **0.09 ms** (26×) | **0.09 ms** (26×) |
| rename | 7.10 ms | **0.90 ms** (7.9×) | **0.38 ms** (19×) |
| unlink | 1.65 ms | **0.70 ms** (2.4×) | **0.49 ms** (3.4×) |
| append | 1.79 ms | **0.31 ms** (5.7×) | **0.26 ms** (6.9×) |

`opfs-worker` has no synchronous API, so this compares its facade against **`fs.promises`**, not
against `fs.*Sync` — comparing our sync path to their async one would be measuring a capability
gap, not speed. Both of our storage modes are shown because `hybrid` is the default and it
additionally mirrors every mutation to real OPFS files, which is the honest number for an
out-of-the-box install.

Two rows are architecture rather than tighter code, and are worth discounting: `rename` is a
copy-and-delete for anything working directly on OPFS files, because OPFS has no rename
primitive; and `readdir`/`stat` never touch storage here at all, because the VFS keeps its
directory index in shared memory.

```bash
npx playwright test opfs-worker --project=chromium
```

Run the suite yourself:

```bash
npm run benchmark:open
```

## Performance

The sync hot path is a `SharedArrayBuffer` request/response to a relay worker that owns the OPFS handle. On **Chromium, Firefox and (importantly) mobile Chrome/Android** the library runs the lean path: a parked `Atomics.wait`, and **on-demand file growth**. On **WebKit/Safari** it additionally enables a set of workarounds for one underlying fact — *MessagePort delivery and size-changing OPFS calls (`truncate` / extending `write`) are brokered through the page's main thread, which a spinning sync caller blocks.* Those WebKit-only workarounds are:

- **Dispatch-loop tweaks** — a post-response busy-poll, a starvation-timer yield, and a 5 ms-sliced response wait (defeat WebKit's lost cross-thread `Atomics.notify`).
- **Idle/init pre-growth** — a 64 MB free-tail headroom grown at idle, so writes never have to grow *in-request* (which would deadlock against the spinning caller on WebKit).

All of these are **gated behind a UA check (`IS_WEBKIT`) and run only on WebKit.** On Chromium/Gecko they are pure overhead — and on core-constrained mobile (few cores, big.LITTLE, slow flash) the pre-growth `truncate` in particular noticeably stalled the dispatch loop, so leaving it on everywhere regressed Android sync throughput badly (≈10×). Gating it restores full speed on Android while keeping Safari correct.

**Override:** `forceSpin: true | false` (or the runtime global `self.__fs_force_spin` in the relay worker) forces all of the above on or off regardless of UA — purely for A/B testing on a specific device. Default (`undefined`) is auto, which is what you want.

**Mode and write cost:** the OPFS **mirror** (`mode: 'hybrid'`, the default) writes every change to real OPFS files for interop; it's the main *write*-cost knob (reads are unaffected). If nothing reads the real OPFS files directly, `mode: 'vfs'` skips the mirror for the fastest writes. See [Filesystem Modes](./filesystem-modes.md#filesystem-modes).

### What operations cost, and why

`vfs` mode, measured against real OPFS ([profile-hotpath.spec.ts](../tests/benchmark/profile-hotpath.spec.ts)):

| operation | Chromium | Firefox | WebKit |
|---|---|---|---|
| create 256 B | 1209/s | 1355/s | **12433/s** |
| create 8 KB | 1189/s | 1577/s | **12658/s** |
| overwrite 8 KB | 3365/s | 5068/s | **17241/s** |
| read 8 KB | 9675/s | 17135/s | 20096/s |
| unlink | 2334/s | 2526/s | **16543/s** |
| stat | **87k/s** | 44k/s | 27k/s |
| exists | **121k/s** | 48k/s | 24k/s |
| readdir (~800 entries) | **3284/s** | 2644/s | 2353/s |

**The bottleneck is a different thing in each browser**, which is the single most useful thing to know here:

- **Chromium is storage-bound.** A raw `FileSystemSyncAccessHandle.write` costs **0.22 ms there regardless of size** — 64 bytes and 8 KB are the same price ([opfs-floor.spec.ts](../tests/benchmark/opfs-floor.spec.ts)). So cost tracks the *number* of writes an operation makes, not its bytes: a create needs five — path-table entry, file data, inode, free-block bitmap, superblock, each in a different region so none can be combined — while an overwrite that fits its existing blocks needs two. That is exactly the ~2.5× between them, and it means there is no overhead left in this library to remove on Chromium.
- **WebKit is the opposite.** Its sync-handle writes cost **0.004 ms**, ~50× cheaper, so it creates files ~10× faster than Chromium — but its metadata operations are 3–5× *slower*, because those are pure `SharedArrayBuffer` round-trips and WebKit's relay needs the extra spin/yield handling described above. On Safari, per-operation overhead matters and write volume barely does.
- **Firefox sits between the two**, and is the only engine where `flush()` is not free (0.21 ms, against 0.002 ms on Chromium).

Practical consequences: overwriting beats creating everywhere, but *how much* depends on the engine. Metadata reads never touch storage, so `stat`/`exists` are cheap in absolute terms on every engine. Batching many small files into fewer larger ones is the biggest lever on Chromium and roughly irrelevant on Safari. And a benchmark run against an in-memory handle will overstate wins that Chromium's storage cost hides — measure in the browser you care about.
