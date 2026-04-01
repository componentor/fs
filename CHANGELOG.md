# Changelog

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
