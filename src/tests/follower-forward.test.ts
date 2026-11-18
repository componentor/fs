/**
 * FollowerForwarder tests — the follower→leader request state machine.
 *
 * Covers the reliability contract:
 *  - sequence-id matching (stale/foreign responses can never resolve the
 *    wrong request)
 *  - per-request deadline → EIO instead of an infinite hang
 *  - late echoes of timed-out requests are swallowed, not leaked to the
 *    no-SAB async-relay path
 *  - reconnection (setPort) aborts in-flight requests with EIO
 *  - no stray timers after on-time responses
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  FollowerForwarder, LeaderSilenceWatch, FORWARD_DEADLINE_MS, UNPROVEN_DEADLINE_MS,
  TAKEOVER_SILENCE_MS, TAKEOVER_MIN_TIMEOUTS, PROBE_INTERVAL_MS, type LeaderPortLike,
} from '../src/protocol/follower-forward.js';
import { STATUS } from '../src/protocol/opcodes.js';

class FakePort implements LeaderPortLike {
  posted: Array<{ message: any; transfer?: Transferable[] }> = [];
  closed = false;
  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.posted.push({ message, transfer });
  }
  close(): void {
    this.closed = true;
  }
}

function statusOf(buf: ArrayBuffer): number {
  return new DataView(buf).getUint32(0, true);
}

function makeResponse(): ArrayBuffer {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setUint32(0, STATUS.OK, true);
  return buf;
}

describe('FollowerForwarder', () => {
  let forwarder: FollowerForwarder;
  let port: FakePort;
  const payload = new Uint8Array([1, 2, 3, 4]);

  beforeEach(() => {
    vi.useFakeTimers();
    forwarder = new FollowerForwarder(() => 'tab-1');
    port = new FakePort();
    forwarder.setPort(port);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('posts requests with monotonically increasing numeric ids and the tabId', async () => {
    const p1 = forwarder.forward(payload);
    expect(port.posted.length).toBe(1);
    const msg1 = port.posted[0].message;
    expect(typeof msg1.id).toBe('number');
    expect(msg1.tabId).toBe('tab-1');
    expect(msg1.buffer).toBeInstanceOf(ArrayBuffer);

    forwarder.handleResponse(msg1.id, makeResponse());
    await p1;

    const p2 = forwarder.forward(payload);
    const msg2 = port.posted[1].message;
    expect(msg2.id).toBe(msg1.id + 1);
    forwarder.handleResponse(msg2.id, makeResponse());
    await p2;
  });

  it('a matching response resolves the in-flight request with that buffer', async () => {
    const p = forwarder.forward(payload);
    const id = port.posted[0].message.id;
    const response = makeResponse();
    expect(forwarder.handleResponse(id, response)).toBe(true);
    await expect(p).resolves.toBe(response);
  });

  it('a response with a non-matching id is not consumed and resolves nothing', async () => {
    const p = forwarder.forward(payload);
    const id = port.posted[0].message.id;
    const foreign = makeResponse();
    // Foreign id (e.g. async-relay string id, or a bogus number)
    expect(forwarder.handleResponse('a17', foreign)).toBe(false);
    expect(forwarder.handleResponse(id + 999, foreign)).toBe(false);
    // The real response still resolves the request
    const real = makeResponse();
    expect(forwarder.handleResponse(id, real)).toBe(true);
    await expect(p).resolves.toBe(real);
  });

  it('resolves with EIO after the deadline instead of hanging', async () => {
    const p = forwarder.forward(payload);
    vi.advanceTimersByTime(FORWARD_DEADLINE_MS + 1);
    const buf = await p;
    expect(statusOf(buf)).toBe(STATUS.EIO);
  });

  it('a late echo of a timed-out request is consumed, not leaked', async () => {
    const p = forwarder.forward(payload);
    const id = port.posted[0].message.id;
    vi.advanceTimersByTime(FORWARD_DEADLINE_MS + 1);
    expect(statusOf(await p)).toBe(STATUS.EIO);
    // The leader answers late: must be swallowed (true), so the no-SAB
    // async-relay path never sees a buffer it didn't ask for.
    expect(forwarder.handleResponse(id, makeResponse())).toBe(true);
    // And only once — a second identical message is foreign.
    expect(forwarder.handleResponse(id, makeResponse())).toBe(false);
  });

  it('a late echo can never resolve a NEWER request with stale data', async () => {
    const p1 = forwarder.forward(payload);
    const id1 = port.posted[0].message.id;
    vi.advanceTimersByTime(FORWARD_DEADLINE_MS + 1);
    expect(statusOf(await p1)).toBe(STATUS.EIO);

    const p2 = forwarder.forward(payload);
    const id2 = port.posted[1].message.id;

    // Stale response for request 1 arrives while request 2 is in flight
    const stale = makeResponse();
    expect(forwarder.handleResponse(id1, stale)).toBe(false); // id1 !== pendingSeq anymore

    const real = makeResponse();
    forwarder.handleResponse(id2, real);
    await expect(p2).resolves.toBe(real);
  });

  it('an on-time response clears the deadline timer (no stray EIO)', async () => {
    const p = forwarder.forward(payload);
    const id = port.posted[0].message.id;
    const response = makeResponse();
    forwarder.handleResponse(id, response);
    await expect(p).resolves.toBe(response);
    // Advancing past the deadline must not fire anything (would throw on
    // double-resolve via the abandoned-flag accounting if the timer leaked)
    vi.advanceTimersByTime(FORWARD_DEADLINE_MS * 2);
    expect(forwarder.handleResponse(id, makeResponse())).toBe(false);
  });

  it('setPort with a new port closes the old one and aborts in-flight with EIO', async () => {
    const p = forwarder.forward(payload);
    const newPort = new FakePort();
    forwarder.setPort(newPort);
    expect(port.closed).toBe(true);
    expect(statusOf(await p)).toBe(STATUS.EIO);
    // New requests go out on the new port
    const p2 = forwarder.forward(payload);
    expect(newPort.posted.length).toBe(1);
    forwarder.handleResponse(newPort.posted[0].message.id, makeResponse());
    await p2;
  });

  it('setPort with the same port is a no-op for in-flight requests', async () => {
    const p = forwarder.forward(payload);
    forwarder.setPort(port);
    expect(port.closed).toBe(false);
    const id = port.posted[0].message.id;
    const response = makeResponse();
    forwarder.handleResponse(id, response);
    await expect(p).resolves.toBe(response);
  });

  it('a second forward while one is pending aborts the first with EIO', async () => {
    const p1 = forwarder.forward(payload);
    const p2 = forwarder.forward(payload);
    expect(statusOf(await p1)).toBe(STATUS.EIO);
    const id2 = port.posted[1].message.id;
    const response = makeResponse();
    forwarder.handleResponse(id2, response);
    await expect(p2).resolves.toBe(response);
  });

  it('abortPending resolves the in-flight request with EIO', async () => {
    const p = forwarder.forward(payload);
    forwarder.abortPending();
    expect(statusOf(await p)).toBe(STATUS.EIO);
  });

  it('the no-SAB path is tracked under its own string ids, never the caller\'s', () => {
    // It used to be posted raw (`postRaw`), untracked and without a deadline.
    forwarder.forwardTracked(new ArrayBuffer(4), () => {});
    expect(port.posted.length).toBe(1);
    expect(port.posted[0].message.id).toMatch(/^t\d+$/);
    expect(port.posted[0].message.tabId).toBe('tab-1');
  });

  it('a subarray payload is copied so the posted buffer has exactly the payload bytes', async () => {
    const backing = new Uint8Array([9, 9, 5, 6, 7, 9, 9]);
    const view = backing.subarray(2, 5); // [5, 6, 7], buffer larger than view
    const p = forwarder.forward(view);
    const posted = port.posted[0].message.buffer as ArrayBuffer;
    expect(Array.from(new Uint8Array(posted))).toEqual([5, 6, 7]);
    forwarder.handleResponse(port.posted[0].message.id, makeResponse());
    await p;
  });

  it('hasPort reflects port attachment', () => {
    expect(forwarder.hasPort).toBe(true);
    expect(new FollowerForwarder(() => 't').hasPort).toBe(false);
  });

  /**
   * Give the port its one successful round trip.
   *
   * Suspicion now applies only to a port that *was* working and stopped — the dead-under-spin
   * case it was built for. A port that has never answered is handled by reconnecting instead, so
   * a test that wants to exercise suspicion has to prove the port first.
   */
  async function proveThePort(): Promise<void> {
    const p = forwarder.forward(payload);
    forwarder.handleResponse(port.posted[port.posted.length - 1].message.id, makeResponse());
    await p;
  }

  it('an unproven port is not marked suspect — it reconnects instead', async () => {
    const p = forwarder.forward(payload, true);
    vi.advanceTimersByTime(FORWARD_DEADLINE_MS + 1);
    expect(statusOf(await p)).toBe(STATUS.EIO);
    // Marking it suspect would send every later call down the fail-fast path, so the port could
    // never prove itself and the follower would stay broken for good.
    expect(forwarder.portSuspect).toBe(false);
  });

  it('a deadline timeout marks the port suspect; fail-fast requests then fail instantly', async () => {
    await proveThePort();
    const p1 = forwarder.forward(payload, true);
    vi.advanceTimersByTime(FORWARD_DEADLINE_MS + 1);
    expect(statusOf(await p1)).toBe(STATUS.EIO);
    expect(forwarder.portSuspect).toBe(true);
    // Next fail-fast-eligible request: instant EIO, nothing posted
    const postedBefore = port.posted.length;
    const p2 = forwarder.forward(payload, true);
    expect(statusOf(await p2)).toBe(STATUS.EIO);
    expect(port.posted.length).toBe(postedBefore);
  });

  it('non-fail-fast requests still attempt while suspect, and delivery heals it', async () => {
    await proveThePort();
    const p1 = forwarder.forward(payload, true);
    vi.advanceTimersByTime(FORWARD_DEADLINE_MS + 1);
    await p1;
    expect(forwarder.portSuspect).toBe(true);
    // Async-path request (not fail-fast-eligible) goes out on the port
    const p2 = forwarder.forward(payload, false);
    const id2 = port.posted[port.posted.length - 1].message.id;
    const response = makeResponse();
    expect(forwarder.handleResponse(id2, response)).toBe(true);
    await expect(p2).resolves.toBe(response);
    // Delivery healed the suspicion — sync attempts resume
    expect(forwarder.portSuspect).toBe(false);
    const p3 = forwarder.forward(payload, true);
    const id3 = port.posted[port.posted.length - 1].message.id;
    forwarder.handleResponse(id3, makeResponse());
    expect(statusOf(await p3)).toBe(STATUS.OK);
  });

  it('suspicion expires on its own after the suspect window', async () => {
    await proveThePort();
    const p1 = forwarder.forward(payload, true);
    vi.advanceTimersByTime(FORWARD_DEADLINE_MS + 1);
    await p1;
    expect(forwarder.portSuspect).toBe(true);
    vi.advanceTimersByTime(FollowerForwarder.SUSPECT_WINDOW_MS + 1);
    expect(forwarder.portSuspect).toBe(false);
  });

  it('EIO maps to a distinct status code (11), not ENOTEMPTY (5)', async () => {
    // Regression guard for the old mislabeled `encodeResponse(5) // EIO`,
    // which actually surfaced reconnection aborts as ENOTEMPTY.
    const p = forwarder.forward(payload);
    forwarder.abortPending();
    const status = statusOf(await p);
    expect(status).toBe(11);
    expect(status).not.toBe(STATUS.ENOTEMPTY);
  });
});

