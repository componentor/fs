/**
 * MirrorEchoTracker — which observer records the OPFS mirror treats as its own echo.
 *
 * Regression: a 'disappeared' record was matched against our recent ops by time alone, and any op
 * counted — so a genuine external delete of a file we had merely *written* (or of a directory we
 * had created) in the last 3 seconds was taken for our echo and dropped: OPFS lost the file, the
 * VFS kept it. Only an op that removes a path can make it disappear, so only those explain one.
 */

import { describe, it, expect } from 'vitest';
import { MirrorEchoTracker, ECHO_GRACE_MS } from '../src/workers/opfs-sync-echo.js';

const bytes = (s: string) => new TextEncoder().encode(s);

function tracker() {
  let t = 1_000_000;
  const echo = new MirrorEchoTracker(() => t);
  return {
    echo,
    advance: (ms: number) => { t += ms; },
    /** Run a mirror op to completion, the way the worker's queue does. */
    run: (op: Parameters<MirrorEchoTracker['enqueued']>[0], data?: string) => {
      echo.enqueued(op);
      if (data !== undefined) echo.wrote(op.path, bytes(data));
      echo.finished(op);
    },
  };
}

describe('external deletes', () => {
  it('a delete of a file we just wrote is applied, not taken for our echo (the regression)', () => {
    const { echo, run, advance } = tracker();
    run({ op: 'write', path: '/d/a' }, 'x');
    advance(10);
    expect(echo.isDeleteEcho('/d/a')).toBe(false);
  });

  it('a recursive delete of a directory we created and filled is applied, every record of it', () => {
    const { echo, run, advance } = tracker();
    run({ op: 'mkdir', path: '/dir' });
    run({ op: 'mkdir', path: '/dir/sub' });
    for (const n of ['a', 'b', 'c']) run({ op: 'write', path: '/dir/sub/' + n }, 'x');
    advance(10);
    for (const p of ['/dir/sub', '/dir/sub/a', '/dir/sub/b', '/dir/sub/c']) {
      expect(echo.isDeleteEcho(p), p).toBe(false);
    }
  });

  it('our own delete is an echo for the path and everything under it, within the window', () => {
    const { echo, run, advance } = tracker();
    run({ op: 'delete', path: '/dir' });
    advance(ECHO_GRACE_MS - 1);
    expect(echo.isDeleteEcho('/dir')).toBe(true);
    expect(echo.isDeleteEcho('/dir/sub/file')).toBe(true);
    expect(echo.isDeleteEcho('/dirx')).toBe(false); // a sibling sharing the prefix is not under it
    advance(1);
    expect(echo.isDeleteEcho('/dir')).toBe(false);
  });

  it('a delete still in flight is an echo, and stops being one only after its window', () => {
    const { echo, advance } = tracker();
    const op = { op: 'delete' as const, path: '/dir' };
    echo.enqueued(op);
    advance(60_000); // a long queue: no timeout while pending
    expect(echo.isDeleteEcho('/dir/x')).toBe(true);
    echo.finished(op);
    advance(ECHO_GRACE_MS);
    expect(echo.isDeleteEcho('/dir/x')).toBe(false);
  });

  it('a write in flight on the path itself wins over the observed delete', () => {
    const { echo } = tracker();
    echo.enqueued({ op: 'write', path: '/d/a' });
    expect(echo.isDeleteEcho('/d/a')).toBe(true);
    // …but it says nothing about its parent disappearing.
    expect(echo.isDeleteEcho('/d')).toBe(false);
  });

  it('a directory rename removes its source and the target it replaces', () => {
    const { echo, run } = tracker();
    run({ op: 'rename', path: '/.vite/deps_temp', newPath: '/.vite/deps' });
    expect(echo.isDeleteEcho('/.vite/deps_temp')).toBe(true);
    expect(echo.isDeleteEcho('/.vite/deps_temp/chunk.js')).toBe(true);
    expect(echo.isDeleteEcho('/.vite/deps/old.js')).toBe(true);
    expect(echo.isDeleteEcho('/.vite/other')).toBe(false);
  });
});

describe('external moves', () => {
  it('moving a file we just wrote is applied', () => {
    const { echo, run } = tracker();
    run({ op: 'write', path: '/d/a' }, 'x');
    expect(echo.isMoveEcho('/d/a', '/d/b')).toBe(false);
  });

  it('is an echo when our op removed the source or is still writing the destination', () => {
    const { echo, run } = tracker();
    run({ op: 'delete', path: '/d/a' });
    expect(echo.isMoveEcho('/d/a', '/d/b')).toBe(true);
    echo.enqueued({ op: 'write', path: '/e/c' });
    expect(echo.isMoveEcho('/e/x', '/e/c')).toBe(true);
  });
});

describe('external writes (content-matched, unchanged)', () => {
  it('is an echo only for the bytes we wrote, inside the window', () => {
    const { echo, run, advance } = tracker();
    run({ op: 'write', path: '/a' }, 'ours');
    expect(echo.isWriteEcho('/a', bytes('ours'))).toBe(true);
    expect(echo.isWriteEcho('/a', bytes('theirs'))).toBe(false);
    advance(ECHO_GRACE_MS);
    expect(echo.isWriteEcho('/a', bytes('ours'))).toBe(false);
  });

  it('anything observed while our write is in flight is ours', () => {
    const { echo } = tracker();
    echo.enqueued({ op: 'write', path: '/a' });
    expect(echo.isWriteEcho('/a', bytes('half-written'))).toBe(true);
  });

  it('sweep forgets entries past the window', () => {
    const { echo, run, advance } = tracker();
    run({ op: 'write', path: '/a' }, 'x');
    run({ op: 'delete', path: '/b' });
    advance(ECHO_GRACE_MS + 1);
    echo.sweep();
    expect(echo.wasCompleted('/a')).toBe(false);
    expect(echo.isDeleteEcho('/b')).toBe(false);
  });
});
