// copyFile implementation using OPFS with streaming for memory efficiency

import { queueEvent, readFileFromVfs, writeFileToVfs, existsInVfs } from '../fs.vfs'
import { createENOENT } from '../classes'

// Chunk size for streaming copies (1MB)
const STREAM_CHUNK_SIZE = 1024 * 1024

// Async - copies file in OPFS using streaming for memory efficiency
export const copyFile = async (
    root: FileSystemDirectoryHandle,
    src: string,
    dest: string
): Promise<void> => {
    queueEvent('create', dest)

    // Get source file handle
    const srcParts = src.split('/').filter(p => p.length > 0)
    let srcDir = root
    for (let i = 0; i < srcParts.length - 1; i++) {
        srcDir = await srcDir.getDirectoryHandle(srcParts[i])
    }
    const srcFileHandle = await srcDir.getFileHandle(srcParts[srcParts.length - 1])
    const file = await srcFileHandle.getFile()

    // Get destination file handle
    const destParts = dest.split('/').filter(p => p.length > 0)
    let destDir = root
    for (let i = 0; i < destParts.length - 1; i++) {
        destDir = await destDir.getDirectoryHandle(destParts[i], { create: true })
    }
    const destFileHandle = await destDir.getFileHandle(destParts[destParts.length - 1], { create: true })

    // Use streaming for memory-efficient copy
    // For small files (< 1MB), use direct copy for simplicity
    if (file.size < STREAM_CHUNK_SIZE) {
        const data = await file.arrayBuffer()
        const writable = await destFileHandle.createWritable()
        await writable.write(data)
        await writable.close()
        return
    }

    // For large files, use stream piping
    const readable = file.stream()
    const writable = await destFileHandle.createWritable()

    try {
        await readable.pipeTo(writable)
    } catch (error) {
        // If pipeTo fails (e.g., browser doesn't support it), fall back to chunked copy
        await copyFileChunked(file, destFileHandle)
    }
}

// Fallback chunked copy for browsers that don't support pipeTo
async function copyFileChunked(
    file: File,
    destFileHandle: FileSystemFileHandle
): Promise<void> {
    const writable = await destFileHandle.createWritable()
    const size = file.size
    let offset = 0

    try {
        while (offset < size) {
            const end = Math.min(offset + STREAM_CHUNK_SIZE, size)
            const chunk = file.slice(offset, end)
            const buffer = await chunk.arrayBuffer()
            await writable.write({ type: 'write', position: offset, data: buffer })
            offset = end
        }
    } finally {
        await writable.close()
    }
}

// Sync - copies file in VFS
export const copyFileSync = (src: string, dest: string): void => {
    const data = readFileFromVfs(src)
    if (data === null) {
        throw createENOENT('copyfile', src)
    }

    // Queue 'create' for new files, 'update' if dest already exists
    const eventType = existsInVfs(dest) ? 'update' : 'create'
    queueEvent(eventType, dest)

    const content = data instanceof Buffer ? data : Buffer.from(data)
    writeFileToVfs(dest, content)
}
