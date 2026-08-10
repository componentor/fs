/**
 * mkdir return value tests
 *
 * Verifies that mkdirSync/mkdir return the correct values per Node.js spec:
 * - recursive: true returns the first directory that was created, or undefined if all existed
 * - recursive: false (or omitted) returns undefined on success
 *
 * Tests both the method layer (with mocks) and the VFS engine directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, mkdir } from '../src/methods/mkdir.js';
import { OP } from '../src/protocol/opcodes.js';
import { VFSEngine } from '../src/vfs/engine.js';

const encoder = new TextEncoder();

// ---- Method-level tests (mocked transport) ----

describe('mkdir return values (method layer)', () => {
  it('mkdirSync recursive returns first created path from data', () => {
    const syncRequest = vi.fn().mockReturnValue({
      status: 0,
      data: encoder.encode('/a'),
    });

    const result = mkdirSync(syncRequest, '/a/b/c', { recursive: true });
    expect(result).toBe('/a');
  });

  it('mkdirSync recursive returns undefined when all dirs existed', () => {
    const syncRequest = vi.fn().mockReturnValue({
      status: 0,
      data: null,
    });

    const result = mkdirSync(syncRequest, '/existing', { recursive: true });
    expect(result).toBeUndefined();
  });

  it('mkdirSync without recursive returns undefined on success', () => {
    const syncRequest = vi.fn().mockReturnValue({
      status: 0,
      data: null,
    });

    const result = mkdirSync(syncRequest, '/newdir');
    expect(result).toBeUndefined();
  });

  it('async mkdir recursive returns first created path', async () => {
    const asyncRequest = vi.fn().mockResolvedValue({
      status: 0,
      data: encoder.encode('/a'),
    });

    const result = await mkdir(asyncRequest, '/a/b/c', { recursive: true });
    expect(result).toBe('/a');
  });

  it('async mkdir recursive returns undefined when all existed', async () => {
    const asyncRequest = vi.fn().mockResolvedValue({
      status: 0,
      data: null,
    });

    const result = await mkdir(asyncRequest, '/existing', { recursive: true });
    expect(result).toBeUndefined();
  });

  it('async mkdir without recursive returns undefined on success', async () => {
    const asyncRequest = vi.fn().mockResolvedValue({
      status: 0,
      data: null,
    });

    const result = await mkdir(asyncRequest, '/newdir');
    expect(result).toBeUndefined();
  });
});

// ---- VFS Engine-level tests ----

class MockSyncHandle {
  private buffer: Uint8Array;
  private size: number;

  constructor(initialSize: number = 0) {
    this.buffer = new Uint8Array(initialSize);
    this.size = initialSize;
  }

  getSize(): number {
    return this.size;
  }

  truncate(newSize: number): void {
    if (newSize > this.buffer.byteLength) {
      const newBuf = new Uint8Array(newSize);
      newBuf.set(this.buffer.subarray(0, this.size));
      this.buffer = newBuf;
    }
    this.size = newSize;
  }

  read(buf: Uint8Array, opts?: { at?: number }): number {
    const at = opts?.at ?? 0;
    const len = Math.min(buf.byteLength, this.size - at);
    if (len <= 0) return 0;
    buf.set(this.buffer.subarray(at, at + len));
    return len;
  }

  write(buf: Uint8Array, opts?: { at?: number }): number {
    const at = opts?.at ?? 0;
    const end = at + buf.byteLength;
    if (end > this.buffer.byteLength) {
      const newBuf = new Uint8Array(end * 2);
      newBuf.set(this.buffer.subarray(0, this.size));
      this.buffer = newBuf;
    }
    this.buffer.set(buf, at);
    if (end > this.size) this.size = end;
    return buf.byteLength;
  }

  flush(): void {}
  close(): void {}
}

const decoder = new TextDecoder();

describe('mkdir return values (VFS engine)', () => {
  let engine: VFSEngine;

  beforeEach(() => {
    engine = new VFSEngine();
    const handle = new MockSyncHandle(0);
    engine.init(handle as unknown as FileSystemSyncAccessHandle);
  });

  it('recursive mkdir returns first created directory path', () => {
    const result = engine.mkdir('/a/b/c', 1); // flags=1 means recursive
    expect(result.status).toBe(0);
    expect(result.data).not.toBeNull();
    expect(decoder.decode(result.data!)).toBe('/a');
  });

  it('recursive mkdir on fully existing path returns null data', () => {
    engine.mkdir('/a/b/c', 1);
    const result = engine.mkdir('/a/b/c', 1);
    expect(result.status).toBe(0);
    expect(result.data).toBeNull();
  });

  it('recursive mkdir returns first new segment when partial path exists', () => {
    engine.mkdir('/a', 1);
    const result = engine.mkdir('/a/b/c', 1);
    expect(result.status).toBe(0);
    expect(result.data).not.toBeNull();
    expect(decoder.decode(result.data!)).toBe('/a/b');
  });

  it('non-recursive mkdir returns null data on success', () => {
    const result = engine.mkdir('/newdir', 0);
    expect(result.status).toBe(0);
    expect(result.data).toBeNull();
  });
});

// ---- mkdir MODE ----
//
// mkdir used to discard the caller's mode entirely: the method layer encoded only the `recursive`
// flag, and the engine created every directory with a hardcoded DEFAULT_DIR_MODE. Software that
// makes a PRIVATE directory and then stats it back treats the widened mode as a security failure —
// Chrome's ProcessSingleton mkdtemp()s its socket dir and CHECK-fails with
// "Temp directory mode is not 700: 755", which killed the browser during startup.

describe('mkdir mode (method layer)', () => {
  const modeOf = (buf: ArrayBuffer) => {
    const view = new DataView(buf);
    const pathLen = view.getUint32(8, true);
    const dataLen = view.getUint32(12, true);
    expect(dataLen).toBe(4);
    return new DataView(buf, 16 + pathLen, 4).getUint32(0, true);
  };

  it('sends an explicit mode as a 4-byte LE payload', () => {
    const syncRequest = vi.fn().mockReturnValue({ status: 0, data: null });
    mkdirSync(syncRequest, '/d', { mode: 0o700 });
    const sent = syncRequest.mock.calls[0][0] as ArrayBuffer;
    expect(new DataView(sent).getUint32(0, true)).toBe(OP.MKDIR);
    expect(modeOf(sent)).toBe(0o700);
  });

  it('treats the numeric shorthand mkdirSync(path, 0o700) as a mode', () => {
    const syncRequest = vi.fn().mockReturnValue({ status: 0, data: null });
    mkdirSync(syncRequest, '/d', 0o700);
    expect(modeOf(syncRequest.mock.calls[0][0] as ArrayBuffer)).toBe(0o700);
  });

  it("defaults to Node's 0o777 when no mode is given", () => {
    const syncRequest = vi.fn().mockReturnValue({ status: 0, data: null });
    mkdirSync(syncRequest, '/d');
    expect(modeOf(syncRequest.mock.calls[0][0] as ArrayBuffer)).toBe(0o777);
  });

  it('async mkdir carries the mode too', async () => {
    const asyncRequest = vi.fn().mockResolvedValue({ status: 0, data: null });
    await mkdir(asyncRequest, '/d', { mode: 0o700 });
    const [, , , data] = asyncRequest.mock.calls[0];
    expect(new DataView((data as Uint8Array).buffer).getUint32(0, true)).toBe(0o700);
  });
});

describe('mkdir mode (VFS engine)', () => {
  let engine: VFSEngine;

  beforeEach(() => {
    engine = new VFSEngine();
    engine.init(new MockSyncHandle(0) as unknown as FileSystemSyncAccessHandle);
  });

  /** Permission bits the engine actually stored for `path`. */
  const perm = (path: string) => {
    const st = engine.stat(path);
    expect(st.status).toBe(0);
    return new DataView(st.data!.buffer, st.data!.byteOffset, st.data!.byteLength)
      .getUint32(1, true) & 0o7777;
  };

  it('creates a 0700 directory when 0700 is requested', () => {
    expect(engine.mkdir('/priv', 0, 0o700).status).toBe(0);
    expect(perm('/priv')).toBe(0o700);
  });

  it('applies the requested mode to every level of a recursive mkdir', () => {
    expect(engine.mkdir('/a/b/c', 1, 0o700).status).toBe(0);
    expect(perm('/a/b/c')).toBe(0o700);
    expect(perm('/a')).toBe(0o700);
  });

  it('subtracts the umask, exactly as mkdir(2) does in the kernel', () => {
    // Default umask is 0o022, so the default 0o777 request lands on the historical 0o755 —
    // which is what makes this change a no-op for every caller that passes no mode.
    expect(engine.mkdir('/plain', 0, 0o777).status).toBe(0);
    expect(perm('/plain')).toBe(0o755);
  });

  it('mkdtemp creates a PRIVATE 0700 directory, not an ordinary mkdir 0755', () => {
    // mkdtemp(3) creates with S_IRWXU: its whole purpose is a directory only the owner can reach.
    engine.mkdir('/tmp', 0, 0o755);   // mkdtemp requires an existing parent, as node does
    const r = engine.mkdtemp('/tmp/probe-XXXXXX');
    expect(r.status).toBe(0);
    expect(perm(decoder.decode(r.data!))).toBe(0o700);
  });
});
