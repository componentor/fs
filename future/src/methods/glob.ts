// Node.js fs.glob / fs.globSync implementation (Node.js 22+)
// https://nodejs.org/api/fs.html#fspromisesglob

import { Dirent, createDirent } from '../classes'

// Simple glob pattern matching
const globToRegex = (pattern: string): RegExp => {
    let regex = ''
    let i = 0

    while (i < pattern.length) {
        const char = pattern[i]

        if (char === '*') {
            if (pattern[i + 1] === '*') {
                // ** matches any number of directories
                if (pattern[i + 2] === '/') {
                    regex += '(?:[^/]+/)*'
                    i += 3
                    continue
                } else {
                    regex += '.*'
                    i += 2
                    continue
                }
            } else {
                // * matches anything except /
                regex += '[^/]*'
            }
        } else if (char === '?') {
            // ? matches any single character except /
            regex += '[^/]'
        } else if (char === '[') {
            // Character class
            const end = pattern.indexOf(']', i)
            if (end === -1) {
                regex += '\\['
            } else {
                const charClass = pattern.slice(i + 1, end)
                regex += `[${charClass}]`
                i = end
            }
        } else if (char === '{') {
            // Brace expansion {a,b,c}
            const end = pattern.indexOf('}', i)
            if (end === -1) {
                regex += '\\{'
            } else {
                const options = pattern.slice(i + 1, end).split(',')
                regex += `(?:${options.map(o => escapeRegex(o)).join('|')})`
                i = end
            }
        } else if ('.+^${}()|[]\\'.includes(char)) {
            // Escape regex special chars
            regex += '\\' + char
        } else {
            regex += char
        }

        i++
    }

    return new RegExp(`^${regex}$`)
}

const escapeRegex = (str: string): string => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Match path against glob pattern
const matchGlob = (path: string, pattern: string): boolean => {
    const regex = globToRegex(pattern)
    return regex.test(path)
}

export interface GlobOptions {
    cwd?: string
    withFileTypes?: boolean
    exclude?: (path: string) => boolean
}

// Get all entries recursively (to be injected)
type GetEntriesFn = (dir: string) => { path: string; isDir: boolean; isSymlink: boolean }[]

let getEntriesFn: GetEntriesFn | null = null

export const setGlobGetEntriesFn = (fn: GetEntriesFn) => {
    getEntriesFn = fn
}

// Sync implementation
export const globSync = (
    pattern: string | string[],
    options?: GlobOptions
): string[] | Dirent[] => {
    if (!getEntriesFn) {
        throw new Error('glob getEntries function not initialized')
    }

    const patterns = Array.isArray(pattern) ? pattern : [pattern]
    const cwd = options?.cwd ?? '/'
    const withFileTypes = options?.withFileTypes ?? false
    const exclude = options?.exclude

    // Get all entries from VFS
    const entries = getEntriesFn(cwd)

    const matches: { path: string; isDir: boolean; isSymlink: boolean }[] = []

    for (const entry of entries) {
        // Get relative path from cwd
        let relativePath = entry.path
        if (relativePath.startsWith(cwd)) {
            relativePath = relativePath.slice(cwd.length)
            if (relativePath.startsWith('/')) {
                relativePath = relativePath.slice(1)
            }
        }

        // Skip if excluded
        if (exclude && exclude(relativePath)) {
            continue
        }

        // Check against all patterns
        for (const pat of patterns) {
            if (matchGlob(relativePath, pat)) {
                matches.push({ ...entry, path: relativePath })
                break
            }
        }
    }

    if (withFileTypes) {
        return matches.map(m => {
            const name = m.path.split('/').pop() || m.path
            const parentPath = m.path.includes('/')
                ? m.path.slice(0, m.path.lastIndexOf('/'))
                : cwd
            return createDirent(name, m.isDir, m.isSymlink, parentPath)
        })
    }

    return matches.map(m => m.path)
}

// Async implementation (returns async generator)
export async function* glob(
    pattern: string | string[],
    options?: GlobOptions
): AsyncGenerator<string | Dirent, void, unknown> {
    // For simplicity, use sync implementation wrapped in async generator
    const results = globSync(pattern, options)

    for (const result of results) {
        yield result
    }
}

// Alternative async implementation that returns array
export const globAsync = async (
    pattern: string | string[],
    options?: GlobOptions
): Promise<string[] | Dirent[]> => {
    return globSync(pattern, options)
}

export default { glob, globSync, globAsync }
