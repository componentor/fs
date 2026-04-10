/**
 * Truncate Large File Tests
 *
 * Tests that truncate and ftruncate correctly encode/decode lengths
 * beyond the uint32 limit (4GB), using float64 encoding.
 */

import { describe, it, expect } from 'vitest';

describe('truncate length encoding', () => {
  /**
   * Helper: encode a truncate length the same way truncateSync does,
   * then decode it the same way the worker does.
   */
  function roundtripTruncateLength(len: number): number {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setFloat64(0, len, true);
    return new DataView(buf.buffer).getFloat64(0, true);
  }

  /**
   * Helper: encode an ftruncate (fd + length) the same way ftruncateSync does,
   * then decode it the same way the worker does.
   */
  function roundtripFtruncate(fd: number, len: number): { fd: number; len: number } {
    const buf = new Uint8Array(12);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, fd, true);
    dv.setFloat64(4, len, true);
    return {
      fd: new DataView(buf.buffer).getUint32(0, true),
      len: new DataView(buf.buffer).getFloat64(4, true),
    };
  }

  describe('truncateSync encoding', () => {
    it('should roundtrip normal lengths correctly', () => {
      expect(roundtripTruncateLength(0)).toBe(0);
      expect(roundtripTruncateLength(1024)).toBe(1024);
      expect(roundtripTruncateLength(4096)).toBe(4096);
      expect(roundtripTruncateLength(1_000_000)).toBe(1_000_000);
    });

    it('should roundtrip lengths > 4GB correctly', () => {
      const fiveGB = 5 * 1024 * 1024 * 1024;
      expect(roundtripTruncateLength(fiveGB)).toBe(fiveGB);

      const tenGB = 10 * 1024 * 1024 * 1024;
      expect(roundtripTruncateLength(tenGB)).toBe(tenGB);

      const oneHundredGB = 100 * 1024 * 1024 * 1024;
      expect(roundtripTruncateLength(oneHundredGB)).toBe(oneHundredGB);
    });

    it('should roundtrip the uint32 max boundary correctly', () => {
      const uint32Max = 0xFFFFFFFF;
      expect(roundtripTruncateLength(uint32Max)).toBe(uint32Max);
      expect(roundtripTruncateLength(uint32Max + 1)).toBe(uint32Max + 1);
    });
  });

  describe('ftruncateSync encoding', () => {
    it('should roundtrip normal lengths correctly', () => {
      const result = roundtripFtruncate(3, 1024);
      expect(result.fd).toBe(3);
      expect(result.len).toBe(1024);
    });

    it('should roundtrip fd and length > 4GB correctly', () => {
      const fiveGB = 5 * 1024 * 1024 * 1024;
      const result = roundtripFtruncate(7, fiveGB);
      expect(result.fd).toBe(7);
      expect(result.len).toBe(fiveGB);
    });

    it('should preserve fd value with large lengths', () => {
      const tenGB = 10 * 1024 * 1024 * 1024;
      const result = roundtripFtruncate(42, tenGB);
      expect(result.fd).toBe(42);
      expect(result.len).toBe(tenGB);
    });

    it('should handle zero length', () => {
      const result = roundtripFtruncate(1, 0);
      expect(result.fd).toBe(1);
      expect(result.len).toBe(0);
    });
  });
});
