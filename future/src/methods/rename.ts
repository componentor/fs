// rename implementation using OPFS

import {
    queueEvent,
    readFileFromVfs,
    writeFileToVfs,
    deleteFromVfs,
    getVfsIndex,
    getVfsDirIndex,
    isDirectoryInVfs,
    normalizePath,
    createDirInVfs,
    deleteDirFromVfs,
} from '../fs.vfs'
import { createENOENT } from '../classes'

// Async - renames/moves file in OPFS
export const rename = async (
    root: FileSystemDirectoryHandle,
    oldPath: string,
    newPath: string
): Promise<void> => {
    queueEvent('delete', oldPath)
    queueEvent('create', newPath)

    // Read from old location
    const oldParts = oldPath.split('/').filter(p => p.length > 0)
    let oldDir = root
    for (let i = 0; i < oldParts.length - 1; i++) {
        oldDir = await oldDir.getDirectoryHandle(oldParts[i])
    }
    const oldFileHandle = await oldDir.getFileHandle(oldParts[oldParts.length - 1])
    const file = await oldFileHandle.getFile()
    const data = await file.arrayBuffer()

    // Write to new location
    const newParts = newPath.split('/').filter(p => p.length > 0)
    let newDir = root
    for (let i = 0; i < newParts.length - 1; i++) {
        newDir = await newDir.getDirectoryHandle(newParts[i], { create: true })
    }
    const newFileHandle = await newDir.getFileHandle(newParts[newParts.length - 1], { create: true })
    const writable = await newFileHandle.createWritable()
    await writable.write(data)
    await writable.close()

    // Remove old file
    await oldDir.removeEntry(oldParts[oldParts.length - 1])
}

// Sync - renames/moves file or directory in VFS
export const renameSync = (oldPath: string, newPath: string): void => {
    const normalizedOldPath = normalizePath(oldPath)
    const normalizedNewPath = normalizePath(newPath)
    const vfsIndex = getVfsIndex()
    const vfsDirIndex = getVfsDirIndex()

    // Case 1: It's a file
    const data = readFileFromVfs(normalizedOldPath)
    if (data !== null) {
        queueEvent('delete', normalizedOldPath)
        queueEvent('create', normalizedNewPath)

        // Write to new location first, then delete old
        const content = data instanceof Buffer ? data : Buffer.from(data)
        writeFileToVfs(normalizedNewPath, content)
        deleteFromVfs(normalizedOldPath)
        return
    }

    // Case 2: It's a directory
    if (isDirectoryInVfs(normalizedOldPath)) {
        const oldPrefix = normalizedOldPath + '/'
        const filesToRename: Array<{ oldPath: string; newPath: string }> = []

        // Find all files under this directory
        for (const filePath of vfsIndex.keys()) {
            if (filePath.startsWith(oldPrefix) || filePath === normalizedOldPath) {
                const relativePath = filePath.slice(oldPrefix.length)
                const newFilePath = normalizedNewPath + '/' + relativePath
                filesToRename.push({ oldPath: filePath, newPath: newFilePath })
            }
        }

        // Find all subdirectories
        const dirsToRename: Array<{ oldPath: string; newPath: string }> = []
        for (const dirPath of vfsDirIndex) {
            if (dirPath.startsWith(oldPrefix) || dirPath === normalizedOldPath) {
                if (dirPath === normalizedOldPath) {
                    dirsToRename.push({ oldPath: dirPath, newPath: normalizedNewPath })
                } else {
                    const relativePath = dirPath.slice(oldPrefix.length)
                    const newDirPath = normalizedNewPath + '/' + relativePath
                    dirsToRename.push({ oldPath: dirPath, newPath: newDirPath })
                }
            }
        }

        // Rename all files
        for (const { oldPath: op, newPath: np } of filesToRename) {
            const fileData = readFileFromVfs(op)
            if (fileData !== null) {
                queueEvent('delete', op)
                queueEvent('create', np)
                const content = fileData instanceof Buffer ? fileData : Buffer.from(fileData)
                writeFileToVfs(np, content)
                deleteFromVfs(op)
            }
        }

        // Rename all directories
        for (const { oldPath: op, newPath: np } of dirsToRename) {
            queueEvent('delete', op)
            queueEvent('create', np)
            deleteDirFromVfs(op)
            createDirInVfs(np)
        }

        return
    }

    // Neither file nor directory exists
    throw createENOENT('rename', oldPath)
}
