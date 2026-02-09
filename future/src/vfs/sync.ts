// VFS Sync Operations - OPFS <-> VFS synchronization

import { vfsIndex, vfsDirIndex, vfsSymlinkIndex, vfsMetadataIndex, vfsSyncHandle, root, VFS_FILENAME, INDEX_HEADER_SIZE, addWastedBytes, resetWastedBytes, defaultFileMetadata } from './state'
import { saveIndex } from './index-ops'
import { maybeScheduleCompaction } from './compact'
import { normalizePath } from './path'

// Progress callback type
export type SyncProgressCallback = (info: {
    phase: 'scanning' | 'deleting' | 'reading' | 'writing'
    current: number
    total: number
    filename?: string
}) => void

// Result of sync attempt - used for metrics and logging
export type SyncResult = 'synced' | 'skipped_vfs_newer' | 'skipped_directory' | 'error'

// Inline async readFile to avoid circular dependency
// Handles nested paths like "folder/subfolder/file.txt"
// Returns both content and mtime for safe sync comparison
// Returns null if path is a directory (not a file)
const readFileFromOpfs = async (opfsRoot: FileSystemDirectoryHandle, path: string): Promise<{ content: Buffer; mtime: number } | null> => {
    const parts = path.split('/').filter(p => p.length > 0)
    if (parts.length === 0) throw new Error('Invalid path')

    // Navigate to parent directory
    let currentDir = opfsRoot
    for (let i = 0; i < parts.length - 1; i++) {
        currentDir = await currentDir.getDirectoryHandle(parts[i])
    }

    // Get file from final directory
    const fileName = parts[parts.length - 1]
    try {
        const fileHandle = await currentDir.getFileHandle(fileName)
        const file = await fileHandle.getFile()
        const buffer = await file.arrayBuffer()
        return {
            content: Buffer.from(buffer),
            mtime: file.lastModified
        }
    } catch (err) {
        // TypeMismatchError means the path exists but is a directory, not a file
        if ((err as Error).name === 'TypeMismatchError') {
            return null
        }
        throw err
    }
}

// Ensure parent directories exist in VFS dir index
const ensureParentDirs = (path: string) => {
    const parts = path.split('/').filter(p => p.length > 0)
    // Build parent paths and add to dir index
    for (let i = 1; i < parts.length; i++) {
        const dirPath = parts.slice(0, i).join('/')
        vfsDirIndex.add(dirPath)
    }
}

// Sync a file from OPFS to VFS binary
// Returns SyncResult indicating what happened
// IMPORTANT: This function is 100% safe - it will NEVER overwrite newer VFS data with stale OPFS data
// by comparing mtimes before writing. This protects against race conditions where:
// - VFS has version N+1, but OPFS sync queue hasn't caught up yet (still at N)
// - Observer fires for version N
// - Without mtime check, we'd overwrite N+1 with N (data loss!)
export const syncFileToVfs = async (path: string): Promise<SyncResult> => {
    if (!root || !vfsSyncHandle) return 'error'

    // Normalize path for VFS storage (removes leading/trailing slashes)
    const normalizedPath = normalizePath(path)

    // Read OPFS file with its mtime (returns null if path is a directory)
    const fileData = await readFileFromOpfs(root, path)
    if (fileData === null) {
        // Path is a directory, not a file - just ensure it's tracked in VFS
        vfsDirIndex.add(normalizedPath)
        return 'skipped_directory'
    }

    const { content, mtime: opfsMtime } = fileData

    // Check VFS mtime - if VFS is newer, don't overwrite (VFS is authoritative)
    const vfsMetadata = vfsMetadataIndex.get(normalizedPath)
    if (vfsMetadata && vfsMetadata.mtime > opfsMtime) {
        // VFS has newer data than OPFS - this is an internal change that hasn't synced to OPFS yet
        // Skip to avoid overwriting newer VFS data with stale OPFS data
        return 'skipped_vfs_newer'
    }

    // Ensure parent directories are tracked
    ensureParentDirs(normalizedPath)

    const existingEntry = vfsIndex.get(normalizedPath)

    if (existingEntry && existingEntry.size === content.length) {
        // Same size - overwrite in place
        vfsSyncHandle.write(content, { at: existingEntry.offset })
    } else {
        if (existingEntry) {
            // Mark old space as wasted
            addWastedBytes(existingEntry.size)
        }
        // Append to end
        const offset = vfsSyncHandle.getSize()
        vfsSyncHandle.write(content, { at: offset })
        vfsIndex.set(normalizedPath, { offset, size: content.length })
        saveIndex()

        // Schedule compaction if needed (debounced, runs during idle time)
        maybeScheduleCompaction()
    }

    // Update VFS metadata with OPFS mtime
    const existingMetadata = vfsMetadataIndex.get(normalizedPath) || defaultFileMetadata()
    vfsMetadataIndex.set(normalizedPath, { ...existingMetadata, mtime: opfsMtime })

    vfsSyncHandle.flush()
    return 'synced'
}

