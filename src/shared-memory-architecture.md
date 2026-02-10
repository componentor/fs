# High-Performance Shared Memory Architecture

## Overview

A multi-tab filesystem architecture where one tab acts as the **server** holding open sync file handles, and all other tabs communicate through dedicated workers using SharedArrayBuffer (SAB) + Atomics for zero-latency synchronous operations and MessageChannel with zero-copy transfers for async operations.

---

## Core Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Tab A (Server)                                  │
│  ┌───────────────┐     SAB + Atomics      ┌──────────────────────────┐  │
│  │  Main Thread  │◄──────────────────────►│   Dedicated Worker       │  │
│  │               │                        │   (Sync Relay)           │  │
│  │  Sync API ───►  Atomics.wait/notify    │                          │  │
│  │  Async API ──►  postMessage (no-copy)  │   ┌──────────────────┐   │  │
│  └───────────────┘                        │   │ Sync File Handle │   │  │
│                                           │   │  (VFS binary)    │   │  │
│                                           │   │  (Virtual mem)   │   │  │
│                                           │   └──────────────────┘   │  │
│                                           │                          │  │
│                                           │   MessageChannel ports   │  │
│                                           │   to all other workers   │  │
│                                           └─────────┬────────────────┘  │
└─────────────────────────────────────────────────────┼───────────────────┘
                                                      │
                                    Service Worker    │  (port transfer)
                                    ┌──────────────┐  │
                                    │  Transfers   │◄─┘
                                    │  MC ports    │
                                    │  between     │
                                    │  workers     │
                                    └──────┬───────┘
                                           │
              ┌────────────────────────────┼───────────────────────────┐
              │                            │                           │
┌─────────────┼──────────────┐  ┌──────────┼───────────┐  ┌────────────┼────────────┐
│  Tab B      │              │  │  Tab C   │           │  │  Tab N     │            │
│  ┌──────────┴───┐          │  │  ┌───────┴─────┐     │  │  ┌─────────┴─────┐      │
│  │ Main Thread  │          │  │  │ Main Thread │     │  │  │  Main Thread  │      │
│  │              │          │  │  │             │     │  │  │               │      │
│  │ Sync:        │          │  │  │             │     │  │  │               │      │
│  │  SAB+Atomics │          │  │  │             │     │  │  │               │      │
│  │ Async:       │          │  │  │             │     │  │  │               │      │
│  │  postMessage │          │  │  │             │     │  │  │               │      │
│  └──────┬───────┘          │  │  └──────┬──────┘     │  │  └───────┬───────┘      │
│         │                  │  │         │            │  │          │              │
│  ┌──────┴───────┐          │  │  ┌──────┴──────┐     │  │  ┌───────┴───────┐      │
│  │  Dedicated   │          │  │  │  Dedicated  │     │  │  │   Dedicated   │      │
│  │  Worker      │          │  │  │  Worker     │     │  │  │   Worker      │      │
│  │              │          │  │  │             │     │  │  │               │      │
│  │  MC port ────┼──────────┼──┼──┼─── to ──────┼─────┼──┼──┼── server      │      │
│  └──────────────┘          │  │  └─────────────┘     │  │  └───────────────┘      │
└────────────────────────────┘  └──────────────────────┘  └─────────────────────────┘
```

---

## 1. COEP/COOP Setup

All pages must be served with cross-origin isolation headers to enable SharedArrayBuffer:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Every tab must verify isolation before proceeding:

```typescript
if (!crossOriginIsolated) {
  throw new Error('SharedArrayBuffer requires crossOriginIsolated context');
}
```

---

## 2. Server Tab Election

### Initial Election

- First tab to open becomes the server
- Server status is registered via `BroadcastChannel`
- Server tab claims a `navigator.lock` to signal it is alive

```
┌──────────┐    BroadcastChannel     ┌──────────┐
│  Tab A   │◄───────────────────────►│  Tab B   │
│ (server) │   "server-alive"        │ (client) │
│          │   "tab-register"        │          │
│          │   "tab-lost"            │          │
└──────────┘                         └──────────┘
```

### Election Protocol

1. On load, each tab generates a unique `tabId` (crypto.randomUUID)
2. Each tab acquires its own `navigator.lock` named `vfs-tab:<tabId>` (held for lifetime)
3. Each tab allocates its own SAB for Atomics-based communication with its worker
4. Tab broadcasts `{ type: 'hello', tabId }` on `BroadcastChannel`
5. If a server exists, it responds with `{ type: 'server-alive', serverId }` and acquires a liveness lock for the new tab
6. If no response within timeout (~200ms), tab self-promotes to server
7. Server acquires `navigator.locks.request('vfs-server', ...)` - held for lifetime
8. Server broadcasts `{ type: 'who-is-alive' }` - all other tabs respond with `{ type: 'tab-here', tabId }` - server acquires a liveness lock for each responding tab

### Automatic Failover

- Server holds a `navigator.lock` named `vfs-server`
- All client tabs attempt `navigator.locks.request('vfs-server', { ifAvailable: false }, ...)` which queues behind the server
- When the server tab closes/crashes, the lock is released and the next queued tab automatically becomes server
- New server broadcasts `{ type: 'who-is-alive' }` to discover existing tabs
- All living tabs respond with `{ type: 'tab-here', tabId }`
- New server acquires a `navigator.lock` per responding tab (see Tab Liveness Detection)
- New server re-establishes MessageChannel connections to all existing tab workers

### Tab Liveness Detection

Every tab holds its own `navigator.lock` named `vfs-tab:<tabId>` for its entire lifetime. The server uses these locks to track which tabs are alive:

1. **On server initialization:** Server calls `navigator.locks.request('vfs-tab:<tabId>', ...)` for every known tab. This request **queues** behind the tab's own lock and does not resolve until that tab dies.
2. **When a new tab broadcasts `hello`:** Server immediately requests that tab's lock too.
3. **When a tab closes/crashes:** Its `vfs-tab:<tabId>` lock is released, causing the server's queued request to resolve. Server now knows that tab is gone and cleans up its MessageChannel port.
4. **No polling, no heartbeats** - detection is instant and event-driven via the locks API.

```typescript
// Each tab holds its own lock for its entire lifetime
navigator.locks.request(`vfs-tab:${tabId}`, () => {
  // This promise never resolves while the tab is alive
  return new Promise(() => {});
});

// Server tracks a tab by requesting its lock (queues behind the tab)
navigator.locks.request(`vfs-tab:${clientTabId}`, () => {
  // This resolves only when the client tab dies
  onTabLost(clientTabId);
});
```

```
Server Tab                              Client Tab B
    │                                        │
    │  navigator.locks.request               │  navigator.locks.request
    │  ('vfs-tab:B', callback)               │  ('vfs-tab:B', () => new Promise(...))
    │         │                              │         │
    │    (queued - tab B holds lock)         │    (lock held forever)
    │         │                              │         │
    │         │                              │    ✕ Tab B closes
    │         │                              │    Lock released
    │         │                              │
    │    callback fires ◄────────────────────┘
    │    → tab B is dead, clean up
    │
