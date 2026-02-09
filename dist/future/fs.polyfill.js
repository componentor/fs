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
    function EventEmitter3() {
      EventEmitter3.init.call(this);
    }
    module.exports = EventEmitter3;
    module.exports.once = once;
    EventEmitter3.EventEmitter = EventEmitter3;
    EventEmitter3.prototype._events = void 0;
    EventEmitter3.prototype._eventsCount = 0;
    EventEmitter3.prototype._maxListeners = void 0;
    var defaultMaxListeners = 10;
    function checkListener(listener) {
      if (typeof listener !== "function") {
        throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
      }
    }
    Object.defineProperty(EventEmitter3, "defaultMaxListeners", {
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
    EventEmitter3.init = function() {
      if (this._events === void 0 || this._events === Object.getPrototypeOf(this)._events) {
        this._events = /* @__PURE__ */ Object.create(null);
        this._eventsCount = 0;
      }
      this._maxListeners = this._maxListeners || void 0;
    };
    EventEmitter3.prototype.setMaxListeners = function setMaxListeners(n) {
      if (typeof n !== "number" || n < 0 || NumberIsNaN(n)) {
        throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n + ".");
      }
      this._maxListeners = n;
      return this;
    };
    function _getMaxListeners(that) {
      if (that._maxListeners === void 0)
        return EventEmitter3.defaultMaxListeners;
      return that._maxListeners;
    }
    EventEmitter3.prototype.getMaxListeners = function getMaxListeners() {
      return _getMaxListeners(this);
    };
    EventEmitter3.prototype.emit = function emit(type) {
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
    EventEmitter3.prototype.addListener = function addListener(type, listener) {
      return _addListener(this, type, listener, false);
    };
    EventEmitter3.prototype.on = EventEmitter3.prototype.addListener;
    EventEmitter3.prototype.prependListener = function prependListener(type, listener) {
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
    EventEmitter3.prototype.once = function once2(type, listener) {
      checkListener(listener);
      this.on(type, _onceWrap(this, type, listener));
      return this;
    };
    EventEmitter3.prototype.prependOnceListener = function prependOnceListener(type, listener) {
      checkListener(listener);
      this.prependListener(type, _onceWrap(this, type, listener));
      return this;
    };
    EventEmitter3.prototype.removeListener = function removeListener(type, listener) {
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
    EventEmitter3.prototype.off = EventEmitter3.prototype.removeListener;
    EventEmitter3.prototype.removeAllListeners = function removeAllListeners(type) {
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
    EventEmitter3.prototype.listeners = function listeners(type) {
      return _listeners(this, type, true);
    };
    EventEmitter3.prototype.rawListeners = function rawListeners(type) {
      return _listeners(this, type, false);
    };
    EventEmitter3.listenerCount = function(emitter, type) {
      if (typeof emitter.listenerCount === "function") {
        return emitter.listenerCount(type);
      } else {
        return listenerCount.call(emitter, type);
      }
    };
    EventEmitter3.prototype.listenerCount = listenerCount;
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
    EventEmitter3.prototype.eventNames = function eventNames() {
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

// src/fs.polyfill.ts
init_buffer_shim_bundled();

// src/fs.worker-pool.ts
init_buffer_shim_bundled();

// src/logger.ts
init_buffer_shim_bundled();
var defaultConfig = {
  enabled: false,
  level: "info",
  console: true,
  buffer: false,
  bufferSize: 1e3
};
var config = { ...defaultConfig };
var entries = [];
var nextId = 1;
var startTimestamp = performance.now();
function formatId(id) {
  return id.toString().padStart(3, "0");
}
function formatTimestamp(timestamp) {
  return `+${timestamp.toFixed(2)}ms`.padStart(12);
}
function formatArgs(args) {
  return args.map((arg) => {
    if (typeof arg === "string") {
      return arg.length > 50 ? `"${arg.slice(0, 47)}..."` : `"${arg}"`;
    }
    if (arg instanceof Uint8Array || arg instanceof ArrayBuffer) {
      const len = arg instanceof Uint8Array ? arg.length : arg.byteLength;
      return `<Buffer ${len} bytes>`;
    }
    if (typeof arg === "object" && arg !== null) {
      const str = JSON.stringify(arg);
      return str.length > 30 ? `${str.slice(0, 27)}...` : str;
    }
    return String(arg);
  }).join(", ");
}
function shouldLog(method) {
  if (!config.enabled) return false;
  if (!config.methods || config.methods.length === 0) return true;
  return config.methods.includes(method);
}
function logToConsole(entry, phase) {
  if (!config.console) return;
  const prefix = `[FS:${formatId(entry.id)} ${formatTimestamp(entry.timestamp)}]`;
  const methodStr = `${entry.method}(${formatArgs(entry.args)})`;
  const workerTag = entry.worker !== "main" ? ` [${entry.worker}]` : "";
  if (phase === "START") {
    console.log(`%c${prefix} ${methodStr} START${workerTag}`, "color: #888");
  } else {
    const duration = entry.duration !== void 0 ? ` (${entry.duration.toFixed(2)}ms)` : "";
    const status = entry.result === "success" ? "\u2713" : "\u2717";
    const color = entry.result === "success" ? "color: #4a4" : "color: #a44";
    const errorMsg = entry.error ? ` - ${entry.error}` : "";
    console.log(`%c${prefix} ${methodStr} END${duration} ${status}${errorMsg}`, color);
  }
}
function addToBuffer(entry) {
  if (!config.buffer) return;
  entries.push(entry);
  if (entries.length > config.bufferSize) {
    entries = entries.slice(-config.bufferSize);
  }
}
function logStart(method, args, worker = "main") {
  if (!shouldLog(method)) return null;
  const id = nextId++;
  const startTime = performance.now();
  const timestamp = startTime - startTimestamp;
  const handle = { id, startTime, method, args, worker };
  if (config.level === "verbose" || config.level === "debug") {
    const entry = {
      id,
      timestamp,
      absoluteTime: Date.now(),
      method,
      args,
      worker
    };
    logToConsole(entry, "START");
  }
  return handle;
}
function logEnd(handle, result = "success", error) {
  if (!handle) return;
  const endTime = performance.now();
  const duration = endTime - handle.startTime;
  const timestamp = endTime - startTimestamp;
  const entry = {
    id: handle.id,
    timestamp,
    absoluteTime: Date.now(),
    method: handle.method,
    args: handle.args,
    duration,
    result,
    error,
    worker: handle.worker
  };
  logToConsole(entry, "END");
  addToBuffer(entry);
}
var logger = {
  /**
   * Enable logging
   */
  enable() {
    config.enabled = true;
    startTimestamp = performance.now();
    console.log("%c[FS Logger] Enabled", "color: #4a4; font-weight: bold");
  },
  /**
   * Disable logging
   */
  disable() {
    config.enabled = false;
    console.log("%c[FS Logger] Disabled", "color: #a44; font-weight: bold");
  },
  /**
   * Check if logging is enabled
   */
  isEnabled() {
    return config.enabled;
  },
  /**
   * Set log level
   */
  setLevel(level) {
    config.level = level;
    if (config.enabled) {
      console.log(`%c[FS Logger] Level set to: ${level}`, "color: #888");
    }
  },
  /**
   * Set method filter
   */
  setMethods(methods) {
    config.methods = methods;
  },
  /**
   * Enable/disable console output
   */
  setConsole(enabled) {
    config.console = enabled;
  },
  /**
   * Enable/disable buffer storage
   */
  setBuffer(enabled, size) {
    config.buffer = enabled;
    if (size !== void 0) {
      config.bufferSize = size;
    }
  },
  /**
   * Get stored log entries
   */
  getEntries() {
    return [...entries];
  },
  /**
   * Clear stored log entries
   */
  clear() {
    entries = [];
    nextId = 1;
    startTimestamp = performance.now();
  },
  /**
   * Export logs as JSON
   */
  export() {
    return JSON.stringify(entries, null, 2);
  },
  /**
   * Get current configuration
   */
  getConfig() {
    return { ...config };
  },
  /**
   * Configure logger
   */
  configure(options) {
    config = { ...config, ...options };
  },
  /**
   * Reset to default configuration
   */
  reset() {
    config = { ...defaultConfig };
    entries = [];
    nextId = 1;
    startTimestamp = performance.now();
  },
  // Expose start/end functions for use in workers
  start: logStart,
  end: logEnd
};

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
var TIMEOUTS = {
  /** 60s - Worker initialization (WASM compilation can take 15-30s for large modules) */
  WORKER_INIT: 6e4,
  /** 600s - Script execution (WASM under V8 Liftoff can be 10-100x slower than native) */
  EXECUTION: 6e5,
  /** 60s - Bundle operation */
  BUNDLE: 6e4,
  /** 30s - Worker idle before termination */
  WORKER_IDLE: 3e4,
  /** 2s - Auto-scaling check interval */
  SCALE_CHECK: 2e3,
  /** 50ms - Execution polling interval */
  EXEC_POLL: 50
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
var SAB_STATUS = {
  IDLE: 0,
  REQUEST: 1,
  RESPONSE: 2,
  ERROR: 3,
  OUTPUT: 4
  // For streaming terminal output
};
var SAB_TYPE = {
  REQUEST_JSON: 0,
  REQUEST_BINARY_ARG: 1,
  RESPONSE_JSON: 0,
  RESPONSE_BINARY: 1
};
var LOCKS = {
  /** Web Lock for primary tab election */
  FS_PRIMARY: "fs_primary_lock"
};

// src/fs.worker-pool.ts
var MAX_WORKERS = WORKER_POOL.MAX_WORKERS;
var MIN_WORKERS = WORKER_POOL.MIN_WORKERS;
var WORKER_IDLE_TIMEOUT = TIMEOUTS.WORKER_IDLE;
var SCALE_UP_QUEUE_THRESHOLD = WORKER_POOL.SCALE_UP_THRESHOLD;
var SCALE_CHECK_INTERVAL = TIMEOUTS.SCALE_CHECK;
var workers = [];
var pending = /* @__PURE__ */ new Map();
var queue = [];
var nextId2 = 0;
var nextWorkerId = 0;
var eventsSAB = null;
var scaleCheckTimer = null;
var initialized = false;
var metrics = {
  totalRequests: 0,
  peakQueueDepth: 0,
  peakWorkerCount: 0,
  workersCreated: 0,
  workersTerminated: 0
};
var setSharedArrayBuffer = (sab) => {
  eventsSAB = sab;
  for (const pooled of workers) {
    if (!pooled.initialized) {
      pooled.worker.postMessage({ type: "init", eventsSAB: sab });
      pooled.initialized = true;
    }
  }
  if (!initialized) {
    initialized = true;
    startAutoScaling();
    ensureMinWorkers();
  }
  processQueue();
};
function ensureMinWorkers() {
  while (workers.length < MIN_WORKERS) {
    createWorker();
  }
}
var createWorker = () => {
  const worker = new Worker(new URL("./fs.async.worker.js", import.meta.url), { type: "module" });
  const pooled = {
    worker,
    busy: false,
    initialized: false,
    lastActivity: Date.now(),
    id: nextWorkerId++
  };
  worker.onmessage = (event) => handleMessage(pooled, event);
  workers.push(pooled);
  metrics.workersCreated++;
  if (workers.length > metrics.peakWorkerCount) {
    metrics.peakWorkerCount = workers.length;
  }
  if (eventsSAB) {
    worker.postMessage({ type: "init", eventsSAB });
    pooled.initialized = true;
  }
  return pooled;
};
function terminateWorker(pooled) {
  const index = workers.indexOf(pooled);
  if (index !== -1) {
    workers.splice(index, 1);
    pooled.worker.terminate();
    metrics.workersTerminated++;
  }
}
function getIdleWorker() {
  const idle = workers.find((w) => !w.busy && w.initialized);
  if (idle) {
    idle.lastActivity = Date.now();
    return idle;
  }
  if (workers.length < MAX_WORKERS && eventsSAB) {
    return createWorker();
  }
  return null;
}
function processQueue() {
  if (queue.length > metrics.peakQueueDepth) {
    metrics.peakQueueDepth = queue.length;
  }
  while (queue.length > 0) {
    const pooled = getIdleWorker();
    if (!pooled) break;
    const task = queue.shift();
    pooled.busy = true;
    pooled.lastActivity = Date.now();
    pooled.worker.postMessage(task);
  }
  if (queue.length >= SCALE_UP_QUEUE_THRESHOLD && workers.length < MAX_WORKERS && eventsSAB) {
    const newWorker = createWorker();
    if (newWorker.initialized && queue.length > 0) {
      const task = queue.shift();
      newWorker.busy = true;
      newWorker.lastActivity = Date.now();
      newWorker.worker.postMessage(task);
    }
  }
}
function handleMessage(pooled, event) {
  const { id, result, error } = event.data;
  const req = pending.get(id);
  if (req) {
    pending.delete(id);
    if (error) {
      logEnd(req.logHandle, "error", error);
      req.reject(new Error(error));
    } else {
      logEnd(req.logHandle, "success");
      req.resolve(result);
    }
  }
  pooled.busy = false;
  pooled.lastActivity = Date.now();
  processQueue();
}
function startAutoScaling() {
  if (scaleCheckTimer) return;
  scaleCheckTimer = setInterval(() => {
    const now = Date.now();
    const idleWorkers = workers.filter(
      (w) => !w.busy && now - w.lastActivity > WORKER_IDLE_TIMEOUT
    );
    for (const worker of idleWorkers) {
      if (workers.length > MIN_WORKERS) {
        terminateWorker(worker);
      }
    }
  }, SCALE_CHECK_INTERVAL);
}
function request(method, args) {
  metrics.totalRequests++;
  const logHandle = logStart(method, args, "async");
  return new Promise((resolve, reject) => {
    const id = nextId2++;
    pending.set(id, { resolve, reject, logHandle });
    const pooled = getIdleWorker();
    if (pooled) {
      pooled.busy = true;
      pooled.lastActivity = Date.now();
      pooled.worker.postMessage({ id, method, args });
    } else {
      queue.push({ id, method, args });
      if (queue.length > metrics.peakQueueDepth) {
        metrics.peakQueueDepth = queue.length;
      }
    }
  });
}

// src/polyfill/index.ts
init_buffer_shim_bundled();

// src/polyfill/sync.ts
init_buffer_shim_bundled();

// src/classes/index.ts
init_buffer_shim_bundled();

// src/classes/Stats.ts
init_buffer_shim_bundled();

// src/constants.ts
init_buffer_shim_bundled();
var F_OK = 0;
var R_OK = 4;
var W_OK = 2;
var X_OK = 1;
var COPYFILE_EXCL = 1;
var COPYFILE_FICLONE = 2;
var COPYFILE_FICLONE_FORCE = 4;
var O_RDONLY = 0;
var O_WRONLY = 1;
var O_RDWR = 2;
var O_CREAT = 64;
var O_EXCL = 128;
var O_NOCTTY = 256;
var O_TRUNC = 512;
var O_APPEND = 1024;
var O_DIRECTORY = 65536;
var O_NOATIME = 262144;
var O_NOFOLLOW = 131072;
var O_SYNC = 1052672;
var O_DSYNC = 4096;
var O_SYMLINK = 2097152;
var O_DIRECT = 16384;
var O_NONBLOCK = 2048;
var S_IFMT = 61440;
var S_IFREG = 32768;
var S_IFDIR = 16384;
var S_IFCHR = 8192;
var S_IFBLK = 24576;
var S_IFIFO = 4096;
var S_IFLNK = 40960;
var S_IFSOCK = 49152;
var S_IRWXU = 448;
var S_IRUSR = 256;
var S_IWUSR = 128;
var S_IXUSR = 64;
var S_IRWXG = 56;
var S_IRGRP = 32;
var S_IWGRP = 16;
var S_IXGRP = 8;
var S_IRWXO = 7;
var S_IROTH = 4;
var S_IWOTH = 2;
var S_IXOTH = 1;
var S_ISUID = 2048;
var S_ISGID = 1024;
var S_ISVTX = 512;
var constants = {
  // File Access
  F_OK,
  R_OK,
  W_OK,
  X_OK,
  // File Copy
  COPYFILE_EXCL,
  COPYFILE_FICLONE,
  COPYFILE_FICLONE_FORCE,
  // File Open
  O_RDONLY,
  O_WRONLY,
  O_RDWR,
  O_CREAT,
  O_EXCL,
  O_NOCTTY,
  O_TRUNC,
  O_APPEND,
  O_DIRECTORY,
  O_NOATIME,
  O_NOFOLLOW,
  O_SYNC,
  O_DSYNC,
  O_SYMLINK,
  O_DIRECT,
  O_NONBLOCK,
  // File Type
  S_IFMT,
  S_IFREG,
  S_IFDIR,
  S_IFCHR,
  S_IFBLK,
  S_IFIFO,
  S_IFLNK,
  S_IFSOCK,
  // File Mode (permissions)
  S_IRWXU,
  S_IRUSR,
  S_IWUSR,
  S_IXUSR,
  S_IRWXG,
  S_IRGRP,
  S_IWGRP,
  S_IXGRP,
  S_IRWXO,
  S_IROTH,
  S_IWOTH,
  S_IXOTH,
  // Special mode bits
  S_ISUID,
  S_ISGID,
  S_ISVTX
};

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

// src/classes/Dir.ts
init_buffer_shim_bundled();
var Dir = class {
  path;
  #entries;
  #index = 0;
  #closed = false;
  constructor(init2) {
    this.path = init2.path;
    this.#entries = init2.entries;
  }
  // Async read one entry at a time
  async read() {
    if (this.#closed) {
      throw new Error("Directory handle was closed");
    }
    if (this.#index >= this.#entries.length) {
      return null;
    }
    return this.#entries[this.#index++];
  }
  // Sync read one entry at a time
  readSync() {
    if (this.#closed) {
      throw new Error("Directory handle was closed");
    }
    if (this.#index >= this.#entries.length) {
      return null;
    }
    return this.#entries[this.#index++];
  }
  // Close the directory handle
  async close() {
    this.#closed = true;
  }
  // Sync close
  closeSync() {
    this.#closed = true;
  }
  // Async iterator support
  async *[Symbol.asyncIterator]() {
    if (this.#closed) {
      throw new Error("Directory handle was closed");
    }
    for (const entry of this.#entries) {
      yield entry;
    }
  }
  // For...of support (sync)
  *[Symbol.iterator]() {
    if (this.#closed) {
      throw new Error("Directory handle was closed");
    }
    for (const entry of this.#entries) {
      yield entry;
    }
  }
};

// src/classes/FileHandle.ts
init_buffer_shim_bundled();
var asyncRequestFn = null;
var setFileHandleAsyncRequestFn = (fn) => {
  asyncRequestFn = fn;
};
var asyncRequest = (method, args) => {
  if (!asyncRequestFn) throw new Error("FileHandle async request function not initialized");
  return asyncRequestFn(method, args);
};
var FileHandle = class {
  fd;
  #closed = false;
  constructor(fd) {
    this.fd = fd;
  }
  #checkClosed() {
    if (this.#closed) {
      throw new Error("file closed");
    }
  }
  async appendFile(data, options) {
    this.#checkClosed();
    const encoding = options?.encoding ?? "utf8";
    const buffer = typeof data === "string" ? Buffer.from(data, encoding) : data;
    await asyncRequest("write", [this.fd, buffer, 0, buffer.length, null]);
  }
  async chmod(mode) {
    this.#checkClosed();
    await asyncRequest("fchmod", [this.fd, mode]);
  }
  async chown(uid, gid) {
    this.#checkClosed();
    await asyncRequest("fchown", [this.fd, uid, gid]);
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await asyncRequest("close", [this.fd]);
  }
  async datasync() {
    this.#checkClosed();
    await asyncRequest("fdatasync", [this.fd]);
  }
  async read(bufferOrOptions, offset, length, position) {
    this.#checkClosed();
    let buffer;
    let off;
    let len;
    let pos;
    if (Buffer.isBuffer(bufferOrOptions)) {
      buffer = bufferOrOptions;
      off = offset ?? 0;
      len = length ?? buffer.length - off;
      pos = position ?? null;
    } else {
      const opts = bufferOrOptions ?? {};
      buffer = opts.buffer ?? Buffer.alloc(16384);
      off = opts.offset ?? 0;
      len = opts.length ?? buffer.length - off;
      pos = opts.position ?? null;
    }
    const bytesRead = await asyncRequest("read", [this.fd, buffer, off, len, pos]);
    return { bytesRead, buffer };
  }
  async readFile(options) {
    this.#checkClosed();
    const stat3 = await this.stat();
    const buffer = Buffer.alloc(stat3.size);
    await this.read(buffer, 0, stat3.size, 0);
    if (options?.encoding) {
      return buffer.toString(options.encoding);
    }
    return buffer;
  }
  async readLines(options) {
    this.#checkClosed();
    const content = await this.readFile({ encoding: options?.encoding ?? "utf8" });
    const lines = content.split(/\r?\n/);
    return {
      async *[Symbol.asyncIterator]() {
        for (const line of lines) {
          yield line;
        }
      }
    };
  }
  async readv(buffers, position) {
    this.#checkClosed();
    const bytesRead = await asyncRequest("readv", [this.fd, buffers, position ?? null]);
    return { bytesRead, buffers };
  }
  async stat(options) {
    this.#checkClosed();
    const result = await asyncRequest("fstat", [this.fd, options]);
    return result;
  }
  async sync() {
    this.#checkClosed();
    await asyncRequest("fsync", [this.fd]);
  }
  async truncate(len) {
    this.#checkClosed();
    await asyncRequest("ftruncate", [this.fd, len ?? 0]);
  }
  async utimes(atime, mtime) {
    this.#checkClosed();
    await asyncRequest("futimes", [this.fd, atime, mtime]);
  }
  async write(bufferOrData, offsetOrPosition, lengthOrEncoding, position) {
    this.#checkClosed();
    let buffer;
    let off;
    let len;
    let pos;
    if (Buffer.isBuffer(bufferOrData)) {
      buffer = bufferOrData;
      off = offsetOrPosition ?? 0;
      len = lengthOrEncoding ?? buffer.length - off;
      pos = position ?? null;
    } else {
      const encoding = lengthOrEncoding ?? "utf8";
      buffer = Buffer.from(bufferOrData, encoding);
      off = 0;
      len = buffer.length;
      pos = offsetOrPosition ?? null;
    }
    const bytesWritten = await asyncRequest("write", [this.fd, buffer, off, len, pos]);
    return { bytesWritten, buffer };
  }
  async writeFile(data, options) {
    this.#checkClosed();
    await this.truncate(0);
    const buffer = typeof data === "string" ? Buffer.from(data, options?.encoding ?? "utf8") : data;
    await this.write(buffer, 0, buffer.length, 0);
  }
  async writev(buffers, position) {
    this.#checkClosed();
    const bytesWritten = await asyncRequest("writev", [this.fd, buffers, position ?? null]);
    return { bytesWritten, buffers };
  }
  // createReadStream and createWriteStream are omitted - they need stream implementation
};

// src/classes/ReadStream.ts
init_buffer_shim_bundled();
var import_events = __toESM(require_events(), 1);
var readFileFn = null;
var readChunkFn = null;
var getSizeFn = null;
var CHUNKED_READ_THRESHOLD = 1024 * 1024;
var setReadStreamReadFn = (fn) => {
  readFileFn = fn;
};
var setReadStreamChunkFn = (fn) => {
  readChunkFn = fn;
};
var setReadStreamSizeFn = (fn) => {
  getSizeFn = fn;
};
var ReadStream = class extends import_events.EventEmitter {
  path;
  flags;
  mode;
  start;
  end;
  autoClose;
  bytesRead = 0;
  pending = true;
  #encoding;
  #highWaterMark;
  #destroyed = false;
  #reading = false;
  #position;
  #endPosition;
  constructor(path, options) {
    super();
    this.path = path;
    this.flags = options?.flags ?? "r";
    this.mode = options?.mode ?? 438;
    this.start = options?.start;
    this.end = options?.end;
    this.autoClose = options?.autoClose ?? true;
    this.#encoding = options?.encoding ?? null;
    this.#highWaterMark = options?.highWaterMark ?? 64 * 1024;
    this.#position = this.start ?? 0;
    this.#endPosition = this.end;
    setImmediate(() => this.#startReading());
  }
  async #startReading() {
    if (this.#destroyed || this.#reading) return;
    this.#reading = true;
    this.pending = false;
    try {
      if (!readFileFn) {
        throw new Error("ReadStream read function not initialized");
      }
      let fileSize;
      if (getSizeFn && readChunkFn) {
        try {
          fileSize = await getSizeFn(this.path);
        } catch {
        }
      }
      const effectiveEnd = this.end !== void 0 ? this.end + 1 : fileSize;
      const effectiveStart = this.start ?? 0;
      const totalToRead = effectiveEnd !== void 0 ? effectiveEnd - effectiveStart : void 0;
      if (totalToRead !== void 0 && totalToRead > CHUNKED_READ_THRESHOLD && readChunkFn && getSizeFn) {
        await this.#readChunked(effectiveStart, effectiveEnd);
      } else {
        await this.#readFull();
      }
    } catch (err) {
      this.emit("error", err);
      if (this.autoClose) {
        this.destroy();
      }
    }
    this.#reading = false;
  }
  // Read file in chunks (memory efficient for large files)
  async #readChunked(start, end) {
    let position = start;
    while (position < end && !this.#destroyed) {
      const chunkEnd = Math.min(position + this.#highWaterMark, end);
      const chunk = await readChunkFn(this.path, position, chunkEnd);
      position = chunkEnd;
      this.bytesRead += chunk.length;
      if (this.#encoding) {
        this.emit("data", chunk.toString(this.#encoding));
      } else {
        this.emit("data", chunk);
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    if (!this.#destroyed) {
      this.emit("end");
      if (this.autoClose) {
        this.destroy();
      }
    }
  }
  // Read entire file at once (for small files)
  async #readFull() {
    const content = await readFileFn(this.path, {
      start: this.start,
      end: this.end
    });
    let buffer = content;
    let offset = 0;
    while (offset < buffer.length && !this.#destroyed) {
      const chunkSize = Math.min(this.#highWaterMark, buffer.length - offset);
      const chunk = buffer.subarray(offset, offset + chunkSize);
      offset += chunkSize;
      this.bytesRead += chunkSize;
      if (this.#encoding) {
        this.emit("data", chunk.toString(this.#encoding));
      } else {
        this.emit("data", chunk);
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    if (!this.#destroyed) {
      this.emit("end");
      if (this.autoClose) {
        this.destroy();
      }
    }
  }
  setEncoding(encoding) {
    this.#encoding = encoding;
    return this;
  }
  pause() {
    return this;
  }
  resume() {
    return this;
  }
  isPaused() {
    return false;
  }
  pipe(destination) {
    this.on("data", (chunk) => {
      destination.write(chunk);
    });
    this.on("end", () => {
      if (destination.end) {
        destination.end();
      }
    });
    return destination;
  }
  unpipe() {
    this.removeAllListeners("data");
    return this;
  }
  destroy(error) {
    if (this.#destroyed) return this;
    this.#destroyed = true;
    if (error) {
      this.emit("error", error);
    }
    this.emit("close");
    return this;
  }
  // Readable stream interface
  read(_size) {
    return null;
  }
  get destroyed() {
    return this.#destroyed;
  }
  // AsyncIterable support
  async *[Symbol.asyncIterator]() {
    const chunks = [];
    let ended = false;
    let error = null;
    this.on("data", (chunk) => chunks.push(chunk));
    this.on("end", () => {
      ended = true;
    });
    this.on("error", (err) => {
      error = err;
    });
    while (!ended && !error) {
      if (chunks.length > 0) {
        yield chunks.shift();
      } else {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    while (chunks.length > 0) {
      yield chunks.shift();
    }
    if (error) {
      throw error;
    }
  }
};

// src/classes/WriteStream.ts
init_buffer_shim_bundled();
var import_events2 = __toESM(require_events(), 1);
var writeFileFn = null;
var appendFileFn = null;
var setWriteStreamWriteFn = (fn) => {
  writeFileFn = fn;
};
var setWriteStreamAppendFn = (fn) => {
  appendFileFn = fn;
};
var WriteStream = class extends import_events2.EventEmitter {
  path;
  flags;
  mode;
  start;
  autoClose;
  bytesWritten = 0;
  pending = true;
  #encoding;
  #highWaterMark;
  #destroyed = false;
  #finished = false;
  #writeQueue = [];
  #writing = false;
  #needsDrain = false;
  #isFirstWrite = true;
  constructor(path, options) {
    super();
    this.path = path;
    this.flags = options?.flags ?? "w";
    this.mode = options?.mode ?? 438;
    this.start = options?.start;
    this.autoClose = options?.autoClose ?? true;
    this.#encoding = options?.encoding ?? "utf8";
    this.#highWaterMark = options?.highWaterMark ?? 64 * 1024;
    setImmediate(() => {
      this.pending = false;
      this.emit("ready");
      this.emit("open");
    });
  }
  write(chunk, encodingOrCallback, callback) {
    if (this.#destroyed || this.#finished) {
      const err = new Error("write after end");
      if (callback) callback(err);
      else if (typeof encodingOrCallback === "function") encodingOrCallback(err);
      return false;
    }
    let encoding = this.#encoding;
    let cb = callback;
    if (typeof encodingOrCallback === "function") {
      cb = encodingOrCallback;
    } else if (encodingOrCallback) {
      encoding = encodingOrCallback;
    }
    const buffer = typeof chunk === "string" ? Buffer.from(chunk, encoding) : chunk;
    this.#writeQueue.push(buffer);
    const totalQueued = this.#writeQueue.reduce((sum, b) => sum + b.length, 0);
    this.#needsDrain = totalQueued >= this.#highWaterMark;
    this.#processQueue(cb);
    return !this.#needsDrain;
  }
  async #processQueue(callback) {
    if (this.#writing || this.#writeQueue.length === 0) {
      if (callback) callback(null);
      return;
    }
    this.#writing = true;
    try {
      while (this.#writeQueue.length > 0 && !this.#destroyed) {
        const buffer = this.#writeQueue.shift();
        if (!writeFileFn || !appendFileFn) {
          throw new Error("WriteStream write function not initialized");
        }
        if (this.#isFirstWrite && this.flags === "w") {
          await writeFileFn(this.path, buffer, { flag: "w", start: this.start });
          this.#isFirstWrite = false;
        } else {
          await appendFileFn(this.path, buffer);
        }
        this.bytesWritten += buffer.length;
      }
      if (callback) callback(null);
      if (this.#needsDrain) {
        this.#needsDrain = false;
        this.emit("drain");
      }
    } catch (err) {
      if (callback) callback(err);
      this.emit("error", err);
      if (this.autoClose) {
        this.destroy();
      }
    }
    this.#writing = false;
  }
  end(chunkOrCallback, encodingOrCallback, callback) {
    if (this.#finished) return this;
    let chunk;
    let cb;
    if (typeof chunkOrCallback === "function") {
      cb = chunkOrCallback;
    } else if (chunkOrCallback !== void 0) {
      chunk = chunkOrCallback;
      if (typeof encodingOrCallback === "function") {
        cb = encodingOrCallback;
      } else {
        cb = callback;
      }
    }
    const finish = () => {
      this.#finished = true;
      this.emit("finish");
      if (this.autoClose) {
        this.destroy();
      }
      if (cb) cb();
    };
    if (chunk !== void 0) {
      this.write(chunk, () => {
        this.#processQueue().then(finish);
      });
    } else {
      this.#processQueue().then(finish);
    }
    return this;
  }
  setDefaultEncoding(encoding) {
    this.#encoding = encoding;
    return this;
  }
  cork() {
  }
  uncork() {
  }
  destroy(error) {
    if (this.#destroyed) return this;
    this.#destroyed = true;
    if (error) {
      this.emit("error", error);
    }
    this.emit("close");
    return this;
  }
  get destroyed() {
    return this.#destroyed;
  }
  get writable() {
    return !this.#destroyed && !this.#finished;
  }
  get writableEnded() {
    return this.#finished;
  }
  get writableFinished() {
    return this.#finished && this.#writeQueue.length === 0;
  }
  get writableHighWaterMark() {
    return this.#highWaterMark;
  }
  get writableLength() {
    return this.#writeQueue.reduce((sum, b) => sum + b.length, 0);
  }
};

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
var createEINVAL = (syscall, path, message) => {
  const error = new FSError("EINVAL", syscall, path);
  if (message) {
    error.message = `EINVAL: ${message}, ${syscall}${path ? ` '${path}'` : ""}`;
  }
  return error;
};

// src/utils/index.ts
init_buffer_shim_bundled();

// src/utils/validation.ts
init_buffer_shim_bundled();
var VALID_ENCODINGS = /* @__PURE__ */ new Set([
  "ascii",
  "utf8",
  "utf-8",
  "utf16le",
  "utf-16le",
  "ucs2",
  "ucs-2",
  "base64",
  "base64url",
  "latin1",
  "binary",
  // alias for latin1
  "hex"
]);
var VALID_FLAGS = /* @__PURE__ */ new Set([
  "r",
  // Open for reading, error if doesn't exist
  "r+",
  // Open for reading and writing, error if doesn't exist
  "rs",
  // Open for reading synchronously
  "rs+",
  // Open for reading and writing synchronously
  "w",
  // Open for writing, create if doesn't exist, truncate if exists
  "wx",
  // Like 'w' but fails if path exists
  "w+",
  // Open for reading and writing, create/truncate
  "wx+",
  // Like 'w+' but fails if path exists
  "a",
  // Open for appending, create if doesn't exist
  "ax",
  // Like 'a' but fails if path exists
  "a+",
  // Open for reading and appending
  "ax+"
  // Like 'a+' but fails if path exists
]);
var validateEncoding = (encoding, syscall, path) => {
  if (encoding === void 0 || encoding === null) return;
  const normalizedEncoding = encoding.toLowerCase();
  if (!VALID_ENCODINGS.has(normalizedEncoding)) {
    throw createEINVAL(syscall, path, `Unknown encoding: ${encoding}`);
  }
};
var validateFlag = (flag, syscall, path) => {
  if (flag === void 0 || flag === null) return;
  if (!VALID_FLAGS.has(flag)) {
    throw createEINVAL(syscall, path, `Unknown file flag: ${flag}`);
  }
};
var normalizePath = (path) => {
  if (typeof path === "string") {
    return path;
  }
  if (Buffer.isBuffer(path)) {
    return path.toString("utf8");
  }
  if (path instanceof URL) {
    if (path.protocol !== "file:") {
      throw new TypeError(`The URL must be of scheme file. Received ${path.protocol}`);
    }
    return decodeURIComponent(path.pathname);
  }
  throw new TypeError(`The "path" argument must be of type string, Buffer, or URL. Received ${typeof path}`);
};
var PERM_READ = 4;
var PERM_WRITE = 2;
var PERM_EXEC = 1;
var parseSymbolicMode = (symbolicMode, currentMode = 0) => {
  if (/^[0-7]+$/.test(symbolicMode)) {
    return parseInt(symbolicMode, 8);
  }
  let mode = currentMode;
  const clauses = symbolicMode.split(",");
  for (const clause of clauses) {
    const match = clause.match(/^([ugoa]*)([+\-=])([rwxXst]+)$/);
    if (!match) {
      throw new Error(`Invalid symbolic mode: ${clause}`);
    }
    const [, who, op, perms] = match;
    const affectUser = who === "" || who.includes("u") || who.includes("a");
    const affectGroup = who === "" || who.includes("g") || who.includes("a");
    const affectOther = who === "" || who.includes("o") || who.includes("a");
    let bits = 0;
    if (perms.includes("r")) bits |= PERM_READ;
    if (perms.includes("w")) bits |= PERM_WRITE;
    if (perms.includes("x")) bits |= PERM_EXEC;
    if (perms.includes("X")) bits |= PERM_EXEC;
    let mask = 0;
    let value = 0;
    if (affectUser) {
      mask |= 448;
      value |= bits << 6;
    }
    if (affectGroup) {
      mask |= 56;
      value |= bits << 3;
    }
    if (affectOther) {
      mask |= 7;
      value |= bits;
    }
    if (perms.includes("s")) {
      if (affectUser) {
        mask |= 2048;
        value |= 2048;
      }
      if (affectGroup) {
        mask |= 1024;
        value |= 1024;
      }
    }
    if (perms.includes("t")) {
      mask |= 512;
      value |= 512;
    }
    switch (op) {
      case "+":
        mode |= value;
        break;
      case "-":
        mode &= ~value;
        break;
      case "=":
        mode = mode & ~mask | value;
        break;
    }
  }
  return mode;
};
var parseMode = (mode, currentMode = 438) => {
  if (typeof mode === "number") {
    return mode;
  }
  if (typeof mode === "string") {
    return parseSymbolicMode(mode, currentMode);
  }
  throw new TypeError(`Invalid mode type: ${typeof mode}`);
};

// src/polyfill/sync.ts
var requestFn;
var setRequestFn = (fn) => {
  requestFn = fn;
};
var request2 = (method, args) => {
  if (!requestFn) throw new Error("Sync request function not initialized");
  return requestFn(method, args);
};
var CHUNK_THRESHOLD = CHUNK_SIZES.FILE_THRESHOLD;
var CHUNK_SIZE = CHUNK_SIZES.FILE_CHUNK;
var readFileSync = (path, options) => {
  const normalizedPath = normalizePath(path);
  const opts = typeof options === "string" ? { encoding: options } : options;
  validateEncoding(opts?.encoding, "read", normalizedPath);
  validateFlag(opts?.flag, "open", normalizedPath);
  const fileSize = request2("getFileSizeSync", [normalizedPath]);
  if (fileSize <= CHUNK_THRESHOLD) {
    return request2("readFileSync", [normalizedPath, opts]);
  }
  const chunks = [];
  let offset = 0;
  while (offset < fileSize) {
    const chunkLength = Math.min(CHUNK_SIZE, fileSize - offset);
    const chunk = request2("readFileSyncChunk", [normalizedPath, offset, chunkLength]);
    chunks.push(chunk);
    offset += chunkLength;
  }
  const combined = Buffer.concat(chunks);
  if (opts?.encoding) {
    return combined.toString(opts.encoding);
  }
  return combined;
};
var writeFileSync = (path, data, options) => {
  const normalizedPath = normalizePath(path);
  const opts = typeof options === "string" ? { encoding: options } : options;
  validateEncoding(opts?.encoding, "write", normalizedPath);
  validateFlag(opts?.flag, "open", normalizedPath);
  request2("writeFileSync", [normalizedPath, data, opts]);
};
var appendFileSync = (path, data, options) => {
  const normalizedPath = normalizePath(path);
  validateEncoding(options?.encoding, "appendFile", normalizedPath);
  request2("appendFileSync", [normalizedPath, data]);
};
var existsSync = (path) => {
  return request2("existsSync", [path]);
};
var accessSync = (path, mode) => {
  request2("accessSync", [path, mode]);
};
var unlinkSync = (path) => {
  request2("unlinkSync", [path]);
};
var rmSync = (path, options) => {
  request2("rmSync", [path, options]);
};
var mkdirSync = (path, options) => {
  request2("mkdirSync", [path, options]);
};
var rmdirSync = (path, options) => {
  request2("rmdirSync", [path, options]);
};
var readdirSync = (path, options) => {
  return request2("readdirSync", [path, options]);
};
var opendirSync = (path) => {
  return request2("opendirSync", [path]);
};
var statSync = (path, options) => {
  const result = request2("statSync", [path, options]);
  if (options?.bigint) {
    return new BigIntStats(result);
  }
  return new Stats(result);
};
var lstatSync = (path, options) => {
  const result = request2("lstatSync", [path, options]);
  if (options?.bigint) {
    return new BigIntStats(result);
  }
  return new Stats(result);
};
var statfsSync = (path) => {
  return request2("statfsSync", [path]);
};
var globSync = (pattern, options) => {
  return request2("globSync", [pattern, options]);
};
var renameSync = (oldPath, newPath) => {
  request2("renameSync", [oldPath, newPath]);
};
var copyFileSync = (src, dest) => {
  request2("copyFileSync", [src, dest]);
};
var cpSync = (src, dest, options) => {
  request2("cpSync", [src, dest, options]);
};
var truncateSync = (path, len) => {
  request2("truncateSync", [path, len]);
};
var chmodSync = (path, mode) => {
  const normalizedPath = normalizePath(path);
  const numericMode = parseMode(mode);
  request2("chmodSync", [normalizedPath, numericMode]);
};
var chownSync = (path, uid, gid) => {
  request2("chownSync", [path, uid, gid]);
};
var lchmodSync = (path, mode) => {
  const normalizedPath = normalizePath(path);
  const numericMode = parseMode(mode);
  request2("lchmodSync", [normalizedPath, numericMode]);
};
var lchownSync = (path, uid, gid) => {
  request2("lchownSync", [path, uid, gid]);
};
var linkSync = (existingPath, newPath) => {
  request2("linkSync", [existingPath, newPath]);
};
var symlinkSync = (target, path, type) => {
  request2("symlinkSync", [target, path, type]);
};
var readlinkSync = (path) => {
  return request2("readlinkSync", [path]);
};
var realpathSync = (path) => {
  return request2("realpathSync", [path]);
};
var mkdtempSync = (prefix) => {
  return request2("mkdtempSync", [prefix]);
};
var utimesSync = (path, atime, mtime) => {
  request2("utimesSync", [path, atime, mtime]);
};
var lutimesSync = (path, atime, mtime) => {
  request2("lutimesSync", [path, atime, mtime]);
};
var openSync = (path, flags, mode) => {
  const normalizedPath = normalizePath(path);
  validateFlag(flags, "open", normalizedPath);
  return request2("openSync", [normalizedPath, flags, mode]);
};
var closeSync = (fd) => {
  request2("closeSync", [fd]);
};
var readSync = (fd, buffer, offset, length, position) => {
  return request2("readSync", [fd, buffer, offset, length, position]);
};
var writeSync = (fd, buffer, offset, length, position) => {
  return request2("writeSync", [fd, buffer, offset, length, position]);
};
var fstatSync = (fd) => {
  const result = request2("fstatSync", [fd]);
  return new Stats(result);
};
var fsyncSync = (fd) => {
  request2("fsyncSync", [fd]);
};
var fdatasyncSync = (fd) => {
  request2("fdatasyncSync", [fd]);
};
var ftruncateSync = (fd, len) => {
  request2("ftruncateSync", [fd, len]);
};
var fchmodSync = (fd, mode) => {
  const numericMode = parseMode(mode);
  request2("fchmodSync", [fd, numericMode]);
};
var fchownSync = (fd, uid, gid) => {
  request2("fchownSync", [fd, uid, gid]);
};
var futimesSync = (fd, atime, mtime) => {
  request2("futimesSync", [fd, atime, mtime]);
};
var readvSync = (fd, buffers) => {
  return request2("readvSync", [fd, buffers]);
};
var writevSync = (fd, buffers) => {
  return request2("writevSync", [fd, buffers]);
};

// src/polyfill/async.ts
init_buffer_shim_bundled();

// src/config.ts
init_buffer_shim_bundled();
var defaultConfig2 = {
  storageMode: "hybrid",
  logging: {
    enabled: false,
    level: "info",
    console: true,
    buffer: false,
    bufferSize: 1e3
  }
};
var config2 = { ...defaultConfig2, logging: { ...defaultConfig2.logging } };
var initialized2 = false;
function configure(options) {
  if (initialized2 && options.storageMode !== void 0 && options.storageMode !== config2.storageMode) {
    console.warn(
      `[FS Config] storageMode cannot be changed after initialization. Current mode: ${config2.storageMode}, requested: ${options.storageMode}`
    );
    const { storageMode, ...rest } = options;
    options = rest;
  }
  if (options.storageMode !== void 0) {
    config2.storageMode = options.storageMode;
  }
  if (options.logging !== void 0) {
    config2.logging = { ...config2.logging, ...options.logging };
  }
}
function getConfig() {
  return {
    ...config2,
    logging: { ...config2.logging }
  };
}
function getStorageMode() {
  return config2.storageMode;
}

// src/polyfill/async-fd.ts
init_buffer_shim_bundled();
var asyncRequestFn2;
var fireAndForgetFn;
var setFdAsyncRequestFn = (fn) => {
  asyncRequestFn2 = fn;
};
var setFdFireAndForgetFn = (fn) => {
  fireAndForgetFn = fn;
};
var asyncRequest2 = (method, args) => {
  if (!asyncRequestFn2) throw new Error("Async request function not initialized");
  return asyncRequestFn2(method, args);
};
var fireAndForget = (method, args) => {
  if (fireAndForgetFn) fireAndForgetFn(method, args);
};
var open = async (path, flags, mode) => {
  const normalizedPath = normalizePath(path);
  const flag = flags ?? "r";
  validateFlag(flag, "open", normalizedPath);
  const fd = await asyncRequest2("open", [normalizedPath, flag, mode]);
  return new FileHandle(fd);
};
var close = async (fd) => {
  await asyncRequest2("close", [fd]);
  fireAndForget("closeSync", [fd]);
};
var read = async (fd, buffer, offset, length, position) => {
  return asyncRequest2("read", [fd, buffer, offset, length, position]);
};
var write = async (fd, buffer, offset, length, position) => {
  return asyncRequest2("write", [fd, buffer, offset, length, position]);
};
var fstat = async (fd) => {
  return asyncRequest2("fstat", [fd]);
};
var fsync = async (fd) => {
  await asyncRequest2("fsync", [fd]);
  fireAndForget("fsyncSync", [fd]);
};
var fdatasync = async (fd) => {
  await asyncRequest2("fdatasync", [fd]);
  fireAndForget("fdatasyncSync", [fd]);
};
var ftruncate = async (fd, len) => {
  await asyncRequest2("ftruncate", [fd, len]);
  fireAndForget("ftruncateSync", [fd, len]);
};
var fchmod = async (fd, mode) => {
  const numericMode = parseMode(mode);
  await asyncRequest2("fchmod", [fd, numericMode]);
  fireAndForget("fchmodSync", [fd, numericMode]);
};
var fchown = async (fd, uid, gid) => {
  await asyncRequest2("fchown", [fd, uid, gid]);
  fireAndForget("fchownSync", [fd, uid, gid]);
};
var futimes = async (fd, atime, mtime) => {
  await asyncRequest2("futimes", [fd, atime, mtime]);
  fireAndForget("futimesSync", [fd, atime, mtime]);
};
var readv = async (fd, buffers) => {
  return asyncRequest2("readv", [fd, buffers]);
};
var writev = async (fd, buffers) => {
  return asyncRequest2("writev", [fd, buffers]);
};

// src/polyfill/async-watch.ts
init_buffer_shim_bundled();
var asyncRequestFn3;
var syncRequestFn;
var setWatchAsyncRequestFn = (fn) => {
  asyncRequestFn3 = fn;
};
var setWatchSyncRequestFn = (fn) => {
  syncRequestFn = fn;
};
var asyncRequest3 = (method, args) => {
  if (!asyncRequestFn3) throw new Error("Async request function not initialized");
  return asyncRequestFn3(method, args);
};
var stat = async (path, options) => {
  const result = await asyncRequest3("stat", [path, options]);
  return new Stats(result);
};
var watch = (path, options, listener) => {
  const actualListener = typeof options === "function" ? options : listener;
  const actualOptions = typeof options === "object" ? options : void 0;
  const listeners = /* @__PURE__ */ new Map();
  const watcher = {
    close: () => {
      asyncRequest3("watch", [path, { ...actualOptions, close: true }]).catch(() => {
      });
      listeners.clear();
    },
    on: (event, fn) => {
      if (!listeners.has(event)) listeners.set(event, /* @__PURE__ */ new Set());
      listeners.get(event).add(fn);
      return watcher;
    }
  };
  asyncRequest3("watch", [path, actualOptions]).then(() => {
  }).catch((err) => {
    const errorListeners = listeners.get("error");
    if (errorListeners) {
      errorListeners.forEach((fn) => fn(err));
    }
  });
  if (actualListener) {
    watcher.on("change", actualListener);
  }
  return watcher;
};
var watchFileListeners = /* @__PURE__ */ new Map();
var watchFile = (filename, optionsOrListener, listener) => {
  let options = {};
  let callback;
  if (typeof optionsOrListener === "function") {
    callback = optionsOrListener;
  } else if (optionsOrListener) {
    options = optionsOrListener;
    callback = listener;
  }
  if (!callback) return;
  const path = String(filename);
  const interval = options.interval ?? 5007;
  if (!watchFileListeners.has(path)) {
    watchFileListeners.set(path, /* @__PURE__ */ new Map());
  }
  let prevStats = null;
  const timer = setInterval(async () => {
    try {
      const currStats = await stat(path, { bigint: options.bigint });
      if (prevStats && (prevStats.mtimeMs !== currStats.mtimeMs || prevStats.size !== currStats.size)) {
        callback(currStats, prevStats);
      }
      prevStats = currStats;
    } catch {
      const emptyStats = { size: 0, mtimeMs: 0 };
      if (prevStats) {
        callback(emptyStats, prevStats);
      }
      prevStats = emptyStats;
    }
  }, interval);
  if (!options.persistent && timer.unref) {
    timer.unref();
  }
  watchFileListeners.get(path).set(callback, timer);
};
var unwatchFile = (filename, listener) => {
  const path = String(filename);
  const listeners = watchFileListeners.get(path);
  if (!listeners) return;
  if (listener) {
    const timer = listeners.get(listener);
    if (timer) {
      clearInterval(timer);
      listeners.delete(listener);
    }
    if (listeners.size === 0) {
      watchFileListeners.delete(path);
    }
  } else {
    for (const timer of listeners.values()) {
      clearInterval(timer);
    }
    watchFileListeners.delete(path);
  }
};
var createReadStream = (path, options) => {
  const opts = typeof options === "string" ? { encoding: options } : options ?? {};
  return new ReadStream(String(path), opts);
};
var createWriteStream = (path, options) => {
  const opts = typeof options === "string" ? { encoding: options } : options ?? {};
  return new WriteStream(String(path), opts);
};
var vfsLoad = async () => {
  if (!syncRequestFn) throw new Error("Sync request function not initialized");
  syncRequestFn("vfsLoad", []);
};
var vfsExtract = async () => {
  if (!syncRequestFn) throw new Error("Sync request function not initialized");
  syncRequestFn("vfsExtract", []);
};

// src/polyfill/async.ts
var asyncRequestFn4;
var fireAndForgetFn2;
var syncRequestFn2;
var setAsyncRequestFn = (fn) => {
  asyncRequestFn4 = fn;
  setReadStreamReadFn(async (path, options) => {
    return asyncRequest4("readFile", [path, options]);
  });
  setReadStreamChunkFn(async (path, start, end) => {
    return asyncRequest4("readFileChunk", [path, start, end]);
  });
  setReadStreamSizeFn(async (path) => {
    return asyncRequest4("getFileSize", [path]);
  });
  setWriteStreamWriteFn(async (path, data, options) => {
    await asyncRequest4("writeFile", [path, data, options]);
  });
  setWriteStreamAppendFn(async (path, data) => {
    await asyncRequest4("appendFile", [path, data]);
  });
  setFileHandleAsyncRequestFn(fn);
  setFdAsyncRequestFn(fn);
  setWatchAsyncRequestFn(fn);
};
var setFireAndForgetFn = (fn) => {
  fireAndForgetFn2 = fn;
  setFdFireAndForgetFn(fn);
};
var setSyncRequestFn = (fn) => {
  syncRequestFn2 = fn;
  setWatchSyncRequestFn(fn);
};
var asyncRequest4 = (method, args) => {
  if (getStorageMode() === "vfs-only") {
    if (!syncRequestFn2) throw new Error("Sync request function not initialized");
    return Promise.resolve().then(() => syncRequestFn2(method, args));
  }
  if (!asyncRequestFn4) throw new Error("Async request function not initialized");
  return asyncRequestFn4(method, args);
};
var fireAndForget2 = (method, args) => {
  const mode = getStorageMode();
  if (mode === "opfs-only" || mode === "vfs-only") return;
  if (fireAndForgetFn2) fireAndForgetFn2(method, args);
};
var checkAborted = (signal) => {
  if (signal?.aborted) {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    error.code = "ABORT_ERR";
    throw error;
  }
};
var withAbortSignal = async (promise, signal) => {
  checkAborted(signal);
  if (!signal) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        error.code = "ABORT_ERR";
        reject(error);
      }, { once: true });
    })
  ]);
};
var readFile = async (path, options) => {
  const normalizedPath = normalizePath(path);
  const opts = typeof options === "string" ? { encoding: options } : options;
  validateEncoding(opts?.encoding, "read", normalizedPath);
  validateFlag(opts?.flag, "open", normalizedPath);
  return withAbortSignal(
    asyncRequest4("readFile", [normalizedPath, opts]),
    opts?.signal
  );
};
var writeFile = async (path, data, options) => {
  const normalizedPath = normalizePath(path);
  const opts = typeof options === "string" ? { encoding: options } : options;
  validateEncoding(opts?.encoding, "write", normalizedPath);
  validateFlag(opts?.flag, "open", normalizedPath);
  await withAbortSignal(
    asyncRequest4("writeFile", [normalizedPath, data, opts]),
    opts?.signal
  );
  fireAndForget2("writeFileSync", [normalizedPath, data, opts]);
};
var appendFile = async (path, data, options) => {
  const normalizedPath = normalizePath(path);
  validateEncoding(options?.encoding, "appendFile", normalizedPath);
  await withAbortSignal(
    asyncRequest4("appendFile", [normalizedPath, data]),
    options?.signal
  );
  fireAndForget2("appendFileSync", [normalizedPath, data]);
};
function exists(path, callback) {
  const promise = asyncRequest4("exists", [path]);
  if (callback) {
    promise.then((result) => callback(result), () => callback(false));
    return;
  }
  return promise;
}
var access = async (path, mode) => {
  await asyncRequest4("access", [path, mode]);
};
var unlink = async (path) => {
  await asyncRequest4("unlink", [path]);
  fireAndForget2("unlinkSync", [path]);
};
var rm = async (path, options) => {
  await asyncRequest4("rm", [path, options]);
  fireAndForget2("rmSync", [path, options]);
};
var mkdir = async (path, options) => {
  await asyncRequest4("mkdir", [path, options]);
  fireAndForget2("mkdirSync", [path, options]);
};
var rmdir = async (path, options) => {
  await asyncRequest4("rmdir", [path, options]);
  fireAndForget2("rmdirSync", [path, options]);
};
var readdir = async (path, options) => {
  return asyncRequest4("readdir", [path, options]);
};
var opendir = async (path) => {
  const pathStr = String(path).replace(/^\/+|\/+$/g, "");
  const entries2 = await asyncRequest4("readdir", [path, { withFileTypes: true }]);
  return new Dir({ path: pathStr, entries: entries2 });
};
var stat2 = async (path, options) => {
  const result = await asyncRequest4("stat", [path, options]);
  if (options?.bigint) {
    return new BigIntStats(result);
  }
  return new Stats(result);
};
var lstat = async (path, options) => {
  const result = await asyncRequest4("lstat", [path, options]);
  if (options?.bigint) {
    return new BigIntStats(result);
  }
  return new Stats(result);
};
var statfs = async (path) => {
  return asyncRequest4("statfs", [path]);
};
async function* glob(pattern, options) {
  const results = await asyncRequest4("glob", [pattern, options]);
  for (const result of results) {
    yield result;
  }
}
var rename = async (oldPath, newPath) => {
  await asyncRequest4("rename", [oldPath, newPath]);
  fireAndForget2("renameSync", [oldPath, newPath]);
};
var copyFile = async (src, dest, mode) => {
  await asyncRequest4("copyFile", [src, dest, mode]);
  fireAndForget2("copyFileSync", [src, dest, mode]);
};
var cp = async (src, dest, options) => {
  await withAbortSignal(asyncRequest4("cp", [src, dest, options]), options?.signal);
  fireAndForget2("cpSync", [src, dest, options]);
};
var truncate = async (path, len) => {
  await asyncRequest4("truncate", [path, len]);
  fireAndForget2("truncateSync", [path, len]);
};
var chmod = async (path, mode) => {
  const normalizedPath = normalizePath(path);
  const numericMode = parseMode(mode);
  await asyncRequest4("chmod", [normalizedPath, numericMode]);
  fireAndForget2("chmodSync", [normalizedPath, numericMode]);
};
var chown = async (path, uid, gid) => {
  await asyncRequest4("chown", [path, uid, gid]);
  fireAndForget2("chownSync", [path, uid, gid]);
};
var lchmod = async (path, mode) => {
  const normalizedPath = normalizePath(path);
  const numericMode = parseMode(mode);
  await asyncRequest4("lchmod", [normalizedPath, numericMode]);
  fireAndForget2("lchmodSync", [normalizedPath, numericMode]);
};
var lchown = async (path, uid, gid) => {
  await asyncRequest4("lchown", [path, uid, gid]);
  fireAndForget2("lchownSync", [path, uid, gid]);
};
var link = async (existingPath, newPath) => {
  await asyncRequest4("link", [existingPath, newPath]);
  fireAndForget2("linkSync", [existingPath, newPath]);
};
var symlink = async (target, path, type) => {
  await asyncRequest4("symlink", [target, path, type]);
  fireAndForget2("symlinkSync", [target, path, type]);
};
var readlink = async (path) => {
  return asyncRequest4("readlink", [path]);
};
var realpath = async (path) => {
  return asyncRequest4("realpath", [path]);
};
var mkdtemp = async (prefix) => {
  return asyncRequest4("mkdtemp", [prefix]);
};
var utimes = async (path, atime, mtime) => {
  await asyncRequest4("utimes", [path, atime, mtime]);
  fireAndForget2("utimesSync", [path, atime, mtime]);
};
var lutimes = async (path, atime, mtime) => {
  await asyncRequest4("lutimes", [path, atime, mtime]);
  fireAndForget2("lutimesSync", [path, atime, mtime]);
};

// src/utils/tab-tracker.ts
init_buffer_shim_bundled();
var TAB_CHANNEL = "fs_tab_channel";
var TAB_LOCK_PREFIX = "fs_tab_";
var tabId;
var lockId;
var channel = null;
var callbacks = null;
var isPrimary = false;
var trackedTabs = /* @__PURE__ */ new Map();
function generateTabId() {
  return Math.random().toString(36).substr(2, 9) + "-" + Date.now().toString(36);
}
function initTabTracker() {
  tabId = generateTabId();
  lockId = TAB_LOCK_PREFIX + tabId;
  navigator.locks.request(lockId, { mode: "exclusive" }, () => {
    return new Promise(() => {
    });
  });
  channel = new BroadcastChannel(TAB_CHANNEL);
  channel.onmessage = handleBroadcast;
  console.log(`[TabTracker] Initialized with tabId: ${tabId}`);
  return tabId;
}
function setTabTrackerCallbacks(cbs) {
  callbacks = cbs;
}
function becomePrimary() {
  isPrimary = true;
  console.log("[TabTracker] Becoming primary, broadcasting...");
  channel?.postMessage({ type: "new-primary", tabId });
}
function announceToCurrentPrimary() {
  if (isPrimary) return;
  console.log("[TabTracker] Announcing to primary...");
  channel?.postMessage({ type: "secondary-announce", tabId, lockId });
}
function handleBroadcast(event) {
  const { type, tabId: senderTabId, lockId: senderLockId } = event.data;
  if (type === "new-primary") {
    console.log(`[TabTracker] New primary announced: ${senderTabId}`);
    if (!isPrimary && senderTabId !== tabId) {
      setTimeout(() => {
        channel?.postMessage({ type: "secondary-announce", tabId, lockId });
      }, 100);
    }
    callbacks?.onPrimaryChanged();
  }
  if (type === "secondary-announce" && isPrimary) {
    console.log(`[TabTracker] Secondary announced: ${senderTabId}`);
    if (senderTabId === tabId) return;
    if (trackedTabs.has(senderTabId)) return;
    const tabInfo = { tabId: senderTabId, lockId: senderLockId };
    monitorSecondaryLock(tabInfo);
    callbacks?.onSecondaryConnected(tabInfo);
  }
  if (type === "request-announce" && !isPrimary) {
    channel?.postMessage({ type: "secondary-announce", tabId, lockId });
  }
}
function monitorSecondaryLock(tab) {
  const abortController = new AbortController();
  trackedTabs.set(tab.tabId, { tab, abortController });
  console.log(`[TabTracker] Monitoring lock for tab: ${tab.tabId}`);
  navigator.locks.request(
    tab.lockId,
    { mode: "exclusive", signal: abortController.signal },
    () => {
      console.log(`[TabTracker] Tab ${tab.tabId} disconnected (lock released)`);
      trackedTabs.delete(tab.tabId);
      callbacks?.onSecondaryDisconnected(tab);
      return Promise.resolve();
    }
  ).catch((err) => {
    if (err.name !== "AbortError") {
      console.error(`[TabTracker] Error monitoring lock for ${tab.tabId}:`, err);
    }
  });
}
function requestAllAnnounce() {
  channel?.postMessage({ type: "request-announce" });
}
function getTabId() {
  return tabId;
}

// src/fs.sab-utils.ts
init_buffer_shim_bundled();
var SYNC_STATUS_OFFSET = SAB_OFFSETS.STATUS;
var SYNC_LENGTH_OFFSET = SAB_OFFSETS.LENGTH;
var SYNC_TYPE_OFFSET = SAB_OFFSETS.TYPE;
var SYNC_DATA_OFFSET = SAB_OFFSETS.DATA_FS;
var STATUS_IDLE = SAB_STATUS.IDLE;
var STATUS_REQUEST = SAB_STATUS.REQUEST;
var STATUS_RESPONSE = SAB_STATUS.RESPONSE;
var STATUS_ERROR = SAB_STATUS.ERROR;
var REQUEST_TYPE_JSON = SAB_TYPE.REQUEST_JSON;
var REQUEST_TYPE_BINARY_ARG = SAB_TYPE.REQUEST_BINARY_ARG;
var RESPONSE_TYPE_JSON = SAB_TYPE.RESPONSE_JSON;
var RESPONSE_TYPE_BINARY = SAB_TYPE.RESPONSE_BINARY;
var SYNC_SAB_SIZE = SAB_SIZES.FS_SYNC;
var EVENTS_SAB_SIZE = SAB_SIZES.FS_EVENTS;
var FS_LOCK_OFFSET = SAB_OFFSETS.FS_LOCK;
var FS_PRIMARY_LOCK = LOCKS.FS_PRIMARY;
var syncEncoder = new TextEncoder();
function acquireSabLock(sab, isWorkerThread) {
  const lockArray = new Int32Array(sab, FS_LOCK_OFFSET, 1);
  while (true) {
    if (Atomics.compareExchange(lockArray, 0, 0, 1) === 0) {
      return;
    }
    if (isWorkerThread) {
      Atomics.wait(lockArray, 0, 1, 5);
    }
  }
}
function releaseSabLock(sab) {
  const lockArray = new Int32Array(sab, FS_LOCK_OFFSET, 1);
  Atomics.store(lockArray, 0, 0);
  Atomics.notify(lockArray, 0, 1);
}
function writeSyncRequest(sab, method, args) {
  const typeView = new Uint8Array(sab, SYNC_TYPE_OFFSET, 1);
  const lengthView = new DataView(sab, SYNC_LENGTH_OFFSET, 4);
  let bufferArgIndex = -1;
  let bufferData = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (Buffer.isBuffer(arg)) {
      bufferArgIndex = i;
      bufferData = new Uint8Array(arg);
      break;
    }
    if (arg instanceof Uint8Array) {
      bufferArgIndex = i;
      bufferData = arg;
      break;
    }
  }
  if (bufferArgIndex >= 0 && bufferData) {
    const processedArgs = args.slice();
    processedArgs[bufferArgIndex] = null;
    const jsonBytes = syncEncoder.encode(JSON.stringify({ method, args: processedArgs }));
    typeView[0] = REQUEST_TYPE_BINARY_ARG;
    const headerView = new DataView(sab, SYNC_DATA_OFFSET, 5);
    headerView.setUint32(0, jsonBytes.length);
    headerView.setUint8(4, bufferArgIndex);
    new Uint8Array(sab, SYNC_DATA_OFFSET + 5, jsonBytes.length).set(jsonBytes);
    new Uint8Array(sab, SYNC_DATA_OFFSET + 5 + jsonBytes.length, bufferData.length).set(bufferData);
    lengthView.setUint32(0, 5 + jsonBytes.length + bufferData.length);
  } else {
    const jsonBytes = syncEncoder.encode(JSON.stringify({ method, args }));
    typeView[0] = REQUEST_TYPE_JSON;
    new Uint8Array(sab, SYNC_DATA_OFFSET, jsonBytes.length).set(jsonBytes);
    lengthView.setUint32(0, jsonBytes.length);
  }
}
function readSyncResponse(sab) {
  const lengthView = new DataView(sab, SYNC_LENGTH_OFFSET, 4);
  const decoder = new TextDecoder();
  const status = Atomics.load(new Int32Array(sab, SYNC_STATUS_OFFSET, 1), 0);
  const responseType = new Uint8Array(sab, SYNC_TYPE_OFFSET, 1)[0];
  const responseLength = lengthView.getUint32(0);
  Atomics.store(new Int32Array(sab, SYNC_STATUS_OFFSET, 1), 0, STATUS_IDLE);
  if (responseType === RESPONSE_TYPE_BINARY) {
    if (status === STATUS_ERROR) throw new Error("Unexpected binary error response");
    const binaryData = new Uint8Array(sab, SYNC_DATA_OFFSET, responseLength);
    return Buffer.from(binaryData.slice());
  }
  const responseData = new Uint8Array(sab, SYNC_DATA_OFFSET, responseLength).slice();
  const response = JSON.parse(decoder.decode(responseData));
  if (status === STATUS_ERROR) {
    const err = new Error(response.error);
    err.code = response.code;
    err.errno = response.errno;
    err.syscall = response.syscall;
    err.path = response.path;
    throw err;
  }
  return response.result;
}
function extractTransferables(value) {
  const transferables = [];
  if (value instanceof ArrayBuffer) {
    transferables.push(value);
  } else if (value instanceof Uint8Array || value instanceof Int8Array || value instanceof Uint16Array || value instanceof Int16Array || value instanceof Uint32Array || value instanceof Int32Array || value instanceof Float32Array || value instanceof Float64Array) {
    transferables.push(value.buffer);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      transferables.push(...extractTransferables(item));
    }
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      transferables.push(...extractTransferables(value[key]));
    }
  }
  return transferables;
}

// src/fs.primary.ts
init_buffer_shim_bundled();

// src/utils/sab-persistence.ts
init_buffer_shim_bundled();
var DB_NAME = "fs_sab_store";
var DB_VERSION = 1;
var STORE_NAME = "sab_data";
var EVENTS_KEY = "events_sab";
var SYNC_KEY = "sync_sab";
var EVENTS_FORMAT_VERSION = 2;
var SYNC_FORMAT_VERSION = 1;
var db = null;
async function initSabPersistence() {
  return new Promise((resolve, reject) => {
    const request4 = indexedDB.open(DB_NAME, DB_VERSION);
    request4.onerror = () => {
      console.error("[SAB Persistence] Failed to open IndexedDB:", request4.error);
      reject(request4.error);
    };
    request4.onsuccess = () => {
      db = request4.result;
      console.log("[SAB Persistence] IndexedDB opened");
      resolve();
    };
    request4.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
        console.log("[SAB Persistence] Created object store");
      }
    };
  });
}
async function saveEventsSab(sab) {
  if (!db) {
    console.warn("[SAB Persistence] DB not initialized, skipping save");
    return;
  }
  const data = new Uint8Array(sab).slice().buffer;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request4 = store.put({
      data,
      timestamp: Date.now(),
      size: data.byteLength,
      formatVersion: EVENTS_FORMAT_VERSION
    }, EVENTS_KEY);
    request4.onerror = () => {
      console.error("[SAB Persistence] Failed to save events:", request4.error);
      reject(request4.error);
    };
    request4.onsuccess = () => {
      console.log(`[SAB Persistence] Saved events SAB (${(data.byteLength / 1024).toFixed(1)}KB)`);
      resolve();
    };
  });
}
async function saveSyncSab(sab) {
  if (!db) {
    console.warn("[SAB Persistence] DB not initialized, skipping save");
    return;
  }
  const data = new Uint8Array(sab).slice().buffer;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request4 = store.put({
      data,
      timestamp: Date.now(),
      size: data.byteLength,
      formatVersion: SYNC_FORMAT_VERSION
    }, SYNC_KEY);
    request4.onerror = () => {
      console.error("[SAB Persistence] Failed to save sync:", request4.error);
      reject(request4.error);
    };
    request4.onsuccess = () => {
      console.log(`[SAB Persistence] Saved sync SAB (${(data.byteLength / 1024).toFixed(1)}KB)`);
      resolve();
    };
  });
}
async function loadEventsSab(targetSab) {
  if (!db) {
    try {
      await initSabPersistence();
    } catch {
      return false;
    }
  }
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request4 = store.get(EVENTS_KEY);
    request4.onerror = () => {
      console.error("[SAB Persistence] Failed to load events:", request4.error);
      reject(request4.error);
    };
    request4.onsuccess = () => {
      const result = request4.result;
      if (result && result.data) {
        if (result.formatVersion !== EVENTS_FORMAT_VERSION) {
          console.log(`[SAB Persistence] Events SAB format version mismatch (stored: ${result.formatVersion}, current: ${EVENTS_FORMAT_VERSION}) - starting fresh`);
          resolve(false);
          return;
        }
        const storedData = new Uint8Array(result.data);
        const targetView = new Uint8Array(targetSab);
        const copyLength = Math.min(storedData.length, targetView.length);
        targetView.set(storedData.subarray(0, copyLength));
        console.log(`[SAB Persistence] Loaded events SAB (${(copyLength / 1024).toFixed(1)}KB) from ${new Date(result.timestamp).toISOString()}`);
        resolve(true);
      } else {
        console.log("[SAB Persistence] No saved events data found");
        resolve(false);
      }
    };
  });
}
async function loadSyncSab(targetSab) {
  if (!db) {
    try {
      await initSabPersistence();
    } catch {
      return false;
    }
  }
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request4 = store.get(SYNC_KEY);
    request4.onerror = () => {
      console.error("[SAB Persistence] Failed to load sync:", request4.error);
      reject(request4.error);
    };
    request4.onsuccess = () => {
      const result = request4.result;
      if (result && result.data) {
        if (result.formatVersion !== SYNC_FORMAT_VERSION) {
          console.log(`[SAB Persistence] Sync SAB format version mismatch (stored: ${result.formatVersion}, current: ${SYNC_FORMAT_VERSION}) - starting fresh`);
          resolve(false);
          return;
        }
        const storedData = new Uint8Array(result.data);
        const targetView = new Uint8Array(targetSab);
        const copyLength = Math.min(storedData.length, targetView.length);
        targetView.set(storedData.subarray(0, copyLength));
        console.log(`[SAB Persistence] Loaded sync SAB (${(copyLength / 1024).toFixed(1)}KB) from ${new Date(result.timestamp).toISOString()}`);
        resolve(true);
      } else {
        console.log("[SAB Persistence] No saved sync data found");
        resolve(false);
      }
    };
  });
}

