/**
 * `readFile`, `writeFile` and `appendFile` accept a **file descriptor** where a path goes.
 *
 * This is long-standing Node behaviour (`fs.readFileSync(fd)`), and the semantics are not the
 * same as the path form — all three verified against `node:fs`:
 *
 *   • the operation starts at the descriptor's **current position**, not at zero, and advances
 *     it, so `readFileSync(fd)` twice returns the contents and then `''`;
 *   • `writeFile(fd, …)` does **not** truncate — writing `'ab'` over `'XXXXXXXXXX'` leaves
 *     `'abXXXXXXXX'`;
 *   • `appendFile(fd, …)` does **not** seek to end-of-file. It behaves exactly like
 *     `writeFile`; appending comes from having opened with `'a'` (O_APPEND). On an `'r+'`
 *     descriptor, `appendFileSync(fd, 'B')` over `'AAA'` yields `'BAA'`;
 *   • the descriptor stays **open** afterwards — the caller owns it;
 *   • `flag` is ignored, since the descriptor is already open.
 *
 * Only the sync and callback APIs take a raw number. `fsPromises.readFile(fd)` rejects with
 * `ERR_INVALID_ARG_TYPE`; the promise API takes a `FileHandle` instead ([[isFileHandle]]).
 */

import type { FileHandle } from '../types.js';
import { outOfRange } from '../errors.js';

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

/**
 * True when Node would read this argument as a descriptor rather than a path.
 *
 * The test is "is it an int32", not "is it a number": `readFileSync(1.5)` and
 * `readFileSync(2 ** 31)` both fail as *paths* (`ERR_INVALID_ARG_TYPE`), while
 * `readFileSync(-1)` fails as a *descriptor* (`ERR_OUT_OF_RANGE`). Anything outside int32
 * therefore has to fall through to the path handling to produce the right error.
 */
export function isFdArg(p: unknown): p is number {
  return typeof p === 'number' && Number.isInteger(p) && p >= INT32_MIN && p <= INT32_MAX;
}

/** Node's `validateInt32(fd, 'fd', 0)` — negative descriptors are a range error. */
export function validateFdArg(fd: number): number {
  if (fd < 0) throw outOfRange('fd', `>= 0 && <= ${INT32_MAX}`, fd);
  return fd;
}

/**
 * True for a `FileHandle` as returned by `promises.open`, which the promise API accepts in the
 * path position. Structural rather than `instanceof`: handles are plain objects here, and a
 * handle from another copy of the library should still work.
 */
export function isFileHandle(p: unknown): p is FileHandle {
  return typeof p === 'object' && p !== null
    && typeof (p as FileHandle).fd === 'number'
    && typeof (p as FileHandle).readFile === 'function'
    && typeof (p as FileHandle).writeFile === 'function';
}
