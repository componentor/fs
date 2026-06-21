/**
 * TreeDrive — a complete in-RAM POSIX tree (Map<path, node>, each dir carrying a
 * `children` set so list/remove/rename touch only a subtree) implementing the
 * full `Drive` surface. Subclasses (localStorage, IndexedDB) override
 * `hydrate()` + `commit(puts, dels)` to mirror the tree into a durable store
 * incrementally (only changed/removed records per flush); the path/tree logic
 * lives here once. `MemoryDrive` is just this base with the no-op default store.
 */
import type {
  Drive, DriveCapabilities, DriveEntry, DriveReadable, DriveStat, DriveWritable,
} from './types.js'

export interface FileNode { type: 'file'; data: Uint8Array; mtimeMs: number; ctimeMs: number }
export interface DirNode { type: 'dir'; mtimeMs: number; ctimeMs: number; children: Set<string> }
export type TreeNode = FileNode | DirNode

function norm(p: string): string {
  const parts: string[] = []
  for (const seg of (p || '/').split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return '/' + parts.join('/')
}
const dirname = (p: string) => { const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i) }
const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const childPath = (dir: string, name: string) => (dir === '/' ? '/' + name : dir + '/' + name)
function fsError(code: string, msg: string): Error { const e = new Error(`${code}: ${msg}`); (e as { code?: string }).code = code; return e }

export abstract class TreeDrive implements Drive {
  abstract readonly kind: Drive['kind']
  abstract readonly icon: string
  readonly capabilities: DriveCapabilities = { writable: true, streaming: true, nativeSync: false, watch: false, syncBadges: false }
  state: Drive['state'] = 'ready'

  protected nodes = new Map<string, TreeNode>()
  protected now = () => Date.now()

  constructor(public readonly id: string, public label: string) {
    this.nodes.set('/', { type: 'dir', mtimeMs: this.now(), ctimeMs: this.now(), children: new Set() })
  }

  /**
   * Load the whole node set from the backing store into `this.nodes` (records
   * only — the base rebuilds dir `children` sets centrally in `ready()`). Default:
   * no-op (a pure RAM disk).
   */
  protected async hydrate(): Promise<void> {}
  /**
   * Commit just what changed since the last flush: write/replace every node at a
   * path in `puts`, delete every path in `dels`. Default: no-op. This is the seam
   * that makes a single small write touch a single record, not the whole tree.
   */
  protected async commit(_puts: Set<string>, _dels: Set<string>): Promise<void> {}

  // Paths changed/removed since the last flush (mutually exclusive per path).
  private dirtyPuts = new Set<string>()
  private dirtyDels = new Set<string>()
  private markPut(p: string): void { this.dirtyDels.delete(p); this.dirtyPuts.add(p) }
  private markDel(p: string): void { this.dirtyPuts.delete(p); this.dirtyDels.add(p) }

  /** >0 while a multi-step op (copy / batch) is in flight — coalesces its writes
   *  into a single commit instead of one store round-trip per file. */
  private suspend = 0
  private async save(): Promise<void> {
    if (this.suspend !== 0) return
    if (this.dirtyPuts.size === 0 && this.dirtyDels.size === 0) return
    const puts = this.dirtyPuts, dels = this.dirtyDels
    this.dirtyPuts = new Set(); this.dirtyDels = new Set()
    await this.commit(puts, dels)
  }
  /**
   * Run `fn` with persistence suspended, then commit once. Lets a caller (e.g.
   * `DriveManager.transfer`) collapse a whole burst of writes into a single
   * commit. Nests safely; commits on the outermost exit even if `fn` throws.
   */
  async batch<T>(fn: () => Promise<T>): Promise<T> {
    this.suspend++
    try { return await fn() }
    finally { this.suspend--; await this.save() }
  }
  // Memoised so concurrent ops await the SAME hydration — otherwise a second call
  // arriving mid-`hydrate()` (async IndexedDB) would see a half-built tree.
  private readyOnce: Promise<void> | null = null
  protected ready(): Promise<void> {
    if (!this.readyOnce) {
      this.readyOnce = (async () => {
        try { await this.hydrate() } catch { /* fresh store */ }
        if (!this.nodes.has('/')) this.nodes.set('/', { type: 'dir', mtimeMs: this.now(), ctimeMs: this.now(), children: new Set() })
        this.rebuildChildren()
      })()
    }
    return this.readyOnce
  }
  /** Reconstruct every dir's `children` set from the flat path set (the store
   *  persists records, not edges) — so subclasses' `hydrate` only loads nodes. */
  private rebuildChildren(): void {
    for (const n of this.nodes.values()) if (n.type === 'dir') n.children.clear()
    for (const p of this.nodes.keys()) {
      if (p === '/') continue
      const parent = this.nodes.get(dirname(p))
      if (parent?.type === 'dir') parent.children.add(basename(p))
    }
  }

