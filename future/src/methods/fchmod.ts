// fchmod implementation - no-op in OPFS (no permissions)

// Async - no-op
export const fchmod = async (
    _fd: number,
    _mode: number
): Promise<void> => {
    // No-op: OPFS doesn't have a permission system
}

// Sync - no-op
export const fchmodSync = (
    _fd: number,
    _mode: number
): void => {
    // No-op: OPFS doesn't have a permission system
}
