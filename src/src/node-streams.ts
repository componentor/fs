/**
 * Minimal Node.js-compatible stream classes for use in browser/OPFS environments.
 *
 * These do NOT depend on Node.js built-ins — they provide just enough API surface
 * for libraries that expect `.on('data')`, `.pipe()`, `.write()`, `.end()`, etc.
 */

// ---------------------------------------------------------------------------
// SimpleEventEmitter — shared base for Node-style event emitters
// ---------------------------------------------------------------------------

type Listener = (...args: unknown[]) => void;

export class SimpleEventEmitter {
  private _listeners = new Map<string, Listener[]>();
  private _onceSet = new WeakSet<Listener>();

  on(event: string, fn: Listener): this {
    let arr = this._listeners.get(event);
    if (!arr) {
      arr = [];
      this._listeners.set(event, arr);
    }
    arr.push(fn);
    return this;
  }

  addListener(event: string, fn: Listener): this {
    return this.on(event, fn);
  }

  once(event: string, fn: Listener): this {
    this._onceSet.add(fn);
    return this.on(event, fn);
  }

  off(event: string, fn: Listener): this {
    const arr = this._listeners.get(event);
    if (arr) {
      const idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    }
    return this;
  }

  removeListener(event: string, fn: Listener): this {
    return this.off(event, fn);
  }

  removeAllListeners(event?: string): this {
    if (event !== undefined) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const arr = this._listeners.get(event);
    if (!arr || arr.length === 0) return false;
    // Copy so that once-removals don't affect iteration.
    const copy = arr.slice();
    for (const fn of copy) {
      if (this._onceSet.has(fn)) {
        this._onceSet.delete(fn);
        this.off(event, fn);
      }
      fn(...args);
    }
    return true;
  }

  listenerCount(event: string): number {
    return this._listeners.get(event)?.length ?? 0;
  }
}

// ---------------------------------------------------------------------------
// NodeReadable — minimal Node.js Readable-compatible stream
// ---------------------------------------------------------------------------

export interface NodeReadableOptions {
  highWaterMark?: number;
  /** Byte offset to start reading from */
  start?: number;
  /** Byte offset to stop reading at (inclusive, Node.js convention) */
  end?: number;
}

export class NodeReadable extends SimpleEventEmitter {
  private _paused = true;
  private _destroyed = false;
  private _ended = false;
  private _reading = false;
  private _readBuffer: Uint8Array | null = null;
  private _encoding: string | null = null;

  /** Whether the stream is still readable (not ended or destroyed). */
  readable = true;

  /** The file path this stream reads from (set externally). */
  path: string = '';

  /** Total bytes read so far. */
  bytesRead = 0;

  /** Optional cleanup callback invoked on destroy (e.g. close file handle). */
  private _destroyFn: (() => Promise<void>) | null = null;

  constructor(
    private _readFn: () => Promise<{ done: boolean; value?: Uint8Array }>,
    destroyFn?: () => Promise<void>,
  ) {
    super();
    if (destroyFn) this._destroyFn = destroyFn;
  }

  // ---- Flow control (override on to auto-resume) ----

  on(event: string, fn: Listener): this {
    super.on(event, fn);
    // Attaching a 'data' listener switches to flowing mode (Node.js behaviour).
    if (event === 'data' && this._paused) {
      this.resume();
    }
    return this;
  }

  pause(): this {
    this._paused = true;
    return this;
  }

  resume(): this {
    if (this._destroyed || this._ended) return this;
    this._paused = false;
    this._drain();
    return this;
  }

  /**
   * Set the character encoding for data read from this stream.
   * When set, 'data' events emit strings instead of Uint8Array.
   */
  setEncoding(encoding: string): this {
    this._encoding = encoding;
    return this;
  }

  /**
   * Non-flowing read — returns the last buffered chunk or null.
   * Node.js has a complex buffer system; we keep it simple here.
   */
  read(_size?: number): Uint8Array | null {
    const buf = this._readBuffer;
    this._readBuffer = null;
    return buf;
  }

  /** Destroy the stream, optionally with an error. */
  destroy(err?: Error): this {
    if (this._destroyed) return this;
    this._destroyed = true;
    this.readable = false;
    if (err) {
      this.emit('error', err);
    }
    // Run destroy callback (e.g. close file handle) then emit 'close'.
    if (this._destroyFn) {
      this._destroyFn().then(
        () => this.emit('close'),
        () => this.emit('close'),
      );
    } else {
      this.emit('close');
    }
    return this;
  }

  // ---- pipe ----

