/**
 * `FileHandle`'s stream surface, which was missing entirely.
 *
 * `filehandle.createReadStream`, `createWriteStream`, `readLines` and `readableWebStream` are all
 * node APIs; none of them existed here, and `FileHandle` was not an EventEmitter either, so it
 * never emitted `'close'`.
 *
 * The ownership rule is the one worth pinning, and it was read off a live `node:fs`: a stream
 * built from a handle **closes that handle** when it finishes, so using the handle afterwards is
 * `EBADF`. Every expectation below is compared against `node:fs` in the same test where the two
 * can be run side by side.
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
const BODY = 'l1\nl2\nl3\n';

beforeEach(() => {
  fs = createFsHarness().fs;
  root = nodefs.mkdtempSync(join(tmpdir(), 'fh-streams-'));
  fs.writeFileSync('/a', BODY);
  nodefs.writeFileSync(join(root, 'a'), BODY);
});
afterEach(() => nodefs.rmSync(root, { recursive: true, force: true }));

const real = (p: string) => join(root, p);

/** Drain a readable to a string, failing rather than hanging. */
function drain(stream: { on(ev: string, fn: (...a: never[]) => void): unknown }, label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const timer = setTimeout(() => reject(new Error(`${label}: stream never ended`)), 10_000);
    stream.on('data', ((c: Uint8Array | string) => {
      chunks.push(typeof c === 'string' ? new TextEncoder().encode(c) : c);
    }) as never);
    stream.on('end', (() => {
      clearTimeout(timer);
      const total = chunks.reduce((n, c) => n + c.byteLength, 0);
      const out = new Uint8Array(total);
      let at = 0;
      for (const c of chunks) { out.set(c, at); at += c.byteLength; }
      resolve(new TextDecoder().decode(out));
    }) as never);
    stream.on('error', ((e: Error) => { clearTimeout(timer); reject(e); }) as never);
  });
}

describe('filehandle.createReadStream', () => {
  it('reads the whole file, same bytes as node', async () => {
    const h = await fs.promises.open('/a', 'r');
    const ours = await drain(h.createReadStream() as never, 'ours');

    const nh = await nodefsp.open(real('a'), 'r');
    const theirs = await drain(nh.createReadStream() as never, 'node');

    expect(ours).toBe(theirs);
    expect(ours).toBe(BODY);
  });

  it('closes the handle when the stream ends, as node does', async () => {
    const h = await fs.promises.open('/a', 'r');
    await drain(h.createReadStream() as never, 'ours');
    await expect(h.stat()).rejects.toThrow(expect.objectContaining({ code: 'EBADF' }));

    const nh = await nodefsp.open(real('a'), 'r');
    await drain(nh.createReadStream() as never, 'node');
    await expect(nh.stat()).rejects.toThrow(expect.objectContaining({ code: 'EBADF' }));
  });

  it('leaves the handle open with autoClose: false', async () => {
    const h = await fs.promises.open('/a', 'r');
    await drain(h.createReadStream({ autoClose: false }) as never, 'ours');
    await expect(h.stat()).resolves.toBeDefined();
    await h.close();
  });

  it('honours start and end, which are inclusive', async () => {
    const h = await fs.promises.open('/a', 'r');
    const ours = await drain(h.createReadStream({ start: 3, end: 5 }) as never, 'ours');

    const nh = await nodefsp.open(real('a'), 'r');
    const theirs = await drain(nh.createReadStream({ start: 3, end: 5 }) as never, 'node');

    expect(ours).toBe(theirs);
    expect(ours).toBe('l2\n'.slice(0, 3));
  });

  it('produces the same bytes at a small highWaterMark', async () => {
    const h = await fs.promises.open('/a', 'r');
    const ours = await drain(h.createReadStream({ highWaterMark: 2 }) as never, 'ours');
    expect(ours).toBe(BODY);
  });
});

