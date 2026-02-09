// close implementation

import { closeFd, getFdEntry } from './open'

// Async - closes file descriptor
export const close = async (
    fd: number
): Promise<void> => {
    const entry = getFdEntry(fd)
    if (!entry) {
        throw new Error(`EBADF: bad file descriptor, close`)
    }
    closeFd(fd)
}

// Sync - closes file descriptor
export const closeSync = (
    fd: number
): void => {
    const entry = getFdEntry(fd)
    if (!entry) {
        throw new Error(`EBADF: bad file descriptor, close`)
    }
    closeFd(fd)
}
