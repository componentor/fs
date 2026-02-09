// VFS Metadata Operations

import type { FileMetadata } from './types'
import { vfsMetadataIndex, defaultFileMetadata } from './state'
import { saveIndex } from './index-ops'
import { normalizePath } from './path'

// Get file/dir metadata
export const getMetadataFromVfs = (path: string): FileMetadata | null => {
    const normalizedPath = normalizePath(path)
    return vfsMetadataIndex.get(normalizedPath) || null
}

// Set file/dir metadata
export const setMetadataInVfs = (path: string, metadata: Partial<FileMetadata>) => {
    const normalizedPath = normalizePath(path)
    const existing = vfsMetadataIndex.get(normalizedPath) || defaultFileMetadata()
    vfsMetadataIndex.set(normalizedPath, { ...existing, ...metadata })
    saveIndex()
}

// Set chmod (mode only)
export const chmodInVfs = (path: string, mode: number) => {
    const normalizedPath = normalizePath(path)
    const existing = vfsMetadataIndex.get(normalizedPath) || defaultFileMetadata()
    vfsMetadataIndex.set(normalizedPath, { ...existing, mode })
    saveIndex()
}

// Set chown (uid/gid)
export const chownInVfs = (path: string, uid: number, gid: number) => {
    const normalizedPath = normalizePath(path)
    const existing = vfsMetadataIndex.get(normalizedPath) || defaultFileMetadata()
    vfsMetadataIndex.set(normalizedPath, { ...existing, uid, gid })
    saveIndex()
}

// Set utimes (atime/mtime)
export const utimesInVfs = (path: string, atime: number, mtime: number) => {
    const normalizedPath = normalizePath(path)
    const existing = vfsMetadataIndex.get(normalizedPath) || defaultFileMetadata()
    vfsMetadataIndex.set(normalizedPath, { ...existing, atime, mtime })
    saveIndex()
}

// Get VFS metadata index
export const getVfsMetadataIndex = () => vfsMetadataIndex