// Remove a file from VFS index (data remains until compaction)
export const removeFileFromVfs = (path: string) => {
    const normalizedPath = normalizePath(path)
    const entry = vfsIndex.get(normalizedPath)
    if (entry) {
        addWastedBytes(entry.size)
        vfsIndex.delete(normalizedPath)
        saveIndex()

        // Schedule compaction if needed (debounced, runs during idle time)
        maybeScheduleCompaction()
    }
}

// Hydration: Extract all files from VFS binary to OPFS
// Removes existing OPFS files first (except .vfs.bin)
export const syncVfsToOpfs = async (onProgress?: SyncProgressCallback) => {
    if (!root || !vfsSyncHandle) throw new Error('VFS not initialized')

    // Collect entries to delete first (for progress tracking)
    const entriesToDelete: string[] = []
    for await (const [name] of (root as any).entries()) {
        if (name !== VFS_FILENAME) {
            entriesToDelete.push(name)
        }
    }

    // Delete existing files in OPFS (except .vfs.bin)
    for (let i = 0; i < entriesToDelete.length; i++) {
        const name = entriesToDelete[i]
        onProgress?.({ phase: 'deleting', current: i + 1, total: entriesToDelete.length, filename: name })
        await root.removeEntry(name, { recursive: true })
    }

    // Extract all files from VFS to OPFS
    const entries = Array.from(vfsIndex.entries())
    const directories = Array.from(vfsDirIndex)
    const total = entries.length + directories.length

    for (let i = 0; i < entries.length; i++) {
        const [path, { offset, size }] = entries[i]
        onProgress?.({ phase: 'writing', current: i + 1, total, filename: path })

        const buffer = new Uint8Array(size)
        vfsSyncHandle.read(buffer, { at: offset })

        // Handle nested paths by creating directories
        const parts = path.split('/')
        let currentDir = root

        for (let j = 0; j < parts.length - 1; j++) {
            currentDir = await currentDir.getDirectoryHandle(parts[j], { create: true })
        }

        const fileName = parts[parts.length - 1]
        const fileHandle = await currentDir.getFileHandle(fileName, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(buffer)
        await writable.close()
    }

    // Create empty directories from vfsDirIndex
    for (let i = 0; i < directories.length; i++) {
        const dirPath = directories[i]
        onProgress?.({ phase: 'writing', current: entries.length + i + 1, total, filename: dirPath + '/' })

        // Create nested directory structure
        const parts = dirPath.split('/')
        let currentDir = root

        for (const part of parts) {
            currentDir = await currentDir.getDirectoryHandle(part, { create: true })
        }
    }

    console.log(`[VFS] Extracted ${vfsIndex.size} files, ${directories.length} dirs to OPFS`)
}

// Hydration: Pack all OPFS files into VFS binary
// Scans OPFS recursively and adds all files to VFS
export const syncOpfsToVfs = async (onProgress?: SyncProgressCallback) => {
    if (!root || !vfsSyncHandle) throw new Error('VFS not initialized')

    const files: Array<{ path: string; data: Uint8Array }> = []
    const directories: string[] = []
    let scannedCount = 0

    // Recursively collect all files and directories from OPFS
    const collectEntries = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<boolean> => {
        let hasFiles = false

        for await (const [name, handle] of (dir as any).entries()) {
            const path = prefix ? `${prefix}/${name}` : name

            // Skip the VFS binary itself
            if (path === VFS_FILENAME) continue

            if (handle.kind === 'file') {
                scannedCount++
                hasFiles = true
                onProgress?.({ phase: 'scanning', current: scannedCount, total: 0, filename: path })
                const file = await (handle as FileSystemFileHandle).getFile()
                const buffer = await file.arrayBuffer()
                files.push({ path, data: new Uint8Array(buffer) })
            } else if (handle.kind === 'directory') {
                const subHasFiles = await collectEntries(handle as FileSystemDirectoryHandle, path)
                if (!subHasFiles) {
                    // Empty directory - track it explicitly
                    directories.push(path)
                }
                hasFiles = hasFiles || subHasFiles
            }
        }

        return hasFiles
    }

    await collectEntries(root, '')

    // Clear all existing VFS indexes and rebuild
    vfsIndex.clear()
    vfsDirIndex.clear()
    vfsSymlinkIndex.clear()
    vfsMetadataIndex.clear()

    // Add explicit directories
    for (const dir of directories) {
        vfsDirIndex.add(dir)
    }

    // Calculate index size first (using the new format)
    const tempIndex = new Map<string, { offset: number; size: number }>()
    let dataOffset = 0
    for (const { path, data } of files) {
        tempIndex.set(path, { offset: dataOffset, size: data.length })
        dataOffset += data.length
    }

    // We need to calculate the final index size iteratively because:
    // - Index contains file offsets which depend on index size
    // - Index size depends on the string length of those offsets
    // This converges quickly (usually 1-2 iterations)
    let indexSize = 0
    let iterations = 0
    const maxIterations = 10

    while (iterations < maxIterations) {
        iterations++
        const headerSize = INDEX_HEADER_SIZE + indexSize

        // Calculate offsets with current header size estimate
        vfsIndex.clear()
        let offset = headerSize
        for (const { path, data } of files) {
            vfsIndex.set(path, { offset, size: data.length })
            offset += data.length
        }

        // Generate index JSON and measure its size
        const indexData = {
            files: Array.from(vfsIndex.entries()),
            dirs: Array.from(vfsDirIndex),
            symlinks: Array.from(vfsSymlinkIndex.entries()),
            metadata: Array.from(vfsMetadataIndex.entries()),
        }
        const indexJson = JSON.stringify(indexData)
        const indexBytes = new TextEncoder().encode(indexJson)
        const newIndexSize = indexBytes.length

        if (newIndexSize === indexSize) {
            // Converged - write the data
            const headerBuffer = new ArrayBuffer(INDEX_HEADER_SIZE)
            new DataView(headerBuffer).setUint32(0, indexBytes.length)
            vfsSyncHandle.write(new Uint8Array(headerBuffer), { at: 0 })
            vfsSyncHandle.write(indexBytes, { at: INDEX_HEADER_SIZE })
            break
        }

        indexSize = newIndexSize
    }

    if (iterations >= maxIterations) {
        throw new Error('Failed to converge index size calculation')
    }

    // Write file data with progress
    // File offsets are already stored in vfsIndex from the convergence loop
    let writeOffset = INDEX_HEADER_SIZE + indexSize
    for (let i = 0; i < files.length; i++) {
        const { path, data } = files[i]
        onProgress?.({ phase: 'writing', current: i + 1, total: files.length, filename: path })
        vfsSyncHandle.write(data, { at: writeOffset })
        writeOffset += data.length
    }

    // Truncate excess
    vfsSyncHandle.truncate(writeOffset)
    vfsSyncHandle.flush()

    resetWastedBytes()
    console.log(`[VFS] Packed ${files.length} files, ${directories.length} dirs from OPFS (${writeOffset} bytes)`)
}
