/**
 * Echo suppression for the OPFS mirror: telling the observer records our own mirror writes cause
 * from genuine external changes.
 *
 * Extracted from opfs-sync.worker.ts so it can be unit-tested in node; the worker owns one
 * instance and feeds it its queue events and writes. Paths must already be normalized.
 *
 * What it tracks:
 *
 *  - pending: paths with a mirror op queued or in flight. Anything observed on such a path is ours
 *    (or about to be overwritten by ours), whatever the op. No timeout — a long queue (a 500-file
 *    batch) must not produce false externals.
 *  - completed: when each path last had a mirror op finish. The grace window after it catches
 *    observer records delivered late or batched.
 *  - written: a content hash of the bytes we last wrote to a path, so an 'appeared'/'modified'
 *    record is an echo only if it carries exactly those bytes — a genuine external write inside the
 *    window is still forwarded.
 *  - removed / pendingRemovals: paths our own ops take away: a delete, the source of a rename, and
 *    the target a directory rename wipes. Only these can make a path disappear, so only these
 *    explain a 'disappeared' record — with the parent walk, because a recursive removeEntry
 *    reports every child. A path we merely wrote or created keeps its genuine external delete
 *    even inside the window; matching deletes by time alone used to drop it.
 */

export const ECHO_GRACE_MS = 3000;

export interface MirrorOp {
  op: 'write' | 'delete' | 'mkdir' | 'rename';
  path: string;
  newPath?: string;
}

/** Fast FNV-1a 32-bit content hash for echo detection (collision → at worst one suppressed real change, ~1/2^32). */
export function hashBytes(b: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) {
    h ^= b[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) ^ b.length; // fold length in so same-prefix different-length differ
}

/** The paths an op removes from OPFS: what its echo may report as 'disappeared'. */
function removedBy(event: MirrorOp): string[] {
  if (event.op === 'delete') return [event.path];
  // A rename is copy + delete of the source; a directory rename also wipes the target first.
  if (event.op === 'rename') return event.newPath ? [event.path, event.newPath] : [event.path];
  return [];
}

export class MirrorEchoTracker {
  private pending = new Set<string>();
  private pendingRemovals = new Set<string>();
  private completed = new Map<string, number>();
  private removed = new Map<string, number>();
  private written = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** A mirror op was queued. */
  enqueued(event: MirrorOp): void {
    this.pending.add(event.path);
    if (event.op === 'rename' && event.newPath) this.pending.add(event.newPath);
    for (const p of removedBy(event)) this.pendingRemovals.add(p);
  }

  /** A mirror op finished (or gave up): its grace window starts now. */
  finished(event: MirrorOp): void {
    const t = this.now();
    this.pending.delete(event.path);
    this.completed.set(event.path, t);
    if (event.op === 'rename' && event.newPath) {
      this.pending.delete(event.newPath);
      this.completed.set(event.newPath, t);
    }
    for (const p of removedBy(event)) {
      this.pendingRemovals.delete(p);
      this.removed.set(p, t);
    }
  }

  /** We wrote these bytes to `path`. */
  wrote(path: string, bytes: Uint8Array): void {
    this.written.set(path, hashBytes(bytes));
  }

  /** Did a mirror op on `path` finish within the grace window? */
  recentlyCompleted(path: string): boolean {
    const ts = this.completed.get(path);
    return ts !== undefined && this.now() - ts < ECHO_GRACE_MS;
  }

  /** Has a mirror op on `path` finished and not been swept yet (the window plus up to one sweep)? */
  wasCompleted(path: string): boolean {
    return this.completed.has(path);
  }

  /** Is an observed write to `path` carrying `bytes` our own echo? */
  isWriteEcho(path: string, bytes: Uint8Array): boolean {
    if (this.pending.has(path)) return true; // our write is still mid-flight
    if (!this.recentlyCompleted(path)) return false;
    return this.written.get(path) === hashBytes(bytes);
  }

  /** Is an observed 'disappeared' of `path` our own echo? */
  isDeleteEcho(path: string): boolean {
    // Any op still in flight on the path itself wins over the observed delete: applying the
    // delete would only be undone by that op when it lands.
    if (this.pending.has(path)) return true;
    const now = this.now();
    let p = path;
    while (true) {
      if (this.pendingRemovals.has(p)) return true;
      const ts = this.removed.get(p);
      if (ts !== undefined && now - ts < ECHO_GRACE_MS) return true;
      const slash = p.lastIndexOf('/');
      if (slash <= 0) return false;
      p = p.substring(0, slash);
    }
  }

  /**
   * Is an observed 'moved' (from → to) our own echo? We never move natively — a mirror rename is
   * copy + delete — so only an op in flight on either end, or one that removed the source,
   * explains it.
   */
  isMoveEcho(from: string, to: string): boolean {
    if (this.pending.has(to)) return true;
    return this.isDeleteEcho(from);
  }

  /** Drop entries past the grace window. */
  sweep(): void {
    const cutoff = this.now() - ECHO_GRACE_MS;
    for (const [p, ts] of this.completed) {
      if (ts < cutoff) { this.completed.delete(p); this.written.delete(p); }
    }
    for (const [p, ts] of this.removed) if (ts < cutoff) this.removed.delete(p);
  }
}
