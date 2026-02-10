# VFS Write Path — Step-by-Step Trace

Complete trace of `writeFileSync(path, data)` from API call to OPFS persistence.

## Flow Diagram

```
Main Thread                          Sync-Relay Worker                    VFS Engine
───────────                          ─────────────────                    ──────────
writeFileSync(path, data)
  │
  ├─ TextEncoder.encode(data)        [if string input]
  ├─ encodeRequest(OP.WRITE=2,
  │   path, flags=1, data)
  │   → 16B header + path + data     [1 alloc + 1 copy]
  │
  ├─ syncRequest(requestBuf):
  │   ├─ ensureReady()
  │   ├─ .set() into SAB[32+]       [1 copy of request]
  │   ├─ Atomics.store(ctrl[0], REQUEST=1)
  │   ├─ Atomics.notify(ctrl[0])
  │   └─ spinWait() ◀── BLOCKS ──┐
  │                               │  leaderLoop() wakes
  │                               │    │
  │                               │    ├─ readPayload() → .slice()    [1 copy from SAB]
  │                               │    ├─ handleRequest(buffer):
  │                               │    │   ├─ decodeRequest()          [views, no copy]
  │                               │    │   ├─ engine.write(path, data, flags):
  │                               │    │   │     │
  │                               │    │   │     ├─ normalizePath()                   pure string
  │                               │    │   │     ├─ ensureParent()                    Map lookup + cached inode
  │                               │    │   │     ├─ resolvePathComponents()            Map lookups
  │                               │    │   │     │
  │                               │    │   │     ├─ [NEW FILE] createInode():
  │                               │    │   │     │   ├─ findFreeInode()         ▸ handle.read(1B) per uncached slot
  │                               │    │   │     │   ├─ appendPath()            ▸ handle.write(path bytes)
  │                               │    │   │     │   │                          ▸ handle.write(4B superblock)
  │                               │    │   │     │   ├─ allocateBlocks()        ▸ handle.read(bitmap)
  │                               │    │   │     │   │                          ▸ handle.write(bitmap)
  │                               │    │   │     │   │                          ▸ handle.write(4B superblock)
  │                               │    │   │     │   ├─ writeData()             ▸ handle.write(data)
  │                               │    │   │     │   └─ writeInode()            ▸ handle.write(64B inode)
  │                               │    │   │     │
  │                               │    │   │     ├─ [EXISTING, fits in blocks]:
  │                               │    │   │     │   ├─ readInode()              cached → no I/O
  │                               │    │   │     │   ├─ writeData()             ▸ handle.write(data)
  │                               │    │   │     │   └─ writeInode()            ▸ handle.write(64B inode)
  │                               │    │   │     │
  │                               │    │   │     ├─ [EXISTING, needs more blocks]:
  │                               │    │   │     │   ├─ freeBlockRange()        ▸ handle.read(bitmap)
  │                               │    │   │     │   │                          ▸ handle.write(bitmap)
  │                               │    │   │     │   │                          ▸ handle.write(4B superblock)
  │                               │    │   │     │   ├─ allocateBlocks()        ▸ handle.read(bitmap)
  │                               │    │   │     │   │                          ▸ handle.write(bitmap)
  │                               │    │   │     │   │                          ▸ handle.write(4B superblock)
  │                               │    │   │     │   ├─ writeData()             ▸ handle.write(data)
  │                               │    │   │     │   └─ writeInode()            ▸ handle.write(64B inode)
  │                               │    │   │     │
  │                               │    │   │     └─ handle.flush()              ▸ sync to storage
  │                               │    │   │
  │                               │    │   └─ encodeResponse(status=0)          [8B alloc, no data copy]
  │                               │    │
  │                               │    ├─ writeResponse() → .set() into SAB     [1 copy of response]
  │                               │    ├─ Atomics.store(ctrl[0], RESPONSE=2)
  │                               │    └─ Atomics.notify(ctrl[0])
  │                               │
  │ ◀── WAKES ───────────────────┘
  ├─ .slice() from SAB                                                  [1 copy of response]
  ├─ decodeResponse()                                                   [views, no copy]
  ├─ Atomics.store(ctrl[0], IDLE=0)  [no notify]
  └─ return void
```

## OPFS I/O Operations Per Scenario

