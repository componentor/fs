// fsync implementation - flushes file data to storage

import { getFdEntry } from './open'

// Async - no-op for OPFS (writes are already sync to storage)
export const fsync = async (
    fd: number
): Promise<void> => {
    const entry = getFdEntry(fd)
    if (!entry) {
        throw new Error(`EBADF: bad file descriptor, fsync`)
    }
    // OPFS writes are already persisted
}

// Sync - no-op
export const fsyncSync = (
    fd: number
): void => {
    const entry = getFdEntry(fd)
    if (!entry) {
        throw new Error(`EBADF: bad file descriptor, fsync`)
    }
    // VFS writes are immediately persisted
}
