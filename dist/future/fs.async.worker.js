var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
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

// buffer-shim-bundled.js
var __create2, __defProp2, __getOwnPropDesc2, __getOwnPropNames2, __getProtoOf2, __hasOwnProp2, __commonJS2, __copyProps2, __toESM2, require_base64_js, require_ieee754, require_buffer, import_buffer;
var init_buffer_shim_bundled = __esm({
  "buffer-shim-bundled.js"() {
    "use strict";
    __create2 = Object.create;
    __defProp2 = Object.defineProperty;
    __getOwnPropDesc2 = Object.getOwnPropertyDescriptor;
    __getOwnPropNames2 = Object.getOwnPropertyNames;
    __getProtoOf2 = Object.getPrototypeOf;
    __hasOwnProp2 = Object.prototype.hasOwnProperty;
    __commonJS2 = (cb, mod) => function __require() {
      return mod || (0, cb[__getOwnPropNames2(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    };
    __copyProps2 = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames2(from))
          if (!__hasOwnProp2.call(to, key) && key !== except)
            __defProp2(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc2(from, key)) || desc.enumerable });
      }
      return to;
    };
    __toESM2 = (mod, isNodeMode, target) => (target = mod != null ? __create2(__getProtoOf2(mod)) : {}, __copyProps2(
      // If the importer is in node compatibility mode or this is not an ESM
      // file that has been converted to a CommonJS file using a Babel-
      // compatible transform (i.e. "__esModule" has not been set), then set
      // "default" to the CommonJS "module.exports" for node compatibility.
      isNodeMode || !mod || !mod.__esModule ? __defProp2(target, "default", { value: mod, enumerable: true }) : target,
      mod
    ));
    require_base64_js = __commonJS2({
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
    require_ieee754 = __commonJS2({
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
    require_buffer = __commonJS2({
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
          function read2(buf, i2) {
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
              if (read2(arr, i) === read2(val, foundIndex === -1 ? 0 : i - foundIndex)) {
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
                if (read2(arr, i + j) !== read2(val, j)) {
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
        Buffer3.prototype.write = function write2(string, offset, length, encoding) {
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
    import_buffer = __toESM2(require_buffer(), 1);
    globalThis.Buffer = import_buffer.Buffer;
  }
});

// ../node_modules/events/events.js
var require_events = __commonJS({
  "../node_modules/events/events.js"(exports, module) {
    "use strict";
    init_buffer_shim_bundled();
    var R = typeof Reflect === "object" ? Reflect : null;
    var ReflectApply = R && typeof R.apply === "function" ? R.apply : function ReflectApply2(target, receiver, args) {
      return Function.prototype.apply.call(target, receiver, args);
    };
    var ReflectOwnKeys;
    if (R && typeof R.ownKeys === "function") {
      ReflectOwnKeys = R.ownKeys;
    } else if (Object.getOwnPropertySymbols) {
      ReflectOwnKeys = function ReflectOwnKeys2(target) {
        return Object.getOwnPropertyNames(target).concat(Object.getOwnPropertySymbols(target));
      };
    } else {
      ReflectOwnKeys = function ReflectOwnKeys2(target) {
        return Object.getOwnPropertyNames(target);
      };
    }
    function ProcessEmitWarning(warning) {
      if (console && console.warn) console.warn(warning);
    }
    var NumberIsNaN = Number.isNaN || function NumberIsNaN2(value) {
      return value !== value;
    };
    function EventEmitter4() {
      EventEmitter4.init.call(this);
    }
    module.exports = EventEmitter4;
    module.exports.once = once;
    EventEmitter4.EventEmitter = EventEmitter4;
    EventEmitter4.prototype._events = void 0;
    EventEmitter4.prototype._eventsCount = 0;
    EventEmitter4.prototype._maxListeners = void 0;
    var defaultMaxListeners = 10;
    function checkListener(listener) {
      if (typeof listener !== "function") {
        throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
      }
    }
    Object.defineProperty(EventEmitter4, "defaultMaxListeners", {
      enumerable: true,
      get: function() {
        return defaultMaxListeners;
      },
      set: function(arg) {
        if (typeof arg !== "number" || arg < 0 || NumberIsNaN(arg)) {
          throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received ' + arg + ".");
        }
        defaultMaxListeners = arg;
      }
    });
    EventEmitter4.init = function() {
      if (this._events === void 0 || this._events === Object.getPrototypeOf(this)._events) {
        this._events = /* @__PURE__ */ Object.create(null);
        this._eventsCount = 0;
      }
      this._maxListeners = this._maxListeners || void 0;
    };
    EventEmitter4.prototype.setMaxListeners = function setMaxListeners(n) {
      if (typeof n !== "number" || n < 0 || NumberIsNaN(n)) {
        throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n + ".");
      }
      this._maxListeners = n;
      return this;
    };
    function _getMaxListeners(that) {
      if (that._maxListeners === void 0)
        return EventEmitter4.defaultMaxListeners;
      return that._maxListeners;
    }
    EventEmitter4.prototype.getMaxListeners = function getMaxListeners() {
      return _getMaxListeners(this);
    };
    EventEmitter4.prototype.emit = function emit(type) {
      var args = [];
      for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
      var doError = type === "error";
      var events = this._events;
      if (events !== void 0)
        doError = doError && events.error === void 0;
      else if (!doError)
        return false;
      if (doError) {
        var er;
        if (args.length > 0)
          er = args[0];
        if (er instanceof Error) {
          throw er;
        }
        var err = new Error("Unhandled error." + (er ? " (" + er.message + ")" : ""));
        err.context = er;
        throw err;
      }
      var handler = events[type];
      if (handler === void 0)
        return false;
      if (typeof handler === "function") {
        ReflectApply(handler, this, args);
      } else {
        var len = handler.length;
        var listeners = arrayClone(handler, len);
        for (var i = 0; i < len; ++i)
          ReflectApply(listeners[i], this, args);
      }
      return true;
    };
    function _addListener(target, type, listener, prepend) {
      var m;
      var events;
      var existing;
      checkListener(listener);
      events = target._events;
      if (events === void 0) {
        events = target._events = /* @__PURE__ */ Object.create(null);
        target._eventsCount = 0;
      } else {
        if (events.newListener !== void 0) {
          target.emit(
            "newListener",
            type,
            listener.listener ? listener.listener : listener
          );
          events = target._events;
        }
        existing = events[type];
      }
      if (existing === void 0) {
        existing = events[type] = listener;
        ++target._eventsCount;
      } else {
        if (typeof existing === "function") {
          existing = events[type] = prepend ? [listener, existing] : [existing, listener];
        } else if (prepend) {
          existing.unshift(listener);
        } else {
          existing.push(listener);
        }
        m = _getMaxListeners(target);
        if (m > 0 && existing.length > m && !existing.warned) {
          existing.warned = true;
          var w = new Error("Possible EventEmitter memory leak detected. " + existing.length + " " + String(type) + " listeners added. Use emitter.setMaxListeners() to increase limit");
          w.name = "MaxListenersExceededWarning";
          w.emitter = target;
          w.type = type;
          w.count = existing.length;
          ProcessEmitWarning(w);
        }
      }
      return target;
    }
    EventEmitter4.prototype.addListener = function addListener(type, listener) {
      return _addListener(this, type, listener, false);
    };
    EventEmitter4.prototype.on = EventEmitter4.prototype.addListener;
    EventEmitter4.prototype.prependListener = function prependListener(type, listener) {
      return _addListener(this, type, listener, true);
    };
    function onceWrapper() {
      if (!this.fired) {
        this.target.removeListener(this.type, this.wrapFn);
        this.fired = true;
        if (arguments.length === 0)
          return this.listener.call(this.target);
        return this.listener.apply(this.target, arguments);
      }
    }
    function _onceWrap(target, type, listener) {
      var state = { fired: false, wrapFn: void 0, target, type, listener };
      var wrapped = onceWrapper.bind(state);
      wrapped.listener = listener;
      state.wrapFn = wrapped;
      return wrapped;
    }
    EventEmitter4.prototype.once = function once2(type, listener) {
      checkListener(listener);
      this.on(type, _onceWrap(this, type, listener));
      return this;
    };
    EventEmitter4.prototype.prependOnceListener = function prependOnceListener(type, listener) {
      checkListener(listener);
      this.prependListener(type, _onceWrap(this, type, listener));
      return this;
    };
    EventEmitter4.prototype.removeListener = function removeListener(type, listener) {
      var list, events, position, i, originalListener;
      checkListener(listener);
      events = this._events;
      if (events === void 0)
        return this;
      list = events[type];
      if (list === void 0)
        return this;
      if (list === listener || list.listener === listener) {
        if (--this._eventsCount === 0)
          this._events = /* @__PURE__ */ Object.create(null);
        else {
          delete events[type];
          if (events.removeListener)
            this.emit("removeListener", type, list.listener || listener);
        }
      } else if (typeof list !== "function") {
        position = -1;
        for (i = list.length - 1; i >= 0; i--) {
          if (list[i] === listener || list[i].listener === listener) {
            originalListener = list[i].listener;
            position = i;
            break;
          }
        }
        if (position < 0)
          return this;
        if (position === 0)
          list.shift();
        else {
          spliceOne(list, position);
        }
        if (list.length === 1)
          events[type] = list[0];
        if (events.removeListener !== void 0)
          this.emit("removeListener", type, originalListener || listener);
      }
      return this;
    };
    EventEmitter4.prototype.off = EventEmitter4.prototype.removeListener;
    EventEmitter4.prototype.removeAllListeners = function removeAllListeners(type) {
      var listeners, events, i;
      events = this._events;
      if (events === void 0)
        return this;
      if (events.removeListener === void 0) {
        if (arguments.length === 0) {
          this._events = /* @__PURE__ */ Object.create(null);
          this._eventsCount = 0;
        } else if (events[type] !== void 0) {
          if (--this._eventsCount === 0)
            this._events = /* @__PURE__ */ Object.create(null);
          else
            delete events[type];
        }
        return this;
      }
      if (arguments.length === 0) {
        var keys = Object.keys(events);
        var key;
        for (i = 0; i < keys.length; ++i) {
          key = keys[i];
          if (key === "removeListener") continue;
          this.removeAllListeners(key);
        }
        this.removeAllListeners("removeListener");
        this._events = /* @__PURE__ */ Object.create(null);
        this._eventsCount = 0;
        return this;
      }
      listeners = events[type];
      if (typeof listeners === "function") {
        this.removeListener(type, listeners);
      } else if (listeners !== void 0) {
        for (i = listeners.length - 1; i >= 0; i--) {
          this.removeListener(type, listeners[i]);
        }
      }
      return this;
    };
    function _listeners(target, type, unwrap) {
      var events = target._events;
      if (events === void 0)
        return [];
      var evlistener = events[type];
      if (evlistener === void 0)
        return [];
      if (typeof evlistener === "function")
        return unwrap ? [evlistener.listener || evlistener] : [evlistener];
      return unwrap ? unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
    }
    EventEmitter4.prototype.listeners = function listeners(type) {
      return _listeners(this, type, true);
    };
    EventEmitter4.prototype.rawListeners = function rawListeners(type) {
      return _listeners(this, type, false);
    };
    EventEmitter4.listenerCount = function(emitter, type) {
      if (typeof emitter.listenerCount === "function") {
        return emitter.listenerCount(type);
      } else {
        return listenerCount.call(emitter, type);
      }
    };
    EventEmitter4.prototype.listenerCount = listenerCount;
    function listenerCount(type) {
      var events = this._events;
      if (events !== void 0) {
        var evlistener = events[type];
        if (typeof evlistener === "function") {
          return 1;
        } else if (evlistener !== void 0) {
          return evlistener.length;
        }
      }
      return 0;
    }
    EventEmitter4.prototype.eventNames = function eventNames() {
      return this._eventsCount > 0 ? ReflectOwnKeys(this._events) : [];
    };
    function arrayClone(arr, n) {
      var copy = new Array(n);
      for (var i = 0; i < n; ++i)
        copy[i] = arr[i];
      return copy;
    }
    function spliceOne(list, index) {
      for (; index + 1 < list.length; index++)
        list[index] = list[index + 1];
      list.pop();
    }
    function unwrapListeners(arr) {
      var ret = new Array(arr.length);
      for (var i = 0; i < ret.length; ++i) {
        ret[i] = arr[i].listener || arr[i];
      }
      return ret;
    }
    function once(emitter, name) {
      return new Promise(function(resolve, reject) {
        function errorListener(err) {
          emitter.removeListener(name, resolver);
          reject(err);
        }
        function resolver() {
          if (typeof emitter.removeListener === "function") {
            emitter.removeListener("error", errorListener);
          }
          resolve([].slice.call(arguments));
        }
        ;
        eventTargetAgnosticAddListener(emitter, name, resolver, { once: true });
        if (name !== "error") {
          addErrorHandlerIfEventEmitter(emitter, errorListener, { once: true });
        }
      });
    }
    function addErrorHandlerIfEventEmitter(emitter, handler, flags) {
      if (typeof emitter.on === "function") {
        eventTargetAgnosticAddListener(emitter, "error", handler, flags);
      }
    }
    function eventTargetAgnosticAddListener(emitter, name, listener, flags) {
      if (typeof emitter.on === "function") {
        if (flags.once) {
          emitter.once(name, listener);
        } else {
          emitter.on(name, listener);
        }
      } else if (typeof emitter.addEventListener === "function") {
        emitter.addEventListener(name, function wrapListener(arg) {
          if (flags.once) {
            emitter.removeEventListener(name, wrapListener);
          }
          listener(arg);
        });
      } else {
        throw new TypeError('The "emitter" argument must be of type EventEmitter. Received type ' + typeof emitter);
      }
    }
  }
});

// src/fs.async.worker.ts
init_buffer_shim_bundled();

// src/methods/readFile.ts
init_buffer_shim_bundled();

// src/fs.vfs.ts
init_buffer_shim_bundled();

// src/vfs/index.ts
init_buffer_shim_bundled();

// src/vfs/state.ts
init_buffer_shim_bundled();

// src/app-constants.ts
init_buffer_shim_bundled();
var SAB_SIZES = {
  /** 64MB - FS sync requests (large file operations) */
  FS_SYNC: 64 * 1024 * 1024,
  /** 256KB - FS event notifications */
  FS_EVENTS: 256 * 1024,
  /** 32MB - Exec worker sync communication */
  EXEC_SYNC: 32 * 1024 * 1024,
  /** 128MB - Rolldown bundler communication (vue-tsc + typescript can exceed 22MB) */
  BUNDLER: 128 * 1024 * 1024
};
var CHUNK_SIZES = {
  /** 60MB - Threshold for chunked file reads (SAB is 64MB, leave room for overhead) */
  FILE_THRESHOLD: 60 * 1024 * 1024,
  /** 50MB - Size per chunk when reading large files */
  FILE_CHUNK: 50 * 1024 * 1024,
  /** 1MB - Stream chunk size */
  STREAM: 1024 * 1024
};
var WORKER_POOL = {
  /** Minimum workers to keep warm */
  MIN_WORKERS: 1,
  /** Maximum workers (defaults to CPU count) */
  MAX_WORKERS: typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4,
  /** Queue depth to trigger immediate scale up */
  SCALE_UP_THRESHOLD: 3
};
var VFS = {
  /** Binary file that stores all VFS data */
  FILENAME: ".vfs-future.bin",
  /** Header size in bytes for index */
  INDEX_HEADER_SIZE: 4,
  /** 1MB - Schedule compaction when wasted bytes exceed this */
  COMPACTION_THRESHOLD: 1024 * 1024,
  /** 5MB - Immediate compaction when wasted bytes exceed this */
  COMPACTION_URGENT_THRESHOLD: 5 * 1024 * 1024,
  /** 500ms - Wait after last write before compacting */
  COMPACTION_DEBOUNCE_MS: 500,
  /** 2s - Max wait for idle callback before forcing compaction */
  COMPACTION_IDLE_TIMEOUT_MS: 2e3,
  /** 100ms - Flush interval when in deferred mode */
  DEFERRED_FLUSH_INTERVAL_MS: 100
};
var SAB_OFFSETS = {
  /** Byte offset for status flag */
  STATUS: 0,
  /** Byte offset for data length */
  LENGTH: 4,
  /** Byte offset for request/response type (FS only) */
  TYPE: 8,
  /** Byte offset where data payload starts (FS) */
  DATA_FS: 9,
  /** Byte offset where data payload starts (Exec/Bundler) */
  DATA_SIMPLE: 8,
  /**
   * Byte offset for FS SAB lock (last 4 bytes of SAB).
   * Prevents race conditions when multiple threads (exec worker + primary tab)
   * share the same SAB for sync FS operations.
   * Value: 0 = unlocked, 1 = locked. Uses Atomics.compareExchange for CAS.
   */
  FS_LOCK: SAB_SIZES.FS_SYNC - 4
};

// src/vfs/state.ts
var VFS_FILENAME = VFS.FILENAME;
var INDEX_HEADER_SIZE = VFS.INDEX_HEADER_SIZE;
var COMPACTION_THRESHOLD = VFS.COMPACTION_THRESHOLD;
var COMPACTION_URGENT_THRESHOLD = VFS.COMPACTION_URGENT_THRESHOLD;
var COMPACTION_DEBOUNCE_MS = VFS.COMPACTION_DEBOUNCE_MS;
var COMPACTION_IDLE_TIMEOUT_MS = VFS.COMPACTION_IDLE_TIMEOUT_MS;
var vfsSyncHandle = null;
var sharedArrayBuffer = null;
var wastedBytes = 0;
var fireAndForgetDepth = 0;
var isFireAndForgetMode = () => fireAndForgetDepth > 0;
var DEFERRED_FLUSH_INTERVAL_MS = VFS.DEFERRED_FLUSH_INTERVAL_MS;
var compactionScheduled = false;
var compactionDebounceTimer = null;
var compactionIdleCallback = null;
var compactionMetrics = {
  totalCompactions: 0,
  scheduledCompactions: 0,
  urgentCompactions: 0,
  totalBytesReclaimed: 0,
  lastCompactionTime: 0,
  lastCompactionDuration: 0
};
var setSharedArrayBuffer = (sab) => {
  sharedArrayBuffer = sab;
};
var resetWastedBytes = () => {
  wastedBytes = 0;
};
var getWastedBytes = () => wastedBytes;
var setCompactionScheduled = (scheduled) => {
  compactionScheduled = scheduled;
};
var clearCompactionTimers = () => {
  if (compactionDebounceTimer) {
    clearTimeout(compactionDebounceTimer);
    compactionDebounceTimer = null;
  }
  if (compactionIdleCallback !== null && typeof cancelIdleCallback !== "undefined") {
    cancelIdleCallback(compactionIdleCallback);
    compactionIdleCallback = null;
  }
};
var vfsIndex = /* @__PURE__ */ new Map();
var vfsDirIndex = /* @__PURE__ */ new Set();
var vfsSymlinkIndex = /* @__PURE__ */ new Map();
var vfsMetadataIndex = /* @__PURE__ */ new Map();
var watchListeners = /* @__PURE__ */ new Map();
var defaultFileMetadata = () => ({
  mode: 420,
  uid: 0,
  gid: 0,
  mtime: Date.now(),
  atime: Date.now()
});

// src/vfs/events.ts
init_buffer_shim_bundled();

// src/vfs/path.ts
init_buffer_shim_bundled();
var normalizePath = (path) => {
  return path.replace(/^\/+|\/+$/g, "");
};
var isRootPath = (path) => {
  const normalized = normalizePath(path);
  return normalized === "" || path === "." || path === "/";
};

// src/vfs/event-sab.ts
init_buffer_shim_bundled();

// src/vfs/event-constants.ts
init_buffer_shim_bundled();
var METRICS_OFFSET = 0;
var METRIC_QUEUED_TOTAL = 0;
var METRIC_QUEUED_CREATE = 1;
var METRIC_QUEUED_UPDATE = 2;
var METRIC_QUEUED_DELETE = 3;
var METRIC_INTERNAL_TOTAL = 4;
var METRIC_INTERNAL_CREATE = 5;
var METRIC_INTERNAL_UPDATE = 6;
var METRIC_INTERNAL_DELETE = 7;
var METRIC_QUEUE_PATH_COUNT = 12;
var METRIC_PENDING_CREATE = 13;
var METRIC_PENDING_UPDATE = 14;
var METRIC_PENDING_DELETE = 15;
var PATH_DATA_LENGTH = 18;
var RESET_GRACE_COUNTER = 19;
var METRIC_COUNT = 20;
var PATH_DATA_OFFSET = METRIC_COUNT * 4;
var PATH_DATA_MAX_BYTES = 8192;

// src/vfs/event-sab.ts
var getMetrics = () => {
  if (!sharedArrayBuffer) return null;
  return new Uint32Array(sharedArrayBuffer, METRICS_OFFSET, METRIC_COUNT);
};
var syncPathsToSAB = (pathQueue2) => {
  if (!sharedArrayBuffer) return;
  const metrics = getMetrics();
  if (metrics) {
    let pendingCreates = 0, pendingUpdates = 0, pendingDeletes = 0;
    for (const entry of pathQueue2.values()) {
      pendingCreates += entry.creates;
      pendingUpdates += entry.updates;
      pendingDeletes += entry.deletes;
    }
    Atomics.store(metrics, METRIC_QUEUE_PATH_COUNT, pathQueue2.size);
    Atomics.store(metrics, METRIC_PENDING_CREATE, pendingCreates);
    Atomics.store(metrics, METRIC_PENDING_UPDATE, pendingUpdates);
    Atomics.store(metrics, METRIC_PENDING_DELETE, pendingDeletes);
  }
  if (pathQueue2.size === 0) return;
  const paths = [];
  let estimatedSize = 2;
  for (const [path, entry] of pathQueue2.entries()) {
    const item = `${path} (c=${entry.creates} u=${entry.updates} d=${entry.deletes})`;
    const itemSize = item.length + 4;
    if (estimatedSize + itemSize > PATH_DATA_MAX_BYTES - 50) {
      const remaining = pathQueue2.size - paths.length;
      paths.push(`... and ${remaining} more paths`);
      break;
    }
    paths.push(item);
    estimatedSize += itemSize;
  }
  const json = JSON.stringify(paths);
  const bytes = new TextEncoder().encode(json);
  const sabBytes = new Uint8Array(sharedArrayBuffer, PATH_DATA_OFFSET, PATH_DATA_MAX_BYTES);
  sabBytes.set(bytes);
  if (metrics) {
    Atomics.store(metrics, PATH_DATA_LENGTH, bytes.length);
  }
};

// src/vfs/event-metrics.ts
init_buffer_shim_bundled();

// src/vfs/events.ts
var pathQueue = /* @__PURE__ */ new Map();
var queueEvent = (type, path) => {
  if (isFireAndForgetMode()) return;
  const metrics = getMetrics();
  if (metrics) {
    const graceCounter = Atomics.load(metrics, RESET_GRACE_COUNTER);
    if (graceCounter > 0) {
      pathQueue.clear();
      Atomics.store(metrics, RESET_GRACE_COUNTER, 0);
      Atomics.store(metrics, PATH_DATA_LENGTH, 0);
    }
  }
  const normalized = normalizePath(path);
  let entry = pathQueue.get(normalized);
  if (type === "delete" && entry && (entry.creates > 0 || entry.updates > 0)) {
    if (metrics) {
      Atomics.add(metrics, METRIC_QUEUED_TOTAL, 1);
      Atomics.add(metrics, METRIC_QUEUED_DELETE, 1);
    }
    const totalCreates = entry.creates;
    const totalUpdates = entry.updates;
    const totalDeletes = entry.deletes + 1;
    pathQueue.delete(normalized);
    if (metrics) {
      Atomics.add(metrics, METRIC_INTERNAL_TOTAL, totalCreates + totalUpdates + totalDeletes);
      Atomics.add(metrics, METRIC_INTERNAL_CREATE, totalCreates);
      Atomics.add(metrics, METRIC_INTERNAL_UPDATE, totalUpdates);
      Atomics.add(metrics, METRIC_INTERNAL_DELETE, totalDeletes);
    }
    syncPathsToSAB(pathQueue);
    return;
  }
  if (!entry) {
    entry = { creates: 0, updates: 0, deletes: 0, lastMtime: 0 };
    pathQueue.set(normalized, entry);
  }
  if (type === "create") entry.creates++;
  else if (type === "update") entry.updates++;
  else entry.deletes++;
  entry.lastMtime = Date.now();
  if (metrics) {
    Atomics.add(metrics, METRIC_QUEUED_TOTAL, 1);
    if (type === "create") Atomics.add(metrics, METRIC_QUEUED_CREATE, 1);
    else if (type === "update") Atomics.add(metrics, METRIC_QUEUED_UPDATE, 1);
    else Atomics.add(metrics, METRIC_QUEUED_DELETE, 1);
  }
  syncPathsToSAB(pathQueue);
};

// src/vfs/index-ops.ts
init_buffer_shim_bundled();

// src/vfs/compact.ts
init_buffer_shim_bundled();
function performCompaction() {
  if (!vfsSyncHandle) return 0;
  const startTime = performance.now();
  const wastedBefore = getWastedBytes();
  const files = [];
  for (const [path, { offset, size }] of vfsIndex) {
    if (typeof size !== "number" || size < 0 || !Number.isFinite(size) || !Number.isInteger(size)) {
      throw new Error(`Invalid file size in vfsIndex: ${size} for path: ${path}`);
    }
    const buffer = new Uint8Array(size);
    vfsSyncHandle.read(buffer, { at: offset });
    files.push({ path, data: buffer });
  }
  const dirs = Array.from(vfsDirIndex);
  const symlinks = Array.from(vfsSymlinkIndex.entries());
  const metadata = Array.from(vfsMetadataIndex.entries());
  let indexSize = 0;
  let iterations = 0;
  const maxIterations = 10;
  while (iterations < maxIterations) {
    iterations++;
    const headerSize = INDEX_HEADER_SIZE + indexSize;
    vfsIndex.clear();
    let offset = headerSize;
    for (const { path, data } of files) {
      vfsIndex.set(path, { offset, size: data.length });
      offset += data.length;
    }
    const indexData = {
      files: Array.from(vfsIndex.entries()),
      dirs,
      symlinks,
      metadata
    };
    const indexJson = JSON.stringify(indexData);
    const indexBytes = new TextEncoder().encode(indexJson);
    const newIndexSize = indexBytes.length;
    if (newIndexSize === indexSize) {
      const headerBuffer = new ArrayBuffer(INDEX_HEADER_SIZE);
      new DataView(headerBuffer).setUint32(0, indexBytes.length);
      vfsSyncHandle.write(new Uint8Array(headerBuffer), { at: 0 });
      vfsSyncHandle.write(indexBytes, { at: INDEX_HEADER_SIZE });
      break;
    }
    indexSize = newIndexSize;
  }
  if (iterations >= maxIterations) {
    throw new Error("Failed to converge index size calculation during compaction");
  }
  let writeOffset = INDEX_HEADER_SIZE + indexSize;
  for (const { data } of files) {
    vfsSyncHandle.write(data, { at: writeOffset });
    writeOffset += data.length;
  }
  vfsSyncHandle.truncate(writeOffset);
  vfsSyncHandle.flush();
  resetWastedBytes();
  const duration = performance.now() - startTime;
  compactionMetrics.totalCompactions++;
  compactionMetrics.totalBytesReclaimed += wastedBefore;
  compactionMetrics.lastCompactionTime = Date.now();
  compactionMetrics.lastCompactionDuration = duration;
  console.log(`[VFS] Compacted to ${writeOffset} bytes (reclaimed ${wastedBefore} bytes in ${duration.toFixed(1)}ms)`);
  return wastedBefore;
}
var compactSync = () => {
  clearCompactionTimers();
  setCompactionScheduled(false);
  performCompaction();
};

// src/vfs/index-ops.ts
var INDEX_SAVE_DEBOUNCE_MS = 50;
var indexDirty = false;
var indexSaveTimer = null;
var indexFirstDirtyTime = null;
var indexSaveMetrics = {
  totalSaves: 0,
  batchedSaves: 0,
  // Saves that were batched (not immediate)
  lastSaveTime: 0
};
var performIndexSave = () => {
  if (!vfsSyncHandle) return;
  const indexData = {
    files: Array.from(vfsIndex.entries()),
    dirs: Array.from(vfsDirIndex),
    symlinks: Array.from(vfsSymlinkIndex.entries()),
    metadata: Array.from(vfsMetadataIndex.entries())
  };
  const indexJson = JSON.stringify(indexData);
  const indexBytes = new TextEncoder().encode(indexJson);
  const newIndexEnd = INDEX_HEADER_SIZE + indexBytes.length;
  let minFileOffset = Infinity;
  for (const { offset } of vfsIndex.values()) {
    if (offset < minFileOffset) {
      minFileOffset = offset;
    }
  }
  if (minFileOffset !== Infinity && newIndexEnd > minFileOffset) {
    compactSync();
    return;
  }
  const headerBuffer = new ArrayBuffer(INDEX_HEADER_SIZE);
  new DataView(headerBuffer).setUint32(0, indexBytes.length);
  vfsSyncHandle.write(new Uint8Array(headerBuffer), { at: 0 });
  vfsSyncHandle.write(indexBytes, { at: INDEX_HEADER_SIZE });
  vfsSyncHandle.flush();
  indexSaveMetrics.totalSaves++;
  indexSaveMetrics.lastSaveTime = Date.now();
  indexDirty = false;
  indexFirstDirtyTime = null;
};
var scheduleIndexSave = () => {
  if (indexSaveTimer) {
    return;
  }
  indexFirstDirtyTime = Date.now();
  indexSaveTimer = setTimeout(() => {
    indexSaveTimer = null;
    indexSaveMetrics.batchedSaves++;
    performIndexSave();
  }, INDEX_SAVE_DEBOUNCE_MS);
};
var saveIndex = () => {
  if (!vfsSyncHandle) return;
  indexDirty = true;
  scheduleIndexSave();
};

// src/vfs/files.ts
init_buffer_shim_bundled();

// src/vfs/opfs-sync-queue.ts
init_buffer_shim_bundled();

// src/config.ts
init_buffer_shim_bundled();
var defaultConfig = {
  storageMode: "hybrid",
  logging: {
    enabled: false,
    level: "info",
    console: true,
    buffer: false,
    bufferSize: 1e3
  }
};
var config = { ...defaultConfig, logging: { ...defaultConfig.logging } };

// src/vfs/symlinks.ts
init_buffer_shim_bundled();
var createSymlinkInVfs = (linkPath, targetPath) => {
  const normalizedLink = normalizePath(linkPath);
  vfsSymlinkIndex.set(normalizedLink, targetPath);
  vfsMetadataIndex.set(normalizedLink, {
    mode: 41471,
    uid: 0,
    gid: 0,
    mtime: Date.now(),
    atime: Date.now()
  });
  saveIndex();
};
var readSymlinkFromVfs = (linkPath) => {
  const normalizedLink = normalizePath(linkPath);
  return vfsSymlinkIndex.get(normalizedLink) || null;
};
var isSymlinkInVfs = (path) => {
  const normalizedPath = normalizePath(path);
  return vfsSymlinkIndex.has(normalizedPath);
};

// src/vfs/files.ts
var existsInVfs = (path) => {
  if (isRootPath(path)) return true;
  const normalizedPath = normalizePath(path);
  if (normalizedPath === "") return true;
  if (isSymlinkInVfs(normalizedPath)) return true;
  if (vfsIndex.has(normalizedPath)) return true;
  if (vfsDirIndex.has(normalizedPath)) return true;
  const prefix = `${normalizedPath}/`;
  for (const filePath of vfsIndex.keys()) {
    if (filePath.startsWith(prefix)) {
      return true;
    }
  }
  for (const dirPath of vfsDirIndex) {
    if (dirPath.startsWith(prefix)) {
      return true;
    }
  }
  return false;
};

// src/vfs/dirs.ts
init_buffer_shim_bundled();
var FILE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|vue|svelte|json|css|scss|sass|less|html|htm|md|txt|xml|yaml|yml|toml|wasm|map|d\.ts)$/i;
var isDirectoryInVfs = (path) => {
  if (isRootPath(path)) return true;
  const normalizedPath = normalizePath(path);
  if (!normalizedPath) return true;
  if (vfsDirIndex.has(normalizedPath)) return true;
  if (vfsIndex.has(normalizedPath)) return false;
  if (FILE_EXTENSIONS.test(normalizedPath)) return false;
  const prefix = `${normalizedPath}/`;
  for (const filePath of vfsIndex.keys()) {
    if (filePath.startsWith(prefix)) return true;
  }
  for (const dirPath of vfsDirIndex) {
    if (dirPath.startsWith(prefix)) return true;
  }
  return false;
};

// src/vfs/metadata.ts
init_buffer_shim_bundled();
var chmodInVfs = (path, mode) => {
  const normalizedPath = normalizePath(path);
  const existing = vfsMetadataIndex.get(normalizedPath) || defaultFileMetadata();
  vfsMetadataIndex.set(normalizedPath, { ...existing, mode });
  saveIndex();
};
var chownInVfs = (path, uid, gid) => {
  const normalizedPath = normalizePath(path);
  const existing = vfsMetadataIndex.get(normalizedPath) || defaultFileMetadata();
  vfsMetadataIndex.set(normalizedPath, { ...existing, uid, gid });
  saveIndex();
};
var utimesInVfs = (path, atime, mtime) => {
  const normalizedPath = normalizePath(path);
  const existing = vfsMetadataIndex.get(normalizedPath) || defaultFileMetadata();
  vfsMetadataIndex.set(normalizedPath, { ...existing, atime, mtime });
  saveIndex();
};

// src/vfs/watch.ts
init_buffer_shim_bundled();
var addWatchListener = (path, listener) => {
  const normalizedPath = normalizePath(path);
  if (!watchListeners.has(normalizedPath)) {
    watchListeners.set(normalizedPath, /* @__PURE__ */ new Set());
  }
  watchListeners.get(normalizedPath).add(listener);
};
var removeWatchListener = (path, listener) => {
  const normalizedPath = normalizePath(path);
  const listeners = watchListeners.get(normalizedPath);
  if (listeners) {
    listeners.delete(listener);
    if (listeners.size === 0) {
      watchListeners.delete(normalizedPath);
    }
  }
};

// src/vfs/sync.ts
init_buffer_shim_bundled();

// src/vfs/traverse.ts
init_buffer_shim_bundled();

// src/vfs/import.ts
init_buffer_shim_bundled();

// src/vfs/init.ts
init_buffer_shim_bundled();

// src/classes/index.ts
init_buffer_shim_bundled();

// src/classes/Stats.ts
init_buffer_shim_bundled();

// src/constants.ts
init_buffer_shim_bundled();
var S_IFMT = 61440;
var S_IFREG = 32768;
var S_IFDIR = 16384;
var S_IFCHR = 8192;
var S_IFBLK = 24576;
var S_IFIFO = 4096;
var S_IFLNK = 40960;
var S_IFSOCK = 49152;

// src/classes/Stats.ts
var Stats = class _Stats {
  dev;
  ino;
  mode;
  nlink;
  uid;
  gid;
  rdev;
  size;
  blksize;
  blocks;
  atimeMs;
  mtimeMs;
  ctimeMs;
  birthtimeMs;
  atime;
  mtime;
  ctime;
  birthtime;
  constructor(init2) {
    this.dev = init2.dev ?? 0;
    this.ino = init2.ino ?? 0;
    this.mode = init2.mode;
    this.nlink = init2.nlink ?? 1;
    this.uid = init2.uid;
    this.gid = init2.gid;
    this.rdev = init2.rdev ?? 0;
    this.size = init2.size;
    this.blksize = init2.blksize ?? 4096;
    this.blocks = init2.blocks ?? Math.ceil(init2.size / 512);
    this.atimeMs = init2.atimeMs;
    this.mtimeMs = init2.mtimeMs;
    this.ctimeMs = init2.ctimeMs;
    this.birthtimeMs = init2.birthtimeMs ?? init2.ctimeMs;
    this.atime = new Date(this.atimeMs);
    this.mtime = new Date(this.mtimeMs);
    this.ctime = new Date(this.ctimeMs);
    this.birthtime = new Date(this.birthtimeMs);
  }
  isFile() {
    return (this.mode & S_IFMT) === S_IFREG;
  }
  isDirectory() {
    return (this.mode & S_IFMT) === S_IFDIR;
  }
  isBlockDevice() {
    return (this.mode & S_IFMT) === S_IFBLK;
  }
  isCharacterDevice() {
    return (this.mode & S_IFMT) === S_IFCHR;
  }
  isSymbolicLink() {
    return (this.mode & S_IFMT) === S_IFLNK;
  }
  isFIFO() {
    return (this.mode & S_IFMT) === S_IFIFO;
  }
  isSocket() {
    return (this.mode & S_IFMT) === S_IFSOCK;
  }
  // For JSON serialization
  toJSON() {
    return {
      __type: "Stats",
      dev: this.dev,
      ino: this.ino,
      mode: this.mode,
      nlink: this.nlink,
      uid: this.uid,
      gid: this.gid,
      rdev: this.rdev,
      size: this.size,
      blksize: this.blksize,
      blocks: this.blocks,
      atimeMs: this.atimeMs,
      mtimeMs: this.mtimeMs,
      ctimeMs: this.ctimeMs,
      birthtimeMs: this.birthtimeMs
    };
  }
  // Reconstruct from JSON
  static fromJSON(obj) {
    return new _Stats(obj);
  }
};
var BigIntStats = class {
  dev;
  ino;
  mode;
  nlink;
  uid;
  gid;
  rdev;
  size;
  blksize;
  blocks;
  atimeMs;
  mtimeMs;
  ctimeMs;
  birthtimeMs;
  atimeNs;
  mtimeNs;
  ctimeNs;
  birthtimeNs;
  atime;
  mtime;
  ctime;
  birthtime;
  constructor(init2) {
    this.dev = BigInt(init2.dev ?? 0);
    this.ino = BigInt(init2.ino ?? 0);
    this.mode = BigInt(init2.mode);
    this.nlink = BigInt(init2.nlink ?? 1);
    this.uid = BigInt(init2.uid);
    this.gid = BigInt(init2.gid);
    this.rdev = BigInt(init2.rdev ?? 0);
    this.size = BigInt(init2.size);
    this.blksize = BigInt(init2.blksize ?? 4096);
    this.blocks = BigInt(init2.blocks ?? Math.ceil(init2.size / 512));
    this.atimeMs = BigInt(Math.floor(init2.atimeMs));
    this.mtimeMs = BigInt(Math.floor(init2.mtimeMs));
    this.ctimeMs = BigInt(Math.floor(init2.ctimeMs));
    this.birthtimeMs = BigInt(Math.floor(init2.birthtimeMs ?? init2.ctimeMs));
    this.atimeNs = this.atimeMs * 1000000n;
    this.mtimeNs = this.mtimeMs * 1000000n;
    this.ctimeNs = this.ctimeMs * 1000000n;
    this.birthtimeNs = this.birthtimeMs * 1000000n;
    this.atime = new Date(Number(this.atimeMs));
    this.mtime = new Date(Number(this.mtimeMs));
    this.ctime = new Date(Number(this.ctimeMs));
    this.birthtime = new Date(Number(this.birthtimeMs));
  }
  isFile() {
    return (Number(this.mode) & S_IFMT) === S_IFREG;
  }
  isDirectory() {
    return (Number(this.mode) & S_IFMT) === S_IFDIR;
  }
  isBlockDevice() {
    return (Number(this.mode) & S_IFMT) === S_IFBLK;
  }
  isCharacterDevice() {
    return (Number(this.mode) & S_IFMT) === S_IFCHR;
  }
  isSymbolicLink() {
    return (Number(this.mode) & S_IFMT) === S_IFLNK;
  }
  isFIFO() {
    return (Number(this.mode) & S_IFMT) === S_IFIFO;
  }
  isSocket() {
    return (Number(this.mode) & S_IFMT) === S_IFSOCK;
  }
};
var createStats = (size, mode, uid, gid, atimeMs, mtimeMs, ctimeMs, bigint) => {
  const init2 = {
    mode,
    uid,
    gid,
    size,
    atimeMs,
    mtimeMs,
    ctimeMs: ctimeMs ?? mtimeMs
  };
  return bigint ? new BigIntStats(init2) : new Stats(init2);
};

// src/classes/Dirent.ts
init_buffer_shim_bundled();
var Dirent = class _Dirent {
  name;
  path;
  // Use public _mode for JSON serialization (private # fields don't serialize)
  _mode;
  constructor(init2) {
    this.name = init2.name;
    this.path = init2.path ?? "";
    this._mode = init2.mode;
  }
  isFile() {
    return (this._mode & S_IFMT) === S_IFREG;
  }
  isDirectory() {
    return (this._mode & S_IFMT) === S_IFDIR;
  }
  isBlockDevice() {
    return (this._mode & S_IFMT) === S_IFBLK;
  }
  isCharacterDevice() {
    return (this._mode & S_IFMT) === S_IFCHR;
  }
  isSymbolicLink() {
    return (this._mode & S_IFMT) === S_IFLNK;
  }
  isFIFO() {
    return (this._mode & S_IFMT) === S_IFIFO;
  }
  isSocket() {
    return (this._mode & S_IFMT) === S_IFSOCK;
  }
  // For JSON serialization
  toJSON() {
    return {
      __type: "Dirent",
      name: this.name,
      path: this.path,
      _mode: this._mode
    };
  }
  // Reconstruct from JSON
  static fromJSON(obj) {
    return new _Dirent({ name: obj.name, path: obj.path, mode: obj._mode });
  }
};
var createDirent = (name, isDir, isSymlink, parentPath) => {
  let mode;
  if (isSymlink) {
    mode = S_IFLNK | 511;
  } else if (isDir) {
    mode = S_IFDIR | 493;
  } else {
    mode = S_IFREG | 420;
  }
  return new Dirent({
    name,
    path: parentPath,
    mode
  });
};

// src/classes/Dir.ts
init_buffer_shim_bundled();

// src/classes/FileHandle.ts
init_buffer_shim_bundled();

// src/classes/ReadStream.ts
init_buffer_shim_bundled();
var import_events3 = __toESM(require_events(), 1);
var CHUNKED_READ_THRESHOLD = 1024 * 1024;

// src/classes/WriteStream.ts
init_buffer_shim_bundled();
var import_events4 = __toESM(require_events(), 1);

// src/classes/FSError.ts
init_buffer_shim_bundled();
var ERROR_CODES = {
  ENOENT: { code: "ENOENT", errno: -2, message: "no such file or directory" },
  EEXIST: { code: "EEXIST", errno: -17, message: "file already exists" },
  ENOTDIR: { code: "ENOTDIR", errno: -20, message: "not a directory" },
  EISDIR: { code: "EISDIR", errno: -21, message: "illegal operation on a directory" },
  ENOTEMPTY: { code: "ENOTEMPTY", errno: -39, message: "directory not empty" },
  EACCES: { code: "EACCES", errno: -13, message: "permission denied" },
  EPERM: { code: "EPERM", errno: -1, message: "operation not permitted" },
  EBADF: { code: "EBADF", errno: -9, message: "bad file descriptor" },
  EINVAL: { code: "EINVAL", errno: -22, message: "invalid argument" },
  EMFILE: { code: "EMFILE", errno: -24, message: "too many open files" },
  ENFILE: { code: "ENFILE", errno: -23, message: "file table overflow" },
  ELOOP: { code: "ELOOP", errno: -40, message: "too many symbolic links encountered" },
  ENAMETOOLONG: { code: "ENAMETOOLONG", errno: -36, message: "file name too long" },
  ENOSPC: { code: "ENOSPC", errno: -28, message: "no space left on device" },
  EROFS: { code: "EROFS", errno: -30, message: "read-only file system" },
  EXDEV: { code: "EXDEV", errno: -18, message: "cross-device link not permitted" },
  EAGAIN: { code: "EAGAIN", errno: -11, message: "resource temporarily unavailable" },
  EBUSY: { code: "EBUSY", errno: -16, message: "resource busy or locked" },
  ENOTCONN: { code: "ENOTCONN", errno: -107, message: "socket is not connected" },
  ETIMEDOUT: { code: "ETIMEDOUT", errno: -110, message: "connection timed out" },
  ECONNREFUSED: { code: "ECONNREFUSED", errno: -111, message: "connection refused" },
  ECONNRESET: { code: "ECONNRESET", errno: -104, message: "connection reset by peer" }
};
var FSError = class _FSError extends Error {
  code;
  errno;
  syscall;
  path;
  dest;
  constructor(code, syscall, path, dest) {
    const errorInfo = ERROR_CODES[code] ?? { code, errno: -1, message: code.toLowerCase() };
    let message = `${errorInfo.code}: ${errorInfo.message}, ${syscall}`;
    if (path) {
      message += ` '${path}'`;
    }
    if (dest) {
      message += ` -> '${dest}'`;
    }
    super(message);
    this.name = "Error";
    this.code = errorInfo.code;
    this.errno = errorInfo.errno;
    this.syscall = syscall;
    this.path = path;
    this.dest = dest;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, _FSError);
    }
  }
  // Convert to JSON-serializable object
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      errno: this.errno,
      syscall: this.syscall,
      path: this.path,
      dest: this.dest
    };
  }
};
var createENOENT = (syscall, path) => new FSError("ENOENT", syscall, path);
var createEBADF = (syscall) => new FSError("EBADF", syscall);

// src/methods/readFile.ts
var navigateToFile = async (root3, path, options) => {
  const parts = path.split("/").filter((p) => p.length > 0);
  let currentDir = root3;
  for (let i = 0; i < parts.length - 1; i++) {
    currentDir = await currentDir.getDirectoryHandle(parts[i]);
  }
  return currentDir.getFileHandle(parts[parts.length - 1], options);
};
var readFile = async (root3, path, options) => {
  const encoding = typeof options === "string" ? options : options?.encoding;
  const fileHandle = await navigateToFile(root3, path);
  const file = await fileHandle.getFile();
  const buffer = await file.arrayBuffer();
  if (encoding) {
    return new TextDecoder(encoding).decode(buffer);
  }
  return Buffer.from(buffer);
};
var readFileChunk = async (root3, path, start, end) => {
  const fileHandle = await navigateToFile(root3, path);
  const file = await fileHandle.getFile();
  const slice = file.slice(start, end);
  const buffer = await slice.arrayBuffer();
  return Buffer.from(buffer);
};
var getFileSize = async (root3, path) => {
  const fileHandle = await navigateToFile(root3, path);
  const file = await fileHandle.getFile();
  return file.size;
};

// src/methods/writeFile.ts
init_buffer_shim_bundled();
var writeFile = async (root3, path, data, _options) => {
  if (path.includes("/dist/") || path.includes("/dist")) {
    console.log(`[writeFile ASYNC] Writing dist file: ${path} (${typeof data === "string" ? data.length + " chars" : data.length + " bytes"})`);
  }
  queueEvent("update", path);
  const parts = path.split("/").filter((p) => p.length > 0);
  let currentDir = root3;
  for (let i = 0; i < parts.length - 1; i++) {
    currentDir = await currentDir.getDirectoryHandle(parts[i], { create: true });
  }
  const fileHandle = await currentDir.getFileHandle(parts[parts.length - 1], { create: true });
  const writable = await fileHandle.createWritable();
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  await writable.write(bytes);
  await writable.close();
};

// src/methods/exists.ts
init_buffer_shim_bundled();
var exists = async (root3, path) => {
  const parts = path.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return true;
  try {
    let currentDir = root3;
    for (let i = 0; i < parts.length - 1; i++) {
      currentDir = await currentDir.getDirectoryHandle(parts[i]);
    }
    const lastName = parts[parts.length - 1];
    try {
      await currentDir.getFileHandle(lastName);
      return true;
    } catch {
      await currentDir.getDirectoryHandle(lastName);
      return true;
    }
  } catch {
    return false;
  }
};

// src/methods/unlink.ts
init_buffer_shim_bundled();
var unlink = async (root3, path) => {
  queueEvent("delete", path);
  const parts = path.split("/");
  let currentDir = root3;
  for (let i = 0; i < parts.length - 1; i++) {
    currentDir = await currentDir.getDirectoryHandle(parts[i]);
  }
  const fileName = parts[parts.length - 1];
  await currentDir.removeEntry(fileName);
};

// src/methods/mkdir.ts
init_buffer_shim_bundled();
var mkdir = async (root3, path, options) => {
  const normalizedPath = normalizePath(path);
  const parts = normalizedPath.split("/").filter((p) => p.length > 0);
  let currentDir = root3;
  if (options?.recursive) {
    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (!isDirectoryInVfs(currentPath)) {
        queueEvent("create", currentPath);
      }
      currentDir = await currentDir.getDirectoryHandle(part, { create: true });
    }
  } else {
    if (!isDirectoryInVfs(normalizedPath)) {
      queueEvent("create", normalizedPath);
    }
    for (let i = 0; i < parts.length - 1; i++) {
      currentDir = await currentDir.getDirectoryHandle(parts[i]);
    }
    await currentDir.getDirectoryHandle(parts[parts.length - 1], { create: true });
  }
};

// src/methods/rmdir.ts
init_buffer_shim_bundled();
var rmdir = async (root3, path, options) => {
  queueEvent("delete", path);
  const parts = path.split("/").filter((p) => p.length > 0);
  let currentDir = root3;
  for (let i = 0; i < parts.length - 1; i++) {
    currentDir = await currentDir.getDirectoryHandle(parts[i]);
  }
  const dirName = parts[parts.length - 1];
  await currentDir.removeEntry(dirName, { recursive: options?.recursive });
};

// src/methods/readdir.ts
init_buffer_shim_bundled();
var readdir = async (root3, path, options) => {
  const parts = path.split("/").filter((p) => p.length > 0);
  let currentDir = root3;
  for (const part of parts) {
    currentDir = await currentDir.getDirectoryHandle(part);
  }
  const entries = [];
  for await (const [name, handle] of currentDir.entries()) {
    entries.push({ name, kind: handle.kind });
  }
  if (options?.recursive) {
    const allEntries = [...entries];
    for (const entry of entries) {
      if (entry.kind === "directory") {
        const subPath = path ? `${path}/${entry.name}` : entry.name;
        const subEntries = await readdir(root3, subPath, { ...options, withFileTypes: false });
        for (const subEntry of subEntries) {
          allEntries.push({
            name: `${entry.name}/${subEntry}`,
            kind: "file"
            // Will be determined properly if withFileTypes
          });
        }
      }
    }
    if (options?.withFileTypes) {
      return allEntries.map(
        ({ name, kind }) => createDirent(name, kind === "directory", false, path)
      );
    }
    return allEntries.map((e) => e.name);
  }
  if (options?.withFileTypes) {
    return entries.map(
      ({ name, kind }) => createDirent(name, kind === "directory", false, path)
    );
  }
  return entries.map((e) => e.name);
};

// src/methods/stat.ts
init_buffer_shim_bundled();
var createStats2 = (size, isDir, isSymlink = false, metadata, bigint = false) => {
  const now = Date.now();
  let typeBits;
  if (isSymlink) {
    typeBits = S_IFLNK;
  } else if (isDir) {
    typeBits = S_IFDIR;
  } else {
    typeBits = S_IFREG;
  }
  const permBits = metadata?.mode !== void 0 ? metadata.mode & 4095 : isDir ? 493 : 420;
  const mode = typeBits | permBits;
  return createStats(
    size,
    mode,
    metadata?.uid ?? 0,
    metadata?.gid ?? 0,
    metadata?.atimeMs ?? now,
    metadata?.mtimeMs ?? now,
    metadata?.mtimeMs ?? now,
    bigint
  );
};
var stat = async (root3, path, options) => {
  const parts = path.split("/").filter((p) => p.length > 0);
  const bigint = options?.bigint ?? false;
  if (parts.length === 0) {
    return createStats2(0, true, false, void 0, bigint);
  }
  let currentDir = root3;
  for (let i = 0; i < parts.length - 1; i++) {
    currentDir = await currentDir.getDirectoryHandle(parts[i]);
  }
  const lastName = parts[parts.length - 1];
  try {
    const fileHandle = await currentDir.getFileHandle(lastName);
    const file = await fileHandle.getFile();
    return createStats2(file.size, false, false, {
      mtimeMs: file.lastModified,
      atimeMs: file.lastModified
    }, bigint);
  } catch {
    try {
      await currentDir.getDirectoryHandle(lastName);
      return createStats2(0, true, false, void 0, bigint);
    } catch {
      throw createENOENT("stat", path);
    }
  }
};
var lstat = async (root3, path, options) => {
  return stat(root3, path, options);
};

// src/methods/rename.ts
init_buffer_shim_bundled();
var rename = async (root3, oldPath, newPath) => {
  queueEvent("delete", oldPath);
  queueEvent("create", newPath);
  const oldParts = oldPath.split("/").filter((p) => p.length > 0);
  let oldDir = root3;
  for (let i = 0; i < oldParts.length - 1; i++) {
    oldDir = await oldDir.getDirectoryHandle(oldParts[i]);
  }
  const oldFileHandle = await oldDir.getFileHandle(oldParts[oldParts.length - 1]);
  const file = await oldFileHandle.getFile();
  const data = await file.arrayBuffer();
  const newParts = newPath.split("/").filter((p) => p.length > 0);
  let newDir = root3;
  for (let i = 0; i < newParts.length - 1; i++) {
    newDir = await newDir.getDirectoryHandle(newParts[i], { create: true });
  }
  const newFileHandle = await newDir.getFileHandle(newParts[newParts.length - 1], { create: true });
  const writable = await newFileHandle.createWritable();
  await writable.write(data);
  await writable.close();
  await oldDir.removeEntry(oldParts[oldParts.length - 1]);
};

// src/methods/copyFile.ts
init_buffer_shim_bundled();
var STREAM_CHUNK_SIZE = 1024 * 1024;
var copyFile = async (root3, src, dest) => {
  queueEvent("create", dest);
  const srcParts = src.split("/").filter((p) => p.length > 0);
  let srcDir = root3;
  for (let i = 0; i < srcParts.length - 1; i++) {
    srcDir = await srcDir.getDirectoryHandle(srcParts[i]);
  }
  const srcFileHandle = await srcDir.getFileHandle(srcParts[srcParts.length - 1]);
  const file = await srcFileHandle.getFile();
  const destParts = dest.split("/").filter((p) => p.length > 0);
  let destDir = root3;
  for (let i = 0; i < destParts.length - 1; i++) {
    destDir = await destDir.getDirectoryHandle(destParts[i], { create: true });
  }
  const destFileHandle = await destDir.getFileHandle(destParts[destParts.length - 1], { create: true });
  if (file.size < STREAM_CHUNK_SIZE) {
    const data = await file.arrayBuffer();
    const writable2 = await destFileHandle.createWritable();
    await writable2.write(data);
    await writable2.close();
    return;
  }
  const readable = file.stream();
  const writable = await destFileHandle.createWritable();
  try {
    await readable.pipeTo(writable);
  } catch (error) {
    await copyFileChunked(file, destFileHandle);
  }
};
async function copyFileChunked(file, destFileHandle) {
  const writable = await destFileHandle.createWritable();
  const size = file.size;
  let offset = 0;
  try {
    while (offset < size) {
      const end = Math.min(offset + STREAM_CHUNK_SIZE, size);
      const chunk = file.slice(offset, end);
      const buffer = await chunk.arrayBuffer();
      await writable.write({ type: "write", position: offset, data: buffer });
      offset = end;
    }
  } finally {
    await writable.close();
  }
}

// src/methods/appendFile.ts
init_buffer_shim_bundled();
var appendFile = async (root3, path, data) => {
  queueEvent("update", path);
  const parts = path.split("/").filter((p) => p.length > 0);
  let currentDir = root3;
  for (let i = 0; i < parts.length - 1; i++) {
    currentDir = await currentDir.getDirectoryHandle(parts[i], { create: true });
  }
  const fileName = parts[parts.length - 1];
  const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
  const file = await fileHandle.getFile();
  const existingData = await file.arrayBuffer();
  const newData = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const combined = new Uint8Array(existingData.byteLength + newData.length);
  combined.set(new Uint8Array(existingData), 0);
  combined.set(newData, existingData.byteLength);
  const writable = await fileHandle.createWritable();
  await writable.write(combined);
  await writable.close();
};

// src/methods/rm.ts
init_buffer_shim_bundled();
var rm = async (root3, path, options) => {
  const parts = path.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) {
    throw new Error("EPERM: operation not permitted, rm");
  }
  let currentDir = root3;
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      currentDir = await currentDir.getDirectoryHandle(parts[i]);
    } catch (err) {
      if (options?.force) return;
      throw err;
    }
  }
  const name = parts[parts.length - 1];
  try {
    queueEvent("delete", path);
    await currentDir.removeEntry(name, { recursive: options?.recursive });
  } catch (err) {
    if (options?.force) return;
    throw err;
  }
};

