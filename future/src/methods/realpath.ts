// realpath implementation using OPFS

import { existsInVfs, isDirectoryInVfs, normalizePath } from '../fs.vfs'
import { createENOENT } from '../classes'

// Resolve path components (resolve . and ..)
const resolvePath = (path: string): string => {
    const parts = path.split('/').filter(p => p.length > 0)
    const result: string[] = []
    
    for (const part of parts) {
        if (part === '.') continue
        if (part === '..') {
            result.pop()
        } else {
            result.push(part)
        }
    }
    
    return '/' + result.join('/')
}

// Async - resolves path in OPFS
export const realpath = async (
    root: FileSystemDirectoryHandle,
    path: string
): Promise<string> => {
    const resolved = resolvePath(path)
    const parts = resolved.split('/').filter(p => p.length > 0)

    if (parts.length === 0) return '/'

    let currentDir = root
    for (let i = 0; i < parts.length - 1; i++) {
        try {
            currentDir = await currentDir.getDirectoryHandle(parts[i])
        } catch {
            throw createENOENT('realpath', path)
        }
    }

    const name = parts[parts.length - 1]
    try {
        await currentDir.getFileHandle(name)
        return resolved
    } catch {
        try {
            await currentDir.getDirectoryHandle(name)
            return resolved
        } catch {
            throw createENOENT('realpath', path)
        }
    }
}

// Sync - resolves path in VFS
export const realpathSync = (
    path: string
): string => {
    const resolved = resolvePath(path)
    const cleanPath = normalizePath(resolved)

    if (cleanPath === '') return '/'

    if (!existsInVfs(cleanPath) && !isDirectoryInVfs(cleanPath)) {
        throw createENOENT('realpath', path)
    }

    return resolved
}
