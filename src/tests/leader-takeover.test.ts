/**
 * Taking the leader lock from a leader that stays silent, and stepping down when it is taken.
 *
 * Found in Vue Play Studio (`mode: 'hybrid'`, no crossOriginIsolated): a page started as a follower
 * because another page held `<ns>-leader`, but that leader never answered — a frozen background
 * tab, or a stale page. The lock was held, so the follower was never promoted; nothing it asked
 * was answered, so the app stayed blank. The relay now reports a silence that rules out a slow
 * operation (`leader-silent`, see follower-forward.ts), and the page steals the lock.
 *
 * The other side has to hold up too: a leader whose lock is stolen is still serving and still has
 * the volume open. It must stop and give the volume back, or two instances would both own it.
 *
 * A second *instance* on the same root is not possible in one process (instances are per-root
 * singletons), so "the other tab" is a plain lock holder on the stub — which is all a frozen tab
 * is, from here.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VFSFileSystem } from '../src/index.js';

/** A Worker stub that records what it is sent and answers `shutdown` like the real relay does. */
class FakeWorker {
  onmessage: ((e: { data: any }) => void) | null = null;
  posted: any[] = [];
  terminated = false;
  postMessage(msg: any): void {
    this.posted.push(msg);
    if (msg?.type === 'shutdown') queueMicrotask(() => this.onmessage?.({ data: { type: 'shutdown-done' } }));
  }
  terminate(): void { this.terminated = true; }
  addEventListener(): void {}
  removeEventListener(): void {}
  types(): string[] { return this.posted.map((m) => m?.type); }
}

const abortError = () => Object.assign(new Error('The lock was stolen'), { name: 'AbortError' });

interface Holder { reject: (err: Error) => void }
interface Waiter { run: () => void }

/**
 * Web Locks with the semantics this needs, `steal` included: a steal releases the current holder
 * at once — its `request()` promise rejects with an AbortError while its callback keeps running —
 * and is granted ahead of any queue.
 */
class LockManagerStub {
  private holders = new Map<string, Holder>();
  private queues = new Map<string, Waiter[]>();
  steals = 0;

  request(name: string, a: any, b?: any): Promise<void> {
    const options = typeof a === 'function' ? {} : a;
    const callback = typeof a === 'function' ? a : b;

    if (options.steal) {
      this.steals++;
      const holder = this.holders.get(name);
      this.holders.delete(name);
      holder?.reject(abortError());
      return this.grant(name, callback);
    }
    if (options.ifAvailable) {
      if (this.holders.has(name)) return Promise.resolve(callback(null));
      return this.grant(name, callback);
    }
    if (!this.holders.has(name)) return this.grant(name, callback);

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { run: () => this.grant(name, callback).then(resolve, reject) };
      options.signal?.addEventListener('abort', () => {
        const queue = this.queues.get(name) ?? [];
        const at = queue.indexOf(waiter);
        if (at >= 0) queue.splice(at, 1);
        reject(abortError());
      });
      this.queues.set(name, [...(this.queues.get(name) ?? []), waiter]);
    });
  }

  private grant(name: string, callback: (lock: unknown) => unknown): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const holder: Holder = { reject };
      this.holders.set(name, holder);
      const finish = () => {
        if (this.holders.get(name) !== holder) return;   // stolen: no longer ours to release
        this.holders.delete(name);
        this.queues.get(name)?.shift()?.run();
      };
      Promise.resolve()
        .then(() => callback({ name }))
        .then(() => { finish(); resolve(); }, (err) => { finish(); reject(err); });
    });
  }

  isHeld(name: string): boolean { return this.holders.has(name); }
  queueDepth(name: string): number { return (this.queues.get(name) ?? []).length; }
}

let locks: LockManagerStub;
let previousLocks: unknown;
let rootCounter = 0;
let spawned: FakeWorker[];

function makeFS(root: string): any {
  const prevWorker = (globalThis as any).Worker;
  (globalThis as any).Worker = FakeWorker;
  let fs: any;
  try {
    fs = new VFSFileSystem({ root });
  } finally {
    (globalThis as any).Worker = prevWorker;
  }
  fs.spawnWorker = () => { const w = new FakeWorker(); spawned.push(w); return w; };
  fs.initAsyncRelay = () => {};
  fs.initLeaderBroker = () => {};
  // No service worker here: the port brokering is not under test, and a real attempt only logs.
  fs.getServiceWorker = () => new Promise(() => {});
  return fs;
}

/** Let lock callbacks, microtasks and the relay's `shutdown-done` run. */
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

/** "Another tab" that holds the lock until told to let go; `lost` settles if it is stolen. */
function otherTabHolds(name: string): { lost: Promise<unknown>; release: () => void } {
  let release!: () => void;
  const lost = locks.request(name, async () => { await new Promise<void>((r) => { release = r; }); })
    .then(() => 'released', (err) => err);
  return { lost, release: () => release() };
}

