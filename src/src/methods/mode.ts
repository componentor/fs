import { invalidArgType, invalidArgValue, outOfRange } from '../errors.js';

/** Node accepts an octal *string* mode ('0700', '777') — but only digits 0-7. */
const OCTAL_STRING = /^[0-7]+$/;

/**
 * Node's `parseFileMode` (lib/internal/validators.js), reproduced exactly.
 *
 * `fs.mkdir`, `fs.chmod` and friends accept a mode as either a uint32 or an octal string, and
 * validate it in JS before the syscall. Getting this wrong is not cosmetic: `{ mode: '0700' }`
 * coerced numerically yields decimal 700 (= 0o1274) — a directory with a mode the caller never
 * asked for, silently. Verified against Node: `'0700'` → 0o700, `'abc'`/`'999'`/`''` →
 * ERR_INVALID_ARG_VALUE, `null`/`true` → ERR_INVALID_ARG_TYPE, `-1`/`1.5`/`NaN`/`2**32` →
 * ERR_OUT_OF_RANGE. Only `undefined` falls through to the default.
 *
 * @param name Dotted argument name for the error message, e.g. `'options.mode'`. Node words the
 *             message differently for a dotted name ("property") than a bare one ("argument").
 * @param def  Value used when `mode` is nullish. Omit where the mode is required (chmod), so
 *             that omitting it is a type error rather than a silently invented mode. Callers
 *             that *do* have a default must still skip this function when `mode === undefined`
 *             — Node treats an explicit `null` as a type error, not as "use the default".
 */
export function parseFileMode(mode: unknown, name: string, def?: number): number {
  mode ??= def;

  if (typeof mode === 'string') {
    if (!OCTAL_STRING.test(mode)) {
      throw invalidArgValue(name, mode, 'must be a 32-bit unsigned integer or an octal string');
    }
    return parseInt(mode, 8);
  }

  if (typeof mode !== 'number') throw invalidArgType(name, 'number', mode);
  if (!Number.isInteger(mode)) throw outOfRange(name, 'an integer', mode);
  if (mode < 0 || mode > 0xffffffff) throw outOfRange(name, '>= 0 && <= 4294967295', mode);
  return mode;
}

/**
 * Encode a mode as the 4-byte LE payload the wire protocol carries.
 *
 * Written byte-by-byte rather than through a DataView: a `new DataView` per call costs more
 * than the four stores it performs, and this sits on the request-encode path of every mkdir
 * and chmod. Only the async path needs this — the sync path hands the value straight to
 * `encodeRequestU32`, which writes it into the request buffer with no intermediate allocation
 * at all.
 */
export function encodeMode(mode: number): Uint8Array {
  const buf = new Uint8Array(4);
  buf[0] = mode;
  buf[1] = mode >>> 8;
  buf[2] = mode >>> 16;
  buf[3] = mode >>> 24;
  return buf;
}
