/**
 * Glob / GlobSync Tests
 *
 * Tests glob pattern matching against a mock filesystem.
 * We mock the sync/async request layer so no real workers are needed.
 */

import { describe, it, expect } from 'vitest';
import { globSync, glob } from '../src/methods/glob.js';
import { OP, encodeRequest } from '../src/protocol/opcodes.js';
import { INODE_TYPE } from '../src/vfs/layout.js';

// ---------------------------------------------------------------------------
// Helpers — build fake responses that readdir / stat decoders understand
// ---------------------------------------------------------------------------

interface MockEntry {
  name: string;
  type: 'file' | 'dir';
}

interface MockFS {
  [dir: string]: MockEntry[];
}

/**
 * Encode a list of names into the binary format expected by decodeNames.
 * Format: 4-byte LE count, then for each name: 2-byte LE length + UTF-8 bytes.
 */
function encodeMockNames(names: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];

  // count (4 bytes LE)
  const countBuf = new Uint8Array(4);
  new DataView(countBuf.buffer).setUint32(0, names.length, true);
  parts.push(countBuf);

  for (const n of names) {
    const encoded = encoder.encode(n);
    const lenBuf = new Uint8Array(2);
    new DataView(lenBuf.buffer).setUint16(0, encoded.length, true);
    parts.push(lenBuf);
    parts.push(encoded);
  }

  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Build a 49-byte stat buffer for a file or directory.
 */
function encodeMockStat(type: 'file' | 'dir'): Uint8Array {
  const buf = new Uint8Array(49);
  const view = new DataView(buf.buffer);
  view.setUint8(0, type === 'dir' ? INODE_TYPE.DIRECTORY : INODE_TYPE.FILE);
  view.setUint32(1, type === 'dir' ? 0o040755 : 0o100644, true);
  view.setFloat64(5, type === 'dir' ? 0 : 100, true);  // size
  view.setFloat64(13, 1700000000000, true); // mtime
  view.setFloat64(21, 1700000000000, true); // ctime
  view.setFloat64(29, 1700000000000, true); // atime
  view.setUint32(37, 0, true);  // uid
  view.setUint32(41, 0, true);  // gid
  view.setUint32(45, 1, true);  // ino
  return buf;
}

/**
 * Create a mock syncRequest function backed by a MockFS.
 */
function createMockSyncRequest(mockFs: MockFS) {
  return (buf: ArrayBuffer): { status: number; data: Uint8Array | null } => {
    const view = new DataView(buf);
    const op = view.getUint32(0, true);
    // Header: op(4) flags(4) pathLen(4) dataLen(4) then path at offset 16
    const pathLen = view.getUint32(8, true);
    const pathBytes = new Uint8Array(buf, 16, pathLen);
    const path = new TextDecoder().decode(pathBytes);

    if (op === OP.READDIR) {
      const entries = mockFs[path];
      if (!entries) return { status: 2, data: null }; // ENOENT
      const names = entries.map((e) => e.name);
      return { status: 0, data: encodeMockNames(names) };
    }

    if (op === OP.STAT) {
      // Find the entry in parent dir
      const lastSlash = path.lastIndexOf('/');
      const parentDir = lastSlash <= 0 ? '/' : path.substring(0, lastSlash);
      const baseName = path.substring(lastSlash + 1);

      // Root dir itself
      if (path === '/') {
        return { status: 0, data: encodeMockStat('dir') };
      }

      const parentEntries = mockFs[parentDir];
      if (!parentEntries) return { status: 2, data: null };
      const entry = parentEntries.find((e) => e.name === baseName);
      if (!entry) return { status: 2, data: null };
      return { status: 0, data: encodeMockStat(entry.type) };
    }

    return { status: 38, data: null }; // ENOSYS
  };
}

/**
 * Create a mock asyncRequest function backed by a MockFS.
 */
