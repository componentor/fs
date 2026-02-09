// lchown implementation - no-op in OPFS (no ownership/symlinks)

// Async - no-op
export const lchown = async (
    _root: FileSystemDirectoryHandle,
    _path: string,
    _uid: number,
    _gid: number
): Promise<void> => {
    // No-op: OPFS doesn't have ownership or symlinks
}

// Sync - no-op
export const lchownSync = (
    _path: string,
    _uid: number,
    _gid: number
): void => {
    // No-op: OPFS doesn't have ownership or symlinks
}
