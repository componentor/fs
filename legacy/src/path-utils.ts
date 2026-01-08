// Path normalization cache - LRU-style with max size
const normalizeCache = new Map<string, string>()
const CACHE_MAX_SIZE = 1000

/**
 * Normalize a path, handling . and .. components
 * Results are cached for performance on repeated calls
 */
export function normalize(path: string | undefined | null): string {
  if (path === undefined || path === null) {
    throw new TypeError('Path cannot be undefined or null')
  }

  if (typeof path !== 'string') {
    throw new TypeError(`Expected string path, got ${typeof path}`)
  }

  if (path === '') {
    return '/'
  }

  // Check cache first
  const cached = normalizeCache.get(path)
  if (cached !== undefined) {
    return cached
  }

  const parts = path.split('/')
  const stack: string[] = []

  for (const part of parts) {
    if (part === '' || part === '.') {
      continue
    } else if (part === '..') {
      if (stack.length > 0) stack.pop()
    } else {
      stack.push(part)
    }
  }

  const result = '/' + stack.join('/')

  // Cache the result (simple LRU: clear when full)
  if (normalizeCache.size >= CACHE_MAX_SIZE) {
    // Delete oldest entries (first 25%)
    const deleteCount = CACHE_MAX_SIZE / 4
    let count = 0
    for (const key of normalizeCache.keys()) {
      if (count++ >= deleteCount) break
      normalizeCache.delete(key)
    }
  }
  normalizeCache.set(path, result)

  return result
}

/**
 * Get parent directory path
 */
export function dirname(path: string): string {
  const normalized = normalize(path)
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length < 2) return '/'
  return '/' + parts.slice(0, -1).join('/')
}

/**
 * Get base filename
 */
export function basename(path: string): string {
  const normalized = normalize(path)
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || ''
}

/**
 * Join path segments
 */
export function join(...paths: string[]): string {
  return normalize(paths.join('/'))
}

/**
 * Check if path is root
 */
export function isRoot(path: string): boolean {
  const normalized = normalize(path)
  return normalized === '/' || normalized === ''
}

/**
 * Get path segments (excluding empty)
 */
export function segments(path: string): string[] {
  return normalize(path).split('/').filter(Boolean)
}
