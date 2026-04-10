/**
 * Large Position Tests
 *
 * Verifies that FREAD and FWRITE binary encoding supports positions
 * beyond the 2GB int32 limit by using float64 for the position field.
 */

import { describe, it, expect } from 'vitest';
import { OP, encodeRequest, decodeRequest } from '../src/protocol/opcodes.js';

/**
 * Encode an FREAD request the same way readSync / async-relay does.
 * Layout: fd(u32, 4B) + length(u32, 4B) + position(f64, 8B) = 16 bytes.
 */
function encodeFreadPayload(fd: number, length: number, position: number): ArrayBuffer {
  const fdBuf = new Uint8Array(16);
  const dv = new DataView(fdBuf.buffer);
  dv.setUint32(0, fd, true);
  dv.setUint32(4, length, true);
  dv.setFloat64(8, position, true);
  return encodeRequest(OP.FREAD, '', 0, fdBuf);
}

/**
 * Decode an FREAD request payload the same way the workers do.
 */
function decodeFreadPayload(buf: ArrayBuffer): { fd: number; length: number; position: number } {
  const { data } = decodeRequest(buf);
  if (!data || data.byteLength < 16) throw new Error('Invalid FREAD payload');
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    fd: dv.getUint32(0, true),
    length: dv.getUint32(4, true),
    position: dv.getFloat64(8, true),
  };
}

/**
 * Encode an FWRITE request the same way writeSyncFd / async-relay does.
 * Layout: fd(u32, 4B) + position(f64, 8B) + data = 12 + data.length bytes.
 */
function encodeFwritePayload(fd: number, position: number, writeData: Uint8Array): ArrayBuffer {
  const fdBuf = new Uint8Array(12 + writeData.byteLength);
  const dv = new DataView(fdBuf.buffer);
  dv.setUint32(0, fd, true);
  dv.setFloat64(4, position, true);
  fdBuf.set(writeData, 12);
  return encodeRequest(OP.FWRITE, '', 0, fdBuf);
}

/**
 * Decode an FWRITE request payload the same way the workers do.
 */
function decodeFwritePayload(buf: ArrayBuffer): { fd: number; position: number; writeData: Uint8Array } {
  const { data } = decodeRequest(buf);
  if (!data || data.byteLength < 12) throw new Error('Invalid FWRITE payload');
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    fd: dv.getUint32(0, true),
    position: dv.getFloat64(4, true),
    writeData: data.subarray(12),
  };
}

describe('Large position encoding (FREAD/FWRITE)', () => {
  describe('FREAD position roundtrip', () => {
    const testPositions = [
      { name: 'zero', value: 0 },
      { name: 'sentinel -1 (null position)', value: -1 },
      { name: 'small position', value: 1024 },
      { name: 'max int32', value: 2147483647 },
      { name: 'just above int32 (2GB)', value: 2147483648 },
      { name: '3GB', value: 3 * 1024 * 1024 * 1024 },
      { name: '4GB', value: 4 * 1024 * 1024 * 1024 },
      { name: '10GB', value: 10 * 1024 * 1024 * 1024 },
      { name: '1TB', value: 1024 * 1024 * 1024 * 1024 },
      { name: 'MAX_SAFE_INTEGER', value: Number.MAX_SAFE_INTEGER },
    ];

    for (const { name, value } of testPositions) {
      it(`should roundtrip position: ${name} (${value})`, () => {
        const encoded = encodeFreadPayload(42, 4096, value);
        const decoded = decodeFreadPayload(encoded);

        expect(decoded.fd).toBe(42);
        expect(decoded.length).toBe(4096);
        expect(decoded.position).toBe(value);
      });
    }
  });

  describe('FWRITE position roundtrip', () => {
    const testPositions = [
      { name: 'zero', value: 0 },
      { name: 'sentinel -1 (null position)', value: -1 },
      { name: 'small position', value: 512 },
      { name: 'max int32', value: 2147483647 },
      { name: 'just above int32 (2GB)', value: 2147483648 },
      { name: '5GB', value: 5 * 1024 * 1024 * 1024 },
      { name: '100GB', value: 100 * 1024 * 1024 * 1024 },
      { name: 'MAX_SAFE_INTEGER', value: Number.MAX_SAFE_INTEGER },
    ];

    for (const { name, value } of testPositions) {
      it(`should roundtrip position: ${name} (${value})`, () => {
        const writeData = new TextEncoder().encode('hello world');
        const encoded = encodeFwritePayload(7, value, writeData);
        const decoded = decodeFwritePayload(encoded);

        expect(decoded.fd).toBe(7);
        expect(decoded.position).toBe(value);
        expect(new TextDecoder().decode(decoded.writeData)).toBe('hello world');
      });
    }
  });

  describe('FREAD buffer layout', () => {
    it('should produce a 16-byte payload for FREAD', () => {
      const buf = encodeFreadPayload(1, 100, 0);
      const { data } = decodeRequest(buf);
      expect(data!.byteLength).toBe(16);
    });
  });

  describe('FWRITE buffer layout', () => {
    it('should produce a 12+data byte payload for FWRITE', () => {
      const writeData = new Uint8Array(10);
      const buf = encodeFwritePayload(1, 0, writeData);
      const { data } = decodeRequest(buf);
      expect(data!.byteLength).toBe(12 + 10);
    });
  });
});
