/**
 * readlink encoding option tests
 *
 * Tests that readlinkSync and readlink properly handle the encoding option,
 * returning string by default and Uint8Array when encoding is 'buffer'.
 */

import { describe, it, expect } from 'vitest';
import { readlinkSync, readlink } from '../src/methods/symlink.js';
import type { SyncRequestFn, AsyncRequestFn } from '../src/methods/context.js';

const encoder = new TextEncoder();

/** Create a mock syncRequest that returns a successful readlink response */
function mockSyncRequest(target: string): SyncRequestFn {
  const encoded = encoder.encode(target);
  return (_buf: ArrayBuffer) => ({ status: 0, data: encoded });
}

/** Create a mock asyncRequest that returns a successful readlink response */
function mockAsyncRequest(target: string): AsyncRequestFn {
  const encoded = encoder.encode(target);
  return async (_op: number, _path: string, ..._rest: unknown[]) =>
    ({ status: 0, data: encoded });
}

describe('readlink encoding option', () => {
  const target = '/some/target/path';

  describe('readlinkSync', () => {
    it('should return a string by default', () => {
      const result = readlinkSync(mockSyncRequest(target), '/link');
      expect(typeof result).toBe('string');
      expect(result).toBe(target);
    });

    it('should return Uint8Array when encoding is "buffer"', () => {
      const result = readlinkSync(mockSyncRequest(target), '/link', { encoding: 'buffer' });
      expect(result).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(result as Uint8Array)).toBe(target);
    });

    it('should return a string when encoding is "utf8"', () => {
      const result = readlinkSync(mockSyncRequest(target), '/link', { encoding: 'utf8' });
      expect(typeof result).toBe('string');
      expect(result).toBe(target);
    });

    it('should accept string encoding shorthand', () => {
      const bufResult = readlinkSync(mockSyncRequest(target), '/link', 'buffer');
      expect(bufResult).toBeInstanceOf(Uint8Array);

      const strResult = readlinkSync(mockSyncRequest(target), '/link', 'utf8');
      expect(typeof strResult).toBe('string');
      expect(strResult).toBe(target);
    });

    it('should return a string when options is null', () => {
      const result = readlinkSync(mockSyncRequest(target), '/link', null);
      expect(typeof result).toBe('string');
      expect(result).toBe(target);
    });
  });

  describe('readlink (async)', () => {
    it('should return a string by default', async () => {
      const result = await readlink(mockAsyncRequest(target), '/link');
      expect(typeof result).toBe('string');
      expect(result).toBe(target);
    });

    it('should return Uint8Array when encoding is "buffer"', async () => {
      const result = await readlink(mockAsyncRequest(target), '/link', { encoding: 'buffer' });
      expect(result).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(result as Uint8Array)).toBe(target);
    });

    it('should return a string when encoding is "utf8"', async () => {
      const result = await readlink(mockAsyncRequest(target), '/link', { encoding: 'utf8' });
      expect(typeof result).toBe('string');
      expect(result).toBe(target);
    });

    it('should accept string encoding shorthand', async () => {
      const bufResult = await readlink(mockAsyncRequest(target), '/link', 'buffer');
      expect(bufResult).toBeInstanceOf(Uint8Array);

      const strResult = await readlink(mockAsyncRequest(target), '/link', 'utf8');
      expect(typeof strResult).toBe('string');
      expect(strResult).toBe(target);
    });
  });
});
