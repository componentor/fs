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
  EIO: -5,
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
  11: 'EIO',
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
  EIO: 11,
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
    EIO: 'i/o error',
  };
  const msg = messages[code] ?? 'unknown error';
  return new FSError(code, errno, `${code}: ${msg}, ${syscall} '${path}'`, syscall, path);
}

export function statusToError(status: number, syscall: string, path: string): FSError {
  const code = STATUS_TO_CODE[status] ?? 'EINVAL';
  return createError(code, syscall, path);
}

// ========== Node-style argument errors ==========
//
// Everything the *filesystem* rejects surfaces as an FSError carrying a POSIX code (ENOENT,
// EEXIST, …). Argument validation is a different layer: Node checks these in JS before the
// syscall ever runs, and throws a plain TypeError/RangeError tagged with an `ERR_*` code
// instead of an errno. Matching that distinction matters because real-world code branches on
// `err.code`, and a caller catching `ERR_INVALID_ARG_VALUE` should not have to also handle a
// spurious EINVAL.

/**
 * Node words these by whether the name is dotted: `options.mode` is a "property",
 * a bare `mode` is an "argument".
 */
const kind = (name: string) => (name.includes('.') ? 'property' : 'argument');

/** `util.inspect`-style rendering for the "Received …" tail of an argument error. */
function inspectArg(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`;
  if (typeof value === 'bigint') return `${value}n`;
  return String(value);
}

/** `ERR_INVALID_ARG_TYPE` — the argument is the wrong type entirely (null, boolean, object). */
export function invalidArgType(name: string, expected: string, actual: unknown): TypeError {
  // Node prints null/undefined bare, objects by constructor, other primitives with their type.
  let received: string;
  if (actual === null || actual === undefined) received = String(actual);
  else if (typeof actual === 'object' || typeof actual === 'function') {
    received = `an instance of ${(actual as object).constructor?.name ?? 'Object'}`;
  } else received = `type ${typeof actual} (${inspectArg(actual)})`;

  const err = new TypeError(`The "${name}" ${kind(name)} must be of type ${expected}. Received ${received}`);
  (err as TypeError & { code: string }).code = 'ERR_INVALID_ARG_TYPE';
  return err;
}

/** `ERR_INVALID_ARG_VALUE` — right type, unusable value (e.g. a non-octal mode string). */
export function invalidArgValue(name: string, value: unknown, reason: string): TypeError {
  const err = new TypeError(`The ${kind(name)} '${name}' ${reason}. Received ${inspectArg(value)}`);
  (err as TypeError & { code: string }).code = 'ERR_INVALID_ARG_VALUE';
  return err;
}

/** `ERR_OUT_OF_RANGE` — a number outside the accepted domain (negative, fractional, > u32). */
export function outOfRange(name: string, range: string, value: unknown): RangeError {
  const err = new RangeError(
    `The value of "${name}" is out of range. It must be ${range}. Received ${inspectArg(value)}`
  );
  (err as RangeError & { code: string }).code = 'ERR_OUT_OF_RANGE';
  return err;
}
