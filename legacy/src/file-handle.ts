import type { FileHandle, ReadResult, WriteResult, Stats, ReadFileOptions, WriteFileOptions } from './types.js'

export interface FileHandleContext {
  readFile(path: string, options?: ReadFileOptions): Promise<string | Uint8Array>
  writeFile(path: string, data: string | Uint8Array, options?: WriteFileOptions): Promise<void>
  appendFile(path: string, data: string | Uint8Array, options?: WriteFileOptions): Promise<void>
  stat(path: string): Promise<Stats>
  truncate(path: string, len: number): Promise<void>
}

/**
 * Create a FileHandle-like object for the open() method
 */
export function createFileHandle(
  resolvedPath: string,
  initialPosition: number,
  context: FileHandleContext
): FileHandle {
  let position = initialPosition

  return {
    fd: Math.floor(Math.random() * 1000000),

    async read(
      buffer: Uint8Array,
      offset = 0,
      length = buffer.length,
      pos: number | null = null
    ): Promise<ReadResult> {
      const readPos = pos !== null ? pos : position
      const data = await context.readFile(resolvedPath) as Uint8Array
      const bytesToRead = Math.min(length, data.length - readPos)
      buffer.set(data.subarray(readPos, readPos + bytesToRead), offset)
      if (pos === null) position += bytesToRead
      return { bytesRead: bytesToRead, buffer }
    },

    async write(
      buffer: Uint8Array,
      offset = 0,
      length = buffer.length,
      pos: number | null = null
    ): Promise<WriteResult> {
      const writePos = pos !== null ? pos : position
      let existingData = new Uint8Array(0)

      try {
        existingData = await context.readFile(resolvedPath) as Uint8Array
      } catch (e) {
        if ((e as { code?: string }).code !== 'ENOENT') throw e
      }

      const dataToWrite = buffer.subarray(offset, offset + length)
      const newSize = Math.max(existingData.length, writePos + length)
      const newData = new Uint8Array(newSize)
      newData.set(existingData, 0)
      newData.set(dataToWrite, writePos)

      await context.writeFile(resolvedPath, newData)
      if (pos === null) position += length
      return { bytesWritten: length, buffer }
    },

    async close(): Promise<void> {
      // No-op for OPFS
    },

    async stat(): Promise<Stats> {
      return context.stat(resolvedPath)
    },

    async truncate(len = 0): Promise<void> {
      return context.truncate(resolvedPath, len)
    },

    async sync(): Promise<void> {
      // No-op for OPFS (writes are already persisted)
    },

    async datasync(): Promise<void> {
      // No-op for OPFS
    },

    async readFile(options?: ReadFileOptions): Promise<string | Uint8Array> {
      return context.readFile(resolvedPath, options)
    },

    async writeFile(data: string | Uint8Array, options?: WriteFileOptions): Promise<void> {
      return context.writeFile(resolvedPath, data, options)
    },

    async appendFile(data: string | Uint8Array, options?: WriteFileOptions): Promise<void> {
      return context.appendFile(resolvedPath, data, options)
    },

    [Symbol.asyncDispose]: async function(): Promise<void> {
      // No-op for OPFS
    }
  }
}