// src/methods/access.ts
init_buffer_shim_bundled();
var constants = {
  F_OK: 0,
  // File exists
  R_OK: 4,
  // File is readable
  W_OK: 2,
  // File is writable
  X_OK: 1
  // File is executable
};
var access = async (root3, path, mode = constants.F_OK) => {
  const parts = path.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) {
    return;
  }
  let currentDir = root3;
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      currentDir = await currentDir.getDirectoryHandle(parts[i]);
    } catch {
      throw createENOENT("access", path);
    }
  }
  const name = parts[parts.length - 1];
  try {
    await currentDir.getFileHandle(name);
    return;
  } catch {
    try {
      await currentDir.getDirectoryHandle(name);
      return;
    } catch {
      throw createENOENT("access", path);
    }
  }
};

// src/methods/chmod.ts
init_buffer_shim_bundled();
var chmod = async (_root, path, mode) => {
  queueEvent("update", path);
  const normalizedPath = normalizePath(path);
  if (!existsInVfs(normalizedPath) && !isDirectoryInVfs(normalizedPath)) {
    throw createENOENT("chmod", path);
  }
  chmodInVfs(normalizedPath, mode);
};

// src/methods/chown.ts
init_buffer_shim_bundled();
var chown = async (_root, path, uid, gid) => {
  queueEvent("update", path);
  const normalizedPath = normalizePath(path);
  if (!existsInVfs(normalizedPath) && !isDirectoryInVfs(normalizedPath)) {
    throw createENOENT("chown", path);
  }
  chownInVfs(normalizedPath, uid, gid);
};

