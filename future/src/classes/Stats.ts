// Node.js fs.Stats class implementation
// https://nodejs.org/api/fs.html#class-fsstats

import { S_IFMT, S_IFREG, S_IFDIR, S_IFLNK, S_IFCHR, S_IFBLK, S_IFIFO, S_IFSOCK } from '../constants'

export interface StatsInit {
    dev?: number
    ino?: number
    mode: number
    nlink?: number
    uid: number
    gid: number
    rdev?: number
    size: number
    blksize?: number
    blocks?: number
    atimeMs: number
    mtimeMs: number
    ctimeMs: number
    birthtimeMs?: number
}

export class Stats {
    dev: number
    ino: number
    mode: number
    nlink: number
    uid: number
    gid: number
    rdev: number
    size: number
    blksize: number
    blocks: number
    atimeMs: number
    mtimeMs: number
    ctimeMs: number
    birthtimeMs: number
    atime: Date
    mtime: Date
    ctime: Date
    birthtime: Date

    constructor(init: StatsInit) {
        this.dev = init.dev ?? 0
        this.ino = init.ino ?? 0
        this.mode = init.mode
        this.nlink = init.nlink ?? 1
        this.uid = init.uid
        this.gid = init.gid
        this.rdev = init.rdev ?? 0
        this.size = init.size
        this.blksize = init.blksize ?? 4096
        this.blocks = init.blocks ?? Math.ceil(init.size / 512)
        this.atimeMs = init.atimeMs
        this.mtimeMs = init.mtimeMs
        this.ctimeMs = init.ctimeMs
        this.birthtimeMs = init.birthtimeMs ?? init.ctimeMs
        this.atime = new Date(this.atimeMs)
        this.mtime = new Date(this.mtimeMs)
        this.ctime = new Date(this.ctimeMs)
        this.birthtime = new Date(this.birthtimeMs)
    }

    isFile(): boolean {
        return (this.mode & S_IFMT) === S_IFREG
    }

    isDirectory(): boolean {
        return (this.mode & S_IFMT) === S_IFDIR
    }

    isBlockDevice(): boolean {
        return (this.mode & S_IFMT) === S_IFBLK
    }

    isCharacterDevice(): boolean {
        return (this.mode & S_IFMT) === S_IFCHR
    }

    isSymbolicLink(): boolean {
        return (this.mode & S_IFMT) === S_IFLNK
    }

    isFIFO(): boolean {
        return (this.mode & S_IFMT) === S_IFIFO
    }

    isSocket(): boolean {
        return (this.mode & S_IFMT) === S_IFSOCK
    }

    // For JSON serialization
    toJSON() {
        return {
            __type: 'Stats',
            dev: this.dev,
            ino: this.ino,
            mode: this.mode,
            nlink: this.nlink,
            uid: this.uid,
            gid: this.gid,
            rdev: this.rdev,
            size: this.size,
            blksize: this.blksize,
            blocks: this.blocks,
            atimeMs: this.atimeMs,
            mtimeMs: this.mtimeMs,
            ctimeMs: this.ctimeMs,
            birthtimeMs: this.birthtimeMs
        }
    }

    // Reconstruct from JSON
    static fromJSON(obj: StatsInit & { __type?: string }): Stats {
        return new Stats(obj)
    }
}

// BigInt version for stat({ bigint: true })
export class BigIntStats {
    dev: bigint
    ino: bigint
    mode: bigint
    nlink: bigint
    uid: bigint
    gid: bigint
    rdev: bigint
    size: bigint
    blksize: bigint
    blocks: bigint
    atimeMs: bigint
    mtimeMs: bigint
    ctimeMs: bigint
    birthtimeMs: bigint
    atimeNs: bigint
    mtimeNs: bigint
    ctimeNs: bigint
    birthtimeNs: bigint
    atime: Date
    mtime: Date
    ctime: Date
    birthtime: Date

    constructor(init: StatsInit) {
        this.dev = BigInt(init.dev ?? 0)
        this.ino = BigInt(init.ino ?? 0)
        this.mode = BigInt(init.mode)
        this.nlink = BigInt(init.nlink ?? 1)
        this.uid = BigInt(init.uid)
        this.gid = BigInt(init.gid)
        this.rdev = BigInt(init.rdev ?? 0)
        this.size = BigInt(init.size)
        this.blksize = BigInt(init.blksize ?? 4096)
        this.blocks = BigInt(init.blocks ?? Math.ceil(init.size / 512))
        this.atimeMs = BigInt(Math.floor(init.atimeMs))
        this.mtimeMs = BigInt(Math.floor(init.mtimeMs))
        this.ctimeMs = BigInt(Math.floor(init.ctimeMs))
        this.birthtimeMs = BigInt(Math.floor(init.birthtimeMs ?? init.ctimeMs))
        this.atimeNs = this.atimeMs * 1000000n
        this.mtimeNs = this.mtimeMs * 1000000n
        this.ctimeNs = this.ctimeMs * 1000000n
        this.birthtimeNs = this.birthtimeMs * 1000000n
        this.atime = new Date(Number(this.atimeMs))
        this.mtime = new Date(Number(this.mtimeMs))
        this.ctime = new Date(Number(this.ctimeMs))
        this.birthtime = new Date(Number(this.birthtimeMs))
    }

    isFile(): boolean {
        return (Number(this.mode) & S_IFMT) === S_IFREG
    }

    isDirectory(): boolean {
        return (Number(this.mode) & S_IFMT) === S_IFDIR
    }

    isBlockDevice(): boolean {
        return (Number(this.mode) & S_IFMT) === S_IFBLK
    }

    isCharacterDevice(): boolean {
        return (Number(this.mode) & S_IFMT) === S_IFCHR
    }

    isSymbolicLink(): boolean {
        return (Number(this.mode) & S_IFMT) === S_IFLNK
    }

    isFIFO(): boolean {
        return (Number(this.mode) & S_IFMT) === S_IFIFO
    }

    isSocket(): boolean {
        return (Number(this.mode) & S_IFMT) === S_IFSOCK
    }
}

// Helper to create Stats from VFS metadata
export const createStats = (
    size: number,
    mode: number,
    uid: number,
    gid: number,
    atimeMs: number,
    mtimeMs: number,
    ctimeMs?: number,
    bigint?: boolean
): Stats | BigIntStats => {
    const init: StatsInit = {
        mode,
        uid,
        gid,
        size,
        atimeMs,
        mtimeMs,
        ctimeMs: ctimeMs ?? mtimeMs,
    }

    return bigint ? new BigIntStats(init) : new Stats(init)
}

export default Stats
