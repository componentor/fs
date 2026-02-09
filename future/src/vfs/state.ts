// VFS Shared State

import type { FileMetadata, FileSystemSyncAccessHandle, FileSystemObserver, WatchListener, VfsFileEntry } from './types'
import { VFS } from '../app-constants'

// Constants (re-exported from centralized constants)
export const VFS_FILENAME = VFS.FILENAME
export const INDEX_HEADER_SIZE = VFS.INDEX_HEADER_SIZE
export const COMPACTION_THRESHOLD = VFS.COMPACTION_THRESHOLD
export const COMPACTION_URGENT_THRESHOLD = VFS.COMPACTION_URGENT_THRESHOLD
export const COMPACTION_DEBOUNCE_MS = VFS.COMPACTION_DEBOUNCE_MS
export const COMPACTION_IDLE_TIMEOUT_MS = VFS.COMPACTION_IDLE_TIMEOUT_MS

// Global state
export let root: FileSystemDirectoryHandle | null = null
export let vfsFileHandle: FileSystemFileHandle | null = null
export let vfsSyncHandle: FileSystemSyncAccessHandle | null = null
export let observer: FileSystemObserver | null = null
export let sharedArrayBuffer: SharedArrayBuffer | null = null
export let wastedBytes = 0

// Fire-and-forget mode counter (replaces boolean flag for proper nesting)
// When > 0, VFS writes should NOT trigger OPFS sync (because OPFS already has the data)
// This is incremented/decremented by the sync worker when processing fire-and-forget requests
// Using a counter instead of boolean handles nested/reentrant calls correctly
let fireAndForgetDepth = 0
export const isFireAndForgetMode = () => fireAndForgetDepth > 0
export const enterFireAndForgetMode = () => { fireAndForgetDepth++ }
export const exitFireAndForgetMode = () => { fireAndForgetDepth = Math.max(0, fireAndForgetDepth - 1) }
// Legacy API for compatibility - setFireAndForgetMode(true) increments, false decrements
export const setFireAndForgetMode = (value: boolean) => { value ? fireAndForgetDepth++ : fireAndForgetDepth = Math.max(0, fireAndForgetDepth - 1) }

// Deferred flush mode - when enabled, flushes are batched for performance
// This trades durability for speed - data may be lost on crash
let deferredFlushMode = false
let deferredFlushTimer: ReturnType<typeof setTimeout> | null = null
const DEFERRED_FLUSH_INTERVAL_MS = VFS.DEFERRED_FLUSH_INTERVAL_MS

export const isDeferredFlushMode = () => deferredFlushMode

export const enterDeferredFlushMode = () => {
    if (deferredFlushMode) return
    deferredFlushMode = true

    // Start periodic flush timer
    const scheduleFlush = () => {
        deferredFlushTimer = setTimeout(() => {
            if (deferredFlushMode && vfsSyncHandle) {
                vfsSyncHandle.flush()
            }
            if (deferredFlushMode) {
                scheduleFlush()
            }
        }, DEFERRED_FLUSH_INTERVAL_MS)
    }
    scheduleFlush()
}

export const exitDeferredFlushMode = () => {
    if (!deferredFlushMode) return
    deferredFlushMode = false

    // Clear timer and do final flush
    if (deferredFlushTimer) {
        clearTimeout(deferredFlushTimer)
        deferredFlushTimer = null
    }
    if (vfsSyncHandle) {
        vfsSyncHandle.flush()
    }
}

// Compaction scheduling state
let compactionScheduled = false
let compactionDebounceTimer: ReturnType<typeof setTimeout> | null = null
let compactionIdleCallback: number | null = null

// Compaction metrics
export const compactionMetrics = {
    totalCompactions: 0,
    scheduledCompactions: 0,
    urgentCompactions: 0,
    totalBytesReclaimed: 0,
    lastCompactionTime: 0,
    lastCompactionDuration: 0,
}

// Setters for state
export const setRoot = (r: FileSystemDirectoryHandle | null) => { root = r }
export const setVfsFileHandle = (h: FileSystemFileHandle | null) => { vfsFileHandle = h }
export const setVfsSyncHandle = (h: FileSystemSyncAccessHandle | null) => { vfsSyncHandle = h }
export const setObserver = (o: FileSystemObserver | null) => { observer = o }
export const setSharedArrayBuffer = (sab: SharedArrayBuffer) => { sharedArrayBuffer = sab }
export const getSharedArrayBuffer = () => sharedArrayBuffer
export const addWastedBytes = (bytes: number) => { wastedBytes += bytes }
export const resetWastedBytes = () => { wastedBytes = 0 }
export const getWastedBytes = () => wastedBytes

// Compaction scheduling helpers
export const isCompactionScheduled = () => compactionScheduled
export const setCompactionScheduled = (scheduled: boolean) => { compactionScheduled = scheduled }

export const clearCompactionTimers = () => {
    if (compactionDebounceTimer) {
        clearTimeout(compactionDebounceTimer)
        compactionDebounceTimer = null
    }
    if (compactionIdleCallback !== null && typeof cancelIdleCallback !== 'undefined') {
        cancelIdleCallback(compactionIdleCallback)
        compactionIdleCallback = null
    }
}

export const setCompactionDebounceTimer = (timer: ReturnType<typeof setTimeout>) => {
    compactionDebounceTimer = timer
}

export const setCompactionIdleCallback = (id: number) => {
    compactionIdleCallback = id
}

// VFS Indexes
export const vfsIndex = new Map<string, VfsFileEntry>()
export const vfsDirIndex = new Set<string>()
export const vfsSymlinkIndex = new Map<string, string>()
export const vfsMetadataIndex = new Map<string, FileMetadata>()
export const watchListeners = new Map<string, Set<WatchListener>>()

// Getters for handles and root
export const getRoot = () => root
export const getVfsHandle = () => vfsSyncHandle

// Default metadata factories
export const defaultFileMetadata = (): FileMetadata => ({
    mode: 0o644,
    uid: 0,
    gid: 0,
    mtime: Date.now(),
    atime: Date.now(),
})

export const defaultDirMetadata = (): FileMetadata => ({
    mode: 0o755,
    uid: 0,
    gid: 0,
    mtime: Date.now(),
    atime: Date.now(),
})
