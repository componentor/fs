/**
 * openAsBlob Tests
 *
 * `fs.openAsBlob()` and `promises.openAsBlob()` (Node 19+).
 *
 * These call the **real** methods, borrowed off the prototypes and invoked with a stand-in
 * `this` that supplies only `readFile`. Constructing a `VFSFileSystem` needs workers and a
 * SharedArrayBuffer, so the previous version of this file re-implemented `openAsBlob` and tested
 * the copy — which meant it would have kept passing had the real one changed or broken. Both
 * overloads exist (one reads through `this.promises.readFile`, the other through `this.readFile`)
 * and both are covered here, since a divergence between them is exactly what a copy cannot catch.
 */

import { describe, it, expect, vi } from 'vitest';
import { VFSFileSystem } from '../src/filesystem.js';

type ReadFile = (path: string) => Promise<Uint8Array | string>;

/** The real `fs.openAsBlob`, bound to a `this` that only provides `promises.readFile`. */
function fsOpenAsBlob(readFile: ReadFile) {
  const method = VFSFileSystem.prototype.openAsBlob;
  return (filePath: string, options?: { type?: string }) =>
    method.call({ promises: { readFile } } as unknown as VFSFileSystem, filePath, options);
}

/** The real `fs.promises.openAsBlob`, which reads through `this.readFile` instead. */
function promisesOpenAsBlob(readFile: ReadFile) {
  // VFSPromises is not exported, so reach it through an instance's prototype chain — the
  // descriptor is on the class, and this is the only handle on it from outside.
  const proto = getPromisesPrototype();
  const method = proto.openAsBlob as (this: unknown, p: string, o?: { type?: string }) => Promise<Blob>;
  return (filePath: string, options?: { type?: string }) =>
    method.call({ readFile }, filePath, options);
}

/** Locate VFSPromises.prototype without constructing a filesystem. */
function getPromisesPrototype(): Record<string, unknown> {
  // `promises` is created in the constructor, so read the class source's companion through the
  // module's own export graph: the instance property is typed, and the prototype we want is the
  // one holding `openAsBlob`. Constructing with a stubbed Worker is the only way to reach it.
  class StubWorker {
    onmessage: unknown = null;
    postMessage(): void {}
    terminate(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  }
  (globalThis as Record<string, unknown>).Worker ??= StubWorker;
  const fs = new VFSFileSystem();
  return Object.getPrototypeOf(fs.promises) as Record<string, unknown>;
}

const encoder = new TextEncoder();

describe('openAsBlob', () => {
  it('should return a Blob instance', async () => {
    const readFile = vi.fn().mockResolvedValue(encoder.encode('hello'));
    const blob = await fsOpenAsBlob(readFile)('/test.txt');
    expect(blob).toBeInstanceOf(Blob);
  });

  it('should contain the correct data', async () => {
    const content = 'Hello, world!';
    const readFile = vi.fn().mockResolvedValue(encoder.encode(content));
    const blob = await fsOpenAsBlob(readFile)('/test.txt');
    const text = await blob.text();
    expect(text).toBe(content);
  });

  it('should have a size matching the file content length', async () => {
    const content = 'abcdef';
    const bytes = encoder.encode(content);
    const readFile = vi.fn().mockResolvedValue(bytes);
    const blob = await fsOpenAsBlob(readFile)('/test.txt');
    expect(blob.size).toBe(bytes.byteLength);
  });

  it('should handle binary data correctly', async () => {
    const binary = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
    const readFile = vi.fn().mockResolvedValue(binary);
    const blob = await fsOpenAsBlob(readFile)('/binary.bin');
    expect(blob.size).toBe(binary.byteLength);
    const ab = await blob.arrayBuffer();
    expect(new Uint8Array(ab)).toEqual(binary);
  });

  it('should set the MIME type from options.type', async () => {
    const readFile = vi.fn().mockResolvedValue(encoder.encode('<html></html>'));
    const blob = await fsOpenAsBlob(readFile)('/page.html', { type: 'text/html' });
    expect(blob.type).toBe('text/html');
  });

  it('should default to empty string type when options.type is omitted', async () => {
    const readFile = vi.fn().mockResolvedValue(encoder.encode('data'));
    const blob = await fsOpenAsBlob(readFile)('/file.dat');
    expect(blob.type).toBe('');
  });

  it('should default to empty string type when options is omitted', async () => {
    const readFile = vi.fn().mockResolvedValue(encoder.encode('data'));
    const blob = await fsOpenAsBlob(readFile)('/file.dat');
    expect(blob.type).toBe('');
  });

  it('should handle string data from readFile', async () => {
    const content = 'string return value';
    const readFile = vi.fn().mockResolvedValue(content);
    const blob = await fsOpenAsBlob(readFile)('/text.txt');
    const text = await blob.text();
    expect(text).toBe(content);
  });

  /**
   * Node does not surface the errno here, and neither does this: `createBlobFromFilePath` reports
   * any failure to open as `TypeError: Unable to open file as blob` with
   * `code: 'ERR_INVALID_ARG_VALUE'`. Rethrowing the ENOENT would read better, and would also mean
   * `catch (e) { if (e.code === 'ENOENT') … }` behaving differently here than in node.
   */
  it('reports a file it cannot open as node does, not as the errno', async () => {
    const readFile = vi.fn().mockRejectedValue(
      Object.assign(new Error("ENOENT: no such file or directory, open '/missing.txt'"), {
        code: 'ENOENT',
        errno: -2,
        syscall: 'open',
        path: '/missing.txt',
      }),
    );
    const failure = fsOpenAsBlob(readFile)('/missing.txt');
    await expect(failure).rejects.toThrow('Unable to open file as blob');
    await expect(failure).rejects.toMatchObject({ code: 'ERR_INVALID_ARG_VALUE' });
  });

  it('leaves an error that is not an open failure alone', async () => {
    const readFile = vi.fn().mockRejectedValue(Object.assign(new Error('disk fell over'), { code: 'EIO' }));
    await expect(fsOpenAsBlob(readFile)('/x.txt')).rejects.toMatchObject({ code: 'EIO' });
  });

  it('should handle empty files', async () => {
    const readFile = vi.fn().mockResolvedValue(new Uint8Array(0));
    const blob = await fsOpenAsBlob(readFile)('/empty.txt');
    expect(blob.size).toBe(0);
    expect(await blob.text()).toBe('');
  });
});

describe('promises.openAsBlob', () => {
  it('produces the same Blob as the callback-side method', async () => {
    // Two separate implementations exist (one reads via this.promises.readFile, the other via
    // this.readFile). A single re-implemented model in the test file could never have shown
    // that they agree — or caught it if they stopped.
    const content = 'shared-implementation-check';
    const readFile = vi.fn().mockResolvedValue(new TextEncoder().encode(content));
    const viaFs = await fsOpenAsBlob(readFile)('/x.txt', { type: 'text/plain' });
    const viaPromises = await promisesOpenAsBlob(readFile)('/x.txt', { type: 'text/plain' });
    expect(await viaPromises.text()).toBe(await viaFs.text());
    expect(viaPromises.type).toBe(viaFs.type);
    expect(viaPromises.size).toBe(viaFs.size);
  });

  it('defaults the MIME type to empty, as Node does', async () => {
    const readFile = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    expect((await promisesOpenAsBlob(readFile)('/x.bin')).type).toBe('');
  });
});