/**
 * The no-SAB follower path: the promise API of a page without crossOriginIsolated.
 *
 * Found in Vue Play Studio: a page started as a follower of a leader that never answered (a frozen
 * or stale tab holding the lock). `init()` resolved — a follower is ready at once — and the first
 * `fs.promises.mkdir` hung forever, because this path posted raw: no deadline, no EIO, no request
 * for a fresh leader. These pin down that it now has the SAB path's contract.
 */
describe('FollowerForwarder — no-SAB tracked path', () => {
  let forwarder: FollowerForwarder;
  let port: FakePort;
  let needLeader: number;

  /** Collects settle results by call. */
  function call(): { result: ArrayBuffer | null; calls: number; settle: (b: ArrayBuffer) => void } {
    const c = { result: null as ArrayBuffer | null, calls: 0, settle: (b: ArrayBuffer) => { c.calls++; c.result = b; } };
    return c;
  }
  const lastId = () => port.posted[port.posted.length - 1].message.id as string;

  beforeEach(() => {
    vi.useFakeTimers();
    needLeader = 0;
    forwarder = new FollowerForwarder(() => 'tab-1', undefined, () => { needLeader++; });
    port = new FakePort();
    forwarder.setPort(port);
  });
  afterEach(() => { vi.useRealTimers(); });

  /** One answered round trip, so the port is on the generous deadline. */
  function prove(): void {
    const c = call();
    forwarder.forwardTracked(new ArrayBuffer(4), c.settle);
    forwarder.handleResponse(lastId(), makeResponse());
    expect(c.calls).toBe(1);
  }

  it('a leader answer settles the matching call with that buffer', () => {
    const c = call();
    forwarder.forwardTracked(new ArrayBuffer(4), c.settle);
    const response = makeResponse();
    expect(forwarder.handleResponse(lastId(), response)).toBe(true);
    expect(c.calls).toBe(1);
    expect(c.result).toBe(response);
    expect(forwarder.trackedInFlight).toBe(0);
  });

  it('a silent leader on an unproven port: EIO after the short deadline, and a fresh leader is asked for', () => {
    const c = call();
    forwarder.forwardTracked(new ArrayBuffer(4), c.settle);
    vi.advanceTimersByTime(UNPROVEN_DEADLINE_MS - 1);
    expect(c.calls).toBe(0);
    vi.advanceTimersByTime(2);
    expect(c.calls).toBe(1);
    expect(statusOf(c.result!)).toBe(STATUS.EIO);
    expect(needLeader).toBe(1);
  });

  it('a silent leader on a proven port: EIO after the full deadline, no reconnect (same as the SAB path)', () => {
    prove();
    const c = call();
    forwarder.forwardTracked(new ArrayBuffer(4), c.settle);
    vi.advanceTimersByTime(UNPROVEN_DEADLINE_MS + 1);
    expect(c.calls).toBe(0);
    vi.advanceTimersByTime(FORWARD_DEADLINE_MS);
    expect(statusOf(c.result!)).toBe(STATUS.EIO);
    expect(needLeader).toBe(0);
  });

  it('a late answer to a timed-out call is dropped, once', () => {
    const c = call();
    forwarder.forwardTracked(new ArrayBuffer(4), c.settle);
    const id = lastId();
    vi.advanceTimersByTime(UNPROVEN_DEADLINE_MS + 1);
    expect(statusOf(c.result!)).toBe(STATUS.EIO);
    expect(forwarder.handleResponse(id, makeResponse())).toBe(true);   // consumed, not leaked
    expect(c.calls).toBe(1);                                              // never settled twice
    expect(forwarder.handleResponse(id, makeResponse())).toBe(false);  // and only once
  });

  it('a burst of timeouts on one port asks for a fresh leader once', () => {
    const calls = [call(), call(), call(), call()];
    for (const c of calls) forwarder.forwardTracked(new ArrayBuffer(4), c.settle);
    vi.advanceTimersByTime(UNPROVEN_DEADLINE_MS + 1);
    for (const c of calls) expect(statusOf(c.result!)).toBe(STATUS.EIO);
    expect(needLeader).toBe(1);
  });

  it('each new unproven port that times out asks again', () => {
    const a = call();
    forwarder.forwardTracked(new ArrayBuffer(4), a.settle);
    vi.advanceTimersByTime(UNPROVEN_DEADLINE_MS + 1);
    port = new FakePort();
    forwarder.setPort(port);
    const b = call();
    forwarder.forwardTracked(new ArrayBuffer(4), b.settle);
    vi.advanceTimersByTime(UNPROVEN_DEADLINE_MS + 1);
    expect(needLeader).toBe(2);
  });

  it('a reconnect fails what the old port was carrying with EIO, and nothing fires later', () => {
    const c = call();
    forwarder.forwardTracked(new ArrayBuffer(4), c.settle);
    const old = port;
    forwarder.setPort(new FakePort());
    expect(old.closed).toBe(true);
    expect(c.calls).toBe(1);
    expect(statusOf(c.result!)).toBe(STATUS.EIO);
    vi.advanceTimersByTime(FORWARD_DEADLINE_MS * 2);
    expect(c.calls).toBe(1);
    expect(needLeader).toBe(0);
  });

  it('with no leader port at all, EIO at once instead of a dropped request', () => {
    const lone = new FollowerForwarder(() => 'tab-1');
    const c = call();
    lone.forwardTracked(new ArrayBuffer(4), c.settle);
    expect(c.calls).toBe(1);
    expect(statusOf(c.result!)).toBe(STATUS.EIO);
  });

  it('many calls in flight settle independently', () => {
    const a = call();
    const b = call();
    forwarder.forwardTracked(new ArrayBuffer(4), a.settle);
    const idA = lastId();
    forwarder.forwardTracked(new ArrayBuffer(4), b.settle);
    const idB = lastId();
    const rb = makeResponse();
    forwarder.handleResponse(idB, rb);
    expect(b.result).toBe(rb);
    expect(a.calls).toBe(0);
    const ra = makeResponse();
    forwarder.handleResponse(idA, ra);
    expect(a.result).toBe(ra);
  });

  it('tracked and serial requests never answer each other', async () => {
    const c = call();
    forwarder.forwardTracked(new ArrayBuffer(4), c.settle);
    const trackedId = lastId();
    const p = forwarder.forward(new Uint8Array([1]));
    const seqId = port.posted[port.posted.length - 1].message.id;
    const r1 = makeResponse();
    forwarder.handleResponse(seqId, r1);
    await expect(p).resolves.toBe(r1);
    expect(c.calls).toBe(0);
    forwarder.handleResponse(trackedId, makeResponse());
    expect(c.calls).toBe(1);
  });

  it('reports timeouts and deliveries to its observer', () => {
    const seen: string[] = [];
    forwarder.observe({ noteTimeout: () => seen.push('timeout'), noteResponse: () => seen.push('response') });
    forwarder.forwardTracked(new ArrayBuffer(4), () => {});
    vi.advanceTimersByTime(UNPROVEN_DEADLINE_MS + 1);
    forwarder.forwardTracked(new ArrayBuffer(4), () => {});
    forwarder.handleResponse(lastId(), makeResponse());
    expect(seen).toEqual(['timeout', 'response']);
  });
});

