import type { Dir as DirType, Dirent, OpendirOptions } from '../types.js';
import type { AsyncRequestFn } from './context.js';
import { OP } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';
import { readdir } from './readdir.js';
import { Dir } from '../dir.js';

export async function opendir(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: OpendirOptions
): Promise<DirType> {
  const { status, data } = await asyncRequest(OP.OPENDIR, filePath);
  if (status !== 0) throw statusToError(status, 'opendir', filePath);
  const fd = new DataView(data!.buffer, data!.byteOffset, data!.byteLength).getUint32(0, true);

  // `recursive` was accepted by the type but ignored, so `opendir(p, { recursive: true })`
  // silently returned only the top level. `bufferSize` is a read-ahead hint in node and has no
  // analogue here — entries arrive in one response either way.
  const entries = await readdir(asyncRequest, filePath, {
    withFileTypes: true,
    recursive: options?.recursive,
  }) as Dirent[];

  return new Dir(filePath, entries, async () => {
    const { status: closeStatus } = await asyncRequest(OP.CLOSE, '', 0, null, undefined, { fd });
    if (closeStatus !== 0) throw statusToError(closeStatus, 'close', String(fd));
  });
}
