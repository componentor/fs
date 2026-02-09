// write implementation using file descriptors

import { getFdEntry, setFdPosition } from './open'
import { queueEvent, readFromVfs, writeToVfs } from '../fs.vfs'

// Async - writes to file descriptor
export const write = async (
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null
): Promise<number> => {
    const entry = getFdEntry(fd)
    if (!entry) {
        throw new Error(`EBADF: bad file descriptor, write`)
    }

    queueEvent('update', entry.path)

    if (!entry.handle) {
        throw new Error(`EBADF: file descriptor not opened for async operations`)
    }

    const file = await entry.handle.getFile()
    const fileContent = new Uint8Array(await file.arrayBuffer())
    
    const writePosition = position !== null ? position : entry.position
    const dataToWrite = buffer.subarray(offset, offset + length)
    
    // Calculate new file size
    const newSize = Math.max(fileContent.length, writePosition + length)
    const newContent = new Uint8Array(newSize)
    newContent.set(fileContent)
    newContent.set(dataToWrite, writePosition)
    
    const writable = await entry.handle.createWritable()
    await writable.write(newContent)
    await writable.close()
    
    if (position === null) {
        setFdPosition(fd, entry.position + length)
    }
    
    return length
}

// Sync - writes to file descriptor in VFS
// Supports multiple signatures:
//   writeSync(fd, buffer)
//   writeSync(fd, buffer, offset)
//   writeSync(fd, buffer, offset, length)
//   writeSync(fd, buffer, offset, length, position)
//   writeSync(fd, buffer, options) where options = { offset?, length?, position? }
//   writeSync(fd, string)
//   writeSync(fd, string, position)
//   writeSync(fd, string, position, encoding)
export const writeSync = (
    fd: number,
    bufferOrString: Uint8Array | string,
    offsetOrPositionOrOptions?: number | { offset?: number; length?: number; position?: number | null },
    lengthOrEncoding?: number | string,
    position?: number | null
): number => {
    const entry = getFdEntry(fd)
    if (!entry) {
        throw new Error(`EBADF: bad file descriptor, write`)
    }

    queueEvent('update', entry.path)

    let dataToWrite: Uint8Array
    let writePosition: number

    if (typeof bufferOrString === 'string') {
        // String signature: writeSync(fd, string, position?, encoding?)
        // Note: TextEncoder only supports UTF-8, other encodings are ignored
        dataToWrite = new TextEncoder().encode(bufferOrString)
        writePosition = typeof offsetOrPositionOrOptions === 'number' ? offsetOrPositionOrOptions : entry.position
    } else if (typeof offsetOrPositionOrOptions === 'object' && offsetOrPositionOrOptions !== null) {
        // Options object signature: writeSync(fd, buffer, options)
        const opts = offsetOrPositionOrOptions
        const offset = opts.offset ?? 0
        const length = opts.length ?? bufferOrString.length - offset
        dataToWrite = bufferOrString.subarray(offset, offset + length)
        writePosition = opts.position ?? entry.position
    } else {
        // Positional arguments signature: writeSync(fd, buffer, offset?, length?, position?)
        const offset = offsetOrPositionOrOptions ?? 0
        const length = typeof lengthOrEncoding === 'number' ? lengthOrEncoding : bufferOrString.length - offset
        dataToWrite = bufferOrString.subarray(offset, offset + length)
        writePosition = position ?? entry.position
    }

    const content = entry.content || readFromVfs(entry.path) || new Uint8Array(0)

    // Calculate new file size
    const newSize = Math.max(content.length, writePosition + dataToWrite.length)
    const newContent = new Uint8Array(newSize)
    newContent.set(content)
    newContent.set(dataToWrite, writePosition)

    writeToVfs(entry.path, newContent)
    entry.content = newContent

    setFdPosition(fd, writePosition + dataToWrite.length)

    return dataToWrite.length
}
