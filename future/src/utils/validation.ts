// Validation utilities for fs operations

import { createEINVAL } from '../classes'

// Valid Node.js buffer encodings
const VALID_ENCODINGS = new Set([
    'ascii',
    'utf8',
    'utf-8',
    'utf16le',
    'utf-16le',
    'ucs2',
    'ucs-2',
    'base64',
    'base64url',
    'latin1',
    'binary', // alias for latin1
    'hex',
])

// Valid file open flags
const VALID_FLAGS = new Set([
    'r',      // Open for reading, error if doesn't exist
    'r+',     // Open for reading and writing, error if doesn't exist
    'rs',     // Open for reading synchronously
    'rs+',    // Open for reading and writing synchronously
    'w',      // Open for writing, create if doesn't exist, truncate if exists
    'wx',     // Like 'w' but fails if path exists
    'w+',     // Open for reading and writing, create/truncate
    'wx+',    // Like 'w+' but fails if path exists
    'a',      // Open for appending, create if doesn't exist
    'ax',     // Like 'a' but fails if path exists
    'a+',     // Open for reading and appending
    'ax+',    // Like 'a+' but fails if path exists
])

/**
 * Validates that the encoding is a valid Node.js buffer encoding
 * @throws Error with code EINVAL if encoding is invalid
 */
export const validateEncoding = (encoding: string | undefined, syscall: string, path?: string): void => {
    if (encoding === undefined || encoding === null) return

    const normalizedEncoding = encoding.toLowerCase()

    if (!VALID_ENCODINGS.has(normalizedEncoding)) {
        throw createEINVAL(syscall, path, `Unknown encoding: ${encoding}`)
    }
}

/**
 * Validates that the flag is a valid file open flag
 * @throws Error with code EINVAL if flag is invalid
 */
export const validateFlag = (flag: string | undefined, syscall: string, path?: string): void => {
    if (flag === undefined || flag === null) return

    if (!VALID_FLAGS.has(flag)) {
        throw createEINVAL(syscall, path, `Unknown file flag: ${flag}`)
    }
}

/**
 * Normalizes encoding to standard form
 * Returns undefined if no encoding specified (binary mode)
 */
export const normalizeEncoding = (encoding: string | undefined): BufferEncoding | undefined => {
    if (encoding === undefined || encoding === null) return undefined

    const lower = encoding.toLowerCase()

    // Normalize aliases
    switch (lower) {
        case 'utf-8':
            return 'utf8'
        case 'utf-16le':
            return 'utf16le'
        case 'ucs-2':
            return 'ucs2'
        case 'binary':
            return 'latin1'
        default:
            return lower as BufferEncoding
    }
}

/**
 * Validates that mode is a valid file mode (permissions)
 */
export const validateMode = (mode: number | undefined, syscall: string, path?: string): void => {
    if (mode === undefined || mode === null) return

    if (typeof mode !== 'number' || mode < 0 || mode > 0o7777) {
        throw createEINVAL(syscall, path, `Invalid mode: ${mode}`)
    }
}

/**
 * Validates and normalizes a path
 * Supports string, Buffer, and URL paths
 */
export const normalizePath = (path: string | Buffer | URL): string => {
    if (typeof path === 'string') {
        return path
    }

    if (Buffer.isBuffer(path)) {
        return path.toString('utf8')
    }

    if (path instanceof URL) {
        if (path.protocol !== 'file:') {
            throw new TypeError(`The URL must be of scheme file. Received ${path.protocol}`)
        }
        // Convert file:// URL to path
        // file:///path/to/file -> /path/to/file
        return decodeURIComponent(path.pathname)
    }

    throw new TypeError(`The "path" argument must be of type string, Buffer, or URL. Received ${typeof path}`)
}

/**
 * Checks if a value is a valid path type
 */
export const isValidPath = (path: unknown): path is string | Buffer | URL => {
    return typeof path === 'string' || Buffer.isBuffer(path) || path instanceof URL
}

/**
 * Permission bits for symbolic mode parsing
 */
const PERM_READ = 4
const PERM_WRITE = 2
const PERM_EXEC = 1

