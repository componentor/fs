// File System Access API type declarations

interface FileSystemSyncAccessHandle {
  read(buffer: ArrayBufferView, options?: { at?: number }): number
  write(buffer: ArrayBufferView, options?: { at?: number }): number
  truncate(newSize: number): void
  getSize(): number
  flush(): void
  close(): void
}

interface FileSystemFileHandle {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<File>
  createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>
  createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>
}

interface FileSystemDirectoryHandle {
  readonly kind: 'directory'
  readonly name: string
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
  resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null>
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
  keys(): AsyncIterableIterator<string>
  values(): AsyncIterableIterator<FileSystemHandle>
  [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemHandle]>
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: ArrayBuffer | ArrayBufferView | Blob | string | WriteParams): Promise<void>
  seek(position: number): Promise<void>
  truncate(size: number): Promise<void>
}

interface WriteParams {
  type: 'write' | 'seek' | 'truncate'
  data?: ArrayBuffer | ArrayBufferView | Blob | string
  position?: number
  size?: number
}

type FileSystemHandle = FileSystemFileHandle | FileSystemDirectoryHandle

interface StorageManager {
  getDirectory(): Promise<FileSystemDirectoryHandle>
  estimate(): Promise<StorageEstimate>
  persist(): Promise<boolean>
  persisted(): Promise<boolean>
}

interface Navigator {
  storage: StorageManager
}