describe('filehandle.createWriteStream', () => {
  it('writes through the handle, same result as node', async () => {
    const write = async (stream: { write(c: string): unknown; end(c?: string): unknown; on(e: string, f: (...a: never[]) => void): unknown }) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('never finished')), 10_000);
        stream.on('finish', (() => { clearTimeout(timer); resolve(); }) as never);
        stream.on('error', ((e: Error) => { clearTimeout(timer); reject(e); }) as never);
        stream.write('hello ');
        stream.end('world');
      });

    const h = await fs.promises.open('/b', 'w');
    await write(h.createWriteStream() as never);

    const nh = await nodefsp.open(real('b'), 'w');
    await write(nh.createWriteStream() as never);

    expect(fs.readFileSync('/b', 'utf8')).toBe('hello world');
    expect(fs.readFileSync('/b', 'utf8')).toBe(nodefs.readFileSync(real('b'), 'utf8'));
  });

  it('closes the handle on finish', async () => {
    const h = await fs.promises.open('/c', 'w');
    const ws = h.createWriteStream();
    await new Promise<void>((resolve, reject) => {
      ws.on('finish', () => resolve());
      ws.on('error', reject);
      ws.end('x');
    });
    await expect(h.stat()).rejects.toThrow(expect.objectContaining({ code: 'EBADF' }));
  });
});

describe('filehandle.readLines', () => {
  it('yields the same lines as node', async () => {
    const h = await fs.promises.open('/a', 'r');
    const ours: string[] = [];
    for await (const line of h.readLines()) ours.push(line);

    const nh = await nodefsp.open(real('a'), 'r');
    const theirs: string[] = [];
    for await (const line of nh.readLines()) theirs.push(line);

    expect(ours).toEqual(theirs);
    expect(ours).toEqual(['l1', 'l2', 'l3']);
  });

  it('drops no content when the file has no trailing newline', async () => {
    fs.writeFileSync('/n', 'a\nb');
    nodefs.writeFileSync(real('n'), 'a\nb');

    const h = await fs.promises.open('/n', 'r');
    const ours: string[] = [];
    for await (const line of h.readLines()) ours.push(line);

    const nh = await nodefsp.open(real('n'), 'r');
    const theirs: string[] = [];
    for await (const line of nh.readLines()) theirs.push(line);

    expect(ours).toEqual(theirs);
    expect(ours).toEqual(['a', 'b']);
  });

  it('strips CR from CRLF line endings, as readline does', async () => {
    fs.writeFileSync('/crlf', 'a\r\nb\r\n');
    nodefs.writeFileSync(real('crlf'), 'a\r\nb\r\n');

    const h = await fs.promises.open('/crlf', 'r');
    const ours: string[] = [];
    for await (const line of h.readLines()) ours.push(line);

    const nh = await nodefsp.open(real('crlf'), 'r');
    const theirs: string[] = [];
    for await (const line of nh.readLines()) theirs.push(line);

    expect(ours).toEqual(theirs);
    expect(ours).toEqual(['a', 'b']);
  });

  it('yields nothing for an empty file', async () => {
    fs.writeFileSync('/empty', '');
    const h = await fs.promises.open('/empty', 'r');
    const ours: string[] = [];
    for await (const line of h.readLines()) ours.push(line);
    expect(ours).toEqual([]);
  });

  it('handles a line spanning several chunks', async () => {
    const long = 'x'.repeat(5000);
    fs.writeFileSync('/long', `${long}\nshort\n`);
    const h = await fs.promises.open('/long', 'r');
    const ours: string[] = [];
    for await (const line of h.readLines({ highWaterMark: 64 })) ours.push(line);
    expect(ours).toEqual([long, 'short']);
  });
});

