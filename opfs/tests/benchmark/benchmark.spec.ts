/**
 * OPFS-FS Benchmark Suite
 * Compares performance of OPFS-FS (all tiers) against LightningFS
 *
 * Run with: npm run benchmark
 */

import { test, expect } from '@playwright/test';

interface BenchmarkResult {
  operation: string;
  iterations: number;
  fileSize: number;
  fileSizeMB?: number;
  lightning: number;
  tier1: number | null;
  tier2: number | null;
  tier3: number;
}

test.describe('OPFS-FS Benchmark Suite', () => {
  test.setTimeout(120000); // 2 minutes for all benchmarks

  test('Full benchmark comparison: OPFS vs LightningFS', async ({ page }) => {
    // Navigate to benchmark page
    await page.goto('/');

    // Wait for page to load
    await page.waitForSelector('#btn-run-all');

    // Check environment
    const env = await page.evaluate(() => ({
      crossOriginIsolated: (globalThis as unknown as { crossOriginIsolated: boolean }).crossOriginIsolated,
      hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      hasAtomics: typeof Atomics !== 'undefined',
      hasOPFS: 'storage' in navigator,
    }));

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║              OPFS-FS BENCHMARK SUITE                        ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║ Cross-Origin Isolated: ${env.crossOriginIsolated ? '✅ Yes' : '❌ No (Tier 1 unavailable)'}`.padEnd(62) + '║');
    console.log(`║ SharedArrayBuffer:     ${env.hasSharedArrayBuffer ? '✅ Yes' : '❌ No'}`.padEnd(62) + '║');
    console.log(`║ Atomics:               ${env.hasAtomics ? '✅ Yes' : '❌ No'}`.padEnd(62) + '║');
    console.log(`║ OPFS Available:        ${env.hasOPFS ? '✅ Yes' : '❌ No'}`.padEnd(62) + '║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // Run all benchmarks
    console.log('Running benchmarks...\n');
    await page.click('#btn-run-all');

    // Wait for benchmarks to complete (check for success status)
    await page.waitForFunction(
      () => document.querySelector('#status')?.textContent?.includes('complete'),
      { timeout: 120000 }
    );

    // Get results
    const results: BenchmarkResult[] = await page.evaluate(() => {
      return (window as unknown as { getBenchmarkResults: () => BenchmarkResult[] }).getBenchmarkResults();
    });

    expect(results.length).toBeGreaterThan(0);

    // Print comparison table
    console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                                    BENCHMARK RESULTS                                              ║');
    console.log('╠════════════════════════╦═══════════════╦═══════════════╦═══════════════╦═══════════════╦═════════╣');
    console.log('║ Test                   ║ LightningFS   ║ OPFS Tier 1   ║ OPFS Tier 2   ║ OPFS Tier 3   ║ Winner  ║');
    console.log('╠════════════════════════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╬═════════╣');

    let totalLightning = 0;
    let totalOpfsBest = 0;

    for (const result of results) {
      const testName = result.operation === 'write'
        ? `Write ${result.iterations}×${result.fileSize}B`
        : result.operation === 'read'
        ? `Read ${result.iterations}×${result.fileSize}B`
        : `Large ${result.iterations}×${result.fileSizeMB}MB`;

      const values = [
        { name: 'LFS', ms: result.lightning },
        { name: 'T1', ms: result.tier1 },
        { name: 'T2', ms: result.tier2 },
        { name: 'T3', ms: result.tier3 },
      ].filter(v => v.ms !== null) as { name: string; ms: number }[];

      const minMs = Math.min(...values.map(v => v.ms));
      const winner = values.find(v => v.ms === minMs)!;

      totalLightning += result.lightning;
      totalOpfsBest += minMs === result.lightning ? result.lightning : Math.min(result.tier1 || Infinity, result.tier3);

      const formatMs = (ms: number | null) => {
        if (ms === null) return 'N/A'.padStart(11);
        const opsPerSec = Math.round(result.iterations / ms * 1000);
        return `${ms.toFixed(0).padStart(5)}ms ${opsPerSec.toString().padStart(4)}op/s`;
      };

      const winnerStr = winner.name === 'LFS' ? 'LFS' : `OPFS ${winner.name}`;
      const speedup = (result.lightning / minMs).toFixed(1);
      const winnerDisplay = winner.name === 'LFS' ? `${winnerStr}` : `${winnerStr} ${speedup}x`;

      console.log(
        `║ ${testName.padEnd(22)} ║ ${formatMs(result.lightning)} ║ ${formatMs(result.tier1)} ║ ${formatMs(result.tier2)} ║ ${formatMs(result.tier3)} ║ ${winnerDisplay.padEnd(7)} ║`
      );
    }

    console.log('╠════════════════════════╩═══════════════╩═══════════════╩═══════════════╩═══════════════╩═════════╣');

    const overallSpeedup = (totalLightning / totalOpfsBest).toFixed(2);
    const summaryLine = `║ Overall: OPFS is ${parseFloat(overallSpeedup) >= 1 ? overallSpeedup + 'x FASTER' : (1/parseFloat(overallSpeedup)).toFixed(2) + 'x slower'} than LightningFS on average`;
    console.log(summaryLine.padEnd(99) + '║');
    console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════════╝');

    // Print detailed bar chart
    console.log('\n📊 Performance Comparison (lower is better):\n');

    for (const result of results) {
      const testName = result.operation === 'write'
        ? `Write ${result.iterations}×${result.fileSize}B`
        : result.operation === 'read'
        ? `Read ${result.iterations}×${result.fileSize}B`
        : `Large ${result.iterations}×${result.fileSizeMB}MB`;

      console.log(`${testName}:`);

      const maxMs = Math.max(result.lightning, result.tier1 || 0, result.tier2 || 0, result.tier3);
      const scale = 50;

      const drawBar = (name: string, ms: number | null, emoji: string) => {
        if (ms === null) {
          console.log(`  ${emoji} ${name.padEnd(12)} N/A`);
          return;
        }
        const barLen = Math.round((ms / maxMs) * scale);
        const bar = '█'.repeat(barLen) + '░'.repeat(scale - barLen);
        const opsPerSec = Math.round(result.iterations / ms * 1000);
        console.log(`  ${emoji} ${name.padEnd(12)} ${bar} ${ms.toFixed(0)}ms (${opsPerSec} ops/s)`);
      };

      drawBar('LightningFS', result.lightning, '🟡');
      drawBar('OPFS Tier 1', result.tier1, '🟢');
      drawBar('OPFS Tier 2', result.tier2, '🔵');
      drawBar('OPFS Tier 3', result.tier3, '🟣');
      console.log('');
    }

    // Assertions - OPFS Tier 3 (async) should be competitive
    // Note: Sync operations (Tier 1/2) can't run in browser main thread
    // Tier 3 uses createWritable which is slower for small files but competitive for large files
    for (const result of results) {
      // Tier 3 should be within 10x for small files, faster for large files
      expect(result.tier3).toBeLessThan(result.lightning * 10);
    }
  });

  test('Individual: Write performance (1KB)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#btn-run-write');
    await page.click('#btn-run-write');

    await page.waitForFunction(
      () => document.querySelector('#status')?.textContent?.includes('complete'),
      { timeout: 60000 }
    );

    const results = await page.evaluate(() => (window as unknown as { getBenchmarkResults: () => BenchmarkResult[] }).getBenchmarkResults());
    expect(results.length).toBe(1);

    const result = results[0];
    console.log(`\nWrite 1KB benchmark:`);
    console.log(`  LightningFS: ${result.lightning.toFixed(2)}ms`);
    console.log(`  OPFS Tier 1: ${result.tier1?.toFixed(2) || 'N/A'}ms`);
    console.log(`  OPFS Tier 3: ${result.tier3.toFixed(2)}ms`);
  });

  test('Individual: Read performance (1KB)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#btn-run-read');
    await page.click('#btn-run-read');

    await page.waitForFunction(
      () => document.querySelector('#status')?.textContent?.includes('complete'),
      { timeout: 60000 }
    );

    const results = await page.evaluate(() => (window as unknown as { getBenchmarkResults: () => BenchmarkResult[] }).getBenchmarkResults());
    expect(results.length).toBe(1);

    const result = results[0];
    console.log(`\nRead 1KB benchmark:`);
    console.log(`  LightningFS: ${result.lightning.toFixed(2)}ms`);
    console.log(`  OPFS Tier 1: ${result.tier1?.toFixed(2) || 'N/A'}ms`);
    console.log(`  OPFS Tier 3: ${result.tier3.toFixed(2)}ms`);
  });

  test('Individual: Large file performance (1MB)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#btn-run-large');
    await page.click('#btn-run-large');

    await page.waitForFunction(
      () => document.querySelector('#status')?.textContent?.includes('complete'),
      { timeout: 60000 }
    );

    const results = await page.evaluate(() => (window as unknown as { getBenchmarkResults: () => BenchmarkResult[] }).getBenchmarkResults());
    expect(results.length).toBe(1);

    const result = results[0];
    console.log(`\nLarge file (1MB) benchmark:`);
    console.log(`  LightningFS: ${result.lightning.toFixed(2)}ms`);
    console.log(`  OPFS Tier 1: ${result.tier1?.toFixed(2) || 'N/A'}ms`);
    console.log(`  OPFS Tier 3: ${result.tier3.toFixed(2)}ms`);
  });
});
