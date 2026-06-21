/**
 * SyncEngine — mirror a folder on one drive into a folder on another (typically a
 * cloud/remote drive ↔ a local OPFS-backed cache), one-way or two-way, emitting a
 * per-path `SyncStatus` the UI badges. Works on ANY pair of drives (uses only the
 * `Drive` interface).
 *
 * Change detection uses a manifest (rel → { rMtime, lMtime, size }) persisted in
 * the LOCAL drive at `<localPath>/.tdsync.json`. Because writing a file changes
 * the destination's mtime, we store BOTH sides' observed mtimes after each sync
 * and flag a side "changed" when its CURRENT mtime differs from the stored one —
 * so a copy doesn't look like an edit on the next pass.
 */
import type { Drive, EntryType, SyncStatus } from './types.js'

export type SyncDirection = 'pull' | 'push' | 'two-way'

export interface SyncOptions {
  direction?: SyncDirection // default 'two-way'
  onStatus?: (relPath: string, status: SyncStatus) => void
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

export interface SyncResult {
  downloaded: number
  uploaded: number
  deleted: number
  conflicts: string[]
  errors: Array<{ path: string; error: string }>
}

interface ManifestEntry { rMtime: number; lMtime: number; size: number }
type Manifest = Record<string, ManifestEntry>

const MANIFEST = '.tdsync.json'
function join(dir: string, rel: string): string { if (!rel) return dir; return dir === '/' ? '/' + rel : dir.replace(/\/$/, '') + '/' + rel }

interface WalkEntry { rel: string; type: EntryType; size: number; mtime: number }

export class SyncEngine {
  /** live per-path status (rel → status), readable by the UI between syncs. */
  readonly statuses = new Map<string, SyncStatus>()
  private running = false

  constructor(
    private remote: Drive,
    private remotePath: string,
    private local: Drive,
    private localPath: string,
  ) {}

  status(rel: string): SyncStatus { return this.statuses.get(rel) || 'local' }

  async sync(opts: SyncOptions = {}): Promise<SyncResult> {
    if (this.running) throw new Error('sync already running')
    this.running = true
    const direction = opts.direction || 'two-way'
    const set = (rel: string, s: SyncStatus) => { this.statuses.set(rel, s); opts.onStatus?.(rel, s) }
    const result: SyncResult = { downloaded: 0, uploaded: 0, deleted: 0, conflicts: [], errors: [] }
    try {
      await this.local.mkdir(this.localPath, { recursive: true })
      const manifest = await this.readManifest()

      const [remoteList, localList] = await Promise.all([
        this.walk(this.remote, this.remotePath),
        this.walk(this.local, this.localPath),
      ])
      const rMap = new Map(remoteList.map((e) => [e.rel, e]))
      const lMap = new Map(localList.map((e) => [e.rel, e]))
      const rels = [...new Set([...rMap.keys(), ...lMap.keys()])].filter((r) => r !== MANIFEST).sort()

      let done = 0
      for (const rel of rels) {
        if (opts.signal?.aborted) throw Object.assign(new Error('sync aborted'), { name: 'AbortError' })
        const r = rMap.get(rel), l = lMap.get(rel), m = manifest[rel]
        try {
          // Directories: ensure they exist on both sides (per direction).
          if (r?.type === 'dir' || l?.type === 'dir') {
            if (!l && r && direction !== 'push') await this.local.mkdir(join(this.localPath, rel), { recursive: true })
            if (!r && l && direction !== 'pull') await this.remote.mkdir(join(this.remotePath, rel), { recursive: true })
            done++; opts.onProgress?.(done, rels.length); continue
          }
          const rChanged = !!r && (!m || r.mtime !== m.rMtime || r.size !== m.size)
          const lChanged = !!l && (!m || l.mtime !== m.lMtime || l.size !== m.size)

          if (r && l) {
            if (rChanged && lChanged) {
              // Both edited since last sync → conflict; newer mtime wins, loser kept.
              if (direction === 'two-way') { set(rel, 'conflict'); result.conflicts.push(rel) }
              else if (direction === 'pull') { await this.download(rel, manifest, set); result.downloaded++ }
              else { await this.upload(rel, manifest, set); result.uploaded++ }
            } else if (rChanged && direction !== 'push') { await this.download(rel, manifest, set); result.downloaded++ }
            else if (lChanged && direction !== 'pull') { await this.upload(rel, manifest, set); result.uploaded++ }
            else set(rel, 'synced')
          } else if (r && !l) {
            // Remote-only: a brand-new remote file (pull) or a local deletion to propagate (push/two-way).
            if (m && direction !== 'pull') { await this.remote.remove(join(this.remotePath, rel), { recursive: true }); delete manifest[rel]; result.deleted++; this.statuses.delete(rel) }
            else if (direction !== 'push') { await this.download(rel, manifest, set); result.downloaded++ }
          } else if (l && !r) {
            if (m && direction !== 'push') { await this.local.remove(join(this.localPath, rel), { recursive: true }); delete manifest[rel]; result.deleted++; this.statuses.delete(rel) }
            else if (direction !== 'pull') { await this.upload(rel, manifest, set); result.uploaded++ }
          }
        } catch (e) {
          set(rel, 'error')
          result.errors.push({ path: rel, error: (e as Error).message })
        }
        done++; opts.onProgress?.(done, rels.length)
      }

      await this.writeManifest(manifest)
      return result
    } finally {
      this.running = false
    }
  }