function createMockAsyncRequest(mockFs: MockFS) {
  const syncReq = createMockSyncRequest(mockFs);
  return async (
    op: number,
    path: string,
    flags?: number,
  ): Promise<{ status: number; data: Uint8Array | null }> => {
    // Build the same request buffer that encodeRequest would
    const reqBuf = encodeRequest(op, path, flags);
    return syncReq(reqBuf);
  };
}

// ---------------------------------------------------------------------------
// Mock filesystem layout
// ---------------------------------------------------------------------------
// /
//   a.txt
//   b.js
//   dir/
//     c.txt
//     d.txt
//     sub/
//       e.txt
//       x
//       y
// ---------------------------------------------------------------------------

const mockFs: MockFS = {
  '/': [
    { name: 'a.txt', type: 'file' },
    { name: 'b.js', type: 'file' },
    { name: 'dir', type: 'dir' },
  ],
  '/dir': [
    { name: 'c.txt', type: 'file' },
    { name: 'd.txt', type: 'file' },
    { name: 'sub', type: 'dir' },
  ],
  '/dir/sub': [
    { name: 'e.txt', type: 'file' },
    { name: 'x', type: 'file' },
    { name: 'y', type: 'file' },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('globSync', () => {
  const syncRequest = createMockSyncRequest(mockFs);

  it('should match *.txt in cwd /', () => {
    const results = globSync(syncRequest, '*.txt');
    expect(results.sort()).toEqual(['/a.txt']);
  });

  it('should match **/*.txt for nested files', () => {
    const results = globSync(syncRequest, '**/*.txt');
    expect(results.sort()).toEqual([
      '/a.txt',
      '/dir/c.txt',
      '/dir/d.txt',
      '/dir/sub/e.txt',
    ]);
  });

  it('should match dir/? for single-char names', () => {
    const results = globSync(syncRequest, 'dir/sub/?');
    expect(results.sort()).toEqual(['/dir/sub/x', '/dir/sub/y']);
  });

  it('should respect cwd option', () => {
    const results = globSync(syncRequest, '*.txt', { cwd: '/dir' });
    expect(results.sort()).toEqual(['/dir/c.txt', '/dir/d.txt']);
  });

  it('should respect exclude option', () => {
    const results = globSync(syncRequest, '*.txt', {
      exclude: (p) => p === '/a.txt',
    });
    expect(results).toEqual([]);
  });

  it('should return empty array when nothing matches', () => {
    const results = globSync(syncRequest, '*.xyz');
    expect(results).toEqual([]);
  });

  it('should match dir/*.txt', () => {
    const results = globSync(syncRequest, 'dir/*.txt');
    expect(results.sort()).toEqual(['/dir/c.txt', '/dir/d.txt']);
  });
});

describe('glob (async)', () => {
  const asyncRequest = createMockAsyncRequest(mockFs);

  it('should match *.txt in cwd /', async () => {
    const results = await glob(asyncRequest, '*.txt');
    expect(results.sort()).toEqual(['/a.txt']);
  });

  it('should match **/*.txt for nested files', async () => {
    const results = await glob(asyncRequest, '**/*.txt');
    expect(results.sort()).toEqual([
      '/a.txt',
      '/dir/c.txt',
      '/dir/d.txt',
      '/dir/sub/e.txt',
    ]);
  });

  it('should return empty array when nothing matches', async () => {
    const results = await glob(asyncRequest, '*.nope');
    expect(results).toEqual([]);
  });

  it('should respect cwd option', async () => {
    const results = await glob(asyncRequest, '*.txt', { cwd: '/dir' });
    expect(results.sort()).toEqual(['/dir/c.txt', '/dir/d.txt']);
  });

  it('should respect exclude option', async () => {
    const results = await glob(asyncRequest, '**/*.txt', {
      exclude: (p) => p.includes('/dir/sub/'),
    });
    expect(results.sort()).toEqual([
      '/a.txt',
      '/dir/c.txt',
      '/dir/d.txt',
    ]);
  });
});
