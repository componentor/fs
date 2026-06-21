/**
 * Cloud disk — ONE linked account on Google Drive / Dropbox / OneDrive, brokered
 * by the HOST service (which holds the OAuth tokens encrypted and exposes
 * `${baseUrl}/drives/:connId/*`). The lib never sees a provider token: it just
 * speaks the proxy protocol. Keyed by the backend CONNECTION id so a user can
 * link several accounts per provider. Files live in the provider, so every entry
 * is reported `synced` (badged by the host UI).
 *
 * The proxy contract (all relative to `${baseUrl}/drives/:connId`):
 *   GET  list?path=   → { entries:[{name,type,size,mtimeMs}] }
 *   GET  stat?path=   → { type,size,mtimeMs }
 *   GET  read?path=   → raw bytes
 *   PUT  write?path=  → (raw body)
 *   POST mkdir|remove?path= ; rename|copy?from=&to= ; GET usage
 */
import type {
  Drive, DriveCapabilities, DriveEntry, DriveStat,
} from './types.js'

export type CloudProvider = 'gdrive' | 'dropbox' | 'onedrive'

function norm(p: string): string {
  const parts: string[] = []
  for (const seg of (p || '/').split('/')) { if (!seg || seg === '.') continue; if (seg === '..') parts.pop(); else parts.push(seg) }
  return '/' + parts.join('/')
}
function fsError(code: string, msg: string): Error { const e = new Error(`${code}: ${msg}`); (e as { code?: string }).code = code; return e }

interface RemoteEntry { name: string; type: 'file' | 'dir'; size: number; mtimeMs: number }

export interface CloudDriveOptions {
  id: string
  label: string
  provider: CloudProvider
  /** host service base URL (no trailing slash). */
  baseUrl: string
  /** backend connection id (the linked account). */
  connectionId: string
  /** icon key for the UI (defaults per provider). */
  icon?: string
  /** custom fetch (defaults to global fetch with credentials:'include'). */
  fetch?: typeof fetch
}

const DEFAULT_ICON: Record<CloudProvider, string> = { gdrive: 'gdrive', dropbox: 'dropbox', onedrive: 'onedrive' }

export class CloudDrive implements Drive {
  readonly id: string
  label: string
  readonly kind: Drive['kind']
  readonly icon: string
  readonly capabilities: DriveCapabilities = { writable: true, streaming: false, nativeSync: false, watch: false, syncBadges: true }
  state: Drive['state'] = 'disconnected'

  private base: string
  private connId: string
  readonly provider: CloudProvider
  private _fetch: typeof fetch

  constructor(opts: CloudDriveOptions) {
    this.id = opts.id
    this.label = opts.label
    this.provider = opts.provider
    this.kind = opts.provider
    this.icon = opts.icon || DEFAULT_ICON[opts.provider]
    this.base = opts.baseUrl.replace(/\/$/, '')
    this.connId = opts.connectionId
    const f = opts.fetch || globalThis.fetch.bind(globalThis)
    this._fetch = ((input: any, init?: any) => f(input, { credentials: 'include', ...init })) as typeof fetch
  }

  async connect(): Promise<void> {
    try { await this.list('/'); this.state = 'ready' }
    catch (e) { this.state = (e as { code?: string }).code === 'EAUTH' ? 'disconnected' : 'error'; throw e }
  }

  private url(op: string, q?: Record<string, string>): string {
    const u = new URL(`${this.base}/drives/${this.connId}/${op}`)
    if (q) for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v)
    return u.toString()
  }
  private async api<T>(op: string, init?: RequestInit, q?: Record<string, string>): Promise<T> {
    const res = await this._fetch(this.url(op, q), init)
    if (res.status === 401) { this.state = 'disconnected'; throw fsError('EAUTH', 'cloud session expired; reconnect') }
    if (res.status === 404) throw fsError('ENOENT', 'not found')
    if (!res.ok) throw fsError('EIO', `cloud ${op} failed (${res.status})`)
    return res.json() as Promise<T>
  }

  async stat(path: string): Promise<DriveStat> {
    const r = await this.api<RemoteEntry>('stat', undefined, { path: norm(path) })
    return { type: r.type, size: r.size, mtimeMs: r.mtimeMs, sync: 'synced' }
  }
  async exists(path: string): Promise<boolean> { try { await this.stat(path); return true } catch { return false } }
  async list(path: string): Promise<DriveEntry[]> {
    const r = await this.api<{ entries: RemoteEntry[] }>('list', undefined, { path: norm(path) })
    return r.entries.map((x) => ({ name: x.name, type: x.type, size: x.size, mtimeMs: x.mtimeMs, sync: 'synced' }))
  }

  async readFile(path: string): Promise<Uint8Array> {
    const res = await this._fetch(this.url('read', { path: norm(path) }))
    if (res.status === 401) { this.state = 'disconnected'; throw fsError('EAUTH', 'cloud session expired; reconnect') }
    if (!res.ok) throw fsError('EIO', `cloud read failed (${res.status})`)
    return new Uint8Array(await res.arrayBuffer())
  }
  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const res = await this._fetch(this.url('write', { path: norm(path) }), { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Blob([data as BlobPart]) })
    if (res.status === 401) { this.state = 'disconnected'; throw fsError('EAUTH', 'cloud session expired; reconnect') }
    if (!res.ok) throw fsError('EIO', `cloud write failed (${res.status})`)
  }

  async mkdir(path: string): Promise<void> { await this.api('mkdir', { method: 'POST' }, { path: norm(path) }) }
  async remove(path: string): Promise<void> { await this.api('remove', { method: 'POST' }, { path: norm(path) }) }
  async rename(from: string, to: string): Promise<void> { await this.api('rename', { method: 'POST' }, { from: norm(from), to: norm(to) }) }
  async copy(from: string, to: string): Promise<void> { await this.api('copy', { method: 'POST' }, { from: norm(from), to: norm(to) }) }
  async usage(): Promise<{ total: number; used: number } | null> { try { return await this.api('usage') } catch { return null } }
}
