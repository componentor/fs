/**
 * Differential fuzz of the stream layer against `node:fs`.
 *
 * The other fuzzers drive call/response APIs. Streams are event-driven: a write stream accepts
 * chunks that complete asynchronously and out of step with the calls that queued them, so the
 * interesting failures are about *ordering*, not about any single call's result.
 *
 * That is not hypothetical. Writing this file started by checking streams ran in the Node
 * harness at all, and the check itself found that `ws.write('abc'); ws.write('def')` produced
 * `'def'` — writes were dispatched concurrently, so both started at the same file offset and the
 * second overwrote the first (CHANGELOG 3.3.21). These cases pin the ordering guarantees that
 * bug violated, and compare the bytes against real `node:fs` rather than against an expectation.
 *
 * Read streams are fuzzed over their windowing options (`start`, `end`, `highWaterMark`), where
 * an off-by-one silently truncates content.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as nodefs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFsHarness } from './helpers/engine-transport.js';
import type { VFSFileSystem } from '../src/filesystem.js';

let fs: VFSFileSystem;
let root: string;

beforeEach(() => {
  fs = createFsHarness().fs;
  root = nodefs.mkdtempSync(join(tmpdir(), 'fuzz-stream-'));
});
afterEach(() => nodefs.rmSync(root, { recursive: true, force: true }));

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

const real = (p: string) => join(root, p);
const decode = (chunks: Uint8Array[]) => {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(out);
};

/** Drain a read stream to a string, failing rather than hanging if it never ends. */
function drain(stream: { on(ev: string, fn: (...a: never[]) => void): unknown }, label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const timer = setTimeout(() => reject(new Error(`${label}: read stream never ended`)), 10_000);
    stream.on('data', ((c: Uint8Array | string) => {
      chunks.push(typeof c === 'string' ? new TextEncoder().encode(c) : c);
    }) as never);
    stream.on('end', (() => { clearTimeout(timer); resolve(decode(chunks)); }) as never);
    stream.on('error', ((e: Error) => { clearTimeout(timer); reject(e); }) as never);
  });
}

/** Push a sequence of chunks through a write stream and resolve when it has finished. */
function pump(
  stream: { write(c: string): unknown; end(): unknown; on(ev: string, fn: (...a: never[]) => void): unknown },
  chunks: string[],
  label: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: write stream never finished`)), 10_000);
    stream.on('finish', (() => { clearTimeout(timer); resolve(); }) as never);
    stream.on('error', ((e: Error) => { clearTimeout(timer); reject(e); }) as never);
    // Queued synchronously, exactly as application code does it — this is the ordering the
    // stream has to preserve.
    for (const c of chunks) stream.write(c);
    stream.end();
  });
}

describe('differential fuzz: read streams', () => {
  it.each([1, 42, 1337, 90210])('seed %d: windowed reads match node:fs', async (seed) => {
    const rand = rng(seed);
    const body = Array.from({ length: 40 }, (_, i) => `line-${i}-`).join('');
    fs.writeFileSync('/in.txt', body);
    nodefs.writeFileSync(real('in.txt'), body);

    for (let i = 0; i < 12; i++) {
      const start = Math.floor(rand() * body.length);
      // `end` is inclusive in Node, and sometimes past EOF — both are worth exercising.
      const end = rand() < 0.3 ? undefined : start + Math.floor(rand() * (body.length - start + 10));
      const highWaterMark = pick(rand, [1, 7, 64, 1024]);

      const opts = { start, ...(end === undefined ? {} : { end }), highWaterMark };
      const ours = await drain(fs.createReadStream('/in.txt', opts) as never, `seed ${seed} #${i}`);
      const theirs = await drain(nodefs.createReadStream(real('in.txt'), opts) as never, `node #${i}`);
      expect(ours, `seed ${seed} #${i}: start=${start} end=${end} hwm=${highWaterMark}`).toBe(theirs);
    }
  });
});

function pick<T>(rand: () => number, xs: T[]): T {
  return xs[Math.floor(rand() * xs.length)];
}

describe('differential fuzz: write streams', () => {
  it.each([1, 42, 1337, 90210])('seed %d: chunk sequences land in order', async (seed) => {
    const rand = rng(seed);

    for (let i = 0; i < 10; i++) {
      const count = 1 + Math.floor(rand() * 12);
      // Varying chunk sizes so a single write cannot accidentally cover a mis-ordered one.
      const chunks = Array.from({ length: count }, (_, n) =>
        `${n}:${'x'.repeat(Math.floor(rand() * 300))}`);

      const file = `s${i}.txt`;
      await pump(fs.createWriteStream('/' + file) as never, chunks, `seed ${seed} #${i}`);
      await pump(nodefs.createWriteStream(real(file)) as never, chunks, `node #${i}`);

      expect(fs.readFileSync('/' + file, 'utf8'), `seed ${seed} #${i}: ${count} chunks`)
        .toBe(nodefs.readFileSync(real(file), 'utf8'));
    }
  });

  it('writes queued synchronously are not reordered or lost', async () => {
    // The exact shape of the bug this file found: several writes issued in one tick.
    const chunks = ['abc', 'def', 'ghi', 'jkl'];
    await pump(fs.createWriteStream('/sync.txt') as never, chunks, 'sync');
    await pump(nodefs.createWriteStream(real('sync.txt')) as never, chunks, 'node');
    expect(fs.readFileSync('/sync.txt', 'utf8')).toBe('abcdefghijkl');
    expect(fs.readFileSync('/sync.txt', 'utf8')).toBe(nodefs.readFileSync(real('sync.txt'), 'utf8'));
  });

  it('a chunk passed to end() lands after everything written before it', async () => {
    const done = new Promise<void>((resolve, reject) => {
      const ws = fs.createWriteStream('/end.txt');
      ws.on('finish', () => resolve());
      ws.on('error', reject);
      setTimeout(() => reject(new Error('never finished')), 10_000);
      ws.write('first-');
      ws.write('second-');
      ws.end('third');
    });
    await done;

    const nodeDone = new Promise<void>((resolve, reject) => {
      const ws = nodefs.createWriteStream(real('end.txt'));
      ws.on('finish', () => resolve());
      ws.on('error', reject);
      ws.write('first-');
      ws.write('second-');
      ws.end('third');
    });
    await nodeDone;

    expect(fs.readFileSync('/end.txt', 'utf8')).toBe('first-second-third');
    expect(fs.readFileSync('/end.txt', 'utf8')).toBe(nodefs.readFileSync(real('end.txt'), 'utf8'));
  });

  it('piping a read stream into a write stream reproduces the file', async () => {
    const body = 'pipe-'.repeat(2000);
    fs.writeFileSync('/src.txt', body);
    nodefs.writeFileSync(real('src.txt'), body);

    await new Promise<void>((resolve, reject) => {
      const rs = fs.createReadStream('/src.txt');
      const ws = fs.createWriteStream('/dst.txt');
      rs.pipe(ws);
      ws.on('finish', () => resolve());
      ws.on('error', reject);
      rs.on('error', reject);
      setTimeout(() => reject(new Error('pipe never finished')), 15_000);
    });

    expect(fs.readFileSync('/dst.txt', 'utf8')).toBe(body);
  });
});
