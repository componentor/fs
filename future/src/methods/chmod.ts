// chmod implementation using VFS metadata

import { queueEvent, chmodInVfs, existsInVfs, isDirectoryInVfs, normalizePath } from '../fs.vfs'
import { createENOENT } from '../classes'

// Async - sets file mode in VFS metadata
export const chmod = async (
    _root: FileSystemDirectoryHandle,
    path: string,
    mode: number
): Promise<void> => {
    queueEvent('update', path)
    const normalizedPath = normalizePath(path)
    if (!existsInVfs(normalizedPath) && !isDirectoryInVfs(normalizedPath)) {
        throw createENOENT('chmod', path)
    }
    chmodInVfs(normalizedPath, mode)
}

// Sync - sets file mode in VFS metadata
export const chmodSync = (
    path: string,
    mode: number
): void => {
    queueEvent('update', path)
    const normalizedPath = normalizePath(path)
    if (!existsInVfs(normalizedPath) && !isDirectoryInVfs(normalizedPath)) {
        throw createENOENT('chmod', path)
    }
    chmodInVfs(normalizedPath, mode)
}