// src/methods/lchmod.ts
init_buffer_shim_bundled();
var lchmod = async (_root, _path, _mode) => {
};

// src/methods/lchown.ts
init_buffer_shim_bundled();
var lchown = async (_root, _path, _uid, _gid) => {
};

// src/methods/link.ts
init_buffer_shim_bundled();
var link = async (root3, existingPath, newPath) => {
  queueEvent("create", newPath);
  const srcParts = existingPath.split("/").filter((p) => p.length > 0);
  const destParts = newPath.split("/").filter((p) => p.length > 0);
  let srcDir = root3;
  for (let i = 0; i < srcParts.length - 1; i++) {
    srcDir = await srcDir.getDirectoryHandle(srcParts[i]);
  }
  const srcName = srcParts[srcParts.length - 1];
  const srcHandle = await srcDir.getFileHandle(srcName);
  const file = await srcHandle.getFile();
  const content = new Uint8Array(await file.arrayBuffer());
  let destDir = root3;
  for (let i = 0; i < destParts.length - 1; i++) {
    destDir = await destDir.getDirectoryHandle(destParts[i], { create: true });
  }
  const destName = destParts[destParts.length - 1];
  const destHandle = await destDir.getFileHandle(destName, { create: true });
  const writable = await destHandle.createWritable();
  await writable.write(content);
  await writable.close();
};

