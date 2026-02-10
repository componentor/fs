/**
 * Promises-only export for `import promises from '@componentor/fs/promises'`
 */

import { getDefaultFS } from './index.js';

const promises = getDefaultFS().promises;

export const readFile = promises.readFile.bind(promises);
export const writeFile = promises.writeFile.bind(promises);
export const appendFile = promises.appendFile.bind(promises);
export const mkdir = promises.mkdir.bind(promises);
export const rmdir = promises.rmdir.bind(promises);
export const rm = promises.rm.bind(promises);
export const unlink = promises.unlink.bind(promises);
export const readdir = promises.readdir.bind(promises);
export const stat = promises.stat.bind(promises);
export const lstat = promises.lstat.bind(promises);
export const access = promises.access.bind(promises);
export const rename = promises.rename.bind(promises);
export const copyFile = promises.copyFile.bind(promises);
export const truncate = promises.truncate.bind(promises);
export const realpath = promises.realpath.bind(promises);
export const exists = promises.exists.bind(promises);
export const chmod = promises.chmod.bind(promises);
export const chown = promises.chown.bind(promises);
export const utimes = promises.utimes.bind(promises);
export const symlink = promises.symlink.bind(promises);
export const readlink = promises.readlink.bind(promises);
export const link = promises.link.bind(promises);
export const open = promises.open.bind(promises);
export const opendir = promises.opendir.bind(promises);
export const mkdtemp = promises.mkdtemp.bind(promises);
export const flush = promises.flush.bind(promises);
export const purge = promises.purge.bind(promises);
