/**
 * Encoding utilities for converting between Uint8Array and strings
 * using Node.js-compatible encodings.
 *
 * Every behaviour here — the alias set, the case-insensitivity, the leniency of the base64 and
 * hex parsers, and which of `ascii`/`latin1` masks which bits in which direction — was captured
 * from real `node:fs` / `Buffer` before being written. See [encoding.test.ts](../tests/encoding.test.ts).
 */

import { invalidArgValue } from './errors.js';

/** The seven encodings Node actually implements; every accepted name normalises to one. */
export type CanonicalEncoding = 'utf8' | 'utf16le' | 'latin1' | 'base64' | 'base64url' | 'ascii' | 'hex';

const ALIASES: Record<string, CanonicalEncoding> = {
  'utf8': 'utf8', 'utf-8': 'utf8',
  'utf16le': 'utf16le', 'utf-16le': 'utf16le', 'ucs2': 'utf16le', 'ucs-2': 'utf16le',
  'latin1': 'latin1', 'binary': 'latin1',
  'base64': 'base64', 'base64url': 'base64url',
  'ascii': 'ascii', 'hex': 'hex',
};

const utf8Decoder = new TextDecoder('utf-8');
const utf16Decoder = new TextDecoder('utf-16le');
const utf8Encoder = new TextEncoder();

/**
 * Resolve an encoding name to its canonical form, or `undefined` if Node would not accept it.
 *
 * Node matches case-insensitively — `'UTF8'`, `'Latin1'` and `'HEX'` are all valid — which is
 * why a plain `switch` on the raw string is not enough: `'HEX'` silently missing its case and
 * falling through to a UTF-8 default writes the literal text `"4142"` where the caller asked
 * for the bytes `41 42`.
 */
export function normalizeEncoding(encoding: unknown): CanonicalEncoding | undefined {
  // Fast path for the spellings that dominate real traffic — no lowercasing, no map lookup.
  if (encoding === 'utf8' || encoding === 'utf-8') return 'utf8';
  if (typeof encoding !== 'string') return undefined;
  return ALIASES[encoding.toLowerCase()];
}

/**
 * Resolve an encoding name, throwing Node's `ERR_INVALID_ARG_VALUE` if it is not one.
 *
 * Silently falling back to UTF-8 turns a typo into corrupted data that surfaces far from its
 * cause; Node rejects the call instead, and so do we.
 */
export function assertEncoding(encoding: unknown, name = 'encoding'): CanonicalEncoding {
  const normalized = normalizeEncoding(encoding);
  if (normalized === undefined) throw invalidArgValue(name, encoding, 'is invalid encoding');
  return normalized;
}

// ---- base64 ----
//
// Node's decoder is deliberately lenient, and the details are observable:
//   • characters outside the alphabet are SKIPPED, not fatal  — 'aGVs!bG8' → 'hello'
//   • '=' TERMINATES the input                                 — 'aGVs=bG8' → 'hel'
//   • padding may be missing entirely                          — 'aGVsbG8'  → 'hello'
//   • a trailing group of one character contributes no byte    — 'a'        → []
//   • the url-safe alphabet is accepted under plain 'base64'   — 'a-_b'     → [107,239,219]
// `atob` does none of that: it throws on unpadded input and on '-'/'_', so an unpadded base64
// write used to fail outright.

const B64_VALUES = /* @__PURE__ */ (() => {
  const table = new Int8Array(256).fill(-1);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < alphabet.length; i++) table[alphabet.charCodeAt(i)] = i;
  table['-'.charCodeAt(0)] = 62; // url-safe '+'
  table['_'.charCodeAt(0)] = 63; // url-safe '/'
  return table;
})();

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64ToBytes(str: string): Uint8Array {
  const sextets = new Uint8Array(str.length);
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code === 61) break; // '='
    const value = code < 256 ? B64_VALUES[code] : -1;
    if (value >= 0) sextets[n++] = value;
  }

  const groups = n >> 2;
  const rem = n & 3;
  // A leftover of 1 sextet carries only 6 bits — not enough for a byte, so Node drops it.
  const out = new Uint8Array(groups * 3 + (rem === 0 ? 0 : rem - 1));

  let o = 0;
  for (let g = 0; g < groups; g++) {
    const i = g * 4;
    out[o++] = (sextets[i] << 2) | (sextets[i + 1] >> 4);
    out[o++] = ((sextets[i + 1] & 0xf) << 4) | (sextets[i + 2] >> 2);
    out[o++] = ((sextets[i + 2] & 0x3) << 6) | sextets[i + 3];
  }
  const tail = groups * 4;
  if (rem === 2) {
    out[o] = (sextets[tail] << 2) | (sextets[tail + 1] >> 4);
  } else if (rem === 3) {
    out[o++] = (sextets[tail] << 2) | (sextets[tail + 1] >> 4);
    out[o] = ((sextets[tail + 1] & 0xf) << 4) | (sextets[tail + 2] >> 2);
  }
  return out;
}

