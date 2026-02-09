// VFS Symlink Operations

import { vfsSymlinkIndex, vfsMetadataIndex } from './state'
import { saveIndex } from './index-ops'
import { normalizePath, getParentPath, joinPath } from './path'

// Create symlink in VFS
export const createSymlinkInVfs = (linkPath: string, targetPath: string) => {
    const normalizedLink = normalizePath(linkPath)
    vfsSymlinkIndex.set(normalizedLink, targetPath)
    // Set metadata for symlink (mode 0o120777 = symlink)
    vfsMetadataIndex.set(normalizedLink, {
        mode: 0o120777,
        uid: 0,
        gid: 0,
        mtime: Date.now(),
        atime: Date.now(),
    })
    saveIndex()
}

// Read symlink target from VFS
export const readSymlinkFromVfs = (linkPath: string): string | null => {
    const normalizedLink = normalizePath(linkPath)
    return vfsSymlinkIndex.get(normalizedLink) || null
}

// Check if path is a symlink in VFS
export const isSymlinkInVfs = (path: string): boolean => {
    const normalizedPath = normalizePath(path)
    return vfsSymlinkIndex.has(normalizedPath)
}

// Delete symlink from VFS
export const deleteSymlinkFromVfs = (linkPath: string) => {
    const normalizedLink = normalizePath(linkPath)
    vfsSymlinkIndex.delete(normalizedLink)
    vfsMetadataIndex.delete(normalizedLink)
    saveIndex()
}

// Resolve symlink (follow the chain)
export const resolveSymlinkInVfs = (path: string, maxDepth: number = 40): string => {
    let currentPath = normalizePath(path)
    let depth = 0

    while (vfsSymlinkIndex.has(currentPath) && depth < maxDepth) {
        const target = vfsSymlinkIndex.get(currentPath)!
        // Handle relative vs absolute targets
        if (target.startsWith('/')) {
            currentPath = normalizePath(target)
        } else {
            // Relative to parent directory
            const parentDir = getParentPath(currentPath)
            currentPath = joinPath(parentDir, target)
        }
        depth++
    }

    if (depth >= maxDepth) {
        throw new Error(`ELOOP: too many levels of symbolic links, '${path}'`)
    }

    return currentPath
}

// Get VFS symlink index
export const getVfsSymlinkIndex = () => vfsSymlinkIndex