// src/fs.primary.ts
var syncSAB = null;
var eventsSAB2 = null;
var syncWorker = null;
var syncWorkerReady = false;
var isPrimaryTab = false;
var readyResolve = null;
var readyReject = null;
var activeServiceWorker = null;
function setActiveServiceWorker(sw) {
  activeServiceWorker = sw;
}
function getActiveServiceWorker() {
  return activeServiceWorker;
}
var connectedSecondaries = /* @__PURE__ */ new Set();
var secondaryPorts = /* @__PURE__ */ new Map();
var fireAndForgetBuffer = [];
var sabSaveTimeout = null;
var SAB_SAVE_DEBOUNCE_MS = 2e3;
function setReadyCallbacks(resolve, reject) {
  readyResolve = resolve;
  readyReject = reject;
}
function getSyncSAB() {
  return syncSAB;
}
function getEventsSAB() {
  return eventsSAB2;
}
function getSyncWorkerReady() {
  return syncWorkerReady;
}
function getIsPrimaryTab() {
  return isPrimaryTab;
}
function getSyncWorker() {
  return syncWorker;
}
function initPrimarySyncWorker() {
  console.log("[FS] Creating sync worker (primary tab)...");
  syncWorker = new Worker(new URL("./fs.sync.worker.js", import.meta.url), { type: "module" });
  syncWorker.onmessage = (e) => {
    console.log("[FS] Sync worker message:", e.data.type);
    if (e.data.type === "initialized") {
      syncWorkerReady = true;
      console.log("[FS] FS polyfill ready (primary)!");
      flushFireAndForgetBuffer();
      readyResolve?.();
    }
  };
  syncWorker.onerror = (e) => {
    console.error("[FS] Sync worker error:", e);
    readyReject?.(new Error(`Sync worker error: ${e.message}`));
  };
  syncWorker.postMessage({ type: "init", syncSAB, eventsSAB: eventsSAB2, storageMode: getStorageMode() });
  setSharedArrayBuffer(eventsSAB2);
}
async function createSABsAndInitPrimary() {
  console.log("[FS] Creating SABs as primary tab...");
  try {
    syncSAB = new SharedArrayBuffer(SYNC_SAB_SIZE);
    eventsSAB2 = new SharedArrayBuffer(EVENTS_SAB_SIZE);
    console.log("[FS] SABs created:", { syncSize: SYNC_SAB_SIZE, eventsSize: EVENTS_SAB_SIZE });
    try {
      console.log("[FS] Initializing SAB persistence...");
      await initSabPersistence();
      const [syncLoaded, eventsLoaded] = await Promise.all([
        loadSyncSab(syncSAB),
        loadEventsSab(eventsSAB2)
      ]);
      if (syncLoaded || eventsLoaded) {
        console.log("[FS] Restored persisted SAB data:", { syncLoaded, eventsLoaded });
      }
    } catch (err) {
      console.warn("[FS] Could not restore persisted SAB data:", err);
    }
    const statusArray = new Int32Array(syncSAB, SYNC_STATUS_OFFSET, 1);
    Atomics.store(statusArray, 0, STATUS_IDLE);
    isPrimaryTab = true;
    initPrimarySyncWorker();
  } catch (err) {
    const msg = `Failed to create SharedArrayBuffer: ${err.message}. Make sure the page is cross-origin isolated.`;
    console.error("[FS]", msg);
    readyReject?.(new Error(msg));
  }
}
function scheduleSabPersist() {
  if (!isPrimaryTab || !syncSAB || !eventsSAB2) return;
  if (sabSaveTimeout) clearTimeout(sabSaveTimeout);
  sabSaveTimeout = setTimeout(async () => {
    console.log("[FS] Persisting SAB data to IndexedDB...");
    try {
      await Promise.all([saveSyncSab(syncSAB), saveEventsSab(eventsSAB2)]);
      console.log("[FS] SAB data persisted successfully");
    } catch (err) {
      console.warn("[FS] Failed to persist SAB data:", err);
    }
  }, SAB_SAVE_DEBOUNCE_MS);
}
function primaryExecuteSync(method, args) {
  if (!syncSAB || !syncWorkerReady) throw new Error("Primary not ready");
  acquireSabLock(syncSAB, false);
  try {
    const statusArray = new Int32Array(syncSAB, SYNC_STATUS_OFFSET, 1);
    writeSyncRequest(syncSAB, method, args);
    Atomics.store(statusArray, 0, STATUS_REQUEST);
    Atomics.notify(statusArray, 0);
    while (Atomics.load(statusArray, 0) === STATUS_REQUEST) {
    }
    return readSyncResponse(syncSAB);
  } finally {
    releaseSabLock(syncSAB);
  }
}
function handleSecondaryFsRequest(port, requestId, method, args) {
  console.log(`[FS Primary] Request: ${method}`);
  try {
    const result = primaryExecuteSync(method, args);
    const message = { type: "fs-response", requestId, result };
    const transferables = extractTransferables(result);
    if (transferables.length > 0) port.postMessage(message, transferables);
    else port.postMessage(message);
  } catch (err) {
    const e = err;
    port.postMessage({
      type: "fs-response",
      requestId,
      error: e.message,
      code: e.code,
      errno: e.errno,
      syscall: e.syscall,
      path: e.path
    });
  }
}
function handleVfsReadRequest(requestId, filePath) {
  const sw = activeServiceWorker;
  if (!sw) {
    console.error("[FS Primary] No active service worker for VFS read response");
    return;
  }
  try {
    const content = primaryExecuteSync("readFileSync", [filePath]);
    if (content) {
      const data = content instanceof Uint8Array ? content : new Uint8Array(content);
      sw.postMessage({
        type: "vfs-read-response",
        requestId,
        content: Array.from(data)
        // Convert to array for structured clone
      });
    } else {
      sw.postMessage({
        type: "vfs-read-response",
        requestId,
        content: null
      });
    }
  } catch (err) {
    sw.postMessage({
      type: "vfs-read-response",
      requestId,
      content: null,
      error: err.message
    });
  }
}
function handleSecondaryPort(secondaryClientId, port) {
  console.log(`[FS Primary] Received port from secondary: ${secondaryClientId}`);
  secondaryPorts.set(secondaryClientId, port);
  connectedSecondaries.add(secondaryClientId);
  port.onmessage = (e) => {
    const { type: msgType, requestId, method, args } = e.data;
    if (msgType === "fs-request") {
      handleSecondaryFsRequest(port, requestId, method, args);
    }
  };
  port.postMessage({ type: "connected" });
}
function setupPrimaryServiceWorkerListener() {
  const sw = activeServiceWorker;
  if (sw) {
    const mc = new MessageChannel();
    sw.postMessage({ type: "register-primary" }, [mc.port2]);
    mc.port1.onmessage = (event) => {
      if (event.data.type === "secondary-port") {
        const port = event.ports[0];
        if (port) handleSecondaryPort(event.data.secondaryClientId, port);
      }
    };
    mc.port1.start();
  }
  navigator.serviceWorker.addEventListener("message", (event) => {
    const { type, secondaryClientId, requestId, filePath } = event.data;
    if (type === "vfs-read-request") {
      handleVfsReadRequest(requestId, filePath);
      return;
    }
    if (type === "discover-primary") {
      if (isPrimaryTab) {
        console.log("[FS Primary] Re-registering with ServiceWorker (discover-primary)");
        activeServiceWorker?.postMessage({ type: "register-primary" });
      }
      return;
    }
    if (type === "secondary-port") {
      const port = event.ports[0];
      if (port) handleSecondaryPort(secondaryClientId, port);
    }
  });
  console.log("[FS Primary] Listening for secondary ports via ServiceWorker");
}
function setupTabTrackerCallbacks(reconnectFn) {
  setTabTrackerCallbacks({
    onSecondaryConnected: (tab) => {
      console.log(`[FS Primary] Secondary connected (tab tracker): ${tab.tabId}`);
      connectedSecondaries.add(tab.tabId);
    },
    onSecondaryDisconnected: (tab) => {
      console.log(`[FS Primary] Secondary disconnected: ${tab.tabId}`);
      connectedSecondaries.delete(tab.tabId);
    },
    onPrimaryChanged: () => {
      console.log("[FS] Primary changed notification received");
      if (!isPrimaryTab) {
        console.log("[FS Secondary] Reconnecting to new primary...");
        reconnectFn();
      }
    }
  });
}
function flushFireAndForgetBuffer() {
  if (!syncWorker || !syncWorkerReady || !isPrimaryTab) return;
  while (fireAndForgetBuffer.length > 0) {
    const { method, args } = fireAndForgetBuffer.shift();
    syncWorker.postMessage({ type: "fireAndForget", method, args });
  }
}
function fireAndForget3(method, args) {
  if (!isPrimaryTab) return;
  if (!syncWorker || !syncWorkerReady) {
    fireAndForgetBuffer.push({ method, args });
    return;
  }
  syncWorker.postMessage({ type: "fireAndForget", method, args });
}
function promoteToTruePrimary(relayWorker2) {
  console.log("[FS] Acquired primary lock - promoted to primary!");
  isPrimaryTab = true;
  syncWorkerReady = false;
  if (relayWorker2) {
    relayWorker2.terminate();
  }
  setupPrimaryServiceWorkerListener();
  becomePrimary();
  requestAllAnnounce();
  createSABsAndInitPrimary();
}
function setSABs(sync, events) {
  syncSAB = sync;
  if (events) eventsSAB2 = events;
}
function setWorkerReady(ready) {
  syncWorkerReady = ready;
}
function setIsPrimaryTab(primary) {
  isPrimaryTab = primary;
}