function bytesToBase64(data: Uint8Array, urlSafe: boolean): string {
  const chars = urlSafe ? B64URL_CHARS : B64_CHARS;
  const full = Math.floor(data.length / 3);
  let out = '';
  let i = 0;
  for (let g = 0; g < full; g++, i += 3) {
    const n = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + chars[n & 63];
  }
  const rem = data.length - i;
  if (rem === 1) {
    const n = data[i] << 16;
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63];
    if (!urlSafe) out += '=='; // base64url omits padding entirely
  } else if (rem === 2) {
    const n = (data[i] << 16) | (data[i + 1] << 8);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63];
    if (!urlSafe) out += '=';
  }
  return out;
}

// ---- hex ----

function hexValue(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;        // 0-9
  if (code >= 97 && code <= 102) return code - 87;       // a-f
  if (code >= 65 && code <= 70) return code - 55;        // A-F
  return -1;
}

function hexToBytes(str: string): Uint8Array {
  // Node stops at the first pair that is not two hex digits and ignores a trailing odd
  // character: '41zz42' → [0x41], '414' → [0x41]. The old parser used parseInt, which turns a
  // bad pair into NaN and then a silent 0x00 byte in the middle of the output.
  const max = str.length >>> 1;
  const out = new Uint8Array(max);
  let n = 0;
  for (; n < max; n++) {
    const hi = hexValue(str.charCodeAt(n * 2));
    const lo = hexValue(str.charCodeAt(n * 2 + 1));
    if (hi < 0 || lo < 0) break;
    out[n] = (hi << 4) | lo;
  }
  return n === max ? out : out.subarray(0, n);
}

/** Build a string from bytes in chunks — `fromCharCode.apply` on a huge array overflows the stack. */
function bytesToBinaryString(data: Uint8Array, mask: number): string {
  const CHUNK = 8192;
  let out = '';
  for (let i = 0; i < data.length; i += CHUNK) {
    const slice = data.subarray(i, i + CHUNK);
    if (mask === 0xff) {
      out += String.fromCharCode.apply(null, slice as unknown as number[]);
    } else {
      const masked = new Uint8Array(slice.length);
      for (let j = 0; j < slice.length; j++) masked[j] = slice[j] & mask;
      out += String.fromCharCode.apply(null, masked as unknown as number[]);
    }
  }
  return out;
}

/**
 * Decode a Uint8Array to a string using the specified encoding.
 *
 * @throws `ERR_INVALID_ARG_VALUE` if the encoding is not one Node accepts.
 */
export function decodeBuffer(data: Uint8Array, encoding: string): string {
  switch (assertEncoding(encoding)) {
    case 'utf8':
      return utf8Decoder.decode(data);

    case 'latin1':
      return bytesToBinaryString(data, 0xff);

    case 'ascii':
      // Decoding ascii DOES mask to 7 bits (byte 233 reads back as 'i'), unlike encoding it.
      return bytesToBinaryString(data, 0x7f);

    case 'base64':
      return bytesToBase64(data, false);

    case 'base64url':
      return bytesToBase64(data, true);

    case 'hex': {
      let hex = '';
      for (let i = 0; i < data.length; i++) hex += data[i].toString(16).padStart(2, '0');
      return hex;
    }

    case 'utf16le':
      // Node drops a trailing odd byte rather than emitting a replacement character.
      return utf16Decoder.decode(data.length & 1 ? data.subarray(0, data.length - 1) : data);
  }
}

