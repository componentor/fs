// rm implementation using OPFS (recursive delete)

import { queueEvent, deleteFromVfs, getVfsIndex, getVfsDirIndex, deleteDirFromVfs, normalizePath, getVfsSymlinkIndex, deleteSymlinkFromVfs } from '../fs.vfs'
import { createENOENT, FSError } from '../classes'

// Async - removes file or directory recursively from OPFS
export const rm = async (
    root: FileSystemDirectoryHandle,
    path: string,
    options?: { recursive?: boolean; force?: boolean }
): Promise<void> => {
    const parts = path.split('/').filter(p => p.length > 0)

    if (parts.length === 0) {
        throw new Error('EPERM: operation not permitted, rm')
    }

    let currentDir = root

    // Navigate to parent directory
    for (let i = 0; i < parts.length - 1; i++) {
        try {
            currentDir = await currentDir.getDirectoryHandle(parts[i])
        } catch (err) {
            if (options?.force) return
            throw err
        }
    }

    const name = parts[parts.length - 1]

    try {
        queueEvent('delete', path)
        await currentDir.removeEntry(name, { recursive: options?.recursive })
    } catch (err) {
        if (options?.force) return
        throw err
    }
}

// Sync - removes file or directory recursively from VFS
export const rmSync = (
    path: string,
    options?: { recursive?: boolean; force?: boolean }
): void => {
    const vfsIndex = getVfsIndex()
    const vfsDirIndex = getVfsDirIndex()
    const normalizedPath = normalizePath(path)

    // Check if it's a direct file
    if (vfsIndex.has(normalizedPath)) {
        queueEvent('delete', normalizedPath)
        deleteFromVfs(normalizedPath)
        return
    }

    // Check for directory (files with this prefix or explicit dir entry)
    const prefix = `${normalizedPath}/`
    const filesToDelete: string[] = []
    const dirsToDelete: string[] = []
    const symlinksToDelete: string[] = []

    // Find files to delete
    for (const filePath of vfsIndex.keys()) {
        if (filePath.startsWith(prefix)) {
            filesToDelete.push(filePath)
        }
    }

    // Find explicit directories to delete (including the target dir and subdirs)
    if (vfsDirIndex.has(normalizedPath)) {
        dirsToDelete.push(normalizedPath)
    }
    for (const dirPath of vfsDirIndex) {
        if (dirPath.startsWith(prefix)) {
            dirsToDelete.push(dirPath)
        }
    }

    // Find symlinks to delete
    const vfsSymlinkIndex = getVfsSymlinkIndex()
    for (const symlinkPath of vfsSymlinkIndex.keys()) {
        if (symlinkPath === normalizedPath || symlinkPath.startsWith(prefix)) {
            symlinksToDelete.push(symlinkPath)
        }
    }

    // Check if anything exists to delete
    if (filesToDelete.length === 0 && dirsToDelete.length === 0 && symlinksToDelete.length === 0) {
        if (options?.force) return
        throw createENOENT('rm', path)
    }

    // If there are files/subdirs, require recursive option
    if (!options?.recursive && (filesToDelete.length > 0 || dirsToDelete.length > 1 || symlinksToDelete.length > 0)) {
        throw new FSError('EISDIR', 'rm', path)
    }

    // Delete all files with this prefix
    for (const filePath of filesToDelete) {
        queueEvent('delete', filePath)
        deleteFromVfs(filePath)
    }

    // Delete all symlinks with this prefix
    for (const symlinkPath of symlinksToDelete) {
        queueEvent('delete', symlinkPath)
        deleteSymlinkFromVfs(symlinkPath)
    }

    // Delete all explicit directory entries
    for (const dirPath of dirsToDelete) {
        queueEvent('delete', dirPath)
        deleteDirFromVfs(dirPath)
    }
}
