/**
 * `fs.watch` must not lose the watcher because the transport was momentarily unavailable.
 *
 * `watch` checks the path exists before registering, so that a mistyped path throws instead of
 * handing back a watcher that can never fire. That check is a synchronous call, and it is the
 * *first* one a tab makes. A follower whose leader port has not yet proved itself refuses such a
 * call quickly with `EIO` — deliberately, because the alternative is a ten-second stall.
 *
 * So a tab that lost the election could have this one check refused and throw out of `watch()`
 * before registering anything. It then never saw another change for the rest of its life, while
 * every other tab worked normally. Measured at roughly one tab in sixteen; four tabs each writing
 * in turn reproduced it in three runs of ten, and in 144 tabs after the fix, never.
 *
 * `ENOENT` is a permanent fact about the filesystem and must still throw. `EIO` is the transport
 * declining to answer, which is not, and must not be treated as one.
 */

import { describe, it, expect } from 'vitest';
import { watch } from '../src/methods/watch.js';
import { STATUS } from '../src/protocol/opcodes.js';

/** A transport that answers every request with the same status. */
const respondWith = (status: number) => () => ({ status, data: null });

let nsCounter = 0;
const freshNs = () => `vfs-watch-eio-${nsCounter++}`;

describe('fs.watch and a transport that will not answer', () => {
  it('still registers when the existence check is refused with EIO', () => {
    const watcher = watch(freshNs(), respondWith(STATUS.EIO), '/', { recursive: true }, () => {});
    // Registering is the whole point: throwing here is what left a tab permanently deaf.
    expect(watcher).toBeDefined();
    expect(() => watcher.close()).not.toThrow();
  });

  it('still throws ENOENT for a path that genuinely is not there', () => {
    expect(() => watch(freshNs(), respondWith(STATUS.ENOENT), '/nope', {}, () => {}))
      .toThrowError(/ENOENT/);
  });

  it('reports the failure against watch, not the stat that discovered it', () => {
    try {
      watch(freshNs(), respondWith(STATUS.ENOENT), '/nope', {}, () => {});
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as { syscall?: string }).syscall).toBe('watch');
    }
  });
});