// src/methods/symlink.ts
init_buffer_shim_bundled();
var symlink = async (_root, target, path, _type) => {
  const normalizedPath = normalizePath(path);
  createSymlinkInVfs(normalizedPath, target);
};

// src/methods/readlink.ts
init_buffer_shim_bundled();
var readlink = async (_root, path) => {
  const normalizedPath = normalizePath(path);
  const target = readSymlinkFromVfs(normalizedPath);
  if (target === null) {
    throw new Error(`EINVAL: invalid argument, readlink '${path}'`);
  }
  return target;
};

// src/methods/truncate.ts
init_buffer_shim_bundled();
var truncate = async (root3, path, len = 0) => {
  queueEvent("update", path);
  const parts = path.split("/").filter((p) => p.length > 0);
  let currentDir = root3;
  for (let i = 0; i < parts.length - 1; i++) {
    currentDir = await currentDir.getDirectoryHandle(parts[i]);
  }
  const fileName = parts[parts.length - 1];
  const fileHandle = await currentDir.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  let newContent;
  if (len === 0) {
    newContent = new Uint8Array(0);
  } else if (len < file.size) {
    const buffer = await file.arrayBuffer();
    newContent = new Uint8Array(buffer.slice(0, len));
  } else {
    const buffer = await file.arrayBuffer();
    newContent = new Uint8Array(len);
    newContent.set(new Uint8Array(buffer));
  }
  const writable = await fileHandle.createWritable();
  await writable.write(new Uint8Array(newContent).buffer);
  await writable.close();
};

