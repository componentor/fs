// VFS Types and Interfaces

export type EventType = 'create' | 'update' | 'delete'

export interface PendingEvent {
    type: EventType
    path: string
    timestamp: number
}

export interface FileMetadata {
    mode: number  // Permission bits (default 0o644 for files, 0o755 for dirs)
    uid: number   // User ID (default 0)
    gid: number   // Group ID (default 0)
    mtime: number // Modification time (ms since epoch)
    atime: number // Access time (ms since epoch)
}

export type WatchListener = (eventType: 'rename' | 'change', filename: string) => void

export interface FileSystemSyncAccessHandle {
    read(buffer: ArrayBuffer | ArrayBufferView, options?: { at?: number }): number
    write(buffer: ArrayBuffer | ArrayBufferView, options?: { at?: number }): number
    getSize(): number
    truncate(newSize: number): void
    flush(): void
    close(): void
}

export interface FileSystemChangeRecord {
    root: FileSystemHandle
    changedHandle: FileSystemHandle
    relativePathComponents: string[]
    relativePathMovedFrom?: string[]  // Present for 'moved' events - the old path
    type: 'appeared' | 'disappeared' | 'modified' | 'moved' | 'unknown' | 'errored'
}

export interface FileSystemObserver {
    observe(handle: FileSystemHandle, options?: { recursive?: boolean }): Promise<void>
    unobserve(handle: FileSystemHandle): void
    disconnect(): void
}

declare global {
    const FileSystemObserver: {
        new(callback: (records: FileSystemChangeRecord[], observer: FileSystemObserver) => void): FileSystemObserver
    }
}

export interface VfsFileEntry {
    offset: number
    size: number
}
