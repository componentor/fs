// VFS Init and Lifecycle

import type { EventType, FileSystemChangeRecord } from './types'
import { VFS_FILENAME, setRoot, setVfsFileHandle, setVfsSyncHandle, observer, setObserver, root } from './state'
import { loadIndex } from './index-ops'
import { consumeEvent, disableEventQueuing, checkPathDumpRequest } from './events'
import { syncFileToVfs, removeFileFromVfs } from './sync'
import { notifyWatchListeners } from './watch'

// Map FileSystemObserver types to our event types
const mapChangeType = (type: FileSystemChangeRecord['type']): EventType | 'moved' | null => {
    switch (type) {
        case 'appeared': return 'create'
        case 'modified': return 'update'
        case 'disappeared': return 'delete'
        case 'moved': return 'moved'
        default: return null
    }
}

// Internal: watch OPFS for changes via FileSystemObserver (Chrome 129+ only)
const watchOpfs = async (callback: (records: FileSystemChangeRecord[]) => void) => {
    if (!root) throw new Error('VFS not initialized')

    try {
        const obs = new FileSystemObserver((records) => {
            callback(records)
        })

        await obs.observe(root, { recursive: true })
        setObserver(obs)
    } catch (err) {
        console.warn('[VFS] FileSystemObserver not supported (Firefox/Safari) - external OPFS changes will not be detected automatically. This only affects detection of changes made by other applications; internal fs operations work normally.')
        disableEventQueuing()
    }
}

export const unwatchOpfs = () => {
    observer?.disconnect()
    setObserver(null)
}

export const init = async () => {
    const opfsRoot = await navigator.storage.getDirectory()
    setRoot(opfsRoot)

    const vfsFileHandle = await opfsRoot.getFileHandle(VFS_FILENAME, { create: true })
    setVfsFileHandle(vfsFileHandle)

    const vfsSyncHandle = await (vfsFileHandle as any).createSyncAccessHandle()
    setVfsSyncHandle(vfsSyncHandle)

    // Load existing index from binary
    loadIndex()
    return
    watchOpfs(async records => {
        if (records.length > 0) {
            const paths = records.map(r => r.relativePathComponents.join('/')).join(', ')
            console.log(`[VFS Watcher] Received ${records.length} change(s): ${paths.substring(0, 200)}${paths.length > 200 ? '...' : ''}`)
        }

        for (const record of records) {
            const path = record.relativePathComponents.join('/')

            // Ignore the VFS binary itself
            if (path === VFS_FILENAME) continue

            const eventType = mapChangeType(record.type)
            if (!eventType) continue

            // Handle 'moved' events specially - they have both old and new paths
            if (eventType === 'moved') {
                const oldPath = record.relativePathMovedFrom?.join('/')
                const newPath = path

                // Skip if old path is the VFS binary
                if (oldPath === VFS_FILENAME) continue

                console.log(`[VFS Watcher] Move: ${oldPath} -> ${newPath}`)

                // Remove from old path if we have it
                if (oldPath) {
                    removeFileFromVfs(oldPath)
                    notifyWatchListeners(oldPath, 'rename')
                }

                // Sync at new path (mtime comparison ensures safety)
                try {
                    const result = await syncFileToVfs(newPath)
                    if (result === 'synced') {
                        console.log(`[VFS Watcher] Synced ${newPath} to VFS`)
                    }
                } catch (err) {
                    const errorName = (err as Error).name
                    if (errorName === 'NotFoundError') {
                        console.log(`[VFS Watcher] File ${newPath} no longer exists, skipping sync`)
                    } else if (errorName === 'NotReadableError') {
                        console.log(`[VFS Watcher] File ${newPath} is locked, skipping sync`)
                    } else {
                        console.error(`[VFS Watcher] Error syncing ${newPath}:`, err)
                    }
                }
                notifyWatchListeners(newPath, 'rename')

                continue
            }

            // For create/update: always attempt sync - mtime comparison in syncFileToVfs is 100% safe
            // It will only sync if OPFS mtime >= VFS mtime, preventing stale OPFS from overwriting newer VFS
            // This eliminates the need for unreliable event queue matching
            if (eventType === 'create' || eventType === 'update') {
                try {
                    const result = await syncFileToVfs(path)

                    // Use sync result to determine if this was truly external
                    // - 'synced': OPFS was newer or equal - this is a real external change
                    // - 'skipped_vfs_newer': VFS was newer - this is our internal change, OPFS just caught up
                    if (result === 'synced') {
                        // consumeEvent handles metrics: returns true if internal, false if external
                        const wasOurs = consumeEvent(eventType, path)
                        console.log(`[VFS Watcher] ${wasOurs ? 'Internal' : 'External'} ${eventType}: ${path} (synced to VFS)`)
                    } else if (result === 'skipped_vfs_newer') {
                        // VFS is newer - this is definitely our internal change
                        // Skip external counting since duplicate observer reports for same path are not external
                        consumeEvent(eventType, path, undefined, true)
                    } else if (result === 'skipped_directory') {
                        // Directory event - consume all queued events for this path and children
                        consumeEvent(eventType, path)
                        console.log(`[VFS Watcher] Directory ${eventType}: ${path} (consumed children)`)
                    }
                } catch (err) {
                    const errorName = (err as Error).name
                    // Still consume events even if sync fails - the observer reported this path
                    // Skip external counting since these are known internal events (file was deleted or locked by us)
                    consumeEvent(eventType, path, undefined, true)
                    if (errorName === 'NotFoundError') {
                        console.log(`[VFS Watcher] File ${path} no longer exists, consumed events`)
                    } else if (errorName === 'NotReadableError') {
                        console.log(`[VFS Watcher] File ${path} is locked, consumed events`)
                    } else {
                        console.error(`[VFS Watcher] Error syncing ${path}:`, err)
                    }
                }
            } else if (eventType === 'delete') {
                // consumeEvent handles metrics: returns true if internal, false if external
                const wasOurs = consumeEvent(eventType, path)
                console.log(`[VFS Watcher] ${wasOurs ? 'Internal' : 'External'} ${eventType}: ${path}`)
                // Always remove from VFS - safe because delete is idempotent
                removeFileFromVfs(path)
            }

            // Notify fs.watch listeners (for both internal and external changes)
            const watchEventType = eventType === 'create' || eventType === 'delete' ? 'rename' : 'change'
            notifyWatchListeners(path, watchEventType)
        }

        // Check if main thread requested path dump via SAB (Atomics-based fetch)
        checkPathDumpRequest()
    })
}

export const teardown = async () => {
    unwatchOpfs()
}
