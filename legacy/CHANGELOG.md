# Changelog

All notable changes to this project will be documented in this file.

## [1.2.8] - 2025-12-24

### Changed
- File locking only for shared resources (pack file, symlink file) - no locking overhead for regular file operations

## [1.2.7] - 2025-12-24

### Changed
- Optimized file lock for uncontended case (no Promise creation when lock is free)
- Faster pack file operations with reduced locking overhead

## [1.2.6] - 2025-12-24

### Fixed
- Fixed concurrent access error within same context (e.g., concurrent batch writes)
- Added simple in-memory file lock for sync access handle serialization
- Fast locking (no Web Locks overhead) that only serializes access to the same file

### Added
- 4 new concurrent access tests (218 total tests)

## [1.2.5] - 2025-12-21

### Fixed
- Removed double locking in packed-storage.ts for better performance
- Fixed missing try/finally for access.close() in index.ts to prevent resource leaks

## [1.2.4] - 2025-12-20

### Fixed
- Fixed concurrent access error "Access Handles cannot be created if there is another open Access Handle"
- Added FileLockManager to prevent concurrent sync access handle creation
- Added try/finally blocks to ensure sync access handles are always closed

### Added
- `useCompression` option (default: `false`) - Enable gzip compression for batch writes
- `useChecksum` option (default: `true`) - Enable CRC32 checksum verification
- PERFORMANCE.md with detailed benchmark comparisons
- 15 new compression tests (214 total tests)

### Changed
- Updated performance comparison to use real LightningFS benchmarks
- Removed `gc()` mention from README (not needed for typical use)

## [1.2.3] - 2025-12-20

### Changed
- Renamed package from `@componentor/opfs-fs` to `@componentor/fs`
- Updated repository URLs to github.com/componentor/fs

## [1.2.0] - 2025-12-19

### Added
- Hybrid mode for optimal performance (reads on main thread, writes on worker)
- Batch read/write operations with packed storage format
- CRC32 checksum for data integrity verification

### Performance
- 1.20x faster than LightningFS in hybrid mode
- 14.8x faster batch writes
- 8.1x faster batch reads
