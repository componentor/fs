/**
 * Differential parity for instance-level features, browser vs real `node:fs`.
 *
 * [node-parity.test.ts](../../src/tests/node-parity.test.ts) diffs the *method layer* against
 * `node:fs` inside Node. It cannot reach `cp`, `opendir`, the streams, or `watch`, because those
 * live on `VFSFileSystem` and need real workers to exist. Their unit tests assert behaviour
 * someone believed Node has — the same blind spot that hid three wire-format bugs.
 *
 * A Playwright spec can close that: the test body runs in **Node**, so it can drive `node:fs` on
 * a temp directory, while `page.evaluate` drives the library in a **browser** against real OPFS.
 * Running the same script in both and comparing the results gives these features the same
 * no-room-for-a-wrong-expectation coverage the method layer already has.
 */

import { test, expect } from './fixtures';
import * as nodefs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Recursively describe a tree as sorted "path:contents" lines, for comparison. */
function describeTreeNode(root: string, dir = ''): string[] {
  const out: string[] = [];
  const full = dir ? join(root, dir) : root;
  for (const name of nodefs.readdirSync(full).sort()) {
    const rel = dir ? `${dir}/${name}` : name;
    const st = nodefs.lstatSync(join(root, rel));
    if (st.isDirectory()) {
      out.push(`d ${rel}`);
      out.push(...describeTreeNode(root, rel));
    } else if (st.isSymbolicLink()) {
      out.push(`l ${rel} -> ${nodefs.readlinkSync(join(root, rel))}`);
    } else {
      out.push(`f ${rel} = ${nodefs.readFileSync(join(root, rel), 'utf8')}`);
    }
  }
  return out;
}

