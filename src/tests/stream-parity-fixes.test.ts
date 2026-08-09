/**
 * The five stream divergences found reviewing 3.3.28, each pinned against real `node:fs`.
 *
 * They shared a cause worth naming: the stream layer was written against what the *stream* needs
 * rather than against what node observably does, so each one looked correct in isolation. Every
 * expectation below was taken from a live `node:fs` run in the same test, not from the docs —
 * two of these (the `end` byte budget, and reading from a handle's cursor) are things the docs
 * describe differently from how node behaves.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as nodefs from 'node:fs';
import * as nodefsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFsHarness } from './helpers/engine-transport.js';
import type { VFSFileSystem } from '../src/filesystem.js';

let fs: VFSFileSystem;
let root: string;

beforeEach(() => {
  fs = createFsHarness().fs;
  root = nodefs.mkdtempSync(join(tmpdir(), 'stream-fix-'));
});
afterEach(() => nodefs.rmSync(root, { recursive: true, force: true }));

const real = (p: string) => join(root, p);

/** Drain a readable to a string, failing rather than hanging. */
function drain(stream: any, label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    const chunks: Uint8Array[] = [];
    const timer = setTimeout(() => reject(new Error(`${label}: stream never ended`)), 10_000);
    stream.on('data', (c: Uint8Array | string) => {
      if (typeof c === 'string') text += c; else chunks.push(c);
    });
    stream.on('end', () => {
      clearTimeout(timer);
      if (chunks.length) {
        const total = chunks.reduce((n, c) => n + c.byteLength, 0);
        const b = new Uint8Array(total);
        let at = 0;
        for (const c of chunks) { b.set(c, at); at += c.byteLength; }
        text += new TextDecoder().decode(b);
      }
      resolve(text);
    });
    stream.on('error', (e: Error) => { clearTimeout(timer); reject(e); });
  });
}

/** Write both filesystems the same bytes. */
function seed(name: string, body: string | Uint8Array) {
  fs.writeFileSync('/' + name, body as never);
  nodefs.writeFileSync(real(name), body as never);
}

// ---------------------------------------------------------------------------
// 1. setEncoding across a chunk boundary
// ---------------------------------------------------------------------------

describe('a multi-byte character split across two chunks', () => {
  // Decoding each 64 KB chunk with its own TextDecoder turned every character that straddled a
  // boundary into two U+FFFDs — silent corruption, since the surrounding text decoded fine.
  it('survives a 2-byte character on the 64KB boundary, as in node', async () => {
    seed('m', 'a'.repeat(65535) + 'é' + 'b'.repeat(10));
    const ours = await drain(fs.createReadStream('/m', 'utf8'), 'ours');
    const theirs = await drain(nodefs.createReadStream(real('m'), 'utf8'), 'node');

    expect(ours).toBe(theirs);
    expect(ours).toContain('é');
    expect(ours).not.toContain('�');
  });

  it('survives a 4-byte character split at every offset across the boundary', async () => {
    // An emoji is four bytes, so it can be cut in three different places.
    for (const pad of [65533, 65534, 65535, 65536]) {
      seed('e', 'a'.repeat(pad) + '😀' + 'b');
      const ours = await drain(fs.createReadStream('/e', 'utf8'), 'ours');
      const theirs = await drain(nodefs.createReadStream(real('e'), 'utf8'), 'node');
      expect(ours, `pad=${pad}`).toBe(theirs);
      expect(ours, `pad=${pad}`).toContain('😀');
    }
  });

  it('flushes a truncated character at EOF the way node does', async () => {
    // A lone lead byte with nothing after it: node emits the replacement character rather
    // than dropping the byte.
    seed('t', new Uint8Array([0x61, 0xe2, 0x82]));
    const ours = await drain(fs.createReadStream('/t', 'utf8'), 'ours');
    const theirs = await drain(nodefs.createReadStream(real('t'), 'utf8'), 'node');
    expect(ours).toBe(theirs);
  });

  it('keeps a utf16le surrogate pair whole when the chunk splits it', async () => {
    // Two bytes per unit and four per astral character, so the boundary can fall *between* the
    // two units of one character. Emitting each half separately yields two lone surrogates
    // instead of the emoji; node holds the lead surrogate back for the next chunk.
    // 32767 units of padding puts the emoji's two units either side of byte 65536.
    for (const pad of [32766, 32767, 32768]) {
      seed('u16', new Uint8Array(Buffer.from('a'.repeat(pad) + '😀' + 'bc', 'utf16le')));
      const ours = await drain(fs.createReadStream('/u16', 'utf16le'), 'ours');
      const theirs = await drain(nodefs.createReadStream(real('u16'), 'utf16le'), 'node');
      expect(ours, `pad=${pad}`).toBe(theirs);
      expect(ours, `pad=${pad}`).toContain('😀');
    }
  });

  it('drops a stray odd trailing byte in utf16le, as node does', async () => {
    seed('u16odd', new Uint8Array([0x41, 0x00, 0x42]));
    expect(await drain(fs.createReadStream('/u16odd', 'utf16le'), 'ours'))
      .toBe(await drain(nodefs.createReadStream(real('u16odd'), 'utf16le'), 'node'));
  });

  it('handles latin1 across a boundary', async () => {
    const bytes = new Uint8Array(65537);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i % 251) + 1;
    seed('l1', bytes);
    expect(await drain(fs.createReadStream('/l1', 'latin1'), 'ours'))
      .toBe(await drain(nodefs.createReadStream(real('l1'), 'latin1'), 'node'));
  });
});

