// open implementation using OPFS with file descriptor emulation

import { readFromVfs, writeToVfs, existsInVfs, normalizePath, queueEvent } from '../fs.vfs'
import { createENOENT } from '../classes'

// File descriptor table (shared across sync/async)
interface FdEntry {
    path: string
    flags: string
    position: number
    // For async: store the handle
    handle?: FileSystemFileHandle
    // For sync: store cached content
    content?: Uint8Array
}

const fdTable = new Map<number, FdEntry>()
let nextFd = 3 // 0, 1, 2 are stdin/stdout/stderr

// Exported for other fd-based methods
export const getFdEntry = (fd: number): FdEntry | undefined => fdTable.get(fd)
export const setFdPosition = (fd: number, position: number) => {
    const entry = fdTable.get(fd)
    if (entry) entry.position = position
}
export const closeFd = (fd: number) => fdTable.delete(fd)

// Parse flags string to determine access mode
const parseFlags = (flags: string): { read: boolean; write: boolean; append: boolean; create: boolean; truncate: boolean } => {
    return {
        read: flags.includes('r') || flags === 'a+' || flags === 'w+',
        write: flags.includes('w') || flags.includes('a') || flags.includes('+'),
        append: flags.includes('a'),
        create: flags.includes('w') || flags.includes('a') || flags.includes('x'),
        truncate: flags.includes('w'),
    }
}

// Async - opens file in OPFS
export const open = async (
    root: FileSystemDirectoryHandle,
    path: string,
    flags: string = 'r',
    _mode?: number
): Promise<number> => {
    const parts = path.split('/').filter(p => p.length > 0)
    const parsedFlags = parseFlags(flags)
    
    let currentDir = root
    for (let i = 0; i < parts.length - 1; i++) {
        try {
            currentDir = await currentDir.getDirectoryHandle(parts[i])
        } catch {
            if (parsedFlags.create) {
                currentDir = await currentDir.getDirectoryHandle(parts[i], { create: true })
            } else {
                throw createENOENT('open', path)
            }
        }
    }
    
    const fileName = parts[parts.length - 1]
    let handle: FileSystemFileHandle
    
    try {
        handle = await currentDir.getFileHandle(fileName, { create: parsedFlags.create })
    } catch {
        throw createENOENT('open', path)
    }
    
    // Truncate if needed
    if (parsedFlags.truncate) {
        const writable = await handle.createWritable()
        await writable.truncate(0)
        await writable.close()
    }
    
    const fd = nextFd++
    const file = await handle.getFile()
    
    fdTable.set(fd, {
        path,
        flags,
        position: parsedFlags.append ? file.size : 0,
        handle,
    })
    
    return fd
}

// Sync - opens file in VFS
export const openSync = (
    path: string,
    flags: string = 'r',
    _mode?: number
): number => {
    const normalizedPath = normalizePath(path)
    const parsedFlags = parseFlags(flags)
    
    let content = readFromVfs(normalizedPath)
    
    if (content === null && !parsedFlags.create) {
        throw createENOENT('open', path)
    }
    
    if (content === null || parsedFlags.truncate) {
        const isNewFile = content === null
        content = new Uint8Array(0)
        if (parsedFlags.create || parsedFlags.truncate) {
            // Queue create for new files, update for truncate of existing files
            queueEvent(isNewFile ? 'create' : 'update', normalizedPath)
            writeToVfs(normalizedPath, content)
        }
    }
    
    const fd = nextFd++
    fdTable.set(fd, {
        path: normalizedPath,
        flags,
        position: parsedFlags.append ? content.length : 0,
        content,
    })
    
    return fd
}
