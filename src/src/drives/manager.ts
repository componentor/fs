/**
 * DriveManager — the registry the Finder talks to, plus the one generic
 * cross-drive copy/move engine. It only ever uses the `Drive` interface, so any
 * pair of drives (OPFS↔cloud, memory↔USB, …) interoperates with no per-pair code.
 *
 * Self-contained (depends only on ./types). No engine/SAB coupling.
 */
import type {
  Drive, DriveEntry, TransferOptions, TransferProgress,
} from './types.js'

const STREAM_THRESHOLD = 4 * 1024 * 1024 // stream files larger than this when both ends support it

function join(dir: string, name: string): string {
  if (dir === '/' || dir === '') return '/' + name
  return dir.replace(/\/$/, '') + '/' + name
}

/** POSIX-normalise to an absolute path with no trailing slash (root → "/"). */
function normPath(p: string): string {
  const parts: string[] = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return '/' + parts.join('/')
}

export type DriveEvent =
  | { type: 'mounted'; drive: Drive }
  | { type: 'unmounted'; id: string }
  | { type: 'changed'; id: string } // state/label changed

export class DriveManager {
  private drives = new Map<string, Drive>()
  private listeners = new Set<(e: DriveEvent) => void>()

  // ---- registry ----
  mount(drive: Drive): Drive {
    if (this.drives.has(drive.id)) throw new Error(`drive already mounted: ${drive.id}`)
    this.drives.set(drive.id, drive)
    this.emit({ type: 'mounted', drive })
    return drive
  }

  async unmount(id: string): Promise<void> {
    const d = this.drives.get(id)
    if (!d) return
    this.drives.delete(id)
    try { await d.dispose?.() } finally { this.emit({ type: 'unmounted', id }) }
  }

  get(id: string): Drive | undefined { return this.drives.get(id) }
  list(): Drive[] { return [...this.drives.values()] }
  has(id: string): boolean { return this.drives.has(id) }

  /** drivers call this when a drive's state/label changes (e.g. OAuth completes). */
  notifyChanged(id: string): void { if (this.drives.has(id)) this.emit({ type: 'changed', id }) }

