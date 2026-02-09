// VFS Path Utilities
// Shared path normalization to ensure consistent path handling across all VFS operations

/**
 * Normalizes a path for VFS storage and lookup.
 * - Removes leading and trailing slashes
 * - Handles empty paths, root, and current directory
 * - Returns empty string for root paths
 *
 * @example
 * normalizePath('/foo/bar/') -> 'foo/bar'
 * normalizePath('foo/bar')   -> 'foo/bar'
 * normalizePath('/')         -> ''
 * normalizePath('')          -> ''
 */
export const normalizePath = (path: string): string => {
    return path.replace(/^\/+|\/+$/g, '')
}

/**
 * Checks if a path represents the root directory
 */
export const isRootPath = (path: string): boolean => {
    const normalized = normalizePath(path)
    return normalized === '' || path === '.' || path === '/'
}

/**
 * Gets the parent directory of a path
 * @example
 * getParentPath('foo/bar/baz') -> 'foo/bar'
 * getParentPath('foo')         -> ''
 * getParentPath('')            -> ''
 */
export const getParentPath = (path: string): string => {
    const normalized = normalizePath(path)
    const lastSlash = normalized.lastIndexOf('/')
    return lastSlash === -1 ? '' : normalized.slice(0, lastSlash)
}

/**
 * Gets the basename (final component) of a path
 * @example
 * getBasename('foo/bar/baz') -> 'baz'
 * getBasename('foo')         -> 'foo'
 */
export const getBasename = (path: string): string => {
    const normalized = normalizePath(path)
    const lastSlash = normalized.lastIndexOf('/')
    return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1)
}

/**
 * Joins path segments, normalizing the result
 * @example
 * joinPath('foo', 'bar')     -> 'foo/bar'
 * joinPath('/foo/', '/bar/') -> 'foo/bar'
 */
export const joinPath = (...segments: string[]): string => {
    return normalizePath(segments.map(normalizePath).filter(Boolean).join('/'))
}
