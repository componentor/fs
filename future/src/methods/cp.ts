// cp implementation - recursive copy

import { queueEvent, readFromVfs, writeToVfs, getVfsIndex, getVfsDirIndex, createDirInVfs, normalizePath } from '../fs.vfs'
import { createENOENT, FSError } from '../classes'

interface CpOptions {
    recursive?: boolean
    force?: boolean
}

// Async - copies file or directory recursively in OPFS
export const cp = async (
    root: FileSystemDirectoryHandle,
    src: string,
    dest: string,
    options?: CpOptions
): Promise<void> => {
    queueEvent('create', dest)
    const srcParts = src.split('/').filter(p => p.length > 0)
    const destParts = dest.split('/').filter(p => p.length > 0)
    
    // Navigate to source parent
    let srcDir = root
    for (let i = 0; i < srcParts.length - 1; i++) {
        srcDir = await srcDir.getDirectoryHandle(srcParts[i])
    }
    
    const srcName = srcParts[srcParts.length - 1]
    
    // Check if source is a file or directory
    let isDir = false
    try {
        await srcDir.getDirectoryHandle(srcName)
        isDir = true
    } catch {
        // It's a file
    }
    
    if (isDir && !options?.recursive) {
        throw new FSError('EISDIR', 'cp', src)
    }
    
    // Navigate/create destination parent
    let destDir = root
    for (let i = 0; i < destParts.length - 1; i++) {
        destDir = await destDir.getDirectoryHandle(destParts[i], { create: true })
    }
    
    const destName = destParts[destParts.length - 1]
    
    if (isDir) {
        await copyDirRecursive(srcDir, srcName, destDir, destName)
    } else {
        await copyFile(srcDir, srcName, destDir, destName)
    }
}

async function copyFile(
    srcDir: FileSystemDirectoryHandle,
    srcName: string,
    destDir: FileSystemDirectoryHandle,
    destName: string
): Promise<void> {
    const srcHandle = await srcDir.getFileHandle(srcName)
    const file = await srcHandle.getFile()
    const content = new Uint8Array(await file.arrayBuffer())
    
    const destHandle = await destDir.getFileHandle(destName, { create: true })
    const writable = await destHandle.createWritable()
    await writable.write(content)
    await writable.close()
}

async function copyDirRecursive(
    srcParent: FileSystemDirectoryHandle,
    srcName: string,
    destParent: FileSystemDirectoryHandle,
    destName: string
): Promise<void> {
    const srcDir = await srcParent.getDirectoryHandle(srcName)
    const destDir = await destParent.getDirectoryHandle(destName, { create: true })
    
    for await (const [name, handle] of (srcDir as any).entries()) {
        if (handle.kind === 'file') {
            await copyFile(srcDir, name, destDir, name)
        } else {
            await copyDirRecursive(srcDir, name, destDir, name)
        }
    }
}

// Sync - copies file or directory in VFS
export const cpSync = (
    src: string,
    dest: string,
    options?: CpOptions
): void => {
    queueEvent('create', dest)
    const normalizedSrc = normalizePath(src)
    const normalizedDest = normalizePath(dest)
    
    const vfsIndex = getVfsIndex()
    const vfsDirIndex = getVfsDirIndex()
    
    // Check if src is a file
    const srcContent = readFromVfs(normalizedSrc)
    if (srcContent !== null) {
        // It's a file - just copy it
        writeToVfs(normalizedDest, srcContent)
        return
    }
    
    // Check if src is a directory
    const srcPrefix = normalizedSrc + '/'
    const isDir = vfsDirIndex.has(normalizedSrc) ||
        Array.from(vfsIndex.keys()).some(p => p.startsWith(srcPrefix))
    
    if (!isDir) {
        throw createENOENT('cp', src)
    }
    
    if (!options?.recursive) {
        throw new FSError('EISDIR', 'cp', src)
    }
    
    // Copy directory recursively
    createDirInVfs(normalizedDest)
    
    // Copy all files under src to dest
    for (const [path, _] of vfsIndex) {
        if (path.startsWith(srcPrefix)) {
            const relativePath = path.substring(srcPrefix.length)
            const destPath = normalizedDest + '/' + relativePath
            queueEvent('create', destPath)
            const content = readFromVfs(path)
            if (content) {
                writeToVfs(destPath, content)
            }
        }
    }

    // Copy all subdirectories
    for (const dirPath of vfsDirIndex) {
        if (dirPath.startsWith(srcPrefix)) {
            const relativePath = dirPath.substring(srcPrefix.length)
            const newDirPath = normalizedDest + '/' + relativePath
            queueEvent('create', newDirPath)
            createDirInVfs(newDirPath)
        }
    }
}
