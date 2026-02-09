// Node.js fs error class implementation
// https://nodejs.org/api/errors.html#class-systemerror

// Error codes mapping
export const ERROR_CODES: Record<string, { code: string; errno: number; message: string }> = {
    ENOENT: { code: 'ENOENT', errno: -2, message: 'no such file or directory' },
    EEXIST: { code: 'EEXIST', errno: -17, message: 'file already exists' },
    ENOTDIR: { code: 'ENOTDIR', errno: -20, message: 'not a directory' },
    EISDIR: { code: 'EISDIR', errno: -21, message: 'illegal operation on a directory' },
    ENOTEMPTY: { code: 'ENOTEMPTY', errno: -39, message: 'directory not empty' },
    EACCES: { code: 'EACCES', errno: -13, message: 'permission denied' },
    EPERM: { code: 'EPERM', errno: -1, message: 'operation not permitted' },
    EBADF: { code: 'EBADF', errno: -9, message: 'bad file descriptor' },
    EINVAL: { code: 'EINVAL', errno: -22, message: 'invalid argument' },
    EMFILE: { code: 'EMFILE', errno: -24, message: 'too many open files' },
    ENFILE: { code: 'ENFILE', errno: -23, message: 'file table overflow' },
    ELOOP: { code: 'ELOOP', errno: -40, message: 'too many symbolic links encountered' },
    ENAMETOOLONG: { code: 'ENAMETOOLONG', errno: -36, message: 'file name too long' },
    ENOSPC: { code: 'ENOSPC', errno: -28, message: 'no space left on device' },
    EROFS: { code: 'EROFS', errno: -30, message: 'read-only file system' },
    EXDEV: { code: 'EXDEV', errno: -18, message: 'cross-device link not permitted' },
    EAGAIN: { code: 'EAGAIN', errno: -11, message: 'resource temporarily unavailable' },
    EBUSY: { code: 'EBUSY', errno: -16, message: 'resource busy or locked' },
    ENOTCONN: { code: 'ENOTCONN', errno: -107, message: 'socket is not connected' },
    ETIMEDOUT: { code: 'ETIMEDOUT', errno: -110, message: 'connection timed out' },
    ECONNREFUSED: { code: 'ECONNREFUSED', errno: -111, message: 'connection refused' },
    ECONNRESET: { code: 'ECONNRESET', errno: -104, message: 'connection reset by peer' },
}

export class FSError extends Error {
    code: string
    errno: number
    syscall: string
    path?: string
    dest?: string

    constructor(
        code: keyof typeof ERROR_CODES | string,
        syscall: string,
        path?: string,
        dest?: string
    ) {
        const errorInfo = ERROR_CODES[code] ?? { code, errno: -1, message: code.toLowerCase() }

        let message = `${errorInfo.code}: ${errorInfo.message}, ${syscall}`
        if (path) {
            message += ` '${path}'`
        }
        if (dest) {
            message += ` -> '${dest}'`
        }

        super(message)

        this.name = 'Error'
        this.code = errorInfo.code
        this.errno = errorInfo.errno
        this.syscall = syscall
        this.path = path
        this.dest = dest

        // Maintain proper stack trace in V8
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, FSError)
        }
    }

    // Convert to JSON-serializable object
    toJSON(): object {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            errno: this.errno,
            syscall: this.syscall,
            path: this.path,
            dest: this.dest,
        }
    }
}

// Helper functions to create common errors
export const createENOENT = (syscall: string, path: string): FSError =>
    new FSError('ENOENT', syscall, path)

export const createEEXIST = (syscall: string, path: string): FSError =>
    new FSError('EEXIST', syscall, path)

export const createENOTDIR = (syscall: string, path: string): FSError =>
    new FSError('ENOTDIR', syscall, path)

export const createEISDIR = (syscall: string, path: string): FSError =>
    new FSError('EISDIR', syscall, path)

export const createENOTEMPTY = (syscall: string, path: string): FSError =>
    new FSError('ENOTEMPTY', syscall, path)

export const createEACCES = (syscall: string, path: string): FSError =>
    new FSError('EACCES', syscall, path)

export const createEPERM = (syscall: string, path: string): FSError =>
    new FSError('EPERM', syscall, path)

export const createEBADF = (syscall: string): FSError =>
    new FSError('EBADF', syscall)

export const createEINVAL = (syscall: string, path?: string, message?: string): FSError => {
    const error = new FSError('EINVAL', syscall, path)
    if (message) {
        error.message = `EINVAL: ${message}, ${syscall}${path ? ` '${path}'` : ''}`
    }
    return error
}

export const createELOOP = (syscall: string, path: string): FSError =>
    new FSError('ELOOP', syscall, path)

export default FSError
