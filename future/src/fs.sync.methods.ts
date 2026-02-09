/**
 * FS Sync Worker Methods Maps
 * Maps method names to their implementations for sync/async execution
 */

// Sync methods (VFS-based)
import { readFileSync, readFileSyncChunk, getFileSizeSync } from './methods/readFile'
import { writeFileSync } from './methods/writeFile'
import { existsSync } from './methods/exists'
import { unlinkSync } from './methods/unlink'
import { mkdirSync } from './methods/mkdir'
import { rmdirSync } from './methods/rmdir'
import { readdirSync } from './methods/readdir'
import { statSync, lstatSync } from './methods/stat'
import { renameSync } from './methods/rename'
import { copyFileSync } from './methods/copyFile'
import { appendFileSync } from './methods/appendFile'
import { rmSync } from './methods/rm'
import { accessSync } from './methods/access'
import { chmodSync } from './methods/chmod'
import { chownSync } from './methods/chown'
import { lchmodSync } from './methods/lchmod'
import { lchownSync } from './methods/lchown'
import { linkSync } from './methods/link'
import { symlinkSync } from './methods/symlink'
import { readlinkSync } from './methods/readlink'
import { truncateSync } from './methods/truncate'
import { mkdtempSync } from './methods/mkdtemp'
import { realpathSync } from './methods/realpath'
import { utimesSync } from './methods/utimes'
import { lutimesSync } from './methods/lutimes'
import { cpSync } from './methods/cp'
import { opendirSync } from './methods/opendir'
import { statfsSync } from './methods/statfs'
import { openSync } from './methods/open'
import { closeSync } from './methods/close'
import { readSync } from './methods/read'
import { writeSync } from './methods/write'
import { fstatSync } from './methods/fstat'
import { fsyncSync } from './methods/fsync'
import { fdatasyncSync } from './methods/fdatasync'
import { ftruncateSync } from './methods/ftruncate'
import { fchmodSync } from './methods/fchmod'
import { fchownSync } from './methods/fchown'
import { futimesSync } from './methods/futimes'
import { readvSync } from './methods/readv'
import { writevSync } from './methods/writev'

// Async methods (OPFS-based) for OPFS-only mode
import { readFile } from './methods/readFile'
import { writeFile } from './methods/writeFile'
import { exists } from './methods/exists'
import { unlink } from './methods/unlink'
import { mkdir } from './methods/mkdir'
import { rmdir } from './methods/rmdir'
import { readdir } from './methods/readdir'
import { stat, lstat } from './methods/stat'
import { rename } from './methods/rename'
import { copyFile } from './methods/copyFile'
import { appendFile } from './methods/appendFile'
import { rm } from './methods/rm'
import { access } from './methods/access'
import { chmod } from './methods/chmod'
import { chown } from './methods/chown'
import { lchmod } from './methods/lchmod'
import { lchown } from './methods/lchown'
import { link } from './methods/link'
import { symlink } from './methods/symlink'
import { readlink } from './methods/readlink'
import { truncate } from './methods/truncate'
import { mkdtemp } from './methods/mkdtemp'
import { realpath } from './methods/realpath'
import { utimes } from './methods/utimes'
import { lutimes } from './methods/lutimes'
import { cp } from './methods/cp'
import { opendir } from './methods/opendir'
import { statfs } from './methods/statfs'

import { syncOpfsToVfs, syncVfsToOpfs } from './fs.vfs'

// Sync methods map (VFS-based) - used in hybrid and vfs-only modes
export const syncMethods: Record<string, Function> = {
  // Sync method names (called from sync polyfill)
  readFileSync,
  readFileSyncChunk,
  getFileSizeSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  mkdirSync,
  rmdirSync,
  readdirSync,
  statSync,
  lstatSync,
  renameSync,
  copyFileSync,
  appendFileSync,
  rmSync,
  accessSync,
  chmodSync,
  chownSync,
  lchmodSync,
  lchownSync,
  linkSync,
  symlinkSync,
  readlinkSync,
  truncateSync,
  mkdtempSync,
  realpathSync,
  utimesSync,
  lutimesSync,
  cpSync,
  opendirSync,
  statfsSync,
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
  // Async method name aliases (called from async polyfill in vfs-only mode
  // or from secondary tabs routing async methods through sync worker)
  readFile: readFileSync,
  readFileChunk: readFileSyncChunk,
  getFileSize: getFileSizeSync,
  writeFile: writeFileSync,
  exists: existsSync,
  unlink: unlinkSync,
  mkdir: mkdirSync,
  rmdir: rmdirSync,
  readdir: readdirSync,
  stat: statSync,
  lstat: lstatSync,
  rename: renameSync,
  copyFile: copyFileSync,
  appendFile: appendFileSync,
  rm: rmSync,
  access: accessSync,
  chmod: chmodSync,
  chown: chownSync,
  lchmod: lchmodSync,
  lchown: lchownSync,
  link: linkSync,
  symlink: symlinkSync,
  readlink: readlinkSync,
  truncate: truncateSync,
  mkdtemp: mkdtempSync,
  realpath: realpathSync,
  utimes: utimesSync,
  lutimes: lutimesSync,
  cp: cpSync,
  opendir: opendirSync,
  statfs: statfsSync,
  open: openSync,
  close: closeSync,
  read: readSync,
  write: writeSync,
  fstat: fstatSync,
  fsync: fsyncSync,
  fdatasync: fdatasyncSync,
  ftruncate: ftruncateSync,
  fchmod: fchmodSync,
  fchown: fchownSync,
  futimes: futimesSync,
  readv: readvSync,
  writev: writevSync,
}

// Async methods map (OPFS-based) - used in opfs-only mode
// Maps sync method names to async OPFS implementations
export const opfsMethods: Record<string, Function> = {
  readFileSync: readFile,
  writeFileSync: writeFile,
  existsSync: exists,
  unlinkSync: unlink,
  mkdirSync: mkdir,
  rmdirSync: rmdir,
  readdirSync: readdir,
  statSync: stat,
  lstatSync: lstat,
  renameSync: rename,
  copyFileSync: copyFile,
  appendFileSync: appendFile,
  rmSync: rm,
  accessSync: access,
  chmodSync: chmod,
  chownSync: chown,
  lchmodSync: lchmod,
  lchownSync: lchown,
  linkSync: link,
  symlinkSync: symlink,
  readlinkSync: readlink,
  truncateSync: truncate,
  mkdtempSync: mkdtemp,
  realpathSync: realpath,
  utimesSync: utimes,
  lutimesSync: lutimes,
  cpSync: cp,
  opendirSync: opendir,
  statfsSync: statfs,
  // fd-based methods don't have direct OPFS equivalents, fall back to VFS
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
}

// Async VFS methods (require await, run in worker context)
export const asyncVfsMethods: Record<string, Function> = {
  vfsLoad: syncOpfsToVfs,
  vfsExtract: syncVfsToOpfs,
}
