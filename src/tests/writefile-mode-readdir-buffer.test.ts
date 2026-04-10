/**
 * Tests for:
 * 1. writeFile/writeFileSync respecting the `mode` option
 * 2. readdir/readdirSync supporting `encoding: 'buffer'`
 */

import { describe, it, expect, vi } from 'vitest';
import { writeFileSync, writeFile } from '../src/methods/writeFile.js';
import { readdirSync, readdir } from '../src/methods/readdir.js';
import { OP, decodeRequest } from '../src/protocol/opcodes.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const encoder = new TextEncoder();

/** Encode a names-only readdir response. */
function encodeNames(names: string[]): Uint8Array {
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
/*  writeFile mode tests                                               */
/* ------------------------------------------------------------------ */

describe('writeFileSync with mode option', () => {
  it('applies chmod after write on fast path when mode is specified', () => {
    const calls: { op: number; path: string }[] = [];
    const syncRequest = vi.fn((buf: ArrayBuffer) => {
      const { op, path } = decodeRequest(buf);
      calls.push({ op, path });
      return { status: 0, data: null };
    });

    writeFileSync(syncRequest, '/test.txt', 'hello', { mode: 0o755 });

    // Should have two calls: WRITE then CHMOD
    expect(calls).toHaveLength(2);
    expect(calls[0].op).toBe(OP.WRITE);
    expect(calls[0].path).toBe('/test.txt');
    expect(calls[1].op).toBe(OP.CHMOD);
    expect(calls[1].path).toBe('/test.txt');

    // Verify mode value encoded in CHMOD request
    const chmodBuf = syncRequest.mock.calls[1][0];
    const { data } = decodeRequest(chmodBuf);
    if (data) {
      const mode = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true);
      expect(mode).toBe(0o755);
    }
  });

  it('does not call chmod when mode is not specified (fast path)', () => {
    const calls: { op: number }[] = [];
    const syncRequest = vi.fn((buf: ArrayBuffer) => {
      const { op } = decodeRequest(buf);
      calls.push({ op });
      return { status: 0, data: null };
    });

    writeFileSync(syncRequest, '/test.txt', 'hello');

    // Only WRITE, no CHMOD
    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe(OP.WRITE);
  });

  it('passes mode to openSync on non-default flag path', () => {
    const calls: { op: number; path: string; flags: number }[] = [];
    const syncRequest = vi.fn((buf: ArrayBuffer) => {
      const { op, path, flags } = decodeRequest(buf);
      calls.push({ op, path, flags });
      // OPEN returns fd=5
      if (op === OP.OPEN) {
        const fdBuf = new Uint8Array(4);
        new DataView(fdBuf.buffer).setUint32(0, 5, true);
        return { status: 0, data: fdBuf };
      }
      return { status: 0, data: null };
    });

    writeFileSync(syncRequest, '/test.txt', 'hello', { flag: 'a', mode: 0o644 });

    // Should have OPEN, FWRITE, CLOSE
    expect(calls[0].op).toBe(OP.OPEN);
    expect(calls[0].path).toBe('/test.txt');
  });
});

describe('writeFile async with mode option', () => {
  it('applies chmod after write on fast path when mode is specified', async () => {
    const calls: { op: number; path: string }[] = [];
    const asyncRequest = vi.fn(async (op: number, path: string, _flags: number, _data?: Uint8Array) => {
      calls.push({ op, path });
      return { status: 0, data: null };
    });

    await writeFile(asyncRequest, '/test.txt', 'hello', { mode: 0o755 });

    // Should have two calls: WRITE then CHMOD
    expect(calls).toHaveLength(2);
    expect(calls[0].op).toBe(OP.WRITE);
    expect(calls[0].path).toBe('/test.txt');
    expect(calls[1].op).toBe(OP.CHMOD);
    expect(calls[1].path).toBe('/test.txt');
  });

  it('does not call chmod when mode is not specified', async () => {
    const calls: { op: number }[] = [];
    const asyncRequest = vi.fn(async (op: number, _path: string) => {
      calls.push({ op });
      return { status: 0, data: null };
    });

    await writeFile(asyncRequest, '/test.txt', 'hello');

    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe(OP.WRITE);
  });
});

/* ------------------------------------------------------------------ */
/*  readdir encoding: 'buffer' tests                                   */
/* ------------------------------------------------------------------ */

describe('readdirSync with encoding: buffer', () => {
  it('returns Uint8Array names when encoding is buffer', () => {
    const namesData = encodeNames(['foo.txt', 'bar.txt']);
    const syncRequest = vi.fn((_buf: ArrayBuffer) => {
      return { status: 0, data: namesData };
    });

    const result = readdirSync(syncRequest, '/dir', { encoding: 'buffer' });

    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(Uint8Array);
    expect(result[1]).toBeInstanceOf(Uint8Array);
    // Verify content matches
    expect(new TextDecoder().decode(result[0] as Uint8Array)).toBe('foo.txt');
    expect(new TextDecoder().decode(result[1] as Uint8Array)).toBe('bar.txt');
  });

  it('returns strings by default', () => {
    const namesData = encodeNames(['foo.txt', 'bar.txt']);
    const syncRequest = vi.fn((_buf: ArrayBuffer) => {
      return { status: 0, data: namesData };
    });

    const result = readdirSync(syncRequest, '/dir');

    expect(result).toHaveLength(2);
    expect(typeof result[0]).toBe('string');
    expect(result[0]).toBe('foo.txt');
  });

  it('returns strings when encoding is utf8', () => {
    const namesData = encodeNames(['test.txt']);
    const syncRequest = vi.fn((_buf: ArrayBuffer) => {
      return { status: 0, data: namesData };
    });

    const result = readdirSync(syncRequest, '/dir', { encoding: 'utf8' });

    expect(result).toHaveLength(1);
    expect(typeof result[0]).toBe('string');
    expect(result[0]).toBe('test.txt');
  });
});

describe('readdir async with encoding: buffer', () => {
  it('returns Uint8Array names when encoding is buffer', async () => {
    const namesData = encodeNames(['alpha', 'beta']);
    const asyncRequest = vi.fn(async (_op: number, _path: string, _flags: number) => {
      return { status: 0, data: namesData };
    });

    const result = await readdir(asyncRequest, '/dir', { encoding: 'buffer' });

    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(Uint8Array);
    expect(result[1]).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(result[0] as Uint8Array)).toBe('alpha');
    expect(new TextDecoder().decode(result[1] as Uint8Array)).toBe('beta');
  });

  it('returns strings by default', async () => {
    const namesData = encodeNames(['file.js']);
    const asyncRequest = vi.fn(async (_op: number, _path: string, _flags: number) => {
      return { status: 0, data: namesData };
    });

    const result = await readdir(asyncRequest, '/dir');

    expect(result).toHaveLength(1);
    expect(typeof result[0]).toBe('string');
    expect(result[0]).toBe('file.js');
  });

  it('returns empty array for empty directory', async () => {
    const asyncRequest = vi.fn(async (_op: number, _path: string, _flags: number) => {
      return { status: 0, data: null };
    });

    const result = await readdir(asyncRequest, '/empty', { encoding: 'buffer' });
    expect(result).toHaveLength(0);
  });
});
