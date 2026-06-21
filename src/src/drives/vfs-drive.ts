/**
 * VfsDrive — exposes a `VFSFileSystem` (the OPFS-backed VFS engine) as a `Drive`.
 * This is the Phase-2 bridge: instead of refactoring the SAB/OPFS engine behind a
 * block-backend seam, we wrap its existing async API. One VfsDrive = one disk;
 * pass a sub-`root` to scope a disk to a sub-tree (multiple independent OPFS
 * disks), or a separately-configured `VFSFileSystem` for a different medium.
 *
 * Unlike the leaf drives, this one DOES import the engine (it's the bridge) and
 * it honours `EntryType: 'symlink'` — the VFS has real symlinks (lstat/readlink),
 * so they surface here rather than being flattened to files.
 */
import type { VFSFileSystem } from '../filesystem.js'
import type {
  Drive, DriveCapabilities, DriveEntry, DriveReadable, DriveStat, DriveWritable, EntryType,
} from './types.js'

function norm(p: string): string {
  const parts: string[] = []
  for (const seg of (p || '/').split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return '/' + parts.join('/')
}
function join(dir: string, name: string): string { return dir === '/' ? '/' + name : dir + '/' + name }

interface StatLike { size: number; mtimeMs: number; ctimeMs?: number; isDirectory(): boolean; isSymbolicLink?(): boolean }
interface DirentLike { name: string; isDirectory(): boolean; isSymbolicLink?(): boolean }

export class VfsDrive implements Drive {
  readonly kind: Drive['kind']
  readonly icon: string
  readonly capabilities: DriveCapabilities = { writable: true, streaming: false, nativeSync: true, watch: false, syncBadges: false }
  state: Drive['state'] = 'ready'

  /**
   * @param id     drive id
   * @param label  sidebar label
   * @param vfs    the VFS engine instance
   * @param root   kernel root for this disk ("/" = whole VFS; "/Volumes/x" scoped)
   * @param scoped marks a scoped sub-tree disk (icon/kind differ)
   */
  constructor(
    public readonly id: string,
    public label: string,
    private vfs: VFSFileSystem,
    private root = '/',
    scoped = false,
  ) {
    this.root = norm(root)
    this.kind = 'opfs'
    this.icon = scoped ? 'hard-drive' : 'hard-drive'
  }

  private get p(): any { return (this.vfs as any).promises }
  private abs(path: string): string {
    const rel = norm(path)
    return this.root === '/' ? rel : rel === '/' ? this.root : this.root + rel
  }
  private entryType(s: StatLike): EntryType { return s.isSymbolicLink?.() ? 'symlink' : s.isDirectory() ? 'dir' : 'file' }

  /** Ensure the scoped root exists (no-op for the whole-VFS disk). */
  async ensureRoot(): Promise<void> {
    if (this.root !== '/') await this.p.mkdir(this.root, { recursive: true })
  }

  async stat(path: string): Promise<DriveStat> {
    const s: StatLike = await this.p.lstat(this.abs(path))
    return { type: this.entryType(s), size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, sync: 'local' }
  }
  async exists(path: string): Promise<boolean> {
    try { await this.p.lstat(this.abs(path)); return true } catch { return false }
  }
  async list(path: string): Promise<DriveEntry[]> {
    const ents: DirentLike[] = await this.p.readdir(this.abs(path), { withFileTypes: true })
    const out: DriveEntry[] = []
    for (const d of ents) {
      let size = 0, mtimeMs = 0, ctimeMs: number | undefined
      try { const s: StatLike = await this.p.lstat(join(this.abs(path), d.name)); size = s.size; mtimeMs = s.mtimeMs; ctimeMs = s.ctimeMs } catch { /* race */ }
      out.push({ name: d.name, type: this.entryType(d as unknown as StatLike), size, mtimeMs, ctimeMs, sync: 'local' })
    }
    return out
  }

  async readFile(path: string): Promise<Uint8Array> {
    const d = await this.p.readFile(this.abs(path))
    return d instanceof Uint8Array ? new Uint8Array(d) : new Uint8Array(d as ArrayBuffer)
  }
  async writeFile(path: string, data: Uint8Array): Promise<void> { await this.p.writeFile(this.abs(path), data) }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> { await this.p.mkdir(this.abs(path), { recursive: opts?.recursive ?? false }) }
  async remove(path: string, opts?: { recursive?: boolean }): Promise<void> { await this.p.rm(this.abs(path), { recursive: opts?.recursive ?? false, force: true }) }
  async rename(from: string, to: string): Promise<void> { await this.p.rename(this.abs(from), this.abs(to)) }
  async copy(from: string, to: string): Promise<void> { await this.p.cp(this.abs(from), this.abs(to), { recursive: true }) }

  async usage(): Promise<{ total: number; used: number } | null> {
    try { const s = await this.p.statfs(this.abs('/')); const total = s.blocks * s.bsize; return { total, used: total - s.bfree * s.bsize } }
    catch { return null }
  }

  // Streaming over the buffered engine API (keeps the Drive contract complete).
  async createReadable(path: string): Promise<DriveReadable> {
    const data = await this.readFile(path)
    let done = false
    return { async read() { if (done) return null; done = true; return data }, async close() {} }
  }
  async createWritable(path: string): Promise<DriveWritable> {
    const chunks: Uint8Array[] = []
    const self = this
    return {
      async write(c) { chunks.push(c) },
      async close() { let n = 0; for (const c of chunks) n += c.byteLength; const b = new Uint8Array(n); let o = 0; for (const c of chunks) { b.set(c, o); o += c.byteLength } await self.writeFile(path, b) },
      async abort() { chunks.length = 0 },
    }
  }
}
