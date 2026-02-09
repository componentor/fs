// fdatasync implementation - same as fsync for OPFS

import { getFdEntry } from './open'

// Async - no-op for OPFS
export const fdatasync = async (
    fd: number
): Promise<void> => {
    const entry = getFdEntry(fd)
    if (!entry) {
        throw new Error(`EBADF: bad file descriptor, fdatasync`)
    }
}

// Sync - no-op
export const fdatasyncSync = (
    fd: number
): void => {
    const entry = getFdEntry(fd)
    if (!entry) {
        throw new Error(`EBADF: bad file descriptor, fdatasync`)
    }
}
