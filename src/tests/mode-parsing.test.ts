/**
 * File-mode argument parsing — Node parity.
 *
 * Node accepts a mode as a uint32 *or* an octal string, and validates it in JS before the
 * syscall runs. Coercing numerically instead is silently wrong: `{ mode: '0700' }` becomes
 * decimal 700 (= 0o1274), a directory with permissions nobody asked for. Every expectation
 * below was captured from real `node:fs` on this machine (umask 0o022) before being written.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, mkdir } from '../src/methods/mkdir.js';
import { chmodSync, chmod, fchmodSync } from '../src/methods/chmod.js';
import { parseFileMode } from '../src/methods/mode.js';
import { openSync, open as openAsync } from '../src/methods/open.js';
import { OP, encodeRequest, encodeRequestU32, decodeRequest } from '../src/protocol/opcodes.js';
import { VFSEngine } from '../src/vfs/engine.js';
import { MockSyncHandle } from './helpers/mock-handle.js';


/** The mode a request frame actually carries (4-byte LE payload after the path). */
const modeOf = (buf: ArrayBuffer) => {
  const { data } = decodeRequest(buf);
  expect(data?.byteLength).toBe(4);
  return new DataView(data!.buffer, data!.byteOffset, 4).getUint32(0, true);
};

const okSync = () => vi.fn().mockReturnValue({ status: 0, data: null });
const okAsync = () => vi.fn().mockResolvedValue({ status: 0, data: null });

describe('parseFileMode', () => {
  it('accepts octal strings, with or without a leading zero', () => {
    expect(parseFileMode('0700', 'mode', 0o777)).toBe(0o700);
    expect(parseFileMode('777', 'mode', 0o777)).toBe(0o777);
    expect(parseFileMode('0', 'mode', 0o777)).toBe(0);
  });

  it('accepts uint32 numbers unchanged', () => {
    expect(parseFileMode(0o700, 'mode', 0o777)).toBe(0o700);
    expect(parseFileMode(0, 'mode', 0o777)).toBe(0);
    expect(parseFileMode(0xffffffff, 'mode', 0o777)).toBe(0xffffffff);
  });

  it('falls back to the default when nullish and a default was supplied', () => {
    expect(parseFileMode(undefined, 'options.mode', 0o777)).toBe(0o777);
    expect(parseFileMode(null, 'options.mode', 0o777)).toBe(0o777);
  });

  it('words the message by name shape, exactly as Node does', () => {
    // Captured from node:fs — dotted names read "property", bare names read "argument".
    expect(() => parseFileMode({}, 'options.mode')).toThrow(
      'The "options.mode" property must be of type number. Received an instance of Object'
    );
    expect(() => parseFileMode({}, 'mode')).toThrow(
      'The "mode" argument must be of type number. Received an instance of Object'
    );
    expect(() => parseFileMode('abc', 'mode')).toThrow(
      "The argument 'mode' must be a 32-bit unsigned integer or an octal string. Received 'abc'"
    );
    expect(() => parseFileMode(undefined, 'mode')).toThrow(
      'The "mode" argument must be of type number. Received undefined'
    );
  });

  it('rejects a required mode that was omitted', () => {
    expect(() => parseFileMode(undefined, 'mode')).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' })
    );
  });

  it.each(['abc', '999', '0x1ff', ''])('rejects non-octal string %o', (bad) => {
    expect(() => parseFileMode(bad, 'options.mode', 0o777)).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_VALUE', name: 'TypeError' })
    );
  });

  it.each([true, {}, [], 1n])('rejects non-number, non-string %o', (bad) => {
    expect(() => parseFileMode(bad, 'options.mode')).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' })
    );
  });

  it.each([-1, 1.5, NaN, 2 ** 32, Infinity])('rejects out-of-range number %o', (bad) => {
    expect(() => parseFileMode(bad, 'options.mode', 0o777)).toThrow(
      expect.objectContaining({ code: 'ERR_OUT_OF_RANGE', name: 'RangeError' })
    );
  });
});

