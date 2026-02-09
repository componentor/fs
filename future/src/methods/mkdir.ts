// mkdir implementation using OPFS

import { queueEvent, createDirInVfs, isDirectoryInVfs, normalizePath, saveIndex } from '../fs.vfs'
import { createENOENT } from '../classes'

// Async - creates directory in OPFS
export const mkdir = async (
    root: FileSystemDirectoryHandle,
    path: string,
    options?: { recursive?: boolean }
): Promise<void> => {
    const normalizedPath = normalizePath(path)
    const parts = normalizedPath.split('/').filter(p => p.length > 0)
    let currentDir = root

    if (options?.recursive) {
        // Create all directories in path
        let currentPath = ''
        for (const part of parts) {
            currentPath = currentPath ? `${currentPath}/${part}` : part
            // Only queue create if directory doesn't already exist
            if (!isDirectoryInVfs(currentPath)) {
                queueEvent('create', currentPath)
            }
            currentDir = await currentDir.getDirectoryHandle(part, { create: true })
        }
    } else {
        // Non-recursive: only queue if directory doesn't exist
        if (!isDirectoryInVfs(normalizedPath)) {
            queueEvent('create', normalizedPath)
        }
        // Create only the final directory (parent must exist)
        for (let i = 0; i < parts.length - 1; i++) {
            currentDir = await currentDir.getDirectoryHandle(parts[i])
        }
        await currentDir.getDirectoryHandle(parts[parts.length - 1], { create: true })
    }
}

// Sync - creates directory entry in VFS
export const mkdirSync = (
    path: string,
    options?: { recursive?: boolean }
): void => {
    // Debug: log all dist directory creation
    if (path.includes('/dist')) {
        console.log(`[mkdirSync] Creating dist directory: ${path} (recursive: ${options?.recursive})`)
    }
    const normalizedPath = normalizePath(path)

    if (options?.recursive) {
        // Create all directories in path - batch saves for performance
        const parts = normalizedPath.split('/').filter(p => p.length > 0)
        let currentPath = ''
        for (let i = 0; i < parts.length; i++) {
            currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]
            // Only queue create if directory doesn't already exist
            // This prevents queueing creates for parent dirs in recursive mkdir
            if (!isDirectoryInVfs(currentPath)) {
                queueEvent('create', currentPath)
            }
            // Defer save until last directory
            createDirInVfs(currentPath, i < parts.length - 1)
        }
        // Ensure index is saved after all directories created
        if (parts.length > 0) {
            saveIndex()
        }
    } else {
        // Check parent exists
        const parts = normalizedPath.split('/')
        if (parts.length > 1) {
            const parentPath = parts.slice(0, -1).join('/')
            if (!isDirectoryInVfs(parentPath)) {
                throw createENOENT('mkdir', path)
            }
        }
        // Only queue create if directory doesn't already exist
        if (!isDirectoryInVfs(normalizedPath)) {
            queueEvent('create', normalizedPath)
        }
        createDirInVfs(normalizedPath)
    }
}