```

---

## 3. Per-Tab Dedicated Worker

Each tab creates its own dedicated worker on load. This worker is the **sync communication relay** between the main thread (via SAB + Atomics) and the server (via MessageChannel).

### SAB Layout Per Tab

```
SharedArrayBuffer (per tab, e.g. 2MB):
┌─────────────────────────────────────────────────────────┐
│ Offset 0-3:   Control signal (Int32Array)               │
│               0 = idle                                  │
│               1 = request ready                         │
│               2 = response ready                        │
│               3 = chunk ready (more data follows)       │
│               4 = chunk ack (receiver consumed chunk)   │
│ Offset 4-7:   Operation code (Int32Array)               │
│               1 = read, 2 = write, 3 = delete           │
│ Offset 8-11:  Status / error code (Int32Array)          │
│ Offset 12-15: Chunk length (Int32Array) - bytes in this │
│               chunk (may be < total length)             │
│ Offset 16-23: Total length (BigUint64) - full data size │
│               across all chunks                         │
│ Offset 24-27: Chunk index (Int32Array) - 0-based        │
│ Offset 28-31: Reserved                                  │
│ Offset 32+:   Data payload (Uint8Array)                 │
│               Max chunk = SAB size - 32 bytes (header)  │
└─────────────────────────────────────────────────────────┘
```

The SAB has a fixed size (e.g. 2MB). When a file exceeds the payload area (`SAB_SIZE - 32` bytes), the data is transferred in multiple chunks using a handshake protocol between main thread and worker.

### Chunked Transfer Protocol

For data larger than one SAB payload:

```
Main Thread                              Worker
    │                                       │
    │  Write chunk 0 to SAB payload         │
    │  Store totalLength, chunkLen, idx=0   │
    │  Atomics.store(ctrl, 0, 1) ──────────►│  (request ready)
    │  Atomics.wait(ctrl, 0, 1)             │
    │     (blocked)                         │  Worker reads chunk 0
    │                                       │  Copies to internal buffer
    │  Atomics.store(ctrl, 0, 4) ◄──────────│  (chunk ack)
    │  Atomics.notify(ctrl, 0)              │
    │     (unblocked)                       │
    │                                       │
    │  Write chunk 1 to SAB payload         │
    │  Store chunkLen, idx=1                │
    │  Atomics.store(ctrl, 0, 3) ──────────►│  (chunk ready)
    │  Atomics.wait(ctrl, 0, 3)             │
    │     (blocked)                         │  Worker reads chunk 1
    │                                       │  Appends to internal buffer
    │  Atomics.store(ctrl, 0, 4) ◄──────────│  (chunk ack)
    │  ...repeat until all chunks sent...   │
    │                                       │
    │                                       │  All chunks received
    │                                       │  Forward full buffer to server
    │                                       │  (MessageChannel, zero-copy)
    │                                       │
    │                                       │  Server responds
    │                                       │
    │  (response may also be chunked)       │
    │  Atomics.store(ctrl, 0, 3) ◄──────────│  (chunk ready, more coming)
    │  ...or...                             │
    │  Atomics.store(ctrl, 0, 2) ◄──────────│  (response ready, final/only)
    │                                       │
```

**Small data (fits in one SAB):** Single round-trip, no chunking overhead. `totalLength == chunkLength`, `chunkIndex == 0`, control goes directly `1 → 2`.

**Large data:** Main thread writes chunks, worker assembles them into a full ArrayBuffer, then transfers to server via MessageChannel (which has no size limit with zero-copy transfer).

### Worker Responsibilities

1. **Receive sync requests** via `Atomics.wait` on the control signal
2. **Assemble chunks** if data spans multiple SAB fills
3. **Encode** request into binary ArrayBuffer (string→buf, path→binary)
4. **Forward to server** via MessageChannel (zero-copy transfer for ArrayBuffers)
5. **Receive response** from server via MessageChannel
6. **Decode** response (buf→string, parse result)
7. **Write response** into SAB (chunked if needed) and `Atomics.notify` main thread

```typescript
// Worker pseudo-code
const ctrl = new Int32Array(sab, 0, 8);
const totalLenView = new BigUint64Array(sab, 16, 1);
const HEADER_SIZE = 32;
const MAX_CHUNK = sab.byteLength - HEADER_SIZE;

while (true) {
  Atomics.wait(ctrl, 0, 0); // Block until main thread signals

  const op = Atomics.load(ctrl, 1);
  const chunkLen = Atomics.load(ctrl, 3);
  const totalLen = Number(Atomics.load(totalLenView, 0));

  let payload: Uint8Array;

  if (totalLen <= MAX_CHUNK) {
    // Fast path: single chunk, no assembly needed
    payload = new Uint8Array(sab, HEADER_SIZE, chunkLen).slice();
  } else {
    // Multi-chunk: assemble full buffer
    const fullBuffer = new Uint8Array(totalLen);
    let offset = 0;

    // Read first chunk (already in SAB)
    fullBuffer.set(new Uint8Array(sab, HEADER_SIZE, chunkLen), offset);
    offset += chunkLen;

    // Ack and wait for more chunks
    while (offset < totalLen) {
      Atomics.store(ctrl, 0, 4); // chunk ack
      Atomics.notify(ctrl, 0);
      Atomics.wait(ctrl, 0, 4);  // wait for next chunk

      const nextLen = Atomics.load(ctrl, 3);
      fullBuffer.set(new Uint8Array(sab, HEADER_SIZE, nextLen), offset);
      offset += nextLen;
    }

    payload = fullBuffer;
  }

  // Encode and forward to server (zero-copy)
  const reqBuffer = encode(op, payload);
  serverPort.postMessage(reqBuffer, [reqBuffer]);

  // Wait for response
  const response = await waitForResponse();

  // Write response back (chunked if needed)
  if (response.byteLength <= MAX_CHUNK) {
    // Fast path: single chunk
    new Uint8Array(sab, HEADER_SIZE, response.byteLength).set(new Uint8Array(response));
    Atomics.store(ctrl, 3, response.byteLength);
    Atomics.store(totalLenView, 0, BigInt(response.byteLength));
    Atomics.store(ctrl, 0, 2); // response ready (final)
    Atomics.notify(ctrl, 0);
  } else {
    // Multi-chunk response
    const data = new Uint8Array(response);
    let sent = 0;
    while (sent < data.byteLength) {
      const chunkSize = Math.min(MAX_CHUNK, data.byteLength - sent);
      new Uint8Array(sab, HEADER_SIZE, chunkSize).set(data.subarray(sent, sent + chunkSize));
      Atomics.store(ctrl, 3, chunkSize);
      Atomics.store(ctrl, 6, sent / MAX_CHUNK | 0); // chunk index

      const isLast = sent + chunkSize >= data.byteLength;
      Atomics.store(ctrl, 0, isLast ? 2 : 3); // 2=final, 3=more
      Atomics.notify(ctrl, 0);

      if (!isLast) {
        Atomics.wait(ctrl, 0, 3); // wait for main thread ack
      }
      sent += chunkSize;
    }
  }

  // Reset to idle
  Atomics.store(ctrl, 0, 0);
}
```

---

## 4. Service Worker for Port Transfer

The server tab registers a Service Worker. The Service Worker's **only job** is to transfer MessageChannel ports from client workers to the server worker, since workers cannot directly exchange ports.

### Port Transfer Flow

Each **client worker** creates its own `MessageChannel` and sends one port to the server via the Service Worker. The server worker receives ports - it never creates channels itself.

```
Client Worker               Service Worker              Server Worker
     │                            │                           │
     │  1. new MessageChannel()   │                           │
     │     keep port1             │                           │
     │                            │                           │
     │  2. postMessage(           │                           │
     │    { tabId },              │                           │
     │    [port2]  ← transfer)    │                           │
     ├───────────────────────────►│                           │
     │    port2 transferred       │                           │
     │    (zero-copy)             │  3. postMessage(          │
     │                            │    { tabId },             │
     │                            │    [port2]  ← transfer)   │
     │                            ├──────────────────────────►│
     │                            │    port2 transferred      │
     │                            │    (zero-copy)            │  4. Store port2
     │                            │                           │     in ports map
     │                            │                           │
     │◄──── MessageChannel is now established ───────────────►│
     │  port1                                            port2│
```

### How It Works

1. Each client worker creates a `MessageChannel` and keeps `port1` for sending requests
2. Client worker sends `port2` to the Service Worker using `postMessage` with transfer list: `sw.postMessage({ tabId }, [port2])` - port is moved, not copied
3. Service Worker forwards `port2` to the server worker using `client.postMessage({ tabId }, [port2])` - again transferred, not copied
4. Server worker stores the received port in a `Map<tabId, MessagePort>` and listens on it
5. Client worker sends requests via its `port1`, server worker receives on `port2`

**Key:** All port transfers use `postMessage` transfer lists (`[port]`) for zero-copy. The port is **moved** through the chain (client worker -> service worker -> server worker) without ever being cloned. The server worker holds only received **ports** (not channels) - one per client tab, which is cheaper than creating channel pairs on the server side.

---

## 5. Server Worker - The Sync File Handle Owner

The server's dedicated worker is the **only** entity that opens sync file handles. It manages:

- **VFS binary file** - the virtual filesystem data
- **Virtual memory file** (optional) - for shared memory-mapped regions

### Server Worker Design

```typescript
// Server worker - minimal, high-performance, sync-only operations
let vfsHandle: FileSystemSyncAccessHandle;
let memHandle: FileSystemSyncAccessHandle;

