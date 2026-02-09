// VFS Watch Listener Operations

import type { WatchListener } from './types'
import { watchListeners } from './state'
import { normalizePath, getBasename, getParentPath } from './path'

// Register a watch listener for a path
export const addWatchListener = (path: string, listener: WatchListener) => {
    const normalizedPath = normalizePath(path)
    if (!watchListeners.has(normalizedPath)) {
        watchListeners.set(normalizedPath, new Set())
    }
    watchListeners.get(normalizedPath)!.add(listener)
}

// Remove a watch listener
export const removeWatchListener = (path: string, listener: WatchListener) => {
    const normalizedPath = normalizePath(path)
    const listeners = watchListeners.get(normalizedPath)
    if (listeners) {
        listeners.delete(listener)
        if (listeners.size === 0) {
            watchListeners.delete(normalizedPath)
        }
    }
}

// Notify all listeners for a path (called when file changes)
export const notifyWatchListeners = (path: string, eventType: 'rename' | 'change') => {
    const normalizedPath = normalizePath(path)
    const filename = getBasename(normalizedPath)

    // Notify exact path listeners
    const listeners = watchListeners.get(normalizedPath)
    if (listeners) {
        for (const listener of listeners) {
            try {
                listener(eventType, filename)
            } catch (e) {
                console.error('[VFS] Watch listener error:', e)
            }
        }
    }

    // Notify parent directory listeners (for recursive watches)
    const parentPath = getParentPath(normalizedPath)
    if (parentPath) {
        const parentListeners = watchListeners.get(parentPath)
        if (parentListeners) {
            for (const listener of parentListeners) {
                try {
                    listener(eventType, filename)
                } catch (e) {
                    console.error('[VFS] Watch listener error:', e)
                }
            }
        }
    }
}
