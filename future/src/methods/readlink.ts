// readlink implementation using VFS symlink support

import { readSymlinkFromVfs, isSymlinkInVfs, normalizePath } from '../fs.vfs'

// Async - reads symlink target
export const readlink = async (
    _root: FileSystemDirectoryHandle,
    path: string
): Promise<string> => {
    const normalizedPath = normalizePath(path)
    const target = readSymlinkFromVfs(normalizedPath)

    if (target === null) {
        throw new Error(`EINVAL: invalid argument, readlink '${path}'`)
    }

    return target
}

// Sync - reads symlink target from VFS
export const readlinkSync = (
    path: string
): string => {
    const normalizedPath = normalizePath(path)
    const target = readSymlinkFromVfs(normalizedPath)

    if (target === null) {
        throw new Error(`EINVAL: invalid argument, readlink '${path}'`)
    }

    return target
}