/** The lock name an instance on `root` uses (`<ns>-leader`), known before it is constructed. */
const lockOf = (root: string) => `vfs-${root.replace(/[^a-zA-Z0-9]/g, '_')}-leader`;

/** A follower: another tab holds the lock before this instance runs its election. */
function makeFollower(root = `/takeover-${rootCounter++}`) {
  const other = otherTabHolds(lockOf(root));
  const fs = makeFS(root);
  return { fs, other, name: lockOf(root) };
}

const silent = (fs: any, silentForMs = 16_000) =>
  fs.syncWorker.onmessage({ data: { type: 'leader-silent', silentForMs, timeouts: 3 } });

let silenceWarn: typeof console.warn;
beforeEach(() => {
  spawned = [];
  locks = new LockManagerStub();
  previousLocks = (navigator as any).locks;
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true, writable: true });
  silenceWarn = console.warn;
  console.warn = () => {};   // the takeover and step-down announce themselves; expected here
});
afterEach(() => {
  console.warn = silenceWarn;
  Object.defineProperty(navigator, 'locks', { value: previousLocks, configurable: true, writable: true });
});

describe('a follower whose leader stays silent', () => {
  it('steals the lock and becomes leader through the ordinary promotion', async () => {
    const { fs, other, name } = makeFollower();
    await settle();
    expect(fs.isLeader).toBe(false);
    expect(locks.queueDepth(name)).toBe(1);   // queued behind the silent leader

    const roles: boolean[] = [];
    fs.onLeaderChange((isLeader: boolean) => roles.push(isLeader));
    silent(fs);
    await settle();

    expect(await other.lost).toMatchObject({ name: 'AbortError' });   // the old holder lost it
    expect(fs.isLeader).toBe(true);
    expect(fs.holdingLeaderLock).toBe(true);
    expect(locks.isHeld(name)).toBe(true);
    expect(locks.queueDepth(name)).toBe(0);   // the queued bid was withdrawn, not left to fire later
    expect(roles).toEqual([true]);
    // Promotion opened the volume on fresh relays, with the usual retry/deadline path behind it.
    expect(spawned.at(-2)!.types()).toContain('init-leader');
    expect(fs.transitioning).toBe(true);
    await fs.dispose();
  });

  it('settles a promise call stuck on the old leader with EIO instead of leaving it pending', async () => {
    const { fs } = makeFollower();
    await settle();
    fs.syncWorker.onmessage({ data: { type: 'ready' } });   // a follower is ready at once

    const call = fs.promises.mkdir('/app').then(() => 'resolved', (err: any) => err);
    await settle();
    expect(fs.asyncPending.size).toBe(1);   // in the async relay, on its way to the silent leader

    silent(fs);
    await settle();
    expect(fs.asyncPending.size).toBe(0);
    expect(await call).toMatchObject({ code: 'EIO' });
    await fs.dispose();
  });

  it('keeps at most one takeover in flight', async () => {
    const { fs } = makeFollower();
    await settle();
    silent(fs);
    silent(fs);
    silent(fs);
    await settle();
    expect(locks.steals).toBe(1);
    silent(fs);   // now leader: nothing to take over
    await settle();
    expect(locks.steals).toBe(1);
    await fs.dispose();
  });

  it('never steals once closed', async () => {
    const { fs, other } = makeFollower();
    await settle();
    const relay = fs.syncWorker;
    await fs.dispose();
    relay.onmessage({ data: { type: 'leader-silent', silentForMs: 60_000, timeouts: 9 } });
    await settle();
    expect(locks.steals).toBe(0);
    other.release();
    expect(await other.lost).toBe('released');   // the other tab kept it until it chose to let go
  });

  it('gives a newly announced leader its own window instead of stealing from it', async () => {
    const { fs } = makeFollower();
    await settle();
    fs.lastLeaderChangeAt = Date.now() - 2_000;   // a leader announced itself 2s into the silence
    silent(fs, 16_000);
    await settle();
    expect(locks.steals).toBe(0);
    expect(fs.isLeader).toBe(false);
    await fs.dispose();
  });

  describe('when the volume stays held after the takeover (the old leader is frozen)', () => {
    let silenceError: typeof console.error;
    beforeEach(() => { silenceError = console.error; console.error = () => {}; });
    afterEach(() => { console.error = silenceError; });

    /** Took over, then the volume deadline passed with the handle still held. */
    async function takeoverPastDeadline() {
      const { fs, name } = makeFollower();
      await settle();
      silent(fs);
      await settle();
      expect(fs.isLeader).toBe(true);
      fs.volumeRetryStartedAt = Date.now() - 16_000;
      fs.syncWorker.onmessage({ data: { type: 'init-failed', error: 'NoModificationAllowedError' } });
      return { fs, name, relay: fs.syncWorker as FakeWorker };
    }

    it('reports the failure, but keeps the lock and keeps retrying', async () => {
      const { fs, name } = await takeoverPastDeadline();
      // Callers get an error rather than a hang…
      expect(await fs.promises.mkdir('/a').then(() => 'resolved', (e: any) => e.message)).toMatch(/could not open the volume/);
      // …but this instance did not give up: lock held, retrying slowly.
      expect(fs.holdingLeaderLock).toBe(true);
      expect(locks.isHeld(name)).toBe(true);
      expect(fs.volumeRetryDelayMs).toBe(2_000);
      await fs.dispose();
    });

    it('recovers when the volume opens: calls work again', async () => {
      const { fs } = await takeoverPastDeadline();
      await fs.promises.mkdir('/a').catch(() => {});
      fs.syncWorker.onmessage({ data: { type: 'ready' } });   // the frozen leader thawed and let go
      expect(fs.ready).toBe(true);
      expect(fs.initError).toBe(null);
      const call = fs.promises.mkdir('/b');
      await settle();
      expect(fs.asyncPending.size).toBe(1);   // sent to the relay, not rejected with the old error
      fs.asyncWorker.onmessage({ data: { type: 'response', callId: [...fs.asyncPending.keys()][0], status: 0, data: null } });
      await expect(call).resolves.toBeUndefined();
      await fs.dispose();
    });

    it('a retry pending when the lock is stolen back does not reach the follower relays', async () => {
      const { fs, name, relay } = await takeoverPastDeadline();
      locks.request(name, { steal: true }, async () => { await new Promise(() => {}); });
      await settle();
      expect(fs.isLeader).toBe(false);
      expect(fs.initError).toBe(null);   // the takeover's failure no longer applies to a follower
      const followerRelay = fs.syncWorker as FakeWorker;
      expect(followerRelay).not.toBe(relay);
      await new Promise((r) => setTimeout(r, 2_100));
      expect(followerRelay.types()).not.toContain('init-leader');
      await fs.dispose();
    }, 5_000);

    it('an ordinary promotion past the deadline still gives up and releases the lock', async () => {
      const { fs, other, name } = makeFollower();
      await settle();
      other.release();   // the leader left normally: promoted by the queue, not by a takeover
      await settle();
      expect(fs.isLeader).toBe(true);
      fs.volumeRetryStartedAt = Date.now() - 16_000;
      fs.syncWorker.onmessage({ data: { type: 'init-failed', error: 'NoModificationAllowedError' } });
      await settle();
      expect(fs.holdingLeaderLock).toBe(false);
      expect(locks.isHeld(name)).toBe(false);
      await fs.dispose();
    });
  });

  it('does nothing without Web Locks', async () => {
    const { fs } = makeFollower();
    await settle();
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true, writable: true });
    delete (navigator as any).locks;
    expect(() => silent(fs)).not.toThrow();
    expect(fs.takeoverInFlight).toBe(false);
    Object.defineProperty(navigator, 'locks', { value: locks, configurable: true, writable: true });
    expect(locks.steals).toBe(0);
    await fs.dispose();
  });

  it('a responsive leader is never stolen from: no silence report, no steal', async () => {
    // The page only steals on `leader-silent`, which the relay sends only after the silence rule
    // holds (any answer resets it — see LeaderSilenceWatch in follower-forward.test.ts). A
    // follower that keeps getting answers therefore just stays a follower.
    const { fs, other } = makeFollower();
    await settle();
    fs.syncWorker.onmessage({ data: { type: 'ready' } });
    fs.syncWorker.onmessage({ data: { type: 'need-leader' } });   // an ordinary reconnect is not a takeover
    await settle();
    expect(locks.steals).toBe(0);
    expect(fs.isLeader).toBe(false);
    other.release();
    expect(await other.lost).toBe('released');
    await fs.dispose();
  });
});

