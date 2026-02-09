// mkdtemp implementation using OPFS

import { queueEvent, createDirInVfs, normalizePath } from '../fs.vfs'

const generateRandomString = (length: number): string => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
}

// Async - creates temporary directory in OPFS
export const mkdtemp = async (
    root: FileSystemDirectoryHandle,
    prefix: string
): Promise<string> => {
    const suffix = generateRandomString(6)
    const dirName = prefix + suffix
    queueEvent('create', '/' + dirName)
    const parts = dirName.split('/').filter(p => p.length > 0)

    let currentDir = root
    for (let i = 0; i < parts.length - 1; i++) {
        currentDir = await currentDir.getDirectoryHandle(parts[i], { create: true })
    }

    await currentDir.getDirectoryHandle(parts[parts.length - 1], { create: true })
    return '/' + dirName
}

// Sync - creates temporary directory in VFS
export const mkdtempSync = (
    prefix: string
): string => {
    const normalizedPrefix = normalizePath(prefix)
    const suffix = generateRandomString(6)
    const dirPath = normalizedPrefix + suffix
    queueEvent('create', '/' + dirPath)

    // Create parent directories if needed
    const parts = dirPath.split('/').filter(p => p.length > 0)
    let currentPath = ''
    for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part
        createDirInVfs(currentPath)
    }
    
    return '/' + dirPath
}
