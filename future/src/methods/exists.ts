// exists implementation using OPFS

import { existsInVfs } from '../fs.vfs'

// Async - uses getFileHandle/getDirectoryHandle
export const exists = async (
  root: FileSystemDirectoryHandle,
  path: string
): Promise<boolean> => {
  const parts = path.split('/').filter(p => p.length > 0)
  if (parts.length === 0) return true // root always exists

  try {
    // Navigate to parent directory
    let currentDir = root
    for (let i = 0; i < parts.length - 1; i++) {
      currentDir = await currentDir.getDirectoryHandle(parts[i])
    }
    const lastName = parts[parts.length - 1]

    // Try as file first, then directory
    try {
      await currentDir.getFileHandle(lastName)
      return true
    } catch {
      await currentDir.getDirectoryHandle(lastName)
      return true
    }
  } catch {
    return false
  }
}

// Sync - checks VFS index
export const existsSync = (path: string): boolean => {
  return existsInVfs(path)
}
