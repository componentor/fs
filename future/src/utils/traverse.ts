// Traverse and import utilities for VFS/OPFS - works with any zip/tar library

import type { FileSystemDirectoryHandle, FileSystemFileHandle } from '../types'

const VFS_FILENAME = '.vfs.bin'

export interface FileEntry {
    path: string
    data: Uint8Array
}

export interface VfsContext {
    vfsSyncHandle: {
        read(buffer: ArrayBuffer | ArrayBufferView, options?: { at?: number }): number
        write(buffer: ArrayBuffer | ArrayBufferView, options?: { at?: number }): number
        getSize(): number
        truncate(newSize: number): void
        flush(): void
    }
    vfsIndex: Map<string, { offset: number; size: number }>
    INDEX_HEADER_SIZE: number
}

// Traverse VFS - yields all files for use with zip/tar libraries
export function* traverseVfs(ctx: VfsContext): Generator<FileEntry> {
    if (!ctx.vfsSyncHandle) return

    for (const [path, { offset, size }] of ctx.vfsIndex) {
        const buffer = new Uint8Array(size)
        ctx.vfsSyncHandle.read(buffer, { at: offset })
        yield { path, data: buffer }
    }
}

// Traverse OPFS - async generator that yields all files
export async function* traverseOpfs(
    root: FileSystemDirectoryHandle,
    dir?: FileSystemDirectoryHandle,
    prefix: string = ''
): AsyncGenerator<FileEntry> {
    const directory = dir || root
    if (!directory) return

    for await (const [name, handle] of (directory as any).entries()) {
        const path = prefix ? `${prefix}/${name}` : name

        // Skip the VFS binary itself
        if (path === VFS_FILENAME) continue

        if (handle.kind === 'file') {
            const file = await (handle as FileSystemFileHandle).getFile()
            const buffer = await file.arrayBuffer()
            yield { path, data: new Uint8Array(buffer) }
        } else if (handle.kind === 'directory') {
            yield* traverseOpfs(root, handle as FileSystemDirectoryHandle, path)
        }
    }
}

// Import files to VFS from an iterable (e.g., from zip/tar extraction)
export const importToVfs = (
    ctx: VfsContext,
    files: Iterable<{ path: string; data: Uint8Array | ArrayBuffer }>
) => {
    if (!ctx.vfsSyncHandle) throw new Error('VFS not initialized')

    const fileList: Array<{ path: string; data: Uint8Array }> = []

    for (const file of files) {
        const data = file.data instanceof ArrayBuffer ? new Uint8Array(file.data) : file.data
        fileList.push({ path: file.path, data })
    }

    // Clear existing VFS and rebuild
    ctx.vfsIndex.clear()

    // Calculate index size first
    const tempIndex = new Map<string, { offset: number; size: number }>()
    let dataOffset = 0
    for (const { path, data } of fileList) {
        tempIndex.set(path, { offset: dataOffset, size: data.length })
        dataOffset += data.length
    }

    const indexJson = JSON.stringify(Array.from(tempIndex.entries()))
    const indexBytes = new TextEncoder().encode(indexJson)
    const headerSize = ctx.INDEX_HEADER_SIZE + indexBytes.length

    // Set final offsets accounting for header
    let actualOffset = headerSize
    for (const { path, data } of fileList) {
        ctx.vfsIndex.set(path, { offset: actualOffset, size: data.length })
        actualOffset += data.length
    }

    // Write header
    const headerBuffer = new ArrayBuffer(ctx.INDEX_HEADER_SIZE)
    new DataView(headerBuffer).setUint32(0, indexBytes.length)
    ctx.vfsSyncHandle.write(new Uint8Array(headerBuffer), { at: 0 })

    // Write index with correct offsets
    const finalIndexJson = JSON.stringify(Array.from(ctx.vfsIndex.entries()))
    const finalIndexBytes = new TextEncoder().encode(finalIndexJson)
    ctx.vfsSyncHandle.write(finalIndexBytes, { at: ctx.INDEX_HEADER_SIZE })

    // Write file data
    let writeOffset = ctx.INDEX_HEADER_SIZE + finalIndexBytes.length
    for (const { data } of fileList) {
        ctx.vfsSyncHandle.write(data, { at: writeOffset })
        writeOffset += data.length
    }

    // Truncate excess
    ctx.vfsSyncHandle.truncate(writeOffset)
    ctx.vfsSyncHandle.flush()

    console.log(`[VFS] Imported ${fileList.length} files (${writeOffset} bytes)`)
}

// Import files to OPFS from an iterable (e.g., from zip/tar extraction)
export const importToOpfs = async (
    root: FileSystemDirectoryHandle,
    files: Iterable<{ path: string; data: Uint8Array | ArrayBuffer }> | AsyncIterable<{ path: string; data: Uint8Array | ArrayBuffer }>
) => {
    if (!root) throw new Error('OPFS root not initialized')

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
