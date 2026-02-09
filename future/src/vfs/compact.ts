// VFS Compaction Operations with Smart Scheduling

import {
    INDEX_HEADER_SIZE,
    vfsIndex,
    vfsDirIndex,
    vfsSymlinkIndex,
    vfsMetadataIndex,
    vfsSyncHandle,
    resetWastedBytes,
    getWastedBytes,
    COMPACTION_THRESHOLD,
    COMPACTION_URGENT_THRESHOLD,
    COMPACTION_DEBOUNCE_MS,
    COMPACTION_IDLE_TIMEOUT_MS,
    compactionMetrics,
    isCompactionScheduled,
    setCompactionScheduled,
    clearCompactionTimers,
    setCompactionDebounceTimer,
    setCompactionIdleCallback,
} from './state'

// Internal compaction implementation
function performCompaction(): number {
    if (!vfsSyncHandle) return 0

    const startTime = performance.now()
    const wastedBefore = getWastedBytes()

    // Read all current file data
    const files: Array<{ path: string; data: Uint8Array }> = []

    for (const [path, { offset, size }] of vfsIndex) {
        // Validate entry before creating typed array
        if (typeof size !== 'number' || size < 0 || !Number.isFinite(size) || !Number.isInteger(size)) {
            throw new Error(`Invalid file size in vfsIndex: ${size} for path: ${path}`)
        }

        const buffer = new Uint8Array(size)
        vfsSyncHandle.read(buffer, { at: offset })
        files.push({ path, data: buffer })
    }

    // Preserve directories, symlinks, and metadata
    const dirs = Array.from(vfsDirIndex)
    const symlinks = Array.from(vfsSymlinkIndex.entries())
    const metadata = Array.from(vfsMetadataIndex.entries())

    // Calculate index size iteratively (same approach as syncOpfsToVfs)
    // The index contains file offsets which depend on index size,
    // and index size depends on the string length of those offsets
    let indexSize = 0
    let iterations = 0
    const maxIterations = 10

    while (iterations < maxIterations) {
        iterations++
        const headerSize = INDEX_HEADER_SIZE + indexSize

        // Calculate offsets with current header size estimate
        vfsIndex.clear()
        let offset = headerSize
        for (const { path, data } of files) {
            vfsIndex.set(path, { offset, size: data.length })
            offset += data.length
        }

        // Generate index JSON and measure its size
        const indexData = {
            files: Array.from(vfsIndex.entries()),
            dirs,
            symlinks,
            metadata,
        }
        const indexJson = JSON.stringify(indexData)
        const indexBytes = new TextEncoder().encode(indexJson)
        const newIndexSize = indexBytes.length

        if (newIndexSize === indexSize) {
            // Converged - write the data
            const headerBuffer = new ArrayBuffer(INDEX_HEADER_SIZE)
            new DataView(headerBuffer).setUint32(0, indexBytes.length)
            vfsSyncHandle.write(new Uint8Array(headerBuffer), { at: 0 })
            vfsSyncHandle.write(indexBytes, { at: INDEX_HEADER_SIZE })
            break
        }

        indexSize = newIndexSize
    }

    if (iterations >= maxIterations) {
        throw new Error('Failed to converge index size calculation during compaction')
    }

    // Write file data
    let writeOffset = INDEX_HEADER_SIZE + indexSize
    for (const { data } of files) {
        vfsSyncHandle.write(data, { at: writeOffset })
        writeOffset += data.length
    }

    // Truncate excess
    vfsSyncHandle.truncate(writeOffset)
    vfsSyncHandle.flush()

    resetWastedBytes()

    // Update metrics
    const duration = performance.now() - startTime
    compactionMetrics.totalCompactions++
    compactionMetrics.totalBytesReclaimed += wastedBefore
    compactionMetrics.lastCompactionTime = Date.now()
    compactionMetrics.lastCompactionDuration = duration

    console.log(`[VFS] Compacted to ${writeOffset} bytes (reclaimed ${wastedBefore} bytes in ${duration.toFixed(1)}ms)`)

    return wastedBefore
}

// Sync version of compact - runs immediately
export const compactSync = () => {
    clearCompactionTimers()
    setCompactionScheduled(false)
    performCompaction()
}

// Async version of compact - runs immediately
export const compact = async () => {
    clearCompactionTimers()
    setCompactionScheduled(false)
    performCompaction()
}

// Schedule compaction with debouncing and idle callback
// This is the preferred way to trigger compaction from write operations
export const scheduleCompaction = () => {
    const wasted = getWastedBytes()

    // If wasted space is extremely high, compact immediately
    if (wasted >= COMPACTION_URGENT_THRESHOLD) {
        compactionMetrics.urgentCompactions++
        compactSync()
        return
    }

    // If below threshold, don't schedule
    if (wasted < COMPACTION_THRESHOLD) {
        return
    }

    // If already scheduled, just reset the debounce timer
    if (isCompactionScheduled()) {
        clearCompactionTimers()
    }

    setCompactionScheduled(true)
    compactionMetrics.scheduledCompactions++

    // Debounce: wait for activity to settle
    const debounceTimer = setTimeout(() => {
        // Try to use requestIdleCallback for non-blocking compaction
        if (typeof requestIdleCallback !== 'undefined') {
            const idleCallback = requestIdleCallback(
                (deadline) => {
                    // Only compact if we have enough idle time or timeout expired
                    if (deadline.timeRemaining() > 10 || deadline.didTimeout) {
                        setCompactionScheduled(false)
                        performCompaction()
                    } else {
                        // Not enough idle time, reschedule
                        scheduleCompaction()
                    }
                },
                { timeout: COMPACTION_IDLE_TIMEOUT_MS }
            )
            setCompactionIdleCallback(idleCallback)
        } else {
            // No requestIdleCallback, use setTimeout as fallback
            setTimeout(() => {
                setCompactionScheduled(false)
                performCompaction()
            }, 0)
        }
    }, COMPACTION_DEBOUNCE_MS)

    setCompactionDebounceTimer(debounceTimer)
}

// Check if compaction should be scheduled (call this after writes/deletes)
export const maybeScheduleCompaction = () => {
    const wasted = getWastedBytes()

    if (wasted >= COMPACTION_URGENT_THRESHOLD) {
        // Urgent: compact immediately
        compactionMetrics.urgentCompactions++
        compactSync()
    } else if (wasted >= COMPACTION_THRESHOLD && !isCompactionScheduled()) {
        // Schedule for later
        scheduleCompaction()
    }
}

// Get compaction status and metrics
export const getCompactionStatus = () => ({
    scheduled: isCompactionScheduled(),
    wastedBytes: getWastedBytes(),
    threshold: COMPACTION_THRESHOLD,
    urgentThreshold: COMPACTION_URGENT_THRESHOLD,
    ...compactionMetrics,
})
