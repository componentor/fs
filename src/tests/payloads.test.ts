/**
 * Every payload encoder round-trips through the real decoder.
 *
 * This is the guarantee that [payloads.ts](../src/protocol/payloads.ts) and
 * [dispatch.ts](../src/protocol/dispatch.ts) stay paired. Three separate production bugs came
 * from an encoder and a decoder disagreeing about one field:
 *
 *   • TRUNCATE  — written f64, read u32 by the server worker → every truncate emptied the file
 *   • FTRUNCATE — same, in the server worker
 *   • FTRUNCATE — written u32/8 bytes by the async relay, read f64/12 everywhere → EINVAL on
 *                 `await fileHandle.truncate(n)`
 *
 * Each case below encodes a value, decodes it through `dispatchOp`, and checks the engine
 * observed exactly what was sent — so a layout change that breaks the pairing fails here rather
 * than in someone's data.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchOp } from '../src/protocol/dispatch.js';
import { OP } from '../src/protocol/opcodes.js';
import type { VFSEngine } from '../src/vfs/engine.js';
import {
  encodeModePayload, encodeTruncatePayload, encodeChownPayload, encodeTimesPayload,
  encodeFdPayload, encodeFreadPayload, encodeFwritePayload, encodeFtruncatePayload,
  encodeFchmodPayload, encodeFchownPayload, encodeFutimesPayload, toEpochMs,
} from '../src/protocol/payloads.js';

/** A stand-in engine that records the arguments each op was dispatched with. */
function spyEngine() {
  const ok = { status: 0, data: null };
  return {
    chmod: vi.fn(() => ok),
    truncate: vi.fn(() => ok),
    chown: vi.fn(() => ok),
    utimes: vi.fn(() => ok),
    close: vi.fn(() => ok),
    fstat: vi.fn(() => ok),
    fread: vi.fn(() => ok),
    fwrite: vi.fn(() => ok),
    ftruncate: vi.fn(() => ok),
    fchmod: vi.fn(() => ok),
    fchown: vi.fn(() => ok),
    futimes: vi.fn(() => ok),
  };
}

let engine: ReturnType<typeof spyEngine>;
const run = (op: number, data: Uint8Array) =>
  dispatchOp(engine as unknown as VFSEngine, 'tab', op, 0, '/p', data);

beforeEach(() => { engine = spyEngine(); });

describe('path-op payloads', () => {
  it('chmod carries the mode', () => {
    run(OP.CHMOD, encodeModePayload(0o4755));
    expect(engine.chmod).toHaveBeenCalledWith('/p', 0o4755);
  });

  it.each([0, 1, 4095, 0xffffffff, 4294967296, 8589934592, Number.MAX_SAFE_INTEGER])(
    'truncate carries length %d exactly', (len) => {
      run(OP.TRUNCATE, encodeTruncatePayload(len));
      expect(engine.truncate).toHaveBeenCalledWith('/p', len);
    }
  );

  it('chown carries uid and gid in order', () => {
    run(OP.CHOWN, encodeChownPayload(501, 20));
    expect(engine.chown).toHaveBeenCalledWith('/p', 501, 20);
  });

  it('utimes carries both timestamps with millisecond precision', () => {
    const a = 1_600_000_000_123;
    const m = 1_700_000_000_456;
    run(OP.UTIMES, encodeTimesPayload(a, m));
    expect(engine.utimes).toHaveBeenCalledWith('/p', a, m);
  });

  it('toEpochMs reads numbers as seconds, matching Node', () => {
    // Node's time arguments are seconds; a Date is used as-is. Treating a number as
    // milliseconds is a silent 1000× error — utimes(p, 1600000000) means 2020, not 1970.
    expect(toEpochMs(new Date(1_600_000_000_000))).toBe(1_600_000_000_000);
    expect(toEpochMs(1_600_000_000)).toBe(1_600_000_000_000);
    expect(toEpochMs('1600000000')).toBe(1_600_000_000_000);
    expect(toEpochMs(1.5)).toBe(1500);
  });

  it('toEpochMs rejects what Node rejects', () => {
    for (const bad of [NaN, Infinity, 'abc', null, undefined, {}]) {
      expect(() => toEpochMs(bad as never), String(bad)).toThrow(
        expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' })
      );
    }
  });
});

