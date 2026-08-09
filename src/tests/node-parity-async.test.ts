/**
 * Differential parity for the **async** paths, against real `node:fs/promises`.
 *
 * The sync and async paths do not share an encoder end to end: the sync method layer builds its
 * own request frames, while the async layer hands (op, path, data, fdArgs) to a relay worker
 * that shapes the frame there. That second shaping step is a place the two can silently
 * disagree — and did: `FTRUNCATE` was encoded with a uint32 length on the async side and a
 * float64 length everywhere else, so `await fileHandle.truncate(n)` was rejected as EINVAL.
 *
 * These run the promise API against `node:fs/promises` on a real temp directory, the same way
 * [node-parity.test.ts](./node-parity.test.ts) does for the sync API.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as nodefs from 'node:fs';
import * as nodefsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHarness, type Harness } from './helpers/engine-transport.js';
import { readFile } from '../src/methods/readFile.js';
import { writeFile } from '../src/methods/writeFile.js';
import { appendFile } from '../src/methods/appendFile.js';
import { mkdir } from '../src/methods/mkdir.js';
import { readdir } from '../src/methods/readdir.js';
import { stat } from '../src/methods/stat.js';
import { rm as vfsRm } from '../src/methods/rm.js';
import { rename } from '../src/methods/rename.js';
import { truncate } from '../src/methods/truncate.js';
import { chmod } from '../src/methods/chmod.js';
import { open } from '../src/methods/open.js';

let harness: Harness;
let root: string;

beforeEach(() => {
  harness = createHarness();
  root = nodefs.mkdtempSync(join(tmpdir(), 'parity-async-'));
});

afterEach(() => {
  nodefs.rmSync(root, { recursive: true, force: true });
});

const real = (p: string) => join(root, p);
const text = (v: unknown) => (typeof v === 'string' ? v : new TextDecoder().decode(v as Uint8Array));

async function compare<T>(ours: () => Promise<T>, theirs: () => Promise<T>) {
  const run = async <R>(fn: () => Promise<R>): Promise<R | string> => {
    try {
      return await fn();
    } catch (e) {
      return `ERR:${(e as NodeJS.ErrnoException).code ?? (e as Error).name}`;
    }
  };
  return { ours: await run(ours), theirs: await run(theirs) };
}

async function same<T>(ours: () => Promise<T>, theirs: () => Promise<T>, label?: string) {
  const r = await compare(ours, theirs);
  expect(r.ours, label).toEqual(r.theirs);
  return r.ours;
}

describe('parity (async): files', () => {
  it('write then read round-trips identically', async () => {
    await same(
      async () => { await writeFile(harness.asyncRequest, '/a', 'hello'); return text(await readFile(harness.asyncRequest, '/a', 'utf8')); },
      async () => { await nodefsp.writeFile(real('a'), 'hello'); return nodefsp.readFile(real('a'), 'utf8'); }
    );
  });

  it('reading a missing file rejects with the same code', async () => {
    await same(
      () => readFile(harness.asyncRequest, '/nope', 'utf8') as Promise<string>,
      () => nodefsp.readFile(real('nope'), 'utf8')
    );
  });

  it('append builds the same file', async () => {
    await same(
      async () => {
        for (let i = 0; i < 20; i++) await appendFile(harness.asyncRequest, '/log', `${i},`);
        return text(await readFile(harness.asyncRequest, '/log', 'utf8'));
      },
      async () => {
        for (let i = 0; i < 20; i++) await nodefsp.appendFile(real('log'), `${i},`);
        return nodefsp.readFile(real('log'), 'utf8');
      }
    );
  });

  it('writeFile honours an explicit mode on creation', async () => {
    await same(
      async () => { await writeFile(harness.asyncRequest, '/m', 'x', { mode: 0o600 }); return ((await stat(harness.asyncRequest, '/m')) as nodefs.Stats).mode & 0o777; },
      async () => { await nodefsp.writeFile(real('m'), 'x', { mode: 0o600 }); return (await nodefsp.stat(real('m'))).mode & 0o777; }
    );
  });

  it('truncate shortens to the requested length, not to zero', async () => {
    await same(
      async () => { await writeFile(harness.asyncRequest, '/t', 'abcdef'); await truncate(harness.asyncRequest, '/t', 4); return text(await readFile(harness.asyncRequest, '/t', 'utf8')); },
      async () => { await nodefsp.writeFile(real('t'), 'abcdef'); await nodefsp.truncate(real('t'), 4); return nodefsp.readFile(real('t'), 'utf8'); }
    );
  });

  it('chmod is reflected in stat', async () => {
    await same(
      async () => { await writeFile(harness.asyncRequest, '/c', 'x'); await chmod(harness.asyncRequest, '/c', 0o640); return ((await stat(harness.asyncRequest, '/c')) as nodefs.Stats).mode & 0o777; },
      async () => { await nodefsp.writeFile(real('c'), 'x'); await nodefsp.chmod(real('c'), 0o640); return (await nodefsp.stat(real('c'))).mode & 0o777; }
    );
  });
});

describe('parity (async): directories', () => {
  it('recursive mkdir then readdir agree', async () => {
    await same(
      async () => {
        await mkdir(harness.asyncRequest, '/a/b', { recursive: true });
        await writeFile(harness.asyncRequest, '/a/f', '');
        return (await readdir(harness.asyncRequest, '/a') as string[]).slice().sort();
      },
      async () => {
        await nodefsp.mkdir(real('a/b'), { recursive: true });
        await nodefsp.writeFile(real('a/f'), '');
        return (await nodefsp.readdir(real('a'))).slice().sort();
      }
    );
  });

  it('mkdir on an existing path rejects with the same code', async () => {
    await same(
      async () => { await mkdir(harness.asyncRequest, '/d'); await mkdir(harness.asyncRequest, '/d'); },
      async () => { await nodefsp.mkdir(real('d')); await nodefsp.mkdir(real('d')); }
    );
  });

  it('rm without recursive rejects on a directory, with recursive succeeds', async () => {
    await same(
      async () => { await mkdir(harness.asyncRequest, '/d'); await vfsRm(harness.asyncRequest, '/d'); },
      async () => { await nodefsp.mkdir(real('d')); await nodefsp.rm(real('d')); }
    );
    await same(
      async () => { await vfsRm(harness.asyncRequest, '/d', { recursive: true }); return 'gone'; },
      async () => { await nodefsp.rm(real('d'), { recursive: true }); return 'gone'; }
    );
  });

  it('rename moves the file', async () => {
    await same(
      async () => { await writeFile(harness.asyncRequest, '/a', 'v'); await rename(harness.asyncRequest, '/a', '/b'); return text(await readFile(harness.asyncRequest, '/b', 'utf8')); },
      async () => { await nodefsp.writeFile(real('a'), 'v'); await nodefsp.rename(real('a'), real('b')); return nodefsp.readFile(real('b'), 'utf8'); }
    );
  });
});

describe('parity (async): FileHandle', () => {
  it('truncate on a handle shortens the file', async () => {
    // Regression: the async relay encoded FTRUNCATE's length as a uint32 in an 8-byte payload
    // while every decoder expects a float64 in 12, so this rejected with EINVAL.
    await same(
      async () => {
        await writeFile(harness.asyncRequest, '/h', 'abcdef');
        const fh = await open(harness.asyncRequest, '/h', 'r+');
        await fh.truncate(4);
        await fh.close();
        return text(await readFile(harness.asyncRequest, '/h', 'utf8'));
      },
      async () => {
        await nodefsp.writeFile(real('h'), 'abcdef');
        const fh = await nodefsp.open(real('h'), 'r+');
        await fh.truncate(4);
        await fh.close();
        return nodefsp.readFile(real('h'), 'utf8');
      }
    );
  });

  it('write then read through a handle round-trips', async () => {
    await same(
      async () => {
        const fh = await open(harness.asyncRequest, '/w', 'w+');
        await fh.write(new TextEncoder().encode('payload'), 0, 7, 0);
        await fh.close();
        return text(await readFile(harness.asyncRequest, '/w', 'utf8'));
      },
      async () => {
        const fh = await nodefsp.open(real('w'), 'w+');
        await fh.write(Buffer.from('payload'), 0, 7, 0);
        await fh.close();
        return nodefsp.readFile(real('w'), 'utf8');
      }
    );
  });

  it('stat through a handle reports the same size and type', async () => {
    await same(
      async () => {
        await writeFile(harness.asyncRequest, '/s', 'abcd');
        const fh = await open(harness.asyncRequest, '/s', 'r');
        const st = await fh.stat();
        await fh.close();
        return [st.size, st.isFile()];
      },
      async () => {
        await nodefsp.writeFile(real('s'), 'abcd');
        const fh = await nodefsp.open(real('s'), 'r');
        const st = await fh.stat();
        await fh.close();
        return [st.size, st.isFile()];
      }
    );
  });

  it('readFile through a handle returns the whole file', async () => {
    await same(
      async () => {
        await writeFile(harness.asyncRequest, '/r', 'x'.repeat(5000));
        const fh = await open(harness.asyncRequest, '/r', 'r');
        const out = await fh.readFile();
        await fh.close();
        return text(out).length;
      },
      async () => {
        await nodefsp.writeFile(real('r'), 'x'.repeat(5000));
        const fh = await nodefsp.open(real('r'), 'r');
        const out = await fh.readFile();
        await fh.close();
        return out.length;
      }
    );
  });

  it('opening a missing file rejects with the same code', async () => {
    await same(
      () => open(harness.asyncRequest, '/gone', 'r') as unknown as Promise<unknown>,
      () => nodefsp.open(real('gone'), 'r') as unknown as Promise<unknown>
    );
  });
});
