var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/errors.ts
var FSError = class extends Error {
  code;
  errno;
  syscall;
  path;
  constructor(code, errno, message, syscall, path) {
    super(message);
    this.name = "FSError";
    this.code = code;
    this.errno = errno;
    this.syscall = syscall;
    this.path = path;
  }
};
var ErrorCodes = {
  ENOENT: -2,
  EEXIST: -17,
  EISDIR: -21,
  ENOTDIR: -20,
  ENOTEMPTY: -39,
  EACCES: -13,
  EBADF: -9,
  EINVAL: -22,
  EMFILE: -24,
  ENOSPC: -28,
  EPERM: -1,
  ENOSYS: -38,
  ELOOP: -40,
  EIO: -5,
  ENOTSUP: -45
};
var STATUS_TO_CODE = {
  0: "OK",
  1: "ENOENT",
  2: "EEXIST",
  3: "EISDIR",
  4: "ENOTDIR",
  5: "ENOTEMPTY",
  6: "EACCES",
  7: "EINVAL",
  8: "EBADF",
  9: "ELOOP",
  10: "ENOSPC",
  11: "EIO",
  12: "ENOTSUP"
};
var CODE_TO_STATUS = {
  ENOENT: 1,
  EEXIST: 2,
  EISDIR: 3,
  ENOTDIR: 4,
  ENOTEMPTY: 5,
  EACCES: 6,
  EINVAL: 7,
  EBADF: 8,
  ELOOP: 9,
  EIO: 11,
  ENOTSUP: 12
};
function createError(code, syscall, path) {
  const errno = ErrorCodes[code] ?? -1;
  const messages = {
    ENOENT: "no such file or directory",
    EEXIST: "file already exists",
    EISDIR: "illegal operation on a directory",
    ENOTDIR: "not a directory",
    ENOTEMPTY: "directory not empty",
    EACCES: "permission denied",
    EINVAL: "invalid argument",
    EBADF: "bad file descriptor",
    ELOOP: "too many symbolic links encountered",
    ENOSPC: "no space left on device",
    EIO: "i/o error",
    ENOTSUP: "operation not supported"
  };
  const msg = messages[code] ?? "unknown error";
  return new FSError(code, errno, `${code}: ${msg}, ${syscall} '${path}'`, syscall, path);
}
function statusToError(status, syscall, path) {
  const code = STATUS_TO_CODE[status] ?? "EINVAL";
  return createError(code, syscall, path);
}
var kind = (name) => name.includes(".") ? "property" : "argument";
function inspectArg(value) {
  if (typeof value === "string") return `'${value}'`;
  if (typeof value === "bigint") return `${value}n`;
  return String(value);
}
function invalidArgType(name, expected, actual) {
  let received;
  if (actual === null || actual === void 0) received = String(actual);
  else if (typeof actual === "object" || typeof actual === "function") {
    received = `an instance of ${actual.constructor?.name ?? "Object"}`;
  } else received = `type ${typeof actual} (${inspectArg(actual)})`;
  const err = new TypeError(`The "${name}" ${kind(name)} must be of type ${expected}. Received ${received}`);
  err.code = "ERR_INVALID_ARG_TYPE";
  return err;
}
function invalidArgValue(name, value, reason) {
  const err = new TypeError(`The ${kind(name)} '${name}' ${reason}. Received ${inspectArg(value)}`);
  err.code = "ERR_INVALID_ARG_VALUE";
  return err;
}
function fsError(code, message, path, syscall) {
  const err = new Error(message);
  err.code = code;
  err.path = path;
  err.syscall = syscall;
  return err;
}
function eisdirNotRecursive(path, syscall = "rm") {
  return fsError("ERR_FS_EISDIR", `Path is a directory: ${syscall} returned EISDIR (is a directory) ${path}`, path, syscall);
}
function cpEisdirNotRecursive(path) {
  return fsError("ERR_FS_EISDIR", `Recursive option not enabled, cannot copy a directory: ${path}`, path, "cp");
}
function cpSameSource(path) {
  return fsError("ERR_FS_CP_EINVAL", `src and dest cannot be the same ${path}`, path, "cp");
}
function cpIntoSubdirectory(src, dest) {
  return fsError("ERR_FS_CP_EINVAL", `Cannot copy ${src}/ to a subdirectory of self ${dest}`, dest, "cp");
}
function cpTargetExists(path) {
  return fsError("ERR_FS_CP_EEXIST", `Target already exists: cp returned EEXIST (${path})`, path, "cp");
}
function streamWriteAfterEnd() {
  const err = new Error("write after end");
  err.code = "ERR_STREAM_WRITE_AFTER_END";
  return err;
}
function outOfRange(name, range, value) {
  const err = new RangeError(
    `The value of "${name}" is out of range. It must be ${range}. Received ${inspectArg(value)}`
  );
  err.code = "ERR_OUT_OF_RANGE";
  return err;
}

// src/encoding.ts
var ALIASES = {
  "utf8": "utf8",
  "utf-8": "utf8",
  "utf16le": "utf16le",
  "utf-16le": "utf16le",
  "ucs2": "utf16le",
  "ucs-2": "utf16le",
  "latin1": "latin1",
  "binary": "latin1",
  "base64": "base64",
  "base64url": "base64url",
  "ascii": "ascii",
  "hex": "hex"
};
var utf8Decoder = new TextDecoder("utf-8");
var utf16Decoder = new TextDecoder("utf-16le");
var utf8Encoder = new TextEncoder();
function normalizeEncoding(encoding) {
  if (encoding === "utf8" || encoding === "utf-8") return "utf8";
  if (typeof encoding !== "string") return void 0;
  return ALIASES[encoding.toLowerCase()];
}
function assertEncoding(encoding, name = "encoding") {
  const normalized = normalizeEncoding(encoding);
  if (normalized === void 0) throw invalidArgValue(name, encoding, "is invalid encoding");
  return normalized;
}
var B64_VALUES = /* @__PURE__ */ (() => {
  const table = new Int8Array(256).fill(-1);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < alphabet.length; i++) table[alphabet.charCodeAt(i)] = i;
  table["-".charCodeAt(0)] = 62;
  table["_".charCodeAt(0)] = 63;
  return table;
})();
var B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var B64URL_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function base64ToBytes(str) {
  const sextets = new Uint8Array(str.length);
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code === 61) break;
    const value = code < 256 ? B64_VALUES[code] : -1;
    if (value >= 0) sextets[n++] = value;
  }
  const groups = n >> 2;
  const rem = n & 3;
  const out = new Uint8Array(groups * 3 + (rem === 0 ? 0 : rem - 1));
  let o = 0;
  for (let g = 0; g < groups; g++) {
    const i = g * 4;
    out[o++] = sextets[i] << 2 | sextets[i + 1] >> 4;
    out[o++] = (sextets[i + 1] & 15) << 4 | sextets[i + 2] >> 2;
    out[o++] = (sextets[i + 2] & 3) << 6 | sextets[i + 3];
  }
  const tail = groups * 4;
  if (rem === 2) {
    out[o] = sextets[tail] << 2 | sextets[tail + 1] >> 4;
  } else if (rem === 3) {
    out[o++] = sextets[tail] << 2 | sextets[tail + 1] >> 4;
    out[o] = (sextets[tail + 1] & 15) << 4 | sextets[tail + 2] >> 2;
  }
  return out;
}
function bytesToBase64(data, urlSafe) {
  const chars = urlSafe ? B64URL_CHARS : B64_CHARS;
  const full = Math.floor(data.length / 3);
  let out = "";
  let i = 0;
  for (let g = 0; g < full; g++, i += 3) {
    const n = data[i] << 16 | data[i + 1] << 8 | data[i + 2];
    out += chars[n >> 18 & 63] + chars[n >> 12 & 63] + chars[n >> 6 & 63] + chars[n & 63];
  }
  const rem = data.length - i;
  if (rem === 1) {
    const n = data[i] << 16;
    out += chars[n >> 18 & 63] + chars[n >> 12 & 63];
    if (!urlSafe) out += "==";
  } else if (rem === 2) {
    const n = data[i] << 16 | data[i + 1] << 8;
    out += chars[n >> 18 & 63] + chars[n >> 12 & 63] + chars[n >> 6 & 63];
    if (!urlSafe) out += "=";
  }
  return out;
}
function hexValue(code) {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 102) return code - 87;
  if (code >= 65 && code <= 70) return code - 55;
  return -1;
}
function hexToBytes(str) {
  const max = str.length >>> 1;
  const out = new Uint8Array(max);
  let n = 0;
  for (; n < max; n++) {
    const hi = hexValue(str.charCodeAt(n * 2));
    const lo = hexValue(str.charCodeAt(n * 2 + 1));
    if (hi < 0 || lo < 0) break;
    out[n] = hi << 4 | lo;
  }
  return n === max ? out : out.subarray(0, n);
}
function bytesToBinaryString(data, mask) {
  const CHUNK = 8192;
  let out = "";
  for (let i = 0; i < data.length; i += CHUNK) {
    const slice = data.subarray(i, i + CHUNK);
    if (mask === 255) {
      out += String.fromCharCode.apply(null, slice);
    } else {
      const masked = new Uint8Array(slice.length);
      for (let j = 0; j < slice.length; j++) masked[j] = slice[j] & mask;
      out += String.fromCharCode.apply(null, masked);
    }
  }
  return out;
}
function decodeBuffer(data, encoding) {
  switch (assertEncoding(encoding)) {
    case "utf8":
      return utf8Decoder.decode(data);
    case "latin1":
      return bytesToBinaryString(data, 255);
    case "ascii":
      return bytesToBinaryString(data, 127);
    case "base64":
      return bytesToBase64(data, false);
    case "base64url":
      return bytesToBase64(data, true);
    case "hex": {
      let hex = "";
      for (let i = 0; i < data.length; i++) hex += data[i].toString(16).padStart(2, "0");
      return hex;
    }
    case "utf16le": {
      const even = data.length & 1 ? data.subarray(0, data.length - 1) : data;
      const decoded = utf16Decoder.decode(even);
      return decoded.includes("\uFFFD") ? utf16leRaw(even) : decoded;
    }
  }
}
function utf16leRaw(data) {
  const units = new Uint16Array(data.length >> 1);
  for (let i = 0; i < units.length; i++) units[i] = data[i * 2] | data[i * 2 + 1] << 8;
  const CHUNK = 8192;
  if (units.length <= CHUNK) return String.fromCharCode(...units);
  let out = "";
  for (let i = 0; i < units.length; i += CHUNK) {
    out += String.fromCharCode(...units.subarray(i, i + CHUNK));
  }
  return out;
}
function createStringDecoder(encoding) {
  const canonical = assertEncoding(encoding);
  if (canonical === "utf8") {
    const decoder9 = new TextDecoder("utf-8");
    return {
      write: (bytes) => decoder9.decode(bytes, { stream: true }),
      end: () => decoder9.decode()
    };
  }
  if (canonical === "utf16le" || canonical === "base64" || canonical === "base64url") {
    const unit = canonical === "utf16le" ? 2 : 3;
    const isUtf16 = canonical === "utf16le";
    let carry = new Uint8Array(0);
    return {
      write(bytes) {
        const joined = carry.length === 0 ? bytes : concatBytes(carry, bytes);
        let whole = joined.length - joined.length % unit;
        if (isUtf16 && whole >= 2) {
          const lastUnit = joined[whole - 2] | joined[whole - 1] << 8;
          if (lastUnit >= 55296 && lastUnit <= 56319) whole -= 2;
        }
        carry = new Uint8Array(joined.subarray(whole));
        return whole === 0 ? "" : decodeBuffer(joined.subarray(0, whole), canonical);
      },
      end() {
        if (carry.length === 0) return "";
        const rest = decodeBuffer(carry, canonical);
        carry = new Uint8Array(0);
        return rest;
      }
    };
  }
  return {
    write: (bytes) => bytes.length === 0 ? "" : decodeBuffer(bytes, canonical),
    end: () => ""
  };
}
function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
function encodeString(str, encoding) {
  switch (assertEncoding(encoding)) {
    case "utf8":
      return utf8Encoder.encode(str);
    case "latin1":
    case "ascii": {
      const buf = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) buf[i] = str.charCodeAt(i);
      return buf;
    }
    case "base64":
    case "base64url":
      return base64ToBytes(str);
    case "hex":
      return hexToBytes(str);
    case "utf16le": {
      const buf = new Uint8Array(str.length * 2);
      for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        buf[i * 2] = code & 255;
        buf[i * 2 + 1] = code >>> 8 & 255;
      }
      return buf;
    }
  }
}

// src/node-streams.ts
var SimpleEventEmitter = class {
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
  _listeners = /* @__PURE__ */ new Map();
  on(event, fn) {
    return this._add(event, fn, false, false);
  }
  addListener(event, fn) {
    return this.on(event, fn);
  }
  once(event, fn) {
    return this._add(event, fn, true, false);
  }
  prependListener(event, fn) {
    return this._add(event, fn, false, true);
  }
  prependOnceListener(event, fn) {
    return this._add(event, fn, true, true);
  }
  /**
   * The single registration path. `protected` because `NodeReadable` hooks it to start flowing
   * when a `'data'` listener appears — it used to override `on()`, which `once()` reached by
   * delegating to it. Now that `once`/`prepend*` build their records directly, overriding `on()`
   * would miss them, and `stream.once('data', …)` would never start the stream.
   */
  _add(event, fn, once, prepend) {
    let arr = this._listeners.get(event);
    if (!arr) {
      arr = [];
      this._listeners.set(event, arr);
    }
    const entry = { fn, once };
    if (prepend) arr.unshift(entry);
    else arr.push(entry);
    return this;
  }
  off(event, fn) {
    const arr = this._listeners.get(event);
    if (arr) {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i].fn === fn) {
          arr.splice(i, 1);
          break;
        }
      }
    }
    return this;
  }
  removeListener(event, fn) {
    return this.off(event, fn);
  }
  removeAllListeners(event) {
    if (event !== void 0) this._listeners.delete(event);
    else this._listeners.clear();
    return this;
  }
  emit(event, ...args) {
    const arr = this._listeners.get(event);
    if (!arr || arr.length === 0) {
      if (event === "error") {
        const err = args[0];
        if (err instanceof Error) throw err;
        throw Object.assign(new Error(`Unhandled error. (${String(err)})`), { code: "ERR_UNHANDLED_ERROR" });
      }
      return false;
    }
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
  listenerCount(event) {
    return this._listeners.get(event)?.length ?? 0;
  }
  listeners(event) {
    return (this._listeners.get(event) ?? []).map((e) => e.fn);
  }
  rawListeners(event) {
    return this.listeners(event);
  }
  /** Node caps listeners per emitter and warns past it; there is no cap here. Shape only. */
  setMaxListeners(_n) {
    return this;
  }
  getMaxListeners() {
    return 0;
  }
  eventNames() {
    return [...this._listeners.keys()].filter((k) => (this._listeners.get(k)?.length ?? 0) > 0);
  }
};
var NodeReadable = class extends SimpleEventEmitter {
  constructor(_readFn, destroyFn) {
    super();
    this._readFn = _readFn;
    if (destroyFn) this._destroyFn = destroyFn;
  }
  _paused = true;
  _destroyed = false;
  _ended = false;
  _reading = false;
  _readBuffer = null;
  _encoding = null;
  /**
   * Carries partial characters between chunks — see {@link createStringDecoder}.
   *
   * Decoding each chunk on its own turned every multi-byte character that straddled a 64 KB
   * chunk boundary into two U+FFFDs.
   */
  _decoder = null;
  /** Whether the stream is still readable (not ended or destroyed). */
  readable = true;
  /** The file path this stream reads from (set externally). */
  path = "";
  /** Total bytes read so far. */
  bytesRead = 0;
  /** Optional cleanup callback invoked on destroy (e.g. close file handle). */
  _destroyFn = null;
  // ---- Flow control (override on to auto-resume) ----
  _add(event, fn, once, prepend) {
    super._add(event, fn, once, prepend);
    if (event === "data" && this._paused) {
      this.resume();
    }
    return this;
  }
  pause() {
    this._paused = true;
    return this;
  }
  resume() {
    if (this._destroyed || this._ended) return this;
    this._paused = false;
    this._drain();
    return this;
  }
  /**
   * Set the character encoding for data read from this stream.
   * When set, 'data' events emit strings instead of Uint8Array.
   */
  setEncoding(encoding) {
    this._encoding = encoding;
    this._decoder = createStringDecoder(encoding);
    return this;
  }
  /**
   * Non-flowing read — returns the last buffered chunk or null.
   * Node.js has a complex buffer system; we keep it simple here.
   */
  read(_size) {
    const buf = this._readBuffer;
    this._readBuffer = null;
    return buf;
  }
  /** Destroy the stream, optionally with an error. */
  destroy(err) {
    if (this._destroyed) return this;
    this._destroyed = true;
    this.readable = false;
    if (err) {
      this.emit("error", err);
    }
    if (this._destroyFn) {
      this._destroyFn().then(
        () => this.emit("close"),
        () => this.emit("close")
      );
    } else {
      this.emit("close");
    }
    return this;
  }
  // ---- pipe ----
  pipe(dest) {
    if (isNodeWritableInstance(dest)) {
      this.on("data", (chunk) => {
        dest.write(chunk);
      });
      this.on("end", () => {
        if (typeof dest.end === "function") {
          dest.end();
        }
      });
      this.on("error", (err) => {
        if (typeof dest.destroy === "function") {
          dest.destroy(err);
        }
      });
    } else {
      const writer = dest.getWriter();
      this.on("data", (chunk) => {
        writer.write(chunk);
      });
      this.on("end", () => {
        writer.close();
      });
      this.on("error", (err) => {
        writer.abort(err);
      });
    }
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
  async *[Symbol.asyncIterator]() {
    const queue = [];
    let ended = false;
    let failure = null;
    let wake = null;
    const notify = () => {
      const w = wake;
      wake = null;
      w?.();
    };
    const onData = ((chunk) => {
      queue.push(chunk);
      this.pause();
      notify();
    });
    const onEnd = (() => {
      ended = true;
      notify();
    });
    const onError = ((err) => {
      failure = err;
      notify();
    });
    this.on("data", onData);
    this.on("end", onEnd);
    this.on("error", onError);
    this.resume();
    try {
      for (; ; ) {
        if (queue.length > 0) {
          const chunk = queue.shift();
          yield chunk;
          this.resume();
          continue;
        }
        if (failure) throw failure;
        if (ended || this._ended) return;
        await new Promise((resolve2) => {
          wake = resolve2;
        });
      }
    } finally {
      this.off("data", onData);
      this.off("end", onEnd);
      this.off("error", onError);
      if (!this._ended && !this._destroyed) this.destroy();
    }
  }
  async _drain() {
    if (this._reading || this._destroyed || this._ended) return;
    this._reading = true;
    try {
      while (!this._paused && !this._destroyed && !this._ended) {
        const result = await this._readFn();
        if (this._destroyed) break;
        if (result.done || !result.value || result.value.byteLength === 0) {
          this._ended = true;
          this.readable = false;
          if (this._decoder) {
            const tail = this._decoder.end();
            if (tail !== "") this.emit("data", tail);
          }
          this.emit("end");
          this.emit("close");
          break;
        }
        this.bytesRead += result.value.byteLength;
        this._readBuffer = result.value;
        if (this._decoder) {
          const text = this._decoder.write(result.value);
          if (text !== "") this.emit("data", text);
        } else {
          this.emit("data", result.value);
        }
      }
    } catch (err) {
      if (!this._destroyed) {
        this.destroy(err);
      }
    } finally {
      this._reading = false;
    }
  }
};
var NodeWritable = class extends SimpleEventEmitter {
  constructor(path, _writeFn, _closeFn, _defaultEncoding = "utf8") {
    super();
    this._writeFn = _writeFn;
    this._closeFn = _closeFn;
    this._defaultEncoding = _defaultEncoding;
    this.path = path;
  }
  /** Total bytes written so far. */
  bytesWritten = 0;
  /** The file path this stream was created for. */
  path;
  /** Whether this stream is still writable. */
  writable = true;
  _destroyed = false;
  _finished = false;
  _writing = false;
  _corked = false;
  /**
   * Set synchronously by `end()`, where `_finished` is only set once the queue has drained.
   *
   * Node rejects a write the moment `end()` has been called. Testing `_finished` instead let a
   * late write be accepted and queued, and whether it landed in the file, hit `EBADF`, or wrote
   * past a closed handle depended purely on whether close won the race.
   */
  _ending = false;
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
  _chain = Promise.resolve();
  // -- public API -----------------------------------------------------------
  /**
   * Buffer all writes until `uncork()` is called.
   * In this minimal implementation we only track the flag for compatibility.
   */
  cork() {
    this._corked = true;
  }
  /**
   * Flush buffered writes (clears the cork flag).
   * In this minimal implementation we only track the flag for compatibility.
   */
  uncork() {
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
  _emitError(err) {
    if (this.listenerCount("error") > 0) {
      this.emit("error", err);
      return;
    }
    setTimeout(() => {
      throw err;
    }, 0);
  }
  write(chunk, encodingOrCb, cb) {
    const callback = typeof encodingOrCb === "function" ? encodingOrCb : cb;
    const encoding = typeof encodingOrCb === "string" ? encodingOrCb : this._defaultEncoding;
    if (this._destroyed || this._finished || this._ending) {
      const err = streamWriteAfterEnd();
      if (callback) callback(err);
      queueMicrotask(() => this._emitError(err));
      return false;
    }
    const data = typeof chunk === "string" ? encodeString(chunk, encoding) : chunk;
    this._writing = true;
    this._chain = this._chain.then(() => this._writeFn(data)).then(
      () => {
        this.bytesWritten += data.byteLength;
        this._writing = false;
        if (callback) callback();
        this.emit("drain");
      },
      (err) => {
        this._writing = false;
        if (callback) callback(err);
        this._emitError(err);
      }
    );
    return true;
  }
  end(chunk, encodingOrCb, cb) {
    let callback;
    let finalChunk;
    let finalEncoding;
    if (typeof chunk === "function") {
      callback = chunk;
      finalChunk = void 0;
    } else {
      finalChunk = chunk;
      if (typeof encodingOrCb === "function") {
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
      this._chain.then(() => this._closeFn()).then(() => {
        this._finished = true;
        this.emit("finish");
        this.emit("close");
        if (callback) callback();
      }).catch((err) => {
        if (callback) callback(err);
        this._emitError(err);
      });
    };
    if (finalChunk !== void 0 && finalChunk !== null) {
      this.write(finalChunk, finalEncoding);
    }
    this._ending = true;
    finish();
    return this;
  }
  destroy(err) {
    if (this._destroyed) return this;
    this._destroyed = true;
    this.writable = false;
    this._closeFn().catch(() => {
    }).finally(() => {
      if (err) this.emit("error", err);
      this.emit("close");
    });
    return this;
  }
};
function isNodeWritableInstance(obj) {
  return obj !== null && typeof obj === "object" && typeof obj.write === "function" && !("getWriter" in obj);
}

// src/protocol/opcodes.ts
var OP = {
  READ: 1,
  WRITE: 2,
  UNLINK: 3,
  STAT: 4,
  LSTAT: 5,
  MKDIR: 6,
  RMDIR: 7,
  READDIR: 8,
  RENAME: 9,
  EXISTS: 10,
  TRUNCATE: 11,
  APPEND: 12,
  COPY: 13,
  ACCESS: 14,
  REALPATH: 15,
  CHMOD: 16,
  CHOWN: 17,
  UTIMES: 18,
  SYMLINK: 19,
  READLINK: 20,
  LINK: 21,
  OPEN: 22,
  CLOSE: 23,
  FREAD: 24,
  FWRITE: 25,
  FSTAT: 26,
  FTRUNCATE: 27,
  FSYNC: 28,
  OPENDIR: 29,
  MKDTEMP: 30,
  FCHMOD: 31,
  FCHOWN: 32,
  FUTIMES: 33,
  STATFS: 34
};
var SAB_OFFSETS = {
  CONTROL: 0,
  // Int32 - signal (0=idle, 1=request, 2=response, 3=chunk, 4=ack)
  TICKET_NEXT: 4,
  // Int32 - fairness lock: next ticket to hand out (fetch-add)
  TICKET_SERVING: 8,
  // Int32 - fairness lock: ticket currently allowed to use the SAB
  OPCODE: 4,
  // (alias of TICKET_NEXT) — op code is carried in the payload
  STATUS: 8,
  // (alias of TICKET_SERVING) — status is carried in the payload
  CHUNK_LEN: 12,
  // Int32 - bytes in this chunk
  TOTAL_LEN: 16,
  // BigUint64 - full data size across all chunks
  CHUNK_IDX: 24,
  // Int32 - 0-based chunk index
  HEARTBEAT: 28,
  // Int32 - liveness counter; the relay worker bumps this ~1×/s
  //         while its event loop is alive (incl. mid-await of a
  //         long op) so a spin-waiting main thread can tell
  //         "slow" from "dead". Never written by the main thread.
  HEADER_SIZE: 32
  // Data payload starts here
};
var SIGNAL = {
  IDLE: 0,
  REQUEST: 1,
  RESPONSE: 2,
  CHUNK: 3,
  CHUNK_ACK: 4
};
var encoder = new TextEncoder();
new TextDecoder();
function encodeRequest(op, path, flags = 0, data) {
  const pathBytes = encoder.encode(path);
  const dataLen = data ? data.byteLength : 0;
  const totalLen = 16 + pathBytes.byteLength + dataLen;
  const buf = new ArrayBuffer(totalLen);
  const view = new DataView(buf);
  view.setUint32(0, op, true);
  view.setUint32(4, flags, true);
  view.setUint32(8, pathBytes.byteLength, true);
  view.setUint32(12, dataLen, true);
  const bytes = new Uint8Array(buf);
  bytes.set(pathBytes, 16);
  if (data) {
    bytes.set(data, 16 + pathBytes.byteLength);
  }
  return buf;
}
function encodeRequestU32(op, path, flags, value) {
  const pathBytes = encoder.encode(path);
  const payloadOffset = 16 + pathBytes.byteLength;
  const buf = new ArrayBuffer(payloadOffset + 4);
  const view = new DataView(buf);
  view.setUint32(0, op, true);
  view.setUint32(4, flags, true);
  view.setUint32(8, pathBytes.byteLength, true);
  view.setUint32(12, 4, true);
  new Uint8Array(buf).set(pathBytes, 16);
  view.setUint32(payloadOffset, value >>> 0, true);
  return buf;
}
function decodeResponse(buf) {
  const view = new DataView(buf);
  const status = view.getUint32(0, true);
  const dataLen = view.getUint32(4, true);
  const data = dataLen > 0 ? new Uint8Array(buf, 8, dataLen) : null;
  return { status, data };
}
function encodeTwoPathRequest(op, path1, path2, flags = 0) {
  const path2Bytes = encoder.encode(path2);
  const payload = new Uint8Array(4 + path2Bytes.byteLength);
  const pv = new DataView(payload.buffer);
  pv.setUint32(0, path2Bytes.byteLength, true);
  payload.set(path2Bytes, 4);
  return encodeRequest(op, path1, flags, payload);
}

// src/protocol/fs-lock.ts
var NEXT_INDEX = SAB_OFFSETS.TICKET_NEXT >> 2;
var SERVING_INDEX = SAB_OFFSETS.TICKET_SERVING >> 2;
var SIGNAL_INDEX = SAB_OFFSETS.CONTROL >> 2;
var CAN_WAIT = typeof globalThis.WorkerGlobalScope !== "undefined";
var WAIT_SLICE_MS = 50;
var HOLDER_STUCK_MS = 3e4;
function now() {
  return performance.now();
}
function acquireFsLock(ctrl) {
  const ticket = Atomics.add(ctrl, NEXT_INDEX, 1);
  if (Atomics.load(ctrl, SERVING_INDEX) === ticket) return ticket;
  waitForTurn(ctrl, ticket);
  return ticket;
}
function releaseFsLock(ctrl) {
  Atomics.add(ctrl, SERVING_INDEX, 1);
  Atomics.notify(ctrl, SERVING_INDEX);
}
function waitForTurn(ctrl, ticket) {
  let serving = Atomics.load(ctrl, SERVING_INDEX);
  let sig = Atomics.load(ctrl, SIGNAL_INDEX);
  let progressAt = now();
  while (serving !== ticket) {
    if (CAN_WAIT) {
      Atomics.wait(ctrl, SERVING_INDEX, serving, WAIT_SLICE_MS);
    } else {
      const spinStart = now();
      while (now() - spinStart < WAIT_SLICE_MS && Atomics.load(ctrl, SERVING_INDEX) === serving) {
      }
    }
    const curServing = Atomics.load(ctrl, SERVING_INDEX);
    const curSig = Atomics.load(ctrl, SIGNAL_INDEX);
    if (curServing !== serving || curSig !== sig) {
      serving = curServing;
      sig = curSig;
      progressAt = now();
      continue;
    }
    if (now() - progressAt > HOLDER_STUCK_MS) {
      if (Atomics.compareExchange(ctrl, SERVING_INDEX, serving, serving + 1) === serving) {
        Atomics.store(ctrl, SIGNAL_INDEX, SIGNAL.IDLE);
        Atomics.notify(ctrl, SERVING_INDEX);
      }
      serving = Atomics.load(ctrl, SERVING_INDEX);
      sig = Atomics.load(ctrl, SIGNAL_INDEX);
      progressAt = now();
    }
  }
}

// src/protocol/payloads.ts
function encodeTruncatePayload(len) {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setFloat64(0, len, true);
  return buf;
}
function encodeFdPayload(fd) {
  const buf = new Uint8Array(4);
  writeU32(buf, 0, fd);
  return buf;
}
function encodeFreadPayload(fd, length, position) {
  const buf = new Uint8Array(16);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, fd, true);
  dv.setUint32(4, length, true);
  dv.setFloat64(8, position ?? -1, true);
  return buf;
}
function encodeFwritePayload(fd, position, data) {
  const buf = new Uint8Array(12 + data.byteLength);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, fd, true);
  dv.setFloat64(4, position ?? -1, true);
  buf.set(data, 12);
  return buf;
}
function encodeFtruncatePayload(fd, len) {
  const buf = new Uint8Array(12);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, fd, true);
  dv.setFloat64(4, len, true);
  return buf;
}
function writeU32(buf, at, value) {
  buf[at] = value;
  buf[at + 1] = value >>> 8;
  buf[at + 2] = value >>> 16;
  buf[at + 3] = value >>> 24;
}
function toEpochMs(time, name = "time") {
  return toUnixTimestamp(time, name) * 1e3;
}
function toUnixTimestamp(time, name = "time") {
  if (typeof time === "string" && String(Number(time)) === time.trim() && time.trim() !== "") {
    return Number(time);
  }
  if (typeof time === "number" && Number.isFinite(time)) {
    return time < 0 ? Date.now() / 1e3 : time;
  }
  if (time instanceof Date) return time.getTime() / 1e3;
  throw invalidArgType(name, "number | string | Date", time);
}

// src/methods/mode.ts
var OCTAL_STRING = /^[0-7]+$/;
function parseFileMode(mode, name, def) {
  mode ??= def;
  if (typeof mode === "string") {
    if (!OCTAL_STRING.test(mode)) {
      throw invalidArgValue(name, mode, "must be a 32-bit unsigned integer or an octal string");
    }
    return parseInt(mode, 8);
  }
  if (typeof mode !== "number") throw invalidArgType(name, "number", mode);
  if (!Number.isInteger(mode)) throw outOfRange(name, "an integer", mode);
  if (mode < 0 || mode > 4294967295) throw outOfRange(name, ">= 0 && <= 4294967295", mode);
  return mode;
}
function encodeMode(mode) {
  const buf = new Uint8Array(4);
  buf[0] = mode;
  buf[1] = mode >>> 8;
  buf[2] = mode >>> 16;
  buf[3] = mode >>> 24;
  return buf;
}

// src/vfs/layout.ts
var VFS_MAGIC = 1447449377;
var VFS_VERSION = 1;
var DEFAULT_BLOCK_SIZE = 4096;
var DEFAULT_INODE_COUNT = 1e5;
var INODE_SIZE = 64;
var SUPERBLOCK = {
  SIZE: 64,
  MAGIC: 0,
  // uint32 - 0x56465321
  VERSION: 4,
  // uint32
  INODE_COUNT: 8,
  // uint32 - total inodes allocated
  BLOCK_SIZE: 12,
  // uint32 - data block size (default 4096)
  TOTAL_BLOCKS: 16,
  // uint32 - total data blocks
  FREE_BLOCKS: 20,
  // uint32 - available data blocks
  INODE_OFFSET: 24,
  // float64 - byte offset to inode table
  PATH_OFFSET: 32,
  // float64 - byte offset to path table
  DATA_OFFSET: 40,
  // float64 - byte offset to data region
  BITMAP_OFFSET: 48,
  // float64 - byte offset to free block bitmap
  PATH_USED: 56,
  // uint32 - bytes used in path table
  CRC32: 60
  // uint32 - CRC-32 of superblock bytes 0..59.
  //   0 = legacy file written before checksumming existed
  //   (validation skipped; upgraded on next superblock write).
};
var INODE = {
  TYPE: 0,
  // uint8 - 0=free, 1=file, 2=directory, 3=symlink
  FLAGS: 1,
  // uint8[3] - reserved
  PATH_OFFSET: 4,
  // uint32 - byte offset into path table
  PATH_LENGTH: 8,
  // uint16 - length of path string
  NLINK: 10,
  // uint16 - hard link count
  MODE: 12,
  // uint32 - permissions (e.g. 0o100644)
  SIZE: 16,
  // float64 - file content size in bytes (using f64 for >4GB)
  FIRST_BLOCK: 24,
  // uint32 - index of first data block
  BLOCK_COUNT: 28,
  // uint32 - number of contiguous data blocks
  MTIME: 32,
  // float64 - last modification time (ms since epoch)
  CTIME: 40,
  // float64 - creation/change time (ms since epoch)
  ATIME: 48,
  // float64 - last access time (ms since epoch)
  UID: 56,
  // uint32 - owner
  GID: 60
  // uint32 - group
};
var INODE_TYPE = {
  FREE: 0,
  FILE: 1,
  DIRECTORY: 2,
  SYMLINK: 3
};
var DEFAULT_FILE_MODE = 33188;
var DEFAULT_DIR_MODE = 16877;
var DEFAULT_SYMLINK_MODE = 41471;
var DEFAULT_UMASK = 18;
var S_IFMT = 61440;
var S_IFREG = 32768;
var S_IFDIR = 16384;
var MAX_SYMLINK_DEPTH = 40;
var INITIAL_PATH_TABLE_SIZE = 256 * 1024;
var INITIAL_DATA_BLOCKS = 1024;
var MAX_DATA_BLOCKS = 4e6;
function calculateLayout(inodeCount = DEFAULT_INODE_COUNT, blockSize = DEFAULT_BLOCK_SIZE, totalBlocks = INITIAL_DATA_BLOCKS, maxBlocks = MAX_DATA_BLOCKS) {
  const inodeTableOffset = SUPERBLOCK.SIZE;
  const inodeTableSize = inodeCount * INODE_SIZE;
  const pathTableOffset = inodeTableOffset + inodeTableSize;
  const pathTableSize = INITIAL_PATH_TABLE_SIZE;
  const bitmapOffset = pathTableOffset + pathTableSize;
  const bitmapRegionSize = Math.ceil(maxBlocks / 8);
  const bitmapSize = Math.ceil(totalBlocks / 8);
  const dataOffset = Math.ceil((bitmapOffset + bitmapRegionSize) / blockSize) * blockSize;
  const totalSize = dataOffset + totalBlocks * blockSize;
  return {
    inodeTableOffset,
    inodeTableSize,
    pathTableOffset,
    pathTableSize,
    bitmapOffset,
    bitmapSize,
    bitmapRegionSize,
    dataOffset,
    totalSize,
    totalBlocks
  };
}

// src/stats-classes.ts
var S_IFMT2 = 61440;
var S_IFREG2 = 32768;
var S_IFDIR2 = 16384;
var S_IFLNK = 40960;
var S_IFBLK = 24576;
var S_IFCHR = 8192;
var S_IFIFO = 4096;
var S_IFSOCK = 49152;
var Stats = class {
  dev;
  mode;
  nlink;
  uid;
  gid;
  rdev;
  blksize;
  ino;
  size;
  blocks;
  atimeMs;
  mtimeMs;
  ctimeMs;
  birthtimeMs;
  constructor(dev, mode, nlink, uid, gid, rdev, blksize, ino, size, blocks, atimeMs, mtimeMs, ctimeMs, birthtimeMs) {
    this.dev = dev;
    this.mode = mode;
    this.nlink = nlink;
    this.uid = uid;
    this.gid = gid;
    this.rdev = rdev;
    this.blksize = blksize;
    this.ino = ino;
    this.size = size;
    this.blocks = blocks;
    this.atimeMs = atimeMs;
    this.mtimeMs = mtimeMs;
    this.ctimeMs = ctimeMs;
    this.birthtimeMs = birthtimeMs;
  }
  /** node's own helper name, kept so code that pokes at it behaves the same. */
  _checkModeProperty(type) {
    return (this.mode & S_IFMT2) === type;
  }
  isFile() {
    return this._checkModeProperty(S_IFREG2);
  }
  isDirectory() {
    return this._checkModeProperty(S_IFDIR2);
  }
  isSymbolicLink() {
    return this._checkModeProperty(S_IFLNK);
  }
  isBlockDevice() {
    return this._checkModeProperty(S_IFBLK);
  }
  isCharacterDevice() {
    return this._checkModeProperty(S_IFCHR);
  }
  isFIFO() {
    return this._checkModeProperty(S_IFIFO);
  }
  isSocket() {
    return this._checkModeProperty(S_IFSOCK);
  }
  // Built on first read, then cached — most callers never touch them. Native private fields
  // rather than symbol-keyed properties: a symbol write pushes the object into dictionary mode,
  // which measured slower than the closures it was meant to replace.
  #atime;
  #mtime;
  #ctime;
  #birthtime;
  get atime() {
    return this.#atime ??= new Date(this.atimeMs);
  }
  get mtime() {
    return this.#mtime ??= new Date(this.mtimeMs);
  }
  get ctime() {
    return this.#ctime ??= new Date(this.ctimeMs);
  }
  get birthtime() {
    return this.#birthtime ??= new Date(this.birthtimeMs);
  }
  // Not node's — see the file comment. Kept readable for backward compatibility.
  get atimeNs() {
    return this.atimeMs * 1e6;
  }
  get mtimeNs() {
    return this.mtimeMs * 1e6;
  }
  get ctimeNs() {
    return this.ctimeMs * 1e6;
  }
  get birthtimeNs() {
    return this.birthtimeMs * 1e6;
  }
};
var BigIntStats = class {
  dev;
  mode;
  nlink;
  uid;
  gid;
  rdev;
  blksize;
  ino;
  size;
  blocks;
  atimeMs;
  mtimeMs;
  ctimeMs;
  birthtimeMs;
  atimeNs;
  mtimeNs;
  ctimeNs;
  birthtimeNs;
  constructor(dev, mode, nlink, uid, gid, rdev, blksize, ino, size, blocks, atimeMs, mtimeMs, ctimeMs, birthtimeMs) {
    this.dev = dev;
    this.mode = mode;
    this.nlink = nlink;
    this.uid = uid;
    this.gid = gid;
    this.rdev = rdev;
    this.blksize = blksize;
    this.ino = ino;
    this.size = size;
    this.blocks = blocks;
    this.atimeMs = atimeMs;
    this.mtimeMs = mtimeMs;
    this.ctimeMs = ctimeMs;
    this.birthtimeMs = birthtimeMs;
    this.atimeNs = atimeMs * 1000000n;
    this.mtimeNs = mtimeMs * 1000000n;
    this.ctimeNs = ctimeMs * 1000000n;
    this.birthtimeNs = birthtimeMs * 1000000n;
  }
  _checkModeProperty(type) {
    return (this.mode & BigInt(S_IFMT2)) === BigInt(type);
  }
  isFile() {
    return this._checkModeProperty(S_IFREG2);
  }
  isDirectory() {
    return this._checkModeProperty(S_IFDIR2);
  }
  isSymbolicLink() {
    return this._checkModeProperty(S_IFLNK);
  }
  isBlockDevice() {
    return this._checkModeProperty(S_IFBLK);
  }
  isCharacterDevice() {
    return this._checkModeProperty(S_IFCHR);
  }
  isFIFO() {
    return this._checkModeProperty(S_IFIFO);
  }
  isSocket() {
    return this._checkModeProperty(S_IFSOCK);
  }
  #atime;
  #mtime;
  #ctime;
  #birthtime;
  get atime() {
    return this.#atime ??= new Date(Number(this.atimeMs));
  }
  get mtime() {
    return this.#mtime ??= new Date(Number(this.mtimeMs));
  }
  get ctime() {
    return this.#ctime ??= new Date(Number(this.ctimeMs));
  }
  get birthtime() {
    return this.#birthtime ??= new Date(Number(this.birthtimeMs));
  }
};
var Dirent = class _Dirent {
  name;
  parentPath;
  /**
   * A native private field, not a symbol-keyed property: it stays out of `Object.keys`,
   * `JSON.stringify` and spreads exactly like node's internal type slot, and unlike a symbol it
   * does not push the object into dictionary mode — measured, a symbol here made `Dirent`
   * construction *slower* than the object literal it replaced.
   */
  #type;
  constructor(name, type, parentPath) {
    this.name = name;
    this.parentPath = parentPath;
    this.#type = type;
  }
  /** @deprecated Alias of `parentPath`. Node removed this in v24; kept here for compatibility. */
  get path() {
    return this.parentPath;
  }
  /**
   * The same entry reported under a different parent directory — what recursive `readdir` needs.
   *
   * Copying `isFile`/`isDirectory`/… off the source entry into a new object literal (which is
   * what the recursive walk used to do) only worked while those were per-instance closures. With
   * the predicates on the prototype they read the entry type through `this`, so a bare function
   * reference lands on an object that has no type and reports false for everything.
   */
  withParentPath(parentPath) {
    return new _Dirent(this.name, this.#type, parentPath);
  }
  isFile() {
    return this.#type === INODE_TYPE.FILE;
  }
  isDirectory() {
    return this.#type === INODE_TYPE.DIRECTORY;
  }
  isSymbolicLink() {
    return this.#type === INODE_TYPE.SYMLINK;
  }
  isBlockDevice() {
    return false;
  }
  isCharacterDevice() {
    return false;
  }
  isFIFO() {
    return false;
  }
  isSocket() {
    return false;
  }
};

// src/stats.ts
function decodeStats(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  view.getUint8(0);
  const mode = view.getUint32(1, true);
  const size = view.getFloat64(5, true);
  const mtimeMs = view.getFloat64(13, true);
  const ctimeMs = view.getFloat64(21, true);
  const atimeMs = view.getFloat64(29, true);
  const uid = view.getUint32(37, true);
  const gid = view.getUint32(41, true);
  const ino = view.getUint32(45, true);
  const nlink = data.byteLength >= 53 ? view.getUint32(49, true) : 1;
  return new Stats(
    1,
    mode,
    nlink,
    uid,
    gid,
    0,
    4096,
    ino,
    size,
    Math.ceil(size / 512),
    atimeMs,
    mtimeMs,
    ctimeMs,
    ctimeMs
  );
}
function decodeStatsBigInt(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  view.getUint8(0);
  const mode = view.getUint32(1, true);
  const size = view.getFloat64(5, true);
  const mtimeMs = view.getFloat64(13, true);
  const ctimeMs = view.getFloat64(21, true);
  const atimeMs = view.getFloat64(29, true);
  const uid = view.getUint32(37, true);
  const gid = view.getUint32(41, true);
  const ino = view.getUint32(45, true);
  const nlink = data.byteLength >= 53 ? view.getUint32(49, true) : 1;
  return new BigIntStats(
    1n,
    BigInt(mode),
    BigInt(nlink),
    BigInt(uid),
    BigInt(gid),
    0n,
    4096n,
    BigInt(ino),
    BigInt(Math.trunc(size)),
    BigInt(Math.ceil(size / 512)),
    BigInt(Math.trunc(atimeMs)),
    BigInt(Math.trunc(mtimeMs)),
    BigInt(Math.trunc(ctimeMs)),
    BigInt(Math.trunc(ctimeMs))
  );
}
function decodeDirents(data, parentPath = "") {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(0, true);
  const decoder9 = new TextDecoder();
  const entries = [];
  let offset = 4;
  for (let i = 0; i < count; i++) {
    const nameLen = view.getUint16(offset, true);
    offset += 2;
    const name = decoder9.decode(data.subarray(offset, offset + nameLen));
    offset += nameLen;
    const type = data[offset++];
    entries.push(new Dirent(name, type, parentPath));
  }
  return entries;
}
function decodeNames(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(0, true);
  const decoder9 = new TextDecoder();
  const names = [];
  let offset = 4;
  for (let i = 0; i < count; i++) {
    const nameLen = view.getUint16(offset, true);
    offset += 2;
    names.push(decoder9.decode(data.subarray(offset, offset + nameLen)));
    offset += nameLen;
  }
  return names;
}

// src/handle-streams.ts
function byteBudget(start, end) {
  return end === void 0 ? Infinity : end - (start ?? 0) + 1;
}
function readStreamFromHandle(source, options) {
  const opts = typeof options === "string" ? { encoding: options } : options;
  const start = opts?.start;
  const highWaterMark = opts?.highWaterMark ?? 64 * 1024;
  let position = start ?? (source.followCursor ? void 0 : 0);
  let remaining = byteBudget(start, opts?.end);
  let handle = null;
  let finished = false;
  const cleanup = async () => {
    if (handle && source.autoClose) {
      try {
        await handle.close();
      } catch {
      }
    }
    handle = null;
  };
  const readFn = async () => {
    if (finished) return { done: true };
    if (!handle) handle = await source.acquire();
    const readLen = Math.min(highWaterMark, remaining);
    if (readLen <= 0) {
      finished = true;
      await cleanup();
      return { done: true };
    }
    const buffer = new Uint8Array(readLen);
    const { bytesRead } = await handle.read(buffer, 0, readLen, position ?? null);
    if (bytesRead === 0) {
      finished = true;
      await cleanup();
      return { done: true };
    }
    if (position !== void 0) position += bytesRead;
    remaining -= bytesRead;
    if (remaining <= 0) {
      finished = true;
      await cleanup();
    }
    return { done: false, value: buffer.subarray(0, bytesRead) };
  };
  const stream = new NodeReadable(readFn, cleanup);
  stream.path = source.path;
  if (opts?.encoding) stream.setEncoding(opts.encoding);
  return stream;
}
function writeStreamFromHandle(source, options) {
  const opts = typeof options === "string" ? { encoding: options } : options;
  let position = opts?.start ?? (source.followCursor ? void 0 : 0);
  let handle = null;
  const writeFn = async (chunk) => {
    if (!handle) handle = await source.acquire();
    const { bytesWritten } = await handle.write(chunk, 0, chunk.byteLength, position ?? null);
    if (position !== void 0) position += bytesWritten;
  };
  const closeFn = async () => {
    if (!handle) return;
    if (opts?.flush) await handle.sync();
    if (source.autoClose) await handle.close();
    handle = null;
  };
  return new NodeWritable(source.path, writeFn, closeFn, opts?.encoding ?? "utf8");
}
async function* linesFromStream(stream) {
  const decoder9 = new TextDecoder();
  let carry = "";
  for await (const chunk of stream) {
    carry += typeof chunk === "string" ? chunk : decoder9.decode(chunk, { stream: true });
    let nl = carry.indexOf("\n");
    while (nl !== -1) {
      const line = carry.slice(0, nl);
      yield line.endsWith("\r") ? line.slice(0, -1) : line;
      carry = carry.slice(nl + 1);
      nl = carry.indexOf("\n");
    }
  }
  carry += decoder9.decode();
  if (carry.length > 0) yield carry.endsWith("\r") ? carry.slice(0, -1) : carry;
}
function webStreamFromHandle(source, highWaterMark = 64 * 1024) {
  let handle = null;
  let position = source.followCursor ? void 0 : 0;
  return new ReadableStream({
    async pull(controller) {
      if (!handle) handle = await source.acquire();
      const buffer = new Uint8Array(highWaterMark);
      const { bytesRead } = await handle.read(buffer, 0, highWaterMark, position ?? null);
      if (bytesRead === 0) {
        controller.close();
        if (source.autoClose) {
          try {
            await handle.close();
          } catch {
          }
        }
        handle = null;
        return;
      }
      if (position !== void 0) position += bytesRead;
      controller.enqueue(buffer.subarray(0, bytesRead));
    },
    async cancel() {
      if (handle && source.autoClose) {
        try {
          await handle.close();
        } catch {
        }
      }
      handle = null;
    }
  });
}

// src/constants.ts
var constants = {
  // File access constants
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
  // File copy constants
  COPYFILE_EXCL: 1,
  COPYFILE_FICLONE: 2,
  COPYFILE_FICLONE_FORCE: 4,
  // File open constants
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  O_CREAT: 64,
  O_EXCL: 128,
  O_TRUNC: 512,
  O_APPEND: 1024,
  O_NOCTTY: 256,
  O_NONBLOCK: 2048,
  O_SYNC: 4096,
  O_DSYNC: 4096,
  O_DIRECTORY: 65536,
  O_NOFOLLOW: 131072,
  O_NOATIME: 262144,
  // File type constants
  S_IFMT: 61440,
  S_IFREG: 32768,
  S_IFDIR: 16384,
  S_IFCHR: 8192,
  S_IFBLK: 24576,
  S_IFIFO: 4096,
  S_IFLNK: 40960,
  S_IFSOCK: 49152,
  // File mode constants
  S_IRWXU: 448,
  S_IRUSR: 256,
  S_IWUSR: 128,
  S_IXUSR: 64,
  S_IRWXG: 56,
  S_IRGRP: 32,
  S_IWGRP: 16,
  S_IXGRP: 8,
  S_IRWXO: 7,
  S_IROTH: 4,
  S_IWOTH: 2,
  S_IXOTH: 1,
  // ---- libuv-level constants Node re-exports ----
  //
  // Node exposes libuv's own numbering on `fs.constants`, and the `UV_DIRENT_*` set is the part
  // real code reads: a `Dirent`'s type is one of these numbers, so anything comparing types
  // numerically rather than calling `isFile()`/`isDirectory()` needs them to exist. The rest are
  // included for completeness, with the values taken from a live `node:fs`.
  UV_DIRENT_UNKNOWN: 0,
  UV_DIRENT_FILE: 1,
  UV_DIRENT_DIR: 2,
  UV_DIRENT_LINK: 3,
  UV_DIRENT_FIFO: 4,
  UV_DIRENT_SOCKET: 5,
  UV_DIRENT_CHAR: 6,
  UV_DIRENT_BLOCK: 7,
  // Windows-only in Node; defined so a cross-platform `constants.X` read does not come back
  // `undefined` and silently change a bitmask.
  UV_FS_SYMLINK_DIR: 1,
  UV_FS_SYMLINK_JUNCTION: 2,
  UV_FS_O_FILEMAP: 0,
  // macOS-only in Node. We have no O_SYMLINK behaviour to offer, but the value is here so the
  // flag can be tested for rather than crashing on a missing property.
  O_SYMLINK: 2097152,
  // The `UV_`-prefixed spellings of the copyfile flags; identical values to `COPYFILE_*` above.
  UV_FS_COPYFILE_EXCL: 1,
  UV_FS_COPYFILE_FICLONE: 2,
  UV_FS_COPYFILE_FICLONE_FORCE: 4
};

// src/methods/open.ts
var encoder2 = new TextEncoder();
new TextDecoder();
function parseFlags(flags) {
  const { O_RDONLY, O_RDWR, O_WRONLY, O_CREAT, O_TRUNC, O_APPEND, O_EXCL } = constants;
  switch (flags) {
    case "r":
      return O_RDONLY;
    case "rs":
      return O_RDONLY;
    // O_SYNC — see above
    case "r+":
      return O_RDWR;
    case "rs+":
      return O_RDWR;
    case "w":
      return O_WRONLY | O_CREAT | O_TRUNC;
    case "wx":
      return O_WRONLY | O_CREAT | O_TRUNC | O_EXCL;
    case "w+":
      return O_RDWR | O_CREAT | O_TRUNC;
    case "wx+":
      return O_RDWR | O_CREAT | O_TRUNC | O_EXCL;
    case "a":
      return O_WRONLY | O_CREAT | O_APPEND;
    case "ax":
      return O_WRONLY | O_CREAT | O_APPEND | O_EXCL;
    case "as":
      return O_WRONLY | O_CREAT | O_APPEND;
    case "a+":
      return O_RDWR | O_CREAT | O_APPEND;
    case "ax+":
      return O_RDWR | O_CREAT | O_APPEND | O_EXCL;
    case "as+":
      return O_RDWR | O_CREAT | O_APPEND;
    default:
      throw invalidArgValue("flags", flags, "is invalid");
  }
}
var DEFAULT_OPEN_MODE = 438;
function resolveOpenMode(mode) {
  return mode === void 0 ? DEFAULT_OPEN_MODE : parseFileMode(mode, "mode");
}
function openSync(syncRequest, filePath, flags = "r", mode) {
  const numFlags = typeof flags === "string" ? parseFlags(flags) : flags;
  const buf = encodeRequestU32(OP.OPEN, filePath, numFlags, resolveOpenMode(mode));
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "open", filePath);
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true);
}
function closeSync(syncRequest, fd) {
  const buf = encodeRequest(OP.CLOSE, "", 0, encodeFdPayload(fd));
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "close", String(fd));
}
function readSync(syncRequest, fd, bufferOrOptions, offsetOrOptions, length, position) {
  let buffer;
  let off, len, pos;
  if (bufferOrOptions instanceof Uint8Array) {
    buffer = bufferOrOptions;
    if (offsetOrOptions != null && typeof offsetOrOptions === "object") {
      off = offsetOrOptions.offset ?? 0;
      len = offsetOrOptions.length ?? buffer.byteLength;
      pos = offsetOrOptions.position ?? null;
    } else {
      off = offsetOrOptions ?? 0;
      len = length ?? buffer.byteLength;
      pos = position ?? null;
    }
  } else {
    buffer = bufferOrOptions.buffer;
    off = bufferOrOptions.offset ?? 0;
    len = bufferOrOptions.length ?? buffer.byteLength;
    pos = bufferOrOptions.position ?? null;
  }
  const buf = encodeRequest(OP.FREAD, "", 0, encodeFreadPayload(fd, len, pos));
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "read", String(fd));
  if (data) {
    buffer.set(data.subarray(0, Math.min(data.byteLength, len)), off);
    return data.byteLength;
  }
  return 0;
}
function writeSyncFd(syncRequest, fd, bufferOrString, offsetOrPositionOrOptions, lengthOrEncoding, position) {
  let writeData;
  let pos;
  if (typeof bufferOrString === "string") {
    writeData = encoder2.encode(bufferOrString);
    pos = offsetOrPositionOrOptions != null && typeof offsetOrPositionOrOptions === "number" ? offsetOrPositionOrOptions : null;
  } else if (offsetOrPositionOrOptions != null && typeof offsetOrPositionOrOptions === "object") {
    const offset = offsetOrPositionOrOptions.offset ?? 0;
    const length = offsetOrPositionOrOptions.length ?? bufferOrString.byteLength;
    pos = offsetOrPositionOrOptions.position ?? null;
    writeData = bufferOrString.subarray(offset, offset + length);
  } else {
    const offset = offsetOrPositionOrOptions ?? 0;
    const length = lengthOrEncoding != null ? lengthOrEncoding : bufferOrString.byteLength;
    pos = position ?? null;
    writeData = bufferOrString.subarray(offset, offset + length);
  }
  const buf = encodeRequest(OP.FWRITE, "", 0, encodeFwritePayload(fd, pos, writeData));
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "write", String(fd));
  return data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
}
function fstatSync(syncRequest, fd, options) {
  const buf = encodeRequest(OP.FSTAT, "", 0, encodeFdPayload(fd));
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "fstat", String(fd));
  return options?.bigint ? decodeStatsBigInt(data) : decodeStats(data);
}
function ftruncateSync(syncRequest, fd, len = 0) {
  const buf = encodeRequest(OP.FTRUNCATE, "", 0, encodeFtruncatePayload(fd, len));
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "ftruncate", String(fd));
}
function fdatasyncSync(syncRequest, fd, syscall = "fdatasync") {
  const buf = encodeRequest(OP.FSYNC, "", 0, encodeFdPayload(fd));
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, syscall, String(fd));
}
async function open(asyncRequest, filePath, flags, mode) {
  const numFlags = typeof flags === "string" ? parseFlags(flags ?? "r") : flags ?? 0;
  const { status, data } = await asyncRequest(OP.OPEN, filePath, numFlags, encodeMode(resolveOpenMode(mode)));
  if (status !== 0) throw statusToError(status, "open", filePath);
  const fd = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true);
  return createFileHandle(fd, asyncRequest);
}
function createFileHandle(fd, asyncRequest) {
  const events = new SimpleEventEmitter();
  const handle = {
    fd,
    async read(bufferOrOptions, offsetOrOptions, length, position) {
      let buffer;
      let off, len, pos;
      if (bufferOrOptions instanceof Uint8Array) {
        buffer = bufferOrOptions;
        if (offsetOrOptions != null && typeof offsetOrOptions === "object") {
          off = offsetOrOptions.offset ?? 0;
          len = offsetOrOptions.length ?? buffer.byteLength;
          pos = offsetOrOptions.position ?? null;
        } else {
          off = offsetOrOptions ?? 0;
          len = length ?? buffer.byteLength;
          pos = position ?? null;
        }
      } else {
        buffer = bufferOrOptions.buffer;
        off = bufferOrOptions.offset ?? 0;
        len = bufferOrOptions.length ?? buffer.byteLength;
        pos = bufferOrOptions.position ?? null;
      }
      const { status, data } = await asyncRequest(OP.FREAD, "", 0, null, void 0, { fd, length: len, position: pos ?? -1 });
      if (status !== 0) throw statusToError(status, "read", String(fd));
      const bytesRead = data ? data.byteLength : 0;
      if (data) buffer.set(data.subarray(0, Math.min(bytesRead, len)), off);
      return { bytesRead, buffer };
    },
    async write(bufferOrString, offsetOrPositionOrOptions, lengthOrEncoding, position) {
      let writeData;
      let pos;
      let resultBuffer;
      if (typeof bufferOrString === "string") {
        resultBuffer = encoder2.encode(bufferOrString);
        writeData = resultBuffer;
        pos = offsetOrPositionOrOptions != null && typeof offsetOrPositionOrOptions === "number" ? offsetOrPositionOrOptions : -1;
      } else if (offsetOrPositionOrOptions != null && typeof offsetOrPositionOrOptions === "object") {
        resultBuffer = bufferOrString;
        const offset = offsetOrPositionOrOptions.offset ?? 0;
        const length = offsetOrPositionOrOptions.length ?? bufferOrString.byteLength;
        pos = offsetOrPositionOrOptions.position != null ? offsetOrPositionOrOptions.position : -1;
        writeData = bufferOrString.subarray(offset, offset + length);
      } else {
        resultBuffer = bufferOrString;
        const offset = offsetOrPositionOrOptions ?? 0;
        const length = lengthOrEncoding != null ? lengthOrEncoding : bufferOrString.byteLength;
        pos = position != null ? position : -1;
        writeData = bufferOrString.subarray(offset, offset + length);
      }
      const { status, data } = await asyncRequest(OP.FWRITE, "", 0, null, void 0, { fd, data: writeData, position: pos });
      if (status !== 0) throw statusToError(status, "write", String(fd));
      const bytesWritten = data ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) : 0;
      return { bytesWritten, buffer: resultBuffer };
    },
    async readv(buffers, position) {
      let totalRead = 0;
      let pos = position ?? null;
      for (const buf of buffers) {
        const { bytesRead } = await this.read(buf, 0, buf.byteLength, pos);
        totalRead += bytesRead;
        if (pos !== null) pos += bytesRead;
        if (bytesRead < buf.byteLength) break;
      }
      return { bytesRead: totalRead, buffers };
    },
    async writev(buffers, position) {
      let totalWritten = 0;
      let pos = position ?? null;
      for (const buf of buffers) {
        const { bytesWritten } = await this.write(buf, 0, buf.byteLength, pos);
        totalWritten += bytesWritten;
        if (pos !== null) pos += bytesWritten;
      }
      return { bytesWritten: totalWritten, buffers };
    },
    async readFile(options) {
      const encoding = typeof options === "string" ? options : options?.encoding;
      const { status, data } = await asyncRequest(OP.FREAD, "", 0, null, void 0, { fd, length: Number.MAX_SAFE_INTEGER, position: -1 });
      if (status !== 0) throw statusToError(status, "read", String(fd));
      const result = data ?? new Uint8Array(0);
      if (encoding) return decodeBuffer(result, encoding);
      return result;
    },
    async writeFile(data, options) {
      const encoding = typeof options === "string" ? options : options?.encoding;
      const encoded = typeof data === "string" ? encoding ? encodeString(data, encoding) : encoder2.encode(data) : data;
      const { status } = await asyncRequest(OP.FWRITE, "", 0, null, void 0, { fd, data: encoded, position: -1 });
      if (status !== 0) throw statusToError(status, "write", String(fd));
    },
    async truncate(len = 0) {
      const { status } = await asyncRequest(OP.FTRUNCATE, "", 0, null, void 0, { fd, length: len });
      if (status !== 0) throw statusToError(status, "ftruncate", String(fd));
    },
    async stat() {
      const { status, data } = await asyncRequest(OP.FSTAT, "", 0, null, void 0, { fd });
      if (status !== 0) throw statusToError(status, "fstat", String(fd));
      return decodeStats(data);
    },
    /**
     * In Node this is a documented **alias of `writeFile`** — the appending comes from opening
     * with `'a'` (O_APPEND), not from the method. Seeking to end-of-file here made
     * `handle.appendFile()` on an `'r+'` handle write past the cursor, where Node overwrites at
     * it, and cost an extra `fstat` round-trip per call.
     */
    async appendFile(data, options) {
      return this.writeFile(data, options);
    },
    async chmod(mode) {
      const payload = new Uint8Array(8);
      const dv = new DataView(payload.buffer);
      dv.setUint32(0, fd, true);
      dv.setUint32(4, mode, true);
      const { status } = await asyncRequest(OP.FCHMOD, "", 0, payload);
      if (status !== 0) throw statusToError(status, "fchmod", String(fd));
    },
    async chown(uid, gid) {
      const payload = new Uint8Array(12);
      const dv = new DataView(payload.buffer);
      dv.setUint32(0, fd, true);
      dv.setUint32(4, uid, true);
      dv.setUint32(8, gid, true);
      const { status } = await asyncRequest(OP.FCHOWN, "", 0, payload);
      if (status !== 0) throw statusToError(status, "fchown", String(fd));
    },
    async utimes(atime, mtime) {
      const payload = new Uint8Array(24);
      const dv = new DataView(payload.buffer);
      dv.setUint32(0, fd, true);
      dv.setFloat64(8, toEpochMs(atime, "atime"), true);
      dv.setFloat64(16, toEpochMs(mtime, "mtime"), true);
      const { status } = await asyncRequest(OP.FUTIMES, "", 0, payload);
      if (status !== 0) throw statusToError(status, "futimes", String(fd));
    },
    async sync() {
      const { status } = await asyncRequest(OP.FSYNC, "", 0, null, void 0, { fd });
      if (status !== 0) throw statusToError(status, "fsync", String(fd));
    },
    async datasync() {
      const { status } = await asyncRequest(OP.FSYNC, "", 0, null, void 0, { fd });
      if (status !== 0) throw statusToError(status, "fdatasync", String(fd));
    },
    async close() {
      const { status } = await asyncRequest(OP.CLOSE, "", 0, null, void 0, { fd });
      if (status !== 0) throw statusToError(status, "close", String(fd));
      events.emit("close");
    },
    [Symbol.asyncDispose]() {
      return this.close();
    },
    // ---- Streams over this handle ----
    //
    // All four were missing. A stream built from a handle **owns** it: node closes the handle
    // when the stream ends, so `handle.stat()` afterwards is EBADF. `autoClose: false` opts out.
    // The machinery is shared with `fs.createReadStream`/`createWriteStream` so the two cannot
    // drift — see [handle-streams.ts](../handle-streams.ts).
    createReadStream(options) {
      return readStreamFromHandle(handleSource(options), options);
    },
    createWriteStream(options) {
      return writeStreamFromHandle(handleSource(options), options);
    },
    readLines(options) {
      return linesFromStream(readStreamFromHandle(handleSource(options), options));
    },
    readableWebStream(_options) {
      return webStreamFromHandle(handleSource(void 0));
    },
    // ---- EventEmitter surface ----
    //
    // All of it, not the five methods this used to forward. Node's `FileHandle` is a real
    // `EventEmitter`, so code that keeps a handle around and calls `removeAllListeners()` on
    // teardown, or `listenerCount('close')` to decide whether to wire something up, hits an
    // "is not a function" on a partial implementation — and the missing ones were the
    // housekeeping methods, which is exactly what long-lived objects use.
    on(event, listener) {
      events.on(event, listener);
      return this;
    },
    addListener(event, listener) {
      events.on(event, listener);
      return this;
    },
    once(event, listener) {
      events.once(event, listener);
      return this;
    },
    off(event, listener) {
      events.off(event, listener);
      return this;
    },
    removeListener(event, listener) {
      events.off(event, listener);
      return this;
    },
    removeAllListeners(event) {
      events.removeAllListeners(event);
      return this;
    },
    prependListener(event, listener) {
      events.prependListener(event, listener);
      return this;
    },
    prependOnceListener(event, listener) {
      events.prependOnceListener(event, listener);
      return this;
    },
    listeners(event) {
      return events.rawListeners(event);
    },
    rawListeners(event) {
      return events.rawListeners(event);
    },
    listenerCount(event) {
      return events.listenerCount(event);
    },
    eventNames() {
      return events.eventNames();
    },
    // Node caps listeners per emitter and warns past the limit. There is no limit here — a
    // handle emits one event, `'close'` — so these keep the shape without inventing a cap.
    setMaxListeners(_n) {
      return this;
    },
    getMaxListeners() {
      return 0;
    },
    emit(event, ...args) {
      return events.emit(event, ...args);
    }
  };
  function handleSource(options) {
    const opts = typeof options === "string" ? void 0 : options;
    return {
      acquire: async () => handle,
      autoClose: opts?.autoClose !== false,
      path: "",
      // node reports no path for a handle-backed stream
      followCursor: true
    };
  }
  return handle;
}

// src/methods/fd-arg.ts
var INT32_MIN = -2147483648;
var INT32_MAX = 2147483647;
function isFdArg(p) {
  return typeof p === "number" && Number.isInteger(p) && p >= INT32_MIN && p <= INT32_MAX;
}
function validateFdArg(fd) {
  if (fd < 0) throw outOfRange("fd", `>= 0 && <= ${INT32_MAX}`, fd);
  return fd;
}
function isFileHandle(p) {
  return typeof p === "object" && p !== null && typeof p.fd === "number" && typeof p.readFile === "function" && typeof p.writeFile === "function";
}

// src/methods/readFile.ts
new TextDecoder();
var TO_EOF = 4294967295;
function readFileFdSync(syncRequest, fd, options) {
  validateFdArg(fd);
  const encoding = typeof options === "string" ? options : options?.encoding;
  const signal = typeof options === "string" ? void 0 : options?.signal;
  if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
  const buf = encodeRequest(OP.FREAD, "", 0, encodeFreadPayload(fd, TO_EOF, null));
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "read", String(fd));
  const result = data ?? new Uint8Array(0);
  return encoding ? decodeBuffer(result, encoding) : result;
}
async function readFileFd(asyncRequest, fd, options) {
  validateFdArg(fd);
  const signal = typeof options === "string" ? void 0 : options?.signal;
  if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
  const result = await createFileHandle(fd, asyncRequest).readFile(options);
  if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
  return result;
}
function readFileSync(syncRequest, filePath, options) {
  const encoding = typeof options === "string" ? options : options?.encoding;
  const flag = typeof options === "string" ? void 0 : options?.flag;
  const signal = typeof options === "string" ? void 0 : options?.signal;
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
  if (!flag || flag === "r") {
    const buf = encodeRequest(OP.READ, filePath);
    const { status, data } = syncRequest(buf);
    if (status !== 0) throw statusToError(status, "read", filePath);
    const result = data ?? new Uint8Array(0);
    if (encoding) return decodeBuffer(result, encoding);
    return result;
  }
  const fd = openSync(syncRequest, filePath, flag);
  try {
    const chunks = [];
    let totalRead = 0;
    const chunkSize = 64 * 1024;
    while (true) {
      const chunk = new Uint8Array(chunkSize);
      const bytesRead = readSync(syncRequest, fd, chunk, 0, chunkSize, totalRead);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      totalRead += bytesRead;
      if (bytesRead < chunkSize) break;
    }
    let result;
    if (chunks.length === 0) {
      result = new Uint8Array(0);
    } else if (chunks.length === 1) {
      result = chunks[0];
    } else {
      result = new Uint8Array(totalRead);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
    }
    if (encoding) return decodeBuffer(result, encoding);
    return result;
  } finally {
    closeSync(syncRequest, fd);
  }
}
async function readFile(asyncRequest, filePath, options) {
  const encoding = typeof options === "string" ? options : options?.encoding;
  const flag = typeof options === "string" ? void 0 : options?.flag;
  const signal = typeof options === "string" ? void 0 : options?.signal;
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
  if (!flag || flag === "r") {
    const { status, data } = await asyncRequest(OP.READ, filePath);
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    if (status !== 0) throw statusToError(status, "read", filePath);
    const result = data ?? new Uint8Array(0);
    if (encoding) return decodeBuffer(result, encoding);
    return result;
  }
  const handle = await open(asyncRequest, filePath, flag);
  try {
    const result = await handle.readFile(encoding ? encoding : void 0);
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    return result;
  } finally {
    await handle.close();
  }
}

// src/methods/writeFile.ts
var encoder3 = new TextEncoder();
function encodeData(data, encoding) {
  if (typeof data !== "string") return data;
  return encoding ? encodeString(data, encoding) : encoder3.encode(data);
}
function writeFileFdSync(syncRequest, fd, data, options) {
  validateFdArg(fd);
  const opts = typeof options === "string" ? { encoding: options } : options;
  if (opts?.signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
  const encoded = encodeData(data, opts?.encoding);
  writeSyncFd(syncRequest, fd, encoded, 0, encoded.byteLength, null);
  if (opts?.flush === true) fdatasyncSync(syncRequest, fd);
}
async function writeFileFd(asyncRequest, fd, data, options) {
  validateFdArg(fd);
  const opts = typeof options === "string" ? { encoding: options } : options;
  const signal = opts?.signal;
  if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
  const handle = createFileHandle(fd, asyncRequest);
  await handle.writeFile(encodeData(data, opts?.encoding));
  if (opts?.flush === true) await handle.datasync();
  if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
}
function writeFileSync(syncRequest, filePath, data, options) {
  const opts = typeof options === "string" ? { encoding: options } : options;
  const encoded = typeof data === "string" ? opts?.encoding ? encodeString(data, opts.encoding) : encoder3.encode(data) : data;
  const flag = opts?.flag;
  const signal = opts?.signal;
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
  if ((!flag || flag === "w") && opts?.mode === void 0) {
    const flags = opts?.flush === true ? 1 : 0;
    const buf = encodeRequest(OP.WRITE, filePath, flags, encoded);
    const { status } = syncRequest(buf);
    if (status !== 0) throw statusToError(status, "write", filePath);
    return;
  }
  const fd = openSync(syncRequest, filePath, flag ?? "w", opts?.mode);
  try {
    writeSyncFd(syncRequest, fd, encoded, 0, encoded.byteLength, 0);
    if (opts?.flush === true) fdatasyncSync(syncRequest, fd);
  } finally {
    closeSync(syncRequest, fd);
  }
}
async function writeFile(asyncRequest, filePath, data, options) {
  const opts = typeof options === "string" ? { encoding: options } : options;
  const encoded = typeof data === "string" ? opts?.encoding ? encodeString(data, opts.encoding) : encoder3.encode(data) : data;
  const flag = opts?.flag;
  const signal = opts?.signal;
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
  if ((!flag || flag === "w") && opts?.mode === void 0) {
    const flags = opts?.flush === true ? 1 : 0;
    const { status } = await asyncRequest(OP.WRITE, filePath, flags, encoded);
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    if (status !== 0) throw statusToError(status, "write", filePath);
    return;
  }
  const handle = await open(asyncRequest, filePath, flag ?? "w", opts?.mode);
  try {
    await handle.writeFile(encoded);
    if (opts?.flush === true) await handle.datasync();
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
  } finally {
    await handle.close();
  }
}

// src/methods/appendFile.ts
var encoder4 = new TextEncoder();
function resolveOptions(options) {
  const opts = typeof options === "string" ? { encoding: options } : options;
  const flag = opts?.flag;
  return {
    opts,
    flag,
    /** True when APPEND alone can express the request. */
    fastPath: (!flag || flag === "a") && opts?.mode === void 0 && opts?.flush !== true
  };
}
function encodeData2(data, encoding) {
  if (typeof data !== "string") return data;
  return encoding ? encodeString(data, encoding) : encoder4.encode(data);
}
var appendFileFdSync = writeFileFdSync;
var appendFileFd = writeFileFd;
function appendFileSync(syncRequest, filePath, data, options) {
  const { opts, flag, fastPath } = resolveOptions(options);
  const encoded = encodeData2(data, opts?.encoding);
  if (opts?.signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
  if (fastPath) {
    const buf = encodeRequest(OP.APPEND, filePath, 0, encoded);
    const { status } = syncRequest(buf);
    if (status !== 0) throw statusToError(status, "appendFile", filePath);
    return;
  }
  const fd = openSync(syncRequest, filePath, flag ?? "a", opts?.mode);
  try {
    writeSyncFd(syncRequest, fd, encoded, 0, encoded.byteLength, 0);
    if (opts?.flush === true) fdatasyncSync(syncRequest, fd);
  } finally {
    closeSync(syncRequest, fd);
  }
}
async function appendFile(asyncRequest, filePath, data, options) {
  const { opts, flag, fastPath } = resolveOptions(options);
  const encoded = encodeData2(data, opts?.encoding);
  const signal = opts?.signal;
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
  if (fastPath) {
    const { status } = await asyncRequest(OP.APPEND, filePath, 0, encoded);
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    if (status !== 0) throw statusToError(status, "appendFile", filePath);
    return;
  }
  const handle = await open(asyncRequest, filePath, flag ?? "a", opts?.mode);
  try {
    await handle.writeFile(encoded);
    if (opts?.flush === true) await handle.datasync();
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
  } finally {
    await handle.close();
  }
}

// src/methods/exists.ts
function existsSync(syncRequest, filePath) {
  const buf = encodeRequest(OP.EXISTS, filePath);
  const { data } = syncRequest(buf);
  return data ? data[0] === 1 : false;
}
async function exists(asyncRequest, filePath) {
  const { data } = await asyncRequest(OP.EXISTS, filePath);
  return data ? data[0] === 1 : false;
}

// src/methods/mkdir.ts
var decoder4 = new TextDecoder();
var DEFAULT_MKDIR_MODE = 511;
function resolveOptions2(options) {
  if (typeof options === "number" || typeof options === "string") {
    return { flags: 0, mode: parseFileMode(options, "mode") };
  }
  const mode = options?.mode;
  return {
    flags: options?.recursive ? 1 : 0,
    // Only an *absent* mode takes the default; `{ mode: null }` is a type error, as in Node.
    mode: mode === void 0 ? DEFAULT_MKDIR_MODE : parseFileMode(mode, "options.mode")
  };
}
function mkdirSync(syncRequest, filePath, options) {
  const { flags, mode } = resolveOptions2(options);
  const buf = encodeRequestU32(OP.MKDIR, filePath, flags, mode);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "mkdir", filePath);
  return data ? decoder4.decode(data) : void 0;
}
async function mkdir(asyncRequest, filePath, options) {
  const { flags, mode } = resolveOptions2(options);
  const { status, data } = await asyncRequest(OP.MKDIR, filePath, flags, encodeMode(mode));
  if (status !== 0) throw statusToError(status, "mkdir", filePath);
  return data ? decoder4.decode(data) : void 0;
}

// src/methods/rmdir.ts
function rmdirSync(syncRequest, filePath, options) {
  const flags = options?.recursive ? 1 : 0;
  const buf = encodeRequest(OP.RMDIR, filePath, flags);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "rmdir", filePath);
}
async function rmdir(asyncRequest, filePath, options) {
  const flags = options?.recursive ? 1 : 0;
  const { status } = await asyncRequest(OP.RMDIR, filePath, flags);
  if (status !== 0) throw statusToError(status, "rmdir", filePath);
}

// src/methods/rm.ts
var RETRYABLE_CODES = /* @__PURE__ */ new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);
function isRetryable(e) {
  return e instanceof FSError && RETRYABLE_CODES.has(e.code);
}
function rmSyncCore(syncRequest, filePath, options) {
  const flags = (options?.recursive ? 1 : 0) | (options?.force ? 2 : 0);
  const buf = encodeRequest(OP.UNLINK, filePath, flags);
  const { status } = syncRequest(buf);
  if (status === 3) {
    if (!options?.recursive) throw eisdirNotRecursive(filePath);
    const rmdirBuf = encodeRequest(OP.RMDIR, filePath, flags);
    const rmdirResult = syncRequest(rmdirBuf);
    if (rmdirResult.status !== 0) {
      if (options?.force && rmdirResult.status === 1) return;
      throw statusToError(rmdirResult.status, "rm", filePath);
    }
    return;
  }
  if (status !== 0) {
    if (options?.force && status === 1) return;
    throw statusToError(status, "rm", filePath);
  }
}
function rmSync(syncRequest, filePath, options) {
  const maxRetries = options?.maxRetries ?? 0;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      rmSyncCore(syncRequest, filePath, options);
      return;
    } catch (e) {
      lastError = e;
      if (attempt < maxRetries && isRetryable(e)) {
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}
async function rmAsyncCore(asyncRequest, filePath, options) {
  const flags = (options?.recursive ? 1 : 0) | (options?.force ? 2 : 0);
  const { status } = await asyncRequest(OP.UNLINK, filePath, flags);
  if (status === 3) {
    if (!options?.recursive) throw eisdirNotRecursive(filePath);
    const { status: s2 } = await asyncRequest(OP.RMDIR, filePath, flags);
    if (s2 !== 0) {
      if (options?.force && s2 === 1) return;
      throw statusToError(s2, "rm", filePath);
    }
    return;
  }
  if (status !== 0) {
    if (options?.force && status === 1) return;
    throw statusToError(status, "rm", filePath);
  }
}
function delay(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
async function rm(asyncRequest, filePath, options) {
  const maxRetries = options?.maxRetries ?? 0;
  const retryDelay = options?.retryDelay ?? 100;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await rmAsyncCore(asyncRequest, filePath, options);
      return;
    } catch (e) {
      lastError = e;
      if (attempt < maxRetries && isRetryable(e)) {
        await delay(retryDelay);
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

// src/methods/unlink.ts
function unlinkSync(syncRequest, filePath) {
  const buf = encodeRequest(OP.UNLINK, filePath);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "unlink", filePath);
}
async function unlink(asyncRequest, filePath) {
  const { status } = await asyncRequest(OP.UNLINK, filePath);
  if (status !== 0) throw statusToError(status, "unlink", filePath);
}

// src/methods/readdir.ts
var textEncoder = new TextEncoder();
function namesToBuffers(names) {
  return names.map((n) => textEncoder.encode(n));
}
function readdirBaseSync(syncRequest, filePath, withFileTypes) {
  const flags = withFileTypes ? 1 : 0;
  const buf = encodeRequest(OP.READDIR, filePath, flags);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "readdir", filePath);
  if (!data) return [];
  return withFileTypes ? decodeDirents(data, filePath) : decodeNames(data);
}
async function readdirBaseAsync(asyncRequest, filePath, withFileTypes) {
  const flags = withFileTypes ? 1 : 0;
  const { status, data } = await asyncRequest(OP.READDIR, filePath, flags);
  if (status !== 0) throw statusToError(status, "readdir", filePath);
  if (!data) return [];
  return withFileTypes ? decodeDirents(data, filePath) : decodeNames(data);
}
function readdirRecursiveSync(syncRequest, basePath, prefix, withFileTypes, rootPath) {
  const entries = readdirBaseSync(syncRequest, basePath, true);
  const results = [];
  const effectiveRoot = rootPath ?? basePath;
  for (const entry of entries) {
    const relativePath = prefix ? prefix + "/" + entry.name : entry.name;
    if (withFileTypes) {
      const parentPath = prefix ? effectiveRoot + "/" + prefix : effectiveRoot;
      results.push(entry.withParentPath(parentPath));
    } else {
      results.push(relativePath);
    }
    if (entry.isDirectory()) {
      const childPath2 = basePath + "/" + entry.name;
      results.push(
        ...readdirRecursiveSync(syncRequest, childPath2, relativePath, withFileTypes, effectiveRoot)
      );
    }
  }
  return results;
}
async function readdirRecursiveAsync(asyncRequest, basePath, prefix, withFileTypes, rootPath) {
  const entries = await readdirBaseAsync(asyncRequest, basePath, true);
  const results = [];
  const effectiveRoot = rootPath ?? basePath;
  for (const entry of entries) {
    const relativePath = prefix ? prefix + "/" + entry.name : entry.name;
    if (withFileTypes) {
      const parentPath = prefix ? effectiveRoot + "/" + prefix : effectiveRoot;
      results.push(entry.withParentPath(parentPath));
    } else {
      results.push(relativePath);
    }
    if (entry.isDirectory()) {
      const childPath2 = basePath + "/" + entry.name;
      const children = await readdirRecursiveAsync(
        asyncRequest,
        childPath2,
        relativePath,
        withFileTypes,
        effectiveRoot
      );
      results.push(...children);
    }
  }
  return results;
}
function resolveNameEncoding(encoding) {
  if (encoding === void 0 || encoding === null || encoding === "buffer") {
    return encoding === "buffer" ? "buffer" : null;
  }
  const canonical = assertEncoding(encoding);
  return canonical === "utf8" ? null : canonical;
}
function recodeNames(names, encoding) {
  return names.map((n) => decodeBuffer(encodeString(n, "utf8"), encoding));
}
function readdirSync(syncRequest, filePath, options) {
  const opts = typeof options === "string" ? { encoding: options } : options;
  const nameEncoding = resolveNameEncoding(opts?.encoding);
  const recode = (names) => {
    if (opts?.withFileTypes || nameEncoding === null) return names;
    if (nameEncoding === "buffer") return namesToBuffers(names);
    return recodeNames(names, nameEncoding);
  };
  if (opts?.recursive) {
    return recode(readdirRecursiveSync(syncRequest, filePath, "", !!opts?.withFileTypes));
  }
  return recode(readdirBaseSync(syncRequest, filePath, !!opts?.withFileTypes));
}
async function readdir(asyncRequest, filePath, options) {
  const opts = typeof options === "string" ? { encoding: options } : options;
  const nameEncoding = resolveNameEncoding(opts?.encoding);
  const recode = (names) => {
    if (opts?.withFileTypes || nameEncoding === null) return names;
    if (nameEncoding === "buffer") return namesToBuffers(names);
    return recodeNames(names, nameEncoding);
  };
  if (opts?.recursive) {
    return recode(await readdirRecursiveAsync(asyncRequest, filePath, "", !!opts?.withFileTypes));
  }
  return recode(await readdirBaseAsync(asyncRequest, filePath, !!opts?.withFileTypes));
}

// src/methods/stat.ts
function suppressesMissing(options, status) {
  return options?.throwIfNoEntry === false && status === CODE_TO_STATUS.ENOENT;
}
function statSync(syncRequest, filePath, options) {
  const buf = encodeRequest(OP.STAT, filePath);
  const { status, data } = syncRequest(buf);
  if (status !== 0) {
    if (suppressesMissing(options, status)) return void 0;
    throw statusToError(status, "stat", filePath);
  }
  return options?.bigint ? decodeStatsBigInt(data) : decodeStats(data);
}
function lstatSync(syncRequest, filePath, options) {
  const buf = encodeRequest(OP.LSTAT, filePath);
  const { status, data } = syncRequest(buf);
  if (status !== 0) {
    if (suppressesMissing(options, status)) return void 0;
    throw statusToError(status, "lstat", filePath);
  }
  return options?.bigint ? decodeStatsBigInt(data) : decodeStats(data);
}
async function stat(asyncRequest, filePath, options) {
  const { status, data } = await asyncRequest(OP.STAT, filePath);
  if (status !== 0) {
    if (suppressesMissing(options, status)) return void 0;
    throw statusToError(status, "stat", filePath);
  }
  return options?.bigint ? decodeStatsBigInt(data) : decodeStats(data);
}
async function lstat(asyncRequest, filePath, options) {
  const { status, data } = await asyncRequest(OP.LSTAT, filePath);
  if (status !== 0) {
    if (suppressesMissing(options, status)) return void 0;
    throw statusToError(status, "lstat", filePath);
  }
  return options?.bigint ? decodeStatsBigInt(data) : decodeStats(data);
}

// src/methods/rename.ts
var encoder5 = new TextEncoder();
function renameSync(syncRequest, oldPath, newPath) {
  const buf = encodeTwoPathRequest(OP.RENAME, oldPath, newPath);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "rename", oldPath);
}
async function rename(asyncRequest, oldPath, newPath) {
  const path2Bytes = encoder5.encode(newPath);
  const payload = new Uint8Array(4 + path2Bytes.byteLength);
  new DataView(payload.buffer).setUint32(0, path2Bytes.byteLength, true);
  payload.set(path2Bytes, 4);
  const { status } = await asyncRequest(OP.RENAME, oldPath, 0, payload);
  if (status !== 0) throw statusToError(status, "rename", oldPath);
}

// src/methods/copyFile.ts
var encoder6 = new TextEncoder();
function copyFileSync(syncRequest, src, dest, mode) {
  const buf = encodeTwoPathRequest(OP.COPY, src, dest, mode ?? 0);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "copyFile", src);
}
async function copyFile(asyncRequest, src, dest, mode) {
  const path2Bytes = encoder6.encode(dest);
  const payload = new Uint8Array(4 + path2Bytes.byteLength);
  new DataView(payload.buffer).setUint32(0, path2Bytes.byteLength, true);
  payload.set(path2Bytes, 4);
  const { status } = await asyncRequest(OP.COPY, src, mode ?? 0, payload);
  if (status !== 0) throw statusToError(status, "copyFile", src);
}

// src/methods/truncate.ts
function truncateSync(syncRequest, filePath, len = 0) {
  const buf = encodeRequest(OP.TRUNCATE, filePath, 0, encodeTruncatePayload(len));
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "truncate", filePath);
}
async function truncate(asyncRequest, filePath, len) {
  const { status } = await asyncRequest(OP.TRUNCATE, filePath, 0, encodeTruncatePayload(len ?? 0));
  if (status !== 0) throw statusToError(status, "truncate", filePath);
}

// src/methods/access.ts
function accessSync(syncRequest, filePath, mode = constants.F_OK) {
  const buf = encodeRequest(OP.ACCESS, filePath, mode);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "access", filePath);
}
async function access(asyncRequest, filePath, mode = constants.F_OK) {
  const { status } = await asyncRequest(OP.ACCESS, filePath, mode);
  if (status !== 0) throw statusToError(status, "access", filePath);
}

// src/methods/realpath.ts
function decodePath(data, options) {
  const encoding = typeof options === "string" ? options : options?.encoding;
  if (encoding === "buffer") return new Uint8Array(data);
  if (encoding === void 0 || encoding === null) return decoder5.decode(data);
  return decodeBuffer(data, assertEncoding(encoding));
}
var decoder5 = new TextDecoder();
function realpathSync(syncRequest, filePath, options) {
  const buf = encodeRequest(OP.REALPATH, filePath);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "realpath", filePath);
  return decodePath(data, options);
}
async function realpath(asyncRequest, filePath, options) {
  const { status, data } = await asyncRequest(OP.REALPATH, filePath);
  if (status !== 0) throw statusToError(status, "realpath", filePath);
  return decodePath(data, options);
}
var NOFOLLOW = 1;

// src/methods/chmod.ts
var followFlag = (follow) => follow ? 0 : NOFOLLOW;
function requireMode(mode) {
  return parseFileMode(mode, "mode");
}
function chmodSync(syncRequest, filePath, mode, follow = true) {
  const buf = encodeRequestU32(OP.CHMOD, filePath, followFlag(follow), requireMode(mode));
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "chmod", filePath);
}
async function chmod(asyncRequest, filePath, mode, follow = true) {
  const { status } = await asyncRequest(OP.CHMOD, filePath, followFlag(follow), encodeMode(requireMode(mode)));
  if (status !== 0) throw statusToError(status, "chmod", filePath);
}
function fchmodSync(syncRequest, fd, mode) {
  const buf = encodeRequest(OP.FCHMOD, "", 0, encodeFdMode(fd, requireMode(mode)));
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "fchmod", String(fd));
}
async function fchmod(asyncRequest, fd, mode) {
  const { status } = await asyncRequest(OP.FCHMOD, "", 0, encodeFdMode(fd, requireMode(mode)));
  if (status !== 0) throw statusToError(status, "fchmod", String(fd));
}
function encodeFdMode(fd, mode) {
  const payload = new Uint8Array(8);
  payload[0] = fd;
  payload[1] = fd >>> 8;
  payload[2] = fd >>> 16;
  payload[3] = fd >>> 24;
  payload[4] = mode;
  payload[5] = mode >>> 8;
  payload[6] = mode >>> 16;
  payload[7] = mode >>> 24;
  return payload;
}

// src/methods/chown.ts
function chownSync(syncRequest, filePath, uid, gid, follow = true) {
  const ownerBuf = new Uint8Array(8);
  const dv = new DataView(ownerBuf.buffer);
  dv.setUint32(0, uid, true);
  dv.setUint32(4, gid, true);
  const buf = encodeRequest(OP.CHOWN, filePath, follow ? 0 : NOFOLLOW, ownerBuf);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "chown", filePath);
}
async function chown(asyncRequest, filePath, uid, gid, follow = true) {
  const buf = new Uint8Array(8);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, uid, true);
  dv.setUint32(4, gid, true);
  const { status } = await asyncRequest(OP.CHOWN, filePath, follow ? 0 : NOFOLLOW, buf);
  if (status !== 0) throw statusToError(status, "chown", filePath);
}
function fchownSync(syncRequest, fd, uid, gid) {
  const payload = new Uint8Array(12);
  const dv = new DataView(payload.buffer);
  dv.setUint32(0, fd, true);
  dv.setUint32(4, uid, true);
  dv.setUint32(8, gid, true);
  const buf = encodeRequest(OP.FCHOWN, "", 0, payload);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "fchown", String(fd));
}
async function fchown(asyncRequest, fd, uid, gid) {
  const payload = new Uint8Array(12);
  const dv = new DataView(payload.buffer);
  dv.setUint32(0, fd, true);
  dv.setUint32(4, uid, true);
  dv.setUint32(8, gid, true);
  const { status } = await asyncRequest(OP.FCHOWN, "", 0, payload);
  if (status !== 0) throw statusToError(status, "fchown", String(fd));
}

// src/methods/utimes.ts
function utimesSync(syncRequest, filePath, atime, mtime, follow = true) {
  const timesBuf = new Uint8Array(16);
  const dv = new DataView(timesBuf.buffer);
  dv.setFloat64(0, toEpochMs(atime, "atime"), true);
  dv.setFloat64(8, toEpochMs(mtime, "mtime"), true);
  const buf = encodeRequest(OP.UTIMES, filePath, follow ? 0 : NOFOLLOW, timesBuf);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "utimes", filePath);
}
async function utimes(asyncRequest, filePath, atime, mtime, follow = true) {
  const buf = new Uint8Array(16);
  const dv = new DataView(buf.buffer);
  dv.setFloat64(0, toEpochMs(atime, "atime"), true);
  dv.setFloat64(8, toEpochMs(mtime, "mtime"), true);
  const { status } = await asyncRequest(OP.UTIMES, filePath, follow ? 0 : NOFOLLOW, buf);
  if (status !== 0) throw statusToError(status, "utimes", filePath);
}
function futimesSync(syncRequest, fd, atime, mtime) {
  const payload = new Uint8Array(24);
  const dv = new DataView(payload.buffer);
  dv.setUint32(0, fd, true);
  dv.setFloat64(8, toEpochMs(atime, "atime"), true);
  dv.setFloat64(16, toEpochMs(mtime, "mtime"), true);
  const buf = encodeRequest(OP.FUTIMES, "", 0, payload);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "futimes", String(fd));
}
async function futimes(asyncRequest, fd, atime, mtime) {
  const payload = new Uint8Array(24);
  const dv = new DataView(payload.buffer);
  dv.setUint32(0, fd, true);
  dv.setFloat64(8, toEpochMs(atime, "atime"), true);
  dv.setFloat64(16, toEpochMs(mtime, "mtime"), true);
  const { status } = await asyncRequest(OP.FUTIMES, "", 0, payload);
  if (status !== 0) throw statusToError(status, "futimes", String(fd));
}

// src/methods/symlink.ts
var encoder7 = new TextEncoder();
var decoder6 = new TextDecoder();
function symlinkSync(syncRequest, target, linkPath, type) {
  const targetBytes = encoder7.encode(target);
  const buf = encodeRequest(OP.SYMLINK, linkPath, 0, targetBytes);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "symlink", linkPath);
}
function decodeLink(data, options) {
  const encoding = typeof options === "string" ? options : options?.encoding;
  if (encoding === "buffer") return new Uint8Array(data);
  if (encoding === void 0 || encoding === null) return decoder6.decode(data);
  return decodeBuffer(data, assertEncoding(encoding));
}
function readlinkSync(syncRequest, filePath, options) {
  const buf = encodeRequest(OP.READLINK, filePath);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "readlink", filePath);
  return decodeLink(data, options);
}
async function symlink(asyncRequest, target, linkPath, type) {
  const targetBytes = encoder7.encode(target);
  const { status } = await asyncRequest(OP.SYMLINK, linkPath, 0, targetBytes);
  if (status !== 0) throw statusToError(status, "symlink", linkPath);
}
async function readlink(asyncRequest, filePath, options) {
  const { status, data } = await asyncRequest(OP.READLINK, filePath);
  if (status !== 0) throw statusToError(status, "readlink", filePath);
  return decodeLink(data, options);
}

// src/methods/link.ts
var encoder8 = new TextEncoder();
function linkSync(syncRequest, existingPath, newPath) {
  const buf = encodeTwoPathRequest(OP.LINK, existingPath, newPath);
  const { status } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "link", existingPath);
}
async function link(asyncRequest, existingPath, newPath) {
  const path2Bytes = encoder8.encode(newPath);
  const payload = new Uint8Array(4 + path2Bytes.byteLength);
  new DataView(payload.buffer).setUint32(0, path2Bytes.byteLength, true);
  payload.set(path2Bytes, 4);
  const { status } = await asyncRequest(OP.LINK, existingPath, 0, payload);
  if (status !== 0) throw statusToError(status, "link", existingPath);
}

// src/methods/mkdtemp.ts
function decodePath2(data, options) {
  const encoding = typeof options === "string" ? options : options?.encoding;
  if (encoding === "buffer") return new Uint8Array(data);
  if (encoding === void 0 || encoding === null) return decoder7.decode(data);
  return decodeBuffer(data, assertEncoding(encoding));
}
var decoder7 = new TextDecoder();
function mkdtempSync(syncRequest, prefix, options) {
  const buf = encodeRequest(OP.MKDTEMP, prefix);
  const { status, data } = syncRequest(buf);
  if (status !== 0) throw statusToError(status, "mkdtemp", prefix);
  return decodePath2(data, options);
}
async function mkdtemp(asyncRequest, prefix, options) {
  const { status, data } = await asyncRequest(OP.MKDTEMP, prefix);
  if (status !== 0) throw statusToError(status, "mkdtemp", prefix);
  return decodePath2(data, options);
}

// src/methods/statfs.ts
function decodeStatFs(data) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const bfree = dv.getUint32(12, true);
  const bsize = dv.getUint32(4, true);
  return {
    type: dv.getUint32(0, true),
    bsize,
    frsize: bsize,
    blocks: dv.getUint32(8, true),
    bfree,
    bavail: bfree,
    files: dv.getUint32(16, true),
    ffree: dv.getUint32(20, true)
  };
}
function asBigInt(s) {
  const out = {};
  for (const [k, v] of Object.entries(s)) out[k] = BigInt(Math.trunc(v));
  return out;
}
function statfsSync(syncRequest, path = "/", options) {
  const { status, data } = syncRequest(encodeRequest(OP.STATFS, path));
  if (status !== 0) throw statusToError(status, "statfs", path);
  const stats = decodeStatFs(data);
  return options?.bigint ? asBigInt(stats) : stats;
}
async function statfs(asyncRequest, path = "/", options) {
  const { status, data } = await asyncRequest(OP.STATFS, path);
  if (status !== 0) throw statusToError(status, "statfs", path);
  const stats = decodeStatFs(data);
  return options?.bigint ? asBigInt(stats) : stats;
}

// src/dir.ts
var Dir = class {
  path;
  _entries;
  _index = 0;
  _closed = false;
  _onClose;
  constructor(path, entries, onClose = null) {
    this.path = path;
    this._entries = entries;
    this._onClose = onClose;
  }
  _assertOpen() {
    if (this._closed) {
      const err = new Error("Directory handle was closed");
      err.code = "ERR_DIR_CLOSED";
      throw err;
    }
  }
  /** The next entry, or `null` once the directory is exhausted. */
  async read() {
    this._assertOpen();
    return this._index >= this._entries.length ? null : this._entries[this._index++];
  }
  /** The synchronous form. Was missing entirely. */
  readSync() {
    this._assertOpen();
    return this._index >= this._entries.length ? null : this._entries[this._index++];
  }
  async close() {
    if (this._closed) return;
    this._closed = true;
    if (this._onClose) await this._onClose();
  }
  /** The synchronous form. Was missing entirely. */
  closeSync() {
    if (this._closed) return;
    this._closed = true;
    if (this._onClose) void this._onClose().catch(() => {
    });
  }
  async *[Symbol.asyncIterator]() {
    try {
      for (let entry = await this.read(); entry !== null; entry = await this.read()) {
        yield entry;
      }
    } finally {
      await this.close();
    }
  }
};

// src/methods/opendir.ts
async function opendir(asyncRequest, filePath, options) {
  const { status, data } = await asyncRequest(OP.OPENDIR, filePath);
  if (status !== 0) throw statusToError(status, "opendir", filePath);
  const fd = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true);
  const entries = await readdir(asyncRequest, filePath, {
    withFileTypes: true,
    recursive: options?.recursive
  });
  return new Dir(filePath, entries, async () => {
    const { status: closeStatus } = await asyncRequest(OP.CLOSE, "", 0, null, void 0, { fd });
    if (closeStatus !== 0) throw statusToError(closeStatus, "close", String(fd));
  });
}

// src/workers/worker-blob.ts
var objectUrls = /* @__PURE__ */ new WeakMap();
function workerFromSource(source, name) {
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    const worker = new Worker(url, { type: "module", name });
    objectUrls.set(worker, url);
    return worker;
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}
function terminateWorker(worker) {
  if (!worker) return;
  try {
    worker.terminate();
  } catch {
  }
  const url = objectUrls.get(worker);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrls.delete(worker);
  }
}

// src/workers/inlined/sync-relay.workertext
var sync_relay_default = 'var lt=1447449377,Tt=1,At=4096,xt=1e5,P=64,b={SIZE:64,MAGIC:0,VERSION:4,INODE_COUNT:8,BLOCK_SIZE:12,TOTAL_BLOCKS:16,FREE_BLOCKS:20,INODE_OFFSET:24,PATH_OFFSET:32,DATA_OFFSET:40,BITMAP_OFFSET:48,PATH_USED:56,CRC32:60},E={TYPE:0,FLAGS:1,PATH_OFFSET:4,PATH_LENGTH:8,NLINK:10,MODE:12,SIZE:16,FIRST_BLOCK:24,BLOCK_COUNT:28,MTIME:32,CTIME:40,ATIME:48,UID:56,GID:60},p={FREE:0,FILE:1,DIRECTORY:2,SYMLINK:3},Re=33188,Qt=16877,ve=41471,Xt=18,jt=61440,Ue=32768,xe=16384,Pt=40,Jt=256*1024,Lt=1024,te=4e6;function Pe(i=xt,t=At,e=Lt,s=te){const n=b.SIZE,r=i*P,a=n+r,o=Jt,u=a+o,f=Math.ceil(s/8),h=Math.ceil(e/8),d=Math.ceil((u+f)/t)*t,m=d+e*t;return{inodeTableOffset:n,inodeTableSize:r,pathTableOffset:a,pathTableSize:o,bitmapOffset:u,bitmapSize:h,bitmapRegionSize:f,dataOffset:d,totalSize:m,totalBlocks:e}}var Le=(()=>{const i=new Uint32Array(256);for(let t=0;t<256;t++){let e=t;for(let s=0;s<8;s++)e=e&1?3988292384^e>>>1:e>>>1;i[t]=e>>>0}return i})();function ee(i,t=0,e=i.byteLength){let s=4294967295;for(let n=t;n<e;n++)s=Le[(s^i[n])&255]^s>>>8;return(s^4294967295)>>>0}var y={OK:0,ENOENT:1,EEXIST:2,EISDIR:3,ENOTDIR:4,ENOTEMPTY:5,EACCES:6,EINVAL:7,EBADF:8,ELOOP:9,ENOSPC:10,EIO:11,ENOTSUP:12},V=new TextEncoder,Mt=16384,ut=new TextDecoder,Me=class St{handle;pathIndex=new Map;inodeCount=0;blockSize=At;totalBlocks=0;freeBlocks=0;inodeTableOffset=0;pathTableOffset=0;pathTableUsed=0;pathTableSize=0;bitmapOffset=0;dataOffset=0;umask=Xt;processUid=0;processGid=0;strictPermissions=!1;debug=!1;fdTable=new Map;nextFd=3;static isReadable(t){const e=t&3;return e===0||e===2}static isWritable(t){const e=t&3;return e===1||e===2}inodeBuf=new Uint8Array(P);inodeView=new DataView(this.inodeBuf.buffer);inodeCache=new Map;superblockBuf=new Uint8Array(b.SIZE);superblockView=new DataView(this.superblockBuf.buffer);bitmap=null;bitmapDirtyLo=1/0;bitmapDirtyHi=-1;superblockDirty=!1;freeInodeHint=0;implicitDirs=new Map;implicitDirsGen=-1;pathIndexGen=0;descCount=new Map;descCountGen=0;childIndex=new Map;childIndexGen=0;allocCursor=0;symlinkLoopDetected=!1;resolveFailureStatus(){return this.symlinkLoopDetected?y.ELOOP:y.ENOENT}maxInodes=4e6;maxBlocks=te;maxPathTable=256*1024*1024;maxVFSSize=100*1024*1024*1024;init(t,e){if(this.handle=t,this.processUid=e?.uid??0,this.processGid=e?.gid??0,this.umask=e?.umask??Xt,this.strictPermissions=e?.strictPermissions??!1,this.debug=e?.debug??!1,e?.limits&&(e.limits.maxInodes!=null&&(this.maxInodes=e.limits.maxInodes),e.limits.maxBlocks!=null&&(this.maxBlocks=e.limits.maxBlocks),e.limits.maxPathTable!=null&&(this.maxPathTable=e.limits.maxPathTable),e.limits.maxVFSSize!=null&&(this.maxVFSSize=e.limits.maxVFSSize)),t.getSize()===0)this.format();else try{this.mount()}catch(n){const r=n.message??String(n);throw r.startsWith("Corrupt VFS:")?n:new Error(`Corrupt VFS: ${r}`)}}closeHandle(){try{this.handle?.close()}catch{}}format(){const t=Pe(xt,At,Lt,this.maxBlocks);this.inodeCount=xt,this.blockSize=At,this.totalBlocks=t.totalBlocks,this.freeBlocks=t.totalBlocks,this.inodeTableOffset=t.inodeTableOffset,this.pathTableOffset=t.pathTableOffset,this.pathTableSize=t.pathTableSize,this.pathTableUsed=0,this.bitmapOffset=t.bitmapOffset,this.dataOffset=t.dataOffset,this.handle.truncate(t.totalSize),this.writeSuperblock();const e=new Uint8Array(t.inodeTableSize);this.handle.write(e,{at:this.inodeTableOffset}),this.bitmap=new Uint8Array(t.bitmapSize),this.handle.write(this.bitmap,{at:this.bitmapOffset}),this.createInode("/",p.DIRECTORY,Qt,0),this.writeSuperblock(),this.handle.flush()}mount(){const t=this.handle.getSize();if(t<b.SIZE)throw new Error(`Corrupt VFS: file too small (${t} bytes, need at least ${b.SIZE})`);this.handle.read(this.superblockBuf,{at:0});const e=this.superblockView,s=e.getUint32(b.MAGIC,!0);if(s!==lt)throw new Error(`Corrupt VFS: bad magic 0x${s.toString(16)} (expected 0x${lt.toString(16)})`);const n=e.getUint32(b.VERSION,!0);if(n!==Tt)throw new Error(`Corrupt VFS: unsupported version ${n} (expected ${Tt})`);const r=e.getUint32(b.CRC32,!0);if(r!==0){const R=ee(this.superblockBuf,0,b.CRC32);if(R!==r)throw new Error(`Corrupt VFS: superblock checksum mismatch (stored 0x${r.toString(16)}, computed 0x${R.toString(16)})`)}const a=e.getUint32(b.INODE_COUNT,!0),o=e.getUint32(b.BLOCK_SIZE,!0),u=e.getUint32(b.TOTAL_BLOCKS,!0),f=e.getUint32(b.FREE_BLOCKS,!0),h=e.getFloat64(b.INODE_OFFSET,!0),d=e.getFloat64(b.PATH_OFFSET,!0),m=e.getFloat64(b.DATA_OFFSET,!0),w=e.getFloat64(b.BITMAP_OFFSET,!0),l=e.getUint32(b.PATH_USED,!0);if(o===0||(o&o-1)!==0)throw new Error(`Corrupt VFS: invalid block size ${o} (must be power of 2)`);if(a===0)throw new Error("Corrupt VFS: inode count is 0");if(f>u)throw new Error(`Corrupt VFS: free blocks (${f}) exceeds total blocks (${u})`);if(a>this.maxInodes)throw new Error(`Corrupt VFS: inode count ${a} exceeds maximum ${this.maxInodes}`);if(u>this.maxBlocks)throw new Error(`Corrupt VFS: total blocks ${u} exceeds maximum ${this.maxBlocks}`);if(t>this.maxVFSSize)throw new Error(`Corrupt VFS: file size ${t} exceeds maximum ${this.maxVFSSize}`);if(!Number.isFinite(h)||h<0||!Number.isFinite(d)||d<0||!Number.isFinite(w)||w<0||!Number.isFinite(m)||m<0)throw new Error("Corrupt VFS: non-finite or negative section offset");if(h!==b.SIZE)throw new Error(`Corrupt VFS: inode table offset ${h} (expected ${b.SIZE})`);const I=h+a*P;if(d!==I)throw new Error(`Corrupt VFS: path table offset ${d} (expected ${I})`);if(w<=d)throw new Error(`Corrupt VFS: bitmap offset ${w} must be after path table ${d}`);if(m<=w)throw new Error(`Corrupt VFS: data offset ${m} must be after bitmap ${w}`);if(u>(m-w)*8)throw new Error(`Corrupt VFS: total blocks (${u}) exceed bitmap region capacity (${(m-w)*8})`);const T=w-d;if(l>T)throw new Error(`Corrupt VFS: path used (${l}) exceeds path table size (${T})`);if(T>this.maxPathTable)throw new Error(`Corrupt VFS: path table size ${T} exceeds maximum ${this.maxPathTable}`);const F=m+u*o;if(F>this.maxVFSSize)throw new Error(`Corrupt VFS: computed layout size ${F} exceeds maximum ${this.maxVFSSize}`);if(t<F)throw new Error(`Corrupt VFS: file size ${t} too small for layout (need ${F})`);this.inodeCount=a,this.blockSize=o,this.totalBlocks=u,this.freeBlocks=f,this.inodeTableOffset=h,this.pathTableOffset=d,this.dataOffset=m,this.bitmapOffset=w,this.pathTableUsed=l,this.pathTableSize=T;const C=Math.ceil(this.totalBlocks/8);if(this.bitmap=new Uint8Array(C),this.handle.read(this.bitmap,{at:this.bitmapOffset}),this.rebuildIndex(),!this.pathIndex.has("/"))throw new Error(\'Corrupt VFS: root directory "/" not found in inode table\')}writeSuperblock(){const t=this.superblockView;t.setUint32(b.MAGIC,lt,!0),t.setUint32(b.VERSION,Tt,!0),t.setUint32(b.INODE_COUNT,this.inodeCount,!0),t.setUint32(b.BLOCK_SIZE,this.blockSize,!0),t.setUint32(b.TOTAL_BLOCKS,this.totalBlocks,!0),t.setUint32(b.FREE_BLOCKS,this.freeBlocks,!0),t.setFloat64(b.INODE_OFFSET,this.inodeTableOffset,!0),t.setFloat64(b.PATH_OFFSET,this.pathTableOffset,!0),t.setFloat64(b.DATA_OFFSET,this.dataOffset,!0),t.setFloat64(b.BITMAP_OFFSET,this.bitmapOffset,!0),t.setUint32(b.PATH_USED,this.pathTableUsed,!0),t.setUint32(b.CRC32,ee(this.superblockBuf,0,b.CRC32),!0),this.handle.write(this.superblockBuf,{at:0})}markBitmapDirty(t,e){t<this.bitmapDirtyLo&&(this.bitmapDirtyLo=t),e>this.bitmapDirtyHi&&(this.bitmapDirtyHi=e)}commitPending(){if(this.blocksFreedsinceTrim&&(this.trimTrailingBlocks(),this.blocksFreedsinceTrim=!1),this.bitmapDirtyHi>=0){const t=this.bitmapDirtyLo,e=this.bitmapDirtyHi;this.handle.write(this.bitmap.subarray(t,e+1),{at:this.bitmapOffset+t}),this.bitmapDirtyLo=1/0,this.bitmapDirtyHi=-1}this.superblockDirty&&(this.writeSuperblock(),this.superblockDirty=!1)}findLastUsedBlock(){const t=this.bitmap;for(let e=Math.ceil(this.totalBlocks/8)-1;e>=0;e--)if(t[e]!==0)for(let s=7;s>=0;s--){const n=e*8+s;if(n<this.totalBlocks&&t[e]&1<<s)return n}return-1}trimTrailingBlocks(){const t=this.findLastUsedBlock(),e=Math.max(t+1+Mt,Lt);if(e>=this.totalBlocks)return;this.handle.truncate(this.dataOffset+e*this.blockSize);const s=Math.ceil(e/8);this.bitmap=this.bitmap.slice(0,s);const n=this.totalBlocks-e;this.freeBlocks-=n,this.totalBlocks=e,this.superblockDirty=!0,this.bitmapDirtyLo=0,this.bitmapDirtyHi=s-1}lastPreGrowCheck=0;maybePreGrow(t=!1){if(!this.bitmap)return!1;const e=Date.now();if(!t&&e-this.lastPreGrowCheck<250)return!1;this.lastPreGrowCheck=e;const s=this.totalBlocks-(this.findLastUsedBlock()+1);if(s>=Mt)return!1;const n=Math.min(this.maxBlocks,this.bitmapCapacityBlocks()),r=Math.ceil((Mt-s)/8)*8,a=Math.min(r,n-this.totalBlocks);if(a<=0)return!1;const o=this.totalBlocks+a;this.handle.truncate(this.dataOffset+o*this.blockSize);const u=Math.ceil(o/8);if(u>this.bitmap.byteLength){const f=new Uint8Array(u);f.set(this.bitmap),this.bitmap=f}return this.totalBlocks=o,this.freeBlocks+=a,this.superblockDirty=!0,this.commitPending(),!0}rebuildIndex(){this.pathIndex.clear(),this.inodeCache.clear();const t=this.inodeCount*P,e=new Uint8Array(t);this.handle.read(e,{at:this.inodeTableOffset});const s=new DataView(e.buffer),n=this.pathTableUsed>0?new Uint8Array(this.pathTableUsed):null;n&&this.handle.read(n,{at:this.pathTableOffset});for(let r=0;r<this.inodeCount;r++){const a=r*P,o=s.getUint8(a+E.TYPE);if(o===p.FREE)continue;if(o<p.FILE||o>p.SYMLINK)throw new Error(`Corrupt VFS: inode ${r} has invalid type ${o}`);const u=s.getUint32(a+E.PATH_OFFSET,!0),f=s.getUint16(a+E.PATH_LENGTH,!0),h=s.getFloat64(a+E.SIZE,!0),d=s.getUint32(a+E.FIRST_BLOCK,!0),m=s.getUint32(a+E.BLOCK_COUNT,!0);if(f===0||u+f>this.pathTableUsed)throw new Error(`Corrupt VFS: inode ${r} path out of bounds (offset=${u}, len=${f}, tableUsed=${this.pathTableUsed})`);if(o!==p.DIRECTORY){if(h<0||!isFinite(h))throw new Error(`Corrupt VFS: inode ${r} has invalid size ${h}`);if(m>0&&d+m>this.totalBlocks)throw new Error(`Corrupt VFS: inode ${r} data blocks out of range (first=${d}, count=${m}, total=${this.totalBlocks})`)}const w={type:o,pathOffset:u,pathLength:f,nlink:s.getUint16(a+E.NLINK,!0)||1,mode:s.getUint32(a+E.MODE,!0),size:h,firstBlock:d,blockCount:m,mtime:s.getFloat64(a+E.MTIME,!0),ctime:s.getFloat64(a+E.CTIME,!0),atime:s.getFloat64(a+E.ATIME,!0),uid:s.getUint32(a+E.UID,!0),gid:s.getUint32(a+E.GID,!0)};this.inodeCache.set(r,w);let l;if(n?l=ut.decode(n.subarray(w.pathOffset,w.pathOffset+w.pathLength)):l=this.readPath(w.pathOffset,w.pathLength),!l.startsWith("/")||l.includes("\\0"))throw new Error(`Corrupt VFS: inode ${r} has invalid path "${l.substring(0,50)}"`);this.setPathIndex(l,r)}this.pathIndexGen++}readInode(t){const e=this.inodeCache.get(t);if(e)return e;const s=this.inodeTableOffset+t*P;this.handle.read(this.inodeBuf,{at:s});const n=this.inodeView,r={type:n.getUint8(E.TYPE),pathOffset:n.getUint32(E.PATH_OFFSET,!0),pathLength:n.getUint16(E.PATH_LENGTH,!0),nlink:n.getUint16(E.NLINK,!0)||1,mode:n.getUint32(E.MODE,!0),size:n.getFloat64(E.SIZE,!0),firstBlock:n.getUint32(E.FIRST_BLOCK,!0),blockCount:n.getUint32(E.BLOCK_COUNT,!0),mtime:n.getFloat64(E.MTIME,!0),ctime:n.getFloat64(E.CTIME,!0),atime:n.getFloat64(E.ATIME,!0),uid:n.getUint32(E.UID,!0),gid:n.getUint32(E.GID,!0)};return this.inodeCache.set(t,r),r}writeInode(t,e){e.type===p.FREE?this.inodeCache.delete(t):this.inodeCache.set(t,e);const s=this.inodeView;s.setUint8(E.TYPE,e.type),s.setUint8(E.FLAGS,0),s.setUint8(E.FLAGS+1,0),s.setUint8(E.FLAGS+2,0),s.setUint32(E.PATH_OFFSET,e.pathOffset,!0),s.setUint16(E.PATH_LENGTH,e.pathLength,!0),s.setUint16(E.NLINK,e.nlink,!0),s.setUint32(E.MODE,e.mode,!0),s.setFloat64(E.SIZE,e.size,!0),s.setUint32(E.FIRST_BLOCK,e.firstBlock,!0),s.setUint32(E.BLOCK_COUNT,e.blockCount,!0),s.setFloat64(E.MTIME,e.mtime,!0),s.setFloat64(E.CTIME,e.ctime,!0),s.setFloat64(E.ATIME,e.atime,!0),s.setUint32(E.UID,e.uid,!0),s.setUint32(E.GID,e.gid,!0);const n=this.inodeTableOffset+t*P;this.handle.write(this.inodeBuf,{at:n})}readPath(t,e){const s=new Uint8Array(e);return this.handle.read(s,{at:this.pathTableOffset+t}),ut.decode(s)}appendPath(t){const e=V.encode(t),s=this.pathTableUsed;return s+e.byteLength>this.pathTableSize&&this.growPathTable(s+e.byteLength),this.handle.write(e,{at:this.pathTableOffset+s}),this.pathTableUsed+=e.byteLength,this.superblockDirty=!0,{offset:s,length:e.byteLength}}growPathTable(t){const e=Math.max(this.pathTableSize*2,t+Jt),s=e-this.pathTableSize,n=this.handle.getSize()+s;this.handle.truncate(n);const r=this.totalBlocks*this.blockSize,a=4*1024*1024,o=new Uint8Array(Math.min(a,Math.max(r,1)));let u=r;for(;u>0;){const d=Math.min(u,a),m=this.dataOffset+(u-d),w=this.dataOffset+s+(u-d),l=d<o.length?o.subarray(0,d):o;this.handle.read(l,{at:m}),this.handle.write(l,{at:w}),u-=d}const f=this.bitmapOffset+s,h=this.dataOffset+s;this.handle.write(this.bitmap,{at:f}),this.pathTableSize=e,this.bitmapOffset=f,this.dataOffset=h,this.superblockDirty=!0}zeroFileRange(t,e){if(e<=0)return;const s=4*1024*1024,n=new Uint8Array(Math.min(e,s));let r=0;for(;r<e;){const a=Math.min(s,e-r),o=a<n.length?n.subarray(0,a):n;this.handle.write(o,{at:t+r}),r+=a}}allocateBlocks(t){if(t===0)return 0;let e=this.scanForRun(this.allocCursor,this.totalBlocks,t);if(e<0&&this.allocCursor>0){const r=Math.min(this.allocCursor+t-1,this.totalBlocks);e=this.scanForRun(0,r,t)}if(e<0)return this.growAndAllocate(t);const s=e+t-1,n=this.bitmap;for(let r=e;r<=s;r++)n[r>>>3]|=1<<(r&7);return this.markBitmapDirty(e>>>3,s>>>3),this.freeBlocks-=t,this.superblockDirty=!0,this.allocCursor=s+1>=this.totalBlocks?0:s+1,e}scanForRun(t,e,s){const n=this.bitmap;let r=0,a=t;for(let o=t;o<e;o++){if(r===0&&(o&7)===0&&n[o>>>3]===255){o+=7,a=o+1;continue}if(n[o>>>3]>>>(o&7)&1)r=0,a=o+1;else if(++r===s)return a}return-1}bitmapCapacityBlocks(){return(this.dataOffset-this.bitmapOffset)*8}growAndAllocate(t){const e=this.totalBlocks,s=Math.min(this.maxBlocks,this.bitmapCapacityBlocks());let n=Math.max(e*2,e+t);if(n>s&&(n=s),n<e+t)throw new Error(`ENOSPC: cannot allocate ${t} blocks (total ${e}, ceiling ${s})`);const r=n-e,a=this.dataOffset+n*this.blockSize;this.handle.truncate(a);const o=Math.ceil(n/8),u=new Uint8Array(o);u.set(this.bitmap),this.bitmap=u,this.totalBlocks=n,this.freeBlocks+=r;const f=e;for(let h=f;h<f+t;h++){const d=h>>>3,m=h&7;this.bitmap[d]|=1<<m}return this.markBitmapDirty(f>>>3,f+t-1>>>3),this.freeBlocks-=t,this.superblockDirty=!0,f}blocksFreedsinceTrim=!1;freeBlockRange(t,e){if(e===0)return;const s=this.bitmap;for(let n=t;n<t+e;n++){const r=n>>>3,a=n&7;s[r]&=~(1<<a)}this.markBitmapDirty(t>>>3,t+e-1>>>3),this.freeBlocks+=e,this.superblockDirty=!0,this.blocksFreedsinceTrim=!0}findFreeInode(){for(let e=this.freeInodeHint;e<this.inodeCount;e++){if(this.inodeCache.has(e))continue;const s=this.inodeTableOffset+e*P,n=new Uint8Array(1);if(this.handle.read(n,{at:s}),n[0]===p.FREE)return this.freeInodeHint=e+1,e}const t=this.growInodeTable();return this.freeInodeHint=t+1,t}growInodeTable(){const t=this.inodeCount,e=t*2,s=(e-t)*P,n=this.inodeTableOffset+t*P,r=this.handle.getSize(),a=r-n;this.handle.truncate(r+s);const o=8*1024*1024;if(a>0){const d=new Uint8Array(Math.min(o,a));let m=a;for(;m>0;){const w=Math.min(o,m),l=n+m-w,I=w===d.length?d:d.subarray(0,w);this.handle.read(I,{at:l}),this.handle.write(I,{at:l+s}),m-=w}}const u=new Uint8Array(Math.min(o,s));let f=s,h=n;for(;f>0;){const d=Math.min(o,f);this.handle.write(d===u.length?u:u.subarray(0,d),{at:h}),h+=d,f-=d}return this.pathTableOffset+=s,this.bitmapOffset+=s,this.dataOffset+=s,this.inodeCount=e,this.superblockDirty=!0,t}readData(t,e,s){const n=new Uint8Array(s),r=this.dataOffset+t*this.blockSize;return this.handle.read(n,{at:r}),n}writeData(t,e){const s=this.dataOffset+t*this.blockSize;this.handle.write(e,{at:s})}resolvePath(t,e=0){if(e===0&&(this.symlinkLoopDetected=!1),e>Pt){this.symlinkLoopDetected=!0;return}const s=this.pathIndex.get(t);if(s===void 0)return this.resolvePathComponents(t,!0,e);const n=this.readInode(s);if(n.type===p.SYMLINK){const r=ut.decode(this.readData(n.firstBlock,n.blockCount,n.size)),a=r.startsWith("/")?r:this.resolveRelative(t,r);return this.resolvePath(a,e+1)}return s}resolvePathComponents(t,e=!0,s=0){return this.resolvePathFull(t,e,s)?.idx}resolvePathFull(t,e=!0,s=0){if(s===0&&(this.symlinkLoopDetected=!1),s>Pt){this.symlinkLoopDetected=!0;return}const n=t.split("/").filter(Boolean);let r="/";for(let o=0;o<n.length;o++){const u=o===n.length-1;r=r==="/"?"/"+n[o]:r+"/"+n[o];const f=this.pathIndex.get(r);if(f===void 0)return;const h=this.readInode(f);if(h.type===p.SYMLINK&&(!u||e)){const d=ut.decode(this.readData(h.firstBlock,h.blockCount,h.size)),m=d.startsWith("/")?d:this.resolveRelative(r,d);if(u)return this.resolvePathFull(m,!0,s+1);const w=n.slice(o+1).join("/"),l=m+(w?"/"+w:"");return this.resolvePathFull(l,e,s+1)}}const a=this.pathIndex.get(r);if(a!==void 0)return{idx:a,resolvedPath:r}}resolveDanglingLink(t,e=0){if(e>Pt)return null;const s=this.pathIndex.get(t);if(s===void 0)return t;const n=this.readInode(s);if(n.type!==p.SYMLINK)return t;const r=ut.decode(this.readData(n.firstBlock,n.blockCount,n.size)),a=r.startsWith("/")?r:this.resolveRelative(t,r);return this.resolveDanglingLink(a,e+1)}resolveRelative(t,e){const n=((t.substring(0,t.lastIndexOf("/"))||"/")+"/"+e).split("/").filter(Boolean),r=[];for(const a of n)if(a!=="."){if(a===".."){r.pop();continue}r.push(a)}return"/"+r.join("/")}createInode(t,e,s,n,r){const a=this.findFreeInode(),{offset:o,length:u}=this.appendPath(t),f=Date.now();let h=0,d=0;r&&r.byteLength>0&&(d=Math.ceil(r.byteLength/this.blockSize),h=this.allocateBlocks(d),this.writeData(h,r));const m={type:e,pathOffset:o,pathLength:u,nlink:e===p.DIRECTORY?2:1,mode:s,size:n,firstBlock:h,blockCount:d,mtime:f,ctime:f,atime:f,uid:this.processUid,gid:this.processGid};return this.writeInode(a,m),this.setPathIndex(t,a),this.pathIndexGen++,a}normalizePath(t){if(t.charCodeAt(0)!==47&&(t="/"+t),t.length===1||t.indexOf("/.")===-1&&t.indexOf("//")===-1&&t.charCodeAt(t.length-1)!==47)return t;const e=t.split("/").filter(Boolean),s=[];for(const n of e)if(n!=="."){if(n===".."){s.pop();continue}s.push(n)}return"/"+s.join("/")}read(t){const e=this.debug?performance.now():0;t=this.normalizePath(t);let s=this.pathIndex.get(t);if(s!==void 0){const a=this.inodeCache.get(s);if(a)if(a.type===p.SYMLINK)s=this.resolvePathComponents(t,!0);else{if(a.type===p.DIRECTORY)return{status:y.EISDIR,data:null};{const o=a.size>0?this.readData(a.firstBlock,a.blockCount,a.size):new Uint8Array(0);if(this.debug){const u=performance.now();console.log(`[VFS read] path=${t} size=${a.size} TOTAL=${(u-e).toFixed(3)}ms (fast)`)}return{status:0,data:o}}}}if(s===void 0&&(s=this.resolvePathComponents(t,!0)),s===void 0)return{status:this.resolveFailureStatus(),data:null};const n=this.readInode(s);if(n.type===p.DIRECTORY)return{status:y.EISDIR,data:null};const r=n.size>0?this.readData(n.firstBlock,n.blockCount,n.size):new Uint8Array(0);if(this.debug){const a=performance.now();console.log(`[VFS read] path=${t} size=${n.size} TOTAL=${(a-e).toFixed(3)}ms (slow path)`)}return{status:0,data:r}}write(t,e,s=0){const n=this.debug?performance.now():0;t=this.normalizePath(t);const r=this.debug?performance.now():0,a=this.ensureParent(t);if(a!==0)return{status:a};const o=this.debug?performance.now():0;let u=this.resolvePathComponents(t,!0);if(u===void 0){const l=this.resolveDanglingLink(t);if(l===null)return{status:y.ELOOP};if(l!==t){t=l;const I=this.ensureParent(t);if(I!==0)return{status:I};u=this.resolvePathComponents(t,!0)}}const f=this.debug?performance.now():0;let h=f,d=f,m=f;if(u!==void 0){const l=this.readInode(u);if(l.type===p.DIRECTORY)return{status:y.EISDIR};const I=Math.ceil(e.byteLength/this.blockSize);if(I<=l.blockCount)h=this.debug?performance.now():0,this.writeData(l.firstBlock,e),d=this.debug?performance.now():0,I<l.blockCount&&this.freeBlockRange(l.firstBlock+I,l.blockCount-I);else{this.freeBlockRange(l.firstBlock,l.blockCount);const T=this.allocateBlocks(I);h=this.debug?performance.now():0,this.writeData(T,e),d=this.debug?performance.now():0,l.firstBlock=T}l.size=e.byteLength,l.blockCount=I,l.mtime=Date.now(),this.writeInode(u,l),m=this.debug?performance.now():0}else{if(this.isImplicitDirectory(t))return{status:y.EISDIR};const l=Re&~(this.umask&511);this.createInode(t,p.FILE,l,e.byteLength,e),h=this.debug?performance.now():0,d=h,m=h}this.commitPending(),s&1&&this.handle.flush();const w=this.debug?performance.now():0;if(this.debug){const l=u!==void 0;console.log(`[VFS write] path=${t} size=${e.byteLength} ${l?"UPDATE":"CREATE"} normalize=${(r-n).toFixed(3)}ms parent=${(o-r).toFixed(3)}ms resolve=${(f-o).toFixed(3)}ms alloc=${(h-f).toFixed(3)}ms data=${(d-h).toFixed(3)}ms inode=${(m-d).toFixed(3)}ms flush=${(w-m).toFixed(3)}ms TOTAL=${(w-n).toFixed(3)}ms`)}return{status:0}}append(t,e){t=this.normalizePath(t);const s=this.resolvePathComponents(t,!0);if(s===void 0)return this.write(t,e);const n=this.readInode(s);if(n.type===p.DIRECTORY)return{status:y.EISDIR};const r=n.size+e.byteLength,a=Math.ceil(r/this.blockSize);if(a<=n.blockCount)return this.handle.write(e,{at:this.dataOffset+n.firstBlock*this.blockSize+n.size}),n.size=r,n.mtime=Date.now(),this.writeInode(s,n),this.commitPending(),{status:0};const o=this.allocateBlocks(a),u=this.dataOffset+o*this.blockSize;if(n.size>0){const f=this.dataOffset+n.firstBlock*this.blockSize,h=4*1024*1024,d=new Uint8Array(Math.min(h,n.size));let m=0;for(;m<n.size;){const w=Math.min(h,n.size-m),l=w<d.length?d.subarray(0,w):d;this.handle.read(l,{at:f+m}),this.handle.write(l,{at:u+m}),m+=w}}return this.freeBlockRange(n.firstBlock,n.blockCount),this.handle.write(e,{at:u+n.size}),n.firstBlock=o,n.blockCount=a,n.size=r,n.mtime=Date.now(),this.writeInode(s,n),this.commitPending(),{status:0}}unlink(t){t=this.normalizePath(t);const e=this.pathIndex.get(t);if(e===void 0)return{status:y.ENOENT};const s=this.readInode(e);return s.type===p.DIRECTORY?{status:y.EISDIR}:(s.nlink=Math.max(0,s.nlink-1),this.freeBlockRange(s.firstBlock,s.blockCount),s.type=p.FREE,this.writeInode(e,s),this.deletePathIndex(t),this.pathIndexGen++,e<this.freeInodeHint&&(this.freeInodeHint=e),this.commitPending(),{status:0})}stat(t){t=this.normalizePath(t);const e=this.resolvePathComponents(t,!0);if(e===void 0){const s=this.resolveFailureStatus();return this.isImplicitDirectory(t)?this.encodeImplicitDirStatResponse(t):{status:s,data:null}}return this.encodeStatResponse(e)}lstat(t){t=this.normalizePath(t);let e=this.resolvePathComponents(t,!1);return e===void 0&&(e=this.resolvePathComponents(t,!0),e===void 0)?this.isImplicitDirectory(t)?this.encodeImplicitDirStatResponse(t):{status:y.ENOENT,data:null}:this.encodeStatResponse(e)}encodeStatResponse(t){const e=this.readInode(t);let s=e.nlink;e.type===p.DIRECTORY&&(s=2+this.countSubdirectories(this.readPath(e.pathOffset,e.pathLength)));const n=new Uint8Array(53),r=new DataView(n.buffer);return r.setUint8(0,e.type),r.setUint32(1,e.mode,!0),r.setFloat64(5,e.size,!0),r.setFloat64(13,e.mtime,!0),r.setFloat64(21,e.ctime,!0),r.setFloat64(29,e.atime,!0),r.setUint32(37,e.uid,!0),r.setUint32(41,e.gid,!0),r.setUint32(45,t,!0),r.setUint32(49,s,!0),{status:0,data:n}}mkdir(t,e=0,s=511){if(t=this.normalizePath(t),(e&1)!==0)return this.mkdirRecursive(t,s);if(this.pathIndex.has(t)||this.isImplicitDirectory(t))return{status:y.EEXIST,data:null};const r=this.ensureParent(t);return r!==0?{status:r,data:null}:(this.createInode(t,p.DIRECTORY,this.dirModeFor(s),0),this.commitPending(),{status:0,data:null})}dirModeFor(t){return xe|t&4095&~(this.umask&511)}fileModeFor(t){return Ue|t&4095&~(this.umask&511)}mkdirRecursive(t,e=511){const s=t.split("/").filter(Boolean);let n="",r=null;for(const o of s){if(n+="/"+o,this.pathIndex.has(n)){const u=this.pathIndex.get(n);if(this.readInode(u).type!==p.DIRECTORY)return{status:y.ENOTDIR,data:null};continue}this.createInode(n,p.DIRECTORY,this.dirModeFor(e),0),r||(r=n)}return this.commitPending(),{status:0,data:(r?V.encode(r):void 0)??null}}rmdir(t,e=0){t=this.normalizePath(t);const s=(e&1)!==0,n=this.pathIndex.get(t);if(n===void 0){if(this.isImplicitDirectory(t)){if(this.getDirectChildrenWithImplicit(t).length>0){if(!s)return{status:y.ENOTEMPTY};for(const u of this.getAllDescendants(t)){const f=this.pathIndex.get(u),h=this.readInode(f);this.freeBlockRange(h.firstBlock,h.blockCount),h.type=p.FREE,this.writeInode(f,h),this.deletePathIndex(u)}this.pathIndexGen++,this.commitPending()}return{status:0}}return{status:y.ENOENT}}const r=this.readInode(n);if(r.type!==p.DIRECTORY)return{status:y.ENOTDIR};if(this.getDirectChildren(t).length>0){if(!s)return{status:y.ENOTEMPTY};for(const o of this.getAllDescendants(t)){const u=this.pathIndex.get(o),f=this.readInode(u);this.freeBlockRange(f.firstBlock,f.blockCount),f.type=p.FREE,this.writeInode(u,f),this.deletePathIndex(o)}}return t==="/"?(this.pathIndexGen++,this.commitPending(),{status:0}):(r.type=p.FREE,this.writeInode(n,r),this.deletePathIndex(t),this.pathIndexGen++,n<this.freeInodeHint&&(this.freeInodeHint=n),this.commitPending(),{status:0})}readdir(t,e=0){t=this.normalizePath(t);const s=this.resolvePathFull(t,!0);let n;if(s){if(this.readInode(s.idx).type!==p.DIRECTORY)return{status:y.ENOTDIR,data:null};n=s.resolvedPath}else if(this.isImplicitDirectory(t))n=t;else return{status:y.ENOENT,data:null};if((e&1)!==0){this.ensureChildIndex();const m=this.childIndex.get(n);if(!m)return{status:0,data:new Uint8Array([0,0,0,0])};const w=[...m.keys()].sort(),l=n==="/"?"/":n+"/";let I=4;for(const R of w)I+=3+R.length*3;const T=new Uint8Array(I),F=new DataView(T.buffer);F.setUint32(0,w.length,!0);let C=4;for(const R of w){const{written:$}=V.encodeInto(R,T.subarray(C+2));F.setUint16(C,$,!0),C+=2+$;const Zt=this.pathIndex.get(l+R);T[C++]=Zt===void 0?p.DIRECTORY:this.readInode(Zt).type}return{status:0,data:T.subarray(0,C)}}this.ensureChildIndex();const a=this.childIndex.get(n);if(!a)return{status:0,data:new Uint8Array([0,0,0,0])};const o=[...a.keys()].sort();let u=4;for(const m of o)u+=2+m.length*3;const f=new Uint8Array(u),h=new DataView(f.buffer);h.setUint32(0,o.length,!0);let d=4;for(const m of o){const{written:w}=V.encodeInto(m,f.subarray(d+2));h.setUint16(d,w,!0),d+=2+w}return{status:0,data:f.subarray(0,d)}}rename(t,e){t=this.normalizePath(t),e=this.normalizePath(e);const s=this.pathIndex.get(t);if(s===void 0)return{status:y.ENOENT};if(t===e)return{status:0};const n=this.ensureParent(e);if(n!==0)return{status:n};const r=this.pathIndex.get(e),a=r===void 0&&this.isImplicitDirectory(e);if(r!==void 0||a){const h=this.readInode(s).type===p.DIRECTORY,d=a||r!==void 0&&this.readInode(r).type===p.DIRECTORY;if(h&&!d)return{status:y.ENOTDIR};if(!h&&d)return{status:y.EISDIR}}if(r!==void 0||a){let h=a;if(r!==void 0){const d=this.readInode(r);h=d.type===p.DIRECTORY,this.freeBlockRange(d.firstBlock,d.blockCount),d.type=p.FREE,this.writeInode(r,d),this.deletePathIndex(e),r<this.freeInodeHint&&(this.freeInodeHint=r)}if(h)for(const d of this.getAllDescendants(e)){const m=this.pathIndex.get(d),w=this.readInode(m);this.freeBlockRange(w.firstBlock,w.blockCount),w.type=p.FREE,this.writeInode(m,w),this.deletePathIndex(d),m<this.freeInodeHint&&(this.freeInodeHint=m)}}const o=this.readInode(s),{offset:u,length:f}=this.appendPath(e);if(o.pathOffset=u,o.pathLength=f,o.mtime=Date.now(),this.writeInode(s,o),this.deletePathIndex(t),this.setPathIndex(e,s),this.pathIndexGen++,o.type===p.DIRECTORY){const h=t==="/"?"/":t+"/",d=[];for(const[m,w]of this.pathIndex)m.startsWith(h)&&d.push([m,w]);for(const[m,w]of d){const l=m.substring(t.length),I=e+l,T=this.readInode(w),{offset:F,length:C}=this.appendPath(I);T.pathOffset=F,T.pathLength=C,this.writeInode(w,T),this.deletePathIndex(m),this.setPathIndex(I,w)}}return this.commitPending(),{status:0}}exists(t){t=this.normalizePath(t);const e=this.resolvePathComponents(t,!0),s=new Uint8Array(1);return s[0]=e!==void 0||this.isImplicitDirectory(t)?1:0,{status:0,data:s}}truncate(t,e=0){t=this.normalizePath(t);const s=this.resolvePathComponents(t,!0);if(s===void 0)return{status:this.resolveFailureStatus()};const n=this.readInode(s);if(n.type===p.DIRECTORY)return{status:y.EISDIR};if(e===0)this.freeBlockRange(n.firstBlock,n.blockCount),n.firstBlock=0,n.blockCount=0,n.size=0;else if(e<n.size){const r=Math.ceil(e/this.blockSize);r<n.blockCount&&this.freeBlockRange(n.firstBlock+r,n.blockCount-r),n.blockCount=r,n.size=e}else if(e>n.size){const r=Math.ceil(e/this.blockSize);if(r>n.blockCount){const a=this.allocateBlocks(r),o=this.dataOffset+a*this.blockSize;if(n.size>0){const u=this.dataOffset+n.firstBlock*this.blockSize,f=4*1024*1024,h=new Uint8Array(Math.min(f,n.size));let d=0;for(;d<n.size;){const m=Math.min(f,n.size-d),w=m<h.length?h.subarray(0,m):h;this.handle.read(w,{at:u+d}),this.handle.write(w,{at:o+d}),d+=m}}this.freeBlockRange(n.firstBlock,n.blockCount),this.zeroFileRange(o+n.size,e-n.size),n.firstBlock=a}else this.zeroFileRange(this.dataOffset+n.firstBlock*this.blockSize+n.size,e-n.size);n.blockCount=r,n.size=e}return n.mtime=Date.now(),this.writeInode(s,n),this.commitPending(),{status:0}}copy(t,e,s=0){t=this.normalizePath(t),e=this.normalizePath(e);const n=this.resolvePathComponents(t,!0);if(n===void 0)return{status:this.resolveFailureStatus()};const r=this.readInode(n);if(r.type===p.DIRECTORY)return{status:y.ENOTSUP};if(s&1&&(this.pathIndex.has(e)||this.isImplicitDirectory(e)))return{status:y.EEXIST};if(t===e)return{status:0};const a=r.size,o=r.firstBlock,u=r.mode,f=this.write(e,new Uint8Array(0));if(f.status!==0)return f;if(a===0){const R=this.resolvePathComponents(e,!0);if(R!==void 0){const $=this.readInode(R);$.mode=$.mode&-4096|u&4095,this.writeInode(R,$),this.commitPending()}return{status:0}}const h=this.resolvePathComponents(e,!0);if(h===void 0)return{status:y.EIO};const d=this.readInode(h),m=Math.ceil(a/this.blockSize),w=this.allocateBlocks(m),l=this.dataOffset+w*this.blockSize,I=this.dataOffset+o*this.blockSize,T=4*1024*1024,F=new Uint8Array(Math.min(T,a));let C=0;for(;C<a;){const R=Math.min(T,a-C),$=R<F.length?F.subarray(0,R):F;this.handle.read($,{at:I+C}),this.handle.write($,{at:l+C}),C+=R}return d.firstBlock=w,d.blockCount=m,d.size=a,d.mtime=Date.now(),d.mode=d.mode&-4096|u&4095,this.writeInode(h,d),this.commitPending(),{status:0}}access(t,e=0){t=this.normalizePath(t);const s=this.resolvePathComponents(t,!0);if(s===void 0){const a=this.resolveFailureStatus();return this.isImplicitDirectory(t)?{status:0}:{status:a}}if(e===0)return{status:0};if(!this.strictPermissions)return{status:0};const n=this.readInode(s),r=this.getEffectivePermission(n);return e&4&&!(r&4)?{status:y.EACCES}:e&2&&!(r&2)?{status:y.EACCES}:e&1&&!(r&1)?{status:y.EACCES}:{status:0}}getEffectivePermission(t){const e=t.mode&511;return this.processUid===t.uid?e>>>6&7:this.processGid===t.gid?e>>>3&7:e&7}realpath(t){t=this.normalizePath(t);const e=this.resolvePathComponents(t,!0);if(e===void 0){const r=this.resolveFailureStatus();return this.isImplicitDirectory(t)?{status:0,data:V.encode(t)}:{status:r,data:null}}const s=this.readInode(e),n=this.readPath(s.pathOffset,s.pathLength);return{status:0,data:V.encode(n)}}chmod(t,e,s=!0){t=this.normalizePath(t);const n=this.resolvePathComponents(t,s);if(n===void 0)return{status:this.resolveFailureStatus()};const r=this.readInode(n);return r.mode=r.mode&jt|e&4095,r.ctime=Date.now(),this.writeInode(n,r),{status:0}}chown(t,e,s,n=!0){t=this.normalizePath(t);const r=this.resolvePathComponents(t,n);if(r===void 0)return{status:this.resolveFailureStatus()};const a=this.readInode(r);return a.uid=e,a.gid=s,a.ctime=Date.now(),this.writeInode(r,a),{status:0}}utimes(t,e,s,n=!0){t=this.normalizePath(t);const r=this.resolvePathComponents(t,n);if(r===void 0)return{status:this.resolveFailureStatus()};const a=this.readInode(r);return a.atime=e,a.mtime=s,a.ctime=Date.now(),this.writeInode(r,a),{status:0}}symlink(t,e){if(e=this.normalizePath(e),this.pathIndex.has(e)||this.isImplicitDirectory(e))return{status:y.EEXIST};const s=this.ensureParent(e);if(s!==0)return{status:s};const n=V.encode(t);return this.createInode(e,p.SYMLINK,ve,n.byteLength,n),this.commitPending(),{status:0}}readlink(t){t=this.normalizePath(t);const e=this.pathIndex.get(t);if(e===void 0)return{status:y.ENOENT,data:null};const s=this.readInode(e);return s.type!==p.SYMLINK?{status:y.EINVAL,data:null}:{status:0,data:this.readData(s.firstBlock,s.blockCount,s.size)}}link(t,e){t=this.normalizePath(t),e=this.normalizePath(e);const s=this.resolvePathComponents(t,!0);if(s===void 0)return{status:this.resolveFailureStatus()};const n=this.readInode(s);if(n.type===p.DIRECTORY)return{status:y.EPERM};if(this.pathIndex.has(e)||this.isImplicitDirectory(e))return{status:y.EEXIST};const r=this.copy(t,e);if(r.status!==0)return r;n.nlink++,this.writeInode(s,n);const a=this.pathIndex.get(e);if(a!==void 0){const o=this.readInode(a);o.nlink=n.nlink,this.writeInode(a,o)}return{status:0}}open(t,e,s,n=438){t=this.normalizePath(t);const r=(e&64)!==0,a=(e&512)!==0,o=(e&128)!==0;let u=this.resolvePathComponents(t,!0);if(u===void 0){const d=this.resolveDanglingLink(t);if(d===null)return{status:y.ELOOP,data:null};d!==t&&(t=d,u=this.resolvePathComponents(t,!0))}if(St.isWritable(e)&&(u!==void 0?this.readInode(u).type===p.DIRECTORY:this.isImplicitDirectory(t)))return{status:y.EISDIR,data:null};if(u===void 0){if(!r)return{status:this.resolveFailureStatus(),data:null};const d=this.ensureParent(t);if(d!==0)return{status:d,data:null};u=this.createInode(t,p.FILE,this.fileModeFor(n),0)}else if(o&&r)return{status:y.EEXIST,data:null};a&&this.truncate(t,0);const f=this.nextFd++;this.fdTable.set(f,{tabId:s,inodeIdx:u,position:0,flags:e});const h=new Uint8Array(4);return new DataView(h.buffer).setUint32(0,f,!0),{status:0,data:h}}close(t){return this.fdTable.has(t)?(this.fdTable.delete(t),{status:0}):{status:y.EBADF}}fread(t,e,s){const n=this.fdTable.get(t);if(!n)return{status:y.EBADF,data:null};if(!St.isReadable(n.flags))return{status:y.EBADF,data:null};const r=this.readInode(n.inodeIdx);if(r.type===p.DIRECTORY)return{status:y.EISDIR,data:null};const a=s??n.position,o=Math.min(e,r.size-a);if(o<=0)return{status:0,data:new Uint8Array(0)};const u=this.dataOffset+r.firstBlock*this.blockSize+a,f=new Uint8Array(o);return this.handle.read(f,{at:u}),s===null&&(n.position+=o),{status:0,data:f}}fwrite(t,e,s){const n=this.fdTable.get(t);if(!n)return{status:y.EBADF,data:null};if(!St.isWritable(n.flags))return{status:y.EBADF,data:null};const r=this.readInode(n.inodeIdx),o=(n.flags&1024)!==0?r.size:s??n.position,u=o+e.byteLength;if(u>r.size){const h=Math.ceil(u/this.blockSize);if(h>r.blockCount){const d=this.allocateBlocks(h),m=this.dataOffset+d*this.blockSize,w=this.dataOffset+r.firstBlock*this.blockSize;if(r.size>0){const I=new Uint8Array(Math.min(4194304,r.size));let T=0;for(;T<r.size;){const F=Math.min(4194304,r.size-T),C=F<I.length?I.subarray(0,F):I;this.handle.read(C,{at:w+T}),this.handle.write(C,{at:m+T}),T+=F}}this.freeBlockRange(r.firstBlock,r.blockCount),o>r.size&&this.zeroFileRange(m+r.size,o-r.size),this.handle.write(e,{at:m+o}),r.firstBlock=d,r.blockCount=h}else{o>r.size&&this.zeroFileRange(this.dataOffset+r.firstBlock*this.blockSize+r.size,o-r.size);const d=this.dataOffset+r.firstBlock*this.blockSize+o;this.handle.write(e,{at:d})}r.size=u}else{const h=this.dataOffset+r.firstBlock*this.blockSize+o;this.handle.write(e,{at:h})}r.mtime=Date.now(),this.writeInode(n.inodeIdx,r),s===null&&(n.position=u),this.commitPending();const f=new Uint8Array(4);return new DataView(f.buffer).setUint32(0,e.byteLength,!0),{status:0,data:f}}fstat(t){const e=this.fdTable.get(t);return e?e.implicitPath?this.encodeImplicitDirStatResponse(e.implicitPath):this.encodeStatResponse(e.inodeIdx):{status:y.EBADF,data:null}}ftruncate(t,e=0){const s=this.fdTable.get(t);if(!s)return{status:y.EBADF};if(!St.isWritable(s.flags))return{status:y.EINVAL};const n=this.readInode(s.inodeIdx),r=this.readPath(n.pathOffset,n.pathLength);return this.truncate(r,e)}statfs(t="/"){if(t=this.normalizePath(t),this.resolvePathComponents(t,!0)===void 0&&!this.isImplicitDirectory(t))return{status:this.resolveFailureStatus(),data:null};const e=new Set(this.pathIndex.values()).size,s=new Uint8Array(24),n=new DataView(s.buffer);return n.setUint32(0,lt,!0),n.setUint32(4,this.blockSize,!0),n.setUint32(8,this.totalBlocks,!0),n.setUint32(12,this.freeBlocks,!0),n.setUint32(16,this.inodeCount,!0),n.setUint32(20,Math.max(0,this.inodeCount-e),!0),{status:0,data:s}}fsync(t){return t!==void 0&&!this.fdTable.has(t)?{status:y.EBADF}:(this.commitPending(),this.handle.flush(),{status:0})}fchmod(t,e){const s=this.fdTable.get(t);if(!s)return{status:y.EBADF};if(s.implicitPath)return{status:0};const n=this.readInode(s.inodeIdx);return n.mode=n.mode&jt|e&4095,n.ctime=Date.now(),this.writeInode(s.inodeIdx,n),{status:0}}fchown(t,e,s){const n=this.fdTable.get(t);if(!n)return{status:y.EBADF};if(n.implicitPath)return{status:0};const r=this.readInode(n.inodeIdx);return r.uid=e,r.gid=s,r.ctime=Date.now(),this.writeInode(n.inodeIdx,r),{status:0}}futimes(t,e,s){const n=this.fdTable.get(t);if(!n)return{status:y.EBADF};if(n.implicitPath)return{status:0};const r=this.readInode(n.inodeIdx);return r.atime=e,r.mtime=s,r.ctime=Date.now(),this.writeInode(n.inodeIdx,r),{status:0}}opendir(t,e){t=this.normalizePath(t);const s=this.resolvePathComponents(t,!0);if(s===void 0){if(this.isImplicitDirectory(t)){const o=this.nextFd++;this.fdTable.set(o,{tabId:e,inodeIdx:-1,position:0,flags:0,implicitPath:t});const u=new Uint8Array(4);return new DataView(u.buffer).setUint32(0,o,!0),{status:0,data:u}}return{status:y.ENOENT,data:null}}if(this.readInode(s).type!==p.DIRECTORY)return{status:y.ENOTDIR,data:null};const r=this.nextFd++;this.fdTable.set(r,{tabId:e,inodeIdx:s,position:0,flags:0});const a=new Uint8Array(4);return new DataView(a.buffer).setUint32(0,r,!0),{status:0,data:a}}mkdtemp(t){const e=Math.random().toString(36).substring(2,8),s=this.normalizePath(t+e),n=s.substring(0,s.lastIndexOf("/"))||"/";return n!=="/"&&this.resolvePathComponents(n,!0)===void 0&&!this.isImplicitDirectory(n)?{status:y.ENOENT,data:null}:(this.createInode(s,p.DIRECTORY,this.dirModeFor(448),0),this.commitPending(),{status:0,data:V.encode(s)})}getDirectChildren(t){this.ensureChildIndex();const e=this.childIndex.get(t);if(!e)return[];const s=t==="/"?"/":t+"/",n=[];for(const r of e.keys()){const a=s+r;this.pathIndex.has(a)&&n.push(a)}return n.sort()}rebuildImplicitDirs(){if(this.implicitDirsGen===this.pathIndexGen)return;const t=Date.now(),e=this.implicitDirs;this.implicitDirs=new Map;for(const s of this.pathIndex.keys()){let n=s.length;for(;n=s.lastIndexOf("/",n-1),!(n<=0);){const r=s.substring(0,n);if(this.implicitDirs.has(r))break;this.pathIndex.has(r)||this.implicitDirs.set(r,e.get(r)??t)}}this.implicitDirsGen=this.pathIndexGen}isImplicitDirectory(t){return t==="/"||this.pathIndex.has(t)?!1:(this.descCountGen<this.pathIndexGen&&this.rebuildDescCount(),(this.descCount.get(t)??0)>0)}rebuildDescCount(){this.descCount.clear();for(const t of this.pathIndex.keys())this.bumpDescCount(t);this.descCountGen=this.pathIndexGen}setPathIndex(t,e){const s=this.pathIndex.has(t);this.pathIndex.set(t,e),s||(this.bumpDescCount(t),this.bumpChildIndex(t)),this.descCountGen=this.pathIndexGen+1,this.childIndexGen=this.pathIndexGen+1}deletePathIndex(t){const e=this.pathIndex.delete(t);return e&&(this.decDescCount(t),this.decChildIndex(t)),this.descCountGen=this.pathIndexGen+1,this.childIndexGen=this.pathIndexGen+1,e}bumpDescCount(t){let e=t.length;for(;e=t.lastIndexOf("/",e-1),!(e<=0);){const s=t.substring(0,e);this.descCount.set(s,(this.descCount.get(s)??0)+1)}}decDescCount(t){let e=t.length;for(;e=t.lastIndexOf("/",e-1),!(e<=0);){const s=t.substring(0,e),n=this.descCount.get(s);if(n===void 0)break;n<=1?this.descCount.delete(s):this.descCount.set(s,n-1)}}bumpChildIndex(t){if(t==="/"||t.length===0)return;let e="/",s=1;for(;s<=t.length;){let n=t.indexOf("/",s);n===-1&&(n=t.length);const r=t.substring(s,n);if(r.length>0){let a=this.childIndex.get(e);a||(a=new Map,this.childIndex.set(e,a)),a.set(r,(a.get(r)??0)+1),e=e==="/"?"/"+r:e+"/"+r}s=n+1}}decChildIndex(t){if(t==="/"||t.length===0)return;let e="/",s=1;for(;s<=t.length;){let n=t.indexOf("/",s);n===-1&&(n=t.length);const r=t.substring(s,n);if(r.length>0){const a=this.childIndex.get(e);if(!a)break;const o=a.get(r);if(o===void 0)break;o<=1?(a.delete(r),a.size===0&&this.childIndex.delete(e)):a.set(r,o-1),e=e==="/"?"/"+r:e+"/"+r}s=n+1}}ensureChildIndex(){if(!(this.childIndexGen>=this.pathIndexGen)){this.childIndex.clear();for(const t of this.pathIndex.keys())this.bumpChildIndex(t);this.childIndexGen=this.pathIndexGen}}countSubdirectories(t){this.ensureChildIndex();const e=this.childIndex.get(t);if(!e)return 0;const s=t==="/"?"/":t+"/";let n=0;for(const r of e.keys()){const a=this.pathIndex.get(s+r);(a===void 0||this.readInode(a).type===p.DIRECTORY)&&n++}return n}getDirectChildrenWithImplicit(t){this.ensureChildIndex();const e=this.childIndex.get(t);if(!e)return[];const s=t==="/"?"/":t+"/",n=[];for(const r of e.keys()){const a=s+r;n.push({path:a,type:this.pathIndex.has(a)?"real":"implicit"})}return n.sort((r,a)=>r.path<a.path?-1:r.path>a.path?1:0),n}encodeImplicitDirStatResponse(t){this.rebuildImplicitDirs();const e=this.implicitDirs.get(t)??Date.now(),s=Qt&~(this.umask&511),n=2+this.countSubdirectories(t),r=new Uint8Array(53),a=new DataView(r.buffer);return a.setUint8(0,p.DIRECTORY),a.setUint32(1,s,!0),a.setFloat64(5,0,!0),a.setFloat64(13,e,!0),a.setFloat64(21,e,!0),a.setFloat64(29,e,!0),a.setUint32(37,this.processUid,!0),a.setUint32(41,this.processGid,!0),a.setUint32(45,0,!0),a.setUint32(49,n,!0),{status:0,data:r}}getAllDescendants(t){const e=t==="/"?"/":t+"/",s=[];for(const n of this.pathIndex.keys())n!==t&&n.startsWith(e)&&s.push(n);return s.sort((n,r)=>{const a=n.split("/").length;return r.split("/").length-a})}ensureParent(t){const e=t.lastIndexOf("/");if(e<=0)return 0;const s=t.substring(0,e),n=this.pathIndex.get(s);return n===void 0?this.isImplicitDirectory(s)?0:y.ENOENT:this.readInode(n).type!==p.DIRECTORY?y.ENOTDIR:0}cleanupTab(t){for(const[e,s]of this.fdTable)s.tabId===t&&this.fdTable.delete(e)}getAllFiles(){const t=[];for(const[e,s]of this.pathIndex)t.push({path:e,idx:s});return t}getPathForFd(t){const e=this.fdTable.get(t);if(!e)return null;const s=this.readInode(e.inodeIdx);return this.readPath(s.pathOffset,s.pathLength)}getInodeData(t){const e=this.readInode(t),s=e.size>0?this.readData(e.firstBlock,e.blockCount,e.size):new Uint8Array(0);return{type:e.type,data:s,mtime:e.mtime}}exportAll(){const t=[];for(const[e,s]of this.pathIndex){const n=this.readInode(s);let r=null;(n.type===p.FILE||n.type===p.SYMLINK)&&(r=n.size>0?this.readData(n.firstBlock,n.blockCount,n.size):new Uint8Array(0)),t.push({path:e,type:n.type,data:r,mode:n.mode,mtime:n.mtime})}return t.sort((e,s)=>e.type===p.DIRECTORY&&s.type!==p.DIRECTORY?-1:e.type!==p.DIRECTORY&&s.type===p.DIRECTORY?1:e.path.localeCompare(s.path)),t}flush(){this.handle.flush()}},kt=new TextEncoder,Ne=1447449377,se=1,ne=2,g=0,O=1,Nt=2,Be=5,Bt=7,K=8,ze=class{rootDir;fdTable=new Map;nextFd=3;nextIno=1;processUid=0;processGid=0;async init(i,t){this.rootDir=i,this.processUid=t?.uid??0,this.processGid=t?.gid??0}cleanupTab(i){for(const[t,e]of this.fdTable){try{e.handle.close()}catch{}this.fdTable.delete(t)}}getPathForFd(i){return this.fdTable.get(i)?.path??null}normalizePath(i){for(i.startsWith("/")||(i="/"+i);i.length>1&&i.endsWith("/");)i=i.slice(0,-1);const t=i.split("/"),e=[];for(const s of t)if(!(s===""||s===".")){if(s===".."){e.pop();continue}e.push(s)}return"/"+e.join("/")}async navigateToParent(i){const t=i.split("/").filter(Boolean);if(t.length===0)return null;const e=t.pop();let s=this.rootDir;for(const n of t)try{s=await s.getDirectoryHandle(n)}catch{return null}return{dir:s,name:e}}async navigateToDir(i){if(i==="/")return this.rootDir;const t=i.split("/").filter(Boolean);let e=this.rootDir;for(const s of t)try{e=await e.getDirectoryHandle(s)}catch{return null}return e}async getEntry(i){if(i==="/")return{handle:this.rootDir,kind:"directory"};const t=await this.navigateToParent(i);if(!t)return null;try{return{handle:await t.dir.getFileHandle(t.name),kind:"file"}}catch{try{return{handle:await t.dir.getDirectoryHandle(t.name),kind:"directory"}}catch{return null}}}async ensureParent(i){const t=i.split("/").filter(Boolean);t.pop();let e=this.rootDir;for(const s of t)try{e=await e.getDirectoryHandle(s,{create:!0})}catch{return null}return e}encodeStat(i,t,e,s){const n=new Uint8Array(53),r=new DataView(n.buffer);return r.setUint8(0,i==="file"?se:ne),r.setUint32(1,i==="file"?33188:16877,!0),r.setFloat64(5,t,!0),r.setFloat64(13,e,!0),r.setFloat64(21,e,!0),r.setFloat64(29,e,!0),r.setUint32(37,this.processUid,!0),r.setUint32(41,this.processGid,!0),r.setUint32(45,s,!0),r.setUint32(49,i==="directory"?2:1,!0),n}async read(i){i=this.normalizePath(i);const t=await this.navigateToParent(i);if(!t)return{status:O,data:null};try{const s=await(await t.dir.getFileHandle(t.name)).createSyncAccessHandle();try{const n=s.getSize(),r=new Uint8Array(n);return n>0&&s.read(r,{at:0}),{status:g,data:r}}finally{s.close()}}catch{return{status:O,data:null}}}async write(i,t,e){i=this.normalizePath(i);const s=await this.ensureParent(i);if(!s)return{status:O,data:null};const n=i.split("/").filter(Boolean).pop();try{const a=await(await s.getFileHandle(n,{create:!0})).createSyncAccessHandle();try{a.truncate(0),t.byteLength>0&&a.write(t,{at:0}),a.flush()}finally{a.close()}return{status:g,data:null}}catch{return{status:O,data:null}}}async append(i,t){i=this.normalizePath(i);const e=await this.ensureParent(i);if(!e)return{status:O,data:null};const s=i.split("/").filter(Boolean).pop();try{const r=await(await e.getFileHandle(s,{create:!0})).createSyncAccessHandle();try{const a=r.getSize();r.write(t,{at:a}),r.flush()}finally{r.close()}return{status:g,data:null}}catch{return{status:O,data:null}}}async unlink(i){i=this.normalizePath(i);const t=await this.navigateToParent(i);if(!t)return{status:O,data:null};try{return await t.dir.getFileHandle(t.name),await t.dir.removeEntry(t.name),{status:g,data:null}}catch{return{status:O,data:null}}}async stat(i){i=this.normalizePath(i);const t=await this.getEntry(i);if(!t)return{status:O,data:null};if(t.kind==="file"){const e=await t.handle.getFile();return{status:g,data:this.encodeStat("file",e.size,e.lastModified,this.nextIno++)}}return{status:g,data:this.encodeStat("directory",0,Date.now(),this.nextIno++)}}async lstat(i){return this.stat(i)}async mkdir(i,t=0,e=511){if(i=this.normalizePath(i),(t&1)!==0){const r=i.split("/").filter(Boolean);let a=this.rootDir,o=null,u="";for(const f of r){u+="/"+f;let h=!0;try{a=await a.getDirectoryHandle(f)}catch{h=!1,a=await a.getDirectoryHandle(f,{create:!0})}!h&&!o&&(o=u)}return{status:g,data:o?kt.encode(o):null}}const n=await this.navigateToParent(i);if(!n)return{status:O,data:null};try{try{return await n.dir.getDirectoryHandle(n.name),{status:Nt,data:null}}catch{}return await n.dir.getDirectoryHandle(n.name,{create:!0}),{status:g,data:null}}catch{return{status:O,data:null}}}async rmdir(i,t=0){if(i=this.normalizePath(i),i==="/")return{status:Bt,data:null};const e=(t&1)!==0,s=await this.navigateToParent(i);if(!s)return{status:O,data:null};try{return await s.dir.getDirectoryHandle(s.name),await s.dir.removeEntry(s.name,{recursive:e}),{status:g,data:null}}catch(n){return n.name==="InvalidModificationError"?{status:Be,data:null}:{status:O,data:null}}}async readdir(i,t=0){i=this.normalizePath(i);const e=await this.navigateToDir(i);if(!e)return{status:O,data:null};const s=(t&1)!==0,n=[];for await(const[h,d]of e.entries())n.push({name:h,kind:d.kind});if(s){let h=4;const d=[];for(const I of n){const T=kt.encode(I.name);d.push({nameBytes:T,type:I.kind==="file"?se:ne}),h+=2+T.byteLength+1}const m=new Uint8Array(h),w=new DataView(m.buffer);w.setUint32(0,d.length,!0);let l=4;for(const I of d)w.setUint16(l,I.nameBytes.byteLength,!0),l+=2,m.set(I.nameBytes,l),l+=I.nameBytes.byteLength,m[l++]=I.type;return{status:g,data:m}}let r=4;const a=[];for(const h of n){const d=kt.encode(h.name);a.push(d),r+=2+d.byteLength}const o=new Uint8Array(r),u=new DataView(o.buffer);u.setUint32(0,a.length,!0);let f=4;for(const h of a)u.setUint16(f,h.byteLength,!0),f+=2,o.set(h,f),f+=h.byteLength;return{status:g,data:o}}async rename(i,t){if(i=this.normalizePath(i),t=this.normalizePath(t),i===t)return{status:g,data:null};const e=await this.getEntry(i);if(!e)return{status:O,data:null};if(e.kind==="file"){const n=await e.handle.getFile(),r=new Uint8Array(await n.arrayBuffer()),a=await this.write(t,r);if(a.status!==g)return a;const o=await this.removeSourceWithRetry(()=>this.unlink(i));if(o.status!==g)return o}else{const s=await this.getEntry(t);if(s){const a=s.kind==="directory"?await this.rmdir(t,1):await this.unlink(t);if(a.status!==g)return a}const n=await this.mkdir(t,1);if(n.status!==g&&n.status!==Nt)return n;await this.copyDirectoryContents(i,t);const r=await this.removeSourceWithRetry(()=>this.rmdir(i,1));if(r.status!==g)return r}return{status:g,data:null}}async removeSourceWithRetry(i){let t=await i();for(let e=0;e<3&&t.status!==g;e++)await new Promise(s=>setTimeout(s,10*(e+1))),t=await i();return t}async copyDirectoryContents(i,t){const e=await this.navigateToDir(i);if(e)for await(const[s,n]of e.entries()){const r=i==="/"?`/${s}`:`${i}/${s}`,a=t==="/"?`/${s}`:`${t}/${s}`;if(n.kind==="directory")await this.mkdir(a,1),await this.copyDirectoryContents(r,a);else{const o=await n.getFile(),u=new Uint8Array(await o.arrayBuffer());await this.write(a,u)}}}async exists(i){i=this.normalizePath(i);const t=await this.getEntry(i);return{status:g,data:new Uint8Array([t?1:0])}}async truncate(i,t){i=this.normalizePath(i);const e=await this.navigateToParent(i);if(!e)return{status:O,data:null};try{const n=await(await e.dir.getFileHandle(e.name)).createSyncAccessHandle();try{n.truncate(t),n.flush()}finally{n.close()}return{status:g,data:null}}catch{return{status:O,data:null}}}async copy(i,t,e){i=this.normalizePath(i),t=this.normalizePath(t);const s=await this.read(i);return s.status!==g?s:this.write(t,s.data??new Uint8Array(0))}async access(i,t){return i=this.normalizePath(i),await this.getEntry(i)?{status:g,data:null}:{status:O,data:null}}async realpath(i){return i=this.normalizePath(i),await this.getEntry(i)?{status:g,data:kt.encode(i)}:{status:O,data:null}}async chmod(i,t){return i=this.normalizePath(i),await this.getEntry(i)?{status:g,data:null}:{status:O,data:null}}async chown(i,t,e){return i=this.normalizePath(i),await this.getEntry(i)?{status:g,data:null}:{status:O,data:null}}async utimes(i,t,e){return i=this.normalizePath(i),await this.getEntry(i)?{status:g,data:null}:{status:O,data:null}}async fchmod(i,t){return this.fdTable.has(i)?{status:g,data:null}:{status:K,data:null}}async fchown(i,t,e){return this.fdTable.has(i)?{status:g,data:null}:{status:K,data:null}}async futimes(i,t,e){return this.fdTable.has(i)?{status:g,data:null}:{status:K,data:null}}async symlink(i,t){return{status:Bt,data:null}}async readlink(i){return{status:Bt,data:null}}async link(i,t){return this.copy(i,t)}async open(i,t,e,s=438){i=this.normalizePath(i);const n=(t&64)!==0,r=(t&512)!==0,a=(t&128)!==0,o=await this.ensureParent(i);if(!o)return{status:O,data:null};const u=i.split("/").filter(Boolean).pop();try{let f=!0;try{await o.getFileHandle(u)}catch{f=!1}if(!f&&!n)return{status:O,data:null};if(f&&a&&n)return{status:Nt,data:null};const d=await(await o.getFileHandle(u,{create:n})).createSyncAccessHandle();r&&(d.truncate(0),d.flush());const m=this.nextFd++;this.fdTable.set(m,{handle:d,path:i,position:0,flags:t});const w=new Uint8Array(4);return new DataView(w.buffer).setUint32(0,m,!0),{status:g,data:w}}catch{return{status:O,data:null}}}async close(i){const t=this.fdTable.get(i);if(!t)return{status:K,data:null};try{t.handle.close()}catch{}return this.fdTable.delete(i),{status:g,data:null}}async fread(i,t,e){const s=this.fdTable.get(i);if(!s)return{status:K,data:null};const n=e??s.position,r=s.handle.getSize(),a=Math.min(t,r-n);if(a<=0)return{status:g,data:new Uint8Array(0)};const o=new Uint8Array(a);return s.handle.read(o,{at:n}),e===null&&(s.position+=a),{status:g,data:o}}async fwrite(i,t,e){const s=this.fdTable.get(i);if(!s)return{status:K,data:null};const r=(s.flags&1024)!==0?s.handle.getSize():e??s.position;s.handle.write(t,{at:r}),e===null&&(s.position=r+t.byteLength);const a=new Uint8Array(4);return new DataView(a.buffer).setUint32(0,t.byteLength,!0),{status:g,data:a}}async fstat(i){const t=this.fdTable.get(i);if(!t)return{status:K,data:null};const e=t.handle.getSize();return{status:g,data:this.encodeStat("file",e,Date.now(),i)}}async ftruncate(i,t=0){const e=this.fdTable.get(i);return e?(e.handle.truncate(t),e.handle.flush(),{status:g,data:null}):{status:K,data:null}}async statfs(){let t=0,e=0;try{const o=await navigator.storage.estimate();t=o.quota??0,e=o.usage??0}catch{}const s=Math.floor(t/4096),n=Math.max(0,Math.floor((t-e)/4096)),r=new Uint8Array(24),a=new DataView(r.buffer);return a.setUint32(0,Ne,!0),a.setUint32(4,4096,!0),a.setUint32(8,Math.min(s,4294967295),!0),a.setUint32(12,Math.min(n,4294967295),!0),a.setUint32(16,0,!0),a.setUint32(20,0,!0),{status:0,data:r}}async fsync(i){if(i!==void 0&&!this.fdTable.has(i))return{status:K,data:null};for(const[,t]of this.fdTable)try{t.handle.flush()}catch{}return{status:g,data:null}}async opendir(i,t){return this.readdir(i,1)}async mkdtemp(i){const t=Math.random().toString(36).substring(2,8),e=this.normalizePath(i+t);return this.mkdir(e,1)}},c={READ:1,WRITE:2,UNLINK:3,STAT:4,LSTAT:5,MKDIR:6,RMDIR:7,READDIR:8,RENAME:9,EXISTS:10,TRUNCATE:11,APPEND:12,COPY:13,ACCESS:14,REALPATH:15,CHMOD:16,CHOWN:17,UTIMES:18,SYMLINK:19,READLINK:20,LINK:21,OPEN:22,CLOSE:23,FREAD:24,FWRITE:25,FSTAT:26,FTRUNCATE:27,FSYNC:28,OPENDIR:29,MKDTEMP:30,FCHMOD:31,FCHOWN:32,FUTIMES:33,STATFS:34},Y={OK:0,ENOENT:1,EEXIST:2,EISDIR:3,ENOTDIR:4,ENOTEMPTY:5,EACCES:6,EINVAL:7,EBADF:8,ELOOP:9,ENOSPC:10,EIO:11},j={CONTROL:0,TICKET_NEXT:4,TICKET_SERVING:8,OPCODE:4,STATUS:8,CHUNK_LEN:12,TOTAL_LEN:16,CHUNK_IDX:24,HEARTBEAT:28,HEADER_SIZE:32},S={IDLE:0,REQUEST:1,RESPONSE:2,CHUNK:3,CHUNK_ACK:4},Rs=new TextEncoder,ie=new TextDecoder;function re(i){if(i.byteLength<16)throw new Error(`Request buffer too small: ${i.byteLength} < 16 bytes (possible SAB race)`);const t=new DataView(i),e=t.getUint32(0,!0),s=t.getUint32(4,!0),n=t.getUint32(8,!0),r=t.getUint32(12,!0),a=16+n+r;if(i.byteLength<a)throw new Error(`Request buffer truncated: ${i.byteLength} < ${a} bytes (op=${e}, pathLen=${n}, dataLen=${r})`);const o=new Uint8Array(i),u=ie.decode(o.subarray(16,16+n)),f=r>0?o.subarray(16+n,16+n+r):null;return{op:e,flags:s,path:u,data:f}}function W(i,t){const e=t?t.byteLength:0,s=new ArrayBuffer(8+e),n=new DataView(s);return n.setUint32(0,i,!0),n.setUint32(4,e,!0),t&&new Uint8Array(s).set(t,8),s}function G(i){const e=new DataView(i.buffer,i.byteOffset,i.byteLength).getUint32(0,!0);return ie.decode(i.subarray(4,4+e))}var _e=1e4,He=class Fe{constructor(t,e=_e){this.getTabId=t,this.deadlineMs=e}port=null;pendingResolve=null;pendingSeq=0;pendingAbandoned=!1;seqCounter=0;timer=null;get hasPort(){return this.port!==null}setPort(t){this.port&&this.port!==t&&(this.port.close(),this.abortPending()),this.port=t}postRaw(t,e){this.port?.postMessage(t,e)}portSuspectUntil=0;static SUSPECT_WINDOW_MS=3e4;get portSuspect(){return Date.now()<this.portSuspectUntil}forward(t,e=!1){return e&&this.portSuspect?Promise.resolve(W(Y.EIO)):(this.pendingResolve&&this.abortPending(),new Promise(s=>{const n=++this.seqCounter;this.pendingSeq=n,this.pendingAbandoned=!1,this.pendingResolve=s;const r=t.buffer.byteLength===t.byteLength?t.buffer:t.slice().buffer;this.port.postMessage({id:n,tabId:this.getTabId(),buffer:r},[r]),this.timer=setTimeout(()=>{if(this.timer=null,this.pendingSeq===n&&this.pendingResolve){const a=this.pendingResolve;this.pendingResolve=null,this.pendingAbandoned=!0,this.portSuspectUntil=Date.now()+Fe.SUSPECT_WINDOW_MS,a(W(Y.EIO))}},this.deadlineMs)}))}handleResponse(t,e){if(this.portSuspectUntil=0,t===this.pendingSeq){if(this.pendingResolve){this.clearTimer();const s=this.pendingResolve;return this.pendingResolve=null,s(e),!0}if(this.pendingAbandoned)return this.pendingAbandoned=!1,!0}return!1}abortPending(){if(this.clearTimer(),this.pendingResolve){const t=this.pendingResolve;this.pendingResolve=null,this.pendingAbandoned=!1,t(W(Y.EIO))}}clearTimer(){this.timer!==null&&(clearTimeout(this.timer),this.timer=null)}},ae=12e4,$e=1e3,Ke=class extends Error{constructor(i){super(`SAB protocol wait timed out: ${i}`),this.name="SabWaitTimeoutError"}};function oe(i,t,e,s,n=$e){for(;Atomics.load(i,0)===t;){const r=e-Date.now();if(r<=0)throw new Ke(s);Atomics.wait(i,0,t,Math.min(n,r))}}function Ve(i,t,e,s){try{const n=i.read(e);if(n.status===0){const r=[],a=[];if(n.data&&n.data.byteLength>0){const o=n.data.buffer.byteLength===n.data.byteLength?n.data.buffer:n.data.slice().buffer;r.push({op:"write",path:e,data:o,ts:s}),a.push(o)}else r.push({op:"write",path:e,data:new ArrayBuffer(0),ts:s});return r.push({op:"delete",path:t,ts:s}),{messages:r,transfers:a}}}catch{}return{messages:[{op:"rename",path:t,newPath:e,ts:s}],transfers:[]}}function Ye(i,t,e){const s=t.endsWith("/")?t:t+"/",n=e.endsWith("/")?e:e+"/",r=[];for(const a of i)a.startsWith(s)&&r.push({from:a,to:n+a.slice(s.length)});return r}function ce(i){if(i.startsWith("/")||(i="/"+i),i.length===1)return i;const t=[];for(const e of i.split("/"))if(!(e===""||e===".")){if(e===".."){t.pop();continue}t.push(e)}return"/"+t.join("/")}function We(i,t){if(t.startsWith("/"))return ce(t);const e=i.lastIndexOf("/"),s=e<=0?"/":i.slice(0,e);return ce(s+"/"+t)}function Ge(i,t,e,s){Dt(i,t,e),t.set(e,s);let n=i.get(s);n||(n=new Set,i.set(s,n)),n.add(e)}function Dt(i,t,e){const s=t.get(e);if(s===void 0)return;t.delete(e);const n=i.get(s);n&&(n.delete(e),n.size===0&&i.delete(s))}function zt(i,t){const e=t.endsWith("/")?t:t+"/",s=[];for(const n of i)(n===t||n.startsWith(e))&&s.push(n);return s}var L=i=>new DataView(i.buffer,i.byteOffset,i.byteLength),M=(i,t)=>!i||i.byteLength<t;function _t(i){return M(i,4)?null:L(i).getUint32(0,!0)}function le(i){return M(i,8)?null:L(i).getFloat64(0,!0)}function ue(i){if(M(i,8))return null;const t=L(i);return{uid:t.getUint32(0,!0),gid:t.getUint32(4,!0)}}function de(i){if(M(i,16))return null;const t=L(i);return{atime:t.getFloat64(0,!0),mtime:t.getFloat64(8,!0)}}function J(i){return M(i,4)?null:L(i).getUint32(0,!0)}function fe(i){if(M(i,16))return null;const t=L(i),e=t.getFloat64(8,!0);return{fd:t.getUint32(0,!0),length:t.getUint32(4,!0),position:e===-1?null:e}}function he(i){if(M(i,12))return null;const t=L(i),e=t.getFloat64(4,!0);return{fd:t.getUint32(0,!0),position:e===-1?null:e,bytes:i.subarray(12)}}function me(i){if(M(i,12))return null;const t=L(i);return{fd:t.getUint32(0,!0),len:t.getFloat64(4,!0)}}function we(i){if(M(i,8))return null;const t=L(i);return{fd:t.getUint32(0,!0),mode:t.getUint32(4,!0)}}function ye(i){if(M(i,12))return null;const t=L(i);return{fd:t.getUint32(0,!0),uid:t.getUint32(4,!0),gid:t.getUint32(8,!0)}}function pe(i){if(M(i,24))return null;const t=L(i);return{fd:t.getUint32(0,!0),atime:t.getFloat64(8,!0),mtime:t.getFloat64(16,!0)}}var qe=511,Ze=438,U=y.EINVAL,Ht=1;function be(i,t){return _t(i??null)??t}function Qe(i,t,e,s,n,r){switch(e){case c.READ:return i.read(n);case c.WRITE:return i.write(n,r??new Uint8Array(0),s);case c.APPEND:return i.append(n,r??new Uint8Array(0));case c.UNLINK:return i.unlink(n);case c.STAT:return i.stat(n);case c.LSTAT:return i.lstat(n);case c.MKDIR:return i.mkdir(n,s,be(r,qe));case c.RMDIR:return i.rmdir(n,s);case c.READDIR:return i.readdir(n,s);case c.RENAME:return i.rename(n,r?G(r):"");case c.EXISTS:return i.exists(n);case c.COPY:return i.copy(n,r?G(r):"",s);case c.ACCESS:return i.access(n,s);case c.REALPATH:return i.realpath(n);case c.READLINK:return i.readlink(n);case c.LINK:return i.link(n,r?G(r):"");case c.OPENDIR:return i.opendir(n,t);case c.MKDTEMP:return i.mkdtemp(n);case c.FSYNC:return i.fsync(J(r)??void 0);case c.STATFS:return i.statfs(n);case c.TRUNCATE:{const a=le(r);return a===null?{status:U}:i.truncate(n,a)}case c.CHMOD:{const a=_t(r);return a===null?{status:U}:i.chmod(n,a,(s&Ht)===0)}case c.CHOWN:{const a=ue(r);return a===null?{status:U}:i.chown(n,a.uid,a.gid,(s&Ht)===0)}case c.UTIMES:{const a=de(r);return a===null?{status:U}:i.utimes(n,a.atime,a.mtime,(s&Ht)===0)}case c.SYMLINK:return i.symlink(r?new TextDecoder().decode(r):"",n);case c.OPEN:return i.open(n,s,t,be(r,Ze));case c.CLOSE:{const a=J(r);return a===null?{status:U}:i.close(a)}case c.FREAD:{const a=fe(r);return a===null?{status:U}:i.fread(a.fd,a.length,a.position)}case c.FWRITE:{const a=he(r);return a===null?{status:U}:i.fwrite(a.fd,a.bytes,a.position)}case c.FSTAT:{const a=J(r);return a===null?{status:U}:i.fstat(a)}case c.FTRUNCATE:{const a=me(r);return a===null?{status:U}:i.ftruncate(a.fd,a.len)}case c.FCHMOD:{const a=we(r);return a===null?{status:U}:i.fchmod(a.fd,a.mode)}case c.FCHOWN:{const a=ye(r);return a===null?{status:U}:i.fchown(a.fd,a.uid,a.gid)}case c.FUTIMES:{const a=pe(r);return a===null?{status:U}:i.futimes(a.fd,a.atime,a.mtime)}default:return{status:U}}}var vs=new Set([c.READ,c.WRITE,c.APPEND,c.UNLINK,c.STAT,c.LSTAT,c.MKDIR,c.RMDIR,c.READDIR,c.RENAME,c.EXISTS,c.TRUNCATE,c.COPY,c.ACCESS,c.REALPATH,c.CHMOD,c.CHOWN,c.UTIMES,c.SYMLINK,c.READLINK,c.LINK,c.OPEN,c.CLOSE,c.FREAD,c.FWRITE,c.FSTAT,c.FTRUNCATE,c.FSYNC,c.OPENDIR,c.MKDTEMP,c.FCHMOD,c.FCHOWN,c.FUTIMES,c.STATFS]),$t=new WeakMap;function Xe(i,t){const e=URL.createObjectURL(new Blob([i],{type:"text/javascript"}));try{const s=new Worker(e,{type:"module",name:t});return $t.set(s,e),s}catch(s){throw URL.revokeObjectURL(e),s}}function je(i){if(!i)return;try{i.terminate()}catch{}const t=$t.get(i);t&&(URL.revokeObjectURL(t),$t.delete(i))}var Je=`function E(e){if(e.startsWith("/")||(e="/"+e),e.length===1)return e;const t=[];for(const r of e.split("/"))if(!(r===""||r===".")){if(r===".."){t.pop();continue}t.push(r)}return"/"+t.join("/")}function j(e,t){const r=E(t);for(let n=e.length-1;n>=0;n--){const a=e[n];if(E(a.path)!==r){if(a.op==="rename"&&a.newPath&&E(a.newPath)===r)return-1;continue}return a.op==="write"?n:-1}return-1}var h,m;function f(e){if(e.charCodeAt(0)!==47&&(e="/"+e),e.indexOf("//")!==-1&&(e=e.replace(/\\\\/\\\\/+/g,"/")),e.indexOf("/.")!==-1){const t=e.split("/"),r=[];for(const n of t)if(!(n==="."||n==="")){if(n===".."){r.pop();continue}r.push(n)}e="/"+r.join("/")}return e.length>1&&e.charCodeAt(e.length-1)===47&&(e=e.slice(0,-1)),e||"/"}function H(e){return f(e).split("/").filter(Boolean)}var D=new Set,p=new Map,M=new Map;function O(e){let t=2166136261;for(let r=0;r<e.length;r++)t^=e[r],t=Math.imul(t,16777619);return t>>>0^e.length}function P(e,t){if(e=f(e),D.has(e))return!0;const r=p.get(e);return!r||Date.now()-r>=A?!1:M.get(e)===O(t)}var A=3e3;function R(e){D.add(f(e))}function T(e){D.delete(f(e))}function z(e){p.set(f(e),Date.now())}function b(e,t=!1){e=f(e);const r=Date.now();if(D.has(e))return!0;const n=p.get(e);if(n&&r-n<A)return!0;if(t){let a=e;for(;;){const o=a.lastIndexOf("/");if(o<=0)break;if(a=a.substring(0,o),D.has(a))return!0;const i=p.get(a);if(i&&r-i<A)return!0}}return!1}setInterval(()=>{const e=Date.now()-A;for(const[t,r]of p)r<e&&(p.delete(t),M.delete(t))},5e3);var g=[],F=!1;function q(e){if(R(e.path),e.op==="rename"&&e.newPath&&R(e.newPath),e.op==="write"){const t=j(g,e.path);if(t!==-1){g[t].data=e.data,g[t].ts=e.ts;return}}g.push(e),F||I()}async function G(e){switch(e.op){case"write":e.data?await B(e.path,e.data):await B(e.path,new ArrayBuffer(0));break;case"delete":await K(e.path);break;case"mkdir":await X(e.path);break;case"rename":await J(e.path,e.newPath);break}}var C=4;async function I(){if(g.length===0){F=!1;return}F=!0;const e=g.shift();for(let t=1;t<=C;t++)try{await G(e);break}catch(r){if(t===C){console.warn("[opfs-sync] mirror failed after retries:",e.op,e.path,r);break}await new Promise(n=>setTimeout(n,10*t))}T(e.path),z(e.path),e.op==="rename"&&e.newPath&&(T(e.newPath),z(e.newPath)),I()}async function S(e){const t=H(e);t.pop();let r=m;for(const n of t)r=await r.getDirectoryHandle(n,{create:!0});return r}function y(e){const t=H(e);return t[t.length-1]||""}async function B(e,t){const r=await S(e),n=y(e),a=await r.getFileHandle(n,{create:!0}),o=new Uint8Array(t),i=await a.createSyncAccessHandle();try{i.truncate(0),i.write(o,{at:0}),i.flush()}finally{i.close()}M.set(f(e),O(o))}async function K(e){try{await(await x(e)).removeEntry(y(e),{recursive:!0})}catch{}}async function X(e){let t=m;for(const r of H(e))t=await t.getDirectoryHandle(r,{create:!0})}var U=2*1024*1024;async function J(e,t){let r=null,n=null,a,o,i=!1,u=null;for(let s=0;s<6;s++)try{a=await x(e),o=await a.getFileHandle(y(e)),i=!0;break}catch(d){u=d;const l=d?.message||"";if(d?.name==="TypeMismatchError"||l.includes("TypeMismatch")||l.includes("not a file")||l.includes("not an entry of requested type")){try{await W(e,t)}catch(c){console.warn("[opfs-sync] rename (dir) failed:",e,"\\\\u2192",t,c)}return}if(s<5){await new Promise(c=>setTimeout(c,8*(s+1)));continue}}if(!i){try{await W(e,t);return}catch{}console.warn("[opfs-sync] rename failed (source not found after retries):",e,"\\\\u2192",t,u);return}try{r=await o.createSyncAccessHandle();const s=r.getSize();if(n=await(await(await S(t)).getFileHandle(y(t),{create:!0})).createSyncAccessHandle(),n.truncate(0),s>0){const w=new Uint8Array(Math.min(s,U));let c=0;for(;c<s;){const k=Math.min(w.length,s-c),v=k===w.length?w:w.subarray(0,k);r.read(v,{at:c}),n.write(v,{at:c}),c+=k}}n.flush();try{n.close()}catch{}n=null;try{r.close()}catch{}r=null,await N(a,y(e))}catch(s){console.warn("[opfs-sync] rename failed:",e,"\\\\u2192",t,s)}finally{if(n)try{n.close()}catch{}if(r)try{r.close()}catch{}}}async function W(e,t){const r=await x(e),n=await r.getDirectoryHandle(y(e)),a=await S(t);try{await a.removeEntry(y(t),{recursive:!0})}catch(i){if(i?.name!=="NotFoundError")throw i}const o=await a.getDirectoryHandle(y(t),{create:!0});await _(n,o),await N(r,y(e),{recursive:!0})}async function N(e,t,r){let n=null;for(let a=0;a<4;a++)try{await e.removeEntry(t,r);return}catch(o){if(o?.name==="NotFoundError")return;n=o,await new Promise(i=>setTimeout(i,10*(a+1)))}throw n}async function _(e,t){for await(const[r,n]of e.entries())if(n.kind==="directory"){const a=await t.getDirectoryHandle(r,{create:!0});await _(n,a)}else{const a=n,o=await t.getFileHandle(r,{create:!0});let i=null,u=null;try{i=await a.createSyncAccessHandle(),u=await o.createSyncAccessHandle();const s=i.getSize();if(u.truncate(0),s>0){const d=new Uint8Array(Math.min(s,U));let l=0;for(;l<s;){const w=Math.min(d.length,s-l),c=w===d.length?d:d.subarray(0,w);i.read(c,{at:l}),u.write(c,{at:l}),l+=w}}u.flush()}finally{if(u)try{u.close()}catch{}if(i)try{i.close()}catch{}}}}async function x(e){const t=H(e);t.pop();let r=m;for(const n of t)r=await r.getDirectoryHandle(n);return r}function L(e){for(const t of e){const r=f(t.path);if(!(r==="/.vfs.bin"||r==="/.vfs"||r.startsWith("/.vfs")))switch(t.kind){case"appeared":case"modified":Q(r,t.handle??null);break;case"disappeared":if(b(r,!0))continue;V(r);break;case"moved":{const n=f(t.from);if(b(r)||b(n))continue;Y(n,r);break}}}}async function Q(e,t){try{if(!t||t.kind!=="file")return;const r=t;let n=await r.getFile().then(a=>a.arrayBuffer());if(P(e,new Uint8Array(n))||p.has(f(e))&&(n=await r.getFile().then(a=>a.arrayBuffer()),P(e,new Uint8Array(n))))return;h.postMessage({op:"external-write",path:e,data:n,ts:Date.now()},[n])}catch(r){console.warn("[opfs-sync] external change read failed:",e,r)}}function V(e){h.postMessage({op:"external-delete",path:e,ts:Date.now()})}function Y(e,t){h.postMessage({op:"external-rename",path:e,newPath:t,ts:Date.now()})}self.onmessage=async e=>{const t=e.data;if(t.type==="init"){if(h=e.ports[0],m=await navigator.storage.getDirectory(),t.root&&t.root!=="/"){const r=t.root.split("/").filter(Boolean);for(const n of r)m=await m.getDirectoryHandle(n,{create:!0})}console.log("[opfs-sync] initialized with root:",t.root||"/","mirrorRoot.name:",m.name||"(opfs-root)"),h.onmessage=r=>{if(r.data?.type==="external-records"){L(r.data.records);return}q(r.data)},h.start(),self.postMessage({type:"ready"});return}if(t.type==="shutdown"){try{h?.close()}catch{}self.postMessage({type:"shutdown-done"}),self.close();return}};\n`;function ts(i,t,e){const s=(t&64)!==0,n=(t&512)!==0,r=s&&!n?i.exists(e).data?.[0]===1:!1;return{willCreate:s,willTrunc:n,existedBefore:r}}var Ot=(i,t)=>new DataView(i.buffer,i.byteOffset,i.byteLength).getUint32(t,!0);function es(i,t,e,s,n,r){if(n.status!==0)return null;switch(t){case c.WRITE:case c.APPEND:case c.UNLINK:case c.MKDIR:case c.RMDIR:case c.TRUNCATE:case c.CHMOD:case c.CHOWN:case c.UTIMES:case c.SYMLINK:return{op:t,path:e};case c.RENAME:return{op:t,path:e,newPath:s?G(s):""};case c.COPY:case c.LINK:return{op:t,path:s?G(s):""};case c.OPEN:return r&&(r.willTrunc||r.willCreate&&!r.existedBefore)?{op:c.WRITE,path:e}:null;case c.MKDTEMP:return n.data instanceof Uint8Array?{op:t,path:new TextDecoder().decode(n.data)}:null;case c.FWRITE:case c.FTRUNCATE:return s&&s.byteLength>=4?{op:t,path:i.getPathForFd(Ot(s,0))??void 0}:null;case c.FCHMOD:return s&&s.byteLength>=4?{op:c.CHMOD,path:i.getPathForFd(Ot(s,0))??void 0}:null;case c.FCHOWN:return s&&s.byteLength>=4?{op:c.CHOWN,path:i.getPathForFd(Ot(s,0))??void 0}:null;case c.FUTIMES:return s&&s.byteLength>=4?{op:c.UTIMES,path:i.getPathForFd(Ot(s,0))??void 0}:null;default:return null}}self.addEventListener("error",i=>{console.error("[sync-relay] uncaught error:",i.message,i.filename,i.lineno)}),self.addEventListener("unhandledrejection",i=>{const t=i.reason;console.error("[sync-relay] unhandled rejection:",t?.message??String(t),t?.stack??"")});var D=new Me;function Ie(i,t){return!i||i.byteLength<4?t:new DataView(i.buffer,i.byteOffset,i.byteLength).getUint32(0,!0)}var Ct=null,tt=!1,q=!1,Z=!1,B=!1,Ft=!1,v=null,Kt=!1,dt=null,ft=null,x,A,et,z,_=null,k=null,N="",H=j.HEADER_SIZE,ss=j.HEARTBEAT>>2,ns=1e3,Ee=null;function Vt(){Ee!==null||!A||(Ee=setInterval(()=>{Atomics.add(A,ss,1)},ns))}var ht=new Map,Q=[],ge=typeof navigator<"u"&&navigator.userAgent||"",is=/AppleWebKit/.test(ge)&&!/Chrome|Chromium|Android|Edg|OPR/.test(ge),Se=void 0;function mt(){const i=self.__fs_force_spin??Se;return i===void 0?is:!!i}var Yt=new MessageChannel;Yt.port2.start();function wt(){return new Promise(i=>{let t=!1,e=null;const s=()=>{t||(t=!0,e!==null&&clearTimeout(e),i())};Yt.port2.onmessage=s,Yt.port1.postMessage(null),mt()&&(e=setTimeout(s,1))})}function yt(i,t){try{return fs(i,t)}catch(e){return console.error("[sync-relay] handleRequest threw:",e?.message,e?.stack),{status:Y.EIO}}}async function pt(i,t){try{return await hs(i,t)}catch(e){return console.error("[sync-relay] handleRequestOPFS threw:",e?.message,e?.stack),{status:Y.EIO}}}function rs(i,t){t.onmessage=async e=>{if(e.data.buffer instanceof ArrayBuffer)if(Ft)Q.push({port:t,tabId:i,id:e.data.id,buffer:e.data.buffer});else{const s=tt?await pt(i,e.data.buffer):yt(i,e.data.buffer),n=W(s.status,s.data);t.postMessage({id:e.data.id,buffer:n},[n]),!tt&&s._op!==void 0&&gt(s._op,s._path,s._newPath)}},t.start(),ht.set(i,t)}function as(i){const t=ht.get(i);t&&(t.close(),ht.delete(i)),tt?Ct?.cleanupTab(i):D.cleanupTab(i)}function os(){for(;Q.length>0;){const i=Q.shift(),t=yt(i.tabId,i.buffer),e=W(t.status,t.data);i.port.postMessage({id:i.id,buffer:e},[e]),t._op!==void 0&&gt(t._op,t._path,t._newPath)}}async function cs(){for(;Q.length>0;){const i=Q.shift(),t=await pt(i.tabId,i.buffer),e=W(t.status,t.data);i.port.postMessage({id:i.id,buffer:e},[e])}}var st=new He(()=>N),Wt=null;function ls(i){return st.forward(i)}function us(i){if(i.data.buffer instanceof ArrayBuffer){if(st.handleResponse(i.data.id,i.data.buffer))return;Wt&&Wt.postMessage({id:i.data.id,buffer:i.data.buffer},[i.data.buffer])}}var ds={1:"READ",2:"WRITE",3:"UNLINK",4:"STAT",5:"LSTAT",6:"MKDIR",7:"RMDIR",8:"READDIR",9:"RENAME",10:"EXISTS",11:"TRUNCATE",12:"APPEND",13:"COPY",14:"ACCESS",15:"REALPATH",16:"CHMOD",17:"CHOWN",18:"UTIMES",19:"SYMLINK",20:"READLINK",21:"LINK",22:"OPEN",23:"CLOSE",24:"FREAD",25:"FWRITE",26:"FSTAT",27:"FTRUNCATE",28:"FSYNC",29:"OPENDIR",30:"MKDTEMP"};function fs(i,t){const e=B?performance.now():0;let s,n,r,a;try{({op:s,flags:n,path:r,data:a}=re(t))}catch(I){return console.error(`[sync-relay] decodeRequest failed (bufLen=${t.byteLength}): ${I.message}`),{status:-1}}const o=B?performance.now():0,u=s===c.OPEN?ts(D,n,r):void 0,f=Qe(D,i,s,n,r,a),h=es(D,s,r,a,f,u),d=h?.op,m=h?.path,w=h?.newPath;if(B){const I=performance.now();console.log(`[sync-relay] op=${ds[s]??s} path=${r} decode=${(o-e).toFixed(3)}ms engine=${(I-o).toFixed(3)}ms TOTAL=${(I-e).toFixed(3)}ms`)}const l={status:f.status,data:f.data instanceof Uint8Array?f.data:void 0};return d!==void 0&&m&&(l._op=d,l._path=m,l._newPath=w,It(d,m,w)),l}async function hs(i,t){const e=Ct;let s,n,r,a;try{({op:s,flags:n,path:r,data:a}=re(t))}catch(l){return console.error(`[sync-relay] decodeRequest failed in OPFS handler (bufLen=${t.byteLength}): ${l.message}`),{status:-1}}let o,u,f;switch(s){case c.READ:o=await e.read(r);break;case c.WRITE:o=await e.write(r,a??new Uint8Array(0),n),u=r;break;case c.APPEND:o=await e.append(r,a??new Uint8Array(0)),u=r;break;case c.UNLINK:o=await e.unlink(r),u=r;break;case c.STAT:o=await e.stat(r);break;case c.LSTAT:o=await e.lstat(r);break;case c.MKDIR:o=await e.mkdir(r,n,Ie(a,511)),u=r;break;case c.RMDIR:o=await e.rmdir(r,n),u=r;break;case c.READDIR:o=await e.readdir(r,n);break;case c.RENAME:{const l=a?G(a):"";o=await e.rename(r,l),u=r,f=l;break}case c.EXISTS:o=await e.exists(r);break;case c.TRUNCATE:{const l=le(a);if(l===null){o={status:7};break}o=await e.truncate(r,l),u=r;break}case c.COPY:{const l=a?G(a):"";o=await e.copy(r,l,n),u=l;break}case c.ACCESS:o=await e.access(r,n);break;case c.REALPATH:o=await e.realpath(r);break;case c.CHMOD:{const l=_t(a)??0;o=await e.chmod(r,l);break}case c.CHOWN:{const l=ue(a);if(l===null){o={status:7};break}o=await e.chown(r,l.uid,l.gid);break}case c.UTIMES:{const l=de(a);if(l===null){o={status:7};break}o=await e.utimes(r,l.atime,l.mtime);break}case c.SYMLINK:{const l=a?new TextDecoder().decode(a):"";o=await e.symlink(l,r);break}case c.READLINK:o=await e.readlink(r);break;case c.LINK:{const l=a?G(a):"";o=await e.link(r,l),u=l;break}case c.OPEN:o=await e.open(r,n,i,Ie(a,438));break;case c.CLOSE:{const l=J(a);if(l===null){o={status:7};break}o=await e.close(l);break}case c.FREAD:{const l=fe(a);if(l===null){o={status:7};break}o=await e.fread(l.fd,l.length,l.position);break}case c.FWRITE:{const l=he(a);if(l===null){o={status:7};break}o=await e.fwrite(l.fd,l.bytes,l.position),u=e.getPathForFd(l.fd)??void 0;break}case c.FSTAT:{const l=J(a);if(l===null){o={status:7};break}o=await e.fstat(l);break}case c.FTRUNCATE:{const l=me(a);if(l===null){o={status:7};break}o=await e.ftruncate(l.fd,l.len),u=e.getPathForFd(l.fd)??void 0;break}case c.FSYNC:o=await e.fsync(J(a)??void 0);break;case c.STATFS:o=await e.statfs();break;case c.OPENDIR:o=await e.opendir(r,i);break;case c.MKDTEMP:o=await e.mkdtemp(r),o.status===0&&o.data&&(u=new TextDecoder().decode(o.data instanceof Uint8Array?o.data:new Uint8Array(0)));break;case c.FCHMOD:{const l=we(a);if(l===null){o={status:7};break}o=await e.fchmod(l.fd,l.mode);break}case c.FCHOWN:{const l=ye(a);if(l===null){o={status:7};break}o=await e.fchown(l.fd,l.uid,l.gid);break}case c.FUTIMES:{const l=pe(a);if(l===null){o={status:7};break}o=await e.futimes(l.fd,l.atime,l.mtime);break}default:o={status:7}}const h=1,d=[c.READ,c.STAT,c.LSTAT,c.READDIR,c.EXISTS,c.ACCESS,c.REALPATH,c.READLINK],m=s===c.EXISTS&&o.status===0&&o.data instanceof Uint8Array&&o.data[0]===0;if((o.status===h||m)&&d.includes(s)){const l=(()=>{switch(s){case c.READ:return D.read(r);case c.STAT:return D.stat(r);case c.LSTAT:return D.lstat(r);case c.READDIR:return D.readdir(r,n);case c.EXISTS:return D.exists(r);case c.ACCESS:return D.access(r,n);case c.REALPATH:return D.realpath(r);case c.READLINK:return D.readlink(r);default:return null}})();l&&l.status!==h&&(o=l)}const w={status:o.status,data:o.data instanceof Uint8Array?o.data:void 0};return o.status===0&&u&&It(s,u,f),w}function nt(i,t){const e=new BigUint64Array(i,j.TOTAL_LEN,1),s=i.byteLength-H,n=Atomics.load(t,3),r=Number(Atomics.load(e,0));if(n<=0||n>s)return console.error(`[sync-relay] readPayload: invalid chunkLen=${n} (maxChunk=${s}, totalLen=${r})`),new Uint8Array(0);if(r<=s)return new Uint8Array(i,H,n).slice();if(r>bt.maxPayload||r<=0)return console.error(`[sync-relay] readPayload: totalLen=${r} exceeds limit (${bt.maxPayload}) or invalid`),new Uint8Array(0);const a=new Uint8Array(r);let o=0;a.set(new Uint8Array(i,H,n),o),o+=n;const u=Date.now()+ae;for(;o<r;){Atomics.store(t,0,S.CHUNK_ACK),Atomics.notify(t,0),oe(t,S.CHUNK_ACK,u,"request chunk from caller",50);const f=Atomics.load(t,3);if(f<=0||f>s)return console.error(`[sync-relay] readPayload: invalid nextLen=${f} at offset=${o}`),a.slice(0,o);a.set(new Uint8Array(i,H,f),o),o+=f}return a}function it(i,t,e,s){const n=s?s.byteLength:0,r=8+n,a=i.byteLength-H;if(r<=a){const o=new DataView(i,H,8);o.setUint32(0,e,!0),o.setUint32(4,n,!0),s&&n>0&&new Uint8Array(i,H+8,n).set(s),Atomics.store(t,3,r);const u=new BigUint64Array(i,j.TOTAL_LEN,1);Atomics.store(u,0,BigInt(r)),Atomics.store(t,0,S.RESPONSE),Atomics.notify(t,0)}else{const o=W(e,s);Gt(i,t,new Uint8Array(o))}}function Gt(i,t,e){const s=i.byteLength-H;if(e.byteLength<=s){new Uint8Array(i,H,e.byteLength).set(e),Atomics.store(t,3,e.byteLength);const n=new BigUint64Array(i,j.TOTAL_LEN,1);Atomics.store(n,0,BigInt(e.byteLength)),Atomics.store(t,0,S.RESPONSE),Atomics.notify(t,0)}else{const n=new BigUint64Array(i,j.TOTAL_LEN,1);Atomics.store(n,0,BigInt(e.byteLength));let r=0;for(;r<e.byteLength;){const a=Math.min(s,e.byteLength-r);new Uint8Array(i,H,a).set(e.subarray(r,r+a)),Atomics.store(t,3,a),Atomics.store(t,6,Math.floor(r/s));const o=r+a>=e.byteLength;Atomics.store(t,0,o?S.RESPONSE:S.CHUNK),Atomics.notify(t,0),o||oe(t,S.CHUNK,Date.now()+ae,"response chunk ack from caller",50),r+=a}}}var ms=25,Rt=0;function ws(){if(mt())try{if(Date.now()-Rt<ms||Atomics.load(A,0)===S.REQUEST||k&&Atomics.load(k,0)===S.REQUEST)return;D.maybePreGrow(!0)}catch(i){console.error("[sync-relay] pre-grow failed:",i?.message)}}function rt(i,t){if(!mt())return Atomics.wait(i,0,S.RESPONSE,t),Atomics.load(i,0)!==S.RESPONSE;const e=Date.now()+t;for(;Atomics.load(i,0)===S.RESPONSE;){const s=e-Date.now();if(s<=0)return!1;Atomics.wait(i,0,S.RESPONSE,Math.min(5,s))}return!0}var ys=0,ps=5;function qt(i,t){i().catch(e=>{Ft=!1,console.error(`[sync-relay] ${t} crashed:`,e?.message,e?.stack);try{A&&Atomics.load(A,0)===S.REQUEST&&it(x,A,Y.EIO),k&&Atomics.load(k,0)===S.REQUEST&&it(_,k,Y.EIO)}catch{}++ys<=ps?qt(i,t):self.postMessage({type:"leader-loop-fatal",error:e?.message??String(e)})})}async function bs(){for(Ft=!0;;){let i=!0,t=0;for(;i;){if(i=!1,++t>=100&&(t=0,await wt()),Atomics.load(A,0)===S.REQUEST){const e=B?performance.now():0,s=nt(x,A),n=B?performance.now():0,r=yt(N,s.buffer),a=B?performance.now():0;it(x,A,r.status,r.data),r._op!==void 0&&gt(r._op,r._path,r._newPath);const o=B?performance.now():0;B&&console.log(`[leaderLoop] readPayload=${(n-e).toFixed(3)}ms handleRequest=${(a-n).toFixed(3)}ms writeResponse=${(o-a).toFixed(3)}ms TOTAL=${(o-e).toFixed(3)}ms`),rt(A,100)||Atomics.store(A,0,S.IDLE),Rt=Date.now(),i=!0;continue}if(k&&Atomics.load(k,0)===S.REQUEST){const e=nt(_,k),s=yt(N,e.buffer);it(_,k,s.status,s.data),s._op!==void 0&&gt(s._op,s._path,s._newPath),rt(k,5e3),Rt=Date.now(),i=!0;continue}if(Q.length>0){os(),i=!0;continue}if(mt()&&Date.now()-Rt<20){const e=performance.now();for(;performance.now()-e<.25;)if(Atomics.load(A,0)===S.REQUEST||k!==null&&Atomics.load(k,0)===S.REQUEST){i=!0;break}}}if(await wt(),ws(),ht.size===0){const e=Atomics.load(A,0),s=k!==null&&Atomics.load(k,0)===S.REQUEST;e!==S.REQUEST&&!s&&Atomics.wait(A,0,e,Kt?5:50)}}}async function Is(){for(Ft=!0;;){let i=!0,t=0;for(;i;){if(i=!1,++t>=100&&(t=0,await wt()),Atomics.load(A,0)===S.REQUEST){const e=nt(x,A),s=await pt(N,e.buffer);it(x,A,s.status,s.data),rt(A,100)||Atomics.store(A,0,S.IDLE),i=!0;continue}if(k&&Atomics.load(k,0)===S.REQUEST){const e=nt(_,k),s=await pt(N,e.buffer);it(_,k,s.status,s.data),rt(k,100)||Atomics.store(k,0,S.IDLE),i=!0;continue}if(Q.length>0){await cs(),i=!0;continue}}if(await wt(),ht.size===0){const e=Atomics.load(A,0),s=k!==null&&Atomics.load(k,0)===S.REQUEST;e!==S.REQUEST&&!s&&Atomics.wait(A,0,e,50)}}}async function Es(){for(;;){if(Atomics.load(A,0)===S.REQUEST){const t=nt(x,A),e=await st.forward(t,!0);Gt(x,A,new Uint8Array(e)),rt(A,100)||Atomics.store(A,0,S.IDLE);continue}if(k&&Atomics.load(k,0)===S.REQUEST){const t=nt(_,k),e=await ls(t);Gt(_,k,new Uint8Array(e)),rt(k,100)||Atomics.store(k,0,S.IDLE);continue}Atomics.wait(A,0,S.IDLE,50)==="timed-out"&&await wt()}}var gs=new Set([".vfs.bin",".vfs.bin.tmp"]),Ss=2*1024*1024;async function Te(i,t){const e=[],s=[];for await(const[n,r]of i.entries())t===""&&gs.has(n)||(r.kind==="directory"?e.push({name:n,handle:r}):s.push({name:n,handle:r}));for(const{name:n}of e){const r=t?`${t}/${n}`:`/${n}`;D.mkdir(r,1,493)}for(const{name:n,handle:r}of s){const a=t?`${t}/${n}`:`/${n}`;let o=null;try{o=await r.createSyncAccessHandle();const u=o.getSize();if(D.write(a,new Uint8Array(0)),u>0){const f=new Uint8Array(Math.min(u,Ss));let h=0;for(;h<u;){const d=Math.min(f.length,u-h),m=d===f.length?f:f.subarray(0,d);o.read(m,{at:h}),D.append(a,m),h+=d}}}finally{if(o)try{o.close()}catch{}}}for(const{name:n,handle:r}of e){const a=t?`${t}/${n}`:`/${n}`;await Te(r,a)}}var Ae={maxInodes:4e6,maxBlocks:4e6,maxPathTable:256*1024*1024,maxVFSSize:100*1024*1024*1024,maxPayload:2*1024*1024*1024};function Ts(i){return{...Ae,...i}}var bt={...Ae};function As(i,t,e){if(t<b.SIZE)return`file too small (${t} bytes)`;const s=new Uint8Array(b.SIZE);i.read(s,{at:0});const n=new DataView(s.buffer),r=n.getUint32(b.MAGIC,!0);if(r!==lt)return`bad magic 0x${r.toString(16)}`;const a=n.getUint32(b.VERSION,!0);if(a!==Tt)return`unsupported version ${a}`;const o=n.getUint32(b.INODE_COUNT,!0),u=n.getUint32(b.BLOCK_SIZE,!0),f=n.getUint32(b.TOTAL_BLOCKS,!0),h=n.getUint32(b.FREE_BLOCKS,!0),d=n.getFloat64(b.INODE_OFFSET,!0),m=n.getFloat64(b.PATH_OFFSET,!0),w=n.getFloat64(b.DATA_OFFSET,!0),l=n.getFloat64(b.BITMAP_OFFSET,!0),I=n.getUint32(b.PATH_USED,!0);if(u===0||(u&u-1)!==0)return`invalid block size ${u}`;if(o===0)return"inode count is 0";if(o>e.maxInodes)return`inode count ${o} exceeds maximum ${e.maxInodes}`;if(f>e.maxBlocks)return`total blocks ${f} exceeds maximum ${e.maxBlocks}`;if(h>f)return`free blocks (${h}) exceeds total (${f})`;if(!Number.isFinite(d)||d<0||!Number.isFinite(m)||m<0||!Number.isFinite(l)||l<0||!Number.isFinite(w)||w<0)return"non-finite or negative section offset";if(d!==b.SIZE)return`inode table offset ${d} (expected ${b.SIZE})`;const T=d+o*P;if(m!==T)return`path table offset ${m} (expected ${T})`;if(l<=m)return"bitmap offset must be after path table";if(w<=l)return"data offset must be after bitmap";const F=l-m;if(I>F)return`path used (${I}) exceeds path table size (${F})`;if(F>e.maxPathTable)return`path table size ${F} exceeds maximum ${e.maxPathTable}`;const C=w+f*u;return C>e.maxVFSSize?`computed layout size ${C} exceeds maximum ${e.maxVFSSize}`:t<C?`file size ${t} too small for layout (need ${C})`:null}async function ks(i){B=i.debug??!1,Se=i.forceSpin,bt=Ts(i.limits);let t=await navigator.storage.getDirectory();if(i.root&&i.root!=="/"){const a=i.root.split("/").filter(Boolean);for(const o of a)t=await t.getDirectoryHandle(o,{create:!0})}const s=await(await t.getFileHandle(".vfs.bin",{create:!0})).createSyncAccessHandle(),n=s.getSize();if(n>0){const a=As(s,n,bt);if(a){try{s.close()}catch{}throw new Error(`Corrupt VFS: ${a}`)}}const r=n===0;try{D.init(s,{uid:i.uid,gid:i.gid,umask:i.umask,strictPermissions:i.strictPermissions,debug:i.debug,limits:bt})}catch(a){try{s.close()}catch{}throw a}if(r&&(await Te(t,""),D.flush()),i.opfsSync){Kt=!0;const a=new MessageChannel;v=a.port1,v.onmessage=o=>Fs(o.data),v.start(),dt=Xe(Je,"vfs-opfs-sync"),dt.postMessage({type:"init",root:i.opfsSyncRoot??i.root},[a.port2])}if(mt())try{D.maybePreGrow(!0)}catch(a){console.error("[sync-relay] init pre-grow failed:",a?.message)}ft=new BroadcastChannel(`${i.ns}-watch`)}async function Ds(i){B=i.debug??!1,tt=!0;let t=await navigator.storage.getDirectory();if(i.root&&i.root!=="/"){const e=i.root.split("/").filter(Boolean);for(const s of e)t=await t.getDirectoryHandle(s,{create:!0})}Ct=new ze,await Ct.init(t,{uid:i.uid,gid:i.gid}),ft=new BroadcastChannel(`${i.ns}-watch`)}function It(i,t,e){if(!ft)return;let s;switch(i){case c.WRITE:case c.APPEND:case c.TRUNCATE:case c.FWRITE:case c.FTRUNCATE:case c.CHMOD:case c.CHOWN:case c.UTIMES:case c.COPY:s="change";break;case c.UNLINK:case c.RMDIR:case c.RENAME:case c.MKDIR:case c.MKDTEMP:case c.SYMLINK:case c.LINK:s="rename";break;default:return}ft.postMessage({eventType:s,path:t}),i===c.RENAME&&e&&ft.postMessage({eventType:"rename",path:e})}var at=new Map,Os=50,ot=new Map,ct=new Map;function ke(i){const t=D.readlink(i);if(t.status!==0||!t.data)return;const e=We(i,new TextDecoder().decode(t.data));Ge(ot,ct,i,e)}function Cs(i){if(at.delete(i),!!v)try{const t=D.read(i);if(t.status!==0){D.readlink(i).status===0&&v.postMessage({op:"write",path:i,data:new ArrayBuffer(0),ts:Date.now()});return}const e=Date.now();if(t.data&&t.data.byteLength>0){const s=t.data.buffer.byteLength===t.data.byteLength?t.data.buffer:t.data.slice().buffer;v.postMessage({op:"write",path:i,data:s,ts:e},[s])}else v.postMessage({op:"write",path:i,data:new ArrayBuffer(0),ts:e});Et(i)}catch{}}function Et(i){const t=ot.get(i);if(t)for(const e of t)Ut(e)}function vt(i){Et(i);for(const t of zt(ot.keys(),i))t!==i&&Et(t)}function X(i){const t=at.get(i);t&&(clearTimeout(t),at.delete(i))}function De(i,t){for(const{from:e,to:s}of Ye(at.keys(),i,t))X(e),Ut(s)}function Oe(i,t){for(const e of zt(ct.keys(),i))Dt(ot,ct,e),ke(e===i?t:t+e.slice(i.length))}function Ce(i,t){if(t)for(const e of zt(ct.keys(),i))Dt(ot,ct,e);else Dt(ot,ct,i)}function Ut(i){const t=at.get(i);t&&clearTimeout(t),at.set(i,setTimeout(()=>Cs(i),Os))}function gt(i,t,e){if(!v)return;const s=Date.now();switch(i){case c.WRITE:case c.APPEND:case c.TRUNCATE:case c.FWRITE:case c.FTRUNCATE:case c.COPY:case c.LINK:{Ut(t),Et(t);break}case c.SYMLINK:{ke(t),Ut(t);break}case c.UNLINK:case c.RMDIR:{X(t),Ce(t,i===c.RMDIR),v.postMessage({op:"delete",path:t,ts:s}),vt(t);break}case c.MKDIR:case c.MKDTEMP:v.postMessage({op:"mkdir",path:t,ts:s});break;case c.RENAME:if(e){X(t),X(e),De(t,e),Oe(t,e);const n=Ve(D,t,e,s);for(const r of n.messages)r.op==="write"&&n.transfers.includes(r.data)?v.postMessage(r,[r.data]):v.postMessage(r);vt(t)}break}}function Fs(i){switch(i.op){case"external-write":{let t=D.write(i.path,new Uint8Array(i.data),0);t.status===Y.EISDIR&&(D.rmdir(i.path,1),t=D.write(i.path,new Uint8Array(i.data),0)),t.status===0&&(Et(i.path),It(c.WRITE,i.path)),console.log("[sync-relay] external-write:",i.path,`${i.data?.byteLength??0}B`,`status=${t.status}`);break}case"external-delete":{X(i.path);let t=!1,e=D.unlink(i.path).status===0;e||(e=D.rmdir(i.path,1).status===0,t=e),e&&(Ce(i.path,t),vt(i.path),It(t?c.RMDIR:c.UNLINK,i.path)),console.log("[sync-relay] external-delete:",i.path,`dir=${t}`,`ok=${e}`);break}case"external-rename":if(i.newPath){const t=D.rename(i.path,i.newPath);t.status===0&&(X(i.path),X(i.newPath),De(i.path,i.newPath),Oe(i.path,i.newPath),vt(i.path),It(c.RENAME,i.path,i.newPath)),console.log("[sync-relay] external-rename:",i.path,"\\u2192",i.newPath,`status=${t.status}`)}break}}self.onmessage=async i=>{const t=i.data;if(t.type==="async-port"){const e=t.port??i.ports[0];e&&(Wt=e,e.onmessage=async s=>{if(s.data.buffer instanceof ArrayBuffer){if(q){const n=tt?await pt(N||"nosab",s.data.buffer):yt(N||"nosab",s.data.buffer),r=W(n.status,n.data);e.postMessage({id:s.data.id,buffer:r},[r]),!tt&&n._op!==void 0&&gt(n._op,n._path,n._newPath)}else if(st.hasPort){const n=s.data.buffer;st.postRaw({id:s.data.id,tabId:N,buffer:n},[n])}}},e.start());return}if(t.type==="init-leader"){if(q)return;q=!0,N=t.tabId;const e=t.sab!=null;e&&(x=t.sab,et=t.readySab,A=new Int32Array(x,0,8),z=new Int32Array(et,0,1),Vt()),t.asyncSab&&(_=t.asyncSab,k=new Int32Array(t.asyncSab,0,8));try{await ks(t.config)}catch(s){q=!1,self.postMessage({type:"init-failed",error:s.message});return}Z||(Z=!0,e&&(Atomics.store(z,0,1),Atomics.notify(z,0)),self.postMessage({type:"ready"})),e&&qt(bs,"leaderLoop");return}if(t.type==="init-opfs"){q=!0,Z=!1,N=t.tabId;const e=t.sab!=null;e&&(x=t.sab,et=t.readySab,A=new Int32Array(x,0,8),z=new Int32Array(et,0,1),Vt()),t.asyncSab&&(_=t.asyncSab,k=new Int32Array(t.asyncSab,0,8));try{await Ds(t.config)}catch(s){q=!1,self.postMessage({type:"init-failed",error:s.message});return}Z||(Z=!0,e&&(Atomics.store(z,0,1),Atomics.notify(z,0)),self.postMessage({type:"ready",mode:"opfs"})),e&&qt(Is,"leaderLoopOPFS");return}if(t.type==="init-follower"){N=t.tabId,t.sab!=null&&(x=t.sab,et=t.readySab,A=new Int32Array(x,0,8),z=new Int32Array(et,0,1),Vt()),t.asyncSab&&(_=t.asyncSab,k=new Int32Array(t.asyncSab,0,8));return}if(t.type==="leader-port"){if(q)return;const e=t.port??i.ports[0];if(!e)return;st.setPort(e),e.onmessage=us,e.start(),Z||(Z=!0,z&&(Atomics.store(z,0,1),Atomics.notify(z,0)),self.postMessage({type:"ready"}),A&&Es());return}if(t.type==="client-port"){rs(t.tabId,t.port??i.ports[0]);return}if(t.type==="client-lost"){as(t.tabId);return}if(t.type==="external-records"){v?.postMessage({type:"external-records",records:t.records});return}if(t.type==="shutdown"){if(dt){const e=dt;dt=null,await new Promise(s=>{const n=()=>{clearTimeout(r),je(e),s()},r=setTimeout(n,500);e.onmessage=a=>{a.data?.type==="shutdown-done"&&n()}})}try{v?.close()}catch{}v=null,Kt=!1,self.postMessage({type:"shutdown-done"});return}};\n';

// src/workers/inlined/async-relay.workertext
var async_relay_default = 'var d={READ:1,WRITE:2,UNLINK:3,STAT:4,LSTAT:5,MKDIR:6,RMDIR:7,READDIR:8,RENAME:9,EXISTS:10,TRUNCATE:11,APPEND:12,COPY:13,ACCESS:14,REALPATH:15,CHMOD:16,CHOWN:17,UTIMES:18,SYMLINK:19,READLINK:20,LINK:21,OPEN:22,CLOSE:23,FREAD:24,FWRITE:25,FSTAT:26,FTRUNCATE:27,FSYNC:28,OPENDIR:29,MKDTEMP:30,FCHMOD:31,FCHOWN:32,FUTIMES:33,STATFS:34},b={OK:0,ENOENT:1,EEXIST:2,EISDIR:3,ENOTDIR:4,ENOTEMPTY:5,EACCES:6,EINVAL:7,EBADF:8,ELOOP:9,ENOSPC:10,EIO:11},N={CONTROL:0,TICKET_NEXT:4,TICKET_SERVING:8,OPCODE:4,STATUS:8,CHUNK_LEN:12,TOTAL_LEN:16,CHUNK_IDX:24,HEARTBEAT:28,HEADER_SIZE:32},u={IDLE:0,REQUEST:1,RESPONSE:2,CHUNK:3,CHUNK_ACK:4},m=new TextEncoder,Q=new TextDecoder;function w(e,t,r=0,n){const s=m.encode(t),i=n?n.byteLength:0,f=16+s.byteLength+i,A=new ArrayBuffer(f),c=new DataView(A);c.setUint32(0,e,!0),c.setUint32(4,r,!0),c.setUint32(8,s.byteLength,!0),c.setUint32(12,i,!0);const o=new Uint8Array(A);return o.set(s,16),n&&o.set(n,16+s.byteLength),A}function R(e){const t=new DataView(e),r=t.getUint32(0,!0),n=t.getUint32(4,!0),s=n>0?new Uint8Array(e,8,n):null;return{status:r,data:s}}function p(e,t,r,n=0){const s=m.encode(r),i=new Uint8Array(4+s.byteLength);return new DataView(i.buffer).setUint32(0,s.byteLength,!0),i.set(s,4),w(e,t,n,i)}function g(e){const t=new Uint8Array(4);return K(t,0,e),t}function O(e,t,r){const n=new Uint8Array(16),s=new DataView(n.buffer);return s.setUint32(0,e,!0),s.setUint32(4,t,!0),s.setFloat64(8,r??-1,!0),n}function v(e,t,r){const n=new Uint8Array(12+r.byteLength),s=new DataView(n.buffer);return s.setUint32(0,e,!0),s.setFloat64(4,t??-1,!0),n.set(r,12),n}function F(e,t){const r=new Uint8Array(12),n=new DataView(r.buffer);return n.setUint32(0,e,!0),n.setFloat64(4,t,!0),r}function K(e,t,r){e[t]=r,e[t+1]=r>>>8,e[t+2]=r>>>16,e[t+3]=r>>>24}var P=12e4,C=1e3,h=class extends Error{constructor(e){super(`SAB protocol wait timed out: ${e}`),this.name="SabWaitTimeoutError"}};function I(e,t,r,n,s=C){for(;Atomics.load(e,0)===t;){const i=r-Date.now();if(i<=0)throw new h(n);Atomics.wait(e,0,t,Math.min(s,i))}}function M(e,t,r,n){for(;;){const s=Atomics.load(e,0);if(t.includes(s))return s;const i=r-Date.now();if(i<=0)throw new h(n);Atomics.wait(e,0,s,Math.min(C,i))}}var H=new TextEncoder,T=N.HEADER_SIZE,l=null,a=null,S=null;function _(e){const t=Date.now()+P;try{return B(e,t)}catch(r){if(r instanceof h)return Atomics.store(a,0,u.IDLE),{status:b.EIO,data:null};throw r}}function B(e,t){const r=l.byteLength-T,n=new Uint8Array(e),s=new BigUint64Array(l,N.TOTAL_LEN,1);if(n.byteLength<=r)new Uint8Array(l,T,n.byteLength).set(n),Atomics.store(a,3,n.byteLength),Atomics.store(s,0,BigInt(n.byteLength)),Atomics.store(a,0,u.REQUEST),Atomics.notify(a,0),S&&Atomics.notify(S,0);else{let o=0;for(;o<n.byteLength;){const E=Math.min(r,n.byteLength-o);new Uint8Array(l,T,E).set(n.subarray(o,o+E)),Atomics.store(a,3,E),Atomics.store(s,0,BigInt(n.byteLength)),Atomics.store(a,6,Math.floor(o/r)),o===0?Atomics.store(a,0,u.REQUEST):Atomics.store(a,0,u.CHUNK),Atomics.notify(a,0),o===0&&S&&Atomics.notify(S,0),o+=E,o<n.byteLength&&I(a,o===E?u.REQUEST:u.CHUNK,t,"request chunk ack")}I(a,u.CHUNK,t,"last request chunk ack")}const i=M(a,[u.RESPONSE,u.CHUNK],t,"response"),f=Atomics.load(a,3),A=Number(Atomics.load(s,0));let c;if(i===u.RESPONSE&&A<=r)c=new Uint8Array(l,T,f).slice();else{c=new Uint8Array(A);let o=0;for(c.set(new Uint8Array(l,T,f),0),o+=f;o<A;){Atomics.store(a,0,u.CHUNK_ACK),Atomics.notify(a,0),I(a,u.CHUNK_ACK,t,"response chunk");const E=Atomics.load(a,3);c.set(new Uint8Array(l,T,E),o),o+=E}}return Atomics.store(a,0,u.IDLE),Atomics.notify(a,0),R(c.buffer)}var y=null,U=new Map,q=0;function k(){return"a"+q++}function W(e){return new Promise(t=>{const r=k();U.set(r,n=>{t(R(n))}),y.postMessage({id:r,buffer:e},[e])})}async function V(e){return l?_(e):y?W(e):{status:7,data:null}}self.onmessage=async e=>{const t=e.data;if(t.type==="init-leader"){l=t.asyncSab,a=new Int32Array(t.asyncSab,0,8),t.wakeSab&&(S=new Int32Array(t.wakeSab,0,1));return}if(t.type==="init-port"){const r=t.port??e.ports[0];r&&(y=r,y.onmessage=n=>{const{id:s,buffer:i}=n.data,f=U.get(s);f&&(U.delete(s),f(i))},y.start());return}if(t.type!=="init-follower"){if(t.type==="leader-port"){y=t.port,y.onmessage=r=>{const{id:n,buffer:s}=r.data,i=U.get(n);i&&(U.delete(n),i(s))},y.start();return}if(t.type==="request"){const{callId:r,op:n,path:s,data:i,flags:f,path2:A,fdArgs:c}=t;try{let o;if(A!==void 0)o=p(n,s,A,f??0);else if(c)o=Y(n,c);else{const D=x(i);o=w(n,s??"",f??0,D??void 0)}const{status:E,data:L}=await V(o);self.postMessage({type:"response",callId:r,status:E,data:L},L?[L.buffer]:[])}catch(o){self.postMessage({type:"response",callId:r,status:7,data:null,error:o.message})}}}};function x(e){return e==null?null:e instanceof Uint8Array?e:e instanceof ArrayBuffer?new Uint8Array(e):typeof e=="string"?H.encode(e):null}function Y(e,t){switch(e){case d.FREAD:return w(e,"",0,O(t.fd,t.length??0,t.position??-1));case d.FWRITE:return w(e,"",0,v(t.fd,t.position??-1,t.data??new Uint8Array(0)));case d.FSTAT:case d.CLOSE:case d.FSYNC:return w(e,"",0,g(t.fd));case d.FTRUNCATE:return w(e,"",0,F(t.fd,t.length??0));default:return w(e,"",0)}}\n';

// src/path.ts
var path_exports = {};
__export(path_exports, {
  basename: () => basename,
  delimiter: () => delimiter,
  dirname: () => dirname,
  extname: () => extname,
  format: () => format,
  isAbsolute: () => isAbsolute,
  join: () => join,
  normalize: () => normalize,
  parse: () => parse,
  relative: () => relative,
  resolve: () => resolve,
  sep: () => sep,
  toPathString: () => toPathString,
  toRealpathString: () => toRealpathString
});
function toPathString(p) {
  if (typeof p === "string") return p;
  if (p instanceof Uint8Array) return new TextDecoder().decode(p);
  if (typeof URL !== "undefined" && p instanceof URL) {
    if (p.protocol !== "file:") {
      throw new TypeError("The URL must use the file: protocol");
    }
    return decodeURIComponent(p.pathname);
  }
  throw invalidArgType("path", "string or an instance of Uint8Array or URL", p);
}
function toRealpathString(p) {
  if (typeof p === "string") return p;
  if (p instanceof Uint8Array) return new TextDecoder().decode(p);
  if (typeof URL !== "undefined" && p instanceof URL) return toPathString(p);
  return String(p);
}
var sep = "/";
var delimiter = ":";
function normalize(p) {
  if (p.length === 0) return ".";
  const isAbsolute2 = p.charCodeAt(0) === 47;
  const segments = p.split("/");
  const result = [];
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (result.length > 0 && result[result.length - 1] !== "..") {
        result.pop();
      } else if (!isAbsolute2) {
        result.push("..");
      }
    } else {
      result.push(seg);
    }
  }
  let out = result.join("/");
  if (isAbsolute2) out = "/" + out;
  return out || (isAbsolute2 ? "/" : ".");
}
function join(...paths) {
  return normalize(paths.filter(Boolean).join("/"));
}
function resolve(...paths) {
  let resolved = "";
  for (let i = paths.length - 1; i >= 0; i--) {
    const p = paths[i];
    if (!p) continue;
    resolved = p + (resolved ? "/" + resolved : "");
    if (p.charCodeAt(0) === 47) break;
  }
  return normalize(resolved || "/");
}
function dirname(p) {
  if (p.length === 0) return ".";
  const i = p.lastIndexOf("/");
  if (i < 0) return ".";
  if (i === 0) return "/";
  return p.substring(0, i);
}
function basename(p, ext) {
  let base = p;
  const i = p.lastIndexOf("/");
  if (i >= 0) base = p.substring(i + 1);
  if (ext && base.endsWith(ext)) {
    base = base.substring(0, base.length - ext.length);
  }
  return base;
}
function extname(p) {
  const base = basename(p);
  const i = base.lastIndexOf(".");
  if (i <= 0) return "";
  return base.substring(i);
}
function isAbsolute(p) {
  return p.length > 0 && p.charCodeAt(0) === 47;
}
function relative(from, to) {
  const fromParts = resolve(from).split("/").filter(Boolean);
  const toParts = resolve(to).split("/").filter(Boolean);
  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common++;
  }
  const ups = fromParts.length - common;
  const result = [...Array(ups).fill(".."), ...toParts.slice(common)];
  return result.join("/") || ".";
}
function parse(p) {
  const dir = dirname(p);
  const base = basename(p);
  const ext = extname(p);
  const name = ext ? base.substring(0, base.length - ext.length) : base;
  const root = isAbsolute(p) ? "/" : "";
  return { root, dir, base, ext, name };
}
function format(obj) {
  const dir = obj.dir || obj.root || "";
  const base = obj.base || (obj.name || "") + (obj.ext || "");
  return dir ? dir === "/" ? "/" + base : dir + "/" + base : base;
}

// src/methods/watch.ts
var watchers = /* @__PURE__ */ new Set();
var fileWatchers = /* @__PURE__ */ new Map();
var bcMap = /* @__PURE__ */ new Map();
function ensureBc(ns) {
  const entry = bcMap.get(ns);
  if (entry) {
    entry.refCount++;
    return;
  }
  const bc = new BroadcastChannel(`${ns}-watch`);
  bcMap.set(ns, { bc, refCount: 1 });
  bc.onmessage = onBroadcast;
}
function releaseBc(ns) {
  const entry = bcMap.get(ns);
  if (!entry) return;
  if (--entry.refCount <= 0) {
    entry.bc.close();
    bcMap.delete(ns);
  }
}
function onBroadcast(event) {
  const { eventType, path: mutatedPath } = event.data;
  for (const entry of watchers) {
    const filename = matchWatcher(entry, mutatedPath);
    if (filename === null) continue;
    queueWatchEvent(entry, eventType, filename);
  }
  const fileSet = fileWatchers.get(mutatedPath);
  if (fileSet) {
    for (const entry of fileSet) {
      triggerWatchFile(entry);
    }
  }
}
function queueWatchEvent(entry, eventType, filename) {
  const key = eventType + ":" + filename;
  if (!entry.pendingEvents) {
    entry.pendingEvents = /* @__PURE__ */ new Set();
    queueMicrotask(() => {
      const pending = entry.pendingEvents;
      entry.pendingEvents = null;
      for (const k of pending) {
        const colon = k.indexOf(":");
        const et = k.slice(0, colon);
        const name = k.slice(colon + 1);
        try {
          entry.listener(et, entry.asBuffer ? encodeFilename(name) : name);
        } catch {
        }
      }
    });
  }
  entry.pendingEvents.add(key);
}
function encodeFilename(name) {
  return new TextEncoder().encode(name);
}
function matchWatcher(entry, mutatedPath) {
  const { absPath, recursive } = entry;
  if (mutatedPath === absPath) {
    return basename(mutatedPath);
  }
  const prefix = absPath.endsWith("/") ? absPath : absPath + "/";
  if (!mutatedPath.startsWith(prefix)) {
    return null;
  }
  const relativePath = mutatedPath.substring(prefix.length);
  if (recursive) return relativePath;
  return relativePath.indexOf("/") === -1 ? relativePath : null;
}
var VFSWatcher = class extends SimpleEventEmitter {
  #stop;
  #closed = false;
  constructor(stop) {
    super();
    this.#stop = stop;
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#stop();
    this.emit("close");
  }
  /**
   * Node's watchers hold the event loop open and `ref`/`unref` say whether they should. There is
   * no loop to hold open in a browser, so these keep the chainable shape and do nothing.
   */
  ref() {
    return this;
  }
  unref() {
    return this;
  }
};
var VFSStatWatcher = class extends SimpleEventEmitter {
  #stop;
  constructor(stop) {
    super();
    this.#stop = stop;
  }
  /** `stop()` is `unwatchFile` for this listener alone — see node's `StatWatcher#stop`. */
  stop() {
    this.#stop();
  }
  ref() {
    return this;
  }
  unref() {
    return this;
  }
};
function watch(ns, syncRequest, filePath, options, listener) {
  const listenerInOptions = typeof options === "function";
  const cb = listenerInOptions ? options : listener;
  const opts = typeof options === "string" ? { encoding: options } : listenerInOptions || options == null ? {} : options;
  const absPath = resolve(filePath);
  const signal = opts.signal;
  const asBuffer = opts.encoding === "buffer";
  try {
    statSync(syncRequest, absPath);
  } catch (err) {
    const code = err.code;
    throw code ? createError(code, "watch", filePath) : err;
  }
  const watcher = new VFSWatcher(() => {
    watchers.delete(entry);
    releaseBc(ns);
  });
  if (cb) watcher.on("change", cb);
  const entry = {
    ns,
    absPath,
    recursive: opts.recursive ?? false,
    listener: (eventType, filename) => watcher.emit("change", eventType, filename),
    signal,
    asBuffer,
    pendingEvents: null
  };
  ensureBc(ns);
  watchers.add(entry);
  if (signal) {
    const onAbort = () => {
      watchers.delete(entry);
      releaseBc(ns);
      signal.removeEventListener("abort", onAbort);
    };
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort);
    }
  }
  return watcher;
}
function watchFile(ns, syncRequest, filePath, optionsOrListener, listener) {
  let opts;
  let cb;
  if (typeof optionsOrListener === "function") {
    cb = optionsOrListener;
    opts = {};
  } else {
    opts = optionsOrListener ?? {};
    cb = listener;
  }
  const absPath = resolve(filePath);
  if (!cb) return new VFSStatWatcher(() => {
  });
  const interval = opts.interval ?? 5007;
  let prevStats = null;
  try {
    prevStats = statSync(syncRequest, absPath);
  } catch {
  }
  const watcher = new VFSStatWatcher(() => unwatchFile(ns, filePath, cb));
  const entry = {
    ns,
    absPath,
    listener: cb,
    watcher,
    interval,
    prevStats,
    syncRequest,
    timerId: null
  };
  ensureBc(ns);
  let set = fileWatchers.get(absPath);
  if (!set) {
    set = /* @__PURE__ */ new Set();
    fileWatchers.set(absPath, set);
  }
  set.add(entry);
  entry.timerId = setInterval(() => triggerWatchFile(entry), interval);
  return watcher;
}
function unwatchFile(ns, filePath, listener) {
  const absPath = resolve(filePath);
  const set = fileWatchers.get(absPath);
  if (!set) return;
  if (listener) {
    for (const entry of set) {
      if (entry.listener === listener) {
        if (entry.timerId !== null) clearInterval(entry.timerId);
        set.delete(entry);
        releaseBc(ns);
        break;
      }
    }
    if (set.size === 0) fileWatchers.delete(absPath);
  } else {
    for (const entry of set) {
      if (entry.timerId !== null) clearInterval(entry.timerId);
      releaseBc(ns);
    }
    fileWatchers.delete(absPath);
  }
}
function triggerWatchFile(entry) {
  let currStats = null;
  try {
    currStats = statSync(entry.syncRequest, entry.absPath);
  } catch {
  }
  const prev = entry.prevStats ?? emptyStats();
  const curr = currStats ?? emptyStats();
  if (prev.mtimeMs !== curr.mtimeMs || prev.size !== curr.size || prev.ino !== curr.ino) {
    entry.prevStats = currStats;
    try {
      entry.listener(curr, prev);
    } catch {
    }
    try {
      entry.watcher?.emit("change", curr, prev);
    } catch {
    }
  }
}
function emptyStats() {
  return new Stats(0, 0, 0, 0, 0, 0, 4096, 0, 0, 0, 0, 0, 0, 0);
}
async function* watchAsync(ns, _asyncRequest, filePath, options) {
  const absPath = resolve(filePath);
  const recursive = options?.recursive ?? false;
  const signal = options?.signal;
  const queue = [];
  let resolve2 = null;
  const asBuffer = options?.encoding === "buffer";
  const entry = {
    ns,
    absPath,
    recursive,
    listener: (eventType, filename) => {
      queue.push({ eventType, filename });
      if (resolve2) {
        resolve2();
        resolve2 = null;
      }
    },
    signal,
    asBuffer,
    pendingEvents: null
  };
  ensureBc(ns);
  watchers.add(entry);
  try {
    while (!signal?.aborted) {
      if (queue.length === 0) {
        await new Promise((r) => {
          resolve2 = r;
        });
      }
      while (queue.length > 0) {
        yield queue.shift();
      }
    }
  } finally {
    watchers.delete(entry);
    releaseBc(ns);
  }
}

// src/methods/glob.ts
function expandBraces(pattern) {
  const out = [];
  function recurse(prefix, rest) {
    const open2 = findBrace(rest);
    if (open2 === -1) {
      out.push(prefix + rest);
      return;
    }
    const close = matchCloseBrace(rest, open2);
    if (close === -1) {
      out.push(prefix + rest);
      return;
    }
    const head = rest.slice(0, open2);
    const body = rest.slice(open2 + 1, close);
    const tail = rest.slice(close + 1);
    for (const alt of splitAlternations(body)) {
      recurse(prefix + head + alt, tail);
    }
  }
  recurse("", pattern);
  return out;
}
function findBrace(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "[") {
      const end = s.indexOf("]", i + 1);
      if (end !== -1) {
        i = end;
        continue;
      }
    }
    if (c === "{") return i;
  }
  return -1;
}
function matchCloseBrace(s, open2) {
  let depth = 1;
  for (let i = open2 + 1; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "[") {
      const end = s.indexOf("]", i + 1);
      if (end !== -1) {
        i = end;
        continue;
      }
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
function splitAlternations(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}
function segmentToRegex(pattern) {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) {
      const next = pattern[++i];
      re += /[.+^${}()|[\]\\*?]/.test(next) ? "\\" + next : next;
    } else if (ch === "*") {
      re += "[^/]*";
    } else if (ch === "?") {
      re += "[^/]";
    } else if (ch === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end === -1) {
        re += "\\[";
      } else {
        let body = pattern.slice(i + 1, end);
        if (body.startsWith("!")) body = "^" + body.slice(1);
        re += "[" + body + "]";
        i = end;
      }
    } else if (".+^${}()|\\".includes(ch)) {
      re += "\\" + ch;
    } else {
      re += ch;
    }
  }
  re += "$";
  return new RegExp(re);
}
function joinPath(base, name) {
  if (base === "/") return "/" + name;
  return base + "/" + name;
}
function toResultPath(fullPath, cwd, patternIsAbsolute) {
  if (patternIsAbsolute) return fullPath;
  const base = cwd === "/" ? "/" : cwd.replace(/\/+$/, "") + "/";
  return fullPath.startsWith(base) ? fullPath.slice(base.length) : fullPath;
}
function normalizeCwd(cwd) {
  if (!cwd) return "/";
  if (typeof cwd === "string") return cwd || "/";
  return cwd.pathname || "/";
}
function makeDirent(parentPath, name, isDir, isSymlink) {
  const type = isDir ? INODE_TYPE.DIRECTORY : INODE_TYPE.FILE;
  return new Dirent(name, type, parentPath);
}
function globSync(syncRequest, pattern, options) {
  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  const cwd = normalizeCwd(options?.cwd);
  const exclude = options?.exclude;
  const withFileTypes = options?.withFileTypes === true;
  const patternIsAbsolute = patterns.every((p) => p.startsWith("/"));
  const resultsSet = /* @__PURE__ */ new Set();
  const resultsDirents = [];
  const pushResult = (fullPath) => {
    if (withFileTypes) {
      if (!resultsSet.has(fullPath)) {
        resultsSet.add(fullPath);
        let isDir = false;
        try {
          const s = statSync(syncRequest, fullPath);
          isDir = s.isDirectory();
        } catch {
        }
        const slash = fullPath.lastIndexOf("/");
        const parent = slash <= 0 ? "/" : fullPath.slice(0, slash);
        const name = fullPath.slice(slash + 1);
        const dirent = makeDirent(parent, name, isDir);
        if (exclude && exclude(dirent)) {
          resultsSet.delete(fullPath);
          return;
        }
        resultsDirents.push(dirent);
      }
    } else {
      if (exclude && exclude(fullPath)) return;
      resultsSet.add(toResultPath(fullPath, cwd, patternIsAbsolute));
    }
  };
  function walk(dir, segments, segIdx) {
    if (segIdx >= segments.length) return;
    const seg = segments[segIdx];
    const isLast = segIdx === segments.length - 1;
    if (seg === "**") {
      if (segIdx + 1 < segments.length) {
        walk(dir, segments, segIdx + 1);
      } else {
        pushResult(dir);
      }
      let entries2;
      try {
        entries2 = readdirSync(syncRequest, dir);
      } catch {
        return;
      }
      for (const entry of entries2) {
        const full = joinPath(dir, entry);
        let isDir;
        try {
          isDir = statSync(syncRequest, full).isDirectory();
        } catch {
          continue;
        }
        if (isDir) {
          walk(full, segments, segIdx);
        }
        if (isLast) pushResult(full);
      }
      return;
    }
    let entries;
    try {
      entries = readdirSync(syncRequest, dir);
    } catch {
      return;
    }
    const re = segmentToRegex(seg);
    for (const entry of entries) {
      if (!re.test(entry)) continue;
      const full = joinPath(dir, entry);
      if (isLast) {
        pushResult(full);
      } else {
        let isDir;
        try {
          isDir = statSync(syncRequest, full).isDirectory();
        } catch {
          continue;
        }
        if (isDir) walk(full, segments, segIdx + 1);
      }
    }
  }
  for (const pat of patterns) {
    for (const expanded of expandBraces(pat)) {
      const segments = expanded.split("/").filter((s) => s !== "");
      walk(cwd, segments, 0);
    }
  }
  return withFileTypes ? resultsDirents : Array.from(resultsSet);
}
async function glob(asyncRequest, pattern, options) {
  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  const cwd = normalizeCwd(options?.cwd);
  const exclude = options?.exclude;
  const withFileTypes = options?.withFileTypes === true;
  const patternIsAbsolute = patterns.every((p) => p.startsWith("/"));
  const resultsSet = /* @__PURE__ */ new Set();
  const resultsDirents = [];
  const pushResult = async (fullPath) => {
    if (withFileTypes) {
      if (resultsSet.has(fullPath)) return;
      resultsSet.add(fullPath);
      let isDir = false;
      try {
        const s = await stat(asyncRequest, fullPath);
        isDir = s.isDirectory();
      } catch {
      }
      const slash = fullPath.lastIndexOf("/");
      const parent = slash <= 0 ? "/" : fullPath.slice(0, slash);
      const name = fullPath.slice(slash + 1);
      const dirent = makeDirent(parent, name, isDir);
      if (exclude && exclude(dirent)) {
        resultsSet.delete(fullPath);
        return;
      }
      resultsDirents.push(dirent);
    } else {
      if (exclude && exclude(fullPath)) return;
      resultsSet.add(toResultPath(fullPath, cwd, patternIsAbsolute));
    }
  };
  async function walk(dir, segments, segIdx) {
    if (segIdx >= segments.length) return;
    const seg = segments[segIdx];
    const isLast = segIdx === segments.length - 1;
    if (seg === "**") {
      if (segIdx + 1 < segments.length) {
        await walk(dir, segments, segIdx + 1);
      } else {
        await pushResult(dir);
      }
      let entries2;
      try {
        entries2 = await readdir(asyncRequest, dir);
      } catch {
        return;
      }
      for (const entry of entries2) {
        const full = joinPath(dir, entry);
        let isDir;
        try {
          isDir = (await stat(asyncRequest, full)).isDirectory();
        } catch {
          continue;
        }
        if (isDir) await walk(full, segments, segIdx);
        if (isLast) await pushResult(full);
      }
      return;
    }
    let entries;
    try {
      entries = await readdir(asyncRequest, dir);
    } catch {
      return;
    }
    const re = segmentToRegex(seg);
    for (const entry of entries) {
      if (!re.test(entry)) continue;
      const full = joinPath(dir, entry);
      if (isLast) {
        await pushResult(full);
      } else {
        let isDir;
        try {
          isDir = (await stat(asyncRequest, full)).isDirectory();
        } catch {
          continue;
        }
        if (isDir) await walk(full, segments, segIdx + 1);
      }
    }
  }
  for (const pat of patterns) {
    for (const expanded of expandBraces(pat)) {
      const segments = expanded.split("/").filter((s) => s !== "");
      await walk(cwd, segments, 0);
    }
  }
  return withFileTypes ? resultsDirents : Array.from(resultsSet);
}

// src/utf8-stream.ts
function createUtf8StreamClass(host) {
  return class Utf8Stream extends SimpleEventEmitter {
    #fd = -1;
    #file;
    #buffer = [];
    #pending = 0;
    #writing = false;
    #destroyed = false;
    #ended = false;
    #timer = null;
    #minLength;
    #maxLength;
    #append;
    #mode;
    #mkdir;
    #sync;
    #fsync;
    #periodicFlush;
    #contentMode;
    constructor(options = {}) {
      super();
      if (typeof options !== "object" || options === null) {
        throw invalidArgType("options", "object", options);
      }
      const { dest, fd, contentMode = "utf8" } = options;
      if (contentMode !== "utf8" && contentMode !== "buffer") {
        throw invalidArgValue("contentMode", contentMode, "must be 'utf8' or 'buffer'");
      }
      if (dest === void 0 && fd === void 0) {
        throw invalidArgValue("options", options, "must contain either dest or fd");
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
      if (fd !== void 0) {
        this.#fd = fd;
      } else {
        this.#file = dest;
        this.#open();
      }
      if (this.#periodicFlush > 0) {
        this.#timer = setInterval(() => this.flush(), this.#periodicFlush);
        this.#timer.unref?.();
      }
      queueMicrotask(() => {
        if (!this.#destroyed) this.emit("ready");
      });
    }
    #open() {
      const file = this.#file;
      try {
        if (this.#mkdir) host.mkdirSync(host.dirname(file), { recursive: true });
        this.#fd = host.openSync(file, this.#append ? "a" : "w", this.#mode);
      } catch (err) {
        queueMicrotask(() => this.emit("error", err));
      }
    }
    // ---- getters, all read-only, matching node's ----
    get fd() {
      return this.#fd;
    }
    get file() {
      return this.#file;
    }
    get minLength() {
      return this.#minLength;
    }
    get maxLength() {
      return this.#maxLength;
    }
    get writing() {
      return this.#writing;
    }
    get sync() {
      return this.#sync;
    }
    get fsync() {
      return this.#fsync;
    }
    get append() {
      return this.#append;
    }
    get mode() {
      return this.#mode;
    }
    get mkdir() {
      return this.#mkdir;
    }
    get periodicFlush() {
      return this.#periodicFlush;
    }
    get contentMode() {
      return this.#contentMode;
    }
    /**
     * Queue a chunk. Returns `false` once `maxLength` is exceeded, as a Node writable does when
     * its buffer is full — and, like node's, the over-limit chunk is **dropped** rather than
     * queued, with a `drop` event.
     */
    write(chunk) {
      if (this.#destroyed) throw new Error("Utf8Stream destroyed");
      if (this.#ended) throw new Error("Utf8Stream ended");
      if (this.#contentMode === "utf8" && typeof chunk !== "string") {
        throw invalidArgType("chunk", "string", chunk);
      }
      if (this.#contentMode === "buffer" && typeof chunk === "string") {
        throw invalidArgType("chunk", "Uint8Array", chunk);
      }
      const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
      if (this.#maxLength > 0 && this.#pending + bytes.byteLength > this.#maxLength) {
        this.emit("drop", chunk);
        return false;
      }
      this.#buffer.push(bytes);
      this.#pending += bytes.byteLength;
      if (this.#pending >= this.#minLength) this.#drain();
      return true;
    }
    #drain() {
      if (this.#buffer.length === 0 || this.#fd < 0) return;
      const payload = this.#join();
      this.#buffer = [];
      this.#pending = 0;
      this.#writing = true;
      try {
        const written = host.writeSync(this.#fd, payload);
        if (this.#fsync) host.fsyncSync(this.#fd);
        this.#writing = false;
        this.emit("write", written);
        this.emit("drain");
      } catch (err) {
        this.#writing = false;
        this.emit("error", err);
      }
    }
    #join() {
      if (this.#buffer.length === 1) return this.#buffer[0];
      const out = new Uint8Array(this.#pending);
      let at = 0;
      for (const part of this.#buffer) {
        out.set(part, at);
        at += part.byteLength;
      }
      return out;
    }
    /** Flush buffered bytes, calling back when they have reached the file. */
    flush(callback) {
      try {
        this.#drain();
        if (callback) queueMicrotask(() => callback(null));
      } catch (err) {
        if (callback) queueMicrotask(() => callback(err));
        else this.emit("error", err);
      }
    }
    /** Flush synchronously. Everything here is synchronous already; this forces the batch out. */
    flushSync() {
      this.#drain();
    }
    /** Close the current descriptor and open the destination again — log rotation. */
    reopen(dest) {
      if (this.#destroyed) throw new Error("Utf8Stream destroyed");
      this.#drain();
      if (this.#fd >= 0 && this.#file !== void 0) {
        try {
          host.closeSync(this.#fd);
        } catch {
        }
      }
      if (dest !== void 0) this.#file = dest;
      if (this.#file === void 0) throw invalidArgValue("dest", dest, "is required to reopen an fd-backed stream");
      this.#open();
      this.emit("ready");
    }
    /** Flush, close, then emit `finish` and `close`. */
    end() {
      if (this.#ended || this.#destroyed) return;
      this.#ended = true;
      this.#drain();
      this.#close();
      this.emit("finish");
      this.emit("close");
    }
    /** Drop everything without flushing. */
    destroy() {
      if (this.#destroyed) return;
      this.#destroyed = true;
      this.#buffer = [];
      this.#pending = 0;
      this.#close();
      this.emit("close");
    }
    #close() {
      if (this.#timer) {
        clearInterval(this.#timer);
        this.#timer = null;
      }
      if (this.#fd >= 0 && this.#file !== void 0) {
        try {
          host.closeSync(this.#fd);
        } catch {
        }
      }
      this.#fd = -1;
    }
  };
}

// src/filesystem.ts
new TextEncoder();
var DEFAULT_SAB_SIZE = 2 * 1024 * 1024;
var instanceRegistry = /* @__PURE__ */ new Map();
var HEADER_SIZE = SAB_OFFSETS.HEADER_SIZE;
var _canAtomicsWait = typeof globalThis.WorkerGlobalScope !== "undefined";
var SAB_HEARTBEAT_INDEX = SAB_OFFSETS.HEARTBEAT >> 2;
var SPIN_STALL_TIMEOUT_MS = 3e4;
var SPIN_NO_HEARTBEAT_TIMEOUT_MS = 3e4;
var OPFS_MAIN_THREAD_SPIN_TIMEOUT_MS = 1e4;
var OPFS_SYNC_STALL_MESSAGE = "VFS sync operation stalled in opfs mode. Sync calls from a page main thread are only reliable on Chromium here: every operation is async underneath, and the spin-wait this thread must use (Atomics.wait is illegal on the main thread) starves the relay worker on Firefox and WebKit. Use fs.promises.* instead, or host the filesystem inside a Worker, where the sync API works on every engine.";
function spinWait(arr, index, value, heartbeatArr, absoluteDeadlineMs, deadlineMessage) {
  if (_canAtomicsWait) {
    Atomics.wait(arr, index, value);
    return;
  }
  const deadlineAt = absoluteDeadlineMs !== void 0 ? performance.now() + absoluteDeadlineMs : Infinity;
  const checkDeadline = () => {
    if (performance.now() > deadlineAt) {
      throw new Error(deadlineMessage ?? `VFS sync operation timed out after ${absoluteDeadlineMs}ms`);
    }
  };
  if (!heartbeatArr) {
    const start = performance.now();
    while (Atomics.load(arr, index) === value) {
      checkDeadline();
      if (performance.now() - start > SPIN_NO_HEARTBEAT_TIMEOUT_MS) {
        throw new Error(
          `VFS sync operation timed out after ${SPIN_NO_HEARTBEAT_TIMEOUT_MS / 1e3}s \u2014 relay worker did not respond`
        );
      }
    }
    return;
  }
  let lastBeat = Atomics.load(heartbeatArr, SAB_HEARTBEAT_INDEX);
  let lastProgress = performance.now();
  while (Atomics.load(arr, index) === value) {
    checkDeadline();
    const beat = Atomics.load(heartbeatArr, SAB_HEARTBEAT_INDEX);
    if (beat !== lastBeat) {
      lastBeat = beat;
      lastProgress = performance.now();
    } else if (performance.now() - lastProgress > SPIN_STALL_TIMEOUT_MS) {
      throw new Error(
        `VFS sync operation aborted: relay worker heartbeat stalled for ${SPIN_STALL_TIMEOUT_MS / 1e3}s \u2014 worker is unresponsive`
      );
    }
  }
}
function assertCopyable(srcPath, destPath) {
  if (srcPath === destPath) throw cpSameSource(srcPath);
  const srcPrefix = srcPath.endsWith("/") ? srcPath : srcPath + "/";
  if (destPath.startsWith(srcPrefix)) throw cpIntoSubdirectory(srcPath, destPath);
}
async function _readFileAsBlobBytes(read) {
  let data;
  try {
    data = await read;
  } catch (err) {
    const code = err.code;
    if (code === "ENOENT" || code === "EACCES" || code === "ENOTDIR" || code === "ELOOP") {
      throw Object.assign(new TypeError("Unable to open file as blob"), { code: "ERR_INVALID_ARG_VALUE" });
    }
    throw err;
  }
  return data instanceof Uint8Array ? data : new TextEncoder().encode(data);
}
var LIVE_KEY = "__componentorFsLiveInstances";
var liveInstances = globalThis[LIVE_KEY] ?? (globalThis[LIVE_KEY] = /* @__PURE__ */ new Set());
async function disposeAll() {
  await Promise.all([...liveInstances].map((fs) => fs.dispose().catch(() => {
  })));
}
var VFSFileSystem = class {
  /**
   * `fs.constants` — the flag/mode constants (`F_OK`, `O_CREAT`, `COPYFILE_EXCL`, …).
   *
   * This existed on `fs.promises.constants` but not on the instance, so the single most common
   * form — `fs.access(p, fs.constants.F_OK)` — read a property of `undefined`.
   */
  get constants() {
    return constants;
  }
  // The classes behind `stat`, `readdir({ withFileTypes: true })` and `opendir` results, exposed
  // as node exposes them so `x instanceof fs.Stats` / `fs.Dirent` / `fs.Dir` type-tests work.
  get Stats() {
    return Stats;
  }
  get Dirent() {
    return Dirent;
  }
  get Dir() {
    return Dir;
  }
  /**
   * `fs.Utf8Stream` — node 24's buffered append stream, the engine behind fast logging.
   *
   * Built per instance rather than exported as a module constant, because it writes through
   * *this* filesystem; node's can be a free class because there is only one real one. Cached so
   * `fs.Utf8Stream === fs.Utf8Stream` and `instanceof` behaves.
   */
  get Utf8Stream() {
    return this._utf8StreamClass ??= createUtf8StreamClass({
      openSync: (p, flags, mode) => this.openSync(p, flags, mode),
      writeSync: (fd, data) => this.writeSync(fd, data),
      closeSync: (fd) => this.closeSync(fd),
      fsyncSync: (fd) => this.fsyncSync(fd),
      mkdirSync: (p, o) => {
        this.mkdirSync(p, o);
      },
      dirname
    });
  }
  /**
   * TypeScript-private rather than a `#` field on purpose: the test harness builds an instance
   * with `Object.create(VFSFileSystem.prototype)` and never runs the constructor, and a real
   * private field would not exist on such an object — reading it throws rather than returning
   * `undefined`.
   */
  _utf8StreamClass;
  /**
   * Node's internal time coercion, exposed under the same underscored name node uses.
   *
   * Reduces a `Date`, a number of seconds, or a numeric string to seconds since the epoch. A
   * negative number means *now*, which is the part that surprises people — see
   * {@link toUnixTimestamp}.
   */
  _toUnixTimestamp(time, name = "time") {
    return toUnixTimestamp(time, name);
  }
  /**
   * Not on node's `fs` — node keeps `BigIntStats` internal — but `stat({ bigint: true })` returns
   * one, and there was no way to `instanceof` the result. Exposed for symmetry with `Stats`.
   */
  get BigIntStats() {
    return BigIntStats;
  }
  // SAB for sync communication with sync relay worker (null when SAB unavailable)
  sab;
  ctrl;
  readySab;
  readySignal;
  // SAB for async-relay ↔ sync-relay communication
  asyncSab;
  // Whether SharedArrayBuffer is available (crossOriginIsolated)
  hasSAB = typeof SharedArrayBuffer !== "undefined";
  // Workers
  syncWorker;
  asyncWorker;
  // Async request tracking
  asyncCallId = 0;
  asyncPending = /* @__PURE__ */ new Map();
  // Ready promise for async callers
  readyPromise;
  resolveReady;
  rejectReady;
  initError = null;
  isReady = false;
  /** Set by {@link dispose}; makes disposal idempotent. */
  closed = false;
  /** The `pagehide` handler, kept so {@link dispose} can unregister it. */
  onPageHide = null;
  /**
   * Watches real OPFS for changes made outside this library.
   *
   * Lives here, in the scope that owns the instance, rather than inside the mirror worker — the
   * whole point is that `disconnect()` is reachable **synchronously** from the unload path. A
   * recursive observer still attached when its page is torn down makes Chromium abort the entire
   * browser process, and an observer inside a nested worker cannot be detached in time: the page
   * can post a shutdown at `pagehide` but cannot wait for it.
   *
   * Only the detected records cross into the worker; the file I/O stays there.
   */
  externalObserver = null;
  /** True while a leader transition is in flight (promotion to leader, etc.).
   *  Cleared the moment the new sync-relay signals `ready`. Consumers can
   *  combine this with `isReady` to know when sync FS ops are safe again. */
  transitioning = false;
  /** Listeners awaiting the next `ready` signal (used by `whenReady()`). */
  readyListeners = /* @__PURE__ */ new Set();
  // Config (definite assignment — always set when constructor doesn't return singleton)
  config;
  tabId;
  _mode;
  corruptionError = null;
  /** Namespace string derived from root — used for lock names, BroadcastChannel, and SW scope
   *  so multiple VFS instances with different roots don't collide. */
  ns;
  // Service worker registration for multi-tab port transfer
  swReg = null;
  isFollower = false;
  /** Callbacks for {@link onLeaderChange}. */
  leaderListeners = /* @__PURE__ */ new Set();
  holdingLeaderLock = false;
  /** Resolving this releases the leader lock — see {@link acquireLeaderLock}. */
  releaseLeaderLock = null;
  /** Cancels a queued bid for promotion, so a disposed follower cannot later be elected. */
  leaderLockBid = null;
  brokerInitialized = false;
  brokerHeartbeatTimer = null;
  /** The service worker this instance registered its broker with, so it can deregister. */
  brokerSw = null;
  brokerControlPort = null;
  leaderChangeBc = null;
  // Bound request functions for method delegation
  _sync = (buf) => this.syncRequest(buf);
  /**
   * Spin cap for the current mode: bounded in `opfs` mode, unbounded otherwise.
   *
   * `undefined` keeps hybrid/vfs behaviour exactly as it was — those service sync requests
   * synchronously in the relay, so a long spin there means a genuinely slow op, not a stall.
   */
  _opfsSpinCap() {
    return this._mode === "opfs" ? OPFS_MAIN_THREAD_SPIN_TIMEOUT_MS : void 0;
  }
  _async = (op, p, flags, data, path2, fdArgs) => this.asyncRequest(op, p, flags, data, path2, fdArgs);
  // Promises API namespace
  promises;
  constructor(config = {}) {
    const root = config.root ?? "/";
    const ns = `vfs-${root.replace(/[^a-zA-Z0-9]/g, "_")}`;
    const existing = instanceRegistry.get(ns);
    if (existing) return existing;
    const mode = config.mode ?? "hybrid";
    this._mode = mode;
    const opfsSync = config.opfsSync ?? mode === "hybrid";
    this.config = {
      root,
      opfsSync,
      opfsSyncRoot: config.opfsSyncRoot,
      uid: config.uid ?? 0,
      gid: config.gid ?? 0,
      umask: config.umask ?? 18,
      strictPermissions: config.strictPermissions ?? false,
      sabSize: config.sabSize ?? DEFAULT_SAB_SIZE,
      debug: config.debug ?? false,
      forceSpin: config.forceSpin,
      swUrl: config.swUrl,
      swScope: config.swScope,
      swBridge: config.swBridge,
      limits: config.limits
    };
    this.tabId = crypto.randomUUID();
    this.ns = ns;
    this.readyPromise = new Promise((resolve2, reject) => {
      this.resolveReady = resolve2;
      this.rejectReady = reject;
    });
    this.promises = new VFSPromises(this._async, ns);
    const boundRealpath = this.realpath.bind(this);
    boundRealpath.native = boundRealpath;
    this.realpath = boundRealpath;
    const boundRealpathSync = this.realpathSync.bind(this);
    boundRealpathSync.native = boundRealpathSync;
    this.realpathSync = boundRealpathSync;
    instanceRegistry.set(ns, this);
    this.bootstrap();
  }
  /** Spawn workers and establish communication */
  bootstrap() {
    const sabSize = this.config.sabSize;
    if (this.hasSAB) {
      this.sab = new SharedArrayBuffer(sabSize);
      this.readySab = new SharedArrayBuffer(4);
      this.asyncSab = new SharedArrayBuffer(sabSize);
      this.ctrl = new Int32Array(this.sab, 0, 8);
      this.readySignal = new Int32Array(this.readySab, 0, 1);
    }
    this.syncWorker = this.spawnWorker("sync-relay");
    this.asyncWorker = this.spawnWorker("async-relay");
    liveInstances.add(this);
    this.installUnloadTeardown();
    void this.watchExternalChanges();
    this.syncWorker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "ready") {
        this.isReady = true;
        this.transitioning = false;
        this.initAsyncRelay();
        this.resolveReady();
        this.fireReadyListeners();
        if (!this.isFollower) {
          this.initLeaderBroker();
        }
      } else if (msg.type === "init-failed") {
        if (msg.error?.startsWith("Corrupt VFS:")) {
          this.handleCorruptVFS(msg.error);
        } else if (this.holdingLeaderLock) {
          setTimeout(() => this.sendLeaderInit(), 500);
        } else if (!("locks" in navigator)) {
          this.startAsFollower();
        }
      }
    };
    this.asyncWorker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "response") {
        const pending = this.asyncPending.get(msg.callId);
        if (pending) {
          this.asyncPending.delete(msg.callId);
          pending.resolve({ status: msg.status, data: msg.data });
        }
      }
    };
    this.acquireLeaderLock();
  }
  /** Use Web Locks API for leader election. The tab that acquires the lock is
   *  the leader; all others become followers. When the leader dies, the browser
   *  releases the lock and the next waiting tab is promoted. */
  acquireLeaderLock() {
    if (!("locks" in navigator)) {
      this.startAsLeader();
      return;
    }
    let decided = false;
    navigator.locks.request(`${this.ns}-leader`, { ifAvailable: true }, async (lock) => {
      if (decided) return;
      decided = true;
      if (lock) {
        this.holdingLeaderLock = true;
        this.startAsLeader();
        await new Promise((resolve2) => {
          this.releaseLeaderLock = resolve2;
        });
      } else {
        this.startAsFollower();
        this.waitForLeaderLock();
      }
    });
  }
  /** Queue for leader takeover when the current leader's lock is released */
  waitForLeaderLock() {
    if (!("locks" in navigator)) return;
    const bid = new AbortController();
    this.leaderLockBid = bid;
    navigator.locks.request(`${this.ns}-leader`, { signal: bid.signal }, async () => {
      this.leaderLockBid = null;
      if (this.closed) return;
      this.holdingLeaderLock = true;
      this.promoteToLeader();
      await new Promise((resolve2) => {
        this.releaseLeaderLock = resolve2;
      });
    }).catch(() => {
    });
  }
  /** Send init-leader message to sync-relay worker */
  sendLeaderInit() {
    this.syncWorker.postMessage({
      type: "init-leader",
      sab: this.hasSAB ? this.sab : null,
      readySab: this.hasSAB ? this.readySab : null,
      asyncSab: this.hasSAB ? this.asyncSab : null,
      tabId: this.tabId,
      config: {
        root: this.config.root,
        ns: this.ns,
        opfsSync: this.config.opfsSync,
        opfsSyncRoot: this.config.opfsSyncRoot,
        uid: this.config.uid,
        gid: this.config.gid,
        umask: this.config.umask,
        strictPermissions: this.config.strictPermissions,
        debug: this.config.debug,
        forceSpin: this.config.forceSpin,
        limits: this.config.limits
      }
    });
  }
  /** Send init-opfs message to sync-relay for OPFS-direct mode */
  sendOPFSInit() {
    this.syncWorker.postMessage({
      type: "init-opfs",
      sab: this.hasSAB ? this.sab : null,
      readySab: this.hasSAB ? this.readySab : null,
      asyncSab: this.hasSAB ? this.asyncSab : null,
      tabId: this.tabId,
      config: {
        root: this.config.root,
        ns: this.ns,
        uid: this.config.uid,
        gid: this.config.gid,
        debug: this.config.debug
      }
    });
  }
  /** Handle VFS corruption: log error, fall back to OPFS-direct mode.
   *  The readyPromise will resolve once OPFS mode is ready, but init()
   *  will reject with the corruption error to inform the caller. */
  handleCorruptVFS(errorMessage) {
    const err = new Error(`${errorMessage} \u2014 Falling back to OPFS mode`);
    this.corruptionError = err;
    console.error(`[VFS] ${err.message}`);
    if (this._mode === "vfs") {
      this.initError = err;
      this.rejectReady(err);
      if (this.hasSAB) {
        Atomics.store(this.readySignal, 0, -1);
        Atomics.notify(this.readySignal, 0);
      }
      return;
    }
    this._mode = "opfs";
    this.sendOPFSInit();
  }
  /** Initialize the async-relay worker. Called after sync-relay signals ready. */
  initAsyncRelay() {
    if (this.hasSAB) {
      this.asyncWorker.postMessage({
        type: "init-leader",
        asyncSab: this.asyncSab,
        wakeSab: this.sab
      });
    } else {
      const mc = new MessageChannel();
      this.asyncWorker.postMessage(
        { type: "init-port", port: mc.port1 },
        [mc.port1]
      );
      this.syncWorker.postMessage(
        { type: "async-port", port: mc.port2 },
        [mc.port2]
      );
    }
  }
  /** Start as leader — tell sync-relay to init VFS engine + OPFS handle */
  startAsLeader() {
    this.isFollower = false;
    this.announceRole();
    if (this._mode === "opfs") {
      this.sendOPFSInit();
    } else {
      this.sendLeaderInit();
    }
  }
  /** Start as follower — connect to leader via service worker port brokering */
  startAsFollower() {
    this.isFollower = true;
    this.announceRole();
    this.syncWorker.postMessage({
      type: "init-follower",
      sab: this.hasSAB ? this.sab : null,
      readySab: this.hasSAB ? this.readySab : null,
      asyncSab: this.hasSAB ? this.asyncSab : null,
      tabId: this.tabId
    });
    this.connectToLeader();
    this.leaderChangeBc = new BroadcastChannel(`${this.ns}-leader-change`);
    this.leaderChangeBc.onmessage = () => {
      if (this.isFollower) {
        console.log("[VFS] Leader changed \u2014 reconnecting");
        this.connectToLeader();
      }
    };
  }
  /** Send a new port to sync-relay for connecting to the current leader */
  connectToLeader() {
    const mc = new MessageChannel();
    this.syncWorker.postMessage(
      { type: "leader-port", port: mc.port1 },
      [mc.port1]
    );
    this.getServiceWorker().then((sw) => {
      sw.postMessage({ type: "transfer-port", tabId: this.tabId }, [mc.port2]);
    }).catch((err) => {
      console.error("[VFS] Failed to connect to leader:", err.message);
      mc.port2.close();
    });
  }
  /** Register the VFS service worker and return something that can post
   *  messages to it. When running inside a worker (`swBridge` provided),
   *  returns a proxy that forwards postMessages — including transferred
   *  ports — to a main-thread bridge that owns the real `navigator.serviceWorker`. */
  async getServiceWorker() {
    if (this.config.swBridge) {
      const bridge = this.config.swBridge;
      return {
        postMessage: (message, transfer) => bridge.postMessage(message, transfer ?? [])
      };
    }
    if (!this.swReg) {
      const base = typeof document !== "undefined" ? document.baseURI : location.href;
      const swUrl = this.config.swUrl ? new URL(this.config.swUrl, base) : new URL("./workers/service.worker.js", import.meta.url);
      const scope = this.config.swScope ?? new URL(`./${this.ns}/`, swUrl).href;
      this.swReg = await navigator.serviceWorker.register(swUrl.href, { scope });
    }
    const reg = this.swReg;
    if (reg.active) return reg.active;
    const sw = reg.installing || reg.waiting;
    if (!sw) throw new Error("No service worker found");
    return new Promise((resolve2, reject) => {
      const timer = setTimeout(() => {
        sw.removeEventListener("statechange", onState);
        reject(new Error("Service worker activation timeout"));
      }, 5e3);
      const onState = () => {
        if (sw.state === "activated") {
          clearTimeout(timer);
          sw.removeEventListener("statechange", onState);
          resolve2(sw);
        } else if (sw.state === "redundant") {
          clearTimeout(timer);
          sw.removeEventListener("statechange", onState);
          reject(new Error("SW redundant"));
        }
      };
      sw.addEventListener("statechange", onState);
      onState();
    });
  }
  /** Register as leader with SW broker (receives follower ports via control channel).
   *
   *  Re-registers on a heartbeat so the broker survives SW idle-kill. Without this,
   *  a follower opening a tab after the SW has been killed (≥30s idle on Chrome)
   *  sees its `transfer-port` queued in the new SW's `pending` array forever:
   *  the prior leader's `port2` was held by the dead SW instance, the new SW
   *  starts with `serverPort=null`, and the leader has no way to know to
   *  re-register.
   *
   *  Re-posting `register-server` is idempotent in the SW handler — it replaces
   *  `serverPort` and flushes `pending` — so the heartbeat alone unsticks
   *  followers without needing to disturb anyone else. The follower's queued
   *  `mc.port2` rides through the pending-flush, and because it's a
   *  MessageChannel, any messages the follower's sync-relay had already posted
   *  on `port1` are buffered on `port2` until the leader's syncWorker starts
   *  the received port. Standard MessageChannel semantics — no follower-side
   *  notification required.
   *
   *  We deliberately do NOT broadcast `leader-changed` from the heartbeat:
   *  followers receiving it call `connectToLeader()`, which tears down the
   *  existing `leader-port` and resolves any in-flight sync FS request with
   *  EIO (sync-relay.worker.ts: `pendingResolve(EIO)`). Broadcasting on every
   *  tick would inject random EIOs into long-running ops on every connected
   *  follower. Broadcast only fires once, at initial registration, to wake any
   *  pre-existing followers (e.g. left over from a previous leader). */
  initLeaderBroker() {
    if (this.brokerInitialized) return;
    this.brokerInitialized = true;
    const register = () => {
      this.getServiceWorker().then((sw) => {
        this.brokerSw = sw;
        const mc = new MessageChannel();
        sw.postMessage({ type: "register-server" }, [mc.port2]);
        mc.port1.onmessage = (event) => {
          if (event.data.type === "client-port") {
            const clientPort = event.ports[0];
            if (clientPort) {
              this.syncWorker.postMessage(
                { type: "client-port", tabId: event.data.tabId, port: clientPort },
                [clientPort]
              );
            }
          }
        };
        mc.port1.start();
        this.brokerControlPort = mc.port1;
      }).catch((err) => {
        console.warn("[VFS] SW broker unavailable, single-tab only:", err.message);
      });
    };
    register();
    const bc = new BroadcastChannel(`${this.ns}-leader-change`);
    bc.postMessage({ type: "leader-changed" });
    bc.close();
    if (this.brokerHeartbeatTimer) clearInterval(this.brokerHeartbeatTimer);
    this.brokerHeartbeatTimer = setInterval(register, 5e3);
  }
  /** Promote from follower to leader (after leader tab dies and lock is acquired) */
  promoteToLeader() {
    this.isFollower = false;
    this.announceRole();
    this.isReady = false;
    this.transitioning = true;
    this.brokerInitialized = false;
    if (this.brokerHeartbeatTimer) {
      clearInterval(this.brokerHeartbeatTimer);
      this.brokerHeartbeatTimer = null;
    }
    if (this.brokerControlPort) {
      try {
        this.brokerControlPort.close();
      } catch {
      }
      this.brokerControlPort = null;
    }
    this.deregisterBroker();
    if (this.leaderChangeBc) {
      this.leaderChangeBc.close();
      this.leaderChangeBc = null;
    }
    this.readyPromise = new Promise((resolve2, reject) => {
      this.resolveReady = resolve2;
      this.rejectReady = reject;
    });
    terminateWorker(this.syncWorker);
    terminateWorker(this.asyncWorker);
    const sabSize = this.config.sabSize;
    if (this.hasSAB) {
      this.sab = new SharedArrayBuffer(sabSize);
      this.readySab = new SharedArrayBuffer(4);
      this.asyncSab = new SharedArrayBuffer(sabSize);
      this.ctrl = new Int32Array(this.sab, 0, 8);
      this.readySignal = new Int32Array(this.readySab, 0, 1);
    }
    this.syncWorker = this.spawnWorker("sync-relay");
    this.asyncWorker = this.spawnWorker("async-relay");
    this.syncWorker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "ready") {
        this.isReady = true;
        this.transitioning = false;
        this.resolveReady();
        this.fireReadyListeners();
        this.initLeaderBroker();
      } else if (msg.type === "init-failed") {
        if (msg.error?.startsWith("Corrupt VFS:")) {
          this.handleCorruptVFS(msg.error);
        } else {
          console.warn("[VFS] Promotion: OPFS handle still busy, retrying...");
          setTimeout(() => this.sendLeaderInit(), 500);
        }
      }
    };
    this.asyncWorker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "response") {
        const pending = this.asyncPending.get(msg.callId);
        if (pending) {
          this.asyncPending.delete(msg.callId);
          pending.resolve({ status: msg.status, data: msg.data });
        }
      }
    };
    if (this.hasSAB) {
      this.asyncWorker.postMessage({
        type: "init-leader",
        asyncSab: this.asyncSab,
        wakeSab: this.sab
      });
    } else {
      const mc = new MessageChannel();
      this.asyncWorker.postMessage(
        { type: "init-port", port: mc.port1 },
        [mc.port1]
      );
      this.syncWorker.postMessage(
        { type: "async-port", port: mc.port2 },
        [mc.port2]
      );
    }
    if (this._mode === "opfs") {
      this.sendOPFSInit();
    } else {
      this.sendLeaderInit();
    }
  }
  /** Spawn an inline worker from bundled code */
  /**
   * Start one of the relay workers from source embedded in this bundle.
   *
   * This used to resolve `new URL('./workers/<name>.worker.js', import.meta.url)`, which meant
   * the package could not be loaded from a CDN at all (a cross-origin `new Worker()` is a
   * `SecurityError`) and needed `optimizeDeps.exclude` under Vite, whose pre-bundling rewrites
   * that URL. See [worker-blob.ts](./workers/worker-blob.ts).
   */
  spawnWorker(name) {
    return workerFromSource(name === "sync-relay" ? sync_relay_default : async_relay_default, `vfs-${name}`);
  }
  // ========== Sync operation primitives ==========
  /** Block until workers are ready */
  ensureReady() {
    if (this.isReady) return;
    if (this.initError) throw this.initError;
    if (!this.hasSAB) {
      throw new Error("Sync API requires crossOriginIsolated (COOP/COEP headers). Use the promises API instead.");
    }
    const signal = Atomics.load(this.readySignal, 0);
    if (signal === 1) {
      this.isReady = true;
      return;
    }
    if (signal === -1) {
      throw this.initError ?? new Error("VFS initialization failed");
    }
    spinWait(this.readySignal, 0, 0, this.ctrl);
    const finalSignal = Atomics.load(this.readySignal, 0);
    if (finalSignal === -1) {
      throw this.initError ?? new Error("VFS initialization failed");
    }
    this.isReady = true;
  }
  /** Send a sync request via SAB and wait for response */
  syncRequest(requestBuf) {
    this.ensureReady();
    const lockCtrl = this.ctrl;
    acquireFsLock(lockCtrl);
    try {
      return this.syncRequestLocked(requestBuf);
    } finally {
      releaseFsLock(lockCtrl);
    }
  }
  syncRequestLocked(requestBuf) {
    const t0 = this.config.debug ? performance.now() : 0;
    const maxChunk = this.sab.byteLength - HEADER_SIZE;
    const requestBytes = new Uint8Array(requestBuf);
    const totalLenView = new BigUint64Array(this.sab, SAB_OFFSETS.TOTAL_LEN, 1);
    const multiChunkRequest = requestBytes.byteLength > maxChunk;
    if (!multiChunkRequest) {
      new Uint8Array(this.sab, HEADER_SIZE, requestBytes.byteLength).set(requestBytes);
      Atomics.store(this.ctrl, 3, requestBytes.byteLength);
      Atomics.store(totalLenView, 0, BigInt(requestBytes.byteLength));
      Atomics.store(this.ctrl, 0, SIGNAL.REQUEST);
      Atomics.notify(this.ctrl, 0);
    } else {
      let sent = 0;
      while (sent < requestBytes.byteLength) {
        const chunkSize = Math.min(maxChunk, requestBytes.byteLength - sent);
        new Uint8Array(this.sab, HEADER_SIZE, chunkSize).set(
          requestBytes.subarray(sent, sent + chunkSize)
        );
        Atomics.store(this.ctrl, 3, chunkSize);
        Atomics.store(totalLenView, 0, BigInt(requestBytes.byteLength));
        Atomics.store(this.ctrl, 6, Math.floor(sent / maxChunk));
        if (sent === 0) {
          Atomics.store(this.ctrl, 0, SIGNAL.REQUEST);
        } else {
          Atomics.store(this.ctrl, 0, SIGNAL.CHUNK);
        }
        Atomics.notify(this.ctrl, 0);
        sent += chunkSize;
        if (sent < requestBytes.byteLength) {
          spinWait(this.ctrl, 0, sent === chunkSize ? SIGNAL.REQUEST : SIGNAL.CHUNK, this.ctrl, this._opfsSpinCap(), OPFS_SYNC_STALL_MESSAGE);
        }
      }
    }
    spinWait(this.ctrl, 0, multiChunkRequest ? SIGNAL.CHUNK : SIGNAL.REQUEST, this.ctrl, this._opfsSpinCap(), OPFS_SYNC_STALL_MESSAGE);
    const signal = Atomics.load(this.ctrl, 0);
    const respChunkLen = Atomics.load(this.ctrl, 3);
    const respTotalLen = Number(Atomics.load(totalLenView, 0));
    let responseBytes;
    if (signal === SIGNAL.RESPONSE && respTotalLen <= maxChunk) {
      responseBytes = new Uint8Array(this.sab, HEADER_SIZE, respChunkLen).slice();
    } else {
      responseBytes = new Uint8Array(respTotalLen);
      let received = 0;
      const firstLen = respChunkLen;
      responseBytes.set(new Uint8Array(this.sab, HEADER_SIZE, firstLen), 0);
      received += firstLen;
      while (received < respTotalLen) {
        Atomics.store(this.ctrl, 0, SIGNAL.CHUNK_ACK);
        Atomics.notify(this.ctrl, 0);
        spinWait(this.ctrl, 0, SIGNAL.CHUNK_ACK, this.ctrl, this._opfsSpinCap(), OPFS_SYNC_STALL_MESSAGE);
        const nextLen = Atomics.load(this.ctrl, 3);
        responseBytes.set(new Uint8Array(this.sab, HEADER_SIZE, nextLen), received);
        received += nextLen;
      }
    }
    Atomics.store(this.ctrl, 0, SIGNAL.IDLE);
    const result = decodeResponse(responseBytes.buffer);
    if (this.config.debug) {
      const t1 = performance.now();
      console.log(`[syncRequest] size=${requestBuf.byteLength} roundTrip=${(t1 - t0).toFixed(3)}ms`);
    }
    return result;
  }
  // ========== Async operation primitive ==========
  asyncRequest(op, filePath, flags, data, path2, fdArgs) {
    return this.readyPromise.then(() => {
      return new Promise((resolve2, reject) => {
        const callId = this.asyncCallId++;
        this.asyncPending.set(callId, { resolve: resolve2, reject });
        this.asyncWorker.postMessage({
          type: "request",
          callId,
          op,
          path: filePath,
          flags: flags ?? 0,
          data: data instanceof Uint8Array ? data : typeof data === "string" ? data : null,
          path2,
          fdArgs
        });
      });
    });
  }
  // ========== Sync API ==========
  readFileSync(filePath, options) {
    if (isFdArg(filePath)) return readFileFdSync(this._sync, filePath, options);
    return readFileSync(this._sync, toPathString(filePath), options);
  }
  writeFileSync(filePath, data, options) {
    if (isFdArg(filePath)) return writeFileFdSync(this._sync, filePath, data, options);
    writeFileSync(this._sync, toPathString(filePath), data, options);
  }
  appendFileSync(filePath, data, options) {
    if (isFdArg(filePath)) return appendFileFdSync(this._sync, filePath, data, options);
    appendFileSync(this._sync, toPathString(filePath), data, options);
  }
  existsSync(filePath) {
    return existsSync(this._sync, toPathString(filePath));
  }
  mkdirSync(filePath, options) {
    return mkdirSync(this._sync, toPathString(filePath), options);
  }
  rmdirSync(filePath, options) {
    rmdirSync(this._sync, toPathString(filePath), options);
  }
  rmSync(filePath, options) {
    rmSync(this._sync, toPathString(filePath), options);
  }
  unlinkSync(filePath) {
    unlinkSync(this._sync, toPathString(filePath));
  }
  readdirSync(filePath, options) {
    return readdirSync(this._sync, toPathString(filePath), options);
  }
  globSync(pattern, options) {
    return globSync(this._sync, pattern, options);
  }
  opendirSync(filePath, options) {
    const dirPath = toPathString(filePath);
    const entries = this.readdirSync(dirPath, {
      withFileTypes: true,
      recursive: options?.recursive
    });
    return new Dir(dirPath, entries);
  }
  statSync(filePath, options) {
    return statSync(this._sync, toPathString(filePath), options);
  }
  lstatSync(filePath, options) {
    return lstatSync(this._sync, toPathString(filePath), options);
  }
  renameSync(oldPath, newPath) {
    renameSync(this._sync, toPathString(oldPath), toPathString(newPath));
  }
  copyFileSync(src, dest, mode) {
    copyFileSync(this._sync, toPathString(src), toPathString(dest), mode);
  }
  /**
   * Reject a copy whose destination is the source, or lives inside it.
   *
   * The subtree case is the dangerous one: a recursive copy into its own subtree recreates the
   * destination inside itself on every pass and never terminates — an unbounded loop that hangs
   * the tab and fills storage. Node rejects both with ERR_FS_CP_EINVAL before copying anything.
   *
   * Called once per public `cp` entry point rather than inside the recursion, so the recursive
   * calls (whose dest is legitimately inside the destination tree) are unaffected.
   */
  _assertCopyable(srcPath, destPath) {
    assertCopyable(srcPath, destPath);
  }
  cpSync(src, dest, options) {
    this._assertCopyable(toPathString(src), toPathString(dest));
    this._cpSyncInner(src, dest, options);
  }
  /** The recursive worker. Its destinations are legitimately inside the destination tree. */
  _cpSyncInner(src, dest, options) {
    const srcPath = toPathString(src);
    const destPath = toPathString(dest);
    if (options?.filter && !options.filter(srcPath, destPath)) return;
    const force = options?.force !== false;
    const errorOnExist = options?.errorOnExist ?? false;
    options?.dereference ?? false;
    const preserveTimestamps = options?.preserveTimestamps ?? false;
    const srcStat = this.lstatSync(srcPath);
    if (srcStat.isDirectory()) {
      if (!options?.recursive) {
        throw cpEisdirNotRecursive(srcPath);
      }
      try {
        this.mkdirSync(destPath, { recursive: true });
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      }
      const entries = this.readdirSync(srcPath, { withFileTypes: true });
      for (const entry of entries) {
        const srcChild = join(srcPath, entry.name);
        const destChild = join(destPath, entry.name);
        this._cpSyncInner(srcChild, destChild, options);
      }
    } else if (srcStat.isSymbolicLink()) {
      const target = this.readlinkSync(srcPath);
      let destExists = false;
      try {
        this.lstatSync(destPath);
        destExists = true;
      } catch {
      }
      if (destExists) {
        if (errorOnExist) throw cpTargetExists(destPath);
        if (!force) return;
        this.unlinkSync(destPath);
      }
      this.symlinkSync(target, destPath);
    } else {
      let destExists = false;
      try {
        this.lstatSync(destPath);
        destExists = true;
      } catch {
      }
      if (destExists) {
        if (errorOnExist) throw cpTargetExists(destPath);
        if (!force) return;
      }
      this.copyFileSync(srcPath, destPath, errorOnExist ? constants.COPYFILE_EXCL : 0);
    }
    if (preserveTimestamps) {
      const st = this.statSync(srcPath);
      this.utimesSync(destPath, st.atime, st.mtime);
    }
  }
  async _cpAsync(src, dest, options) {
    if (options?.filter && !options.filter(src, dest)) return;
    const force = options?.force !== false;
    const errorOnExist = options?.errorOnExist ?? false;
    options?.dereference ?? false;
    const preserveTimestamps = options?.preserveTimestamps ?? false;
    const srcStat = await this.promises.lstat(src);
    if (srcStat.isDirectory()) {
      if (!options?.recursive) {
        throw cpEisdirNotRecursive(src);
      }
      try {
        await this.promises.mkdir(dest, { recursive: true });
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      }
      const entries = await this.promises.readdir(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcChild = join(src, entry.name);
        const destChild = join(dest, entry.name);
        await this._cpAsync(srcChild, destChild, options);
      }
    } else if (srcStat.isSymbolicLink()) {
      const target = await this.promises.readlink(src);
      let destExists = false;
      try {
        await this.promises.lstat(dest);
        destExists = true;
      } catch {
      }
      if (destExists) {
        if (errorOnExist) throw cpTargetExists(dest);
        if (!force) return;
        await this.promises.unlink(dest);
      }
      await this.promises.symlink(target, dest);
    } else {
      let destExists = false;
      try {
        await this.promises.lstat(dest);
        destExists = true;
      } catch {
      }
      if (destExists) {
        if (errorOnExist) throw cpTargetExists(dest);
        if (!force) return;
      }
      await this.promises.copyFile(src, dest, errorOnExist ? constants.COPYFILE_EXCL : 0);
    }
    if (preserveTimestamps) {
      const st = await this.promises.stat(src);
      await this.promises.utimes(dest, st.atime, st.mtime);
    }
  }
  truncateSync(filePath, len) {
    truncateSync(this._sync, toPathString(filePath), len);
  }
  accessSync(filePath, mode) {
    accessSync(this._sync, toPathString(filePath), mode);
  }
  realpathSync(filePath, options) {
    return realpathSync(this._sync, toRealpathString(filePath), options);
  }
  chmodSync(filePath, mode) {
    chmodSync(this._sync, toPathString(filePath), mode);
  }
  /**
   * `chmod` on the symlink itself rather than on what it points at.
   *
   * This used to delegate straight to `chmodSync`, which follows the link — so it changed the
   * **target's** permissions, the one outcome the `l` prefix exists to rule out.
   */
  lchmodSync(filePath, mode) {
    chmodSync(this._sync, toPathString(filePath), mode, false);
  }
  /** chmod on an open file descriptor. Resolves the fd to its inode on the
   *  server side and mutates the inode's mode bits directly, matching what
   *  native Node's libuv does. */
  fchmodSync(fd, mode) {
    fchmodSync(this._sync, fd, mode);
  }
  chownSync(filePath, uid, gid) {
    chownSync(this._sync, toPathString(filePath), uid, gid);
  }
  /** `chown` on the symlink itself rather than its target — see {@link lchmodSync}. */
  lchownSync(filePath, uid, gid) {
    chownSync(this._sync, toPathString(filePath), uid, gid, false);
  }
  /** chown on an open file descriptor. Mutates the underlying inode's uid/gid. */
  fchownSync(fd, uid, gid) {
    fchownSync(this._sync, fd, uid, gid);
  }
  utimesSync(filePath, atime, mtime) {
    utimesSync(this._sync, toPathString(filePath), atime, mtime);
  }
  /** utimes on an open file descriptor. Mutates the underlying inode's atime/mtime. */
  futimesSync(fd, atime, mtime) {
    futimesSync(this._sync, fd, atime, mtime);
  }
  /** Timestamps on the symlink itself rather than its target — see {@link lchmodSync}. */
  lutimesSync(filePath, atime, mtime) {
    utimesSync(this._sync, toPathString(filePath), atime, mtime, false);
  }
  symlinkSync(target, linkPath, type) {
    symlinkSync(this._sync, toPathString(target), toPathString(linkPath));
  }
  readlinkSync(filePath, options) {
    return readlinkSync(this._sync, toPathString(filePath), options);
  }
  linkSync(existingPath, newPath) {
    linkSync(this._sync, toPathString(existingPath), toPathString(newPath));
  }
  mkdtempSync(prefix, options) {
    return mkdtempSync(this._sync, toPathString(prefix), options);
  }
  /**
   * The stream constructors, exposed as properties the way `node:fs` exposes them, so
   * `x instanceof fs.ReadStream` and `fs.FileReadStream` resolve for code written against Node.
   * `Stats`, `Dirent` and `Dir` are exposed the same way — see the getters near the top of the
   * class. They became real classes in 3.3.27; before that they were object literals and there
   * was nothing for `instanceof` to test against.
   */
  get ReadStream() {
    return NodeReadable;
  }
  get WriteStream() {
    return NodeWritable;
  }
  /** Node's legacy aliases for the same two constructors. */
  get FileReadStream() {
    return NodeReadable;
  }
  get FileWriteStream() {
    return NodeWritable;
  }
  /**
   * `mkdtempSync` whose result cleans itself up — Node 24's explicit-resource-management form.
   *
   * ```js
   * using dir = fs.mkdtempDisposableSync('/tmp/build-');
   * // dir.path is removed when the block exits, however it exits
   * ```
   * `remove()` is idempotent so an explicit call followed by the implicit `Symbol.dispose`
   * does not throw ENOENT.
   */
  mkdtempDisposableSync(prefix) {
    const path = mkdtempSync(this._sync, prefix);
    const remove = () => {
      this.rmSync(path, { recursive: true, force: true });
    };
    return { path, remove, [Symbol.dispose]: remove };
  }
  // ---- File descriptor sync methods ----
  openSync(filePath, flags = "r", mode) {
    return openSync(this._sync, toPathString(filePath), flags, mode);
  }
  closeSync(fd) {
    closeSync(this._sync, fd);
  }
  readSync(fd, bufferOrOptions, offsetOrOptions, length, position) {
    return readSync(this._sync, fd, bufferOrOptions, offsetOrOptions, length, position);
  }
  writeSync(fd, bufferOrString, offsetOrPositionOrOptions, lengthOrEncoding, position) {
    return writeSyncFd(this._sync, fd, bufferOrString, offsetOrPositionOrOptions, lengthOrEncoding, position);
  }
  fstatSync(fd, options) {
    return fstatSync(this._sync, fd, options);
  }
  ftruncateSync(fd, len) {
    ftruncateSync(this._sync, fd, len);
  }
  fdatasyncSync(fd) {
    fdatasyncSync(this._sync, fd);
  }
  fsyncSync(fd) {
    fdatasyncSync(this._sync, fd, "fsync");
  }
  // ---- Vector I/O methods ----
  readvSync(fd, buffers, position) {
    let totalRead = 0;
    let pos = position ?? null;
    for (const buf of buffers) {
      const bytesRead = this.readSync(fd, buf, 0, buf.byteLength, pos);
      totalRead += bytesRead;
      if (pos !== null) pos += bytesRead;
      if (bytesRead < buf.byteLength) break;
    }
    return totalRead;
  }
  writevSync(fd, buffers, position) {
    let totalWritten = 0;
    let pos = position ?? null;
    for (const buf of buffers) {
      const bytesWritten = this.writeSync(fd, buf, 0, buf.byteLength, pos);
      totalWritten += bytesWritten;
      if (pos !== null) pos += bytesWritten;
    }
    return totalWritten;
  }
  readv(fd, buffers, positionOrCallback, callback) {
    let pos;
    let cb;
    if (typeof positionOrCallback === "function") {
      pos = void 0;
      cb = positionOrCallback;
    } else {
      pos = positionOrCallback;
      cb = callback;
    }
    this._validateCb(cb);
    try {
      const bytesRead = this.readvSync(fd, buffers, pos);
      if (cb) setTimeout(() => cb(null, bytesRead, buffers), 0);
    } catch (err) {
      if (cb) setTimeout(() => cb(err), 0);
      else throw err;
    }
  }
  writev(fd, buffers, positionOrCallback, callback) {
    let pos;
    let cb;
    if (typeof positionOrCallback === "function") {
      pos = void 0;
      cb = positionOrCallback;
    } else {
      pos = positionOrCallback;
      cb = callback;
    }
    this._validateCb(cb);
    try {
      const bytesWritten = this.writevSync(fd, buffers, pos);
      if (cb) setTimeout(() => cb(null, bytesWritten, buffers), 0);
    } catch (err) {
      if (cb) setTimeout(() => cb(err), 0);
      else throw err;
    }
  }
  // ---- statfs methods ----
  /**
   * Real volume statistics, read from the VFS superblock.
   *
   * This used to return fixed constants — always ~4 GB capacity with ~2 GB free, whatever the
   * volume actually held — so code checking free space before a large write got an answer
   * unrelated to reality, and never saw a full disk coming.
   */
  statfsSync(path = "/", options) {
    return statfsSync(this._sync, toPathString(path), options);
  }
  statfs(path = "/", callback) {
    const promise = statfs(this._async, path);
    if (callback) {
      this._validateCb(callback);
      return this._cb(promise, callback);
    }
    return promise;
  }
  // ---- Watch methods ----
  watch(filePath, options, listener) {
    return watch(this.ns, this._sync, toPathString(filePath), options, listener);
  }
  watchFile(filePath, optionsOrListener, listener) {
    return watchFile(this.ns, this._sync, toPathString(filePath), optionsOrListener, listener);
  }
  unwatchFile(filePath, listener) {
    unwatchFile(this.ns, toPathString(filePath), listener);
  }
  // ---- openAsBlob (Node.js 19+) ----
  async openAsBlob(filePath, options) {
    const data = await _readFileAsBlobBytes(this.promises.readFile(filePath));
    return new Blob([data], { type: options?.type ?? "" });
  }
  // ---- Stream methods ----
  createReadStream(filePath, options) {
    const opts = typeof options === "string" ? void 0 : options;
    const providedFd = opts?.fd;
    const stream = readStreamFromHandle({
      // Opened lazily on first read, as before — creating the stream must not touch the disk.
      acquire: async () => providedFd != null ? createFileHandle(providedFd, this._async) : await this.promises.open(toPathString(filePath), opts?.flags ?? "r"),
      // A caller-supplied fd stays the caller's to close.
      autoClose: providedFd == null && opts?.autoClose !== false,
      path: toPathString(filePath),
      // A descriptor handed in by the caller has its own position, and node reads from it; one we
      // opened ourselves is at zero, where the two are the same.
      followCursor: providedFd != null
    }, options);
    return stream;
  }
  createWriteStream(filePath, options) {
    const opts = typeof options === "string" ? void 0 : options;
    const providedFd = opts?.fd;
    const stream = writeStreamFromHandle({
      acquire: async () => providedFd != null ? createFileHandle(providedFd, this._async) : await this.promises.open(toPathString(filePath), opts?.flags ?? "w"),
      autoClose: providedFd == null && opts?.autoClose !== false,
      path: toPathString(filePath),
      followCursor: providedFd != null
    }, options);
    return stream;
  }
  // ---- Utility methods ----
  flushSync() {
    const buf = encodeRequest(OP.FSYNC, "");
    this.syncRequest(buf);
  }
  purgeSync() {
  }
  /** The current filesystem mode. Changes to 'opfs' on corruption fallback. */
  get mode() {
    return this._mode;
  }
  /** Async init helper — avoid blocking main thread.
   *  Rejects with corruption error if VFS was corrupt (but system falls back to OPFS mode).
   *  Callers can catch and continue — the fs API works in OPFS mode after rejection. */
  init() {
    return this.readyPromise.then(() => {
      if (this.corruptionError) {
        throw this.corruptionError;
      }
    });
  }
  /** True only while the filesystem is fully ready for synchronous operations
   *  AND no leader transition is in progress. Reflects the moment-in-time state;
   *  use `whenReady()` to await readiness reliably. */
  get ready() {
    return this.isReady && !this.transitioning;
  }
  /** Resolves once the filesystem is fully ready for synchronous operations,
   *  including any in-flight leader transition (promotion-to-leader, etc.).
   *  If already ready and no transition is pending, resolves immediately.
   *
   *  Use this when coordinating with other Web-Lock-based systems (e.g. a
   *  parent app that elects its own leader independently of the FS) — the
   *  timing of the two elections isn't synchronized, so the FS may still be
   *  reinitialising when the parent's lock fires. Calling `whenReady()`
   *  after your own leader-acquisition guarantees the FS is back in a state
   *  where sync ops won't stall the 20-second relay-worker heartbeat. */
  whenReady() {
    if (this.isReady && !this.transitioning) return Promise.resolve();
    if (this.transitioning) {
      return new Promise((resolve2) => {
        this.readyListeners.add(resolve2);
      });
    }
    return this.readyPromise.then(() => {
    });
  }
  /** Internal — called by lifecycle handlers when sync-relay says 'ready'. */
  fireReadyListeners() {
    const listeners = Array.from(this.readyListeners);
    this.readyListeners.clear();
    for (const l of listeners) {
      try {
        l();
      } catch (e) {
        console.warn("[VFS] readyListener threw:", e);
      }
    }
  }
  /**
   * Register the external-change observer, if this mode wants one and the browser has the API.
   *
   * Records are forwarded to the mirror worker, which reads the files and applies them; see
   * `applyExternalRecords` in opfs-sync.worker.ts.
   */
  async watchExternalChanges() {
    if (!this.config.opfsSync) return;
    if (typeof FileSystemObserver === "undefined") return;
    if (typeof document === "undefined") return;
    try {
      let dir = await navigator.storage.getDirectory();
      const root = this.config.opfsSyncRoot ?? this.config.root;
      for (const segment of (root ?? "/").split("/").filter(Boolean)) {
        dir = await dir.getDirectoryHandle(segment, { create: true });
      }
      if (this.closed) return;
      const observer = new FileSystemObserver((records) => {
        this.forwardExternalRecords(records.map((record) => ({
          kind: record.type,
          path: "/" + record.relativePathComponents.join("/"),
          from: record.relativePathMovedFrom ? "/" + record.relativePathMovedFrom.join("/") : void 0,
          handle: record.changedHandle
        })));
      });
      await observer.observe(dir, { recursive: true });
      if (this.closed) {
        try {
          observer.disconnect();
        } catch {
        }
        return;
      }
      this.externalObserver = observer;
    } catch (err) {
      console.warn("[VFS] external-change watching unavailable:", err?.message);
    }
  }
  /** Hand detected records to the mirror worker, which does the file I/O. */
  forwardExternalRecords(records) {
    try {
      this.syncWorker?.postMessage({ type: "external-records", records });
    } catch {
    }
  }
  /** Detach the observer. Synchronous on purpose — the unload path cannot await. */
  stopWatchingExternalChanges() {
    if (!this.externalObserver) return;
    try {
      this.externalObserver.disconnect();
    } catch {
    }
    this.externalObserver = null;
  }
  /**
   * Tear the workers down when the page goes away, without needing the caller to remember.
   *
   * The OPFS mirror worker holds a recursive `FileSystemObserver`, and Chromium aborts the
   * **browser process** — `FATAL: Detected dangling raw_ptr in unretained` — when a page is
   * destroyed with one still attached. Callers cannot reasonably be relied on to call
   * {@link dispose} before every navigation, and `pagehide` is too late to round-trip a message
   * to the worker and back: nothing will run the event loop again.
   *
   * So this does the one thing that works synchronously — terminate the relay. The mirror worker
   * is a *nested* worker owned by the relay, so killing the parent destroys the child's context
   * and the observer with it, before teardown can trip over it.
   *
   * `event.persisted` means the page is going into the back/forward cache and may be restored,
   * so the filesystem is left alone in that case.
   */
  installUnloadTeardown() {
    if (typeof addEventListener !== "function" || typeof document === "undefined") return;
    this.onPageHide = (event) => {
      if (event.persisted) return;
      this.stopWatchingExternalChanges();
      terminateWorker(this.syncWorker);
      terminateWorker(this.asyncWorker);
    };
    addEventListener("pagehide", this.onPageHide);
  }
  /**
   * Ask the sync relay to release what it owns, and wait briefly for it to confirm.
   *
   * The thing that actually has to happen here is the OPFS mirror worker disconnecting its
   * recursive `FileSystemObserver`. Everything else the relay holds dies with the worker; an
   * attached observer does not, and Chromium aborts the browser process on a page teardown that
   * leaves one dangling. Bounded, because a close must not be able to hang.
   */
  async shutdownRelay() {
    if (!this.syncWorker) return;
    const worker = this.syncWorker;
    const previous = worker.onmessage;
    try {
      await new Promise((resolve2) => {
        const done = () => {
          clearTimeout(timer);
          worker.onmessage = previous;
          resolve2();
        };
        const timer = setTimeout(done, 750);
        worker.onmessage = (e) => {
          if (e.data?.type === "shutdown-done") done();
          else if (typeof previous === "function") previous.call(worker, e);
        };
        worker.postMessage({ type: "shutdown" });
      });
    } catch {
    }
  }
  /**
   * Release every resource this instance owns: the relay workers, the OPFS mirror worker, and
   * the `FileSystemObserver` registered on the origin's storage.
   *
   * Worth calling explicitly in anything that creates instances repeatedly — a test suite, an
   * app that switches volumes — because the observer is the one thing that does not simply die
   * with the page. The instance is unusable afterwards; construct a new one to reopen the volume.
   *
   * Named `dispose` rather than `close` because `close(fd)` is already node's descriptor API and
   * means something entirely different. `await using fs = new VFSFileSystem()` works too.
   */
  async dispose() {
    if (this.closed) return;
    this.closed = true;
    liveInstances.delete(this);
    this.stopWatchingExternalChanges();
    if (this.onPageHide) {
      removeEventListener("pagehide", this.onPageHide);
      this.onPageHide = null;
    }
    if (this.brokerHeartbeatTimer) {
      clearInterval(this.brokerHeartbeatTimer);
      this.brokerHeartbeatTimer = null;
    }
    this.deregisterBroker();
    await this.shutdownRelay();
    terminateWorker(this.syncWorker);
    terminateWorker(this.asyncWorker);
    this.leaderLockBid?.abort();
    this.leaderLockBid = null;
    this.releaseLeaderLock?.();
    this.releaseLeaderLock = null;
    this.holdingLeaderLock = false;
    this.isReady = false;
  }
  /**
   * Tell the service-worker broker this instance is no longer serving.
   *
   * The broker holds one `serverPort` for the volume. If a leader goes away without saying so,
   * that slot keeps a detached port, and posting to a detached port is a silent no-op — so
   * followers' ports were dropped on the floor instead of being queued for the next leader, and
   * every call they made waited out the 10s forward deadline. Clearing it is what lets the
   * broker queue arrivals and flush them the moment a new leader registers.
   */
  deregisterBroker() {
    if (!this.brokerSw) return;
    try {
      this.brokerSw.postMessage({ type: "deregister-server" });
    } catch {
    }
    this.brokerSw = null;
  }
  /** `await using` support, so an instance can be scoped to a block. */
  [Symbol.asyncDispose]() {
    return this.dispose();
  }
  /**
   * Whether this tab owns the volume.
   *
   * One tab per origin holds the lock and does the actual work; the rest relay their calls to it.
   * Which one you are is worth knowing for two reasons. A follower's synchronous calls cost a
   * round trip to the leader, so they measure slower — a benchmark that does not say which role
   * it ran in is not comparable. And on Safari a follower's *main-thread* sync call cannot work
   * at all (see the readme), so code that must be synchronous everywhere runs the instance in a
   * worker.
   *
   * Leadership moves: close the leader and a follower is promoted, without reloading. Use
   * {@link onLeaderChange} rather than reading this once.
   */
  get isLeader() {
    return !this.isFollower;
  }
  /**
   * Observe leadership changes. Returns an unsubscribe function.
   *
   * Fires on election and on promotion when the previous leader goes away.
   */
  onLeaderChange(listener) {
    this.leaderListeners.add(listener);
    return () => {
      this.leaderListeners.delete(listener);
    };
  }
  announceRole() {
    const isLeader = !this.isFollower;
    for (const listener of this.leaderListeners) {
      try {
        listener(isLeader);
      } catch (err) {
        console.warn("[VFS] leader listener threw:", err);
      }
    }
  }
  /** Switch the filesystem mode at runtime.
   *
   *  Typical flow for IDE corruption recovery:
   *  1. `await fs.init()` throws with corruption error (auto-falls back to opfs)
   *  2. IDE shows warning, user clicks "Repair" → call `repairVFS(root, fs)`
   *  3. After repair: `await fs.setMode('hybrid')` to resume normal VFS+OPFS mode
   *
   *  Returns a Promise that resolves when the new mode is ready. */
  async setMode(newMode) {
    if (newMode === this._mode && this.isReady && !this.corruptionError) {
      return;
    }
    this._mode = newMode;
    this.corruptionError = null;
    this.initError = null;
    this.isReady = false;
    this.config.opfsSync = newMode === "hybrid";
    this.readyPromise = new Promise((resolve2, reject) => {
      this.resolveReady = resolve2;
      this.rejectReady = reject;
    });
    await this.shutdownRelay();
    terminateWorker(this.syncWorker);
    terminateWorker(this.asyncWorker);
    const sabSize = this.config.sabSize;
    if (this.hasSAB) {
      this.sab = new SharedArrayBuffer(sabSize);
      this.readySab = new SharedArrayBuffer(4);
      this.asyncSab = new SharedArrayBuffer(sabSize);
      this.ctrl = new Int32Array(this.sab, 0, 8);
      this.readySignal = new Int32Array(this.readySab, 0, 1);
    }
    this.syncWorker = this.spawnWorker("sync-relay");
    this.asyncWorker = this.spawnWorker("async-relay");
    this.syncWorker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "ready") {
        this.isReady = true;
        this.transitioning = false;
        this.resolveReady();
        this.fireReadyListeners();
        if (!this.isFollower) {
          this.initLeaderBroker();
        }
      } else if (msg.type === "init-failed") {
        if (msg.error?.startsWith("Corrupt VFS:")) {
          this.handleCorruptVFS(msg.error);
        } else if (this.holdingLeaderLock) {
          setTimeout(() => this.sendLeaderInit(), 500);
        }
      }
    };
    this.asyncWorker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "response") {
        const pending = this.asyncPending.get(msg.callId);
        if (pending) {
          this.asyncPending.delete(msg.callId);
          pending.resolve({ status: msg.status, data: msg.data });
        }
      }
    };
    if (this.hasSAB) {
      this.asyncWorker.postMessage({
        type: "init-leader",
        asyncSab: this.asyncSab,
        wakeSab: this.sab
      });
    } else {
      const mc = new MessageChannel();
      this.asyncWorker.postMessage(
        { type: "init-port", port: mc.port1 },
        [mc.port1]
      );
      this.syncWorker.postMessage(
        { type: "async-port", port: mc.port2 },
        [mc.port2]
      );
    }
    if (newMode === "opfs") {
      this.sendOPFSInit();
    } else {
      this.sendLeaderInit();
    }
    return this.readyPromise;
  }
  // ========== Callback API ==========
  // Node.js-style callback overloads for all async operations.
  // These delegate to this.promises.* and adapt the result to (err, result) callbacks.
  _validateCb(cb) {
    if (cb !== void 0 && cb !== null && typeof cb !== "function") {
      throw new TypeError('The "cb" argument must be of type function. Received ' + typeof cb);
    }
  }
  /** Adapt a promise to optional Node.js callback style.
   *  If cb is a function: calls cb(err, result) via setTimeout. Returns void.
   *  If cb is missing: returns the promise (allows .then() or await). */
  _cb(promise, cb, mapResult) {
    if (typeof cb === "function") {
      promise.then(
        (val) => setTimeout(() => cb(null, ...mapResult ? mapResult(val) : [val]), 0),
        (err) => setTimeout(() => cb(err), 0)
      );
      return;
    }
    return promise;
  }
  /** Like _cb but for void-returning promises (no result value). */
  _cbVoid(promise, cb) {
    if (typeof cb === "function") {
      promise.then(
        () => setTimeout(() => cb(null), 0),
        (err) => setTimeout(() => cb(err), 0)
      );
      return;
    }
    return promise;
  }
  readFile(filePath, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    if (isFdArg(filePath)) return this._cb(readFileFd(this._async, filePath, opts), cb);
    toPathString(filePath);
    return this._cb(this.promises.readFile(filePath, opts), cb);
  }
  writeFile(filePath, data, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    if (isFdArg(filePath)) return this._cbVoid(writeFileFd(this._async, filePath, data, opts), cb);
    toPathString(filePath);
    return this._cbVoid(this.promises.writeFile(filePath, data, opts), cb);
  }
  appendFile(filePath, data, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    if (isFdArg(filePath)) return this._cbVoid(appendFileFd(this._async, filePath, data, opts), cb);
    toPathString(filePath);
    return this._cbVoid(this.promises.appendFile(filePath, data, opts), cb);
  }
  mkdir(filePath, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    toPathString(filePath);
    return this._cb(this.promises.mkdir(filePath, opts), cb);
  }
  rmdir(filePath, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    toPathString(filePath);
    return this._cbVoid(this.promises.rmdir(filePath, opts), cb);
  }
  rm(filePath, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    toPathString(filePath);
    return this._cbVoid(this.promises.rm(filePath, opts), cb);
  }
  unlink(filePath, callback) {
    this._validateCb(callback);
    toPathString(filePath);
    return this._cbVoid(this.promises.unlink(filePath), callback);
  }
  readdir(filePath, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    toPathString(filePath);
    return this._cb(this.promises.readdir(filePath, opts), cb);
  }
  stat(filePath, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    toPathString(filePath);
    return this._cb(this.promises.stat(filePath, opts), cb);
  }
  lstat(filePath, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    toPathString(filePath);
    return this._cb(this.promises.lstat(filePath, opts), cb);
  }
  access(filePath, modeOrCallback, callback) {
    const cb = typeof modeOrCallback === "function" ? modeOrCallback : callback;
    this._validateCb(cb);
    const mode = typeof modeOrCallback === "function" ? void 0 : modeOrCallback;
    toPathString(filePath);
    return this._cbVoid(this.promises.access(filePath, mode), cb);
  }
  rename(oldPath, newPath, callback) {
    this._validateCb(callback);
    toPathString(oldPath);
    toPathString(newPath);
    return this._cbVoid(this.promises.rename(oldPath, newPath), callback);
  }
  copyFile(src, dest, modeOrCallback, callback) {
    const cb = typeof modeOrCallback === "function" ? modeOrCallback : callback;
    this._validateCb(cb);
    const mode = typeof modeOrCallback === "function" ? void 0 : modeOrCallback;
    toPathString(src);
    toPathString(dest);
    return this._cbVoid(this.promises.copyFile(src, dest, mode), cb);
  }
  truncate(filePath, lenOrCallback, callback) {
    const cb = typeof lenOrCallback === "function" ? lenOrCallback : callback;
    this._validateCb(cb);
    const len = typeof lenOrCallback === "function" ? void 0 : lenOrCallback;
    toPathString(filePath);
    return this._cbVoid(this.promises.truncate(filePath, len), cb);
  }
  realpath(filePath, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    this._validateCb(cb);
    return this._cb(this.promises.realpath(filePath, opts), cb);
  }
  chmod(filePath, mode, callback) {
    this._validateCb(callback);
    toPathString(filePath);
    return this._cbVoid(this.promises.chmod(filePath, mode), callback);
  }
  chown(filePath, uid, gid, callback) {
    this._validateCb(callback);
    toPathString(filePath);
    return this._cbVoid(this.promises.chown(filePath, uid, gid), callback);
  }
  utimes(filePath, atime, mtime, callback) {
    this._validateCb(callback);
    toPathString(filePath);
    return this._cbVoid(this.promises.utimes(filePath, atime, mtime), callback);
  }
  symlink(target, linkPath, typeOrCallback, callback) {
    const cb = typeof typeOrCallback === "function" ? typeOrCallback : callback;
    this._validateCb(cb);
    const type = typeof typeOrCallback === "function" ? void 0 : typeOrCallback;
    toPathString(target);
    toPathString(linkPath);
    return this._cbVoid(this.promises.symlink(target, linkPath, type), cb);
  }
  readlink(filePath, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    toPathString(filePath);
    return this._cb(this.promises.readlink(filePath, opts), cb);
  }
  link(existingPath, newPath, callback) {
    this._validateCb(callback);
    toPathString(existingPath);
    toPathString(newPath);
    return this._cbVoid(this.promises.link(existingPath, newPath), callback);
  }
  open(filePath, flagsOrCallback, modeOrCallback, callback) {
    let flags = "r";
    let mode;
    let cb;
    if (typeof flagsOrCallback === "function") {
      cb = flagsOrCallback;
    } else {
      flags = flagsOrCallback ?? "r";
      if (typeof modeOrCallback === "function") {
        cb = modeOrCallback;
      } else {
        mode = modeOrCallback;
        cb = callback;
      }
    }
    this._validateCb(cb);
    toPathString(filePath);
    return this._cb(this.promises.open(filePath, flags, mode), cb, (handle) => [handle.fd]);
  }
  mkdtemp(prefix, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    this._validateCb(cb);
    toPathString(prefix);
    return this._cb(this.promises.mkdtemp(prefix, opts), cb);
  }
  cp(src, dest, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    if (cb) {
      this._validateCb(cb);
      this._cpAsync(src, dest, opts).then(
        () => setTimeout(() => cb(null), 0),
        (err) => setTimeout(() => cb(err), 0)
      );
      return;
    }
    return this._cpAsync(src, dest, opts);
  }
  fdatasync(fd, callback) {
    this._validateCb(callback);
    try {
      this.fdatasyncSync(fd);
      if (callback) setTimeout(() => callback(null), 0);
    } catch (err) {
      if (callback) setTimeout(() => callback(err), 0);
      else throw err;
    }
  }
  fsync(fd, callback) {
    this._validateCb(callback);
    try {
      this.fsyncSync(fd);
      if (callback) setTimeout(() => callback(null), 0);
    } catch (err) {
      if (callback) setTimeout(() => callback(err), 0);
      else throw err;
    }
  }
  fstat(fd, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    try {
      const result = this.fstatSync(fd, opts);
      if (cb) setTimeout(() => cb(null, result), 0);
    } catch (err) {
      if (cb) setTimeout(() => cb(err), 0);
      else throw err;
    }
  }
  ftruncate(fd, lenOrCallback, callback) {
    const cb = typeof lenOrCallback === "function" ? lenOrCallback : callback;
    this._validateCb(cb);
    const len = typeof lenOrCallback === "function" ? 0 : lenOrCallback;
    try {
      this.ftruncateSync(fd, len);
      if (cb) setTimeout(() => cb(null), 0);
    } catch (err) {
      if (cb) setTimeout(() => cb(err), 0);
      else throw err;
    }
  }
  read(fd, buffer, offset, length, position, callback) {
    let cb;
    let buf;
    let off;
    let len;
    let pos;
    if (typeof buffer === "object" && !(buffer instanceof Uint8Array) && buffer !== null && "buffer" in buffer) {
      cb = offset;
      buf = buffer.buffer;
      off = buffer.offset ?? 0;
      len = buffer.length ?? buf.byteLength;
      pos = buffer.position ?? null;
    } else {
      cb = callback;
      buf = buffer;
      off = offset;
      len = length;
      pos = position;
    }
    this._validateCb(cb);
    try {
      const bytesRead = this.readSync(fd, buf, off, len, pos);
      if (cb) setTimeout(() => cb(null, bytesRead, buf), 0);
    } catch (err) {
      if (cb) setTimeout(() => cb(err), 0);
      else throw err;
    }
  }
  write(fd, bufferOrString, offsetOrPosition, lengthOrEncoding, position, callback) {
    const cb = [offsetOrPosition, lengthOrEncoding, position, callback].find((a) => typeof a === "function");
    this._validateCb(cb);
    try {
      let bytesWritten;
      if (typeof bufferOrString === "string") {
        const pos = typeof offsetOrPosition === "function" ? void 0 : offsetOrPosition;
        const enc2 = typeof lengthOrEncoding === "function" ? void 0 : lengthOrEncoding;
        bytesWritten = this.writeSync(fd, bufferOrString, pos, enc2);
      } else {
        const off = typeof offsetOrPosition === "function" ? void 0 : offsetOrPosition;
        const len = typeof lengthOrEncoding === "function" ? void 0 : lengthOrEncoding;
        const pos = typeof position === "function" ? void 0 : position;
        bytesWritten = this.writeSync(fd, bufferOrString, off, len, pos);
      }
      if (cb) setTimeout(() => cb(null, bytesWritten, bufferOrString), 0);
    } catch (err) {
      if (cb) setTimeout(() => cb(err), 0);
      else throw err;
    }
  }
  close(fd, callback) {
    try {
      this.closeSync(fd);
      if (callback) setTimeout(() => callback(null), 0);
    } catch (err) {
      if (callback) setTimeout(() => callback(err), 0);
      else throw err;
    }
  }
  exists(filePath, callback) {
    const p = this.promises.exists(filePath);
    if (typeof callback === "function") {
      p.then(
        (result) => setTimeout(() => callback(result), 0),
        () => setTimeout(() => callback(false), 0)
      );
      return;
    }
    return p;
  }
  opendir(filePath, callback) {
    this._validateCb(callback);
    toPathString(filePath);
    return this._cb(this.promises.opendir(filePath), callback);
  }
  glob(pattern, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    this._validateCb(cb);
    const opts = typeof optionsOrCallback === "function" ? void 0 : optionsOrCallback;
    return this._cb(glob(this._async, pattern, opts), cb);
  }
  futimes(fd, atime, mtime, callback) {
    this._validateCb(callback);
    return this._cbVoid(this.promises.futimes(fd, atime, mtime), callback);
  }
  fchmod(fd, mode, callback) {
    this._validateCb(callback);
    return this._cbVoid(this.promises.fchmod(fd, mode), callback);
  }
  fchown(fd, uid, gid, callback) {
    this._validateCb(callback);
    return this._cbVoid(this.promises.fchown(fd, uid, gid), callback);
  }
  lchmod(filePath, mode, callback) {
    this._validateCb(callback);
    toPathString(filePath);
    return this._cbVoid(this.promises.lchmod(filePath, mode), callback);
  }
  lchown(filePath, uid, gid, callback) {
    this._validateCb(callback);
    toPathString(filePath);
    return this._cbVoid(this.promises.lchown(filePath, uid, gid), callback);
  }
  lutimes(filePath, atime, mtime, callback) {
    this._validateCb(callback);
    toPathString(filePath);
    return this._cbVoid(this.promises.lutimes(filePath, atime, mtime), callback);
  }
};
var VFSPromises = class {
  _async;
  _ns;
  constructor(asyncRequest, ns) {
    this._async = asyncRequest;
    this._ns = ns;
  }
  /** Node.js compat: fs.promises.constants (same as fs.constants) */
  get constants() {
    return constants;
  }
  // Unlike the callback API, the promise API takes a **FileHandle** rather than a raw descriptor
  // in the path position — `fsPromises.readFile(fd)` is an ERR_INVALID_ARG_TYPE in Node, and
  // stays one here because `toPathString` rejects numbers.
  async readFile(filePath, options) {
    if (isFileHandle(filePath)) return filePath.readFile(options);
    return readFile(this._async, toPathString(filePath), options);
  }
  async writeFile(filePath, data, options) {
    if (isFileHandle(filePath)) return filePath.writeFile(data, options);
    return writeFile(this._async, toPathString(filePath), data, options);
  }
  async appendFile(filePath, data, options) {
    if (isFileHandle(filePath)) return filePath.appendFile(data, options);
    return appendFile(this._async, toPathString(filePath), data, options);
  }
  async mkdir(filePath, options) {
    return mkdir(this._async, toPathString(filePath), options);
  }
  async rmdir(filePath, options) {
    return rmdir(this._async, toPathString(filePath), options);
  }
  async rm(filePath, options) {
    return rm(this._async, toPathString(filePath), options);
  }
  async unlink(filePath) {
    return unlink(this._async, toPathString(filePath));
  }
  async readdir(filePath, options) {
    return readdir(this._async, toPathString(filePath), options);
  }
  /**
   * `fsPromises.glob` — an **async iterator** of matches, which is what node returns.
   *
   * This used to be `async glob(): Promise<string[]>`, so the documented way to consume it —
   * `for await (const p of fsp.glob(pattern))` — got a promise, which is not async-iterable, and
   * silently produced nothing. `await`ing it worked, which is why it looked fine: the shape was
   * only wrong for the usage node's own docs show.
   *
   * Matches are gathered before the first yield rather than streamed. Observably identical for a
   * consumer, and the engine answers a glob in one round trip, so there is nothing to stream.
   */
  async *glob(pattern, options) {
    const matches = await glob(this._async, pattern, options);
    for (const match of matches) yield match;
  }
  async stat(filePath, options) {
    return stat(this._async, toPathString(filePath), options);
  }
  async lstat(filePath, options) {
    return lstat(this._async, toPathString(filePath), options);
  }
  async access(filePath, mode) {
    return access(this._async, toPathString(filePath), mode);
  }
  async rename(oldPath, newPath) {
    return rename(this._async, toPathString(oldPath), toPathString(newPath));
  }
  async copyFile(src, dest, mode) {
    return copyFile(this._async, toPathString(src), toPathString(dest), mode);
  }
  async cp(src, dest, options) {
    assertCopyable(toPathString(src), toPathString(dest));
    return this._cpInner(src, dest, options);
  }
  /** The recursive worker; its destinations are legitimately inside the destination tree. */
  async _cpInner(src, dest, options) {
    const srcPath = toPathString(src);
    const destPath = toPathString(dest);
    if (options?.filter && !options.filter(srcPath, destPath)) return;
    const force = options?.force !== false;
    const errorOnExist = options?.errorOnExist ?? false;
    options?.dereference ?? false;
    const preserveTimestamps = options?.preserveTimestamps ?? false;
    const srcStat = await this.lstat(srcPath);
    if (srcStat.isDirectory()) {
      if (!options?.recursive) {
        throw cpEisdirNotRecursive(srcPath);
      }
      try {
        await this.mkdir(destPath, { recursive: true });
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      }
      const entries = await this.readdir(srcPath, { withFileTypes: true });
      for (const entry of entries) {
        const srcChild = join(srcPath, entry.name);
        const destChild = join(destPath, entry.name);
        await this._cpInner(srcChild, destChild, options);
      }
    } else if (srcStat.isSymbolicLink()) {
      const target = await this.readlink(srcPath);
      let destExists = false;
      try {
        await this.lstat(destPath);
        destExists = true;
      } catch {
      }
      if (destExists) {
        if (errorOnExist) throw cpTargetExists(destPath);
        if (!force) return;
        await this.unlink(destPath);
      }
      await this.symlink(target, destPath);
    } else {
      let destExists = false;
      try {
        await this.lstat(destPath);
        destExists = true;
      } catch {
      }
      if (destExists) {
        if (errorOnExist) throw cpTargetExists(destPath);
        if (!force) return;
      }
      await this.copyFile(srcPath, destPath, errorOnExist ? constants.COPYFILE_EXCL : 0);
    }
    if (preserveTimestamps) {
      const st = await this.stat(srcPath);
      await this.utimes(destPath, st.atime, st.mtime);
    }
  }
  async truncate(filePath, len) {
    return truncate(this._async, toPathString(filePath), len);
  }
  async realpath(filePath, options) {
    return realpath(this._async, toRealpathString(filePath), options);
  }
  async exists(filePath) {
    return exists(this._async, toPathString(filePath));
  }
  async chmod(filePath, mode) {
    return chmod(this._async, toPathString(filePath), mode);
  }
  /** `chmod` on the symlink itself — see {@link lchmodSync}. */
  async lchmod(filePath, mode) {
    return chmod(this._async, toPathString(filePath), mode, false);
  }
  /** chmod on an open file descriptor. Engine resolves fd → inode and
   *  mutates the mode bits directly. */
  async fchmod(fd, mode) {
    return fchmod(this._async, fd, mode);
  }
  async chown(filePath, uid, gid) {
    return chown(this._async, toPathString(filePath), uid, gid);
  }
  /** `chown` on the symlink itself rather than its target — see {@link lchmodSync}. */
  async lchown(filePath, uid, gid) {
    return chown(this._async, toPathString(filePath), uid, gid, false);
  }
  /** chown on an open file descriptor. Engine resolves fd → inode and
   *  mutates uid/gid directly. */
  async fchown(fd, uid, gid) {
    return fchown(this._async, fd, uid, gid);
  }
  async utimes(filePath, atime, mtime) {
    return utimes(this._async, toPathString(filePath), atime, mtime);
  }
  /** utimes on an open file descriptor. Engine resolves fd → inode and
   *  mutates atime/mtime directly. */
  async futimes(fd, atime, mtime) {
    return futimes(this._async, fd, atime, mtime);
  }
  /** Timestamps on the symlink itself rather than its target — see {@link lchmodSync}. */
  async lutimes(filePath, atime, mtime) {
    return utimes(this._async, toPathString(filePath), atime, mtime, false);
  }
  async symlink(target, linkPath, type) {
    return symlink(this._async, toPathString(target), toPathString(linkPath));
  }
  async readlink(filePath, options) {
    return readlink(this._async, toPathString(filePath), options);
  }
  async link(existingPath, newPath) {
    return link(this._async, toPathString(existingPath), toPathString(newPath));
  }
  async open(filePath, flags, mode) {
    return open(this._async, toPathString(filePath), flags, mode);
  }
  async opendir(filePath, options) {
    return opendir(this._async, toPathString(filePath), options);
  }
  /**
   * `mkdtemp` whose result cleans itself up — see `mkdtempDisposableSync`. Disposal is async
   * here (`await using`), so the symbol is `Symbol.asyncDispose` and `remove()` returns a promise.
   */
  async mkdtempDisposable(prefix) {
    const path = await mkdtemp(this._async, prefix);
    const remove = () => this.rm(path, { recursive: true, force: true });
    return { path, remove, [Symbol.asyncDispose]: remove };
  }
  async mkdtemp(prefix, options) {
    return mkdtemp(this._async, toPathString(prefix), options);
  }
  async openAsBlob(filePath, options) {
    const data = await _readFileAsBlobBytes(this.readFile(filePath));
    return new Blob([data], { type: options?.type ?? "" });
  }
  /** Real volume statistics — see the note on `VFSFileSystem.statfsSync`. */
  async statfs(path = "/", options) {
    return statfs(this._async, toPathString(path), options);
  }
  async *watch(filePath, options) {
    yield* watchAsync(this._ns, this._async, filePath, options);
  }
  async fstat(fd, options) {
    const { status, data } = await this._async(OP.FSTAT, "", 0, null, void 0, { fd });
    if (status !== 0) throw statusToError(status, "fstat", String(fd));
    return options?.bigint ? decodeStatsBigInt(data) : decodeStats(data);
  }
  async ftruncate(fd, len = 0) {
    const { status } = await this._async(OP.FTRUNCATE, "", 0, null, void 0, { fd, length: len });
    if (status !== 0) throw statusToError(status, "ftruncate", String(fd));
  }
  async fsync(fd) {
    const { status } = await this._async(OP.FSYNC, "", 0, null, void 0, { fd });
    if (status !== 0) throw statusToError(status, "fsync", String(fd));
  }
  async fdatasync(fd) {
    const { status } = await this._async(OP.FSYNC, "", 0, null, void 0, { fd });
    if (status !== 0) throw statusToError(status, "fdatasync", String(fd));
  }
  /** The volume-wide flush: no descriptor, so nothing to validate. */
  async flush() {
    await this._async(OP.FSYNC, "");
  }
  async purge() {
  }
};

// src/sw-bridge.ts
function createServiceWorkerBridge(bridgePort, opts) {
  let regPromise = null;
  const resolveSW = () => {
    if (regPromise) return regPromise;
    regPromise = (async () => {
      const swUrl = opts.swUrl ? new URL(opts.swUrl, document.baseURI) : new URL("./workers/service.worker.js", import.meta.url);
      const scope = opts.swScope ?? new URL(`./${opts.ns}/`, swUrl).href;
      const reg = await navigator.serviceWorker.register(swUrl.href, { scope });
      if (reg.active) return reg.active;
      const sw = reg.installing || reg.waiting;
      if (!sw) throw new Error("No service worker found");
      await new Promise((resolve2, reject) => {
        const timer = setTimeout(() => {
          sw.removeEventListener("statechange", onState);
          reject(new Error("Service worker activation timeout"));
        }, 5e3);
        const onState = () => {
          if (sw.state === "activated") {
            clearTimeout(timer);
            sw.removeEventListener("statechange", onState);
            resolve2();
          } else if (sw.state === "redundant") {
            clearTimeout(timer);
            sw.removeEventListener("statechange", onState);
            reject(new Error("SW redundant"));
          }
        };
        sw.addEventListener("statechange", onState);
        onState();
      });
      return reg.active;
    })();
    return regPromise;
  };
  const onMessage = (event) => {
    const transfer = event.ports.length ? Array.from(event.ports) : void 0;
    resolveSW().then((sw) => sw.postMessage(event.data, transfer)).catch((err) => console.error("[VFS sw-bridge] forward failed:", err.message));
  };
  bridgePort.addEventListener("message", onMessage);
  bridgePort.start();
  return () => {
    bridgePort.removeEventListener("message", onMessage);
    bridgePort.close();
  };
}

// src/workers/inlined/repair.workertext
var repair_default = 'var V=1447449377,G=1,U=4096,P=1e5,T=64,b={SIZE:64,MAGIC:0,VERSION:4,INODE_COUNT:8,BLOCK_SIZE:12,TOTAL_BLOCKS:16,FREE_BLOCKS:20,INODE_OFFSET:24,PATH_OFFSET:32,DATA_OFFSET:40,BITMAP_OFFSET:48,PATH_USED:56,CRC32:60},p={TYPE:0,FLAGS:1,PATH_OFFSET:4,PATH_LENGTH:8,NLINK:10,MODE:12,SIZE:16,FIRST_BLOCK:24,BLOCK_COUNT:28,MTIME:32,CTIME:40,ATIME:48,UID:56,GID:60},f={FREE:0,FILE:1,DIRECTORY:2,SYMLINK:3},It=33188,rt=16877,pt=41471,ot=18,at=61440,bt=32768,wt=16384,W=40,lt=256*1024,L=1024,ct=4e6;function X(S=P,t=U,e=L,s=ct){const i=b.SIZE,n=S*T,r=i+n,o=lt,l=r+o,h=Math.ceil(s/8),c=Math.ceil(e/8),a=Math.ceil((l+h)/t)*t,d=a+e*t;return{inodeTableOffset:i,inodeTableSize:n,pathTableOffset:r,pathTableSize:o,bitmapOffset:l,bitmapSize:c,bitmapRegionSize:h,dataOffset:a,totalSize:d,totalBlocks:e}}var gt=(()=>{const S=new Uint32Array(256);for(let t=0;t<256;t++){let e=t;for(let s=0;s<8;s++)e=e&1?3988292384^e>>>1:e>>>1;S[t]=e>>>0}return S})();function j(S,t=0,e=S.byteLength){let s=4294967295;for(let i=t;i<e;i++)s=gt[(s^S[i])&255]^s>>>8;return(s^4294967295)>>>0}var I={OK:0,ENOENT:1,EEXIST:2,EISDIR:3,ENOTDIR:4,ENOTEMPTY:5,EACCES:6,EINVAL:7,EBADF:8,ELOOP:9,ENOSPC:10,EIO:11,ENOTSUP:12},R=new TextEncoder,J=16384,$=new TextDecoder,Q=class H{handle;pathIndex=new Map;inodeCount=0;blockSize=U;totalBlocks=0;freeBlocks=0;inodeTableOffset=0;pathTableOffset=0;pathTableUsed=0;pathTableSize=0;bitmapOffset=0;dataOffset=0;umask=ot;processUid=0;processGid=0;strictPermissions=!1;debug=!1;fdTable=new Map;nextFd=3;static isReadable(t){const e=t&3;return e===0||e===2}static isWritable(t){const e=t&3;return e===1||e===2}inodeBuf=new Uint8Array(T);inodeView=new DataView(this.inodeBuf.buffer);inodeCache=new Map;superblockBuf=new Uint8Array(b.SIZE);superblockView=new DataView(this.superblockBuf.buffer);bitmap=null;bitmapDirtyLo=1/0;bitmapDirtyHi=-1;superblockDirty=!1;freeInodeHint=0;implicitDirs=new Map;implicitDirsGen=-1;pathIndexGen=0;descCount=new Map;descCountGen=0;childIndex=new Map;childIndexGen=0;allocCursor=0;symlinkLoopDetected=!1;resolveFailureStatus(){return this.symlinkLoopDetected?I.ELOOP:I.ENOENT}maxInodes=4e6;maxBlocks=ct;maxPathTable=256*1024*1024;maxVFSSize=100*1024*1024*1024;init(t,e){if(this.handle=t,this.processUid=e?.uid??0,this.processGid=e?.gid??0,this.umask=e?.umask??ot,this.strictPermissions=e?.strictPermissions??!1,this.debug=e?.debug??!1,e?.limits&&(e.limits.maxInodes!=null&&(this.maxInodes=e.limits.maxInodes),e.limits.maxBlocks!=null&&(this.maxBlocks=e.limits.maxBlocks),e.limits.maxPathTable!=null&&(this.maxPathTable=e.limits.maxPathTable),e.limits.maxVFSSize!=null&&(this.maxVFSSize=e.limits.maxVFSSize)),t.getSize()===0)this.format();else try{this.mount()}catch(i){const n=i.message??String(i);throw n.startsWith("Corrupt VFS:")?i:new Error(`Corrupt VFS: ${n}`)}}closeHandle(){try{this.handle?.close()}catch{}}format(){const t=X(P,U,L,this.maxBlocks);this.inodeCount=P,this.blockSize=U,this.totalBlocks=t.totalBlocks,this.freeBlocks=t.totalBlocks,this.inodeTableOffset=t.inodeTableOffset,this.pathTableOffset=t.pathTableOffset,this.pathTableSize=t.pathTableSize,this.pathTableUsed=0,this.bitmapOffset=t.bitmapOffset,this.dataOffset=t.dataOffset,this.handle.truncate(t.totalSize),this.writeSuperblock();const e=new Uint8Array(t.inodeTableSize);this.handle.write(e,{at:this.inodeTableOffset}),this.bitmap=new Uint8Array(t.bitmapSize),this.handle.write(this.bitmap,{at:this.bitmapOffset}),this.createInode("/",f.DIRECTORY,rt,0),this.writeSuperblock(),this.handle.flush()}mount(){const t=this.handle.getSize();if(t<b.SIZE)throw new Error(`Corrupt VFS: file too small (${t} bytes, need at least ${b.SIZE})`);this.handle.read(this.superblockBuf,{at:0});const e=this.superblockView,s=e.getUint32(b.MAGIC,!0);if(s!==V)throw new Error(`Corrupt VFS: bad magic 0x${s.toString(16)} (expected 0x${V.toString(16)})`);const i=e.getUint32(b.VERSION,!0);if(i!==G)throw new Error(`Corrupt VFS: unsupported version ${i} (expected ${G})`);const n=e.getUint32(b.CRC32,!0);if(n!==0){const O=j(this.superblockBuf,0,b.CRC32);if(O!==n)throw new Error(`Corrupt VFS: superblock checksum mismatch (stored 0x${n.toString(16)}, computed 0x${O.toString(16)})`)}const r=e.getUint32(b.INODE_COUNT,!0),o=e.getUint32(b.BLOCK_SIZE,!0),l=e.getUint32(b.TOTAL_BLOCKS,!0),h=e.getUint32(b.FREE_BLOCKS,!0),c=e.getFloat64(b.INODE_OFFSET,!0),a=e.getFloat64(b.PATH_OFFSET,!0),d=e.getFloat64(b.DATA_OFFSET,!0),u=e.getFloat64(b.BITMAP_OFFSET,!0),m=e.getUint32(b.PATH_USED,!0);if(o===0||(o&o-1)!==0)throw new Error(`Corrupt VFS: invalid block size ${o} (must be power of 2)`);if(r===0)throw new Error("Corrupt VFS: inode count is 0");if(h>l)throw new Error(`Corrupt VFS: free blocks (${h}) exceeds total blocks (${l})`);if(r>this.maxInodes)throw new Error(`Corrupt VFS: inode count ${r} exceeds maximum ${this.maxInodes}`);if(l>this.maxBlocks)throw new Error(`Corrupt VFS: total blocks ${l} exceeds maximum ${this.maxBlocks}`);if(t>this.maxVFSSize)throw new Error(`Corrupt VFS: file size ${t} exceeds maximum ${this.maxVFSSize}`);if(!Number.isFinite(c)||c<0||!Number.isFinite(a)||a<0||!Number.isFinite(u)||u<0||!Number.isFinite(d)||d<0)throw new Error("Corrupt VFS: non-finite or negative section offset");if(c!==b.SIZE)throw new Error(`Corrupt VFS: inode table offset ${c} (expected ${b.SIZE})`);const w=c+r*T;if(a!==w)throw new Error(`Corrupt VFS: path table offset ${a} (expected ${w})`);if(u<=a)throw new Error(`Corrupt VFS: bitmap offset ${u} must be after path table ${a}`);if(d<=u)throw new Error(`Corrupt VFS: data offset ${d} must be after bitmap ${u}`);if(l>(d-u)*8)throw new Error(`Corrupt VFS: total blocks (${l}) exceed bitmap region capacity (${(d-u)*8})`);const E=u-a;if(m>E)throw new Error(`Corrupt VFS: path used (${m}) exceeds path table size (${E})`);if(E>this.maxPathTable)throw new Error(`Corrupt VFS: path table size ${E} exceeds maximum ${this.maxPathTable}`);const y=d+l*o;if(y>this.maxVFSSize)throw new Error(`Corrupt VFS: computed layout size ${y} exceeds maximum ${this.maxVFSSize}`);if(t<y)throw new Error(`Corrupt VFS: file size ${t} too small for layout (need ${y})`);this.inodeCount=r,this.blockSize=o,this.totalBlocks=l,this.freeBlocks=h,this.inodeTableOffset=c,this.pathTableOffset=a,this.dataOffset=d,this.bitmapOffset=u,this.pathTableUsed=m,this.pathTableSize=E;const C=Math.ceil(this.totalBlocks/8);if(this.bitmap=new Uint8Array(C),this.handle.read(this.bitmap,{at:this.bitmapOffset}),this.rebuildIndex(),!this.pathIndex.has("/"))throw new Error(\'Corrupt VFS: root directory "/" not found in inode table\')}writeSuperblock(){const t=this.superblockView;t.setUint32(b.MAGIC,V,!0),t.setUint32(b.VERSION,G,!0),t.setUint32(b.INODE_COUNT,this.inodeCount,!0),t.setUint32(b.BLOCK_SIZE,this.blockSize,!0),t.setUint32(b.TOTAL_BLOCKS,this.totalBlocks,!0),t.setUint32(b.FREE_BLOCKS,this.freeBlocks,!0),t.setFloat64(b.INODE_OFFSET,this.inodeTableOffset,!0),t.setFloat64(b.PATH_OFFSET,this.pathTableOffset,!0),t.setFloat64(b.DATA_OFFSET,this.dataOffset,!0),t.setFloat64(b.BITMAP_OFFSET,this.bitmapOffset,!0),t.setUint32(b.PATH_USED,this.pathTableUsed,!0),t.setUint32(b.CRC32,j(this.superblockBuf,0,b.CRC32),!0),this.handle.write(this.superblockBuf,{at:0})}markBitmapDirty(t,e){t<this.bitmapDirtyLo&&(this.bitmapDirtyLo=t),e>this.bitmapDirtyHi&&(this.bitmapDirtyHi=e)}commitPending(){if(this.blocksFreedsinceTrim&&(this.trimTrailingBlocks(),this.blocksFreedsinceTrim=!1),this.bitmapDirtyHi>=0){const t=this.bitmapDirtyLo,e=this.bitmapDirtyHi;this.handle.write(this.bitmap.subarray(t,e+1),{at:this.bitmapOffset+t}),this.bitmapDirtyLo=1/0,this.bitmapDirtyHi=-1}this.superblockDirty&&(this.writeSuperblock(),this.superblockDirty=!1)}findLastUsedBlock(){const t=this.bitmap;for(let e=Math.ceil(this.totalBlocks/8)-1;e>=0;e--)if(t[e]!==0)for(let s=7;s>=0;s--){const i=e*8+s;if(i<this.totalBlocks&&t[e]&1<<s)return i}return-1}trimTrailingBlocks(){const t=this.findLastUsedBlock(),e=Math.max(t+1+J,L);if(e>=this.totalBlocks)return;this.handle.truncate(this.dataOffset+e*this.blockSize);const s=Math.ceil(e/8);this.bitmap=this.bitmap.slice(0,s);const i=this.totalBlocks-e;this.freeBlocks-=i,this.totalBlocks=e,this.superblockDirty=!0,this.bitmapDirtyLo=0,this.bitmapDirtyHi=s-1}lastPreGrowCheck=0;maybePreGrow(t=!1){if(!this.bitmap)return!1;const e=Date.now();if(!t&&e-this.lastPreGrowCheck<250)return!1;this.lastPreGrowCheck=e;const s=this.totalBlocks-(this.findLastUsedBlock()+1);if(s>=J)return!1;const i=Math.min(this.maxBlocks,this.bitmapCapacityBlocks()),n=Math.ceil((J-s)/8)*8,r=Math.min(n,i-this.totalBlocks);if(r<=0)return!1;const o=this.totalBlocks+r;this.handle.truncate(this.dataOffset+o*this.blockSize);const l=Math.ceil(o/8);if(l>this.bitmap.byteLength){const h=new Uint8Array(l);h.set(this.bitmap),this.bitmap=h}return this.totalBlocks=o,this.freeBlocks+=r,this.superblockDirty=!0,this.commitPending(),!0}rebuildIndex(){this.pathIndex.clear(),this.inodeCache.clear();const t=this.inodeCount*T,e=new Uint8Array(t);this.handle.read(e,{at:this.inodeTableOffset});const s=new DataView(e.buffer),i=this.pathTableUsed>0?new Uint8Array(this.pathTableUsed):null;i&&this.handle.read(i,{at:this.pathTableOffset});for(let n=0;n<this.inodeCount;n++){const r=n*T,o=s.getUint8(r+p.TYPE);if(o===f.FREE)continue;if(o<f.FILE||o>f.SYMLINK)throw new Error(`Corrupt VFS: inode ${n} has invalid type ${o}`);const l=s.getUint32(r+p.PATH_OFFSET,!0),h=s.getUint16(r+p.PATH_LENGTH,!0),c=s.getFloat64(r+p.SIZE,!0),a=s.getUint32(r+p.FIRST_BLOCK,!0),d=s.getUint32(r+p.BLOCK_COUNT,!0);if(h===0||l+h>this.pathTableUsed)throw new Error(`Corrupt VFS: inode ${n} path out of bounds (offset=${l}, len=${h}, tableUsed=${this.pathTableUsed})`);if(o!==f.DIRECTORY){if(c<0||!isFinite(c))throw new Error(`Corrupt VFS: inode ${n} has invalid size ${c}`);if(d>0&&a+d>this.totalBlocks)throw new Error(`Corrupt VFS: inode ${n} data blocks out of range (first=${a}, count=${d}, total=${this.totalBlocks})`)}const u={type:o,pathOffset:l,pathLength:h,nlink:s.getUint16(r+p.NLINK,!0)||1,mode:s.getUint32(r+p.MODE,!0),size:c,firstBlock:a,blockCount:d,mtime:s.getFloat64(r+p.MTIME,!0),ctime:s.getFloat64(r+p.CTIME,!0),atime:s.getFloat64(r+p.ATIME,!0),uid:s.getUint32(r+p.UID,!0),gid:s.getUint32(r+p.GID,!0)};this.inodeCache.set(n,u);let m;if(i?m=$.decode(i.subarray(u.pathOffset,u.pathOffset+u.pathLength)):m=this.readPath(u.pathOffset,u.pathLength),!m.startsWith("/")||m.includes("\\0"))throw new Error(`Corrupt VFS: inode ${n} has invalid path "${m.substring(0,50)}"`);this.setPathIndex(m,n)}this.pathIndexGen++}readInode(t){const e=this.inodeCache.get(t);if(e)return e;const s=this.inodeTableOffset+t*T;this.handle.read(this.inodeBuf,{at:s});const i=this.inodeView,n={type:i.getUint8(p.TYPE),pathOffset:i.getUint32(p.PATH_OFFSET,!0),pathLength:i.getUint16(p.PATH_LENGTH,!0),nlink:i.getUint16(p.NLINK,!0)||1,mode:i.getUint32(p.MODE,!0),size:i.getFloat64(p.SIZE,!0),firstBlock:i.getUint32(p.FIRST_BLOCK,!0),blockCount:i.getUint32(p.BLOCK_COUNT,!0),mtime:i.getFloat64(p.MTIME,!0),ctime:i.getFloat64(p.CTIME,!0),atime:i.getFloat64(p.ATIME,!0),uid:i.getUint32(p.UID,!0),gid:i.getUint32(p.GID,!0)};return this.inodeCache.set(t,n),n}writeInode(t,e){e.type===f.FREE?this.inodeCache.delete(t):this.inodeCache.set(t,e);const s=this.inodeView;s.setUint8(p.TYPE,e.type),s.setUint8(p.FLAGS,0),s.setUint8(p.FLAGS+1,0),s.setUint8(p.FLAGS+2,0),s.setUint32(p.PATH_OFFSET,e.pathOffset,!0),s.setUint16(p.PATH_LENGTH,e.pathLength,!0),s.setUint16(p.NLINK,e.nlink,!0),s.setUint32(p.MODE,e.mode,!0),s.setFloat64(p.SIZE,e.size,!0),s.setUint32(p.FIRST_BLOCK,e.firstBlock,!0),s.setUint32(p.BLOCK_COUNT,e.blockCount,!0),s.setFloat64(p.MTIME,e.mtime,!0),s.setFloat64(p.CTIME,e.ctime,!0),s.setFloat64(p.ATIME,e.atime,!0),s.setUint32(p.UID,e.uid,!0),s.setUint32(p.GID,e.gid,!0);const i=this.inodeTableOffset+t*T;this.handle.write(this.inodeBuf,{at:i})}readPath(t,e){const s=new Uint8Array(e);return this.handle.read(s,{at:this.pathTableOffset+t}),$.decode(s)}appendPath(t){const e=R.encode(t),s=this.pathTableUsed;return s+e.byteLength>this.pathTableSize&&this.growPathTable(s+e.byteLength),this.handle.write(e,{at:this.pathTableOffset+s}),this.pathTableUsed+=e.byteLength,this.superblockDirty=!0,{offset:s,length:e.byteLength}}growPathTable(t){const e=Math.max(this.pathTableSize*2,t+lt),s=e-this.pathTableSize,i=this.handle.getSize()+s;this.handle.truncate(i);const n=this.totalBlocks*this.blockSize,r=4*1024*1024,o=new Uint8Array(Math.min(r,Math.max(n,1)));let l=n;for(;l>0;){const a=Math.min(l,r),d=this.dataOffset+(l-a),u=this.dataOffset+s+(l-a),m=a<o.length?o.subarray(0,a):o;this.handle.read(m,{at:d}),this.handle.write(m,{at:u}),l-=a}const h=this.bitmapOffset+s,c=this.dataOffset+s;this.handle.write(this.bitmap,{at:h}),this.pathTableSize=e,this.bitmapOffset=h,this.dataOffset=c,this.superblockDirty=!0}zeroFileRange(t,e){if(e<=0)return;const s=4*1024*1024,i=new Uint8Array(Math.min(e,s));let n=0;for(;n<e;){const r=Math.min(s,e-n),o=r<i.length?i.subarray(0,r):i;this.handle.write(o,{at:t+n}),n+=r}}allocateBlocks(t){if(t===0)return 0;let e=this.scanForRun(this.allocCursor,this.totalBlocks,t);if(e<0&&this.allocCursor>0){const n=Math.min(this.allocCursor+t-1,this.totalBlocks);e=this.scanForRun(0,n,t)}if(e<0)return this.growAndAllocate(t);const s=e+t-1,i=this.bitmap;for(let n=e;n<=s;n++)i[n>>>3]|=1<<(n&7);return this.markBitmapDirty(e>>>3,s>>>3),this.freeBlocks-=t,this.superblockDirty=!0,this.allocCursor=s+1>=this.totalBlocks?0:s+1,e}scanForRun(t,e,s){const i=this.bitmap;let n=0,r=t;for(let o=t;o<e;o++){if(n===0&&(o&7)===0&&i[o>>>3]===255){o+=7,r=o+1;continue}if(i[o>>>3]>>>(o&7)&1)n=0,r=o+1;else if(++n===s)return r}return-1}bitmapCapacityBlocks(){return(this.dataOffset-this.bitmapOffset)*8}growAndAllocate(t){const e=this.totalBlocks,s=Math.min(this.maxBlocks,this.bitmapCapacityBlocks());let i=Math.max(e*2,e+t);if(i>s&&(i=s),i<e+t)throw new Error(`ENOSPC: cannot allocate ${t} blocks (total ${e}, ceiling ${s})`);const n=i-e,r=this.dataOffset+i*this.blockSize;this.handle.truncate(r);const o=Math.ceil(i/8),l=new Uint8Array(o);l.set(this.bitmap),this.bitmap=l,this.totalBlocks=i,this.freeBlocks+=n;const h=e;for(let c=h;c<h+t;c++){const a=c>>>3,d=c&7;this.bitmap[a]|=1<<d}return this.markBitmapDirty(h>>>3,h+t-1>>>3),this.freeBlocks-=t,this.superblockDirty=!0,h}blocksFreedsinceTrim=!1;freeBlockRange(t,e){if(e===0)return;const s=this.bitmap;for(let i=t;i<t+e;i++){const n=i>>>3,r=i&7;s[n]&=~(1<<r)}this.markBitmapDirty(t>>>3,t+e-1>>>3),this.freeBlocks+=e,this.superblockDirty=!0,this.blocksFreedsinceTrim=!0}findFreeInode(){for(let e=this.freeInodeHint;e<this.inodeCount;e++){if(this.inodeCache.has(e))continue;const s=this.inodeTableOffset+e*T,i=new Uint8Array(1);if(this.handle.read(i,{at:s}),i[0]===f.FREE)return this.freeInodeHint=e+1,e}const t=this.growInodeTable();return this.freeInodeHint=t+1,t}growInodeTable(){const t=this.inodeCount,e=t*2,s=(e-t)*T,i=this.inodeTableOffset+t*T,n=this.handle.getSize(),r=n-i;this.handle.truncate(n+s);const o=8*1024*1024;if(r>0){const a=new Uint8Array(Math.min(o,r));let d=r;for(;d>0;){const u=Math.min(o,d),m=i+d-u,w=u===a.length?a:a.subarray(0,u);this.handle.read(w,{at:m}),this.handle.write(w,{at:m+s}),d-=u}}const l=new Uint8Array(Math.min(o,s));let h=s,c=i;for(;h>0;){const a=Math.min(o,h);this.handle.write(a===l.length?l:l.subarray(0,a),{at:c}),c+=a,h-=a}return this.pathTableOffset+=s,this.bitmapOffset+=s,this.dataOffset+=s,this.inodeCount=e,this.superblockDirty=!0,t}readData(t,e,s){const i=new Uint8Array(s),n=this.dataOffset+t*this.blockSize;return this.handle.read(i,{at:n}),i}writeData(t,e){const s=this.dataOffset+t*this.blockSize;this.handle.write(e,{at:s})}resolvePath(t,e=0){if(e===0&&(this.symlinkLoopDetected=!1),e>W){this.symlinkLoopDetected=!0;return}const s=this.pathIndex.get(t);if(s===void 0)return this.resolvePathComponents(t,!0,e);const i=this.readInode(s);if(i.type===f.SYMLINK){const n=$.decode(this.readData(i.firstBlock,i.blockCount,i.size)),r=n.startsWith("/")?n:this.resolveRelative(t,n);return this.resolvePath(r,e+1)}return s}resolvePathComponents(t,e=!0,s=0){return this.resolvePathFull(t,e,s)?.idx}resolvePathFull(t,e=!0,s=0){if(s===0&&(this.symlinkLoopDetected=!1),s>W){this.symlinkLoopDetected=!0;return}const i=t.split("/").filter(Boolean);let n="/";for(let o=0;o<i.length;o++){const l=o===i.length-1;n=n==="/"?"/"+i[o]:n+"/"+i[o];const h=this.pathIndex.get(n);if(h===void 0)return;const c=this.readInode(h);if(c.type===f.SYMLINK&&(!l||e)){const a=$.decode(this.readData(c.firstBlock,c.blockCount,c.size)),d=a.startsWith("/")?a:this.resolveRelative(n,a);if(l)return this.resolvePathFull(d,!0,s+1);const u=i.slice(o+1).join("/"),m=d+(u?"/"+u:"");return this.resolvePathFull(m,e,s+1)}}const r=this.pathIndex.get(n);if(r!==void 0)return{idx:r,resolvedPath:n}}resolveDanglingLink(t,e=0){if(e>W)return null;const s=this.pathIndex.get(t);if(s===void 0)return t;const i=this.readInode(s);if(i.type!==f.SYMLINK)return t;const n=$.decode(this.readData(i.firstBlock,i.blockCount,i.size)),r=n.startsWith("/")?n:this.resolveRelative(t,n);return this.resolveDanglingLink(r,e+1)}resolveRelative(t,e){const i=((t.substring(0,t.lastIndexOf("/"))||"/")+"/"+e).split("/").filter(Boolean),n=[];for(const r of i)if(r!=="."){if(r===".."){n.pop();continue}n.push(r)}return"/"+n.join("/")}createInode(t,e,s,i,n){const r=this.findFreeInode(),{offset:o,length:l}=this.appendPath(t),h=Date.now();let c=0,a=0;n&&n.byteLength>0&&(a=Math.ceil(n.byteLength/this.blockSize),c=this.allocateBlocks(a),this.writeData(c,n));const d={type:e,pathOffset:o,pathLength:l,nlink:e===f.DIRECTORY?2:1,mode:s,size:i,firstBlock:c,blockCount:a,mtime:h,ctime:h,atime:h,uid:this.processUid,gid:this.processGid};return this.writeInode(r,d),this.setPathIndex(t,r),this.pathIndexGen++,r}normalizePath(t){if(t.charCodeAt(0)!==47&&(t="/"+t),t.length===1||t.indexOf("/.")===-1&&t.indexOf("//")===-1&&t.charCodeAt(t.length-1)!==47)return t;const e=t.split("/").filter(Boolean),s=[];for(const i of e)if(i!=="."){if(i===".."){s.pop();continue}s.push(i)}return"/"+s.join("/")}read(t){const e=this.debug?performance.now():0;t=this.normalizePath(t);let s=this.pathIndex.get(t);if(s!==void 0){const r=this.inodeCache.get(s);if(r)if(r.type===f.SYMLINK)s=this.resolvePathComponents(t,!0);else{if(r.type===f.DIRECTORY)return{status:I.EISDIR,data:null};{const o=r.size>0?this.readData(r.firstBlock,r.blockCount,r.size):new Uint8Array(0);if(this.debug){const l=performance.now();console.log(`[VFS read] path=${t} size=${r.size} TOTAL=${(l-e).toFixed(3)}ms (fast)`)}return{status:0,data:o}}}}if(s===void 0&&(s=this.resolvePathComponents(t,!0)),s===void 0)return{status:this.resolveFailureStatus(),data:null};const i=this.readInode(s);if(i.type===f.DIRECTORY)return{status:I.EISDIR,data:null};const n=i.size>0?this.readData(i.firstBlock,i.blockCount,i.size):new Uint8Array(0);if(this.debug){const r=performance.now();console.log(`[VFS read] path=${t} size=${i.size} TOTAL=${(r-e).toFixed(3)}ms (slow path)`)}return{status:0,data:n}}write(t,e,s=0){const i=this.debug?performance.now():0;t=this.normalizePath(t);const n=this.debug?performance.now():0,r=this.ensureParent(t);if(r!==0)return{status:r};const o=this.debug?performance.now():0;let l=this.resolvePathComponents(t,!0);if(l===void 0){const m=this.resolveDanglingLink(t);if(m===null)return{status:I.ELOOP};if(m!==t){t=m;const w=this.ensureParent(t);if(w!==0)return{status:w};l=this.resolvePathComponents(t,!0)}}const h=this.debug?performance.now():0;let c=h,a=h,d=h;if(l!==void 0){const m=this.readInode(l);if(m.type===f.DIRECTORY)return{status:I.EISDIR};const w=Math.ceil(e.byteLength/this.blockSize);if(w<=m.blockCount)c=this.debug?performance.now():0,this.writeData(m.firstBlock,e),a=this.debug?performance.now():0,w<m.blockCount&&this.freeBlockRange(m.firstBlock+w,m.blockCount-w);else{this.freeBlockRange(m.firstBlock,m.blockCount);const E=this.allocateBlocks(w);c=this.debug?performance.now():0,this.writeData(E,e),a=this.debug?performance.now():0,m.firstBlock=E}m.size=e.byteLength,m.blockCount=w,m.mtime=Date.now(),this.writeInode(l,m),d=this.debug?performance.now():0}else{if(this.isImplicitDirectory(t))return{status:I.EISDIR};const m=It&~(this.umask&511);this.createInode(t,f.FILE,m,e.byteLength,e),c=this.debug?performance.now():0,a=c,d=c}this.commitPending(),s&1&&this.handle.flush();const u=this.debug?performance.now():0;if(this.debug){const m=l!==void 0;console.log(`[VFS write] path=${t} size=${e.byteLength} ${m?"UPDATE":"CREATE"} normalize=${(n-i).toFixed(3)}ms parent=${(o-n).toFixed(3)}ms resolve=${(h-o).toFixed(3)}ms alloc=${(c-h).toFixed(3)}ms data=${(a-c).toFixed(3)}ms inode=${(d-a).toFixed(3)}ms flush=${(u-d).toFixed(3)}ms TOTAL=${(u-i).toFixed(3)}ms`)}return{status:0}}append(t,e){t=this.normalizePath(t);const s=this.resolvePathComponents(t,!0);if(s===void 0)return this.write(t,e);const i=this.readInode(s);if(i.type===f.DIRECTORY)return{status:I.EISDIR};const n=i.size+e.byteLength,r=Math.ceil(n/this.blockSize);if(r<=i.blockCount)return this.handle.write(e,{at:this.dataOffset+i.firstBlock*this.blockSize+i.size}),i.size=n,i.mtime=Date.now(),this.writeInode(s,i),this.commitPending(),{status:0};const o=this.allocateBlocks(r),l=this.dataOffset+o*this.blockSize;if(i.size>0){const h=this.dataOffset+i.firstBlock*this.blockSize,c=4*1024*1024,a=new Uint8Array(Math.min(c,i.size));let d=0;for(;d<i.size;){const u=Math.min(c,i.size-d),m=u<a.length?a.subarray(0,u):a;this.handle.read(m,{at:h+d}),this.handle.write(m,{at:l+d}),d+=u}}return this.freeBlockRange(i.firstBlock,i.blockCount),this.handle.write(e,{at:l+i.size}),i.firstBlock=o,i.blockCount=r,i.size=n,i.mtime=Date.now(),this.writeInode(s,i),this.commitPending(),{status:0}}unlink(t){t=this.normalizePath(t);const e=this.pathIndex.get(t);if(e===void 0)return{status:I.ENOENT};const s=this.readInode(e);return s.type===f.DIRECTORY?{status:I.EISDIR}:(s.nlink=Math.max(0,s.nlink-1),this.freeBlockRange(s.firstBlock,s.blockCount),s.type=f.FREE,this.writeInode(e,s),this.deletePathIndex(t),this.pathIndexGen++,e<this.freeInodeHint&&(this.freeInodeHint=e),this.commitPending(),{status:0})}stat(t){t=this.normalizePath(t);const e=this.resolvePathComponents(t,!0);if(e===void 0){const s=this.resolveFailureStatus();return this.isImplicitDirectory(t)?this.encodeImplicitDirStatResponse(t):{status:s,data:null}}return this.encodeStatResponse(e)}lstat(t){t=this.normalizePath(t);let e=this.resolvePathComponents(t,!1);return e===void 0&&(e=this.resolvePathComponents(t,!0),e===void 0)?this.isImplicitDirectory(t)?this.encodeImplicitDirStatResponse(t):{status:I.ENOENT,data:null}:this.encodeStatResponse(e)}encodeStatResponse(t){const e=this.readInode(t);let s=e.nlink;e.type===f.DIRECTORY&&(s=2+this.countSubdirectories(this.readPath(e.pathOffset,e.pathLength)));const i=new Uint8Array(53),n=new DataView(i.buffer);return n.setUint8(0,e.type),n.setUint32(1,e.mode,!0),n.setFloat64(5,e.size,!0),n.setFloat64(13,e.mtime,!0),n.setFloat64(21,e.ctime,!0),n.setFloat64(29,e.atime,!0),n.setUint32(37,e.uid,!0),n.setUint32(41,e.gid,!0),n.setUint32(45,t,!0),n.setUint32(49,s,!0),{status:0,data:i}}mkdir(t,e=0,s=511){if(t=this.normalizePath(t),(e&1)!==0)return this.mkdirRecursive(t,s);if(this.pathIndex.has(t)||this.isImplicitDirectory(t))return{status:I.EEXIST,data:null};const n=this.ensureParent(t);return n!==0?{status:n,data:null}:(this.createInode(t,f.DIRECTORY,this.dirModeFor(s),0),this.commitPending(),{status:0,data:null})}dirModeFor(t){return wt|t&4095&~(this.umask&511)}fileModeFor(t){return bt|t&4095&~(this.umask&511)}mkdirRecursive(t,e=511){const s=t.split("/").filter(Boolean);let i="",n=null;for(const o of s){if(i+="/"+o,this.pathIndex.has(i)){const l=this.pathIndex.get(i);if(this.readInode(l).type!==f.DIRECTORY)return{status:I.ENOTDIR,data:null};continue}this.createInode(i,f.DIRECTORY,this.dirModeFor(e),0),n||(n=i)}return this.commitPending(),{status:0,data:(n?R.encode(n):void 0)??null}}rmdir(t,e=0){t=this.normalizePath(t);const s=(e&1)!==0,i=this.pathIndex.get(t);if(i===void 0){if(this.isImplicitDirectory(t)){if(this.getDirectChildrenWithImplicit(t).length>0){if(!s)return{status:I.ENOTEMPTY};for(const l of this.getAllDescendants(t)){const h=this.pathIndex.get(l),c=this.readInode(h);this.freeBlockRange(c.firstBlock,c.blockCount),c.type=f.FREE,this.writeInode(h,c),this.deletePathIndex(l)}this.pathIndexGen++,this.commitPending()}return{status:0}}return{status:I.ENOENT}}const n=this.readInode(i);if(n.type!==f.DIRECTORY)return{status:I.ENOTDIR};if(this.getDirectChildren(t).length>0){if(!s)return{status:I.ENOTEMPTY};for(const o of this.getAllDescendants(t)){const l=this.pathIndex.get(o),h=this.readInode(l);this.freeBlockRange(h.firstBlock,h.blockCount),h.type=f.FREE,this.writeInode(l,h),this.deletePathIndex(o)}}return t==="/"?(this.pathIndexGen++,this.commitPending(),{status:0}):(n.type=f.FREE,this.writeInode(i,n),this.deletePathIndex(t),this.pathIndexGen++,i<this.freeInodeHint&&(this.freeInodeHint=i),this.commitPending(),{status:0})}readdir(t,e=0){t=this.normalizePath(t);const s=this.resolvePathFull(t,!0);let i;if(s){if(this.readInode(s.idx).type!==f.DIRECTORY)return{status:I.ENOTDIR,data:null};i=s.resolvedPath}else if(this.isImplicitDirectory(t))i=t;else return{status:I.ENOENT,data:null};if((e&1)!==0){this.ensureChildIndex();const d=this.childIndex.get(i);if(!d)return{status:0,data:new Uint8Array([0,0,0,0])};const u=[...d.keys()].sort(),m=i==="/"?"/":i+"/";let w=4;for(const O of u)w+=3+O.length*3;const E=new Uint8Array(w),y=new DataView(E.buffer);y.setUint32(0,u.length,!0);let C=4;for(const O of u){const{written:D}=R.encodeInto(O,E.subarray(C+2));y.setUint16(C,D,!0),C+=2+D;const B=this.pathIndex.get(m+O);E[C++]=B===void 0?f.DIRECTORY:this.readInode(B).type}return{status:0,data:E.subarray(0,C)}}this.ensureChildIndex();const r=this.childIndex.get(i);if(!r)return{status:0,data:new Uint8Array([0,0,0,0])};const o=[...r.keys()].sort();let l=4;for(const d of o)l+=2+d.length*3;const h=new Uint8Array(l),c=new DataView(h.buffer);c.setUint32(0,o.length,!0);let a=4;for(const d of o){const{written:u}=R.encodeInto(d,h.subarray(a+2));c.setUint16(a,u,!0),a+=2+u}return{status:0,data:h.subarray(0,a)}}rename(t,e){t=this.normalizePath(t),e=this.normalizePath(e);const s=this.pathIndex.get(t);if(s===void 0)return{status:I.ENOENT};if(t===e)return{status:0};const i=this.ensureParent(e);if(i!==0)return{status:i};const n=this.pathIndex.get(e),r=n===void 0&&this.isImplicitDirectory(e);if(n!==void 0||r){const c=this.readInode(s).type===f.DIRECTORY,a=r||n!==void 0&&this.readInode(n).type===f.DIRECTORY;if(c&&!a)return{status:I.ENOTDIR};if(!c&&a)return{status:I.EISDIR}}if(n!==void 0||r){let c=r;if(n!==void 0){const a=this.readInode(n);c=a.type===f.DIRECTORY,this.freeBlockRange(a.firstBlock,a.blockCount),a.type=f.FREE,this.writeInode(n,a),this.deletePathIndex(e),n<this.freeInodeHint&&(this.freeInodeHint=n)}if(c)for(const a of this.getAllDescendants(e)){const d=this.pathIndex.get(a),u=this.readInode(d);this.freeBlockRange(u.firstBlock,u.blockCount),u.type=f.FREE,this.writeInode(d,u),this.deletePathIndex(a),d<this.freeInodeHint&&(this.freeInodeHint=d)}}const o=this.readInode(s),{offset:l,length:h}=this.appendPath(e);if(o.pathOffset=l,o.pathLength=h,o.mtime=Date.now(),this.writeInode(s,o),this.deletePathIndex(t),this.setPathIndex(e,s),this.pathIndexGen++,o.type===f.DIRECTORY){const c=t==="/"?"/":t+"/",a=[];for(const[d,u]of this.pathIndex)d.startsWith(c)&&a.push([d,u]);for(const[d,u]of a){const m=d.substring(t.length),w=e+m,E=this.readInode(u),{offset:y,length:C}=this.appendPath(w);E.pathOffset=y,E.pathLength=C,this.writeInode(u,E),this.deletePathIndex(d),this.setPathIndex(w,u)}}return this.commitPending(),{status:0}}exists(t){t=this.normalizePath(t);const e=this.resolvePathComponents(t,!0),s=new Uint8Array(1);return s[0]=e!==void 0||this.isImplicitDirectory(t)?1:0,{status:0,data:s}}truncate(t,e=0){t=this.normalizePath(t);const s=this.resolvePathComponents(t,!0);if(s===void 0)return{status:this.resolveFailureStatus()};const i=this.readInode(s);if(i.type===f.DIRECTORY)return{status:I.EISDIR};if(e===0)this.freeBlockRange(i.firstBlock,i.blockCount),i.firstBlock=0,i.blockCount=0,i.size=0;else if(e<i.size){const n=Math.ceil(e/this.blockSize);n<i.blockCount&&this.freeBlockRange(i.firstBlock+n,i.blockCount-n),i.blockCount=n,i.size=e}else if(e>i.size){const n=Math.ceil(e/this.blockSize);if(n>i.blockCount){const r=this.allocateBlocks(n),o=this.dataOffset+r*this.blockSize;if(i.size>0){const l=this.dataOffset+i.firstBlock*this.blockSize,h=4*1024*1024,c=new Uint8Array(Math.min(h,i.size));let a=0;for(;a<i.size;){const d=Math.min(h,i.size-a),u=d<c.length?c.subarray(0,d):c;this.handle.read(u,{at:l+a}),this.handle.write(u,{at:o+a}),a+=d}}this.freeBlockRange(i.firstBlock,i.blockCount),this.zeroFileRange(o+i.size,e-i.size),i.firstBlock=r}else this.zeroFileRange(this.dataOffset+i.firstBlock*this.blockSize+i.size,e-i.size);i.blockCount=n,i.size=e}return i.mtime=Date.now(),this.writeInode(s,i),this.commitPending(),{status:0}}copy(t,e,s=0){t=this.normalizePath(t),e=this.normalizePath(e);const i=this.resolvePathComponents(t,!0);if(i===void 0)return{status:this.resolveFailureStatus()};const n=this.readInode(i);if(n.type===f.DIRECTORY)return{status:I.ENOTSUP};if(s&1&&(this.pathIndex.has(e)||this.isImplicitDirectory(e)))return{status:I.EEXIST};if(t===e)return{status:0};const r=n.size,o=n.firstBlock,l=n.mode,h=this.write(e,new Uint8Array(0));if(h.status!==0)return h;if(r===0){const O=this.resolvePathComponents(e,!0);if(O!==void 0){const D=this.readInode(O);D.mode=D.mode&-4096|l&4095,this.writeInode(O,D),this.commitPending()}return{status:0}}const c=this.resolvePathComponents(e,!0);if(c===void 0)return{status:I.EIO};const a=this.readInode(c),d=Math.ceil(r/this.blockSize),u=this.allocateBlocks(d),m=this.dataOffset+u*this.blockSize,w=this.dataOffset+o*this.blockSize,E=4*1024*1024,y=new Uint8Array(Math.min(E,r));let C=0;for(;C<r;){const O=Math.min(E,r-C),D=O<y.length?y.subarray(0,O):y;this.handle.read(D,{at:w+C}),this.handle.write(D,{at:m+C}),C+=O}return a.firstBlock=u,a.blockCount=d,a.size=r,a.mtime=Date.now(),a.mode=a.mode&-4096|l&4095,this.writeInode(c,a),this.commitPending(),{status:0}}access(t,e=0){t=this.normalizePath(t);const s=this.resolvePathComponents(t,!0);if(s===void 0){const r=this.resolveFailureStatus();return this.isImplicitDirectory(t)?{status:0}:{status:r}}if(e===0)return{status:0};if(!this.strictPermissions)return{status:0};const i=this.readInode(s),n=this.getEffectivePermission(i);return e&4&&!(n&4)?{status:I.EACCES}:e&2&&!(n&2)?{status:I.EACCES}:e&1&&!(n&1)?{status:I.EACCES}:{status:0}}getEffectivePermission(t){const e=t.mode&511;return this.processUid===t.uid?e>>>6&7:this.processGid===t.gid?e>>>3&7:e&7}realpath(t){t=this.normalizePath(t);const e=this.resolvePathComponents(t,!0);if(e===void 0){const n=this.resolveFailureStatus();return this.isImplicitDirectory(t)?{status:0,data:R.encode(t)}:{status:n,data:null}}const s=this.readInode(e),i=this.readPath(s.pathOffset,s.pathLength);return{status:0,data:R.encode(i)}}chmod(t,e,s=!0){t=this.normalizePath(t);const i=this.resolvePathComponents(t,s);if(i===void 0)return{status:this.resolveFailureStatus()};const n=this.readInode(i);return n.mode=n.mode&at|e&4095,n.ctime=Date.now(),this.writeInode(i,n),{status:0}}chown(t,e,s,i=!0){t=this.normalizePath(t);const n=this.resolvePathComponents(t,i);if(n===void 0)return{status:this.resolveFailureStatus()};const r=this.readInode(n);return r.uid=e,r.gid=s,r.ctime=Date.now(),this.writeInode(n,r),{status:0}}utimes(t,e,s,i=!0){t=this.normalizePath(t);const n=this.resolvePathComponents(t,i);if(n===void 0)return{status:this.resolveFailureStatus()};const r=this.readInode(n);return r.atime=e,r.mtime=s,r.ctime=Date.now(),this.writeInode(n,r),{status:0}}symlink(t,e){if(e=this.normalizePath(e),this.pathIndex.has(e)||this.isImplicitDirectory(e))return{status:I.EEXIST};const s=this.ensureParent(e);if(s!==0)return{status:s};const i=R.encode(t);return this.createInode(e,f.SYMLINK,pt,i.byteLength,i),this.commitPending(),{status:0}}readlink(t){t=this.normalizePath(t);const e=this.pathIndex.get(t);if(e===void 0)return{status:I.ENOENT,data:null};const s=this.readInode(e);return s.type!==f.SYMLINK?{status:I.EINVAL,data:null}:{status:0,data:this.readData(s.firstBlock,s.blockCount,s.size)}}link(t,e){t=this.normalizePath(t),e=this.normalizePath(e);const s=this.resolvePathComponents(t,!0);if(s===void 0)return{status:this.resolveFailureStatus()};const i=this.readInode(s);if(i.type===f.DIRECTORY)return{status:I.EPERM};if(this.pathIndex.has(e)||this.isImplicitDirectory(e))return{status:I.EEXIST};const n=this.copy(t,e);if(n.status!==0)return n;i.nlink++,this.writeInode(s,i);const r=this.pathIndex.get(e);if(r!==void 0){const o=this.readInode(r);o.nlink=i.nlink,this.writeInode(r,o)}return{status:0}}open(t,e,s,i=438){t=this.normalizePath(t);const n=(e&64)!==0,r=(e&512)!==0,o=(e&128)!==0;let l=this.resolvePathComponents(t,!0);if(l===void 0){const a=this.resolveDanglingLink(t);if(a===null)return{status:I.ELOOP,data:null};a!==t&&(t=a,l=this.resolvePathComponents(t,!0))}if(H.isWritable(e)&&(l!==void 0?this.readInode(l).type===f.DIRECTORY:this.isImplicitDirectory(t)))return{status:I.EISDIR,data:null};if(l===void 0){if(!n)return{status:this.resolveFailureStatus(),data:null};const a=this.ensureParent(t);if(a!==0)return{status:a,data:null};l=this.createInode(t,f.FILE,this.fileModeFor(i),0)}else if(o&&n)return{status:I.EEXIST,data:null};r&&this.truncate(t,0);const h=this.nextFd++;this.fdTable.set(h,{tabId:s,inodeIdx:l,position:0,flags:e});const c=new Uint8Array(4);return new DataView(c.buffer).setUint32(0,h,!0),{status:0,data:c}}close(t){return this.fdTable.has(t)?(this.fdTable.delete(t),{status:0}):{status:I.EBADF}}fread(t,e,s){const i=this.fdTable.get(t);if(!i)return{status:I.EBADF,data:null};if(!H.isReadable(i.flags))return{status:I.EBADF,data:null};const n=this.readInode(i.inodeIdx);if(n.type===f.DIRECTORY)return{status:I.EISDIR,data:null};const r=s??i.position,o=Math.min(e,n.size-r);if(o<=0)return{status:0,data:new Uint8Array(0)};const l=this.dataOffset+n.firstBlock*this.blockSize+r,h=new Uint8Array(o);return this.handle.read(h,{at:l}),s===null&&(i.position+=o),{status:0,data:h}}fwrite(t,e,s){const i=this.fdTable.get(t);if(!i)return{status:I.EBADF,data:null};if(!H.isWritable(i.flags))return{status:I.EBADF,data:null};const n=this.readInode(i.inodeIdx),o=(i.flags&1024)!==0?n.size:s??i.position,l=o+e.byteLength;if(l>n.size){const c=Math.ceil(l/this.blockSize);if(c>n.blockCount){const a=this.allocateBlocks(c),d=this.dataOffset+a*this.blockSize,u=this.dataOffset+n.firstBlock*this.blockSize;if(n.size>0){const w=new Uint8Array(Math.min(4194304,n.size));let E=0;for(;E<n.size;){const y=Math.min(4194304,n.size-E),C=y<w.length?w.subarray(0,y):w;this.handle.read(C,{at:u+E}),this.handle.write(C,{at:d+E}),E+=y}}this.freeBlockRange(n.firstBlock,n.blockCount),o>n.size&&this.zeroFileRange(d+n.size,o-n.size),this.handle.write(e,{at:d+o}),n.firstBlock=a,n.blockCount=c}else{o>n.size&&this.zeroFileRange(this.dataOffset+n.firstBlock*this.blockSize+n.size,o-n.size);const a=this.dataOffset+n.firstBlock*this.blockSize+o;this.handle.write(e,{at:a})}n.size=l}else{const c=this.dataOffset+n.firstBlock*this.blockSize+o;this.handle.write(e,{at:c})}n.mtime=Date.now(),this.writeInode(i.inodeIdx,n),s===null&&(i.position=l),this.commitPending();const h=new Uint8Array(4);return new DataView(h.buffer).setUint32(0,e.byteLength,!0),{status:0,data:h}}fstat(t){const e=this.fdTable.get(t);return e?e.implicitPath?this.encodeImplicitDirStatResponse(e.implicitPath):this.encodeStatResponse(e.inodeIdx):{status:I.EBADF,data:null}}ftruncate(t,e=0){const s=this.fdTable.get(t);if(!s)return{status:I.EBADF};if(!H.isWritable(s.flags))return{status:I.EINVAL};const i=this.readInode(s.inodeIdx),n=this.readPath(i.pathOffset,i.pathLength);return this.truncate(n,e)}statfs(t="/"){if(t=this.normalizePath(t),this.resolvePathComponents(t,!0)===void 0&&!this.isImplicitDirectory(t))return{status:this.resolveFailureStatus(),data:null};const e=new Set(this.pathIndex.values()).size,s=new Uint8Array(24),i=new DataView(s.buffer);return i.setUint32(0,V,!0),i.setUint32(4,this.blockSize,!0),i.setUint32(8,this.totalBlocks,!0),i.setUint32(12,this.freeBlocks,!0),i.setUint32(16,this.inodeCount,!0),i.setUint32(20,Math.max(0,this.inodeCount-e),!0),{status:0,data:s}}fsync(t){return t!==void 0&&!this.fdTable.has(t)?{status:I.EBADF}:(this.commitPending(),this.handle.flush(),{status:0})}fchmod(t,e){const s=this.fdTable.get(t);if(!s)return{status:I.EBADF};if(s.implicitPath)return{status:0};const i=this.readInode(s.inodeIdx);return i.mode=i.mode&at|e&4095,i.ctime=Date.now(),this.writeInode(s.inodeIdx,i),{status:0}}fchown(t,e,s){const i=this.fdTable.get(t);if(!i)return{status:I.EBADF};if(i.implicitPath)return{status:0};const n=this.readInode(i.inodeIdx);return n.uid=e,n.gid=s,n.ctime=Date.now(),this.writeInode(i.inodeIdx,n),{status:0}}futimes(t,e,s){const i=this.fdTable.get(t);if(!i)return{status:I.EBADF};if(i.implicitPath)return{status:0};const n=this.readInode(i.inodeIdx);return n.atime=e,n.mtime=s,n.ctime=Date.now(),this.writeInode(i.inodeIdx,n),{status:0}}opendir(t,e){t=this.normalizePath(t);const s=this.resolvePathComponents(t,!0);if(s===void 0){if(this.isImplicitDirectory(t)){const o=this.nextFd++;this.fdTable.set(o,{tabId:e,inodeIdx:-1,position:0,flags:0,implicitPath:t});const l=new Uint8Array(4);return new DataView(l.buffer).setUint32(0,o,!0),{status:0,data:l}}return{status:I.ENOENT,data:null}}if(this.readInode(s).type!==f.DIRECTORY)return{status:I.ENOTDIR,data:null};const n=this.nextFd++;this.fdTable.set(n,{tabId:e,inodeIdx:s,position:0,flags:0});const r=new Uint8Array(4);return new DataView(r.buffer).setUint32(0,n,!0),{status:0,data:r}}mkdtemp(t){const e=Math.random().toString(36).substring(2,8),s=this.normalizePath(t+e),i=s.substring(0,s.lastIndexOf("/"))||"/";return i!=="/"&&this.resolvePathComponents(i,!0)===void 0&&!this.isImplicitDirectory(i)?{status:I.ENOENT,data:null}:(this.createInode(s,f.DIRECTORY,this.dirModeFor(448),0),this.commitPending(),{status:0,data:R.encode(s)})}getDirectChildren(t){this.ensureChildIndex();const e=this.childIndex.get(t);if(!e)return[];const s=t==="/"?"/":t+"/",i=[];for(const n of e.keys()){const r=s+n;this.pathIndex.has(r)&&i.push(r)}return i.sort()}rebuildImplicitDirs(){if(this.implicitDirsGen===this.pathIndexGen)return;const t=Date.now(),e=this.implicitDirs;this.implicitDirs=new Map;for(const s of this.pathIndex.keys()){let i=s.length;for(;i=s.lastIndexOf("/",i-1),!(i<=0);){const n=s.substring(0,i);if(this.implicitDirs.has(n))break;this.pathIndex.has(n)||this.implicitDirs.set(n,e.get(n)??t)}}this.implicitDirsGen=this.pathIndexGen}isImplicitDirectory(t){return t==="/"||this.pathIndex.has(t)?!1:(this.descCountGen<this.pathIndexGen&&this.rebuildDescCount(),(this.descCount.get(t)??0)>0)}rebuildDescCount(){this.descCount.clear();for(const t of this.pathIndex.keys())this.bumpDescCount(t);this.descCountGen=this.pathIndexGen}setPathIndex(t,e){const s=this.pathIndex.has(t);this.pathIndex.set(t,e),s||(this.bumpDescCount(t),this.bumpChildIndex(t)),this.descCountGen=this.pathIndexGen+1,this.childIndexGen=this.pathIndexGen+1}deletePathIndex(t){const e=this.pathIndex.delete(t);return e&&(this.decDescCount(t),this.decChildIndex(t)),this.descCountGen=this.pathIndexGen+1,this.childIndexGen=this.pathIndexGen+1,e}bumpDescCount(t){let e=t.length;for(;e=t.lastIndexOf("/",e-1),!(e<=0);){const s=t.substring(0,e);this.descCount.set(s,(this.descCount.get(s)??0)+1)}}decDescCount(t){let e=t.length;for(;e=t.lastIndexOf("/",e-1),!(e<=0);){const s=t.substring(0,e),i=this.descCount.get(s);if(i===void 0)break;i<=1?this.descCount.delete(s):this.descCount.set(s,i-1)}}bumpChildIndex(t){if(t==="/"||t.length===0)return;let e="/",s=1;for(;s<=t.length;){let i=t.indexOf("/",s);i===-1&&(i=t.length);const n=t.substring(s,i);if(n.length>0){let r=this.childIndex.get(e);r||(r=new Map,this.childIndex.set(e,r)),r.set(n,(r.get(n)??0)+1),e=e==="/"?"/"+n:e+"/"+n}s=i+1}}decChildIndex(t){if(t==="/"||t.length===0)return;let e="/",s=1;for(;s<=t.length;){let i=t.indexOf("/",s);i===-1&&(i=t.length);const n=t.substring(s,i);if(n.length>0){const r=this.childIndex.get(e);if(!r)break;const o=r.get(n);if(o===void 0)break;o<=1?(r.delete(n),r.size===0&&this.childIndex.delete(e)):r.set(n,o-1),e=e==="/"?"/"+n:e+"/"+n}s=i+1}}ensureChildIndex(){if(!(this.childIndexGen>=this.pathIndexGen)){this.childIndex.clear();for(const t of this.pathIndex.keys())this.bumpChildIndex(t);this.childIndexGen=this.pathIndexGen}}countSubdirectories(t){this.ensureChildIndex();const e=this.childIndex.get(t);if(!e)return 0;const s=t==="/"?"/":t+"/";let i=0;for(const n of e.keys()){const r=this.pathIndex.get(s+n);(r===void 0||this.readInode(r).type===f.DIRECTORY)&&i++}return i}getDirectChildrenWithImplicit(t){this.ensureChildIndex();const e=this.childIndex.get(t);if(!e)return[];const s=t==="/"?"/":t+"/",i=[];for(const n of e.keys()){const r=s+n;i.push({path:r,type:this.pathIndex.has(r)?"real":"implicit"})}return i.sort((n,r)=>n.path<r.path?-1:n.path>r.path?1:0),i}encodeImplicitDirStatResponse(t){this.rebuildImplicitDirs();const e=this.implicitDirs.get(t)??Date.now(),s=rt&~(this.umask&511),i=2+this.countSubdirectories(t),n=new Uint8Array(53),r=new DataView(n.buffer);return r.setUint8(0,f.DIRECTORY),r.setUint32(1,s,!0),r.setFloat64(5,0,!0),r.setFloat64(13,e,!0),r.setFloat64(21,e,!0),r.setFloat64(29,e,!0),r.setUint32(37,this.processUid,!0),r.setUint32(41,this.processGid,!0),r.setUint32(45,0,!0),r.setUint32(49,i,!0),{status:0,data:n}}getAllDescendants(t){const e=t==="/"?"/":t+"/",s=[];for(const i of this.pathIndex.keys())i!==t&&i.startsWith(e)&&s.push(i);return s.sort((i,n)=>{const r=i.split("/").length;return n.split("/").length-r})}ensureParent(t){const e=t.lastIndexOf("/");if(e<=0)return 0;const s=t.substring(0,e),i=this.pathIndex.get(s);return i===void 0?this.isImplicitDirectory(s)?0:I.ENOENT:this.readInode(i).type!==f.DIRECTORY?I.ENOTDIR:0}cleanupTab(t){for(const[e,s]of this.fdTable)s.tabId===t&&this.fdTable.delete(e)}getAllFiles(){const t=[];for(const[e,s]of this.pathIndex)t.push({path:e,idx:s});return t}getPathForFd(t){const e=this.fdTable.get(t);if(!e)return null;const s=this.readInode(e.inodeIdx);return this.readPath(s.pathOffset,s.pathLength)}getInodeData(t){const e=this.readInode(t),s=e.size>0?this.readData(e.firstBlock,e.blockCount,e.size):new Uint8Array(0);return{type:e.type,data:s,mtime:e.mtime}}exportAll(){const t=[];for(const[e,s]of this.pathIndex){const i=this.readInode(s);let n=null;(i.type===f.FILE||i.type===f.SYMLINK)&&(n=i.size>0?this.readData(i.firstBlock,i.blockCount,i.size):new Uint8Array(0)),t.push({path:e,type:i.type,data:n,mode:i.mode,mtime:i.mtime})}return t.sort((e,s)=>e.type===f.DIRECTORY&&s.type!==f.DIRECTORY?-1:e.type!==f.DIRECTORY&&s.type===f.DIRECTORY?1:e.path.localeCompare(s.path)),t}flush(){this.handle.flush()}};self.onmessage=async S=>{try{const t=S.data;if(t.type==="repair")self.postMessage(await kt(t.root));else if(t.type==="load")self.postMessage(await St(t.root));else throw new Error(`Unknown message type: ${t.type}`)}catch(t){self.postMessage({error:t.message||String(t)})}};async function ht(S){let t=await navigator.storage.getDirectory();if(S&&S!=="/")for(const e of S.split("/").filter(Boolean))t=await t.getDirectoryHandle(e,{create:!0});return t}async function dt(S,t,e){const s=[];for await(const[i,n]of S.entries()){if(t===""&&e.has(i))continue;const r=t?`${t}/${i}`:`/${i}`;if(n.kind==="directory"){s.push({path:r,type:"directory"});const o=await dt(n,r,e);s.push(...o)}else{const l=await(await n.getFile()).arrayBuffer();s.push({path:r,type:"file",data:l})}}return s}async function N(S){try{await S.removeEntry(".vfs.bin.tmp")}catch{}}async function Et(S){const t=await S.createSyncAccessHandle();try{new Q().init(t)}finally{t.close()}}async function ut(S,t){await Et(t);const e=await S.getFileHandle(".vfs.bin",{create:!0}),s=await t.createSyncAccessHandle(),i=await e.createSyncAccessHandle();try{const n=s.getSize();i.truncate(n);const r=1024*1024,o=new Uint8Array(r);for(let l=0;l<n;l+=r){const h=s.read(o,{at:l});i.write(h<r?o.subarray(0,h):o,{at:l})}i.flush()}finally{i.close(),s.close()}try{await S.removeEntry(".vfs.bin.tmp")}catch{}}async function kt(S){const t=await ht(S);await N(t);const s=await(await t.getFileHandle(".vfs.bin")).getFile(),i=new Uint8Array(await s.arrayBuffer()),n=i.byteLength;if(n<b.SIZE)throw new Error(`VFS file too small to repair (${n} bytes)`);const r=new DataView(i.buffer);let o,l,h,c,a,d,u,m;const w=r.getUint32(b.MAGIC,!0),E=r.getUint32(b.VERSION,!0),y=r.getUint32(b.CRC32,!0),C=y===0||j(i,0,b.CRC32)===y;if(w===V&&E===G&&C){if(o=r.getUint32(b.INODE_COUNT,!0),l=r.getUint32(b.BLOCK_SIZE,!0),h=r.getUint32(b.TOTAL_BLOCKS,!0),c=r.getFloat64(b.INODE_OFFSET,!0),a=r.getFloat64(b.PATH_OFFSET,!0),d=r.getFloat64(b.DATA_OFFSET,!0),u=r.getFloat64(b.BITMAP_OFFSET,!0),m=u-a,l===0||(l&l-1)!==0||o===0||c>=n||a>=n||d>=n||m<=0){const g=X(P,U,L);o=P,l=U,h=L,c=g.inodeTableOffset,a=g.pathTableOffset,d=g.dataOffset,u=g.bitmapOffset,m=u-a}}else{const g=X(P,U,L);o=P,l=U,h=L,c=g.inodeTableOffset,a=g.pathTableOffset,d=g.dataOffset,u=g.bitmapOffset,m=u-a}const D=new TextDecoder("utf-8",{fatal:!0}),B=[];let F=0;const ft=Math.min(o,Math.floor((n-c)/T));for(let g=0;g<ft;g++){const _=c+g*T;if(_+T>n)break;const v=i[_+p.TYPE];if(v<f.FILE||v>f.SYMLINK)continue;const A=new DataView(i.buffer,_,T),k=A.getUint32(p.PATH_OFFSET,!0),x=A.getUint16(p.PATH_LENGTH,!0),z=A.getFloat64(p.SIZE,!0),K=A.getUint32(p.FIRST_BLOCK,!0),Z=a+k;if(x===0||x>4096||Z+x>n||k+x>m){F++;continue}let M;try{M=D.decode(i.subarray(Z,Z+x))}catch{F++;continue}if(!M.startsWith("/")||M.includes("\\0")){F++;continue}if(v===f.DIRECTORY){B.push({path:M,type:v,dataOffset:0,dataSize:0,contentLost:!1});continue}if(z<0||z>n||!isFinite(z)){F++;continue}const st=A.getUint32(p.BLOCK_COUNT,!0),nt=d+K*l;if(nt+z>n||K>=h||st>0&&K+st>h){B.push({path:M,type:v,dataOffset:0,dataSize:0,contentLost:!0}),F++;continue}B.push({path:M,type:v,dataOffset:nt,dataSize:z,contentLost:!1})}const q=await t.getFileHandle(".vfs.bin.tmp",{create:!0}),tt=await q.createSyncAccessHandle();let et=!1,Y=0;const mt=5;try{const g=new Q;g.init(tt);const _=B.filter(k=>k.type===f.DIRECTORY&&k.path!=="/").sort((k,x)=>k.path.localeCompare(x.path)),v=B.filter(k=>k.type===f.FILE),A=B.filter(k=>k.type===f.SYMLINK);for(const k of _)if(g.mkdir(k.path,1,493).status!==0&&(Y++,F++,Y>=mt))throw new Error(`Repair aborted: too many critical errors (${Y} mkdir failures)`);for(const k of v){const x=k.dataSize>0?i.subarray(k.dataOffset,k.dataOffset+k.dataSize):new Uint8Array(0);g.write(k.path,x).status!==0&&F++}for(const k of A){if(k.dataSize===0&&k.contentLost){F++;continue}const x=k.dataSize>0?i.subarray(k.dataOffset,k.dataOffset+k.dataSize):new Uint8Array(0);let z;try{z=D.decode(x)}catch{F++;continue}if(z.length===0||z.includes("\\0")){F++;continue}g.symlink(z,k.path).status!==0&&F++}g.flush(),et=!0}finally{tt.close(),et||await N(t)}try{await ut(t,q)}catch(g){throw await N(t),new Error(`Repair built a VFS but verification failed: ${g.message}`)}const it=B.filter(g=>g.path!=="/").map(g=>({path:g.path,type:g.type===f.FILE?"file":g.type===f.DIRECTORY?"directory":"symlink",size:g.dataSize,contentLost:g.contentLost}));return{recovered:it.length,lost:F,entries:it}}async function St(S){const t=await ht(S);await N(t);const e=await dt(t,"",new Set([".vfs.bin",".vfs.bin.tmp"])),s=await t.getFileHandle(".vfs.bin.tmp",{create:!0}),i=await s.createSyncAccessHandle();let n=!1,r=0,o=0;try{const l=new Q;l.init(i);const h=e.filter(a=>a.type==="directory").sort((a,d)=>a.path.localeCompare(d.path));for(const a of h)l.mkdir(a.path,1,493).status===0&&o++;const c=e.filter(a=>a.type==="file");for(const a of c)l.write(a.path,new Uint8Array(a.data??new ArrayBuffer(0))).status===0&&r++;l.flush(),n=!0}finally{i.close(),n||await N(t)}try{await ut(t,s)}catch(l){throw await N(t),new Error(`Load built a VFS but verification failed: ${l.message}`)}return{files:r,directories:o}}\n';

// src/vfs/crc32.ts
var TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();
function crc32(bytes, start = 0, end = bytes.byteLength) {
  let crc = 4294967295;
  for (let i = start; i < end; i++) {
    crc = TABLE[(crc ^ bytes[i]) & 255] ^ crc >>> 8;
  }
  return (crc ^ 4294967295) >>> 0;
}

// src/vfs/engine.ts
var encoder10 = new TextEncoder();
var PREGROW_HEADROOM_BLOCKS = 16384;
var decoder8 = new TextDecoder();
var VFSEngine = class _VFSEngine {
  handle;
  pathIndex = /* @__PURE__ */ new Map();
  // path → inode index
  inodeCount = 0;
  blockSize = DEFAULT_BLOCK_SIZE;
  totalBlocks = 0;
  freeBlocks = 0;
  inodeTableOffset = 0;
  pathTableOffset = 0;
  pathTableUsed = 0;
  pathTableSize = 0;
  bitmapOffset = 0;
  dataOffset = 0;
  umask = DEFAULT_UMASK;
  processUid = 0;
  processGid = 0;
  strictPermissions = false;
  debug = false;
  // File descriptor table
  fdTable = /* @__PURE__ */ new Map();
  nextFd = 3;
  // 0=stdin, 1=stdout, 2=stderr reserved
  /**
   * Whether an fd's open flags permit reading / writing.
   *
   * The low two bits of the flags are the access mode (O_RDONLY=0, O_WRONLY=1, O_RDWR=2). These
   * were not enforced: reading from a descriptor opened `'w'` returned 0 bytes instead of EBADF,
   * and writing through one opened `'r'` succeeded. Both are errors in Node, and code that
   * relies on the error to detect a mis-opened file saw silence instead. Found by the fd fuzzer.
   */
  static isReadable(flags) {
    const mode = flags & 3;
    return mode === 0 || mode === 2;
  }
  static isWritable(flags) {
    const mode = flags & 3;
    return mode === 1 || mode === 2;
  }
  // Reusable buffers to avoid allocations
  inodeBuf = new Uint8Array(INODE_SIZE);
  inodeView = new DataView(this.inodeBuf.buffer);
  // In-memory inode cache — eliminates disk reads for hot inodes
  inodeCache = /* @__PURE__ */ new Map();
  superblockBuf = new Uint8Array(SUPERBLOCK.SIZE);
  superblockView = new DataView(this.superblockBuf.buffer);
  // In-memory bitmap cache — eliminates bitmap reads from OPFS
  bitmap = null;
  bitmapDirtyLo = Infinity;
  // lowest dirty byte index
  bitmapDirtyHi = -1;
  // highest dirty byte index (inclusive)
  superblockDirty = false;
  // Free inode hint — skip O(n) scan
  freeInodeHint = 0;
  // Implicit directory support — tracks all directory prefixes implied by file paths.
  // Rebuilt lazily when pathIndex changes (tracked via generation counter).
  // Map value is the stable timestamp (ms since epoch) assigned when the implicit
  // dir was first discovered, so that stat() returns consistent mtime/ctime/atime
  // across repeated calls.
  implicitDirs = /* @__PURE__ */ new Map();
  implicitDirsGen = -1;
  // generation when implicitDirs was last rebuilt
  pathIndexGen = 0;
  // bumped on every pathIndex mutation
  // Incrementally maintained "number of pathIndex entries that have this
  // path as a strict ancestor" map. Lets `isImplicitDirectory` answer in
  // O(1) — an implicit dir P is exactly !pathIndex.has(P) && descCount[P] > 0.
  // Without this, every `isImplicitDirectory` call triggered an O(N×depth)
  // rebuild of `implicitDirs`, and the 3.0.49 fix put one of those calls on
  // the hot path of every fresh write/symlink/link/copy — making batch
  // writes O(N²) on total path count.
  descCount = /* @__PURE__ */ new Map();
  // descCount is in sync with pathIndex iff descCountGen >= pathIndexGen.
  // Helpers `setPathIndex`/`deletePathIndex` keep them in sync. Code that
  // mutates `pathIndex` directly (only test scaffolding does this in
  // practice — see the implicit-directory tests in vfs-engine.test.ts)
  // bumps `pathIndexGen` without going through the helpers, which leaves
  // descCount stale; `isImplicitDirectory` notices the mismatch and
  // recomputes descCount on demand.
  descCountGen = 0;
  // Incrementally maintained directory-children index: parent dir path →
  // (child name → number of pathIndex entries whose path passes through
  // parent/name). Lets getDirectChildren / getDirectChildrenWithImplicit
  // answer in O(children) instead of scanning every path in the volume,
  // which made readdir and directory-stat O(total files) per call.
  // A child name with refcount > 0 but no pathIndex entry of its own is an
  // implicit directory. Same staleness contract as descCount: in sync iff
  // childIndexGen >= pathIndexGen, rebuilt from scratch on demand when test
  // scaffolding mutates pathIndex directly.
  childIndex = /* @__PURE__ */ new Map();
  childIndexGen = 0;
  /** Where the next block search resumes — see allocateBlocks. Reset on mount/format. */
  allocCursor = 0;
  /**
   * Set when path resolution gave up because a symlink chain exceeded MAX_SYMLINK_DEPTH.
   *
   * The resolvers return `undefined` for both "not there" and "went in circles", which every
   * caller then reported as ENOENT — so a symlink pointing at itself looked like a missing file
   * instead of the ELOOP Node reports. Reset at the start of every top-level resolve and read
   * immediately after, via `resolveFailureStatus`.
   */
  symlinkLoopDetected = false;
  /** ENOENT, or ELOOP when the last resolve gave up on a symlink cycle. */
  resolveFailureStatus() {
    return this.symlinkLoopDetected ? CODE_TO_STATUS.ELOOP : CODE_TO_STATUS.ENOENT;
  }
  // Configurable upper bounds
  maxInodes = 4e6;
  // Default ceiling on data blocks. The on-disk bitmap region is reserved for
  // this many blocks at format time (see calculateLayout), so the effective
  // limit and the reserved bitmap capacity stay in lock-step. Sourced from the
  // shared layout constant so both agree.
  maxBlocks = MAX_DATA_BLOCKS;
  maxPathTable = 256 * 1024 * 1024;
  // 256MB
  maxVFSSize = 100 * 1024 * 1024 * 1024;
  // 100GB
  init(handle, opts) {
    this.handle = handle;
    this.processUid = opts?.uid ?? 0;
    this.processGid = opts?.gid ?? 0;
    this.umask = opts?.umask ?? DEFAULT_UMASK;
    this.strictPermissions = opts?.strictPermissions ?? false;
    this.debug = opts?.debug ?? false;
    if (opts?.limits) {
      if (opts.limits.maxInodes != null) this.maxInodes = opts.limits.maxInodes;
      if (opts.limits.maxBlocks != null) this.maxBlocks = opts.limits.maxBlocks;
      if (opts.limits.maxPathTable != null) this.maxPathTable = opts.limits.maxPathTable;
      if (opts.limits.maxVFSSize != null) this.maxVFSSize = opts.limits.maxVFSSize;
    }
    const size = handle.getSize();
    if (size === 0) {
      this.format();
    } else {
      try {
        this.mount();
      } catch (err) {
        const msg = err.message ?? String(err);
        if (msg.startsWith("Corrupt VFS:")) throw err;
        throw new Error(`Corrupt VFS: ${msg}`);
      }
    }
  }
  /** Release the sync access handle (call on fatal error or shutdown) */
  closeHandle() {
    try {
      this.handle?.close();
    } catch (_) {
    }
  }
  /** Format a fresh VFS */
  format() {
    const layout = calculateLayout(DEFAULT_INODE_COUNT, DEFAULT_BLOCK_SIZE, INITIAL_DATA_BLOCKS, this.maxBlocks);
    this.inodeCount = DEFAULT_INODE_COUNT;
    this.blockSize = DEFAULT_BLOCK_SIZE;
    this.totalBlocks = layout.totalBlocks;
    this.freeBlocks = layout.totalBlocks;
    this.inodeTableOffset = layout.inodeTableOffset;
    this.pathTableOffset = layout.pathTableOffset;
    this.pathTableSize = layout.pathTableSize;
    this.pathTableUsed = 0;
    this.bitmapOffset = layout.bitmapOffset;
    this.dataOffset = layout.dataOffset;
    this.handle.truncate(layout.totalSize);
    this.writeSuperblock();
    const zeroBuf = new Uint8Array(layout.inodeTableSize);
    this.handle.write(zeroBuf, { at: this.inodeTableOffset });
    this.bitmap = new Uint8Array(layout.bitmapSize);
    this.handle.write(this.bitmap, { at: this.bitmapOffset });
    this.createInode("/", INODE_TYPE.DIRECTORY, DEFAULT_DIR_MODE, 0);
    this.writeSuperblock();
    this.handle.flush();
  }
  /** Mount an existing VFS from disk — validates superblock integrity */
  mount() {
    const fileSize = this.handle.getSize();
    if (fileSize < SUPERBLOCK.SIZE) {
      throw new Error(`Corrupt VFS: file too small (${fileSize} bytes, need at least ${SUPERBLOCK.SIZE})`);
    }
    this.handle.read(this.superblockBuf, { at: 0 });
    const v = this.superblockView;
    const magic = v.getUint32(SUPERBLOCK.MAGIC, true);
    if (magic !== VFS_MAGIC) {
      throw new Error(`Corrupt VFS: bad magic 0x${magic.toString(16)} (expected 0x${VFS_MAGIC.toString(16)})`);
    }
    const version = v.getUint32(SUPERBLOCK.VERSION, true);
    if (version !== VFS_VERSION) {
      throw new Error(`Corrupt VFS: unsupported version ${version} (expected ${VFS_VERSION})`);
    }
    const storedCrc = v.getUint32(SUPERBLOCK.CRC32, true);
    if (storedCrc !== 0) {
      const computedCrc = crc32(this.superblockBuf, 0, SUPERBLOCK.CRC32);
      if (computedCrc !== storedCrc) {
        throw new Error(
          `Corrupt VFS: superblock checksum mismatch (stored 0x${storedCrc.toString(16)}, computed 0x${computedCrc.toString(16)})`
        );
      }
    }
    const inodeCount = v.getUint32(SUPERBLOCK.INODE_COUNT, true);
    const blockSize = v.getUint32(SUPERBLOCK.BLOCK_SIZE, true);
    const totalBlocks = v.getUint32(SUPERBLOCK.TOTAL_BLOCKS, true);
    const freeBlocks = v.getUint32(SUPERBLOCK.FREE_BLOCKS, true);
    const inodeTableOffset = v.getFloat64(SUPERBLOCK.INODE_OFFSET, true);
    const pathTableOffset = v.getFloat64(SUPERBLOCK.PATH_OFFSET, true);
    const dataOffset = v.getFloat64(SUPERBLOCK.DATA_OFFSET, true);
    const bitmapOffset = v.getFloat64(SUPERBLOCK.BITMAP_OFFSET, true);
    const pathUsed = v.getUint32(SUPERBLOCK.PATH_USED, true);
    if (blockSize === 0 || (blockSize & blockSize - 1) !== 0) {
      throw new Error(`Corrupt VFS: invalid block size ${blockSize} (must be power of 2)`);
    }
    if (inodeCount === 0) {
      throw new Error("Corrupt VFS: inode count is 0");
    }
    if (freeBlocks > totalBlocks) {
      throw new Error(`Corrupt VFS: free blocks (${freeBlocks}) exceeds total blocks (${totalBlocks})`);
    }
    if (inodeCount > this.maxInodes) {
      throw new Error(`Corrupt VFS: inode count ${inodeCount} exceeds maximum ${this.maxInodes}`);
    }
    if (totalBlocks > this.maxBlocks) {
      throw new Error(`Corrupt VFS: total blocks ${totalBlocks} exceeds maximum ${this.maxBlocks}`);
    }
    if (fileSize > this.maxVFSSize) {
      throw new Error(`Corrupt VFS: file size ${fileSize} exceeds maximum ${this.maxVFSSize}`);
    }
    if (!Number.isFinite(inodeTableOffset) || inodeTableOffset < 0 || !Number.isFinite(pathTableOffset) || pathTableOffset < 0 || !Number.isFinite(bitmapOffset) || bitmapOffset < 0 || !Number.isFinite(dataOffset) || dataOffset < 0) {
      throw new Error(`Corrupt VFS: non-finite or negative section offset`);
    }
    if (inodeTableOffset !== SUPERBLOCK.SIZE) {
      throw new Error(`Corrupt VFS: inode table offset ${inodeTableOffset} (expected ${SUPERBLOCK.SIZE})`);
    }
    const expectedPathOffset = inodeTableOffset + inodeCount * INODE_SIZE;
    if (pathTableOffset !== expectedPathOffset) {
      throw new Error(`Corrupt VFS: path table offset ${pathTableOffset} (expected ${expectedPathOffset})`);
    }
    if (bitmapOffset <= pathTableOffset) {
      throw new Error(`Corrupt VFS: bitmap offset ${bitmapOffset} must be after path table ${pathTableOffset}`);
    }
    if (dataOffset <= bitmapOffset) {
      throw new Error(`Corrupt VFS: data offset ${dataOffset} must be after bitmap ${bitmapOffset}`);
    }
    if (totalBlocks > (dataOffset - bitmapOffset) * 8) {
      throw new Error(`Corrupt VFS: total blocks (${totalBlocks}) exceed bitmap region capacity (${(dataOffset - bitmapOffset) * 8})`);
    }
    const pathTableSize = bitmapOffset - pathTableOffset;
    if (pathUsed > pathTableSize) {
      throw new Error(`Corrupt VFS: path used (${pathUsed}) exceeds path table size (${pathTableSize})`);
    }
    if (pathTableSize > this.maxPathTable) {
      throw new Error(`Corrupt VFS: path table size ${pathTableSize} exceeds maximum ${this.maxPathTable}`);
    }
    const expectedMinSize = dataOffset + totalBlocks * blockSize;
    if (expectedMinSize > this.maxVFSSize) {
      throw new Error(`Corrupt VFS: computed layout size ${expectedMinSize} exceeds maximum ${this.maxVFSSize}`);
    }
    if (fileSize < expectedMinSize) {
      throw new Error(`Corrupt VFS: file size ${fileSize} too small for layout (need ${expectedMinSize})`);
    }
    this.inodeCount = inodeCount;
    this.blockSize = blockSize;
    this.totalBlocks = totalBlocks;
    this.freeBlocks = freeBlocks;
    this.inodeTableOffset = inodeTableOffset;
    this.pathTableOffset = pathTableOffset;
    this.dataOffset = dataOffset;
    this.bitmapOffset = bitmapOffset;
    this.pathTableUsed = pathUsed;
    this.pathTableSize = pathTableSize;
    const bitmapSize = Math.ceil(this.totalBlocks / 8);
    this.bitmap = new Uint8Array(bitmapSize);
    this.handle.read(this.bitmap, { at: this.bitmapOffset });
    this.rebuildIndex();
    if (!this.pathIndex.has("/")) {
      throw new Error('Corrupt VFS: root directory "/" not found in inode table');
    }
  }
  writeSuperblock() {
    const v = this.superblockView;
    v.setUint32(SUPERBLOCK.MAGIC, VFS_MAGIC, true);
    v.setUint32(SUPERBLOCK.VERSION, VFS_VERSION, true);
    v.setUint32(SUPERBLOCK.INODE_COUNT, this.inodeCount, true);
    v.setUint32(SUPERBLOCK.BLOCK_SIZE, this.blockSize, true);
    v.setUint32(SUPERBLOCK.TOTAL_BLOCKS, this.totalBlocks, true);
    v.setUint32(SUPERBLOCK.FREE_BLOCKS, this.freeBlocks, true);
    v.setFloat64(SUPERBLOCK.INODE_OFFSET, this.inodeTableOffset, true);
    v.setFloat64(SUPERBLOCK.PATH_OFFSET, this.pathTableOffset, true);
    v.setFloat64(SUPERBLOCK.DATA_OFFSET, this.dataOffset, true);
    v.setFloat64(SUPERBLOCK.BITMAP_OFFSET, this.bitmapOffset, true);
    v.setUint32(SUPERBLOCK.PATH_USED, this.pathTableUsed, true);
    v.setUint32(SUPERBLOCK.CRC32, crc32(this.superblockBuf, 0, SUPERBLOCK.CRC32), true);
    this.handle.write(this.superblockBuf, { at: 0 });
  }
  /** Flush pending bitmap and superblock writes to disk (one write each) */
  markBitmapDirty(lo, hi) {
    if (lo < this.bitmapDirtyLo) this.bitmapDirtyLo = lo;
    if (hi > this.bitmapDirtyHi) this.bitmapDirtyHi = hi;
  }
  commitPending() {
    if (this.blocksFreedsinceTrim) {
      this.trimTrailingBlocks();
      this.blocksFreedsinceTrim = false;
    }
    if (this.bitmapDirtyHi >= 0) {
      const lo = this.bitmapDirtyLo;
      const hi = this.bitmapDirtyHi;
      this.handle.write(this.bitmap.subarray(lo, hi + 1), { at: this.bitmapOffset + lo });
      this.bitmapDirtyLo = Infinity;
      this.bitmapDirtyHi = -1;
    }
    if (this.superblockDirty) {
      this.writeSuperblock();
      this.superblockDirty = false;
    }
  }
  /** Find the last used block index (-1 if the data region is empty). */
  findLastUsedBlock() {
    const bitmap = this.bitmap;
    for (let byteIdx = Math.ceil(this.totalBlocks / 8) - 1; byteIdx >= 0; byteIdx--) {
      if (bitmap[byteIdx] !== 0) {
        for (let bit = 7; bit >= 0; bit--) {
          const blockIdx = byteIdx * 8 + bit;
          if (blockIdx < this.totalBlocks && bitmap[byteIdx] & 1 << bit) {
            return blockIdx;
          }
        }
      }
    }
    return -1;
  }
  /** Shrink the OPFS file by removing trailing free blocks from the data region.
   *  Keeps PREGROW_HEADROOM_BLOCKS of free tail (see maybePreGrow) so trim and
   *  idle pre-growth don't oscillate — each truncate is a storage-IPC round
   *  trip that can stall badly on WebKit while a sync caller spins. */
  trimTrailingBlocks() {
    const lastUsed = this.findLastUsedBlock();
    const newTotal = Math.max(lastUsed + 1 + PREGROW_HEADROOM_BLOCKS, INITIAL_DATA_BLOCKS);
    if (newTotal >= this.totalBlocks) return;
    this.handle.truncate(this.dataOffset + newTotal * this.blockSize);
    const newBitmapSize = Math.ceil(newTotal / 8);
    this.bitmap = this.bitmap.slice(0, newBitmapSize);
    const trimmed = this.totalBlocks - newTotal;
    this.freeBlocks -= trimmed;
    this.totalBlocks = newTotal;
    this.superblockDirty = true;
    this.bitmapDirtyLo = 0;
    this.bitmapDirtyHi = newBitmapSize - 1;
  }
  // Throttle for maybePreGrow's tail scan (cheap, but no need to run it
  // thousands of times per second from the dispatch loop's idle phase).
  lastPreGrowCheck = 0;
  /**
   * Idle-time data-region pre-growth — call from the dispatch loop when no
   * request is pending.
   *
   * Growing the VFS file (`handle.truncate`) is the one engine operation
   * that can block on a storage-IPC round trip for ~20 seconds on WebKit
   * while a sync caller busy-spins the page's main thread (observed:
   * FWRITE engine time of exactly ~20s when allocation landed on a growth
   * boundary). Growing during idle — when nobody is spinning — takes
   * milliseconds. This keeps PREGROW_HEADROOM_BLOCKS of CONTIGUOUS trailing
   * free space (allocation is contiguous, so scattered free blocks don't
   * prevent an in-request growth), so request-path growth only happens for
   * single writes larger than the headroom.
   *
   * Returns true if the file was grown.
   */
  maybePreGrow(force = false) {
    if (!this.bitmap) return false;
    const now2 = Date.now();
    if (!force && now2 - this.lastPreGrowCheck < 250) return false;
    this.lastPreGrowCheck = now2;
    const trailingFree = this.totalBlocks - (this.findLastUsedBlock() + 1);
    if (trailingFree >= PREGROW_HEADROOM_BLOCKS) return false;
    const hardCap = Math.min(this.maxBlocks, this.bitmapCapacityBlocks());
    const wanted = Math.ceil((PREGROW_HEADROOM_BLOCKS - trailingFree) / 8) * 8;
    const addedBlocks = Math.min(wanted, hardCap - this.totalBlocks);
    if (addedBlocks <= 0) return false;
    const newTotal = this.totalBlocks + addedBlocks;
    this.handle.truncate(this.dataOffset + newTotal * this.blockSize);
    const newBitmapSize = Math.ceil(newTotal / 8);
    if (newBitmapSize > this.bitmap.byteLength) {
      const newBitmap = new Uint8Array(newBitmapSize);
      newBitmap.set(this.bitmap);
      this.bitmap = newBitmap;
    }
    this.totalBlocks = newTotal;
    this.freeBlocks += addedBlocks;
    this.superblockDirty = true;
    this.commitPending();
    return true;
  }
  /** Rebuild in-memory path→inode index from disk.
   *  Bulk-reads the entire inode table + path table in 2 I/O calls,
   *  then parses in memory (avoids 10k+ individual reads). */
  rebuildIndex() {
    this.pathIndex.clear();
    this.inodeCache.clear();
    const inodeTableSize = this.inodeCount * INODE_SIZE;
    const inodeBuf = new Uint8Array(inodeTableSize);
    this.handle.read(inodeBuf, { at: this.inodeTableOffset });
    const inodeView = new DataView(inodeBuf.buffer);
    const pathBuf = this.pathTableUsed > 0 ? new Uint8Array(this.pathTableUsed) : null;
    if (pathBuf) {
      this.handle.read(pathBuf, { at: this.pathTableOffset });
    }
    for (let i = 0; i < this.inodeCount; i++) {
      const off = i * INODE_SIZE;
      const type = inodeView.getUint8(off + INODE.TYPE);
      if (type === INODE_TYPE.FREE) continue;
      if (type < INODE_TYPE.FILE || type > INODE_TYPE.SYMLINK) {
        throw new Error(`Corrupt VFS: inode ${i} has invalid type ${type}`);
      }
      const pathOffset = inodeView.getUint32(off + INODE.PATH_OFFSET, true);
      const pathLength = inodeView.getUint16(off + INODE.PATH_LENGTH, true);
      const size = inodeView.getFloat64(off + INODE.SIZE, true);
      const firstBlock = inodeView.getUint32(off + INODE.FIRST_BLOCK, true);
      const blockCount = inodeView.getUint32(off + INODE.BLOCK_COUNT, true);
      if (pathLength === 0 || pathOffset + pathLength > this.pathTableUsed) {
        throw new Error(`Corrupt VFS: inode ${i} path out of bounds (offset=${pathOffset}, len=${pathLength}, tableUsed=${this.pathTableUsed})`);
      }
      if (type !== INODE_TYPE.DIRECTORY) {
        if (size < 0 || !isFinite(size)) {
          throw new Error(`Corrupt VFS: inode ${i} has invalid size ${size}`);
        }
        if (blockCount > 0 && firstBlock + blockCount > this.totalBlocks) {
          throw new Error(`Corrupt VFS: inode ${i} data blocks out of range (first=${firstBlock}, count=${blockCount}, total=${this.totalBlocks})`);
        }
      }
      const inode = {
        type,
        pathOffset,
        pathLength,
        nlink: inodeView.getUint16(off + INODE.NLINK, true) || 1,
        mode: inodeView.getUint32(off + INODE.MODE, true),
        size,
        firstBlock,
        blockCount,
        mtime: inodeView.getFloat64(off + INODE.MTIME, true),
        ctime: inodeView.getFloat64(off + INODE.CTIME, true),
        atime: inodeView.getFloat64(off + INODE.ATIME, true),
        uid: inodeView.getUint32(off + INODE.UID, true),
        gid: inodeView.getUint32(off + INODE.GID, true)
      };
      this.inodeCache.set(i, inode);
      let path;
      if (pathBuf) {
        path = decoder8.decode(pathBuf.subarray(inode.pathOffset, inode.pathOffset + inode.pathLength));
      } else {
        path = this.readPath(inode.pathOffset, inode.pathLength);
      }
      if (!path.startsWith("/") || path.includes("\0")) {
        throw new Error(`Corrupt VFS: inode ${i} has invalid path "${path.substring(0, 50)}"`);
      }
      this.setPathIndex(path, i);
    }
    this.pathIndexGen++;
  }
  // ========== Low-level inode I/O ==========
  readInode(idx) {
    const cached = this.inodeCache.get(idx);
    if (cached) return cached;
    const offset = this.inodeTableOffset + idx * INODE_SIZE;
    this.handle.read(this.inodeBuf, { at: offset });
    const v = this.inodeView;
    const inode = {
      type: v.getUint8(INODE.TYPE),
      pathOffset: v.getUint32(INODE.PATH_OFFSET, true),
      pathLength: v.getUint16(INODE.PATH_LENGTH, true),
      nlink: v.getUint16(INODE.NLINK, true) || 1,
      mode: v.getUint32(INODE.MODE, true),
      size: v.getFloat64(INODE.SIZE, true),
      firstBlock: v.getUint32(INODE.FIRST_BLOCK, true),
      blockCount: v.getUint32(INODE.BLOCK_COUNT, true),
      mtime: v.getFloat64(INODE.MTIME, true),
      ctime: v.getFloat64(INODE.CTIME, true),
      atime: v.getFloat64(INODE.ATIME, true),
      uid: v.getUint32(INODE.UID, true),
      gid: v.getUint32(INODE.GID, true)
    };
    this.inodeCache.set(idx, inode);
    return inode;
  }
  writeInode(idx, inode) {
    if (inode.type === INODE_TYPE.FREE) {
      this.inodeCache.delete(idx);
    } else {
      this.inodeCache.set(idx, inode);
    }
    const v = this.inodeView;
    v.setUint8(INODE.TYPE, inode.type);
    v.setUint8(INODE.FLAGS, 0);
    v.setUint8(INODE.FLAGS + 1, 0);
    v.setUint8(INODE.FLAGS + 2, 0);
    v.setUint32(INODE.PATH_OFFSET, inode.pathOffset, true);
    v.setUint16(INODE.PATH_LENGTH, inode.pathLength, true);
    v.setUint16(INODE.NLINK, inode.nlink, true);
    v.setUint32(INODE.MODE, inode.mode, true);
    v.setFloat64(INODE.SIZE, inode.size, true);
    v.setUint32(INODE.FIRST_BLOCK, inode.firstBlock, true);
    v.setUint32(INODE.BLOCK_COUNT, inode.blockCount, true);
    v.setFloat64(INODE.MTIME, inode.mtime, true);
    v.setFloat64(INODE.CTIME, inode.ctime, true);
    v.setFloat64(INODE.ATIME, inode.atime, true);
    v.setUint32(INODE.UID, inode.uid, true);
    v.setUint32(INODE.GID, inode.gid, true);
    const offset = this.inodeTableOffset + idx * INODE_SIZE;
    this.handle.write(this.inodeBuf, { at: offset });
  }
  // ========== Path table I/O ==========
  readPath(offset, length) {
    const buf = new Uint8Array(length);
    this.handle.read(buf, { at: this.pathTableOffset + offset });
    return decoder8.decode(buf);
  }
  appendPath(path) {
    const bytes = encoder10.encode(path);
    const offset = this.pathTableUsed;
    if (offset + bytes.byteLength > this.pathTableSize) {
      this.growPathTable(offset + bytes.byteLength);
    }
    this.handle.write(bytes, { at: this.pathTableOffset + offset });
    this.pathTableUsed += bytes.byteLength;
    this.superblockDirty = true;
    return { offset, length: bytes.byteLength };
  }
  growPathTable(needed) {
    const newSize = Math.max(this.pathTableSize * 2, needed + INITIAL_PATH_TABLE_SIZE);
    const growth = newSize - this.pathTableSize;
    const newTotalSize = this.handle.getSize() + growth;
    this.handle.truncate(newTotalSize);
    const dataSize = this.totalBlocks * this.blockSize;
    const CHUNK = 4 * 1024 * 1024;
    const scratch = new Uint8Array(Math.min(CHUNK, Math.max(dataSize, 1)));
    let remaining = dataSize;
    while (remaining > 0) {
      const chunk = Math.min(remaining, CHUNK);
      const srcAt = this.dataOffset + (remaining - chunk);
      const dstAt = this.dataOffset + growth + (remaining - chunk);
      const slice = chunk < scratch.length ? scratch.subarray(0, chunk) : scratch;
      this.handle.read(slice, { at: srcAt });
      this.handle.write(slice, { at: dstAt });
      remaining -= chunk;
    }
    const newBitmapOffset = this.bitmapOffset + growth;
    const newDataOffset = this.dataOffset + growth;
    this.handle.write(this.bitmap, { at: newBitmapOffset });
    this.pathTableSize = newSize;
    this.bitmapOffset = newBitmapOffset;
    this.dataOffset = newDataOffset;
    this.superblockDirty = true;
  }
  // ========== Bitmap I/O ==========
  // Write `length` zero bytes at absolute file offset `at` via a small
  // reusable scratch buffer. Used to materialize POSIX "holes" when a
  // write starts past the current file size — those bytes must read as
  // zeros rather than whatever stale data happened to live in the
  // underlying storage blocks.
  zeroFileRange(at, length) {
    if (length <= 0) return;
    const CHUNK = 4 * 1024 * 1024;
    const zeros = new Uint8Array(Math.min(length, CHUNK));
    let written = 0;
    while (written < length) {
      const n = Math.min(CHUNK, length - written);
      const slice = n < zeros.length ? zeros.subarray(0, n) : zeros;
      this.handle.write(slice, { at: at + written });
      written += n;
    }
  }
  /**
   * Find and reserve `count` contiguous free blocks.
   *
   * Next-fit: the search resumes where the last allocation ended and wraps once, rather than
   * restarting at block 0 every time. Restarting meant each allocation first walked past every
   * block already in use, so creating files into a filling volume cost O(allocated) each and
   * O(n²) overall — measured at 8 µs per create on an empty volume rising to 16 µs by 16k files.
   * With a cursor, sequential allocation is O(count).
   *
   * Wrapping preserves the old guarantee that the volume only grows when no contiguous run
   * exists anywhere: the second pass covers everything below the cursor, extended by `count - 1`
   * so a run straddling the cursor is still found.
   */
  allocateBlocks(count) {
    if (count === 0) return 0;
    let start = this.scanForRun(this.allocCursor, this.totalBlocks, count);
    if (start < 0 && this.allocCursor > 0) {
      const wrapEnd = Math.min(this.allocCursor + count - 1, this.totalBlocks);
      start = this.scanForRun(0, wrapEnd, count);
    }
    if (start < 0) return this.growAndAllocate(count);
    const end = start + count - 1;
    const bitmap = this.bitmap;
    for (let j = start; j <= end; j++) bitmap[j >>> 3] |= 1 << (j & 7);
    this.markBitmapDirty(start >>> 3, end >>> 3);
    this.freeBlocks -= count;
    this.superblockDirty = true;
    this.allocCursor = end + 1 >= this.totalBlocks ? 0 : end + 1;
    return start;
  }
  /**
   * First index in [from, to) starting a run of `count` free blocks, or -1.
   *
   * Fully-allocated bytes are skipped eight blocks at a time. That matters on a filling volume,
   * where the overwhelming majority of the bitmap the scan crosses is solid 0xFF.
   */
  scanForRun(from, to, count) {
    const bitmap = this.bitmap;
    let run = 0;
    let start = from;
    for (let i = from; i < to; i++) {
      if (run === 0 && (i & 7) === 0 && bitmap[i >>> 3] === 255) {
        i += 7;
        start = i + 1;
        continue;
      }
      if (bitmap[i >>> 3] >>> (i & 7) & 1) {
        run = 0;
        start = i + 1;
      } else if (++run === count) {
        return start;
      }
    }
    return -1;
  }
  /** Highest block count the reserved on-disk bitmap region can represent.
   *  The bitmap lives in [bitmapOffset, dataOffset); each byte covers 8 blocks.
   *  Growing past this would write bitmap bytes into the data region (silent
   *  corruption) — the bug fixed by reserving the region for maxBlocks at
   *  format. This is the authoritative ceiling for any layout, new or legacy. */
  bitmapCapacityBlocks() {
    return (this.dataOffset - this.bitmapOffset) * 8;
  }
  growAndAllocate(count) {
    const oldTotal = this.totalBlocks;
    const hardCap = Math.min(this.maxBlocks, this.bitmapCapacityBlocks());
    let newTotal = Math.max(oldTotal * 2, oldTotal + count);
    if (newTotal > hardCap) newTotal = hardCap;
    if (newTotal < oldTotal + count) {
      throw new Error(`ENOSPC: cannot allocate ${count} blocks (total ${oldTotal}, ceiling ${hardCap})`);
    }
    const addedBlocks = newTotal - oldTotal;
    const newFileSize = this.dataOffset + newTotal * this.blockSize;
    this.handle.truncate(newFileSize);
    const newBitmapSize = Math.ceil(newTotal / 8);
    const newBitmap = new Uint8Array(newBitmapSize);
    newBitmap.set(this.bitmap);
    this.bitmap = newBitmap;
    this.totalBlocks = newTotal;
    this.freeBlocks += addedBlocks;
    const start = oldTotal;
    for (let j = start; j < start + count; j++) {
      const bj = j >>> 3;
      const bi = j & 7;
      this.bitmap[bj] |= 1 << bi;
    }
    this.markBitmapDirty(start >>> 3, start + count - 1 >>> 3);
    this.freeBlocks -= count;
    this.superblockDirty = true;
    return start;
  }
  blocksFreedsinceTrim = false;
  freeBlockRange(start, count) {
    if (count === 0) return;
    const bitmap = this.bitmap;
    for (let i = start; i < start + count; i++) {
      const byteIdx = i >>> 3;
      const bitIdx = i & 7;
      bitmap[byteIdx] &= ~(1 << bitIdx);
    }
    this.markBitmapDirty(start >>> 3, start + count - 1 >>> 3);
    this.freeBlocks += count;
    this.superblockDirty = true;
    this.blocksFreedsinceTrim = true;
  }
  // updateSuperblockFreeBlocks is no longer needed — superblock writes are coalesced via commitPending()
  // ========== Inode allocation ==========
  findFreeInode() {
    for (let i = this.freeInodeHint; i < this.inodeCount; i++) {
      if (this.inodeCache.has(i)) continue;
      const offset = this.inodeTableOffset + i * INODE_SIZE;
      const typeBuf = new Uint8Array(1);
      this.handle.read(typeBuf, { at: offset });
      if (typeBuf[0] === INODE_TYPE.FREE) {
        this.freeInodeHint = i + 1;
        return i;
      }
    }
    const idx = this.growInodeTable();
    this.freeInodeHint = idx + 1;
    return idx;
  }
  growInodeTable() {
    const oldCount = this.inodeCount;
    const newCount = oldCount * 2;
    const growth = (newCount - oldCount) * INODE_SIZE;
    const afterInodeOffset = this.inodeTableOffset + oldCount * INODE_SIZE;
    const totalSize = this.handle.getSize();
    const afterSize = totalSize - afterInodeOffset;
    this.handle.truncate(totalSize + growth);
    const SHIFT_CHUNK = 8 * 1024 * 1024;
    if (afterSize > 0) {
      const buf = new Uint8Array(Math.min(SHIFT_CHUNK, afterSize));
      let remaining = afterSize;
      while (remaining > 0) {
        const n = Math.min(SHIFT_CHUNK, remaining);
        const srcAt = afterInodeOffset + remaining - n;
        const view = n === buf.length ? buf : buf.subarray(0, n);
        this.handle.read(view, { at: srcAt });
        this.handle.write(view, { at: srcAt + growth });
        remaining -= n;
      }
    }
    const zChunk = new Uint8Array(Math.min(SHIFT_CHUNK, growth));
    let zRemaining = growth;
    let zOffset = afterInodeOffset;
    while (zRemaining > 0) {
      const n = Math.min(SHIFT_CHUNK, zRemaining);
      this.handle.write(n === zChunk.length ? zChunk : zChunk.subarray(0, n), { at: zOffset });
      zOffset += n;
      zRemaining -= n;
    }
    this.pathTableOffset += growth;
    this.bitmapOffset += growth;
    this.dataOffset += growth;
    this.inodeCount = newCount;
    this.superblockDirty = true;
    return oldCount;
  }
  // ========== Data I/O ==========
  readData(firstBlock, blockCount, size) {
    const buf = new Uint8Array(size);
    const offset = this.dataOffset + firstBlock * this.blockSize;
    this.handle.read(buf, { at: offset });
    return buf;
  }
  writeData(firstBlock, data) {
    const offset = this.dataOffset + firstBlock * this.blockSize;
    this.handle.write(data, { at: offset });
  }
  // ========== Path resolution ==========
  resolvePath(path, depth = 0) {
    if (depth === 0) this.symlinkLoopDetected = false;
    if (depth > MAX_SYMLINK_DEPTH) {
      this.symlinkLoopDetected = true;
      return void 0;
    }
    const idx = this.pathIndex.get(path);
    if (idx === void 0) {
      return this.resolvePathComponents(path, true, depth);
    }
    const inode = this.readInode(idx);
    if (inode.type === INODE_TYPE.SYMLINK) {
      const target = decoder8.decode(this.readData(inode.firstBlock, inode.blockCount, inode.size));
      const resolved = target.startsWith("/") ? target : this.resolveRelative(path, target);
      return this.resolvePath(resolved, depth + 1);
    }
    return idx;
  }
  /** Resolve symlinks in intermediate path components */
  resolvePathComponents(path, followLast = true, depth = 0) {
    const result = this.resolvePathFull(path, followLast, depth);
    return result?.idx;
  }
  /**
   * Resolve a path following symlinks, returning both the inode index AND the
   * fully resolved path. This is needed by readdir: when listing a symlinked
   * directory, we must search for children under the resolved target path
   * (where files actually exist in pathIndex), not under the symlink path.
   */
  resolvePathFull(path, followLast = true, depth = 0) {
    if (depth === 0) this.symlinkLoopDetected = false;
    if (depth > MAX_SYMLINK_DEPTH) {
      this.symlinkLoopDetected = true;
      return void 0;
    }
    const parts = path.split("/").filter(Boolean);
    let current = "/";
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      current = current === "/" ? "/" + parts[i] : current + "/" + parts[i];
      const idx = this.pathIndex.get(current);
      if (idx === void 0) return void 0;
      const inode = this.readInode(idx);
      if (inode.type === INODE_TYPE.SYMLINK && (!isLast || followLast)) {
        const target = decoder8.decode(this.readData(inode.firstBlock, inode.blockCount, inode.size));
        const resolved = target.startsWith("/") ? target : this.resolveRelative(current, target);
        if (isLast) {
          return this.resolvePathFull(resolved, true, depth + 1);
        }
        const remaining = parts.slice(i + 1).join("/");
        const newPath = resolved + (remaining ? "/" + remaining : "");
        return this.resolvePathFull(newPath, followLast, depth + 1);
      }
    }
    const finalIdx = this.pathIndex.get(current);
    if (finalIdx === void 0) return void 0;
    return { idx: finalIdx, resolvedPath: current };
  }
  /**
   * Follow a symlink chain to the path a *create* should land on.
   *
   * `resolvePathFull` gives up when the final target does not exist, which is exactly the
   * dangling-link case: `writeFileSync('/link', …)` where `/link` → `t3` and `t3` is absent.
   * Callers then created a file at `/link` itself, destroying the symlink — Node follows the
   * link and creates `/t3`, leaving the link intact.
   *
   * Returns `path` unchanged when it is not a symlink, so callers on the common path pay a
   * single Map lookup, and `null` when the chain exceeds MAX_SYMLINK_DEPTH — a cycle, which
   * callers must report as ELOOP rather than writing to wherever the walk happened to stop.
   */
  resolveDanglingLink(path, depth = 0) {
    if (depth > MAX_SYMLINK_DEPTH) return null;
    const idx = this.pathIndex.get(path);
    if (idx === void 0) return path;
    const inode = this.readInode(idx);
    if (inode.type !== INODE_TYPE.SYMLINK) return path;
    const target = decoder8.decode(this.readData(inode.firstBlock, inode.blockCount, inode.size));
    const resolved = target.startsWith("/") ? target : this.resolveRelative(path, target);
    return this.resolveDanglingLink(resolved, depth + 1);
  }
  resolveRelative(from, target) {
    const dir = from.substring(0, from.lastIndexOf("/")) || "/";
    const parts = (dir + "/" + target).split("/").filter(Boolean);
    const resolved = [];
    for (const p of parts) {
      if (p === ".") continue;
      if (p === "..") {
        resolved.pop();
        continue;
      }
      resolved.push(p);
    }
    return "/" + resolved.join("/");
  }
  // ========== Core inode creation helper ==========
  createInode(path, type, mode, size, data) {
    const idx = this.findFreeInode();
    const { offset: pathOff, length: pathLen } = this.appendPath(path);
    const now2 = Date.now();
    let firstBlock = 0;
    let blockCount = 0;
    if (data && data.byteLength > 0) {
      blockCount = Math.ceil(data.byteLength / this.blockSize);
      firstBlock = this.allocateBlocks(blockCount);
      this.writeData(firstBlock, data);
    }
    const inode = {
      type,
      pathOffset: pathOff,
      pathLength: pathLen,
      nlink: type === INODE_TYPE.DIRECTORY ? 2 : 1,
      mode,
      size,
      firstBlock,
      blockCount,
      mtime: now2,
      ctime: now2,
      atime: now2,
      uid: this.processUid,
      gid: this.processGid
    };
    this.writeInode(idx, inode);
    this.setPathIndex(path, idx);
    this.pathIndexGen++;
    return idx;
  }
  // ========== Public API — called by server worker dispatch ==========
  /** Normalize a path: ensure leading /, resolve . and .. */
  normalizePath(p) {
    if (p.charCodeAt(0) !== 47) p = "/" + p;
    if (p.length === 1) return p;
    if (p.indexOf("/.") === -1 && p.indexOf("//") === -1 && p.charCodeAt(p.length - 1) !== 47) {
      return p;
    }
    const parts = p.split("/").filter(Boolean);
    const resolved = [];
    for (const part of parts) {
      if (part === ".") continue;
      if (part === "..") {
        resolved.pop();
        continue;
      }
      resolved.push(part);
    }
    return "/" + resolved.join("/");
  }
  // ---- READ ----
  read(path) {
    const t0 = this.debug ? performance.now() : 0;
    path = this.normalizePath(path);
    let idx = this.pathIndex.get(path);
    if (idx !== void 0) {
      const inode2 = this.inodeCache.get(idx);
      if (inode2) {
        if (inode2.type === INODE_TYPE.SYMLINK) {
          idx = this.resolvePathComponents(path, true);
        } else if (inode2.type === INODE_TYPE.DIRECTORY) {
          return { status: CODE_TO_STATUS.EISDIR, data: null };
        } else {
          const data2 = inode2.size > 0 ? this.readData(inode2.firstBlock, inode2.blockCount, inode2.size) : new Uint8Array(0);
          if (this.debug) {
            const t1 = performance.now();
            console.log(`[VFS read] path=${path} size=${inode2.size} TOTAL=${(t1 - t0).toFixed(3)}ms (fast)`);
          }
          return { status: 0, data: data2 };
        }
      }
    }
    if (idx === void 0) idx = this.resolvePathComponents(path, true);
    if (idx === void 0) return { status: this.resolveFailureStatus(), data: null };
    const inode = this.readInode(idx);
    if (inode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EISDIR, data: null };
    const data = inode.size > 0 ? this.readData(inode.firstBlock, inode.blockCount, inode.size) : new Uint8Array(0);
    if (this.debug) {
      const t1 = performance.now();
      console.log(`[VFS read] path=${path} size=${inode.size} TOTAL=${(t1 - t0).toFixed(3)}ms (slow path)`);
    }
    return { status: 0, data };
  }
  // ---- WRITE ----
  write(path, data, flags = 0) {
    const t0 = this.debug ? performance.now() : 0;
    path = this.normalizePath(path);
    const t1 = this.debug ? performance.now() : 0;
    const parentStatus = this.ensureParent(path);
    if (parentStatus !== 0) return { status: parentStatus };
    const t2 = this.debug ? performance.now() : 0;
    let existingIdx = this.resolvePathComponents(path, true);
    if (existingIdx === void 0) {
      const linkTarget = this.resolveDanglingLink(path);
      if (linkTarget === null) return { status: CODE_TO_STATUS.ELOOP };
      if (linkTarget !== path) {
        path = linkTarget;
        const targetParentStatus = this.ensureParent(path);
        if (targetParentStatus !== 0) return { status: targetParentStatus };
        existingIdx = this.resolvePathComponents(path, true);
      }
    }
    const t3 = this.debug ? performance.now() : 0;
    let tAlloc = t3, tData = t3, tInode = t3;
    if (existingIdx !== void 0) {
      const inode = this.readInode(existingIdx);
      if (inode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EISDIR };
      const neededBlocks = Math.ceil(data.byteLength / this.blockSize);
      if (neededBlocks <= inode.blockCount) {
        tAlloc = this.debug ? performance.now() : 0;
        this.writeData(inode.firstBlock, data);
        tData = this.debug ? performance.now() : 0;
        if (neededBlocks < inode.blockCount) {
          this.freeBlockRange(inode.firstBlock + neededBlocks, inode.blockCount - neededBlocks);
        }
      } else {
        this.freeBlockRange(inode.firstBlock, inode.blockCount);
        const newFirst = this.allocateBlocks(neededBlocks);
        tAlloc = this.debug ? performance.now() : 0;
        this.writeData(newFirst, data);
        tData = this.debug ? performance.now() : 0;
        inode.firstBlock = newFirst;
      }
      inode.size = data.byteLength;
      inode.blockCount = neededBlocks;
      inode.mtime = Date.now();
      this.writeInode(existingIdx, inode);
      tInode = this.debug ? performance.now() : 0;
    } else {
      if (this.isImplicitDirectory(path)) return { status: CODE_TO_STATUS.EISDIR };
      const mode = DEFAULT_FILE_MODE & ~(this.umask & 511);
      this.createInode(path, INODE_TYPE.FILE, mode, data.byteLength, data);
      tAlloc = this.debug ? performance.now() : 0;
      tData = tAlloc;
      tInode = tAlloc;
    }
    this.commitPending();
    if (flags & 1) {
      this.handle.flush();
    }
    const tFlush = this.debug ? performance.now() : 0;
    if (this.debug) {
      const existing = existingIdx !== void 0;
      console.log(`[VFS write] path=${path} size=${data.byteLength} ${existing ? "UPDATE" : "CREATE"} normalize=${(t1 - t0).toFixed(3)}ms parent=${(t2 - t1).toFixed(3)}ms resolve=${(t3 - t2).toFixed(3)}ms alloc=${(tAlloc - t3).toFixed(3)}ms data=${(tData - tAlloc).toFixed(3)}ms inode=${(tInode - tData).toFixed(3)}ms flush=${(tFlush - tInode).toFixed(3)}ms TOTAL=${(tFlush - t0).toFixed(3)}ms`);
    }
    return { status: 0 };
  }
  // ---- APPEND ----
  append(path, data) {
    path = this.normalizePath(path);
    const existingIdx = this.resolvePathComponents(path, true);
    if (existingIdx === void 0) {
      return this.write(path, data);
    }
    const inode = this.readInode(existingIdx);
    if (inode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EISDIR };
    const combinedSize = inode.size + data.byteLength;
    const neededBlocks = Math.ceil(combinedSize / this.blockSize);
    if (neededBlocks <= inode.blockCount) {
      this.handle.write(data, { at: this.dataOffset + inode.firstBlock * this.blockSize + inode.size });
      inode.size = combinedSize;
      inode.mtime = Date.now();
      this.writeInode(existingIdx, inode);
      this.commitPending();
      return { status: 0 };
    }
    const newFirst = this.allocateBlocks(neededBlocks);
    const newBase = this.dataOffset + newFirst * this.blockSize;
    if (inode.size > 0) {
      const oldBase = this.dataOffset + inode.firstBlock * this.blockSize;
      const CHUNK = 4 * 1024 * 1024;
      const scratch = new Uint8Array(Math.min(CHUNK, inode.size));
      let copied = 0;
      while (copied < inode.size) {
        const n = Math.min(CHUNK, inode.size - copied);
        const slice = n < scratch.length ? scratch.subarray(0, n) : scratch;
        this.handle.read(slice, { at: oldBase + copied });
        this.handle.write(slice, { at: newBase + copied });
        copied += n;
      }
    }
    this.freeBlockRange(inode.firstBlock, inode.blockCount);
    this.handle.write(data, { at: newBase + inode.size });
    inode.firstBlock = newFirst;
    inode.blockCount = neededBlocks;
    inode.size = combinedSize;
    inode.mtime = Date.now();
    this.writeInode(existingIdx, inode);
    this.commitPending();
    return { status: 0 };
  }
  // ---- UNLINK ----
  unlink(path) {
    path = this.normalizePath(path);
    const idx = this.pathIndex.get(path);
    if (idx === void 0) return { status: CODE_TO_STATUS.ENOENT };
    const inode = this.readInode(idx);
    if (inode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EISDIR };
    inode.nlink = Math.max(0, inode.nlink - 1);
    this.freeBlockRange(inode.firstBlock, inode.blockCount);
    inode.type = INODE_TYPE.FREE;
    this.writeInode(idx, inode);
    this.deletePathIndex(path);
    this.pathIndexGen++;
    if (idx < this.freeInodeHint) this.freeInodeHint = idx;
    this.commitPending();
    return { status: 0 };
  }
  // ---- STAT ----
  stat(path) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === void 0) {
      const failure = this.resolveFailureStatus();
      if (this.isImplicitDirectory(path)) {
        return this.encodeImplicitDirStatResponse(path);
      }
      return { status: failure, data: null };
    }
    return this.encodeStatResponse(idx);
  }
  // ---- LSTAT (no symlink follow for the FINAL component) ----
  lstat(path) {
    path = this.normalizePath(path);
    let idx = this.resolvePathComponents(path, false);
    if (idx === void 0) {
      idx = this.resolvePathComponents(path, true);
      if (idx === void 0) {
        if (this.isImplicitDirectory(path)) {
          return this.encodeImplicitDirStatResponse(path);
        }
        return { status: CODE_TO_STATUS.ENOENT, data: null };
      }
    }
    return this.encodeStatResponse(idx);
  }
  encodeStatResponse(idx) {
    const inode = this.readInode(idx);
    let nlink = inode.nlink;
    if (inode.type === INODE_TYPE.DIRECTORY) {
      nlink = 2 + this.countSubdirectories(this.readPath(inode.pathOffset, inode.pathLength));
    }
    const buf = new Uint8Array(53);
    const view = new DataView(buf.buffer);
    view.setUint8(0, inode.type);
    view.setUint32(1, inode.mode, true);
    view.setFloat64(5, inode.size, true);
    view.setFloat64(13, inode.mtime, true);
    view.setFloat64(21, inode.ctime, true);
    view.setFloat64(29, inode.atime, true);
    view.setUint32(37, inode.uid, true);
    view.setUint32(41, inode.gid, true);
    view.setUint32(45, idx, true);
    view.setUint32(49, nlink, true);
    return { status: 0, data: buf };
  }
  // ---- MKDIR ----
  /**
   * mkdir(2). `reqMode` is the caller's requested permission mode; the umask is subtracted from it
   * here exactly as the kernel does. It defaults to 0o777 so an omitted mode still lands on the
   * historical 0o755 under the default 0o022 umask.
   *
   * Honouring the mode is not cosmetic: software that creates a private directory and then stats it
   * back treats a widened mode as a security failure and aborts. Chrome's ProcessSingleton is the
   * canonical case — it mkdtemp()s its socket directory and CHECKs that the mode is exactly 0700,
   * killing the browser at startup when the filesystem silently returns 0755.
   */
  mkdir(path, flags = 0, reqMode = 511) {
    path = this.normalizePath(path);
    const recursive = (flags & 1) !== 0;
    if (recursive) {
      return this.mkdirRecursive(path, reqMode);
    }
    if (this.pathIndex.has(path) || this.isImplicitDirectory(path)) {
      return { status: CODE_TO_STATUS.EEXIST, data: null };
    }
    const parentStatus = this.ensureParent(path);
    if (parentStatus !== 0) return { status: parentStatus, data: null };
    this.createInode(path, INODE_TYPE.DIRECTORY, this.dirModeFor(reqMode), 0);
    this.commitPending();
    return { status: 0, data: null };
  }
  /** Permission bits a new directory gets: the request minus the umask, plus the S_IFDIR type. */
  dirModeFor(reqMode) {
    return S_IFDIR | reqMode & 4095 & ~(this.umask & 511);
  }
  /** Same, for a newly created regular file. Node's open defaults reqMode to 0o666 → 0o644. */
  fileModeFor(reqMode) {
    return S_IFREG | reqMode & 4095 & ~(this.umask & 511);
  }
  mkdirRecursive(path, reqMode = 511) {
    const parts = path.split("/").filter(Boolean);
    let current = "";
    let firstCreated = null;
    for (const part of parts) {
      current += "/" + part;
      if (this.pathIndex.has(current)) {
        const idx = this.pathIndex.get(current);
        const inode = this.readInode(idx);
        if (inode.type !== INODE_TYPE.DIRECTORY) {
          return { status: CODE_TO_STATUS.ENOTDIR, data: null };
        }
        continue;
      }
      this.createInode(current, INODE_TYPE.DIRECTORY, this.dirModeFor(reqMode), 0);
      if (!firstCreated) firstCreated = current;
    }
    this.commitPending();
    const result = firstCreated ? encoder10.encode(firstCreated) : void 0;
    return { status: 0, data: result ?? null };
  }
  // ---- RMDIR ----
  rmdir(path, flags = 0) {
    path = this.normalizePath(path);
    const recursive = (flags & 1) !== 0;
    const idx = this.pathIndex.get(path);
    if (idx === void 0) {
      if (this.isImplicitDirectory(path)) {
        const children2 = this.getDirectChildrenWithImplicit(path);
        if (children2.length > 0) {
          if (!recursive) return { status: CODE_TO_STATUS.ENOTEMPTY };
          for (const desc of this.getAllDescendants(path)) {
            const descIdx = this.pathIndex.get(desc);
            const descInode = this.readInode(descIdx);
            this.freeBlockRange(descInode.firstBlock, descInode.blockCount);
            descInode.type = INODE_TYPE.FREE;
            this.writeInode(descIdx, descInode);
            this.deletePathIndex(desc);
          }
          this.pathIndexGen++;
          this.commitPending();
        }
        return { status: 0 };
      }
      return { status: CODE_TO_STATUS.ENOENT };
    }
    const inode = this.readInode(idx);
    if (inode.type !== INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.ENOTDIR };
    const children = this.getDirectChildren(path);
    if (children.length > 0) {
      if (!recursive) return { status: CODE_TO_STATUS.ENOTEMPTY };
      for (const child of this.getAllDescendants(path)) {
        const childIdx = this.pathIndex.get(child);
        const childInode = this.readInode(childIdx);
        this.freeBlockRange(childInode.firstBlock, childInode.blockCount);
        childInode.type = INODE_TYPE.FREE;
        this.writeInode(childIdx, childInode);
        this.deletePathIndex(child);
      }
    }
    if (path === "/") {
      this.pathIndexGen++;
      this.commitPending();
      return { status: 0 };
    }
    inode.type = INODE_TYPE.FREE;
    this.writeInode(idx, inode);
    this.deletePathIndex(path);
    this.pathIndexGen++;
    if (idx < this.freeInodeHint) this.freeInodeHint = idx;
    this.commitPending();
    return { status: 0 };
  }
  // ---- READDIR ----
  readdir(path, flags = 0) {
    path = this.normalizePath(path);
    const resolved = this.resolvePathFull(path, true);
    let effectiveDirPath;
    if (resolved) {
      const inode = this.readInode(resolved.idx);
      if (inode.type !== INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.ENOTDIR, data: null };
      effectiveDirPath = resolved.resolvedPath;
    } else if (this.isImplicitDirectory(path)) {
      effectiveDirPath = path;
    } else {
      return { status: CODE_TO_STATUS.ENOENT, data: null };
    }
    const withFileTypes = (flags & 1) !== 0;
    if (withFileTypes) {
      this.ensureChildIndex();
      const typedNames = this.childIndex.get(effectiveDirPath);
      if (!typedNames) return { status: 0, data: new Uint8Array([0, 0, 0, 0]) };
      const names2 = [...typedNames.keys()].sort();
      const prefix = effectiveDirPath === "/" ? "/" : effectiveDirPath + "/";
      let capacity2 = 4;
      for (const name of names2) capacity2 += 3 + name.length * 3;
      const buf2 = new Uint8Array(capacity2);
      const view2 = new DataView(buf2.buffer);
      view2.setUint32(0, names2.length, true);
      let offset2 = 4;
      for (const name of names2) {
        const { written } = encoder10.encodeInto(name, buf2.subarray(offset2 + 2));
        view2.setUint16(offset2, written, true);
        offset2 += 2 + written;
        const childIdx = this.pathIndex.get(prefix + name);
        buf2[offset2++] = childIdx === void 0 ? INODE_TYPE.DIRECTORY : this.readInode(childIdx).type;
      }
      return { status: 0, data: buf2.subarray(0, offset2) };
    }
    this.ensureChildIndex();
    const childNames = this.childIndex.get(effectiveDirPath);
    if (!childNames) return { status: 0, data: new Uint8Array([0, 0, 0, 0]) };
    const names = [...childNames.keys()].sort();
    let capacity = 4;
    for (const name of names) capacity += 2 + name.length * 3;
    const buf = new Uint8Array(capacity);
    const view = new DataView(buf.buffer);
    view.setUint32(0, names.length, true);
    let offset = 4;
    for (const name of names) {
      const { written } = encoder10.encodeInto(name, buf.subarray(offset + 2));
      view.setUint16(offset, written, true);
      offset += 2 + written;
    }
    return { status: 0, data: buf.subarray(0, offset) };
  }
  // ---- RENAME ----
  rename(oldPath, newPath) {
    oldPath = this.normalizePath(oldPath);
    newPath = this.normalizePath(newPath);
    const idx = this.pathIndex.get(oldPath);
    if (idx === void 0) return { status: CODE_TO_STATUS.ENOENT };
    if (oldPath === newPath) return { status: 0 };
    const parentStatus = this.ensureParent(newPath);
    if (parentStatus !== 0) return { status: parentStatus };
    const existingIdx = this.pathIndex.get(newPath);
    const targetIsImplicitDir = existingIdx === void 0 && this.isImplicitDirectory(newPath);
    if (existingIdx !== void 0 || targetIsImplicitDir) {
      const srcIsDir = this.readInode(idx).type === INODE_TYPE.DIRECTORY;
      const dstIsDir = targetIsImplicitDir || existingIdx !== void 0 && this.readInode(existingIdx).type === INODE_TYPE.DIRECTORY;
      if (srcIsDir && !dstIsDir) return { status: CODE_TO_STATUS.ENOTDIR };
      if (!srcIsDir && dstIsDir) return { status: CODE_TO_STATUS.EISDIR };
    }
    if (existingIdx !== void 0 || targetIsImplicitDir) {
      let cleanDescendants = targetIsImplicitDir;
      if (existingIdx !== void 0) {
        const existingInode = this.readInode(existingIdx);
        cleanDescendants = existingInode.type === INODE_TYPE.DIRECTORY;
        this.freeBlockRange(existingInode.firstBlock, existingInode.blockCount);
        existingInode.type = INODE_TYPE.FREE;
        this.writeInode(existingIdx, existingInode);
        this.deletePathIndex(newPath);
        if (existingIdx < this.freeInodeHint) this.freeInodeHint = existingIdx;
      }
      if (cleanDescendants) {
        for (const desc of this.getAllDescendants(newPath)) {
          const descIdx = this.pathIndex.get(desc);
          const descInode = this.readInode(descIdx);
          this.freeBlockRange(descInode.firstBlock, descInode.blockCount);
          descInode.type = INODE_TYPE.FREE;
          this.writeInode(descIdx, descInode);
          this.deletePathIndex(desc);
          if (descIdx < this.freeInodeHint) this.freeInodeHint = descIdx;
        }
      }
    }
    const inode = this.readInode(idx);
    const { offset: pathOff, length: pathLen } = this.appendPath(newPath);
    inode.pathOffset = pathOff;
    inode.pathLength = pathLen;
    inode.mtime = Date.now();
    this.writeInode(idx, inode);
    this.deletePathIndex(oldPath);
    this.setPathIndex(newPath, idx);
    this.pathIndexGen++;
    if (inode.type === INODE_TYPE.DIRECTORY) {
      const prefix = oldPath === "/" ? "/" : oldPath + "/";
      const toRename = [];
      for (const [p, i] of this.pathIndex) {
        if (p.startsWith(prefix)) {
          toRename.push([p, i]);
        }
      }
      for (const [p, i] of toRename) {
        const suffix = p.substring(oldPath.length);
        const childNewPath = newPath + suffix;
        const childInode = this.readInode(i);
        const { offset: cpo, length: cpl } = this.appendPath(childNewPath);
        childInode.pathOffset = cpo;
        childInode.pathLength = cpl;
        this.writeInode(i, childInode);
        this.deletePathIndex(p);
        this.setPathIndex(childNewPath, i);
      }
    }
    this.commitPending();
    return { status: 0 };
  }
  // ---- EXISTS ----
  exists(path) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    const buf = new Uint8Array(1);
    buf[0] = idx !== void 0 || this.isImplicitDirectory(path) ? 1 : 0;
    return { status: 0, data: buf };
  }
  // ---- TRUNCATE ----
  truncate(path, len = 0) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === void 0) return { status: this.resolveFailureStatus() };
    const inode = this.readInode(idx);
    if (inode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EISDIR };
    if (len === 0) {
      this.freeBlockRange(inode.firstBlock, inode.blockCount);
      inode.firstBlock = 0;
      inode.blockCount = 0;
      inode.size = 0;
    } else if (len < inode.size) {
      const neededBlocks = Math.ceil(len / this.blockSize);
      if (neededBlocks < inode.blockCount) {
        this.freeBlockRange(inode.firstBlock + neededBlocks, inode.blockCount - neededBlocks);
      }
      inode.blockCount = neededBlocks;
      inode.size = len;
    } else if (len > inode.size) {
      const neededBlocks = Math.ceil(len / this.blockSize);
      if (neededBlocks > inode.blockCount) {
        const newFirst = this.allocateBlocks(neededBlocks);
        const newBase = this.dataOffset + newFirst * this.blockSize;
        if (inode.size > 0) {
          const oldBase = this.dataOffset + inode.firstBlock * this.blockSize;
          const CHUNK = 4 * 1024 * 1024;
          const scratch = new Uint8Array(Math.min(CHUNK, inode.size));
          let copied = 0;
          while (copied < inode.size) {
            const n = Math.min(CHUNK, inode.size - copied);
            const slice = n < scratch.length ? scratch.subarray(0, n) : scratch;
            this.handle.read(slice, { at: oldBase + copied });
            this.handle.write(slice, { at: newBase + copied });
            copied += n;
          }
        }
        this.freeBlockRange(inode.firstBlock, inode.blockCount);
        this.zeroFileRange(newBase + inode.size, len - inode.size);
        inode.firstBlock = newFirst;
      } else {
        this.zeroFileRange(
          this.dataOffset + inode.firstBlock * this.blockSize + inode.size,
          len - inode.size
        );
      }
      inode.blockCount = neededBlocks;
      inode.size = len;
    }
    inode.mtime = Date.now();
    this.writeInode(idx, inode);
    this.commitPending();
    return { status: 0 };
  }
  // ---- COPY ----
  copy(srcPath, destPath, flags = 0) {
    srcPath = this.normalizePath(srcPath);
    destPath = this.normalizePath(destPath);
    const srcIdx = this.resolvePathComponents(srcPath, true);
    if (srcIdx === void 0) return { status: this.resolveFailureStatus() };
    const srcInode = this.readInode(srcIdx);
    if (srcInode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.ENOTSUP };
    if (flags & 1 && (this.pathIndex.has(destPath) || this.isImplicitDirectory(destPath))) {
      return { status: CODE_TO_STATUS.EEXIST };
    }
    if (srcPath === destPath) return { status: 0 };
    const srcSize = srcInode.size;
    const srcFirstBlock = srcInode.firstBlock;
    const srcMode = srcInode.mode;
    const emptyStatus = this.write(destPath, new Uint8Array(0));
    if (emptyStatus.status !== 0) return emptyStatus;
    if (srcSize === 0) {
      const emptyIdx = this.resolvePathComponents(destPath, true);
      if (emptyIdx !== void 0) {
        const emptyInode = this.readInode(emptyIdx);
        emptyInode.mode = emptyInode.mode & -4096 | srcMode & 4095;
        this.writeInode(emptyIdx, emptyInode);
        this.commitPending();
      }
      return { status: 0 };
    }
    const destIdx = this.resolvePathComponents(destPath, true);
    if (destIdx === void 0) return { status: CODE_TO_STATUS.EIO };
    const destInode = this.readInode(destIdx);
    const neededBlocks = Math.ceil(srcSize / this.blockSize);
    const newFirst = this.allocateBlocks(neededBlocks);
    const newBase = this.dataOffset + newFirst * this.blockSize;
    const srcBase = this.dataOffset + srcFirstBlock * this.blockSize;
    const CHUNK = 4 * 1024 * 1024;
    const scratch = new Uint8Array(Math.min(CHUNK, srcSize));
    let copied = 0;
    while (copied < srcSize) {
      const n = Math.min(CHUNK, srcSize - copied);
      const slice = n < scratch.length ? scratch.subarray(0, n) : scratch;
      this.handle.read(slice, { at: srcBase + copied });
      this.handle.write(slice, { at: newBase + copied });
      copied += n;
    }
    destInode.firstBlock = newFirst;
    destInode.blockCount = neededBlocks;
    destInode.size = srcSize;
    destInode.mtime = Date.now();
    destInode.mode = destInode.mode & -4096 | srcMode & 4095;
    this.writeInode(destIdx, destInode);
    this.commitPending();
    return { status: 0 };
  }
  // ---- ACCESS ----
  access(path, mode = 0) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === void 0) {
      const failure = this.resolveFailureStatus();
      if (this.isImplicitDirectory(path)) return { status: 0 };
      return { status: failure };
    }
    if (mode === 0) return { status: 0 };
    if (!this.strictPermissions) return { status: 0 };
    const inode = this.readInode(idx);
    const filePerm = this.getEffectivePermission(inode);
    if (mode & 4 && !(filePerm & 4)) return { status: CODE_TO_STATUS.EACCES };
    if (mode & 2 && !(filePerm & 2)) return { status: CODE_TO_STATUS.EACCES };
    if (mode & 1 && !(filePerm & 1)) return { status: CODE_TO_STATUS.EACCES };
    return { status: 0 };
  }
  getEffectivePermission(inode) {
    const modeBits = inode.mode & 511;
    if (this.processUid === inode.uid) return modeBits >>> 6 & 7;
    if (this.processGid === inode.gid) return modeBits >>> 3 & 7;
    return modeBits & 7;
  }
  // ---- REALPATH ----
  realpath(path) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === void 0) {
      const failure = this.resolveFailureStatus();
      if (this.isImplicitDirectory(path)) {
        return { status: 0, data: encoder10.encode(path) };
      }
      return { status: failure, data: null };
    }
    const inode = this.readInode(idx);
    const resolvedPath = this.readPath(inode.pathOffset, inode.pathLength);
    return { status: 0, data: encoder10.encode(resolvedPath) };
  }
  // ---- CHMOD ----
  /**
   * `follow: false` is `lchmod` — act on the symlink itself rather than what it points at.
   *
   * This used to have no such parameter and `lchmod` simply called `chmod`, so it changed the
   * **target's** permissions: the one thing the `l` prefix exists to prevent. `resolvePathComponents`
   * already distinguishes the two, exactly as `stat` and `lstat` do.
   */
  chmod(path, mode, follow = true) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, follow);
    if (idx === void 0) return { status: this.resolveFailureStatus() };
    const inode = this.readInode(idx);
    inode.mode = inode.mode & S_IFMT | mode & 4095;
    inode.ctime = Date.now();
    this.writeInode(idx, inode);
    return { status: 0 };
  }
  // ---- CHOWN ----
  /** `follow: false` is `lchown` — the link's own ownership, not its target's. */
  chown(path, uid, gid, follow = true) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, follow);
    if (idx === void 0) return { status: this.resolveFailureStatus() };
    const inode = this.readInode(idx);
    inode.uid = uid;
    inode.gid = gid;
    inode.ctime = Date.now();
    this.writeInode(idx, inode);
    return { status: 0 };
  }
  // ---- UTIMES ----
  /** `follow: false` is `lutimes` — timestamps on the symlink itself, not on its target. */
  utimes(path, atime, mtime, follow = true) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, follow);
    if (idx === void 0) return { status: this.resolveFailureStatus() };
    const inode = this.readInode(idx);
    inode.atime = atime;
    inode.mtime = mtime;
    inode.ctime = Date.now();
    this.writeInode(idx, inode);
    return { status: 0 };
  }
  // ---- SYMLINK ----
  symlink(target, linkPath) {
    linkPath = this.normalizePath(linkPath);
    if (this.pathIndex.has(linkPath) || this.isImplicitDirectory(linkPath)) {
      return { status: CODE_TO_STATUS.EEXIST };
    }
    const parentStatus = this.ensureParent(linkPath);
    if (parentStatus !== 0) return { status: parentStatus };
    const targetBytes = encoder10.encode(target);
    this.createInode(linkPath, INODE_TYPE.SYMLINK, DEFAULT_SYMLINK_MODE, targetBytes.byteLength, targetBytes);
    this.commitPending();
    return { status: 0 };
  }
  // ---- READLINK ----
  readlink(path) {
    path = this.normalizePath(path);
    const idx = this.pathIndex.get(path);
    if (idx === void 0) return { status: CODE_TO_STATUS.ENOENT, data: null };
    const inode = this.readInode(idx);
    if (inode.type !== INODE_TYPE.SYMLINK) return { status: CODE_TO_STATUS.EINVAL, data: null };
    const target = this.readData(inode.firstBlock, inode.blockCount, inode.size);
    return { status: 0, data: target };
  }
  // ---- LINK (hard link — copies the file data, tracks nlink) ----
  link(existingPath, newPath) {
    existingPath = this.normalizePath(existingPath);
    newPath = this.normalizePath(newPath);
    const srcIdx = this.resolvePathComponents(existingPath, true);
    if (srcIdx === void 0) return { status: this.resolveFailureStatus() };
    const srcInode = this.readInode(srcIdx);
    if (srcInode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EPERM };
    if (this.pathIndex.has(newPath) || this.isImplicitDirectory(newPath)) {
      return { status: CODE_TO_STATUS.EEXIST };
    }
    const result = this.copy(existingPath, newPath);
    if (result.status !== 0) return result;
    srcInode.nlink++;
    this.writeInode(srcIdx, srcInode);
    const destIdx = this.pathIndex.get(newPath);
    if (destIdx !== void 0) {
      const destInode = this.readInode(destIdx);
      destInode.nlink = srcInode.nlink;
      this.writeInode(destIdx, destInode);
    }
    return { status: 0 };
  }
  // ---- OPEN (file descriptor) ----
  /**
   * open(2). `reqMode` is the mode an O_CREAT open asks for; the umask is subtracted from it
   * here, as the kernel does. It defaults to 0o666 — Node's default for `open` — so an omitted
   * mode still lands on the historical 0o644 under the default 0o022 umask.
   *
   * The mode applies **only when the file is created**. Re-opening an existing file with a
   * different mode leaves its permissions alone, matching open(2) and Node.
   */
  open(path, flags, tabId, reqMode = 438) {
    path = this.normalizePath(path);
    const hasCreate = (flags & 64) !== 0;
    const hasTrunc = (flags & 512) !== 0;
    const hasExcl = (flags & 128) !== 0;
    let idx = this.resolvePathComponents(path, true);
    if (idx === void 0) {
      const linkTarget = this.resolveDanglingLink(path);
      if (linkTarget === null) return { status: CODE_TO_STATUS.ELOOP, data: null };
      if (linkTarget !== path) {
        path = linkTarget;
        idx = this.resolvePathComponents(path, true);
      }
    }
    if (_VFSEngine.isWritable(flags)) {
      const isDirectory = idx !== void 0 ? this.readInode(idx).type === INODE_TYPE.DIRECTORY : this.isImplicitDirectory(path);
      if (isDirectory) return { status: CODE_TO_STATUS.EISDIR, data: null };
    }
    if (idx === void 0) {
      if (!hasCreate) return { status: this.resolveFailureStatus(), data: null };
      const parentStatus = this.ensureParent(path);
      if (parentStatus !== 0) return { status: parentStatus, data: null };
      idx = this.createInode(path, INODE_TYPE.FILE, this.fileModeFor(reqMode), 0);
    } else if (hasExcl && hasCreate) {
      return { status: CODE_TO_STATUS.EEXIST, data: null };
    }
    if (hasTrunc) {
      this.truncate(path, 0);
    }
    const fd = this.nextFd++;
    this.fdTable.set(fd, { tabId, inodeIdx: idx, position: 0, flags });
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, fd, true);
    return { status: 0, data: buf };
  }
  // ---- CLOSE ----
  close(fd) {
    if (!this.fdTable.has(fd)) return { status: CODE_TO_STATUS.EBADF };
    this.fdTable.delete(fd);
    return { status: 0 };
  }
  // ---- FREAD ----
  fread(fd, length, position) {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF, data: null };
    if (!_VFSEngine.isReadable(entry.flags)) return { status: CODE_TO_STATUS.EBADF, data: null };
    const inode = this.readInode(entry.inodeIdx);
    if (inode.type === INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.EISDIR, data: null };
    const pos = position ?? entry.position;
    const readLen = Math.min(length, inode.size - pos);
    if (readLen <= 0) return { status: 0, data: new Uint8Array(0) };
    const dataOffset = this.dataOffset + inode.firstBlock * this.blockSize + pos;
    const buf = new Uint8Array(readLen);
    this.handle.read(buf, { at: dataOffset });
    if (position === null) {
      entry.position += readLen;
    }
    return { status: 0, data: buf };
  }
  // ---- FWRITE ----
  fwrite(fd, data, position) {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF, data: null };
    if (!_VFSEngine.isWritable(entry.flags)) return { status: CODE_TO_STATUS.EBADF, data: null };
    const inode = this.readInode(entry.inodeIdx);
    const isAppend = (entry.flags & 1024) !== 0;
    const pos = isAppend ? inode.size : position ?? entry.position;
    const endPos = pos + data.byteLength;
    if (endPos > inode.size) {
      const neededBlocks = Math.ceil(endPos / this.blockSize);
      if (neededBlocks > inode.blockCount) {
        const newFirst = this.allocateBlocks(neededBlocks);
        const newBase = this.dataOffset + newFirst * this.blockSize;
        const oldBase = this.dataOffset + inode.firstBlock * this.blockSize;
        if (inode.size > 0) {
          const CHUNK = 4 * 1024 * 1024;
          const scratch = new Uint8Array(Math.min(CHUNK, inode.size));
          let copied = 0;
          while (copied < inode.size) {
            const n = Math.min(CHUNK, inode.size - copied);
            const slice = n < scratch.length ? scratch.subarray(0, n) : scratch;
            this.handle.read(slice, { at: oldBase + copied });
            this.handle.write(slice, { at: newBase + copied });
            copied += n;
          }
        }
        this.freeBlockRange(inode.firstBlock, inode.blockCount);
        if (pos > inode.size) {
          this.zeroFileRange(newBase + inode.size, pos - inode.size);
        }
        this.handle.write(data, { at: newBase + pos });
        inode.firstBlock = newFirst;
        inode.blockCount = neededBlocks;
      } else {
        if (pos > inode.size) {
          this.zeroFileRange(
            this.dataOffset + inode.firstBlock * this.blockSize + inode.size,
            pos - inode.size
          );
        }
        const dataOffset = this.dataOffset + inode.firstBlock * this.blockSize + pos;
        this.handle.write(data, { at: dataOffset });
      }
      inode.size = endPos;
    } else {
      const dataOffset = this.dataOffset + inode.firstBlock * this.blockSize + pos;
      this.handle.write(data, { at: dataOffset });
    }
    inode.mtime = Date.now();
    this.writeInode(entry.inodeIdx, inode);
    if (position === null) {
      entry.position = endPos;
    }
    this.commitPending();
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, data.byteLength, true);
    return { status: 0, data: buf };
  }
  // ---- FSTAT ----
  fstat(fd) {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF, data: null };
    if (entry.implicitPath) return this.encodeImplicitDirStatResponse(entry.implicitPath);
    return this.encodeStatResponse(entry.inodeIdx);
  }
  // ---- FTRUNCATE ----
  ftruncate(fd, len = 0) {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF };
    if (!_VFSEngine.isWritable(entry.flags)) return { status: CODE_TO_STATUS.EINVAL };
    const inode = this.readInode(entry.inodeIdx);
    const path = this.readPath(inode.pathOffset, inode.pathLength);
    return this.truncate(path, len);
  }
  // ---- FSYNC ----
  /**
   * Real volume statistics.
   *
   * `statfs` used to be answered by the filesystem layer with fixed constants — always ~4 GB
   * capacity and ~2 GB free, whatever the volume actually held — so anything checking free space
   * before a large write got a number unrelated to reality. These come from the superblock the
   * allocator maintains.
   *
   * Payload: [type u32][bsize u32][blocks u32][bfree u32][files u32][ffree u32].
   */
  statfs(path = "/") {
    path = this.normalizePath(path);
    if (this.resolvePathComponents(path, true) === void 0 && !this.isImplicitDirectory(path)) {
      return { status: this.resolveFailureStatus(), data: null };
    }
    const usedInodes = new Set(this.pathIndex.values()).size;
    const buf = new Uint8Array(24);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, VFS_MAGIC, true);
    dv.setUint32(4, this.blockSize, true);
    dv.setUint32(8, this.totalBlocks, true);
    dv.setUint32(12, this.freeBlocks, true);
    dv.setUint32(16, this.inodeCount, true);
    dv.setUint32(20, Math.max(0, this.inodeCount - usedInodes), true);
    return { status: 0, data: buf };
  }
  /**
   * fsync(2) / fdatasync(2).
   *
   * Everything here is committed to one backing handle, so there is nothing per-descriptor to
   * flush — but the descriptor still has to be *checked*. `fs.fsyncSync(fd)` on a closed or
   * never-opened fd answers EBADF in node, and reporting success instead turns a use-after-close
   * into silence at the one call whose entire job is to confirm the data is safe.
   *
   * `fd` is optional because the volume-wide flush behind `promises.flush()` has no descriptor
   * to name, and because a request encoded by an older worker carries no fd payload.
   */
  fsync(fd) {
    if (fd !== void 0 && !this.fdTable.has(fd)) return { status: CODE_TO_STATUS.EBADF };
    this.commitPending();
    this.handle.flush();
    return { status: 0 };
  }
  // ---- FCHMOD ----
  // fd-based chmod: look up the inode directly from the fd table and mutate
  // its mode bits. Native Node does the same thing at the libuv layer.
  fchmod(fd, mode) {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF };
    if (entry.implicitPath) return { status: 0 };
    const inode = this.readInode(entry.inodeIdx);
    inode.mode = inode.mode & S_IFMT | mode & 4095;
    inode.ctime = Date.now();
    this.writeInode(entry.inodeIdx, inode);
    return { status: 0 };
  }
  // ---- FCHOWN ----
  fchown(fd, uid, gid) {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF };
    if (entry.implicitPath) return { status: 0 };
    const inode = this.readInode(entry.inodeIdx);
    inode.uid = uid;
    inode.gid = gid;
    inode.ctime = Date.now();
    this.writeInode(entry.inodeIdx, inode);
    return { status: 0 };
  }
  // ---- FUTIMES ----
  futimes(fd, atime, mtime) {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: CODE_TO_STATUS.EBADF };
    if (entry.implicitPath) return { status: 0 };
    const inode = this.readInode(entry.inodeIdx);
    inode.atime = atime;
    inode.mtime = mtime;
    inode.ctime = Date.now();
    this.writeInode(entry.inodeIdx, inode);
    return { status: 0 };
  }
  // ---- OPENDIR ----
  opendir(path, tabId) {
    path = this.normalizePath(path);
    const idx = this.resolvePathComponents(path, true);
    if (idx === void 0) {
      if (this.isImplicitDirectory(path)) {
        const fd2 = this.nextFd++;
        this.fdTable.set(fd2, { tabId, inodeIdx: -1, position: 0, flags: 0, implicitPath: path });
        const buf2 = new Uint8Array(4);
        new DataView(buf2.buffer).setUint32(0, fd2, true);
        return { status: 0, data: buf2 };
      }
      return { status: CODE_TO_STATUS.ENOENT, data: null };
    }
    const inode = this.readInode(idx);
    if (inode.type !== INODE_TYPE.DIRECTORY) return { status: CODE_TO_STATUS.ENOTDIR, data: null };
    const fd = this.nextFd++;
    this.fdTable.set(fd, { tabId, inodeIdx: idx, position: 0, flags: 0 });
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, fd, true);
    return { status: 0, data: buf };
  }
  // ---- MKDTEMP ----
  mkdtemp(prefix) {
    const suffix = Math.random().toString(36).substring(2, 8);
    const path = this.normalizePath(prefix + suffix);
    const parentPath = path.substring(0, path.lastIndexOf("/")) || "/";
    if (parentPath !== "/" && this.resolvePathComponents(parentPath, true) === void 0 && !this.isImplicitDirectory(parentPath)) {
      return { status: CODE_TO_STATUS.ENOENT, data: null };
    }
    this.createInode(path, INODE_TYPE.DIRECTORY, this.dirModeFor(448), 0);
    this.commitPending();
    return { status: 0, data: encoder10.encode(path) };
  }
  // ========== Helpers ==========
  getDirectChildren(dirPath) {
    this.ensureChildIndex();
    const names = this.childIndex.get(dirPath);
    if (!names) return [];
    const prefix = dirPath === "/" ? "/" : dirPath + "/";
    const children = [];
    for (const name of names.keys()) {
      const full = prefix + name;
      if (this.pathIndex.has(full)) children.push(full);
    }
    return children.sort();
  }
  /**
   * Rebuild the set of all implicit directory paths.
   * An implicit directory is any ancestor path of a file/symlink in pathIndex
   * that doesn't itself have an explicit inode entry.
   * Only rebuilt when pathIndex has changed (tracked via generation counter).
   */
  rebuildImplicitDirs() {
    if (this.implicitDirsGen === this.pathIndexGen) return;
    const now2 = Date.now();
    const prev = this.implicitDirs;
    this.implicitDirs = /* @__PURE__ */ new Map();
    for (const filePath of this.pathIndex.keys()) {
      let pos = filePath.length;
      while (true) {
        pos = filePath.lastIndexOf("/", pos - 1);
        if (pos <= 0) break;
        const ancestor = filePath.substring(0, pos);
        if (this.implicitDirs.has(ancestor)) break;
        if (!this.pathIndex.has(ancestor)) {
          this.implicitDirs.set(ancestor, prev.get(ancestor) ?? now2);
        }
      }
    }
    this.implicitDirsGen = this.pathIndexGen;
  }
  /**
   * Check if a path is an implicit directory (exists because files exist under it,
   * but no explicit directory inode was created for it).
   *
   * O(1) via the incrementally maintained `descCount` map (an implicit dir
   * is exactly !pathIndex.has(P) && descCount[P] > 0). If `pathIndex` was
   * mutated directly without going through the helpers (test scaffolding),
   * descCount is stale and we rebuild it from scratch — once — to resync.
   */
  isImplicitDirectory(path) {
    if (path === "/") return false;
    if (this.pathIndex.has(path)) return false;
    if (this.descCountGen < this.pathIndexGen) this.rebuildDescCount();
    return (this.descCount.get(path) ?? 0) > 0;
  }
  /**
   * Recompute `descCount` from scratch by walking every pathIndex entry's
   * ancestor chain. O(N×depth). Only triggered when something bypassed the
   * setPathIndex/deletePathIndex helpers — in production code that's
   * never; the tests exercise this path.
   */
  rebuildDescCount() {
    this.descCount.clear();
    for (const path of this.pathIndex.keys()) {
      this.bumpDescCount(path);
    }
    this.descCountGen = this.pathIndexGen;
  }
  // ---- pathIndex helpers — keep `descCount` in sync ----
  // Every pathIndex.set/delete in the engine MUST go through these so the
  // `descCount` map (used by `isImplicitDirectory`) stays correct. We
  // anticipate the caller's `pathIndexGen++` by setting `descCountGen` to
  // `pathIndexGen + 1`; idempotent across multiple helper calls within a
  // single logical op (e.g. rmdir doing N deletes then one bump). Test
  // code that mutates `pathIndex` directly leaves descCountGen behind,
  // which is what triggers the rebuild path in `isImplicitDirectory`.
  setPathIndex(path, idx) {
    const had = this.pathIndex.has(path);
    this.pathIndex.set(path, idx);
    if (!had) {
      this.bumpDescCount(path);
      this.bumpChildIndex(path);
    }
    this.descCountGen = this.pathIndexGen + 1;
    this.childIndexGen = this.pathIndexGen + 1;
  }
  deletePathIndex(path) {
    const had = this.pathIndex.delete(path);
    if (had) {
      this.decDescCount(path);
      this.decChildIndex(path);
    }
    this.descCountGen = this.pathIndexGen + 1;
    this.childIndexGen = this.pathIndexGen + 1;
    return had;
  }
  bumpDescCount(path) {
    let pos = path.length;
    while (true) {
      pos = path.lastIndexOf("/", pos - 1);
      if (pos <= 0) break;
      const ancestor = path.substring(0, pos);
      this.descCount.set(ancestor, (this.descCount.get(ancestor) ?? 0) + 1);
    }
  }
  decDescCount(path) {
    let pos = path.length;
    while (true) {
      pos = path.lastIndexOf("/", pos - 1);
      if (pos <= 0) break;
      const ancestor = path.substring(0, pos);
      const cur = this.descCount.get(ancestor);
      if (cur === void 0) break;
      if (cur <= 1) this.descCount.delete(ancestor);
      else this.descCount.set(ancestor, cur - 1);
    }
  }
  // ---- children index maintenance ----
  // For path /a/b/c.txt, registers: '/'→'a', '/a'→'b', '/a/b'→'c.txt',
  // each with a refcount of how many pathIndex entries pass through that edge.
  bumpChildIndex(path) {
    if (path === "/" || path.length === 0) return;
    let parent = "/";
    let start = 1;
    while (start <= path.length) {
      let end = path.indexOf("/", start);
      if (end === -1) end = path.length;
      const name = path.substring(start, end);
      if (name.length > 0) {
        let children = this.childIndex.get(parent);
        if (!children) {
          children = /* @__PURE__ */ new Map();
          this.childIndex.set(parent, children);
        }
        children.set(name, (children.get(name) ?? 0) + 1);
        parent = parent === "/" ? "/" + name : parent + "/" + name;
      }
      start = end + 1;
    }
  }
  decChildIndex(path) {
    if (path === "/" || path.length === 0) return;
    let parent = "/";
    let start = 1;
    while (start <= path.length) {
      let end = path.indexOf("/", start);
      if (end === -1) end = path.length;
      const name = path.substring(start, end);
      if (name.length > 0) {
        const children = this.childIndex.get(parent);
        if (!children) break;
        const cur = children.get(name);
        if (cur === void 0) break;
        if (cur <= 1) {
          children.delete(name);
          if (children.size === 0) this.childIndex.delete(parent);
        } else {
          children.set(name, cur - 1);
        }
        parent = parent === "/" ? "/" + name : parent + "/" + name;
      }
      start = end + 1;
    }
  }
  /**
   * Resync childIndex with pathIndex if test scaffolding (or repair paths)
   * mutated pathIndex directly. Mirrors the descCount staleness contract.
   */
  ensureChildIndex() {
    if (this.childIndexGen >= this.pathIndexGen) return;
    this.childIndex.clear();
    for (const path of this.pathIndex.keys()) {
      this.bumpChildIndex(path);
    }
    this.childIndexGen = this.pathIndexGen;
  }
  /**
   * Get direct children of a directory path, including implicit subdirectories.
   * Returns unique child full paths. Each entry is tagged with whether it's a
   * real inode or an implicit directory.
   */
  /**
   * How many direct children of `dirPath` are directories — the `nlink` a directory reports
   * (`2 + subdirectories`, as on a real filesystem).
   *
   * Counting through {@link getDirectChildrenWithImplicit} meant every `stat` on a directory
   * allocated one object and one string per child, built an array, and then **sorted** it, all to
   * arrive at a single integer. The sort in particular is entirely wasted: order cannot change a
   * count. This walks the child index directly and allocates nothing per child beyond the lookup
   * key, which is why `stat` on a directory was ~40× the cost of `stat` on a file.
   */
  countSubdirectories(dirPath) {
    this.ensureChildIndex();
    const names = this.childIndex.get(dirPath);
    if (!names) return 0;
    const prefix = dirPath === "/" ? "/" : dirPath + "/";
    let subdirs = 0;
    for (const name of names.keys()) {
      const childIdx = this.pathIndex.get(prefix + name);
      if (childIdx === void 0) subdirs++;
      else if (this.readInode(childIdx).type === INODE_TYPE.DIRECTORY) subdirs++;
    }
    return subdirs;
  }
  getDirectChildrenWithImplicit(dirPath) {
    this.ensureChildIndex();
    const names = this.childIndex.get(dirPath);
    if (!names) return [];
    const prefix = dirPath === "/" ? "/" : dirPath + "/";
    const result = [];
    for (const name of names.keys()) {
      const full = prefix + name;
      result.push({ path: full, type: this.pathIndex.has(full) ? "real" : "implicit" });
    }
    result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return result;
  }
  /**
   * Encode a synthetic stat response for an implicit directory.
   * Returns directory stats with default mode, zero size, current timestamps.
   */
  encodeImplicitDirStatResponse(path) {
    this.rebuildImplicitDirs();
    const ts = this.implicitDirs.get(path) ?? Date.now();
    const mode = DEFAULT_DIR_MODE & ~(this.umask & 511);
    const nlink = 2 + this.countSubdirectories(path);
    const buf = new Uint8Array(53);
    const view = new DataView(buf.buffer);
    view.setUint8(0, INODE_TYPE.DIRECTORY);
    view.setUint32(1, mode, true);
    view.setFloat64(5, 0, true);
    view.setFloat64(13, ts, true);
    view.setFloat64(21, ts, true);
    view.setFloat64(29, ts, true);
    view.setUint32(37, this.processUid, true);
    view.setUint32(41, this.processGid, true);
    view.setUint32(45, 0, true);
    view.setUint32(49, nlink, true);
    return { status: 0, data: buf };
  }
  getAllDescendants(dirPath) {
    const prefix = dirPath === "/" ? "/" : dirPath + "/";
    const descendants = [];
    for (const path of this.pathIndex.keys()) {
      if (path !== dirPath && path.startsWith(prefix)) descendants.push(path);
    }
    return descendants.sort((a, b) => {
      const da = a.split("/").length;
      const db = b.split("/").length;
      return db - da;
    });
  }
  ensureParent(path) {
    const lastSlash = path.lastIndexOf("/");
    if (lastSlash <= 0) return 0;
    const parentPath = path.substring(0, lastSlash);
    const parentIdx = this.pathIndex.get(parentPath);
    if (parentIdx === void 0) {
      if (this.isImplicitDirectory(parentPath)) return 0;
      return CODE_TO_STATUS.ENOENT;
    }
    const parentInode = this.readInode(parentIdx);
    if (parentInode.type !== INODE_TYPE.DIRECTORY) return CODE_TO_STATUS.ENOTDIR;
    return 0;
  }
  /** Clean up all fds owned by a tab */
  cleanupTab(tabId) {
    for (const [fd, entry] of this.fdTable) {
      if (entry.tabId === tabId) {
        this.fdTable.delete(fd);
      }
    }
  }
  /** Get all file paths and their data for OPFS sync */
  getAllFiles() {
    const files = [];
    for (const [path, idx] of this.pathIndex) {
      files.push({ path, idx });
    }
    return files;
  }
  /** Get file path for a file descriptor (used by OPFS sync for FD-based ops) */
  getPathForFd(fd) {
    const entry = this.fdTable.get(fd);
    if (!entry) return null;
    const inode = this.readInode(entry.inodeIdx);
    return this.readPath(inode.pathOffset, inode.pathLength);
  }
  /** Get file data by inode index */
  getInodeData(idx) {
    const inode = this.readInode(idx);
    const data = inode.size > 0 ? this.readData(inode.firstBlock, inode.blockCount, inode.size) : new Uint8Array(0);
    return { type: inode.type, data, mtime: inode.mtime };
  }
  /** Export all files/dirs/symlinks from the VFS */
  exportAll() {
    const result = [];
    for (const [path, idx] of this.pathIndex) {
      const inode = this.readInode(idx);
      let data = null;
      if (inode.type === INODE_TYPE.FILE || inode.type === INODE_TYPE.SYMLINK) {
        data = inode.size > 0 ? this.readData(inode.firstBlock, inode.blockCount, inode.size) : new Uint8Array(0);
      }
      result.push({ path, type: inode.type, data, mode: inode.mode, mtime: inode.mtime });
    }
    result.sort((a, b) => {
      if (a.type === INODE_TYPE.DIRECTORY && b.type !== INODE_TYPE.DIRECTORY) return -1;
      if (a.type !== INODE_TYPE.DIRECTORY && b.type === INODE_TYPE.DIRECTORY) return 1;
      return a.path.localeCompare(b.path);
    });
    return result;
  }
  flush() {
    this.handle.flush();
  }
};

// src/helpers.ts
var MemoryHandle = class {
  buf;
  len;
  constructor(initialData) {
    if (initialData && initialData.byteLength > 0) {
      this.buf = new Uint8Array(initialData);
      this.len = initialData.byteLength;
    } else {
      this.buf = new Uint8Array(1024 * 1024);
      this.len = 0;
    }
  }
  getSize() {
    return this.len;
  }
  read(target, opts) {
    const offset = opts?.at ?? 0;
    const dst = new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
    const bytesToRead = Math.min(dst.length, this.len - offset);
    if (bytesToRead <= 0) return 0;
    dst.set(this.buf.subarray(offset, offset + bytesToRead));
    return bytesToRead;
  }
  write(data, opts) {
    const offset = opts?.at ?? 0;
    const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const needed = offset + src.length;
    if (needed > this.buf.length) {
      this.grow(needed);
    }
    this.buf.set(src, offset);
    if (needed > this.len) this.len = needed;
    return src.length;
  }
  truncate(size) {
    if (size > this.buf.length) {
      this.grow(size);
    }
    if (size > this.len) {
      this.buf.fill(0, this.len, size);
    }
    this.len = size;
  }
  flush() {
  }
  close() {
  }
  getBuffer() {
    return this.buf.buffer.slice(0, this.len);
  }
  grow(minSize) {
    const MAX_SIZE = 4 * 1024 * 1024 * 1024;
    if (minSize > MAX_SIZE) {
      throw new Error(`MemoryHandle: cannot grow to ${minSize} bytes (max ${MAX_SIZE})`);
    }
    const newSize = Math.max(minSize, this.buf.length * 2);
    const newBuf = new Uint8Array(newSize);
    newBuf.set(this.buf.subarray(0, this.len));
    this.buf = newBuf;
  }
};
async function openVFSHandle(fileHandle) {
  try {
    const handle = await fileHandle.createSyncAccessHandle();
    return { handle, isMemory: false };
  } catch {
    const file = await fileHandle.getFile();
    const data = await file.arrayBuffer();
    return { handle: new MemoryHandle(data), isMemory: true };
  }
}
async function navigateToRoot(root) {
  let dir = await navigator.storage.getDirectory();
  if (root && root !== "/") {
    for (const seg of root.split("/").filter(Boolean)) {
      dir = await dir.getDirectoryHandle(seg, { create: true });
    }
  }
  return dir;
}
async function ensureParentDirs(rootDir, path) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  let dir = rootDir;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}
function basename2(path) {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}
async function writeOPFSFile(rootDir, path, data) {
  const parentDir = await ensureParentDirs(rootDir, path);
  const name = basename2(path);
  const fileHandle = await parentDir.getFileHandle(name, { create: true });
  try {
    const syncHandle = await fileHandle.createSyncAccessHandle();
    try {
      syncHandle.truncate(0);
      if (data.byteLength > 0) {
        syncHandle.write(data, { at: 0 });
      }
      syncHandle.flush();
    } finally {
      syncHandle.close();
    }
  } catch {
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
  }
}
async function clearDirectory(dir, skip) {
  const entries = [];
  for await (const name of dir.keys()) {
    if (!skip.has(name)) entries.push(name);
  }
  for (const name of entries) {
    await dir.removeEntry(name, { recursive: true });
  }
}
async function readOPFSRecursive(dir, prefix, skip) {
  const result = [];
  for await (const [name, handle] of dir.entries()) {
    if (prefix === "" && skip.has(name)) continue;
    const fullPath = prefix ? `${prefix}/${name}` : `/${name}`;
    if (handle.kind === "directory") {
      result.push({ path: fullPath, type: "directory" });
      const children = await readOPFSRecursive(handle, fullPath, skip);
      result.push(...children);
    } else {
      const file = await handle.getFile();
      const data = await file.arrayBuffer();
      result.push({ path: fullPath, type: "file", data });
    }
  }
  return result;
}
function readVFSRecursive(fs, vfsPath) {
  const result = [];
  let entries;
  try {
    entries = fs.readdirSync(vfsPath, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    const fullPath = vfsPath === "/" ? `/${entry.name}` : `${vfsPath}/${entry.name}`;
    if (entry.isDirectory()) {
      result.push({ path: fullPath, type: "directory" });
      result.push(...readVFSRecursive(fs, fullPath));
    } else {
      try {
        const data = fs.readFileSync(fullPath);
        result.push({ path: fullPath, type: "file", data });
      } catch {
      }
    }
  }
  return result;
}
async function unpackToOPFS(root = "/", fs) {
  const rootDir = await navigateToRoot(root);
  if (fs) {
    const vfsEntries = readVFSRecursive(fs, "/");
    let files2 = 0;
    let directories2 = 0;
    for (const entry of vfsEntries) {
      if (entry.type === "directory") {
        const name = basename2(entry.path);
        const parent = await ensureParentDirs(rootDir, entry.path);
        await parent.getDirectoryHandle(name, { create: true });
        directories2++;
      } else {
        try {
          await writeOPFSFile(rootDir, entry.path, entry.data ?? new Uint8Array(0));
          files2++;
        } catch (err) {
          console.warn(`[VFS] Failed to write OPFS file ${entry.path}: ${err.message}`);
        }
      }
    }
    return { files: files2, directories: directories2 };
  }
  const vfsFileHandle = await rootDir.getFileHandle(".vfs.bin");
  const { handle } = await openVFSHandle(vfsFileHandle);
  let entries;
  try {
    const engine = new VFSEngine();
    engine.init(handle);
    entries = engine.exportAll();
  } finally {
    handle.close();
  }
  await clearDirectory(rootDir, /* @__PURE__ */ new Set([".vfs.bin"]));
  let files = 0;
  let directories = 0;
  for (const entry of entries) {
    if (entry.path === "/") continue;
    if (entry.type === INODE_TYPE.DIRECTORY) {
      const name = basename2(entry.path);
      const parent = await ensureParentDirs(rootDir, entry.path);
      await parent.getDirectoryHandle(name, { create: true });
      directories++;
    } else if (entry.type === INODE_TYPE.FILE || entry.type === INODE_TYPE.SYMLINK) {
      await writeOPFSFile(rootDir, entry.path, entry.data ?? new Uint8Array(0));
      files++;
    }
  }
  return { files, directories };
}
async function loadFromOPFS(root = "/", fs) {
  const rootDir = await navigateToRoot(root);
  const opfsEntries = await readOPFSRecursive(rootDir, "", /* @__PURE__ */ new Set([".vfs.bin"]));
  if (fs) {
    try {
      const rootEntries = fs.readdirSync("/");
      for (const entry of rootEntries) {
        try {
          fs.rmSync(`/${entry}`, { recursive: true, force: true });
        } catch {
        }
      }
    } catch {
    }
    const dirs = opfsEntries.filter((e) => e.type === "directory").sort((a, b) => a.path.localeCompare(b.path));
    let files = 0;
    let directories = 0;
    for (const dir of dirs) {
      try {
        fs.mkdirSync(dir.path, { recursive: true, mode: 493 });
        directories++;
      } catch {
      }
    }
    const fileEntries = opfsEntries.filter((e) => e.type === "file");
    for (const file of fileEntries) {
      try {
        const parentPath = file.path.substring(0, file.path.lastIndexOf("/")) || "/";
        if (parentPath !== "/") {
          try {
            fs.mkdirSync(parentPath, { recursive: true, mode: 493 });
          } catch {
          }
        }
        fs.writeFileSync(file.path, new Uint8Array(file.data));
        files++;
      } catch (err) {
        console.warn(`[VFS] Failed to write ${file.path}: ${err.message}`);
      }
    }
    return { files, directories };
  }
  return spawnRepairWorker({ type: "load", root });
}
async function repairVFS(root = "/", fs) {
  if (fs) {
    const loadResult = await loadFromOPFS(root, fs);
    await unpackToOPFS(root, fs);
    const total = loadResult.files + loadResult.directories;
    return {
      recovered: total,
      lost: 0,
      entries: []
      // Detailed entries not available in fs-based path
    };
  }
  return spawnRepairWorker({ type: "repair", root });
}
function spawnRepairWorker(msg) {
  return new Promise((resolve2, reject) => {
    const worker = workerFromSource(repair_default, "vfs-repair");
    worker.onmessage = (event) => {
      terminateWorker(worker);
      if (event.data.error) {
        reject(new Error(event.data.error));
      } else {
        resolve2(event.data);
      }
    };
    worker.onerror = (event) => {
      terminateWorker(worker);
      reject(new Error(event.message || "Repair worker failed"));
    };
    worker.postMessage(msg);
  });
}

// src/drives/manager.ts
var STREAM_THRESHOLD = 4 * 1024 * 1024;
function join2(dir, name) {
  if (dir === "/" || dir === "") return "/" + name;
  return dir.replace(/\/$/, "") + "/" + name;
}
function normPath(p) {
  const parts = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return "/" + parts.join("/");
}
var DriveManager = class {
  drives = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  // ---- registry ----
  mount(drive) {
    if (this.drives.has(drive.id)) throw new Error(`drive already mounted: ${drive.id}`);
    this.drives.set(drive.id, drive);
    this.emit({ type: "mounted", drive });
    return drive;
  }
  async unmount(id) {
    const d = this.drives.get(id);
    if (!d) return;
    this.drives.delete(id);
    try {
      await d.dispose?.();
    } finally {
      this.emit({ type: "unmounted", id });
    }
  }
  get(id) {
    return this.drives.get(id);
  }
  list() {
    return [...this.drives.values()];
  }
  has(id) {
    return this.drives.has(id);
  }
  /** drivers call this when a drive's state/label changes (e.g. OAuth completes). */
  notifyChanged(id) {
    if (this.drives.has(id)) this.emit({ type: "changed", id });
  }
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(e) {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {
      }
    }
  }
  // ---- transfer ----
  /**
   * Copy (or move) a file or directory tree from one drive to another, emitting
   * progress. Pre-walks the source to compute totals so the Finder bar is exact,
   * then copies file-by-file. On `move`, sources are removed only after the whole
   * tree copies successfully (fast in-drive rename when src===dst).
   *
   * Semantics worth knowing:
   * - Directory copies **merge** into an existing destination (per-file overwrite
   *   governed by `opts.overwrite`); they do not replace it wholesale.
   * - A cross-drive `move` is copy-then-delete, so it is **not atomic** — an abort
   *   or error mid-transfer can leave a partial copy at the destination with the
   *   source still intact. Same-drive moves use the drive's atomic `rename`.
   * - `opts.signal` cancels between files and mid-file during streaming, rejecting
   *   with an `AbortError`.
   */
  async transfer(src, srcPath, dst, dstPath, opts = {}) {
    const { move = false, overwrite = true, onProgress, signal } = opts;
    srcPath = normPath(srcPath);
    dstPath = normPath(dstPath);
    if (src === dst) {
      const st = await src.stat(srcPath);
      const totalBytes2 = st.type === "dir" ? 0 : st.size;
      await dst.mkdir(parentOf(dstPath), { recursive: true });
      if (move) {
        await src.rename(srcPath, dstPath);
        onProgress?.({ totalBytes: totalBytes2, movedBytes: totalBytes2, totalFiles: 1, movedFiles: 1, current: dstPath });
        return;
      }
      if (src.copy) {
        await src.copy(srcPath, dstPath);
        onProgress?.({ totalBytes: totalBytes2, movedBytes: totalBytes2, totalFiles: 1, movedFiles: 1, current: dstPath });
        return;
      }
    }
    const files = await this.walk(src, srcPath);
    const totalBytes = files.reduce((n, f) => n + f.size, 0);
    const totalFiles = files.filter((f) => f.type === "file").length;
    const progress = { totalBytes, movedBytes: 0, totalFiles, movedFiles: 0, current: "" };
    onProgress?.({ ...progress });
    const writeAll = async () => {
      for (const f of files) {
        throwIfAborted(signal);
        const rel = f.path.slice(srcPath.length).replace(/^\//, "");
        const target = rel ? join2(dstPath, rel) : dstPath;
        progress.current = f.path;
        if (f.type === "dir") {
          await dst.mkdir(target, { recursive: true });
          continue;
        }
        if (!overwrite && await dst.exists(target)) {
          progress.movedFiles++;
          progress.movedBytes += f.size;
          onProgress?.({ ...progress });
          continue;
        }
        await dst.mkdir(parentOf(target), { recursive: true });
        await this.copyFile(src, f.path, dst, target, f.size, (delta) => {
          progress.movedBytes += delta;
          onProgress?.({ ...progress });
        }, signal);
        progress.movedFiles++;
        onProgress?.({ ...progress });
      }
    };
    if (dst.batch) await dst.batch(writeAll);
    else await writeAll();
    if (move) {
      throwIfAborted(signal);
      await src.remove(srcPath, { recursive: true });
    }
  }
  /** Stream a single file when both ends support it and it's large; else buffer. */
  async copyFile(src, srcPath, dst, dstPath, size, onBytes, signal) {
    const canStream = size >= STREAM_THRESHOLD && src.capabilities.streaming && dst.capabilities.streaming && src.createReadable && dst.createWritable;
    if (canStream) {
      const r = await src.createReadable(srcPath);
      const w = await dst.createWritable(dstPath, size).catch(async (e) => {
        await r.close();
        throw e;
      });
      try {
        for (; ; ) {
          throwIfAborted(signal);
          const chunk = await r.read();
          if (!chunk) break;
          await w.write(chunk);
          onBytes(chunk.byteLength);
        }
        await w.close();
      } catch (e) {
        await w.abort?.(e);
        throw e;
      } finally {
        await r.close();
      }
      return;
    }
    const data = await src.readFile(srcPath);
    await dst.writeFile(dstPath, data);
    onBytes(data.byteLength);
  }
  /** Depth-first listing of a path: dirs (parents before children) then files. */
  async walk(drive, root) {
    const st = await drive.stat(root);
    if (st.type !== "dir") return [{ path: root, type: st.type, size: st.size }];
    const out = [{ path: root, type: "dir", size: 0 }];
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      for (const e of await drive.list(dir)) {
        const p = join2(dir, e.name);
        if (e.type === "dir") {
          out.push({ path: p, type: "dir", size: 0 });
          stack.push(p);
        } else out.push({ path: p, type: e.type, size: e.size });
      }
    }
    return out;
  }
  async dispose() {
    for (const id of [...this.drives.keys()]) await this.unmount(id);
    this.listeners.clear();
  }
};
function parentOf(path) {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}
function throwIfAborted(signal) {
  if (signal?.aborted) {
    const e = new Error("transfer aborted");
    e.name = "AbortError";
    throw e;
  }
}

// src/drives/tree-drive.ts
function norm(p) {
  const parts = [];
  for (const seg of (p || "/").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return "/" + parts.join("/");
}
var dirname2 = (p) => {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
};
var basename3 = (p) => p.slice(p.lastIndexOf("/") + 1);
var childPath = (dir, name) => dir === "/" ? "/" + name : dir + "/" + name;
function fsError2(code, msg) {
  const e = new Error(`${code}: ${msg}`);
  e.code = code;
  return e;
}
var TreeDrive = class {
  constructor(id, label) {
    this.id = id;
    this.label = label;
    this.nodes.set("/", { type: "dir", mtimeMs: this.now(), ctimeMs: this.now(), children: /* @__PURE__ */ new Set() });
  }
  capabilities = { writable: true, streaming: true, nativeSync: false, watch: false, syncBadges: false };
  state = "ready";
  nodes = /* @__PURE__ */ new Map();
  now = () => Date.now();
  /**
   * Load the whole node set from the backing store into `this.nodes` (records
   * only — the base rebuilds dir `children` sets centrally in `ready()`). Default:
   * no-op (a pure RAM disk).
   */
  async hydrate() {
  }
  /**
   * Commit just what changed since the last flush: write/replace every node at a
   * path in `puts`, delete every path in `dels`. Default: no-op. This is the seam
   * that makes a single small write touch a single record, not the whole tree.
   */
  async commit(_puts, _dels) {
  }
  // Paths changed/removed since the last flush (mutually exclusive per path).
  dirtyPuts = /* @__PURE__ */ new Set();
  dirtyDels = /* @__PURE__ */ new Set();
  markPut(p) {
    this.dirtyDels.delete(p);
    this.dirtyPuts.add(p);
  }
  markDel(p) {
    this.dirtyPuts.delete(p);
    this.dirtyDels.add(p);
  }
  /** >0 while a multi-step op (copy / batch) is in flight — coalesces its writes
   *  into a single commit instead of one store round-trip per file. */
  suspend = 0;
  async save() {
    if (this.suspend !== 0) return;
    if (this.dirtyPuts.size === 0 && this.dirtyDels.size === 0) return;
    const puts = this.dirtyPuts, dels = this.dirtyDels;
    this.dirtyPuts = /* @__PURE__ */ new Set();
    this.dirtyDels = /* @__PURE__ */ new Set();
    await this.commit(puts, dels);
  }
  /**
   * Run `fn` with persistence suspended, then commit once. Lets a caller (e.g.
   * `DriveManager.transfer`) collapse a whole burst of writes into a single
   * commit. Nests safely; commits on the outermost exit even if `fn` throws.
   */
  async batch(fn) {
    this.suspend++;
    try {
      return await fn();
    } finally {
      this.suspend--;
      await this.save();
    }
  }
  // Memoised so concurrent ops await the SAME hydration — otherwise a second call
  // arriving mid-`hydrate()` (async IndexedDB) would see a half-built tree.
  readyOnce = null;
  ready() {
    if (!this.readyOnce) {
      this.readyOnce = (async () => {
        try {
          await this.hydrate();
        } catch {
        }
        if (!this.nodes.has("/")) this.nodes.set("/", { type: "dir", mtimeMs: this.now(), ctimeMs: this.now(), children: /* @__PURE__ */ new Set() });
        this.rebuildChildren();
      })();
    }
    return this.readyOnce;
  }
  /** Reconstruct every dir's `children` set from the flat path set (the store
   *  persists records, not edges) — so subclasses' `hydrate` only loads nodes. */
  rebuildChildren() {
    for (const n of this.nodes.values()) if (n.type === "dir") n.children.clear();
    for (const p of this.nodes.keys()) {
      if (p === "/") continue;
      const parent = this.nodes.get(dirname2(p));
      if (parent?.type === "dir") parent.children.add(basename3(p));
    }
  }
  link(p, node) {
    this.nodes.set(p, node);
    this.markPut(p);
    if (p === "/") return;
    const parent = this.nodes.get(dirname2(p));
    if (parent?.type === "dir") parent.children.add(basename3(p));
  }
  unlink(p) {
    this.nodes.delete(p);
    this.markDel(p);
    if (p === "/") return;
    const parent = this.nodes.get(dirname2(p));
    if (parent?.type === "dir") parent.children.delete(basename3(p));
  }
  descendants(dir) {
    const out = [];
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop();
      const node = this.nodes.get(d);
      if (node?.type !== "dir") continue;
      for (const name of node.children) {
        const c = childPath(d, name);
        out.push(c);
        stack.push(c);
      }
    }
    return out;
  }
  requireDirOf(p) {
    const d = this.nodes.get(dirname2(p));
    if (!d) throw fsError2("ENOENT", `no such file or directory, '${dirname2(p)}'`);
    if (d.type !== "dir") throw fsError2("ENOTDIR", `not a directory, '${dirname2(p)}'`);
  }
  async stat(path) {
    await this.ready();
    const n = this.nodes.get(norm(path));
    if (!n) throw fsError2("ENOENT", `no such file or directory, '${path}'`);
    return { type: n.type, size: n.type === "file" ? n.data.byteLength : 0, mtimeMs: n.mtimeMs, ctimeMs: n.ctimeMs, sync: "local" };
  }
  async exists(path) {
    await this.ready();
    return this.nodes.has(norm(path));
  }
  async list(path) {
    await this.ready();
    const dir = norm(path);
    const n = this.nodes.get(dir);
    if (!n) throw fsError2("ENOENT", `no such file or directory, '${path}'`);
    if (n.type !== "dir") throw fsError2("ENOTDIR", `not a directory, '${path}'`);
    const out = [];
    for (const name of n.children) {
      const node = this.nodes.get(childPath(dir, name));
      out.push({ name, type: node.type, size: node.type === "file" ? node.data.byteLength : 0, mtimeMs: node.mtimeMs, ctimeMs: node.ctimeMs, sync: "local" });
    }
    return out;
  }
  async readFile(path) {
    await this.ready();
    const n = this.nodes.get(norm(path));
    if (!n) throw fsError2("ENOENT", `no such file or directory, '${path}'`);
    if (n.type !== "file") throw fsError2("EISDIR", `illegal operation on a directory, '${path}'`);
    return n.data.slice();
  }
  async writeFile(path, data) {
    await this.ready();
    const target = norm(path);
    this.requireDirOf(target);
    const existing = this.nodes.get(target);
    if (existing?.type === "dir") throw fsError2("EISDIR", `illegal operation on a directory, '${path}'`);
    this.link(target, { type: "file", data: data.slice(), mtimeMs: this.now(), ctimeMs: existing?.ctimeMs ?? this.now() });
    await this.save();
  }
  async mkdir(path, opts) {
    await this.ready();
    const segs2 = norm(path).split("/").filter(Boolean);
    let cur = "";
    for (let i = 0; i < segs2.length; i++) {
      cur += "/" + segs2[i];
      const ex = this.nodes.get(cur);
      if (ex) {
        if (ex.type !== "dir") throw fsError2("ENOTDIR", `not a directory, '${cur}'`);
        continue;
      }
      if (!opts?.recursive && i < segs2.length - 1) throw fsError2("ENOENT", `no such file or directory, '${cur}'`);
      this.link(cur, { type: "dir", mtimeMs: this.now(), ctimeMs: this.now(), children: /* @__PURE__ */ new Set() });
    }
    await this.save();
  }
  async remove(path, opts) {
    await this.ready();
    const target = norm(path);
    const n = this.nodes.get(target);
    if (!n) return;
    if (n.type === "dir") {
      const desc = this.descendants(target);
      if (desc.length && !opts?.recursive) throw fsError2("ENOTEMPTY", `directory not empty, '${path}'`);
      for (const c of desc) {
        this.nodes.delete(c);
        this.markDel(c);
      }
    }
    this.unlink(target);
    await this.save();
  }
  async rename(from, to) {
    await this.ready();
    const a = norm(from), b = norm(to);
    const n = this.nodes.get(a);
    if (!n) throw fsError2("ENOENT", `no such file or directory, '${from}'`);
    if (a === b) return;
    this.requireDirOf(b);
    if (n.type === "dir" && b.startsWith(a + "/")) throw fsError2("EINVAL", `invalid argument, rename '${from}' -> '${to}'`);
    this.suspend++;
    try {
      if (this.nodes.has(b)) await this.remove(b, { recursive: true });
      const desc = n.type === "dir" ? this.descendants(a) : [];
      const grafts = desc.map((p) => [b + p.slice(a.length), this.nodes.get(p)]);
      this.unlink(a);
      for (const p of desc) {
        this.nodes.delete(p);
        this.markDel(p);
      }
      this.link(b, n);
      for (const [p, node] of grafts) {
        this.nodes.set(p, node);
        this.markPut(p);
      }
      n.mtimeMs = this.now();
    } finally {
      this.suspend--;
      await this.save();
    }
  }
  async copy(from, to) {
    await this.ready();
    const a = norm(from), b = norm(to);
    if (!this.nodes.has(a)) throw fsError2("ENOENT", `no such file or directory, '${from}'`);
    if (this.nodes.get(a).type === "dir" && (b === a || b.startsWith(a + "/"))) {
      throw fsError2("EINVAL", `cannot copy a directory into itself, '${from}' -> '${to}'`);
    }
    this.suspend++;
    try {
      await this.copyInto(a, b);
    } finally {
      this.suspend--;
    }
    await this.save();
  }
  async copyInto(a, b) {
    const n = this.nodes.get(a);
    if (n.type === "file") {
      await this.writeFile(b, n.data);
      return;
    }
    await this.mkdir(b, { recursive: true });
    for (const e of await this.list(a)) await this.copyInto(childPath(a, e.name), childPath(b, e.name));
  }
  async createReadable(path) {
    const data = await this.readFile(path);
    let done = false;
    return { async read() {
      if (done) return null;
      done = true;
      return data;
    }, async close() {
    } };
  }
  async createWritable(path) {
    const chunks = [];
    const self = this;
    return {
      async write(c) {
        chunks.push(c.slice());
      },
      async close() {
        let n = 0;
        for (const c of chunks) n += c.byteLength;
        const b = new Uint8Array(n);
        let o = 0;
        for (const c of chunks) {
          b.set(c, o);
          o += c.byteLength;
        }
        await self.writeFile(path, b);
      },
      async abort() {
        chunks.length = 0;
      }
    };
  }
  async usage() {
    await this.ready();
    let used = 0;
    for (const n of this.nodes.values()) if (n.type === "file") used += n.data.byteLength;
    return { total: this.quotaBytes(), used };
  }
  quotaBytes() {
    return 0;
  }
  dispose() {
    this.nodes.clear();
  }
};

// src/drives/memory-drive.ts
var enc = new TextEncoder();
var MemoryDrive = class extends TreeDrive {
  kind = "memory";
  icon = "memory";
  constructor(id, label = "Memory") {
    super(id, label);
  }
  /** convenience for seeding/tests */
  writeText(path, text) {
    return this.writeFile(path, enc.encode(text));
  }
};

// src/drives/localstorage-drive.ts
function toB64(u) {
  let s = "";
  const CH = 32768;
  for (let i = 0; i < u.length; i += CH) s += String.fromCharCode(...u.subarray(i, i + CH));
  return btoa(s);
}
function fromB64(b) {
  const s = atob(b);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
var LocalStorageDrive = class extends TreeDrive {
  kind = "localstorage";
  icon = "database";
  prefix;
  constructor(id, label = "localStorage") {
    super(id, label);
    this.prefix = `td.drive.ls.${id}:`;
  }
  quotaBytes() {
    return 5 * 1024 * 1024;
  }
  keys() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(this.prefix)) out.push(k);
    }
    return out;
  }
  async hydrate() {
    const keys = this.keys();
    if (!keys.length) return;
    this.nodes.clear();
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const n = JSON.parse(raw);
      const path = k.slice(this.prefix.length);
      this.nodes.set(path, n.t === "file" ? { type: "file", data: n.d ? fromB64(n.d) : new Uint8Array(0), mtimeMs: n.m, ctimeMs: n.c } : { type: "dir", mtimeMs: n.m, ctimeMs: n.c, children: /* @__PURE__ */ new Set() });
    }
  }
  /** Incremental: write only changed keys, remove only deleted ones. */
  async commit(puts, dels) {
    try {
      for (const p of dels) localStorage.removeItem(this.prefix + p);
      for (const p of puts) {
        const n = this.nodes.get(p);
        if (!n) continue;
        const ser = n.type === "file" ? { t: "file", m: n.mtimeMs, c: n.ctimeMs, d: toB64(n.data) } : { t: "dir", m: n.mtimeMs, c: n.ctimeMs };
        localStorage.setItem(this.prefix + p, JSON.stringify(ser));
      }
    } catch (e) {
      throw Object.assign(new Error("ENOSPC: localStorage quota exceeded"), { code: "ENOSPC", cause: e });
    }
  }
  dispose() {
    this.nodes.clear();
  }
  /** Wipe persisted contents (when the user removes the disk). */
  async destroy() {
    try {
      for (const k of this.keys()) localStorage.removeItem(k);
    } catch {
    }
    this.nodes.clear();
  }
};

// src/drives/indexeddb-drive.ts
function openDb(name) {
  return new Promise((resolve2, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("nodes", { keyPath: "path" });
    };
    req.onsuccess = () => resolve2(req.result);
    req.onerror = () => reject(req.error);
  });
}
function txDone(tx) {
  return new Promise((resolve2, reject) => {
    tx.oncomplete = () => resolve2();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
var IndexedDbDrive = class extends TreeDrive {
  kind = "indexeddb";
  icon = "database";
  dbName;
  db = null;
  constructor(id, label = "IndexedDB") {
    super(id, label);
    this.dbName = `td-drive-idb-${id}`;
  }
  async getDb() {
    if (!this.db) this.db = await openDb(this.dbName);
    return this.db;
  }
  async hydrate() {
    const db = await this.getDb();
    const recs = await new Promise((resolve2, reject) => {
      const req = db.transaction("nodes", "readonly").objectStore("nodes").getAll();
      req.onsuccess = () => resolve2(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!recs.length) return;
    this.nodes.clear();
    for (const r of recs) {
      this.nodes.set(r.path, r.t === "file" ? { type: "file", data: r.d ?? new Uint8Array(0), mtimeMs: r.m, ctimeMs: r.c } : { type: "dir", mtimeMs: r.m, ctimeMs: r.c, children: /* @__PURE__ */ new Set() });
    }
  }
  /** Incremental: write only changed records, delete only removed ones — one tx. */
  async commit(puts, dels) {
    const db = await this.getDb();
    const tx = db.transaction("nodes", "readwrite");
    const store = tx.objectStore("nodes");
    for (const p of dels) store.delete(p);
    for (const p of puts) {
      const n = this.nodes.get(p);
      if (!n) continue;
      store.put(n.type === "file" ? { path: p, t: "file", m: n.mtimeMs, c: n.ctimeMs, d: n.data } : { path: p, t: "dir", m: n.mtimeMs, c: n.ctimeMs });
    }
    await txDone(tx);
  }
  dispose() {
    this.db?.close();
    this.db = null;
    this.nodes.clear();
  }
  async destroy() {
    this.dispose();
    await new Promise((resolve2) => {
      const r = indexedDB.deleteDatabase(this.dbName);
      r.onsuccess = r.onerror = () => resolve2();
    });
  }
};

// src/drives/vfs-drive.ts
function norm2(p) {
  const parts = [];
  for (const seg of (p || "/").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return "/" + parts.join("/");
}
function join3(dir, name) {
  return dir === "/" ? "/" + name : dir + "/" + name;
}
var VfsDrive = class {
  /**
   * @param id     drive id
   * @param label  sidebar label
   * @param vfs    the VFS engine instance
   * @param root   kernel root for this disk ("/" = whole VFS; "/Volumes/x" scoped)
   * @param scoped marks a scoped sub-tree disk (icon/kind differ)
   */
  constructor(id, label, vfs, root = "/", scoped = false) {
    this.id = id;
    this.label = label;
    this.vfs = vfs;
    this.root = root;
    this.root = norm2(root);
    this.kind = "opfs";
    this.icon = scoped ? "hard-drive" : "hard-drive";
  }
  kind;
  icon;
  capabilities = { writable: true, streaming: false, nativeSync: true, watch: false, syncBadges: false };
  state = "ready";
  get p() {
    return this.vfs.promises;
  }
  abs(path) {
    const rel = norm2(path);
    return this.root === "/" ? rel : rel === "/" ? this.root : this.root + rel;
  }
  entryType(s) {
    return s.isSymbolicLink?.() ? "symlink" : s.isDirectory() ? "dir" : "file";
  }
  /** Ensure the scoped root exists (no-op for the whole-VFS disk). */
  async ensureRoot() {
    if (this.root !== "/") await this.p.mkdir(this.root, { recursive: true });
  }
  async stat(path) {
    const s = await this.p.lstat(this.abs(path));
    return { type: this.entryType(s), size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, sync: "local" };
  }
  async exists(path) {
    try {
      await this.p.lstat(this.abs(path));
      return true;
    } catch {
      return false;
    }
  }
  async list(path) {
    const ents = await this.p.readdir(this.abs(path), { withFileTypes: true });
    const out = [];
    for (const d of ents) {
      let size = 0, mtimeMs = 0, ctimeMs;
      try {
        const s = await this.p.lstat(join3(this.abs(path), d.name));
        size = s.size;
        mtimeMs = s.mtimeMs;
        ctimeMs = s.ctimeMs;
      } catch {
      }
      out.push({ name: d.name, type: this.entryType(d), size, mtimeMs, ctimeMs, sync: "local" });
    }
    return out;
  }
  async readFile(path) {
    const d = await this.p.readFile(this.abs(path));
    return d instanceof Uint8Array ? new Uint8Array(d) : new Uint8Array(d);
  }
  async writeFile(path, data) {
    await this.p.writeFile(this.abs(path), data);
  }
  async mkdir(path, opts) {
    await this.p.mkdir(this.abs(path), { recursive: opts?.recursive ?? false });
  }
  async remove(path, opts) {
    await this.p.rm(this.abs(path), { recursive: opts?.recursive ?? false, force: true });
  }
  async rename(from, to) {
    await this.p.rename(this.abs(from), this.abs(to));
  }
  async copy(from, to) {
    await this.p.cp(this.abs(from), this.abs(to), { recursive: true });
  }
  async usage() {
    try {
      const s = await this.p.statfs(this.abs("/"));
      const total = s.blocks * s.bsize;
      return { total, used: total - s.bfree * s.bsize };
    } catch {
      return null;
    }
  }
  // Streaming over the buffered engine API (keeps the Drive contract complete).
  async createReadable(path) {
    const data = await this.readFile(path);
    let done = false;
    return { async read() {
      if (done) return null;
      done = true;
      return data;
    }, async close() {
    } };
  }
  async createWritable(path) {
    const chunks = [];
    const self = this;
    return {
      async write(c) {
        chunks.push(c);
      },
      async close() {
        let n = 0;
        for (const c of chunks) n += c.byteLength;
        const b = new Uint8Array(n);
        let o = 0;
        for (const c of chunks) {
          b.set(c, o);
          o += c.byteLength;
        }
        await self.writeFile(path, b);
      },
      async abort() {
        chunks.length = 0;
      }
    };
  }
};

// src/drives/localfolder-drive.ts
var HANDLE_DB = "td-drive-handles";
function norm3(p) {
  const parts = [];
  for (const seg of (p || "/").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return "/" + parts.join("/");
}
var segs = (p) => norm3(p).split("/").filter(Boolean);
var baseName = (p) => segs(p).slice(-1)[0] || "";
var dirName = (p) => "/" + segs(p).slice(0, -1).join("/");
function fsError3(code, msg) {
  const e = new Error(`${code}: ${msg}`);
  e.code = code;
  return e;
}
function openHandleDb() {
  return new Promise((resolve2, reject) => {
    const req = indexedDB.open(HANDLE_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("handles");
    };
    req.onsuccess = () => resolve2(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function saveHandle(id, handle) {
  const db = await openHandleDb();
  await new Promise((resolve2, reject) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put(handle, id);
    tx.oncomplete = () => resolve2();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
async function loadHandle(id) {
  const db = await openHandleDb();
  const h = await new Promise((resolve2, reject) => {
    const r = db.transaction("handles", "readonly").objectStore("handles").get(id);
    r.onsuccess = () => resolve2(r.result ?? null);
    r.onerror = () => reject(r.error);
  });
  db.close();
  return h;
}
async function dropHandle(id) {
  const db = await openHandleDb();
  await new Promise((resolve2) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").delete(id);
    tx.oncomplete = tx.onerror = () => resolve2();
  });
  db.close();
}
function localFolderSupported() {
  return typeof globalThis.showDirectoryPicker === "function";
}
async function pickDirectory() {
  const picker = globalThis.showDirectoryPicker;
  if (!picker) throw fsError3("ENOTSUP", "directory picker not supported");
  return picker({ mode: "readwrite" });
}
var LocalFolderDrive = class {
  constructor(id, label, root) {
    this.id = id;
    this.label = label;
    this.root = root;
    if (root) this.state = "ready";
  }
  kind = "localfolder";
  icon = "usb";
  capabilities = { writable: true, streaming: true, nativeSync: false, watch: false, syncBadges: false };
  state = "disconnected";
  async connect() {
    if (!this.root) this.root = await loadHandle(this.id);
    if (!this.root) {
      this.state = "disconnected";
      throw fsError3("ENOENT", "no folder handle; pick a folder");
    }
    const perm = await this.ensurePermission(true);
    this.state = perm === "granted" ? "ready" : "disconnected";
    if (perm === "granted") await saveHandle(this.id, this.root);
  }
  async ensurePermission(request) {
    const h = this.root;
    const opt = { mode: "readwrite" };
    let p = await h.queryPermission?.(opt) ?? "granted";
    if (p !== "granted" && request) p = await h.requestPermission?.(opt) ?? p;
    return p;
  }
  async dirHandle(path, create = false) {
    if (!this.root) throw fsError3("ENOENT", "folder not attached");
    let cur = this.root;
    for (const seg of segs(path)) cur = await cur.getDirectoryHandle(seg, { create });
    return cur;
  }
  async fileHandle(path, create = false) {
    return (await this.dirHandle(dirName(path), create)).getFileHandle(baseName(path), { create });
  }
  async stat(path) {
    if (!segs(path).length) return { type: "dir", size: 0, mtimeMs: 0, sync: "local" };
    try {
      const f = await (await this.fileHandle(path)).getFile();
      return { type: "file", size: f.size, mtimeMs: f.lastModified, sync: "local" };
    } catch {
      await this.dirHandle(path);
      return { type: "dir", size: 0, mtimeMs: 0, sync: "local" };
    }
  }
  async exists(path) {
    try {
      await this.stat(path);
      return true;
    } catch {
      return false;
    }
  }
  async list(path) {
    const dir = await this.dirHandle(path);
    const out = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "directory") out.push({ name, type: "dir", size: 0, mtimeMs: 0, sync: "local" });
      else {
        const f = await handle.getFile();
        out.push({ name, type: "file", size: f.size, mtimeMs: f.lastModified, sync: "local" });
      }
    }
    return out;
  }
  async readFile(path) {
    return new Uint8Array(await (await (await this.fileHandle(path)).getFile()).arrayBuffer());
  }
  async writeFile(path, data) {
    const w = await (await this.fileHandle(path, true)).createWritable();
    await w.write(data);
    await w.close();
  }
  async createReadable(path) {
    const reader = (await (await this.fileHandle(path)).getFile()).stream().getReader();
    return { async read() {
      const { value, done } = await reader.read();
      return done ? null : value;
    }, async close() {
      try {
        await reader.cancel();
      } catch {
      }
    } };
  }
  async createWritable(path) {
    const w = await (await this.fileHandle(path, true)).createWritable();
    return { async write(c) {
      await w.write(c);
    }, async close() {
      await w.close();
    }, async abort(r) {
      try {
        await w.abort?.(r);
      } catch {
      }
    } };
  }
  async mkdir(path, opts) {
    if (opts?.recursive) {
      await this.dirHandle(path, true);
      return;
    }
    await (await this.dirHandle(dirName(path))).getDirectoryHandle(baseName(path), { create: true });
  }
  async remove(path, opts) {
    try {
      await (await this.dirHandle(dirName(path))).removeEntry(baseName(path), { recursive: opts?.recursive ?? false });
    } catch (e) {
      if (e.name !== "NotFoundError") throw e;
    }
  }
  async rename(from, to) {
    await this.copy(from, to);
    await this.remove(from, { recursive: true });
  }
  async copy(from, to) {
    const s = await this.stat(from);
    if (s.type === "file") {
      await this.writeFile(to, await this.readFile(from));
      return;
    }
    const a = norm3(from), b = norm3(to);
    if (b === a || b.startsWith(a + "/")) throw fsError3("EINVAL", `cannot copy a directory into itself, '${from}' -> '${to}'`);
    await this.mkdir(to, { recursive: true });
    for (const e of await this.list(from)) await this.copy(`${from}/${e.name}`, `${to}/${e.name}`);
  }
  async usage() {
    return null;
  }
  dispose() {
  }
  async destroy() {
    await dropHandle(this.id);
  }
};

// src/drives/cloud-drive.ts
function norm4(p) {
  const parts = [];
  for (const seg of (p || "/").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return "/" + parts.join("/");
}
function fsError4(code, msg) {
  const e = new Error(`${code}: ${msg}`);
  e.code = code;
  return e;
}
var DEFAULT_ICON = { gdrive: "gdrive", dropbox: "dropbox", onedrive: "onedrive" };
var CloudDrive = class {
  id;
  label;
  kind;
  icon;
  capabilities = { writable: true, streaming: false, nativeSync: false, watch: false, syncBadges: true };
  state = "disconnected";
  base;
  connId;
  provider;
  _fetch;
  constructor(opts) {
    this.id = opts.id;
    this.label = opts.label;
    this.provider = opts.provider;
    this.kind = opts.provider;
    this.icon = opts.icon || DEFAULT_ICON[opts.provider];
    this.base = opts.baseUrl.replace(/\/$/, "");
    this.connId = opts.connectionId;
    const f = opts.fetch || globalThis.fetch.bind(globalThis);
    this._fetch = ((input, init2) => f(input, { credentials: "include", ...init2 }));
  }
  async connect() {
    try {
      await this.list("/");
      this.state = "ready";
    } catch (e) {
      this.state = e.code === "EAUTH" ? "disconnected" : "error";
      throw e;
    }
  }
  url(op, q) {
    const u = new URL(`${this.base}/drives/${this.connId}/${op}`);
    if (q) for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
    return u.toString();
  }
  async api(op, init2, q) {
    const res = await this._fetch(this.url(op, q), init2);
    if (res.status === 401) {
      this.state = "disconnected";
      throw fsError4("EAUTH", "cloud session expired; reconnect");
    }
    if (res.status === 404) throw fsError4("ENOENT", "not found");
    if (!res.ok) throw fsError4("EIO", `cloud ${op} failed (${res.status})`);
    return res.json();
  }
  async stat(path) {
    const r = await this.api("stat", void 0, { path: norm4(path) });
    return { type: r.type, size: r.size, mtimeMs: r.mtimeMs, sync: "synced" };
  }
  async exists(path) {
    try {
      await this.stat(path);
      return true;
    } catch {
      return false;
    }
  }
  async list(path) {
    const r = await this.api("list", void 0, { path: norm4(path) });
    return r.entries.map((x) => ({ name: x.name, type: x.type, size: x.size, mtimeMs: x.mtimeMs, sync: "synced" }));
  }
  async readFile(path) {
    const res = await this._fetch(this.url("read", { path: norm4(path) }));
    if (res.status === 401) {
      this.state = "disconnected";
      throw fsError4("EAUTH", "cloud session expired; reconnect");
    }
    if (!res.ok) throw fsError4("EIO", `cloud read failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }
  async writeFile(path, data) {
    const res = await this._fetch(this.url("write", { path: norm4(path) }), { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: new Blob([data]) });
    if (res.status === 401) {
      this.state = "disconnected";
      throw fsError4("EAUTH", "cloud session expired; reconnect");
    }
    if (!res.ok) throw fsError4("EIO", `cloud write failed (${res.status})`);
  }
  async mkdir(path) {
    await this.api("mkdir", { method: "POST" }, { path: norm4(path) });
  }
  async remove(path) {
    await this.api("remove", { method: "POST" }, { path: norm4(path) });
  }
  async rename(from, to) {
    await this.api("rename", { method: "POST" }, { from: norm4(from), to: norm4(to) });
  }
  async copy(from, to) {
    await this.api("copy", { method: "POST" }, { from: norm4(from), to: norm4(to) });
  }
  async usage() {
    try {
      return await this.api("usage");
    } catch {
      return null;
    }
  }
};

// src/drives/sync-engine.ts
var MANIFEST = ".tdsync.json";
function join4(dir, rel) {
  if (!rel) return dir;
  return dir === "/" ? "/" + rel : dir.replace(/\/$/, "") + "/" + rel;
}
var SyncEngine = class {
  constructor(remote, remotePath, local, localPath) {
    this.remote = remote;
    this.remotePath = remotePath;
    this.local = local;
    this.localPath = localPath;
  }
  /** live per-path status (rel → status), readable by the UI between syncs. */
  statuses = /* @__PURE__ */ new Map();
  running = false;
  status(rel) {
    return this.statuses.get(rel) || "local";
  }
  async sync(opts = {}) {
    if (this.running) throw new Error("sync already running");
    this.running = true;
    const direction = opts.direction || "two-way";
    const set = (rel, s) => {
      this.statuses.set(rel, s);
      opts.onStatus?.(rel, s);
    };
    const result = { downloaded: 0, uploaded: 0, deleted: 0, conflicts: [], errors: [] };
    try {
      await this.local.mkdir(this.localPath, { recursive: true });
      const manifest = await this.readManifest();
      const [remoteList, localList] = await Promise.all([
        this.walk(this.remote, this.remotePath),
        this.walk(this.local, this.localPath)
      ]);
      const rMap = new Map(remoteList.map((e) => [e.rel, e]));
      const lMap = new Map(localList.map((e) => [e.rel, e]));
      const rels = [.../* @__PURE__ */ new Set([...rMap.keys(), ...lMap.keys()])].filter((r) => r !== MANIFEST).sort();
      let done = 0;
      for (const rel of rels) {
        if (opts.signal?.aborted) throw Object.assign(new Error("sync aborted"), { name: "AbortError" });
        const r = rMap.get(rel), l = lMap.get(rel), m = manifest[rel];
        try {
          if (r?.type === "dir" || l?.type === "dir") {
            if (!l && r && direction !== "push") await this.local.mkdir(join4(this.localPath, rel), { recursive: true });
            if (!r && l && direction !== "pull") await this.remote.mkdir(join4(this.remotePath, rel), { recursive: true });
            done++;
            opts.onProgress?.(done, rels.length);
            continue;
          }
          const rChanged = !!r && (!m || r.mtime !== m.rMtime || r.size !== m.size);
          const lChanged = !!l && (!m || l.mtime !== m.lMtime || l.size !== m.size);
          if (r && l) {
            if (rChanged && lChanged) {
              if (direction === "two-way") {
                set(rel, "conflict");
                result.conflicts.push(rel);
              } else if (direction === "pull") {
                await this.download(rel, manifest, set);
                result.downloaded++;
              } else {
                await this.upload(rel, manifest, set);
                result.uploaded++;
              }
            } else if (rChanged && direction !== "push") {
              await this.download(rel, manifest, set);
              result.downloaded++;
            } else if (lChanged && direction !== "pull") {
              await this.upload(rel, manifest, set);
              result.uploaded++;
            } else set(rel, "synced");
          } else if (r && !l) {
            if (m && direction !== "pull") {
              await this.remote.remove(join4(this.remotePath, rel), { recursive: true });
              delete manifest[rel];
              result.deleted++;
              this.statuses.delete(rel);
            } else if (direction !== "push") {
              await this.download(rel, manifest, set);
              result.downloaded++;
            }
          } else if (l && !r) {
            if (m && direction !== "push") {
              await this.local.remove(join4(this.localPath, rel), { recursive: true });
              delete manifest[rel];
              result.deleted++;
              this.statuses.delete(rel);
            } else if (direction !== "pull") {
              await this.upload(rel, manifest, set);
              result.uploaded++;
            }
          }
        } catch (e) {
          set(rel, "error");
          result.errors.push({ path: rel, error: e.message });
        }
        done++;
        opts.onProgress?.(done, rels.length);
      }
      await this.writeManifest(manifest);
      return result;
    } finally {
      this.running = false;
    }
  }
  async download(rel, manifest, set) {
    set(rel, "downloading");
    const rp = join4(this.remotePath, rel), lp = join4(this.localPath, rel);
    await this.local.mkdir(parentRel(lp), { recursive: true });
    await this.local.writeFile(lp, await this.remote.readFile(rp));
    await this.record(rel, manifest);
    set(rel, "synced");
  }
  async upload(rel, manifest, set) {
    set(rel, "uploading");
    const rp = join4(this.remotePath, rel), lp = join4(this.localPath, rel);
    await this.remote.mkdir(parentRel(rp), { recursive: true });
    await this.remote.writeFile(rp, await this.local.readFile(lp));
    await this.record(rel, manifest);
    set(rel, "synced");
  }
  /** Re-stat both sides after an op and store their current mtimes/size. */
  async record(rel, manifest) {
    const [r, l] = await Promise.all([
      this.remote.stat(join4(this.remotePath, rel)).catch(() => null),
      this.local.stat(join4(this.localPath, rel)).catch(() => null)
    ]);
    manifest[rel] = { rMtime: r?.mtimeMs || 0, lMtime: l?.mtimeMs || 0, size: l?.size ?? r?.size ?? 0 };
  }
  async readManifest() {
    try {
      return JSON.parse(new TextDecoder().decode(await this.local.readFile(join4(this.localPath, MANIFEST))));
    } catch {
      return {};
    }
  }
  async writeManifest(m) {
    await this.local.writeFile(join4(this.localPath, MANIFEST), new TextEncoder().encode(JSON.stringify(m)));
  }
  /** Depth-first relative listing of a tree (paths relative to `root`). */
  async walk(drive, root) {
    const out = [];
    const stack = [""];
    while (stack.length) {
      const rel = stack.pop();
      let entries;
      try {
        entries = await drive.list(rel ? join4(root, rel) : root);
      } catch {
        continue;
      }
      for (const e of entries) {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.type === "dir") {
          out.push({ rel: childRel, type: "dir", size: 0, mtime: e.mtimeMs });
          stack.push(childRel);
        } else out.push({ rel: childRel, type: e.type, size: e.size, mtime: e.mtimeMs });
      }
    }
    return out;
  }
};
function parentRel(p) {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

// src/index.ts
function createFS(config) {
  return new VFSFileSystem(config);
}
var _defaultFS;
function getDefaultFS() {
  if (!_defaultFS) _defaultFS = new VFSFileSystem();
  return _defaultFS;
}
function init() {
  return getDefaultFS().init();
}

export { BigIntStats, CloudDrive, Dir, Dirent, DriveManager, FSError, IndexedDbDrive, LocalFolderDrive, LocalStorageDrive, MemoryDrive, NodeReadable, NodeWritable, NodeReadable as ReadStream, SAB_OFFSETS, SIGNAL, SimpleEventEmitter, Stats, SyncEngine, TreeDrive, VFSFileSystem, VfsDrive, NodeWritable as WriteStream, acquireFsLock, constants, createError, createFS, createServiceWorkerBridge, disposeAll, dropHandle, getDefaultFS, init, loadFromOPFS, loadHandle, localFolderSupported, path_exports as path, pickDirectory, releaseFsLock, repairVFS, statusToError, unpackToOPFS };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map