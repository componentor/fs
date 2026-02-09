// readFile implementation using OPFS

import { readFileFromVfs, readChunkFromVfs, getFileSizeFromVfs, isDirectoryInVfs } from '../fs.vfs'
import { createENOENT, createEISDIR } from '../classes'

// Navigate to a file handle through OPFS directory tree
const navigateToFile = async (
  root: FileSystemDirectoryHandle,
  path: string,
  options?: FileSystemGetFileOptions
): Promise<FileSystemFileHandle> => {
  const parts = path.split('/').filter(p => p.length > 0)
  let currentDir = root
  for (let i = 0; i < parts.length - 1; i++) {
    currentDir = await currentDir.getDirectoryHandle(parts[i])
  }
  return currentDir.getFileHandle(parts[parts.length - 1], options)
}

// Async - uses getFile()
export const readFile = async (
  root: FileSystemDirectoryHandle,
  path: string,
  options?: { encoding?: BufferEncoding } | BufferEncoding
): Promise<string | Buffer> => {
  const encoding = typeof options === 'string' ? options : options?.encoding

  const fileHandle = await navigateToFile(root, path)
  const file = await fileHandle.getFile()
  const buffer = await file.arrayBuffer()

  if (encoding) {
    return new TextDecoder(encoding).decode(buffer)
  }
  return Buffer.from(buffer)
}

// Read a specific chunk of a file (for streaming large files)
export const readFileChunk = async (
  root: FileSystemDirectoryHandle,
  path: string,
  start: number,
  end: number
): Promise<Buffer> => {
  const fileHandle = await navigateToFile(root, path)
  const file = await fileHandle.getFile()

  // Use slice to read only the needed portion
  const slice = file.slice(start, end)
  const buffer = await slice.arrayBuffer()

  return Buffer.from(buffer)
}

// Get file size without reading content
export const getFileSize = async (
  root: FileSystemDirectoryHandle,
  path: string
): Promise<number> => {
  const fileHandle = await navigateToFile(root, path)
  const file = await fileHandle.getFile()
  return file.size
}

// Sync - reads from VFS binary
export const readFileSync = (
  path: string,
  options?: { encoding?: BufferEncoding } | BufferEncoding
): string | Buffer => {
  // Check if path is a directory - throw EISDIR to match Node.js behavior
  if (isDirectoryInVfs(path)) {
    throw createEISDIR('read', path)
  }
  const result = readFileFromVfs(path, options)
  if (result === null) {
    throw createENOENT('open', path)
  }
  return result
}

// Sync - read a chunk of a file (for large file streaming)
export const readFileSyncChunk = (
  path: string,
  start: number,
  length: number
): Buffer => {
  const result = readChunkFromVfs(path, start, length)
  if (result === null) {
    throw createENOENT('open', path)
  }
  return Buffer.from(result)
}

// Sync - get file size without reading content
export const getFileSizeSync = (path: string): number => {
  const size = getFileSizeFromVfs(path)
  if (size === null) {
    throw createENOENT('stat', path)
  }
  return size
}
