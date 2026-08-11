/**
 * `glob` throughput, and what `exclude` costs.
 *
 * The exclude rework added a check *before descending* into a directory, on the traversal hot
 * path. With no `exclude` given the predicate is `undefined` and the guard is a single falsy
 * test — the first two cases are here to keep that honest.
 *
 * `exclude` that prunes should be **faster** than one that does not, because pruning skips whole
 * subtrees rather than walking them and filtering afterwards.
 */

import { bench, describe } from 'vitest';
import { createFsHarness } from './helpers/engine-transport.js';

const { fs } = createFsHarness();

// 10 directories x 20 files, plus a nested level — enough that pruning is measurable.
fs.mkdirSync('/tree');
for (let d = 0; d < 10; d++) {
  fs.mkdirSync(`/tree/d${d}`);
  fs.mkdirSync(`/tree/d${d}/nested`);
  for (let f = 0; f < 20; f++) {
    fs.writeFileSync(`/tree/d${d}/f${f}.ts`, 'x');
    fs.writeFileSync(`/tree/d${d}/nested/n${f}.ts`, 'x');
  }
}
fs.mkdirSync('/tree/node_modules');
for (let f = 0; f < 200; f++) fs.writeFileSync(`/tree/node_modules/m${f}.ts`, 'x');

const g = fs as unknown as { globSync(p: string, o?: Record<string, unknown>): unknown[] };

describe('glob', () => {
  bench('**/*.ts, no exclude', () => { g.globSync('**/*.ts', { cwd: '/tree' }); });

  bench('*.ts (one level), no exclude', () => { g.globSync('*.ts', { cwd: '/tree/d0' }); });

  bench('**/*.ts, exclude prunes node_modules', () => {
    g.globSync('**/*.ts', { cwd: '/tree', exclude: (n: string) => n === 'node_modules' });
  });

  bench('**/*.ts, exclude matches nothing', () => {
    g.globSync('**/*.ts', { cwd: '/tree', exclude: (n: string) => n === 'never-matches' });
  });

  bench('**/*.ts, exclude by pattern', () => {
    g.globSync('**/*.ts', { cwd: '/tree', exclude: ['node_modules/**'] });
  });
});