test.describe('instance-level parity with node:fs', () => {
  test.setTimeout(120_000);

  let root: string;
  test.beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'inst-parity-')); });
  test.afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  test('cp -r reproduces the same tree as node:fs', async ({ page }) => {
    // --- Node side ---
    nodefs.mkdirSync(join(root, 'src/nested/deep'), { recursive: true });
    nodefs.writeFileSync(join(root, 'src/top.txt'), 'top');
    nodefs.writeFileSync(join(root, 'src/nested/mid.txt'), 'mid');
    nodefs.writeFileSync(join(root, 'src/nested/deep/leaf.txt'), 'leaf');
    nodefs.mkdirSync(join(root, 'src/empty'));
    nodefs.cpSync(join(root, 'src'), join(root, 'dst'), { recursive: true });
    const nodeTree = describeTreeNode(join(root, 'dst'));

    // --- Browser side ---
    const browserTree = await page.goto('/correctness.html').then(() => page.evaluate(async () => {
      try {
        const opfsRoot = await navigator.storage.getDirectory();
        await opfsRoot.removeEntry('ct-instance-cp', { recursive: true });
      } catch { /* didn't exist */ }
      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: '/ct-instance-cp' });
      await fs.init();
      try { await fs.promises.rm('/', { recursive: true, force: true }); } catch { /* fresh */ }

      fs.mkdirSync('/src/nested/deep', { recursive: true });
      fs.writeFileSync('/src/top.txt', 'top');
      fs.writeFileSync('/src/nested/mid.txt', 'mid');
      fs.writeFileSync('/src/nested/deep/leaf.txt', 'leaf');
      fs.mkdirSync('/src/empty');
      fs.cpSync('/src', '/dst', { recursive: true });

      const describe = (dir: string, prefix = ''): string[] => {
        const out: string[] = [];
        for (const name of [...fs.readdirSync(dir)].sort()) {
          const rel = prefix ? `${prefix}/${name}` : name;
          const st = fs.lstatSync(`${dir}/${name}`);
          if (st.isDirectory()) {
            out.push(`d ${rel}`);
            out.push(...describe(`${dir}/${name}`, rel));
          } else if (st.isSymbolicLink()) {
            out.push(`l ${rel} -> ${fs.readlinkSync(`${dir}/${name}`)}`);
          } else {
            out.push(`f ${rel} = ${fs.readFileSync(`${dir}/${name}`, 'utf8')}`);
          }
        }
        return out;
      };
      return describe('/dst');
    }));

    expect(browserTree).toEqual(nodeTree);
    // Guard against the comparison passing because both sides produced nothing.
    expect(nodeTree.length).toBeGreaterThan(5);
  });

  test('cp without recursive fails on a directory, as in node:fs', async ({ page }) => {
    nodefs.mkdirSync(join(root, 'd'));
    let nodeCode = 'no-throw';
    try { nodefs.cpSync(join(root, 'd'), join(root, 'e')); } catch (e) { nodeCode = (e as NodeJS.ErrnoException).code ?? 'ERR'; }

    const browserCode = await page.goto('/correctness.html').then(() => page.evaluate(async () => {
      try {
        const opfsRoot = await navigator.storage.getDirectory();
        await opfsRoot.removeEntry('ct-instance-cp2', { recursive: true });
      } catch { /* didn't exist */ }
      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: '/ct-instance-cp2' });
      await fs.init();
      try { await fs.promises.rm('/', { recursive: true, force: true }); } catch { /* fresh */ }
      fs.mkdirSync('/d');
      try { fs.cpSync('/d', '/e'); return 'no-throw'; } catch (e: any) { return e.code ?? 'ERR'; }
    }));

    expect(browserCode).toBe(nodeCode);
  });

  test('cp with errorOnExist reports the same code as node:fs', async ({ page }) => {
    nodefs.writeFileSync(join(root, 'a'), 'x');
    nodefs.writeFileSync(join(root, 'b'), 'y');
    let nodeCode = 'no-throw';
    try {
      nodefs.cpSync(join(root, 'a'), join(root, 'b'), { errorOnExist: true, force: false });
    } catch (e) { nodeCode = (e as NodeJS.ErrnoException).code ?? 'ERR'; }

    const browserCode = await page.goto('/correctness.html').then(() => page.evaluate(async () => {
      try {
        const opfsRoot = await navigator.storage.getDirectory();
        await opfsRoot.removeEntry('ct-instance-cp3', { recursive: true });
      } catch { /* didn't exist */ }
      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: '/ct-instance-cp3' });
      await fs.init();
      try { await fs.promises.rm('/', { recursive: true, force: true }); } catch { /* fresh */ }
      fs.writeFileSync('/a', 'x');
      fs.writeFileSync('/b', 'y');
      try {
        fs.cpSync('/a', '/b', { errorOnExist: true, force: false });
        return 'no-throw';
      } catch (e: any) { return e.code ?? 'ERR'; }
    }));

    expect(browserCode).toBe(nodeCode);
    expect(nodeCode).toBe('ERR_FS_CP_EEXIST');
  });

  test('opendir iterates the same entries as node:fs', async ({ page }) => {
    nodefs.mkdirSync(join(root, 'dir/sub'), { recursive: true });
    for (const n of ['a.txt', 'b.txt', 'héllo.txt']) nodefs.writeFileSync(join(root, 'dir', n), '');
    const nodeEntries: string[] = [];
    const nd = await nodefs.promises.opendir(join(root, 'dir'));
    for await (const e of nd) nodeEntries.push(`${e.name}:${e.isDirectory() ? 'd' : 'f'}`);
    nodeEntries.sort();

    const browserEntries = await page.goto('/correctness.html').then(() => page.evaluate(async () => {
      try {
        const opfsRoot = await navigator.storage.getDirectory();
        await opfsRoot.removeEntry('ct-instance-dir', { recursive: true });
      } catch { /* didn't exist */ }
      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: '/ct-instance-dir' });
      await fs.init();
      try { await fs.promises.rm('/', { recursive: true, force: true }); } catch { /* fresh */ }
      fs.mkdirSync('/dir/sub', { recursive: true });
      for (const n of ['a.txt', 'b.txt', 'héllo.txt']) fs.writeFileSync(`/dir/${n}`, '');

      const out: string[] = [];
      const d = await fs.promises.opendir('/dir');
      for await (const e of d) out.push(`${e.name}:${e.isDirectory() ? 'd' : 'f'}`);
      return out.sort();
    }));

    expect(browserEntries).toEqual(nodeEntries);
    expect(nodeEntries).toHaveLength(4);
  });

  test('several writes queued in one tick land in order', async ({ page }) => {
    // Through the real relay and OPFS: writes used to be dispatched concurrently, so two
    // synchronous write() calls both started at the same offset and the second overwrote the
    // first. See CHANGELOG 3.3.21.
    const chunks = ['abc', 'def', 'ghi', 'jkl'];

    await new Promise<void>((resolve, reject) => {
      const ws = nodefs.createWriteStream(join(root, 'n.txt'));
      ws.on('finish', () => resolve());
      ws.on('error', reject);
      for (const c of chunks) ws.write(c);
      ws.end();
    });
    const expected = nodefs.readFileSync(join(root, 'n.txt'), 'utf8');

    const actual = await page.goto('/correctness.html').then(() => page.evaluate(async (cs) => {
      try {
        const opfsRoot = await navigator.storage.getDirectory();
        await opfsRoot.removeEntry('ct-stream-order', { recursive: true });
      } catch { /* fresh */ }
      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: '/ct-stream-order' });
      await fs.init();
      try { await fs.promises.rm('/', { recursive: true, force: true }); } catch { /* fresh */ }

      await new Promise<void>((resolve, reject) => {
        const ws = fs.createWriteStream('/w.txt');
        ws.on('finish', () => resolve());
        ws.on('error', reject);
        setTimeout(() => reject(new Error('write stream never finished')), 15_000);
        for (const c of cs) ws.write(c);
        ws.end();
      });
      return fs.readFileSync('/w.txt', 'utf8');
    }, chunks));

    expect(actual).toBe(expected);
    expect(actual).toBe('abcdefghijkl');
  });

  test('read and write streams move the same bytes as node:fs', async ({ page }) => {
    const payload = 'line-'.repeat(5000); // ~25 KB, spans many stream chunks
    nodefs.writeFileSync(join(root, 'in.txt'), payload);
    await new Promise<void>((resolve, reject) => {
      const rs = nodefs.createReadStream(join(root, 'in.txt'));
      const ws = nodefs.createWriteStream(join(root, 'out.txt'));
      rs.pipe(ws);
      ws.on('finish', () => resolve());
      ws.on('error', reject);
      rs.on('error', reject);
    });
    const nodeResult = {
      copied: nodefs.readFileSync(join(root, 'out.txt'), 'utf8') === payload,
      size: nodefs.statSync(join(root, 'out.txt')).size,
    };

    const browserResult = await page.goto('/correctness.html').then(() => page.evaluate(async (text) => {
      try {
        const opfsRoot = await navigator.storage.getDirectory();
        await opfsRoot.removeEntry('ct-instance-stream', { recursive: true });
      } catch { /* didn't exist */ }
      const mod = await import('/index.js') as any;
      const fs = new mod.VFSFileSystem({ root: '/ct-instance-stream' });
      await fs.init();
      try { await fs.promises.rm('/', { recursive: true, force: true }); } catch { /* fresh */ }

      fs.writeFileSync('/in.txt', text);
      await new Promise<void>((resolve, reject) => {
        const rs = fs.createReadStream('/in.txt');
        const ws = fs.createWriteStream('/out.txt');
        rs.pipe(ws);
        ws.on('finish', () => resolve());
        ws.on('error', reject);
        rs.on('error', reject);
        // Safety net so a stream that never finishes fails the test instead of hanging it.
        setTimeout(() => reject(new Error('stream pipe timed out')), 20_000);
      });
      return {
        copied: fs.readFileSync('/out.txt', 'utf8') === text,
        size: fs.statSync('/out.txt').size,
      };
    }, payload));

    expect(browserResult).toEqual(nodeResult);
    expect(nodeResult.copied).toBe(true);
  });
});