// ---------------------------------------------------------------------------
// 2. a handle-backed stream starts at the handle's cursor
// ---------------------------------------------------------------------------

describe('a stream over a FileHandle reads from the handle position', () => {
  it('picks up where the handle left off', async () => {
    seed('c', 'ABCDEFGHIJ');

    const nh = await nodefsp.open(real('c'), 'r');
    await nh.read(Buffer.alloc(2), 0, 2);
    const theirs = await drain(nh.createReadStream(), 'node');

    const oh = await fs.promises.open('/c', 'r');
    await oh.read(new Uint8Array(2), 0, 2);
    const ours = await drain(oh.createReadStream() as never, 'ours');

    expect(ours).toBe(theirs);
    expect(ours).toBe('CDEFGHIJ');
  });

  it('treats `end` as a byte budget from `start ?? 0`, not an absolute offset', async () => {
    // Node's documented wording says offset, but a handle at position 2 given `{end: 3}` yields
    // four bytes, not two. `start` present makes it absolute-inclusive again.
    const cases: Array<{ move: number; opts?: { start?: number; end?: number } }> = [
      { move: 2, opts: { end: 3 } },
      { move: 2, opts: { start: 1, end: 3 } },
      { move: 0, opts: { end: 3 } },
      { move: 3, opts: undefined },
    ];
    for (const { move, opts } of cases) {
      seed('d', 'ABCDEFGHIJ');
      const nh = await nodefsp.open(real('d'), 'r');
      if (move) await nh.read(Buffer.alloc(move), 0, move);
      const theirs = await drain(nh.createReadStream(opts), 'node');

      const oh = await fs.promises.open('/d', 'r');
      if (move) await oh.read(new Uint8Array(move), 0, move);
      const ours = await drain(oh.createReadStream(opts as never) as never, 'ours');

      expect(ours, `move=${move} opts=${JSON.stringify(opts)}`).toBe(theirs);
    }
  });

  it('leaves a path-backed stream reading from zero', async () => {
    seed('p', 'ABCDEFGHIJ');
    expect(await drain(fs.createReadStream('/p'), 'ours'))
      .toBe(await drain(nodefs.createReadStream(real('p')), 'node'));
    expect(await drain(fs.createReadStream('/p', { start: 2, end: 5 }), 'ours'))
      .toBe(await drain(nodefs.createReadStream(real('p'), { start: 2, end: 5 }), 'node'));
  });

  it('writes through a handle at its current position', async () => {
    seed('w', 'AAAAAA');
    const nh = await nodefsp.open(real('w'), 'r+');
    await nh.write(Buffer.from('XY'), 0, 2);
    await new Promise<void>((res, rej) => {
      const ws = nh.createWriteStream();
      ws.on('finish', () => res()); ws.on('error', rej); ws.end('Z');
    });

    const oh = await fs.promises.open('/w', 'r+');
    await oh.write(new TextEncoder().encode('XY'), 0, 2);
    await new Promise<void>((res, rej) => {
      const ws = oh.createWriteStream() as never as {
        on(e: string, f: (x?: unknown) => void): void; end(c: string): void;
      };
      ws.on('finish', () => res()); ws.on('error', rej); ws.end('Z');
    });

    expect(fs.readFileSync('/w', 'utf8')).toBe(nodefs.readFileSync(real('w'), 'utf8'));
  });
});

