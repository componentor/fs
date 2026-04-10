/**
 * Encoding Utilities Tests
 */

import { describe, it, expect } from 'vitest';
import { decodeBuffer, encodeString } from '../src/encoding.js';

describe('encoding', () => {
  describe('decodeBuffer', () => {
    it('should decode utf-8', () => {
      const data = new TextEncoder().encode('hello world');
      expect(decodeBuffer(data, 'utf8')).toBe('hello world');
      expect(decodeBuffer(data, 'utf-8')).toBe('hello world');
    });

    it('should decode latin1', () => {
      const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0xe9]); // "Hello" + é (0xe9)
      expect(decodeBuffer(data, 'latin1')).toBe('Hello\u00e9');
    });

    it('should treat binary as alias for latin1', () => {
      const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0xe9]);
      expect(decodeBuffer(data, 'binary')).toBe(decodeBuffer(data, 'latin1'));
    });

    it('should decode ascii (mask to 7 bits)', () => {
      const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0xff]);
      const result = decodeBuffer(data, 'ascii');
      // 0xff masked to 7 bits = 0x7f
      expect(result).toBe('Hello\u007f');
    });

    it('should decode hex', () => {
      const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
      expect(decodeBuffer(data, 'hex')).toBe('48656c6c6f');
    });

    it('should decode base64', () => {
      const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
      expect(decodeBuffer(data, 'base64')).toBe('SGVsbG8=');
    });

    it('should decode utf16le', () => {
      // "Hi" in UTF-16LE: H=0x0048, i=0x0069
      const data = new Uint8Array([0x48, 0x00, 0x69, 0x00]);
      expect(decodeBuffer(data, 'utf16le')).toBe('Hi');
      expect(decodeBuffer(data, 'utf-16le')).toBe('Hi');
      expect(decodeBuffer(data, 'ucs2')).toBe('Hi');
      expect(decodeBuffer(data, 'ucs-2')).toBe('Hi');
    });
  });

  describe('encodeString', () => {
    it('should encode utf-8', () => {
      const result = encodeString('hello', 'utf8');
      expect(result).toEqual(new TextEncoder().encode('hello'));
    });

    it('should encode latin1', () => {
      const result = encodeString('Hello\u00e9', 'latin1');
      expect(result).toEqual(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0xe9]));
    });

    it('should encode binary same as latin1', () => {
      const str = 'Hello\u00e9';
      expect(encodeString(str, 'binary')).toEqual(encodeString(str, 'latin1'));
    });

    it('should encode ascii (mask to 7 bits)', () => {
      const result = encodeString('Hello\u00e9', 'ascii');
      // 0xe9 & 0x7f = 0x69 = 'i'
      expect(result).toEqual(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x69]));
    });

    it('should encode hex', () => {
      const result = encodeString('48656c6c6f', 'hex');
      expect(result).toEqual(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]));
    });

    it('should encode base64', () => {
      const result = encodeString('SGVsbG8=', 'base64');
      expect(result).toEqual(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]));
    });

    it('should encode utf16le', () => {
      const result = encodeString('Hi', 'utf16le');
      expect(result).toEqual(new Uint8Array([0x48, 0x00, 0x69, 0x00]));
    });
  });

  describe('roundtrip', () => {
    const testStr = 'Hello, World!';

    it('should roundtrip utf8', () => {
      const encoded = encodeString(testStr, 'utf8');
      expect(decodeBuffer(encoded, 'utf8')).toBe(testStr);
    });

    it('should roundtrip latin1', () => {
      const encoded = encodeString(testStr, 'latin1');
      expect(decodeBuffer(encoded, 'latin1')).toBe(testStr);
    });

    it('should roundtrip hex', () => {
      // Encode bytes to hex, then decode hex back to bytes
      const original = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const hexStr = decodeBuffer(original, 'hex');
      expect(hexStr).toBe('deadbeef');
      const decoded = encodeString(hexStr, 'hex');
      expect(decoded).toEqual(original);
    });

    it('should roundtrip base64', () => {
      const original = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const b64Str = decodeBuffer(original, 'base64');
      const decoded = encodeString(b64Str, 'base64');
      expect(decoded).toEqual(original);
    });

    it('should roundtrip utf16le', () => {
      const encoded = encodeString(testStr, 'utf16le');
      expect(decodeBuffer(encoded, 'utf16le')).toBe(testStr);
    });

    it('should roundtrip binary as latin1 alias', () => {
      const encoded = encodeString(testStr, 'binary');
      expect(decodeBuffer(encoded, 'binary')).toBe(testStr);
      // Cross-alias: encode as binary, decode as latin1
      expect(decodeBuffer(encoded, 'latin1')).toBe(testStr);
    });
  });
});
