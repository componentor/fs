/**
 * `Stats`, `BigIntStats` and `Dirent` as real classes.
 *
 * These used to be object literals built fresh on every call, which cost eleven allocations per
 * `stat`: seven closures for `isFile()`/`isDirectory()`/… and four `Date` objects for
 * `atime`/`mtime`/`ctime`/`birthtime`, whether or not the caller ever looked at them. A
 * `readdirSync` + `stat` walk over a tree pays that per entry.
 *
 * Node builds these the way this file does, and the shapes were read off a live `node:fs`:
 *
 *   • the type predicates live on the **prototype** and read `mode & S_IFMT`, exactly as node's
 *     `Stats._checkModeProperty` does — so they cost nothing per instance;
 *   • the four `Date`s are **lazy getters**, created on first access and then cached;
 *   • `Object.keys(stats)` returns node's own-property list, in node's order, so `JSON.stringify`
 *     of a `Stats` now matches node's output.
 *
 * The one deliberate addition: node has `atimeNs`/`mtimeNs`/`ctimeNs`/`birthtimeNs` on bigint
 * stats only, but earlier versions of this library exposed them on plain `Stats` too. They stay
 * as prototype getters — still readable, no longer own enumerable properties — so existing code
 * keeps working while `Object.keys`/`JSON.stringify` match node.
 *
 * Making them classes also restores `instanceof`: `stats instanceof fs.Stats` and
 * `entry instanceof fs.Dirent` are how a good deal of node code type-tests these.
 */

import { INODE_TYPE } from './vfs/layout.js';

export const S_IFMT = 0o170000;
export const S_IFREG = 0o100000;
export const S_IFDIR = 0o040000;
export const S_IFLNK = 0o120000;
export const S_IFBLK = 0o060000;
export const S_IFCHR = 0o020000;
export const S_IFIFO = 0o010000;
export const S_IFSOCK = 0o140000;

/**
 * Field order matters: it is the order `Object.keys` reports, and it matches node's.
 */
export class Stats {
  dev: number;
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  rdev: number;
  blksize: number;
  ino: number;
  size: number;
  blocks: number;
  atimeMs: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;

