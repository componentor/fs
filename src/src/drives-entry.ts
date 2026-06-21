/**
 * `@componentor/fs/drives` — the ENGINE-FREE drive layer. Identical to the
 * drives exported from the root entry EXCEPT it omits `VfsDrive` (which wraps the
 * VFS engine and would pull the whole `filesystem.ts` graph into a consumer's
 * bundle). Host apps that bring their own OPFS layer (e.g. a kernel) import the
 * portable drives from here to keep their bundle lean; import `VfsDrive` from the
 * root `@componentor/fs` when you actually want to wrap the engine.
 */
export * from './drives/types.js'
export { DriveManager, type DriveEvent } from './drives/manager.js'

// Block-backed disks (no engine dependency)
export { MemoryDrive } from './drives/memory-drive.js'
export { TreeDrive, type TreeNode, type FileNode, type DirNode } from './drives/tree-drive.js'
export { LocalStorageDrive } from './drives/localstorage-drive.js'
export { IndexedDbDrive } from './drives/indexeddb-drive.js'

// Native-tree disks
export { LocalFolderDrive, localFolderSupported, pickDirectory, loadHandle, dropHandle } from './drives/localfolder-drive.js'
export { CloudDrive, type CloudProvider, type CloudDriveOptions } from './drives/cloud-drive.js'

// Sync engine
export { SyncEngine, type SyncDirection, type SyncOptions, type SyncResult } from './drives/sync-engine.js'
