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

/**
 * For a rename(oldDir → newDir), compute which pending debounced child syncs
 * must be re-keyed to the new location.
 *
 * Pending syncs are keyed by absolute path. `engine.rename` of a directory
 * moves every descendant to the new prefix in a single op, so a child sync
 * still keyed under `oldDir` would, when it flushes, `engine.read` a path that
 * no longer exists → silently drop the child's content from the OPFS mirror.
 * (The directory itself is mirrored via `renameDirInOPFS`, which only moves
 * files ALREADY in the mirror — a child written inside the debounce window
 * isn't mirrored yet, so without rerouting it is lost entirely.)
 *
 * Only STRICT descendants are returned: a file rename (no `oldDir/` children)
 * yields nothing, and the directory's own key is never scheduled (directories
 * are never debounced). Rerouting to the new path lets the child flush against
 * its real post-rename location, landing after the rename op in the mirror.
 */
export function planPendingReroutes(
  pendingKeys: Iterable<string>,
  oldDir: string,
  newDir: string,
): Array<{ from: string; to: string }> {
  const prefix = oldDir.endsWith('/') ? oldDir : oldDir + '/';
  const newPrefix = newDir.endsWith('/') ? newDir : newDir + '/';
  const out: Array<{ from: string; to: string }> = [];
  for (const key of pendingKeys) {
    if (key.startsWith(prefix)) {
      out.push({ from: key, to: newPrefix + key.slice(prefix.length) });
    }
  }
  return out;
}

/** Collapse `.`/`..`/`//` to an absolute path — matches VFSEngine.normalizePath. */
function normalizeAbs(p: string): string {
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length === 1) return p;
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { out.pop(); continue; }
    out.push(part);
  }
  return '/' + out.join('/');
}

/**
 * Resolve a symlink's raw target to the absolute VFS path it points at, so the
 * relay can key a symlink→target alias and re-mirror the link when that target
 * is later written. Mirrors the engine's normalization so the resolved key
 * equals the `path` the engine reports when the target is mutated.
 *
 * Absolute targets are normalized as-is; relative targets resolve against the
 * link's own directory (POSIX symlink semantics).
 */
export function resolveLinkTarget(linkPath: string, rawTarget: string): string {
  if (rawTarget.startsWith('/')) return normalizeAbs(rawTarget);
  const slash = linkPath.lastIndexOf('/');
  const dir = slash <= 0 ? '/' : linkPath.slice(0, slash);
  return normalizeAbs(dir + '/' + rawTarget);
}
