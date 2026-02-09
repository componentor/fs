// Node.js fs.FileHandle class implementation (promises API)
// https://nodejs.org/api/fs.html#class-filehandle

import { Stats } from './Stats'

// Types for async request function
type AsyncRequestFn = (method: string, args: unknown[]) => Promise<unknown>

let asyncRequestFn: AsyncRequestFn | null = null

export const setFileHandleAsyncRequestFn = (fn: AsyncRequestFn) => {
    asyncRequestFn = fn
}

const asyncRequest = (method: string, args: unknown[]): Promise<unknown> => {
    if (!asyncRequestFn) throw new Error('FileHandle async request function not initialized')
    return asyncRequestFn(method, args)
}

export interface ReadResult {
    bytesRead: number
    buffer: Buffer
}

export interface WriteResult {
    bytesWritten: number
    buffer: Buffer
}

export class FileHandle {
    readonly fd: number
    #closed: boolean = false

    constructor(fd: number) {
        this.fd = fd
    }

    #checkClosed(): void {
        if (this.#closed) {
            throw new Error('file closed')
        }
    }

    async appendFile(data: string | Buffer, options?: { encoding?: string }): Promise<void> {
        this.#checkClosed()
        const encoding = options?.encoding ?? 'utf8'
        const buffer = typeof data === 'string' ? Buffer.from(data, encoding as BufferEncoding) : data
        await asyncRequest('write', [this.fd, buffer, 0, buffer.length, null])
    }

    async chmod(mode: number): Promise<void> {
        this.#checkClosed()
        await asyncRequest('fchmod', [this.fd, mode])
    }

    async chown(uid: number, gid: number): Promise<void> {
        this.#checkClosed()
        await asyncRequest('fchown', [this.fd, uid, gid])
    }

    async close(): Promise<void> {
        if (this.#closed) return
        this.#closed = true
        await asyncRequest('close', [this.fd])
    }

    async datasync(): Promise<void> {
        this.#checkClosed()
        await asyncRequest('fdatasync', [this.fd])
    }

    async read(
        buffer: Buffer,
        offset?: number,
        length?: number,
        position?: number | null
    ): Promise<ReadResult>
    async read(options?: {
        buffer?: Buffer
        offset?: number
        length?: number
        position?: number | null
    }): Promise<ReadResult>
    async read(
        bufferOrOptions?: Buffer | { buffer?: Buffer; offset?: number; length?: number; position?: number | null },
        offset?: number,
        length?: number,
        position?: number | null
    ): Promise<ReadResult> {
        this.#checkClosed()

        let buffer: Buffer
        let off: number
        let len: number
        let pos: number | null

        if (Buffer.isBuffer(bufferOrOptions)) {
            buffer = bufferOrOptions
            off = offset ?? 0
            len = length ?? buffer.length - off
            pos = position ?? null
        } else {
            const opts = bufferOrOptions ?? {}
            buffer = opts.buffer ?? Buffer.alloc(16384)
            off = opts.offset ?? 0
            len = opts.length ?? buffer.length - off
            pos = opts.position ?? null
        }

        const bytesRead = await asyncRequest('read', [this.fd, buffer, off, len, pos]) as number
        return { bytesRead, buffer }
    }

    async readFile(options?: { encoding?: string; flag?: string }): Promise<Buffer | string> {
        this.#checkClosed()
        // Read entire file from current position
        const stat = await this.stat()
        const buffer = Buffer.alloc(stat.size)
        await this.read(buffer, 0, stat.size, 0)

        if (options?.encoding) {
            return buffer.toString(options.encoding as BufferEncoding)
        }
        return buffer
    }

    async readLines(options?: { encoding?: string }): Promise<AsyncIterable<string>> {
        this.#checkClosed()
        const content = await this.readFile({ encoding: options?.encoding ?? 'utf8' }) as string
        const lines = content.split(/\r?\n/)

        return {
            async *[Symbol.asyncIterator]() {
                for (const line of lines) {
                    yield line
                }
            }
        }
    }

    async readv(buffers: Buffer[], position?: number | null): Promise<{ bytesRead: number; buffers: Buffer[] }> {
        this.#checkClosed()
        const bytesRead = await asyncRequest('readv', [this.fd, buffers, position ?? null]) as number
        return { bytesRead, buffers }
    }

    async stat(options?: { bigint?: boolean }): Promise<Stats> {
        this.#checkClosed()
        const result = await asyncRequest('fstat', [this.fd, options])
        return result as Stats
    }

    async sync(): Promise<void> {
        this.#checkClosed()
        await asyncRequest('fsync', [this.fd])
    }

    async truncate(len?: number): Promise<void> {
        this.#checkClosed()
        await asyncRequest('ftruncate', [this.fd, len ?? 0])
    }

    async utimes(atime: number | string | Date, mtime: number | string | Date): Promise<void> {
        this.#checkClosed()
        await asyncRequest('futimes', [this.fd, atime, mtime])
    }

    async write(
        buffer: Buffer,
        offset?: number,
        length?: number,
        position?: number | null
    ): Promise<WriteResult>
    async write(
        data: string,
        position?: number | null,
        encoding?: string
    ): Promise<WriteResult>
    async write(
        bufferOrData: Buffer | string,
        offsetOrPosition?: number | null,
        lengthOrEncoding?: number | string,
        position?: number | null
    ): Promise<WriteResult> {
        this.#checkClosed()

        let buffer: Buffer
        let off: number
        let len: number
        let pos: number | null

        if (Buffer.isBuffer(bufferOrData)) {
            buffer = bufferOrData
            off = (offsetOrPosition as number) ?? 0
            len = (lengthOrEncoding as number) ?? buffer.length - off
            pos = position ?? null
        } else {
            const encoding = (lengthOrEncoding as string) ?? 'utf8'
            buffer = Buffer.from(bufferOrData, encoding as BufferEncoding)
            off = 0
            len = buffer.length
            pos = (offsetOrPosition as number) ?? null
        }

        const bytesWritten = await asyncRequest('write', [this.fd, buffer, off, len, pos]) as number
        return { bytesWritten, buffer }
    }

    async writeFile(data: string | Buffer, options?: { encoding?: string }): Promise<void> {
        this.#checkClosed()
        await this.truncate(0)
        const buffer = typeof data === 'string'
            ? Buffer.from(data, (options?.encoding ?? 'utf8') as BufferEncoding)
            : data
        await this.write(buffer, 0, buffer.length, 0)
    }

    async writev(buffers: Buffer[], position?: number | null): Promise<{ bytesWritten: number; buffers: Buffer[] }> {
        this.#checkClosed()
        const bytesWritten = await asyncRequest('writev', [this.fd, buffers, position ?? null]) as number
        return { bytesWritten, buffers }
    }

    // createReadStream and createWriteStream are omitted - they need stream implementation
}

export default FileHandle
