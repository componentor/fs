/**
 * `Dir` — the handle returned by `opendir`/`opendirSync`.
 *
 * Previously two separate object literals (one in `methods/opendir.ts`, one inline in
 * `opendirSync`) that between them were missing `readSync()` and `closeSync()`, half of node's
 * `Dir` API. A single class serves both, so the two forms cannot drift apart again.
 *
 * Entries are read eagerly at open. Node's `opendir` opens a real directory handle and streams
 * entries from it; here the entries come from one `readdir`, and reading them up front is what
 * makes the **synchronous** `readSync()` possible on a handle obtained asynchronously. The cost
 * is one extra round trip at open for a caller that opens a directory and never reads it, and
 * one fewer await for every caller that does.
 */

import type { Dirent } from './types.js';

export class Dir {
  readonly path: string;
  private _entries: Dirent[];
  private _index = 0;
  private _closed = false;
  private _onClose: (() => Promise<void>) | null;

  constructor(path: string, entries: Dirent[], onClose: (() => Promise<void>) | null = null) {
    this.path = path;
    this._entries = entries;
    this._onClose = onClose;
  }

  private _assertOpen(): void {
    // node reports a use-after-close as ERR_DIR_CLOSED rather than letting it read stale state.
    if (this._closed) {
      const err = new Error('Directory handle was closed') as Error & { code: string };
      err.code = 'ERR_DIR_CLOSED';
      throw err;
    }
  }

  /** The next entry, or `null` once the directory is exhausted. */
  async read(): Promise<Dirent | null> {
    this._assertOpen();
    return this._index >= this._entries.length ? null : this._entries[this._index++];
  }

  /** The synchronous form. Was missing entirely. */
  readSync(): Dirent | null {
    this._assertOpen();
    return this._index >= this._entries.length ? null : this._entries[this._index++];
  }

  /**
   * Closing an already-closed handle is `ERR_DIR_CLOSED`, not a no-op.
   *
   * Verified against `node:fs` in every form that reaches it: a second `close()`, a `close()`
   * after `for await` (which closes the handle itself), after an early `break`, and after
   * `Symbol.asyncDispose`. Returning silently here hid the misuse — and hid it *differently*
   * from node, so a `finally { await dir.close() }` that throws in node passed quietly here.
   */
  async close(): Promise<void> {
    this._assertOpen();
    this._closed = true;
    if (this._onClose) await this._onClose();
  }

  /** The synchronous form. Was missing entirely. */
  closeSync(): void {
    // The descriptor is released asynchronously; marking the handle closed is what callers
    // observe, and a pending release cannot fail in a way they could act on.
    this._assertOpen();
    this._closed = true;
    if (this._onClose) void this._onClose().catch(() => { /* handle is already gone */ });
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<Dirent> {
    try {
      for (let entry = await this.read(); entry !== null; entry = await this.read()) {
        yield entry;
      }
    } finally {
      // node closes the handle when iteration ends, including on an early `break`. Guarded
      // because the loop body may have closed it already, and `close()` now throws on a
      // closed handle — the iterator's own cleanup is not the caller's misuse.
      if (!this._closed) await this.close();
    }
  }
}
