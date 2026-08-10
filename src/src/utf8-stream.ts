/**
 * `fs.Utf8Stream` — node 24's buffered append-only stream for writing text to a file.
 *
 * Node added this in v24 as the engine behind fast logging (it is `sonic-boom` absorbed into
 * core). It buffers writes and flushes them in batches, which is the whole point: a logger that
 * issued one syscall per line would dominate the cost of whatever it was logging.
 *
 * It was the last `node:fs` export this library did not provide. The surface here — six methods
 * and twelve getters — was read off a live `fs.Utf8Stream` rather than the docs, including the
 * defaults (`append: true`, `contentMode: 'utf8'`, `minLength: 0`, `mode: undefined`) and the
 * event order, which is `write` → `ready` → `drain`, then `finish` → `close` on `end()`.
 *
 * The one structural difference from node's: node's is a free function over the real filesystem,
 * while this one has to be bound to a `VFSFileSystem` instance, so it is exposed as
 * `fs.Utf8Stream` rather than as a module export. That is also why it is built by a factory.
 */

import { SimpleEventEmitter } from './node-streams.js';
import { invalidArgType, invalidArgValue } from './errors.js';

export interface Utf8StreamOptions {
  /** Path to write to. Either this or `fd` is required. */
  dest?: string;
  /** An already-open descriptor to write to, instead of opening `dest`. */
  fd?: number;
  /** Buffer until at least this many bytes are pending. `0` writes through. */
  minLength?: number;
  /** Drop writes once this many bytes are pending. `0` means no limit. */
  maxLength?: number;
  /** Append to the file rather than truncating it. Default `true`. */
  append?: boolean;
  /** Mode for a file this stream creates. */
  mode?: number;
  /** Create the parent directory if it is missing. Default `false`. */
  mkdir?: boolean;
  /** Use the synchronous API for every write. Default `false`. */
  sync?: boolean;
  /** `fsync` after each flush. Default `false`. */
  fsync?: boolean;
  /** Flush automatically every N ms. `0` disables. */
  periodicFlush?: number;
  /** `'utf8'` accepts strings; `'buffer'` accepts `Uint8Array`. Default `'utf8'`. */
  contentMode?: 'utf8' | 'buffer';
}

/**
 * The public shape, declared explicitly.
 *
 * Needed because the class is produced by a factory: TypeScript cannot emit a declaration for an
 * anonymous class that has private fields, so the factory states what it returns instead. That
 * it doubles as the documented surface is a fair trade.
 */
export interface Utf8StreamInstance {
  readonly fd: number;
  readonly file: string | undefined;
  readonly minLength: number;
  readonly maxLength: number;
  readonly writing: boolean;
  readonly sync: boolean;
  readonly fsync: boolean;
  readonly append: boolean;
  readonly mode: number | undefined;
  readonly mkdir: boolean;
  readonly periodicFlush: number;
  readonly contentMode: 'utf8' | 'buffer';

  write(chunk: string | Uint8Array): boolean;
  flush(callback?: (err?: Error | null) => void): void;
  flushSync(): void;
  reopen(dest?: string): void;
  end(): void;
  destroy(): void;

  // EventEmitter surface: 'ready', 'write', 'drain', 'drop', 'finish', 'close', 'error'.
  on(event: string, fn: (...args: unknown[]) => void): this;
  once(event: string, fn: (...args: unknown[]) => void): this;
  off(event: string, fn: (...args: unknown[]) => void): this;
  addListener(event: string, fn: (...args: unknown[]) => void): this;
  removeListener(event: string, fn: (...args: unknown[]) => void): this;
  removeAllListeners(event?: string): this;
  listenerCount(event: string): number;
  eventNames(): string[];
  emit(event: string, ...args: unknown[]): boolean;
}

export type Utf8StreamConstructor = new (options?: Utf8StreamOptions) => Utf8StreamInstance;

/** The filesystem operations a `Utf8Stream` needs, so the class does not import the world. */
export interface Utf8StreamHost {
  openSync(path: string, flags: string, mode?: number): number;
  writeSync(fd: number, data: Uint8Array): number;
  closeSync(fd: number): void;
  fsyncSync(fd: number): void;
  mkdirSync(path: string, options: { recursive: boolean }): void;
  dirname(path: string): string;
}