describe('a leader whose lock is stolen', () => {
  async function leaderWithStolenLock() {
    const fs = makeFS(`/stepdown-${rootCounter++}`);
    const name = `${fs.ns}-leader`;
    await settle();
    expect(fs.isLeader).toBe(true);
    fs.syncWorker.onmessage({ data: { type: 'ready' } });
    const relay: FakeWorker = fs.syncWorker;
    const asyncRelay: FakeWorker = fs.asyncWorker;
    const broker: any[] = [];
    fs.brokerSw = { postMessage: (m: unknown) => broker.push(m) };
    fs.brokerHeartbeatTimer = setInterval(() => {}, 5_000);
    return { fs, name, relay, asyncRelay, broker };
  }

  it('shuts its relay down (giving the volume back), stops serving and continues as a follower', async () => {
    const { fs, name, relay, asyncRelay, broker } = await leaderWithStolenLock();
    const roles: boolean[] = [];
    fs.onLeaderChange((isLeader: boolean) => roles.push(isLeader));
    const inFlight = fs.promises.mkdir('/x').then(() => 'resolved', (err: any) => err);
    await settle();

    let stealerRelease!: () => void;
    locks.request(name, { steal: true }, async () => { await new Promise<void>((r) => { stealerRelease = r; }); });
    await settle();

    // The volume went back through the same `shutdown` the unload path uses, then the relays died.
    expect(relay.types()).toContain('shutdown');
    expect(relay.terminated).toBe(true);
    expect(asyncRelay.terminated).toBe(true);
    // It stopped taking followers, and only cleared the broker slot if the slot was still its own.
    expect(broker).toContainEqual({ type: 'deregister-server', serverId: fs.tabId });
    expect(fs.brokerHeartbeatTimer).toBe(null);
    // A call the old relay was carrying may or may not have been applied: EIO, not a hang.
    expect(await inFlight).toMatchObject({ code: 'EIO' });

    // Now a follower of the new leader, on fresh relays, queued for the lock again.
    expect(fs.isLeader).toBe(false);
    expect(fs.holdingLeaderLock).toBe(false);
    expect(roles).toEqual([false]);
    const newRelay = fs.syncWorker as FakeWorker;
    expect(newRelay).not.toBe(relay);
    expect(newRelay.types()).toEqual(expect.arrayContaining(['init-follower', 'leader-port']));
    expect(newRelay.types()).not.toContain('init-leader');
    expect(locks.queueDepth(name)).toBe(1);
    expect(fs.ready).toBe(false);

    // Follower ready → calls work again (they go to the new leader through the relay).
    fs.syncWorker.onmessage({ data: { type: 'ready' } });
    expect(fs.ready).toBe(true);

    // When the stealer goes away, this instance is promoted again in the ordinary way.
    stealerRelease();
    await settle();
    expect(fs.isLeader).toBe(true);
    expect(roles).toEqual([false, true]);
    await fs.dispose();
  });

  it('a disposed leader that loses the lock does not come back as a follower', async () => {
    const { fs, name, relay } = await leaderWithStolenLock();
    const spawnedBefore = spawned.length;
    await fs.dispose();
    locks.request(name, { steal: true }, async () => { await new Promise(() => {}); });
    await settle();
    expect(relay.terminated).toBe(true);
    expect(spawned.length).toBe(spawnedBefore);
    expect(locks.queueDepth(name)).toBe(0);
  });

  it('an ordinary release (dispose) is not mistaken for a steal', async () => {
    const { fs, name } = await leaderWithStolenLock();
    const spawnedBefore = spawned.length;
    await fs.dispose();
    await settle();
    expect(locks.isHeld(name)).toBe(false);
    expect(spawned.length).toBe(spawnedBefore);
  });
});

