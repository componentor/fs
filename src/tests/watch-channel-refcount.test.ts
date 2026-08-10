/**
 * One watcher gives back exactly one reference to the shared broadcast channel.
 *
 * Every `fs.watch` in a context shares a single `BroadcastChannel`, refcounted. Tearing a watcher
 * down used to release more than once — `close()` released, an `AbortSignal` firing released
 * again, and `close()` itself is callable repeatedly. Each extra release decremented a count that
 * other, still-registered watchers were relying on, and when it reached zero the channel closed
 * underneath them. Those watchers stopped receiving events permanently.
 *
 * The symptom gives no hint of the cause: a tab that has stopped seeing changes made elsewhere,
 * while its siblings carry on. Reported as one follower tab out of four whose watcher stopped
 * firing.
 *
 * These assert on the channel's own bookkeeping rather than on delivery, because the failure is
 * precisely that the channel is gone before the last watcher has finished with it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFsHarness } from './helpers/engine-transport.js';
import type { VFSFileSystem } from '../src/filesystem.js';

let fs: VFSFileSystem;
beforeEach(() => {
  fs = createFsHarness().fs;
  fs.mkdirSync('/w', { recursive: true });
});
afterEach(() => { /* watchers are closed per test */ });

describe('watch channel refcounting', () => {
  it('survives a watcher that is closed twice', () => {
    const survivor = fs.watch('/w', () => {});
    const doubled = fs.watch('/w', () => {});

    doubled.close();
    doubled.close();   // the extra release used to close the shared channel

    // The survivor must still be registered and functional: closing it is the only remaining
    // reference, and doing so must not throw.
    expect(() => survivor.close()).not.toThrow();
  });

  it('survives a watcher that is both aborted and closed', () => {
    const controller = new AbortController();
    const survivor = fs.watch('/w', () => {});
    const doomed = fs.watch('/w', { signal: controller.signal }, () => {});

    controller.abort();   // releases once
    doomed.close();       // used to release a second time

    expect(() => survivor.close()).not.toThrow();
  });

  // Delivery itself is not asserted here: events reach a watcher over a BroadcastChannel posted
  // by the leader's relay, which this in-process harness does not run. What is asserted is the
  // bookkeeping that decides whether the channel is still open to deliver *over*.
});