export function createUtf8StreamClass(host: Utf8StreamHost): Utf8StreamConstructor {
  return class Utf8Stream extends SimpleEventEmitter {
    #fd = -1;
    #file: string | undefined;
    #buffer: Uint8Array[] = [];
    #pending = 0;
    #writing = false;
    #destroyed = false;
    #ended = false;
    #timer: ReturnType<typeof setInterval> | null = null;

    readonly #minLength: number;
    readonly #maxLength: number;
    readonly #append: boolean;
    readonly #mode: number | undefined;
    readonly #mkdir: boolean;
    readonly #sync: boolean;
    readonly #fsync: boolean;
    readonly #periodicFlush: number;
    readonly #contentMode: 'utf8' | 'buffer';

    constructor(options: Utf8StreamOptions = {}) {
      super();
      if (typeof options !== 'object' || options === null) {
        throw invalidArgType('options', 'object', options);
      }
      const { dest, fd, contentMode = 'utf8' } = options;
      if (contentMode !== 'utf8' && contentMode !== 'buffer') {
        throw invalidArgValue('contentMode', contentMode, "must be 'utf8' or 'buffer'");
      }
      if (dest === undefined && fd === undefined) {
        throw invalidArgValue('options', options, 'must contain either dest or fd');
      }

      this.#minLength = options.minLength ?? 0;
      this.#maxLength = options.maxLength ?? 0;
      this.#append = options.append ?? true;
      this.#mode = options.mode;
      this.#mkdir = options.mkdir ?? false;
      this.#sync = options.sync ?? false;
      this.#fsync = options.fsync ?? false;
      this.#periodicFlush = options.periodicFlush ?? 0;
      this.#contentMode = contentMode;

      if (fd !== undefined) {
        this.#fd = fd;
      } else {
        this.#file = dest;
        this.#open();
      }

      if (this.#periodicFlush > 0) {
        this.#timer = setInterval(() => this.flush(), this.#periodicFlush);
        // Never hold a Node process open for a logger; node's does the same.
        (this.#timer as unknown as { unref?: () => void }).unref?.();
      }

      // 'ready' is emitted asynchronously even when the open was synchronous, so a listener
      // attached on the line after the constructor still sees it.
      queueMicrotask(() => { if (!this.#destroyed) this.emit('ready'); });
    }

    #open(): void {
      const file = this.#file!;
      try {
        if (this.#mkdir) host.mkdirSync(host.dirname(file), { recursive: true });
        this.#fd = host.openSync(file, this.#append ? 'a' : 'w', this.#mode);
      } catch (err) {
        // Reported rather than thrown: node surfaces an open failure on the stream.
        queueMicrotask(() => this.emit('error', err));
      }
    }

    // ---- getters, all read-only, matching node's ----
    get fd(): number { return this.#fd; }
    get file(): string | undefined { return this.#file; }
    get minLength(): number { return this.#minLength; }
    get maxLength(): number { return this.#maxLength; }
    get writing(): boolean { return this.#writing; }
    get sync(): boolean { return this.#sync; }
    get fsync(): boolean { return this.#fsync; }
    get append(): boolean { return this.#append; }
    get mode(): number | undefined { return this.#mode; }
    get mkdir(): boolean { return this.#mkdir; }
    get periodicFlush(): number { return this.#periodicFlush; }
    get contentMode(): 'utf8' | 'buffer' { return this.#contentMode; }

    /**
     * Queue a chunk. Returns `false` once `maxLength` is exceeded, as a Node writable does when
     * its buffer is full — and, like node's, the over-limit chunk is **dropped** rather than
     * queued, with a `drop` event.
     */
    write(chunk: string | Uint8Array): boolean {
      if (this.#destroyed) throw new Error('Utf8Stream destroyed');
      if (this.#ended) throw new Error('Utf8Stream ended');

      if (this.#contentMode === 'utf8' && typeof chunk !== 'string') {
        throw invalidArgType('chunk', 'string', chunk);
      }
      if (this.#contentMode === 'buffer' && typeof chunk === 'string') {
        throw invalidArgType('chunk', 'Uint8Array', chunk);
      }

      const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;

      if (this.#maxLength > 0 && this.#pending + bytes.byteLength > this.#maxLength) {
        this.emit('drop', chunk);
        return false;
      }

      this.#buffer.push(bytes);
      this.#pending += bytes.byteLength;

      // minLength is the batching threshold: below it, hold the bytes back.
      if (this.#pending >= this.#minLength) this.#drain();
      return true;
    }

    #drain(): void {
      if (this.#buffer.length === 0 || this.#fd < 0) return;
      const payload = this.#join();
      this.#buffer = [];
      this.#pending = 0;
      this.#writing = true;
      try {
        const written = host.writeSync(this.#fd, payload);
        if (this.#fsync) host.fsyncSync(this.#fd);
        this.#writing = false;
        this.emit('write', written);
        this.emit('drain');
      } catch (err) {
        this.#writing = false;
        this.emit('error', err);
      }
    }

    #join(): Uint8Array {
      if (this.#buffer.length === 1) return this.#buffer[0];
      const out = new Uint8Array(this.#pending);
      let at = 0;
      for (const part of this.#buffer) { out.set(part, at); at += part.byteLength; }
      return out;
    }

    /** Flush buffered bytes, calling back when they have reached the file. */
    flush(callback?: (err?: Error | null) => void): void {
      try {
        this.#drain();
        if (callback) queueMicrotask(() => callback(null));
      } catch (err) {
        if (callback) queueMicrotask(() => callback(err as Error));
        else this.emit('error', err);
      }
    }

    /** Flush synchronously. Everything here is synchronous already; this forces the batch out. */
    flushSync(): void {
      this.#drain();
    }

    /** Close the current descriptor and open the destination again — log rotation. */
    reopen(dest?: string): void {
      if (this.#destroyed) throw new Error('Utf8Stream destroyed');
      this.#drain();
      if (this.#fd >= 0 && this.#file !== undefined) {
        try { host.closeSync(this.#fd); } catch { /* already gone */ }
      }
      if (dest !== undefined) this.#file = dest;
      if (this.#file === undefined) throw invalidArgValue('dest', dest, 'is required to reopen an fd-backed stream');
      this.#open();
      this.emit('ready');
    }

    /** Flush, close, then emit `finish` and `close`. */
    end(): void {
      if (this.#ended || this.#destroyed) return;
      this.#ended = true;
      this.#drain();
      this.#close();
      this.emit('finish');
      this.emit('close');
    }

    /** Drop everything without flushing. */
    destroy(): void {
      if (this.#destroyed) return;
      this.#destroyed = true;
      this.#buffer = [];
      this.#pending = 0;
      this.#close();
      this.emit('close');
    }

    #close(): void {
      if (this.#timer) { clearInterval(this.#timer); this.#timer = null; }
      // A caller-supplied fd stays the caller's to close, as everywhere else in this library.
      if (this.#fd >= 0 && this.#file !== undefined) {
        try { host.closeSync(this.#fd); } catch { /* already gone */ }
      }
      this.#fd = -1;
    }
  };
}

export type Utf8Stream = Utf8StreamInstance;
