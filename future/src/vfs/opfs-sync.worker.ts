// Dedicated worker for background OPFS sync operations
// Receives batches of sync entries and writes/deletes to OPFS asynchronously

export type OpfsSyncType = 'write' | 'delete' | 'mkdir' | 'rmdir'

interface OpfsSyncEntry {
    type: OpfsSyncType
    path: string
    data?: Uint8Array // For writes, the file content
}

let root: FileSystemDirectoryHandle | null = null

const initRoot = async () => {
    root = await navigator.storage.getDirectory()
}

// Process a single sync entry
const processEntry = async (entry: OpfsSyncEntry): Promise<void> => {
    if (!root) await initRoot()
    if (!root) throw new Error('OPFS root not available')

    const parts = entry.path.split('/').filter(p => p.length > 0)
    if (parts.length === 0) return

    switch (entry.type) {
        case 'write': {
            if (!entry.data) return

            // Navigate/create parent directories
            let currentDir = root
            for (let i = 0; i < parts.length - 1; i++) {
                currentDir = await currentDir.getDirectoryHandle(parts[i], { create: true })
            }

            // Write file
            const fileName = parts[parts.length - 1]
            const fileHandle = await currentDir.getFileHandle(fileName, { create: true })
            const writable = await fileHandle.createWritable()
            // Create a copy backed by ArrayBuffer (not SharedArrayBuffer) for FileSystemWritableFileStream
            await writable.write(new Uint8Array(entry.data!).buffer as ArrayBuffer)
            await writable.close()
            break
        }

        case 'delete': {
            try {
                let currentDir = root
                for (let i = 0; i < parts.length - 1; i++) {
                    currentDir = await currentDir.getDirectoryHandle(parts[i])
                }
                const fileName = parts[parts.length - 1]
                await currentDir.removeEntry(fileName)
            } catch {
                // File might not exist, that's ok
            }
            break
        }

        case 'mkdir': {
            let currentDir = root
            for (const part of parts) {
                currentDir = await currentDir.getDirectoryHandle(part, { create: true })
            }
            break
        }

        case 'rmdir': {
            try {
                let currentDir = root
                for (let i = 0; i < parts.length - 1; i++) {
                    currentDir = await currentDir.getDirectoryHandle(parts[i])
                }
                const dirName = parts[parts.length - 1]
                await currentDir.removeEntry(dirName, { recursive: true })
            } catch {
                // Directory might not exist, that's ok
            }
            break
        }
    }
}

// Handle messages from main VFS module
self.onmessage = async (event) => {
    const { type, id, entries } = event.data

    if (type === 'init') {
        await initRoot()
        self.postMessage({ type: 'initialized' })
        return
    }

    if (type === 'process-batch') {
        const results: { path: string; success: boolean; error?: string }[] = []

        for (const entry of entries as OpfsSyncEntry[]) {
            try {
                await processEntry(entry)
                results.push({ path: entry.path, success: true })
            } catch (err) {
                results.push({ path: entry.path, success: false, error: (err as Error).message })
            }
        }

        self.postMessage({ type: 'batch-complete', id, results })
        return
    }
}

self.postMessage({ type: 'ready' })
