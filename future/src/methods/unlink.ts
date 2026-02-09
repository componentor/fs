// unlink implementation using OPFS

import { queueEvent, deleteFromVfs, existsInVfs } from '../fs.vfs'

// Async - removes file from OPFS
export const unlink = async (
    root: FileSystemDirectoryHandle,
    path: string
): Promise<void> => {
    queueEvent('delete', path)

    // Handle nested paths
    const parts = path.split('/')
    let currentDir = root

    for (let i = 0; i < parts.length - 1; i++) {
        currentDir = await currentDir.getDirectoryHandle(parts[i])
    }

    const fileName = parts[parts.length - 1]
    await currentDir.removeEntry(fileName)
}

// Sync - removes file from VFS
export const unlinkSync = (path: string): void => {
    // Only queue delete if file exists
    if (existsInVfs(path)) {
        queueEvent('delete', path)
    }
    deleteFromVfs(path)
}
