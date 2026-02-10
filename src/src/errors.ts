/**
 * Node.js compatible filesystem error classes
 */

export class FSError extends Error {
  code: string;
  errno: number;
  syscall?: string;
  path?: string;

  constructor(code: string, errno: number, message: string, syscall?: string, path?: string) {
    super(message);
    this.name = 'FSError';
    this.code = code;
    this.errno = errno;
    this.syscall = syscall;
    this.path = path;
  }
}

export const ErrorCodes = {
  ENOENT: -2,
  EEXIST: -17,
  EISDIR: -21,
  ENOTDIR: -20,
  ENOTEMPTY: -39,
  EACCES: -13,
  EBADF: -9,
  EINVAL: -22,
  EMFILE: -24,
  ENOSPC: -28,
  EPERM: -1,
  ENOSYS: -38,
  ELOOP: -40,
} as const;

/** Binary protocol status codes → error code mapping */
export const STATUS_TO_CODE: Record<number, string> = {
  0: 'OK',
  1: 'ENOENT',
  2: 'EEXIST',
  3: 'EISDIR',
  4: 'ENOTDIR',
  5: 'ENOTEMPTY',
  6: 'EACCES',
  7: 'EINVAL',
  8: 'EBADF',
  9: 'ELOOP',
  10: 'ENOSPC',
};

/** Error code → binary protocol status mapping */
export const CODE_TO_STATUS: Record<string, number> = {
  OK: 0,
  ENOENT: 1,
  EEXIST: 2,
  EISDIR: 3,
  ENOTDIR: 4,
  ENOTEMPTY: 5,
  EACCES: 6,
  EINVAL: 7,
  EBADF: 8,
  ELOOP: 9,
  ENOSPC: 10,
};

export function createError(code: string, syscall: string, path: string): FSError {
  const errno = ErrorCodes[code as keyof typeof ErrorCodes] ?? -1;
  const messages: Record<string, string> = {
    ENOENT: 'no such file or directory',
    EEXIST: 'file already exists',
    EISDIR: 'illegal operation on a directory',
    ENOTDIR: 'not a directory',
    ENOTEMPTY: 'directory not empty',
    EACCES: 'permission denied',
    EINVAL: 'invalid argument',
    EBADF: 'bad file descriptor',
    ELOOP: 'too many symbolic links encountered',
    ENOSPC: 'no space left on device',
  };
  const msg = messages[code] ?? 'unknown error';
  return new FSError(code, errno, `${code}: ${msg}, ${syscall} '${path}'`, syscall, path);
}

export function statusToError(status: number, syscall: string, path: string): FSError {
  const code = STATUS_TO_CODE[status] ?? 'EINVAL';
  return createError(code, syscall, path);
}
