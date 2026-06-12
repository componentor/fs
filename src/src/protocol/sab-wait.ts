/**
 * Deadline-aware Atomics.wait primitives for SAB signal protocols.
 *
 * Plain `Atomics.wait(ctrl, 0, value)` with no timeout blocks a worker
 * forever if the counterpart dies mid-protocol (e.g. the sync-relay is
 * terminated between response chunks). Every blocking wait in the relay
 * protocol should go through these helpers so a dead counterpart degrades
 * into a recognizable timeout error instead of a permanently wedged worker.
 *
 * The deadline is intentionally generous (minutes, not seconds): it only
 * needs to beat "never". Legitimate operations — even multi-GB writes —
 * finish far inside it, so a SabWaitTimeoutError reliably means the
 * counterpart is gone, not slow.
 */

/** Overall deadline for one protocol exchange (request → full response). */
export const SAB_WAIT_DEADLINE_MS = 120_000;

/** Max single Atomics.wait slice, so the deadline is honored even if no
 *  notify ever arrives. */
const WAIT_SLICE_MS = 1000;

export class SabWaitTimeoutError extends Error {
  constructor(detail: string) {
    super(`SAB protocol wait timed out: ${detail}`);
    this.name = 'SabWaitTimeoutError';
  }
}

/**
 * Block while ctrl[0] === value (the counterpart is expected to move it).
 * Throws SabWaitTimeoutError once `deadlineAt` (epoch ms) passes.
 *
 * `sliceMs` bounds each individual Atomics.wait. Besides enforcing the
 * deadline, slicing makes a LOST WAKE recoverable: some engines (observed
 * in WebKit while the page's main thread busy-spins on a sync response)
 * can fail to deliver a cross-thread Atomics.notify, and an unbounded wait
 * would sleep forever even though the value has already changed. With a
 * slice, the loop re-reads the value at worst `sliceMs` later. Use a short
 * slice for latency-sensitive handshakes (chunk transfers), the default
 * for ordinary response waits.
 */
export function waitWhile(
  ctrl: Int32Array,
  value: number,
  deadlineAt: number,
  detail: string,
  sliceMs: number = WAIT_SLICE_MS
): void {
  while (Atomics.load(ctrl, 0) === value) {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new SabWaitTimeoutError(detail);
    Atomics.wait(ctrl, 0, value, Math.min(sliceMs, remaining));
  }
}

/**
 * Block until ctrl[0] is one of `accept`; returns that signal value.
 * Throws SabWaitTimeoutError once `deadlineAt` (epoch ms) passes.
 */
export function waitUntil(
  ctrl: Int32Array,
  accept: readonly number[],
  deadlineAt: number,
  detail: string
): number {
  for (;;) {
    const signal = Atomics.load(ctrl, 0);
    if (accept.includes(signal)) return signal;
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new SabWaitTimeoutError(detail);
    Atomics.wait(ctrl, 0, signal, Math.min(WAIT_SLICE_MS, remaining));
  }
}
