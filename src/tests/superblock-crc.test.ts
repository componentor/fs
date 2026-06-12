/**
 * Superblock CRC tests — torn/corrupt superblock writes must be DETECTED at
 * mount (and routed to repair via the "Corrupt VFS:" contract) instead of
 * being trusted as layout truth. Legacy files written before checksumming
 * (CRC field = 0) must keep mounting, and upgrade on their next superblock
 * write.
 */

import { describe, it, expect } from 'vitest';
import { VFSEngine } from '../src/vfs/engine.js';
import { SUPERBLOCK } from '../src/vfs/layout.js';
import { crc32 } from '../src/vfs/crc32.js';
import { MockSyncHandle } from './helpers/mock-handle.js';

const encoder = new TextEncoder();
const DATA = encoder.encode('crc-test-data');

function freshVolume(): MockSyncHandle {
  const handle = new MockSyncHandle(0);
  const engine = new VFSEngine();
  engine.init(handle as unknown as FileSystemSyncAccessHandle);
  engine.mkdir('/dir');
  engine.write('/dir/file.txt', DATA);
  return handle;
}

function readSuperblock(handle: MockSyncHandle): { buf: Uint8Array; view: DataView } {
  const buf = new Uint8Array(SUPERBLOCK.SIZE);
  handle.read(buf, { at: 0 });
  return { buf, view: new DataView(buf.buffer) };
}

function mount(handle: MockSyncHandle): VFSEngine {
  const engine = new VFSEngine();
  engine.init(handle as unknown as FileSystemSyncAccessHandle);
  return engine;
}

describe('crc32 primitive', () => {
  it('matches the IEEE 802.3 check value for "123456789"', () => {
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
  });

  it('respects start/end bounds', () => {
    const bytes = encoder.encode('xx123456789yy');
    expect(crc32(bytes, 2, 11)).toBe(0xcbf43926);
  });

  it('returns a different value when any byte changes', () => {
    const a = encoder.encode('hello-world!');
    const b = encoder.encode('hello-world?');
    expect(crc32(a)).not.toBe(crc32(b));
  });
});

describe('superblock CRC — write side', () => {
  it('a fresh volume stores a valid non-zero CRC at offset 60', () => {
    const handle = freshVolume();
    const { buf, view } = readSuperblock(handle);
    const stored = view.getUint32(SUPERBLOCK.CRC32, true);
    expect(stored).not.toBe(0);
    expect(stored).toBe(crc32(buf, 0, SUPERBLOCK.CRC32));
  });

  it('the CRC stays valid across mutating operations', () => {
    const handle = freshVolume();
    const engine = mount(handle);
    engine.write('/dir/another.txt', DATA);
    engine.unlink('/dir/file.txt');
    engine.mkdir('/dir2');
    const { buf, view } = readSuperblock(handle);
    expect(view.getUint32(SUPERBLOCK.CRC32, true)).toBe(crc32(buf, 0, SUPERBLOCK.CRC32));
  });
});

describe('superblock CRC — mount side', () => {
  it('an intact volume mounts and serves its data', () => {
    const handle = freshVolume();
    const engine = mount(handle);
    const res = engine.read('/dir/file.txt');
    expect(res.status).toBe(0);
    expect(new TextDecoder().decode(res.data!)).toBe('crc-test-data');
  });

  it('a corrupted layout field fails mount with a checksum error', () => {
    const handle = freshVolume();
    const { buf, view } = readSuperblock(handle);
    // Corrupt INODE_COUNT without recomputing the CRC — exactly what a torn
    // write or bit flip looks like.
    view.setUint32(SUPERBLOCK.INODE_COUNT, 3, true);
    handle.write(buf, { at: 0 });
    expect(() => mount(handle)).toThrowError(/Corrupt VFS: superblock checksum mismatch/);
  });

  it('garbage across the field region fails mount with a checksum error', () => {
    const handle = freshVolume();
    const { buf } = readSuperblock(handle);
    // Garbage bytes 8..59 (preserving magic/version so we reach the CRC check)
    for (let i = 8; i < SUPERBLOCK.CRC32; i++) buf[i] = 0xab;
    handle.write(buf, { at: 0 });
    expect(() => mount(handle)).toThrowError(/Corrupt VFS: superblock checksum mismatch/);
  });

  it('corruption that garbles the magic still fails fast (magic precedes CRC)', () => {
    const handle = freshVolume();
    const { buf } = readSuperblock(handle);
    buf.fill(0xff, 0, 8);
    handle.write(buf, { at: 0 });
    expect(() => mount(handle)).toThrowError(/Corrupt VFS: bad magic/);
  });
});

describe('superblock CRC — legacy compatibility', () => {
  function makeLegacy(handle: MockSyncHandle): void {
    // Zero the CRC field, simulating a file written before checksumming.
    const { buf, view } = readSuperblock(handle);
    view.setUint32(SUPERBLOCK.CRC32, 0, true);
    handle.write(buf, { at: 0 });
  }

  it('a legacy file (CRC field = 0) mounts without validation', () => {
    const handle = freshVolume();
    makeLegacy(handle);
    const engine = mount(handle);
    expect(engine.read('/dir/file.txt').status).toBe(0);
  });

  it('a legacy file is upgraded to checksummed on its next superblock write', () => {
    const handle = freshVolume();
    makeLegacy(handle);
    const engine = mount(handle);
    engine.write('/dir/new.txt', DATA); // triggers commitPending -> writeSuperblock
    const { buf, view } = readSuperblock(handle);
    const stored = view.getUint32(SUPERBLOCK.CRC32, true);
    expect(stored).not.toBe(0);
    expect(stored).toBe(crc32(buf, 0, SUPERBLOCK.CRC32));
  });

  it('a legacy file with corrupt fields still fails the pre-existing sanity checks', () => {
    const handle = freshVolume();
    const { buf, view } = readSuperblock(handle);
    view.setUint32(SUPERBLOCK.CRC32, 0, true); // legacy: no CRC protection
    view.setUint32(SUPERBLOCK.BLOCK_SIZE, 12345, true); // not a power of 2
    handle.write(buf, { at: 0 });
    expect(() => mount(handle)).toThrowError(/Corrupt VFS/);
  });
});
