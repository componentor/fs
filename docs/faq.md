# FAQ and troubleshooting

Common questions, and the errors people actually hit with what each one means.

← Back to the [readme](../readme.md).

---

## FAQ

**Can you really use `readFileSync` in a browser?**
Yes, and it really blocks. The call writes a request into a `SharedArrayBuffer` and parks the
calling thread on `Atomics.wait` until a worker answers, so the value is returned from the call
rather than through a callback. That is why the page has to be
[cross-origin isolated](./coop-coep.md#coopcoep-headers) — `SharedArrayBuffer` is gated behind it.

**Why does the synchronous API need COOP/COEP headers?**
Because it needs `SharedArrayBuffer`, and browsers only expose that to cross-origin-isolated
pages (a Spectre mitigation). It is a browser rule, not a choice this library made, and no
library can work around it. The **async** API has no such requirement.

**What if I cannot set headers — GitHub Pages, a CDN, an embedded iframe?**
Two options. Use `fs.promises.*`, which works everywhere and loses nothing but the blocking
calls. Or install a service worker that adds the headers to its own responses — [demo here](../demo/coi-serviceworker.js).

**Does the data survive a page reload?**
Yes. It lives in OPFS (Origin Private File System), which is real browser-managed disk storage,
not memory. It is cleared when the user clears site data, and it is private to the origin.

**Does it work with isomorphic-git?**
Yes — that is one of the workloads it was built for, and the benchmark suite clones and runs
`statusMatrix` against a real repository. See [isomorphic-git Integration](./isomorphic-git.md#isomorphic-git-integration).

**Does it work in Safari and Firefox?**
Yes. The one caveat is Safari-specific and only affects *multi-tab* synchronous calls from a
page's main thread; running the instance inside a worker fixes it, and
[examples/03-worker-hosted](../examples/03-worker-hosted/) is that arrangement. Details in
[Browser Support](../readme.md#browser-support).

**How is this different from `memfs`?**
`memfs` is in-memory: fast, complete, and gone on refresh. This persists to OPFS. If you do not
need persistence, `memfs` is the simpler choice.

**Can I see the files outside the app?**
In the default `hybrid` mode, yes — every change is mirrored to real OPFS files, which you can
browse in Chrome DevTools under Application → Storage. `vfs` mode skips the mirror and is faster.

**How much can I store?**
Whatever the browser grants the origin, which is typically a large share of free disk. Call
`navigator.storage.estimate()` for the current quota, and `fs.statfsSync('/')` for the volume's
own view.

**Is there a smaller build if I only want the drive abstraction?**
Yes — `@componentor/fs/drives` is engine-free and does not pull in the VFS.

## Troubleshooting

### "SharedArrayBuffer is not defined"

Your page is not `crossOriginIsolated`. Add COOP/COEP headers (see above). The async API still works without them.

### "Sync API requires crossOriginIsolated"

Same issue — sync methods (`readFileSync`, etc.) need `SharedArrayBuffer`. Use `fs.promises.*` as a fallback.

### "Atomics.wait cannot be called in this context"

`Atomics.wait` only works in Workers. The library handles this internally — if you see this error, you're likely calling sync methods from the main thread without proper COOP/COEP headers.

### Files not visible in OPFS DevTools

Make sure `opfsSync` is enabled (it's `true` by default). Files are mirrored to OPFS in the background after each VFS operation. Check DevTools > Application > Storage > OPFS.

### External OPFS changes not detected

`FileSystemObserver` requires Chrome 129+. The VFS instance must be running (observer is set up during init). Changes to files outside the configured `root` directory won't be detected.
