# Changelog

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