// Map of tabId -> received port (from client workers via Service Worker)
const ports = new Map<string, MessagePort>();

function handleRequest(tabId: string, op: number, buffer: ArrayBuffer): ArrayBuffer {
  switch (op) {
    case 1: // READ
      return syncRead(buffer);
    case 2: // WRITE
      return syncWrite(buffer);
    case 3: // DELETE
      return syncDelete(buffer);
  }
}

function syncRead(buffer: ArrayBuffer): ArrayBuffer {
  // Decode offset + length from buffer header
  const view = new DataView(buffer);
  const offset = view.getUint32(0);
  const length = view.getUint32(4);

  const result = new ArrayBuffer(length);
  const resultView = new Uint8Array(result);
  vfsHandle.read(resultView, { at: offset });

  return result; // Transferred back via zero-copy
}
```

### Critical Performance Rules for Server Worker

1. **Only receives and sends ArrayBuffers** - no JSON, no strings, no objects
2. **Only does sync file operations** - read, write, delete on open handles
3. **Minimal work** - decode header, execute op, encode response, done
4. **Zero-copy transfers** on all MessageChannel communication
5. **No encoding/decoding** - that is the client's responsibility
6. **Handles stay open** - never close/reopen during normal operation

---

## 6. Request Flow - Sync Operations

A synchronous operation from a client tab's main thread:

```
Main Thread (Tab B)          Worker (Tab B)            Worker (Server Tab A)
      │                           │                           │
  1.  │ Write request to SAB      │                           │
      │ (raw user data + op code) │                           │
      │ Atomics.store(ctrl, 0, 1) │                           │
      │ Atomics.notify(ctrl, 0)   │                           │
      │ Atomics.wait(ctrl, 0, 1)  │                           │
      │         ┌─────────────────┤                           │
      │ (blocked)                 │                           │
      │         │  2. Read SAB    │                           │
      │         │  Encode:        │                           │
      │         │   - string→buf  │                           │
      │         │   - path→binary │                           │
      │         │   - build req   │                           │
      │         │    ArrayBuffer  │                           │
      │         │                 │                           │
      │         │  3. postMessage │  (zero-copy transfer)     │
      │         │  ──────────────►│                           │
      │         │                 │  4. Sync read/write       │
      │         │                 │     on VFS handle         │
      │         │                 │     (raw ArrayBuffer I/O) │
      │         │                 │                           │
      │         │  5. postMessage │  (zero-copy transfer)     │
      │         │  ◄──────────────│                           │
      │         │                 │                           │
      │         │  6. Decode:     │                           │
      │         │   - buf→string  │                           │
      │         │   - parse resp  │                           │
      │         │  Write result   │                           │
      │         │  to SAB         │                           │
      │         │  Atomics.store  │                           │
      │         │  Atomics.notify │                           │
      │         └─────────────────┤                           │
      │                           │                           │
  7.  │ Atomics.wait returns      │                           │
      │ Read response from SAB    │                           │
      │                           │                           │
```

**Encoding/decoding happens in the client worker**, not on the main thread and not on the server. This keeps the main thread unblocked (it only does a SAB write + Atomics.wait) and keeps the server worker doing only raw binary I/O.

---

## 7. Request Flow - Async Operations

Async operations use a **preflight worker** pattern for concurrent encoding/decoding:

```
Main Thread (Tab B)         Async Worker (Tab B)        Sync Worker (Tab B)       Server Worker
      │                           │                           │                        │
  1.  │  postMessage (no-copy)    │                           │                        │
      │  ────────────────────────►│                           │                        │
      │                           │  2. Preflight:            │                        │
      │                           │     - encode to           │                        │
      │                           │       ArrayBuffer         │                        │
      │                           │     - validate            │                        │
      │                           │                           │                        │
      │                           │  3. MC postMessage        │                        │
      │                           │     (no-copy)             │                        │
      │                           │  ────────────────────────►│                        │
      │                           │                           │  4. MC postMessage     │
      │                           │                           │     (no-copy)          │
      │                           │                           │  ─────────────────────►│
      │                           │                           │                        │
      │                           │                           │  5. Sync file op       │
      │                           │                           │                        │
      │                           │                           │  6. MC response        │
      │                           │                           │     (no-copy)          │
      │                           │                           │  ◄─────────────────────│
      │                           │  7. MC response           │                        │
      │                           │     (no-copy)             │                        │
      │                           │  ◄────────────────────────│                        │
      │                           │                           │                        │
      │                           │  8. Deserialize:          │                        │
      │                           │     - decode response     │                        │
      │                           │     - prepare result      │                        │
      │                           │                           │                        │
      │  9. postMessage (no-copy) │                           │                        │
      │  ◄────────────────────────│                           │                        │
      │                           │                           │                        │
  10. │  Resolve promise          │                           │                        │
      │                           │                           │                        │
```

### Why Two Workers Per Tab?

- **Sync worker**: Runs an Atomics.wait loop - permanently blocked, dedicated to sync relay
- **Async (preflight) worker**: Handles encoding/decoding concurrently so main thread never serializes or deserializes data, communicates with sync worker via MessageChannel (no-copy), also talks to main thread using MessageChannel (no-copy) instead of Atomics.wait to keep it async without blocking main thread also.

This allows encoding and decoding to happen **off the main thread**, keeping the UI responsive.

---

## 8. Worker Summary Per Tab

| Worker | Role | Communication | Operations |
|--------|------|---------------|------------|
| **Sync Worker** | Relay between main thread SAB and server MC | SAB + Atomics (main thread) / MessageChannel (server) | Forward raw ArrayBuffers only |
| **Async Worker** | Preflight - encode/decode off main thread | postMessage (main thread) / MessageChannel (sync worker) | Serialize, validate, deserialize |
| **Server Worker** | Sync file handle owner, direct MC to all tabs | MessageChannel (all tab workers + OPFS sync worker) | read, write, delete on VFS sync handle |
| **OPFS Sync Worker** | Optional — mirrors VFS ↔ real OPFS files | MessageChannel (server worker) | Sequential OPFS writes, FileSystemObserver |
| **Service Worker** | Port transfer broker | postMessage (all workers) | Transfer MC ports between workers |

---

## 9. Binary Protocol

All inter-worker messages use a minimal binary protocol — **no JSON, no strings**.

### Operation Codes

```
 1 = READ          16 = CHMOD
 2 = WRITE         17 = CHOWN
 3 = UNLINK        18 = UTIMES
 4 = STAT          19 = SYMLINK
 5 = LSTAT         20 = READLINK
 6 = MKDIR         21 = LINK
 7 = RMDIR         22 = OPEN
 8 = READDIR       23 = CLOSE
 9 = RENAME        24 = FREAD
