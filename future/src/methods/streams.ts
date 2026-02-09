// Node.js fs.createReadStream / fs.createWriteStream implementation
// https://nodejs.org/api/fs.html#fscreatereadstreampath-options

import { ReadStream, WriteStream } from '../classes'
import type { ReadStreamOptions, WriteStreamOptions } from '../classes'

// createReadStream - create a readable stream for a file
export const createReadStream = (
    path: string,
    options?: ReadStreamOptions | string
): ReadStream => {
    const opts: ReadStreamOptions = typeof options === 'string'
        ? { encoding: options as BufferEncoding }
        : options ?? {}

    return new ReadStream(path, opts)
}

// createWriteStream - create a writable stream for a file
export const createWriteStream = (
    path: string,
    options?: WriteStreamOptions | string
): WriteStream => {
    const opts: WriteStreamOptions = typeof options === 'string'
        ? { encoding: options as BufferEncoding }
        : options ?? {}

    return new WriteStream(path, opts)
}

export default { createReadStream, createWriteStream }
