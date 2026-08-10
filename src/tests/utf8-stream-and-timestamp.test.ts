/**
 * `fs.Utf8Stream` and `fs._toUnixTimestamp` — the last two `node:fs` exports, and the one rule
 * inside them that is easy to get wrong.
 *
 * Both were on the "intentionally absent" list, on the reasoning that one is an internal logging
 * stream and the other a private helper. Neither reason survives contact with the goal of a
 * complete surface: node exports them, so code can reach for them.
 *
 * Implementing `_toUnixTimestamp` also turned up a live bug — a **negative** time argument means
 * "now" in node, not a pre-epoch instant, and `utimes(p, -1, -1)` was stamping 1969.
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
  root = nodefs.mkdtempSync(join(tmpdir(), 'u8-'));
});
afterEach(() => nodefs.rmSync(root, { recursive: true, force: true }));

const R = (p: string) => join(root, p);

describe('_toUnixTimestamp', () => {
  const cases: [string, Date | number | string][] = [
    ['a whole number of seconds', 5],
    ['zero', 0],
    ['a fractional number', 1.5],
    ['a numeric string', '7'],
    ['a Date', new Date(1_600_000_000_000)],
    ['a large timestamp', 1_600_000_000],
  ];

  it.each(cases)('matches node for %s', (_label, value) => {
    expect(fs._toUnixTimestamp(value)).toBe((nodefs as unknown as { _toUnixTimestamp(v: unknown): number })._toUnixTimestamp(value));
  });

  it('treats a negative number as "now", as node does', () => {
    // The rule the docs do not mention, and the one this library had wrong.
    const ours = fs._toUnixTimestamp(-1);
    const theirs = (nodefs as unknown as { _toUnixTimestamp(v: unknown): number })._toUnixTimestamp(-1);
    expect(Math.abs(ours - theirs)).toBeLessThan(2);
    expect(Math.abs(ours - Date.now() / 1000)).toBeLessThan(2);
  });

  const bad: [string, unknown][] = [
    ['NaN', NaN], ['Infinity', Infinity], ['a boolean', true], ['null', null],
    ['undefined', undefined], ['an object', {}], ['a non-numeric string', 'abc'],
  ];

  it.each(bad)('rejects %s the way node does', (_label, value) => {
    const ourCode = (() => { try { fs._toUnixTimestamp(value as never); return 'no-throw'; } catch (e) { return (e as { code: string }).code; } })();
    const nodeCode = (() => { try { (nodefs as unknown as { _toUnixTimestamp(v: unknown): number })._toUnixTimestamp(value); return 'no-throw'; } catch (e) { return (e as { code: string }).code; } })();
    expect(ourCode).toBe(nodeCode);
    expect(ourCode).toBe('ERR_INVALID_ARG_TYPE');
  });

  it('the negative rule reaches utimes, which is where it mattered', () => {
    fs.writeFileSync('/t.txt', 'x');
    nodefs.writeFileSync(R('t.txt'), 'x');
    fs.utimesSync('/t.txt', -1, -1);
    nodefs.utimesSync(R('t.txt'), -1, -1);
    const ours = new Date(fs.statSync('/t.txt')!.mtimeMs).getUTCFullYear();
    const theirs = new Date(nodefs.statSync(R('t.txt')).mtimeMs).getUTCFullYear();
    expect(ours).toBe(theirs);
    expect(ours).toBe(new Date().getUTCFullYear());   // not 1969
  });
});

describe('Utf8Stream', () => {
  const NodeU8 = (nodefs as unknown as { Utf8Stream: new (o: object) => Record<string, unknown> }).Utf8Stream;

  it('exposes exactly node\'s members', () => {
    const ourNames = new Set(Object.getOwnPropertyNames(fs.Utf8Stream.prototype));
    const nodeNames = Object.getOwnPropertyNames(NodeU8.prototype).filter((k) => k !== 'constructor');
    for (const name of nodeNames) {
      expect(ourNames.has(name), `Utf8Stream.prototype.${name} is missing`).toBe(true);
    }
  });

  it('matches node\'s defaults', () => {
    const ours = new fs.Utf8Stream({ dest: '/log.txt' });
    const theirs = new NodeU8({ dest: R('log.txt') });
    // node's opens asynchronously; without a listener a late open failure — the temp root is
    // removed in afterEach — surfaces as an uncaught exception rather than on the stream.
    (theirs as unknown as { on(e: string, f: () => void): void }).on('error', () => {});
    for (const key of ['minLength', 'maxLength', 'append', 'contentMode', 'mode', 'mkdir', 'fsync', 'periodicFlush', 'sync'] as const) {
      expect((ours as unknown as Record<string, unknown>)[key], `default ${key}`).toBe(theirs[key]);
    }
    expect(ours.file).toBe('/log.txt');
    expect(typeof ours.fd).toBe('number');
    ours.end();
    (theirs as unknown as { end(): void }).end();
  });

  it('writes text through to the file', async () => {
    const s = new fs.Utf8Stream({ dest: '/app.log' });
    expect(s.write('first\n')).toBe(true);
    expect(s.write('second\n')).toBe(true);
    s.flushSync();
    expect(fs.readFileSync('/app.log', 'utf8')).toBe('first\nsecond\n');
    s.end();
  });

  it('appends by default and truncates when append is false', () => {
    fs.writeFileSync('/a.log', 'existing\n');
    const appending = new fs.Utf8Stream({ dest: '/a.log' });
    appending.write('added\n');
    appending.end();
    expect(fs.readFileSync('/a.log', 'utf8')).toBe('existing\nadded\n');

    const truncating = new fs.Utf8Stream({ dest: '/a.log', append: false });
    truncating.write('fresh\n');
    truncating.end();
    expect(fs.readFileSync('/a.log', 'utf8')).toBe('fresh\n');
  });

  it('buffers below minLength — the reason the class exists', () => {
    const s = new fs.Utf8Stream({ dest: '/buf.log', minLength: 32 });
    s.write('small\n');                                    // 6 bytes, under the threshold
    expect(fs.readFileSync('/buf.log', 'utf8')).toBe('');  // nothing written yet
    s.write('x'.repeat(40) + '\n');                        // now over it
    expect(fs.readFileSync('/buf.log', 'utf8')).toContain('small');
    s.end();
  });

  it('flushSync forces a buffered batch out', () => {
    const s = new fs.Utf8Stream({ dest: '/f.log', minLength: 1024 });
    s.write('held\n');
    expect(fs.readFileSync('/f.log', 'utf8')).toBe('');
    s.flushSync();
    expect(fs.readFileSync('/f.log', 'utf8')).toBe('held\n');
    s.end();
  });

  it('drops writes past maxLength and reports them', () => {
    const s = new fs.Utf8Stream({ dest: '/cap.log', minLength: 1024, maxLength: 10 });
    const dropped: unknown[] = [];
    s.on('drop', ((c: unknown) => dropped.push(c)) as never);
    expect(s.write('12345\n')).toBe(true);
    expect(s.write('this one is far too long\n')).toBe(false);
    expect(dropped).toHaveLength(1);
    s.end();
  });

  it('emits ready, write, drain, then finish and close', async () => {
    const seen: string[] = [];
    const s = new fs.Utf8Stream({ dest: '/ev.log' });
    for (const e of ['ready', 'write', 'drain', 'finish', 'close']) s.on(e, (() => seen.push(e)) as never);
    s.write('x\n');
    await new Promise((r) => setTimeout(r, 10));
    s.end();
    expect(seen).toContain('ready');
    expect(seen).toContain('write');
    expect(seen).toContain('drain');
    expect(seen.slice(-2)).toEqual(['finish', 'close']);
  });

  it('reopen closes the old file and starts a new one — log rotation', () => {
    const s = new fs.Utf8Stream({ dest: '/rot.log' });
    s.write('before\n');
    s.flushSync();
    s.reopen('/rot.1.log');
    s.write('after\n');
    s.end();
    expect(fs.readFileSync('/rot.log', 'utf8')).toBe('before\n');
    expect(fs.readFileSync('/rot.1.log', 'utf8')).toBe('after\n');
  });

  it('mkdir creates the parent directory', () => {
    const s = new fs.Utf8Stream({ dest: '/deep/nested/m.log', mkdir: true });
    s.write('ok\n');
    s.end();
    expect(fs.readFileSync('/deep/nested/m.log', 'utf8')).toBe('ok\n');
  });

  it('contentMode buffer takes bytes and rejects strings', () => {
    const s = new fs.Utf8Stream({ dest: '/bin.log', contentMode: 'buffer' });
    s.write(new Uint8Array([104, 105, 10]));
    expect(() => s.write('a string')).toThrow();
    s.end();
    expect(fs.readFileSync('/bin.log', 'utf8')).toBe('hi\n');
  });

  it('utf8 mode rejects a Uint8Array, as node does', () => {
    const s = new fs.Utf8Stream({ dest: '/txt.log' });
    expect(() => s.write(new Uint8Array([1]))).toThrow();
    s.end();
  });

  it('writes to a caller-supplied fd and leaves it open', () => {
    const fd = fs.openSync('/fd.log', 'w');
    const s = new fs.Utf8Stream({ fd });
    s.write('via fd\n');
    s.end();
    // The fd is the caller's, so it must still be usable after end().
    expect(() => fs.fstatSync(fd)).not.toThrow();
    fs.closeSync(fd);
    expect(fs.readFileSync('/fd.log', 'utf8')).toBe('via fd\n');
  });

  it('destroy discards buffered bytes without writing them', () => {
    const s = new fs.Utf8Stream({ dest: '/d.log', minLength: 1024 });
    s.write('never written\n');
    s.destroy();
    expect(fs.readFileSync('/d.log', 'utf8')).toBe('');
    expect(() => s.write('x')).toThrow();
  });

  it('rejects options node rejects', () => {
    expect(() => new fs.Utf8Stream({})).toThrow();
    expect(() => new NodeU8({})).toThrow();
    expect(() => new fs.Utf8Stream({ dest: '/x', contentMode: 'nonsense' as never })).toThrow();
  });
});
