// opendir implementation using OPFS

import { getVfsIndex, getVfsDirIndex, normalizePath } from '../fs.vfs'
import type { Dirent } from '../types'

interface Dir {
    path: string
    read(): Promise<Dirent | null>
    readSync(): Dirent | null
    close(): Promise<void>
    closeSync(): void
    [Symbol.asyncIterator](): AsyncIterableIterator<Dirent>
}

// Async - opens directory for iteration in OPFS
export const opendir = async (
    root: FileSystemDirectoryHandle,
    path: string
): Promise<Dir> => {
    const parts = path.split('/').filter(p => p.length > 0)
    
    let currentDir = root
    for (const part of parts) {
        currentDir = await currentDir.getDirectoryHandle(part)
    }
    
    const entries: Dirent[] = []
    for await (const [name, handle] of (currentDir as any).entries()) {
        const isDir = handle.kind === 'directory'
        entries.push({
            name,
            isFile: () => !isDir,
            isDirectory: () => isDir,
            isSymbolicLink: () => false,
            isBlockDevice: () => false,
            isCharacterDevice: () => false,
            isFIFO: () => false,
            isSocket: () => false,
        })
    }
    
    let index = 0
    
    return {
        path,
        async read(): Promise<Dirent | null> {
            if (index >= entries.length) return null
            return entries[index++]
        },
        readSync(): Dirent | null {
            if (index >= entries.length) return null
            return entries[index++]
        },
        async close(): Promise<void> {
            index = entries.length
        },
        closeSync(): void {
            index = entries.length
        },
        async *[Symbol.asyncIterator](): AsyncIterableIterator<Dirent> {
            for (const entry of entries) {
                yield entry
            }
        },
    }
}

// Sync - opens directory for iteration in VFS
export const opendirSync = (
    path: string
): Dir => {
    const normalizedPath = normalizePath(path)
    const vfsIndex = getVfsIndex()
    const vfsDirIndex = getVfsDirIndex()
    
    const prefix = normalizedPath ? normalizedPath + '/' : ''
    const seen = new Set<string>()
    const entries: Dirent[] = []
    
    // Scan for files
    for (const filePath of vfsIndex.keys()) {
        if (normalizedPath === '' || filePath.startsWith(prefix)) {
            const relativePath = normalizedPath === '' ? filePath : filePath.substring(prefix.length)
            const firstPart = relativePath.split('/')[0]
            if (!seen.has(firstPart)) {
                seen.add(firstPart)
                const isDir = relativePath.includes('/')
                entries.push({
                    name: firstPart,
                    isFile: () => !isDir,
                    isDirectory: () => isDir,
                    isSymbolicLink: () => false,
                    isBlockDevice: () => false,
                    isCharacterDevice: () => false,
                    isFIFO: () => false,
                    isSocket: () => false,
                })
            }
        }
    }
    
    // Scan for directories
    for (const dirPath of vfsDirIndex) {
        if (normalizedPath === '' || dirPath.startsWith(prefix)) {
            const relativePath = normalizedPath === '' ? dirPath : dirPath.substring(prefix.length)
            const firstPart = relativePath.split('/')[0]
            if (!seen.has(firstPart)) {
                seen.add(firstPart)
                entries.push({
                    name: firstPart,
                    isFile: () => false,
                    isDirectory: () => true,
                    isSymbolicLink: () => false,
                    isBlockDevice: () => false,
                    isCharacterDevice: () => false,
                    isFIFO: () => false,
                    isSocket: () => false,
                })
            }
        }
    }
    
    let index = 0
    
    return {
        path,
        async read(): Promise<Dirent | null> {
            if (index >= entries.length) return null
            return entries[index++]
        },
        readSync(): Dirent | null {
            if (index >= entries.length) return null
            return entries[index++]
        },
        async close(): Promise<void> {
            index = entries.length
        },
        closeSync(): void {
            index = entries.length
        },
        async *[Symbol.asyncIterator](): AsyncIterableIterator<Dirent> {
            for (const entry of entries) {
                yield entry
            }
        },
    }
}
