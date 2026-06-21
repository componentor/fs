/**
 * localStorage disk — a TreeDrive mirrored into localStorage, ONE key per path
 * (`td.drive.ls.<id>:<path>`) so a single write touches a single key instead of
 * re-serialising the whole tree. Small (~5 MB origin budget) but persistent and
 * synchronous; file bytes are base64'd in each entry.
 */
import { TreeDrive, type TreeNode } from './tree-drive.js'

interface SerNode { t: 'file' | 'dir'; m: number; c: number; d?: string }

function toB64(u: Uint8Array): string {
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < u.length; i += CH) s += String.fromCharCode(...u.subarray(i, i + CH))
  return btoa(s)
}
function fromB64(b: string): Uint8Array {
  const s = atob(b)
  const u = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i)
  return u
}

export class LocalStorageDrive extends TreeDrive {
  readonly kind = 'localstorage' as const
  readonly icon = 'database'
  private prefix: string

  constructor(id: string, label = 'localStorage') {
    super(id, label)
    this.prefix = `td.drive.ls.${id}:`
  }

  protected override quotaBytes(): number { return 5 * 1024 * 1024 }

  private keys(): string[] {
    const out: string[] = []
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(this.prefix)) out.push(k) }
    return out
  }

  protected override async hydrate(): Promise<void> {
    const keys = this.keys()
    if (!keys.length) return
    this.nodes.clear() // the base rebuilds dir children from the path set
    for (const k of keys) {
      const raw = localStorage.getItem(k)
      if (!raw) continue
      const n = JSON.parse(raw) as SerNode
      const path = k.slice(this.prefix.length)
      this.nodes.set(path, n.t === 'file'
        ? { type: 'file', data: n.d ? fromB64(n.d) : new Uint8Array(0), mtimeMs: n.m, ctimeMs: n.c }
        : { type: 'dir', mtimeMs: n.m, ctimeMs: n.c, children: new Set() })
    }
  }

  /** Incremental: write only changed keys, remove only deleted ones. */
  protected override async commit(puts: Set<string>, dels: Set<string>): Promise<void> {
    try {
      for (const p of dels) localStorage.removeItem(this.prefix + p)
      for (const p of puts) {
        const n = (this.nodes as Map<string, TreeNode>).get(p)
        if (!n) continue
        const ser: SerNode = n.type === 'file'
          ? { t: 'file', m: n.mtimeMs, c: n.ctimeMs, d: toB64(n.data) }
          : { t: 'dir', m: n.mtimeMs, c: n.ctimeMs }
        localStorage.setItem(this.prefix + p, JSON.stringify(ser))
      }
    } catch (e) {
      throw Object.assign(new Error('ENOSPC: localStorage quota exceeded'), { code: 'ENOSPC', cause: e })
    }
  }

  override dispose(): void { this.nodes.clear() }
  /** Wipe persisted contents (when the user removes the disk). */
  async destroy(): Promise<void> { try { for (const k of this.keys()) localStorage.removeItem(k) } catch { /* ignore */ } this.nodes.clear() }
}
