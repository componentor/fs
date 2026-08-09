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
  ENOTSUP: -45,
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
  12: 'ENOTSUP',
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
  ENOTSUP: 12,
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
    ENOTSUP: 'operation not supported',
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

/** Attach Node's `ERR_*` shape to an argument-level filesystem error. */
function fsError(code: string, message: string, path: string, syscall: string): Error {
  const err = new Error(message) as Error & { code: string; path: string; syscall: string };
  err.code = code;
  err.path = path;
  err.syscall = syscall;
  return err;
}

/**
 * `ERR_FS_EISDIR` — `rm` was pointed at a directory without `recursive: true`.
 *
 * Not an errno error: Node raises this in JS before deciding what syscall to make, and unlike
 * ENOENT it is *not* suppressed by `force`. Empty or not, a directory needs `recursive`.
 */
export function eisdirNotRecursive(path: string, syscall = 'rm'): Error {
  return fsError('ERR_FS_EISDIR', `Path is a directory: ${syscall} returned EISDIR (is a directory) ${path}`, path, syscall);
}

/**
 * `ERR_FS_EISDIR` as `cp` raises it — same code, different wording.
 *
 * Node words this one after the option the caller forgot rather than after the syscall, and
 * code that branches on `err.code` sees `ERR_FS_EISDIR` from both. Reporting a bare `EISDIR`
 * here (as this used to) makes a Node-targeted `catch (e) { if (e.code === 'ERR_FS_EISDIR') }`
 * miss entirely.
 */
export function cpEisdirNotRecursive(path: string): Error {
  return fsError('ERR_FS_EISDIR', `Recursive option not enabled, cannot copy a directory: ${path}`, path, 'cp');
}

/**
 * `ERR_FS_CP_EINVAL` — `cp` was asked to copy something onto itself.
 *
 * Node rejects both `src === dest` and a `dest` inside `src`. The second is not a nicety: a
 * recursive copy into its own subtree recreates the destination inside itself on every pass and
 * never terminates, filling storage and hanging the tab. The drives layer guarded this in 3.3.0;
 * `VFSFileSystem.cpSync` did not, until 3.3.16.
 */
export function cpSameSource(path: string): Error {
  return fsError('ERR_FS_CP_EINVAL', `src and dest cannot be the same ${path}`, path, 'cp');
}

/** `ERR_FS_CP_EINVAL` — the destination lives inside the source directory. */
export function cpIntoSubdirectory(src: string, dest: string): Error {
  return fsError('ERR_FS_CP_EINVAL', `Cannot copy ${src}/ to a subdirectory of self ${dest}`, dest, 'cp');
}

/** `ERR_FS_CP_EEXIST` — `cp` with `errorOnExist` found the destination already present. */
export function cpTargetExists(path: string): Error {
  return fsError('ERR_FS_CP_EEXIST', `Target already exists: cp returned EEXIST (${path})`, path, 'cp');
}

/**
 * `ERR_STREAM_WRITE_AFTER_END` — `write()` on a stream whose `end()` has already been called.
 *
 * A stream error rather than a filesystem one, so it carries no `path`/`syscall`. Node raises it
 * the moment `end()` has been seen, not when the close completes; deferring it makes the outcome
 * depend on whether the queued writes happened to drain first, which is a race the caller has no
 * way to observe or control.
 */
export function streamWriteAfterEnd(): Error {
  const err = new Error('write after end') as Error & { code: string };
  err.code = 'ERR_STREAM_WRITE_AFTER_END';
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
