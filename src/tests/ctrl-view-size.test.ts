/**
 * Every control-SAB view must cover every header slot.
 *
 * The views were built as `new Int32Array(sab, 0, 8)` — 32 bytes — and WORK was later added at
 * byte 32. Atomics on it then threw `Invalid atomic access index`: in `opfs` mode every write
 * failed with EIO (the relay's progress bump threw) and the page's wait threw too. The views are
 * now sized from the header, and this keeps a new slot from falling outside them again.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SAB_OFFSETS, CTRL_INT32S } from '../src/protocol/opcodes.js';

describe('control SAB views', () => {
  it('span the whole header, so every slot is addressable', () => {
    expect(CTRL_INT32S * 4).toBe(SAB_OFFSETS.HEADER_SIZE);
    for (const [name, offset] of Object.entries(SAB_OFFSETS)) {
      if (name === 'HEADER_SIZE' || name === 'TOTAL_LEN') continue; // TOTAL_LEN is a BigUint64, read via DataView
      expect(offset >> 2, name).toBeLessThan(CTRL_INT32S);
    }
  });

  it('are all built with CTRL_INT32S, not a literal length', () => {
    const root = resolve(process.cwd(), 'src');
    const files = [join(root, 'filesystem.ts'), ...readdirSync(join(root, 'workers')).filter((f) => f.endsWith('.ts')).map((f) => join(root, 'workers', f))];
    // The header views are the ones named ctrl / asyncCtrl; single-slot views (readySignal, the
    // wake hint on slot 0) are a different thing and rightly take a length of 1.
    const view = /\b(?:this\.)?(?:ctrl|asyncCtrl)\s*=\s*new Int32Array\(([^)]*)\)/g;
    let seen = 0;
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(view)) {
        seen++;
        expect(m[1].replace(/\s+/g, ''), f).toMatch(/,0,CTRL_INT32S$/);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(10); // the guard must actually be looking at the views
  });
});