describe('mkdir mode parsing', () => {
  it('sends an octal string mode as its octal value, not its decimal coercion', () => {
    const req = okSync();
    mkdirSync(req, '/d', { mode: '0700' });
    // The bug this guards: '0700' >>> 0 === 700 === 0o1274.
    expect(modeOf(req.mock.calls[0][0])).toBe(0o700);
  });

  it('accepts the bare-string shorthand mkdirSync(path, "0700")', () => {
    const req = okSync();
    mkdirSync(req, '/d', '0700');
    expect(modeOf(req.mock.calls[0][0])).toBe(0o700);
  });

  it('a bare-string shorthand is a mode, never a recursive flag', () => {
    const req = okSync();
    mkdirSync(req, '/d', '0700');
    expect(new DataView(req.mock.calls[0][0]).getUint32(4, true)).toBe(0); // flags
  });

  it('keeps recursive independent of the mode', () => {
    const req = okSync();
    mkdirSync(req, '/d', { recursive: true, mode: '0700' });
    expect(new DataView(req.mock.calls[0][0]).getUint32(4, true)).toBe(1);
    expect(modeOf(req.mock.calls[0][0])).toBe(0o700);
  });

  it('rejects an explicit null mode rather than defaulting it, as in Node', () => {
    const req = okSync();
    expect(() => mkdirSync(req, '/d', { mode: null as unknown as number })).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' })
    );
    expect(req).not.toHaveBeenCalled();
  });

  it('rejects a bad mode before issuing any request', () => {
    const req = okSync();
    expect(() => mkdirSync(req, '/d', { mode: 'abc' as unknown as number })).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_VALUE' })
    );
    expect(req).not.toHaveBeenCalled();
  });

  it('async mkdir parses the mode identically', async () => {
    const req = okAsync();
    await mkdir(req, '/d', { mode: '0700' });
    const data = req.mock.calls[0][3] as Uint8Array;
    expect(new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true)).toBe(0o700);
  });

  it('async mkdir allocates a fresh payload per call (no shared scratch buffer)', async () => {
    // postMessage happens after an await, so a shared buffer would let concurrent calls
    // structured-clone each other's mode.
    const req = okAsync();
    await Promise.all([mkdir(req, '/a', { mode: 0o700 }), mkdir(req, '/b', { mode: 0o755 })]);
    const [a, b] = req.mock.calls.map((c) => c[3] as Uint8Array);
    expect(a).not.toBe(b);
    expect(new DataView(a.buffer, a.byteOffset, 4).getUint32(0, true)).toBe(0o700);
    expect(new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true)).toBe(0o755);
  });
});

describe('chmod mode parsing', () => {
  it('accepts an octal string mode', () => {
    const req = okSync();
    chmodSync(req, '/f', '0700');
    expect(modeOf(req.mock.calls[0][0])).toBe(0o700);
  });

  it('rejects an omitted mode instead of silently chmod-ing to 000', () => {
    const req = okSync();
    // Previously: setUint32(0, undefined) → NaN → 0.
    expect(() => chmodSync(req, '/f', undefined as unknown as number)).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' })
    );
    expect(req).not.toHaveBeenCalled();
  });

  it('async chmod parses the mode identically', async () => {
    const req = okAsync();
    await chmod(req, '/f', '0700');
    const data = req.mock.calls[0][3] as Uint8Array;
    expect(new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true)).toBe(0o700);
  });

  it('fchmod carries [fd][mode] and parses the mode', () => {
    const req = okSync();
    fchmodSync(req, 7, '0700');
    const { data } = decodeRequest(req.mock.calls[0][0]);
    const dv = new DataView(data!.buffer, data!.byteOffset, 8);
    expect(dv.getUint32(0, true)).toBe(7);
    expect(dv.getUint32(4, true)).toBe(0o700);
  });
});

describe('encodeRequestU32', () => {
  it('is byte-identical to encodeRequest with a 4-byte LE payload', () => {
    const payload = new Uint8Array(4);
    new DataView(payload.buffer).setUint32(0, 0o755, true);
    const viaPayload = new Uint8Array(encodeRequest(OP.MKDIR, '/some/nested/dir', 1, payload));
    const viaU32 = new Uint8Array(encodeRequestU32(OP.MKDIR, '/some/nested/dir', 1, 0o755));
    expect(Array.from(viaU32)).toEqual(Array.from(viaPayload));
  });

  it('round-trips through decodeRequest, including a UTF-8 path', () => {
    const { op, flags, path, data } = decodeRequest(encodeRequestU32(OP.CHMOD, '/tmp/día/ünïcode', 0, 0o4755));
    expect(op).toBe(OP.CHMOD);
    expect(flags).toBe(0);
    expect(path).toBe('/tmp/día/ünïcode');
    expect(new DataView(data!.buffer, data!.byteOffset, 4).getUint32(0, true)).toBe(0o4755);
  });

  it('masks the value to 32 bits like DataView.setUint32 does', () => {
    expect(modeOf(encodeRequestU32(OP.CHMOD, '/f', 0, 0xffffffff))).toBe(0xffffffff);
  });
});


