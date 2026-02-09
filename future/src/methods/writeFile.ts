// writeFile implementation using OPFS

import { queueEvent, writeFileToVfs, existsInVfs } from '../fs.vfs'

// Async - writes to OPFS; VFS update happens via fire-and-forget to sync worker
// Note: For async OPFS mode, we queue 'update' since we can't easily check VFS existence
export const writeFile = async (
  root: FileSystemDirectoryHandle,
  path: string,
  data: string | Buffer,
  _options?: { encoding?: BufferEncoding } | BufferEncoding
): Promise<void> => {
  // Debug: log all writes to dist folder
  if (path.includes('/dist/') || path.includes('/dist')) {
    console.log(`[writeFile ASYNC] Writing dist file: ${path} (${typeof data === 'string' ? data.length + ' chars' : data.length + ' bytes'})`)
  }
  queueEvent('update', path)

  // Navigate to parent directory, creating dirs as needed
  const parts = path.split('/').filter(p => p.length > 0)
  let currentDir = root
  for (let i = 0; i < parts.length - 1; i++) {
    currentDir = await currentDir.getDirectoryHandle(parts[i], { create: true })
  }
  const fileHandle = await currentDir.getFileHandle(parts[parts.length - 1], { create: true })
  const writable = await fileHandle.createWritable()

  const bytes = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : new Uint8Array(data)

  await writable.write(bytes)
  await writable.close()
}

// Sync - writes to VFS binary
export const writeFileSync = (
  path: string,
  data: string | Buffer,
  _options?: { encoding?: BufferEncoding } | BufferEncoding
): void => {
  // Debug: log all writes to dist folder
  if (path.includes('/dist/') || path.includes('/dist')) {
    const size = data == null ? 'null' : typeof data === 'string' ? data.length + ' chars' : data.length + ' bytes'
    console.log(`[writeFileSync] Writing dist file: ${path} (${size})`)
  }
  // Queue 'create' for new files, 'update' for existing files
  const eventType = existsInVfs(path) ? 'update' : 'create'
  queueEvent(eventType, path)
  writeFileToVfs(path, data)
}