// src/methods/mkdtemp.ts
init_buffer_shim_bundled();
var generateRandomString = (length) => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};
var mkdtemp = async (root3, prefix) => {
  const suffix = generateRandomString(6);
  const dirName = prefix + suffix;
  queueEvent("create", "/" + dirName);
  const parts = dirName.split("/").filter((p) => p.length > 0);
  let currentDir = root3;
  for (let i = 0; i < parts.length - 1; i++) {
    currentDir = await currentDir.getDirectoryHandle(parts[i], { create: true });
  }
  await currentDir.getDirectoryHandle(parts[parts.length - 1], { create: true });
  return "/" + dirName;
};

// src/methods/realpath.ts
init_buffer_shim_bundled();
var resolvePath = (path) => {
  const parts = path.split("/").filter((p) => p.length > 0);
  const result = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      result.pop();
    } else {
      result.push(part);
    }
  }
  return "/" + result.join("/");
};
var realpath = async (root3, path) => {
  const resolved = resolvePath(path);
  const parts = resolved.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return "/";
  let currentDir = root3;
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      currentDir = await currentDir.getDirectoryHandle(parts[i]);
    } catch {
      throw createENOENT("realpath", path);
    }
  }
  const name = parts[parts.length - 1];
  try {
    await currentDir.getFileHandle(name);
    return resolved;
  } catch {
    try {
      await currentDir.getDirectoryHandle(name);
      return resolved;
    } catch {
      throw createENOENT("realpath", path);
    }
  }
};

