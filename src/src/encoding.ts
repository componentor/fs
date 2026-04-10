/**
 * Encoding utilities for converting between Uint8Array and strings
 * using Node.js-compatible encodings.
 */

/**
 * Decode a Uint8Array to a string using the specified encoding.
 */
export function decodeBuffer(data: Uint8Array, encoding: string): string {
  switch (encoding) {
    case 'utf8':
    case 'utf-8':
      return new TextDecoder('utf-8').decode(data);

    case 'latin1':
    case 'binary': {
      // Each byte maps directly to a code point 0-255
      let result = '';
      for (let i = 0; i < data.length; i++) {
        result += String.fromCharCode(data[i]);
      }
      return result;
    }

    case 'ascii': {
      // Same as latin1 but mask to 7 bits
      let result = '';
      for (let i = 0; i < data.length; i++) {
        result += String.fromCharCode(data[i] & 0x7f);
      }
      return result;
    }

    case 'base64': {
      let binary = '';
      for (let i = 0; i < data.length; i++) {
        binary += String.fromCharCode(data[i]);
      }
      return btoa(binary);
    }

    case 'hex': {
      let hex = '';
      for (let i = 0; i < data.length; i++) {
        hex += data[i].toString(16).padStart(2, '0');
      }
      return hex;
    }

    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return new TextDecoder('utf-16le').decode(data);

    default:
      return new TextDecoder('utf-8').decode(data);
  }
}

/**
 * Encode a string to a Uint8Array using the specified encoding.
 */
export function encodeString(str: string, encoding: string): Uint8Array {
  switch (encoding) {
    case 'utf8':
    case 'utf-8':
      return new TextEncoder().encode(str);

    case 'latin1':
    case 'binary': {
      const buf = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) {
        buf[i] = str.charCodeAt(i) & 0xff;
      }
      return buf;
    }

    case 'ascii': {
      const buf = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) {
        buf[i] = str.charCodeAt(i) & 0x7f;
      }
      return buf;
    }

    case 'base64': {
      const binary = atob(str);
      const buf = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        buf[i] = binary.charCodeAt(i);
      }
      return buf;
    }

    case 'hex': {
      const len = str.length >>> 1;
      const buf = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        buf[i] = parseInt(str.slice(i * 2, i * 2 + 2), 16);
      }
      return buf;
    }

    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le': {
      const buf = new Uint8Array(str.length * 2);
      for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        buf[i * 2] = code & 0xff;
        buf[i * 2 + 1] = (code >>> 8) & 0xff;
      }
      return buf;
    }

    default:
      return new TextEncoder().encode(str);
  }
}
