# Node compatibility

What "100% of Node 24.18" means here, how it is verified against a live `node:fs` rather than against the docs, and every deliberate divergence.

← Back to the [readme](../readme.md).

---

**Surface: 100% of Node 24.18, with no exceptions.** All 134 functions exported by `node:fs` and `node:fs/promises` exist here,
plus the `FileHandle`, `Dir` and `Stats`/`BigIntStats`/`Dirent` classes and the full
`fs.constants` table. This is not a claim maintained by hand —
[api-surface.test.ts](../src/tests/api-surface.test.ts) reads Node's own exports at runtime and
fails if any are missing, and it checks the reverse too, so a documented omission that quietly
gets implemented is caught as well.

There is no omissions list any more. `Utf8Stream` (Node 24's buffered append stream for logging)
and `_toUnixTimestamp` (Node's internal time coercion, underscore and all) were the last two and
landed in 4.0.0. The suite still checks in both directions, so an omission introduced later
cannot be quietly forgotten.

**Behaviour: verified against a live `node:fs`, not against the docs.** The suites run the same
operation through this library and through real `node:fs` on a temp directory and compare the
results — contents, entry lists, sizes, permission bits and error `code`s — including four
differential fuzzers over the sync, promise, file-descriptor and stream APIs. Several
divergences below were found that way, and more than one was a case of the documentation being
wrong about Node rather than the code being wrong about the docs.

### Known divergences from Node

All deliberate:

- **A function `exclude` passed to `glob` also drops nested files.** Node's *function* form
  applies the predicate to top-level entries and to directories (pruning their subtrees), but
  silently keeps **nested files**: `(n) => n.endsWith('.js')` removes `top.js` and leaves
  `a/drop.js`, while node's own *pattern* form removes both. Reproducing that would keep files
  the caller asked to drop, so the predicate is applied at every depth here. Node's behaviour is
  [asserted in the parity test](../src/tests/glob-exclude-parity.test.ts), so if it changes, we find
  out.
- **An invalid descriptor passed to `fs.readFile(fd, cb)` reaches the callback.** Node defers the
  check and then throws it *uncaught* from a later tick (inside `readFileAfterOpen`), taking the
  process down instead of calling back — `fs.readFile(-1, cb)` is an unhandled `ERR_OUT_OF_RANGE`
  crash. We report it to the callback, which is where the caller can act on it.
- **`openAsBlob` rejects where node throws.** The error itself matches node exactly — any file it
  cannot open is `TypeError: Unable to open file as blob` with `code: 'ERR_INVALID_ARG_VALUE'`,
  not the errno — but node raises it *synchronously* out of a function that otherwise returns a
  promise, so `fs.openAsBlob(missing).catch(…)` crashes rather than catching. This rejects, which
  is identical under `await` and works with `.catch`.
- **`watch` reports a new file as `change`, not `rename`.** Node emits `rename` when an entry
  appears or disappears; a file created by `writeFile` surfaces here as `change` (deletes do
  report `rename`). Telling the two apart would need a per-write existence check on the hot path,
  and Node's own event types are platform-dependent enough that its docs call them "not always
  accurate" — so this is left as-is.
- **`cp` with symlinks does not chase Node's behaviour**, deliberately: `node:fs` (v24) *aborts
  the process* on two of these — copying onto an existing dangling link, and copying a tree
  containing a cyclic link — with uncaught C++ exceptions rather than throwable errors. We copy
  links as links and always terminate. Ordinary copies match Node exactly, permissions included.
- **Hard links are real.** They were copies once, and this entry used to say so.
  `link()` adds a second *name* for one inode: both names share an inode number, a write
  through either is visible through the other, `nlink` counts the names that exist, and the data
  is freed only when the last one goes. The name is stored on disk as its own inode-table entry
  (`INODE_TYPE.HARDLINK`: its path plus the target's index), so it is rebuilt by the mount scan
  and survives a reload — an in-memory-only second name would not, since the path index is
  rebuilt from inodes and an inode stores exactly one path. Two things still differ from a
  POSIX filesystem: the link's entry occupies an inode-table slot, so `statfs().ffree` falls by
  one per link, and the `opfs` mirror has no way to represent sharing, so each name is a
  separate file there (kept in step on every write, but a hard link that reaches OPFS and comes
  back through a repair/load is two independent files).
- **No `ENAMETOOLONG`.** Real filesystems cap a path component at 255 bytes; we accept longer
  names. Enforcing the limit would reject names existing volumes may already contain, so the
  cap is left off.
- **`opfs` fallback mode stores no permission metadata**, so entries there always read back as
  the synthetic 0755/0644. Inherent to OPFS, which has no permission model; the default hybrid
  mode persists real modes.

- **`fs.constants` includes the platform-specific entries Node exposes but this cannot honour**
  — `O_SYMLINK` (macOS), `UV_FS_O_FILEMAP` (Windows) and the `UV_FS_SYMLINK_*` pair are defined
  with Node's values so a bitmask read does not come back `undefined`, but there is no OPFS
  behaviour behind them. The `UV_DIRENT_*` numbering, which code reading a `Dirent` type
  numerically depends on, is real.

- **A worker-hosted instance does not watch for external OPFS changes.** The inbound half of the
  mirror needs a `FileSystemObserver`, and one still attached when its scope is destroyed makes
  Chromium abort the whole browser process — a use-after-free in Chromium's own C++, not
  something this library can be careful enough to avoid. An instance on a page detaches it
  synchronously on `pagehide`; a worker cannot, because the page kills it outright. Outward
  mirroring — every change this library makes appearing as real OPFS files — works in every mode.

Errno spellings that are platform-dependent in Node itself (`unlink` on a directory is `EISDIR`
on Linux, `EPERM` on macOS) follow the Linux spelling.
