// access implementation using OPFS

import { existsInVfs, isDirectoryInVfs, normalizePath } from '../fs.vfs'
import { createENOENT } from '../classes'

// Access constants (matching Node.js fs.constants)
export const constants = {
    F_OK: 0,  // File exists
    R_OK: 4,  // File is readable
    W_OK: 2,  // File is writable
    X_OK: 1,  // File is executable
}

// Async - checks if file/directory is accessible in OPFS
export const access = async (
    root: FileSystemDirectoryHandle,
    path: string,
    mode: number = constants.F_OK
): Promise<void> => {
    const parts = path.split('/').filter(p => p.length > 0)

    if (parts.length === 0) {
        // Root always exists
        return
    }

    let currentDir = root
    for (let i = 0; i < parts.length - 1; i++) {
        try {
            currentDir = await currentDir.getDirectoryHandle(parts[i])
        } catch {
            throw createENOENT('access', path)
        }
    }

    const name = parts[parts.length - 1]

    // Try as file first, then as directory
    try {
        await currentDir.getFileHandle(name)
        return
    } catch {
        try {
            await currentDir.getDirectoryHandle(name)
            return
        } catch {
            throw createENOENT('access', path)
        }
    }
}

// Sync - checks if file/directory exists in VFS
export const accessSync = (
    path: string,
    mode: number = constants.F_OK
): void => {
    const normalizedPath = normalizePath(path)

    if (normalizedPath === '') return

    if (!existsInVfs(normalizedPath) && !isDirectoryInVfs(normalizedPath)) {
        throw createENOENT('access', path)
    }
}
