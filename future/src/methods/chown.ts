// chown implementation using VFS metadata

import { queueEvent, chownInVfs, existsInVfs, isDirectoryInVfs, normalizePath } from '../fs.vfs'
import { createENOENT } from '../classes'

// Async - sets file owner in VFS metadata
export const chown = async (
    _root: FileSystemDirectoryHandle,
    path: string,
    uid: number,
    gid: number
): Promise<void> => {
    queueEvent('update', path)
    const normalizedPath = normalizePath(path)
    if (!existsInVfs(normalizedPath) && !isDirectoryInVfs(normalizedPath)) {
        throw createENOENT('chown', path)
    }
    chownInVfs(normalizedPath, uid, gid)
}

// Sync - sets file owner in VFS metadata
export const chownSync = (
    path: string,
    uid: number,
    gid: number
): void => {
    queueEvent('update', path)
    const normalizedPath = normalizePath(path)
    if (!existsInVfs(normalizedPath) && !isDirectoryInVfs(normalizedPath)) {
        throw createENOENT('chown', path)
    }
    chownInVfs(normalizedPath, uid, gid)
}
