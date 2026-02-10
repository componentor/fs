/**
 * Binary Protocol Tests
 *
 * Tests encoding/decoding of the binary protocol used for
 * inter-worker communication.
 */

import { describe, it, expect } from 'vitest';
import {
  encodeRequest, decodeRequest,
  encodeResponse, decodeResponse,
  encodeTwoPathRequest, decodeSecondPath,
  OP,
} from '../src/protocol/opcodes.js';

describe('Binary Protocol', () => {
  describe('encodeRequest / decodeRequest', () => {
    it('should encode and decode a simple request', () => {
      const buf = encodeRequest(OP.READ, '/hello.txt');
      const { op, flags, path, data } = decodeRequest(buf);

      expect(op).toBe(OP.READ);
      expect(flags).toBe(0);
      expect(path).toBe('/hello.txt');
      expect(data).toBeNull();
    });

    it('should encode and decode request with data', () => {
      const payload = new TextEncoder().encode('file content');
      const buf = encodeRequest(OP.WRITE, '/test.txt', 1, payload);
      const { op, flags, path, data } = decodeRequest(buf);

      expect(op).toBe(OP.WRITE);
      expect(flags).toBe(1);
      expect(path).toBe('/test.txt');
      expect(data).not.toBeNull();
      expect(new TextDecoder().decode(data!)).toBe('file content');
    });

    it('should handle empty path', () => {
      const buf = encodeRequest(OP.FSYNC, '');
      const { op, path } = decodeRequest(buf);
      expect(op).toBe(OP.FSYNC);
      expect(path).toBe('');
    });

    it('should handle unicode paths', () => {
      const buf = encodeRequest(OP.STAT, '/日本語/文件.txt');
      const { path } = decodeRequest(buf);
      expect(path).toBe('/日本語/文件.txt');
    });

    it('should handle all operation codes', () => {
      for (const [name, code] of Object.entries(OP)) {
        const buf = encodeRequest(code, '/test');
        const { op } = decodeRequest(buf);
        expect(op).toBe(code);
      }
    });
  });

  describe('encodeResponse / decodeResponse', () => {
    it('should encode and decode success response', () => {
      const buf = encodeResponse(0);
      const { status, data } = decodeResponse(buf);

      expect(status).toBe(0);
      expect(data).toBeNull();
    });

    it('should encode and decode response with data', () => {
      const payload = new TextEncoder().encode('response data');
      const buf = encodeResponse(0, payload);
      const { status, data } = decodeResponse(buf);

      expect(status).toBe(0);
      expect(data).not.toBeNull();
      expect(new TextDecoder().decode(data!)).toBe('response data');
    });

    it('should encode error status', () => {
      const buf = encodeResponse(1); // ENOENT
      const { status } = decodeResponse(buf);
      expect(status).toBe(1);
    });
  });

  describe('encodeTwoPathRequest', () => {
    it('should encode rename request', () => {
      const buf = encodeTwoPathRequest(OP.RENAME, '/old.txt', '/new.txt');
      const { op, path, data } = decodeRequest(buf);

      expect(op).toBe(OP.RENAME);
      expect(path).toBe('/old.txt');
      expect(data).not.toBeNull();

      const secondPath = decodeSecondPath(data!);
      expect(secondPath).toBe('/new.txt');
    });

    it('should encode symlink request', () => {
      const buf = encodeTwoPathRequest(OP.SYMLINK, '/link', '/target');
      const { op, path, data } = decodeRequest(buf);

      expect(op).toBe(OP.SYMLINK);
      expect(path).toBe('/link');
      expect(decodeSecondPath(data!)).toBe('/target');
    });
  });

  describe('binary header sizes', () => {
    it('should produce correct request header size', () => {
      const buf = encodeRequest(OP.READ, '/test');
      // 16 bytes header + 5 bytes path + 0 bytes data = 21
      expect(buf.byteLength).toBe(16 + 5);
    });

    it('should produce correct response header size', () => {
      const buf = encodeResponse(0);
      // 8 bytes header + 0 bytes data = 8
      expect(buf.byteLength).toBe(8);
    });

    it('should produce correct size with data', () => {
      const data = new Uint8Array(100);
      const buf = encodeRequest(OP.WRITE, '/f', 0, data);
      expect(buf.byteLength).toBe(16 + 2 + 100);
    });
  });
});
