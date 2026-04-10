/**
 * Tests for missing aliases and exports:
 * - realpath.native / realpathSync.native
 * - promises.constants
 * - ReadStream / WriteStream class exports
 * - FileHandle readv/writev (already tested in vector-io, just verify existence)
 */

import { describe, it, expect, vi } from 'vitest';
import { VFSFileSystem, NodeReadable, NodeWritable, constants } from '../src/index.js';
import { open } from '../src/methods/open.js';
import { OP } from '../src/protocol/opcodes.js';
import type { AsyncRequestFn } from '../src/methods/context.js';

// We also verify the re-exports exist
import { ReadStream, WriteStream } from '../src/index.js';

describe('ReadStream / WriteStream exports', () => {
  it('ReadStream is exported and is NodeReadable', () => {
    expect(ReadStream).toBe(NodeReadable);
  });

  it('WriteStream is exported and is NodeWritable', () => {
    expect(WriteStream).toBe(NodeWritable);
  });

  it('ReadStream is a constructor/class', () => {
    expect(typeof ReadStream).toBe('function');
  });

  it('WriteStream is a constructor/class', () => {
    expect(typeof WriteStream).toBe('function');
  });
});

describe('promises.constants', () => {
  it('VFSFileSystem instance exposes promises.constants', () => {
    // VFSFileSystem constructor spawns workers; in test env Worker may not exist.
    // Stub Worker globally so the constructor succeeds when needed.
    let fs: VFSFileSystem;
    try {
      fs = new VFSFileSystem();
    } catch {
      (globalThis as any).Worker = class { postMessage() {} addEventListener() {} };
      try {
        fs = new VFSFileSystem({ root: '/test-constants' });
      } finally {
        delete (globalThis as any).Worker;
      }
    }
    const c = fs!.promises.constants;
    expect(c).toBeDefined();
    expect(c.F_OK).toBe(0);
    expect(c.R_OK).toBe(4);
    expect(c.W_OK).toBe(2);
    expect(c.X_OK).toBe(1);
    expect(c.O_RDONLY).toBe(0);
    expect(c.O_WRONLY).toBe(1);
    expect(c.O_RDWR).toBe(2);
    expect(c.COPYFILE_EXCL).toBe(1);
  });

  it('promises.constants matches top-level constants', () => {
    let fs: VFSFileSystem;
    try {
      fs = new VFSFileSystem();
    } catch {
      (globalThis as any).Worker = class { postMessage() {} addEventListener() {} };
      try {
        fs = new VFSFileSystem({ root: '/test-constants-match' });
      } finally {
        delete (globalThis as any).Worker;
      }
    }
    expect(fs!.promises.constants).toBe(constants);
  });
});

describe('realpath.native / realpathSync.native', () => {
  it('realpath.native exists on VFSFileSystem instance', () => {
    const fs = new VFSFileSystem();
    expect((fs.realpath as any).native).toBeDefined();
    expect(typeof (fs.realpath as any).native).toBe('function');
  });

  it('realpathSync.native exists on VFSFileSystem instance', () => {
    const fs = new VFSFileSystem();
    expect((fs.realpathSync as any).native).toBeDefined();
    expect(typeof (fs.realpathSync as any).native).toBe('function');
  });

  it('realpath.native is the same function as realpath', () => {
    const fs = new VFSFileSystem();
    expect((fs.realpath as any).native).toBe(fs.realpath);
  });

  it('realpathSync.native is the same function as realpathSync', () => {
    const fs = new VFSFileSystem();
    expect((fs.realpathSync as any).native).toBe(fs.realpathSync);
  });
});

describe('FileHandle readv/writev existence', () => {
  /**
   * Encode a stat response buffer for a file.
   */
  function encodeStatData(size: number): Uint8Array {
    const buf = new Uint8Array(53);
    const dv = new DataView(buf.buffer);
    dv.setUint8(0, 1); // INODE_TYPE.FILE
    dv.setUint32(1, 0o100644, true);
    dv.setFloat64(5, size, true);
    const now = Date.now();
    dv.setFloat64(13, now, true);
    dv.setFloat64(21, now, true);
    dv.setFloat64(29, now, true);
    dv.setUint32(37, 0, true);
    dv.setUint32(41, 0, true);
    dv.setUint32(45, 1, true);
    dv.setUint32(49, 1, true);
    return buf;
  }

  function createMockAsync() {
    const asyncRequest: AsyncRequestFn = async (op, _path, _flags, _data, _path2, _fdArgs) => {
      if (op === OP.OPEN) {
        const resp = new Uint8Array(4);
        new DataView(resp.buffer).setUint32(0, 7, true);
        return { status: 0, data: resp };
      }
      if (op === OP.FSTAT) {
        return { status: 0, data: encodeStatData(100) };
      }
      if (op === OP.FREAD) {
        return { status: 0, data: new Uint8Array(10) };
      }
      if (op === OP.FWRITE) {
        const resp = new Uint8Array(4);
        new DataView(resp.buffer).setUint32(0, 10, true);
        return { status: 0, data: resp };
      }
      return { status: 0, data: null };
    };
    return asyncRequest;
  }

  it('FileHandle has readv method', async () => {
    const mockAsync = createMockAsync();
    const handle = await open(mockAsync, '/test.txt', 'r', 0o666);
    expect(typeof handle.readv).toBe('function');
    await handle.close();
  });

  it('FileHandle has writev method', async () => {
    const mockAsync = createMockAsync();
    const handle = await open(mockAsync, '/test.txt', 'w', 0o666);
    expect(typeof handle.writev).toBe('function');
    await handle.close();
  });
});
