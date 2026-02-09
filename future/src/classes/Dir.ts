// Node.js fs.Dir class implementation
// https://nodejs.org/api/fs.html#class-fsdir

import { Dirent } from './Dirent'

export interface DirInit {
    path: string
    entries: Dirent[]
}

export class Dir implements AsyncIterable<Dirent> {
    readonly path: string
    #entries: Dirent[]
    #index: number = 0
    #closed: boolean = false

    constructor(init: DirInit) {
        this.path = init.path
        this.#entries = init.entries
    }

    // Async read one entry at a time
    async read(): Promise<Dirent | null> {
        if (this.#closed) {
            throw new Error('Directory handle was closed')
        }

        if (this.#index >= this.#entries.length) {
            return null
        }

        return this.#entries[this.#index++]
    }

    // Sync read one entry at a time
    readSync(): Dirent | null {
        if (this.#closed) {
            throw new Error('Directory handle was closed')
        }

        if (this.#index >= this.#entries.length) {
            return null
        }

        return this.#entries[this.#index++]
    }

    // Close the directory handle
    async close(): Promise<void> {
        this.#closed = true
    }

    // Sync close
    closeSync(): void {
        this.#closed = true
    }

    // Async iterator support
    async *[Symbol.asyncIterator](): AsyncIterableIterator<Dirent> {
        if (this.#closed) {
            throw new Error('Directory handle was closed')
        }

        for (const entry of this.#entries) {
            yield entry
        }
    }

    // For...of support (sync)
    *[Symbol.iterator](): IterableIterator<Dirent> {
        if (this.#closed) {
            throw new Error('Directory handle was closed')
        }

        for (const entry of this.#entries) {
            yield entry
        }
    }
}

export default Dir