10 = EXISTS        25 = FWRITE
11 = TRUNCATE      26 = FSTAT
12 = APPEND        27 = FTRUNCATE
13 = COPY          28 = FSYNC
14 = ACCESS        29 = OPENDIR
15 = REALPATH      30 = MKDTEMP
```

### Request Header (16 bytes)

```
Bytes 0-3:   Operation (uint32) - see operation codes above
Bytes 4-7:   Flags (uint32)    - operation-specific flags
Bytes 8-11:  Path length (uint32)
Bytes 12-15: Data length (uint32)
Bytes 16+:   Path (UTF-8 bytes, pathLen)
Bytes 16+pathLen: Data payload (dataLen bytes, if applicable)
```

Flags field usage per operation:
- WRITE: bit 0 = flush after write
- MKDIR: bit 0 = recursive
- RMDIR: bit 0 = recursive
- ACCESS: bits 0-2 = mode (F_OK=0, R_OK=4, W_OK=2, X_OK=1)
- OPEN: bits 0-7 = flags (O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_TRUNC, O_APPEND)
- READDIR: bit 0 = withFileTypes
- COPY: bits 0-2 = mode (COPYFILE_EXCL, etc.)
- CHMOD: mode stored in data payload (4 bytes uint32)
- CHOWN: uid+gid stored in data payload (8 bytes, 2x uint32)

### Response Header (8 bytes)

```
Bytes 0-3:   Status (uint32) - 0=ok, error codes map to errno
Bytes 4-7:   Data length (uint32)
Bytes 8+:    Data payload (if applicable)
```

Status codes:
```
0  = OK
1  = ENOENT   (not found)
2  = EEXIST   (already exists)
3  = EISDIR   (is a directory)
4  = ENOTDIR  (not a directory)
5  = ENOTEMPTY (directory not empty)
6  = EACCES   (permission denied)
7  = EINVAL   (invalid argument)
8  = EBADF    (bad file descriptor)
9  = ELOOP    (too many symlinks)
10 = ENOSPC   (no space left)
```

---

## 10. API Surface & Operation Mapping

Every method from the current implementation is supported. Each method routes through either the **sync worker** (SAB + Atomics, blocks caller) or the **async worker** (postMessage, returns Promise). Some methods are handled **locally** on the calling thread with no worker needed.

### Sync Methods → Sync Worker (SAB + Atomics)

Every sync method calls `ensureReady()`, writes the operation to the SAB, and blocks via `Atomics.wait` until the server responds.

| Method | VFS Op | Payload | Response |
|--------|--------|---------|----------|
| `readFileSync(path, enc?)` | READ | path | file data (decoded if enc) |
| `writeFileSync(path, data, opts?)` | WRITE | path + data | success |
| `appendFileSync(path, data, opts?)` | APPEND | path + data | success |
| `existsSync(path)` | EXISTS | path | boolean |
| `mkdirSync(path, opts?)` | MKDIR | path, flags=recursive | created path |
| `rmdirSync(path, opts?)` | RMDIR | path, flags=recursive | success |
| `rmSync(path, opts?)` | UNLINK/RMDIR | path, flags=recursive+force | success |
| `unlinkSync(path)` | UNLINK | path | success |
| `readdirSync(path, opts?)` | READDIR | path, flags=withFileTypes | entries |
| `statSync(path)` | STAT | path | Stats object |
| `lstatSync(path)` | LSTAT | path | Stats (no symlink follow) |
| `renameSync(old, new)` | RENAME | oldPath + newPath | success |
| `copyFileSync(src, dest, mode?)` | COPY | srcPath + destPath | success |
| `truncateSync(path, len?)` | TRUNCATE | path + length | success |
| `accessSync(path, mode?)` | ACCESS | path, flags=mode | success or EACCES |
| `realpathSync(path)` | REALPATH | path | resolved path |
| `chmodSync(path, mode)` | CHMOD | path + mode | success |
| `chownSync(path, uid, gid)` | CHOWN | path + uid + gid | success |
| `utimesSync(path, atime, mtime)` | UTIMES | path + atime + mtime | success |
| `symlinkSync(target, path)` | SYMLINK | targetPath + linkPath | success |
| `readlinkSync(path)` | READLINK | path | target path string |
| `linkSync(existing, new)` | LINK | existingPath + newPath | success |
| `mkdtempSync(prefix)` | MKDTEMP | prefix | created path |

**File descriptor operations** (via `openSync` returning an fd):

| Method | VFS Op | Notes |
|--------|--------|-------|
| `openSync(path, flags?, mode?)` | OPEN | returns fd (integer, mapped to inode on server) |
| `closeSync(fd)` | CLOSE | releases fd mapping |
| `readSync(fd, buf, off, len, pos)` | FREAD | read from open fd at position |
| `writeSync(fd, buf, off, len, pos)` | FWRITE | write to open fd at position |
| `fstatSync(fd)` | FSTAT | stat via fd |
| `ftruncateSync(fd, len?)` | FTRUNCATE | truncate via fd |
| `fdatasyncSync(fd)` | FSYNC | flush fd to VFS |
| `opendirSync(path)` | OPENDIR | returns Dir with read()/close()/iterator |

### Async Methods → Async Worker (postMessage)

Async methods send requests via `postMessage` to the async preflight worker, which encodes and forwards to the sync worker's MessageChannel, which forwards to the server. Response comes back the same chain.

| Method | VFS Op | Notes |
|--------|--------|-------|
| `promises.readFile(path, enc?)` | READ | |
| `promises.writeFile(path, data, opts?)` | WRITE | |
| `promises.appendFile(path, data, opts?)` | APPEND | |
| `promises.mkdir(path, opts?)` | MKDIR | |
| `promises.rmdir(path, opts?)` | RMDIR | |
| `promises.rm(path, opts?)` | UNLINK/RMDIR | |
| `promises.unlink(path)` | UNLINK | |
| `promises.readdir(path, opts?)` | READDIR | |
| `promises.stat(path)` | STAT | |
| `promises.lstat(path)` | LSTAT | |
| `promises.access(path, mode?)` | ACCESS | |
| `promises.rename(old, new)` | RENAME | |
| `promises.copyFile(src, dest, mode?)` | COPY | |
| `promises.truncate(path, len?)` | TRUNCATE | |
| `promises.realpath(path)` | REALPATH | |
| `promises.exists(path)` | EXISTS | |
| `promises.chmod(path, mode)` | CHMOD | |
| `promises.chown(path, uid, gid)` | CHOWN | |
| `promises.utimes(path, atime, mtime)` | UTIMES | |
| `promises.symlink(target, path)` | SYMLINK | |
| `promises.readlink(path)` | READLINK | |
| `promises.link(existing, new)` | LINK | |
| `promises.open(path, flags?, mode?)` | OPEN | returns FileHandle |
| `promises.opendir(path)` | OPENDIR | returns Dir |
| `promises.mkdtemp(prefix)` | MKDTEMP | |

### FileHandle Methods (async, operate on open fd)

`FileHandle` is returned by `promises.open()`. Each method sends an operation with the fd number:

| Method | VFS Op | Notes |
|--------|--------|-------|
| `handle.read(buf, off, len, pos)` | FREAD | read at position |
| `handle.write(buf, off, len, pos)` | FWRITE | write at position |
| `handle.readFile(opts?)` | READ | read entire file via fd |
| `handle.writeFile(data, opts?)` | WRITE | write entire file via fd |
| `handle.truncate(len?)` | FTRUNCATE | |
| `handle.stat()` | FSTAT | |
| `handle.sync()` | FSYNC | |
| `handle.datasync()` | FSYNC | |
| `handle.close()` | CLOSE | |

### Streams (built on top of read/write ops)

Streams are constructed locally and issue read/write operations internally:

| Method | Implementation |
|--------|---------------|
| `createReadStream(path, opts?)` | Creates `ReadableStream`, pulls chunks via READ ops with offset+length |
| `createWriteStream(path, opts?)` | Creates `WritableStream`, pushes chunks via WRITE ops with offset |

Both stream types use the sync or async path depending on context. Each chunk is a separate VFS operation.

### Watch (local + VFS events)

| Method | Implementation |
|--------|---------------|
| `watch(path, opts?)` | Returns `FSWatcher`. If `opfsSync` enabled: backed by FileSystemObserver. Otherwise: server broadcasts change events via BroadcastChannel when writes/deletes occur. |
| `watchFile(path, opts?)` | Polls stat at interval, compares mtime. Runs locally, calls STAT periodically. |
| `unwatchFile(path)` | Clears the polling interval. |
| `promises.watch(path, opts?)` | Returns `AsyncIterable<WatchEventType>`. Same backing as `watch()`. |

### Local Methods (no worker needed)

These run entirely on the calling thread:

| Method | Notes |
|--------|-------|
| `promises.flush()` | Sends FSYNC to server (flushes VFS handle) |
| `promises.purge()` | Sends cache-clear signal to server |
| `flushSync()` | Same via sync path |
| `purgeSync()` | Same via sync path |
| `setDebugSync(enabled)` | Sends config message to worker |
| `setDebug(enabled)` | Async version |

### File Descriptor Table

The server maintains a per-tab fd table mapping integer descriptors to open inode references:

```typescript
// Server-side fd tracking
const fdTable = new Map<number, { tabId: string; inodeIdx: number; position: number; flags: number }>();
let nextFd = 3; // 0=stdin, 1=stdout, 2=stderr reserved

function openFd(tabId: string, inodeIdx: number, flags: number): number {
  const fd = nextFd++;
  fdTable.set(fd, { tabId, inodeIdx, position: 0, flags });
  return fd;
}

