/**
 * Tests that recursive readdir with withFileTypes returns Dirents
 * with correct parentPath and path properties.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readdir } from '../src/methods/readdir.js';
import { INODE_TYPE } from '../src/vfs/layout.js';
import { decodeRequest } from '../src/protocol/opcodes.js';
import type { Dirent } from '../src/types.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

interface FakeEntry {
  name: string;
  type: number;
}

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

/* ------------------------------------------------------------------ */
/*  Fake filesystem tree                                              */
/* ------------------------------------------------------------------ */

// Tree layout:
//   /mydir
//     hello.txt       (file)
//     subdir/         (dir)
//       nested.txt    (file)
//       deep/         (dir)
//         bottom.txt  (file)

const tree: Record<string, FakeEntry[]> = {
  '/mydir': [
    { name: 'hello.txt', type: INODE_TYPE.FILE },
    { name: 'subdir', type: INODE_TYPE.DIRECTORY },
  ],
  '/mydir/subdir': [
    { name: 'nested.txt', type: INODE_TYPE.FILE },
    { name: 'deep', type: INODE_TYPE.DIRECTORY },
  ],
  '/mydir/subdir/deep': [
    { name: 'bottom.txt', type: INODE_TYPE.FILE },
  ],
};

function makeSyncRequest() {
  return (buf: ArrayBuffer) => {
    const { path } = decodeRequest(buf);
    const entries = tree[path];
    if (!entries) return { status: 1, data: null };
    const data = encodeDirents(entries);
    return { status: 0, data };
  };
}

function makeAsyncRequest() {
  const sync = makeSyncRequest();
  return async (
    op: number,
    path: string,
    flags?: number,
    _data?: Uint8Array | string | null,
    _path2?: string,
  ) => {
    const { encodeRequest } = await import('../src/protocol/opcodes.js');
    const buf = encodeRequest(op, path, flags ?? 0);
    return sync(buf);
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('recursive readdir Dirent parentPath', () => {
  it('readdirSync recursive with withFileTypes returns Dirents with parentPath', () => {
    const result = readdirSync(makeSyncRequest(), '/mydir', {
      recursive: true,
      withFileTypes: true,
    }) as Dirent[];

    for (const dirent of result) {
      expect(dirent).toHaveProperty('parentPath');
      expect(typeof dirent.parentPath).toBe('string');
    }
  });

  it('a nested dirent carries its basename and the absolute directory holding it', () => {
    // Captured from real node:fs: recursive withFileTypes reports the **basename** in `name`,
    // with the containing directory in `parentPath` — only the names-only recursive form uses
    // relative paths. This file previously asserted `name: 'subdir/nested.txt'` with a relative
    // `parentPath: 'subdir'`, which matched neither Node nor itself: an entry whose name is a
    // path but whose parent is also a path cannot be joined back into a usable location.
    const result = readdirSync(makeSyncRequest(), '/mydir', {
      recursive: true,
      withFileTypes: true,
    }) as Dirent[];

    const nested = result.find(d => d.name === 'nested.txt')!;
    expect(nested).toBeDefined();
    expect(nested.parentPath).toBe('/mydir/subdir');

    const deep = result.find(d => d.name === 'bottom.txt')!;
    expect(deep).toBeDefined();
    expect(deep.parentPath).toBe('/mydir/subdir/deep');
  });

  it('top-level dirent has the original directory as parentPath', () => {
    const result = readdirSync(makeSyncRequest(), '/mydir', {
      recursive: true,
      withFileTypes: true,
    }) as Dirent[];

    const topLevel = result.find(d => d.name === 'hello.txt')!;
    expect(topLevel).toBeDefined();
    expect(topLevel.parentPath).toBe('/mydir');

    const topLevelDir = result.find(d => d.name === 'subdir')!;
    expect(topLevelDir).toBeDefined();
    expect(topLevelDir.parentPath).toBe('/mydir');
  });

  it('dirent.path equals dirent.parentPath', () => {
    const result = readdirSync(makeSyncRequest(), '/mydir', {
      recursive: true,
      withFileTypes: true,
    }) as Dirent[];

    for (const dirent of result) {
      expect(dirent.path).toBe(dirent.parentPath);
    }
  });

  it('async readdir recursive also sets parentPath correctly', async () => {
    const result = (await readdir(makeAsyncRequest(), '/mydir', {
      recursive: true,
      withFileTypes: true,
    })) as Dirent[];

    const topLevel = result.find(d => d.name === 'hello.txt')!;
    expect(topLevel.parentPath).toBe('/mydir');
    expect(topLevel.path).toBe(topLevel.parentPath);

    const nested = result.find(d => d.name === 'nested.txt')!;
    expect(nested.parentPath).toBe('/mydir/subdir');
    expect(nested.path).toBe(nested.parentPath);

    const deep = result.find(d => d.name === 'bottom.txt')!;
    expect(deep.parentPath).toBe('/mydir/subdir/deep');
    expect(deep.path).toBe(deep.parentPath);
  });
});
