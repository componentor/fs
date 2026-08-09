/**
 * Which OPFS-mirror action a completed request implies.
 *
 * The sync relay used to decide this inline, interleaved with its own copy of the request
 * decode switch. Keeping the two together is what made the relay's switch a second
 * implementation of [dispatch.ts](./dispatch.ts) — and every encode/decode bug found so far came
 * from a layout existing in more than one place. Splitting the mirror decision out lets the
 * relay use the shared dispatch for the engine call and this for the bookkeeping, with neither
 * duplicated.
 *
 * The rules are not uniform, which is why they are worth stating in one place:
 *
 *   • most mutations mirror the path they were given;
 *   • `RENAME` carries both paths; `COPY` and `LINK` mirror the *destination*, not the source;
 *   • fd operations mirror whatever path the fd resolves to;
 *   • `FCHMOD`/`FCHOWN`/`FUTIMES` are reported as their path-based equivalents, because the
 *     mirror speaks paths and has no fd table;
 *   • `MKDTEMP` mirrors the directory it invented, which is only known from the response;
 *   • `OPEN` mirrors as a WRITE, but only when it actually changed bytes — see {@link OpenPreState}.
 */

import { OP, decodeSecondPath } from './opcodes.js';
import type { VFSEngine } from '../vfs/engine.js';

/** What the mirror should be told about. `op` is a path-based opcode the mirror understands. */
export interface MirrorAction {
  op: number;
  path?: string;
  newPath?: string;
}

/**
 * State that must be sampled *before* an OPEN runs.
 *
 * `O_CREAT` on a path that already exists changes nothing, so mirroring it would re-read a
 * possibly large file for no reason — the existence check has to happen before the open creates
 * the file. `O_TRUNC` always changes bytes, so no pre-check is needed (and none is done: the
 * check is skipped entirely in that case, which also keeps append-mode opens cheap).
 */
export interface OpenPreState {
  willCreate: boolean;
  willTrunc: boolean;
  existedBefore: boolean;
}

/** Sample the pre-open state. Call immediately before dispatching an OPEN. */
export function sampleOpenPreState(engine: VFSEngine, flags: number, path: string): OpenPreState {
  const willCreate = (flags & 64) !== 0;  // O_CREAT
  const willTrunc = (flags & 512) !== 0;  // O_TRUNC
  // Only worth checking when O_CREAT could be a no-op; O_TRUNC always mirrors regardless.
  const existedBefore = willCreate && !willTrunc ? engine.exists(path).data?.[0] === 1 : false;
  return { willCreate, willTrunc, existedBefore };
}

const u32 = (d: Uint8Array, at: number) =>
  new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(at, true);

/**
 * Decide what to mirror after `dispatchOp` has run.
 *
 * Returns `null` when nothing should be mirrored — a read, a metadata query, or any failed
 * operation. Failures never mirror: telling the mirror to create a directory whose `mkdir` was
 * rejected leaves the two filesystems disagreeing.
 */
export function planMirror(
  engine: VFSEngine,
  op: number,
  path: string,
  data: Uint8Array | null,
  result: { status: number; data?: Uint8Array | null },
  openPre?: OpenPreState
): MirrorAction | null {
  if (result.status !== 0) return null;

  switch (op) {
    // Mutations that mirror the path they were handed.
    case OP.WRITE:
    case OP.APPEND:
    case OP.UNLINK:
    case OP.MKDIR:
    case OP.RMDIR:
    case OP.TRUNCATE:
    case OP.CHMOD:
    case OP.CHOWN:
    case OP.UTIMES:
    case OP.SYMLINK:
      return { op, path };

    case OP.RENAME:
      return { op, path, newPath: data ? decodeSecondPath(data) : '' };

    // COPY and LINK create something at the *destination*; the source is untouched.
    case OP.COPY:
    case OP.LINK:
      return { op, path: data ? decodeSecondPath(data) : '' };

    case OP.OPEN:
      // Mirror only when the open actually changed bytes: a truncating open always does, a
      // creating open only when the file was not already there. A plain read-open never does.
      if (openPre && (openPre.willTrunc || (openPre.willCreate && !openPre.existedBefore))) {
        return { op: OP.WRITE, path };
      }
      return null;

    case OP.MKDTEMP: {
      // The generated directory name only exists in the response.
      if (!(result.data instanceof Uint8Array)) return null;
      return { op, path: new TextDecoder().decode(result.data) };
    }

    // fd operations: resolve the fd to a path the mirror can act on. A fd whose path cannot be
    // resolved yields an action with no path, matching the relay's previous `?? undefined`.
    case OP.FWRITE:
    case OP.FTRUNCATE:
      return data && data.byteLength >= 4
        ? { op, path: engine.getPathForFd(u32(data, 0)) ?? undefined }
        : null;

    // Metadata-by-fd is reported to the mirror as its path-based equivalent.
    case OP.FCHMOD:
      return data && data.byteLength >= 4
        ? { op: OP.CHMOD, path: engine.getPathForFd(u32(data, 0)) ?? undefined }
        : null;
    case OP.FCHOWN:
      return data && data.byteLength >= 4
        ? { op: OP.CHOWN, path: engine.getPathForFd(u32(data, 0)) ?? undefined }
        : null;
    case OP.FUTIMES:
      return data && data.byteLength >= 4
        ? { op: OP.UTIMES, path: engine.getPathForFd(u32(data, 0)) ?? undefined }
        : null;

    // Reads and metadata queries change nothing.
    default:
      return null;
  }
}