  private link(p: string, node: TreeNode): void {
    this.nodes.set(p, node)
    this.markPut(p)
    if (p === '/') return
    const parent = this.nodes.get(dirname(p))
    if (parent?.type === 'dir') parent.children.add(basename(p))
  }
  private unlink(p: string): void {
    this.nodes.delete(p)
    this.markDel(p)
    if (p === '/') return
    const parent = this.nodes.get(dirname(p))
    if (parent?.type === 'dir') parent.children.delete(basename(p))
  }
  private descendants(dir: string): string[] {
    const out: string[] = []
    const stack = [dir]
    while (stack.length) {
      const d = stack.pop()!
      const node = this.nodes.get(d)
      if (node?.type !== 'dir') continue
      for (const name of node.children) { const c = childPath(d, name); out.push(c); stack.push(c) }
    }
    return out
  }
  private requireDirOf(p: string): void {
    const d = this.nodes.get(dirname(p))
    if (!d) throw fsError('ENOENT', `no such file or directory, '${dirname(p)}'`)
    if (d.type !== 'dir') throw fsError('ENOTDIR', `not a directory, '${dirname(p)}'`)
  }

  async stat(path: string): Promise<DriveStat> {
    await this.ready()
    const n = this.nodes.get(norm(path))
    if (!n) throw fsError('ENOENT', `no such file or directory, '${path}'`)
    return { type: n.type, size: n.type === 'file' ? n.data.byteLength : 0, mtimeMs: n.mtimeMs, ctimeMs: n.ctimeMs, sync: 'local' }
  }
  async exists(path: string): Promise<boolean> { await this.ready(); return this.nodes.has(norm(path)) }

  async list(path: string): Promise<DriveEntry[]> {
    await this.ready()
    const dir = norm(path)
    const n = this.nodes.get(dir)
    if (!n) throw fsError('ENOENT', `no such file or directory, '${path}'`)
    if (n.type !== 'dir') throw fsError('ENOTDIR', `not a directory, '${path}'`)
    const out: DriveEntry[] = []
    for (const name of n.children) {
      const node = this.nodes.get(childPath(dir, name))!
      out.push({ name, type: node.type, size: node.type === 'file' ? node.data.byteLength : 0, mtimeMs: node.mtimeMs, ctimeMs: node.ctimeMs, sync: 'local' })
    }
    return out
  }

