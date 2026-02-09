// Node.js fs.Dirent class implementation
// https://nodejs.org/api/fs.html#class-fsdirent

import { S_IFMT, S_IFREG, S_IFDIR, S_IFLNK, S_IFCHR, S_IFBLK, S_IFIFO, S_IFSOCK } from '../constants'

export interface DirentInit {
    name: string
    path?: string
    mode: number
}

export class Dirent {
    name: string
    path: string
    // Use public _mode for JSON serialization (private # fields don't serialize)
    _mode: number

    constructor(init: DirentInit) {
        this.name = init.name
        this.path = init.path ?? ''
        this._mode = init.mode
    }

    isFile(): boolean {
        return (this._mode & S_IFMT) === S_IFREG
    }

    isDirectory(): boolean {
        return (this._mode & S_IFMT) === S_IFDIR
    }

    isBlockDevice(): boolean {
        return (this._mode & S_IFMT) === S_IFBLK
    }

    isCharacterDevice(): boolean {
        return (this._mode & S_IFMT) === S_IFCHR
    }

    isSymbolicLink(): boolean {
        return (this._mode & S_IFMT) === S_IFLNK
    }

    isFIFO(): boolean {
        return (this._mode & S_IFMT) === S_IFIFO
    }

    isSocket(): boolean {
        return (this._mode & S_IFMT) === S_IFSOCK
    }

    // For JSON serialization
    toJSON() {
        return {
            __type: 'Dirent',
            name: this.name,
            path: this.path,
            _mode: this._mode
        }
    }

    // Reconstruct from JSON
    static fromJSON(obj: { name: string; path: string; _mode: number }): Dirent {
        return new Dirent({ name: obj.name, path: obj.path, mode: obj._mode })
    }
}

// Helper to create Dirent from VFS entry
export const createDirent = (
    name: string,
    isDir: boolean,
    isSymlink: boolean,
    parentPath?: string
): Dirent => {
    let mode: number
    if (isSymlink) {
        mode = S_IFLNK | 0o777
    } else if (isDir) {
        mode = S_IFDIR | 0o755
    } else {
        mode = S_IFREG | 0o644
    }

    return new Dirent({
        name,
        path: parentPath,
        mode,
    })
}

export default Dirent
