/**
 * Minimal OPFS mock — enough of `navigator.storage.getDirectory()` to drive the repair
 * worker in-process.
 *
 * The worker touches a small, fixed slice of the API: get a directory, get/create a file,
 * remove an entry, read a file whole (`getFile().arrayBuffer()`), and open a sync access
 * handle over it. Files are backed by {@link MockSyncHandle}, so bytes persist across
 * open/close exactly as they do in OPFS — which is the property the worker depends on
 * when it builds `.vfs.bin.tmp`, closes it, re-mounts it to verify, and copies it over
 * `.vfs.bin`.
 *
 * Not modelled: the real API's rule that only one sync access handle may be open on a
 * file at a time. The worker never opens two on one file, so there is nothing to enforce.
 */

import { MockSyncHandle } from './mock-handle.js';

function notFound(name: string): Error {
  const err = new Error(`A requested file or directory could not be found: ${name}`);
  err.name = 'NotFoundError';
  return err;
}

function mismatch(name: string, wanted: string): Error {
  const err = new Error(`The path supplied exists, but was not an entry of the requested type: ${name} (wanted ${wanted})`);
  err.name = 'TypeMismatchError';
  return err;
}

/** Everything the handle currently holds, through its public surface. */
export function snapshot(handle: MockSyncHandle): Uint8Array {
  const out = new Uint8Array(handle.getSize());
  if (out.byteLength > 0) handle.read(out, { at: 0 });
  return out;
}

export class MockFileHandle {
  readonly kind = 'file' as const;
  /** The one backing store — every access handle opened on this file is this object. */
  readonly handle = new MockSyncHandle(0);

  constructor(readonly name: string) {}

  async createSyncAccessHandle(): Promise<MockSyncHandle> {
    return this.handle;
  }

  async getFile(): Promise<{ size: number; arrayBuffer: () => Promise<ArrayBuffer> }> {
    const bytes = snapshot(this.handle);
    return { size: bytes.byteLength, arrayBuffer: async () => bytes.buffer as ArrayBuffer };
  }

  /** Replace the file's whole contents — used to plant a volume for the worker to find. */
  setBytes(bytes: Uint8Array): void {
    this.handle.truncate(0);
    this.handle.truncate(bytes.byteLength);
    if (bytes.byteLength > 0) this.handle.write(bytes, { at: 0 });
  }
}

export class MockDirectoryHandle {
  readonly kind = 'directory' as const;
  readonly children = new Map<string, MockFileHandle | MockDirectoryHandle>();

  constructor(readonly name: string) {}

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<MockFileHandle> {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== 'file') throw mismatch(name, 'file');
      return existing;
    }
    if (!opts?.create) throw notFound(name);
    const file = new MockFileHandle(name);
    this.children.set(name, file);
    return file;
  }

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MockDirectoryHandle> {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== 'directory') throw mismatch(name, 'directory');
      return existing;
    }
    if (!opts?.create) throw notFound(name);
    const dir = new MockDirectoryHandle(name);
    this.children.set(name, dir);
    return dir;
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.children.delete(name)) throw notFound(name);
  }

  async *entries(): AsyncGenerator<[string, MockFileHandle | MockDirectoryHandle]> {
    for (const entry of [...this.children]) yield entry;
  }
}

/**
 * Point `navigator.storage.getDirectory()` at a fresh in-memory tree.
 * Returns the root and a `restore` that puts the previous `navigator` back.
 */
export function installMockOPFS(): { root: MockDirectoryHandle; restore: () => void } {
  const root = new MockDirectoryHandle('');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  Object.defineProperty(globalThis, 'navigator', {
    value: { storage: { getDirectory: async () => root } },
    configurable: true,
    writable: true,
  });

  return {
    root,
    restore: () => {
      if (previous) Object.defineProperty(globalThis, 'navigator', previous);
      else delete (globalThis as any).navigator;
    },
  };
}
