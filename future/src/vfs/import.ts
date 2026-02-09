// VFS Import Operations

import { vfsIndex, vfsSyncHandle, root, INDEX_HEADER_SIZE, resetWastedBytes } from './state'

// Import files to VFS from an iterable (e.g., from zip/tar extraction)
export const importToVfs = (files: Iterable<{ path: string; data: Uint8Array | ArrayBuffer }>) => {
    if (!vfsSyncHandle) throw new Error('VFS not initialized')

    const fileList: Array<{ path: string; data: Uint8Array }> = []

    for (const file of files) {
        const data = file.data instanceof ArrayBuffer ? new Uint8Array(file.data) : file.data
        fileList.push({ path: file.path, data })
    }

    // Clear existing VFS and rebuild
    vfsIndex.clear()

    // Calculate index size first
    const tempIndex = new Map<string, { offset: number; size: number }>()
    let dataOffset = 0
    for (const { path, data } of fileList) {
        tempIndex.set(path, { offset: dataOffset, size: data.length })
        dataOffset += data.length
    }

    const indexJson = JSON.stringify(Array.from(tempIndex.entries()))
    const indexBytes = new TextEncoder().encode(indexJson)
    const headerSize = INDEX_HEADER_SIZE + indexBytes.length

    // Set final offsets accounting for header
    let actualOffset = headerSize
    for (const { path, data } of fileList) {
        vfsIndex.set(path, { offset: actualOffset, size: data.length })
        actualOffset += data.length
    }

    // Write header
    const headerBuffer = new ArrayBuffer(INDEX_HEADER_SIZE)
    new DataView(headerBuffer).setUint32(0, indexBytes.length)
    vfsSyncHandle.write(new Uint8Array(headerBuffer), { at: 0 })

    // Write index with correct offsets
    const finalIndexJson = JSON.stringify(Array.from(vfsIndex.entries()))
    const finalIndexBytes = new TextEncoder().encode(finalIndexJson)
    vfsSyncHandle.write(finalIndexBytes, { at: INDEX_HEADER_SIZE })

    // Write file data
    let writeOffset = INDEX_HEADER_SIZE + finalIndexBytes.length
    for (const { data } of fileList) {
        vfsSyncHandle.write(data, { at: writeOffset })
        writeOffset += data.length
    }

    // Truncate excess
    vfsSyncHandle.truncate(writeOffset)
    vfsSyncHandle.flush()

    resetWastedBytes()
    console.log(`[VFS] Imported ${fileList.length} files (${writeOffset} bytes)`)
}

// Import files to OPFS from an iterable (e.g., from zip/tar extraction)
export const importToOpfs = async (
    files: Iterable<{ path: string; data: Uint8Array | ArrayBuffer }> | AsyncIterable<{ path: string; data: Uint8Array | ArrayBuffer }>
) => {
    if (!root) throw new Error('VFS not initialized')

    let count = 0

    for await (const file of files as AsyncIterable<{ path: string; data: Uint8Array | ArrayBuffer }>) {
        const data = file.data instanceof ArrayBuffer ? new Uint8Array(file.data) : file.data

        // Handle nested paths by creating directories
        const parts = file.path.split('/')
        let currentDir = root

        for (let i = 0; i < parts.length - 1; i++) {
            currentDir = await currentDir.getDirectoryHandle(parts[i], { create: true })
        }

        const fileName = parts[parts.length - 1]
        const fileHandle = await currentDir.getFileHandle(fileName, { create: true })
        const writable = await fileHandle.createWritable()
        // Copy to regular ArrayBuffer (TypeScript complains about SharedArrayBuffer compatibility)
        const buffer = new ArrayBuffer(data.length)
        new Uint8Array(buffer).set(data)
        await writable.write(buffer)
        await writable.close()

        count++
    }

    console.log(`[VFS] Imported ${count} files to OPFS`)
}
