// stat implementation using OPFS

import { getVfsIndex, getVfsDirIndex, getMetadataFromVfs, isSymlinkInVfs, resolveSymlinkInVfs, normalizePath } from '../fs.vfs'
import { Stats, BigIntStats, createStats as createStatsClass, createENOENT } from '../classes'
import { S_IFREG, S_IFDIR, S_IFLNK } from '../constants'

export interface StatOptions {
    bigint?: boolean
}

// Common file extensions that indicate a path is likely a file, not a directory
// Used as a defensive check to prevent false positive directory detection
const FILE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|vue|svelte|json|css|scss|sass|less|html|htm|md|txt|xml|yaml|yml|toml|wasm|map|d\.ts)$/i

const createStats = (
    size: number,
    isDir: boolean,
    isSymlink: boolean = false,
    metadata?: { mode?: number; uid?: number; gid?: number; atimeMs?: number; mtimeMs?: number },
    bigint: boolean = false
): Stats | BigIntStats => {
    const now = Date.now()

    // Determine file type bits
    let typeBits: number
    if (isSymlink) {
        typeBits = S_IFLNK
    } else if (isDir) {
        typeBits = S_IFDIR
    } else {
        typeBits = S_IFREG
    }

    // Get permission bits (default 755 for dirs, 644 for files)
    const permBits = metadata?.mode !== undefined
        ? (metadata.mode & 0o7777)
        : (isDir ? 0o755 : 0o644)

    const mode = typeBits | permBits

    return createStatsClass(
        size,
        mode,
        metadata?.uid ?? 0,
        metadata?.gid ?? 0,
        metadata?.atimeMs ?? now,
        metadata?.mtimeMs ?? now,
        metadata?.mtimeMs ?? now,
        bigint
    )
}

// Async - gets file/directory stats from OPFS
export const stat = async (
    root: FileSystemDirectoryHandle,
    path: string,
    options?: StatOptions
): Promise<Stats | BigIntStats> => {
    const parts = path.split('/').filter(p => p.length > 0)
    const bigint = options?.bigint ?? false

    if (parts.length === 0) {
        // Root directory
        return createStats(0, true, false, undefined, bigint)
    }

    let currentDir = root

    // Try to navigate as directories first
    for (let i = 0; i < parts.length - 1; i++) {
        currentDir = await currentDir.getDirectoryHandle(parts[i])
    }

    const lastName = parts[parts.length - 1]

    // Try as file first
    try {
        const fileHandle = await currentDir.getFileHandle(lastName)
        const file = await fileHandle.getFile()
        return createStats(file.size, false, false, {
            mtimeMs: file.lastModified,
            atimeMs: file.lastModified,
        }, bigint)
    } catch {
        // Try as directory
        try {
            await currentDir.getDirectoryHandle(lastName)
            return createStats(0, true, false, undefined, bigint)
        } catch {
            throw createENOENT('stat', path)
        }
    }
}

// Sync - gets file stats from VFS index
export const statSync = (path: string, options?: StatOptions): Stats | BigIntStats => {
    const vfsIndex = getVfsIndex()
    const vfsDirIndex = getVfsDirIndex()
    let normalizedPath = normalizePath(path)
    const bigint = options?.bigint ?? false

    // Root directory (empty string, or "." which represents current dir)
    if (normalizedPath === '' || normalizedPath === '.') {
        return createStats(0, true, false, undefined, bigint)
    }

    // For stat, follow symlinks to get target's stats
    if (isSymlinkInVfs(normalizedPath)) {
        normalizedPath = resolveSymlinkInVfs(normalizedPath)
    }

    // Get metadata if available
    const metadata = getMetadataFromVfs(normalizedPath)

    // Check if it's a file
    const entry = vfsIndex.get(normalizedPath)
    if (entry) {
        return createStats(entry.size, false, false, metadata ?? undefined, bigint)
    }

    // Check if it's an explicit empty directory
    if (vfsDirIndex.has(normalizedPath)) {
        return createStats(0, true, false, metadata ?? undefined, bigint)
    }

    // Check if it's an implicit directory (any file starts with this path)
    // Skip this check for paths that look like files (have common file extensions)
    // This prevents false positives from VFS state inconsistencies
    const looksLikeFile = FILE_EXTENSIONS.test(normalizedPath)

    if (!looksLikeFile) {
        const prefix = `${normalizedPath}/`
        for (const filePath of vfsIndex.keys()) {
            if (filePath.startsWith(prefix)) {
                return createStats(0, true, false, metadata ?? undefined, bigint)
            }
        }

        // Check if any explicit dir starts with this path
        for (const dirPath of vfsDirIndex) {
            if (dirPath.startsWith(prefix)) {
                return createStats(0, true, false, metadata ?? undefined, bigint)
            }
        }
    }

    throw createENOENT('stat', path)
}

// lstat returns symlink info instead of following the symlink
export const lstat = async (
    root: FileSystemDirectoryHandle,
    path: string,
    options?: StatOptions
): Promise<Stats | BigIntStats> => {
    // For OPFS, lstat is same as stat since OPFS doesn't have real symlinks
    // But we check VFS for emulated symlinks
    return stat(root, path, options)
}

export const lstatSync = (path: string, options?: StatOptions): Stats | BigIntStats => {
    const vfsIndex = getVfsIndex()
    const vfsDirIndex = getVfsDirIndex()
    const normalizedPath = normalizePath(path)
    const bigint = options?.bigint ?? false

    // Check if it's a symlink - for lstat we don't follow it
    const isSymlink = isSymlinkInVfs(normalizedPath)
    const metadata = getMetadataFromVfs(normalizedPath)

    if (isSymlink) {
        // Return symlink stats
        return createStats(0, false, true, metadata ?? undefined, bigint)
    }

    // Otherwise same as stat
    return statSync(path, options)
}
