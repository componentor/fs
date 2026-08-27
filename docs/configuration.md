# Configuration

Every constructor option, plus the cross-cutting behaviours they govern: text encodings, file permissions, file descriptors in place of a path, result objects, and when arguments are validated.

← Back to the [readme](../readme.md).

---

```typescript
const fs = new VFSFileSystem({
  root: '/',              // OPFS root directory (default: '/')
  mode: 'hybrid',        // 'hybrid' | 'vfs' | 'opfs' (default: 'hybrid')
  opfsSyncRoot: undefined, // Custom OPFS root for mirroring (default: same as root)
  uid: 0,                 // User ID for file ownership (default: 0)
  gid: 0,                 // Group ID for file ownership (default: 0)
  umask: 0o022,           // File creation mask (default: 0o022)
  strictPermissions: false, // Enforce Unix permissions (default: false)
  sabSize: 4194304,       // SharedArrayBuffer size in bytes (default: 4MB)
  debug: false,           // Per-op timing logs (caller roundTrip + relay handleRequest) (default: false)
  forceSpin: undefined,   // Override the WebKit-only sync workarounds (spin/yield/slice + pre-grow).
                          // undefined = auto (on only for WebKit); true/false force on/off — an
                          // A/B escape hatch. You should not need this; see "Performance" below.
  swUrl: undefined,       // URL of the service worker script (default: auto-resolved)
  swScope: undefined,     // Custom service worker scope (default: auto-scoped per root)
  swBridge: undefined,    // MessagePort to a main-thread service-worker bridge, for
                          // running this instance inside a worker (enables follower
                          // sync on Safari). See "Multi-Tab Sync on Safari" below.
  limits: {               // Upper bounds for VFS validation (prevents corrupt data from causing OOM)
    maxInodes: 4_000_000,   // Max inode count (default: 4M)
    maxBlocks: 4_000_000,   // Max data blocks (default: 4M)
    maxPathTable: 256 * 1024 * 1024, // Max path table bytes (default: 256MB)
    maxVFSSize: 100 * 1024 * 1024 * 1024, // Max .vfs.bin size (default: 100GB)
    maxPayload: 2 * 1024 * 1024 * 1024,   // Max single SAB payload (default: 2GB)
  },
});
```

### Text Encodings

Encodings follow Node: the same names, matched **case-insensitively**, with the same aliases —
`utf8`/`utf-8`, `utf16le`/`utf-16le`/`ucs2`/`ucs-2`, `latin1`/`binary`, `base64`, `base64url`,
`ascii`, `hex`. An unrecognised name throws Node's `ERR_INVALID_ARG_VALUE` rather than silently
falling back to UTF-8, so a typo surfaces at the call instead of as corrupted bytes later.

```js
fs.writeFileSync('/a.bin', '4142', 'hex');       // writes the two bytes 41 42
fs.readFileSync('/a.bin', 'latin1');             // 'AB'
fs.readdirSync('/dir', 'buffer');                // raw name bytes
fs.writeFileSync('/b', 'x', 'utf9');             // throws ERR_INVALID_ARG_VALUE
```

The `base64` and `hex` parsers reproduce Node's leniency exactly: base64 skips characters outside
the alphabet, stops at `=`, tolerates missing padding, and accepts the url-safe alphabet under
either name; hex stops at the first pair that is not two hex digits and ignores a trailing odd
character. Note the `ascii` asymmetry, which is Node's, not ours — encoding truncates to the low
byte (identical to `latin1`), while decoding masks to 7 bits.

### File Permissions

Modes behave as they do in Node. `mkdir` takes the mode you give it, the engine subtracts the
umask exactly as `mkdir(2)` does in the kernel, and `stat` reads back what was actually stored:

```js
fs.mkdirSync('/private', { mode: 0o700 });
fs.statSync('/private').mode & 0o777;   // 0o700

fs.mkdirSync('/pub');                    // default 0o777 & ~umask(0o022)
fs.statSync('/pub').mode & 0o777;        // 0o755

fs.mkdtempSync('/tmp/run-');             // 0o700 — mkdtemp(3) is private by design
```

A mode may be a uint32 or an octal **string** (`'0700'`), and a recursive `mkdir` applies it to
every level it creates — both matching Node. Invalid modes throw Node's own
`ERR_INVALID_ARG_VALUE` / `ERR_INVALID_ARG_TYPE` / `ERR_OUT_OF_RANGE`.