### New file (1KB data)
| # | Operation | Size | Description |
|---|-----------|------|-------------|
| 1 | `handle.read(1B)` | 1B × N | `findFreeInode()` — scan uncached inode slots |
| 2 | `handle.write()` | ~20B | `appendPath()` — write path string to path table |
| 3 | `handle.write()` | 4B | `appendPath()` — update superblock PATH_USED |
| 4 | `handle.read()` | bitmap | `allocateBlocks()` — read entire block bitmap |
| 5 | `handle.write()` | bitmap | `allocateBlocks()` — write updated bitmap |
| 6 | `handle.write()` | 4B | `updateSuperblockFreeBlocks()` |
| 7 | `handle.write()` | 1024B | `writeData()` — file data |
| 8 | `handle.write()` | 64B | `writeInode()` — inode metadata |
| 9 | `handle.flush()` | — | Sync all pending writes to storage |

**Total: 5-8 writes + 1-2 reads + 1 flush**

### Existing file, same size (overwrite 1KB)
| # | Operation | Size | Description |
|---|-----------|------|-------------|
| 1 | `handle.write()` | 1024B | `writeData()` — file data |
| 2 | `handle.write()` | 64B | `writeInode()` — update mtime |
| 3 | `handle.flush()` | — | Sync to storage |

**Total: 2 writes + 1 flush**

### Existing file, different size (resize + write)
| # | Operation | Size | Description |
|---|-----------|------|-------------|
| 1 | `handle.read()` | bitmap | `freeBlockRange()` — read bitmap |
| 2 | `handle.write()` | bitmap | `freeBlockRange()` — clear old blocks |
| 3 | `handle.write()` | 4B | `updateSuperblockFreeBlocks()` |
| 4 | `handle.read()` | bitmap | `allocateBlocks()` — read bitmap (again!) |
| 5 | `handle.write()` | bitmap | `allocateBlocks()` — mark new blocks |
| 6 | `handle.write()` | 4B | `updateSuperblockFreeBlocks()` |
| 7 | `handle.write()` | data | `writeData()` — file data |
| 8 | `handle.write()` | 64B | `writeInode()` — metadata |
| 9 | `handle.flush()` | — | Sync to storage |

**Total: 5 writes + 2 reads + 1 flush**

## Memory Copies

| Step | What | Size |
|------|------|------|
| `encodeRequest()` | Path UTF-8 + data → new ArrayBuffer | 16 + path + data |
| `syncRequest()` `.set()` | Request → SAB | request size |
| `readPayload()` `.slice()` | SAB → owned buffer | request size |
| `encodeResponse()` | Status → new ArrayBuffer | 8B (no data for writes) |
| `writeResponse()` `.set()` | Response → SAB | 8B |
| `syncRequest()` `.slice()` | SAB → owned buffer | 8B |

For writes, response is only 8 bytes (status + dataLen=0), so response path is negligible.
The main cost is the **request path**: data is copied 3 times (encode → SAB → slice).

## Key Observations

1. **`handle.flush()` is the dominant cost** — forces OPFS to sync all pending writes to the underlying storage.
2. **Bitmap I/O is redundant for resize** — `freeBlockRange()` reads the entire bitmap, writes it, then `allocateBlocks()` reads it again.
3. **`findFreeInode()` linear scan** — reads 1 byte per uncached inode slot until a free one is found.
4. **Each `handle.write()` is a separate OPFS call** — no batching. For a new file, that's 5-8 separate OPFS write calls before flush.

## Binary Formats

### Request (16B header + path + data)
```
Offset  Type    Field
0-3     u32     OP.WRITE (2)
4-7     u32     flags (1 = flush)
8-11    u32     pathLen
12-15   u32     dataLen
16+     bytes   path (UTF-8)
16+pLen bytes   data payload
```

### Response (8B header, no data for writes)
```
Offset  Type    Field
0-3     u32     status (0 = OK)
4-7     u32     dataLen (0)
```

### Inode (64B on disk)
```
Offset  Type    Field
0       u8      type (0=free, 1=file, 2=dir, 3=symlink)
1-3     u8×3    flags (reserved)
4-7     u32     pathOffset
8-9     u16     pathLength
10-11   u16     reserved
12-15   u32     mode
16-23   f64     size
24-27   u32     firstBlock
28-31   u32     blockCount
32-39   f64     mtime
40-47   f64     ctime
48-55   f64     atime
56-59   u32     uid
60-63   u32     gid
```

### SAB Layout (32B header)
```
Offset  Type     Field
0       i32      signal (0=IDLE, 1=REQUEST, 2=RESPONSE)
4       i32      opcode
8       i32      status
12      i32      chunkLen
16-23   u64      totalLen
24      i32      chunkIdx
28      i32      reserved
32+     bytes    payload data
```
