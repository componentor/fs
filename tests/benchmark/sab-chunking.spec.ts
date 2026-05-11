/**
 * SAB protocol — multi-chunk request round-trips.
 *
 * A sync request whose *encoded payload* exceeds the SAB data window
 * (sabSize - HEADER_SIZE, default ≈ 2 MB) is sent to the relay worker in
 * chunks. This only happens for big writes (writeFileSync / writeSync /
 * appendFileSync of >~2 MB) and is exercised only in a real browser against
 * the SAB-backed sync path — the in-memory vitest suite never hits it.
 *
 * Regression guard for the bug where syncRequest waited on SIGNAL.REQUEST after
 * a multi-chunk send even though the last chunk left ctrl[0] at SIGNAL.CHUNK,
 * causing the spin-wait to fall through and read stale request bytes as the
 * response (or wedge waiting on a CHUNK_ACK that never came).
 *
 * Runs against the dist build via the benchmark server (which sets COOP/COEP so
 * the page is crossOriginIsolated and the sync API is available).
 */

import { test, expect } from '@playwright/test';

// Sizes chosen to straddle the default 2 MB SAB window:
//  - ~2.0 MB + a hair  → exactly 2 chunks, tiny final chunk
//  - 5 MB + an odd tail → 3 chunks, non-aligned final chunk
const SIZES = [
  2 * 1024 * 1024 + 777,
  5 * 1024 * 1024 + 0xCAFE,
];

test.describe('SAB protocol — multi-chunk request round-trips', () => {
  test.setTimeout(60_000);

  test('large writeFileSync / writeSync / promises.writeFile survive the round-trip', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/correctness.html');

    const report = await page.evaluate(async (sizes: number[]) => {
      const env = {
        crossOriginIsolated: (globalThis as unknown as { crossOriginIsolated: boolean }).crossOriginIsolated,
        hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      };

      // Deterministic, aperiodic-enough byte pattern: a shifted/folded index, so
      // truncation, length mismatch, or an offset shift in the data all show up.
      const pattern = (n: number): Uint8Array => {
        const a = new Uint8Array(n);
        for (let i = 0; i < n; i++) a[i] = (i + (i >>> 7) + (i >>> 13) + (i >>> 19)) & 0xff;
        return a;
      };
      const firstMismatch = (got: Uint8Array, want: Uint8Array): number => {
        if (got.byteLength !== want.byteLength) return -2; // length mismatch sentinel
        for (let i = 0; i < want.byteLength; i++) if (got[i] !== want[i]) return i;
        return -1;
      };

      const mod = await import('/index.js') as unknown as { VFSFileSystem: new (cfg: unknown) => {
        init(): Promise<unknown>;
        writeFileSync(p: string, d: Uint8Array): void;
        readFileSync(p: string): Uint8Array;
        openSync(p: string, flags: string): number;
        writeSync(fd: number, buf: Uint8Array, offset: number, length: number, position: number): number;
        closeSync(fd: number): void;
        promises: {
          writeFile(p: string, d: Uint8Array): Promise<void>;
          readFile(p: string): Promise<Uint8Array>;
          rm(p: string, o: { recursive: boolean; force: boolean }): Promise<void>;
        };
      } };

      const fs = new mod.VFSFileSystem({ root: '/ct-multichunk' });
      await fs.init();
      try { await fs.promises.rm('/', { recursive: true, force: true }); } catch { /* fresh */ }

      const cases: Array<{ name: string; size: number; mismatch: number; len: number }> = [];

      for (const size of sizes) {
        const data = pattern(size);

        // 1) writeFileSync → readFileSync (sync SAB path; OP.WRITE encoded request > maxChunk)
        fs.writeFileSync(`/wfs-${size}.bin`, data);
        const back1 = fs.readFileSync(`/wfs-${size}.bin`);
        cases.push({ name: `writeFileSync ${size}`, size, mismatch: firstMismatch(back1, data), len: back1.byteLength });

        // 2) fd writeSync → readFileSync (sync SAB path; OP.FWRITE encoded request > maxChunk)
        const fd = fs.openSync(`/ws-${size}.bin`, 'w');
        fs.writeSync(fd, data, 0, size, 0);
        fs.closeSync(fd);
        const back2 = fs.readFileSync(`/ws-${size}.bin`);
        cases.push({ name: `writeSync(fd) ${size}`, size, mismatch: firstMismatch(back2, data), len: back2.byteLength });

        // 3) promises.writeFile → promises.readFile (async-relay SAB path; also multi-chunk send)
        await fs.promises.writeFile(`/pwf-${size}.bin`, data);
        const back3 = await fs.promises.readFile(`/pwf-${size}.bin`);
        cases.push({ name: `promises.writeFile ${size}`, size, mismatch: firstMismatch(back3, data), len: back3.byteLength });
      }

      return { env, cases };
    }, SIZES);

    console.log('environment:', JSON.stringify(report.env));
    for (const c of report.cases) {
      const status = c.mismatch === -1 ? 'ok' : c.mismatch === -2 ? `LENGTH MISMATCH (${c.len})` : `BYTE MISMATCH @ ${c.mismatch}`;
      console.log(`  ${c.name.padEnd(32)} → ${status}`);
    }

    expect(report.env.crossOriginIsolated, 'benchmark server must make the page crossOriginIsolated for the sync SAB path').toBe(true);
    expect(report.env.hasSharedArrayBuffer).toBe(true);
    for (const c of report.cases) {
      expect(c.mismatch, `${c.name}: round-trip data must match (got len ${c.len})`).toBe(-1);
    }
    expect(consoleErrors, `no console errors during multi-chunk round-trips:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
