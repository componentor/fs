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
import { FollowerForwarder, FORWARD_DEADLINE_MS, type LeaderPortLike } from '../src/protocol/follower-forward.js';
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

  it('postRaw passes messages through untracked', () => {
    forwarder.postRaw({ id: 'a3', buffer: new ArrayBuffer(4) });
    expect(port.posted.length).toBe(1);
    expect(port.posted[0].message.id).toBe('a3');
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

  it('a deadline timeout marks the port suspect; fail-fast requests then fail instantly', async () => {
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
