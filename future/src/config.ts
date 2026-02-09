/**
 * FS Polyfill Configuration
 * Manages storage modes and other configuration options
 */

import type { LoggerConfig } from './logger'

/**
 * Storage mode determines how sync and async operations are handled
 *
 * - 'hybrid' (default): Sync uses VFS binary file (single persistent OPFS file), async uses OPFS native structure
 * - 'vfs-only': Both sync and async use VFS binary file (async wraps sync)
 * - 'opfs-only': Both use OPFS native directory/file structure (sync uses SAB+async internally)
 */
export type StorageMode = 'hybrid' | 'vfs-only' | 'opfs-only'

/**
 * Full FS polyfill configuration
 */
export interface FsConfig {
    /**
     * Storage mode - must be set before initialization
     */
    storageMode: StorageMode

    /**
     * Logging configuration
     */
    logging: LoggerConfig
}

/**
 * Default configuration
 */
export const defaultConfig: FsConfig = {
    storageMode: 'hybrid',
    logging: {
        enabled: false,
        level: 'info',
        console: true,
        buffer: false,
        bufferSize: 1000,
    },
}

// Current configuration state
let config: FsConfig = { ...defaultConfig, logging: { ...defaultConfig.logging } }
let initialized = false

/**
 * Configure the FS polyfill
 * Must be called before any fs operation for storage mode to take effect
 */
export function configure(options: Partial<FsConfig>): void {
    if (initialized && options.storageMode !== undefined && options.storageMode !== config.storageMode) {
        console.warn(
            '[FS Config] storageMode cannot be changed after initialization. ' +
            `Current mode: ${config.storageMode}, requested: ${options.storageMode}`
        )
        // Still allow other options to be updated
        const { storageMode, ...rest } = options
        options = rest
    }

    if (options.storageMode !== undefined) {
        config.storageMode = options.storageMode
    }

    if (options.logging !== undefined) {
        config.logging = { ...config.logging, ...options.logging }
    }
}

/**
 * Get current configuration
 */
export function getConfig(): FsConfig {
    return {
        ...config,
        logging: { ...config.logging },
    }
}

/**
 * Get current storage mode
 */
export function getStorageMode(): StorageMode {
    return config.storageMode
}

/**
 * Mark the polyfill as initialized
 * After this, storage mode cannot be changed
 */
export function markInitialized(): void {
    initialized = true
}

/**
 * Check if the polyfill has been initialized
 */
export function isInitialized(): boolean {
    return initialized
}

/**
 * Reset configuration (mainly for testing)
 */
export function resetConfig(): void {
    config = { ...defaultConfig, logging: { ...defaultConfig.logging } }
    initialized = false
}

/**
 * Storage mode descriptions for help/documentation
 */
export const storageModeDescriptions: Record<StorageMode, string> = {
    'hybrid': 'Sync operations use VFS binary file (single persistent OPFS file), async operations use OPFS native structure. Best performance for mixed workloads.',
    'vfs-only': 'All operations use VFS binary file. Async methods wrap sync operations. Single file contains entire filesystem state.',
    'opfs-only': 'All operations use OPFS native directory/file structure directly. Sync methods use SAB with async OPFS internally. No VFS binary file.',
}

export default {
    configure,
    getConfig,
    getStorageMode,
    markInitialized,
    isInitialized,
    resetConfig,
    storageModeDescriptions,
}
