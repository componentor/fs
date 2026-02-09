// VFS Directory Operations

import { vfsIndex, vfsDirIndex } from './state'
import { saveIndex } from './index-ops'
import { queueOpfsSync } from './opfs-sync-queue'
import { normalizePath, isRootPath } from './path'

// Common file extensions that indicate a path is likely a file, not a directory
// Used as a defensive check to prevent false positive directory detection
const FILE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|vue|svelte|json|css|scss|sass|less|html|htm|md|txt|xml|yaml|yml|toml|wasm|map|d\.ts)$/i

// Check if path is a directory in VFS
export const isDirectoryInVfs = (path: string): boolean => {
    // Root and current directory always exist
    if (isRootPath(path)) return true

    const normalizedPath = normalizePath(path)
    if (!normalizedPath) return true // Empty = root

    // Explicit directory - O(1) lookup
    if (vfsDirIndex.has(normalizedPath)) return true

    // Check if it's actually a file (not a directory)
    if (vfsIndex.has(normalizedPath)) return false

    // Skip implicit directory check for paths that look like files
    // This prevents false positives from VFS state inconsistencies
    if (FILE_EXTENSIONS.test(normalizedPath)) return false

    // Implicit directory check - check if any file/dir has this as parent
    // Exit early on first match for better average case
    const prefix = `${normalizedPath}/`

    for (const filePath of vfsIndex.keys()) {
        if (filePath.startsWith(prefix)) return true
    }

    for (const dirPath of vfsDirIndex) {
        if (dirPath.startsWith(prefix)) return true
    }

    return false
}

// Create directory in VFS (sync) - with optional save deferral for batching
export const createDirInVfs = (path: string, deferSave = false) => {
    if (!path) return
    const normalizedPath = normalizePath(path)
    if (!normalizedPath) return

    vfsDirIndex.add(normalizedPath)

    if (!deferSave) {
        saveIndex()
    }

    // Queue background sync to OPFS (hybrid mode only)
    queueOpfsSync('mkdir', normalizedPath)
}

// Delete directory from VFS (sync)
export const deleteDirFromVfs = (path: string) => {
    const normalizedPath = normalizePath(path)
    vfsDirIndex.delete(normalizedPath)
    saveIndex()

    // Queue background sync to OPFS (hybrid mode only)
    queueOpfsSync('rmdir', normalizedPath)
}

// Get VFS directory index
export const getVfsDirIndex = () => vfsDirIndex
