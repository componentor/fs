/**
 * Encoding parity with Node — validation, aliasing, and the parsers' leniency.
 *
 * The old implementation `switch`ed on the raw encoding string and fell through to a UTF-8
 * default. That made three classes of silent corruption possible, all reproduced below as
 * regression tests:
 *
 *   1. an unrecognised encoding was accepted and wrote UTF-8 instead of erroring;
 *   2. any non-lowercase spelling missed its case — `'HEX'` wrote the literal text "4142"
 *      where the caller asked for the bytes 41 42 — and `base64url` had no case at all;
 *   3. base64/hex parsing was stricter or looser than Node's in ways that either threw on
 *      valid input (unpadded base64) or injected 0x00 bytes into the output (bad hex pair).
 *
 * Every expectation was captured from real `node:fs` / `Buffer` before being written.
 */

import { describe, it, expect } from 'vitest';
import { decodeBuffer, encodeString, normalizeEncoding, assertEncoding } from '../src/encoding.js';
import { readdirSync } from '../src/methods/readdir.js';
import { readlinkSync } from '../src/methods/symlink.js';

const bytes = (...b: number[]) => new Uint8Array(b);
const list = (u: Uint8Array) => Array.from(u);

describe('encoding validation', () => {
  it.each(['nope', 'utf9', '', 'utf 8', 'base 64'])('rejects unknown encoding %o', (bad) => {
    expect(() => assertEncoding(bad)).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_VALUE', name: 'TypeError' })
    );
  });

  it("matches Node's message exactly", () => {
    // node:fs → "The argument 'encoding' is invalid encoding. Received 'nope'"
    expect(() => assertEncoding('nope')).toThrow(
      "The argument 'encoding' is invalid encoding. Received 'nope'"
    );
  });

  it('rejects non-strings, as Node does', () => {
    for (const bad of [123, null, {}, true]) {
      expect(() => assertEncoding(bad)).toThrow(
        expect.objectContaining({ code: 'ERR_INVALID_ARG_VALUE' })
      );
    }
  });

  it('rejects rather than silently writing UTF-8', () => {
    expect(() => encodeString('x', 'nope')).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_VALUE' })
    );
    expect(() => decodeBuffer(bytes(1, 2), 'nope')).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_VALUE' })
    );
  });
});

describe('encoding aliases and case', () => {
  it.each([
    ['utf8', 'utf8'], ['utf-8', 'utf8'], ['UTF8', 'utf8'], ['UTF-8', 'utf8'],
    ['utf16le', 'utf16le'], ['utf-16le', 'utf16le'], ['ucs2', 'utf16le'], ['UCS-2', 'utf16le'],
    ['latin1', 'latin1'], ['binary', 'latin1'], ['Latin1', 'latin1'], ['BINARY', 'latin1'],
    ['base64', 'base64'], ['BASE64', 'base64'],
    ['base64url', 'base64url'], ['Base64URL', 'base64url'],
    ['ascii', 'ascii'], ['ASCII', 'ascii'],
    ['hex', 'hex'], ['HEX', 'hex'],
  ])('normalises %o to %o', (input, expected) => {
    expect(normalizeEncoding(input)).toBe(expected);
  });

  it('honours a non-lowercase encoding instead of falling back to UTF-8', () => {
    // The bug: 'HEX' missed its switch case, so the literal text "4142" was written as UTF-8.
    expect(list(encodeString('4142', 'HEX'))).toEqual([0x41, 0x42]);
    expect(list(encodeString('4142', 'hex'))).toEqual([0x41, 0x42]);
    expect(list(encodeString('é', 'Latin1'))).toEqual([0xe9]);
  });
});

describe('base64', () => {
  it('accepts input with no padding', () => {
    // atob throws on this; Node returns 'hello'. An unpadded base64 write used to fail outright.
    expect(list(encodeString('aGVsbG8', 'base64'))).toEqual([104, 101, 108, 108, 111]);
    expect(list(encodeString('aGVsbG8=', 'base64'))).toEqual([104, 101, 108, 108, 111]);
  });

  it('skips characters outside the alphabet, including whitespace', () => {
    for (const input of ['aGVs!bG8', 'aGVs bG8', 'aGVs\nbG8', 'aG Vs bG 8', '!aGVsbG8']) {
      expect(list(encodeString(input, 'base64'))).toEqual([104, 101, 108, 108, 111]);
    }
  });

  it("treats '=' as a terminator, not as a skippable character", () => {
    expect(list(encodeString('aGVs=bG8', 'base64'))).toEqual([104, 101, 108]);
    expect(list(encodeString('a=b=c=d', 'base64'))).toEqual([]);
  });

  it('drops a trailing group of one character, which carries no whole byte', () => {
    expect(list(encodeString('a', 'base64'))).toEqual([]);
    expect(list(encodeString('ab', 'base64'))).toEqual([105]);
    expect(list(encodeString('abc', 'base64'))).toEqual([105, 183]);
    expect(list(encodeString('abcd', 'base64'))).toEqual([105, 183, 29]);
    expect(list(encodeString('abcde', 'base64'))).toEqual([105, 183, 29]);
  });

  it('accepts the url-safe alphabet under the plain base64 name too', () => {
    expect(list(encodeString('a-_b', 'base64'))).toEqual([107, 239, 219]);
    expect(list(encodeString('a-_b', 'base64url'))).toEqual([107, 239, 219]);
  });

  it('encodes base64url without padding and with the url-safe alphabet', () => {
    expect(decodeBuffer(bytes(107, 239, 219), 'base64url')).toBe('a-_b');
    expect(decodeBuffer(bytes(107, 239, 219), 'base64')).toBe('a+/b');
    expect(decodeBuffer(bytes(1), 'base64')).toBe('AQ==');
    expect(decodeBuffer(bytes(1), 'base64url')).toBe('AQ');
    expect(decodeBuffer(bytes(1, 2), 'base64')).toBe('AQI=');
    expect(decodeBuffer(bytes(1, 2), 'base64url')).toBe('AQI');
  });

  it('round-trips arbitrary bytes through both alphabets', () => {
    const data = new Uint8Array(256);
    for (let i = 0; i < 256; i++) data[i] = i;
    for (const enc of ['base64', 'base64url'] as const) {
      expect(list(encodeString(decodeBuffer(data, enc), enc))).toEqual(list(data));
    }
  });
});

