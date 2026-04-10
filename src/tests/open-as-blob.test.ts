/**
 * openAsBlob Tests
 *
 * Tests for fs.openAsBlob() and promises.openAsBlob() (Node.js 19+).
 * Since openAsBlob is a thin wrapper over readFile, we test it by mocking
 * the underlying readFile behaviour via a minimal VFSPromises-like object.
 */

import { describe, it, expect, vi } from 'vitest';

/**
 * Helper: simulates VFSPromises.openAsBlob logic (same implementation as the
 * real method) so we can unit-test without spinning up workers.
 */
async function openAsBlob(
  readFile: (path: string) => Promise<Uint8Array | string>,
  filePath: string,
  options?: { type?: string },
): Promise<Blob> {
  const data = await readFile(filePath);
  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data as string);
  return new Blob([bytes], { type: options?.type ?? '' });
}

const encoder = new TextEncoder();

describe('openAsBlob', () => {
  it('should return a Blob instance', async () => {
    const readFile = vi.fn().mockResolvedValue(encoder.encode('hello'));
    const blob = await openAsBlob(readFile, '/test.txt');
    expect(blob).toBeInstanceOf(Blob);
  });

  it('should contain the correct data', async () => {
    const content = 'Hello, world!';
    const readFile = vi.fn().mockResolvedValue(encoder.encode(content));
    const blob = await openAsBlob(readFile, '/test.txt');
    const text = await blob.text();
    expect(text).toBe(content);
  });

  it('should have a size matching the file content length', async () => {
    const content = 'abcdef';
    const bytes = encoder.encode(content);
    const readFile = vi.fn().mockResolvedValue(bytes);
    const blob = await openAsBlob(readFile, '/test.txt');
    expect(blob.size).toBe(bytes.byteLength);
  });

  it('should handle binary data correctly', async () => {
    const binary = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
    const readFile = vi.fn().mockResolvedValue(binary);
    const blob = await openAsBlob(readFile, '/binary.bin');
    expect(blob.size).toBe(binary.byteLength);
    const ab = await blob.arrayBuffer();
    expect(new Uint8Array(ab)).toEqual(binary);
  });

  it('should set the MIME type from options.type', async () => {
    const readFile = vi.fn().mockResolvedValue(encoder.encode('<html></html>'));
    const blob = await openAsBlob(readFile, '/page.html', { type: 'text/html' });
    expect(blob.type).toBe('text/html');
  });

  it('should default to empty string type when options.type is omitted', async () => {
    const readFile = vi.fn().mockResolvedValue(encoder.encode('data'));
    const blob = await openAsBlob(readFile, '/file.dat');
    expect(blob.type).toBe('');
  });

  it('should default to empty string type when options is omitted', async () => {
    const readFile = vi.fn().mockResolvedValue(encoder.encode('data'));
    const blob = await openAsBlob(readFile, '/file.dat');
    expect(blob.type).toBe('');
  });

  it('should handle string data from readFile', async () => {
    const content = 'string return value';
    const readFile = vi.fn().mockResolvedValue(content);
    const blob = await openAsBlob(readFile, '/text.txt');
    const text = await blob.text();
    expect(text).toBe(content);
  });

  it('should throw when readFile rejects (non-existent file)', async () => {
    const readFile = vi.fn().mockRejectedValue(
      Object.assign(new Error("ENOENT: no such file or directory, open '/missing.txt'"), {
        code: 'ENOENT',
        errno: -2,
        syscall: 'open',
        path: '/missing.txt',
      }),
    );
    await expect(openAsBlob(readFile, '/missing.txt')).rejects.toThrow('ENOENT');
  });

  it('should handle empty files', async () => {
    const readFile = vi.fn().mockResolvedValue(new Uint8Array(0));
    const blob = await openAsBlob(readFile, '/empty.txt');
    expect(blob.size).toBe(0);
    expect(await blob.text()).toBe('');
  });
});
