// VFS File Operations

import { vfsIndex, vfsDirIndex, vfsMetadataIndex, vfsSyncHandle, addWastedBytes, isDeferredFlushMode, defaultFileMetadata } from './state'
import { saveIndex } from './index-ops'
import { maybeScheduleCompaction } from './compact'
import { queueOpfsSync } from './opfs-sync-queue'
import { normalizePath, isRootPath } from './path'
import { isSymlinkInVfs, resolveSymlinkInVfs } from './symlinks'

// Read file from VFS (sync) - returns raw bytes
export const readFromVfs = (path: string): Uint8Array | null => {
    let normalizedPath = normalizePath(path)

    // Resolve symlinks to get actual file path
    if (isSymlinkInVfs(normalizedPath)) {
        normalizedPath = resolveSymlinkInVfs(normalizedPath)
    }
    const entry = vfsIndex.get(normalizedPath)
    if (!entry || !vfsSyncHandle) return null

    // Validate entry before creating typed array
    if (typeof entry.size !== 'number' || entry.size < 0 || !Number.isFinite(entry.size)) {
        console.error('[VFS] Invalid entry size:', entry.size, 'for path:', normalizedPath)
        return null
    }
    if (typeof entry.offset !== 'number' || entry.offset < 0 || !Number.isFinite(entry.offset)) {
        console.error('[VFS] Invalid entry offset:', entry.offset, 'for path:', normalizedPath)
        return null
    }

    try {
        const buffer = new Uint8Array(entry.size)
        vfsSyncHandle.read(buffer, { at: entry.offset })
        return buffer
    } catch (err) {
        console.error('[VFS] Error reading file:', normalizedPath, 'size:', entry.size, 'offset:', entry.offset, err)
        throw err
    }
}

// Read a chunk of a file from VFS (sync) - for large file streaming
export const readChunkFromVfs = (path: string, start: number, length: number): Uint8Array | null => {
    let normalizedPath = normalizePath(path)

    // Resolve symlinks to get actual file path
    if (isSymlinkInVfs(normalizedPath)) {
        normalizedPath = resolveSymlinkInVfs(normalizedPath)
    }

    const entry = vfsIndex.get(normalizedPath)
    if (!entry || !vfsSyncHandle) return null

    // Clamp to file bounds
    const actualStart = Math.min(start, entry.size)
    const actualLength = Math.min(length, entry.size - actualStart)
    if (actualLength <= 0) return new Uint8Array(0)

    const buffer = new Uint8Array(actualLength)
    vfsSyncHandle.read(buffer, { at: entry.offset + actualStart })
    return buffer
}

// Get file size from VFS without reading content
export const getFileSizeFromVfs = (path: string): number | null => {
    let normalizedPath = normalizePath(path)

    // Resolve symlinks to get actual file path
    if (isSymlinkInVfs(normalizedPath)) {
        normalizedPath = resolveSymlinkInVfs(normalizedPath)
    }

    const entry = vfsIndex.get(normalizedPath)
    if (!entry) return null
    return entry.size
}

// Read file from VFS (sync) - with encoding options
export const readFileFromVfs = (path: string, options?: { encoding?: BufferEncoding } | BufferEncoding): string | Buffer | null => {
    const buffer = readFromVfs(path)
    if (!buffer) return null

    const encoding = typeof options === 'string' ? options : options?.encoding
    if (encoding) {
        return new TextDecoder(encoding).decode(buffer)
    }
    return Buffer.from(buffer)
}

// Write file to VFS (sync) - accepts raw bytes
export const writeToVfs = (path: string, data: Uint8Array) => {
    if (!vfsSyncHandle) {
        console.error(`[writeToVfs] SKIPPED - vfsSyncHandle is null! path: ${path}`)
        return
    }

    const normalizedPath = normalizePath(path)
    const existingEntry = vfsIndex.get(normalizedPath)

    if (existingEntry && existingEntry.size === data.length) {
        // Same size - overwrite in place
        vfsSyncHandle.write(data, { at: existingEntry.offset })
    } else {
        if (existingEntry) {
            addWastedBytes(existingEntry.size)
        }
        // Append after current data
        const offset = vfsSyncHandle.getSize()
        vfsSyncHandle.write(data, { at: offset })
        vfsIndex.set(normalizedPath, { offset, size: data.length })
        saveIndex()

        // Schedule compaction if needed (debounced, runs during idle time)
        maybeScheduleCompaction()
    }

    // Update mtime for 100% safe external change detection
    // When observer fires, syncFileToVfs compares OPFS mtime vs VFS mtime
    // If VFS mtime is newer, sync is skipped (prevents stale OPFS overwriting newer VFS)
    const now = Date.now()
    const existingMetadata = vfsMetadataIndex.get(normalizedPath) || defaultFileMetadata()
    vfsMetadataIndex.set(normalizedPath, { ...existingMetadata, mtime: now })

    // Flush unless in deferred flush mode (for bulk operations)
    if (!isDeferredFlushMode()) {
        vfsSyncHandle.flush()
    }

    // Queue background sync to OPFS (hybrid mode only)
    queueOpfsSync('write', normalizedPath)
}

// Write file to VFS (sync) - accepts string or Buffer
export const writeFileToVfs = (path: string, data: string | Buffer) => {
    const content = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data ?? new ArrayBuffer(0))
    writeToVfs(path, content)
}

// Check if file exists in VFS (sync)
export const existsInVfs = (path: string): boolean => {
    // Root and current directory always exist
    if (isRootPath(path)) return true

    const normalizedPath = normalizePath(path)
    if (normalizedPath === '') return true

    // Check if it's a symlink
    if (isSymlinkInVfs(normalizedPath)) return true

    // Check if it's a file
    if (vfsIndex.has(normalizedPath)) return true

    // Check if it's an explicit directory
    if (vfsDirIndex.has(normalizedPath)) return true

    // Check if it's an implicit directory (any file starts with this path)
    const prefix = `${normalizedPath}/`
    for (const filePath of vfsIndex.keys()) {
        if (filePath.startsWith(prefix)) {
            return true
        }
    }

    // Check if any explicit dir starts with this path
    for (const dirPath of vfsDirIndex) {
        if (dirPath.startsWith(prefix)) {
            return true
        }
    }

    return false
}

// Delete file from VFS (sync)
export const deleteFromVfs = (path: string) => {
    const normalizedPath = normalizePath(path)
    const entry = vfsIndex.get(normalizedPath)
    if (entry) {
        addWastedBytes(entry.size)
        vfsIndex.delete(normalizedPath)
        saveIndex()

        // Schedule compaction if needed (debounced, runs during idle time)
        maybeScheduleCompaction()

        // Queue background sync to OPFS (hybrid mode only)
        queueOpfsSync('delete', normalizedPath)
    }
}

// Get VFS file index (for readdir, etc.)
export const getVfsIndex = () => vfsIndex
