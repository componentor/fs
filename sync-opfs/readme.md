# sync-opfs

**Node's `fs` in the browser — including a real, blocking `readFileSync` — stored in OPFS.**

This package is an alias. Everything lives in [`@componentor/fs`](https://www.npmjs.com/package/@componentor/fs);
this is a re-export under a name that matches what people search for. Same code, same version,
same docs — pick whichever name you prefer.

```bash
npm install sync-opfs
```

```typescript
import { VFSFileSystem } from 'sync-opfs';

const fs = new VFSFileSystem({ root: '/my-app' });
await fs.init();

// Genuinely synchronous — not a callback pretending. Needs a cross-origin-isolated page.
fs.writeFileSync('/hello.txt', 'Hello!');
const text = fs.readFileSync('/hello.txt', 'utf8');

// Works everywhere, isolation or not.
await fs.promises.writeFile('/async.txt', 'hi');
```

**Full documentation, examples and the storage-mode guide:**
<https://github.com/componentor/fs#readme>
