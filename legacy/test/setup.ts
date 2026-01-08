// Mock OPFS APIs for testing

interface MockFile {
  size: number
  lastModified: number
  arrayBuffer: () => Promise<ArrayBuffer>
  text: () => Promise<string>
}

interface MockWritable {
  write: (data: ArrayBufferLike | Uint8Array) => Promise<void>
  close: () => Promise<void>
}

interface MockSyncAccessHandle {
  getSize: () => number
  read: (buffer: Uint8Array) => number
  write: (data: Uint8Array, options?: { at?: number }) => number
  truncate: (size: number) => void
  close: () => void
}

type MockHandle = MockFileSystemFileHandle | MockFileSystemDirectoryHandle

class MockFileSystemFileHandle {
  readonly kind = 'file' as const
  readonly name: string
  _content: Uint8Array
  _lastModified: number

  constructor(name: string, content: Uint8Array = new Uint8Array()) {
    this.name = name
    this._content = content
    this._lastModified = Date.now()
  }

  async getFile(): Promise<MockFile> {
    return {
      size: this._content.length,
      lastModified: this._lastModified,
      arrayBuffer: async () => this._content.buffer,
      text: async () => new TextDecoder().decode(this._content)
    }
  }

  async createWritable(): Promise<MockWritable> {
    return {
      write: async (data: ArrayBufferLike | Uint8Array) => {
        this._content = new Uint8Array(data as ArrayBuffer)
        this._lastModified = Date.now()
      },
      close: async () => {}
    }
  }

  async createSyncAccessHandle(): Promise<MockSyncAccessHandle> {
    const handle = this
    return {
      getSize: () => handle._content.length,
      read: (buffer: Uint8Array, options: { at?: number } = {}) => {
        const at = options.at || 0
        const bytesToRead = Math.min(buffer.length, handle._content.length - at)
        buffer.set(handle._content.subarray(at, at + bytesToRead))
        return bytesToRead
      },
      write: (data: Uint8Array, options: { at?: number } = {}) => {
        const at = options.at || 0
        if (at + data.length > handle._content.length) {
          const newContent = new Uint8Array(at + data.length)
          newContent.set(handle._content)
          handle._content = newContent
        }
        handle._content.set(data, at)
        handle._lastModified = Date.now()
        return data.length
      },
      truncate: (size: number) => {
        // Preserve existing data up to the truncation point
        const newContent = new Uint8Array(size)
        const copyLen = Math.min(size, handle._content.length)
        for (let i = 0; i < copyLen; i++) {
          newContent[i] = handle._content[i]
        }
        handle._content = newContent
      },
      close: () => {}
    }
  }
}

class MockFileSystemDirectoryHandle {
  readonly kind = 'directory' as const
  readonly name: string
  _entries: Map<string, MockHandle> = new Map()

  constructor(name: string) {
    this.name = name
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<MockFileSystemFileHandle> {
    if (this._entries.has(name)) {
      const entry = this._entries.get(name)!
      if (entry.kind === 'file') return entry as MockFileSystemFileHandle
      throw new DOMException('TypeMismatchError')
    }
    if (options.create) {
      const handle = new MockFileSystemFileHandle(name)
      this._entries.set(name, handle)
      return handle
    }
    throw new DOMException('NotFoundError')
  }

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<MockFileSystemDirectoryHandle> {
    if (this._entries.has(name)) {
      const entry = this._entries.get(name)!
      if (entry.kind === 'directory') return entry as MockFileSystemDirectoryHandle
      throw new DOMException('TypeMismatchError')
    }
    if (options.create) {
      const handle = new MockFileSystemDirectoryHandle(name)
      this._entries.set(name, handle)
      return handle
    }
    throw new DOMException('NotFoundError')
  }

  async removeEntry(name: string, options: { recursive?: boolean } = {}): Promise<void> {
    if (!this._entries.has(name)) {
      throw new DOMException('NotFoundError')
    }
    const entry = this._entries.get(name)!
    if (entry.kind === 'directory' && (entry as MockFileSystemDirectoryHandle)._entries.size > 0 && !options.recursive) {
      throw new DOMException('InvalidModificationError')
    }
    this._entries.delete(name)
  }

  async *entries(): AsyncGenerator<[string, MockHandle]> {
    for (const [name, handle] of this._entries) {
      yield [name, handle]
    }
  }
}

// Extend global types
declare global {
  // eslint-disable-next-line no-var
  var FileSystemFileHandle: typeof MockFileSystemFileHandle
  // eslint-disable-next-line no-var
  var FileSystemDirectoryHandle: typeof MockFileSystemDirectoryHandle
  // eslint-disable-next-line no-var
  var resetFileSystem: () => void

  interface Navigator {
    storage: {
      getDirectory: () => Promise<MockFileSystemDirectoryHandle>
      estimate: () => Promise<{ usage: number; quota: number }>
    }
  }
}

// Setup global mocks
globalThis.FileSystemFileHandle = MockFileSystemFileHandle as unknown as typeof globalThis.FileSystemFileHandle
globalThis.FileSystemDirectoryHandle = MockFileSystemDirectoryHandle as unknown as typeof globalThis.FileSystemDirectoryHandle

const rootHandle = new MockFileSystemDirectoryHandle('root')

// @ts-expect-error - mock navigator
globalThis.navigator = {
  storage: {
    getDirectory: async () => rootHandle,
    estimate: async () => ({ usage: 1024 * 1024 * 50, quota: 1024 * 1024 * 1024 * 10 }) // 50MB used, 10GB quota
  }
}

// Reset the root directory before each test
export function resetFileSystem(): void {
  rootHandle._entries.clear()
}

// Make resetFileSystem available globally
globalThis.resetFileSystem = resetFileSystem

// Note: CompressionStream/DecompressionStream are NOT globally mocked here
// The packed-storage constructor checks for API availability and disables compression if not found
// Compression tests provide their own mock within the test file
