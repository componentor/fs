/**
 * What each operation tells the OPFS mirror.
 *
 * These expectations were read off the sync relay's inline bookkeeping *before* it was rewired
 * onto the shared dispatch, so they pin the behaviour the default path already had rather than
 * describing an intention. If the rewire changed anything, it fails here.
 *
 * The rules are deliberately non-uniform — `COPY`/`LINK` mirror the destination, fd ops resolve
 * through the fd table, `FCHMOD` is reported as `CHMOD` — so each is asserted individually.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OP } from '../src/protocol/opcodes.js';
import { dispatchOp } from '../src/protocol/dispatch.js';
import { planMirror, sampleOpenPreState } from '../src/protocol/mirror-plan.js';
import {
  encodeModePayload, encodeTruncatePayload, encodeFdPayload, encodeFwritePayload,
  encodeFtruncatePayload, encodeFchmodPayload, encodeTimesPayload,
} from '../src/protocol/payloads.js';
import { encodeSecondPath } from './helpers/second-path.js';
import { createHarness, type Harness } from './helpers/engine-transport.js';
import { writeFileSync } from '../src/methods/writeFile.js';
import { mkdirSync } from '../src/methods/mkdir.js';

let h: Harness;
beforeEach(() => { h = createHarness(); });

/** Dispatch an op against the harness engine and return the mirror action it implies. */
function actionFor(op: number, path: string, data: Uint8Array | null = null, flags = 0) {
  const openPre = op === OP.OPEN ? sampleOpenPreState(h.engine, flags, path) : undefined;
  const result = dispatchOp(h.engine, 'tab', op, flags, path, data);
  return { result, action: planMirror(h.engine, op, path, data, result, openPre) };
}

describe('mirrored mutations', () => {
  it.each([
    ['WRITE', OP.WRITE],
    ['APPEND', OP.APPEND],
  ])('%s mirrors its own path', (_n, op) => {
    const { action } = actionFor(op as number, '/f', new TextEncoder().encode('x'));
    expect(action).toEqual({ op, path: '/f' });
  });

  it('MKDIR mirrors the new directory', () => {
    const { action } = actionFor(OP.MKDIR, '/d', encodeModePayload(0o777));
    expect(action).toEqual({ op: OP.MKDIR, path: '/d' });
  });

  it('UNLINK and RMDIR mirror the removed path', () => {
    writeFileSync(h.request, '/f', 'x');
    expect(actionFor(OP.UNLINK, '/f').action).toEqual({ op: OP.UNLINK, path: '/f' });
    mkdirSync(h.request, '/d');
    expect(actionFor(OP.RMDIR, '/d').action).toEqual({ op: OP.RMDIR, path: '/d' });
  });

  it('TRUNCATE, CHMOD and UTIMES mirror their path', () => {
    writeFileSync(h.request, '/f', 'abcdef');
    expect(actionFor(OP.TRUNCATE, '/f', encodeTruncatePayload(2)).action).toEqual({ op: OP.TRUNCATE, path: '/f' });
    expect(actionFor(OP.CHMOD, '/f', encodeModePayload(0o600)).action).toEqual({ op: OP.CHMOD, path: '/f' });
    expect(actionFor(OP.UTIMES, '/f', encodeTimesPayload(1, 2)).action).toEqual({ op: OP.UTIMES, path: '/f' });
  });

  it('RENAME carries both paths', () => {
    writeFileSync(h.request, '/a', 'x');
    const { action } = actionFor(OP.RENAME, '/a', encodeSecondPath('/b'));
    expect(action).toEqual({ op: OP.RENAME, path: '/a', newPath: '/b' });
  });

  it('COPY mirrors the destination, not the source', () => {
    writeFileSync(h.request, '/a', 'x');
    const { action } = actionFor(OP.COPY, '/a', encodeSecondPath('/b'));
    expect(action).toEqual({ op: OP.COPY, path: '/b' });
  });

  it('LINK mirrors the destination, not the source', () => {
    writeFileSync(h.request, '/a', 'x');
    const { action } = actionFor(OP.LINK, '/a', encodeSecondPath('/b'));
    expect(action).toEqual({ op: OP.LINK, path: '/b' });
  });

  it('MKDTEMP mirrors the directory it invented', () => {
    const { result, action } = actionFor(OP.MKDTEMP, '/tmp-');
    const created = new TextDecoder().decode(result.data as Uint8Array);
    expect(action).toEqual({ op: OP.MKDTEMP, path: created });
    expect(created.startsWith('/tmp-')).toBe(true);
  });
});

