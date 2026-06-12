/**
 * Mock FileSystemSyncAccessHandle backed by an ArrayBuffer.
 * Simulates sync read/write/truncate/flush/getSize.
 * Shared by engine unit tests and engine benchmarks.
 */
export class MockSyncHandle {
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

  flush(): void {
    // No-op in mock
  }

  close(): void {
    // No-op in mock
  }
}
