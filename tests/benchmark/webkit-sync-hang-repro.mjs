import { webkit } from '../../node_modules/playwright/index.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ctx = await webkit.launchPersistentContext(mkdtempSync(join(tmpdir(), 'wk-p-')));
const page = await ctx.newPage();
page.on('console', m => console.log('[pw]', m.text()));
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://localhost:3519/correctness.html');
// Fire-and-forget evaluate; stages log via console so we see progress live
const done = page.evaluate(async () => {
  const t0 = performance.now();
  const log = (s) => console.log(`+${Math.round(performance.now() - t0)}ms ${s}`);
  const mod = await import('/index.js');
  log('import done');
  const fs = new mod.VFSFileSystem({ root: '/probe-instr1' });
  await fs.init();
  log('init done');
  const data = new TextEncoder().encode('probe');
  fs.writeFileSync('/one.txt', data);
  log('write 1 done');
  const r = fs.readFileSync('/one.txt');
  log('read 1 done len=' + r.byteLength);
  for (let i = 0; i < 10; i++) fs.writeFileSync(`/f${i}.txt`, data);
  log('10 writes done');
  fs.mkdirSync('/d', { recursive: true });
  log('mkdir done');
  const n = fs.readdirSync('/').length;
  log('readdir root done n=' + n);
  await fs.promises.writeFile('/async.txt', data);
  log('async write done');
  return 'OK';
}).catch(e => 'EVAL ERROR: ' + e.message);
const result = await Promise.race([done, new Promise(r => setTimeout(() => r('OVERALL TIMEOUT 60s'), 60000))]);
console.log('RESULT:', result);
await ctx.close();
process.exit(0);
