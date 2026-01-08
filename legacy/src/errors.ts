/**
 * Custom error class for filesystem errors
 */
export class FSError extends Error {
  code: string
  syscall?: string
  path?: string
  original?: Error

  constructor(message: string, code: string, options?: { syscall?: string; path?: string; original?: Error }) {
    super(message)
    this.name = 'FSError'
    this.code = code
    this.syscall = options?.syscall
    this.path = options?.path
    this.original = options?.original
  }
}

/**
 * Create ENOENT (No such file or directory) error
 */
export function createENOENT(path: string): FSError {
  return new FSError(`ENOENT: No such file or directory, '${path}'`, 'ENOENT', { path })
}

/**
 * Create EEXIST (File exists) error
 */
export function createEEXIST(path: string, operation?: string): FSError {
  const message = operation
    ? `EEXIST: file already exists, ${operation} '${path}'`
    : `EEXIST: File exists, '${path}'`
  return new FSError(message, 'EEXIST', { path })
}

/**
 * Create EACCES (Permission denied) error
 */
export function createEACCES(path: string, syscall?: string): FSError {
  return new FSError(`EACCES: permission denied, access '${path}'`, 'EACCES', { syscall, path })
}

/**
 * Create EISDIR (Is a directory) error
 */
export function createEISDIR(path: string, operation = 'operation'): FSError {
  return new FSError(`EISDIR: illegal operation on a directory, ${operation} '${path}'`, 'EISDIR', { path })
}

/**
 * Create ELOOP (Too many symbolic links) error
 */
export function createELOOP(path: string): FSError {
  return new FSError(`ELOOP: Too many symbolic links, '${path}'`, 'ELOOP', { path })
}

/**
 * Create EINVAL (Invalid argument) error
 */
export function createEINVAL(path: string): FSError {
  return new FSError(`EINVAL: Invalid argument, '${path}'`, 'EINVAL', { path })
}

/**
 * Create ECORRUPTED (Data corruption detected) error
 */
export function createECORRUPTED(path: string): FSError {
  return new FSError(`ECORRUPTED: Pack file integrity check failed, '${path}'`, 'ECORRUPTED', { path })
}

/**
 * Wrap an error with a standard code if it doesn't have one
 */
export function wrapError(err: unknown): FSError {
  if (err instanceof FSError) return err

  const error = err as Error
  if (typeof (error as FSError).code === 'string') {
    const fsErr = new FSError(error.message, (error as FSError).code)
    fsErr.original = error
    return fsErr
  }

  const wrapped = new FSError(error.message || 'Unknown error', 'UNKNOWN')
  wrapped.original = error
  return wrapped
}
