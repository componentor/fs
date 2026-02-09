// link (hard link) implementation
// Hard links are emulated by copying the file content reference

import { queueEvent, readFromVfs, writeToVfs, getVfsIndex, normalizePath } from '../fs.vfs'
import { createENOENT } from '../classes'

// Async - creates hard link in OPFS (emulated by copying file)
export const link = async (
    root: FileSystemDirectoryHandle,
    existingPath: string,
    newPath: string
): Promise<void> => {
    queueEvent('create', newPath)
    const srcParts = existingPath.split('/').filter(p => p.length > 0)
    const destParts = newPath.split('/').filter(p => p.length > 0)
    
    // Navigate to source
    let srcDir = root
    for (let i = 0; i < srcParts.length - 1; i++) {
        srcDir = await srcDir.getDirectoryHandle(srcParts[i])
    }
    
    const srcName = srcParts[srcParts.length - 1]
    const srcHandle = await srcDir.getFileHandle(srcName)
    const file = await srcHandle.getFile()
    const content = new Uint8Array(await file.arrayBuffer())
    
    // Navigate/create destination
    let destDir = root
    for (let i = 0; i < destParts.length - 1; i++) {
        destDir = await destDir.getDirectoryHandle(destParts[i], { create: true })
    }
    
    const destName = destParts[destParts.length - 1]
    const destHandle = await destDir.getFileHandle(destName, { create: true })
    const writable = await destHandle.createWritable()
    await writable.write(content)
    await writable.close()
}

// Sync - creates hard link in VFS (emulated by sharing same offset/size)
export const linkSync = (
    existingPath: string,
    newPath: string
): void => {
    queueEvent('create', newPath)
    const normalizedSrc = normalizePath(existingPath)
    const normalizedDest = normalizePath(newPath)
    
    const vfsIndex = getVfsIndex()
    const srcEntry = vfsIndex.get(normalizedSrc)
    
    if (!srcEntry) {
        throw createENOENT('link', existingPath)
    }
    
    // For VFS, we can truly share the same data by pointing to same offset
    // This is a real hard link in the VFS sense
    vfsIndex.set(normalizedDest, { ...srcEntry })
}
