// VFS Traverse Operations

import { vfsIndex, vfsSyncHandle, root, VFS_FILENAME } from './state'

// Traverse VFS - yields all files for use with zip/tar libraries
export function* traverseVfs(): Generator<{ path: string; data: Uint8Array }> {
    if (!vfsSyncHandle) return

    for (const [path, { offset, size }] of vfsIndex) {
        const buffer = new Uint8Array(size)
        vfsSyncHandle.read(buffer, { at: offset })
        yield { path, data: buffer }
    }
}

// Traverse OPFS - async generator that yields all files
export async function* traverseOpfs(
    dir?: FileSystemDirectoryHandle,
    prefix: string = ''
): AsyncGenerator<{ path: string; data: Uint8Array }> {
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
            yield* traverseOpfs(handle as FileSystemDirectoryHandle, path)
        }
    }
}