// src/fs.secondary.ts
init_buffer_shim_bundled();
var isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
var secondarySyncSAB = null;
var relayWorker = null;
var relayWorkerReady = false;
var syncSupported = true;
var readyResolve2 = null;
var readyReject2 = null;
var safariPrimaryPort = null;
var safariPendingRequests = /* @__PURE__ */ new Map();
function setReadyCallbacks2(resolve, reject) {
  readyResolve2 = resolve;
  readyReject2 = reject;
}
function getRelayWorker() {
  return relayWorker;
}
function isSyncSupported() {
  return syncSupported;
}
function getSafariPrimaryPort() {
  return safariPrimaryPort;
}
function reconstructClasses(value) {
  if (value === null || value === void 0) return value;
  if (Array.isArray(value)) return value.map(reconstructClasses);
  if (typeof value === "object") {
    const obj = value;
    if (obj.__type === "Dirent") return Dirent.fromJSON(obj);
    if (obj.__type === "Stats") return Stats.fromJSON(obj);
    const result = {};
    for (const key of Object.keys(obj)) result[key] = reconstructClasses(obj[key]);
    return result;
  }
  return value;
}
function initSecondary() {
  console.log("[FS Secondary] Initializing secondary tab...");
  if (isSafari) {
    console.warn("[FS Secondary] Safari detected - sync operations not supported in secondary tabs.");
    syncSupported = false;
    initSecondaryAsyncOnly();
    return;
  }
  try {
    secondarySyncSAB = new SharedArrayBuffer(SYNC_SAB_SIZE);
    console.log("[FS Secondary] Local SAB created");
    const statusArray = new Int32Array(secondarySyncSAB, SYNC_STATUS_OFFSET, 1);
    Atomics.store(statusArray, 0, STATUS_IDLE);
  } catch (err) {
    console.error("[FS Secondary] Failed to create local SAB:", err);
    readyReject2?.(new Error("Failed to create SharedArrayBuffer for secondary tab"));
    return;
  }
  console.log("[FS Secondary] Creating relay worker...");
  relayWorker = new Worker(new URL("./fs.relay.worker.js", import.meta.url), { type: "module" });
  relayWorker.onmessage = (e) => {
    console.log("[FS Secondary] Relay worker message:", e.data.type);
    if (e.data.type === "initialized") {
      relayWorkerReady = true;
      console.log("[FS Secondary] Relay worker ready");
      connectToPrimary();
    }
    if (e.data.type === "primary-disconnected") {
      console.log("[FS Secondary] Primary disconnected notification");
    }
  };
  relayWorker.onerror = (e) => {
    console.error("[FS Secondary] Relay worker error:", e);
    readyReject2?.(new Error(`Relay worker error: ${e.message}`));
  };
  relayWorker.postMessage({ type: "init", syncSAB: secondarySyncSAB, tabId: getTabId() });
}
function initSecondaryAsyncOnly() {
  console.log("[FS Secondary] Initializing in async-only mode (Safari)...");
  const channel2 = new MessageChannel();
  channel2.port1.onmessage = (e) => {
    if (e.data.type === "connected") {
      console.log("[FS Secondary] Connected to primary (async-only mode)!");
      safariPrimaryPort = channel2.port1;
      channel2.port1.onmessage = (event) => {
        const { type, requestId, result, error } = event.data;
        if (type === "fs-response") {
          const pending2 = safariPendingRequests.get(requestId);
          if (pending2) {
            safariPendingRequests.delete(requestId);
            if (error) pending2.reject(new Error(error));
            else pending2.resolve(reconstructClasses(result));
          }
        }
      };
      setWorkerReady(true);
      announceToCurrentPrimary();
      readyResolve2?.();
    }
  };
  getActiveServiceWorker()?.postMessage(
    { type: "request-connection" },
    [channel2.port2]
  );
}
function safariAsyncRequest(method, args) {
  return new Promise((resolve, reject) => {
    if (!safariPrimaryPort) {
      reject(new Error("Not connected to primary"));
      return;
    }
    const requestId = Math.random().toString(36).substr(2, 9);
    safariPendingRequests.set(requestId, { resolve, reject });
    setTimeout(() => {
      if (safariPendingRequests.has(requestId)) {
        safariPendingRequests.delete(requestId);
        reject(new Error("Request timeout"));
      }
    }, 3e4);
    safariPrimaryPort.postMessage({ type: "fs-request", requestId, method, args });
  });
}
function connectToPrimary() {
  console.log("[FS Secondary] Connecting to primary via ServiceWorker...");
  const channel2 = new MessageChannel();
  channel2.port1.onmessage = (e) => {
    if (e.data.type === "connected") {
      console.log("[FS Secondary] Connected to primary!");
      relayWorker?.postMessage({ type: "set-primary-port" }, [channel2.port1]);
      setWorkerReady(true);
      setSABs(secondarySyncSAB, null);
      setIsPrimaryTab(false);
      announceToCurrentPrimary();
      readyResolve2?.();
    }
  };
  getActiveServiceWorker()?.postMessage(
    { type: "request-connection" },
    [channel2.port2]
  );
}
function reconnectToPrimary() {
  console.log("[FS Secondary] Reconnecting to new primary via ServiceWorker...");
  const channel2 = new MessageChannel();
  channel2.port1.onmessage = (e) => {
    if (e.data.type === "connected") {
      console.log("[FS Secondary] Reconnected to new primary!");
      relayWorker?.postMessage({ type: "set-primary-port" }, [channel2.port1]);
      announceToCurrentPrimary();
    }
  };
  getActiveServiceWorker()?.postMessage(
    { type: "request-connection" },
    [channel2.port2]
  );
}

