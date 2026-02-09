// lstat implementation - re-exports from stat (no symlinks in OPFS)

export { lstat, lstatSync } from './stat'
