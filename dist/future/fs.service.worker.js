// buffer-shim-bundled.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var require_base64_js = __commonJS({
  "../node_modules/base64-js/index.js"(exports) {
    "use strict";
    exports.byteLength = byteLength;
    exports.toByteArray = toByteArray;
    exports.fromByteArray = fromByteArray;
    var lookup = [];
    var revLookup = [];
    var Arr = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
    var code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (i = 0, len = code.length; i < len; ++i) {
      lookup[i] = code[i];
      revLookup[code.charCodeAt(i)] = i;
    }
    var i;
    var len;
    revLookup["-".charCodeAt(0)] = 62;
    revLookup["_".charCodeAt(0)] = 63;
    function getLens(b64) {
      var len2 = b64.length;
      if (len2 % 4 > 0) {
        throw new Error("Invalid string. Length must be a multiple of 4");
      }
      var validLen = b64.indexOf("=");
      if (validLen === -1) validLen = len2;
      var placeHoldersLen = validLen === len2 ? 0 : 4 - validLen % 4;
      return [validLen, placeHoldersLen];
    }
    function byteLength(b64) {
      var lens = getLens(b64);
      var validLen = lens[0];
      var placeHoldersLen = lens[1];
      return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
    }
    function _byteLength(b64, validLen, placeHoldersLen) {
      return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
    }
    function toByteArray(b64) {
      var tmp;
      var lens = getLens(b64);
      var validLen = lens[0];
      var placeHoldersLen = lens[1];
      var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen));
      var curByte = 0;
      var len2 = placeHoldersLen > 0 ? validLen - 4 : validLen;
      var i2;
      for (i2 = 0; i2 < len2; i2 += 4) {
        tmp = revLookup[b64.charCodeAt(i2)] << 18 | revLookup[b64.charCodeAt(i2 + 1)] << 12 | revLookup[b64.charCodeAt(i2 + 2)] << 6 | revLookup[b64.charCodeAt(i2 + 3)];
        arr[curByte++] = tmp >> 16 & 255;
        arr[curByte++] = tmp >> 8 & 255;
        arr[curByte++] = tmp & 255;
      }
      if (placeHoldersLen === 2) {
        tmp = revLookup[b64.charCodeAt(i2)] << 2 | revLookup[b64.charCodeAt(i2 + 1)] >> 4;
        arr[curByte++] = tmp & 255;
      }
      if (placeHoldersLen === 1) {
        tmp = revLookup[b64.charCodeAt(i2)] << 10 | revLookup[b64.charCodeAt(i2 + 1)] << 4 | revLookup[b64.charCodeAt(i2 + 2)] >> 2;
        arr[curByte++] = tmp >> 8 & 255;
        arr[curByte++] = tmp & 255;
      }
      return arr;
    }
    function tripletToBase64(num) {
      return lookup[num >> 18 & 63] + lookup[num >> 12 & 63] + lookup[num >> 6 & 63] + lookup[num & 63];
    }
    function encodeChunk(uint8, start, end) {
      var tmp;
      var output = [];
      for (var i2 = start; i2 < end; i2 += 3) {
        tmp = (uint8[i2] << 16 & 16711680) + (uint8[i2 + 1] << 8 & 65280) + (uint8[i2 + 2] & 255);
        output.push(tripletToBase64(tmp));
      }
      return output.join("");
    }
    function fromByteArray(uint8) {
      var tmp;
      var len2 = uint8.length;
      var extraBytes = len2 % 3;
      var parts = [];
      var maxChunkLength = 16383;
      for (var i2 = 0, len22 = len2 - extraBytes; i2 < len22; i2 += maxChunkLength) {
        parts.push(encodeChunk(uint8, i2, i2 + maxChunkLength > len22 ? len22 : i2 + maxChunkLength));
      }
      if (extraBytes === 1) {
        tmp = uint8[len2 - 1];
        parts.push(
          lookup[tmp >> 2] + lookup[tmp << 4 & 63] + "=="
        );
      } else if (extraBytes === 2) {
        tmp = (uint8[len2 - 2] << 8) + uint8[len2 - 1];
        parts.push(
          lookup[tmp >> 10] + lookup[tmp >> 4 & 63] + lookup[tmp << 2 & 63] + "="
        );
      }
      return parts.join("");
    }
  }
});
var require_ieee754 = __commonJS({
  "../node_modules/ieee754/index.js"(exports) {
    exports.read = function(buffer, offset, isLE, mLen, nBytes) {
      var e, m;
      var eLen = nBytes * 8 - mLen - 1;
      var eMax = (1 << eLen) - 1;
      var eBias = eMax >> 1;
      var nBits = -7;
      var i = isLE ? nBytes - 1 : 0;
      var d = isLE ? -1 : 1;
      var s = buffer[offset + i];
      i += d;
      e = s & (1 << -nBits) - 1;
      s >>= -nBits;
      nBits += eLen;
      for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {
      }
      m = e & (1 << -nBits) - 1;
      e >>= -nBits;
      nBits += mLen;
      for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {
      }
      if (e === 0) {
        e = 1 - eBias;
      } else if (e === eMax) {
        return m ? NaN : (s ? -1 : 1) * Infinity;
      } else {
        m = m + Math.pow(2, mLen);
        e = e - eBias;
      }
      return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
    };
    exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
      var e, m, c;
      var eLen = nBytes * 8 - mLen - 1;
      var eMax = (1 << eLen) - 1;
      var eBias = eMax >> 1;
      var rt = mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0;
      var i = isLE ? 0 : nBytes - 1;
      var d = isLE ? 1 : -1;
      var s = value < 0 || value === 0 && 1 / value < 0 ? 1 : 0;
      value = Math.abs(value);
      if (isNaN(value) || value === Infinity) {
        m = isNaN(value) ? 1 : 0;
        e = eMax;
      } else {
        e = Math.floor(Math.log(value) / Math.LN2);
        if (value * (c = Math.pow(2, -e)) < 1) {
          e--;
          c *= 2;
        }
        if (e + eBias >= 1) {
          value += rt / c;
        } else {
          value += rt * Math.pow(2, 1 - eBias);
        }
        if (value * c >= 2) {
          e++;
          c /= 2;
        }
        if (e + eBias >= eMax) {
          m = 0;
          e = eMax;
        } else if (e + eBias >= 1) {
          m = (value * c - 1) * Math.pow(2, mLen);
          e = e + eBias;
        } else {
          m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
          e = 0;
        }
      }
      for (; mLen >= 8; buffer[offset + i] = m & 255, i += d, m /= 256, mLen -= 8) {
      }
      e = e << mLen | m;
      eLen += mLen;
      for (; eLen > 0; buffer[offset + i] = e & 255, i += d, e /= 256, eLen -= 8) {
      }
      buffer[offset + i - d] |= s * 128;
    };
  }
});
var require_buffer = __commonJS({
  "../node_modules/buffer/index.js"(exports) {
    "use strict";
    var base64 = require_base64_js();
    var ieee754 = require_ieee754();
    var customInspectSymbol = typeof Symbol === "function" && typeof Symbol["for"] === "function" ? Symbol["for"]("nodejs.util.inspect.custom") : null;
    exports.Buffer = Buffer3;
    exports.SlowBuffer = SlowBuffer;
    exports.INSPECT_MAX_BYTES = 50;
    var K_MAX_LENGTH = 2147483647;
    exports.kMaxLength = K_MAX_LENGTH;
    Buffer3.TYPED_ARRAY_SUPPORT = typedArraySupport();
    if (!Buffer3.TYPED_ARRAY_SUPPORT && typeof console !== "undefined" && typeof console.error === "function") {
      console.error(
        "This browser lacks typed array (Uint8Array) support which is required by `buffer` v5.x. Use `buffer` v4.x if you require old browser support."
      );
    }
    function typedArraySupport() {
      try {
        const arr = new Uint8Array(1);
        const proto = { foo: function() {
          return 42;
        } };
        Object.setPrototypeOf(proto, Uint8Array.prototype);
        Object.setPrototypeOf(arr, proto);
        return arr.foo() === 42;
      } catch (e) {
        return false;
      }
    }
    Object.defineProperty(Buffer3.prototype, "parent", {
      enumerable: true,
      get: function() {
        if (!Buffer3.isBuffer(this)) return void 0;
        return this.buffer;
      }
    });
    Object.defineProperty(Buffer3.prototype, "offset", {
      enumerable: true,
      get: function() {
        if (!Buffer3.isBuffer(this)) return void 0;
        return this.byteOffset;
      }
    });
    function createBuffer(length) {
      if (length > K_MAX_LENGTH) {
        throw new RangeError('The value "' + length + '" is invalid for option "size"');
      }
      const buf = new Uint8Array(length);
      Object.setPrototypeOf(buf, Buffer3.prototype);
      return buf;
    }
    function Buffer3(arg, encodingOrOffset, length) {
      if (typeof arg === "number") {
        if (typeof encodingOrOffset === "string") {
          throw new TypeError(
            'The "string" argument must be of type string. Received type number'
          );
        }
        return allocUnsafe(arg);
      }
      return from(arg, encodingOrOffset, length);
    }
    Buffer3.poolSize = 8192;
    function from(value, encodingOrOffset, length) {
      if (typeof value === "string") {
        return fromString(value, encodingOrOffset);
      }
      if (ArrayBuffer.isView(value)) {
        return fromArrayView(value);
      }
      if (value == null) {
        throw new TypeError(
          "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
        );
      }
      if (isInstance(value, ArrayBuffer) || value && isInstance(value.buffer, ArrayBuffer)) {
        return fromArrayBuffer(value, encodingOrOffset, length);
      }
      if (typeof SharedArrayBuffer !== "undefined" && (isInstance(value, SharedArrayBuffer) || value && isInstance(value.buffer, SharedArrayBuffer))) {
        return fromArrayBuffer(value, encodingOrOffset, length);
      }
      if (typeof value === "number") {
        throw new TypeError(
          'The "value" argument must not be of type number. Received type number'
        );
      }
      const valueOf = value.valueOf && value.valueOf();
      if (valueOf != null && valueOf !== value) {
        return Buffer3.from(valueOf, encodingOrOffset, length);
      }
      const b = fromObject(value);
      if (b) return b;
      if (typeof Symbol !== "undefined" && Symbol.toPrimitive != null && typeof value[Symbol.toPrimitive] === "function") {
        return Buffer3.from(value[Symbol.toPrimitive]("string"), encodingOrOffset, length);
      }
      throw new TypeError(
        "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
      );
    }
    Buffer3.from = function(value, encodingOrOffset, length) {
      return from(value, encodingOrOffset, length);
    };
    Object.setPrototypeOf(Buffer3.prototype, Uint8Array.prototype);
    Object.setPrototypeOf(Buffer3, Uint8Array);
    function assertSize(size) {
      if (typeof size !== "number") {
        throw new TypeError('"size" argument must be of type number');
      } else if (size < 0) {
        throw new RangeError('The value "' + size + '" is invalid for option "size"');
      }
    }
    function alloc(size, fill, encoding) {
      assertSize(size);
      if (size <= 0) {
        return createBuffer(size);
      }
      if (fill !== void 0) {
        return typeof encoding === "string" ? createBuffer(size).fill(fill, encoding) : createBuffer(size).fill(fill);
      }
      return createBuffer(size);
    }
    Buffer3.alloc = function(size, fill, encoding) {
      return alloc(size, fill, encoding);
    };
    function allocUnsafe(size) {
      assertSize(size);
      return createBuffer(size < 0 ? 0 : checked(size) | 0);
    }
    Buffer3.allocUnsafe = function(size) {
      return allocUnsafe(size);
    };
    Buffer3.allocUnsafeSlow = function(size) {
      return allocUnsafe(size);
    };
    function fromString(string, encoding) {
      if (typeof encoding !== "string" || encoding === "") {
        encoding = "utf8";
      }
      if (!Buffer3.isEncoding(encoding)) {
        throw new TypeError("Unknown encoding: " + encoding);
      }
      const length = byteLength(string, encoding) | 0;
      let buf = createBuffer(length);
      const actual = buf.write(string, encoding);
      if (actual !== length) {
        buf = buf.slice(0, actual);
      }
      return buf;
    }
    function fromArrayLike(array) {
      const length = array.length < 0 ? 0 : checked(array.length) | 0;
      const buf = createBuffer(length);
      for (let i = 0; i < length; i += 1) {
        buf[i] = array[i] & 255;
      }
      return buf;
    }
    function fromArrayView(arrayView) {
      if (isInstance(arrayView, Uint8Array)) {
        const copy = new Uint8Array(arrayView);
        return fromArrayBuffer(copy.buffer, copy.byteOffset, copy.byteLength);
      }
      return fromArrayLike(arrayView);
    }
    function fromArrayBuffer(array, byteOffset, length) {
      if (byteOffset < 0 || array.byteLength < byteOffset) {
        throw new RangeError('"offset" is outside of buffer bounds');
      }
      if (array.byteLength < byteOffset + (length || 0)) {
        throw new RangeError('"length" is outside of buffer bounds');
      }
      let buf;
      if (byteOffset === void 0 && length === void 0) {
        buf = new Uint8Array(array);
      } else if (length === void 0) {
        buf = new Uint8Array(array, byteOffset);
      } else {
        buf = new Uint8Array(array, byteOffset, length);
      }
      Object.setPrototypeOf(buf, Buffer3.prototype);
      return buf;
    }
    function fromObject(obj) {
      if (Buffer3.isBuffer(obj)) {
        const len = checked(obj.length) | 0;
        const buf = createBuffer(len);
        if (buf.length === 0) {
          return buf;
        }
        obj.copy(buf, 0, 0, len);
        return buf;
      }
      if (obj.length !== void 0) {
        if (typeof obj.length !== "number" || numberIsNaN(obj.length)) {
          return createBuffer(0);
        }
        return fromArrayLike(obj);
      }
      if (obj.type === "Buffer" && Array.isArray(obj.data)) {
        return fromArrayLike(obj.data);
      }
    }
    function checked(length) {
      if (length >= K_MAX_LENGTH) {
        throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x" + K_MAX_LENGTH.toString(16) + " bytes");
      }
      return length | 0;
    }
    function SlowBuffer(length) {
      if (+length != length) {
        length = 0;
      }
      return Buffer3.alloc(+length);
    }
    Buffer3.isBuffer = function isBuffer(b) {
      return b != null && b._isBuffer === true && b !== Buffer3.prototype;
    };
    Buffer3.compare = function compare(a, b) {
      if (isInstance(a, Uint8Array)) a = Buffer3.from(a, a.offset, a.byteLength);
      if (isInstance(b, Uint8Array)) b = Buffer3.from(b, b.offset, b.byteLength);
      if (!Buffer3.isBuffer(a) || !Buffer3.isBuffer(b)) {
        throw new TypeError(
          'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
        );
      }
      if (a === b) return 0;
      let x = a.length;
      let y = b.length;
      for (let i = 0, len = Math.min(x, y); i < len; ++i) {
        if (a[i] !== b[i]) {
          x = a[i];
          y = b[i];
          break;
        }
      }
      if (x < y) return -1;
      if (y < x) return 1;
      return 0;
    };
    Buffer3.isEncoding = function isEncoding(encoding) {
      switch (String(encoding).toLowerCase()) {
        case "hex":
        case "utf8":
        case "utf-8":
        case "ascii":
        case "latin1":
        case "binary":
        case "base64":
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
          return true;
        default:
          return false;
      }
    };
    Buffer3.concat = function concat(list, length) {
      if (!Array.isArray(list)) {
        throw new TypeError('"list" argument must be an Array of Buffers');
      }
      if (list.length === 0) {
        return Buffer3.alloc(0);
      }
      let i;
      if (length === void 0) {
        length = 0;
        for (i = 0; i < list.length; ++i) {
          length += list[i].length;
        }
      }
      const buffer = Buffer3.allocUnsafe(length);
      let pos = 0;
      for (i = 0; i < list.length; ++i) {
        let buf = list[i];
        if (isInstance(buf, Uint8Array)) {
          if (pos + buf.length > buffer.length) {
            if (!Buffer3.isBuffer(buf)) buf = Buffer3.from(buf);
            buf.copy(buffer, pos);
          } else {
            Uint8Array.prototype.set.call(
              buffer,
              buf,
              pos
            );
          }
        } else if (!Buffer3.isBuffer(buf)) {
          throw new TypeError('"list" argument must be an Array of Buffers');
        } else {
          buf.copy(buffer, pos);
        }
        pos += buf.length;
      }
      return buffer;
    };
    function byteLength(string, encoding) {
      if (Buffer3.isBuffer(string)) {
        return string.length;
      }
      if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
        return string.byteLength;
      }
      if (typeof string !== "string") {
        throw new TypeError(
          'The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type ' + typeof string
        );
      }
      const len = string.length;
      const mustMatch = arguments.length > 2 && arguments[2] === true;
      if (!mustMatch && len === 0) return 0;
      let loweredCase = false;
      for (; ; ) {
        switch (encoding) {
          case "ascii":
          case "latin1":
          case "binary":
            return len;
          case "utf8":
          case "utf-8":
            return utf8ToBytes(string).length;
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return len * 2;
          case "hex":
            return len >>> 1;
          case "base64":
            return base64ToBytes(string).length;
          default:
            if (loweredCase) {
              return mustMatch ? -1 : utf8ToBytes(string).length;
            }
            encoding = ("" + encoding).toLowerCase();
            loweredCase = true;
        }
      }
    }
    Buffer3.byteLength = byteLength;
    function slowToString(encoding, start, end) {
      let loweredCase = false;
      if (start === void 0 || start < 0) {
        start = 0;
      }
      if (start > this.length) {
        return "";
      }
      if (end === void 0 || end > this.length) {
        end = this.length;
      }
      if (end <= 0) {
        return "";
      }
      end >>>= 0;
      start >>>= 0;
      if (end <= start) {
        return "";
      }
      if (!encoding) encoding = "utf8";
      while (true) {
        switch (encoding) {
          case "hex":
            return hexSlice(this, start, end);
          case "utf8":
          case "utf-8":
            return utf8Slice(this, start, end);
          case "ascii":
            return asciiSlice(this, start, end);
          case "latin1":
          case "binary":
            return latin1Slice(this, start, end);
          case "base64":
            return base64Slice(this, start, end);
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return utf16leSlice(this, start, end);
          default:
            if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
            encoding = (encoding + "").toLowerCase();
            loweredCase = true;
        }
      }
    }
    Buffer3.prototype._isBuffer = true;
    function swap(b, n, m) {
      const i = b[n];
      b[n] = b[m];
      b[m] = i;
    }
    Buffer3.prototype.swap16 = function swap16() {
      const len = this.length;
      if (len % 2 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 16-bits");
      }
      for (let i = 0; i < len; i += 2) {
        swap(this, i, i + 1);
      }
      return this;
    };
    Buffer3.prototype.swap32 = function swap32() {
      const len = this.length;
      if (len % 4 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 32-bits");
      }
      for (let i = 0; i < len; i += 4) {
        swap(this, i, i + 3);
        swap(this, i + 1, i + 2);
      }
      return this;
    };
    Buffer3.prototype.swap64 = function swap64() {
      const len = this.length;
      if (len % 8 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 64-bits");
      }
      for (let i = 0; i < len; i += 8) {
        swap(this, i, i + 7);
        swap(this, i + 1, i + 6);
        swap(this, i + 2, i + 5);
        swap(this, i + 3, i + 4);
      }
      return this;
    };
    Buffer3.prototype.toString = function toString() {
      const length = this.length;
      if (length === 0) return "";
      if (arguments.length === 0) return utf8Slice(this, 0, length);
      return slowToString.apply(this, arguments);
    };
    Buffer3.prototype.toLocaleString = Buffer3.prototype.toString;
    Buffer3.prototype.equals = function equals(b) {
      if (!Buffer3.isBuffer(b)) throw new TypeError("Argument must be a Buffer");
      if (this === b) return true;
      return Buffer3.compare(this, b) === 0;
    };
    Buffer3.prototype.inspect = function inspect() {
      let str = "";
      const max = exports.INSPECT_MAX_BYTES;
      str = this.toString("hex", 0, max).replace(/(.{2})/g, "$1 ").trim();
      if (this.length > max) str += " ... ";
      return "<Buffer " + str + ">";
    };
    if (customInspectSymbol) {
      Buffer3.prototype[customInspectSymbol] = Buffer3.prototype.inspect;
    }
    Buffer3.prototype.compare = function compare(target, start, end, thisStart, thisEnd) {
      if (isInstance(target, Uint8Array)) {
        target = Buffer3.from(target, target.offset, target.byteLength);
      }
      if (!Buffer3.isBuffer(target)) {
        throw new TypeError(
          'The "target" argument must be one of type Buffer or Uint8Array. Received type ' + typeof target
        );
      }
      if (start === void 0) {
        start = 0;
      }
      if (end === void 0) {
        end = target ? target.length : 0;
      }
      if (thisStart === void 0) {
        thisStart = 0;
      }
      if (thisEnd === void 0) {
        thisEnd = this.length;
      }
      if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
        throw new RangeError("out of range index");
      }
      if (thisStart >= thisEnd && start >= end) {
        return 0;
      }
      if (thisStart >= thisEnd) {
        return -1;
      }
      if (start >= end) {
        return 1;
      }
      start >>>= 0;
      end >>>= 0;
      thisStart >>>= 0;
      thisEnd >>>= 0;
      if (this === target) return 0;
      let x = thisEnd - thisStart;
      let y = end - start;
      const len = Math.min(x, y);
      const thisCopy = this.slice(thisStart, thisEnd);
      const targetCopy = target.slice(start, end);
      for (let i = 0; i < len; ++i) {
        if (thisCopy[i] !== targetCopy[i]) {
          x = thisCopy[i];
          y = targetCopy[i];
          break;
        }
      }
      if (x < y) return -1;
      if (y < x) return 1;
      return 0;
    };
    function bidirectionalIndexOf(buffer, val, byteOffset, encoding, dir) {
      if (buffer.length === 0) return -1;
      if (typeof byteOffset === "string") {
        encoding = byteOffset;
        byteOffset = 0;
      } else if (byteOffset > 2147483647) {
        byteOffset = 2147483647;
      } else if (byteOffset < -2147483648) {
        byteOffset = -2147483648;
      }
      byteOffset = +byteOffset;
      if (numberIsNaN(byteOffset)) {
        byteOffset = dir ? 0 : buffer.length - 1;
      }
      if (byteOffset < 0) byteOffset = buffer.length + byteOffset;
      if (byteOffset >= buffer.length) {
        if (dir) return -1;
        else byteOffset = buffer.length - 1;
      } else if (byteOffset < 0) {
        if (dir) byteOffset = 0;
        else return -1;
      }
      if (typeof val === "string") {
        val = Buffer3.from(val, encoding);
      }
      if (Buffer3.isBuffer(val)) {
        if (val.length === 0) {
          return -1;
        }
        return arrayIndexOf(buffer, val, byteOffset, encoding, dir);
      } else if (typeof val === "number") {
        val = val & 255;
        if (typeof Uint8Array.prototype.indexOf === "function") {
          if (dir) {
            return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset);
          } else {
            return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset);
          }
        }
        return arrayIndexOf(buffer, [val], byteOffset, encoding, dir);
      }
      throw new TypeError("val must be string, number or Buffer");
    }
    function arrayIndexOf(arr, val, byteOffset, encoding, dir) {
      let indexSize = 1;
      let arrLength = arr.length;
      let valLength = val.length;
      if (encoding !== void 0) {
        encoding = String(encoding).toLowerCase();
        if (encoding === "ucs2" || encoding === "ucs-2" || encoding === "utf16le" || encoding === "utf-16le") {
          if (arr.length < 2 || val.length < 2) {
            return -1;
          }
          indexSize = 2;
          arrLength /= 2;
          valLength /= 2;
          byteOffset /= 2;
        }
      }
      function read(buf, i2) {
        if (indexSize === 1) {
          return buf[i2];
        } else {
          return buf.readUInt16BE(i2 * indexSize);
        }
      }
      let i;
      if (dir) {
        let foundIndex = -1;
        for (i = byteOffset; i < arrLength; i++) {
          if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
            if (foundIndex === -1) foundIndex = i;
            if (i - foundIndex + 1 === valLength) return foundIndex * indexSize;
          } else {
            if (foundIndex !== -1) i -= i - foundIndex;
            foundIndex = -1;
          }
        }
      } else {
        if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength;
        for (i = byteOffset; i >= 0; i--) {
          let found = true;
          for (let j = 0; j < valLength; j++) {
            if (read(arr, i + j) !== read(val, j)) {
              found = false;
              break;
            }
          }
          if (found) return i;
        }
      }
      return -1;
    }
    Buffer3.prototype.includes = function includes(val, byteOffset, encoding) {
      return this.indexOf(val, byteOffset, encoding) !== -1;
    };
    Buffer3.prototype.indexOf = function indexOf(val, byteOffset, encoding) {
      return bidirectionalIndexOf(this, val, byteOffset, encoding, true);
    };
    Buffer3.prototype.lastIndexOf = function lastIndexOf(val, byteOffset, encoding) {
      return bidirectionalIndexOf(this, val, byteOffset, encoding, false);
    };
    function hexWrite(buf, string, offset, length) {
      offset = Number(offset) || 0;
      const remaining = buf.length - offset;
      if (!length) {
        length = remaining;
      } else {
        length = Number(length);
        if (length > remaining) {
          length = remaining;
        }
      }
      const strLen = string.length;
      if (length > strLen / 2) {
        length = strLen / 2;
      }
      let i;
      for (i = 0; i < length; ++i) {
        const parsed = parseInt(string.substr(i * 2, 2), 16);
        if (numberIsNaN(parsed)) return i;
        buf[offset + i] = parsed;
      }
      return i;
    }
    function utf8Write(buf, string, offset, length) {
      return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length);
    }
    function asciiWrite(buf, string, offset, length) {
      return blitBuffer(asciiToBytes(string), buf, offset, length);
    }
    function base64Write(buf, string, offset, length) {
      return blitBuffer(base64ToBytes(string), buf, offset, length);
    }
    function ucs2Write(buf, string, offset, length) {
      return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length);
    }
    Buffer3.prototype.write = function write(string, offset, length, encoding) {
      if (offset === void 0) {
        encoding = "utf8";
        length = this.length;
        offset = 0;
      } else if (length === void 0 && typeof offset === "string") {
        encoding = offset;
        length = this.length;
        offset = 0;
      } else if (isFinite(offset)) {
        offset = offset >>> 0;
        if (isFinite(length)) {
          length = length >>> 0;
          if (encoding === void 0) encoding = "utf8";
        } else {
          encoding = length;
          length = void 0;
        }
      } else {
        throw new Error(
          "Buffer.write(string, encoding, offset[, length]) is no longer supported"
        );
      }
      const remaining = this.length - offset;
      if (length === void 0 || length > remaining) length = remaining;
      if (string.length > 0 && (length < 0 || offset < 0) || offset > this.length) {
        throw new RangeError("Attempt to write outside buffer bounds");
      }
      if (!encoding) encoding = "utf8";
      let loweredCase = false;
      for (; ; ) {
        switch (encoding) {
          case "hex":
            return hexWrite(this, string, offset, length);
          case "utf8":
          case "utf-8":
            return utf8Write(this, string, offset, length);
          case "ascii":
          case "latin1":
          case "binary":
            return asciiWrite(this, string, offset, length);
          case "base64":
            return base64Write(this, string, offset, length);
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return ucs2Write(this, string, offset, length);
          default:
            if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
            encoding = ("" + encoding).toLowerCase();
            loweredCase = true;
        }
      }
    };
    Buffer3.prototype.toJSON = function toJSON() {
      return {
        type: "Buffer",
        data: Array.prototype.slice.call(this._arr || this, 0)
      };
    };
    function base64Slice(buf, start, end) {
      if (start === 0 && end === buf.length) {
        return base64.fromByteArray(buf);
      } else {
        return base64.fromByteArray(buf.slice(start, end));
      }
    }
    function utf8Slice(buf, start, end) {
      end = Math.min(buf.length, end);
      const res = [];
      let i = start;
      while (i < end) {
        const firstByte = buf[i];
        let codePoint = null;
        let bytesPerSequence = firstByte > 239 ? 4 : firstByte > 223 ? 3 : firstByte > 191 ? 2 : 1;
        if (i + bytesPerSequence <= end) {
          let secondByte, thirdByte, fourthByte, tempCodePoint;
          switch (bytesPerSequence) {
            case 1:
              if (firstByte < 128) {
                codePoint = firstByte;
              }
              break;
            case 2:
              secondByte = buf[i + 1];
              if ((secondByte & 192) === 128) {
                tempCodePoint = (firstByte & 31) << 6 | secondByte & 63;
                if (tempCodePoint > 127) {
                  codePoint = tempCodePoint;
                }
              }
              break;
            case 3:
              secondByte = buf[i + 1];
              thirdByte = buf[i + 2];
              if ((secondByte & 192) === 128 && (thirdByte & 192) === 128) {
                tempCodePoint = (firstByte & 15) << 12 | (secondByte & 63) << 6 | thirdByte & 63;
                if (tempCodePoint > 2047 && (tempCodePoint < 55296 || tempCodePoint > 57343)) {
                  codePoint = tempCodePoint;
                }
              }
              break;
            case 4:
              secondByte = buf[i + 1];
              thirdByte = buf[i + 2];
              fourthByte = buf[i + 3];
              if ((secondByte & 192) === 128 && (thirdByte & 192) === 128 && (fourthByte & 192) === 128) {
                tempCodePoint = (firstByte & 15) << 18 | (secondByte & 63) << 12 | (thirdByte & 63) << 6 | fourthByte & 63;
                if (tempCodePoint > 65535 && tempCodePoint < 1114112) {
                  codePoint = tempCodePoint;
                }
              }
          }
        }
        if (codePoint === null) {
          codePoint = 65533;
          bytesPerSequence = 1;
        } else if (codePoint > 65535) {
          codePoint -= 65536;
          res.push(codePoint >>> 10 & 1023 | 55296);
          codePoint = 56320 | codePoint & 1023;
        }
        res.push(codePoint);
        i += bytesPerSequence;
      }
      return decodeCodePointsArray(res);
    }
    var MAX_ARGUMENTS_LENGTH = 4096;
    function decodeCodePointsArray(codePoints) {
      const len = codePoints.length;
      if (len <= MAX_ARGUMENTS_LENGTH) {
        return String.fromCharCode.apply(String, codePoints);
      }
      let res = "";
      let i = 0;
      while (i < len) {
        res += String.fromCharCode.apply(
          String,
          codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
        );
      }
      return res;
    }
    function asciiSlice(buf, start, end) {
      let ret = "";
      end = Math.min(buf.length, end);
      for (let i = start; i < end; ++i) {
        ret += String.fromCharCode(buf[i] & 127);
      }
      return ret;
    }
    function latin1Slice(buf, start, end) {
      let ret = "";
      end = Math.min(buf.length, end);
      for (let i = start; i < end; ++i) {
        ret += String.fromCharCode(buf[i]);
      }
      return ret;
    }
    function hexSlice(buf, start, end) {
      const len = buf.length;
      if (!start || start < 0) start = 0;
      if (!end || end < 0 || end > len) end = len;
      let out = "";
      for (let i = start; i < end; ++i) {
        out += hexSliceLookupTable[buf[i]];
      }
      return out;
    }
    function utf16leSlice(buf, start, end) {
      const bytes = buf.slice(start, end);
      let res = "";
      for (let i = 0; i < bytes.length - 1; i += 2) {
        res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256);
      }
      return res;
    }
    Buffer3.prototype.slice = function slice(start, end) {
      const len = this.length;
      start = ~~start;
      end = end === void 0 ? len : ~~end;
      if (start < 0) {
        start += len;
        if (start < 0) start = 0;
      } else if (start > len) {
        start = len;
      }
      if (end < 0) {
        end += len;
        if (end < 0) end = 0;
      } else if (end > len) {
        end = len;
      }
      if (end < start) end = start;
      const newBuf = this.subarray(start, end);
      Object.setPrototypeOf(newBuf, Buffer3.prototype);
      return newBuf;
    };
    function checkOffset(offset, ext, length) {
      if (offset % 1 !== 0 || offset < 0) throw new RangeError("offset is not uint");
      if (offset + ext > length) throw new RangeError("Trying to access beyond buffer length");
    }
    Buffer3.prototype.readUintLE = Buffer3.prototype.readUIntLE = function readUIntLE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let val = this[offset];
      let mul = 1;
      let i = 0;
      while (++i < byteLength2 && (mul *= 256)) {
        val += this[offset + i] * mul;
      }
      return val;
    };
    Buffer3.prototype.readUintBE = Buffer3.prototype.readUIntBE = function readUIntBE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        checkOffset(offset, byteLength2, this.length);
      }
      let val = this[offset + --byteLength2];
      let mul = 1;
      while (byteLength2 > 0 && (mul *= 256)) {
        val += this[offset + --byteLength2] * mul;
      }
      return val;
    };
    Buffer3.prototype.readUint8 = Buffer3.prototype.readUInt8 = function readUInt8(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 1, this.length);
      return this[offset];
    };
    Buffer3.prototype.readUint16LE = Buffer3.prototype.readUInt16LE = function readUInt16LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      return this[offset] | this[offset + 1] << 8;
    };
    Buffer3.prototype.readUint16BE = Buffer3.prototype.readUInt16BE = function readUInt16BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      return this[offset] << 8 | this[offset + 1];
    };
    Buffer3.prototype.readUint32LE = Buffer3.prototype.readUInt32LE = function readUInt32LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return (this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16) + this[offset + 3] * 16777216;
    };
    Buffer3.prototype.readUint32BE = Buffer3.prototype.readUInt32BE = function readUInt32BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] * 16777216 + (this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3]);
    };
    Buffer3.prototype.readBigUInt64LE = defineBigIntMethod(function readBigUInt64LE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const lo = first + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24;
      const hi = this[++offset] + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + last * 2 ** 24;
      return BigInt(lo) + (BigInt(hi) << BigInt(32));
    });
    Buffer3.prototype.readBigUInt64BE = defineBigIntMethod(function readBigUInt64BE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const hi = first * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset];
      const lo = this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last;
      return (BigInt(hi) << BigInt(32)) + BigInt(lo);
    });
    Buffer3.prototype.readIntLE = function readIntLE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let val = this[offset];
      let mul = 1;
      let i = 0;
      while (++i < byteLength2 && (mul *= 256)) {
        val += this[offset + i] * mul;
      }
      mul *= 128;
      if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
      return val;
    };
    Buffer3.prototype.readIntBE = function readIntBE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let i = byteLength2;
      let mul = 1;
      let val = this[offset + --i];
      while (i > 0 && (mul *= 256)) {
        val += this[offset + --i] * mul;
      }
      mul *= 128;
      if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
      return val;
    };
    Buffer3.prototype.readInt8 = function readInt8(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 1, this.length);
      if (!(this[offset] & 128)) return this[offset];
      return (255 - this[offset] + 1) * -1;
    };
    Buffer3.prototype.readInt16LE = function readInt16LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      const val = this[offset] | this[offset + 1] << 8;
      return val & 32768 ? val | 4294901760 : val;
    };
    Buffer3.prototype.readInt16BE = function readInt16BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      const val = this[offset + 1] | this[offset] << 8;
      return val & 32768 ? val | 4294901760 : val;
    };
    Buffer3.prototype.readInt32LE = function readInt32LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16 | this[offset + 3] << 24;
    };
    Buffer3.prototype.readInt32BE = function readInt32BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] << 24 | this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3];
    };
    Buffer3.prototype.readBigInt64LE = defineBigIntMethod(function readBigInt64LE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const val = this[offset + 4] + this[offset + 5] * 2 ** 8 + this[offset + 6] * 2 ** 16 + (last << 24);
      return (BigInt(val) << BigInt(32)) + BigInt(first + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24);
    });
    Buffer3.prototype.readBigInt64BE = defineBigIntMethod(function readBigInt64BE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const val = (first << 24) + // Overflow
      this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset];
      return (BigInt(val) << BigInt(32)) + BigInt(this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last);
    });
    Buffer3.prototype.readFloatLE = function readFloatLE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return ieee754.read(this, offset, true, 23, 4);
    };
    Buffer3.prototype.readFloatBE = function readFloatBE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return ieee754.read(this, offset, false, 23, 4);
    };
    Buffer3.prototype.readDoubleLE = function readDoubleLE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 8, this.length);
      return ieee754.read(this, offset, true, 52, 8);
    };
    Buffer3.prototype.readDoubleBE = function readDoubleBE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 8, this.length);
      return ieee754.read(this, offset, false, 52, 8);
    };
    function checkInt(buf, value, offset, ext, max, min) {
      if (!Buffer3.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance');
      if (value > max || value < min) throw new RangeError('"value" argument is out of bounds');
      if (offset + ext > buf.length) throw new RangeError("Index out of range");
    }
    Buffer3.prototype.writeUintLE = Buffer3.prototype.writeUIntLE = function writeUIntLE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        const maxBytes = Math.pow(2, 8 * byteLength2) - 1;
        checkInt(this, value, offset, byteLength2, maxBytes, 0);
      }
      let mul = 1;
      let i = 0;
      this[offset] = value & 255;
      while (++i < byteLength2 && (mul *= 256)) {
        this[offset + i] = value / mul & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeUintBE = Buffer3.prototype.writeUIntBE = function writeUIntBE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        const maxBytes = Math.pow(2, 8 * byteLength2) - 1;
        checkInt(this, value, offset, byteLength2, maxBytes, 0);
      }
      let i = byteLength2 - 1;
      let mul = 1;
      this[offset + i] = value & 255;
      while (--i >= 0 && (mul *= 256)) {
        this[offset + i] = value / mul & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeUint8 = Buffer3.prototype.writeUInt8 = function writeUInt8(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 1, 255, 0);
      this[offset] = value & 255;
      return offset + 1;
    };
    Buffer3.prototype.writeUint16LE = Buffer3.prototype.writeUInt16LE = function writeUInt16LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      return offset + 2;
    };
    Buffer3.prototype.writeUint16BE = Buffer3.prototype.writeUInt16BE = function writeUInt16BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
      this[offset] = value >>> 8;
      this[offset + 1] = value & 255;
      return offset + 2;
    };
    Buffer3.prototype.writeUint32LE = Buffer3.prototype.writeUInt32LE = function writeUInt32LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
      this[offset + 3] = value >>> 24;
      this[offset + 2] = value >>> 16;
      this[offset + 1] = value >>> 8;
      this[offset] = value & 255;
      return offset + 4;
    };
    Buffer3.prototype.writeUint32BE = Buffer3.prototype.writeUInt32BE = function writeUInt32BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
      this[offset] = value >>> 24;
      this[offset + 1] = value >>> 16;
      this[offset + 2] = value >>> 8;
      this[offset + 3] = value & 255;
      return offset + 4;
    };
    function wrtBigUInt64LE(buf, value, offset, min, max) {
      checkIntBI(value, min, max, buf, offset, 7);
      let lo = Number(value & BigInt(4294967295));
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      let hi = Number(value >> BigInt(32) & BigInt(4294967295));
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      return offset;
    }
    function wrtBigUInt64BE(buf, value, offset, min, max) {
      checkIntBI(value, min, max, buf, offset, 7);
      let lo = Number(value & BigInt(4294967295));
      buf[offset + 7] = lo;
      lo = lo >> 8;
      buf[offset + 6] = lo;
      lo = lo >> 8;
      buf[offset + 5] = lo;
      lo = lo >> 8;
      buf[offset + 4] = lo;
      let hi = Number(value >> BigInt(32) & BigInt(4294967295));
      buf[offset + 3] = hi;
      hi = hi >> 8;
      buf[offset + 2] = hi;
      hi = hi >> 8;
      buf[offset + 1] = hi;
      hi = hi >> 8;
      buf[offset] = hi;
      return offset + 8;
    }
    Buffer3.prototype.writeBigUInt64LE = defineBigIntMethod(function writeBigUInt64LE(value, offset = 0) {
      return wrtBigUInt64LE(this, value, offset, BigInt(0), BigInt("0xffffffffffffffff"));
    });
    Buffer3.prototype.writeBigUInt64BE = defineBigIntMethod(function writeBigUInt64BE(value, offset = 0) {
      return wrtBigUInt64BE(this, value, offset, BigInt(0), BigInt("0xffffffffffffffff"));
    });
    Buffer3.prototype.writeIntLE = function writeIntLE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        const limit = Math.pow(2, 8 * byteLength2 - 1);
        checkInt(this, value, offset, byteLength2, limit - 1, -limit);
      }
      let i = 0;
      let mul = 1;
      let sub = 0;
      this[offset] = value & 255;
      while (++i < byteLength2 && (mul *= 256)) {
        if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
          sub = 1;
        }
        this[offset + i] = (value / mul >> 0) - sub & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeIntBE = function writeIntBE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        const limit = Math.pow(2, 8 * byteLength2 - 1);
        checkInt(this, value, offset, byteLength2, limit - 1, -limit);
      }
      let i = byteLength2 - 1;
      let mul = 1;
      let sub = 0;
      this[offset + i] = value & 255;
      while (--i >= 0 && (mul *= 256)) {
        if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
          sub = 1;
        }
        this[offset + i] = (value / mul >> 0) - sub & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeInt8 = function writeInt8(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 1, 127, -128);
      if (value < 0) value = 255 + value + 1;
      this[offset] = value & 255;
      return offset + 1;
    };
    Buffer3.prototype.writeInt16LE = function writeInt16LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      return offset + 2;
    };
    Buffer3.prototype.writeInt16BE = function writeInt16BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
      this[offset] = value >>> 8;
      this[offset + 1] = value & 255;
      return offset + 2;
    };
    Buffer3.prototype.writeInt32LE = function writeInt32LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      this[offset + 2] = value >>> 16;
      this[offset + 3] = value >>> 24;
      return offset + 4;
    };
    Buffer3.prototype.writeInt32BE = function writeInt32BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
      if (value < 0) value = 4294967295 + value + 1;
      this[offset] = value >>> 24;
      this[offset + 1] = value >>> 16;
      this[offset + 2] = value >>> 8;
      this[offset + 3] = value & 255;
      return offset + 4;
    };
    Buffer3.prototype.writeBigInt64LE = defineBigIntMethod(function writeBigInt64LE(value, offset = 0) {
      return wrtBigUInt64LE(this, value, offset, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
    });
    Buffer3.prototype.writeBigInt64BE = defineBigIntMethod(function writeBigInt64BE(value, offset = 0) {
      return wrtBigUInt64BE(this, value, offset, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
    });
    function checkIEEE754(buf, value, offset, ext, max, min) {
      if (offset + ext > buf.length) throw new RangeError("Index out of range");
      if (offset < 0) throw new RangeError("Index out of range");
    }
    function writeFloat(buf, value, offset, littleEndian, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        checkIEEE754(buf, value, offset, 4, 34028234663852886e22, -34028234663852886e22);
      }
      ieee754.write(buf, value, offset, littleEndian, 23, 4);
      return offset + 4;
    }
    Buffer3.prototype.writeFloatLE = function writeFloatLE(value, offset, noAssert) {
      return writeFloat(this, value, offset, true, noAssert);
    };
    Buffer3.prototype.writeFloatBE = function writeFloatBE(value, offset, noAssert) {
      return writeFloat(this, value, offset, false, noAssert);
    };
    function writeDouble(buf, value, offset, littleEndian, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        checkIEEE754(buf, value, offset, 8, 17976931348623157e292, -17976931348623157e292);
      }
      ieee754.write(buf, value, offset, littleEndian, 52, 8);
      return offset + 8;
    }
    Buffer3.prototype.writeDoubleLE = function writeDoubleLE(value, offset, noAssert) {
      return writeDouble(this, value, offset, true, noAssert);
    };
    Buffer3.prototype.writeDoubleBE = function writeDoubleBE(value, offset, noAssert) {
      return writeDouble(this, value, offset, false, noAssert);
    };
    Buffer3.prototype.copy = function copy(target, targetStart, start, end) {
      if (!Buffer3.isBuffer(target)) throw new TypeError("argument should be a Buffer");
      if (!start) start = 0;
      if (!end && end !== 0) end = this.length;
      if (targetStart >= target.length) targetStart = target.length;
      if (!targetStart) targetStart = 0;
      if (end > 0 && end < start) end = start;
      if (end === start) return 0;
      if (target.length === 0 || this.length === 0) return 0;
      if (targetStart < 0) {
        throw new RangeError("targetStart out of bounds");
      }
      if (start < 0 || start >= this.length) throw new RangeError("Index out of range");
      if (end < 0) throw new RangeError("sourceEnd out of bounds");
      if (end > this.length) end = this.length;
      if (target.length - targetStart < end - start) {
        end = target.length - targetStart + start;
      }
      const len = end - start;
      if (this === target && typeof Uint8Array.prototype.copyWithin === "function") {
        this.copyWithin(targetStart, start, end);
      } else {
        Uint8Array.prototype.set.call(
          target,
          this.subarray(start, end),
          targetStart
        );
      }
      return len;
    };
    Buffer3.prototype.fill = function fill(val, start, end, encoding) {
      if (typeof val === "string") {
        if (typeof start === "string") {
          encoding = start;
          start = 0;
          end = this.length;
        } else if (typeof end === "string") {
          encoding = end;
          end = this.length;
        }
        if (encoding !== void 0 && typeof encoding !== "string") {
          throw new TypeError("encoding must be a string");
        }
        if (typeof encoding === "string" && !Buffer3.isEncoding(encoding)) {
          throw new TypeError("Unknown encoding: " + encoding);
        }
        if (val.length === 1) {
          const code = val.charCodeAt(0);
          if (encoding === "utf8" && code < 128 || encoding === "latin1") {
            val = code;
          }
        }
      } else if (typeof val === "number") {
        val = val & 255;
      } else if (typeof val === "boolean") {
        val = Number(val);
      }
      if (start < 0 || this.length < start || this.length < end) {
        throw new RangeError("Out of range index");
      }
      if (end <= start) {
        return this;
      }
      start = start >>> 0;
      end = end === void 0 ? this.length : end >>> 0;
      if (!val) val = 0;
      let i;
      if (typeof val === "number") {
        for (i = start; i < end; ++i) {
          this[i] = val;
        }
      } else {
        const bytes = Buffer3.isBuffer(val) ? val : Buffer3.from(val, encoding);
        const len = bytes.length;
        if (len === 0) {
          throw new TypeError('The value "' + val + '" is invalid for argument "value"');
        }
        for (i = 0; i < end - start; ++i) {
          this[i + start] = bytes[i % len];
        }
      }
      return this;
    };
    var errors = {};
    function E(sym, getMessage, Base) {
      errors[sym] = class NodeError extends Base {
        constructor() {
          super();
          Object.defineProperty(this, "message", {
            value: getMessage.apply(this, arguments),
            writable: true,
            configurable: true
          });
          this.name = `${this.name} [${sym}]`;
          this.stack;
          delete this.name;
        }
        get code() {
          return sym;
        }
        set code(value) {
          Object.defineProperty(this, "code", {
            configurable: true,
            enumerable: true,
            value,
            writable: true
          });
        }
        toString() {
          return `${this.name} [${sym}]: ${this.message}`;
        }
      };
    }
    E(
      "ERR_BUFFER_OUT_OF_BOUNDS",
      function(name) {
        if (name) {
          return `${name} is outside of buffer bounds`;
        }
        return "Attempt to access memory outside buffer bounds";
      },
      RangeError
    );
    E(
      "ERR_INVALID_ARG_TYPE",
      function(name, actual) {
        return `The "${name}" argument must be of type number. Received type ${typeof actual}`;
      },
      TypeError
    );
    E(
      "ERR_OUT_OF_RANGE",
      function(str, range, input) {
        let msg = `The value of "${str}" is out of range.`;
        let received = input;
        if (Number.isInteger(input) && Math.abs(input) > 2 ** 32) {
          received = addNumericalSeparator(String(input));
        } else if (typeof input === "bigint") {
          received = String(input);
          if (input > BigInt(2) ** BigInt(32) || input < -(BigInt(2) ** BigInt(32))) {
            received = addNumericalSeparator(received);
          }
          received += "n";
        }
        msg += ` It must be ${range}. Received ${received}`;
        return msg;
      },
      RangeError
    );
    function addNumericalSeparator(val) {
      let res = "";
      let i = val.length;
      const start = val[0] === "-" ? 1 : 0;
      for (; i >= start + 4; i -= 3) {
        res = `_${val.slice(i - 3, i)}${res}`;
      }
      return `${val.slice(0, i)}${res}`;
    }
    function checkBounds(buf, offset, byteLength2) {
      validateNumber(offset, "offset");
      if (buf[offset] === void 0 || buf[offset + byteLength2] === void 0) {
        boundsError(offset, buf.length - (byteLength2 + 1));
      }
    }
    function checkIntBI(value, min, max, buf, offset, byteLength2) {
      if (value > max || value < min) {
        const n = typeof min === "bigint" ? "n" : "";
        let range;
        if (byteLength2 > 3) {
          if (min === 0 || min === BigInt(0)) {
            range = `>= 0${n} and < 2${n} ** ${(byteLength2 + 1) * 8}${n}`;
          } else {
            range = `>= -(2${n} ** ${(byteLength2 + 1) * 8 - 1}${n}) and < 2 ** ${(byteLength2 + 1) * 8 - 1}${n}`;
          }
        } else {
          range = `>= ${min}${n} and <= ${max}${n}`;
        }
        throw new errors.ERR_OUT_OF_RANGE("value", range, value);
      }
      checkBounds(buf, offset, byteLength2);
    }
    function validateNumber(value, name) {
      if (typeof value !== "number") {
        throw new errors.ERR_INVALID_ARG_TYPE(name, "number", value);
      }
    }
    function boundsError(value, length, type) {
      if (Math.floor(value) !== value) {
        validateNumber(value, type);
        throw new errors.ERR_OUT_OF_RANGE(type || "offset", "an integer", value);
      }
      if (length < 0) {
        throw new errors.ERR_BUFFER_OUT_OF_BOUNDS();
      }
      throw new errors.ERR_OUT_OF_RANGE(
        type || "offset",
        `>= ${type ? 1 : 0} and <= ${length}`,
        value
      );
    }
    var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g;
    function base64clean(str) {
      str = str.split("=")[0];
      str = str.trim().replace(INVALID_BASE64_RE, "");
      if (str.length < 2) return "";
      while (str.length % 4 !== 0) {
        str = str + "=";
      }
      return str;
    }
    function utf8ToBytes(string, units) {
      units = units || Infinity;
      let codePoint;
      const length = string.length;
      let leadSurrogate = null;
      const bytes = [];
      for (let i = 0; i < length; ++i) {
        codePoint = string.charCodeAt(i);
        if (codePoint > 55295 && codePoint < 57344) {
          if (!leadSurrogate) {
            if (codePoint > 56319) {
              if ((units -= 3) > -1) bytes.push(239, 191, 189);
              continue;
            } else if (i + 1 === length) {
              if ((units -= 3) > -1) bytes.push(239, 191, 189);
              continue;
            }
            leadSurrogate = codePoint;
            continue;
          }
          if (codePoint < 56320) {
            if ((units -= 3) > -1) bytes.push(239, 191, 189);
            leadSurrogate = codePoint;
            continue;
          }
          codePoint = (leadSurrogate - 55296 << 10 | codePoint - 56320) + 65536;
        } else if (leadSurrogate) {
          if ((units -= 3) > -1) bytes.push(239, 191, 189);
        }
        leadSurrogate = null;
        if (codePoint < 128) {
          if ((units -= 1) < 0) break;
          bytes.push(codePoint);
        } else if (codePoint < 2048) {
          if ((units -= 2) < 0) break;
          bytes.push(
            codePoint >> 6 | 192,
            codePoint & 63 | 128
          );
        } else if (codePoint < 65536) {
          if ((units -= 3) < 0) break;
          bytes.push(
            codePoint >> 12 | 224,
            codePoint >> 6 & 63 | 128,
            codePoint & 63 | 128
          );
        } else if (codePoint < 1114112) {
          if ((units -= 4) < 0) break;
          bytes.push(
            codePoint >> 18 | 240,
            codePoint >> 12 & 63 | 128,
            codePoint >> 6 & 63 | 128,
            codePoint & 63 | 128
          );
        } else {
          throw new Error("Invalid code point");
        }
      }
      return bytes;
    }
    function asciiToBytes(str) {
      const byteArray = [];
      for (let i = 0; i < str.length; ++i) {
        byteArray.push(str.charCodeAt(i) & 255);
      }
      return byteArray;
    }
    function utf16leToBytes(str, units) {
      let c, hi, lo;
      const byteArray = [];
      for (let i = 0; i < str.length; ++i) {
        if ((units -= 2) < 0) break;
        c = str.charCodeAt(i);
        hi = c >> 8;
        lo = c % 256;
        byteArray.push(lo);
        byteArray.push(hi);
      }
      return byteArray;
    }
    function base64ToBytes(str) {
      return base64.toByteArray(base64clean(str));
    }
    function blitBuffer(src, dst, offset, length) {
      let i;
      for (i = 0; i < length; ++i) {
        if (i + offset >= dst.length || i >= src.length) break;
        dst[i + offset] = src[i];
      }
      return i;
    }
    function isInstance(obj, type) {
      return obj instanceof type || obj != null && obj.constructor != null && obj.constructor.name != null && obj.constructor.name === type.name;
    }
    function numberIsNaN(obj) {
      return obj !== obj;
    }
    var hexSliceLookupTable = (function() {
      const alphabet = "0123456789abcdef";
      const table = new Array(256);
      for (let i = 0; i < 16; ++i) {
        const i16 = i * 16;
        for (let j = 0; j < 16; ++j) {
          table[i16 + j] = alphabet[i] + alphabet[j];
        }
      }
      return table;
    })();
    function defineBigIntMethod(fn) {
      return typeof BigInt === "undefined" ? BufferBigIntNotDefined : fn;
    }
    function BufferBigIntNotDefined() {
      throw new Error("BigInt not supported");
    }
  }
});
var import_buffer = __toESM(require_buffer(), 1);
globalThis.Buffer = import_buffer.Buffer;

