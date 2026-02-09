// lutimes implementation - no-op in OPFS (no symlinks/timestamps)

// Async - no-op
export const lutimes = async (
    _root: FileSystemDirectoryHandle,
    _path: string,
    _atime: number | string | Date,
    _mtime: number | string | Date
): Promise<void> => {
    // No-op: OPFS doesn't support setting timestamps or symlinks
}

// Sync - no-op
export const lutimesSync = (
    _path: string,
    _atime: number | string | Date,
    _mtime: number | string | Date
): void => {
    // No-op: OPFS doesn't support setting timestamps or symlinks
}
