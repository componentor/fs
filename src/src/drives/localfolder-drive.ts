/**
 * Local folder / USB disk — a real directory on the user's machine via the File
 * System Access API. A mounted USB stick is just a picked folder (no web API
 * mounts a USB filesystem directly). The picked handle is stashed in IndexedDB so
 * the disk can be re-attached across reloads (re-prompting for permission).
 */
import type {
  Drive, DriveCapabilities, DriveEntry, DriveReadable, DriveStat, DriveWritable,
} from './types.js'

const HANDLE_DB = 'td-drive-handles'
function norm(p: string): string {
  const parts: string[] = []
  for (const seg of (p || '/').split('/')) { if (!seg || seg === '.') continue; if (seg === '..') parts.pop(); else parts.push(seg) }
  return '/' + parts.join('/')
}
const segs = (p: string) => norm(p).split('/').filter(Boolean)
const baseName = (p: string) => segs(p).slice(-1)[0] || ''
const dirName = (p: string) => '/' + segs(p).slice(0, -1).join('/')
function fsError(code: string, msg: string): Error { const e = new Error(`${code}: ${msg}`); (e as { code?: string }).code = code; return e }

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore('handles') }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function saveHandle(id: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openHandleDb()
  await new Promise<void>((resolve, reject) => { const tx = db.transaction('handles', 'readwrite'); tx.objectStore('handles').put(handle, id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
  db.close()
}
export async function loadHandle(id: string): Promise<FileSystemDirectoryHandle | null> {
  const db = await openHandleDb()
  const h = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => { const r = db.transaction('handles', 'readonly').objectStore('handles').get(id); r.onsuccess = () => resolve((r.result as FileSystemDirectoryHandle) ?? null); r.onerror = () => reject(r.error) })
  db.close()
  return h
}
export async function dropHandle(id: string): Promise<void> {
  const db = await openHandleDb()
  await new Promise<void>((resolve) => { const tx = db.transaction('handles', 'readwrite'); tx.objectStore('handles').delete(id); tx.oncomplete = tx.onerror = () => resolve() as void })
  db.close()
}
export function localFolderSupported(): boolean { return typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function' }
export async function pickDirectory(): Promise<FileSystemDirectoryHandle> {
  const picker = (globalThis as { showDirectoryPicker?: (o?: unknown) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker
  if (!picker) throw fsError('ENOTSUP', 'directory picker not supported')
  return picker({ mode: 'readwrite' })
}

type Perm = 'granted' | 'denied' | 'prompt'

export class LocalFolderDrive implements Drive {
  readonly kind = 'localfolder' as const
  readonly icon = 'usb'
  readonly capabilities: DriveCapabilities = { writable: true, streaming: true, nativeSync: false, watch: false, syncBadges: false }
  state: Drive['state'] = 'disconnected'

  constructor(public readonly id: string, public label: string, private root: FileSystemDirectoryHandle | null) {
    if (root) this.state = 'ready'
  }

  async connect(): Promise<void> {
    if (!this.root) this.root = await loadHandle(this.id)
    if (!this.root) { this.state = 'disconnected'; throw fsError('ENOENT', 'no folder handle; pick a folder') }
    const perm = await this.ensurePermission(true)
    this.state = perm === 'granted' ? 'ready' : 'disconnected'
    if (perm === 'granted') await saveHandle(this.id, this.root)
  }
  private async ensurePermission(request: boolean): Promise<Perm> {
    const h = this.root as unknown as { queryPermission?: (o: unknown) => Promise<Perm>; requestPermission?: (o: unknown) => Promise<Perm> }
    const opt = { mode: 'readwrite' }
    let p: Perm = (await h.queryPermission?.(opt)) ?? 'granted'
    if (p !== 'granted' && request) p = (await h.requestPermission?.(opt)) ?? p
    return p
  }

  private async dirHandle(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    if (!this.root) throw fsError('ENOENT', 'folder not attached')
    let cur = this.root
    for (const seg of segs(path)) cur = await cur.getDirectoryHandle(seg, { create })
    return cur
  }
  private async fileHandle(path: string, create = false): Promise<FileSystemFileHandle> {
    return (await this.dirHandle(dirName(path), create)).getFileHandle(baseName(path), { create })
  }

  async stat(path: string): Promise<DriveStat> {
    if (!segs(path).length) return { type: 'dir', size: 0, mtimeMs: 0, sync: 'local' }
    try { const f = await (await this.fileHandle(path)).getFile(); return { type: 'file', size: f.size, mtimeMs: f.lastModified, sync: 'local' } }
    catch { await this.dirHandle(path); return { type: 'dir', size: 0, mtimeMs: 0, sync: 'local' } }
  }
  async exists(path: string): Promise<boolean> { try { await this.stat(path); return true } catch { return false } }
  async list(path: string): Promise<DriveEntry[]> {
    const dir = await this.dirHandle(path)
    const out: DriveEntry[] = []
    for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (handle.kind === 'directory') out.push({ name, type: 'dir', size: 0, mtimeMs: 0, sync: 'local' })
      else { const f = await (handle as FileSystemFileHandle).getFile(); out.push({ name, type: 'file', size: f.size, mtimeMs: f.lastModified, sync: 'local' }) }
    }
    return out
  }

  async readFile(path: string): Promise<Uint8Array> { return new Uint8Array(await (await (await this.fileHandle(path)).getFile()).arrayBuffer()) }
  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const w = await (await this.fileHandle(path, true) as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable()
    await w.write(data as BufferSource); await w.close()
  }
  async createReadable(path: string): Promise<DriveReadable> {
    const reader = ((await (await this.fileHandle(path)).getFile()).stream() as ReadableStream<Uint8Array>).getReader()
    return { async read() { const { value, done } = await reader.read(); return done ? null : value! }, async close() { try { await reader.cancel() } catch { /* */ } } }
  }
  async createWritable(path: string): Promise<DriveWritable> {
    const w = await (await this.fileHandle(path, true) as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable()
    return { async write(c) { await w.write(c as BufferSource) }, async close() { await w.close() }, async abort(r) { try { await w.abort?.(r) } catch { /* */ } } }
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    if (opts?.recursive) { await this.dirHandle(path, true); return }
    await (await this.dirHandle(dirName(path))).getDirectoryHandle(baseName(path), { create: true })
  }
  async remove(path: string, opts?: { recursive?: boolean }): Promise<void> {
    try { await (await this.dirHandle(dirName(path))).removeEntry(baseName(path), { recursive: opts?.recursive ?? false }) }
    catch (e) { if ((e as { name?: string }).name !== 'NotFoundError') throw e }
  }
  async rename(from: string, to: string): Promise<void> { await this.copy(from, to); await this.remove(from, { recursive: true }) }
  async copy(from: string, to: string): Promise<void> {
    const s = await this.stat(from)
    if (s.type === 'file') { await this.writeFile(to, await this.readFile(from)); return }
    // Copying a dir into its own subtree would recurse forever (list keeps seeing
    // the growing destination) — reject like `cp`. Also guards rename() (= copy+rm).
    const a = norm(from), b = norm(to)
    if (b === a || b.startsWith(a + '/')) throw fsError('EINVAL', `cannot copy a directory into itself, '${from}' -> '${to}'`)
    await this.mkdir(to, { recursive: true })
    for (const e of await this.list(from)) await this.copy(`${from}/${e.name}`, `${to}/${e.name}`)
  }

  async usage(): Promise<{ total: number; used: number } | null> { return null }
  dispose(): void {}
  async destroy(): Promise<void> { await dropHandle(this.id) }
}
