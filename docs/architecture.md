# Architecture

How a blocking `readFileSync` is actually served — the SharedArrayBuffer relay, the worker layout, and leader election.

← Back to the [readme](../readme.md).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Main Thread                              │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │   Sync API   │  │  Async API   │  │    Path / Constants    │  │
│  │ readFileSync │  │  promises.   │  │ join, dirname, etc.    │  │
│  │writeFileSync │  │  readFile    │  └────────────────────────┘  │
│  └──────┬───────┘  └──────┬───────┘                              │
│         │                 │                                      │
│   SAB + Atomics     postMessage                                  │
└─────────┼─────────────────┼──────────────────────────────────────┘
          │                 │
          ▼                 ▼
┌──────────────────────────────────────────────────────────────────┐
│               sync-relay Worker (Leader)                         │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                     VFS Engine                             │  │
│  │  ┌──────────────────┐  ┌─────────────┐  ┌──────────────┐   │  │
│  │  │  VFS Binary File │  │  Inode/Path │  │  Block Data  │   │  │
│  │  │  (.vfs.bin OPFS) │  │    Table    │  │   Region     │   │  │
│  │  └──────────────────┘  └─────────────┘  └──────────────┘   │  │
│  └────────────────────────────────────────────────────────────┘  │
│                            │                                     │
│                    notifyOPFSSync()                              │
│                     (fire & forget)                              │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    opfs-sync Worker                              │
│  ┌────────────────────┐  ┌────────────────────────────────────┐  │
│  │  VFS → OPFS Mirror │  │  FileSystemObserver (OPFS → VFS)   │  │
│  │  (queue + echo     │  │  External changes detected and     │  │
│  │   suppression)     │  │  synced back to VFS engine         │  │
│  └────────────────────┘  └────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘

Multi-tab (via Service Worker + navigator.locks):
  Tab 1 (Leader) ←→ Service Worker ←→ Tab 2 (Follower)
  Tab 1 holds VFS engine, Tab 2 forwards requests via MessagePort
  If Tab 1 dies, Tab 2 auto-promotes to leader
```
