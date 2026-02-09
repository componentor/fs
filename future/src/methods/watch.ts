// watch implementation using VFS watch system

import { EventEmitter } from 'events'
import { addWatchListener, removeWatchListener } from '../fs.vfs'

interface WatchOptions {
    persistent?: boolean
    recursive?: boolean
    encoding?: BufferEncoding
}

interface FSWatcher extends EventEmitter {
    close(): void
    ref(): this
    unref(): this
}

type WatchListener = (eventType: 'rename' | 'change', filename: string) => void

// Creates a watcher that receives events from VFS FileSystemObserver
export const watch = (
    _root: FileSystemDirectoryHandle,
    path: string,
    optionsOrListener?: WatchOptions | BufferEncoding | WatchListener,
    maybeListener?: WatchListener
): FSWatcher => {
    const normalizedPath = path.split('/').filter(p => p.length > 0).join('/')
    const emitter = new EventEmitter() as FSWatcher
    
    // Parse arguments
    let listener: WatchListener | undefined
    if (typeof optionsOrListener === 'function') {
        listener = optionsOrListener
    } else if (typeof maybeListener === 'function') {
        listener = maybeListener
    }
    
    // Internal listener that forwards to EventEmitter
    const internalListener: WatchListener = (eventType, filename) => {
        emitter.emit('change', eventType, filename)
        if (listener) {
            listener(eventType, filename)
        }
    }
    
    // Register with VFS watch system
    addWatchListener(normalizedPath, internalListener)
    
    emitter.close = () => {
        removeWatchListener(normalizedPath, internalListener)
        emitter.removeAllListeners()
    }
    
    emitter.ref = () => emitter
    emitter.unref = () => emitter
    
    return emitter
}

// Sync version (same implementation, watch is inherently async but API is sync)
export const watchSync = watch
