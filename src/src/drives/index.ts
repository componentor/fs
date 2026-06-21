/**
 * Multi-drive abstraction — public entry. Additive; the existing single-OPFS
 * `VFSFileSystem` API is unchanged. See DESIGN.md.
 *
 * @experimental The `Drive` surface and `DriveManager` are stable enough to build
 * against, but the drive set may grow. Pin a version if you depend on it.
 */
export * from './types.js'
export { DriveManager, type DriveEvent } from './manager.js'

// Block-backed disks
export { MemoryDrive } from './memory-drive.js'
export { TreeDrive, type TreeNode, type FileNode, type DirNode } from './tree-drive.js'
export { LocalStorageDrive } from './localstorage-drive.js'
export { IndexedDbDrive } from './indexeddb-drive.js'
export { VfsDrive } from './vfs-drive.js'

// Native-tree disks
export { LocalFolderDrive, localFolderSupported, pickDirectory, loadHandle, dropHandle } from './localfolder-drive.js'
export { CloudDrive, type CloudProvider, type CloudDriveOptions } from './cloud-drive.js'

// Sync engine
export { SyncEngine, type SyncDirection, type SyncOptions, type SyncResult } from './sync-engine.js'