// ---------------------------------------------------------------------------
// 3. leaving a for-await loop early releases the handle
// ---------------------------------------------------------------------------

describe('breaking out of `for await` destroys the stream', () => {
  const body = 'x'.repeat(300_000);

  it('closes the handle, as node does', async () => {
    seed('b', body);

    const nh = await nodefsp.open(real('b'), 'r');
    for await (const _c of nh.createReadStream()) break;
    await new Promise(r => setTimeout(r, 200));
    let theirs = 'open';
    try { await nh.stat(); } catch (e) { theirs = (e as { code: string }).code; }

    const oh = await fs.promises.open('/b', 'r');
    for await (const _c of oh.createReadStream() as never as AsyncIterable<unknown>) break;
    await new Promise(r => setTimeout(r, 200));
    let ours = 'open';
    try { await oh.stat(); } catch (e) { ours = (e as { code: string }).code; }

    expect(ours).toBe(theirs);
    expect(ours).toBe('EBADF');
  });

  it('releases the handle when the loop body throws', async () => {
    seed('b2', body);
    const oh = await fs.promises.open('/b2', 'r');
    await expect(async () => {
      for await (const _c of oh.createReadStream() as never as AsyncIterable<unknown>) {
        throw new Error('consumer failed');
      }
    }).rejects.toThrow('consumer failed');
    await new Promise(r => setTimeout(r, 200));
    await expect(oh.stat()).rejects.toMatchObject({ code: 'EBADF' });
  });

  it('still leaves a caller-owned handle open with autoClose: false', async () => {
    seed('b3', body);
    const oh = await fs.promises.open('/b3', 'r');
    const s = oh.createReadStream({ autoClose: false } as never);
    for await (const _c of s as never as AsyncIterable<unknown>) break;
    await new Promise(r => setTimeout(r, 200));
    await expect(oh.stat()).resolves.toBeDefined();
    await oh.close();
  });

  it('a loop that runs to completion still ends normally', async () => {
    seed('b4', 'hello world');
    const chunks: string[] = [];
    for await (const c of fs.createReadStream('/b4') as never as AsyncIterable<Uint8Array>) {
      chunks.push(new TextDecoder().decode(c));
    }
    expect(chunks.join('')).toBe('hello world');
  });
});

// ---------------------------------------------------------------------------
// 4. write after end
// ---------------------------------------------------------------------------