  constructor(
    dev: number, mode: number, nlink: number, uid: number, gid: number, rdev: number,
    blksize: number, ino: number, size: number, blocks: number,
    atimeMs: number, mtimeMs: number, ctimeMs: number, birthtimeMs: number,
  ) {
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
  _checkModeProperty(type: number): boolean {
    return (this.mode & S_IFMT) === type;
  }

  isFile(): boolean { return this._checkModeProperty(S_IFREG); }
  isDirectory(): boolean { return this._checkModeProperty(S_IFDIR); }
  isSymbolicLink(): boolean { return this._checkModeProperty(S_IFLNK); }
  isBlockDevice(): boolean { return this._checkModeProperty(S_IFBLK); }
  isCharacterDevice(): boolean { return this._checkModeProperty(S_IFCHR); }
  isFIFO(): boolean { return this._checkModeProperty(S_IFIFO); }
  isSocket(): boolean { return this._checkModeProperty(S_IFSOCK); }

  // Built on first read, then cached — most callers never touch them. Native private fields
  // rather than symbol-keyed properties: a symbol write pushes the object into dictionary mode,
  // which measured slower than the closures it was meant to replace.
  #atime?: Date; #mtime?: Date; #ctime?: Date; #birthtime?: Date;
  get atime(): Date { return this.#atime ??= new Date(this.atimeMs); }
  get mtime(): Date { return this.#mtime ??= new Date(this.mtimeMs); }
  get ctime(): Date { return this.#ctime ??= new Date(this.ctimeMs); }
  get birthtime(): Date { return this.#birthtime ??= new Date(this.birthtimeMs); }

  // Not node's — see the file comment. Kept readable for backward compatibility.
  get atimeNs(): number { return this.atimeMs * 1_000_000; }
  get mtimeNs(): number { return this.mtimeMs * 1_000_000; }
  get ctimeNs(): number { return this.ctimeMs * 1_000_000; }
  get birthtimeNs(): number { return this.birthtimeMs * 1_000_000; }
}

/**
 * The `{ bigint: true }` form. Node keeps this a separate class, and unlike plain `Stats` it does
 * carry the nanosecond fields as own properties.
 */
export class BigIntStats {
  dev: bigint;
  mode: bigint;
  nlink: bigint;
  uid: bigint;
  gid: bigint;
  rdev: bigint;
  blksize: bigint;
  ino: bigint;
  size: bigint;
  blocks: bigint;
  atimeMs: bigint;
  mtimeMs: bigint;
  ctimeMs: bigint;
  birthtimeMs: bigint;
  atimeNs: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
  birthtimeNs: bigint;

  constructor(
    dev: bigint, mode: bigint, nlink: bigint, uid: bigint, gid: bigint, rdev: bigint,
    blksize: bigint, ino: bigint, size: bigint, blocks: bigint,
    atimeMs: bigint, mtimeMs: bigint, ctimeMs: bigint, birthtimeMs: bigint,
  ) {
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
    this.atimeNs = atimeMs * 1_000_000n;
    this.mtimeNs = mtimeMs * 1_000_000n;
    this.ctimeNs = ctimeMs * 1_000_000n;
    this.birthtimeNs = birthtimeMs * 1_000_000n;
  }

  _checkModeProperty(type: number): boolean {
    return (this.mode & BigInt(S_IFMT)) === BigInt(type);
  }

  isFile(): boolean { return this._checkModeProperty(S_IFREG); }
  isDirectory(): boolean { return this._checkModeProperty(S_IFDIR); }
  isSymbolicLink(): boolean { return this._checkModeProperty(S_IFLNK); }
  isBlockDevice(): boolean { return this._checkModeProperty(S_IFBLK); }
  isCharacterDevice(): boolean { return this._checkModeProperty(S_IFCHR); }
  isFIFO(): boolean { return this._checkModeProperty(S_IFIFO); }
  isSocket(): boolean { return this._checkModeProperty(S_IFSOCK); }

  #atime?: Date; #mtime?: Date; #ctime?: Date; #birthtime?: Date;
  get atime(): Date { return this.#atime ??= new Date(Number(this.atimeMs)); }
  get mtime(): Date { return this.#mtime ??= new Date(Number(this.mtimeMs)); }
  get ctime(): Date { return this.#ctime ??= new Date(Number(this.ctimeMs)); }
  get birthtime(): Date { return this.#birthtime ??= new Date(Number(this.birthtimeMs)); }
}

/**
 * A directory entry. Node's own properties are `name` and `parentPath` only. Ours carried `path`
 * as a third own property, so serialising an entry emitted a field node does not.
 *
 * `path` survives here as a prototype **getter** aliasing `parentPath`. Node deprecated it
 * (DEP0178) and removed it outright in v24, but dropping it would break callers that still read
 * it; as a getter it costs nothing per instance and stays out of `Object.keys`/`JSON.stringify`,
 * which is the part of the shape that has to match.
 *
 * Unlike `Stats`, this class is not a speed win: constructing one measures a few nanoseconds
 * *slower* than the object literal it replaced, because the private type slot costs more than
 * the seven closures saved. It is here for `instanceof fs.Dirent`, for node's exact own-property
 * shape, and so that `glob` and `readdir` cannot disagree about what a `Dirent` is — `glob` used
 * to omit `path` entirely.
 */
export class Dirent {
  name: string;
  parentPath: string;
  /**
   * A native private field, not a symbol-keyed property: it stays out of `Object.keys`,
   * `JSON.stringify` and spreads exactly like node's internal type slot, and unlike a symbol it
   * does not push the object into dictionary mode — measured, a symbol here made `Dirent`
   * construction *slower* than the object literal it replaced.
   */
  #type: number;

  constructor(name: string, type: number, parentPath: string) {
    this.name = name;
    this.parentPath = parentPath;
    this.#type = type;
  }

  /** @deprecated Alias of `parentPath`. Node removed this in v24; kept here for compatibility. */
  get path(): string { return this.parentPath; }

  /**
   * The same entry reported under a different parent directory — what recursive `readdir` needs.
   *
   * Copying `isFile`/`isDirectory`/… off the source entry into a new object literal (which is
   * what the recursive walk used to do) only worked while those were per-instance closures. With
   * the predicates on the prototype they read the entry type through `this`, so a bare function
   * reference lands on an object that has no type and reports false for everything.
   */
  withParentPath(parentPath: string): Dirent {
    return new Dirent(this.name, this.#type, parentPath);
  }

  isFile(): boolean { return this.#type === INODE_TYPE.FILE; }
  isDirectory(): boolean { return this.#type === INODE_TYPE.DIRECTORY; }
  isSymbolicLink(): boolean { return this.#type === INODE_TYPE.SYMLINK; }
  isBlockDevice(): boolean { return false; }
  isCharacterDevice(): boolean { return false; }
  isFIFO(): boolean { return false; }
  isSocket(): boolean { return false; }
}
