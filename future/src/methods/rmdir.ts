// rmdir implementation using OPFS

import { queueEvent, deleteDirFromVfs, deleteFromVfs, getVfsIndex, getVfsDirIndex, normalizePath, isDirectoryInVfs } from '../fs.vfs'
import { FSError } from '../classes'

// Async - removes directory from OPFS
export const rmdir = async (
    root: FileSystemDirectoryHandle,
    path: string,
    options?: { recursive?: boolean }
): Promise<void> => {
    queueEvent('delete', path)
    const parts = path.split('/').filter(p => p.length > 0)
    let currentDir = root

    // Navigate to parent directory
    for (let i = 0; i < parts.length - 1; i++) {
        currentDir = await currentDir.getDirectoryHandle(parts[i])
    }

    const dirName = parts[parts.length - 1]
    await currentDir.removeEntry(dirName, { recursive: options?.recursive })
}

// Sync - removes directory from VFS
export const rmdirSync = (
    path: string,
    options?: { recursive?: boolean }
): void => {
    const normalizedPath = normalizePath(path)

    // Only queue delete if directory exists
    if (isDirectoryInVfs(normalizedPath)) {
        queueEvent('delete', normalizedPath)
    }
    const vfsIndex = getVfsIndex()
    const vfsDirIndex = getVfsDirIndex()
    const prefix = `${normalizedPath}/`

    // Check for files in directory
    const filesInDir: string[] = []
    for (const filePath of vfsIndex.keys()) {
        if (filePath.startsWith(prefix)) {
            filesInDir.push(filePath)
        }
    }

    // Check for subdirectories
    const subDirs: string[] = []
    for (const dirPath of vfsDirIndex) {
        if (dirPath.startsWith(prefix)) {
            subDirs.push(dirPath)
        }
    }

    if (!options?.recursive && (filesInDir.length > 0 || subDirs.length > 0)) {
        throw new FSError('ENOTEMPTY', 'rmdir', path)
    }

    if (options?.recursive) {
        // Delete all files in directory
        for (const filePath of filesInDir) {
            queueEvent('delete', filePath)
            deleteFromVfs(filePath)
        }
        // Delete all subdirectories
        for (const dirPath of subDirs) {
            queueEvent('delete', dirPath)
            deleteDirFromVfs(dirPath)
        }
    }

    // Delete the directory itself
    deleteDirFromVfs(normalizedPath)
}
