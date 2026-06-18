/**
 * Fairness ticket lock for a shared control SAB.
 *
 * ## Why this exists
 *
 * The sync FS protocol uses ONE control SAB (one request/response slot) serviced
 * by ONE sync-relay worker against ONE OPFS sync access handle. When a single
 * client drives that SAB this is fine. But a host can deliberately share one SAB
 * across MANY sync clients — e.g. a browser dev container that runs several exec
 * Web Workers plus the main thread, all issuing sync FS ops to a single relay so
 * there is only ever one open OPFS handle. Those clients must take turns: if two
 * stage a request into the single slot at once, the relay reads a torn frame and
 * everyone downstream sees truncated/garbage data.
 *
 * A plain CAS spinlock (`compareExchange(lock, 0, 1)`) provides mutual exclusion
 * but is **unfair**: under contention one client can lose the race indefinitely
 * (starve). Hosts that "self-heal" a starved client by force-stealing the lock
 * after a timeout then create the exact double-holder corruption the lock was
 * meant to prevent — the timeout fires on a *live* holder simply because the
 * waiter was starved, not because anyone died.
 *
 * This is a **ticket (bakery) lock**: each client atomically draws a ticket and
 * is served in strict arrival order. No starvation, so the only reason a waiter
 * ever waits "too long" is a genuinely dead/wedged holder — which is recovered
 * conservatively (see below), not on mere contention.
 *
 * ## Protocol (two Int32 slots in the control header)
 *
 *   TICKET_NEXT     — next ticket to hand out; `Atomics.add(.,1)` draws one.
 *   TICKET_SERVING  — ticket currently permitted to touch the SAB.
 *
 * Both start at 0 (zeroed SAB). Acquire draws `t = fetch_add(NEXT)`, then waits
 * until `SERVING === t`. Release does `add(SERVING, 1)` + notify. Uncontended,
 * NEXT and SERVING march in lockstep and every acquire is satisfied immediately
 * — so the single-client case pays only a couple of atomics and never blocks
 * (in particular it never calls `Atomics.wait`, which is illegal on the browser
 * main thread).
 *
 * ## Liveness / recovery
 *
 * A holder runs exactly ONE sync op between acquire and release. A live holder
 * therefore always makes observable progress quickly: either SERVING advances
 * (it finished and released) or the protocol signal changes (it is mid multi-
 * chunk transfer, handing frames back and forth with the relay). The ONE state
 * that can legitimately sit frozen for a long stretch is a single slow op the
 * relay is servicing (e.g. a WebKit OPFS truncate that blocks the relay — and
 * thus its heartbeat — for up to ~20s). So: if neither SERVING nor the signal
 * changes for `HOLDER_STUCK_MS` (30s, matching the relay-heartbeat stall ceiling
 * the rest of the library already tolerates), the current holder — or the relay
 * itself — is wedged/dead. Exactly one waiter then advances SERVING past the
 * dead ticket via CAS so the queue drains. If it was the relay that died, the
 * recovered holder's own op surfaces that error through its normal spin-wait;
 * recovery here never throws and never leaks a ticket.
 *
 * 30s is far longer than any single live op, so a healthy holder is never
 * stolen from — the corruption mode of the old force-steal cannot occur.
 */

import { SAB_OFFSETS, SIGNAL } from './opcodes.js';

const NEXT_INDEX = SAB_OFFSETS.TICKET_NEXT >> 2; // Int32 idx 1 (byte 4)
const SERVING_INDEX = SAB_OFFSETS.TICKET_SERVING >> 2; // Int32 idx 2 (byte 8)
const SIGNAL_INDEX = SAB_OFFSETS.CONTROL >> 2; // Int32 idx 0 (byte 0)

// Workers can block on Atomics.wait; the browser main thread cannot (it throws),
// so it spins. Matches filesystem.ts's `_canAtomicsWait`.
const CAN_WAIT = typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined';

// How long a contended waiter parks/polls before re-checking holder progress.
// Short enough to react promptly, long enough not to busy-burn a core.
const WAIT_SLICE_MS = 50;

// A live holder always shows progress (SERVING advance or signal change) well
// inside this window; only a wedged/dead holder or a dead relay freezes the
// protocol for this long. Aligned with filesystem.ts SPIN_STALL_TIMEOUT_MS (it
// must clear WebKit's ~20s storage-IPC stall, during which a live op's relay —
// and its heartbeat — can be blocked but will still complete).
const HOLDER_STUCK_MS = 30_000;

function now(): number {
  return performance.now();
}

/**
 * Acquire the SAB. Returns the drawn ticket (pass it to nothing — release takes
 * no argument; the ticket is returned only for debugging/inspection). MUST be
 * paired with exactly one {@link releaseFsLock} in a `finally`.
 */
export function acquireFsLock(ctrl: Int32Array): number {
  const ticket = Atomics.add(ctrl, NEXT_INDEX, 1); // fetch-add: returns our place
  // Fast path: our turn already (the uncontended, overwhelmingly common case).
  if (Atomics.load(ctrl, SERVING_INDEX) === ticket) return ticket;
  waitForTurn(ctrl, ticket);
  return ticket;
}

/** Release the SAB, admitting the next ticket in line. */
export function releaseFsLock(ctrl: Int32Array): void {
  Atomics.add(ctrl, SERVING_INDEX, 1);
  Atomics.notify(ctrl, SERVING_INDEX);
}

function waitForTurn(ctrl: Int32Array, ticket: number): void {
  let serving = Atomics.load(ctrl, SERVING_INDEX);
  let sig = Atomics.load(ctrl, SIGNAL_INDEX);
  let progressAt = now();

  while (serving !== ticket) {
    if (CAN_WAIT) {
      // Park until SERVING changes or the slice elapses (then re-check liveness).
      Atomics.wait(ctrl, SERVING_INDEX, serving, WAIT_SLICE_MS);
    } else {
      // Main thread: cannot Atomics.wait — spin a short slice.
      const spinStart = now();
      while (now() - spinStart < WAIT_SLICE_MS && Atomics.load(ctrl, SERVING_INDEX) === serving) {
        /* busy-wait one slice */
      }
    }

    const curServing = Atomics.load(ctrl, SERVING_INDEX);
    const curSig = Atomics.load(ctrl, SIGNAL_INDEX);

    // Any forward progress — a holder released (SERVING moved) or the active
    // holder advanced the protocol (signal changed, e.g. between chunks) — means
    // nobody is wedged. Reset the death watchdog and continue.
    if (curServing !== serving || curSig !== sig) {
      serving = curServing;
      sig = curSig;
      progressAt = now();
      continue;
    }

    // Protocol frozen this whole window. If it stays frozen past HOLDER_STUCK_MS
    // the holder (or the relay) is dead/wedged — advance past the dead ticket
    // exactly once via CAS so the queue can drain. Never throws: if the relay is
    // the casualty, the recovered holder's own op will report it.
    if (now() - progressAt > HOLDER_STUCK_MS) {
      if (Atomics.compareExchange(ctrl, SERVING_INDEX, serving, serving + 1) === serving) {
        // We won the recovery: leave the protocol idle for the next holder so a
        // partial frame from the dead holder can't be mistaken for a response.
        Atomics.store(ctrl, SIGNAL_INDEX, SIGNAL.IDLE);
        Atomics.notify(ctrl, SERVING_INDEX);
      }
      serving = Atomics.load(ctrl, SERVING_INDEX);
      sig = Atomics.load(ctrl, SIGNAL_INDEX);
      progressAt = now();
    }
  }
}