// src/methods/utimes.ts
init_buffer_shim_bundled();
var toTimestamp = (time) => {
  if (typeof time === "number") return time;
  if (typeof time === "string") return new Date(time).getTime();
  return time.getTime();
};
var utimes = async (_root, path, atime, mtime) => {
  queueEvent("update", path);
  const normalizedPath = normalizePath(path);
  if (!existsInVfs(normalizedPath) && !isDirectoryInVfs(normalizedPath)) {
    throw createENOENT("utimes", path);
  }
  utimesInVfs(normalizedPath, toTimestamp(atime), toTimestamp(mtime));
};

// src/methods/lutimes.ts
init_buffer_shim_bundled();
var lutimes = async (_root, _path, _atime, _mtime) => {
};

// src/methods/cp.ts
init_buffer_shim_bundled();
var cp = async (root3, src, dest, options) => {
  queueEvent("create", dest);
  const srcParts = src.split("/").filter((p) => p.length > 0);
  const destParts = dest.split("/").filter((p) => p.length > 0);
  let srcDir = root3;
  for (let i = 0; i < srcParts.length - 1; i++) {
    srcDir = await srcDir.getDirectoryHandle(srcParts[i]);
  }
  const srcName = srcParts[srcParts.length - 1];
  let isDir = false;
  try {
    await srcDir.getDirectoryHandle(srcName);
    isDir = true;
  } catch {
  }
  if (isDir && !options?.recursive) {
    throw new FSError("EISDIR", "cp", src);
  }
  let destDir = root3;
  for (let i = 0; i < destParts.length - 1; i++) {
    destDir = await destDir.getDirectoryHandle(destParts[i], { create: true });
  }
  const destName = destParts[destParts.length - 1];
  if (isDir) {
    await copyDirRecursive(srcDir, srcName, destDir, destName);
  } else {
    await copyFile2(srcDir, srcName, destDir, destName);
  }
};
async function copyFile2(srcDir, srcName, destDir, destName) {
  const srcHandle = await srcDir.getFileHandle(srcName);
  const file = await srcHandle.getFile();
  const content = new Uint8Array(await file.arrayBuffer());
  const destHandle = await destDir.getFileHandle(destName, { create: true });
  const writable = await destHandle.createWritable();
  await writable.write(content);
  await writable.close();
}
async function copyDirRecursive(srcParent, srcName, destParent, destName) {
  const srcDir = await srcParent.getDirectoryHandle(srcName);
  const destDir = await destParent.getDirectoryHandle(destName, { create: true });
  for await (const [name, handle] of srcDir.entries()) {
    if (handle.kind === "file") {
      await copyFile2(srcDir, name, destDir, name);
    } else {
      await copyDirRecursive(srcDir, name, destDir, name);
    }
  }
}