  private async download(rel: string, manifest: Manifest, set: (r: string, s: SyncStatus) => void): Promise<void> {
    set(rel, 'downloading')
    const rp = join(this.remotePath, rel), lp = join(this.localPath, rel)
    await this.local.mkdir(parentRel(lp), { recursive: true })
    await this.local.writeFile(lp, await this.remote.readFile(rp))
    await this.record(rel, manifest)
    set(rel, 'synced')
  }
  private async upload(rel: string, manifest: Manifest, set: (r: string, s: SyncStatus) => void): Promise<void> {
    set(rel, 'uploading')
    const rp = join(this.remotePath, rel), lp = join(this.localPath, rel)
    await this.remote.mkdir(parentRel(rp), { recursive: true })
    await this.remote.writeFile(rp, await this.local.readFile(lp))
    await this.record(rel, manifest)
    set(rel, 'synced')
  }
  /** Re-stat both sides after an op and store their current mtimes/size. */
  private async record(rel: string, manifest: Manifest): Promise<void> {
    const [r, l] = await Promise.all([
      this.remote.stat(join(this.remotePath, rel)).catch(() => null),
      this.local.stat(join(this.localPath, rel)).catch(() => null),
    ])
    manifest[rel] = { rMtime: r?.mtimeMs || 0, lMtime: l?.mtimeMs || 0, size: l?.size ?? r?.size ?? 0 }
  }

  private async readManifest(): Promise<Manifest> {
    try { return JSON.parse(new TextDecoder().decode(await this.local.readFile(join(this.localPath, MANIFEST)))) as Manifest }
    catch { return {} }
  }
  private async writeManifest(m: Manifest): Promise<void> {
    await this.local.writeFile(join(this.localPath, MANIFEST), new TextEncoder().encode(JSON.stringify(m)))
  }

  /** Depth-first relative listing of a tree (paths relative to `root`). */
  private async walk(drive: Drive, root: string): Promise<WalkEntry[]> {
    const out: WalkEntry[] = []
    const stack: string[] = ['']
    while (stack.length) {
      const rel = stack.pop()!
      let entries
      try { entries = await drive.list(rel ? join(root, rel) : root) } catch { continue }
      for (const e of entries) {
        const childRel = rel ? `${rel}/${e.name}` : e.name
        if (e.type === 'dir') { out.push({ rel: childRel, type: 'dir', size: 0, mtime: e.mtimeMs }); stack.push(childRel) }
        else out.push({ rel: childRel, type: e.type, size: e.size, mtime: e.mtimeMs })
      }
    }
    return out
  }
}

function parentRel(p: string): string { const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i) }