  pipe<T extends NodeWritable | WritableStream<Uint8Array>>(dest: T): T {
    if (isNodeWritableInstance(dest)) {
      this.on('data', (chunk: unknown) => {
        (dest as NodeWritable).write(chunk as Uint8Array);
      });
      this.on('end', () => {
        if (typeof (dest as NodeWritable).end === 'function') {
          (dest as NodeWritable).end();
        }
      });
      this.on('error', (err: unknown) => {
        if (typeof (dest as NodeWritable).destroy === 'function') {
          (dest as NodeWritable).destroy(err as Error);
        }
      });
    } else {
      // Web WritableStream
      const writer = (dest as WritableStream<Uint8Array>).getWriter();
      this.on('data', (chunk: unknown) => {
        writer.write(chunk as Uint8Array);
      });
      this.on('end', () => {
        writer.close();
      });
      this.on('error', (err: unknown) => {
        writer.abort(err);
      });
    }

    // Pipe starts flowing mode.
    if (this._paused) {
      this.resume();
    }
    return dest;
  }

  // ---- Internal ----

  private async _drain(): Promise<void> {
    if (this._reading || this._destroyed || this._ended) return;
    this._reading = true;

    try {
      while (!this._paused && !this._destroyed && !this._ended) {
        const result = await this._readFn();

        if (this._destroyed) break;

        if (result.done || !result.value || result.value.byteLength === 0) {
          this._ended = true;
          this.readable = false;
          this.emit('end');
          this.emit('close');
          break;
        }

        this.bytesRead += result.value.byteLength;
        this._readBuffer = result.value;
        if (this._encoding) {
          this.emit('data', new TextDecoder(this._encoding).decode(result.value));
        } else {
          this.emit('data', result.value);
        }
      }
    } catch (err) {
      if (!this._destroyed) {
        this.destroy(err as Error);
      }
    } finally {
      this._reading = false;
    }
  }
}

// ---------------------------------------------------------------------------
// NodeWritable — minimal Node.js Writable-compatible stream
// ---------------------------------------------------------------------------

export class NodeWritable extends SimpleEventEmitter {
  /** Total bytes written so far. */
  bytesWritten = 0;

  /** The file path this stream was created for. */
  readonly path: string;

  /** Whether this stream is still writable. */
  writable = true;

  private _destroyed = false;
  private _finished = false;
  private _writing = false;
  private _corked = false;

  constructor(
    path: string,
    private _writeFn: (chunk: Uint8Array) => Promise<void>,
    private _closeFn: () => Promise<void>,
  ) {
    super();
    this.path = path;
  }

  // -- public API -----------------------------------------------------------

  /**
   * Buffer all writes until `uncork()` is called.
   * In this minimal implementation we only track the flag for compatibility.
   */
  cork(): void {
    this._corked = true;
  }

  /**
   * Flush buffered writes (clears the cork flag).
   * In this minimal implementation we only track the flag for compatibility.
   */
  uncork(): void {
    this._corked = false;
  }

  write(
    chunk: string | Uint8Array,
    encodingOrCb?: string | ((...args: unknown[]) => void),
    cb?: (...args: unknown[]) => void,
  ): boolean {
    const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;

    if (this._destroyed || this._finished) {
      const err = new Error('write after end');
      if (callback) callback(err);
      return false;
    }

    const data =
      typeof chunk === 'string'
        ? new TextEncoder().encode(chunk)
        : chunk;

    this._writing = true;
    this._writeFn(data)
      .then(() => {
        this.bytesWritten += data.byteLength;
        this._writing = false;
        if (callback) callback();
        this.emit('drain');
      })
      .catch((err: unknown) => {
        this._writing = false;
        if (callback) callback(err);
        this.emit('error', err);
      });

    // Always return true — we don't implement back-pressure
    return true;
  }

  end(
    chunk?: string | Uint8Array | ((...args: unknown[]) => void),
    encodingOrCb?: string | ((...args: unknown[]) => void),
    cb?: (...args: unknown[]) => void,
  ): this {
    // Normalise arguments — Node allows several overloads
    let callback: ((...args: unknown[]) => void) | undefined;
    let finalChunk: string | Uint8Array | undefined;

    if (typeof chunk === 'function') {
      callback = chunk;
      finalChunk = undefined;
    } else {
      finalChunk = chunk;
      if (typeof encodingOrCb === 'function') {
        callback = encodingOrCb;
      } else {
        callback = cb;
      }
    }

    if (this._finished) {
      if (callback) callback();
      return this;
    }

    this.writable = false;

    const finish = () => {
      this._closeFn()
        .then(() => {
          this._finished = true;
          this.emit('finish');
          this.emit('close');
          if (callback) callback();
        })
        .catch((err: unknown) => {
          this.emit('error', err);
          if (callback) callback(err);
        });
    };

    if (finalChunk !== undefined && finalChunk !== null) {
      this.write(finalChunk, undefined, () => finish());
    } else {
      finish();
    }

    return this;
  }

  destroy(err?: Error): this {
    if (this._destroyed) return this;
    this._destroyed = true;
    this.writable = false;

    this._closeFn().catch(() => {}).finally(() => {
      if (err) this.emit('error', err);
      this.emit('close');
    });

    return this;
  }
}

/** Check if something is a Node-style writable (has .write() but no .getWriter()). */
function isNodeWritableInstance(obj: unknown): obj is NodeWritable {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof (obj as NodeWritable).write === 'function' &&
    !('getWriter' in (obj as object))
  );
}
