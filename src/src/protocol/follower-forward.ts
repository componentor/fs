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
 *
 * Both follower paths are covered by that contract:
 *  - the SAB path (`forward`) — one request at a time, from the relay's
 *    follower loop;
 *  - the no-SAB path (`forwardTracked`) — the promise API of a page without
 *    crossOriginIsolated, many requests in flight at once. It used to be
 *    posted raw and untracked, so a leader that never answered (a frozen or
 *    stale tab holding the lock) left `fs.promises.*` pending forever. It now
 *    carries the same deadlines, the same unproven-port fast deadline, the
 *    same `need-leader` request, and drops late responses the same way.
 *
 * And a leader that stays silent is not waited on forever either: every
 * timeout and every delivery is reported to a {@link LeaderSilenceWatch},
 * which probes the leader while it is silent and, once the silence has lasted
 * long enough to rule out a slow operation, asks the page to take the leader
 * lock over (`navigator.locks` `steal`). See {@link TAKEOVER_SILENCE_MS}.
 */

import { STATUS, encodeResponse } from './opcodes.js';

/** Default round-trip deadline for follower→leader requests. Generous: it
 *  only needs to beat "never", not race normal operations — sync ops finish
 *  in microseconds-to-milliseconds; 10s means a genuinely lost request. */
export const FORWARD_DEADLINE_MS = 10_000;

/**
 * Deadline for a port that has never answered.
 *
 * The generous deadline above assumes the port works and the request was merely lost. A port that
 * has not yet completed a single round trip carries no such evidence — and the case that produces
 * one is a leadership change, where the follower is handed a port to a leader that is still coming
 * up or already gone.
 *
 * That is where the 10s hurt most. A page-hosted follower blocks its main thread while waiting
 * (`Atomics.wait` is illegal there, so it spins), and the handshake that would reconnect it to the
 * live leader is delivered *to that same thread* — so the wait blocks the message that would fix
 * it, and nothing can arrive until the deadline expires. Measured across a leadership change:
 * `[VFS] Leader changed — reconnecting` landed at +10118ms, one millisecond after the deadline.
 *
 * Failing an unproven port quickly returns the thread to the event loop, the reconnect lands, and
 * the caller's next call goes to the real leader. The first call after a leadership change still
 * fails — the outcome is genuinely unknown, and EIO is the honest answer — but it costs a beat
 * instead of ten seconds, and the one after it succeeds.
 */
export const UNPROVEN_DEADLINE_MS = 1_000;

/**
 * How long the leader must have been silent before a follower takes the lock from it.
 *
 * Silence is counted from the first request that timed out, and ends with ANY message from a
 * leader port — a late answer to an abandoned request counts, because a leader that answers late
 * is slow, not gone. Longer than {@link FORWARD_DEADLINE_MS}, so a single slow operation on a
 * working port (which times out at 10s) cannot cause a takeover on its own; short enough that a
 * page stuck behind a frozen tab recovers in seconds rather than never.
 */
export const TAKEOVER_SILENCE_MS = 15_000;

/**
 * Timed-out requests the silence must include before a takeover, across reconnects.
 *
 * Time alone is not evidence: a follower that made one call 15s ago and nothing since has not
 * re-checked the leader in between. Three timeouts means the leader was asked at least three
 * times, on at least two ports when the first was unproven (each unproven timeout asks for a
 * fresh one), and answered none of them.
 */
export const TAKEOVER_MIN_TIMEOUTS = 3;

/**
 * While the leader is silent, the follower probes it this often with a read-only request.
 *
 * So the takeover rule does not depend on the app making calls: an app whose first call failed
 * with EIO may well never make a second one, and would otherwise stay broken. Probes stop at the
 * first message from a leader, so a healthy follower never sends one.
 */
export const PROBE_INTERVAL_MS = 2_500;

/** Abandoned tracked ids kept for late-response matching; bounded so a dead leader cannot grow it. */
const MAX_ABANDONED_TRACKED = 256;

