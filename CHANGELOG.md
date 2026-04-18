# Changelog

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
