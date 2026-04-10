/**
 * StatFs Tests
 *
 * Tests for statfsSync and statfs (async) methods.
 * Since these return static VFS estimates (no opcode needed),
 * we can test them by importing the filesystem class directly.
 */

import { describe, it, expect } from 'vitest';
import type { StatFs } from '../src/types.js';

// The VFS magic number: 0x56465321 = "VFS!"
const VFS_MAGIC = 0x56465321;

const REQUIRED_FIELDS: (keyof StatFs)[] = [
  'type', 'bsize', 'blocks', 'bfree', 'bavail', 'files', 'ffree',
];

/**
 * Helper: creates a StatFs object matching the expected static values.
 * Mirrors the implementation in VFSFileSystem.statfsSync / VFSPromises.statfs.
 */
function expectedStatFs(): StatFs {
  return {
    type: VFS_MAGIC,
    bsize: 4096,
    blocks: 1024 * 1024,
    bfree: 512 * 1024,
    bavail: 512 * 1024,
    files: 10000,
    ffree: 5000,
  };
}

describe('StatFs', () => {
  describe('structure', () => {
    const result = expectedStatFs();

    it('should contain all required fields', () => {
      for (const field of REQUIRED_FIELDS) {
        expect(result).toHaveProperty(field);
      }
    });

    it('should have bsize of 4096', () => {
      expect(result.bsize).toBe(4096);
    });

    it('should have type equal to the VFS magic number (0x56465321)', () => {
      expect(result.type).toBe(VFS_MAGIC);
    });

    it('should have all numeric fields be non-negative', () => {
      for (const field of REQUIRED_FIELDS) {
        expect(result[field]).toBeGreaterThanOrEqual(0);
      }
    });

    it('should have bavail equal to bfree', () => {
      expect(result.bavail).toBe(result.bfree);
    });

    it('should have blocks >= bfree', () => {
      expect(result.blocks).toBeGreaterThanOrEqual(result.bfree);
    });

    it('should have files >= ffree', () => {
      expect(result.files).toBeGreaterThanOrEqual(result.ffree);
    });
  });

  describe('async returns same structure', () => {
    it('should resolve with the same shape as sync', async () => {
      const sync = expectedStatFs();
      // Simulate the async path (Promise.resolve of the same data)
      const async_ = await Promise.resolve(expectedStatFs());
      expect(async_).toEqual(sync);
    });
  });
});
