/**
 * CRC-32 (IEEE 802.3, polynomial 0xEDB88320) — used to checksum the VFS
 * superblock so a torn/corrupted superblock write is detected at mount
 * time instead of being trusted as layout truth.
 *
 * Plain table-driven JS: no WebCrypto/Node dependencies, identical results
 * in every browser and in workers.
 */

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/** Compute CRC-32 of `bytes[start..end)`. */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.byteLength): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc = TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
