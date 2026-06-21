/**
 * In-memory Drive — a real "Memory disk" and the reference `Drive`.
 *
 * It IS a `TreeDrive` with no persistence: the base already provides the complete
 * POSIX tree (Map<path, node> with per-dir child sets, batch/copy guards, streaming
 * handles), and `hydrate()`/`commit()` default to no-ops — exactly a RAM disk.
 * Lives in the one tab/worker that created it, so apps run from it at full speed
 * with zero OPFS/SAB round-trips.
 */
import { TreeDrive } from './tree-drive.js'

const enc = new TextEncoder()

export class MemoryDrive extends TreeDrive {
  readonly kind = 'memory' as const
  readonly icon = 'memory'

  constructor(id: string, label = 'Memory') { super(id, label) }

  /** convenience for seeding/tests */
  writeText(path: string, text: string): Promise<void> { return this.writeFile(path, enc.encode(text)) }
}
