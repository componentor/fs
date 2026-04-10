/**
 * Tests for setEncoding (NodeReadable) and cork/uncork (NodeWritable).
 */

import { describe, it, expect, vi } from 'vitest';
import { NodeReadable, NodeWritable } from '../src/node-streams.js';

/** Helper: create a NodeReadable from an array of chunks. */
function fromChunks(chunks: Uint8Array[]): NodeReadable {
  let i = 0;
  return new NodeReadable(async () => {
    if (i >= chunks.length) return { done: true };
    return { done: false, value: chunks[i++] };
  });
}

describe('NodeReadable.setEncoding', () => {
  it('returns this for chaining', () => {
    const stream = fromChunks([]);
    const result = stream.setEncoding('utf8');
    expect(result).toBe(stream);
  });

  it('causes data events to emit strings when set to utf8', async () => {
    const stream = fromChunks([
      new TextEncoder().encode('hello'),
      new TextEncoder().encode(' world'),
    ]);

    stream.setEncoding('utf8');

    const chunks: unknown[] = [];
    await new Promise<void>((resolve) => {
      stream.on('data', (chunk: unknown) => chunks.push(chunk));
      stream.on('end', resolve);
    });

    expect(chunks).toHaveLength(2);
    expect(typeof chunks[0]).toBe('string');
    expect(typeof chunks[1]).toBe('string');
    expect(chunks[0]).toBe('hello');
    expect(chunks[1]).toBe(' world');
  });

  it('emits Uint8Array when encoding is not set', async () => {
    const stream = fromChunks([new TextEncoder().encode('test')]);

    const chunks: unknown[] = [];
    await new Promise<void>((resolve) => {
      stream.on('data', (chunk: unknown) => chunks.push(chunk));
      stream.on('end', resolve);
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBeInstanceOf(Uint8Array);
  });
});

describe('NodeWritable.cork / uncork', () => {
  function makeWritable(): NodeWritable {
    return new NodeWritable(
      '/tmp/test',
      async () => {},
      async () => {},
    );
  }

  it('cork() is a callable method that does not throw', () => {
    const w = makeWritable();
    expect(() => w.cork()).not.toThrow();
  });

  it('uncork() is a callable method that does not throw', () => {
    const w = makeWritable();
    expect(() => w.uncork()).not.toThrow();
  });

  it('cork() and uncork() are functions', () => {
    const w = makeWritable();
    expect(typeof w.cork).toBe('function');
    expect(typeof w.uncork).toBe('function');
  });

  it('cork/uncork can be called in sequence without error', () => {
    const w = makeWritable();
    expect(() => {
      w.cork();
      w.uncork();
    }).not.toThrow();
  });
});
