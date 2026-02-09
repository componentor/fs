// readdir implementation using OPFS

import { getVfsIndex, getVfsDirIndex, isSymlinkInVfs, normalizePath, getVfsSymlinkIndex } from '../fs.vfs'
import { Dirent, createDirent } from '../classes'

export interface ReaddirOptions {
    withFileTypes?: boolean
    encoding?: BufferEncoding | 'buffer'
    recursive?: boolean
}

// Async - reads directory entries from OPFS
export const readdir = async (
    root: FileSystemDirectoryHandle,
    path: string,
    options?: ReaddirOptions
): Promise<string[] | Dirent[]> => {
    const parts = path.split('/').filter(p => p.length > 0)
    let currentDir = root

    // Navigate to target directory
    for (const part of parts) {
        currentDir = await currentDir.getDirectoryHandle(part)
    }

    const entries: Array<{ name: string; kind: 'file' | 'directory' }> = []

    for await (const [name, handle] of (currentDir as any).entries()) {
        entries.push({ name, kind: handle.kind })
    }

    // Handle recursive option
    if (options?.recursive) {
        const allEntries = [...entries]
        for (const entry of entries) {
            if (entry.kind === 'directory') {
                const subPath = path ? `${path}/${entry.name}` : entry.name
                const subEntries = await readdir(root, subPath, { ...options, withFileTypes: false }) as string[]
                for (const subEntry of subEntries) {
                    allEntries.push({
                        name: `${entry.name}/${subEntry}`,
                        kind: 'file' // Will be determined properly if withFileTypes
                    })
                }
            }
        }
        if (options?.withFileTypes) {
            return allEntries.map(({ name, kind }) =>
                createDirent(name, kind === 'directory', false, path)
            )
        }
        return allEntries.map(e => e.name)
    }

    if (options?.withFileTypes) {
        return entries.map(({ name, kind }) =>
            createDirent(name, kind === 'directory', false, path)
        )
    }

    return entries.map(e => e.name)
}

// Sync - reads directory entries from VFS index
export const readdirSync = (
    path: string,
    options?: ReaddirOptions
): string[] | Dirent[] => {
    const vfsIndex = getVfsIndex()
    const vfsDirIndex = getVfsDirIndex()
    const normalizedPath = normalizePath(path)
    const prefix = normalizedPath ? `${normalizedPath}/` : ''

    const entriesSet = new Set<string>()
    const entryTypes = new Map<string, { isDir: boolean; isSymlink: boolean }>()

    // Add entries from files
    for (const filePath of vfsIndex.keys()) {
        if (prefix && !filePath.startsWith(prefix)) continue
        if (!prefix && filePath.includes('/')) {
            // Root level - get first directory component
            const firstPart = filePath.split('/')[0]
            entriesSet.add(firstPart)
            entryTypes.set(firstPart, { isDir: true, isSymlink: false })
        } else if (prefix) {
            // Get next path component after prefix
            const remainder = filePath.slice(prefix.length)
            const nextPart = remainder.split('/')[0]
            if (nextPart) {
                entriesSet.add(nextPart)
                // It's a directory if there's more path after it
                const isDir = remainder.includes('/')
                const fullPath = prefix + nextPart
                const isSymlink = isSymlinkInVfs(fullPath)
                entryTypes.set(nextPart, { isDir, isSymlink })
            }
        } else {
            // Root level file
            const isSymlink = isSymlinkInVfs(filePath)
            entriesSet.add(filePath)
            entryTypes.set(filePath, { isDir: false, isSymlink })
        }
    }

    // Add entries from explicit empty directories
    for (const dirPath of vfsDirIndex) {
        if (prefix && !dirPath.startsWith(prefix)) continue
        if (!prefix && dirPath.includes('/')) {
            // Root level - get first directory component
            const firstPart = dirPath.split('/')[0]
            entriesSet.add(firstPart)
            entryTypes.set(firstPart, { isDir: true, isSymlink: false })
        } else if (prefix) {
            // Get next path component after prefix
            const remainder = dirPath.slice(prefix.length)
            const nextPart = remainder.split('/')[0]
            if (nextPart) {
                entriesSet.add(nextPart)
                entryTypes.set(nextPart, { isDir: true, isSymlink: false })
            }
        } else if (!prefix && !dirPath.includes('/')) {
            // Root level empty directory
            entriesSet.add(dirPath)
            entryTypes.set(dirPath, { isDir: true, isSymlink: false })
        }
    }

    // Add entries from symlinks (stored separately from files)
    const vfsSymlinkIndex = getVfsSymlinkIndex()
    for (const symlinkPath of vfsSymlinkIndex.keys()) {
        if (prefix && !symlinkPath.startsWith(prefix)) continue
        if (!prefix && symlinkPath.includes('/')) {
            // Root level - get first directory component (parent dir of symlink)
            const firstPart = symlinkPath.split('/')[0]
            if (!entriesSet.has(firstPart)) {
                entriesSet.add(firstPart)
                entryTypes.set(firstPart, { isDir: true, isSymlink: false })
            }
        } else if (prefix) {
            // Get next path component after prefix
            const remainder = symlinkPath.slice(prefix.length)
            const nextPart = remainder.split('/')[0]
            if (nextPart && !remainder.includes('/')) {
                // This is a direct child symlink
                entriesSet.add(nextPart)
                entryTypes.set(nextPart, { isDir: false, isSymlink: true })
            } else if (nextPart) {
                // This is a parent directory containing symlinks
                if (!entriesSet.has(nextPart)) {
                    entriesSet.add(nextPart)
                    entryTypes.set(nextPart, { isDir: true, isSymlink: false })
                }
            }
        } else {
            // Root level symlink
            entriesSet.add(symlinkPath)
            entryTypes.set(symlinkPath, { isDir: false, isSymlink: true })
        }
    }

    let entries = Array.from(entriesSet)

    // Handle recursive option
    if (options?.recursive) {
        const allEntries: string[] = []
        const allTypes = new Map<string, { isDir: boolean; isSymlink: boolean }>()

        for (const name of entries) {
            const type = entryTypes.get(name)!
            allEntries.push(name)
            allTypes.set(name, type)

            if (type.isDir) {
                const subPath = normalizedPath ? `${normalizedPath}/${name}` : name
                const subEntries = readdirSync(subPath, { recursive: true }) as string[]
                for (const subEntry of subEntries) {
                    const fullName = `${name}/${subEntry}`
                    allEntries.push(fullName)
                    // Determine type for sub entry
                    const subFullPath = subPath + '/' + subEntry
                    const subIsSymlink = isSymlinkInVfs(subFullPath)
                    const subIsDir = vfsDirIndex.has(subFullPath) ||
                        Array.from(vfsIndex.keys()).some(p => p.startsWith(subFullPath + '/'))
                    allTypes.set(fullName, { isDir: subIsDir, isSymlink: subIsSymlink })
                }
            }
        }

        if (options?.withFileTypes) {
            return allEntries.map(name => {
                const type = allTypes.get(name) ?? { isDir: false, isSymlink: false }
                return createDirent(name, type.isDir, type.isSymlink, normalizedPath)
            })
        }

        return allEntries
    }

    if (options?.withFileTypes) {
        return entries.map(name => {
            const type = entryTypes.get(name) ?? { isDir: false, isSymlink: false }
            return createDirent(name, type.isDir, type.isSymlink, normalizedPath)
        })
    }

    return entries
}
