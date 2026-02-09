// read implementation using file descriptors

import { getFdEntry, setFdPosition } from './open'
import { readFromVfs } from '../fs.vfs'

// Async - reads from file descriptor
export const read = async (
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null
): Promise<number> => {
    const entry = getFdEntry(fd)
    if (!entry) {
        throw new Error(`EBADF: bad file descriptor, read`)
    }
    
    if (!entry.handle) {
        throw new Error(`EBADF: file descriptor not opened for async operations`)
    }
    
    const file = await entry.handle.getFile()
    const fileContent = new Uint8Array(await file.arrayBuffer())
    
    const readPosition = position !== null ? position : entry.position
    const bytesToRead = Math.min(length, fileContent.length - readPosition)
    
    if (bytesToRead <= 0) return 0
    
    buffer.set(fileContent.subarray(readPosition, readPosition + bytesToRead), offset)
    
    if (position === null) {
        setFdPosition(fd, entry.position + bytesToRead)
    }
    
    return bytesToRead
}

// Sync - reads from file descriptor in VFS
// Supports multiple signatures:
//   readSync(fd, buffer, offset, length, position)
//   readSync(fd, buffer, options?)  where options = { offset?, length?, position? }
//   readSync(fd, buffer)
export const readSync = (
    fd: number,
    buffer: Uint8Array,
    offsetOrOptions?: number | { offset?: number; length?: number; position?: number | null },
    length?: number,
    position?: number | null
): number => {
    const entry = getFdEntry(fd)
    if (!entry) {
        throw new Error(`EBADF: bad file descriptor, read`)
    }

    // Parse arguments based on signature
    let actualOffset: number
    let actualLength: number
    let actualPosition: number | null

    if (typeof offsetOrOptions === 'object' && offsetOrOptions !== null) {
        // Options object signature
        actualOffset = offsetOrOptions.offset ?? 0
        actualLength = offsetOrOptions.length ?? buffer.length - actualOffset
        actualPosition = offsetOrOptions.position ?? null
    } else {
        // Positional arguments signature
        actualOffset = offsetOrOptions ?? 0
        actualLength = length ?? buffer.length - actualOffset
        actualPosition = position ?? null
    }

    // Re-read content for sync (may have changed)
    const content = entry.content || readFromVfs(entry.path)
    if (!content) {
        throw new Error(`EBADF: file content not available`)
    }

    const readPosition = actualPosition !== null ? actualPosition : entry.position
    const bytesToRead = Math.min(actualLength, content.length - readPosition)

    if (bytesToRead <= 0) return 0

    buffer.set(content.subarray(readPosition, readPosition + bytesToRead), actualOffset)

    if (actualPosition === null) {
        setFdPosition(fd, entry.position + bytesToRead)
    }

    return bytesToRead
}
