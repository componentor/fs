/**
 * FS Polyfill Logger
 * Provides verbose logging with timestamps, incremental IDs, and duration tracking
 */

export type LogLevel = 'none' | 'info' | 'verbose' | 'debug'

export interface LogEntry {
    id: number
    timestamp: number      // performance.now() relative to start
    absoluteTime: number   // Date.now() for absolute timing
    method: string
    args: any[]
    duration?: number
    result?: 'success' | 'error'
    error?: string
    worker?: 'main' | 'sync' | 'async'
}

export interface LoggerConfig {
    enabled: boolean
    level: LogLevel
    methods?: string[]     // Filter specific methods (empty/undefined = all)
    console: boolean       // Log to console
    buffer: boolean        // Store in memory buffer
    bufferSize: number     // Max entries to keep in buffer
}

export interface LogHandle {
    id: number
    startTime: number
    method: string
    args: any[]
    worker: 'main' | 'sync' | 'async'
}

// Default configuration
const defaultConfig: LoggerConfig = {
    enabled: false,
    level: 'info',
    console: true,
    buffer: false,
    bufferSize: 1000,
}

// Logger state
let config: LoggerConfig = { ...defaultConfig }
let entries: LogEntry[] = []
let nextId = 1
let startTimestamp = performance.now()

/**
 * Format log ID with padding
 */
function formatId(id: number): string {
    return id.toString().padStart(3, '0')
}

/**
 * Format timestamp with ms precision
 */
function formatTimestamp(timestamp: number): string {
    return `+${timestamp.toFixed(2)}ms`.padStart(12)
}

/**
 * Format args for display (truncate long strings)
 */
function formatArgs(args: any[]): string {
    return args.map(arg => {
        if (typeof arg === 'string') {
            return arg.length > 50 ? `"${arg.slice(0, 47)}..."` : `"${arg}"`
        }
        if (arg instanceof Uint8Array || arg instanceof ArrayBuffer) {
            const len = arg instanceof Uint8Array ? arg.length : arg.byteLength
            return `<Buffer ${len} bytes>`
        }
        if (typeof arg === 'object' && arg !== null) {
            const str = JSON.stringify(arg)
            return str.length > 30 ? `${str.slice(0, 27)}...` : str
        }
        return String(arg)
    }).join(', ')
}

/**
 * Check if method should be logged based on filter
 */
function shouldLog(method: string): boolean {
    if (!config.enabled) return false
    if (!config.methods || config.methods.length === 0) return true
    return config.methods.includes(method)
}

/**
 * Log to console with formatting
 */
function logToConsole(entry: LogEntry, phase: 'START' | 'END'): void {
    if (!config.console) return

    const prefix = `[FS:${formatId(entry.id)} ${formatTimestamp(entry.timestamp)}]`
    const methodStr = `${entry.method}(${formatArgs(entry.args)})`
    const workerTag = entry.worker !== 'main' ? ` [${entry.worker}]` : ''

    if (phase === 'START') {
        console.log(`%c${prefix} ${methodStr} START${workerTag}`, 'color: #888')
    } else {
        const duration = entry.duration !== undefined ? ` (${entry.duration.toFixed(2)}ms)` : ''
        const status = entry.result === 'success' ? '✓' : '✗'
        const color = entry.result === 'success' ? 'color: #4a4' : 'color: #a44'
        const errorMsg = entry.error ? ` - ${entry.error}` : ''
        console.log(`%c${prefix} ${methodStr} END${duration} ${status}${errorMsg}`, color)
    }
}

/**
 * Add entry to buffer
 */
function addToBuffer(entry: LogEntry): void {
    if (!config.buffer) return

    entries.push(entry)

    // Trim buffer if too large
    if (entries.length > config.bufferSize) {
        entries = entries.slice(-config.bufferSize)
    }
}

/**
 * Start logging an operation
 */
export function logStart(method: string, args: any[], worker: 'main' | 'sync' | 'async' = 'main'): LogHandle | null {
    if (!shouldLog(method)) return null

    const id = nextId++
    const startTime = performance.now()
    const timestamp = startTime - startTimestamp

    const handle: LogHandle = { id, startTime, method, args, worker }

    if (config.level === 'verbose' || config.level === 'debug') {
        const entry: LogEntry = {
            id,
            timestamp,
            absoluteTime: Date.now(),
            method,
            args,
            worker,
        }
        logToConsole(entry, 'START')
    }

    return handle
}

/**
 * End logging an operation
 */
export function logEnd(handle: LogHandle | null, result: 'success' | 'error' = 'success', error?: string): void {
    if (!handle) return

    const endTime = performance.now()
    const duration = endTime - handle.startTime
    const timestamp = endTime - startTimestamp

    const entry: LogEntry = {
        id: handle.id,
        timestamp,
        absoluteTime: Date.now(),
        method: handle.method,
        args: handle.args,
        duration,
        result,
        error,
        worker: handle.worker,
    }

    logToConsole(entry, 'END')
    addToBuffer(entry)
}

/**
 * Logger API
 */
export const logger = {
    /**
     * Enable logging
     */
    enable(): void {
        config.enabled = true
        startTimestamp = performance.now()
        console.log('%c[FS Logger] Enabled', 'color: #4a4; font-weight: bold')
    },

    /**
     * Disable logging
     */
    disable(): void {
        config.enabled = false
        console.log('%c[FS Logger] Disabled', 'color: #a44; font-weight: bold')
    },

    /**
     * Check if logging is enabled
     */
    isEnabled(): boolean {
        return config.enabled
    },

    /**
     * Set log level
     */
    setLevel(level: LogLevel): void {
        config.level = level
        if (config.enabled) {
            console.log(`%c[FS Logger] Level set to: ${level}`, 'color: #888')
        }
    },

    /**
     * Set method filter
     */
    setMethods(methods: string[] | undefined): void {
        config.methods = methods
    },

    /**
     * Enable/disable console output
     */
    setConsole(enabled: boolean): void {
        config.console = enabled
    },

    /**
     * Enable/disable buffer storage
     */
    setBuffer(enabled: boolean, size?: number): void {
        config.buffer = enabled
        if (size !== undefined) {
            config.bufferSize = size
        }
    },

    /**
     * Get stored log entries
     */
    getEntries(): LogEntry[] {
        return [...entries]
    },

    /**
     * Clear stored log entries
     */
    clear(): void {
        entries = []
        nextId = 1
        startTimestamp = performance.now()
    },

    /**
     * Export logs as JSON
     */
    export(): string {
        return JSON.stringify(entries, null, 2)
    },

    /**
     * Get current configuration
     */
    getConfig(): LoggerConfig {
        return { ...config }
    },

    /**
     * Configure logger
     */
    configure(options: Partial<LoggerConfig>): void {
        config = { ...config, ...options }
    },

    /**
     * Reset to default configuration
     */
    reset(): void {
        config = { ...defaultConfig }
        entries = []
        nextId = 1
        startTimestamp = performance.now()
    },

    // Expose start/end functions for use in workers
    start: logStart,
    end: logEnd,
}

export default logger