/** Told about every timeout and every delivery; see {@link LeaderSilenceWatch}. */
export interface ForwardObserver {
  noteTimeout(): void;
  noteResponse(): void;
}

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
  /** Cleared whenever the port is replaced; set by the first response it delivers. */
  private portProven = false;
  /** In-flight no-SAB requests, by wire id (see {@link forwardTracked}). */
  private tracked = new Map<string, { settle: (buf: ArrayBuffer) => void; timer: ReturnType<typeof setTimeout> }>();
  /** Wire ids that timed out on the current port, so their late answers are dropped. */
  private abandonedTracked = new Set<string>();
  private trackedCounter = 0;
  /** When this port last asked for a fresh leader (0 = not yet). */
  private freshLeaderAskedAt = 0;
  private observer: ForwardObserver | null = null;

  constructor(
    private readonly getTabId: () => string,
    private readonly deadlineMs: number = FORWARD_DEADLINE_MS,
    /**
     * Called when an unproven port misses its deadline — the port is pointing at a leader that
     * never answered, so the follower needs a fresh one.
     *
     * `leader-changed` is broadcast exactly once, when a leader becomes ready. A follower that
     * arrives after that announcement never hears it, so it keeps a port to a leader that has
     * gone and has no way to learn better. Asking for a new connection on failure is what closes
     * that loop: the broker queues the request and the next leader flushes it.
     */
    private readonly onUnprovenTimeout?: () => void,
  ) {}

  get hasPort(): boolean {
    return this.port !== null;
  }

  /** Attach a (new) leader port. Aborts any in-flight request with EIO. */
  setPort(port: LeaderPortLike): void {
    if (this.port && this.port !== port) {
      this.port.close();
      this.abortPending();
      // The old port is closed, so nothing more can arrive on it: its in-flight
      // requests fail now, and its abandoned ids can be forgotten.
      this.abortTracked();
      this.abandonedTracked.clear();
    }
    this.port = port;
    // A new port has proved nothing yet, whatever the old one managed.
    this.portProven = false;
    this.freshLeaderAskedAt = 0;
  }

  /** Report every timeout and delivery to `observer` (the silent-leader watch). */
  observe(observer: ForwardObserver | null): void {
    this.observer = observer;
  }

  /** Number of no-SAB requests currently in flight. */
  get trackedInFlight(): number {
    return this.tracked.size;
  }

  /**
   * Forward a no-SAB promise-API request (many may be in flight at once).
   *
   * Same contract as {@link forward}: `settle` is called exactly once, with the leader's response
   * or, after the deadline (the short one for an unproven port), with an EIO response. No retry;
   * a late answer is dropped. The wire id is this forwarder's own (`t<n>`), so it can never
   * collide with the numeric ids of {@link forward} or with anything the caller uses.
   */
  forwardTracked(buffer: ArrayBuffer, settle: (buf: ArrayBuffer) => void): void {
    if (!this.port) {
      settle(encodeResponse(STATUS.EIO));
      return;
    }
    const id = `t${++this.trackedCounter}`;
    const deadline = this.portProven ? this.deadlineMs : UNPROVEN_DEADLINE_MS;
    const timer = setTimeout(() => {
      const entry = this.tracked.get(id);
      if (!entry) return;
      this.tracked.delete(id);
      this.abandonedTracked.add(id);
      if (this.abandonedTracked.size > MAX_ABANDONED_TRACKED) {
        // Oldest first (Set keeps insertion order). Its answer, if it ever comes, is then
        // unmatched — and an unmatched answer is dropped by the caller too.
        this.abandonedTracked.delete(this.abandonedTracked.values().next().value as string);
      }
      entry.settle(encodeResponse(STATUS.EIO));
      this.observer?.noteTimeout();
      if (!this.portProven) this.requestFreshLeader();
    }, deadline);
    // Registered before posting: a port may answer synchronously (tests do).
    this.tracked.set(id, { settle, timer });
    this.port.postMessage({ id, tabId: this.getTabId(), buffer }, [buffer]);
  }

  /** Fail every in-flight tracked request with EIO (reconnect, teardown). */
  abortTracked(): void {
    const entries = [...this.tracked.values()];
    this.tracked.clear();
    for (const entry of entries) {
      clearTimeout(entry.timer);
      entry.settle(encodeResponse(STATUS.EIO));
    }
  }

  /**
   * Ask for a fresh leader port, at most once per port per unproven deadline.
   *
   * The serial SAB path times out one request at a time, so this changes nothing there. The
   * no-SAB path can time out a whole burst at once, and each reconnect aborts what the previous
   * one started — so a burst asks once.
   */
  private requestFreshLeader(): void {
    const now = Date.now();
    if (this.freshLeaderAskedAt && now - this.freshLeaderAskedAt < UNPROVEN_DEADLINE_MS) return;
    this.freshLeaderAskedAt = now;
    this.onUnprovenTimeout?.();
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

      const deadline = this.portProven ? this.deadlineMs : UNPROVEN_DEADLINE_MS;
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.pendingSeq === seq && this.pendingResolve) {
          const r = this.pendingResolve;
          this.pendingResolve = null;
          // Keep pendingSeq + mark abandoned so a late echo of this id is
          // recognized as ours and swallowed rather than leaking onward.
          this.pendingAbandoned = true;
          const unproven = !this.portProven;
          // Suspicion is for a port that *was* working and stopped — the dead-under-spin case.
          // An unproven port has not failed that way; it has never been given the chance. Marking
          // it suspect sends every later call down the fail-fast path, which returns EIO without
          // attempting anything, so the port can never prove itself and the follower stays broken
          // for good. Reconnect instead, and let the fresh port try on its own merits.
          if (!unproven) {
            this.portSuspectUntil = Date.now() + FollowerForwarder.SUSPECT_WINDOW_MS;
          }
          r(encodeResponse(STATUS.EIO));
          this.observer?.noteTimeout();
          if (unproven) this.requestFreshLeader();
        }
      }, deadline);
    });
  }

  /**
   * Offer a response message to the forwarder.
   * Returns true if it was consumed (matched an in-flight request, or was
   * the late echo of an abandoned one); false if no request of this
   * forwarder's matches it — the caller drops it.
   */
  handleResponse(id: unknown, buffer: ArrayBuffer): boolean {
    // Any delivery proves the port works — clear the dead-under-spin
    // suspicion so sync requests resume attempting, and promote the port off
    // the short unproven deadline onto the generous one. It also proves the
    // leader is alive, late or not, which ends any silence being counted.
    this.portSuspectUntil = 0;
    this.portProven = true;
    this.observer?.noteResponse();
    if (typeof id === 'string') {
      const entry = this.tracked.get(id);
      if (entry) {
        clearTimeout(entry.timer);
        this.tracked.delete(id);
        entry.settle(buffer);
        return true;
      }
      // Late answer to a tracked request that already failed with EIO — drop it.
      return this.abandonedTracked.delete(id);
    }
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

export interface SilenceWatchOptions {
  silenceMs?: number;
  minTimeouts?: number;
  probeIntervalMs?: number;
}

/**
 * Decides when a follower's leader has been silent long enough to take the lock from it.
 *
 * Fires `onSilent` when BOTH hold: at least {@link TAKEOVER_MIN_TIMEOUTS} requests timed out with
 * no message from any leader port in between, and the first of them timed out at least
 * {@link TAKEOVER_SILENCE_MS} ago. Any delivery resets it. While silent it calls `probe` every
 * {@link PROBE_INTERVAL_MS}, so the evidence accumulates even when the app makes no calls.
 *
 * After firing it starts a fresh window rather than going quiet: the page may decline the takeover
 * (a new leader announced itself meanwhile), and if that leader is silent too, it gets its own
 * window and the follower asks again. The page keeps at most one takeover in flight.
 */
export class LeaderSilenceWatch implements ForwardObserver {
  private silentSince = 0;
  private timeouts = 0;
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private readonly silenceMs: number;
  private readonly minTimeouts: number;
  private readonly probeIntervalMs: number;

  constructor(
    private readonly onSilent: (info: { silentForMs: number; timeouts: number }) => void,
    private readonly probe: () => void,
    options: SilenceWatchOptions = {},
  ) {
    this.silenceMs = options.silenceMs ?? TAKEOVER_SILENCE_MS;
    this.minTimeouts = options.minTimeouts ?? TAKEOVER_MIN_TIMEOUTS;
    this.probeIntervalMs = options.probeIntervalMs ?? PROBE_INTERVAL_MS;
  }

  /** True while a timeout is outstanding and nothing has been heard since. */
  get silent(): boolean {
    return this.silentSince !== 0;
  }

  noteTimeout(): void {
    if (this.stopped) return;
    if (!this.silentSince) this.silentSince = Date.now();
    this.timeouts++;
    if (!this.probeTimer) {
      this.probeTimer = setInterval(() => {
        if (this.check()) return;
        this.probe();
      }, this.probeIntervalMs);
    }
    this.check();
  }

  noteResponse(): void {
    this.silentSince = 0;
    this.timeouts = 0;
    this.stopProbing();
  }

  /** Stop for good (the relay became leader, or is going away). */
  stop(): void {
    this.stopped = true;
    this.silentSince = 0;
    this.timeouts = 0;
    this.stopProbing();
  }

  /** Fire if the rule holds; returns true when it fired. */
  private check(): boolean {
    if (this.stopped || !this.silentSince) return false;
    const silentForMs = Date.now() - this.silentSince;
    if (this.timeouts < this.minTimeouts || silentForMs < this.silenceMs) return false;
    const timeouts = this.timeouts;
    // A fresh window, still probing — see the class note.
    this.silentSince = Date.now();
    this.timeouts = 0;
    this.onSilent({ silentForMs, timeouts });
    return true;
  }

  private stopProbing(): void {
    if (this.probeTimer !== null) {
      clearInterval(this.probeTimer);
      this.probeTimer = null;
    }
  }
}
