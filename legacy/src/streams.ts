import type { ReadStreamOptions, WriteStreamOptions } from './types.js'

export interface ReadStreamContext {
  readFile(path: string): Promise<Uint8Array>
}

export interface WriteStreamContext {
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, data: Uint8Array): Promise<void>
}

/**
 * Create a ReadableStream for reading file contents
 */
export function createReadStream(
  path: string,
  options: ReadStreamOptions,
  context: ReadStreamContext
): ReadableStream<Uint8Array> {
  const { start = 0, end = Infinity, highWaterMark = 64 * 1024 } = options
  let position = start
  let closed = false
  let cachedData: Uint8Array | null = null

  return new ReadableStream({
    async pull(controller) {
      if (closed) {
        controller.close()
        return
      }

      try {
        // Cache file data on first read - avoid re-reading on every pull
        if (cachedData === null) {
          cachedData = await context.readFile(path)
        }

        const endPos = Math.min(end, cachedData.length)
        const chunk = cachedData.subarray(position, Math.min(position + highWaterMark, endPos))

        if (chunk.length === 0 || position >= endPos) {
          controller.close()
          closed = true
          cachedData = null // Release memory
          return
        }

        position += chunk.length
        controller.enqueue(chunk)
      } catch (err) {
        controller.error(err)
      }
    },
    cancel() {
      closed = true
      cachedData = null // Release memory
    }
  })
}

/**
 * Create a WritableStream for writing file contents
 */
export function createWriteStream(
  path: string,
  options: WriteStreamOptions,
  context: WriteStreamContext
): WritableStream<Uint8Array> {
  const { flags = 'w', start = 0 } = options
  const chunks: Array<{ data: Uint8Array; position: number }> = []
  let position = start

  return new WritableStream({
    async write(chunk) {
      chunks.push({ data: chunk, position })
      position += chunk.length
    },

    async close() {
      // Combine all chunks
      let existingData = new Uint8Array(0)

      if (!flags.includes('w')) {
        try {
          existingData = await context.readFile(path)
        } catch (e) {
          if ((e as { code?: string }).code !== 'ENOENT') throw e
        }
      }

      let maxSize = existingData.length
      for (const { data, position } of chunks) {
        maxSize = Math.max(maxSize, position + data.length)
      }

      const finalData = new Uint8Array(maxSize)

      if (!flags.includes('w')) {
        finalData.set(existingData, 0)
      }

      for (const { data, position } of chunks) {
        finalData.set(data, position)
      }

      await context.writeFile(path, finalData)
    }
  })
}
