/**
 * Pure planning helper for mirroring a VFS rename to the OPFS sync worker.
 *
 * Extracted from sync-relay.worker.ts so the rename-mirroring decision can be
 * unit-tested in node without the worker's `self`/SAB/MessagePort environment.
 * The worker calls this and forwards the returned messages over `opfsSyncPort`.
 */

export type OpfsSyncMessage =
  | { op: 'write'; path: string; data: ArrayBuffer; ts: number }
  | { op: 'delete'; path: string; ts: number }
  | { op: 'rename'; path: string; newPath: string; ts: number };

export interface RenameMirrorPlan {
  messages: OpfsSyncMessage[];
  /**
   * Subset of `messages` (by reference) whose `data` buffer should be passed in
   * the postMessage transfer list — the non-empty write payload, transferred to
   * avoid a copy. Empty writes / delete / rename carry nothing transferable.
   */
  transfers: ArrayBuffer[];
}

interface ReadableEngine {
  read(path: string): { status: number; data: Uint8Array | null };
}

/**
 * Decide how to mirror a VFS rename(path → newPath) to the OPFS mirror.
 *
 * A regular-file rename is mirrored as write(newPath) + delete(path) using the
 * destination's authoritative bytes (read from the engine), so it is independent
 * of whether the source was ever mirrored — critical for the atomic-write
 * pattern (write temp; rename temp → final) where the temp is created and
 * renamed inside the sync debounce window and is therefore never mirrored.
 *
 * A directory rename (engine.read → EISDIR, i.e. any non-zero status) falls back
 * to a real 'rename' op, which the sync worker handles via renameDirInOPFS — the
 * source directory WAS mirrored, unlike a write-temp.
 */
export function planRenameMirror(
  engine: ReadableEngine,
  path: string,
  newPath: string,
  ts: number,
): RenameMirrorPlan {
  try {
    const r = engine.read(newPath);
    if (r.status === 0) {
      const messages: OpfsSyncMessage[] = [];
      const transfers: ArrayBuffer[] = [];
      if (r.data && r.data.byteLength > 0) {
        const buf = r.data.buffer.byteLength === r.data.byteLength
          ? r.data.buffer
          : r.data.slice().buffer;
        messages.push({ op: 'write', path: newPath, data: buf as ArrayBuffer, ts });
        transfers.push(buf as ArrayBuffer);
      } else {
        messages.push({ op: 'write', path: newPath, data: new ArrayBuffer(0), ts });
      }
      messages.push({ op: 'delete', path, ts });
      return { messages, transfers };
    }
  } catch {
    /* fall through to a rename op (e.g. directory rename) */
  }
  return { messages: [{ op: 'rename', path, newPath, ts }], transfers: [] };
}
