// ftruncate implementation using file descriptors

import { getFdEntry } from './open'
import { queueEvent, readFromVfs, writeToVfs } from '../fs.vfs'

// Async - truncates file via file descriptor
export const ftruncate = async (
    fd: number,
    len: number = 0
): Promise<void> => {
    const entry = getFdEntry(fd)
    if (!entry) {
        throw new Error(`EBADF: bad file descriptor, ftruncate`)
    }

    queueEvent('update', entry.path)

    if (!entry.handle) {
        throw new Error(`EBADF: file descriptor not opened for async operations`)
    }

    const file = await entry.handle.getFile()
    const content = new Uint8Array(await file.arrayBuffer())
    
    let newContent: Uint8Array
    if (len === 0) {
        newContent = new Uint8Array(0)
    } else if (len < content.length) {
        newContent = content.slice(0, len)
    } else {
        newContent = new Uint8Array(len)
        newContent.set(content)
    }
    
    const writable = await entry.handle.createWritable()
    // Create a copy backed by ArrayBuffer (not SharedArrayBuffer) for FileSystemWritableFileStream
    await writable.write(new Uint8Array(newContent).buffer as ArrayBuffer)
    await writable.close()
}

// Sync - truncates file in VFS via file descriptor
export const ftruncateSync = (
    fd: number,
    len: number = 0
): void => {
    const entry = getFdEntry(fd)
    if (!entry) {
        throw new Error(`EBADF: bad file descriptor, ftruncate`)
    }

    queueEvent('update', entry.path)

    const content = entry.content || readFromVfs(entry.path) || new Uint8Array(0)
    
    let newContent: Uint8Array
    if (len === 0) {
        newContent = new Uint8Array(0)
    } else if (len < content.length) {
        newContent = content.slice(0, len)
    } else {
        newContent = new Uint8Array(len)
        newContent.set(content)
    }
    
    writeToVfs(entry.path, newContent)
    entry.content = newContent
}
