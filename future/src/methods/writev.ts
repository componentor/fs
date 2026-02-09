// writev implementation - gather write using file descriptors

import { getFdEntry, setFdPosition } from './open'
import { queueEvent, readFromVfs, writeToVfs } from '../fs.vfs'

// Async - writes from multiple buffers
export const writev = async (
    fd: number,
    buffers: Uint8Array[],
    position?: number | null
): Promise<number> => {
    const entry = getFdEntry(fd)
    if (!entry) {
        throw new Error(`EBADF: bad file descriptor, writev`)
    }

    queueEvent('update', entry.path)

    if (!entry.handle) {
        throw new Error(`EBADF: file descriptor not opened for async operations`)
    }

    const file = await entry.handle.getFile()
    const fileContent = new Uint8Array(await file.arrayBuffer())
    
    // Calculate total bytes to write
    let totalLength = 0
    for (const buffer of buffers) {
        totalLength += buffer.length
    }
    
    const writePosition = position !== null && position !== undefined ? position : entry.position
    const newSize = Math.max(fileContent.length, writePosition + totalLength)
    const newContent = new Uint8Array(newSize)
    newContent.set(fileContent)
    
    let currentPosition = writePosition
    for (const buffer of buffers) {
        newContent.set(buffer, currentPosition)
        currentPosition += buffer.length
    }
    
    const writable = await entry.handle.createWritable()
    await writable.write(newContent)
    await writable.close()
    
    if (position === null || position === undefined) {
        setFdPosition(fd, entry.position + totalLength)
    }
    
    return totalLength
}

// Sync - writes from multiple buffers to VFS
export const writevSync = (
    fd: number,
    buffers: Uint8Array[],
    position?: number | null
): number => {
    const entry = getFdEntry(fd)
    if (!entry) {
        throw new Error(`EBADF: bad file descriptor, writev`)
    }

    queueEvent('update', entry.path)

    const content = entry.content || readFromVfs(entry.path) || new Uint8Array(0)
    
    let totalLength = 0
    for (const buffer of buffers) {
        totalLength += buffer.length
    }
    
    const writePosition = position !== null && position !== undefined ? position : entry.position
    const newSize = Math.max(content.length, writePosition + totalLength)
    const newContent = new Uint8Array(newSize)
    newContent.set(content)
    
    let currentPosition = writePosition
    for (const buffer of buffers) {
        newContent.set(buffer, currentPosition)
        currentPosition += buffer.length
    }
    
    writeToVfs(entry.path, newContent)
    entry.content = newContent
    
    if (position === null || position === undefined) {
        setFdPosition(fd, entry.position + totalLength)
    }
    
    return totalLength
}
