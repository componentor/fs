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

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FSError);
    }
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

export function createENOENT(syscall: string, path: string): FSError {
  return new FSError(
    'ENOENT',
    ErrorCodes.ENOENT,
    `ENOENT: no such file or directory, ${syscall} '${path}'`,
    syscall,
    path
  );
}

export function createEEXIST(syscall: string, path: string): FSError {
  return new FSError(
    'EEXIST',
    ErrorCodes.EEXIST,
    `EEXIST: file already exists, ${syscall} '${path}'`,
    syscall,
    path
  );
}

export function createEISDIR(syscall: string, path: string): FSError {
  return new FSError(
    'EISDIR',
    ErrorCodes.EISDIR,
    `EISDIR: illegal operation on a directory, ${syscall} '${path}'`,
    syscall,
    path
  );
}

export function createENOTDIR(syscall: string, path: string): FSError {
  return new FSError(
    'ENOTDIR',
    ErrorCodes.ENOTDIR,
    `ENOTDIR: not a directory, ${syscall} '${path}'`,
    syscall,
    path
  );
}

export function createENOTEMPTY(syscall: string, path: string): FSError {
  return new FSError(
    'ENOTEMPTY',
    ErrorCodes.ENOTEMPTY,
    `ENOTEMPTY: directory not empty, ${syscall} '${path}'`,
    syscall,
    path
  );
}

export function createEACCES(syscall: string, path: string): FSError {
  return new FSError(
    'EACCES',
    ErrorCodes.EACCES,
    `EACCES: permission denied, ${syscall} '${path}'`,
    syscall,
    path
  );
}

export function createEINVAL(syscall: string, path: string): FSError {
  return new FSError(
    'EINVAL',
    ErrorCodes.EINVAL,
    `EINVAL: invalid argument, ${syscall} '${path}'`,
    syscall,
    path
  );
}

export function createENOSYS(syscall: string, path: string): FSError {
  return new FSError(
    'ENOSYS',
    ErrorCodes.ENOSYS,
    `ENOSYS: function not implemented, ${syscall} '${path}'`,
    syscall,
    path
  );
}

export function createELOOP(syscall: string, path: string): FSError {
  return new FSError(
    'ELOOP',
    ErrorCodes.ELOOP,
    `ELOOP: too many symbolic links encountered, ${syscall} '${path}'`,
    syscall,
    path
  );
}

export function mapErrorCode(errorName: string, syscall: string, path: string): FSError {
  switch (errorName) {
    case 'NotFoundError':
      return createENOENT(syscall, path);
    case 'NotAllowedError':
      return createEACCES(syscall, path);
    case 'TypeMismatchError':
      return createENOTDIR(syscall, path);
    case 'InvalidModificationError':
      return createENOTEMPTY(syscall, path);
    case 'QuotaExceededError':
      return new FSError('ENOSPC', ErrorCodes.ENOSPC, `ENOSPC: no space left on device, ${syscall} '${path}'`, syscall, path);
    default:
      return new FSError('EINVAL', ErrorCodes.EINVAL, `${errorName}: ${syscall} '${path}'`, syscall, path);
  }
}
