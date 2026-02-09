// fchown implementation - no-op in OPFS (no ownership)

// Async - no-op
export const fchown = async (
    _fd: number,
    _uid: number,
    _gid: number
): Promise<void> => {
    // No-op: OPFS doesn't have an ownership system
}

// Sync - no-op
export const fchownSync = (
    _fd: number,
    _uid: number,
    _gid: number
): void => {
    // No-op: OPFS doesn't have an ownership system
}
