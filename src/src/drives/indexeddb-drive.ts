/**
 * IndexedDB disk — a TreeDrive mirrored into an IDB object store (one record per
 * path). Persistent, large, works WITHOUT cross-origin isolation / OPFS. File
 * bytes are stored as native Uint8Array (no base64).
 */
import { TreeDrive, type TreeNode } from './tree-drive.js'

interface IdbRec { path: string; t: 'file' | 'dir'; m: number; c: number; d?: Uint8Array }

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore('nodes', { keyPath: 'path' }) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error) })
}

export class IndexedDbDrive extends TreeDrive {
  readonly kind = 'indexeddb' as const
  readonly icon = 'database'
  private dbName: string
  private db: IDBDatabase | null = null

  constructor(id: string, label = 'IndexedDB') {
    super(id, label)
    this.dbName = `td-drive-idb-${id}`
  }

  private async getDb(): Promise<IDBDatabase> { if (!this.db) this.db = await openDb(this.dbName); return this.db }

  protected override async hydrate(): Promise<void> {
    const db = await this.getDb()
    const recs = await new Promise<IdbRec[]>((resolve, reject) => {
      const req = db.transaction('nodes', 'readonly').objectStore('nodes').getAll()
      req.onsuccess = () => resolve(req.result as IdbRec[])
      req.onerror = () => reject(req.error)
    })
    if (!recs.length) return
    this.nodes.clear() // the base rebuilds dir children from the path set
    for (const r of recs) {
      this.nodes.set(r.path, r.t === 'file'
        ? { type: 'file', data: r.d ?? new Uint8Array(0), mtimeMs: r.m, ctimeMs: r.c }
        : { type: 'dir', mtimeMs: r.m, ctimeMs: r.c, children: new Set() })
    }
  }

  /** Incremental: write only changed records, delete only removed ones — one tx. */
  protected override async commit(puts: Set<string>, dels: Set<string>): Promise<void> {
    const db = await this.getDb()
    const tx = db.transaction('nodes', 'readwrite')
    const store = tx.objectStore('nodes')
    for (const p of dels) store.delete(p)
    for (const p of puts) {
      const n = (this.nodes as Map<string, TreeNode>).get(p)
      if (!n) continue
      store.put(n.type === 'file'
        ? { path: p, t: 'file', m: n.mtimeMs, c: n.ctimeMs, d: n.data }
        : { path: p, t: 'dir', m: n.mtimeMs, c: n.ctimeMs })
    }
    await txDone(tx)
  }

  override dispose(): void { this.db?.close(); this.db = null; this.nodes.clear() }
  async destroy(): Promise<void> {
    this.dispose()
    await new Promise<void>((resolve) => { const r = indexedDB.deleteDatabase(this.dbName); r.onsuccess = r.onerror = () => resolve() })
  }
}
