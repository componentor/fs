// Shared types for fs polyfill

export interface FileSystemDirectoryHandle {
    kind: 'directory'
    name: string
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>
    getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>
    removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
    resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null>
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>
}

export interface FileSystemFileHandle {
    kind: 'file'
    name: string
    getFile(): Promise<File>
    createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>
}

export interface FileSystemWritableFileStream extends WritableStream {
    write(data: ArrayBuffer | ArrayBufferView | Blob | string): Promise<void>
    seek(position: number): Promise<void>
    truncate(size: number): Promise<void>
    close(): Promise<void>
}

export type FileSystemHandle = FileSystemFileHandle | FileSystemDirectoryHandle

export interface Stats {
    isFile(): boolean
    isDirectory(): boolean
    isSymbolicLink(): boolean
    isBlockDevice(): boolean
    isCharacterDevice(): boolean
    isFIFO(): boolean
    isSocket(): boolean
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
}

export interface Dirent {
    name: string
    isFile(): boolean
    isDirectory(): boolean
    isSymbolicLink(): boolean
    isBlockDevice(): boolean
    isCharacterDevice(): boolean
    isFIFO(): boolean
    isSocket(): boolean
}
