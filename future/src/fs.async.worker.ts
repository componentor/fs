// Async FS worker - uses OPFS for file operations

import { readFile, readFileChunk, getFileSize } from './methods/readFile'
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
import { open } from './methods/open'
import { close } from './methods/close'
import { read } from './methods/read'
import { write } from './methods/write'
import { fstat } from './methods/fstat'
import { fsync } from './methods/fsync'
import { fdatasync } from './methods/fdatasync'
import { ftruncate } from './methods/ftruncate'
import { fchmod } from './methods/fchmod'
import { fchown } from './methods/fchown'
import { futimes } from './methods/futimes'
import { readv } from './methods/readv'
import { writev } from './methods/writev'
import { watch } from './methods/watch'
import { setSharedArrayBuffer } from './fs.vfs'

let root: FileSystemDirectoryHandle | null = null

const initRoot = async () => {
  root = await navigator.storage.getDirectory()
}

const methods: Record<string, Function> = {
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
  watch,
}

self.onmessage = async (event) => {
  const { type, id, method, args, eventsSAB } = event.data

  // Handle init message
  if (type === 'init') {
    setSharedArrayBuffer(eventsSAB)
    await initRoot()
    self.postMessage({ type: 'initialized' })
    return
  }

  if (!root) await initRoot()

  try {
    const fn = methods[method]
    if (!fn) throw new Error(`Unknown method: ${method}`)
    const result = await fn(root!, ...(args as unknown[]))
    self.postMessage({ id, result })
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message })
  }
}

self.postMessage({ type: 'ready' })