describe('fd-op payloads', () => {
  it('close and fstat carry the fd', () => {
    run(OP.CLOSE, encodeFdPayload(7));
    expect(engine.close).toHaveBeenCalledWith(7);
    run(OP.FSTAT, encodeFdPayload(9));
    expect(engine.fstat).toHaveBeenCalledWith(9);
  });

  it('fread carries fd, length and position', () => {
    run(OP.FREAD, encodeFreadPayload(3, 4096, 8192));
    expect(engine.fread).toHaveBeenCalledWith(3, 4096, 8192);
  });

  it('fread position -1 becomes null, meaning "use the cursor"', () => {
    run(OP.FREAD, encodeFreadPayload(3, 10, null));
    expect(engine.fread).toHaveBeenCalledWith(3, 10, null);
  });

  it('fread handles a position beyond the uint32 ceiling', () => {
    run(OP.FREAD, encodeFreadPayload(3, 10, 5_000_000_000));
    expect(engine.fread).toHaveBeenCalledWith(3, 10, 5_000_000_000);
  });

  it('fwrite carries fd, position and the bytes', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    run(OP.FWRITE, encodeFwritePayload(5, 100, bytes));
    const [fd, data, pos] = engine.fwrite.mock.calls[0] as unknown as [number, Uint8Array, number];
    expect(fd).toBe(5);
    expect(pos).toBe(100);
    expect(Array.from(data)).toEqual([1, 2, 3, 4]);
  });

  it('fwrite with an empty buffer is still a valid 12-byte frame', () => {
    const payload = encodeFwritePayload(5, 0, new Uint8Array(0));
    expect(payload.byteLength).toBe(12);
    expect(run(OP.FWRITE, payload).status).toBe(0);
  });

  it.each([0, 1, 4095, 0xffffffff, 4294967296, Number.MAX_SAFE_INTEGER])(
    'ftruncate carries length %d exactly', (len) => {
      run(OP.FTRUNCATE, encodeFtruncatePayload(2, len));
      expect(engine.ftruncate).toHaveBeenCalledWith(2, len);
    }
  );

  it('ftruncate frames are 12 bytes — the length is a float64, not a uint32', () => {
    // The async relay used to emit 8 bytes here, which the decoder's length guard rejected.
    expect(encodeFtruncatePayload(1, 4).byteLength).toBe(12);
  });

  it('fchmod carries fd and mode', () => {
    run(OP.FCHMOD, encodeFchmodPayload(4, 0o600));
    expect(engine.fchmod).toHaveBeenCalledWith(4, 0o600);
  });

  it('fchown carries fd, uid and gid', () => {
    run(OP.FCHOWN, encodeFchownPayload(4, 501, 20));
    expect(engine.fchown).toHaveBeenCalledWith(4, 501, 20);
  });

  it('futimes carries fd and both timestamps across its alignment padding', () => {
    run(OP.FUTIMES, encodeFutimesPayload(6, 111_111_111_111, 222_222_222_222));
    expect(engine.futimes).toHaveBeenCalledWith(6, 111_111_111_111, 222_222_222_222);
  });
});

describe('short frames are rejected, not misread', () => {
  // A truncated frame must fail cleanly rather than reading past the payload into whatever
  // follows it in the request buffer.
  const EINVAL = 7;
  it.each([
    ['CHMOD', OP.CHMOD, 3],
    ['TRUNCATE', OP.TRUNCATE, 7],
    ['CHOWN', OP.CHOWN, 7],
    ['UTIMES', OP.UTIMES, 15],
    ['CLOSE', OP.CLOSE, 3],
    ['FSTAT', OP.FSTAT, 3],
    ['FREAD', OP.FREAD, 15],
    ['FWRITE', OP.FWRITE, 11],
    ['FTRUNCATE', OP.FTRUNCATE, 11],
    ['FCHMOD', OP.FCHMOD, 7],
    ['FCHOWN', OP.FCHOWN, 11],
    ['FUTIMES', OP.FUTIMES, 23],
  ])('%s rejects a %d-byte frame', (_name, op, size) => {
    expect(run(op as number, new Uint8Array(size as number)).status).toBe(EINVAL);
  });
});
