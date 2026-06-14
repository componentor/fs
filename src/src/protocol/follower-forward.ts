/**
 * Follower→leader request forwarding state machine.
 *
 * Extracted from sync-relay.worker.ts so the deadline/sequencing logic is
 * unit-testable outside a worker context.
 *
 * Reliability contract:
 *  - Every forwarded request carries a unique numeric sequence id; only the
 *    response echoing the CURRENT pending id resolves the in-flight promise.
 *    A late response from an abandoned request can never resolve a newer
 *    request with stale data — it is consumed and dropped.
 *  - Every request has a deadline. If the leader does not answer in time
 *    (frozen/throttled leader tab, response lost in a leader handoff, dead
 *    port), the request resolves with an EIO error response instead of
 *    hanging the caller forever. This closes the gap where the relay
 *    worker's own heartbeat keeps ticking (so the main thread's spin-wait
 *    stall detection never fires — it measures worker liveness, not request
 *    progress) while the request itself is permanently lost.
 *  - Deliberately NO automatic retry: a timed-out mutating op (WRITE,
 *    APPEND, ...) may have been applied by the leader even though the
 *    response was lost. Re-sending it could silently double-apply. EIO
 *    tells the caller "outcome unknown — retry at your level if safe".
 *  - On reconnection (new leader port), any in-flight request is aborted
 *    with EIO, matching the previous behavior but with a correctly-labeled
 *    status code.
 */

import { STATUS, encodeResponse } from './opcodes.js';

/** Default round-trip deadline for follower→leader requests. Generous: it
 *  only needs to beat "never", not race normal operations — sync ops finish
 *  in microseconds-to-milliseconds; 10s means a genuinely lost request. */
export const FORWARD_DEADLINE_MS = 10_000;

/** Minimal structural type so tests can use fake ports. */
export interface LeaderPortLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  close(): void;
  start?(): void;
  onmessage?: ((e: MessageEvent) => void) | null;
}

export class FollowerForwarder {
  private port: LeaderPortLike | null = null;
  private pendingResolve: ((buf: ArrayBuffer) => void) | null = null;
  /** Sequence id of the in-flight (or last abandoned) request. */
  private pendingSeq = 0;
  /** True when pendingSeq timed out and its late response should be swallowed. */
  private pendingAbandoned = false;
  private seqCounter = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly getTabId: () => string,
    private readonly deadlineMs: number = FORWARD_DEADLINE_MS,
  ) {}

  get hasPort(): boolean {
    return this.port !== null;
  }

  /** Attach a (new) leader port. Aborts any in-flight request with EIO. */
  setPort(port: LeaderPortLike): void {
    if (this.port && this.port !== port) {
      this.port.close();
      this.abortPending();
    }
    this.port = port;
  }

  /** Post a non-tracked message on the leader port (no-SAB async relay path). */
  postRaw(message: unknown, transfer?: Transferable[]): void {
    this.port?.postMessage(message, transfer);
  }

  /** Until this epoch-ms timestamp, the port is suspected dead-under-spin
   *  and fail-fast-eligible requests fail immediately. 0 = healthy. */
  private portSuspectUntil = 0;
  /** How long a deadline timeout keeps the port "suspect". */
  static readonly SUSPECT_WINDOW_MS = 30_000;

  /**
   * True while a recent forward timed out and nothing has been delivered
   * since. On WebKit this is the signature of the architectural follower
   * deadlock: a SYNC caller busy-spins the page's main thread, and WebKit
   * brokers this tab's MessagePort traffic through that same main thread —
   * the leader's response cannot arrive until the caller gives up.
   */
  get portSuspect(): boolean {
    return Date.now() < this.portSuspectUntil;
  }

  /**
   * Forward a request payload to the leader. Resolves with the response
   * buffer, or with an encoded EIO response after the deadline.
   *
   * `failFastEligible` marks requests whose caller is busy-spinning the
   * main thread (the sync SAB path). While the port is suspect — a recent
   * forward already timed out — such requests fail IMMEDIATELY with EIO
   * instead of freezing the tab for the full deadline again: on WebKit the
   * response provably cannot arrive while the caller spins. Async-path
   * requests (caller not spinning) always attempt, and any delivered
   * response clears the suspicion — so a recovered or healthy port heals
   * automatically.
   */
  forward(payload: Uint8Array, failFastEligible = false): Promise<ArrayBuffer> {
    if (failFastEligible && this.portSuspect) {
      return Promise.resolve(encodeResponse(STATUS.EIO));
    }

    // The follower loop is strictly serial, but guard anyway: a second
    // forward while one is pending aborts the first instead of leaking it.
    if (this.pendingResolve) this.abortPending();

    return new Promise<ArrayBuffer>(resolve => {
      const seq = ++this.seqCounter;
      this.pendingSeq = seq;
      this.pendingAbandoned = false;
      this.pendingResolve = resolve;

      const buf =
        payload.buffer.byteLength === payload.byteLength
          ? (payload.buffer as ArrayBuffer)
          : payload.slice().buffer;

      this.port!.postMessage({ id: seq, tabId: this.getTabId(), buffer: buf }, [buf]);

      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.pendingSeq === seq && this.pendingResolve) {
          const r = this.pendingResolve;
          this.pendingResolve = null;
          // Keep pendingSeq + mark abandoned so a late echo of this id is
          // recognized as ours and swallowed rather than leaking onward.
          this.pendingAbandoned = true;
          this.portSuspectUntil = Date.now() + FollowerForwarder.SUSPECT_WINDOW_MS;
          r(encodeResponse(STATUS.EIO));
        }
      }, this.deadlineMs);
    });
  }

  /**
   * Offer a response message to the forwarder.
   * Returns true if it was consumed (matched the in-flight request, or was
   * the late echo of an abandoned one); false if it belongs to another
   * consumer (the no-SAB async-relay path).
   */
  handleResponse(id: unknown, buffer: ArrayBuffer): boolean {
    // Any delivery proves the port works — clear the dead-under-spin
    // suspicion so sync requests resume attempting.
    this.portSuspectUntil = 0;
    if (id === this.pendingSeq) {
      if (this.pendingResolve) {
        this.clearTimer();
        const r = this.pendingResolve;
        this.pendingResolve = null;
        r(buffer);
        return true;
      }
      if (this.pendingAbandoned) {
        // Late response to a request we already failed with EIO — drop it.
        this.pendingAbandoned = false;
        return true;
      }
    }
    return false;
  }

  /** Abort the in-flight request (if any) with an EIO response. */
  abortPending(): void {
    this.clearTimer();
    if (this.pendingResolve) {
      const r = this.pendingResolve;
      this.pendingResolve = null;
      this.pendingAbandoned = false;
      r(encodeResponse(STATUS.EIO));
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