// src/fs.module-server.ts
var sw = self;
var VFS_MODULE_PREFIX = "/vfs-module/";
var VFS_CONFIG_PREFIX = "/vfs-config/";
var bundledConfigStore = /* @__PURE__ */ new Map();
var workerModuleStore = /* @__PURE__ */ new Map();
function storeWorkerModuleInSW(filePath, code) {
  workerModuleStore.set(filePath, { code, timestamp: Date.now() });
  console.log(`[ModuleServer] Stored worker module: ${filePath} (${code.length} bytes)`);
}
function moduleResponse(content, status = 200, contentType = "application/javascript") {
  return new Response(content, {
    status,
    headers: {
      "Content-Type": contentType,
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp"
    }
  });
}
function storeBundledConfigInSW(pattern, code) {
  bundledConfigStore.set(pattern, { code, timestamp: Date.now() });
  console.log(`[ModuleServer] Stored bundled config for pattern "${pattern}" (${code.length} bytes)`);
  console.log(`[ModuleServer] Config preview: ${code.substring(0, 300).replace(/\n/g, "\\n")}...`);
}
function getBundledConfigFromSW(path) {
  for (const [pattern, { code, timestamp }] of bundledConfigStore.entries()) {
    if (path.includes(pattern)) {
      if (Date.now() - timestamp < 6e4) {
        console.log(`[ModuleServer] Found bundled config for "${path}" via pattern "${pattern}"`);
        return code;
      } else {
        console.log(`[ModuleServer] Bundled config for "${pattern}" is stale, removing`);
        bundledConfigStore.delete(pattern);
      }
    }
  }
  return null;
}
var NODE_BUILTINS = /* @__PURE__ */ new Set([
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "https",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
  "async_hooks",
  "http2",
  "inspector",
  "trace_events",
  "diagnostics_channel",
  "wasi",
  "fs/promises"
]);
function resolveExportCondition(exp) {
  if (typeof exp === "string") return exp;
  if (!exp || typeof exp !== "object") return null;
  for (const cond of ["module", "import", "require", "default", "node"]) {
    if (exp[cond] !== void 0) {
      const result = resolveExportCondition(exp[cond]);
      if (result) return result;
    }
  }
  return null;
}
function isNodeBuiltin(specifier) {
  if (specifier.startsWith("node:")) {
    return true;
  }
  return NODE_BUILTINS.has(specifier);
}
function getBuiltinGlobalKey(specifier) {
  let name = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  name = name.replace(/\//g, "_");
  return `__node_${name}`;
}
function generateBuiltinShim(specifier) {
  const globalKey = getBuiltinGlobalKey(specifier);
  return `// Node.js builtin shim: ${specifier}
const mod = globalThis.${globalKey} || {};
export default mod;
export const {${Array.from(getCommonExports(specifier)).join(", ")}} = mod;
`;
}
function generateRolldownShim(specifier) {
  if (specifier === "rollup/parseAst" || specifier.includes("parseAst")) {
    return `// Rollup parseAst shim -> acorn-based implementation
const nodeRollup = globalThis.__node_rollup || globalThis.__node_rollup__ || {};
export const parseAst = nodeRollup.parseAst || ((code) => { throw new Error('parseAst not available'); });
export const parseAstAsync = nodeRollup.parseAst?.parseAstAsync || (async (code) => parseAst(code));
export default { parseAst, parseAstAsync };
`;
  }
  if (specifier.includes("native") || specifier.includes("dist/")) {
    return `// Rollup native shim -> acorn-based implementation
const nodeRollup = globalThis.__node_rollup || globalThis.__node_rollup__ || {};
export const parse = nodeRollup.parseAst || ((code) => { throw new Error('parse not available'); });
export const parseAsync = nodeRollup.parseAst?.parseAstAsync || (async (code) => parse(code));
export const xxhashBase64Url = () => '';
export const xxhashBase36 = () => '';
export const xxhashBase16 = () => '';
export default { parse, parseAsync, xxhashBase64Url, xxhashBase36, xxhashBase16 };
`;
  }
  return `// Rollup shim -> @rolldown/browser + acorn parseAst
// Wrapped to use our VFS for bundle.write() instead of WASI filesystem
const rolldownInternal = globalThis.__rolldown__ || {};
const nodeRollup = globalThis.__node_rollup || globalThis.__node_rollup__ || {};
const fs = globalThis.__node_fs || globalThis.__node_fs__;
const path = globalThis.__node_path || globalThis.__node_path__;

export const parseAst = nodeRollup.parseAst || ((code) => { throw new Error('parseAst not available'); });
export const parseAstAsync = nodeRollup.parseAst?.parseAstAsync || (async (code) => parseAst(code));

// Wrap the rollup function to intercept bundle.write()
const originalRollup = rolldownInternal.rollup || rolldownInternal.build;

export const rollup = async function(inputOptions) {
    console.log('[rollup shim] rollup() called with:', inputOptions?.input);
    const bundle = await originalRollup(inputOptions);

    // Wrap the bundle object to intercept write()
    return {
        // Preserve all original bundle properties
        ...bundle,
        cache: bundle.cache,
        watchFiles: bundle.watchFiles,
        closed: bundle.closed,

        // Intercept close() to track bundle state
        close: async function() {
            console.log('[rollup shim] bundle.close() called');
            return bundle.close?.();
        },

        // Preserve generate() as-is
        generate: async function(outputOptions) {
            console.log('[rollup shim] bundle.generate() called');
            return bundle.generate(outputOptions);
        },

        // Intercept write() to use our VFS instead of WASI filesystem
        write: async function(outputOptions) {
            console.log('[rollup shim] bundle.write() called with dir:', outputOptions?.dir, 'file:', outputOptions?.file);

            // Use generate() to get output in memory, then write to our VFS
            const result = await bundle.generate(outputOptions);
            console.log('[rollup shim] generate() returned', result?.output?.length || 0, 'chunks');

            if (!fs || !fs.writeFileSync) {
                console.error('[rollup shim] fs.writeFileSync not available, cannot write output');
                return result;
            }

            if (!fs.mkdirSync) {
                console.error('[rollup shim] fs.mkdirSync not available, cannot create directories');
                return result;
            }

            const outDir = outputOptions?.dir || (outputOptions?.file ? (path?.dirname?.(outputOptions.file) || '/') : '/dist');
            console.log('[rollup shim] Output directory:', outDir);

            // Ensure output directory exists
            try {
                fs.mkdirSync(outDir, { recursive: true });
                console.log('[rollup shim] Created output directory:', outDir);
            } catch (err) {
                // Directory might already exist
                console.log('[rollup shim] mkdirSync result (may already exist):', err?.message || 'ok');
            }

            // Write each output chunk/asset to our VFS
            for (const chunk of result.output || []) {
                let filePath;
                if (outputOptions?.file && chunk.type === 'chunk' && chunk.isEntry) {
                    filePath = outputOptions.file;
                } else {
                    filePath = (path?.join ? path.join(outDir, chunk.fileName) : outDir + '/' + chunk.fileName);
                }

                // Ensure parent directory exists for this specific file
                const parentDir = path?.dirname ? path.dirname(filePath) : filePath.substring(0, filePath.lastIndexOf('/'));
                if (parentDir && parentDir !== outDir) {
                    try {
                        fs.mkdirSync(parentDir, { recursive: true });
                    } catch (err) {
                        // Directory might already exist
                    }
                }

                // Write the file content
                if (chunk.type === 'chunk') {
                    console.log('[rollup shim] Writing chunk:', filePath, '(' + (chunk.code?.length || 0) + ' bytes)');
                    fs.writeFileSync(filePath, chunk.code || '');

                    // Write sourcemap if present
                    if (chunk.map && outputOptions?.sourcemap) {
                        const mapPath = filePath + '.map';
                        console.log('[rollup shim] Writing sourcemap:', mapPath);
                        fs.writeFileSync(mapPath, JSON.stringify(chunk.map));
                    }
                } else if (chunk.type === 'asset') {
                    console.log('[rollup shim] Writing asset:', filePath, '(' + (chunk.source?.length || 0) + ' bytes)');
                    fs.writeFileSync(filePath, chunk.source || '');
                }
            }

            console.log('[rollup shim] bundle.write() complete, wrote', result.output?.length || 0, 'files to', outDir);
            return result;
        }
    };
};

export const watch = rolldownInternal.watch;
export const VERSION = rolldownInternal.VERSION || '4.0.0';

// Default export - ensure rollup function is on it
const shimExports = {
    ...rolldownInternal,
    rollup,
    parseAst,
    parseAstAsync,
    watch,
    VERSION
};
export default shimExports;
`;
}
function generateEsbuildShim(specifier) {
  return `// esbuild shim -> @rolldown/browser
// Maps esbuild API to rolldown API
const rolldown = globalThis.__rolldown__ || {};
const fs = globalThis.__node_fs || globalThis.__node_fs__;

// Transform using rolldown's transformSync
export const transform = async (code, options = {}) => {
    console.log('[esbuild shim] transform()');
    if (rolldown.transformSync) {
        try {
            const result = rolldown.transformSync(options.sourcefile || 'input.js', code, {
                loader: options.loader,
                target: options.target,
                jsx: options.jsx,
                jsxFactory: options.jsxFactory,
                jsxFragment: options.jsxFragment,
            });
            return { code: result.code, map: result.map || '', warnings: [] };
        } catch (err) {
            return { code, map: '', warnings: [{ text: err?.message || String(err) }] };
        }
    }
    // Fallback: return code as-is
    return { code, map: '', warnings: [] };
};

export const transformSync = (code, options = {}) => {
    console.log('[esbuild shim] transformSync()');
    if (rolldown.transformSync) {
        try {
            const result = rolldown.transformSync(options.sourcefile || 'input.js', code, {
                loader: options.loader,
                target: options.target,
            });
            return { code: result.code, map: result.map || '', warnings: [] };
        } catch (err) {
            return { code, map: '', warnings: [{ text: err?.message || String(err) }] };
        }
    }
    return { code, map: '', warnings: [] };
};

/**
 * Convert esbuild loader map to rolldown moduleTypes
 * esbuild: { '.png': 'dataurl', '.txt': 'text' }
 * rolldown: { '**/*.png': 'dataurl', '**/*.txt': 'text' }
 */
function convertLoader(loader) {
    if (!loader) return undefined;
    const moduleTypes = {};
    for (const [ext, type] of Object.entries(loader)) {
        const pattern = ext.startsWith('.') ? '**/*' + ext : '**/*.' + ext;
        moduleTypes[pattern] = type;
    }
    return moduleTypes;
}

/**
 * Build using rolldown - maps esbuild options to rolldown options
 */
export const build = async (options = {}) => {
    console.log('[esbuild shim] build()', {
        entryPoints: options.entryPoints,
        stdin: !!options.stdin,
        write: options.write
    });

    if (!rolldown.build) {
        throw new Error('build not available - @rolldown/browser not loaded');
    }

    // Map esbuild options to rolldown options
    const rolldownOptions = {
        // Entry points: esbuild uses entryPoints, rolldown uses input
        input: options.entryPoints || options.input,

        // Working directory
        cwd: options.absWorkingDir,

        // External modules
        external: options.external,

        // Platform (browser/node/neutral)
        platform: options.platform,

        // Treeshaking
        treeshake: options.treeShaking !== false,

        // Module types (converted from esbuild's loader)
        moduleTypes: convertLoader(options.loader),

        // Resolve options
        resolve: {
            extensions: options.resolveExtensions,
            mainFields: options.mainFields,
            conditions: options.conditions,
        },

        // Output options - rolldown uses nested output object
        output: {
            dir: options.outdir,
            file: options.outfile,
            format: options.format === 'iife' ? 'iife' : options.format === 'cjs' ? 'cjs' : 'esm',
            sourcemap: options.sourcemap,
            minify: options.minify,
            name: options.globalName, // for IIFE
        },

        // Plugins
        plugins: options.plugins || [],
    };

    // Handle stdin input (virtual file)
    if (options.stdin) {
        const stdinPath = options.stdin.sourcefile || '/stdin.js';
        rolldownOptions.input = stdinPath;
        rolldownOptions.plugins = [
            {
                name: 'stdin-plugin',
                resolveId(id) {
                    if (id === stdinPath) return id;
                    return null;
                },
                load(id) {
                    if (id === stdinPath) return options.stdin.contents;
                    return null;
                }
            },
            ...(options.plugins || [])
        ];
    }

    // Clean up undefined values
    Object.keys(rolldownOptions).forEach(key => {
        if (rolldownOptions[key] === undefined) delete rolldownOptions[key];
    });
    if (rolldownOptions.resolve) {
        Object.keys(rolldownOptions.resolve).forEach(key => {
            if (rolldownOptions.resolve[key] === undefined) delete rolldownOptions.resolve[key];
        });
        if (Object.keys(rolldownOptions.resolve).length === 0) delete rolldownOptions.resolve;
    }
    if (rolldownOptions.output) {
        Object.keys(rolldownOptions.output).forEach(key => {
            if (rolldownOptions.output[key] === undefined) delete rolldownOptions.output[key];
        });
        if (Object.keys(rolldownOptions.output).length === 0) delete rolldownOptions.output;
    }

    console.log('[esbuild shim] Mapped to rolldown options:', JSON.stringify(rolldownOptions, null, 2));

    try {
        const result = await rolldown.build(rolldownOptions);
        console.log('[esbuild shim] build() completed successfully');

        // Convert rolldown result to esbuild result format
        const outputFiles = [];
        if (result.output) {
            for (const chunk of result.output) {
                const path = chunk.fileName || 'out.js';
                const contents = chunk.type === 'chunk' ? chunk.code : chunk.source;
                outputFiles.push({
                    path,
                    contents: typeof contents === 'string' ? new TextEncoder().encode(contents) : contents,
                    text: typeof contents === 'string' ? contents : new TextDecoder().decode(contents),
                });
            }
        }

        // Write files if write !== false
        if (options.write !== false && fs && fs.writeFileSync) {
            const outDir = options.outdir || (options.outfile ? options.outfile.substring(0, options.outfile.lastIndexOf('/')) : '/dist');
            if (fs.mkdirSync) {
                try { fs.mkdirSync(outDir, { recursive: true }); } catch {}
            }
            for (const file of outputFiles) {
                const filePath = options.outfile || (outDir + '/' + file.path);
                console.log('[esbuild shim] Writing:', filePath);
                fs.writeFileSync(filePath, file.text);
            }
        }

        return {
            errors: [],
            warnings: [],
            outputFiles: options.write === false ? outputFiles : undefined,
            metafile: options.metafile ? { inputs: {}, outputs: {} } : undefined,
        };
    } catch (err) {
        console.error('[esbuild shim] build() failed:', err?.message || err);
        return {
            errors: [{ text: err?.message || String(err), location: null }],
            warnings: [],
            outputFiles: [],
        };
    }
};

export const buildSync = () => {
    throw new Error('buildSync not supported in browser');
};

export const context = async (options = {}) => {
    console.log('[esbuild shim] context()');
    return {
        rebuild: () => build(options),
        watch: () => Promise.resolve(),
        serve: () => Promise.resolve({ host: 'localhost', port: 0 }),
        cancel: () => {},
        dispose: () => {},
    };
};

export const formatMessages = async (messages, options) => messages.map(m => m.text || String(m));
export const formatMessagesSync = (messages, options) => messages.map(m => m.text || String(m));
export const analyzeMetafile = async (metafile) => JSON.stringify(metafile, null, 2);
export const analyzeMetafileSync = (metafile) => JSON.stringify(metafile, null, 2);
export const initialize = async () => { console.log('[esbuild shim] initialize()'); };
export const version = '0.20.0';
export const stop = () => {};

export default {
    build, buildSync, transform, transformSync,
    formatMessages, formatMessagesSync,
    analyzeMetafile, analyzeMetafileSync,
    context, initialize, version, stop
};
`;
}
function generateRolldownPluginutilsShim() {
  return `// @rolldown/pluginutils inline shim
// Composable filter utilities for Rolldown plugin hook filters

// --- utils ---
const postfixRE = /[?#].*$/;
export function cleanUrl(url) { return url.replace(postfixRE, ''); }
export function extractQueryWithoutFragment(url) {
    const qi = url.indexOf('?');
    if (qi === -1) return '';
    const fi = url.indexOf('#', qi);
    return fi === -1 ? url.substring(qi) : url.substring(qi, fi);
}

// --- simple filters ---
const escapeRegexRE = /[-\\/\\\\^$*+?.()|[\\]{}]/g;
function escapeRegex(str) { return str.replace(escapeRegexRE, '\\\\$&'); }

export function exactRegex(str, flags) { return new RegExp('^' + escapeRegex(str) + '$', flags); }
export function prefixRegex(str, flags) { return new RegExp('^' + escapeRegex(str), flags); }

export function makeIdFiltersToMatchWithQuery(input) {
    if (!Array.isArray(input)) return makeIdFilterToMatchWithQuery(input);
    return input.map(i => makeIdFilterToMatchWithQuery(i));
}
function makeIdFilterToMatchWithQuery(input) {
    if (typeof input === 'string') return input + '{?*,}';
    return makeRegexIdFilterToMatchWithQuery(input);
}
function makeRegexIdFilterToMatchWithQuery(input) {
    return new RegExp(input.source.replace(/(?<!\\\\)\\$/g, '(?:\\\\?.*)?$'), input.flags);
}

// --- composable filters ---
class And { constructor(...args) { this.args = args; this.kind = 'and'; } }
class Or { constructor(...args) { this.args = args; this.kind = 'or'; } }
class Not { constructor(expr) { this.expr = expr; this.kind = 'not'; } }
class Id { constructor(p, params) { this.pattern = p; this.kind = 'id'; this.params = params ?? { cleanUrl: false }; } }
class ImporterId { constructor(p, params) { this.pattern = p; this.kind = 'importerId'; this.params = params ?? { cleanUrl: false }; } }
class ModuleType { constructor(p) { this.pattern = p; this.kind = 'moduleType'; } }
class Code { constructor(p) { this.pattern = p; this.kind = 'code'; } }
class Query { constructor(k, p) { this.key = k; this.pattern = p; this.kind = 'query'; } }
class Include { constructor(e) { this.expr = e; this.kind = 'include'; } }
class Exclude { constructor(e) { this.expr = e; this.kind = 'exclude'; } }

export function and(...args) { return new And(...args); }
export function or(...args) { return new Or(...args); }
export function not(expr) { return new Not(expr); }
export function id(pattern, params) { return new Id(pattern, params); }
export function importerId(pattern, params) { return new ImporterId(pattern, params); }
export function moduleType(pattern) { return new ModuleType(pattern); }
export function code(pattern) { return new Code(pattern); }
export function query(key, pattern) { return new Query(key, pattern); }
export function include(expr) { return new Include(expr); }
export function exclude(expr) { return new Exclude(expr); }

export function queries(queryFilter) {
    const arr = Object.entries(queryFilter).map(([k, v]) => new Query(k, v));
    return and(...arr);
}

export function exprInterpreter(expr, code, id, moduleType, importerId, ctx = {}) {
    switch (expr.kind) {
        case 'and': return expr.args.every(e => exprInterpreter(e, code, id, moduleType, importerId, ctx));
        case 'or': return expr.args.some(e => exprInterpreter(e, code, id, moduleType, importerId, ctx));
        case 'not': return !exprInterpreter(expr.expr, code, id, moduleType, importerId, ctx);
        case 'id': {
            if (id === undefined) throw new Error('id required');
            let m = id; if (expr.params.cleanUrl) m = cleanUrl(m);
            return typeof expr.pattern === 'string' ? m === expr.pattern : expr.pattern.test(m);
        }
        case 'importerId': {
            if (importerId === undefined) return false;
            let m = importerId; if (expr.params.cleanUrl) m = cleanUrl(m);
            return typeof expr.pattern === 'string' ? m === expr.pattern : expr.pattern.test(m);
        }
        case 'moduleType': return moduleType === expr.pattern;
        case 'code': {
            if (code === undefined) throw new Error('code required');
            return typeof expr.pattern === 'string' ? code.includes(expr.pattern) : expr.pattern.test(code);
        }
        case 'query': {
            if (id === undefined) throw new Error('id required');
            if (!ctx.urlSearchParamsCache) ctx.urlSearchParamsCache = new URLSearchParams(extractQueryWithoutFragment(id));
            const p = ctx.urlSearchParamsCache;
            if (typeof expr.pattern === 'boolean') return expr.pattern ? p.has(expr.key) : !p.has(expr.key);
            if (typeof expr.pattern === 'string') return p.get(expr.key) === expr.pattern;
            return expr.pattern.test(p.get(expr.key) ?? '');
        }
        default: throw new Error('Unexpected expression: ' + JSON.stringify(expr));
    }
}

export function interpreterImpl(expr, code, id, moduleType, importerId, ctx = {}) {
    let hasInclude = false;
    for (const e of expr) {
        if (e.kind === 'include') { hasInclude = true; if (exprInterpreter(e.expr, code, id, moduleType, importerId, ctx)) return true; }
        else if (e.kind === 'exclude') { if (exprInterpreter(e.expr, code, id, moduleType, importerId, ctx)) return false; }
    }
    return !hasInclude;
}

export function interpreter(exprs, code, id, moduleType, importerId) {
    return interpreterImpl(Array.isArray(exprs) ? exprs : [exprs], code, id, moduleType, importerId);
}

// --- filter-vite-plugins ---
export function filterVitePlugins(plugins) {
    if (!plugins) return [];
    const arr = Array.isArray(plugins) ? plugins : [plugins];
    const result = [];
    for (const plugin of arr) {
        if (!plugin) continue;
        if (Array.isArray(plugin)) { result.push(...filterVitePlugins(plugin)); continue; }
        if ('apply' in plugin) {
            const a = plugin.apply;
            if (typeof a === 'function') { try { if (a({}, { command: 'build', mode: 'production' })) result.push(plugin); } catch { result.push(plugin); } }
            else if (a === 'serve') continue;
            else result.push(plugin);
        } else result.push(plugin);
    }
    return result;
}

export default {
    exactRegex, prefixRegex, makeIdFiltersToMatchWithQuery,
    and, or, not, id, importerId, moduleType, code, query, include, exclude,
    queries, interpreter, interpreterImpl, exprInterpreter, filterVitePlugins,
    cleanUrl, extractQueryWithoutFragment
};
`;
}
function getCommonExports(specifier) {
  const name = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  const exports = {
    "fs": ["readFileSync", "writeFileSync", "existsSync", "mkdirSync", "readdirSync", "statSync", "unlinkSync", "rmdirSync", "promises", "readFile", "writeFile", "mkdir", "readdir", "stat", "unlink", "rmdir", "copyFile", "rename", "access", "constants"],
    "fs/promises": ["readFile", "writeFile", "mkdir", "readdir", "stat", "unlink", "rmdir", "copyFile", "rename", "access"],
    "path": ["join", "resolve", "dirname", "basename", "extname", "relative", "isAbsolute", "normalize", "parse", "format", "sep", "posix", "win32"],
    "url": ["URL", "URLSearchParams", "parse", "format", "resolve", "fileURLToPath", "pathToFileURL"],
    "util": ["promisify", "inspect", "format", "deprecate", "inherits", "isDeepStrictEqual", "types", "TextDecoder", "TextEncoder"],
    "events": ["EventEmitter", "once", "on"],
    "stream": ["Readable", "Writable", "Duplex", "Transform", "PassThrough", "pipeline", "finished"],
    "buffer": ["Buffer", "Blob", "atob", "btoa"],
    "crypto": ["randomBytes", "createHash", "createHmac", "randomUUID", "subtle"],
    "os": ["platform", "arch", "homedir", "tmpdir", "hostname", "cpus", "freemem", "totalmem", "type", "release", "EOL"],
    "process": ["env", "cwd", "argv", "exit", "nextTick", "platform", "arch", "version", "versions", "stdout", "stderr", "stdin"],
    "http": ["createServer", "request", "get", "Agent", "Server", "IncomingMessage", "ServerResponse", "STATUS_CODES"],
    "https": ["createServer", "request", "get", "Agent", "Server"],
    "module": ["createRequire", "builtinModules", "Module"],
    "assert": ["ok", "equal", "notEqual", "deepEqual", "notDeepEqual", "strictEqual", "notStrictEqual", "deepStrictEqual", "notDeepStrictEqual", "fail", "throws", "doesNotThrow", "rejects", "doesNotReject"],
    "perf_hooks": ["performance", "PerformanceObserver"],
    "querystring": ["parse", "stringify", "escape", "unescape"],
    "timers": ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate"],
    "tty": ["isatty", "ReadStream", "WriteStream"],
    "zlib": ["gzip", "gunzip", "deflate", "inflate", "createGzip", "createGunzip", "createDeflate", "createInflate"],
    "readline": ["createInterface", "Interface"],
    "child_process": ["spawn", "exec", "execSync", "execFile", "fork", "spawnSync"],
    "net": ["createServer", "createConnection", "connect", "Socket", "Server"]
  };
  return new Set(exports[name] || []);
}
var getPrimaryClientId = null;
function setPrimaryClientIdGetter(getter) {
  getPrimaryClientId = getter;
}
var pendingReads = /* @__PURE__ */ new Map();
var moduleCache = /* @__PURE__ */ new Map();
var pathCache = /* @__PURE__ */ new Map();
var CACHE_TTL_MS = 1e4;
var resolvedSpecifierCache = /* @__PURE__ */ new Map();
async function requestFileRead(filePath) {
  const requestId = `${filePath}-${Date.now()}-${Math.random()}`;
  const primaryId = getPrimaryClientId?.();
  let client;
  let clientSource = "none";
  if (primaryId) {
    client = await sw.clients.get(primaryId);
    if (client) clientSource = "primary";
  }
  if (!client) {
    const clients = await sw.clients.matchAll({ type: "window" });
    if (clients.length === 0) {
      console.error("[ModuleServer] No clients available for file read");
      return null;
    }
    client = clients[0];
    clientSource = "fallback";
  }
  console.log(`[ModuleServer] Requesting file read via ${clientSource} client: ${filePath}`);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingReads.delete(requestId);
      console.error(`[ModuleServer] File read timeout after 5s: ${filePath}`);
      reject(new Error(`File read timeout: ${filePath}`));
    }, 5e3);
    pendingReads.set(requestId, {
      resolve: (content) => {
        clearTimeout(timeout);
        pendingReads.delete(requestId);
        console.log(`[ModuleServer] File read response received: ${filePath} (${content?.length || 0} bytes)`);
        resolve(content);
      },
      reject: (error) => {
        clearTimeout(timeout);
        pendingReads.delete(requestId);
        reject(error);
      }
    });
    client.postMessage({
      type: "vfs-read-request",
      requestId,
      filePath
    });
  });
}
function handleFileReadResponse(requestId, content, error) {
  const pending = pendingReads.get(requestId);
  if (!pending) {
    console.warn("[ModuleServer] No pending request for:", requestId);
    return;
  }
  if (error) {
    pending.reject(new Error(error));
  } else {
    pending.resolve(content);
  }
}
async function readFileFromVfs(filePath) {
  try {
    const content = await requestFileRead(filePath);
    if (content && content.length > 0) {
      return content;
    }
    return null;
  } catch (err) {
    console.error("[ModuleServer] Error reading file:", filePath, err);
    return null;
  }
}
async function fileExists(filePath) {
  const cached = pathCache.get(filePath);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.resolved !== null;
  }
  const content = await readFileFromVfs(filePath);
  const exists = content !== null && content.length > 0;
  pathCache.set(filePath, { resolved: exists ? filePath : null, timestamp: Date.now() });
  return exists;
}
async function tryPaths(paths) {
  for (const path of paths) {
    if (await fileExists(path)) {
      return path;
    }
  }
  return null;
}
async function resolveModulePath(specifier, importerDir) {
  const cacheKey = importerDir ? `${specifier}::${importerDir}` : specifier;
  const cached = pathCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.resolved;
  }
  const cleanSpec = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  const isBareSpecifier = !cleanSpec.startsWith("/") && !cleanSpec.startsWith(".");
  if (!isBareSpecifier) {
    const basePath = cleanSpec.startsWith("/") ? cleanSpec : `/${cleanSpec}`;
    const directResult = await tryPaths([
      basePath,
      `${basePath}.js`,
      `${basePath}.mjs`,
      `${basePath}/index.js`,
      `${basePath}/index.mjs`
    ]);
    if (directResult) {
      pathCache.set(cacheKey, { resolved: directResult, timestamp: Date.now() });
      return directResult;
    }
    if (cleanSpec.startsWith("/")) {
      console.warn("[ModuleServer] Direct path not found, not falling through to node_modules:", cleanSpec);
      pathCache.set(cacheKey, { resolved: null, timestamp: Date.now() });
      return null;
    }
  }
  const nodeModulesPaths = [];
  if (importerDir) {
    const parts = importerDir.split("/").filter(Boolean);
    for (let i = parts.length; i >= 0; i--) {
      if (i > 0 && parts[i - 1] === "node_modules") continue;
      if (i > 0 && parts[i - 1].startsWith("@")) continue;
      const dir = "/" + parts.slice(0, i).join("/");
      const nmDir = (dir === "/" ? "" : dir) + "/node_modules";
      nodeModulesPaths.push(nmDir);
    }
  }
  if (!nodeModulesPaths.includes("/node_modules")) {
    nodeModulesPaths.push("/node_modules");
  }
  let packageName;
  let subPath = null;
  if (cleanSpec.startsWith("@")) {
    const parts = cleanSpec.split("/");
    packageName = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : cleanSpec;
    subPath = parts.length > 2 ? parts.slice(2).join("/") : null;
  } else {
    const slashIdx = cleanSpec.indexOf("/");
    if (slashIdx > 0) {
      packageName = cleanSpec.slice(0, slashIdx);
      subPath = cleanSpec.slice(slashIdx + 1);
    } else {
      packageName = cleanSpec;
    }
  }
  for (const nmPath of nodeModulesPaths) {
    const pkgPath = `${nmPath}/${packageName}`;
    const pkgJsonData = await readFileFromVfs(`${pkgPath}/package.json`);
    if (!pkgJsonData) continue;
    let pkgJson;
    try {
      pkgJson = JSON.parse(new TextDecoder().decode(pkgJsonData));
    } catch {
      continue;
    }
    if (subPath) {
      const subResult = await resolveSubpath(pkgPath, subPath, pkgJson);
      if (subResult) {
        pathCache.set(cacheKey, { resolved: subResult, timestamp: Date.now() });
        return subResult;
      }
      continue;
    }
    let entry = null;
    if (pkgJson.exports) {
      if (typeof pkgJson.exports === "string") {
        entry = pkgJson.exports;
      } else if (pkgJson.exports["."]) {
        entry = resolveExportCondition(pkgJson.exports["."]);
      }
    }
    if (!entry && pkgJson.module) entry = pkgJson.module;
    if (!entry && pkgJson.main) entry = pkgJson.main;
    if (!entry) entry = "index.js";
    const entryPath = `${pkgPath}/${entry.replace(/^\.\//, "")}`;
    const entryResult = await tryPaths([
      entryPath,
      `${entryPath}.js`,
      `${entryPath}.mjs`
    ]);
    if (entryResult) {
      pathCache.set(cacheKey, { resolved: entryResult, timestamp: Date.now() });
      return entryResult;
    }
    const fallbackResult = await tryPaths([
      `${pkgPath}/index.js`,
      `${pkgPath}/index.mjs`
    ]);
    if (fallbackResult) {
      pathCache.set(cacheKey, { resolved: fallbackResult, timestamp: Date.now() });
      return fallbackResult;
    }
  }
  pathCache.set(cacheKey, { resolved: null, timestamp: Date.now() });
  return null;
}
async function resolveSubpath(pkgPath, subPath, pkgJson) {
  if (pkgJson.exports && typeof pkgJson.exports === "object") {
    const subpathPatterns = [
      `./${subPath}`,
      `./${subPath.replace(/\.js$/, "")}`,
      `./${subPath.replace(/\.mjs$/, "")}`
    ];
    for (const pattern of subpathPatterns) {
      const exp = pkgJson.exports[pattern];
      if (exp) {
        const resolved = resolveExportCondition(exp);
        if (resolved) {
          const resolvedPath = `${pkgPath}/${resolved.replace(/^\.\//, "")}`;
          const subExportResult = await tryPaths([
            resolvedPath,
            `${resolvedPath}.js`,
            `${resolvedPath}.mjs`
          ]);
          if (subExportResult) {
            return subExportResult;
          }
        }
      }
    }
    for (const [key, value] of Object.entries(pkgJson.exports)) {
      if (key.includes("*")) {
        const pattern = key.replace(/\*/g, "(.*)");
        const regex = new RegExp(`^${pattern.replace(/\//g, "\\/")}$`);
        const match = `./${subPath}`.match(regex);
        if (match && match[1]) {
          const resolved = resolveExportCondition(value);
          if (resolved) {
            const actualPath = resolved.replace(/\*/g, match[1]);
            const wildcardPath = `${pkgPath}/${actualPath.replace(/^\.\//, "")}`;
            const wildcardResult = await tryPaths([
              wildcardPath,
              `${wildcardPath}.js`,
              `${wildcardPath}.mjs`
            ]);
            if (wildcardResult) {
              return wildcardResult;
            }
          }
        }
      }
    }
  }
  return tryPaths([
    `${pkgPath}/${subPath}`,
    `${pkgPath}/${subPath}.js`,
    `${pkgPath}/${subPath}.mjs`,
    `${pkgPath}/${subPath}/index.js`
  ]);
}
async function handleModuleFetch(request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith(VFS_CONFIG_PREFIX)) {
    const configPath = decodeURIComponent(url.pathname.slice(VFS_CONFIG_PREFIX.length));
    console.log("[ModuleServer] Config request:", configPath);
    const bundledCode = getBundledConfigFromSW(configPath);
    if (bundledCode) {
      console.log(`[ModuleServer] Serving bundled config for: ${configPath} (${bundledCode.length} bytes)`);
      console.log(`[ModuleServer] Config content preview: ${bundledCode.substring(0, 500).replace(/\n/g, "\\n")}...`);
      return moduleResponse(bundledCode);
    }
    console.warn("[ModuleServer] No bundled config found for:", configPath);
    return moduleResponse(`// Config not found: ${configPath}
throw new Error("Config not found: ${configPath}");`, 404);
  }
  if (!url.pathname.startsWith(VFS_MODULE_PREFIX)) {
    return null;
  }
  let specifier = decodeURIComponent(url.pathname.slice(VFS_MODULE_PREFIX.length));
  if (!specifier.startsWith("/") && !specifier.startsWith("@") && !specifier.startsWith("~file/") && (specifier.includes("/node_modules/") || specifier.includes(".mjs") || specifier.includes(".js"))) {
    specifier = "/" + specifier;
  }
  const importerDir = url.searchParams.get("from") ? decodeURIComponent(url.searchParams.get("from")) : null;
  console.log("[ModuleServer] Fetching module:", specifier, importerDir ? `(from ${importerDir})` : "");
  if (specifier === "@rolldown/pluginutils" || specifier.startsWith("@rolldown/pluginutils/")) {
    console.log("[ModuleServer] Serving @rolldown/pluginutils shim:", specifier);
    return moduleResponse(generateRolldownPluginutilsShim());
  }
  if (specifier === "rollup" || specifier === "rollup/parseAst" || specifier.startsWith("rollup/") || specifier.includes("rollup/dist/")) {
    console.log("[ModuleServer] Redirecting rollup to @rolldown/browser shim:", specifier);
    return moduleResponse(generateRolldownShim(specifier));
  }
  if (specifier === "esbuild" || specifier.startsWith("esbuild/")) {
    console.log("[ModuleServer] Redirecting esbuild to browser shim:", specifier);
    return moduleResponse(generateEsbuildShim(specifier));
  }
  if (specifier === "lightningcss" || specifier.startsWith("lightningcss/")) {
    console.log("[ModuleServer] Serving lightningcss shim:", specifier);
    return moduleResponse(`// lightningcss shim -> globalThis.__node_lightningcss (lazy)
const _mod = () => globalThis.__node_lightningcss || {};
export default new Proxy({}, { get: (_, k) => _mod()[k] });
export function transform(opts) {
  const fn = _mod().transform;
  if (!fn) throw new Error('lightningcss not loaded yet');
  const r = fn(opts);
  if (r && !r.warnings) r.warnings = [];
  return r;
}
export function transformSync(opts) { return transform(opts); }
export function bundle(...a) { return _mod().bundle(...a); }
export function bundleAsync(...a) { return _mod().bundleAsync(...a); }
export function browserslistToTargets(...a) { return _mod().browserslistToTargets(...a); }
export function composeVisitors(...a) { return _mod().composeVisitors(...a); }
export function transformStyleAttribute(...a) { return _mod().transformStyleAttribute(...a); }
export const Features = new Proxy({}, { get(_, k) { return (_mod().Features || {})[k]; } });
`);
  }
  if (specifier === "fsevents" || specifier.startsWith("fsevents/")) {
    console.log("[ModuleServer] Serving fsevents stub:", specifier);
    return moduleResponse(`// fsevents stub (macOS-only, not available in browser)
export default {};
`);
  }
  if (specifier.startsWith("~worker/")) {
    console.log("[ModuleServer] Worker module request:", specifier);
    const stored = workerModuleStore.get(specifier);
    if (stored && Date.now() - stored.timestamp < 6e4) {
      console.log(`[ModuleServer] Serving worker module: ${specifier} (${stored.code.length} bytes)`);
      return moduleResponse(stored.code);
    }
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const retried = workerModuleStore.get(specifier);
      if (retried && Date.now() - retried.timestamp < 6e4) {
        console.log(`[ModuleServer] Serving worker module after ${i + 1} retries: ${specifier}`);
        return moduleResponse(retried.code);
      }
    }
    console.error("[ModuleServer] Worker module not found after retries:", specifier);
    return moduleResponse(`// Worker module not found: ${specifier}
throw new Error("Worker module not found: ${specifier}");`, 500);
  }
  if (specifier.startsWith("~file/")) {
    const filePath = specifier.slice(5);
    console.log("[ModuleServer] Direct file access:", filePath);
    if (filePath.includes("/rollup/dist/") || filePath.includes("/rollup/")) {
      const rollupSubpath = filePath.includes("/rollup/dist/") ? "rollup/" + filePath.split("/rollup/dist/")[1] : "rollup/" + filePath.split("/rollup/")[1];
      console.log("[ModuleServer] Redirecting rollup file to @rolldown/browser:", filePath, "->", rollupSubpath);
      return moduleResponse(generateRolldownShim(rollupSubpath));
    }
    const storedModule = workerModuleStore.get(filePath);
    if (storedModule && Date.now() - storedModule.timestamp < 6e4) {
      console.log(`[ModuleServer] Serving pre-registered worker module: ${filePath} (${storedModule.code.length} bytes)`);
      workerModuleStore.delete(filePath);
      return moduleResponse(storedModule.code);
    }
    let content2 = await readFileFromVfs(filePath);
    if (!content2) {
      for (let retry = 0; retry < 10; retry++) {
        await new Promise((r) => setTimeout(r, 50));
        const stored = workerModuleStore.get(filePath);
        if (stored && Date.now() - stored.timestamp < 6e4) {
          console.log(`[ModuleServer] Serving pre-registered worker module (after ${retry + 1} retries): ${filePath}`);
          workerModuleStore.delete(filePath);
          return moduleResponse(stored.code);
        }
        content2 = await readFileFromVfs(filePath);
        if (content2) {
          console.log(`[ModuleServer] File found after ${retry + 1} retries: ${filePath}`);
          break;
        }
      }
    }
    if (!content2) {
      for (const ext of [".js", ".mjs", ".ts", "/index.js", "/index.mjs"]) {
        const tryPath = filePath + ext;
        const tryContent = await readFileFromVfs(tryPath);
        if (tryContent) {
          const isJson3 = tryPath.endsWith(".json");
          let responseContent3;
          if (isJson3) {
            responseContent3 = `export default ${new TextDecoder().decode(tryContent)};`;
          } else {
            responseContent3 = new TextDecoder().decode(tryContent);
            if (isCjsModule(responseContent3)) {
              responseContent3 = wrapCjsAsEsm(responseContent3, tryPath);
            } else {
              responseContent3 = rewriteImports(responseContent3, tryPath);
            }
          }
          return moduleResponse(responseContent3, 200, isJson3 ? "application/json" : "application/javascript");
        }
      }
      console.warn("[ModuleServer] Direct file not found:", filePath);
      return moduleResponse(`// File not found: ${filePath}
throw new Error("File not found: ${filePath}");`, 404);
    }
    const isJson2 = filePath.endsWith(".json");
    let responseContent2;
    if (isJson2) {
      responseContent2 = `export default ${new TextDecoder().decode(content2)};`;
    } else {
      responseContent2 = new TextDecoder().decode(content2);
      if (isCjsModule(responseContent2)) {
        responseContent2 = wrapCjsAsEsm(responseContent2, filePath);
      } else {
        responseContent2 = rewriteImports(responseContent2, filePath);
      }
    }
    return moduleResponse(responseContent2, 200, isJson2 ? "application/json" : "application/javascript");
  }
  if (isNodeBuiltin(specifier)) {
    console.log("[ModuleServer] Serving builtin shim:", specifier);
    return moduleResponse(generateBuiltinShim(specifier));
  }
  const resolvedPath = await resolveModulePath(specifier, importerDir);
  if (!resolvedPath) {
    console.warn("[ModuleServer] Module not found:", specifier);
    return moduleResponse(`// Module not found: ${specifier}
throw new Error("Module not found: ${specifier}");`, 404);
  }
  console.log("[ModuleServer] Resolved:", specifier, "->", resolvedPath);
  resolvedSpecifierCache.set(specifier, resolvedPath);
  const content = await readFileFromVfs(resolvedPath);
  if (!content) {
    console.warn("[ModuleServer] Resolved file not readable:", resolvedPath);
    return moduleResponse(`// File not found: ${resolvedPath}
throw new Error("File not found: ${resolvedPath}");`, 404);
  }
  const isJson = resolvedPath.endsWith(".json");
  let responseContent;
  if (isJson) {
    responseContent = `export default ${new TextDecoder().decode(content)};`;
  } else {
    responseContent = new TextDecoder().decode(content);
    if (isCjsModule(responseContent)) {
      responseContent = wrapCjsAsEsm(responseContent, resolvedPath);
    } else {
      responseContent = rewriteImports(responseContent, resolvedPath);
    }
  }
  return moduleResponse(responseContent, 200, isJson ? "application/json" : "application/javascript");
}
function resolveRelativePath(relativePath, basePath) {
  const baseDir = basePath.substring(0, basePath.lastIndexOf("/")) || "/";
  if (relativePath.startsWith("./")) {
    return baseDir + relativePath.slice(1);
  }
  if (relativePath.startsWith("../")) {
    const parts = baseDir.split("/").filter(Boolean);
    const relParts = relativePath.split("/");
    for (const part of relParts) {
      if (part === "..") {
        parts.pop();
      } else if (part !== ".") {
        parts.push(part);
      }
    }
    return "/" + parts.join("/");
  }
  if (relativePath.startsWith("/")) {
    return relativePath;
  }
  return relativePath;
}
function isCjsModule(code) {
  const hasEsmImport = /^\s*import\s+/m.test(code);
  const hasEsmExport = /^\s*export\s+/m.test(code);
  if (hasEsmImport || hasEsmExport) return false;
  const hasRequire = /\brequire\s*\(/m.test(code);
  const hasModuleExports = /\bmodule\.exports\b/m.test(code);
  const hasExportsAssign = /\bexports\.\w+\s*=/m.test(code);
  const hasDefineProperty = /Object\.defineProperty\s*\(\s*exports/m.test(code);
  return hasRequire || hasModuleExports || hasExportsAssign || hasDefineProperty;
}
function wrapCjsAsEsm(code, filePath) {
  const dirPath = filePath.substring(0, filePath.lastIndexOf("/")) || "/";
  const requireRegex = /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  const deps = /* @__PURE__ */ new Map();
  let match;
  let counter = 0;
  while ((match = requireRegex.exec(code)) !== null) {
    const specifier = match[2];
    if (!deps.has(specifier)) {
      deps.set(specifier, `__cjs_dep_${counter++}`);
    }
  }
  const imports = [];
  const switchCases = [];
  for (const [specifier, varName] of deps) {
    let moduleUrl;
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const resolved = resolveRelativePath(specifier, filePath);
      moduleUrl = `${VFS_MODULE_PREFIX}~file${resolved}`;
    } else if (specifier.startsWith("/")) {
      moduleUrl = `${VFS_MODULE_PREFIX}~file${specifier}`;
    } else {
      const cachedPath = resolvedSpecifierCache.get(specifier);
      if (cachedPath) {
        moduleUrl = `${VFS_MODULE_PREFIX}~file${cachedPath}`;
      } else {
        moduleUrl = `${VFS_MODULE_PREFIX}${specifier}?from=${encodeURIComponent(dirPath)}`;
      }
    }
    imports.push(`import ${varName} from '${moduleUrl}';`);
    const escapedSpec = specifier.replace(/'/g, "\\'");
    switchCases.push(`    case '${escapedSpec}': return ${varName};`);
  }
  const importSection = imports.length > 0 ? imports.join("\n") + "\n" : "";
  const switchBody = switchCases.length > 0 ? `
  switch(id) {
${switchCases.join("\n")}
  }` : "";
  return `${importSection}// CJS-to-ESM wrapper for: ${filePath}
var module = { exports: {} };
var exports = module.exports;
var __filename = "${filePath}";
var __dirname = "${dirPath}";
var __baseRequire = globalThis.require || globalThis.__globalRequire || ((id) => { throw new Error("Cannot find module '" + id + "'"); });
var require = function(id) {${switchBody}
  return __baseRequire(id, __dirname);
};
require.resolve = __baseRequire.resolve ? function(id, opts) { return __baseRequire.resolve(id, opts || { paths: [__dirname] }); } : function(id) { return id; };
require.cache = __baseRequire.cache || {};
var process = globalThis.process || globalThis.__node_process || { env: {} };
var Buffer = globalThis.Buffer || undefined;
var global = globalThis;

${code}

// Use 'export { x as default }' instead of 'export default x' to avoid TDZ in circular deps.
// 'var' is hoisted (starts as undefined), so the binding is always accessible.
// 'export default expr' creates an uninitialized binding until the line executes \u2192 TDZ error.
var __cjsExports = module.exports;
export { __cjsExports as default };
export var __esModule = __cjsExports?.__esModule;
`;
}
function validateModuleCode(code, modulePath) {
  const malformedImportStar = /\bimport\s+\*\s+from\b/g;
  let match;
  while ((match = malformedImportStar.exec(code)) !== null) {
    const start = Math.max(0, match.index - 20);
    const end = Math.min(code.length, match.index + 50);
    console.error(`[ModuleServer] MALFORMED 'import * from' in ${modulePath}: ...${code.slice(start, end)}...`);
  }
  const exportStarPattern = /\bexport\s+\*\s+(?:as\s+\w+\s+)?from\s+/g;
  let exportCount = 0;
  while ((match = exportStarPattern.exec(code)) !== null) {
    exportCount++;
    if (exportCount <= 5) {
      const start = Math.max(0, match.index);
      const end = Math.min(code.length, match.index + 80);
      console.log(`[ModuleServer] Found 'export *' in ${modulePath}: ${code.slice(start, end)}`);
    }
  }
  if (exportCount > 5) {
    console.log(`[ModuleServer] ... and ${exportCount - 5} more 'export *' patterns in ${modulePath}`);
  }
}
function rewriteImports(code, basePath) {
  validateModuleCode(code, basePath);
  const baseDir = basePath.substring(0, basePath.lastIndexOf("/")) || "/";
  const rewriteSpecifier = (specifier) => {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const resolved = resolveRelativePath(specifier, basePath);
      return `${VFS_MODULE_PREFIX}~file${resolved}`;
    }
    if (isRelativeOrAbsolute(specifier)) {
      return specifier;
    }
    const cachedPath = resolvedSpecifierCache.get(specifier);
    if (cachedPath) {
      return `${VFS_MODULE_PREFIX}~file${cachedPath}`;
    }
    return `${VFS_MODULE_PREFIX}${specifier}?from=${encodeURIComponent(baseDir)}`;
  };
  const result = code.replace(
    /\bimport\s+([^'"]+)\s+from\s+(['"])([^'"]+)\2/g,
    (match, imports, quote, specifier) => {
      const rewritten = rewriteSpecifier(specifier);
      if (rewritten === specifier) return match;
      return `import ${imports} from ${quote}${rewritten}${quote}`;
    }
  ).replace(
    /\bimport\s+(['"])([^'"]+)\1\s*;?/g,
    (match, quote, specifier) => {
      if (match.includes("import type")) return match;
      const rewritten = rewriteSpecifier(specifier);
      if (rewritten === specifier) return match;
      return `import ${quote}${rewritten}${quote};`;
    }
  ).replace(
    /\bexport\s+([^'"]+)\s+from\s+(['"])([^'"]+)\2/g,
    (match, exports, quote, specifier) => {
      const rewritten = rewriteSpecifier(specifier);
      if (rewritten === specifier) return match;
      return `export ${exports} from ${quote}${rewritten}${quote}`;
    }
  ).replace(
    /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
    (match, quote, specifier) => {
      const rewritten = rewriteSpecifier(specifier);
      if (rewritten === specifier) return match;
      return `import(${quote}${rewritten}${quote})`;
    }
  );
  validateModuleCode(result, basePath + " (after rewrite)");
  return result;
}
function isRelativeOrAbsolute(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/") || specifier.startsWith("data:") || specifier.startsWith("blob:") || specifier.startsWith("http:") || specifier.startsWith("https:");
}
function isModuleRequest(request) {
  const url = new URL(request.url);
  return url.pathname.startsWith(VFS_MODULE_PREFIX) || url.pathname.startsWith(VFS_CONFIG_PREFIX);
}
function invalidateIndexCache() {
  moduleCache.clear();
  pathCache.clear();
  resolvedSpecifierCache.clear();
}

// src/fs.service.worker.ts
var sw2 = self;
var pendingPorts = [];
var primaryClientId = null;
var primaryPort = null;
setPrimaryClientIdGetter(() => primaryClientId);
console.log("[ServiceWorker] Starting (Port Shuttle mode)...");
sw2.addEventListener("activate", (event) => {
  console.log("[ServiceWorker] Activating...");
  event.waitUntil(sw2.clients.claim());
});
sw2.addEventListener("install", (event) => {
  console.log("[ServiceWorker] Installing...");
  event.waitUntil(sw2.skipWaiting());
});
sw2.addEventListener("fetch", (event) => {
  const fetchEvent = event;
  if (!isModuleRequest(fetchEvent.request)) {
    return;
  }
  console.log("[ServiceWorker] Intercepting module request:", fetchEvent.request.url);
  fetchEvent.respondWith(
    (async () => {
      try {
        const response = await handleModuleFetch(fetchEvent.request);
        if (response) {
          return response;
        }
        return fetch(fetchEvent.request);
      } catch (err) {
        console.error("[ServiceWorker] Module fetch error:", err);
        return new Response(`// Module fetch error: ${err.message}`, {
          status: 500,
          headers: {
            "Content-Type": "application/javascript",
            "Cross-Origin-Resource-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp"
          }
        });
      }
    })()
  );
});
async function sendToClient(clientId, message, transfer) {
  try {
    const client = await sw2.clients.get(clientId);
    if (client) {
      if (transfer && transfer.length > 0) {
        client.postMessage(message, transfer);
      } else {
        client.postMessage(message);
      }
      return true;
    }
  } catch (err) {
    console.error(`[ServiceWorker] Failed to send to client ${clientId}:`, err);
  }
  return false;
}
sw2.addEventListener("message", async (event) => {
  const { type } = event.data;
  const clientId = event.source?.id;
  if (!clientId) {
    console.error("[ServiceWorker] Message received without client ID");
    return;
  }
  console.log(`[ServiceWorker] Message from ${clientId}: ${type}`);
  if (type === "register-primary") {
    console.log(`[ServiceWorker] Primary registered: ${clientId}`);
    primaryClientId = clientId;
    if (event.ports[0]) {
      primaryPort = event.ports[0];
    }
    console.log(`[ServiceWorker] Sending ${pendingPorts.length} pending ports to primary`);
    for (const { clientId: secondaryId, port } of pendingPorts) {
      console.log(`[ServiceWorker] Forwarding port from ${secondaryId} to primary`);
      if (primaryPort) {
        primaryPort.postMessage({ type: "secondary-port", secondaryClientId: secondaryId }, [port]);
      } else {
        await sendToClient(clientId, { type: "secondary-port", secondaryClientId: secondaryId }, [port]);
      }
    }
    pendingPorts.length = 0;
    return;
  }
  if (type === "request-connection") {
    const port = event.ports[0];
    if (!port) {
      console.error(`[ServiceWorker] request-connection from ${clientId} has no port!`);
      return;
    }
    console.log(`[ServiceWorker] Secondary ${clientId} requesting connection with port`);
    if (primaryPort) {
      console.log(`[ServiceWorker] Forwarding port to primary via control port`);
      primaryPort.postMessage({ type: "secondary-port", secondaryClientId: clientId }, [port]);
    } else if (primaryClientId) {
      console.log(`[ServiceWorker] Forwarding port to primary ${primaryClientId}`);
      const sent = await sendToClient(primaryClientId, {
        type: "secondary-port",
        secondaryClientId: clientId
      }, [port]);
      if (!sent) {
        console.log(`[ServiceWorker] Primary not available, queuing port`);
        primaryClientId = null;
        pendingPorts.push({ clientId, port });
      }
    } else {
      console.log(`[ServiceWorker] No primary yet, queuing port from ${clientId}`);
      pendingPorts.push({ clientId, port });
      try {
        const allClients = await sw2.clients.matchAll({ type: "window" });
        console.log(`[ServiceWorker] Broadcasting discover-primary to ${allClients.length} clients`);
        for (const client of allClients) {
          if (client.id !== clientId) {
            client.postMessage({ type: "discover-primary" });
          }
        }
      } catch (err) {
        console.error("[ServiceWorker] Failed to broadcast discover-primary:", err);
      }
    }
    return;
  }
  if (type === "disconnect") {
    console.log(`[ServiceWorker] Client ${clientId} disconnecting`);
    if (clientId === primaryClientId) {
      primaryClientId = null;
      primaryPort = null;
    }
    const idx = pendingPorts.findIndex((p) => p.clientId === clientId);
    if (idx !== -1) {
      pendingPorts.splice(idx, 1);
    }
    return;
  }
  if (type === "vfs-changed") {
    console.log("[ServiceWorker] VFS changed, invalidating module cache");
    invalidateIndexCache();
    return;
  }
  if (type === "vfs-read-response") {
    const { requestId, content, error } = event.data;
    const contentArray = content ? new Uint8Array(content) : null;
    handleFileReadResponse(requestId, contentArray, error);
    return;
  }
  if (type === "store-bundled-config") {
    const { pattern, code } = event.data;
    console.log(`[ServiceWorker] Storing bundled config for pattern "${pattern}" (${code?.length || 0} bytes)`);
    storeBundledConfigInSW(pattern, code);
    return;
  }
  if (type === "store-worker-module") {
    const { filePath, code } = event.data;
    console.log(`[ServiceWorker] Storing worker module: ${filePath} (${code?.length || 0} bytes)`);
    storeWorkerModuleInSW(filePath, code);
    return;
  }
});
setInterval(async () => {
  const allClients = await sw2.clients.matchAll();
  const activeClientIds = new Set(allClients.map((c) => c.id));
  if (primaryClientId && !activeClientIds.has(primaryClientId)) {
    console.log(`[ServiceWorker] Primary ${primaryClientId} no longer exists, clearing`);
    primaryClientId = null;
  }
  for (let i = pendingPorts.length - 1; i >= 0; i--) {
    if (!activeClientIds.has(pendingPorts[i].clientId)) {
      console.log(`[ServiceWorker] Removing pending port for disconnected ${pendingPorts[i].clientId}`);
      pendingPorts.splice(i, 1);
    }
  }
}, 5e3);
/*! Bundled license information:

ieee754/index.js:
  (*! ieee754. BSD-3-Clause License. Feross Aboukhadijeh <https://feross.org/opensource> *)

buffer/index.js:
  (*!
   * The buffer module from node.js, for the browser.
   *
   * @author   Feross Aboukhadijeh <https://feross.org>
   * @license  MIT
   *)
*/
//# sourceMappingURL=fs.service.worker.js.map