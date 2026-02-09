// lchmod implementation - no-op in OPFS (no permissions/symlinks)

// Async - no-op
export const lchmod = async (
    _root: FileSystemDirectoryHandle,
    _path: string,
    _mode: number
): Promise<void> => {
    // No-op: OPFS doesn't have permissions or symlinks
}

// Sync - no-op
export const lchmodSync = (
    _path: string,
    _mode: number
): void => {
    // No-op: OPFS doesn't have permissions or symlinks
}
