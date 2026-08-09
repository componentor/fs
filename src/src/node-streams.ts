/**
 * Minimal Node.js-compatible stream classes for use in browser/OPFS environments.
 *
 * These do NOT depend on Node.js built-ins — they provide just enough API surface
 * for libraries that expect `.on('data')`, `.pipe()`, `.write()`, `.end()`, etc.
 */

// ---------------------------------------------------------------------------
// SimpleEventEmitter — shared base for Node-style event emitters
// ---------------------------------------------------------------------------

import { createStringDecoder, encodeString, type StringDecoder } from './encoding.js';
import { streamWriteAfterEnd } from './errors.js';

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

  rawListeners(event: string): Function[] {
    return [...(this._listeners.get(event) ?? [])];
  }

  prependListener(event: string, fn: Listener): this {
    const arr = this._listeners.get(event) ?? [];
    arr.unshift(fn);
    this._listeners.set(event, arr);
    return this;
  }

  prependOnceListener(event: string, fn: Listener): this {
    const wrapper: Listener = (...args: unknown[]) => {
      this.off(event, wrapper);
      fn(...args);
    };
    return this.prependListener(event, wrapper);
  }

  eventNames(): string[] {
    return [...this._listeners.keys()].filter(k => (this._listeners.get(k)?.length ?? 0) > 0);
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
  /**
   * Carries partial characters between chunks — see {@link createStringDecoder}.
   *
   * Decoding each chunk on its own turned every multi-byte character that straddled a 64 KB
   * chunk boundary into two U+FFFDs.
   */
  private _decoder: StringDecoder | null = null;

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
    this._decoder = createStringDecoder(encoding);
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

  /**
   * `for await (const chunk of stream)`.
   *
   * Node's readables are async iterable, and this one was not — so the ordinary way to consume a
   * read stream threw "stream is not async iterable". Implemented over the event interface with
   * `pause()` between chunks so a slow consumer applies backpressure instead of buffering the
   * whole file.
   *
   * Leaving the loop early (`break`, `return`, or a throw in the body) destroys the stream, which
   * closes the underlying handle — node does the same, and here it matters more: in the browser
   * these are OPFS sync access handles holding an *exclusive* lock, so a leaked one blocks every
   * later open of that file for the lifetime of the page.
   */
  async *[Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array | string> {
    const queue: (Uint8Array | string)[] = [];
    let ended = false;
    let failure: Error | null = null;
    let wake: (() => void) | null = null;
    const notify = () => { const w = wake; wake = null; w?.(); };

    const onData = ((chunk: Uint8Array | string) => {
      queue.push(chunk);
      this.pause();      // one chunk at a time; resumed once the consumer takes it
      notify();
    }) as Listener;
    const onEnd = (() => { ended = true; notify(); }) as Listener;
    const onError = ((err: Error) => { failure = err; notify(); }) as Listener;

    this.on('data', onData);
    this.on('end', onEnd);
    this.on('error', onError);

    this.resume();

    try {
      for (;;) {
        if (queue.length > 0) {
          const chunk = queue.shift()!;
          yield chunk;
          this.resume();
          continue;
        }
        if (failure) throw failure;
        if (ended || this._ended) return;
        await new Promise<void>((resolve) => { wake = resolve; });
      }
    } finally {
      // Detach first, so `destroy()` cannot re-enter the handlers above.
      this.off('data', onData);
      this.off('end', onEnd);
      this.off('error', onError);
      // Only on early exit: a stream that ran to completion has already released its handle,
      // and destroying it again would emit a second 'close'.
      if (!this._ended && !this._destroyed) this.destroy();
    }
  }

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
          // Flush any bytes the decoder was holding for a character that never completed. Node
          // emits this as a final 'data' before 'end' rather than dropping it.
          if (this._decoder) {
            const tail = this._decoder.end();
            if (tail !== '') this.emit('data', tail);
          }
          this.emit('end');
          this.emit('close');
          break;
        }

        this.bytesRead += result.value.byteLength;
        this._readBuffer = result.value;
        if (this._decoder) {
          // A chunk may end mid-character; the decoder holds the remainder for the next one.
          const text = this._decoder.write(result.value);
          if (text !== '') this.emit('data', text);
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
  /**
   * Set synchronously by `end()`, where `_finished` is only set once the queue has drained.
   *
   * Node rejects a write the moment `end()` has been called. Testing `_finished` instead let a
   * late write be accepted and queued, and whether it landed in the file, hit `EBADF`, or wrote
   * past a closed handle depended purely on whether close won the race.
   */
  private _ending = false;

  /**
   * Serialises queued writes.
   *
   * `_writeFn` reads the stream's current file offset when it runs and advances it by however
   * much it wrote. Firing writes concurrently therefore loses data: two synchronous `write()`
   * calls both started at the same offset, and the second overwrote the first — a plain
   * `ws.write('abc'); ws.write('def')` produced `'def'`. Chaining keeps each write starting
   * where the previous one finished, and lets `end()` wait for the queue to drain before
   * closing the handle, which was the same race one step later.
   */
  private _chain: Promise<void> = Promise.resolve();

  constructor(
    path: string,
    private _writeFn: (chunk: Uint8Array) => Promise<void>,
    private _closeFn: () => Promise<void>,
    /** Encoding for string chunks written without one — the stream's `encoding` option. */
    private _defaultEncoding: string = 'utf8',
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
    const encoding = typeof encodingOrCb === 'string' ? encodingOrCb : this._defaultEncoding;

    if (this._destroyed || this._finished || this._ending) {
      const err = streamWriteAfterEnd();
      // Node reports it to the callback *and* emits 'error'; without the emit a stream with no
      // per-write callback loses the failure entirely.
      if (callback) callback(err);
      this.emit('error', err);
      return false;
    }

    // A string chunk is encoded with the write's own encoding, falling back to the stream's.
    // This used to be an unconditional `new TextEncoder()`, so `write(s, 'latin1')` wrote UTF-8:
    // 'é' went out as [195,169] where node writes [233].
    const data =
      typeof chunk === 'string'
        ? encodeString(chunk, encoding)
        : chunk;

    this._writing = true;
    this._chain = this._chain
      .then(() => this._writeFn(data))
      .then(
        () => {
          this.bytesWritten += data.byteLength;
          this._writing = false;
          if (callback) callback();
          this.emit('drain');
        },
        (err: unknown) => {
          this._writing = false;
          if (callback) callback(err);
          this.emit('error', err);
          // Settle rather than rethrow: a rejected chain would strand every later write and
          // leave `end()` waiting forever on a promise nobody resolves.
        },
      );

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
    let finalEncoding: string | undefined;

    if (typeof chunk === 'function') {
      callback = chunk;
      finalChunk = undefined;
    } else {
      finalChunk = chunk;
      if (typeof encodingOrCb === 'function') {
        callback = encodingOrCb;
      } else {
        finalEncoding = encodingOrCb;
        callback = cb;
      }
    }

    if (this._finished || this._ending) {
      if (callback) callback();
      return this;
    }

    this.writable = false;

    const finish = () => {
      // Drain queued writes first — closing the handle with writes still in flight loses them.
      this._chain
        .then(() => this._closeFn())
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
      // Enqueue it; `finish` waits on the same chain, so no completion callback is needed.
      // This runs before `_ending` is set, or `write()` would reject the stream's own last chunk.
      this.write(finalChunk, finalEncoding);
    }
    // From here `write()` reports ERR_STREAM_WRITE_AFTER_END. Setting it now — rather than when
    // the queue drains — also freezes `_chain`, so nothing can be appended after `finish()` has
    // captured it and slip in behind the close.
    this._ending = true;
    finish();

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
