// VFS Module Index - Re-exports all VFS functionality

// Types
export type { EventType, PendingEvent, FileMetadata, WatchListener, FileSystemSyncAccessHandle, FileSystemChangeRecord, FileSystemObserver, VfsFileEntry } from './types'

// State & Getters
export { setSharedArrayBuffer, getSharedArrayBuffer, getRoot, getVfsHandle, defaultFileMetadata, defaultDirMetadata, isFireAndForgetMode, setFireAndForgetMode, enterFireAndForgetMode, exitFireAndForgetMode, isDeferredFlushMode, enterDeferredFlushMode, exitDeferredFlushMode } from './state'

// Events
export { queueEvent, consumeEvent, readEventsFromSAB, writeEventsToSAB, clearEventsSAB, validateAndClearCorruptedEventsSAB, isEventQueuingDisabled, enableEventQueuing, disableEventQueuing, eventSabMetrics, resetEventMetrics, incrementExternalEvents, clearEventCounters, getPendingCount, getTotalPending, dumpEventQueue, getPendingPaths, checkPathDumpRequest, requestPendingPathsAsync } from './events'

// Index Operations
export { loadIndex, saveIndex, flushIndex, isIndexDirty, indexSaveMetrics } from './index-ops'

// File Operations
export { readFromVfs, readFileFromVfs, readChunkFromVfs, getFileSizeFromVfs, writeToVfs, writeFileToVfs, existsInVfs, deleteFromVfs, getVfsIndex } from './files'

// Directory Operations
export { isDirectoryInVfs, createDirInVfs, deleteDirFromVfs, getVfsDirIndex } from './dirs'

// Symlink Operations
export { createSymlinkInVfs, readSymlinkFromVfs, isSymlinkInVfs, deleteSymlinkFromVfs, resolveSymlinkInVfs, getVfsSymlinkIndex } from './symlinks'

// Metadata Operations
export { getMetadataFromVfs, setMetadataInVfs, chmodInVfs, chownInVfs, utimesInVfs, getVfsMetadataIndex } from './metadata'

// Watch Operations
export { addWatchListener, removeWatchListener, notifyWatchListeners } from './watch'

// Compact Operations
export { compactSync, compact, maybeScheduleCompaction, scheduleCompaction, getCompactionStatus } from './compact'

// Sync Operations
export type { SyncProgressCallback, SyncResult } from './sync'
export { syncFileToVfs, removeFileFromVfs, syncVfsToOpfs, syncOpfsToVfs } from './sync'

// OPFS Background Sync Queue (VFS -> OPFS in hybrid mode)
export type { OpfsSyncType } from './opfs-sync-queue'
export { queueOpfsSync, flushOpfsSync, getOpfsSyncStatus, clearOpfsSyncQueue, terminateOpfsSyncWorker, opfsSyncMetrics } from './opfs-sync-queue'

// Traverse Operations
export { traverseVfs, traverseOpfs } from './traverse'

// Import Operations
export { importToVfs, importToOpfs } from './import'

// Init & Lifecycle
export { init, teardown, unwatchOpfs } from './init'

// Path Utilities
export { normalizePath, isRootPath, getParentPath, getBasename, joinPath } from './path'
