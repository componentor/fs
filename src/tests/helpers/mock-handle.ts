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

  /**
   * Grow or shrink, padding with null bytes on the way up — which is what the real handle does,
   * and what the engine now depends on: it skips zeroing any part of a file's extension that the
   * volume's own growth just created, on the grounds that growth arrives zeroed.
   *
   * Reallocating happens to satisfy that; reusing spare capacity does not, and the buffer here
   * keeps capacity across a shrink. So the regrown region is cleared explicitly rather than left
   * holding whatever the volume had there before it was trimmed.
   */
  truncate(newSize: number): void {
    if (newSize > this.buffer.byteLength) {
      const newBuf = new Uint8Array(newSize);
      newBuf.set(this.buffer.subarray(0, this.size));
      this.buffer = newBuf;
    } else if (newSize > this.size) {
      this.buffer.fill(0, this.size, newSize);
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
    } else if (at > this.size) {
      // Writing past the end leaves a hole, and a hole reads as null bytes. Spare capacity can
      // still hold bytes from before a shrink, so clear it rather than expose them.
      this.buffer.fill(0, this.size, at);
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