/**
 * When the leader has been silent long enough, the follower asks to take the lock over.
 * The page side (the actual `steal`) is in leader-takeover.test.ts.
 */
describe('LeaderSilenceWatch', () => {
  let fired: Array<{ silentForMs: number; timeouts: number }>;
  let probes: number;
  let watch: LeaderSilenceWatch;

  beforeEach(() => {
    vi.useFakeTimers();
    fired = [];
    probes = 0;
    watch = new LeaderSilenceWatch((info) => fired.push(info), () => { probes++; });
  });
  afterEach(() => { watch.stop(); vi.useRealTimers(); });

  it('a healthy follower never probes and never fires', () => {
    watch.noteResponse();
    vi.advanceTimersByTime(TAKEOVER_SILENCE_MS * 4);
    expect(probes).toBe(0);
    expect(fired).toEqual([]);
  });

  it('a silent leader: probes while silent, then fires once both thresholds hold', () => {
    watch.noteTimeout();
    vi.advanceTimersByTime(PROBE_INTERVAL_MS);
    expect(probes).toBe(1);   // the app made no further calls; the watch keeps asking
    // Time alone is not enough: still one timeout.
    vi.advanceTimersByTime(TAKEOVER_SILENCE_MS);
    expect(fired).toEqual([]);
    for (let i = 1; i < TAKEOVER_MIN_TIMEOUTS; i++) watch.noteTimeout();
    expect(fired.length).toBe(1);
    expect(fired[0].timeouts).toBe(TAKEOVER_MIN_TIMEOUTS);
    expect(fired[0].silentForMs).toBeGreaterThanOrEqual(TAKEOVER_SILENCE_MS);
  });

  it('timeouts alone are not enough before the silence window passes', () => {
    for (let i = 0; i < TAKEOVER_MIN_TIMEOUTS * 3; i++) watch.noteTimeout();
    vi.advanceTimersByTime(TAKEOVER_SILENCE_MS - PROBE_INTERVAL_MS);
    expect(fired).toEqual([]);
  });

  it('fires from the probe tick even if no timeout lands exactly at the window end', () => {
    for (let i = 0; i < TAKEOVER_MIN_TIMEOUTS; i++) watch.noteTimeout();
    vi.advanceTimersByTime(TAKEOVER_SILENCE_MS + PROBE_INTERVAL_MS);
    expect(fired.length).toBe(1);
  });

  it('any answer from a leader resets it — a responsive leader is never taken over', () => {
    for (let i = 0; i < TAKEOVER_MIN_TIMEOUTS; i++) watch.noteTimeout();
    vi.advanceTimersByTime(TAKEOVER_SILENCE_MS - 1_000);
    watch.noteResponse();   // late, but alive
    const probesAtAnswer = probes;
    vi.advanceTimersByTime(TAKEOVER_SILENCE_MS * 2);
    expect(fired).toEqual([]);
    expect(probes).toBe(probesAtAnswer);   // and probing stopped
  });

  it('after firing it opens a fresh window rather than firing again at once', () => {
    for (let i = 0; i < TAKEOVER_MIN_TIMEOUTS; i++) watch.noteTimeout();
    vi.advanceTimersByTime(TAKEOVER_SILENCE_MS + PROBE_INTERVAL_MS);
    expect(fired.length).toBe(1);
    watch.noteTimeout();
    vi.advanceTimersByTime(PROBE_INTERVAL_MS);
    expect(fired.length).toBe(1);
  });

  it('stop() ends probing and firing for good', () => {
    watch.noteTimeout();
    watch.stop();
    for (let i = 0; i < TAKEOVER_MIN_TIMEOUTS; i++) watch.noteTimeout();
    vi.advanceTimersByTime(TAKEOVER_SILENCE_MS * 2);
    expect(probes).toBe(0);
    expect(fired).toEqual([]);
  });

  it('driven by a forwarder against a port that never answers: fires within ~silence + one probe', () => {
    let needLeader = 0;
    const forwarder = new FollowerForwarder(() => 'tab-1', undefined, () => { needLeader++; });
    let port = new FakePort();
    forwarder.setPort(port);
    watch.stop();
    watch = new LeaderSilenceWatch(
      (info) => fired.push(info),
      () => { probes++; forwarder.forwardTracked(new ArrayBuffer(4), () => {}); },
    );
    forwarder.observe(watch);

    const start = Date.now();
    // The app's one call — then nothing more from the app.
    let settled: ArrayBuffer | null = null;
    forwarder.forwardTracked(new ArrayBuffer(4), (b) => { settled = b; });
    vi.advanceTimersByTime(UNPROVEN_DEADLINE_MS + 1);
    expect(statusOf(settled!)).toBe(STATUS.EIO);
    expect(needLeader).toBe(1);
    // The page answers each need-leader with a new port — to the same silent leader.
    let answered = 0;
    let ports = 1;
    for (let t = 0; t <= TAKEOVER_SILENCE_MS + PROBE_INTERVAL_MS && !fired.length; t += 100) {
      if (needLeader > answered) {
        answered = needLeader;
        port = new FakePort();
        forwarder.setPort(port);
        ports++;
      }
      vi.advanceTimersByTime(100);
    }
    expect(fired.length).toBe(1);
    expect(fired[0].timeouts).toBeGreaterThanOrEqual(TAKEOVER_MIN_TIMEOUTS);
    expect(ports).toBeGreaterThanOrEqual(TAKEOVER_MIN_TIMEOUTS);   // across reconnect attempts
    // ~1s first deadline + the 15s window, give or take one probe interval.
    expect(Date.now() - start).toBeLessThanOrEqual(UNPROVEN_DEADLINE_MS + TAKEOVER_SILENCE_MS + PROBE_INTERVAL_MS + 100);
  });
});
