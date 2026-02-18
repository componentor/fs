/**
 * OPFS Engine — operates directly on real OPFS files.
 *
 * Drop-in async replacement for VFSEngine. Used when mode='opfs' or as
 * fallback when VFS binary corruption is detected in hybrid mode.
 *
 * All methods are async because OPFS directory operations require async APIs.
 * File content operations use createSyncAccessHandle for speed.
 *
 * Limitations compared to VFSEngine:
 * - No symlinks (OPFS doesn't support them)
 * - No permissions/ownership (OPFS doesn't support them)
 * - Slower directory operations (async OPFS API calls)
 */

const encoder = new TextEncoder();

// Match VFS inode types for stat encoding
const TYPE_FILE = 1;
const TYPE_DIRECTORY = 2;

// Match binary protocol status codes from errors.ts
const OK = 0;
const ENOENT = 1;
const EEXIST = 2;
const EISDIR = 3;
const ENOTDIR = 4;
const ENOTEMPTY = 5;
const EINVAL = 7;
const EBADF = 8;

interface OPFSResult {
  status: number;
  data?: Uint8Array | null;
}

interface FdEntry {
  handle: FileSystemSyncAccessHandle;
  path: string;
  position: number;
  flags: number;
}

export class OPFSEngine {
  private rootDir!: FileSystemDirectoryHandle;
  private fdTable = new Map<number, FdEntry>();
  private nextFd = 3;
  private nextIno = 1;
  private processUid = 0;
  private processGid = 0;

  async init(
    rootDir: FileSystemDirectoryHandle,
    opts?: { uid?: number; gid?: number },
  ): Promise<void> {
    this.rootDir = rootDir;
    this.processUid = opts?.uid ?? 0;
    this.processGid = opts?.gid ?? 0;
  }

  cleanupTab(_tabId: string): void {
    for (const [fd, entry] of this.fdTable) {
      try { entry.handle.close(); } catch {}
      this.fdTable.delete(fd);
    }
  }

  getPathForFd(fd: number): string | null {
    return this.fdTable.get(fd)?.path ?? null;
  }

  // ========== Path helpers ==========