Files work the same way. `open`'s mode defaults to Node's 0o666 (0o644 after the default umask)
and, as in `open(2)`, applies **only when the file is created** — re-opening an existing file
with a different mode leaves its permissions alone. `writeFile`'s `mode` option follows the same
rule, because it rides along with the creating open:

```js
fs.writeFileSync('/secret.txt', data, { mode: 0o600 });
fs.statSync('/secret.txt').mode & 0o777;   // 0o600

fs.closeSync(fs.openSync('/pub.txt', 'w'));
fs.statSync('/pub.txt').mode & 0o777;      // 0o644
```

Permission bits are stored and reported, but only *enforced* by `access()` when you opt in with
`strictPermissions: true`.

### File descriptors in place of a path

`readFile`, `writeFile` and `appendFile` accept an open descriptor where a path goes, as in Node.
The semantics are **not** the path semantics, and the differences are easy to trip over:

```js
const fd = fs.openSync('/log.txt', 'r+');   // contents: 'AAA'

fs.appendFileSync(fd, 'B');                 // 'BAA' — writes at the cursor, does NOT append
fs.closeSync(fd);                           // the descriptor is yours to close
```

- Every operation starts at the descriptor's **current position** and advances it. Calling
  `readFileSync(fd)` twice returns the contents, then `''`.
- `writeFile(fd, …)` **does not truncate** — writing `'ab'` over `'XXXXXXXXXX'` leaves
  `'abXXXXXXXX'`.
- `appendFile(fd, …)` **does not seek to end-of-file**. It is `writeFile`; the appending comes
  from having opened with `'a'` (O_APPEND), as the example above shows.
- The descriptor is **left open**, and `flag`/`mode` are ignored since the file is already open.

The raw-number form is available on the sync and callback APIs. `fs.promises` takes a
`FileHandle` instead — `fsPromises.readFile(fd)` is an `ERR_INVALID_ARG_TYPE` in Node and here:

```js
const handle = await fs.promises.open('/log.txt', 'r');
await fs.promises.readFile(handle);         // ok
```

### Result objects

`stat`, `readdir({ withFileTypes: true })` and `opendir` return real classes, so node's
`instanceof` type-tests work and the objects serialise the way node's do:

```js
fs.statSync('/f') instanceof fs.Stats           // true
entry instanceof fs.Dirent                       // true
fs.opendirSync('/d') instanceof fs.Dir           // true

Object.keys(fs.statSync('/f'))   // node's own-property list, in node's order
JSON.stringify(fs.statSync('/f'))// same fields node emits
```

`Stats`, `BigIntStats`, `Dirent` and `Dir` are also exported from the package for direct import.
The type predicates live on the prototype and read `mode & S_IFMT` as node's do, and
`atime`/`mtime`/`ctime`/`birthtime` are built lazily on first access — a `stat` no longer
allocates seven closures and four `Date`s it may never use, which makes building one
**5.4× faster** ([stats-alloc.bench.ts](../src/tests/stats-alloc.bench.ts)).

Two intentional differences from current node, both for backward compatibility:
`Dirent.path` is kept as a getter aliasing `parentPath` (node deprecated it and removed it in
v24), and `Stats.atimeNs`/`mtimeNs`/`ctimeNs`/`birthtimeNs` remain readable as getters (node has
them on bigint stats only). Neither appears in `Object.keys` or `JSON.stringify`.

`Dir` supports the full node API including `readSync()` and `closeSync()`, and `opendir`
honours `recursive`.

### Argument validation timing

Node's three APIs report a bad path at three different moments, and code depends on the
difference. All three are reproduced:

```js
fs.statSync({})                  // throws
fs.stat({}, cb)                  // throws at the call site — cb is never called
fs.promises.stat({}).catch(e => …) // rejects; nothing is thrown
```

Errors carry Node's codes (`ERR_INVALID_ARG_TYPE`, `ERR_OUT_OF_RANGE`, …), so callers can branch
on `err.code` rather than matching message text. `realpath` is Node's one exception — it
stringifies its argument instead of type-checking it, so `realpathSync({ toString: () => '/tmp' })`
resolves and a non-path value gives `ENOENT`; that looseness is reproduced too.