function closeFd(fd: number): void {
  fdTable.delete(fd);
}
```

When a tab dies (detected via liveness lock), all its open fds are cleaned up automatically.

---

## 11. VFS Binary Format

The server worker reads/writes to a single binary VFS file (or optionally a second file for virtual memory). The VFS file stores all virtual files, their paths, content, and metadata in a structured binary layout.

### File Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  SUPERBLOCK (64 bytes)                                               │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Magic number (4B): 0x56465321 ("VFS!")                       │  │
│  │  Version (4B): format version                                 │  │
│  │  Inode count (4B): total inodes allocated                     │  │
│  │  Block size (4B): data block size (default 4096)              │  │
│  │  Total blocks (4B): total data blocks                         │  │
│  │  Free blocks (4B): available data blocks                      │  │
│  │  Inode table offset (8B): byte offset to inode table          │  │
│  │  Path table offset (8B): byte offset to path table            │  │
│  │  Data region offset (8B): byte offset to data blocks          │  │
│  │  Free list offset (8B): byte offset to free block bitmap      │  │
│  │  Reserved (4B)                                                │  │
│  └────────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│  INODE TABLE                                                         │
│  Fixed-size entries, indexed by inode number                         │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Inode 0: [type|pathOff|pathLen|size|blocks|mtime|ctime|mode] │  │
│  │  Inode 1: [type|pathOff|pathLen|size|blocks|mtime|ctime|mode] │  │
│  │  ...                                                          │  │
│  │  Inode N: [...]                                               │  │
│  └────────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│  PATH TABLE                                                          │
│  Variable-length, UTF-8 encoded file paths packed contiguously       │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  "/hello.txt\0/projects/src/index.js\0/data/config.json\0..." │  │
│  └────────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│  FREE BLOCK BITMAP                                                   │
│  1 bit per data block: 0=free, 1=used                                │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  [11110000 11001100 ...]                                      │  │
│  └────────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│  DATA REGION                                                         │
│  Fixed-size blocks (4KB each), addressed by block index              │
│  ┌──────────┐┌──────────┐┌──────────┐┌──────────┐                   │
│  │ Block 0  ││ Block 1  ││ Block 2  ││ Block 3  │  ...              │
│  │ (4096B)  ││ (4096B)  ││ (4096B)  ││ (4096B)  │                   │
│  └──────────┘└──────────┘└──────────┘└──────────┘                   │
└──────────────────────────────────────────────────────────────────────┘
```

### Inode Entry (64 bytes each)

```
Bytes 0:      Type (uint8)      - 0=free, 1=file, 2=directory, 3=symlink
Bytes 1-3:    Flags (uint8[3])  - reserved
Bytes 4-7:    Path offset (uint32) - byte offset into path table
Bytes 8-9:    Path length (uint16) - length of path string
Bytes 10-11:  Reserved
Bytes 12-15:  Mode (uint32)     - permissions (e.g. 0o100644 file, 0o40755 dir)
Bytes 16-23:  Size (uint64)     - file content size in bytes
Bytes 24-27:  First block (uint32) - index of first data block
Bytes 28-31:  Block count (uint32) - number of contiguous data blocks
Bytes 32-39:  mtime (float64)   - last modification time (ms since epoch)
Bytes 40-47:  ctime (float64)   - creation time (ms since epoch)
Bytes 48-55:  atime (float64)   - last access time (ms since epoch)
Bytes 56-59:  uid (uint32)      - owner (always 0 in browser)
Bytes 60-63:  gid (uint32)      - group (always 0 in browser)
```

### Path Table

Paths are stored as null-terminated UTF-8 strings packed contiguously. Each inode references its path via `pathOffset` + `pathLength` into this table.

- **Lookup by path**: Server maintains an in-memory `Map<string, inodeIndex>` built on startup by scanning the inode table. This avoids linear scans.
- **New file**: Path is appended to the end of the path table, inode gets the new offset.
- **Delete file**: Inode is marked as free (type=0). Path bytes are left in place (no compaction needed - offset+length still valid for reuse detection). The in-memory map removes the entry.
- **Rename**: Old inode path offset is updated to point to a newly appended path. Old path bytes become dead space.
- **Path table compaction**: When dead space exceeds a threshold (e.g. 25%), compact by rewriting all live paths contiguously and updating inode offsets. This is an infrequent background operation.

### Operations and VFS Consistency

#### Write (create or update)

```
1. Lookup path in memory map → inode index (or allocate new inode)
2. If new file:
   a. Find free inode slot (type=0) or expand inode table
   b. Append path to path table
   c. Allocate data blocks from free bitmap
   d. Write inode entry with metadata:
      - mtime = Date.now()
      - ctime = Date.now() (new file only)
      - size = data length
   e. Add to in-memory path→inode map
3. If existing file:
   a. If new data fits in current blocks → overwrite in place
   b. If new data needs more blocks → allocate additional, update inode
   c. If new data is smaller → update size, free excess blocks in bitmap
   d. Update mtime = Date.now()
   e. Update size
4. Write data to data blocks
5. Flush sync handle
```

#### Read

```
1. Lookup path in memory map → inode index
2. Read inode → get first block index + size
3. Read data blocks (first block, block count, size)
4. Update atime = Date.now() (optional, can be disabled for performance)
5. Return data
```

#### Delete (unlink)

```
1. Lookup path in memory map → inode index
2. Read inode → get block range
3. Clear blocks in free bitmap (mark as free)
4. Set inode type = 0 (free)
5. Remove from in-memory path→inode map
6. Flush sync handle
```

#### Mkdir

```
1. Allocate new inode with type=2 (directory)
2. Append path to path table
3. No data blocks needed (directories are virtual - children found by path prefix)
4. Set mtime = ctime = Date.now()
5. Add to in-memory map
```

#### Stat

```
1. Lookup path in memory map → inode index
2. Read inode → return { size, mtime, ctime, atime, mode, type }
3. No data block access needed
```

#### Readdir

```
1. Lookup directory path in memory map
2. Scan in-memory map for all paths where:
   - path starts with dirPath + "/"
   - path has no additional "/" after dirPath + "/" (direct children only)
3. Return list of child names
```

#### Rename

```
1. Lookup old path → inode index
2. Append new path to path table
3. Update inode pathOffset + pathLength to new path location
4. Update mtime = Date.now()
5. Remove old path from in-memory map, add new path
```

#### Symlink

```
1. Allocate new inode with type=3 (symlink)
2. Append symlink path to path table
3. Encode target path as UTF-8 bytes
4. Allocate data blocks for target path bytes
5. Write target path bytes to data blocks
6. Set inode size = target path byte length
7. Set inode mode = 0o120777 (symlink, all permissions)
8. Set mtime = ctime = Date.now()
9. Add to in-memory path→inode map
```

#### Readlink

```
1. Lookup path in memory map → inode index
2. Read inode → verify type=3 (symlink), get block range + size
3. Read target path bytes from data blocks
4. Decode UTF-8 → return target path string
```

#### Path Resolution with Symlinks

When any operation (read, write, stat, etc.) encounters a symlink during path resolution, it follows the symlink chain:

```
1. Split path into components: ["", "home", "user", "link", "file.txt"]
2. Walk components, resolving each prefix:
   a. Lookup "/home" → inode → type=2 (directory) → continue
   b. Lookup "/home/user" → inode → type=2 (directory) → continue
   c. Lookup "/home/user/link" → inode → type=3 (symlink)
      - Read target: "/data/shared"
      - Restart resolution with "/data/shared/file.txt"
3. Detect circular symlinks: abort after MAX_SYMLINK_DEPTH (e.g. 40)
4. Return final resolved inode
```

#### Chmod

```
1. Lookup path in memory map → inode index
2. Read inode → update mode field (bytes 12-15)
3. Update ctime = Date.now() (metadata change)
4. Write inode back
5. Flush sync handle
```

#### Chown

```
1. Lookup path in memory map → inode index
2. Read inode → update uid (bytes 56-59) and/or gid (bytes 60-63)
3. Update ctime = Date.now() (metadata change)
4. Write inode back
5. Flush sync handle
```

#### Access (permission check)

```
1. Lookup path in memory map → inode index
2. Read inode → get mode, uid, gid
3. Compare against requested access mode:
   - F_OK (0): check existence only
   - R_OK (4): check read permission
   - W_OK (2): check write permission
   - X_OK (1): check execute permission
4. Extract permission bits from mode based on caller identity:
   - Owner (uid match):  bits 8-6 (rwx)
   - Group (gid match):  bits 5-3 (rwx)
   - Other:              bits 2-0 (rwx)
5. In browser context: default uid=0, gid=0 (root), so owner bits apply
6. Return success or EACCES error
```