// src/fs.polyfill.ts
var isFirefox = /Firefox/.test(navigator.userAgent);
var syncSupported2 = true;
function reconstructClasses2(value) {
  if (value === null || value === void 0) return value;
  if (Array.isArray(value)) return value.map(reconstructClasses2);
  if (typeof value === "object") {
    const obj = value;
    if (obj.__type === "Dirent") return Dirent.fromJSON(obj);
    if (obj.__type === "Stats") return Stats.fromJSON(obj);
    const result = {};
    for (const key of Object.keys(obj)) result[key] = reconstructClasses2(obj[key]);
    return result;
  }
  return value;
}
var WRITE_METHODS = /* @__PURE__ */ new Set([
  "writeFileSync",
  "appendFileSync",
  "mkdirSync",
  "rmdirSync",
  "unlinkSync",
  "renameSync",
  "copyFileSync",
  "rmSync",
  "truncateSync",
  "chmodSync",
  "chownSync",
  "lchmodSync",
  "lchownSync",
  "linkSync",
  "symlinkSync",
  "utimesSync",
  "lutimesSync",
  "cpSync",
  "mkdtempSync",
  "writeSync",
  "ftruncateSync",
  "fchmodSync",
  "fchownSync",
  "futimesSync",
  "fsyncSync",
  "fdatasyncSync",
  "writevSync"
]);
var isWorkerContext = typeof window === "undefined" || typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope;
console.log("[FS] Cross-origin isolated:", crossOriginIsolated);
if (!crossOriginIsolated) {
  console.warn("[FS] Page is NOT cross-origin isolated. SharedArrayBuffer may not work.");
}
async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/future/fs.service.worker.js");
    const waitForActive = async () => {
      if (reg.active) return reg.active;
      const sw = reg.installing || reg.waiting;
      if (!sw) throw new Error("No service worker found");
      return new Promise((resolve, reject) => {
        const onStateChange = () => {
          if (sw.state === "activated") {
            sw.removeEventListener("statechange", onStateChange);
            resolve(sw);
          } else if (sw.state === "redundant") {
            sw.removeEventListener("statechange", onStateChange);
            reject(new Error("SW redundant"));
          }
        };
        sw.addEventListener("statechange", onStateChange);
      });
    };
    const activeSw = await waitForActive();
    setActiveServiceWorker(activeSw);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (navigator.serviceWorker.controller) {
        setActiveServiceWorker(navigator.serviceWorker.controller);
      }
    });
    return activeSw;
  } catch (err) {
    console.error("[FS] ServiceWorker registration failed:", err);
    return null;
  }
}
async function initializeFS() {
  console.log("[FS] Initializing...");
  if (isWorkerContext) {
    syncSupported2 = false;
    readyResolve3?.();
    return;
  }
  if (!("locks" in navigator)) {
    console.warn("[FS] Web Locks API not supported");
    createSABsAndInitPrimary();
    return;
  }
  initTabTracker();
  console.log(`[FS] Tab ID: ${getTabId()}`);
  setupTabTrackerCallbacks(reconnectToPrimary);
  await registerServiceWorker();
  const lockAcquired = await navigator.locks.request(FS_PRIMARY_LOCK, { ifAvailable: true }, async (lock) => {
    if (lock) {
      console.log("[FS] Acquired primary lock - this tab is primary");
      setupPrimaryServiceWorkerListener();
      becomePrimary();
      createSABsAndInitPrimary();
      await new Promise(() => {
      });
    }
    return lock !== null;
  });
  if (!lockAcquired) {
    console.log("[FS] Primary lock held by another tab - this tab is secondary");
    initSecondary();
    navigator.locks.request(FS_PRIMARY_LOCK, async () => {
      promoteToTruePrimary(getRelayWorker());
      await new Promise(() => {
      });
    });
  }
}
var readyResolve3 = null;
var readyReject3 = null;
var readyPromise = null;
var initStarted = false;
function createReadyPromise() {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise((resolve, reject) => {
    readyResolve3 = resolve;
    readyReject3 = reject;
    setReadyCallbacks(resolve, reject);
    setReadyCallbacks2(resolve, reject);
    setTimeout(() => reject(new Error("FS worker initialization timed out")), 1e4);
  });
  return readyPromise;
}
var whenReady = () => {
  if (!initStarted) throw new Error("FS not initialized. Call fs.init() first.");
  return createReadyPromise();
};
async function init() {
  if (initStarted) return createReadyPromise();
  initStarted = true;
  createReadyPromise();
  console.log("[FS] init() called - starting initialization...");
  initializeFS();
  return readyPromise;
}
var request3 = (method, args) => {
  if (!initStarted) throw new Error("FS not initialized. Call fs.init() first.");
  if (!isSyncSupported()) {
    throw new Error(`Sync fs operations not supported. Use async methods instead: fs.promises.${method.replace("Sync", "")}()`);
  }
  const syncSAB2 = getSyncSAB();
  if (!syncSAB2 || !getSyncWorkerReady()) throw new Error("FS not ready");
  const logHandle = logStart(method, args, "main");
  const statusArray = new Int32Array(syncSAB2, SYNC_STATUS_OFFSET, 1);
  const lengthView = new DataView(syncSAB2, SYNC_LENGTH_OFFSET, 4);
  const decoder = new TextDecoder();
  acquireSabLock(syncSAB2, isWorkerContext);
  try {
    writeSyncRequest(syncSAB2, method, args);
    Atomics.store(statusArray, 0, STATUS_REQUEST);
    Atomics.notify(statusArray, 0);
    let iterations = 0;
    while (Atomics.load(statusArray, 0) === STATUS_REQUEST) {
      if (!isFirefox) continue;
      iterations++;
      if (iterations > 5e4) throw new Error("FS request timeout");
      const xhr = new XMLHttpRequest();
      xhr.open("GET", `data:,${iterations}`, false);
      try {
        xhr.send();
      } catch {
      }
    }
    const status = Atomics.load(statusArray, 0);
    const responseType = new Uint8Array(syncSAB2, SYNC_TYPE_OFFSET, 1)[0];
    const responseLength = lengthView.getUint32(0);
    if (responseLength > SYNC_SAB_SIZE - SYNC_DATA_OFFSET || responseLength < 0) {
      Atomics.store(statusArray, 0, 0);
      throw new Error(`Invalid response length: ${responseLength}`);
    }
    Atomics.store(statusArray, 0, 0);
    if (responseType === RESPONSE_TYPE_BINARY) {
      if (status === STATUS_ERROR) throw new Error("Unexpected binary error");
      logEnd(logHandle, "success");
      if (WRITE_METHODS.has(method)) scheduleSabPersist();
      return Buffer.from(new Uint8Array(syncSAB2, SYNC_DATA_OFFSET, responseLength).slice());
    }
    const response = JSON.parse(decoder.decode(new Uint8Array(syncSAB2, SYNC_DATA_OFFSET, responseLength).slice()));
    if (status === STATUS_ERROR) {
      logEnd(logHandle, "error", response.error);
      const err = new Error(response.error);
      err.code = response.code;
      err.errno = response.errno;
      err.syscall = response.syscall;
      err.path = response.path;
      throw err;
    }
    logEnd(logHandle, "success");
    if (WRITE_METHODS.has(method)) scheduleSabPersist();
    return reconstructClasses2(response.result);
  } catch (err) {
    logEnd(logHandle, "error", err.message);
    throw err;
  } finally {
    releaseSabLock(syncSAB2);
  }
};
var asyncRequestWrapper = (method, args) => {
  if (getIsPrimaryTab()) return request(method, args);
  else if (!isSyncSupported() && getSafariPrimaryPort()) return safariAsyncRequest(method, args);
  else return Promise.resolve(request3(method, args));
};
setRequestFn(request3);
setAsyncRequestFn(asyncRequestWrapper);
setFireAndForgetFn(fireAndForget3);
setSyncRequestFn(request3);
var isReady = getSyncWorkerReady;
var enterDeferredFlushMode = () => {
  getSyncWorker()?.postMessage({ type: "enterDeferredFlush" });
};
var exitDeferredFlushMode = () => {
  getSyncWorker()?.postMessage({ type: "exitDeferredFlush" });
};
var promises = {
  readFile,
  writeFile,
  appendFile,
  exists,
  access,
  unlink,
  rm,
  mkdir,
  rmdir,
  readdir,
  opendir,
  stat: stat2,
  lstat,
  statfs,
  rename,
  copyFile,
  cp,
  truncate,
  chmod,
  chown,
  lchmod,
  lchown,
  link,
  symlink,
  readlink,
  realpath,
  mkdtemp,
  utimes,
  lutimes,
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
  glob,
  watch
};
var logging = {
  enable: () => logger.enable(),
  disable: () => logger.disable(),
  isEnabled: () => logger.isEnabled(),
  setLevel: (l) => logger.setLevel(l),
  setMethods: (m) => logger.setMethods(m),
  setConsole: (e) => logger.setConsole(e),
  setBuffer: (e, s) => logger.setBuffer(e, s),
  getEntries: () => logger.getEntries(),
  clear: () => logger.clear(),
  export: () => logger.export(),
  getConfig: () => logger.getConfig()
};
var fs_polyfill_default = {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  accessSync,
  unlinkSync,
  rmSync,
  mkdirSync,
  rmdirSync,
  readdirSync,
  opendirSync,
  statSync,
  lstatSync,
  statfsSync,
  renameSync,
  copyFileSync,
  cpSync,
  truncateSync,
  chmodSync,
  chownSync,
  lchmodSync,
  lchownSync,
  linkSync,
  symlinkSync,
  readlinkSync,
  realpathSync,
  mkdtempSync,
  utimesSync,
  lutimesSync,
  openSync,
  closeSync,
  readSync,
  writeSync,
  fstatSync,
  fsyncSync,
  fdatasyncSync,
  ftruncateSync,
  fchmodSync,
  fchownSync,
  futimesSync,
  readvSync,
  writevSync,
  globSync,
  readFile,
  writeFile,
  appendFile,
  exists,
  access,
  unlink,
  rm,
  mkdir,
  rmdir,
  readdir,
  opendir,
  stat: stat2,
  lstat,
  statfs,
  rename,
  copyFile,
  cp,
  truncate,
  chmod,
  chown,
  lchmod,
  lchown,
  link,
  symlink,
  readlink,
  realpath,
  mkdtemp,
  utimes,
  lutimes,
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
  watch,
  glob,
  watchFile,
  unwatchFile,
  createReadStream,
  createWriteStream,
  constants,
  promises,
  logging,
  configure,
  getConfig,
  getStorageMode,
  init,
  vfsLoad,
  vfsExtract
};
export {
  BigIntStats,
  COPYFILE_EXCL,
  COPYFILE_FICLONE,
  COPYFILE_FICLONE_FORCE,
  Dir,
  Dirent,
  FSError,
  F_OK,
  FileHandle,
  O_APPEND,
  O_CREAT,
  O_DIRECT,
  O_DIRECTORY,
  O_DSYNC,
  O_EXCL,
  O_NOATIME,
  O_NOCTTY,
  O_NOFOLLOW,
  O_NONBLOCK,
  O_RDONLY,
  O_RDWR,
  O_SYMLINK,
  O_SYNC,
  O_TRUNC,
  O_WRONLY,
  R_OK,
  ReadStream,
  S_IFBLK,
  S_IFCHR,
  S_IFDIR,
  S_IFIFO,
  S_IFLNK,
  S_IFMT,
  S_IFREG,
  S_IFSOCK,
  S_IRGRP,
  S_IROTH,
  S_IRUSR,
  S_IRWXG,
  S_IRWXO,
  S_IRWXU,
  S_ISGID,
  S_ISUID,
  S_ISVTX,
  S_IWGRP,
  S_IWOTH,
  S_IWUSR,
  S_IXGRP,
  S_IXOTH,
  S_IXUSR,
  Stats,
  W_OK,
  WriteStream,
  X_OK,
  access,
  accessSync,
  appendFile,
  appendFileSync,
  chmod,
  chmodSync,
  chown,
  chownSync,
  close,
  closeSync,
  configure,
  constants,
  copyFile,
  copyFileSync,
  cp,
  cpSync,
  createReadStream,
  createWriteStream,
  fs_polyfill_default as default,
  enterDeferredFlushMode,
  exists,
  existsSync,
  exitDeferredFlushMode,
  fchmod,
  fchmodSync,
  fchown,
  fchownSync,
  fdatasync,
  fdatasyncSync,
  fstat,
  fstatSync,
  fsync,
  fsyncSync,
  ftruncate,
  ftruncateSync,
  futimes,
  futimesSync,
  getConfig,
  getEventsSAB,
  getStorageMode,
  getSyncSAB,
  glob,
  globSync,
  init,
  isReady,
  isSyncSupported,
  lchmod,
  lchmodSync,
  lchown,
  lchownSync,
  link,
  linkSync,
  logging,
  lstat,
  lstatSync,
  lutimes,
  lutimesSync,
  mkdir,
  mkdirSync,
  mkdtemp,
  mkdtempSync,
  open,
  openSync,
  opendir,
  opendirSync,
  promises,
  read,
  readFile,
  readFileSync,
  readSync,
  readdir,
  readdirSync,
  readlink,
  readlinkSync,
  readv,
  readvSync,
  realpath,
  realpathSync,
  rename,
  renameSync,
  rm,
  rmSync,
  rmdir,
  rmdirSync,
  scheduleSabPersist,
  setAsyncRequestFn,
  setFireAndForgetFn,
  setRequestFn,
  setSyncRequestFn,
  stat2 as stat,
  statSync,
  statfs,
  statfsSync,
  symlink,
  symlinkSync,
  truncate,
  truncateSync,
  unlink,
  unlinkSync,
  unwatchFile,
  utimes,
  utimesSync,
  vfsExtract,
  vfsLoad,
  watch,
  watchFile,
  whenReady,
  write,
  writeFile,
  writeFileSync,
  writeSync,
  writev,
  writevSync
};
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
//# sourceMappingURL=fs.polyfill.js.map