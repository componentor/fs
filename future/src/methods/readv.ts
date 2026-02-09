// readv implementation - scatter read using file descriptors

import { getFdEntry, setFdPosition } from './open'
import { readFromVfs } from '../fs.vfs'

// Async - reads into multiple buffers
export const readv = async (
    fd: number,
    buffers: Uint8Array[],
    position?: number | null
): Promise<number> => {
    const entry = getFdEntry(fd)
    if (!entry) {
        throw new Error(`EBADF: bad file descriptor, readv`)
    }
    
    if (!entry.handle) {
        throw new Error(`EBADF: file descriptor not opened for async operations`)
    }
    
    const file = await entry.handle.getFile()
    const fileContent = new Uint8Array(await file.arrayBuffer())
    
    let readPosition = position !== null && position !== undefined ? position : entry.position
    let totalRead = 0
    
    for (const buffer of buffers) {
        const bytesToRead = Math.min(buffer.length, fileContent.length - readPosition)
        if (bytesToRead <= 0) break
        
        buffer.set(fileContent.subarray(readPosition, readPosition + bytesToRead))
        readPosition += bytesToRead
        totalRead += bytesToRead
    }
    
    if (position === null || position === undefined) {
        setFdPosition(fd, entry.position + totalRead)
    }
    
    return totalRead
}

// Sync - reads into multiple buffers from VFS
export const readvSync = (
    fd: number,
    buffers: Uint8Array[],
    position?: number | null
): number => {
    const entry = getFdEntry(fd)
    if (!entry) {
        throw new Error(`EBADF: bad file descriptor, readv`)
    }
    
    const content = entry.content || readFromVfs(entry.path)
    if (!content) {
        throw new Error(`EBADF: file content not available`)
    }
    
    let readPosition = position !== null && position !== undefined ? position : entry.position
    let totalRead = 0
    
    for (const buffer of buffers) {
        const bytesToRead = Math.min(buffer.length, content.length - readPosition)
        if (bytesToRead <= 0) break
        
        buffer.set(content.subarray(readPosition, readPosition + bytesToRead))
        readPosition += bytesToRead
        totalRead += bytesToRead
    }
    
    if (position === null || position === undefined) {
        setFdPosition(fd, entry.position + totalRead)
    }
    
    return totalRead
}