// src/methods/opendir.ts
init_buffer_shim_bundled();
var opendir = async (root3, path) => {
  const parts = path.split("/").filter((p) => p.length > 0);
  let currentDir = root3;
  for (const part of parts) {
    currentDir = await currentDir.getDirectoryHandle(part);
  }
  const entries = [];
  for await (const [name, handle] of currentDir.entries()) {
    const isDir = handle.kind === "directory";
    entries.push({
      name,
      isFile: () => !isDir,
      isDirectory: () => isDir,
      isSymbolicLink: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false
    });
  }
  let index = 0;
  return {
    path,
    async read() {
      if (index >= entries.length) return null;
      return entries[index++];
    },
    readSync() {
      if (index >= entries.length) return null;
      return entries[index++];
    },
    async close() {
      index = entries.length;
    },
    closeSync() {
      index = entries.length;
    },
    async *[Symbol.asyncIterator]() {
      for (const entry of entries) {
        yield entry;
      }
    }
  };
};

// src/methods/statfs.ts
init_buffer_shim_bundled();
var statfs = async (_root, _path) => {
  let total = 1024 * 1024 * 1024;
  let used = 0;
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      total = estimate.quota || total;
      used = estimate.usage || 0;
    } catch {
    }
  }
  const blockSize = 4096;
  const totalBlocks = Math.floor(total / blockSize);
  const usedBlocks = Math.floor(used / blockSize);
  const freeBlocks = totalBlocks - usedBlocks;
  return {
    type: 1330660947,
    // "OPFS" in hex
    bsize: blockSize,
    blocks: totalBlocks,
    bfree: freeBlocks,
    bavail: freeBlocks,
    files: 1e6,
    ffree: 999999
  };
};

// src/methods/open.ts
init_buffer_shim_bundled();
var fdTable = /* @__PURE__ */ new Map();
var nextFd = 3;
var getFdEntry = (fd) => fdTable.get(fd);
var setFdPosition = (fd, position) => {
  const entry = fdTable.get(fd);
  if (entry) entry.position = position;
};
var closeFd = (fd) => fdTable.delete(fd);
var parseFlags = (flags) => {
  return {
    read: flags.includes("r") || flags === "a+" || flags === "w+",
    write: flags.includes("w") || flags.includes("a") || flags.includes("+"),
    append: flags.includes("a"),
    create: flags.includes("w") || flags.includes("a") || flags.includes("x"),
    truncate: flags.includes("w")
  };
};
var open = async (root3, path, flags = "r", _mode) => {
  const parts = path.split("/").filter((p) => p.length > 0);
  const parsedFlags = parseFlags(flags);
  let currentDir = root3;
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      currentDir = await currentDir.getDirectoryHandle(parts[i]);
    } catch {
      if (parsedFlags.create) {
        currentDir = await currentDir.getDirectoryHandle(parts[i], { create: true });
      } else {
        throw createENOENT("open", path);
      }
    }
  }
  const fileName = parts[parts.length - 1];
  let handle;
  try {
    handle = await currentDir.getFileHandle(fileName, { create: parsedFlags.create });
  } catch {
    throw createENOENT("open", path);
  }
  if (parsedFlags.truncate) {
    const writable = await handle.createWritable();
    await writable.truncate(0);
    await writable.close();
  }
  const fd = nextFd++;
  const file = await handle.getFile();
  fdTable.set(fd, {
    path,
    flags,
    position: parsedFlags.append ? file.size : 0,
    handle
  });
  return fd;
};