describe('open mode', () => {
  const okOpen = () =>
    vi.fn().mockImplementation(() => {
      const fd = new Uint8Array(4);
      new DataView(fd.buffer).setUint32(0, 5, true);
      return { status: 0, data: fd };
    });

  it("defaults to Node's 0o666 when no mode is given", () => {
    const req = okOpen();
    openSync(req, '/f', 'w');
    expect(modeOf(req.mock.calls[0][0])).toBe(0o666);
  });

  it('carries an explicit mode, including an octal string', () => {
    const req = okOpen();
    openSync(req, '/f', 'w', 0o600);
    expect(modeOf(req.mock.calls[0][0])).toBe(0o600);
    openSync(req, '/g', 'w', '0600');
    expect(modeOf(req.mock.calls[1][0])).toBe(0o600);
  });

  it('rejects a bad mode before issuing any request', () => {
    const req = okOpen();
    expect(() => openSync(req, '/f', 'w', 'abc')).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_VALUE' })
    );
    expect(req).not.toHaveBeenCalled();
  });

  it('async open carries the mode as a fresh per-call payload', async () => {
    const req = vi.fn().mockImplementation(async () => {
      const fd = new Uint8Array(4);
      new DataView(fd.buffer).setUint32(0, 5, true);
      return { status: 0, data: fd };
    });
    await Promise.all([openAsync(req, '/a', 'w', 0o600), openAsync(req, '/b', 'w', 0o640)]);
    const [a, b] = req.mock.calls.map((c) => c[3] as Uint8Array);
    expect(a).not.toBe(b);
    expect(new DataView(a.buffer, a.byteOffset, 4).getUint32(0, true)).toBe(0o600);
    expect(new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true)).toBe(0o640);
  });
});

describe('open mode (VFS engine)', () => {
  let engine: VFSEngine;

  beforeEach(() => {
    engine = new VFSEngine();
    engine.init(new MockSyncHandle(0) as unknown as FileSystemSyncAccessHandle);
  });

  /** Permission bits the engine actually stored for `path`. */
  const perm = (path: string) => {
    const st = engine.stat(path);
    expect(st.status).toBe(0);
    return new DataView(st.data!.buffer, st.data!.byteOffset, st.data!.byteLength)
      .getUint32(1, true) & 0o7777;
  };

  const O_CREAT_WRONLY = 64 | 1;

  it('creates a file with the requested mode', () => {
    expect(engine.open('/priv', O_CREAT_WRONLY, 't', 0o600).status).toBe(0);
    expect(perm('/priv')).toBe(0o600);
  });

  it('subtracts the umask, exactly as open(2) does', () => {
    // Default umask 0o022, so Node's default 0o666 lands on the historical 0o644 — which is
    // what makes this a no-op for every caller that passes no mode.
    expect(engine.open('/plain', O_CREAT_WRONLY, 't', 0o666).status).toBe(0);
    expect(perm('/plain')).toBe(0o644);
    expect(engine.open('/wide', O_CREAT_WRONLY, 't', 0o777).status).toBe(0);
    expect(perm('/wide')).toBe(0o755);
  });

  it('defaults to 0o644 when the caller supplies no mode at all', () => {
    expect(engine.open('/dflt', O_CREAT_WRONLY, 't').status).toBe(0);
    expect(perm('/dflt')).toBe(0o644);
  });

  it('ignores the mode when the file already exists, as open(2) does', () => {
    expect(engine.open('/keep', O_CREAT_WRONLY, 't', 0o600).status).toBe(0);
    expect(engine.open('/keep', O_CREAT_WRONLY, 't', 0o777).status).toBe(0);
    expect(perm('/keep')).toBe(0o600);
  });
});