### Symlinks

Symlinks are stored as inode entries with `type=3`. The symlink's **target path** is stored as raw UTF-8 bytes in the data region, exactly like file content. The `size` field holds the target path length in bytes.

```
Symlink inode:
┌──────────────────────────────────────────────────┐
│  type = 3 (symlink)                               │
│  mode = 0o120777                                  │
│  size = length of target path in bytes            │
│  firstBlock → data block containing target path   │
│  blockCount = ceil(targetLen / blockSize)          │
└──────────────────────────────────────────────────┘

Data blocks (target path):
┌──────────────────────────────────────────────────┐
│  "/data/shared/actual-file.txt"  (UTF-8 bytes)   │
└──────────────────────────────────────────────────┘
```

**Symlink type flag in mode:** The mode field uses the standard POSIX layout. The top 4 bits encode the file type:

```
0o100000 = regular file
0o040000 = directory
0o120000 = symlink
```

So a symlink with all permissions has `mode = 0o120777`.

**lstat vs stat:** `stat` follows symlinks (resolves the chain and returns the target inode's metadata). `lstat` does not follow symlinks (returns the symlink inode itself, where `size` = target path length, `type` = symlink).

### Permissions

The `mode` field (bytes 12-15 in each inode, uint32) stores standard POSIX-style permission bits:

```
Bits 31-16:  File type (0o100000=file, 0o040000=dir, 0o120000=symlink)
Bits 11-9:   Special bits (setuid, setgid, sticky) - reserved, always 0
Bits 8-6:    Owner permissions (rwx)
Bits 5-3:    Group permissions (rwx)
Bits 2-0:    Other permissions (rwx)
```

**Default modes:**

| Type      | Default mode | Octal     | Meaning                    |
|-----------|-------------|-----------|----------------------------|
| File      | `0o100644`  | rw-r--r-- | Owner read/write, others read |
| Directory | `0o040755`  | rwxr-xr-x | Owner full, others read/exec  |
| Symlink   | `0o120777`  | rwxrwxrwx | All permissions (per POSIX)   |

**Umask support:** A configurable `umask` (default `0o022`) is applied when creating new files and directories:

```
actual_mode = requested_mode & ~umask
```

For example, with `umask = 0o022`:
- File created with `0o666` → actual `0o644`
- Dir created with `0o777` → actual `0o755`

**Permission enforcement:** In a single-user browser context, the process always runs as `uid=0, gid=0`. Permission checks compare the requested access against the **owner** permission bits by default. This makes permissions meaningful for applications that want POSIX-like behavior (e.g. git, build tools), even though the browser has no multi-user model.

Permission enforcement can optionally be **strict** or **relaxed**:
- **Strict mode**: EACCES is thrown if permission bits deny access
- **Relaxed mode** (default): Permissions are stored and reported by `stat()` but not enforced, matching browser reality

### Ownership

The `uid` (bytes 56-59) and `gid` (bytes 60-63) fields in each inode track file ownership. In the browser context, these default to `0` (root) since there are no real users, but they are fully functional for applications that need POSIX ownership semantics.

**Operations:**

- **chown(path, uid, gid):** Updates the inode's `uid` and `gid` fields. Updates `ctime`.
- **New file/directory creation:** Inherits `uid`/`gid` from the process context (default `0`/`0`). Can be overridden via a configurable process identity: `{ uid: number, gid: number }`.
- **stat():** Returns `uid` and `gid` as part of the Stats object.

**Process identity:** The VFS can be initialized with a virtual process identity:

```typescript
const vfs = new VFS({
  uid: 1000,    // virtual user ID
  gid: 1000,    // virtual group ID
  umask: 0o022, // default file creation mask
  strictPermissions: false, // whether to enforce permission checks
});
```

This identity is used for:
1. Setting `uid`/`gid` on newly created inodes
2. Permission checks in strict mode (matching caller uid/gid against inode owner/group bits)
3. `chown` validation (in strict mode, only root uid=0 can change ownership)

### In-Memory Index

On server startup (or failover), the server worker rebuilds the in-memory index by scanning the inode table:

```typescript
// Rebuilt from inode table on startup - O(n) scan, done once
const pathIndex = new Map<string, number>(); // path → inode index

function rebuildIndex(): void {
  pathIndex.clear();
  for (let i = 0; i < inodeCount; i++) {
    const inode = readInode(i);
    if (inode.type === 0) continue; // free slot
    const path = readPath(inode.pathOffset, inode.pathLength);
    pathIndex.set(path, i);
  }
}

// All lookups are O(1) after rebuild
function resolve(path: string): number | undefined {
  return pathIndex.get(path);
}
```

### Growth Strategy

- **Inode table**: Pre-allocated for N inodes (e.g. 10,000). When full, grow by doubling - requires shifting path table and data region forward. Alternatively, use a fixed max and fail when exceeded.
- **Path table**: Append-only, grows as paths are added. Compacted when dead space is excessive.
- **Data region**: Grows as needed by extending the file via `truncate()` on the sync handle.
- **Free bitmap**: Grows proportionally with data region.

---

## 12. OPFS Sync Worker (Optional Bidirectional Mirror)

An optional dedicated worker that mirrors the VFS to real OPFS paths and vice versa. Enabled via configuration — when disabled, the VFS binary is the sole source of truth and no real OPFS files exist.

### Purpose

```
┌─────────────────────────────┐       ┌─────────────────────────────┐
│      VFS Binary File         │       │     Real OPFS File Tree     │
│  (single file, fast, binary) │◄─────►│  /hello.txt                 │
│                              │       │  /projects/src/index.js     │
│  Server Worker reads/writes  │       │  /data/config.json          │
│  this directly               │       │                             │
└──────────────┬───────────────┘       └──────────────┬──────────────┘
               │                                      │
               │         OPFS Sync Worker             │
               │    ┌────────────────────────┐        │
               └───►│  Event queue            │◄───────┘
                    │  (write, delete, mkdir)  │  FileSystemObserver
                    │                         │  (external changes)
                    │  Processes 1 op at a    │
                    │  time, in order          │
                    └─────────────────────────┘
```

**Why:** Some use cases need real OPFS files accessible via the standard `FileSystemDirectoryHandle` API — e.g. for sharing with other libraries, debugging via DevTools, or `<input type="file">` integration. The VFS binary alone is opaque.

### Configuration

```typescript
import fs from '@anthropic/vfs';

// Enabled via config (can also be set via env/build flags)
const fs = new VFS({
  opfsSync: true,          // mirror VFS ↔ real OPFS (default: false)
  opfsSyncRoot: '/mirror', // OPFS directory to mirror into (default: root)
});
```

When `opfsSync: false` (default), this worker is never spawned. Zero overhead.

### Architecture

The OPFS Sync Worker is spawned by the server worker (not by client tabs). It receives events from the server worker via a MessageChannel.

```
Server Worker                    OPFS Sync Worker
     │                                │
     │  VFS write(/hello.txt)        │
     │  1. Write to VFS binary       │
     │  2. postMessage({             │
     │       op: 'write',            │
     │       path: '/hello.txt',     │
     │       data: ArrayBuffer,      │
     │       ts: Date.now()          │
     │     }, [data])                │
     │  ────────────────────────────►│
     │                               │  3. Queue event
     │                               │  4. Process: write to real OPFS
     │                               │     /mirror/hello.txt
     │                               │
     │                               │  FileSystemObserver fires
     │                               │  (for our own write — ignore,
     │                               │   ts matches pending op)
     │                               │
     │                               │  --- later ---
     │                               │
     │                               │  FileSystemObserver fires
     │                               │  (external change to /foo.txt)
     │                               │  ts does NOT match any pending op
     │  ◄────────────────────────────│
     │  postMessage({                │  5. Read changed file from OPFS
     │    op: 'external-write',      │  6. Send to server for VFS update
     │    path: '/foo.txt',          │
     │    data: ArrayBuffer,         │
     │    ts: ...                    │
     │  }, [data])                   │
     │                               │
     │  7. Write to VFS binary       │
     │                               │
```

### Event Queue

All operations from the server are queued and processed sequentially — one sync handle operation at a time, in order:

```typescript
interface SyncEvent {
  op: 'write' | 'delete' | 'mkdir' | 'rename';
  path: string;
  newPath?: string;    // for rename
  data?: ArrayBuffer;  // for write (transferred, not copied)
  ts: number;          // timestamp from server, used for echo suppression
}

const queue: SyncEvent[] = [];
let processing = false;

function enqueue(event: SyncEvent): void {
  queue.push(event);
  if (!processing) processNext();
}

async function processNext(): Promise<void> {
  if (queue.length === 0) { processing = false; return; }
  processing = true;

  const event = queue.shift()!;
  pendingOps.set(event.path, event.ts); // track for echo suppression

  try {
    switch (event.op) {
      case 'write':
        await writeToOPFS(event.path, event.data!);
        break;
      case 'delete':
        await deleteFromOPFS(event.path);
        break;
      case 'mkdir':
        await mkdirInOPFS(event.path);
        break;
      case 'rename':
        await renameInOPFS(event.path, event.newPath!);
        break;
    }
  } catch (e) {
    // Log but don't block queue — OPFS mirror is best-effort
  }

  processNext();
}
```

### Sync Handle Management

The OPFS Sync Worker opens its own sync handles for writing to real OPFS files. It walks the OPFS directory tree to create/delete files as needed:

```typescript
async function writeToOPFS(path: string, data: ArrayBuffer): Promise<void> {
  // Ensure parent directories exist
  const dir = await ensureParentDirs(path);

  // Get or create file
  const fileHandle = await dir.getFileHandle(basename(path), { create: true });
  const syncHandle = await fileHandle.createSyncAccessHandle();

  // Write and close
  syncHandle.truncate(0);
  syncHandle.write(new Uint8Array(data), { at: 0 });
  syncHandle.flush();
  syncHandle.close();
}

async function deleteFromOPFS(path: string): Promise<void> {
  const dir = await navigateToParent(path);
  await dir.removeEntry(basename(path), { recursive: true });
}
```

### FileSystemObserver — Detecting External Changes

The OPFS Sync Worker sets up a `FileSystemObserver` on the mirror root, recursively watching all directories and files — **except the VFS binary file itself**.

```typescript
const observer = new FileSystemObserver((records) => {
  for (const record of records) {
    const path = '/' + record.relativePathComponents.join('/');

    // Skip VFS binary file
    if (path === '/.vfs' || path === '/.vfs.bin') continue;

    // Echo suppression: was this change caused by us?
    const pendingTs = pendingOps.get(path);
    if (pendingTs && Date.now() - pendingTs < ECHO_WINDOW_MS) {
      pendingOps.delete(path);
      continue; // our own write, ignore
    }

    // External change — sync into VFS
    switch (record.type) {
      case 'appeared':
      case 'modified':
        syncExternalChange(path, record.changedHandle);
        break;
      case 'disappeared':
        syncExternalDelete(path);
        break;
      case 'moved':
        syncExternalRename(
          '/' + record.relativePathMovedFrom!.join('/'),
          path
        );
        break;
    }
  }
});

// Watch mirror root recursively
const mirrorRoot = await navigator.storage.getDirectory();
await observer.observe(mirrorRoot, { recursive: true });
```

### Echo Suppression

When the sync worker writes to real OPFS, the `FileSystemObserver` fires for that change. We must not loop this back into the VFS. The worker tracks pending operations with timestamps:

```typescript
const pendingOps = new Map<string, number>(); // path → timestamp
const ECHO_WINDOW_MS = 500; // ignore observer events within this window of our own writes

// Before writing to OPFS:
pendingOps.set(path, Date.now());

// In observer callback:
const pendingTs = pendingOps.get(path);
if (pendingTs && Date.now() - pendingTs < ECHO_WINDOW_MS) {
  pendingOps.delete(path); // consumed — this was our write
  return; // ignore
}
// Otherwise: external change, sync to VFS
```

### Syncing External Changes to VFS

When an external change is detected (not caused by us), the sync worker reads the file from OPFS and sends it to the server worker:

```typescript
async function syncExternalChange(path: string, handle: FileSystemHandle | null): Promise<void> {
  if (!handle || handle.kind !== 'file') return;

  const fileHandle = handle as FileSystemFileHandle;
  const file = await fileHandle.getFile();
  const data = await file.arrayBuffer();

  // Send to server worker to update VFS binary
  serverPort.postMessage({
    op: 'external-write',
    path,
    data,
    ts: Date.now(),
  }, [data]);
}

async function syncExternalDelete(path: string): Promise<void> {
  serverPort.postMessage({
    op: 'external-delete',
    path,
    ts: Date.now(),
  });
}

async function syncExternalRename(oldPath: string, newPath: string): Promise<void> {
  serverPort.postMessage({
    op: 'external-rename',
    path: oldPath,
    newPath,
    ts: Date.now(),
  });
}
```

### Initial Sync on Startup

When the OPFS Sync Worker starts, it performs a full reconciliation between VFS and real OPFS:

```
1. Read all inodes from VFS (via server worker)
2. Walk real OPFS mirror directory tree
3. For each VFS file not in OPFS → write to OPFS
4. For each OPFS file not in VFS → read and add to VFS
5. For files in both → compare mtime, newer wins
6. Start FileSystemObserver after initial sync completes
```

This ensures consistency after restarts or when `opfsSync` is enabled on an existing VFS.

---

## 13. Initialization & Imports

### Import Style

Works like Node.js — import and use immediately:

```typescript
import fs from '@anthropic/vfs';
import { promises } from '@anthropic/vfs';
import promises from '@anthropic/vfs/promises';

// Works immediately — blocks until worker is ready
fs.writeFileSync('/hello.txt', 'Hello World!');
const data = fs.readFileSync('/hello.txt', 'utf8');
```

### Root Directory

By default the VFS uses the OPFS root (`/`). A configurable root allows multiple isolated projects to run side by side, each with their own VFS and OPFS subtree.

```typescript
// Via config
import { createFS } from '@anthropic/vfs';

const projectA = createFS({ root: '/projects/app-a' });
const projectB = createFS({ root: '/projects/app-b' });

// projectA sees "/" but it maps to OPFS "/projects/app-a/"
projectA.writeFileSync('/index.js', 'console.log("A")');
// actual OPFS path: /projects/app-a/index.js

// projectB is completely isolated
projectB.writeFileSync('/index.js', 'console.log("B")');
// actual OPFS path: /projects/app-b/index.js

// Via env variable (checked at module load)
// VFS_ROOT=/projects/my-app
import fs from '@anthropic/vfs'; // uses /projects/my-app as root
```

**Auto-creation:** The root path is created recursively on init if it doesn't exist. The worker walks the OPFS directory tree, calling `getDirectoryHandle(segment, { create: true })` for each path component:

```typescript
async function ensureRoot(rootPath: string): Promise<FileSystemDirectoryHandle> {
  let dir = await navigator.storage.getDirectory();
  if (rootPath === '/' || rootPath === '') return dir;

  const segments = rootPath.split('/').filter(Boolean);
  for (const segment of segments) {
    dir = await dir.getDirectoryHandle(segment, { create: true });
  }
  return dir;
}
```

**What the root affects:**
- VFS binary file is stored at `<root>/.vfs.bin`
- All file operations are relative to the root — `fs.readFileSync('/foo.txt')` reads `<root>/foo.txt`
- OPFS Sync Worker mirrors into the root subtree
- Server election lock is scoped to the root: `vfs-server:<root>` — so each root has its own independent server
- Tab liveness locks are also scoped: `vfs-tab:<root>:<tabId>`

**Default singleton** still works with no config — uses OPFS root, just like before:

```typescript
// No config needed — default root is "/"
import fs from '@anthropic/vfs';
fs.writeFileSync('/hello.txt', 'works');
```

### Inline Workers

All workers are inlined as blob URLs at build time — zero external files for users to manage:

```typescript
const SYNC_WORKER_CODE = `/* bundled at build time */`;
const ASYNC_WORKER_CODE = `/* bundled at build time */`;

function spawnInlineWorker(code: string): Worker {
  const blob = new Blob([code], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  return worker;
}
```

The **service worker** is the exception — browsers require a real URL. Solved via a build plugin that copies `sw.js` to the public root:

```typescript
// vite.config.ts — only required config
import { vfsPlugin } from '@anthropic/vfs/build';
export default { plugins: [vfsPlugin()] };
```

### Initialization: Block by Default

On module load, warmup starts immediately — SABs are allocated, workers are spawned. **Every fs method blocks until the worker is ready.** This is by design — the library primarily runs inside workers where blocking is fine.

```typescript
// Module top-level (runs on import)
const readySAB = new SharedArrayBuffer(4);
const readySignal = new Int32Array(readySAB, 0, 1);
// readySignal[0] = 0 (not ready)

// Spawn worker immediately, it does all async init internally
const worker = spawnInlineWorker(SYNC_WORKER_CODE);
worker.postMessage({ readySAB, operationSAB });

// Every sync method calls this first
function ensureReady(): void {
  if (Atomics.load(readySignal, 0) === 1) return; // fast path after init
  Atomics.wait(readySignal, 0, 0); // block until worker signals ready
}
```

Worker init sequence (all async, runs inside worker):

```
1. Receive readySAB + operationSAB
2. navigator.storage.getDirectory() → OPFS root
3. Open VFS file sync handle
4. Server election (BroadcastChannel + navigator.locks)
5. Establish MessageChannel to server (or become server)
6. Atomics.store(readySignal, 0, 1)  ← unblocks caller
7. Atomics.notify(readySignal, 0)
8. Enter Atomics.wait loop (ready for requests)
```

First call pays the init cost (~10-50ms block). All subsequent calls: single `Atomics.load` check.

### Optional `init()` Helper

For users who want to avoid blocking the main thread (e.g. running on the main thread of a UI app), an optional async `init()` is provided:

```typescript
import fs, { init } from '@anthropic/vfs';

// Option 1: Don't call init() — first fs call blocks until ready (default)
fs.readFileSync('/file.txt', 'utf8'); // blocks ~10-50ms on first call

// Option 2: Call init() to warm up without blocking
await init(); // warmup happens here, non-blocking
fs.readFileSync('/file.txt', 'utf8'); // instant, already ready
```

Implementation:

```typescript
// Exposed as a named export
const initPromise = new Promise<void>(resolve => {
  worker.addEventListener('message', (e) => {
    if (e.data.type === 'ready') resolve();
  }, { once: true });
});

export function init(): Promise<void> {
  return initPromise;
}
```

`init()` is purely optional. If not called, the first sync or async fs call simply blocks until ready. If called, it lets the caller await warmup at a convenient time.

Async methods (`fs.promises.*`) also block-or-wait internally — they `await initPromise` before proceeding:

```typescript
const promises = {
  async readFile(path: string, encoding?: string): Promise<string | Uint8Array> {
    await initPromise; // no-op if already resolved
    // ... normal async operation ...
  },
};
```

---

## 14. Implementation Phases

### Phase 0: Module Bootstrap & Inline Workers
- [ ] Inline worker bundling: sync relay + async preflight workers as blob URLs
- [ ] Service Worker: build plugin (Vite/webpack) to copy SW to public root
- [ ] Module top-level init: allocate SABs, spawn workers on import
- [ ] `ensureReady()`: `Atomics.wait` blocks until worker signals ready
- [ ] Optional `init()`: async helper that awaits warmup for users who want to avoid blocking
- [ ] Export surface: default export, named exports, `@anthropic/vfs/promises` subpath
- [ ] Configurable root directory: `createFS({ root })`, env variable `VFS_ROOT`, auto-create recursively
- [ ] Root-scoped locks: `vfs-server:<root>`, `vfs-tab:<root>:<tabId>` for multi-project isolation

### Phase 1: Single-Tab Foundation
- [ ] SAB layout and Atomics protocol between main thread and dedicated worker
- [ ] Server worker with open sync file handle (VFS binary)
- [ ] Basic read/write/delete over SAB
- [ ] Verify sync operations work end-to-end in a single tab

### Phase 2: Multi-Tab via Service Worker
- [ ] Service Worker registration and port transfer
- [ ] BroadcastChannel for tab discovery
- [ ] MessageChannel establishment between client worker and server worker
- [ ] Sync operations working across tabs

### Phase 3: Server Election & Failover
- [ ] `navigator.locks`-based server election
- [ ] Automatic failover when server tab closes
- [ ] New server re-opens file handles, rebuilds in-memory index, re-establishes ports
- [ ] Tab liveness detection via `navigator.locks` per tab
- [ ] `who-is-alive` broadcast on failover, tabs respond, server acquires liveness locks

### Phase 4: Async Preflight Worker
- [ ] Async worker per tab for encoding/decoding off main thread
- [ ] MessageChannel between async worker and sync worker
- [ ] Zero-copy transfer chain: main thread -> async worker -> sync worker -> server
- [ ] Promise-based async API on main thread

### Phase 5: VFS Binary Format
- [ ] Implement superblock, inode table, path table, free bitmap, data region
- [ ] Inode entries with full metadata: mtime, ctime, atime, mode, uid, gid, size, type
- [ ] Path table with append-only writes + compaction when dead space exceeds threshold
- [ ] In-memory `Map<path, inodeIndex>` rebuilt from inode table on startup/failover
- [ ] Write: allocate blocks, update inode (mtime, size), update free bitmap, flush
- [ ] Delete: free blocks in bitmap, mark inode as free, remove from path index
- [ ] Rename: append new path, update inode offset, update path index
- [ ] Readdir: scan path index for direct children of directory prefix
- [ ] Symlinks: type=3 inodes storing target path in data blocks, readlink, symlink creation
- [ ] Path resolution: follow symlink chains with MAX_SYMLINK_DEPTH=40 cycle detection
- [ ] lstat: return symlink inode itself without following
- [ ] Permissions: mode field with POSIX permission bits (rwx owner/group/other)
- [ ] Umask: configurable file creation mask (default 0o022)
- [ ] Chmod: update mode field on inode, update ctime
- [ ] Ownership: uid/gid fields on inodes, default 0/0 in browser
- [ ] Chown: update uid/gid fields, update ctime
- [ ] Access checks: optional strict mode enforcing permission bits against process identity
- [ ] Configurable process identity: { uid, gid, umask, strictPermissions }
- [ ] Growth strategy: expand data region via truncate, grow inode table when full
- [ ] Optional: separate virtual memory file for shared state

### Phase 6: OPFS Sync Worker (Optional Mirror)
- [ ] Spawn OPFS sync worker from server worker when `opfsSync: true`
- [ ] MessageChannel between server worker and OPFS sync worker
- [ ] Event queue: receive write/delete/mkdir/rename events from server, process sequentially
- [ ] Write to real OPFS: open sync handles, write file, flush, close per operation
- [ ] Delete from real OPFS: walk directory tree, remove entries
- [ ] FileSystemObserver: recursive watch on mirror root, exclude VFS binary
- [ ] Echo suppression: track pending ops with timestamps, ignore observer events within window
- [ ] External change detection: read changed file from OPFS, send to server for VFS update
- [ ] Initial sync on startup: reconcile VFS ↔ OPFS (compare mtimes, newer wins)
- [ ] Server worker: handle `external-write`, `external-delete`, `external-rename` messages

### Phase 7: Benchmark Suite
- [ ] Add new VFS implementation to existing benchmark page alongside LightningFS and current OPFS tiers
- [ ] Benchmark columns: LightningFS | OPFS v2 Tier 1 | OPFS v2 Tier 2 | VFS Sync | VFS Async
- [ ] Write benchmarks: 1KB × 1000, 10KB × 500, 100KB × 100, 1MB × 10
- [ ] Read benchmarks: same file sizes
- [ ] Mixed workload: interleaved read/write/stat/readdir
- [ ] Multi-tab benchmark: 2, 5, 10 tabs doing concurrent writes, measure throughput and latency
- [ ] Latency histogram: p50, p95, p99 for sync operations
- [ ] First-call latency: measure init/warmup blocking time
- [ ] OPFS sync worker overhead: benchmark with `opfsSync: true` vs `false`
- [ ] Streams benchmark: streaming read/write of large files (10MB, 100MB)
- [ ] Add VFS results to existing Playwright benchmark spec output table

### Phase 8: Performance & Hardening
- [ ] Benchmark sync latency (target: <0.1ms per operation)
- [ ] Benchmark throughput (target: >100MB/s for sequential reads)
- [ ] Stress test multi-tab scenarios (10+ tabs)
- [ ] Handle edge cases: rapid tab open/close, server crash during write
- [ ] OPFS sync worker stress test: rapid writes + external changes simultaneously
