/**
 * The last behavioural divergences from `node:fs`, each checked against the real thing.
 *
 * These were found by auditing the API surface rather than by a failing test — the shape matched
 * Node everywhere, so nothing was red. Shape parity is not behaviour parity, and this is the
 * difference: an emitter that drops the wrong listener, and a decoder that quietly rewrites a
 * byte sequence Node hands back untouched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import * as nodefs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SimpleEventEmitter } from '../src/node-streams.js';
import { createFsHarness } from './helpers/engine-transport.js';
import type { VFSFileSystem } from '../src/filesystem.js';

describe('SimpleEventEmitter matches node:events', () => {
  it('does not let once() on one event remove a permanent listener on another', () => {
    // The old implementation kept once-ness in a WeakSet keyed by the function, so a handler
    // shared between two events was torn down by whichever fired first.
    const run = (e: SimpleEventEmitter | EventEmitter) => {
      let calls = 0;
      const f = () => { calls++; };
      e.once('a', f as never);
      e.on('b', f as never);
      e.emit('b');
      e.emit('b');
      return calls;
    };
    expect(run(new SimpleEventEmitter())).toBe(run(new EventEmitter()));
    expect(run(new SimpleEventEmitter())).toBe(2);
  });

  it('treats two once() registrations of the same function as two registrations', () => {
    const run = (e: SimpleEventEmitter | EventEmitter) => {
      let calls = 0;
      const f = () => { calls++; };
      e.once('x', f as never);
      e.once('x', f as never);
      e.emit('x');
      e.emit('x');
      return calls;
    };
    expect(run(new SimpleEventEmitter())).toBe(run(new EventEmitter()));
    expect(run(new SimpleEventEmitter())).toBe(2);
  });

  it('throws on an unhandled error event, as node does', () => {
    const boom = new Error('boom');
    expect(() => new SimpleEventEmitter().emit('error', boom)).toThrow(boom);
    expect(() => new EventEmitter().emit('error', boom)).toThrow(boom);
  });

  it('does not throw when the error event is handled', () => {
    const e = new SimpleEventEmitter();
    let seen: unknown = null;
    e.on('error', ((err: Error) => { seen = err; }) as never);
    expect(() => e.emit('error', new Error('handled'))).not.toThrow();
    expect((seen as Error).message).toBe('handled');
  });

  it('reports listeners, counts and names like node', () => {
    const ours = new SimpleEventEmitter();
    const theirs = new EventEmitter();
    const f = () => {};
    const g = () => {};
    for (const e of [ours, theirs] as const) {
      e.on('a', f as never);
      e.prependListener('a', g as never);
      e.on('b', f as never);
    }
    expect(ours.listenerCount('a')).toBe(theirs.listenerCount('a'));
    expect(ours.listeners('a')).toEqual(theirs.listeners('a'));   // order matters: prepend first
    expect(ours.eventNames().sort()).toEqual(theirs.eventNames().sort());

    for (const e of [ours, theirs] as const) e.removeAllListeners('a');
    expect(ours.listenerCount('a')).toBe(theirs.listenerCount('a'));
    expect(ours.eventNames()).toEqual(theirs.eventNames());
  });

  it('removes only one registration per off(), most recent first', () => {
    const run = (e: SimpleEventEmitter | EventEmitter) => {
      const f = () => {};
      e.on('a', f as never);
      e.on('a', f as never);
      e.off('a', f as never);
      return e.listenerCount('a');
    };
    expect(run(new SimpleEventEmitter())).toBe(run(new EventEmitter()));
  });
});

describe('utf16le keeps unpaired surrogates, as node does', () => {
  let fs: VFSFileSystem;
  let root: string;
  beforeEach(() => {
    fs = createFsHarness().fs;
    root = nodefs.mkdtempSync(join(tmpdir(), 'u16-'));
  });
  afterEach(() => nodefs.rmSync(root, { recursive: true, force: true }));

  const both = (name: string, bytes: Uint8Array) => {
    fs.writeFileSync('/' + name, bytes);
    nodefs.writeFileSync(join(root, name), bytes);
    return {
      ours: fs.readFileSync('/' + name, 'utf16le') as string,
      theirs: nodefs.readFileSync(join(root, name), 'utf16le'),
    };
  };

  it('a lone high surrogate survives instead of becoming U+FFFD', () => {
    // TextDecoder follows the WHATWG rule and substitutes U+FFFD; Buffer.toString does not.
    const { ours, theirs } = both('lone', new Uint8Array([0xd7, 0xd8, 0x41, 0x00]));
    expect(ours).toBe(theirs);
    expect(ours.charCodeAt(0)).toBe(0xd8d7);
  });

  it('a lone low surrogate survives too', () => {
    const { ours, theirs } = both('low', new Uint8Array([0x00, 0xdc, 0x42, 0x00]));
    expect(ours).toBe(theirs);
  });

  it('ordinary text and real surrogate pairs are unchanged', () => {
    const text = 'hello 😀 world — ünïcödé';
    const { ours, theirs } = both('ok', new Uint8Array(Buffer.from(text, 'utf16le')));
    expect(ours).toBe(theirs);
    expect(ours).toBe(text);
  });

  it('a trailing odd byte is dropped, matching node', () => {
    const { ours, theirs } = both('odd', new Uint8Array([0x41, 0x00, 0x42]));
    expect(ours).toBe(theirs);
    expect(ours).toBe('A');
  });

  it('holds up across a large buffer with a lone surrogate past the chunking threshold', () => {
    // utf16leRaw chunks at 8192 code units; put the bad unit well past that boundary.
    const units = new Uint16Array(20_000).fill(0x0061);
    units[15_000] = 0xd800;
    const bytes = new Uint8Array(units.buffer.slice(0));
    const { ours, theirs } = both('big', bytes);
    expect(ours).toBe(theirs);
    expect(ours.charCodeAt(15_000)).toBe(0xd800);
  });
});
