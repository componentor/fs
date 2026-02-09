/**
 * VFS Event Constants - SAB layout and metric indices
 */

// SAB layout for metrics
export const METRICS_OFFSET = 0
export const METRIC_QUEUED_TOTAL = 0
export const METRIC_QUEUED_CREATE = 1
export const METRIC_QUEUED_UPDATE = 2
export const METRIC_QUEUED_DELETE = 3
export const METRIC_INTERNAL_TOTAL = 4
export const METRIC_INTERNAL_CREATE = 5
export const METRIC_INTERNAL_UPDATE = 6
export const METRIC_INTERNAL_DELETE = 7
export const METRIC_EXTERNAL_TOTAL = 8
export const METRIC_EXTERNAL_CREATE = 9
export const METRIC_EXTERNAL_UPDATE = 10
export const METRIC_EXTERNAL_DELETE = 11
export const METRIC_QUEUE_PATH_COUNT = 12
export const METRIC_PENDING_CREATE = 13
export const METRIC_PENDING_UPDATE = 14
export const METRIC_PENDING_DELETE = 15

// Path dump request/response slots
export const PATH_REQUEST_FLAG = 16
export const PATH_RESPONSE_FLAG = 17
export const PATH_DATA_LENGTH = 18
export const RESET_GRACE_COUNTER = 19

export const METRIC_COUNT = 20

// Grace period for reset
export const RESET_GRACE_PERIOD = 500

// Path data region
export const PATH_DATA_OFFSET = METRIC_COUNT * 4  // 80 bytes
export const PATH_DATA_MAX_BYTES = 8192  // 8KB max

// Per-path queue entry
export interface PathQueueEntry {
    creates: number
    updates: number
    deletes: number
    lastMtime: number
}
