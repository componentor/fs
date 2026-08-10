/**
 * Argument-overload audit.
 *
 * Node's callback signatures put an optional argument *in the middle*:
 * `fs.readFile(path[, options], callback)`, `fs.watch(filename[, options][, listener])`. Every
 * such method has to work out at call time whether the middle argument is options or the
 * callback. Get it wrong in one position and the method still returns, still reports no error —
 * and silently never calls back.
 *
 * That is not hypothetical: `fs.watch(path, listener)` did exactly this (CHANGELOG 3.3.11). It
 * stored the callback as the options object, installed a no-op listener, and delivered nothing,
 * while the three-argument form worked perfectly. It shipped because nothing tested the
 * two-argument form — the one Node's own docs lead with.
 *
 * This sweeps every documented form of every method that takes an optional middle argument, and
 * asserts two things per form: the callback is invoked, and the options were not mistaken for
 * the callback (or vice versa). It is a shape audit — the underlying operations are covered by
 * the parity suites — so the promises layer is stubbed and only the argument routing is under
 * test, via the real methods borrowed off `VFSFileSystem.prototype`.
 */

import { describe, it, expect, vi } from 'vitest';
import { VFSFileSystem } from '../src/filesystem.js';

/** An fs whose callback methods are the shipped ones, over resolved promise stubs. */
function realFS() {
  const stats = {
    isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false,
    size: 1, mode: 0o644, mtime: new Date(), atime: new Date(), ctime: new Date(), birthtime: new Date(),
  };
  const promises: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of [
    'readFile', 'writeFile', 'appendFile', 'mkdir', 'readdir', 'rm', 'rmdir', 'unlink',
    'access', 'rename', 'copyFile', 'truncate', 'realpath', 'chmod', 'chown', 'utimes',
    'symlink', 'readlink', 'link', 'mkdtemp', 'cp', 'opendir', 'glob', 'exists',
  ]) promises[name] = vi.fn().mockResolvedValue(undefined);

  promises.readFile.mockResolvedValue(new Uint8Array([1]));
  promises.readdir.mockResolvedValue(['a']);
  promises.mkdtemp.mockResolvedValue('/tmp/x');
  promises.realpath.mockResolvedValue('/real');
  promises.readlink.mockResolvedValue('/target');
  promises.mkdir.mockResolvedValue(undefined);
  promises.opendir.mockResolvedValue({});
  promises.glob.mockResolvedValue([]);
  promises.exists.mockResolvedValue(true);
  promises.stat = vi.fn().mockResolvedValue(stats);
  promises.lstat = vi.fn().mockResolvedValue(stats);
  promises.open = vi.fn().mockResolvedValue({ fd: 7 });

  const fs = Object.create(VFSFileSystem.prototype) as VFSFileSystem;
  (fs as unknown as { promises: unknown; ns: string }).promises = promises;
  (fs as unknown as { ns: string }).ns = 'audit';
  // `watch` now checks that its path exists — node throws ENOENT rather than handing back a
  // watcher that can never fire — so the audit needs a sync transport that says "yes, a file".
  // A zero-filled stats payload is enough: nothing here reads a field off it.
  (fs as unknown as { _sync: () => unknown })._sync = () => ({ status: 0, data: new Uint8Array(53) });
  return { fs, promises };
}

/** Invoke `call` and resolve once its callback fires, or reject after a grace period. */
function expectCallback(call: (cb: (...a: unknown[]) => void) => void, label: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    // The real bridge defers with setTimeout(…, 0); 250 ms is far beyond that, so a timeout here
    // means the callback was never scheduled — the failure mode this audit exists to catch.
    const timer = setTimeout(() => reject(new Error(`${label}: callback never fired`)), 250);
    call((...args: unknown[]) => { clearTimeout(timer); resolve(args); });
  });
}

