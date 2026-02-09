/**
 * FS Storage Mode Setup
 *
 * This module MUST be imported before fs.polyfill.ts to configure storage mode.
 * It reads the storage mode from URL parameters and configures it before initialization.
 */

import { configure, type StorageMode } from './config'

// Valid storage modes
const validModes: StorageMode[] = ['hybrid', 'vfs-only', 'opfs-only']

/**
 * Get storage mode from URL parameter
 */
export function getStorageModeFromURL(): StorageMode | null {
    if (typeof window === 'undefined') return null

    const url = new URL(window.location.href)
    const mode = url.searchParams.get('storageMode')

    if (mode && validModes.includes(mode as StorageMode)) {
        return mode as StorageMode
    }

    return null
}

/**
 * Initialize storage mode from URL or use default
 */
export function initStorageMode(): StorageMode {
    const urlMode = getStorageModeFromURL()

    if (urlMode) {
        console.log(`[FS Setup] Configuring storage mode from URL: ${urlMode}`)
        configure({ storageMode: urlMode })
        return urlMode
    }

    return 'hybrid'
}

// Auto-initialize on import
const configuredMode = initStorageMode()

export { configuredMode }
export default { initStorageMode, getStorageModeFromURL, configuredMode }