describe('hex', () => {
  it('stops at the first pair that is not two hex digits', () => {
    // The old parseInt-based parser produced a silent 0x00 in the middle: [65, 0, 66].
    expect(list(encodeString('41zz42', 'hex'))).toEqual([0x41]);
    expect(list(encodeString('zz', 'hex'))).toEqual([]);
  });

  it('ignores a trailing odd character', () => {
    expect(list(encodeString('414', 'hex'))).toEqual([0x41]);
    expect(list(encodeString('4', 'hex'))).toEqual([]);
    expect(list(encodeString('', 'hex'))).toEqual([]);
  });

  it('accepts upper and lower case digits', () => {
    expect(list(encodeString('DEADbeef', 'hex'))).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });
});

describe('ascii vs latin1 asymmetry', () => {
  it('encodes both by truncating to the low byte', () => {
    // Buffer.from('é','ascii') is [0xE9] — encoding does NOT mask to 7 bits.
    expect(list(encodeString('é', 'ascii'))).toEqual([0xe9]);
    expect(list(encodeString('€', 'ascii'))).toEqual([0xac]); // '€' → 8364 & 0xff
    expect(list(encodeString('€', 'latin1'))).toEqual([0xac]);
  });

  it('masks to 7 bits only when decoding ascii', () => {
    expect(decodeBuffer(bytes(233), 'ascii')).toBe('i');
    expect(decodeBuffer(bytes(200), 'ascii')).toBe('H');
    expect(decodeBuffer(bytes(233), 'latin1')).toBe('é');
  });
});

describe('utf16le', () => {
  it('drops a trailing odd byte rather than emitting a replacement character', () => {
    expect(decodeBuffer(bytes(65, 0, 66), 'utf16le')).toBe('A');
  });

  it('round-trips a surrogate pair', () => {
    expect(list(encodeString('\u{1F600}', 'utf16le'))).toEqual([61, 216, 0, 222]);
    expect(decodeBuffer(bytes(61, 216, 0, 222), 'utf16le')).toBe('\u{1F600}');
  });
});

describe('large buffers', () => {
  it('decodes past the argument-count limit of fromCharCode.apply', () => {
    // A chunked build is required here: apply() on a 200k-element array overflows the stack.
    const data = new Uint8Array(200_000).fill(0x41);
    expect(decodeBuffer(data, 'latin1')).toHaveLength(200_000);
    expect(decodeBuffer(data, 'latin1').slice(0, 3)).toBe('AAA');
  });
});

describe('readdir and readlink honour the encoding too', () => {
  /** Encode a names-only readdir response frame. */
  function encodeNames(names: string[]): Uint8Array {
    const encoded = names.map((n) => new TextEncoder().encode(n));
    let size = 4;
    for (const b of encoded) size += 2 + b.byteLength;
    const buf = new Uint8Array(size);
    const view = new DataView(buf.buffer);
    view.setUint32(0, names.length, true);
    let off = 4;
    for (const b of encoded) {
      view.setUint16(off, b.byteLength, true);
      off += 2;
      buf.set(b, off);
      off += b.byteLength;
    }
    return buf;
  }

  const dirWith = (names: string[]) => () => ({ status: 0, data: encodeNames(names) });
  const linkTo = (target: string) => () => ({ status: 0, data: new TextEncoder().encode(target) });

  it('readdir rejects an unknown encoding instead of returning UTF-8 names', () => {
    expect(() => readdirSync(dirWith(['a.txt']), '/d', 'nope' as never)).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_VALUE' })
    );
  });

  it('readdir decodes names in the requested encoding', () => {
    // 'é' is two UTF-8 bytes; read back as latin1 they are two separate characters.
    expect(readdirSync(dirWith(['é']), '/d', 'latin1')).toEqual(['Ã©']);
    expect(readdirSync(dirWith(['é']), '/d', 'utf8')).toEqual(['é']);
    expect(readdirSync(dirWith(['AB']), '/d', 'hex')).toEqual(['4142']);
  });

  it('readdir still returns raw bytes for the buffer encoding', () => {
    const [name] = readdirSync(dirWith(['hi']), '/d', 'buffer') as Uint8Array[];
    expect(list(name)).toEqual([104, 105]);
  });

  it('readlink rejects an unknown encoding', () => {
    expect(() => readlinkSync(linkTo('/target'), '/link', 'nope')).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_VALUE' })
    );
  });

  it('readlink decodes the target in the requested encoding', () => {
    expect(readlinkSync(linkTo('AB'), '/link', 'hex')).toBe('4142');
    expect(readlinkSync(linkTo('/t'), '/link')).toBe('/t');
    expect(list(readlinkSync(linkTo('hi'), '/link', 'buffer') as Uint8Array)).toEqual([104, 105]);
  });
});
