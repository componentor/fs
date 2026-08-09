/**
 * appendFile option handling — Node parity.
 *
 * `appendFile` used to ignore its `options` argument outright: `mode`, `flag`, `encoding` and
 * `signal` were all dropped on the floor, so `appendFileSync(p, 'é', 'latin1')` wrote UTF-8 and
 * `{ flag: 'w' }` appended rather than truncating. Every expectation below was captured from
 * real `node:fs` (umask 0o022) before being written.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appendFileSync, appendFile } from '../src/methods/appendFile.js';
import { OP, decodeRequest } from '../src/protocol/opcodes.js';
import { VFSEngine } from '../src/vfs/engine.js';

/** Minimal in-memory FileSystemSyncAccessHandle, as each engine test file defines. */
class MockSyncHandle {
  private buffer: Uint8Array;
  private size: number;

  constructor(initialSize: number = 0) {
    this.buffer = new Uint8Array(initialSize);
    this.size = initialSize;
  }

  getSize(): number { return this.size; }

  truncate(newSize: number): void {
    if (newSize > this.buffer.byteLength) {
      const newBuf = new Uint8Array(newSize);
      newBuf.set(this.buffer.subarray(0, this.size));
      this.buffer = newBuf;
    }
    this.size = newSize;
  }

  read(buf: Uint8Array, opts?: { at?: number }): number {
    const at = opts?.at ?? 0;
    const len = Math.min(buf.byteLength, this.size - at);
    if (len <= 0) return 0;
    buf.set(this.buffer.subarray(at, at + len));
    return len;
  }

  write(buf: Uint8Array, opts?: { at?: number }): number {
    const at = opts?.at ?? 0;
    const end = at + buf.byteLength;
    if (end > this.buffer.byteLength) {
      const newBuf = new Uint8Array(end * 2);
      newBuf.set(this.buffer.subarray(0, this.size));
      this.buffer = newBuf;
    }
    this.buffer.set(buf, at);
    if (end > this.size) this.size = end;
    return buf.byteLength;
  }

  flush(): void {}
  close(): void {}
}

/** A sync transport that records every frame and hands back a usable fd for OPEN. */
function recorder() {
  const calls: { op: number; path: string; flags: number; data: Uint8Array | null }[] = [];
  const fn = vi.fn((buf: ArrayBuffer) => {
    const { op, path, flags, data } = decodeRequest(buf);
    calls.push({ op, path, flags, data });
    if (op === OP.OPEN) {
      const fd = new Uint8Array(4);
      new DataView(fd.buffer).setUint32(0, 5, true);
      return { status: 0, data: fd };
    }
    return { status: 0, data: null };
  });
  return { calls, fn };
}

describe('appendFile encoding', () => {
  it('honours a latin1 encoding instead of always writing UTF-8', () => {
    const { calls, fn } = recorder();
    appendFileSync(fn, '/f', 'é', { encoding: 'latin1' });
    // Node writes [0xE9]; UTF-8 would be [0xC3, 0xA9].
    expect(Array.from(calls[0].data!)).toEqual([0xe9]);
  });

  it('accepts the bare-string encoding shorthand', () => {
    const { calls, fn } = recorder();
    appendFileSync(fn, '/f', 'é', 'latin1');
    expect(Array.from(calls[0].data!)).toEqual([0xe9]);
  });

  it('defaults to UTF-8', () => {
    const { calls, fn } = recorder();
    appendFileSync(fn, '/f', 'é');
    expect(Array.from(calls[0].data!)).toEqual([0xc3, 0xa9]);
  });

  it('passes binary data through untouched, ignoring any encoding', () => {
    const { calls, fn } = recorder();
    appendFileSync(fn, '/f', new Uint8Array([1, 2, 3]), { encoding: 'latin1' });
    expect(Array.from(calls[0].data!)).toEqual([1, 2, 3]);
  });
});

