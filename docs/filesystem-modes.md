# Filesystem modes

How the `mode` option stores your data — `hybrid`, `vfs` and `opfs` — and what each one trades away.

← Back to the [readme](../readme.md).

---

## Filesystem Modes

The `mode` option controls how the filesystem stores data:

| Mode | Storage | OPFS Sync | Speed | Resilience |
|------|---------|-----------|-------|------------|
| `hybrid` (default) | VFS binary + OPFS mirror | Bidirectional | Fast | High |
| `vfs` | VFS binary only | None | Fastest | Medium |
| `opfs` | Real OPFS files only | N/A | Slower | Highest |

```typescript
// Hybrid mode (default) — best of both worlds
const fs = new VFSFileSystem({ mode: 'hybrid' });
fs.writeFileSync('/file.txt', 'data');
// → stored in .vfs.bin AND mirrored to real OPFS files

// VFS-only mode — maximum performance, no OPFS mirroring
const fastFs = new VFSFileSystem({ mode: 'vfs' });

// OPFS-only mode — no VFS binary, operates directly on OPFS files
const safeFs = new VFSFileSystem({ mode: 'opfs' });
```

> **In `opfs` mode, the sync API works everywhere except a WebKit page main thread.** Every
> operation in this mode is async underneath, and `Atomics.wait` is illegal on a page's main
> thread, so a sync call there busy-spins — which on WebKit starves the relay worker and the
> response never arrives. It now fails with a clear error after 10 s instead of hanging the tab.
> Two workarounds, both verified on all three engines: use `fs.promises.*`, or host the instance
> **inside a Worker**, where `Atomics.wait` is legal and the sync API works normally. This matters
> beyond the explicit option — `opfs` is also the automatic fallback when VFS corruption is
> detected. Tracked by [opfs-mode-sync.spec.ts](../tests/benchmark/opfs-mode-sync.spec.ts).

**Hybrid mode** mirrors all VFS mutations to real OPFS files in the background:

- **VFS → OPFS**: Every write, delete, mkdir, rename is replicated *after* the sync operation responds, so it adds nothing to the latency of an individual call. It does cost **sustained throughput**, because the mirroring runs on the same relay worker the next request needs: measured against real OPFS, creating files runs at ~1200/s in `vfs` mode and ~750/s in `hybrid`. Bursts to the same path are coalesced into one flush.
- **OPFS → VFS**: A `FileSystemObserver` watches for external changes and syncs them back (Chrome 129+).

This lets external tools (browser DevTools, OPFS extensions) see and modify files while VFS handles all the fast read/write operations internally.

#### Choosing a mode (performance)

The mirror is the main performance knob. It persists every change a second time as a real OPFS file, and on Safari each of those writes opens a fresh sync-access handle, which is comparatively slow. Reads never touch the mirror, so they're fast in every mode.

- **`vfs`** (VFS binary only) — fastest writes; data is still fully persistent in `.vfs.bin`. Choose this when you don't need other tools to see individual files.
- **`hybrid`** (default) — adds the real-OPFS mirror so DevTools/extensions/other code can read your files. Expect writes to cost roughly ~2× `vfs` (more on Safari) in exchange; read speed is unaffected.
- **`opfs`** — no VFS binary; operates directly on OPFS files. Highest external compatibility, slowest.

A good rule of thumb: use `vfs` for pure app storage, `hybrid` when real OPFS visibility matters. You can switch at runtime with `setMode()`.

#### Sync-relay spinning (WebKit-gated)

The sync-relay leader loop carries three latency workarounds — a post-response busy-poll spin, a starvation-timer race in its event-loop yield, and a sliced response-consume wait — that exist **only** to defeat WebKit/Safari's lost cross-thread `Atomics.notify` and its main-thread-brokered `MessagePort` delivery (a sync caller busy-spinning the page's main thread starves both). On Chromium and Firefox those wakes are reliable, so the workarounds are pure overhead; on a core-constrained device (e.g. an Android phone — few cores, big.LITTLE, thermal/background-thread throttling) the relay worker's spinning can contend for a CPU with the spinning leader thread and slow every op.

Since **3.2.8** the spinning is gated to WebKit by user-agent detection, so Chromium/Firefox (desktop *and* mobile) take a quiet park-on-`Atomics.wait` path automatically — no configuration needed. A runtime escape hatch lets you override the detection for A/B testing, set **inside the sync-relay worker scope** before it begins dispatching:

```js
// In the sync-relay worker (e.g. injected at worker bootstrap):
self.__fs_force_spin = false; // force the quiet path (skip all spinning)
self.__fs_force_spin = true;  // force the WebKit spinning path everywhere
// unset (default) → auto-detect: spin only on WebKit
```

#### Corruption Fallback

In `hybrid` mode, if VFS corruption is detected during initialization, the filesystem automatically falls back to `opfs` mode. The `init()` call rejects with an error describing the corruption, but all filesystem operations continue working via OPFS:

```typescript
const fs = new VFSFileSystem(); // hybrid mode

try {
  await fs.init();
} catch (err) {
  // VFS was corrupt — system is now running in OPFS mode
  console.warn(err.message); // "Falling back to OPFS mode: <reason>"
  console.log(fs.mode);      // 'opfs'
}

// Filesystem still works — reads/writes go through OPFS
fs.writeFileSync('/file.txt', 'still works!');
```

#### Runtime Mode Switching

Use `setMode()` to switch modes at runtime. This is useful for IDE workflows where you want to recover from corruption:

```typescript
// Corruption detected, currently in OPFS fallback mode
console.log(fs.mode); // 'opfs'

// Repair the VFS binary
await repairVFS('/my-app');

// Switch back to hybrid mode
await fs.setMode('hybrid');
console.log(fs.mode); // 'hybrid'
```

`setMode()` terminates internal workers, allocates fresh shared memory, and reinitializes the filesystem in the requested mode.
