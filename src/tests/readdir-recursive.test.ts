/**
 * Recursive readdir tests.
 *
 * Mocks the sync/async request functions to simulate a filesystem tree
 * and verifies that `readdirSync` and `readdir` correctly walk nested
 * directories when `recursive: true` is set.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readdir } from '../src/methods/readdir.js';
import { INODE_TYPE } from '../src/vfs/layout.js';
import { OP, decodeRequest } from '../src/protocol/opcodes.js';
import type { Dirent } from '../src/types.js';

/* ------------------------------------------------------------------ */
/*  Helpers to build binary readdir responses                         */
/* ------------------------------------------------------------------ */

interface FakeEntry {
  name: string;
  type: number; // INODE_TYPE.*
}

/** Encode a dirent-style response (withFileTypes flag = 1). */
function encodeDirents(entries: FakeEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const encoded = entries.map(e => ({ bytes: encoder.encode(e.name), type: e.type }));
  let totalSize = 4;
  for (const { bytes } of encoded) totalSize += 2 + bytes.byteLength + 1;

  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);
  view.setUint32(0, entries.length, true);
  let offset = 4;
  for (const { bytes, type } of encoded) {
    view.setUint16(offset, bytes.byteLength, true);
    offset += 2;
    buf.set(bytes, offset);
    offset += bytes.byteLength;
    buf[offset++] = type;
  }
  return buf;
}

/** Encode a names-only response (withFileTypes flag = 0). */
function encodeNames(names: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const encoded = names.map(n => encoder.encode(n));
  let totalSize = 4;
  for (const b of encoded) totalSize += 2 + b.byteLength;

  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);
  view.setUint32(0, names.length, true);
  let offset = 4;
  for (const b of encoded) {
    view.setUint16(offset, b.byteLength, true);
    offset += 2;
    buf.set(b, offset);
    offset += b.byteLength;
  }
  return buf;
}

/* ------------------------------------------------------------------ */
/*  Fake filesystem tree                                              */
/* ------------------------------------------------------------------ */

// Tree layout:
//   /root
//     file1.txt       (file)
//     sub/            (dir)
//       file2.txt     (file)
//       deep/         (dir)
//         file3.txt   (file)
//     empty/          (dir)

const tree: Record<string, FakeEntry[]> = {
  '/root': [
    { name: 'file1.txt', type: INODE_TYPE.FILE },
    { name: 'sub', type: INODE_TYPE.DIRECTORY },
    { name: 'empty', type: INODE_TYPE.DIRECTORY },
  ],
  '/root/sub': [
    { name: 'file2.txt', type: INODE_TYPE.FILE },
    { name: 'deep', type: INODE_TYPE.DIRECTORY },
  ],
  '/root/sub/deep': [
    { name: 'file3.txt', type: INODE_TYPE.FILE },
  ],
  '/root/empty': [],
};

/**
 * Build a mock syncRequest that decodes the binary request, looks up the
 * path in the fake tree, and returns an appropriately encoded response.
 */
function makeSyncRequest() {
  return (buf: ArrayBuffer) => {
    const { path, flags } = decodeRequest(buf);
    const entries = tree[path];
    if (!entries) return { status: 1, data: null }; // ENOENT
    const withFileTypes = flags === 1;
    const data = withFileTypes ? encodeDirents(entries) : encodeNames(entries.map(e => e.name));
    return { status: 0, data };
  };
}

/**
 * Build a mock asyncRequest that returns the same data as the sync variant.
 */
function makeAsyncRequest() {
  const sync = makeSyncRequest();
  return async (
    op: number,
    path: string,
    flags?: number,
    _data?: Uint8Array | string | null,
    _path2?: string,
  ) => {
    // Re-encode the request so we can reuse the sync mock
    const { encodeRequest } = await import('../src/protocol/opcodes.js');
    const buf = encodeRequest(op, path, flags ?? 0);
    return sync(buf);
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('readdir recursive', () => {
  /* ---- Sync ---- */

  describe('readdirSync', () => {
    it('should list nested files with recursive: true (names only)', () => {
      const result = readdirSync(makeSyncRequest(), '/root', { recursive: true }) as string[];
      expect(result).toContain('file1.txt');
      expect(result).toContain('sub');
      expect(result).toContain('sub/file2.txt');
      expect(result).toContain('sub/deep');
      expect(result).toContain('sub/deep/file3.txt');
      expect(result).toContain('empty');
      expect(result).toHaveLength(6);
    });

    it('should return Dirents with relative path names when withFileTypes + recursive', () => {
      const result = readdirSync(makeSyncRequest(), '/root', {
        recursive: true,
        withFileTypes: true,
      }) as Dirent[];

      const names = result.map(d => d.name);
      expect(names).toContain('file1.txt');
      expect(names).toContain('sub');
      expect(names).toContain('sub/file2.txt');
      expect(names).toContain('sub/deep');
      expect(names).toContain('sub/deep/file3.txt');
      expect(names).toContain('empty');

      // Verify type methods work
      const deepFile = result.find(d => d.name === 'sub/deep/file3.txt')!;
      expect(deepFile.isFile()).toBe(true);
      expect(deepFile.isDirectory()).toBe(false);

      const subDir = result.find(d => d.name === 'sub')!;
      expect(subDir.isDirectory()).toBe(true);
      expect(subDir.isFile()).toBe(false);
    });

    it('should handle empty nested directories', () => {
      const result = readdirSync(makeSyncRequest(), '/root/empty', {
        recursive: true,
      }) as string[];
      expect(result).toEqual([]);
    });

    it('should handle deeply nested paths (3+ levels)', () => {
      const result = readdirSync(makeSyncRequest(), '/root/sub', {
        recursive: true,
      }) as string[];
      expect(result).toContain('file2.txt');
      expect(result).toContain('deep');
      expect(result).toContain('deep/file3.txt');
      expect(result).toHaveLength(3);
    });

    it('should work without recursive flag (baseline)', () => {
      const result = readdirSync(makeSyncRequest(), '/root') as string[];
      expect(result).toEqual(['file1.txt', 'sub', 'empty']);
    });
  });

  /* ---- Async ---- */

  describe('readdir (async)', () => {
    it('should list nested files with recursive: true', async () => {
      const result = (await readdir(makeAsyncRequest(), '/root', {
        recursive: true,
      })) as string[];
      expect(result).toContain('file1.txt');
      expect(result).toContain('sub');
      expect(result).toContain('sub/file2.txt');
      expect(result).toContain('sub/deep');
      expect(result).toContain('sub/deep/file3.txt');
      expect(result).toContain('empty');
      expect(result).toHaveLength(6);
    });

    it('should return Dirents with relative paths when withFileTypes + recursive', async () => {
      const result = (await readdir(makeAsyncRequest(), '/root', {
        recursive: true,
        withFileTypes: true,
      })) as Dirent[];

      const names = result.map(d => d.name);
      expect(names).toContain('sub/deep/file3.txt');

      const deepFile = result.find(d => d.name === 'sub/deep/file3.txt')!;
      expect(deepFile.isFile()).toBe(true);
    });

    it('should handle empty directories', async () => {
      const result = (await readdir(makeAsyncRequest(), '/root/empty', {
        recursive: true,
      })) as string[];
      expect(result).toEqual([]);
    });

    it('should handle deeply nested paths (3+ levels)', async () => {
      const result = (await readdir(makeAsyncRequest(), '/root/sub', {
        recursive: true,
      })) as string[];
      expect(result).toContain('file2.txt');
      expect(result).toContain('deep');
      expect(result).toContain('deep/file3.txt');
      expect(result).toHaveLength(3);
    });
  });
});