  private normalizePath(path: string): string {
    if (!path.startsWith('/')) path = '/' + path;
    while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    const parts = path.split('/');
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === '' || part === '.') continue;
      if (part === '..') { resolved.pop(); continue; }
      resolved.push(part);
    }
    return '/' + resolved.join('/');
  }

  /** Navigate to the parent directory of a path, returning the parent handle and child name. */
  private async navigateToParent(
    path: string,
  ): Promise<{ dir: FileSystemDirectoryHandle; name: string } | null> {
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    const name = parts.pop()!;
    let dir = this.rootDir;
    for (const part of parts) {
      try {
        dir = await dir.getDirectoryHandle(part);
      } catch {
        return null;
      }
    }
    return { dir, name };
  }

  /** Navigate to a directory by path. */
  private async navigateToDir(path: string): Promise<FileSystemDirectoryHandle | null> {
    if (path === '/') return this.rootDir;
    const parts = path.split('/').filter(Boolean);
    let dir = this.rootDir;
    for (const part of parts) {
      try {
        dir = await dir.getDirectoryHandle(part);
      } catch {
        return null;
      }
    }
    return dir;
  }

  /** Get a file or directory handle for a path. */
  private async getEntry(
    path: string,
  ): Promise<{ handle: FileSystemFileHandle | FileSystemDirectoryHandle; kind: 'file' | 'directory' } | null> {
    if (path === '/') return { handle: this.rootDir, kind: 'directory' };
    const nav = await this.navigateToParent(path);
    if (!nav) return null;
    try {
      return { handle: await nav.dir.getFileHandle(nav.name), kind: 'file' };
    } catch {
      try {
        return { handle: await nav.dir.getDirectoryHandle(nav.name), kind: 'directory' };
      } catch {
        return null;
      }
    }
  }

  /** Ensure all parent directories exist (recursive mkdir for parents). */
  private async ensureParent(path: string): Promise<FileSystemDirectoryHandle | null> {
    const parts = path.split('/').filter(Boolean);
    parts.pop(); // remove the leaf
    let dir = this.rootDir;
    for (const part of parts) {
      try {
        dir = await dir.getDirectoryHandle(part, { create: true });
      } catch {
        return null;
      }
    }
    return dir;
  }

  private encodeStat(
    kind: 'file' | 'directory',
    size: number,
    mtime: number,
    ino: number,
  ): Uint8Array {
    const buf = new Uint8Array(49);
    const view = new DataView(buf.buffer);
    view.setUint8(0, kind === 'file' ? TYPE_FILE : TYPE_DIRECTORY);
    view.setUint32(1, kind === 'file' ? 0o100644 : 0o040755, true);
    view.setFloat64(5, size, true);
    view.setFloat64(13, mtime, true);
    view.setFloat64(21, mtime, true);
    view.setFloat64(29, mtime, true);
    view.setUint32(37, this.processUid, true);
    view.setUint32(41, this.processGid, true);
    view.setUint32(45, ino, true);
    return buf;
  }

  // ========== FS Operations ==========

  async read(path: string): Promise<OPFSResult> {
    path = this.normalizePath(path);
    const nav = await this.navigateToParent(path);
    if (!nav) return { status: ENOENT, data: null };
    try {
      const fh = await nav.dir.getFileHandle(nav.name);
      const file = await fh.getFile();
      return { status: OK, data: new Uint8Array(await file.arrayBuffer()) };
    } catch {
      return { status: ENOENT, data: null };
    }
  }

  async write(path: string, data: Uint8Array, _flags?: number): Promise<OPFSResult> {
    path = this.normalizePath(path);
    const parentDir = await this.ensureParent(path);
    if (!parentDir) return { status: ENOENT, data: null };
    const name = path.split('/').filter(Boolean).pop()!;
    try {
      const fh = await parentDir.getFileHandle(name, { create: true });
      const sh = await (fh as any).createSyncAccessHandle();
      try {
        sh.truncate(0);
        if (data.byteLength > 0) sh.write(data, { at: 0 });
        sh.flush();
      } finally {
        sh.close();
      }
      return { status: OK, data: null };
    } catch {
      return { status: ENOENT, data: null };
    }
  }

  async append(path: string, data: Uint8Array): Promise<OPFSResult> {
    path = this.normalizePath(path);
    const parentDir = await this.ensureParent(path);
    if (!parentDir) return { status: ENOENT, data: null };
    const name = path.split('/').filter(Boolean).pop()!;
    try {
      const fh = await parentDir.getFileHandle(name, { create: true });
      const sh = await (fh as any).createSyncAccessHandle();
      try {
        const size: number = sh.getSize();
        sh.write(data, { at: size });
        sh.flush();
      } finally {
        sh.close();
      }
      return { status: OK, data: null };
    } catch {
      return { status: ENOENT, data: null };
    }
  }

  async unlink(path: string): Promise<OPFSResult> {
    path = this.normalizePath(path);
    const nav = await this.navigateToParent(path);
    if (!nav) return { status: ENOENT, data: null };
    try {
      // Verify it exists and is a file
      await nav.dir.getFileHandle(nav.name);
      await nav.dir.removeEntry(nav.name);
      return { status: OK, data: null };
    } catch {
      return { status: ENOENT, data: null };
    }
  }

  async stat(path: string): Promise<OPFSResult> {
    path = this.normalizePath(path);
    const entry = await this.getEntry(path);
    if (!entry) return { status: ENOENT, data: null };
    if (entry.kind === 'file') {
      const file = await (entry.handle as FileSystemFileHandle).getFile();
      return { status: OK, data: this.encodeStat('file', file.size, file.lastModified, this.nextIno++) };
    }
    return { status: OK, data: this.encodeStat('directory', 0, Date.now(), this.nextIno++) };
  }

  async lstat(path: string): Promise<OPFSResult> {
    return this.stat(path);
  }

  async mkdir(path: string, flags: number = 0): Promise<OPFSResult> {
    path = this.normalizePath(path);
    const recursive = (flags & 1) !== 0;

    if (recursive) {
      const parts = path.split('/').filter(Boolean);
      let dir = this.rootDir;
      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create: true });
      }
      return { status: OK, data: encoder.encode(path) };
    }

    const nav = await this.navigateToParent(path);
    if (!nav) return { status: ENOENT, data: null };
    try {
      // Check if already exists
      try {
        await nav.dir.getDirectoryHandle(nav.name);
        return { status: EEXIST, data: null };
      } catch {
        // doesn't exist — create it
      }
      await nav.dir.getDirectoryHandle(nav.name, { create: true });
      return { status: OK, data: encoder.encode(path) };
    } catch {
      return { status: ENOENT, data: null };
    }
  }

  async rmdir(path: string, flags: number = 0): Promise<OPFSResult> {
    path = this.normalizePath(path);
    if (path === '/') return { status: EINVAL, data: null };
    const recursive = (flags & 1) !== 0;
    const nav = await this.navigateToParent(path);
    if (!nav) return { status: ENOENT, data: null };
    try {
      // Verify it's a directory
      await nav.dir.getDirectoryHandle(nav.name);
      await nav.dir.removeEntry(nav.name, { recursive });
      return { status: OK, data: null };
    } catch (err: any) {
      if (err.name === 'InvalidModificationError') return { status: ENOTEMPTY, data: null };
      return { status: ENOENT, data: null };
    }
  }

  async readdir(path: string, flags: number = 0): Promise<OPFSResult> {
    path = this.normalizePath(path);
    const dir = await this.navigateToDir(path);
    if (!dir) return { status: ENOENT, data: null };

    // Verify it's a directory (navigateToDir already guarantees this)
    const withFileTypes = (flags & 1) !== 0;
    const entries: { name: string; kind: string }[] = [];

    for await (const [name, handle] of (dir as any).entries()) {
      entries.push({ name, kind: handle.kind });
    }

    if (withFileTypes) {
      let totalSize = 4;
      const encoded: { nameBytes: Uint8Array; type: number }[] = [];
      for (const e of entries) {
        const nameBytes = encoder.encode(e.name);
        encoded.push({ nameBytes, type: e.kind === 'file' ? TYPE_FILE : TYPE_DIRECTORY });
        totalSize += 2 + nameBytes.byteLength + 1;
      }

      const buf = new Uint8Array(totalSize);
      const view = new DataView(buf.buffer);
      view.setUint32(0, encoded.length, true);
      let offset = 4;
      for (const e of encoded) {
        view.setUint16(offset, e.nameBytes.byteLength, true);
        offset += 2;
        buf.set(e.nameBytes, offset);
        offset += e.nameBytes.byteLength;
        buf[offset++] = e.type;
      }
      return { status: OK, data: buf };
    }

    // Simple name list
    let totalSize = 4;
    const nameEntries: Uint8Array[] = [];
    for (const e of entries) {
      const nameBytes = encoder.encode(e.name);
      nameEntries.push(nameBytes);
      totalSize += 2 + nameBytes.byteLength;
    }

    const buf = new Uint8Array(totalSize);
    const view = new DataView(buf.buffer);
    view.setUint32(0, nameEntries.length, true);
    let offset = 4;
    for (const nameBytes of nameEntries) {
      view.setUint16(offset, nameBytes.byteLength, true);
      offset += 2;
      buf.set(nameBytes, offset);
      offset += nameBytes.byteLength;
    }
    return { status: OK, data: buf };
  }

  async rename(oldPath: string, newPath: string): Promise<OPFSResult> {
    oldPath = this.normalizePath(oldPath);
    newPath = this.normalizePath(newPath);

    const entry = await this.getEntry(oldPath);
    if (!entry) return { status: ENOENT, data: null };

    if (entry.kind === 'file') {
      // File rename: read → write new → delete old
      const fh = entry.handle as FileSystemFileHandle;
      const file = await fh.getFile();
      const data = new Uint8Array(await file.arrayBuffer());
      const writeResult = await this.write(newPath, data);
      if (writeResult.status !== OK) return writeResult;
      await this.unlink(oldPath);
    } else {
      // Directory rename: recursive copy → delete old
      await this.mkdir(newPath, 1);
      await this.copyDirectoryContents(oldPath, newPath);
      await this.rmdir(oldPath, 1);
    }
    return { status: OK, data: null };
  }

  private async copyDirectoryContents(srcPath: string, dstPath: string): Promise<void> {
    const srcDir = await this.navigateToDir(srcPath);
    if (!srcDir) return;

    for await (const [name, handle] of (srcDir as any).entries()) {
      const srcChild = srcPath === '/' ? `/${name}` : `${srcPath}/${name}`;
      const dstChild = dstPath === '/' ? `/${name}` : `${dstPath}/${name}`;

      if (handle.kind === 'directory') {
        await this.mkdir(dstChild, 1);
        await this.copyDirectoryContents(srcChild, dstChild);
      } else {
        const file = await (handle as FileSystemFileHandle).getFile();
        const data = new Uint8Array(await file.arrayBuffer());
        await this.write(dstChild, data);
      }
    }
  }

  async exists(path: string): Promise<OPFSResult> {
    path = this.normalizePath(path);
    const entry = await this.getEntry(path);
    return { status: OK, data: new Uint8Array([entry ? 1 : 0]) };
  }

  async truncate(path: string, len: number): Promise<OPFSResult> {
    path = this.normalizePath(path);
    const nav = await this.navigateToParent(path);
    if (!nav) return { status: ENOENT, data: null };
    try {
      const fh = await nav.dir.getFileHandle(nav.name);
      const sh = await (fh as any).createSyncAccessHandle();
      try {
        sh.truncate(len);
        sh.flush();
      } finally {
        sh.close();
      }
      return { status: OK, data: null };
    } catch {
      return { status: ENOENT, data: null };
    }
  }

  async copy(src: string, dest: string, _flags?: number): Promise<OPFSResult> {
    src = this.normalizePath(src);
    dest = this.normalizePath(dest);
    const readResult = await this.read(src);
    if (readResult.status !== OK) return readResult;
    return this.write(dest, readResult.data ?? new Uint8Array(0));
  }

  async access(path: string, _mode?: number): Promise<OPFSResult> {
    path = this.normalizePath(path);
    const entry = await this.getEntry(path);
    if (!entry) return { status: ENOENT, data: null };
    return { status: OK, data: null };
  }

  async realpath(path: string): Promise<OPFSResult> {
    path = this.normalizePath(path);
    const entry = await this.getEntry(path);
    if (!entry) return { status: ENOENT, data: null };
    return { status: OK, data: encoder.encode(path) };
  }

  // OPFS doesn't support permissions — these are no-ops

  async chmod(path: string, _mode: number): Promise<OPFSResult> {
    path = this.normalizePath(path);
    const entry = await this.getEntry(path);
    if (!entry) return { status: ENOENT, data: null };
    return { status: OK, data: null };
  }

  async chown(path: string, _uid: number, _gid: number): Promise<OPFSResult> {
    path = this.normalizePath(path);
    const entry = await this.getEntry(path);
    if (!entry) return { status: ENOENT, data: null };
    return { status: OK, data: null };
  }

  async utimes(path: string, _atime: number, _mtime: number): Promise<OPFSResult> {
    path = this.normalizePath(path);
    const entry = await this.getEntry(path);
    if (!entry) return { status: ENOENT, data: null };
    return { status: OK, data: null };
  }

  // OPFS has no symlinks or hard links

  async symlink(_target: string, _linkPath: string): Promise<OPFSResult> {
    return { status: EINVAL, data: null };
  }

  async readlink(_path: string): Promise<OPFSResult> {
    return { status: EINVAL, data: null };
  }

  async link(existingPath: string, newPath: string): Promise<OPFSResult> {
    return this.copy(existingPath, newPath);
  }

  // ========== File descriptor operations ==========

  async open(path: string, flags: number, _tabId: string): Promise<OPFSResult> {
    path = this.normalizePath(path);
    const hasCreate = (flags & 64) !== 0;   // O_CREAT
    const hasTrunc = (flags & 512) !== 0;    // O_TRUNC
    const hasExcl = (flags & 128) !== 0;     // O_EXCL

    const parentDir = await this.ensureParent(path);
    if (!parentDir) return { status: ENOENT, data: null };
    const name = path.split('/').filter(Boolean).pop()!;

    try {
      // Check existence
      let exists = true;
      try {
        await parentDir.getFileHandle(name);
      } catch {
        exists = false;
      }

      if (!exists && !hasCreate) return { status: ENOENT, data: null };
      if (exists && hasExcl && hasCreate) return { status: EEXIST, data: null };

      const fh = await parentDir.getFileHandle(name, { create: hasCreate });
      const sh = await (fh as any).createSyncAccessHandle();

      if (hasTrunc) {
        sh.truncate(0);
        sh.flush();
      }

      const fd = this.nextFd++;
      this.fdTable.set(fd, { handle: sh, path, position: 0, flags });

      const buf = new Uint8Array(4);
      new DataView(buf.buffer).setUint32(0, fd, true);
      return { status: OK, data: buf };
    } catch {
      return { status: ENOENT, data: null };
    }
  }

  async close(fd: number): Promise<OPFSResult> {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: EBADF, data: null };
    try { entry.handle.close(); } catch {}
    this.fdTable.delete(fd);
    return { status: OK, data: null };
  }

  async fread(fd: number, length: number, position: number | null): Promise<OPFSResult> {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: EBADF, data: null };

    const pos = position ?? entry.position;
    const size: number = entry.handle.getSize();
    const readLen = Math.min(length, size - pos);
    if (readLen <= 0) return { status: OK, data: new Uint8Array(0) };

    const buf = new Uint8Array(readLen);
    entry.handle.read(buf, { at: pos });

    if (position === null) {
      entry.position += readLen;
    }
    return { status: OK, data: buf };
  }

  async fwrite(fd: number, data: Uint8Array, position: number | null): Promise<OPFSResult> {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: EBADF, data: null };

    const isAppend = (entry.flags & 1024) !== 0; // O_APPEND
    const pos = isAppend ? entry.handle.getSize() : (position ?? entry.position);

    entry.handle.write(data, { at: pos });

    if (position === null) {
      entry.position = pos + data.byteLength;
    }

    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, data.byteLength, true);
    return { status: OK, data: buf };
  }

  async fstat(fd: number): Promise<OPFSResult> {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: EBADF, data: null };

    const size: number = entry.handle.getSize();
    return { status: OK, data: this.encodeStat('file', size, Date.now(), fd) };
  }

  async ftruncate(fd: number, len: number = 0): Promise<OPFSResult> {
    const entry = this.fdTable.get(fd);
    if (!entry) return { status: EBADF, data: null };
    entry.handle.truncate(len);
    entry.handle.flush();
    return { status: OK, data: null };
  }

  async fsync(): Promise<OPFSResult> {
    for (const [, entry] of this.fdTable) {
      try { entry.handle.flush(); } catch {}
    }
    return { status: OK, data: null };
  }

  async opendir(path: string, _tabId: string): Promise<OPFSResult> {
    return this.readdir(path, 1);
  }

  async mkdtemp(prefix: string): Promise<OPFSResult> {
    const random = Math.random().toString(36).substring(2, 8);
    const path = this.normalizePath(prefix + random);
    return this.mkdir(path, 1);
  }
}