/**
 * A resumable decoder, for turning a *stream* of byte chunks into text.
 *
 * Node's `string_decoder.StringDecoder`, and the reason it exists: decoding each chunk
 * independently splits any multi-byte character that happens to straddle a chunk boundary into
 * two invalid fragments, and both decode to U+FFFD. With the 64 KB chunks a read stream uses,
 * `createReadStream(p, 'utf8')` over a file with any non-ASCII text past the first 64 KB
 * corrupted exactly one character per boundary — silently, since the surrounding text is fine.
 *
 * Three of the seven encodings need to carry bytes across a chunk:
 *   • `utf8` — a code point is 1–4 bytes; `TextDecoder`'s own `{ stream: true }` handles it;
 *   • `utf16le` — 2 bytes per unit, so an odd-length chunk holds half of one;
 *   • `base64`/`base64url` — 3 bytes map to 4 characters, so only whole triples may be emitted.
 * The rest (`latin1`, `ascii`, `hex`) are byte-aligned and pass straight through.
 *
 * `end()` flushes whatever is left, matching Node: a truncated sequence at EOF yields the
 * replacement character rather than being dropped.
 */
export interface StringDecoder {
  /** Decode a chunk, holding back any bytes that belong to a character still to come. */
  write(bytes: Uint8Array): string;
  /** Flush the held-back bytes at end of stream. */
  end(): string;
}

/**
 * Build a {@link StringDecoder} for `encoding`.
 *
 * @throws `ERR_INVALID_ARG_VALUE` if the encoding is not one Node accepts.
 */
export function createStringDecoder(encoding: string): StringDecoder {
  const canonical = assertEncoding(encoding);

  if (canonical === 'utf8') {
    // A dedicated instance, not the shared `utf8Decoder`: streaming state is per-decoder, so
    // sharing one across concurrent streams would interleave their partial characters.
    const decoder = new TextDecoder('utf-8');
    return {
      write: (bytes) => decoder.decode(bytes, { stream: true }),
      end: () => decoder.decode(),
    };
  }

  if (canonical === 'utf16le' || canonical === 'base64' || canonical === 'base64url') {
    // Emit only whole units; hold the remainder for the next chunk.
    const unit = canonical === 'utf16le' ? 2 : 3;
    const isUtf16 = canonical === 'utf16le';
    let carry = new Uint8Array(0);
    return {
      write(bytes) {
        const joined = carry.length === 0 ? bytes : concatBytes(carry, bytes);
        let whole = joined.length - (joined.length % unit);
        // A UTF-16 astral character is two units, and splitting it emits two lone surrogates
        // instead of the character. Node holds a trailing lead surrogate back for the next
        // chunk; verified against `string_decoder`, which yields '' then the whole emoji.
        if (isUtf16 && whole >= 2) {
          const lastUnit = joined[whole - 2] | (joined[whole - 1] << 8);
          if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) whole -= 2;
        }
        // Copied, not a subarray view: chunks here may be backed by a SharedArrayBuffer, whose
        // bytes the relay is free to overwrite once the read returns. At most three bytes.
        carry = new Uint8Array(joined.subarray(whole));
        return whole === 0 ? '' : decodeBuffer(joined.subarray(0, whole), canonical);
      },
      end() {
        if (carry.length === 0) return '';
        // A lead surrogate still held at EOF is emitted alone, as node does; a stray odd byte is
        // dropped, which `decodeBuffer` already does for utf16le.
        const rest = decodeBuffer(carry, canonical);
        carry = new Uint8Array(0);
        return rest;
      },
    };
  }

  // latin1, ascii, hex — one byte in, a fixed amount of text out. Nothing can straddle.
  return {
    write: (bytes) => (bytes.length === 0 ? '' : decodeBuffer(bytes, canonical)),
    end: () => '',
  };
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Encode a string to a Uint8Array using the specified encoding.
 *
 * @throws `ERR_INVALID_ARG_VALUE` if the encoding is not one Node accepts.
 */
export function encodeString(str: string, encoding: string): Uint8Array {
  switch (assertEncoding(encoding)) {
    case 'utf8':
      return utf8Encoder.encode(str);

    case 'latin1':
    case 'ascii': {
      // Encoding is byte-truncation for BOTH: Buffer.from('é', 'ascii') is [0xE9], identical to
      // latin1. Only the decode direction masks to 7 bits. The old code masked here too, so an
      // 'ascii' write mangled every character above 0x7F.
      const buf = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) buf[i] = str.charCodeAt(i); // stores low byte
      return buf;
    }

    case 'base64':
    case 'base64url':
      // One decoder serves both: Node accepts either alphabet under either name.
      return base64ToBytes(str);

    case 'hex':
      return hexToBytes(str);

    case 'utf16le': {
      const buf = new Uint8Array(str.length * 2);
      for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        buf[i * 2] = code & 0xff;
        buf[i * 2 + 1] = (code >>> 8) & 0xff;
      }
      return buf;
    }
  }
}
