/**
 * The single decoder for engine-bound requests.
 *
 * Every payload layout the method layer writes is read back exactly once, here. That matters:
 * this dispatch previously existed as two hand-maintained copies (the server worker's and the
 * sync relay's), and they drifted — the server worker decoded `TRUNCATE`/`FTRUNCATE` lengths as
 * uint32 where the method layer writes float64. The low four bytes of a small float64 are all
 * zero, so every non-zero truncate silently emptied the file instead of shortening it. One
 * decoder cannot disagree with itself.
 *
 * The layouts themselves, and the decoders for them, live in [payloads.ts](./payloads.ts) beside
 * the encoders that produce them. For reference:
 *   TRUNCATE   [len: f64]
 *   CHMOD      [mode: u32]
 *   CHOWN      [uid: u32][gid: u32]
 *   UTIMES     [atime: f64][mtime: f64]
 *   MKDIR      [mode: u32]                     (absent on pre-3.3.2 clients → 0o777)
 *   OPEN       [mode: u32]                     (absent on pre-3.3.3 clients → 0o666)
 *   CLOSE      [fd: u32]
 *   FREAD      [fd: u32][len: u32][pos: f64]
 *   FWRITE     [fd: u32][pos: f64][bytes…]
 *   FSTAT      [fd: u32]
 *   FTRUNCATE  [fd: u32][len: f64]
 *   FCHMOD     [fd: u32][mode: u32]
 *   FCHOWN     [fd: u32][uid: u32][gid: u32]
 *   FUTIMES    [fd: u32][pad: u32][atime: f64][mtime: f64]
 *   RENAME/COPY/LINK  [path2Len: u32][path2 bytes…]  (see decodeSecondPath)
 */

import type { VFSEngine } from '../vfs/engine.js';
import { decodeSecondPath, OP } from './opcodes.js';
import { CODE_TO_STATUS } from '../errors.js';
import {
  decodeModeArg, decodeTruncateArgs, decodeChownArgs, decodeTimesArgs, decodeFdArg,
  decodeFreadArgs, decodeFwriteArgs, decodeFtruncateArgs, decodeFchmodArgs,
  decodeFchownArgs, decodeFutimesArgs,
} from './payloads.js';

export interface EngineResult {
  status: number;
  data?: Uint8Array | null;
}

/** Node's default `mkdir` mode, before the engine subtracts the umask. */
export const DEFAULT_MKDIR_MODE = 0o777;
/** Node's default `open` mode, before the engine subtracts the umask. */
export const DEFAULT_OPEN_MODE = 0o666;

const EINVAL = CODE_TO_STATUS.EINVAL;

/**
 * Read a mode from a request payload, or `fallback` when the client sent none.
 *
 * The wire format is additive: a bundle built before mkdir/open carried a mode sends no payload
 * at all, and must keep behaving exactly as it did rather than creating 0000 entries.
 */
export function decodeMode(data: Uint8Array | null | undefined, fallback: number): number {
  return decodeModeArg(data ?? null) ?? fallback;
}

/**
 * Decode one request and run it against `engine`.
 *
 * Pure with respect to everything but the engine: callers layer their own concerns (OPFS
 * mirroring, watch events, leader bookkeeping) on top of the returned result.
 */
