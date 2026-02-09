// fstat implementation using file descriptors

import { getFdEntry } from './open'
import { readFromVfs, isDirectoryInVfs } from '../fs.vfs'
import type { Stats } from '../types'
import { createENOENT, createEBADF } from '../classes'

const createStats = (size: number, isDir: boolean): Stats => {
    const now = new Date()
    return {
        isFile: () => !isDir,
        isDirectory: () => isDir,
        isSymbolicLink: () => false,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        dev: 0,
        ino: 0,
        mode: isDir ? 16877 : 33188,
        nlink: 1,
        uid: 0,
        gid: 0,
        rdev: 0,
        size,
        blksize: 4096,
        blocks: Math.ceil(size / 512),
        atimeMs: now.getTime(),
        mtimeMs: now.getTime(),
        ctimeMs: now.getTime(),
        birthtimeMs: now.getTime(),
        atime: now,
        mtime: now,
        ctime: now,
        birthtime: now,
    }
}

// Async - gets file stats from file descriptor
export const fstat = async (
    fd: number
): Promise<Stats> => {
    const entry = getFdEntry(fd)
    if (!entry) {
        throw createEBADF('fstat')
    }
    
    if (!entry.handle) {
        throw new Error(`EBADF: file descriptor not opened for async operations`)
    }
    
    const file = await entry.handle.getFile()
    return createStats(file.size, false)
}

// Sync - gets file stats from file descriptor in VFS
export const fstatSync = (
    fd: number
): Stats => {
    const entry = getFdEntry(fd)
    if (!entry) {
        throw createEBADF('fstat')
    }
    
    const content = entry.content || readFromVfs(entry.path)
    if (!content && !isDirectoryInVfs(entry.path)) {
        throw createENOENT('fstat', entry.path)
    }
    
    return createStats(content?.length || 0, isDirectoryInVfs(entry.path))
}
