# isomorphic-git

Running isomorphic-git on this filesystem, and what the benchmark suite measures.

← Back to the [readme](../readme.md).

---

## isomorphic-git Integration

```typescript
import { VFSFileSystem } from '@componentor/fs';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';

const fs = new VFSFileSystem({ root: '/repo' });

// Clone a repository
await git.clone({
  fs,
  http,
  dir: '/repo',
  url: 'https://github.com/user/repo',
  corsProxy: 'https://cors.isomorphic-git.org',
});

// Check status
const status = await git.statusMatrix({ fs, dir: '/repo' });

// Stage and commit
await git.add({ fs, dir: '/repo', filepath: '.' });
await git.commit({
  fs,
  dir: '/repo',
  message: 'Initial commit',
  author: { name: 'User', email: 'user@example.com' },
});
```
