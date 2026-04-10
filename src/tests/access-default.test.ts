/**
 * Access Method Tests
 *
 * Tests that accessSync and async access use constants.F_OK as the default
 * mode parameter, and that explicit modes and error cases work correctly.
 */

import { describe, it, expect, vi } from 'vitest';
import { accessSync, access } from '../src/methods/access.js';
import { constants } from '../src/constants.js';
import { OP, encodeRequest } from '../src/protocol/opcodes.js';

describe('access default mode', () => {
  it('accessSync with no mode argument uses F_OK (0)', () => {
    const syncRequest = vi.fn().mockReturnValue({ status: 0, data: null });

    accessSync(syncRequest, '/exists.txt');

    // Verify encodeRequest was called with F_OK (0) as the mode/flags
    expect(syncRequest).toHaveBeenCalledTimes(1);
    const buf = syncRequest.mock.calls[0][0];
    expect(buf).toBeInstanceOf(ArrayBuffer);

    // Decode to verify the flags field is F_OK
    const view = new DataView(buf);
    const flags = view.getUint32(4, true); // flags at offset 4
    expect(flags).toBe(constants.F_OK);
  });

  it('async access with no mode argument uses F_OK (0)', async () => {
    const asyncRequest = vi.fn().mockResolvedValue({ status: 0, data: null });

    await access(asyncRequest, '/exists.txt');

    expect(asyncRequest).toHaveBeenCalledTimes(1);
    expect(asyncRequest).toHaveBeenCalledWith(OP.ACCESS, '/exists.txt', constants.F_OK);
  });

  it('accessSync with explicit R_OK mode passes it through', () => {
    const syncRequest = vi.fn().mockReturnValue({ status: 0, data: null });

    accessSync(syncRequest, '/exists.txt', constants.R_OK);

    const buf = syncRequest.mock.calls[0][0];
    const view = new DataView(buf);
    const flags = view.getUint32(4, true);
    expect(flags).toBe(constants.R_OK);
  });

  it('async access with explicit R_OK mode passes it through', async () => {
    const asyncRequest = vi.fn().mockResolvedValue({ status: 0, data: null });

    await access(asyncRequest, '/exists.txt', constants.R_OK);

    expect(asyncRequest).toHaveBeenCalledWith(OP.ACCESS, '/exists.txt', constants.R_OK);
  });

  it('accessSync on non-existent file throws ENOENT', () => {
    // status 1 = ENOENT in the VFS protocol
    const syncRequest = vi.fn().mockReturnValue({ status: 1, data: null });

    expect(() => accessSync(syncRequest, '/no-such-file.txt')).toThrow();
  });

  it('async access on non-existent file throws ENOENT', async () => {
    const asyncRequest = vi.fn().mockResolvedValue({ status: 1, data: null });

    await expect(access(asyncRequest, '/no-such-file.txt')).rejects.toThrow();
  });
});