describe('unmirrored operations', () => {
  it.each([
    ['READ', OP.READ],
    ['STAT', OP.STAT],
    ['LSTAT', OP.LSTAT],
    ['READDIR', OP.READDIR],
    ['EXISTS', OP.EXISTS],
    ['ACCESS', OP.ACCESS],
    ['REALPATH', OP.REALPATH],
  ])('%s changes nothing, so it mirrors nothing', (_n, op) => {
    writeFileSync(h.request, '/f', 'x');
    expect(actionFor(op as number, '/f').action).toBeNull();
  });

  it('a failed operation never mirrors', () => {
    // A rejected mkdir that still told the mirror to create the directory would leave the two
    // filesystems disagreeing.
    mkdirSync(h.request, '/d');
    const { result, action } = actionFor(OP.MKDIR, '/d', encodeModePayload(0o777));
    expect(result.status).not.toBe(0);
    expect(action).toBeNull();
  });

  it('a failed unlink never mirrors a delete', () => {
    const { result, action } = actionFor(OP.UNLINK, '/missing');
    expect(result.status).not.toBe(0);
    expect(action).toBeNull();
  });
});

describe('OPEN mirrors only when bytes actually changed', () => {
  const O_CREAT = 64, O_TRUNC = 512, O_RDONLY = 0;

  it('a creating open of a missing file mirrors as a write', () => {
    const { action } = actionFor(OP.OPEN, '/new', encodeModePayload(0o666), O_CREAT | 1);
    expect(action).toEqual({ op: OP.WRITE, path: '/new' });
  });

  it('a creating open of an existing file does not re-mirror', () => {
    // Re-mirroring here would re-read the whole file on every append-mode open.
    writeFileSync(h.request, '/have', 'contents');
    const { action } = actionFor(OP.OPEN, '/have', encodeModePayload(0o666), O_CREAT | 1);
    expect(action).toBeNull();
  });

  it('a truncating open always mirrors, even on an existing file', () => {
    writeFileSync(h.request, '/have', 'contents');
    const { action } = actionFor(OP.OPEN, '/have', encodeModePayload(0o666), O_CREAT | O_TRUNC | 1);
    expect(action).toEqual({ op: OP.WRITE, path: '/have' });
  });

  it('a plain read-open never mirrors', () => {
    writeFileSync(h.request, '/have', 'contents');
    const { action } = actionFor(OP.OPEN, '/have', null, O_RDONLY);
    expect(action).toBeNull();
  });

  it('a failed open never mirrors', () => {
    const { result, action } = actionFor(OP.OPEN, '/missing', null, O_RDONLY);
    expect(result.status).not.toBe(0);
    expect(action).toBeNull();
  });
});

describe('fd operations resolve to a path', () => {
  /** Open a file through the engine and return its fd. */
  function openFd(path: string): number {
    writeFileSync(h.request, path, 'abcdef');
    const r = dispatchOp(h.engine, 'tab', OP.OPEN, 2 /* O_RDWR */, path, encodeModePayload(0o666));
    return new DataView((r.data as Uint8Array).buffer, (r.data as Uint8Array).byteOffset, 4).getUint32(0, true);
  }

  it('FWRITE mirrors the fd’s path', () => {
    const fd = openFd('/f');
    const { action } = actionFor(OP.FWRITE, '', encodeFwritePayload(fd, 0, new Uint8Array([1])));
    expect(action).toEqual({ op: OP.FWRITE, path: '/f' });
  });

  it('FTRUNCATE mirrors the fd’s path', () => {
    const fd = openFd('/f');
    const { action } = actionFor(OP.FTRUNCATE, '', encodeFtruncatePayload(fd, 2));
    expect(action).toEqual({ op: OP.FTRUNCATE, path: '/f' });
  });

  it('FCHMOD is reported to the mirror as CHMOD, since the mirror speaks paths', () => {
    const fd = openFd('/f');
    const { action } = actionFor(OP.FCHMOD, '', encodeFchmodPayload(fd, 0o600));
    expect(action).toEqual({ op: OP.CHMOD, path: '/f' });
  });

  it('CLOSE and FSTAT mirror nothing', () => {
    const fd = openFd('/f');
    expect(actionFor(OP.FSTAT, '', encodeFdPayload(fd)).action).toBeNull();
    expect(actionFor(OP.CLOSE, '', encodeFdPayload(fd)).action).toBeNull();
  });
});
