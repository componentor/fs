# Testing

How this library is tested: differential suites against a live `node:fs`, four fuzzers, and real-browser runs.

← Back to the [readme](../readme.md).

---

## Testing

```bash
npm test                 # unit + parity suites (Node, no browser needed)
npx vitest bench ops     # full-stack op microbenchmarks
npx vitest bench engine  # engine-only microbenchmarks
npm run benchmark        # Playwright benchmark against real OPFS in Chromium

# Correctness in real browsers — real OPFS, real workers, real SAB relay
npx playwright test regression-fixes instance-parity watch cross-browser sab-chunking \
  --project=chromium --project=firefox --project=webkit

# Targeted browser benchmark against real OPFS (not an in-memory handle)
npx playwright test append-readdir --project=chromium
```

[regression-fixes.spec.ts](../tests/benchmark/regression-fixes.spec.ts) re-checks every bug fixed in
3.3.6–3.3.9 through the shipped stack in Chromium, Firefox and WebKit — the Node suites prove the
layouts agree, only a browser proves the SharedArrayBuffer relay and real OPFS agree with them.

[instance-parity.spec.ts](../tests/benchmark/instance-parity.spec.ts) extends differential testing to
features that need a live filesystem instance — `cp`, `opendir`, the streams. The test body runs
in Node and drives `node:fs` on a temp directory; `page.evaluate` drives the library in a browser
against real OPFS; the two results are compared. That gives instance-level features the same
no-room-for-a-wrong-expectation coverage the method layer has.

[fuzz-stream-parity.test.ts](../src/tests/fuzz-stream-parity.test.ts) covers the stream layer, where
the interesting failures are about ordering rather than any single call's result.

[fuzz-async-parity.test.ts](../src/tests/fuzz-async-parity.test.ts) fuzzes the promise API, which is
not the same code underneath — it hands the request to a relay that re-shapes it there, and that
second step is where a wire-format bug once lived.

[fuzz-fd-parity.test.ts](../src/tests/fuzz-fd-parity.test.ts) does the same for file descriptors,
which are stateful — an fd carries a position and flags that every read and write mutates, so
behaviour depends on the sequence. It compares the file's whole contents after every step, and
found that fd access modes were not enforced at all.

[fuzz-parity.test.ts](../src/tests/fuzz-parity.test.ts) goes further than any hand-written case: it
runs a random sequence of operations against both filesystems with identical arguments, compares
every outcome, then compares the whole resulting tree — path, type, size, contents and permission
bits. Seeds are fixed so a failure reproduces exactly. It found four real divergences on its first
run, including a `cp` that never terminated.

[overload-audit.test.ts](../src/tests/overload-audit.test.ts) exercises all 41 documented argument
forms of the ~20 methods whose signature puts an optional argument *in the middle*
(`fs.readFile(path[, options], cb)`), asserting each one both invokes the callback and keeps the
options. Getting that wrong yields a method that returns normally, reports no error, and never
calls back — which had happened four times.

[api-surface.test.ts](../src/tests/api-surface.test.ts) enumerates `node:fs` and `node:fs/promises`
at runtime and asserts every function they expose exists here too, so a missing method is a test
failure rather than a runtime surprise in someone's app.

Every suite drives product code. That was not always true: five files re-implemented the logic
they were checking and asserted against the copy, so they passed while the real thing was broken
— `truncate-large.test.ts` verified float64 round-tripping with its own helpers while the shipped
worker read the field as a uint32 and zeroed every truncated file. They now borrow the real
methods off `VFSFileSystem.prototype` (the constructor needs workers, `Object.create` does not)
or run the real encoders through the real decoder. Re-introducing that truncate bug now fails 17
tests; before, it failed none.

Most other suites assert behaviour someone believed Node has. [node-parity.test.ts](../src/tests/node-parity.test.ts)
does something stronger: it runs each operation twice — once through the full library stack
(method layer → wire encoding → dispatch → `VFSEngine`, via an in-memory handle) and once
through real `node:fs` on a temp directory — and compares contents, entry lists, sizes,
permission bits and error `code`s. A divergence is a compatibility bug by construction, with no
room for a wrong expectation. Timestamps and inode numbers are excluded, and the handful of
genuinely platform-dependent errnos (`unlink` on a directory is `EISDIR` on Linux, `EPERM` on
macOS) assert only that both sides refuse.