// src/methods/close.ts
init_buffer_shim_bundled();
var close = async (fd) => {
  const entry = getFdEntry(fd);
  if (!entry) {
    throw new Error(`EBADF: bad file descriptor, close`);
  }
  closeFd(fd);
};

// src/methods/read.ts
init_buffer_shim_bundled();
var read = async (fd, buffer, offset, length, position) => {
  const entry = getFdEntry(fd);
  if (!entry) {
    throw new Error(`EBADF: bad file descriptor, read`);
  }
  if (!entry.handle) {
    throw new Error(`EBADF: file descriptor not opened for async operations`);
  }
  const file = await entry.handle.getFile();
  const fileContent = new Uint8Array(await file.arrayBuffer());
  const readPosition = position !== null ? position : entry.position;
  const bytesToRead = Math.min(length, fileContent.length - readPosition);
  if (bytesToRead <= 0) return 0;
  buffer.set(fileContent.subarray(readPosition, readPosition + bytesToRead), offset);
  if (position === null) {
    setFdPosition(fd, entry.position + bytesToRead);
  }
  return bytesToRead;
};

// src/methods/write.ts
init_buffer_shim_bundled();
var write = async (fd, buffer, offset, length, position) => {
  const entry = getFdEntry(fd);
  if (!entry) {
    throw new Error(`EBADF: bad file descriptor, write`);
  }
  queueEvent("update", entry.path);
  if (!entry.handle) {
    throw new Error(`EBADF: file descriptor not opened for async operations`);
  }
  const file = await entry.handle.getFile();
  const fileContent = new Uint8Array(await file.arrayBuffer());
  const writePosition = position !== null ? position : entry.position;
  const dataToWrite = buffer.subarray(offset, offset + length);
  const newSize = Math.max(fileContent.length, writePosition + length);
  const newContent = new Uint8Array(newSize);
  newContent.set(fileContent);
  newContent.set(dataToWrite, writePosition);
  const writable = await entry.handle.createWritable();
  await writable.write(newContent);
  await writable.close();
  if (position === null) {
    setFdPosition(fd, entry.position + length);
  }
  return length;
};

// src/methods/fstat.ts
init_buffer_shim_bundled();
var createStats3 = (size, isDir) => {
  const now = /* @__PURE__ */ new Date();
  return {
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    dev: 0,
    ino: 0,
    mode: isDir ? 16877 : 33188,
    nlink: 1,
    uid: 0,
    gid: 0,
    rdev: 0,
    size,
    blksize: 4096,
    blocks: Math.ceil(size / 512),
    atimeMs: now.getTime(),
    mtimeMs: now.getTime(),
    ctimeMs: now.getTime(),
    birthtimeMs: now.getTime(),
    atime: now,
    mtime: now,
    ctime: now,
    birthtime: now
  };
};
var fstat = async (fd) => {
  const entry = getFdEntry(fd);
  if (!entry) {
    throw createEBADF("fstat");
  }
  if (!entry.handle) {
    throw new Error(`EBADF: file descriptor not opened for async operations`);
  }
  const file = await entry.handle.getFile();
  return createStats3(file.size, false);
};

// src/methods/fsync.ts
init_buffer_shim_bundled();
var fsync = async (fd) => {
  const entry = getFdEntry(fd);
  if (!entry) {
    throw new Error(`EBADF: bad file descriptor, fsync`);
  }
};

// src/methods/fdatasync.ts
init_buffer_shim_bundled();
var fdatasync = async (fd) => {
  const entry = getFdEntry(fd);
  if (!entry) {
    throw new Error(`EBADF: bad file descriptor, fdatasync`);
  }
};

// src/methods/ftruncate.ts
init_buffer_shim_bundled();
var ftruncate = async (fd, len = 0) => {
  const entry = getFdEntry(fd);
  if (!entry) {
    throw new Error(`EBADF: bad file descriptor, ftruncate`);
  }
  queueEvent("update", entry.path);
  if (!entry.handle) {
    throw new Error(`EBADF: file descriptor not opened for async operations`);
  }
  const file = await entry.handle.getFile();
  const content = new Uint8Array(await file.arrayBuffer());
  let newContent;
  if (len === 0) {
    newContent = new Uint8Array(0);
  } else if (len < content.length) {
    newContent = content.slice(0, len);
  } else {
    newContent = new Uint8Array(len);
    newContent.set(content);
  }
  const writable = await entry.handle.createWritable();
  await writable.write(new Uint8Array(newContent).buffer);
  await writable.close();
};

// src/methods/fchmod.ts
init_buffer_shim_bundled();
var fchmod = async (_fd, _mode) => {
};

// src/methods/fchown.ts
init_buffer_shim_bundled();
var fchown = async (_fd, _uid, _gid) => {
};

// src/methods/futimes.ts
init_buffer_shim_bundled();
var futimes = async (_fd, _atime, _mtime) => {
};

// src/methods/readv.ts
init_buffer_shim_bundled();
var readv = async (fd, buffers, position) => {
  const entry = getFdEntry(fd);
  if (!entry) {
    throw new Error(`EBADF: bad file descriptor, readv`);
  }
  if (!entry.handle) {
    throw new Error(`EBADF: file descriptor not opened for async operations`);
  }
  const file = await entry.handle.getFile();
  const fileContent = new Uint8Array(await file.arrayBuffer());
  let readPosition = position !== null && position !== void 0 ? position : entry.position;
  let totalRead = 0;
  for (const buffer of buffers) {
    const bytesToRead = Math.min(buffer.length, fileContent.length - readPosition);
    if (bytesToRead <= 0) break;
    buffer.set(fileContent.subarray(readPosition, readPosition + bytesToRead));
    readPosition += bytesToRead;
    totalRead += bytesToRead;
  }
  if (position === null || position === void 0) {
    setFdPosition(fd, entry.position + totalRead);
  }
  return totalRead;
};

// src/methods/writev.ts
init_buffer_shim_bundled();
var writev = async (fd, buffers, position) => {
  const entry = getFdEntry(fd);
  if (!entry) {
    throw new Error(`EBADF: bad file descriptor, writev`);
  }
  queueEvent("update", entry.path);
  if (!entry.handle) {
    throw new Error(`EBADF: file descriptor not opened for async operations`);
  }
  const file = await entry.handle.getFile();
  const fileContent = new Uint8Array(await file.arrayBuffer());
  let totalLength = 0;
  for (const buffer of buffers) {
    totalLength += buffer.length;
  }
  const writePosition = position !== null && position !== void 0 ? position : entry.position;
  const newSize = Math.max(fileContent.length, writePosition + totalLength);
  const newContent = new Uint8Array(newSize);
  newContent.set(fileContent);
  let currentPosition = writePosition;
  for (const buffer of buffers) {
    newContent.set(buffer, currentPosition);
    currentPosition += buffer.length;
  }
  const writable = await entry.handle.createWritable();
  await writable.write(newContent);
  await writable.close();
  if (position === null || position === void 0) {
    setFdPosition(fd, entry.position + totalLength);
  }
  return totalLength;
};

// src/methods/watch.ts
init_buffer_shim_bundled();
var import_events5 = __toESM(require_events(), 1);
var watch = (_root, path, optionsOrListener, maybeListener) => {
  const normalizedPath = path.split("/").filter((p) => p.length > 0).join("/");
  const emitter = new import_events5.EventEmitter();
  let listener;
  if (typeof optionsOrListener === "function") {
    listener = optionsOrListener;
  } else if (typeof maybeListener === "function") {
    listener = maybeListener;
  }
  const internalListener = (eventType, filename) => {
    emitter.emit("change", eventType, filename);
    if (listener) {
      listener(eventType, filename);
    }
  };
  addWatchListener(normalizedPath, internalListener);
  emitter.close = () => {
    removeWatchListener(normalizedPath, internalListener);
    emitter.removeAllListeners();
  };
  emitter.ref = () => emitter;
  emitter.unref = () => emitter;
  return emitter;
};

// src/fs.async.worker.ts
var root2 = null;
var initRoot = async () => {
  root2 = await navigator.storage.getDirectory();
};
var methods = {
  readFile,
  readFileChunk,
  getFileSize,
  writeFile,
  exists,
  unlink,
  mkdir,
  rmdir,
  readdir,
  stat,
  lstat,
  rename,
  copyFile,
  appendFile,
  rm,
  access,
  chmod,
  chown,
  lchmod,
  lchown,
  link,
  symlink,
  readlink,
  truncate,
  mkdtemp,
  realpath,
  utimes,
  lutimes,
  cp,
  opendir,
  statfs,
  open,
  close,
  read,
  write,
  fstat,
  fsync,
  fdatasync,
  ftruncate,
  fchmod,
  fchown,
  futimes,
  readv,
  writev,
  watch
};
self.onmessage = async (event) => {
  const { type, id, method, args, eventsSAB } = event.data;
  if (type === "init") {
    setSharedArrayBuffer(eventsSAB);
    await initRoot();
    self.postMessage({ type: "initialized" });
    return;
  }
  if (!root2) await initRoot();
  try {
    const fn = methods[method];
    if (!fn) throw new Error(`Unknown method: ${method}`);
    const result = await fn(root2, ...args);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
self.postMessage({ type: "ready" });
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
//# sourceMappingURL=fs.async.worker.js.map