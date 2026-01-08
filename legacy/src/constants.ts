import type { FSConstants } from './types.js'

/**
 * File system constants matching Node.js fs.constants
 */
export const constants: FSConstants = {
  // File access modes
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,

  // Copy file flags
  COPYFILE_EXCL: 1,
  COPYFILE_FICLONE: 2,
  COPYFILE_FICLONE_FORCE: 4,

  // File open flags
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  O_CREAT: 64,
  O_EXCL: 128,
  O_TRUNC: 512,
  O_APPEND: 1024,

  // File type masks
  S_IFMT: 61440,
  S_IFREG: 32768,
  S_IFDIR: 16384,
  S_IFLNK: 40960
}

/**
 * Convert numeric flags to string representation
 */
export function flagsToString(flags: number | string): string {
  if (typeof flags === 'string') return flags

  const map: Record<number, string> = {
    [constants.O_RDONLY]: 'r',
    [constants.O_WRONLY]: 'w',
    [constants.O_RDWR]: 'r+',
    [constants.O_CREAT | constants.O_WRONLY]: 'w',
    [constants.O_CREAT | constants.O_WRONLY | constants.O_TRUNC]: 'w',
    [constants.O_CREAT | constants.O_RDWR]: 'w+',
    [constants.O_APPEND | constants.O_WRONLY]: 'a',
    [constants.O_APPEND | constants.O_RDWR]: 'a+'
  }

  return map[flags] || 'r'
}
