// VFS Index Load/Save Operations

import { INDEX_HEADER_SIZE, vfsIndex, vfsDirIndex, vfsSymlinkIndex, vfsMetadataIndex, vfsSyncHandle } from './state'
import { compactSync } from './compact'

// Index save batching configuration
const INDEX_SAVE_DEBOUNCE_MS = 50 // Debounce saves for 50ms

// Batching state
let indexDirty = false
let indexSaveTimer: ReturnType<typeof setTimeout> | null = null
let indexFirstDirtyTime: number | null = null

// Metrics
export const indexSaveMetrics = {
    totalSaves: 0,
    batchedSaves: 0, // Saves that were batched (not immediate)
    lastSaveTime: 0,
}

// Load index from VFS binary
export const loadIndex = () => {
    if (!vfsSyncHandle) return

    const size = vfsSyncHandle.getSize()
    if (size < INDEX_HEADER_SIZE) return

    const headerBuffer = new ArrayBuffer(INDEX_HEADER_SIZE)
    vfsSyncHandle.read(new Uint8Array(headerBuffer), { at: 0 })
    const indexSize = new DataView(headerBuffer).getUint32(0)

    if (indexSize === 0 || indexSize > size - INDEX_HEADER_SIZE) {
        return
    }

    // Validate index size is reasonable (max 10MB for index)
    if (indexSize > 10 * 1024 * 1024) {
        console.error('[VFS] Index size too large:', indexSize, '- possible corruption')
        return
    }

    const indexBuffer = new Uint8Array(indexSize)
    vfsSyncHandle.read(indexBuffer, { at: INDEX_HEADER_SIZE })

    const indexJson = new TextDecoder().decode(indexBuffer)

    // Handle empty or invalid JSON gracefully
    if (!indexJson || indexJson.trim() === '') {
        console.warn('[VFS] Empty index data, starting fresh')
        return
    }

    let parsed: any
    try {
        parsed = JSON.parse(indexJson)
    } catch (err) {
        console.warn('[VFS] Failed to parse index JSON, starting fresh:', err)
        return
    }

    vfsIndex.clear()
    vfsDirIndex.clear()
    vfsSymlinkIndex.clear()
    vfsMetadataIndex.clear()

    // Support both old format (array) and new format (object with files/dirs/symlinks/metadata)
    if (Array.isArray(parsed)) {
        // Old format: just file entries
        for (const [path, entry] of parsed as Array<[string, { offset: number; size: number }]>) {
            vfsIndex.set(path, entry)
        }
    } else {
        // New format: { files: [...], dirs: [...], symlinks: [...], metadata: [...] }
        for (const [path, entry] of parsed.files || []) {
            vfsIndex.set(path, entry)
        }
        for (const dir of parsed.dirs || []) {
            vfsDirIndex.add(dir)
        }
        for (const [path, target] of parsed.symlinks || []) {
            vfsSymlinkIndex.set(path, target)
        }
        for (const [path, meta] of parsed.metadata || []) {
            vfsMetadataIndex.set(path, meta)
        }
    }
}

// Internal: Actually perform the index save
const performIndexSave = () => {
    if (!vfsSyncHandle) return

    const indexData = {
        files: Array.from(vfsIndex.entries()),
        dirs: Array.from(vfsDirIndex),
        symlinks: Array.from(vfsSymlinkIndex.entries()),
        metadata: Array.from(vfsMetadataIndex.entries()),
    }
    const indexJson = JSON.stringify(indexData)
    const indexBytes = new TextEncoder().encode(indexJson)
    const newIndexEnd = INDEX_HEADER_SIZE + indexBytes.length

    // Find minimum file data offset to check for overflow
    let minFileOffset = Infinity
    for (const { offset } of vfsIndex.values()) {
        if (offset < minFileOffset) {
            minFileOffset = offset
        }
    }

    // If new index would overflow into file data, compact instead
    if (minFileOffset !== Infinity && newIndexEnd > minFileOffset) {
        compactSync()
        return
    }

    const headerBuffer = new ArrayBuffer(INDEX_HEADER_SIZE)
    new DataView(headerBuffer).setUint32(0, indexBytes.length)

    vfsSyncHandle.write(new Uint8Array(headerBuffer), { at: 0 })
    vfsSyncHandle.write(indexBytes, { at: INDEX_HEADER_SIZE })
    vfsSyncHandle.flush()

    // Update metrics
    indexSaveMetrics.totalSaves++
    indexSaveMetrics.lastSaveTime = Date.now()

    // Reset dirty state
    indexDirty = false
    indexFirstDirtyTime = null
}

// Clear the save timer
const clearIndexSaveTimer = () => {
    if (indexSaveTimer) {
        clearTimeout(indexSaveTimer)
        indexSaveTimer = null
    }
}

// Schedule a batched index save
const scheduleIndexSave = () => {
    // If a timer is already scheduled, let it run - don't reschedule
    // This prevents indexFirstDirtyTime from accumulating indefinitely during rapid operations
    // The timer will fire every INDEX_SAVE_DEBOUNCE_MS and reset the dirty time
    if (indexSaveTimer) {
        return
    }

    // Track when we first became dirty (only when scheduling a new timer)
    indexFirstDirtyTime = Date.now()

    // Schedule the save
    indexSaveTimer = setTimeout(() => {
        indexSaveTimer = null
        indexSaveMetrics.batchedSaves++
        performIndexSave()
    }, INDEX_SAVE_DEBOUNCE_MS)
}

// Save index to VFS binary (batched - defers actual save)
export const saveIndex = () => {
    if (!vfsSyncHandle) return

    indexDirty = true
    scheduleIndexSave()
}

// Force immediate index save (for explicit flush or before shutdown)
export const flushIndex = () => {
    if (!vfsSyncHandle || !indexDirty) return

    clearIndexSaveTimer()
    performIndexSave()
}

// Check if index has unsaved changes
export const isIndexDirty = () => indexDirty
