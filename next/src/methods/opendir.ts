import type { Dir, Dirent } from '../types.js';
import type { AsyncRequestFn } from './context.js';
import { OP } from '../protocol/opcodes.js';
import { statusToError } from '../errors.js';
import { readdir } from './readdir.js';

export async function opendir(
  asyncRequest: AsyncRequestFn,
  filePath: string
): Promise<Dir> {
  const { status, data } = await asyncRequest(OP.OPENDIR, filePath);
  if (status !== 0) throw statusToError(status, 'opendir', filePath);
  const fd = new DataView(data!.buffer, data!.byteOffset, data!.byteLength).getUint32(0, true);

  let entries: Dirent[] | null = null;
  let index = 0;

  const loadEntries = async () => {
    if (entries === null) {
      entries = await readdir(asyncRequest, filePath, { withFileTypes: true }) as Dirent[];
    }
  };

  return {
    path: filePath,

    async read(): Promise<Dirent | null> {
      await loadEntries();
      if (index >= entries!.length) return null;
      return entries![index++];
    },

    async close(): Promise<void> {
      const { status } = await asyncRequest(OP.CLOSE, '', 0, null, undefined, { fd });
      if (status !== 0) throw statusToError(status, 'close', String(fd));
    },

    async *[Symbol.asyncIterator](): AsyncIterableIterator<Dirent> {
      await loadEntries();
      for (const entry of entries!) {
        yield entry;
      }
    },
  };
}
