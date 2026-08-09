/**
 * Build the `[path2Len: u32][path2 bytes…]` payload that two-path ops (rename, copy, link)
 * carry, matching `decodeSecondPath` in the protocol.
 *
 * Production builds this inside `encodeTwoPathRequest`, which also writes the request header;
 * tests that call `dispatchOp` directly need just the payload half.
 */
export function encodeSecondPath(path: string): Uint8Array {
  const bytes = new TextEncoder().encode(path);
  const payload = new Uint8Array(4 + bytes.byteLength);
  new DataView(payload.buffer).setUint32(0, bytes.byteLength, true);
  payload.set(bytes, 4);
  return payload;
}
