// futimes implementation - no-op in OPFS (timestamps not controllable)

// Async - no-op
export const futimes = async (
    _fd: number,
    _atime: number | string | Date,
    _mtime: number | string | Date
): Promise<void> => {
    // No-op: OPFS doesn't support setting timestamps
}

// Sync - no-op
export const futimesSync = (
    _fd: number,
    _atime: number | string | Date,
    _mtime: number | string | Date
): void => {
    // No-op: OPFS doesn't support setting timestamps
}