describe('write() after end()', () => {
  it('reports ERR_STREAM_WRITE_AFTER_END rather than racing the close', async () => {
    const nodeErr = await new Promise<string>((res) => {
      const ws = nodefs.createWriteStream(real('x'));
      ws.on('error', () => {});
      ws.end('A');
      ws.write('B', (e: unknown) => res(e ? (e as { code: string }).code : 'no-error'));
    });

    const ourErr = await new Promise<string>((res) => {
      const ws = fs.createWriteStream('/x') as never as {
        on(e: string, f: (x?: unknown) => void): void;
        end(c: string): void;
        write(c: string, cb: (e?: unknown) => void): boolean;
      };
      ws.on('error', () => {});
      ws.end('A');
      ws.write('B', (e: unknown) => res(e ? (e as { code: string }).code : 'no-error'));
    });

    expect(ourErr).toBe(nodeErr);
    expect(ourErr).toBe('ERR_STREAM_WRITE_AFTER_END');
  });

  it('returns false and does not write the bytes', async () => {
    const ws = fs.createWriteStream('/y') as never as {
      on(e: string, f: (x?: unknown) => void): void;
      end(c: string, cb?: () => void): void;
      write(c: string): boolean;
    };
    ws.on('error', () => {});
    await new Promise<void>((res) => ws.end('A', () => res()));
    expect(ws.write('B')).toBe(false);
    await new Promise(r => setTimeout(r, 100));
    expect(fs.readFileSync('/y', 'utf8')).toBe('A');
  });

  it('emits error even when the write passed no callback', async () => {
    const ws = fs.createWriteStream('/z') as never as {
      on(e: string, f: (x?: unknown) => void): void;
      end(c: string): void;
      write(c: string): boolean;
    };
    const seen = new Promise<string>((res) => {
      ws.on('error', (e: unknown) => res((e as { code: string }).code));
    });
    ws.end('A');
    ws.write('B');
    expect(await seen).toBe('ERR_STREAM_WRITE_AFTER_END');
  });

  it('still writes the chunk passed to end() itself', async () => {
    await new Promise<void>((res) => {
      const ws = fs.createWriteStream('/q') as never as {
        on(e: string, f: () => void): void; end(c: string): void;
      };
      ws.on('finish', () => res());
      ws.end('final');
    });
    expect(fs.readFileSync('/q', 'utf8')).toBe('final');
  });
});

// ---------------------------------------------------------------------------
// 5. the write encoding argument
// ---------------------------------------------------------------------------

describe('a string chunk is encoded with the requested encoding', () => {
  const bytesOf = (p: string) => [...(fs.readFileSync('/' + p) as Uint8Array)];
  const nodeBytesOf = (p: string) => [...nodefs.readFileSync(real(p))];

  it('honours a per-write encoding, matching node', async () => {
    for (const enc of ['latin1', 'utf8', 'hex', 'base64', 'ascii'] as const) {
      const text = enc === 'hex' ? '48656c6c6f' : enc === 'base64' ? 'SGVsbG8=' : 'héllo';
      const name = `enc-${enc}`;

      await new Promise<void>((res) => {
        const ws = nodefs.createWriteStream(real(name));
        ws.end(text, enc, () => res());
      });
      await new Promise<void>((res) => {
        const ws = fs.createWriteStream('/' + name) as never as {
          on(e: string, f: () => void): void; end(c: string, enc: string): void;
        };
        ws.on('finish', () => res());
        ws.end(text, enc);
      });

      expect(bytesOf(name), enc).toEqual(nodeBytesOf(name));
    }
  });

  it('honours the stream-level encoding option for later writes', async () => {
    await new Promise<void>((res) => {
      const ws = nodefs.createWriteStream(real('opt'), { encoding: 'latin1' });
      ws.write('é');
      ws.end('ü', () => res());
    });
    await new Promise<void>((res) => {
      const ws = fs.createWriteStream('/opt', { encoding: 'latin1' } as never) as never as {
        on(e: string, f: () => void): void; write(c: string): boolean; end(c: string): void;
      };
      ws.on('finish', () => res());
      ws.write('é');
      ws.end('ü');
    });
    expect(bytesOf('opt')).toEqual(nodeBytesOf('opt'));
  });

  it('leaves the default at utf8', async () => {
    await new Promise<void>((res) => {
      const ws = fs.createWriteStream('/def') as never as {
        on(e: string, f: () => void): void; end(c: string): void;
      };
      ws.on('finish', () => res());
      ws.end('héllo');
    });
    expect(bytesOf('def')).toEqual([...new TextEncoder().encode('héllo')]);
  });
});
