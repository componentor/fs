// symlink implementation using VFS symlink support
// Note: Symlinks are VFS-only (emulated), so we don't queue events - observer will never report them

import { createSymlinkInVfs, normalizePath } from '../fs.vfs'

// Async - creates symlink in OPFS (emulated via metadata, target stored in VFS)
export const symlink = async (
    _root: FileSystemDirectoryHandle,
    target: string,
    path: string,
    _type?: string
): Promise<void> => {
    // No queueEvent - symlinks are VFS-only, observer will never report them
    const normalizedPath = normalizePath(path)
    createSymlinkInVfs(normalizedPath, target)
}

// Sync - creates symlink in VFS
export const symlinkSync = (
    target: string,
    path: string,
    _type?: string
): void => {
    // No queueEvent - symlinks are VFS-only, observer will never report them
    const normalizedPath = normalizePath(path)
    createSymlinkInVfs(normalizedPath, target)
}
