# @componentor/fs

> 🚀 A blazing-fast, Node.js-compatible filesystem interface for the browser using the Origin Private File System API

[![npm version](https://badge.fury.io/js/@componentor%2Ffs.svg)](https://www.npmjs.com/package/@componentor/fs)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ Features

- 🔥 **Lightning Fast** - Leverages sync access handles for optimal performance
- 🌐 **Browser Native** - Built on the modern Origin Private File System API
- 🔄 **Drop-in Replacement** - Compatible with Node.js fs/promises API
- ⚡ **Isomorphic Git Ready** - Perfect companion for browser-based Git operations
- 🔗 **Symlink Support** - Full symbolic link emulation for advanced file operations
- 📦 **Zero Dependencies** - Lightweight and efficient
- ✅ **Fully Tested** - 214 comprehensive tests with 100% pass rate
- 📁 **Full fs Compatibility** - access, appendFile, copyFile, cp, rm, truncate, open, opendir, streams, and more
- 🚀 **Hybrid Mode** - Optimal performance with reads on main thread and writes on worker

## 🚀 Installation

```bash
npm install @componentor/fs
```

```bash
yarn add @componentor/fs
```

```bash
pnpm add @componentor/fs
```

## 🔧 Quick Start

```javascript
import OPFS from '@componentor/fs'

const fs = new OPFS()

// Write a file
await fs.writeFile('hello.txt', 'Hello, OPFS World!')

// Read it back
const content = await fs.readFile('hello.txt', { encoding: 'utf8' })
console.log(content) // "Hello, OPFS World!"

// Create directories
await fs.mkdir('projects/my-app', { recursive: true })

// List directory contents
const files = await fs.readdir('.')
console.log(files) // ['hello.txt', 'projects']
```

## 💡 Why It's Fast

The Origin Private File System API provides **direct access to the device's storage** with significantly better performance characteristics than traditional browser storage solutions:

### 🏎️ Performance Advantages

- **Sync Access Handles**: When available, operations bypass the async overhead for read/write operations
- **Native File System**: Direct integration with the operating system's file system
- **Optimized I/O**: Reduced serialization overhead compared to IndexedDB or localStorage
- **Streaming Support**: Efficient handling of large files without memory constraints

### 📊 Performance vs LightningFS

Benchmarked against [LightningFS](https://github.com/isomorphic-git/lightning-fs) (100 iterations):

| Operation | LightningFS | OPFS-FS (Hybrid) | Speedup |
|-----------|-------------|------------------|---------|
| Batch Writes | 25.57ms | 1.73ms | **14.8x faster** |
| Batch Reads | 12.64ms | 1.56ms | **8.1x faster** |
| Single Writes | 66.45ms | 71.37ms | ~1x |
| Single Reads | 66.76ms | 66.93ms | ~1x |
| **Total** | **172.85ms** | **144.30ms** | **1.20x faster** |

> **Note:** This package was previously published as `@componentor/opfs-fs`. If you're upgrading, simply change your imports from `@componentor/opfs-fs` to `@componentor/fs`.

## 📚 API Reference

### Constructor

#### `new OPFS(options?)`

Creates a new OPFS filesystem instance.

**Parameters:**
- `options.useSync` (boolean, default: `true`) - Use synchronous access handles when available
- `options.workerUrl` (URL | string, optional) - Worker script URL. When provided, enables **hybrid mode** for optimal performance
- `options.read` ('main' | 'worker', default: 'main') - Backend for read operations in hybrid mode
- `options.write` ('main' | 'worker', default: 'worker') - Backend for write operations in hybrid mode
- `options.verbose` (boolean, default: `false`) - Enable verbose logging
- `options.useCompression` (boolean, default: `false`) - Enable gzip compression for batch writes. Can improve performance for text-heavy workloads.
- `options.useChecksum` (boolean, default: `true`) - Enable CRC32 checksum for batch writes. Disable for maximum performance if data integrity verification is not needed.

**Example:**
```javascript
// Use sync handles (recommended for workers)
const fs = new OPFS({ useSync: true })

// Force async mode
const fsAsync = new OPFS({ useSync: false })

// Use hybrid mode (recommended for main thread - best performance!)
const fs = new OPFS({
  workerUrl: new URL('./opfs-worker.js', import.meta.url)
})
await fs.ready() // Wait for worker to initialize

// Don't forget to terminate when done
fs.terminate()
```

### Hybrid Mode (Recommended)

Hybrid mode provides the **best performance** by routing operations to optimal backends:
- **Reads on main thread**: No message passing overhead
- **Writes on worker**: Sync access handles are faster

```javascript
import OPFS from '@componentor/fs'

// Create with hybrid mode
const fs = new OPFS({
  workerUrl: new URL('@componentor/fs/worker-script', import.meta.url)
})

// Wait for worker to be ready
await fs.ready()

// Use like normal - hybrid routing happens automatically
await fs.writeFile('test.txt', 'Hello World') // Routed to worker
const data = await fs.readFile('test.txt')     // Routed to main thread

// Clean up when done
fs.terminate()
```

### File Operations

#### `readFile(path, options?)`

Reads the entire contents of a file.

**Parameters:**
- `path` (string) - File path
- `options.encoding` (string, optional) - Text encoding ('utf8' for string output)

**Returns:** `Promise<Uint8Array | string>`

**Examples:**
```javascript
// Read as binary
const buffer = await fs.readFile('image.png')

// Read as text
const text = await fs.readFile('config.json', { encoding: 'utf8' })

// Parse JSON
const config = JSON.parse(await fs.readFile('config.json', { encoding: 'utf8' }))
```

#### `writeFile(path, data, options?)`

Writes data to a file, creating it if it doesn't exist.

**Parameters:**
- `path` (string) - File path
- `data` (string | Uint8Array) - Data to write
- `options` (object, optional) - Write options

**Returns:** `Promise<void>`

**Examples:**
```javascript
// Write text
await fs.writeFile('note.txt', 'Hello World')

// Write binary data
await fs.writeFile('data.bin', new Uint8Array([1, 2, 3, 4]))

// Write JSON
await fs.writeFile('config.json', JSON.stringify({ theme: 'dark' }))
```

#### `unlink(path)`

Deletes a file.

**Parameters:**
- `path` (string) - File path to delete

**Returns:** `Promise<void>`

**Example:**
```javascript
await fs.unlink('temp.txt')
```

#### `rename(oldPath, newPath)`

Moves/renames a file.

**Parameters:**
- `oldPath` (string) - Current file path
- `newPath` (string) - New file path

**Returns:** `Promise<void>`

**Example:**
```javascript
await fs.rename('old-name.txt', 'new-name.txt')
await fs.rename('file.txt', 'backup/file.txt')
```

#### `stat(path)`

Gets file statistics (follows symlinks).

**Parameters:**
- `path` (string) - File path

**Returns:** `Promise<FileStats>`

**Example:**
```javascript
const stats = await fs.stat('large-file.zip')
console.log(`Size: ${stats.size} bytes`)
console.log(`Modified: ${new Date(stats.mtimeMs)}`)
console.log(`Is file: ${stats.isFile()}`)
```

#### `lstat(path)`

Gets file statistics without following symlinks.

**Parameters:**
- `path` (string) - File path

**Returns:** `Promise<FileStats>`

**Example:**
```javascript
const stats = await fs.lstat('link.txt')
if (stats.isSymbolicLink()) {
  console.log(`Symlink pointing to: ${stats.target}`)
}
```

### Symlink Operations

#### `symlink(target, path)`

Creates a symbolic link.

**Parameters:**
- `target` (string) - Target path the symlink points to
- `path` (string) - Path where the symlink will be created

**Returns:** `Promise<void>`

**Example:**
```javascript
await fs.writeFile('config.json', '{"key": "value"}')
await fs.symlink('config.json', 'current-config.json')

// Read through symlink
const content = await fs.readFile('current-config.json', { encoding: 'utf8' })
```

#### `readlink(path)`

Reads the target of a symbolic link.

**Parameters:**
- `path` (string) - Symlink path

**Returns:** `Promise<string>` - The target path

**Example:**
```javascript
const target = await fs.readlink('my-link.txt')
console.log(`Link points to: ${target}`)
```

#### `symlinkBatch(links)`

Creates multiple symbolic links efficiently in a single operation.

**Parameters:**
- `links` (Array<{target: string, path: string}>) - Array of symlink definitions

**Returns:** `Promise<void>`

**Example:**
```javascript
// Create multiple symlinks with a single metadata write
await fs.symlinkBatch([
  { target: '/configs/prod.json', path: '/current-config.json' },
  { target: '/data/latest.db', path: '/current-db.db' },
  { target: '/logs/today.log', path: '/current.log' }
])

// 60-70% faster than individual symlink() calls
```

### Directory Operations

#### `mkdir(path, options?)`

Creates a directory.

**Parameters:**
- `path` (string) - Directory path
- `options.recursive` (boolean, optional) - Create parent directories

**Returns:** `Promise<void>`

**Examples:**
```javascript
// Create single directory
await fs.mkdir('uploads')

// Create nested directories
await fs.mkdir('projects/webapp/src', { recursive: true })
```

#### `rmdir(path)`

Removes a directory and all its contents.

**Parameters:**
- `path` (string) - Directory path

**Returns:** `Promise<void>`

**Example:**
```javascript
await fs.rmdir('temp-folder')
```

#### `readdir(path)`

Lists directory contents.

**Parameters:**
- `path` (string) - Directory path

**Returns:** `Promise<string[]>`

**Example:**
```javascript
const files = await fs.readdir('documents')
console.log('Files:', files)

// List root directory
const rootFiles = await fs.readdir('.')
```

### Additional File Operations

#### `access(path, mode?)`

Tests file accessibility. Throws if the file doesn't exist.

```javascript
await fs.access('/path/to/file') // Throws if not accessible
```

#### `appendFile(path, data)`

Appends data to a file, creating it if it doesn't exist.

```javascript
await fs.appendFile('log.txt', 'New log entry\n')
```

#### `copyFile(src, dest, mode?)`

Copies a file from source to destination.

```javascript
await fs.copyFile('original.txt', 'backup.txt')
// With COPYFILE_EXCL flag to fail if dest exists
await fs.copyFile('src.txt', 'dest.txt', fs.constants.COPYFILE_EXCL)
```

#### `cp(src, dest, options?)`

Copies files or directories recursively.

```javascript
// Copy single file
await fs.cp('file.txt', 'copy.txt')

// Copy directory recursively
await fs.cp('source-dir', 'dest-dir', { recursive: true })
```

#### `exists(path)`

Returns true if the path exists, false otherwise (doesn't throw).

```javascript
if (await fs.exists('config.json')) {
  // File exists
}
```

#### `realpath(path)`

Resolves symlinks to get the real path.

```javascript
const realPath = await fs.realpath('my-symlink')
```

#### `rm(path, options?)`

Removes files or directories.

```javascript
await fs.rm('file.txt')
await fs.rm('directory', { recursive: true })
await fs.rm('maybe-exists', { force: true }) // No error if doesn't exist
```

#### `truncate(path, len?)`

Truncates a file to the specified length.

```javascript
await fs.truncate('file.txt', 100) // Truncate to 100 bytes
await fs.truncate('file.txt') // Truncate to 0 bytes
```

#### `mkdtemp(prefix)`

Creates a unique temporary directory.

```javascript
const tempDir = await fs.mkdtemp('/tmp/myapp-')
console.log(tempDir) // e.g., "/tmp/myapp-1234567890-abc123"
```

#### `open(path, flags?, mode?)`

Opens a file and returns a FileHandle.

```javascript
const handle = await fs.open('file.txt', 'r')
const buffer = new Uint8Array(100)
await handle.read(buffer)
await handle.close()
```

#### `opendir(path)`

Opens a directory for iteration.

```javascript
const dir = await fs.opendir('/my-dir')
for await (const entry of dir) {
  console.log(entry.name, entry.isFile(), entry.isDirectory())
}
```

#### `createReadStream(path, options?)`

Creates a readable stream for a file.

```javascript
const stream = fs.createReadStream('large-file.bin')
const reader = stream.getReader()
// Read chunks...
```

#### `createWriteStream(path, options?)`

Creates a writable stream for a file.

```javascript
const stream = fs.createWriteStream('output.txt')
const writer = stream.getWriter()
await writer.write(new TextEncoder().encode('data'))
await writer.close()
```

#### `watch(path, options?)`

Watches for file/directory changes (basic implementation).

```javascript
const watcher = fs.watch('/my-dir')
for await (const event of watcher) {
  console.log(event.eventType, event.filename)
}
```

### Compatibility Methods (No-ops for OPFS)

The following methods are implemented for API compatibility but are no-ops since OPFS doesn't support these features:

- `chmod(path, mode)` - File modes not supported
- `chown(path, uid, gid)` - File ownership not supported
- `utimes(path, atime, mtime)` - Timestamps are read-only
- `lutimes(path, atime, mtime)` - Symlink timestamps are read-only

### Lifecycle Methods (Hybrid Mode)

These methods are used when running in hybrid mode (with `workerUrl`):

#### `ready()`

Wait for the worker to be initialized. Call this before performing any operations.

```javascript
const fs = new OPFS({ workerUrl: '...' })
await fs.ready() // Wait for worker
```

#### `terminate()`

Terminate the background worker. Call this when you're done using the filesystem.

```javascript
fs.terminate() // Clean up worker
```

#### `gc()`

Force garbage collection by reinitializing the worker's OPFS instance. Use this for long-running applications to prevent memory leaks.

```javascript
// Periodically call gc() in long-running apps
await fs.gc()
```

#### `resetCache()`

Reset internal caches (symlinks, directory handles). Lighter than `gc()`.

```javascript
fs.resetCache()
```

## 🎯 Real-World Examples

### Working with Isomorphic Git

```javascript
import git from 'isomorphic-git'
import OPFS from '@componentor/fs'

// Use hybrid mode for best performance with git operations
const fs = new OPFS({
  workerUrl: new URL('@componentor/fs/worker-script', import.meta.url)
})
await fs.ready()

// Clone a repository
await git.clone({
  fs,
  http: fetch,
  dir: '/my-repo',
  url: 'https://github.com/user/repo.git'
})

// Read a file from the repo
const readme = await fs.readFile('/my-repo/README.md', { encoding: 'utf8' })
console.log(readme)

// Clean up when done
fs.terminate()
```

### Building a Code Editor

```javascript
import OPFS from '@componentor/fs'

class CodeEditor {
  constructor(workerUrl) {
    // Use hybrid mode for optimal performance
    this.fs = new OPFS({ workerUrl })
  }

  async init() {
    await this.fs.ready()
  }

  destroy() {
    this.fs.terminate()
  }

  async createProject(name) {
    await this.fs.mkdir(`projects/${name}/src`)
    await this.fs.writeFile(`projects/${name}/package.json`, JSON.stringify({
      name,
      version: '1.0.0',
      main: 'src/index.js'
    }, null, 2))
    await this.fs.writeFile(`projects/${name}/src/index.js`, '// Your code here\n')
  }

  async saveFile(path, content) {
    await this.fs.writeFile(path, content)
  }

  async loadFile(path) {
    return await this.fs.readFile(path, { encoding: 'utf8' })
  }

  async getProjectFiles(projectName) {
    return await this.fs.readdir(`projects/${projectName}`)
  }
}
```

### File Upload Handler

```javascript
import OPFS from '@componentor/fs'

const fs = new OPFS()

async function handleFileUpload(file) {
  // Create uploads directory
  await fs.mkdir('uploads', { recursive: true })
  
  // Save uploaded file
  const buffer = new Uint8Array(await file.arrayBuffer())
  const filename = `uploads/${Date.now()}-${file.name}`
  await fs.writeFile(filename, buffer)
  
  // Get file info
  const stats = await fs.stat(filename)
  console.log(`Saved ${file.name} (${stats.size} bytes)`)
  
  return filename
}
```

## 🌐 Browser Support

@componentor/fs requires browsers that support the Origin Private File System API:

- ✅ Chrome 86+
- ✅ Edge 86+
- ✅ Firefox 111+
- ✅ Safari 15.2+

### Feature Detection

```javascript
if ('storage' in navigator && 'getDirectory' in navigator.storage) {
  const fs = new OPFS()
  // OPFS is supported
} else {
  console.warn('OPFS not supported in this browser')
  // Fallback to other storage solutions
}
```

## 🚦 Error Handling

OPFS-FS throws standard filesystem errors:

```javascript
try {
  await fs.readFile('nonexistent.txt')
} catch (error) {
  if (error.message.includes('ENOENT')) {
    console.log('File not found')
  }
}

try {
  await fs.mkdir('existing-dir')
} catch (error) {
  if (error.message.includes('EEXIST')) {
    console.log('Directory already exists')
  }
}
```

## 🧪 Testing

@componentor/fs comes with a comprehensive test suite covering all functionality:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

**Test Coverage:**
- ✅ 214 tests with 100% pass rate
- ✅ File read/write operations (text and binary)
- ✅ Directory operations (create, remove, list)
- ✅ File metadata and statistics
- ✅ Path normalization and edge cases
- ✅ Symlink operations and resolution
- ✅ Error handling and edge cases
- ✅ Concurrent operations
- ✅ Large file handling
- ✅ Performance benchmarks
- ✅ Git integration with symlinks (isomorphic-git compatibility)
- ✅ Node.js fs compatibility (access, appendFile, copyFile, cp, rm, truncate, open, opendir, streams)

See [SYMLINK_IMPLEMENTATION.md](SYMLINK_IMPLEMENTATION.md) for details on symlink support and [PERFORMANCE.md](PERFORMANCE.md) for performance analysis.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

When contributing, please ensure:
- All tests pass (`npm test`)
- New features include corresponding tests
- Code follows the existing style

## 📄 License

MIT © Componentor

## 🙏 Acknowledgments

- Built on the powerful [Origin Private File System API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)
- Inspired by Node.js fs/promises module
- Perfect companion for [isomorphic-git](https://github.com/isomorphic-git/isomorphic-git)

---

**Made with ❤️ for the modern web**