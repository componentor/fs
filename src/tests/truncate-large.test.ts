/**
 * Truncate length encoding — lengths beyond the uint32 ceiling.
 *
 * `truncate` and `ftruncate` carry their length as a float64 so a file larger than 4 GiB can be
 * shortened. This file used to verify that with its *own* encode/decode helpers: it wrote a
 * float64 and read a float64, so it agreed with itself no matter what the product did — and the
 * shipped server worker was meanwhile reading the field as a uint32, which zeroed every file it
 * was asked to truncate. See CHANGELOG 3.3.6.
 *
 * It now runs the real encoders from [payloads.ts](../src/protocol/payloads.ts) through the real
 * decoder in [dispatch.ts](../src/protocol/dispatch.ts), so a disagreement between them fails
 * here. The large-value coverage that motivated the file is kept.
 */

import { describe, it, expect, vi } from 'vitest';
import { encodeTruncatePayload, encodeFtruncatePayload } from '../src/protocol/payloads.js';
import { dispatchOp } from '../src/protocol/dispatch.js';
import { OP } from '../src/protocol/opcodes.js';
import type { VFSEngine } from '../src/vfs/engine.js';

/** Round-trip a truncate length through the real encoder and the real dispatch decoder. */
function roundtripTruncateLength(len: number): number {
  const truncate = vi.fn(() => ({ status: 0, data: null }));
  dispatchOp({ truncate } as unknown as VFSEngine, 't', OP.TRUNCATE, 0, '/p', encodeTruncatePayload(len));
  return (truncate.mock.calls[0] as unknown as [string, number])[1];
}

/** Same for ftruncate, which also carries the fd. */
function roundtripFtruncate(fd: number, len: number): { fd: number; len: number } {
  const ftruncate = vi.fn(() => ({ status: 0, data: null }));
  dispatchOp({ ftruncate } as unknown as VFSEngine, 't', OP.FTRUNCATE, 0, '', encodeFtruncatePayload(fd, len));
  const call = ftruncate.mock.calls[0] as unknown as [number, number];
  return { fd: call[0], len: call[1] };
}

describe('truncate length encoding', () => {
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
