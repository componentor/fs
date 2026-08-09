import type { MkdirOptions, Mode } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { OP, encodeRequestU32 } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';
import { parseFileMode, encodeMode } from './mode.js';

const decoder = new TextDecoder();

/**
 * Node's `fs.mkdir` defaults `mode` to 0o777; the engine then subtracts its umask, exactly as
 * mkdir(2) does in the kernel. With the default umask of 0o022 that yields the historical 0o755,
 * so callers that pass no mode are unaffected by mode plumbing.
 */
const DEFAULT_MKDIR_MODE = 0o777;

/**
 * Normalise the second argument. Node accepts an options object, a numeric mode, *or* an octal
 * string mode — `fs.mkdirSync(p, '0700')` is valid and creates a 0700 directory.
 */
function resolveOptions(options?: MkdirOptions | Mode): { flags: number; mode: number } {
  if (typeof options === 'number' || typeof options === 'string') {
    return { flags: 0, mode: parseFileMode(options, 'mode') };
  }
  const mode = options?.mode;
  return {
    flags: options?.recursive ? 1 : 0,
    // Only an *absent* mode takes the default; `{ mode: null }` is a type error, as in Node.
    mode: mode === undefined ? DEFAULT_MKDIR_MODE : parseFileMode(mode, 'options.mode'),
  };
}

export function mkdirSync(
  syncRequest: SyncRequestFn,
  filePath: string,
  options?: MkdirOptions | Mode
): string | undefined {
  const { flags, mode } = resolveOptions(options);
  // Zero-allocation encode: the mode goes straight into the request buffer.
  const buf = encodeRequestU32(OP.MKDIR, filePath, flags, mode);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, 'mkdir', filePath);
  return data ? decoder.decode(data) : undefined;
}

export async function mkdir(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: MkdirOptions | Mode
): Promise<string | undefined> {
  const { flags, mode } = resolveOptions(options);
  // The async path posts the payload to a relay worker, so it needs a real Uint8Array. It must
  // also be a *fresh* one per call, not a shared scratch buffer: postMessage happens after an
  // await, so two concurrent mkdirs would otherwise structured-clone the same mutated bytes.
  const { status, data } = await asyncRequest(OP.MKDIR, filePath, flags, encodeMode(mode));
  if (status !== 0) throw statusToError(status, 'mkdir', filePath);
  return data ? decoder.decode(data) : undefined;
}
