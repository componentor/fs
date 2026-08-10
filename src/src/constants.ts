/**
 * File system constants matching Node.js fs.constants
 */

export const constants = {
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
  S_IFMT: 0o170000,
  S_IFREG: 0o100000,
  S_IFDIR: 0o040000,
  S_IFCHR: 0o020000,
  S_IFBLK: 0o060000,
  S_IFIFO: 0o010000,
  S_IFLNK: 0o120000,
  S_IFSOCK: 0o140000,

  // File mode constants
  S_IRWXU: 0o700,
  S_IRUSR: 0o400,
  S_IWUSR: 0o200,
  S_IXUSR: 0o100,
  S_IRWXG: 0o070,
  S_IRGRP: 0o040,
  S_IWGRP: 0o020,
  S_IXGRP: 0o010,
  S_IRWXO: 0o007,
  S_IROTH: 0o004,
  S_IWOTH: 0o002,
  S_IXOTH: 0o001,

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
  O_SYMLINK: 0o10000000,

  // The `UV_`-prefixed spellings of the copyfile flags; identical values to `COPYFILE_*` above.
  UV_FS_COPYFILE_EXCL: 1,
  UV_FS_COPYFILE_FICLONE: 2,
  UV_FS_COPYFILE_FICLONE_FORCE: 4,
} as const;

export type Constants = typeof constants;
