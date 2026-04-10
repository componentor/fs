/**
 * PathLike Tests
 *
 * Tests that filesystem methods accept string, Uint8Array, and URL path arguments,
 * and that toPathString correctly normalizes each variant.
 */

import { describe, it, expect, vi } from 'vitest';
import { toPathString } from '../src/path.js';
import { readFileSync } from '../src/methods/readFile.js';
import { statSync } from '../src/methods/stat.js';
import { existsSync } from '../src/methods/exists.js';

const encoder = new TextEncoder();

describe('toPathString', () => {
  it('passes through string paths unchanged', () => {
    expect(toPathString('/foo/bar.txt')).toBe('/foo/bar.txt');
  });

  it('decodes Uint8Array paths as UTF-8', () => {
    const buf = encoder.encode('/hello/world.txt');
    expect(toPathString(buf)).toBe('/hello/world.txt');
  });

  it('extracts pathname from file: URLs', () => {
    const url = new URL('file:///tmp/test.txt');
    expect(toPathString(url)).toBe('/tmp/test.txt');
  });

  it('decodes percent-encoded file: URL pathnames', () => {
    const url = new URL('file:///tmp/my%20file.txt');
    expect(toPathString(url)).toBe('/tmp/my file.txt');
  });

  it('throws TypeError for non-file: URLs', () => {
    const url = new URL('https://example.com/file.txt');
    expect(() => toPathString(url)).toThrow(TypeError);
    expect(() => toPathString(url)).toThrow(/file/);
  });
});

describe('readFileSync accepts PathLike', () => {
  it('works with a string path', () => {
    const syncRequest = vi.fn().mockReturnValue({ status: 0, data: encoder.encode('content') });
    const result = readFileSync(syncRequest, '/test.txt');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(syncRequest).toHaveBeenCalledTimes(1);
  });

  it('works with a Uint8Array path (via toPathString at call site)', () => {
    const syncRequest = vi.fn().mockReturnValue({ status: 0, data: encoder.encode('content') });
    const path = encoder.encode('/test.txt');
    // The public VFSFileSystem.readFileSync calls toPathString, but the internal
    // _readFileSync takes a string. We test the conversion here:
    const resolved = toPathString(path);
    expect(resolved).toBe('/test.txt');
    const result = readFileSync(syncRequest, resolved);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('works with a file: URL path (via toPathString at call site)', () => {
    const syncRequest = vi.fn().mockReturnValue({ status: 0, data: encoder.encode('content') });
    const url = new URL('file:///test.txt');
    const resolved = toPathString(url);
    expect(resolved).toBe('/test.txt');
    const result = readFileSync(syncRequest, resolved);
    expect(result).toBeInstanceOf(Uint8Array);
  });
});

describe('statSync accepts PathLike via toPathString', () => {
  it('works with a Uint8Array path', () => {
    // statSync expects status 0 and a data payload with stat fields
    // Build a minimal stat response: 13 uint32 fields (52 bytes)
    const statData = new Uint8Array(52);
    const view = new DataView(statData.buffer);
    // mode field at offset 8 (field index 2): set S_IFREG (0o100644)
    view.setUint32(8, 0o100644, true);
    // size at offset 24 (field index 6)
    view.setUint32(24, 42, true);

    const syncRequest = vi.fn().mockReturnValue({ status: 0, data: statData });
    const path = encoder.encode('/some/file.txt');
    const resolved = toPathString(path);
    expect(resolved).toBe('/some/file.txt');
    const stats = statSync(syncRequest, resolved);
    expect(stats).toBeDefined();
  });
});

describe('existsSync accepts PathLike via toPathString', () => {
  it('works with a URL path', () => {
    const syncRequest = vi.fn().mockReturnValue({ status: 0, data: new Uint8Array([1]) });
    const url = new URL('file:///exists.txt');
    const resolved = toPathString(url);
    expect(resolved).toBe('/exists.txt');
    const result = existsSync(syncRequest, resolved);
    expect(result).toBe(true);
  });

  it('returns false for non-existent path via URL', () => {
    // status -2 = ENOENT
    const syncRequest = vi.fn().mockReturnValue({ status: -2, data: null });
    const url = new URL('file:///nope.txt');
    const resolved = toPathString(url);
    const result = existsSync(syncRequest, resolved);
    expect(result).toBe(false);
  });
});