  on(fn: (e: DriveEvent) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  private emit(e: DriveEvent): void { for (const fn of this.listeners) { try { fn(e) } catch { /* listener errors never break the manager */ } } }

  // ---- transfer ----
  /**
   * Copy (or move) a file or directory tree from one drive to another, emitting
   * progress. Pre-walks the source to compute totals so the Finder bar is exact,
   * then copies file-by-file. On `move`, sources are removed only after the whole
   * tree copies successfully (fast in-drive rename when src===dst).
   *
   * Semantics worth knowing:
   * - Directory copies **merge** into an existing destination (per-file overwrite
   *   governed by `opts.overwrite`); they do not replace it wholesale.
   * - A cross-drive `move` is copy-then-delete, so it is **not atomic** — an abort
   *   or error mid-transfer can leave a partial copy at the destination with the
   *   source still intact. Same-drive moves use the drive's atomic `rename`.
   * - `opts.signal` cancels between files and mid-file during streaming, rejecting
   *   with an `AbortError`.
   */
  async transfer(
    src: Drive, srcPath: string,
    dst: Drive, dstPath: string,
    opts: TransferOptions = {},
  ): Promise<void> {
    const { move = false, overwrite = true, onProgress, signal } = opts
    // Normalise at the boundary so `rel`-by-slice below and every drive op agree
    // on path shape regardless of caller input (trailing slashes, "." / "..").
    srcPath = normPath(srcPath)
    dstPath = normPath(dstPath)

    // Same drive: prefer native rename/copy (atomic, no byte shuffling).
    if (src === dst) {
      const st = await src.stat(srcPath)
      const totalBytes = st.type === 'dir' ? 0 : st.size
      await dst.mkdir(parentOf(dstPath), { recursive: true }) // generic path mkdirs parents too — keep both consistent
      if (move) { await src.rename(srcPath, dstPath); onProgress?.({ totalBytes, movedBytes: totalBytes, totalFiles: 1, movedFiles: 1, current: dstPath }); return }
      if (src.copy) { await src.copy(srcPath, dstPath); onProgress?.({ totalBytes, movedBytes: totalBytes, totalFiles: 1, movedFiles: 1, current: dstPath }); return }
      // no native copy → fall through to generic walk
    }

    const files = await this.walk(src, srcPath)
    const totalBytes = files.reduce((n, f) => n + f.size, 0)
    const totalFiles = files.filter((f) => f.type === 'file').length
    const progress: TransferProgress = { totalBytes, movedBytes: 0, totalFiles, movedFiles: 0, current: '' }
    onProgress?.({ ...progress })

    const writeAll = async () => {
      for (const f of files) {
        throwIfAborted(signal)
        const rel = f.path.slice(srcPath.length).replace(/^\//, '')
        const target = rel ? join(dstPath, rel) : dstPath
        progress.current = f.path

        if (f.type === 'dir') { await dst.mkdir(target, { recursive: true }); continue }

        if (!overwrite && (await dst.exists(target))) { progress.movedFiles++; progress.movedBytes += f.size; onProgress?.({ ...progress }); continue }
        await dst.mkdir(parentOf(target), { recursive: true })
        await this.copyFile(src, f.path, dst, target, f.size, (delta) => { progress.movedBytes += delta; onProgress?.({ ...progress }) }, signal)

        progress.movedFiles++
        onProgress?.({ ...progress })
      }
    }
    // Persist-per-op drives (localStorage/IndexedDB) collapse the whole write
    // burst into one commit; others run it directly.
    if (dst.batch) await dst.batch(writeAll)
    else await writeAll()

    if (move) {
      throwIfAborted(signal)
      await src.remove(srcPath, { recursive: true })
    }
  }

  /** Stream a single file when both ends support it and it's large; else buffer. */
  private async copyFile(
    src: Drive, srcPath: string,
    dst: Drive, dstPath: string,
    size: number,
    onBytes: (delta: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const canStream = size >= STREAM_THRESHOLD && src.capabilities.streaming && dst.capabilities.streaming && src.createReadable && dst.createWritable
    if (canStream) {
      const r = await src.createReadable!(srcPath)
      // If opening the sink fails, don't leak the source handle.
      const w = await dst.createWritable!(dstPath, size).catch(async (e: unknown) => { await r.close(); throw e })
      try {
        for (;;) {
          throwIfAborted(signal) // cancel mid-file, not just between files
          const chunk = await r.read()
          if (!chunk) break
          await w.write(chunk)
          onBytes(chunk.byteLength)
        }
        await w.close()
      } catch (e) {
        await w.abort?.(e); throw e // abort discards the partial destination
      } finally {
        await r.close()
      }
      return
    }
    const data = await src.readFile(srcPath)
    await dst.writeFile(dstPath, data)
    onBytes(data.byteLength)
  }

  /** Depth-first listing of a path: dirs (parents before children) then files. */
  private async walk(drive: Drive, root: string): Promise<Array<{ path: string; type: DriveEntry['type']; size: number }>> {
    const st = await drive.stat(root)
    if (st.type !== 'dir') return [{ path: root, type: st.type, size: st.size }]

    const out: Array<{ path: string; type: DriveEntry['type']; size: number }> = [{ path: root, type: 'dir', size: 0 }]
    const stack = [root]
    while (stack.length) {
      const dir = stack.pop()!
      for (const e of await drive.list(dir)) {
        const p = join(dir, e.name)
        if (e.type === 'dir') { out.push({ path: p, type: 'dir', size: 0 }); stack.push(p) }
        else out.push({ path: p, type: e.type, size: e.size })
      }
    }
    return out
  }

  async dispose(): Promise<void> {
    for (const id of [...this.drives.keys()]) await this.unmount(id)
    this.listeners.clear()
  }
}

function parentOf(path: string): string { const i = path.lastIndexOf('/'); return i <= 0 ? '/' : path.slice(0, i) }
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) { const e = new Error('transfer aborted'); (e as { name?: string }).name = 'AbortError'; throw e }
}