describe('appendFile flag and mode', () => {
  it('keeps the single-op APPEND fast path for the default case', () => {
    const { calls, fn } = recorder();
    appendFileSync(fn, '/f', 'x');
    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe(OP.APPEND);
  });

  it('routes a creation mode through the open that creates the file', () => {
    const { calls, fn } = recorder();
    appendFileSync(fn, '/f', 'x', { mode: 0o600 });
    expect(calls[0].op).toBe(OP.OPEN);
    expect(calls.map((c) => c.op)).not.toContain(OP.CHMOD);
    const modeBuf = calls[0].data!;
    expect(new DataView(modeBuf.buffer, modeBuf.byteOffset, 4).getUint32(0, true)).toBe(0o600);
  });

  it("honours flag 'w', which truncates rather than appending", () => {
    const { calls, fn } = recorder();
    appendFileSync(fn, '/f', 'x', { flag: 'w' });
    expect(calls[0].op).toBe(OP.OPEN);
    // O_WRONLY|O_CREAT|O_TRUNC — the truncate bit is what makes 'w' differ from 'a'.
    expect(calls[0].flags & 512).toBe(512);
  });

  it("opens with O_APPEND for an explicit flag 'a'", () => {
    const { calls, fn } = recorder();
    appendFileSync(fn, '/f', 'x', { flag: 'a', mode: 0o600 });
    expect(calls[0].flags & 1024).toBe(1024); // O_APPEND
  });

  it('flushes via the fd path, which APPEND cannot express', () => {
    const { calls, fn } = recorder();
    appendFileSync(fn, '/f', 'x', { flush: true });
    expect(calls.map((c) => c.op)).toContain(OP.FSYNC);
  });

  it('rejects a bad mode before issuing any request', () => {
    const { fn } = recorder();
    expect(() => appendFileSync(fn, '/f', 'x', { mode: 'abc' })).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_VALUE' })
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it('honours an already-aborted signal', () => {
    const { fn } = recorder();
    const ctrl = new AbortController();
    ctrl.abort();
    expect(() => appendFileSync(fn, '/f', 'x', { signal: ctrl.signal })).toThrow(/aborted/);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('appendFile async', () => {
  const asyncRecorder = () => {
    const calls: { op: number; path: string; data: Uint8Array | null; fdArgs?: unknown }[] = [];
    const fn = vi.fn(async (op: number, path: string, _flags?: number, data?: Uint8Array | null, _p2?: string, fdArgs?: unknown) => {
      calls.push({ op, path, data: data ?? null, fdArgs });
      if (op === OP.OPEN) {
        const fd = new Uint8Array(4);
        new DataView(fd.buffer).setUint32(0, 5, true);
        return { status: 0, data: fd };
      }
      return { status: 0, data: null };
    });
    return { calls, fn };
  };

  it('honours encoding on the fast path', async () => {
    const { calls, fn } = asyncRecorder();
    await appendFile(fn, '/f', 'é', { encoding: 'latin1' });
    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe(OP.APPEND);
    expect(Array.from(calls[0].data!)).toEqual([0xe9]);
  });

  it('routes a mode through open, and never chmods', async () => {
    const { calls, fn } = asyncRecorder();
    await appendFile(fn, '/f', 'x', { mode: 0o600 });
    expect(calls[0].op).toBe(OP.OPEN);
    expect(calls.map((c) => c.op)).not.toContain(OP.CHMOD);
    const modeBuf = calls[0].data!;
    expect(new DataView(modeBuf.buffer, modeBuf.byteOffset, 4).getUint32(0, true)).toBe(0o600);
  });
});

describe('appendFile semantics against the engine', () => {
  let engine: VFSEngine;

  beforeEach(() => {
    engine = new VFSEngine();
    engine.init(new MockSyncHandle(0) as unknown as FileSystemSyncAccessHandle);
  });

  /** Drive the method layer against a real engine, so flags actually mean something. */
  const transport = () => (buf: ArrayBuffer) => {
    const { op, path, flags, data } = decodeRequest(buf);
    switch (op) {
      case OP.APPEND: return engine.append(path, data ?? new Uint8Array(0));
      case OP.OPEN: return engine.open(path, flags, 't', new DataView(data!.buffer, data!.byteOffset, 4).getUint32(0, true));
      case OP.FWRITE: {
        // Payload is [fd: u32][position: f64][bytes…], decoded exactly as the worker does.
        const dv = new DataView(data!.buffer, data!.byteOffset, data!.byteLength);
        const pos = dv.getFloat64(4, true);
        return engine.fwrite(dv.getUint32(0, true), data!.subarray(12), pos === -1 ? null : pos);
      }
      case OP.CLOSE: return engine.close(new DataView(data!.buffer, data!.byteOffset, 4).getUint32(0, true));
      case OP.FSYNC: return { status: 0, data: null };
      default: throw new Error(`unexpected op ${op}`);
    }
  };

  const text = (p: string) => new TextDecoder().decode(engine.read(p).data!);
  const perm = (p: string) => {
    const st = engine.stat(p);
    return new DataView(st.data!.buffer, st.data!.byteOffset, st.data!.byteLength).getUint32(1, true) & 0o7777;
  };

  it('appends by default, and truncates for flag w', () => {
    const req = transport();
    appendFileSync(req, '/log', 'aa');
    appendFileSync(req, '/log', 'bb');
    expect(text('/log')).toBe('aabb');

    appendFileSync(req, '/log', 'cc', { flag: 'w' });
    expect(text('/log')).toBe('cc');
  });

  it("appends through the fd path too, when a mode forces flag 'a' open", () => {
    const req = transport();
    appendFileSync(req, '/log', 'aa', { mode: 0o600 });
    appendFileSync(req, '/log', 'bb', { mode: 0o600 });
    expect(text('/log')).toBe('aabb');
    // Mode applies at creation only — the second call must not re-permission it.
    expect(perm('/log')).toBe(0o600);
  });

  it('umask-reduces the creation mode, as open(2) does', () => {
    appendFileSync(transport(), '/wide', 'x', { mode: 0o777 });
    expect(perm('/wide')).toBe(0o755);
  });
});
