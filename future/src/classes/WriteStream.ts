// Node.js fs.WriteStream class implementation
// https://nodejs.org/api/fs.html#class-fswritestream

import { EventEmitter } from 'events'

// Type for async write function
type WriteFn = (path: string, data: Buffer, options?: { flag?: string; start?: number }) => Promise<void>
type AppendFn = (path: string, data: Buffer) => Promise<void>

let writeFileFn: WriteFn | null = null
let appendFileFn: AppendFn | null = null

export const setWriteStreamWriteFn = (fn: WriteFn) => {
    writeFileFn = fn
}

export const setWriteStreamAppendFn = (fn: AppendFn) => {
    appendFileFn = fn
}

export interface WriteStreamOptions {
    flags?: string
    encoding?: BufferEncoding
    fd?: number | null
    mode?: number
    autoClose?: boolean
    emitClose?: boolean
    start?: number
    highWaterMark?: number
}

export class WriteStream extends EventEmitter {
    readonly path: string
    readonly flags: string
    readonly mode: number
    readonly start?: number
    readonly autoClose: boolean
    bytesWritten: number = 0
    readonly pending: boolean = true

    #encoding: BufferEncoding
    #highWaterMark: number
    #destroyed: boolean = false
    #finished: boolean = false
    #writeQueue: Buffer[] = []
    #writing: boolean = false
    #needsDrain: boolean = false
    #isFirstWrite: boolean = true

    constructor(path: string, options?: WriteStreamOptions) {
        super()
        this.path = path
        this.flags = options?.flags ?? 'w'
        this.mode = options?.mode ?? 0o666
        this.start = options?.start
        this.autoClose = options?.autoClose ?? true
        this.#encoding = options?.encoding ?? 'utf8'
        this.#highWaterMark = options?.highWaterMark ?? 64 * 1024

        // Mark as ready on next tick
        setImmediate(() => {
            (this as { pending: boolean }).pending = false
            this.emit('ready')
            this.emit('open')
        })
    }

    write(chunk: string | Buffer, callback?: (err?: Error | null) => void): boolean
    write(chunk: string | Buffer, encoding?: BufferEncoding, callback?: (err?: Error | null) => void): boolean
    write(
        chunk: string | Buffer,
        encodingOrCallback?: BufferEncoding | ((err?: Error | null) => void),
        callback?: (err?: Error | null) => void
    ): boolean {
        if (this.#destroyed || this.#finished) {
            const err = new Error('write after end')
            if (callback) callback(err)
            else if (typeof encodingOrCallback === 'function') encodingOrCallback(err)
            return false
        }

        let encoding = this.#encoding
        let cb = callback

        if (typeof encodingOrCallback === 'function') {
            cb = encodingOrCallback
        } else if (encodingOrCallback) {
            encoding = encodingOrCallback
        }

        const buffer = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : chunk
        this.#writeQueue.push(buffer)

        // Check if we need to signal drain
        const totalQueued = this.#writeQueue.reduce((sum, b) => sum + b.length, 0)
        this.#needsDrain = totalQueued >= this.#highWaterMark

        // Process the write queue
        this.#processQueue(cb)

        return !this.#needsDrain
    }

    async #processQueue(callback?: (err?: Error | null) => void): Promise<void> {
        if (this.#writing || this.#writeQueue.length === 0) {
            if (callback) callback(null)
            return
        }

        this.#writing = true

        try {
            while (this.#writeQueue.length > 0 && !this.#destroyed) {
                const buffer = this.#writeQueue.shift()!

                if (!writeFileFn || !appendFileFn) {
                    throw new Error('WriteStream write function not initialized')
                }

                // First write truncates (if flags='w'), subsequent appends
                if (this.#isFirstWrite && this.flags === 'w') {
                    await writeFileFn(this.path, buffer, { flag: 'w', start: this.start })
                    this.#isFirstWrite = false
                } else {
                    await appendFileFn(this.path, buffer)
                }

                this.bytesWritten += buffer.length
            }

            if (callback) callback(null)

            // Emit drain if we were backed up
            if (this.#needsDrain) {
                this.#needsDrain = false
                this.emit('drain')
            }
        } catch (err) {
            if (callback) callback(err as Error)
            this.emit('error', err)
            if (this.autoClose) {
                this.destroy()
            }
        }

        this.#writing = false
    }

    end(callback?: () => void): this
    end(chunk: string | Buffer, callback?: () => void): this
    end(chunk: string | Buffer, encoding?: BufferEncoding, callback?: () => void): this
    end(
        chunkOrCallback?: string | Buffer | (() => void),
        encodingOrCallback?: BufferEncoding | (() => void),
        callback?: () => void
    ): this {
        if (this.#finished) return this

        let chunk: string | Buffer | undefined
        let cb: (() => void) | undefined

        if (typeof chunkOrCallback === 'function') {
            cb = chunkOrCallback
        } else if (chunkOrCallback !== undefined) {
            chunk = chunkOrCallback
            if (typeof encodingOrCallback === 'function') {
                cb = encodingOrCallback
            } else {
                cb = callback
            }
        }

        const finish = () => {
            this.#finished = true
            this.emit('finish')
            if (this.autoClose) {
                this.destroy()
            }
            if (cb) cb()
        }

        if (chunk !== undefined) {
            this.write(chunk, () => {
                this.#processQueue().then(finish)
            })
        } else {
            this.#processQueue().then(finish)
        }

        return this
    }

    setDefaultEncoding(encoding: BufferEncoding): this {
        this.#encoding = encoding
        return this
    }

    cork(): void {
        // No-op in this implementation
    }

    uncork(): void {
        // No-op in this implementation
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

    get destroyed(): boolean {
        return this.#destroyed
    }

    get writable(): boolean {
        return !this.#destroyed && !this.#finished
    }

    get writableEnded(): boolean {
        return this.#finished
    }

    get writableFinished(): boolean {
        return this.#finished && this.#writeQueue.length === 0
    }

    get writableHighWaterMark(): number {
        return this.#highWaterMark
    }

    get writableLength(): number {
        return this.#writeQueue.reduce((sum, b) => sum + b.length, 0)
    }
}

export default WriteStream
