// utimes implementation using VFS metadata

import { queueEvent, utimesInVfs, existsInVfs, isDirectoryInVfs, normalizePath } from '../fs.vfs'
import { createENOENT } from '../classes'

const toTimestamp = (time: number | string | Date): number => {
    if (typeof time === 'number') return time
    if (typeof time === 'string') return new Date(time).getTime()
    return time.getTime()
}

// Async - sets file access/modification times in VFS metadata
export const utimes = async (
    _root: FileSystemDirectoryHandle,
    path: string,
    atime: number | string | Date,
    mtime: number | string | Date
): Promise<void> => {
    queueEvent('update', path)
    const normalizedPath = normalizePath(path)
    if (!existsInVfs(normalizedPath) && !isDirectoryInVfs(normalizedPath)) {
        throw createENOENT('utimes', path)
    }
    utimesInVfs(normalizedPath, toTimestamp(atime), toTimestamp(mtime))
}

// Sync - sets file access/modification times in VFS metadata
export const utimesSync = (
    path: string,
    atime: number | string | Date,
    mtime: number | string | Date
): void => {
    queueEvent('update', path)
    const normalizedPath = normalizePath(path)
    if (!existsInVfs(normalizedPath) && !isDirectoryInVfs(normalizedPath)) {
        throw createENOENT('utimes', path)
    }
    utimesInVfs(normalizedPath, toTimestamp(atime), toTimestamp(mtime))
}
