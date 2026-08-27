# Maintenance helpers

Defragmentation, repair and the other volume-level operations.

← Back to the [readme](../readme.md).

---

Standalone utilities for VFS maintenance, recovery, and migration. Must be called from a Worker context (sync access handle requirement). Close any running `VFSFileSystem` instance first.

```typescript
import { unpackToOPFS, loadFromOPFS, repairVFS } from '@componentor/fs';

// Export VFS contents to real OPFS files (clears existing OPFS files first)
const { files, directories } = await unpackToOPFS('/my-app');

// Rebuild VFS from real OPFS files (deletes .vfs.bin, creates fresh VFS)
const { files, directories } = await loadFromOPFS('/my-app');

// Attempt to recover files from a corrupt VFS binary
const { recovered, lost, entries } = await repairVFS('/my-app');
console.log(`Recovered ${recovered} entries, lost ${lost}`);
for (const entry of entries) {
  console.log(`  ${entry.type} ${entry.path} (${entry.size} bytes)`);
}
```

| Function | Description |
|----------|-------------|
| `unpackToOPFS(root?)` | Read all files from VFS, write to real OPFS paths |
| `loadFromOPFS(root?)` | Read all OPFS files, create fresh VFS with their contents |
| `repairVFS(root?)` | Scan corrupt `.vfs.bin` for recoverable inodes, rebuild fresh VFS |
