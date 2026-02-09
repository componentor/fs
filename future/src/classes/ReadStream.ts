// Node.js fs.ReadStream class implementation
// https://nodejs.org/api/fs.html#class-fsreadstream

import { EventEmitter } from 'events'

// Type for async read function (full file)
type ReadFn = (path: string, options?: { start?: number; end?: number }) => Promise<Buffer>

// Type for chunked read function (for streaming large files)
type ReadChunkFn = (path: string, start: number, end: number) => Promise<Buffer>

// Type for getting file size
type GetSizeFn = (path: string) => Promise<number>

let readFileFn: ReadFn | null = null
let readChunkFn: ReadChunkFn | null = null
let getSizeFn: GetSizeFn | null = null

// Threshold for using chunked reads (files larger than 1MB use streaming)
const CHUNKED_READ_THRESHOLD = 1024 * 1024

export const setReadStreamReadFn = (fn: ReadFn) => {
    readFileFn = fn
}

export const setReadStreamChunkFn = (fn: ReadChunkFn) => {
    readChunkFn = fn
}

export const setReadStreamSizeFn = (fn: GetSizeFn) => {
    getSizeFn = fn
}

export interface ReadStreamOptions {
    flags?: string
    encoding?: BufferEncoding | null
    fd?: number | null
    mode?: number
    autoClose?: boolean
    emitClose?: boolean
    start?: number
    end?: number
    highWaterMark?: number
}

export class ReadStream extends EventEmitter {
    readonly path: string
    readonly flags: string
    readonly mode: number
    readonly start?: number
    readonly end?: number
    readonly autoClose: boolean
    readonly bytesRead: number = 0
    readonly pending: boolean = true

    #encoding: BufferEncoding | null
    #highWaterMark: number
    #destroyed: boolean = false
    #reading: boolean = false
    #position: number
    #endPosition: number | undefined

    constructor(path: string, options?: ReadStreamOptions) {
        super()
        this.path = path
        this.flags = options?.flags ?? 'r'
        this.mode = options?.mode ?? 0o666
        this.start = options?.start
        this.end = options?.end
        this.autoClose = options?.autoClose ?? true
        this.#encoding = options?.encoding ?? null
        this.#highWaterMark = options?.highWaterMark ?? 64 * 1024
        this.#position = this.start ?? 0
        this.#endPosition = this.end

        // Start reading on next tick
        setImmediate(() => this.#startReading())
    }

    async #startReading(): Promise<void> {
        if (this.#destroyed || this.#reading) return
        this.#reading = true
        ;(this as { pending: boolean }).pending = false

        try {
            if (!readFileFn) {
                throw new Error('ReadStream read function not initialized')
            }

            // Determine file size and whether to use chunked reading
            let fileSize: number | undefined
            if (getSizeFn && readChunkFn) {
                try {
                    fileSize = await getSizeFn(this.path)
                } catch {
                    // Fall back to non-chunked read if size check fails
                }
            }

            const effectiveEnd = this.end !== undefined ? this.end + 1 : fileSize
            const effectiveStart = this.start ?? 0
            const totalToRead = effectiveEnd !== undefined
                ? effectiveEnd - effectiveStart
                : undefined

            // Use chunked reads for large files (more memory efficient)
            if (
                totalToRead !== undefined &&
                totalToRead > CHUNKED_READ_THRESHOLD &&
                readChunkFn &&
                getSizeFn
            ) {
                await this.#readChunked(effectiveStart, effectiveEnd!)
            } else {
                // Small file or no chunk support - read all at once
                await this.#readFull()
            }
        } catch (err) {
            this.emit('error', err)
            if (this.autoClose) {
                this.destroy()
            }
        }

        this.#reading = false
    }

    // Read file in chunks (memory efficient for large files)
    async #readChunked(start: number, end: number): Promise<void> {
        let position = start

        while (position < end && !this.#destroyed) {
            const chunkEnd = Math.min(position + this.#highWaterMark, end)
            const chunk = await readChunkFn!(this.path, position, chunkEnd)

            position = chunkEnd
            ;(this as { bytesRead: number }).bytesRead += chunk.length

            if (this.#encoding) {
                this.emit('data', chunk.toString(this.#encoding))
            } else {
                this.emit('data', chunk)
            }

            // Allow event loop to process between chunks
            await new Promise(resolve => setImmediate(resolve))
        }

        if (!this.#destroyed) {
            this.emit('end')
            if (this.autoClose) {
                this.destroy()
            }
        }
    }

    // Read entire file at once (for small files)
    async #readFull(): Promise<void> {
        const content = await readFileFn!(this.path, {
            start: this.start,
            end: this.end,
        })

        let buffer = content
        let offset = 0

        while (offset < buffer.length && !this.#destroyed) {
            const chunkSize = Math.min(this.#highWaterMark, buffer.length - offset)
            const chunk = buffer.subarray(offset, offset + chunkSize)
            offset += chunkSize
            ;(this as { bytesRead: number }).bytesRead += chunkSize

            if (this.#encoding) {
                this.emit('data', chunk.toString(this.#encoding))
            } else {
                this.emit('data', chunk)
            }

            // Allow event loop to process between chunks
            await new Promise(resolve => setImmediate(resolve))
        }

        if (!this.#destroyed) {
            this.emit('end')
            if (this.autoClose) {
                this.destroy()
            }
        }
    }

    setEncoding(encoding: BufferEncoding): this {
        this.#encoding = encoding
        return this
    }

    pause(): this {
        // In this simple implementation, we read all at once
        // A full implementation would support pausing mid-read
        return this
    }

    resume(): this {
        return this
    }

    isPaused(): boolean {
        return false
    }

    pipe<T extends NodeJS.WritableStream>(destination: T): T {
        this.on('data', (chunk) => {
            destination.write(chunk)
        })
        this.on('end', () => {
            if ((destination as any).end) {
                (destination as any).end()
            }
        })
        return destination
    }

    unpipe(): this {
        this.removeAllListeners('data')
        return this
    }

    destroy(error?: Error): this {
        if (this.#destroyed) return this
        this.#destroyed = true

        if (error) {
            this.emit('error', error)
        }
        this.emit('close')

        return this
    }

    // Readable stream interface
    read(_size?: number): Buffer | string | null {
        // This implementation uses push mode (events), not pull mode
        return null
    }

    get destroyed(): boolean {
        return this.#destroyed
    }

    // AsyncIterable support
    async *[Symbol.asyncIterator](): AsyncIterableIterator<Buffer | string> {
        const chunks: (Buffer | string)[] = []
        let ended = false
        let error: Error | null = null

        this.on('data', (chunk) => chunks.push(chunk))
        this.on('end', () => { ended = true })
        this.on('error', (err) => { error = err })

        while (!ended && !error) {
            if (chunks.length > 0) {
                yield chunks.shift()!
            } else {
                await new Promise(resolve => setImmediate(resolve))
            }
        }

        // Yield remaining chunks
        while (chunks.length > 0) {
            yield chunks.shift()!
        }

        if (error) {
            throw error
        }
    }
}

export default ReadStream