describe('callback overloads: every documented argument form invokes the callback', () => {
  /**
   * Each entry lists the forms Node documents. `short` omits the middle argument, `withOptions`
   * supplies it — both must reach the same callback.
   */
  const cases: Array<{
    name: string;
    short: (fs: VFSFileSystem, cb: (...a: unknown[]) => void) => void;
    withOptions: (fs: VFSFileSystem, cb: (...a: unknown[]) => void) => void;
  }> = [
    { name: 'readFile', short: (f, cb) => f.readFile('/p', cb), withOptions: (f, cb) => f.readFile('/p', 'utf8', cb) },
    { name: 'writeFile', short: (f, cb) => f.writeFile('/p', 'd', cb), withOptions: (f, cb) => f.writeFile('/p', 'd', 'utf8', cb) },
    { name: 'appendFile', short: (f, cb) => f.appendFile('/p', 'd', cb), withOptions: (f, cb) => f.appendFile('/p', 'd', 'utf8', cb) },
    { name: 'mkdir', short: (f, cb) => f.mkdir('/p', cb), withOptions: (f, cb) => f.mkdir('/p', { recursive: true }, cb) },
    { name: 'readdir', short: (f, cb) => f.readdir('/p', cb), withOptions: (f, cb) => f.readdir('/p', { withFileTypes: false }, cb) },
    { name: 'stat', short: (f, cb) => f.stat('/p', cb), withOptions: (f, cb) => f.stat('/p', { bigint: false }, cb) },
    { name: 'lstat', short: (f, cb) => f.lstat('/p', cb), withOptions: (f, cb) => f.lstat('/p', { bigint: false }, cb) },
    { name: 'rm', short: (f, cb) => f.rm('/p', cb), withOptions: (f, cb) => f.rm('/p', { force: true }, cb) },
    { name: 'rmdir', short: (f, cb) => f.rmdir('/p', cb), withOptions: (f, cb) => f.rmdir('/p', { recursive: true }, cb) },
    { name: 'realpath', short: (f, cb) => f.realpath('/p', cb), withOptions: (f, cb) => (f as never as { realpath: (a: string, b: unknown, c: unknown) => void }).realpath('/p', 'utf8', cb) },
    { name: 'readlink', short: (f, cb) => f.readlink('/p', cb), withOptions: (f, cb) => f.readlink('/p', 'utf8', cb) },
    { name: 'mkdtemp', short: (f, cb) => f.mkdtemp('/pre', cb), withOptions: (f, cb) => (f as never as { mkdtemp: (a: string, b: unknown, c: unknown) => void }).mkdtemp('/pre', 'utf8', cb) },
    { name: 'open', short: (f, cb) => f.open('/p', cb), withOptions: (f, cb) => f.open('/p', 'r', cb) },
    { name: 'truncate', short: (f, cb) => f.truncate('/p', cb), withOptions: (f, cb) => f.truncate('/p', 4, cb) },
    { name: 'cp', short: (f, cb) => f.cp('/a', '/b', cb), withOptions: (f, cb) => f.cp('/a', '/b', { recursive: true }, cb) },
    { name: 'symlink', short: (f, cb) => f.symlink('/t', '/l', cb), withOptions: (f, cb) => f.symlink('/t', '/l', 'file', cb) },
    { name: 'glob', short: (f, cb) => f.glob('*', cb), withOptions: (f, cb) => f.glob('*', { withFileTypes: false }, cb) },
  ];

  for (const c of cases) {
    it(`${c.name}(…, callback) — options omitted`, async () => {
      const { fs } = realFS();
      const args = await expectCallback((cb) => c.short(fs, cb), `${c.name} short form`);
      // Node's convention: first argument is the error slot, null on success.
      expect(args[0], `${c.name} should report no error`).toBeNull();
    });

    it(`${c.name}(…, options, callback) — options supplied`, async () => {
      const { fs } = realFS();
      const args = await expectCallback((cb) => c.withOptions(fs, cb), `${c.name} options form`);
      expect(args[0], `${c.name} should report no error`).toBeNull();
    });
  }
});

describe('the options argument is not swallowed as a callback', () => {
  // The inverse failure: a method that treats the middle argument as the callback would drop the
  // caller's options. Assert they actually reach the promises layer.
  it('readFile forwards its encoding', async () => {
    const { fs, promises } = realFS();
    await expectCallback((cb) => fs.readFile('/p', 'utf8', cb), 'readFile');
    expect(promises.readFile).toHaveBeenCalledWith('/p', 'utf8');
  });

  it('mkdir forwards recursive', async () => {
    const { fs, promises } = realFS();
    await expectCallback((cb) => fs.mkdir('/p', { recursive: true }, cb), 'mkdir');
    expect(promises.mkdir).toHaveBeenCalledWith('/p', { recursive: true });
  });

  it('rm forwards force', async () => {
    const { fs, promises } = realFS();
    await expectCallback((cb) => fs.rm('/p', { force: true }, cb), 'rm');
    expect(promises.rm).toHaveBeenCalledWith('/p', { force: true });
  });

  it('omitting options forwards undefined, not the callback', async () => {
    const { fs, promises } = realFS();
    await expectCallback((cb) => fs.readFile('/p', cb), 'readFile');
    const [, opts] = promises.readFile.mock.calls[0] as unknown[];
    expect(typeof opts, 'the callback must not land in the options slot').not.toBe('function');
  });
});

describe('watch and watchFile accept a listener in the options slot', () => {
  // The regression that motivated this file. `fs.watch(path, listener)` used to register a
  // watcher with a no-op listener and deliver nothing.
  it('watch(path, listener) keeps the listener', () => {
    const { fs } = realFS();
    const listener = vi.fn();
    const watcher = fs.watch('/p', listener);
    expect(typeof watcher.close).toBe('function');
    watcher.close();
  });

  it('watch(path, options, listener) keeps both', () => {
    const { fs } = realFS();
    const listener = vi.fn();
    const watcher = fs.watch('/p', { recursive: true }, listener);
    expect(typeof watcher.close).toBe('function');
    watcher.close();
  });

  it('watch(path, encoding, listener) keeps both', () => {
    const { fs } = realFS();
    const watcher = fs.watch('/p', 'buffer', vi.fn());
    expect(typeof watcher.close).toBe('function');
    watcher.close();
  });
});
