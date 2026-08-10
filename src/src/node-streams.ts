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

/** One registration. `once` is per-registration, not per-function — see {@link SimpleEventEmitter}. */
interface Registration {
  fn: Listener;
  once: boolean;
}

export class SimpleEventEmitter {
  /**
   * Listeners as `{ fn, once }` records rather than bare functions.
   *
   * `once`-ness used to live in a `WeakSet` keyed by the function alone, which is wrong in two
   * ways that both show up with ordinary code. Sharing one handler across two events —
   * `once('a', f)` plus `on('b', f)` — meant firing `'b'` found `f` in the set and removed a
   * listener that was supposed to be permanent. And registering the same function twice with
   * `once` collapsed to one set entry, so the second registration was silently promoted to
   * permanent. Node wraps each registration separately; these records do the same.
   */
  private _listeners = new Map<string, Registration[]>();

  on(event: string, fn: Listener): this { return this._add(event, fn, false, false); }
  addListener(event: string, fn: Listener): this { return this.on(event, fn); }
  once(event: string, fn: Listener): this { return this._add(event, fn, true, false); }
  prependListener(event: string, fn: Listener): this { return this._add(event, fn, false, true); }
  prependOnceListener(event: string, fn: Listener): this { return this._add(event, fn, true, true); }

  /**
   * The single registration path. `protected` because `NodeReadable` hooks it to start flowing
   * when a `'data'` listener appears — it used to override `on()`, which `once()` reached by
   * delegating to it. Now that `once`/`prepend*` build their records directly, overriding `on()`
   * would miss them, and `stream.once('data', …)` would never start the stream.
   */
  protected _add(event: string, fn: Listener, once: boolean, prepend: boolean): this {
    let arr = this._listeners.get(event);
    if (!arr) {
      arr = [];
      this._listeners.set(event, arr);
    }
    const entry: Registration = { fn, once };
    if (prepend) arr.unshift(entry); else arr.push(entry);
    return this;
  }

  off(event: string, fn: Listener): this {
    const arr = this._listeners.get(event);
    if (arr) {
      // Node removes the most recently added matching registration.
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i].fn === fn) { arr.splice(i, 1); break; }
      }
    }
    return this;
  }

  removeListener(event: string, fn: Listener): this { return this.off(event, fn); }

  removeAllListeners(event?: string): this {
    if (event !== undefined) this._listeners.delete(event);
    else this._listeners.clear();
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const arr = this._listeners.get(event);
    if (!arr || arr.length === 0) {
      // Node throws when an 'error' event has nowhere to go rather than dropping it. Swallowing
      // it silently is how a stream failure turns into a hang with no diagnostic.
      if (event === 'error') {
        const err = args[0];
        if (err instanceof Error) throw err;
        throw Object.assign(new Error(`Unhandled error. (${String(err)})`), { code: 'ERR_UNHANDLED_ERROR' });
      }
      return false;
    }
    // Copy so that once-removals do not disturb iteration.
    const copy = arr.slice();
    for (const entry of copy) {
      if (entry.once) {
        const idx = arr.indexOf(entry);
        if (idx !== -1) arr.splice(idx, 1);
      }
      entry.fn(...args);
    }
    return true;
  }

  listenerCount(event: string): number { return this._listeners.get(event)?.length ?? 0; }
  listeners(event: string): Function[] { return (this._listeners.get(event) ?? []).map((e) => e.fn); }
  rawListeners(event: string): Function[] { return this.listeners(event); }

  /** Node caps listeners per emitter and warns past it; there is no cap here. Shape only. */
  setMaxListeners(_n: number): this { return this; }
  getMaxListeners(): number { return 0; }

  eventNames(): string[] {
    return [...this._listeners.keys()].filter((k) => (this._listeners.get(k)?.length ?? 0) > 0);
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

  protected _add(event: string, fn: Listener, once: boolean, prepend: boolean): this {
    super._add(event, fn, once, prepend);
    // Attaching a 'data' listener switches to flowing mode (Node.js behaviour). Hooked here
    // rather than on `on()` so `once('data', …)` and `prependListener('data', …)` start the
    // stream too — they do not route through `on()`.
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


  /**
   * Emit `'error'` from inside the internal write chain.
   *
   * `emit('error')` throws when nothing is listening, which is node's rule — but thrown from a
   * `.then` handler it becomes an unhandled *rejection* of this stream's own chain: quieter than
   * node, and it strands the chain. Node raises an uncaught exception instead (verified against a
   * real `Writable`: a failing write with a callback but no `'error'` listener calls the callback
   * and *then* crashes). Rethrowing out of band reproduces that and leaves the chain intact.
   */
  private _emitError(err: unknown): void {
    if (this.listenerCount('error') > 0) {
      this.emit('error', err);
      return;
    }
    setTimeout(() => { throw err; }, 0);
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
      // per-write callback loses the failure entirely. Emitted on a later tick, as node does —
      // an unhandled 'error' now throws, and throwing it synchronously from here would break
      // `write()`'s contract of returning false rather than raising.
      if (callback) callback(err);
      queueMicrotask(() => this._emitError(err));
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
          this._emitError(err);
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
          if (callback) callback(err);
          this._emitError(err);
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
