/**
 * Tests for emptyStats() nanosecond timestamp fields.
 */

import { describe, it, expect } from 'vitest';
import { emptyStats } from '../src/methods/watch.js';

describe('emptyStats()', () => {
  const stats = emptyStats();

  it('has atimeNs, mtimeNs, ctimeNs, birthtimeNs', () => {
    expect(stats).toHaveProperty('atimeNs');
    expect(stats).toHaveProperty('mtimeNs');
    expect(stats).toHaveProperty('ctimeNs');
    expect(stats).toHaveProperty('birthtimeNs');
  });

  it('all nanosecond fields are 0', () => {
    expect(stats.atimeNs).toBe(0);
    expect(stats.mtimeNs).toBe(0);
    expect(stats.ctimeNs).toBe(0);
    expect(stats.birthtimeNs).toBe(0);
  });

  it('has all standard Stats fields', () => {
    // Type check methods
    expect(typeof stats.isFile).toBe('function');
    expect(typeof stats.isDirectory).toBe('function');
    expect(typeof stats.isBlockDevice).toBe('function');
    expect(typeof stats.isCharacterDevice).toBe('function');
    expect(typeof stats.isSymbolicLink).toBe('function');
    expect(typeof stats.isFIFO).toBe('function');
    expect(typeof stats.isSocket).toBe('function');

    // Numeric fields
    expect(stats.dev).toBe(0);
    expect(stats.ino).toBe(0);
    expect(stats.mode).toBe(0);
    expect(stats.nlink).toBe(0);
    expect(stats.uid).toBe(0);
    expect(stats.gid).toBe(0);
    expect(stats.rdev).toBe(0);
    expect(stats.size).toBe(0);
    expect(stats.blksize).toBe(4096);
    expect(stats.blocks).toBe(0);

    // Millisecond timestamps
    expect(stats.atimeMs).toBe(0);
    expect(stats.mtimeMs).toBe(0);
    expect(stats.ctimeMs).toBe(0);
    expect(stats.birthtimeMs).toBe(0);

    // Date objects
    expect(stats.atime).toEqual(new Date(0));
    expect(stats.mtime).toEqual(new Date(0));
    expect(stats.ctime).toEqual(new Date(0));
    expect(stats.birthtime).toEqual(new Date(0));

    // Nanosecond timestamps
    expect(stats.atimeNs).toBe(0);
    expect(stats.mtimeNs).toBe(0);
    expect(stats.ctimeNs).toBe(0);
    expect(stats.birthtimeNs).toBe(0);
  });
});
