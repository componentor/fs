/**
 * Centralized Constants
 *
 * All configurable constants in one place for easy tuning and discovery.
 * Import from here rather than defining locally.
 */

// =============================================================================
// SHARED ARRAY BUFFER SIZES
// =============================================================================

export const SAB_SIZES = {
    /** 64MB - FS sync requests (large file operations) */
    FS_SYNC: 64 * 1024 * 1024,

    /** 256KB - FS event notifications */
    FS_EVENTS: 256 * 1024,

    /** 32MB - Exec worker sync communication */
    EXEC_SYNC: 32 * 1024 * 1024,

    /** 128MB - Rolldown bundler communication (vue-tsc + typescript can exceed 22MB) */
    BUNDLER: 128 * 1024 * 1024,
} as const

// =============================================================================
// TIMEOUTS
// =============================================================================

export const TIMEOUTS = {
    /** 60s - Worker initialization (WASM compilation can take 15-30s for large modules) */
    WORKER_INIT: 60_000,

    /** 600s - Script execution (WASM under V8 Liftoff can be 10-100x slower than native) */
    EXECUTION: 600_000,

    /** 60s - Bundle operation */
    BUNDLE: 60_000,

    /** 30s - Worker idle before termination */
    WORKER_IDLE: 30_000,

    /** 2s - Auto-scaling check interval */
    SCALE_CHECK: 2_000,

    /** 50ms - Execution polling interval */
    EXEC_POLL: 50,
} as const

// =============================================================================
// FILE CHUNKING
// =============================================================================

export const CHUNK_SIZES = {
    /** 60MB - Threshold for chunked file reads (SAB is 64MB, leave room for overhead) */
    FILE_THRESHOLD: 60 * 1024 * 1024,

    /** 50MB - Size per chunk when reading large files */
    FILE_CHUNK: 50 * 1024 * 1024,

    /** 1MB - Stream chunk size */
    STREAM: 1024 * 1024,
} as const

// =============================================================================
// WORKER POOL
// =============================================================================

export const WORKER_POOL = {
    /** Minimum workers to keep warm */
    MIN_WORKERS: 1,

    /** Maximum workers (defaults to CPU count) */
    MAX_WORKERS: typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 4) : 4,

    /** Queue depth to trigger immediate scale up */
    SCALE_UP_THRESHOLD: 3,
} as const

// =============================================================================
// VFS (Virtual File System)
// =============================================================================

export const VFS = {
    /** Binary file that stores all VFS data */
    FILENAME: '.vfs-future.bin',

    /** Header size in bytes for index */
    INDEX_HEADER_SIZE: 4,

    /** 1MB - Schedule compaction when wasted bytes exceed this */
    COMPACTION_THRESHOLD: 1024 * 1024,

    /** 5MB - Immediate compaction when wasted bytes exceed this */
    COMPACTION_URGENT_THRESHOLD: 5 * 1024 * 1024,

    /** 500ms - Wait after last write before compacting */
    COMPACTION_DEBOUNCE_MS: 500,

    /** 2s - Max wait for idle callback before forcing compaction */
    COMPACTION_IDLE_TIMEOUT_MS: 2_000,

    /** 100ms - Flush interval when in deferred mode */
    DEFERRED_FLUSH_INTERVAL_MS: 100,
} as const

// =============================================================================
// SAB PROTOCOL OFFSETS (Shared by multiple workers)
// =============================================================================

export const SAB_OFFSETS = {
    /** Byte offset for status flag */
    STATUS: 0,

    /** Byte offset for data length */
    LENGTH: 4,

    /** Byte offset for request/response type (FS only) */
    TYPE: 8,

    /** Byte offset where data payload starts (FS) */
    DATA_FS: 9,

    /** Byte offset where data payload starts (Exec/Bundler) */
    DATA_SIMPLE: 8,

    /**
     * Byte offset for FS SAB lock (last 4 bytes of SAB).
     * Prevents race conditions when multiple threads (exec worker + primary tab)
     * share the same SAB for sync FS operations.
     * Value: 0 = unlocked, 1 = locked. Uses Atomics.compareExchange for CAS.
     */
    FS_LOCK: SAB_SIZES.FS_SYNC - 4,
} as const

// =============================================================================
// SAB STATUS VALUES
// =============================================================================

export const SAB_STATUS = {
    IDLE: 0,
    REQUEST: 1,
    RESPONSE: 2,
    ERROR: 3,
    OUTPUT: 4, // For streaming terminal output
} as const

// =============================================================================
// SAB REQUEST/RESPONSE TYPES (FS protocol)
// =============================================================================

export const SAB_TYPE = {
    REQUEST_JSON: 0,
    REQUEST_BINARY_ARG: 1,
    RESPONSE_JSON: 0,
    RESPONSE_BINARY: 1,
} as const

// =============================================================================
// LOCK NAMES
// =============================================================================

export const LOCKS = {
    /** Web Lock for primary tab election */
    FS_PRIMARY: 'fs_primary_lock',
} as const

// =============================================================================
// DEBUG MODE
// =============================================================================

export const DEBUG_KEY = 'NODECONTAINER_DEBUG'

/**
 * Check if debug mode is enabled
 */
export function isDebugEnabled(): boolean {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(DEBUG_KEY) === 'true'
}
