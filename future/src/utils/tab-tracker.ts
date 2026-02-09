/**
 * Tab Tracker - Uses Web Locks + BroadcastChannel to track tabs
 *
 * Each tab holds a unique lock. Primary monitors secondary locks.
 * When a lock is released (tab closed), primary detects it immediately.
 */

const TAB_CHANNEL = 'fs_tab_channel'
const TAB_LOCK_PREFIX = 'fs_tab_'

export interface TabInfo {
    tabId: string
    lockId: string
}

export interface TabTrackerCallbacks {
    onSecondaryConnected: (tab: TabInfo) => void
    onSecondaryDisconnected: (tab: TabInfo) => void
    onPrimaryChanged: () => void
}

let tabId: string
let lockId: string
let channel: BroadcastChannel | null = null
let callbacks: TabTrackerCallbacks | null = null
let isPrimary = false
let trackedTabs: Map<string, { tab: TabInfo; abortController: AbortController }> = new Map()

// Generate unique tab ID
function generateTabId(): string {
    return Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36)
}

/**
 * Initialize the tab tracker
 * Call this before checking for primary
 */
export function initTabTracker(): string {
    tabId = generateTabId()
    lockId = TAB_LOCK_PREFIX + tabId

    // Acquire our own lock (held until tab closes)
    navigator.locks.request(lockId, { mode: 'exclusive' }, () => {
        // This promise never resolves - we hold the lock until tab closes
        return new Promise(() => {})
    })

    // Setup broadcast channel
    channel = new BroadcastChannel(TAB_CHANNEL)
    channel.onmessage = handleBroadcast

    console.log(`[TabTracker] Initialized with tabId: ${tabId}`)
    return tabId
}

/**
 * Set callbacks for tab events
 */
export function setTabTrackerCallbacks(cbs: TabTrackerCallbacks) {
    callbacks = cbs
}

/**
 * Called when this tab becomes primary
 */
export function becomePrimary() {
    isPrimary = true
    console.log('[TabTracker] Becoming primary, broadcasting...')

    // Broadcast that we're the new primary
    channel?.postMessage({ type: 'new-primary', tabId })
}

/**
 * Called when this tab is secondary and needs to announce to primary
 */
export function announceToCurrentPrimary() {
    if (isPrimary) return

    console.log('[TabTracker] Announcing to primary...')
    channel?.postMessage({ type: 'secondary-announce', tabId, lockId })
}

/**
 * Handle broadcast messages
 */
function handleBroadcast(event: MessageEvent) {
    const { type, tabId: senderTabId, lockId: senderLockId } = event.data

    if (type === 'new-primary') {
        console.log(`[TabTracker] New primary announced: ${senderTabId}`)

        if (!isPrimary && senderTabId !== tabId) {
            // Re-announce ourselves to the new primary
            setTimeout(() => {
                channel?.postMessage({ type: 'secondary-announce', tabId, lockId })
            }, 100)
        }

        callbacks?.onPrimaryChanged()
    }

    if (type === 'secondary-announce' && isPrimary) {
        console.log(`[TabTracker] Secondary announced: ${senderTabId}`)

        // Don't track ourselves
        if (senderTabId === tabId) return

        // Already tracking this tab?
        if (trackedTabs.has(senderTabId)) return

        const tabInfo: TabInfo = { tabId: senderTabId, lockId: senderLockId }

        // Start monitoring this secondary's lock
        monitorSecondaryLock(tabInfo)

        callbacks?.onSecondaryConnected(tabInfo)
    }

    if (type === 'request-announce' && !isPrimary) {
        // Primary is requesting all secondaries to announce
        channel?.postMessage({ type: 'secondary-announce', tabId, lockId })
    }
}

/**
 * Monitor a secondary tab's lock - when we acquire it, the tab is gone
 */
function monitorSecondaryLock(tab: TabInfo) {
    const abortController = new AbortController()
    trackedTabs.set(tab.tabId, { tab, abortController })

    console.log(`[TabTracker] Monitoring lock for tab: ${tab.tabId}`)

    // Try to acquire the secondary's lock
    // This will only succeed when they release it (close tab)
    navigator.locks.request(
        tab.lockId,
        { mode: 'exclusive', signal: abortController.signal },
        () => {
            // We got the lock! Secondary is gone
            console.log(`[TabTracker] Tab ${tab.tabId} disconnected (lock released)`)
            trackedTabs.delete(tab.tabId)
            callbacks?.onSecondaryDisconnected(tab)

            // Release immediately
            return Promise.resolve()
        }
    ).catch(err => {
        // AbortError is expected when we stop tracking
        if (err.name !== 'AbortError') {
            console.error(`[TabTracker] Error monitoring lock for ${tab.tabId}:`, err)
        }
    })
}

/**
 * Stop tracking all secondaries (called when demoted from primary)
 */
export function stopTrackingAll() {
    console.log(`[TabTracker] Stopping tracking of ${trackedTabs.size} tabs`)
    for (const [, { abortController }] of trackedTabs) {
        abortController.abort()
    }
    trackedTabs.clear()
    isPrimary = false
}

/**
 * Request all secondaries to announce themselves
 */
export function requestAllAnnounce() {
    channel?.postMessage({ type: 'request-announce' })
}

/**
 * Get current tab ID
 */
export function getTabId(): string {
    return tabId
}

/**
 * Get number of tracked secondaries
 */
export function getTrackedCount(): number {
    return trackedTabs.size
}

/**
 * Cleanup on tab close
 */
export function cleanup() {
    stopTrackingAll()
    channel?.close()
    channel = null
}
