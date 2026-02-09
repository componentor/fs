// fs/promises entry point
// Re-exports the promises API as default for compatibility with `import fs from 'fs/promises'`

export {
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
    stat,
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
    watch,
} from './polyfill'

// Also export constants
export { constants } from './constants'

// Re-export classes that are used in promises API
export { FileHandle, Dir } from './classes'

// Default export for `import fs from 'fs/promises'`
import { promises } from './fs.polyfill'
export default promises
