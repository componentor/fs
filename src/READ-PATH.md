# VFS Read Path — Step-by-Step Trace

Complete trace of `readFileSync(path)` from API call to returning data.

## Flow Diagram

```
Main Thread                          Sync-Relay Worker                    VFS Engine
───────────                          ─────────────────                    ──────────
readFileSync(path, opts?)
  │
  ├─ encodeRequest(OP.READ=1, path)
  │   → 16B header + path            [1 alloc, small]
  │
  ├─ syncRequest(requestBuf):
  │   ├─ ensureReady()
  │   ├─ .set() into SAB[32+]       [1 copy of request, small]
  │   ├─ Atomics.store(ctrl[0], REQUEST=1)
  │   ├─ Atomics.notify(ctrl[0])
  │   └─ spinWait() ◀── BLOCKS ──┐
  │                               │  leaderLoop() wakes
  │                               │    │
  │                               │    ├─ readPayload() → .slice()    [1 copy from SAB, small]
  │                               │    ├─ handleRequest(buffer):
  │                               │    │   ├─ decodeRequest()          [views, no copy]
  │                               │    │   ├─ engine.read(path):
  │                               │    │   │     │
  │                               │    │   │     ├─ normalizePath()                   pure string
  │                               │    │   │     ├─ resolvePathComponents()            Map lookups
  │                               │    │   │     │   └─ pathIndex.get()       O(1)
  │                               │    │   │     │   └─ readInode()           cached → no I/O
  │                               │    │   │     ├─ readInode(idx)            cached → no I/O
  │                               │    │   │     └─ readData():
  │                               │    │   │         ├─ new Uint8Array(size)  [1 alloc = file size]
  │                               │    │   │         └─ handle.read(buf)      ▸ 1 OPFS read
  │                               │    │   │
  │                               │    │   └─ encodeResponse(0, data):
  │                               │    │       ├─ new ArrayBuffer(8+size)     [1 alloc]
  │                               │    │       └─ .set(data, 8)              [1 COPY of file data ⚠️]
  │                               │    │
  │                               │    ├─ writeResponse() → .set() into SAB  [1 COPY of file data ⚠️]
  │                               │    ├─ Atomics.store(ctrl[0], RESPONSE=2)
  │                               │    └─ Atomics.notify(ctrl[0])
  │                               │
  │ ◀── WAKES ───────────────────┘
  ├─ .slice() from SAB                                                 [1 COPY of file data ⚠️]
  ├─ decodeResponse()                                                  [view into buffer, no copy]
  ├─ Atomics.store(ctrl[0], IDLE=0)
  │
  ├─ [if encoding='utf8'] TextDecoder.decode(data)                     [1 alloc for string]
  └─ return Uint8Array | string
```

## OPFS I/O Operations

### Small file read (1KB)
| # | Operation | Size | Description |
|---|-----------|------|-------------|
| 1 | (none) | — | `resolvePathComponents()` — O(1) Map + cached inode |
| 2 | (none) | — | `readInode()` — served from inodeCache |
| 3 | `handle.read()` | 1024B | `readData()` — read file data from OPFS |

**Total: 1 OPFS read** — this is why small reads are 6x faster than LightningFS.

### Large file read (1MB)
| # | Operation | Size | Description |
|---|-----------|------|-------------|
| 1 | `handle.read()` | 1MB | `readData()` — read file data from OPFS |

**Total: 1 OPFS read** — same as small files, just more data.

### Uncached inode read
| # | Operation | Size | Description |
|---|-----------|------|-------------|
| 1 | `handle.read()` | 64B | `readInode()` — read inode from disk (first access only) |
| 2 | `handle.read()` | data size | `readData()` — read file data |

**Total: 2 OPFS reads** — only on first access before inode is cached.

## Memory Copies — The Real Cost

### 1KB file (single SAB chunk)
```
readData()        → 1KB alloc + handle.read (no copy, read directly)
encodeResponse()  → 1KB copy  (data → response buffer)     ⚠️
writeResponse()   → 1KB copy  (response → SAB)             ⚠️
.slice() from SAB → 1KB copy  (SAB → owned buffer)         ⚠️

Total: 3 copies of file data
```

### 1MB file (single SAB chunk, assuming SAB > 1MB)
```
readData()        → 1MB alloc + handle.read (no copy)
encodeResponse()  → 1MB copy                               ⚠️ EXPENSIVE
writeResponse()   → 1MB copy                               ⚠️ EXPENSIVE
.slice() from SAB → 1MB copy                               ⚠️ EXPENSIVE

Total: 3 copies × 1MB = 3MB of memory traffic
```

### 5MB file (multi-chunk, SAB = 2MB)
```
readData()        → 5MB alloc + handle.read (no copy)
encodeResponse()  → 5MB copy into intermediate buffer      ⚠️
writeResponse()   → Chunk 1: 2MB copy into SAB
                  → Chunk 2: 2MB copy into SAB
                  → Chunk 3: 1MB copy into SAB             ⚠️ 3 chunk copies
.slice() per chunk → 2MB + 2MB + 1MB                       ⚠️ 3 more copies

Total: ~15MB of memory traffic for a 5MB file
```

## Optimization Opportunities

### 1. Eliminate `encodeResponse()` intermediate buffer
Currently: `readData()` → 1MB alloc → `encodeResponse()` copies into NEW 1MB+8B buffer → `writeResponse()` copies into SAB.

Better: Write 8-byte header to SAB first, then copy file data directly from `readData()` buffer to SAB at offset 40 (32 header + 8 response header). Saves 1 full copy of file data.

### 2. Direct-to-SAB reads for leader mode
Instead of `readData()` allocating a buffer and `handle.read()` filling it, read directly into SAB:
```
// Current: 2 copies
const data = readData(firstBlock, blockCount, size);  // alloc + OPFS read
encodeResponse(0, data);                               // copy into new buffer
writeResponse(sab, ctrl, responseBytes);               // copy into SAB

// Optimized: 0 extra copies
// Write response header to SAB[32..40]
// handle.read(new Uint8Array(sab, 40, size), { at: offset });  // read directly to SAB
```

This eliminates ALL data copies for reads — data goes from OPFS directly to SAB.
**Limitation:** Only works for single-chunk responses (file size < SAB - 40 bytes).

### 3. Cache bitmap in memory
`allocateBlocks()` reads the entire bitmap from OPFS every time. Keeping it in memory would eliminate bitmap I/O entirely (useful for writes, not reads).

## Binary Formats

### Request (16B header + path, no data)
```
Offset  Type    Field
0-3     u32     OP.READ (1)
4-7     u32     flags (0)
8-11    u32     pathLen
12-15   u32     dataLen (0)
16+     bytes   path (UTF-8)
```

### Response (8B header + file data)
```
Offset  Type    Field
0-3     u32     status (0 = OK)
4-7     u32     dataLen (file size)
8+      bytes   file contents
```

## Key Observations

1. **OPFS read is fast** — 1 call for any file size. The VFS binary layout stores file data contiguously.
2. **Inode cache eliminates metadata I/O** — after first access, `readInode()` is O(1) from Map.
3. **3 data copies dominate large file reads** — `encodeResponse` and `writeResponse` each copy the entire file.
4. **SAB chunk size matters** — default 2MB SAB means files > ~2MB need multi-chunk transfer with additional copies.
5. **`decodeResponse()` is zero-copy** — creates a Uint8Array view into the existing buffer, not a copy.
