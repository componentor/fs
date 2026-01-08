# Performance Analysis

## Benchmark Results

Benchmarked against [LightningFS](https://github.com/isomorphic-git/lightning-fs) using 100 iterations in interleaved mode.

### Summary

| Mode | Average Time | vs LightningFS |
|------|-------------|----------------|
| Main Thread | ~175ms | ~1.0x |
| Worker Only | ~145ms | 1.19x faster |
| **Hybrid** | **~144ms** | **1.20x faster** |
| LightningFS | ~173ms | baseline |

### Operation Breakdown

| Operation | LightningFS | OPFS-FS (Hybrid) | Speedup |
|-----------|-------------|------------------|---------|
| Batch Writes | 25.57ms | 1.73ms | **14.8x faster** |
| Batch Reads | 12.64ms | 1.56ms | **8.1x faster** |
| Single Writes | 66.45ms | 71.37ms | ~1x |
| Single Reads | 66.76ms | 66.93ms | ~1x |
| Symlinks | 1.42ms | 2.71ms | ~0.5x |
| **Total** | **172.85ms** | **144.30ms** | **1.20x faster** |

### Key Findings

1. **Batch operations are the big win** - OPFS-FS is 14.8x faster for batch writes and 8.1x faster for batch reads due to the packed storage format that reduces OPFS API calls.

2. **Single file operations are comparable** - For individual read/write operations, both libraries perform similarly.

3. **Hybrid mode is recommended** - Routing reads to main thread and writes to worker provides the best overall performance with low variance.

4. **Symlinks have overhead** - LightningFS is slightly faster for symlink operations, but both are fast enough for practical use.

## Mode Comparison

### Main Thread
- Uses sync access handles when available
- Can block the UI for heavy operations
- High variance in benchmarks due to UI thread contention

### Worker Only
- All operations run in a dedicated worker
- Message passing overhead for every operation
- Good for offloading work from main thread

### Hybrid (Recommended)
- Reads on main thread (no message passing overhead)
- Writes on worker (sync access handles are faster)
- Best of both worlds with lowest variance

## Configuration Options

### Maximum Performance

```javascript
const fs = new OPFS({
  useCompression: false,  // Skip compression overhead
  useChecksum: false      // Skip CRC32 calculation
})
```

### Maximum Safety

```javascript
const fs = new OPFS({
  useCompression: false,  // Compression is opt-in
  useChecksum: true       // Verify data integrity (default)
})
```

### Storage Efficiency

```javascript
const fs = new OPFS({
  useCompression: true,   // Compress text-heavy data
  useChecksum: true       // Verify data integrity
})
```

## When to Use OPFS-FS

- **Git operations** - Batch read/write of many small files
- **Offline-first apps** - Fast local storage for web apps
- **Code editors** - Quick file access with symlink support
- **Data processing** - Efficient batch I/O operations

## When LightningFS Might Be Better

- **Simple IndexedDB needs** - If you just need basic storage
- **Legacy browser support** - OPFS requires modern browsers
- **No batch operations** - If you only do single file operations