export function dispatchOp(
  engine: VFSEngine,
  tabId: string,
  op: number,
  flags: number,
  path: string,
  data: Uint8Array | null
): EngineResult {
  switch (op) {
    case OP.READ: return engine.read(path);
    case OP.WRITE: return engine.write(path, data ?? new Uint8Array(0), flags);
    case OP.APPEND: return engine.append(path, data ?? new Uint8Array(0));
    case OP.UNLINK: return engine.unlink(path);
    case OP.STAT: return engine.stat(path);
    case OP.LSTAT: return engine.lstat(path);
    case OP.MKDIR: return engine.mkdir(path, flags, decodeMode(data, DEFAULT_MKDIR_MODE));
    case OP.RMDIR: return engine.rmdir(path, flags);
    case OP.READDIR: return engine.readdir(path, flags);
    case OP.RENAME: return engine.rename(path, data ? decodeSecondPath(data) : '');
    case OP.EXISTS: return engine.exists(path);
    case OP.COPY: return engine.copy(path, data ? decodeSecondPath(data) : '', flags);
    case OP.ACCESS: return engine.access(path, flags);
    case OP.REALPATH: return engine.realpath(path);
    case OP.READLINK: return engine.readlink(path);
    case OP.LINK: return engine.link(path, data ? decodeSecondPath(data) : '');
    case OP.OPENDIR: return engine.opendir(path, tabId);
    case OP.MKDTEMP: return engine.mkdtemp(path);
    case OP.FSYNC: return engine.fsync();
    case OP.STATFS: return engine.statfs(path);

    case OP.TRUNCATE: {
      const len = decodeTruncateArgs(data);
      return len === null ? { status: EINVAL } : engine.truncate(path, len);
    }

    case OP.CHMOD: {
      const mode = decodeModeArg(data);
      return mode === null ? { status: EINVAL } : engine.chmod(path, mode);
    }

    case OP.CHOWN: {
      const a = decodeChownArgs(data);
      return a === null ? { status: EINVAL } : engine.chown(path, a.uid, a.gid);
    }

    case OP.UTIMES: {
      const a = decodeTimesArgs(data);
      return a === null ? { status: EINVAL } : engine.utimes(path, a.atime, a.mtime);
    }

    case OP.SYMLINK:
      return engine.symlink(data ? new TextDecoder().decode(data) : '', path);

    case OP.OPEN:
      return engine.open(path, flags, tabId, decodeMode(data, DEFAULT_OPEN_MODE));

    case OP.CLOSE: {
      const fd = decodeFdArg(data);
      return fd === null ? { status: EINVAL } : engine.close(fd);
    }

    case OP.FREAD: {
      const a = decodeFreadArgs(data);
      return a === null ? { status: EINVAL } : engine.fread(a.fd, a.length, a.position);
    }

    case OP.FWRITE: {
      const a = decodeFwriteArgs(data);
      return a === null ? { status: EINVAL } : engine.fwrite(a.fd, a.bytes, a.position);
    }

    case OP.FSTAT: {
      const fd = decodeFdArg(data);
      return fd === null ? { status: EINVAL } : engine.fstat(fd);
    }

    case OP.FTRUNCATE: {
      const a = decodeFtruncateArgs(data);
      return a === null ? { status: EINVAL } : engine.ftruncate(a.fd, a.len);
    }

    case OP.FCHMOD: {
      const a = decodeFchmodArgs(data);
      return a === null ? { status: EINVAL } : engine.fchmod(a.fd, a.mode);
    }

    case OP.FCHOWN: {
      const a = decodeFchownArgs(data);
      return a === null ? { status: EINVAL } : engine.fchown(a.fd, a.uid, a.gid);
    }

    case OP.FUTIMES: {
      const a = decodeFutimesArgs(data);
      return a === null ? { status: EINVAL } : engine.futimes(a.fd, a.atime, a.mtime);
    }

    default:
      return { status: EINVAL };
  }
}

/** Every opcode `dispatchOp` handles — used by tests to catch an op added without a decoder. */
export const DISPATCHED_OPS: ReadonlySet<number> = new Set([
  OP.READ, OP.WRITE, OP.APPEND, OP.UNLINK, OP.STAT, OP.LSTAT, OP.MKDIR, OP.RMDIR,
  OP.READDIR, OP.RENAME, OP.EXISTS, OP.TRUNCATE, OP.COPY, OP.ACCESS, OP.REALPATH,
  OP.CHMOD, OP.CHOWN, OP.UTIMES, OP.SYMLINK, OP.READLINK, OP.LINK, OP.OPEN, OP.CLOSE,
  OP.FREAD, OP.FWRITE, OP.FSTAT, OP.FTRUNCATE, OP.FSYNC, OP.OPENDIR, OP.MKDTEMP,
  OP.FCHMOD, OP.FCHOWN, OP.FUTIMES, OP.STATFS,
]);
