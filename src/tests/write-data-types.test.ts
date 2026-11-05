/**
 * Differential test: what write / writeFile / appendFile do with each kind of data, against real
 * node:fs.
 *
 * Node takes a string or any ArrayBufferView (Buffer, TypedArray, DataView) and writes the view's
 * bytes; anything else is ERR_INVALID_ARG_TYPE — thrown at the call by the sync and callback
 * forms, a rejection from the promise forms. The data used to go unchecked: an ArrayBuffer (what
 * `file.arrayBuffer()` and `fetch` give you) became an empty file without a word, a DataView wrote
 * zeros, a Uint16Array wrote its element values truncated to bytes, and a number or null wrote
 * nothing or failed with an internal RangeError.
 */

import { describe, it, expect } from 'vitest';
import * as nodefs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFsHarness } from './helpers/engine-transport.js';

const enc = (s: string) => new TextEncoder().encode(s);
const inputs: [string, () => unknown][] = [
  ['string', () => 'abc'],
  ['Uint8Array', () => enc('abc')],
  ['Uint8Array view', () => enc('xabcx').subarray(1, 4)],
  ['ArrayBuffer', () => enc('abc').buffer],
  ['DataView', () => new DataView(enc('xabc').buffer, 1)],
  ['Uint16Array', () => new Uint16Array([0x6261, 0x63])],
  ['Float32Array', () => new Float32Array([1.5])],
  ['number', () => 42],
  ['object', () => ({ a: 1 })],
  ['null', () => null],
  ['undefined', () => undefined],
  // Iterables: only the promise forms take them (fsPromises and FileHandle writeFile/appendFile).
  ['array of strings', () => ['a', 'b']],
  ['generator of mixed chunks', () => (function* () { yield 'x'; yield enc('y'); yield new DataView(enc('z').buffer); })()],
  ['async generator', () => (async function* () { yield 'p'; yield 'q'; })()],
  ['Set', () => new Set(['s1', 's2'])],
  ['String object', () => new String('so')],
  ['chunks: ArrayBuffer and byte array', () => [enc('A').buffer, [66, 67, 256 + 68]]],
  ['empty array', () => []],
  ['bad chunk', () => ['a', 42]],
  ['null chunk', () => ['a', null]],
];

type Outcome = string;
const describeErr = (e: any) => `${e?.code} ${e?.message}`;
const bytes = (fs: any, p: string) => JSON.stringify(Array.from(fs.readFileSync(p) as Uint8Array));

/** Run one form for every input and record either the bytes written or the error. */
async function outcomes(fs: any, base: string, form: string): Promise<Record<string, Outcome>> {
  const out: Record<string, Outcome> = {};
  for (const [name, make] of inputs) {
    const p = `${base}/${form}-${name.replace(/ /g, '_')}`;
    try {
      switch (form) {
        case 'writeFileSync': fs.writeFileSync(p, make()); break;
        case 'appendFileSync': fs.appendFileSync(p, make()); break;
        case 'writeSync': { const fd = fs.openSync(p, 'w'); try { fs.writeSync(fd, make()); } finally { fs.closeSync(fd); } break; }
        case 'promises.writeFile': await fs.promises.writeFile(p, make()); break;
        case 'promises.appendFile': await fs.promises.appendFile(p, make()); break;
        case 'handle.write': { const h = await fs.promises.open(p, 'w'); try { await h.write(make()); } finally { await h.close(); } break; }
        case 'handle.writeFile': { const h = await fs.promises.open(p, 'w'); try { await h.writeFile(make()); } finally { await h.close(); } break; }
        case 'handle.appendFile': { const h = await fs.promises.open(p, 'a'); try { await h.appendFile(make()); } finally { await h.close(); } break; }
        case 'writeFile (callback)':
        case 'appendFile (callback)':
        case 'write (callback)': {
          // Record whether the error is thrown at the call or handed to the callback.
          const result = await new Promise<string>((resolve) => {
            const cb = (err: any) => resolve(err ? 'callback: ' + describeErr(err) : 'ok');
            try {
              if (form.startsWith('writeFile')) fs.writeFile(p, make(), cb);
              else if (form.startsWith('appendFile')) fs.appendFile(p, make(), cb);
              else { const fd = fs.openSync(p, 'w'); fs.write(fd, make(), (err: any) => { fs.closeSync(fd); cb(err); }); }
            } catch (e) {
              resolve('thrown: ' + describeErr(e));
            }
          });
          if (result !== 'ok') { out[name] = result; continue; }
          break;
        }
      }
      out[name] = 'ok ' + bytes(fs, p);
    } catch (e) {
      out[name] = describeErr(e);
    }
  }
  return out;
}

const forms = [
  'writeFileSync', 'appendFileSync', 'writeSync',
  'promises.writeFile', 'promises.appendFile',
  'handle.write', 'handle.writeFile', 'handle.appendFile',
  'writeFile (callback)', 'appendFile (callback)', 'write (callback)',
];

describe('write data types match node:fs', () => {
  it('iterable chunks are encoded with the encoding option, like Buffer.from(chunk, encoding)', async () => {
    const dir = nodefs.mkdtempSync(join(tmpdir(), 'write-data-'));
    try {
      const { fs } = createFsHarness();
      fs.mkdirSync('/t');
      await nodefs.promises.writeFile(join(dir, 'h'), ['6869', '21'], { encoding: 'hex' });
      await fs.promises.writeFile('/t/h', ['6869', '21'], { encoding: 'hex' });
      expect(fs.readFileSync('/t/h', 'latin1')).toBe(nodefs.readFileSync(join(dir, 'h'), 'latin1'));
      expect(fs.readFileSync('/t/h', 'latin1')).toBe('hi!');
    } finally {
      nodefs.rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const form of forms) {
    it(form, async () => {
      const dir = nodefs.mkdtempSync(join(tmpdir(), 'write-data-'));
      try {
        const node = await outcomes(nodefs, dir, form);
        const { fs } = createFsHarness();
        fs.mkdirSync('/t');
        const vfs = await outcomes(fs, '/t', form);
        expect(vfs).toEqual(node);
      } finally {
        nodefs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
