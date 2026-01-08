# Symlink Implementation

This document describes the emulated symlink support added to the OPFS filesystem.

## Overview

Since OPFS (Origin Private File System) doesn't natively support symbolic links, we implemented an emulation layer that stores symlink metadata in a JSON file and resolves links during file operations.

## How It Works

### Metadata Storage
- Symlinks are stored in `/.opfs-symlinks.json` as a mapping of paths to targets
- Example: `{"/link.txt": "/target.txt"}`
- The metadata file is hidden from `readdir()` results

### Link Resolution
- File operations (`readFile`, `writeFile`, `stat`) automatically follow symlinks
- `lstat()` returns symlink information without following the link
- `readlink()` returns the target path
- Maximum resolution depth of 10 to prevent infinite loops

### Circular Link Detection
- Throws `ELOOP` error when symlink chain exceeds 10 levels
- Prevents infinite loops from circular or self-referencing symlinks

## API

### Creating Symlinks
```javascript
await fs.symlink(target, linkPath)
```
Creates a symbolic link at `linkPath` pointing to `target`.

**Errors:**
- `EEXIST` - Path already exists
- Target doesn't need to exist

### Reading Link Target
```javascript
const target = await fs.readlink(linkPath)
```
Returns the target path of a symlink.

**Errors:**
- `EINVAL` - Not a symlink

### Getting Link Info
```javascript
const stat = await fs.lstat(linkPath)
```
Returns information about the symlink itself (not the target).

Properties:
- `type: 'symlink'`
- `target: '/path/to/target'`
- `isSymbolicLink(): true`
- `mode: 0o120777`

### Following Links
```javascript
const stat = await fs.stat(linkPath)
const content = await fs.readFile(linkPath)
await fs.writeFile(linkPath, data)
```
These operations automatically follow symlinks to access the target.

**Errors:**
- `ENOENT` - Target doesn't exist
- `ELOOP` - Too many levels of symlinks

### Removing Symlinks
```javascript
await fs.unlink(linkPath)
```
Removes the symlink without affecting the target.

### Renaming Symlinks
```javascript
await fs.rename(oldLinkPath, newLinkPath)
```
Moves the symlink, preserving the target path.

### Directory Listings
```javascript
const entries = await fs.readdir('/', { withFileTypes: true })
```
Symlinks are identified with `isSymbolicLink(): true`.

## Limitations

1. **Not Native**: These are emulated symlinks, not OS-level symlinks
2. **Performance**: Each symlink operation requires loading/saving metadata
3. **Browser Only**: OPFS is a browser API, so this only works in web environments
4. **No Hard Links**: Only symbolic links are supported
5. **Metadata File**: The `.opfs-symlinks.json` file must not be manually modified

## Testing

Run the test suite:
```bash
npm test
```

The test suite includes 35 tests covering:
- Basic symlink creation and reading
- File operations through symlinks
- `stat()` vs `lstat()` behavior
- Symlink deletion and renaming
- Circular link detection
- Directory listings with symlinks
- Edge cases and persistence

## Example Usage

```javascript
import OPFS from '@componentor/opfs-fs'

const fs = new OPFS()

// Create a file
await fs.writeFile('/config.json', '{"key": "value"}')

// Create a symlink
await fs.symlink('/config.json', '/current-config.json')

// Read through symlink
const data = await fs.readFile('/current-config.json', { encoding: 'utf-8' })
console.log(data) // {"key": "value"}

// Check if it's a symlink
const lstat = await fs.lstat('/current-config.json')
console.log(lstat.isSymbolicLink()) // true
console.log(lstat.target) // /config.json

// Get target file info
const stat = await fs.stat('/current-config.json')
console.log(stat.isFile()) // true

// Remove symlink (doesn't delete target)
await fs.unlink('/current-config.json')

// Original file still exists
await fs.readFile('/config.json') // Works fine
```

## Implementation Details

### File Structure Changes
- Added `_symlinkCache` and `_symlinkFile` properties to OPFS class
- Added helper methods: `_loadSymlinks()`, `_saveSymlinks()`, `_resolveSymlink()`, `_isSymlink()`
- Modified existing methods: `readFile()`, `writeFile()`, `stat()`, `readdir()`, `unlink()`, `rename()`
- Implemented new methods: `symlink()`, `readlink()`, updated `lstat()`

### Symlink Metadata Format
```json
{
  "/path/to/link1": "/path/to/target1",
  "/path/to/link2": "/path/to/target2"
}
```

All paths are normalized using the existing `_normalize()` method.