/**
 * Parses a symbolic permission mode string and applies it to an existing mode
 * Supports formats like: 'u+x', 'go-w', 'a=rw', 'u+rwx,g+rx,o+r'
 *
 * @param symbolicMode - The symbolic mode string (e.g., 'u+x', 'go-w')
 * @param currentMode - The current numeric mode to modify (default: 0)
 * @returns The resulting numeric mode
 */
export const parseSymbolicMode = (symbolicMode: string, currentMode: number = 0): number => {
    // Handle numeric mode passed as string
    if (/^[0-7]+$/.test(symbolicMode)) {
        return parseInt(symbolicMode, 8)
    }

    let mode = currentMode

    // Split by comma for multiple clauses (e.g., 'u+x,g+r')
    const clauses = symbolicMode.split(',')

    for (const clause of clauses) {
        // Parse: [ugoa]*[+-=][rwxXst]+
        const match = clause.match(/^([ugoa]*)([+\-=])([rwxXst]+)$/)

        if (!match) {
            throw new Error(`Invalid symbolic mode: ${clause}`)
        }

        const [, who, op, perms] = match

        // Determine which permission groups to affect
        // Empty 'who' means 'a' (all), but respects umask in real Node.js
        // For simplicity, we treat empty as 'a'
        const affectUser = who === '' || who.includes('u') || who.includes('a')
        const affectGroup = who === '' || who.includes('g') || who.includes('a')
        const affectOther = who === '' || who.includes('o') || who.includes('a')

        // Calculate permission bits
        let bits = 0
        if (perms.includes('r')) bits |= PERM_READ
        if (perms.includes('w')) bits |= PERM_WRITE
        if (perms.includes('x')) bits |= PERM_EXEC
        // 'X' - execute only if directory or already has execute
        // For simplicity, treat as 'x' (would need file type info for full support)
        if (perms.includes('X')) bits |= PERM_EXEC

        // Build the mask for affected bits
        let mask = 0
        let value = 0

        if (affectUser) {
            mask |= 0o700
            value |= (bits << 6)
        }
        if (affectGroup) {
            mask |= 0o070
            value |= (bits << 3)
        }
        if (affectOther) {
            mask |= 0o007
            value |= bits
        }

        // Handle special bits (setuid, setgid, sticky)
        if (perms.includes('s')) {
            if (affectUser) {
                mask |= 0o4000
                value |= 0o4000
            }
            if (affectGroup) {
                mask |= 0o2000
                value |= 0o2000
            }
        }
        if (perms.includes('t')) {
            mask |= 0o1000
            value |= 0o1000
        }

        // Apply the operation
        switch (op) {
            case '+':
                mode |= value
                break
            case '-':
                mode &= ~value
                break
            case '=':
                mode = (mode & ~mask) | value
                break
        }
    }

    return mode
}

/**
 * Converts a numeric mode to symbolic string representation
 * @param mode - The numeric mode
 * @returns Symbolic representation (e.g., 'rwxr-xr-x')
 */
export const modeToSymbolic = (mode: number): string => {
    const chars = [
        (mode & 0o400) ? 'r' : '-',
        (mode & 0o200) ? 'w' : '-',
        (mode & 0o4000) ? ((mode & 0o100) ? 's' : 'S') : ((mode & 0o100) ? 'x' : '-'),
        (mode & 0o040) ? 'r' : '-',
        (mode & 0o020) ? 'w' : '-',
        (mode & 0o2000) ? ((mode & 0o010) ? 's' : 'S') : ((mode & 0o010) ? 'x' : '-'),
        (mode & 0o004) ? 'r' : '-',
        (mode & 0o002) ? 'w' : '-',
        (mode & 0o1000) ? ((mode & 0o001) ? 't' : 'T') : ((mode & 0o001) ? 'x' : '-'),
    ]
    return chars.join('')
}

/**
 * Parses a mode that can be either numeric or symbolic
 * @param mode - Numeric mode, or symbolic string
 * @param currentMode - Current mode for symbolic operations (default: 0o666 for files, 0o777 for dirs)
 * @returns Numeric mode
 */
export const parseMode = (mode: number | string, currentMode: number = 0o666): number => {
    if (typeof mode === 'number') {
        return mode
    }

    if (typeof mode === 'string') {
        return parseSymbolicMode(mode, currentMode)
    }

    throw new TypeError(`Invalid mode type: ${typeof mode}`)
}