  async readFile(path: string): Promise<Uint8Array> {
    await this.ready()
    const n = this.nodes.get(norm(path))
    if (!n) throw fsError('ENOENT', `no such file or directory, '${path}'`)
    if (n.type !== 'file') throw fsError('EISDIR', `illegal operation on a directory, '${path}'`)
    return n.data.slice()
  }
  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await this.ready()
    const target = norm(path)
    this.requireDirOf(target)
    const existing = this.nodes.get(target)
    if (existing?.type === 'dir') throw fsError('EISDIR', `illegal operation on a directory, '${path}'`)
    this.link(target, { type: 'file', data: data.slice(), mtimeMs: this.now(), ctimeMs: existing?.ctimeMs ?? this.now() })
    await this.save()
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    await this.ready()
    const segs = norm(path).split('/').filter(Boolean)
    let cur = ''
    for (let i = 0; i < segs.length; i++) {
      cur += '/' + segs[i]
      const ex = this.nodes.get(cur)
      if (ex) { if (ex.type !== 'dir') throw fsError('ENOTDIR', `not a directory, '${cur}'`); continue }
      if (!opts?.recursive && i < segs.length - 1) throw fsError('ENOENT', `no such file or directory, '${cur}'`)
      this.link(cur, { type: 'dir', mtimeMs: this.now(), ctimeMs: this.now(), children: new Set() })
    }
    await this.save()
  }

  async remove(path: string, opts?: { recursive?: boolean }): Promise<void> {
    await this.ready()
    const target = norm(path)
    const n = this.nodes.get(target)
    if (!n) return
    if (n.type === 'dir') {
      const desc = this.descendants(target)
      if (desc.length && !opts?.recursive) throw fsError('ENOTEMPTY', `directory not empty, '${path}'`)
      for (const c of desc) { this.nodes.delete(c); this.markDel(c) }
    }
    this.unlink(target)
    await this.save()
  }

  async rename(from: string, to: string): Promise<void> {
    await this.ready()
    const a = norm(from), b = norm(to)
    const n = this.nodes.get(a)
    if (!n) throw fsError('ENOENT', `no such file or directory, '${from}'`)
    if (a === b) return
    this.requireDirOf(b)
    if (n.type === 'dir' && b.startsWith(a + '/')) throw fsError('EINVAL', `invalid argument, rename '${from}' -> '${to}'`)
    // One commit for the whole move (the inner overwrite-remove included).
    this.suspend++
    try {
      if (this.nodes.has(b)) await this.remove(b, { recursive: true })
      const desc = n.type === 'dir' ? this.descendants(a) : []
      const grafts: [string, TreeNode][] = desc.map((p) => [b + p.slice(a.length), this.nodes.get(p)!] as [string, TreeNode])
      // Detach old: unlink(a) removes a from its OLD parent's children + deletes the
      // node; the descendant nodes are just dropped from the map (their parent links
      // live inside the moved subtree and are restored below).
      this.unlink(a)
      for (const p of desc) { this.nodes.delete(p); this.markDel(p) }
      // Attach new: link(b) registers b with its NEW parent; descendants keep their
      // own (basename-keyed) children sets, so just re-key them at the new paths.
      this.link(b, n)
      for (const [p, node] of grafts) { this.nodes.set(p, node); this.markPut(p) }
      n.mtimeMs = this.now()
    } finally { this.suspend--; await this.save() }
  }

  async copy(from: string, to: string): Promise<void> {
    await this.ready()
    const a = norm(from), b = norm(to)
    if (!this.nodes.has(a)) throw fsError('ENOENT', `no such file or directory, '${from}'`)
    // Copying a dir onto itself or into its own subtree recurses forever as `list`
    // keeps re-seeing the growing destination — reject like `cp` does.
    if (this.nodes.get(a)!.type === 'dir' && (b === a || b.startsWith(a + '/'))) {
      throw fsError('EINVAL', `cannot copy a directory into itself, '${from}' -> '${to}'`)
    }
    // Coalesce the whole subtree into ONE commit (else N files → N store writes).
    this.suspend++
    try { await this.copyInto(a, b) } finally { this.suspend-- }
    await this.save()
  }
  private async copyInto(a: string, b: string): Promise<void> {
    const n = this.nodes.get(a)!
    if (n.type === 'file') { await this.writeFile(b, n.data); return }
    await this.mkdir(b, { recursive: true })
    for (const e of await this.list(a)) await this.copyInto(childPath(a, e.name), childPath(b, e.name))
  }

  async createReadable(path: string): Promise<DriveReadable> {
    const data = await this.readFile(path)
    let done = false
    return { async read() { if (done) return null; done = true; return data }, async close() {} }
  }
  async createWritable(path: string): Promise<DriveWritable> {
    const chunks: Uint8Array[] = []
    const self = this
    return {
      async write(c) { chunks.push(c.slice()) },
      async close() { let n = 0; for (const c of chunks) n += c.byteLength; const b = new Uint8Array(n); let o = 0; for (const c of chunks) { b.set(c, o); o += c.byteLength } await self.writeFile(path, b) },
      async abort() { chunks.length = 0 },
    }
  }

  async usage(): Promise<{ total: number; used: number } | null> {
    await this.ready()
    let used = 0
    for (const n of this.nodes.values()) if (n.type === 'file') used += n.data.byteLength
    return { total: this.quotaBytes(), used }
  }
  protected quotaBytes(): number { return 0 }
  dispose(): void { this.nodes.clear() }
}
