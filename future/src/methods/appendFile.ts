// appendFile implementation using OPFS

import { queueEvent, readFileFromVfs, writeFileToVfs, existsInVfs } from '../fs.vfs'

// Async - appends to file in OPFS
export const appendFile = async (
    root: FileSystemDirectoryHandle,
    path: string,
    data: string | Buffer
): Promise<void> => {
    queueEvent('update', path)

    const parts = path.split('/').filter(p => p.length > 0)
    let currentDir = root

    for (let i = 0; i < parts.length - 1; i++) {
        currentDir = await currentDir.getDirectoryHandle(parts[i], { create: true })
    }

    const fileName = parts[parts.length - 1]
    const fileHandle = await currentDir.getFileHandle(fileName, { create: true })

    // Read existing content
    const file = await fileHandle.getFile()
    const existingData = await file.arrayBuffer()

    // Append new data
    const newData = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
    const combined = new Uint8Array(existingData.byteLength + newData.length)
    combined.set(new Uint8Array(existingData), 0)
    combined.set(newData, existingData.byteLength)

    // Write combined data
    const writable = await fileHandle.createWritable()
    await writable.write(combined)
    await writable.close()
}

// Sync - appends to file in VFS
export const appendFileSync = (
    path: string,
    data: string | Buffer
): void => {
    // Queue 'create' for new files, 'update' for existing files
    const eventType = existsInVfs(path) ? 'update' : 'create'
    queueEvent(eventType, path)

    const existing = readFileFromVfs(path)
    const existingBuffer = existing ? (existing instanceof Buffer ? existing : Buffer.from(existing)) : Buffer.alloc(0)
    const newBuffer = typeof data === 'string' ? Buffer.from(data) : data

    const combined = Buffer.concat([existingBuffer, newBuffer])
    writeFileToVfs(path, combined)
}