describe('filehandle.readableWebStream', () => {
  it('is a real ReadableStream carrying the file bytes', async () => {
    const h = await fs.promises.open('/a', 'r');
    const stream = h.readableWebStream();
    expect(stream).toBeInstanceOf(ReadableStream);

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let acc = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      acc += decoder.decode(value as Uint8Array);
    }
    expect(acc).toBe(BODY);

    const nh = await nodefsp.open(real('a'), 'r');
    const nreader = (nh.readableWebStream() as ReadableStream<Uint8Array>).getReader();
    let nacc = '';
    for (;;) {
      const { done, value } = await nreader.read();
      if (done) break;
      nacc += decoder.decode(value);
    }
    expect(acc).toBe(nacc);
  });

  it('releases the handle once the stream completes', async () => {
    const h = await fs.promises.open('/a', 'r');
    const reader = h.readableWebStream().getReader();
    for (;;) { const { done } = await reader.read(); if (done) break; }
    await expect(h.stat()).rejects.toThrow(expect.objectContaining({ code: 'EBADF' }));
  });
});

describe('FileHandle is an EventEmitter', () => {
  it('emits close, as node does', async () => {
    const h = await fs.promises.open('/a', 'r');
    let closed = false;
    h.on('close', () => { closed = true; });
    await h.close();
    expect(closed).toBe(true);

    const nh = await nodefsp.open(real('a'), 'r');
    let nClosed = false;
    nh.on('close', () => { nClosed = true; });
    await nh.close();
    await new Promise((r) => setTimeout(r, 20));
    expect(nClosed).toBe(true);
  });

  it('once() fires a single time and off() detaches', async () => {
    const h = await fs.promises.open('/a', 'r');
    let onceCount = 0;
    let offCount = 0;
    const offListener = () => { offCount++; };
    h.once('ping', () => { onceCount++; });
    h.on('ping', offListener);

    h.emit('ping' as never);
    h.emit('ping' as never);
    expect(onceCount).toBe(1);
    expect(offCount).toBe(2);

    h.off('ping', offListener);
    h.emit('ping' as never);
    expect(offCount).toBe(2);
    await h.close();
  });
});

describe('read streams are async iterable', () => {
  // `for await (const chunk of stream)` is the ordinary way to consume a readable in node, and
  // it threw "stream is not async iterable" here — NodeReadable had no Symbol.asyncIterator.
  it('for await over fs.createReadStream yields the file, matching node', async () => {
    const collect = async (stream: AsyncIterable<Uint8Array | string>) => {
      let out = '';
      const dec = new TextDecoder();
      for await (const chunk of stream) out += typeof chunk === 'string' ? chunk : dec.decode(chunk);
      return out;
    };
    const ours = await collect(fs.createReadStream('/a') as never);
    const theirs = await collect(nodefs.createReadStream(real('a')) as never);
    expect(ours).toBe(theirs);
    expect(ours).toBe(BODY);
  });

  it('applies backpressure — a slow consumer does not lose chunks', async () => {
    const big = 'z'.repeat(200_000);
    fs.writeFileSync('/big', big);
    let out = '';
    const dec = new TextDecoder();
    for await (const chunk of fs.createReadStream('/big', { highWaterMark: 4096 }) as never as AsyncIterable<Uint8Array>) {
      await new Promise((r) => setTimeout(r, 0)); // yield between chunks
      out += dec.decode(chunk);
    }
    expect(out.length).toBe(big.length);
    expect(out).toBe(big);
  });

  it('breaking out of the loop stops cleanly', async () => {
    const stream = fs.createReadStream('/a', { highWaterMark: 2 }) as never as AsyncIterable<Uint8Array>;
    let count = 0;
    for await (const _chunk of stream) { count++; if (count === 1) break; }
    expect(count).toBe(1);
  });
});

describe('fs.createReadStream still behaves after sharing the implementation', () => {
  it('does not close a caller-supplied fd', () => {
    // The path- and handle-backed streams share one implementation now; a caller-supplied fd
    // must still stay the caller's to close, unlike a handle-backed stream.
    const fd = fs.openSync('/a', 'r');
    const stream = fs.createReadStream('/a', { fd });
    return drain(stream as never, 'fd-stream').then(() => {
      expect(() => fs.fstatSync(fd)).not.toThrow();
      fs.closeSync(fd);
    });
  });

  it('reports the path it was opened with', async () => {
    const stream = fs.createReadStream('/a');
    expect((stream as unknown as { path: string }).path).toBe('/a');
    await drain(stream as never, 'path-stream');
  });
});
