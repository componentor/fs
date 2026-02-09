// truncate implementation using OPFS

import { queueEvent, readFromVfs, writeToVfs, normalizePath } from '../fs.vfs'
import { createENOENT } from '../classes'

// Async - truncates file in OPFS
export const truncate = async (
    root: FileSystemDirectoryHandle,
    path: string,
    len: number = 0
): Promise<void> => {
    queueEvent('update', path)
    const parts = path.split('/').filter(p => p.length > 0)
    let currentDir = root
    
    for (let i = 0; i < parts.length - 1; i++) {
        currentDir = await currentDir.getDirectoryHandle(parts[i])
    }
    
    const fileName = parts[parts.length - 1]
    const fileHandle = await currentDir.getFileHandle(fileName)
    const file = await fileHandle.getFile()
    
    let newContent: Uint8Array
    if (len === 0) {
        newContent = new Uint8Array(0)
    } else if (len < file.size) {
        const buffer = await file.arrayBuffer()
        newContent = new Uint8Array(buffer.slice(0, len))
    } else {
        // Pad with zeros if len > file.size
        const buffer = await file.arrayBuffer()
        newContent = new Uint8Array(len)
        newContent.set(new Uint8Array(buffer))
    }
    
    const writable = await fileHandle.createWritable()
    // Create a copy backed by ArrayBuffer (not SharedArrayBuffer) for FileSystemWritableFileStream
    await writable.write(new Uint8Array(newContent).buffer as ArrayBuffer)
    await writable.close()
}

// Sync - truncates file in VFS
export const truncateSync = (
    path: string,
    len: number = 0
): void => {
    queueEvent('update', path)
    const normalizedPath = normalizePath(path)
    const content = readFromVfs(normalizedPath)
    
    if (content === null) {
        throw createENOENT('truncate', path)
    }
    
    let newContent: Uint8Array
    if (len === 0) {
        newContent = new Uint8Array(0)
    } else if (len < content.length) {
        newContent = content.slice(0, len)
    } else {
        // Pad with zeros if len > content.length
        newContent = new Uint8Array(len)
        newContent.set(content)
    }
    
    writeToVfs(normalizedPath, newContent)
}