describe('service worker broker', () => {
  it('ignores a deregister from a leader that has been replaced', async () => {
    const listeners: Record<string, (e: any) => void> = {};
    const prevSelf = (globalThis as any).self;
    (globalThis as any).self = {
      addEventListener: (type: string, fn: (e: any) => void) => { listeners[type] = fn; },
      skipWaiting: () => {},
    };
    try {
      await import('../src/workers/service.worker.ts?broker-test');
    } finally {
      (globalThis as any).self = prevSelf;
    }
    const send = (data: any, ports: any[] = []) => listeners.message({ data, ports });
    const control = (id: string) => {
      const got: any[] = [];
      return { got, port: { postMessage: (m: any) => got.push(m) }, id };
    };
    const follower = () => ({ postMessage() {} });

    const oldLeader = control('old');
    const newLeader = control('new');
    send({ type: 'register-server', serverId: 'old' }, [oldLeader.port]);
    send({ type: 'register-server', serverId: 'new' }, [newLeader.port]);   // the stealer
    send({ type: 'deregister-server', serverId: 'old' });                    // the old one steps down late
    send({ type: 'transfer-port', tabId: 'f1' }, [follower()]);
    expect(newLeader.got).toEqual([{ type: 'client-port', tabId: 'f1' }]);   // still routed

    send({ type: 'deregister-server', serverId: 'new' });                    // the real leader leaving
    send({ type: 'transfer-port', tabId: 'f2' }, [follower()]);
    expect(newLeader.got.length).toBe(1);                                    // queued, not posted
    const next = control('next');
    send({ type: 'register-server', serverId: 'next' }, [next.port]);
    expect(next.got).toEqual([{ type: 'client-port', tabId: 'f2' }]);

    // A leader older than serverId still clears the slot, as before.
    send({ type: 'deregister-server' });
    send({ type: 'transfer-port', tabId: 'f3' }, [follower()]);
    expect(next.got.length).toBe(1);
  });
});
